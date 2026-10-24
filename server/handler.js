'use strict';
// Turns an HTTP request into a response. Used by the Netlify Function (netlify/functions/api.mjs),
// the scheduled function, and the local test server (dev/dev-server.js).
//
// Each request: checks the Microsoft sign-in session, loads the database (reusing the in-memory copy
// when nothing changed), runs the route, sends any Outlook changes, then saves the database
// back to storage only if something changed. If another request saved in the meantime,
// it reloads and runs the request again.
const D = require('./db');
const { getStore, ConflictError } = require('./store');
const api = require('./api');
const L = require('./logic');
const U = require('./util');
const graph = require('./graph');
const auth = require('./auth');

const cache = { etag: undefined, isNew: false, backedUp: null };
let chain = Promise.resolve();
function withLock(fn) { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; }

function json(status, obj, headers = {}) {
  return { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }, body: JSON.stringify(obj) };
}

function originOf(headers) {
  try { if (headers['x-ms-original-url']) return new URL(headers['x-ms-original-url']).origin; } catch { /* fall through */ }
  const host = headers['x-forwarded-host'] || headers.host || '';
  const proto = headers['x-forwarded-proto'] || (/^(localhost|127\.)/.test(host) ? 'http' : 'https');
  return host ? `${proto}://${host.split(',')[0].trim()}` : '';
}

async function ensureLoaded(force = false) {
  const store = getStore();
  const tag = await store.etag();
  if (force || !D.db.ready || tag !== cache.etag) {
    const { bytes, etag } = await store.read();
    await D.open(bytes);
    cache.etag = etag; cache.isNew = !bytes;
  }
}

async function save() {
  const store = getStore();
  const bytes = D.exportBytes();
  cache.etag = await store.write(bytes, cache.etag);
  cache.isNew = false;
  const day = U.today();
  if (cache.backedUp !== day) { await store.backup(bytes, day).catch(() => {}); cache.backedUp = day; }
}

function interesting(counts) {
  if (!counts) return false;
  return Object.entries(counts).some(([k, v]) => !['echo', 'cached', 'skip', 'complete'].includes(k) && v > 0);
}

async function handle({ method, path, search = '', headers = {}, body = null }) {
  const query = Object.fromEntries(new URLSearchParams(search));

  // Microsoft calls this when your Outlook calendar changes. It must answer within a few seconds,
  // so it only records that a sync is needed; the next portal request does the work.
  if (path === '/api/graph/notify') {
    if (query.validationToken) return { status: 200, headers: { 'Content-Type': 'text/plain' }, body: query.validationToken };
    let payload = null;
    try { payload = JSON.parse(body ? body.toString('utf8') : '{}'); } catch { /* ignore */ }
    const kind = graph.checkNotification(payload);
    if (kind) await getStore().setFlag(kind).catch(() => {});
    return { status: 202, headers: {}, body: '' };
  }

  const origin = originOf(headers);

  // Microsoft sign-in pages (no session needed yet).
  if (path === '/auth/login') {
    try { const r = auth.startLogin(origin, query.return, query.prompt); return { status: 302, headers: { Location: r.location, 'Set-Cookie': [r.setCookie], 'Cache-Control': 'no-store' }, body: '' }; }
    catch (e) { return htmlPage(e.status || 500, 'Sign-in isn’t ready', e.message); }
  }
  if (path === '/auth/signin-callback') {
    try { const r = await auth.finishLogin(origin, query, headers.cookie); return { status: 302, headers: { Location: r.location, 'Set-Cookie': r.setCookies, 'Cache-Control': 'no-store' }, body: '' }; }
    catch (e) { return htmlPage(e.status || 400, e.status === 403 ? 'No access' : 'Sign-in didn’t work', e.message, e.status === 403); }
  }
  if (path === '/auth/logout') return { status: 302, headers: { Location: '/signed-out.html', 'Set-Cookie': auth.logout(origin), 'Cache-Control': 'no-store' }, body: '' };

  const session = auth.currentUser(headers.cookie, origin);
  if (!session.user) return json(session.status, { error: session.error, signIn: session.status === 401, noAccess: !!session.noAccess });
  const user = session.user;
  const extra = session.renew ? { 'Set-Cookie': [session.renew] } : {};

  if (method !== 'GET' && headers['x-coastfields'] !== '1') return json(403, { error: 'Forbidden' });

  let parsed = {};
  if (body && body.length && (headers['content-type'] || '').includes('application/json')) {
    try { parsed = JSON.parse(body.toString('utf8')); } catch { return json(400, { error: 'Invalid JSON' }); }
  }

  return withLock(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await ensureLoaded(attempt > 0);
        const before = D.totalChanges();
        graph.setOrigin(origin);
        L.maybeScheduledRollover();
        let result;
        if (path === '/api/ping') {
          // Called every minute or so while the portal is open: picks up Outlook changes.
          const flag = await getStore().takeFlag().catch(() => null);
          let changed = false;
          if (graph.isConnected() && (flag || graph.needsSync())) {
            const r = await graph.syncNow({ budgetMs: 5e3, forceFresh: !!(flag && /missed|subscriptionRemoved/.test(flag)) });
            changed = interesting(r.calendar);
          }
          result = { changed, outlook: graph.status(), today: U.today() };
        } else {
          const m = api.match(method, path);
          if (!m) return json(404, { error: 'Not found' });
          result = await m.handler({ params: m.params, query, body: parsed, raw: body, headers, user });
        }
        await graph.flush({ budgetMs: 5e3 });
        if (cache.isNew || D.totalChanges() > before) await save();
        if (result && result.__raw) {
          const b = result.body;
          return { status: result.status, headers: { 'Cache-Control': 'no-store', ...extra, ...result.headers }, body: b };
        }
        return json(200, result === undefined ? { ok: true } : result, extra);
      } catch (e) {
        if (e instanceof ConflictError && attempt < 2) continue;
        if (e instanceof ConflictError) return json(409, { error: 'Another change was being saved at the same moment. Please try again.' });
        // A failed request must not leave half-made changes in the cached copy.
        cache.etag = undefined;
        const status = e.status || 500;
        if (status === 500) console.error(e);
        return json(status, { error: e.message || 'Something went wrong' });
      }
    }
    return json(500, { error: 'Something went wrong' });
  });
}

function htmlPage(status, title, message, offerSwitch = false) {
  const e = t => String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const body = `<!doctype html><html lang="en-GB"><meta charset="utf-8"><title>${e(title)} – Coastfields Customer Portal</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="icon" type="image/png" href="/img/favicon.png"><link rel="stylesheet" href="/css/page.css">
  <body class="plain"><div class="box"><img src="/img/logo.png" alt="Coastfields" class="logo"><h2>${e(title)}</h2><p>${e(message)}</p>
  <p><a class="btn" href="/auth/login${offerSwitch ? '?prompt=select_account' : ''}">${offerSwitch ? 'Sign in with a different account' : 'Try again'}</a></p></div></body></html>`;
  return { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, body };
}

// Run by the scheduled function every few minutes: nightly rollover, Outlook check, subscription renewal.
async function runScheduled() {
  return withLock(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await ensureLoaded(attempt > 0);
        const before = D.totalChanges();
        graph.setOrigin(process.env.URL || '');
        L.maybeScheduledRollover();
        let synced = null;
        if (graph.isConnected()) {
          const flag = await getStore().takeFlag().catch(() => null);
          if (flag || graph.needsSync(9 * 60e3)) synced = await graph.syncNow({ budgetMs: 18e3, forceFresh: !!(flag && /missed|subscriptionRemoved/.test(flag)) });
        }
        await graph.flush({ budgetMs: 5e3 });
        if (cache.isNew || D.totalChanges() > before) await save();
        return { ok: true, synced };
      } catch (e) {
        if (e instanceof ConflictError && attempt < 2) continue;
        cache.etag = undefined;
        console.error('Scheduled run failed:', e);
        return { ok: false, error: e.message };
      }
    }
    return { ok: false };
  });
}

module.exports = { handle, runScheduled };
