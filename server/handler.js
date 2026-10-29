'use strict';
// Turns an HTTP request into a response. Used by the Netlify Function (netlify/functions/api.mjs),
// the scheduled function, and the local test server (dev/dev-server.js).
//
// Each request: checks the Google sign-in session, loads the database (reusing the in-memory copy
// when nothing changed), runs the route, sends any Google Calendar changes, then saves the database
// back to storage only if something changed. If another request saved in the meantime,
// it reloads and runs the request again.
const D = require('./db');
const { getStore, ConflictError } = require('./store');
const api = require('./api');
const L = require('./logic');
const U = require('./util');
const graph = require('./google');
const auth = require('./auth');
const A = require('./access');

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

function interesting(counts) { return !!counts && (counts.created > 0 || counts.updated > 0); }

async function handle({ method, path, search = '', headers = {}, body = null }) {
  const query = Object.fromEntries(new URLSearchParams(search));

  const origin = originOf(headers);

  // Google sign-in pages (no session needed yet).
  if (path === '/auth/login') {
    try { const r = auth.startLogin(origin, query.return, query.prompt); return { status: 302, headers: { Location: r.location, 'Set-Cookie': [r.setCookie], 'Cache-Control': 'no-store' }, body: '' }; }
    catch (e) { return htmlPage(e.status || 500, 'Sign-in isn’t ready', e.message); }
  }
  if (path === '/auth/signin-callback') {
    let r;
    try { r = await auth.finishLogin(origin, query, headers.cookie); }
    catch (e) { return htmlPage(e.status || 400, e.status === 403 ? 'No access' : 'Sign-in didn’t work', e.message, e.status === 403); }
    // Check they are on the team before letting them in.
    const ok = await inDb(() => !!A.resolveUser(r.email, r.name)).catch(e => { console.error(e); return null; });
    if (ok === null) return htmlPage(500, 'Sign-in didn’t work', 'The portal could not check your access just now. Please try again in a moment.');
    if (!ok) return htmlPage(403, 'No access', `${r.email} isn’t on the ParkPilot CRM team yet. Ask the CRM’s owner to add you, then try again.`, true);
    return { status: 302, headers: { Location: r.location, 'Set-Cookie': r.setCookies, 'Cache-Control': 'no-store' }, body: '' };
  }
  if (path === '/auth/logout') return { status: 302, headers: { Location: '/signed-out.html', 'Set-Cookie': auth.logout(origin), 'Cache-Control': 'no-store' }, body: '' };

  const session = auth.currentUser(headers.cookie, origin);
  if (!session.user) return json(session.status, { error: session.error, signIn: session.status === 401, noAccess: !!session.noAccess });
  const extra = session.renew ? { 'Set-Cookie': [session.renew] } : {};

  if (method !== 'GET' && headers['x-parkpilot'] !== '1') return json(403, { error: 'Forbidden' });

  let parsed = {};
  if (body && body.length && (headers['content-type'] || '').includes('application/json')) {
    try { parsed = JSON.parse(body.toString('utf8')); } catch { return json(400, { error: 'Invalid JSON' }); }
  }

  return withLock(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await ensureLoaded(attempt > 0);
        const before = D.totalChanges();
        A.ctx.user = null;
        const me = A.resolveUser(session.user.email, session.user.name);
        if (!me) {
          if (D.totalChanges() > before) await save();
          return json(403, { error: `${session.user.email} isn’t on the ParkPilot CRM team. Ask the CRM’s owner to add you.`, noAccess: true });
        }
        A.ctx.user = me;
        const user = me;
        graph.setOrigin(origin);
        L.maybeScheduledRollover();
        let result;
        if (path === '/api/ping') {
          // Called every couple of minutes while the CRM is open: picks up new leads from this person's Gmail.
          let changed = false;
          if (graph.isConnected(me.id)) {
            await graph.as(me.id, async () => {
              if (graph.needsSync(3 * 60e3)) changed = interesting((await graph.syncNow({ budgetMs: 6e3 })).gmail);
            });
          }
          result = { changed, google: graph.status(me.id), today: U.today() };
        } else {
          const m = api.match(method, path);
          if (!m) return json(404, { error: 'Not found' });
          result = await m.handler({ params: m.params, query, body: parsed, raw: body, headers, user });
        }
        await graph.flush({ budgetMs: 5e3 });
        if (cache.isNew || D.totalChanges() > before) await save();
        A.ctx.user = null;
        if (result && result.__raw) {
          const b = result.body;
          return { status: result.status, headers: { 'Cache-Control': 'no-store', ...extra, ...result.headers }, body: b };
        }
        return json(200, result === undefined ? { ok: true } : result, extra);
      } catch (e) {
        A.ctx.user = null;
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

// Runs fn with the database loaded, saving if it changed (used outside the normal request flow).
function inDb(fn) {
  return withLock(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await ensureLoaded(attempt > 0);
        const before = D.totalChanges();
        const r = await fn();
        if (cache.isNew || D.totalChanges() > before) await save();
        return r;
      } catch (e) {
        if (e instanceof ConflictError && attempt < 2) continue;
        cache.etag = undefined; throw e;
      }
    }
  });
}

function htmlPage(status, title, message, offerSwitch = false) {
  const e = t => String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const body = `<!doctype html><html lang="en-GB"><meta charset="utf-8"><title>${e(title)} – ParkPilot CRM</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="icon" type="image/png" href="/img/favicon.png"><link rel="stylesheet" href="/css/page.css">
  <body class="plain"><div class="box"><span class="wordmark"><img src="/img/mark.png" alt=""><span class="wm">ParkPilot</span><span class="crm">CRM</span></span><h2>${e(title)}</h2><p>${e(message)}</p>
  <p><a class="btn" href="/auth/login${offerSwitch ? '?prompt=select_account' : ''}">${offerSwitch ? 'Sign in with a different account' : 'Try again'}</a></p></div></body></html>`;
  return { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, body };
}

// Run by the scheduled function every few minutes: nightly rollover, new leads from Gmail, calendar updates.
async function runScheduled() {
  return withLock(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await ensureLoaded(attempt > 0);
        const before = D.totalChanges();
        graph.setOrigin(process.env.URL || '');
        L.maybeScheduledRollover();
        A.ctx.user = null;
        // Everyone's Gmail, a share of the time each (the ones not reached carry on next run).
        const synced = {};
        const users = graph.connectedUsers();
        const t0 = Date.now();
        for (const uid of users) {
          if (Date.now() - t0 > 18e3) break;
          await graph.as(uid, async () => {
            if (graph.needsSync(8 * 60e3)) synced[uid] = await graph.syncNow({ budgetMs: Math.max(3e3, 18e3 / users.length) });
          });
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
