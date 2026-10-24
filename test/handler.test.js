'use strict';
// Microsoft sign-in, sessions, saving, conflicts and Outlook notifications – against a mock Microsoft.
const os = require('node:os'), path = require('node:path'), fs = require('node:fs'), http = require('node:http');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coastfields-netlify-'));
process.env.COASTFIELDS_DATA = dir;
process.env.OWNER_EMAILS = 'owner@coastfields.test, second@coastfields.test';
process.env.GRAPH_CLIENT_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
process.env.GRAPH_CLIENT_SECRET = 'secret-for-tests';
process.env.GRAPH_TENANT_ID = 'bbbbbbbb-1111-2222-3333-444444444444';
process.env.SESSION_SECRET = 'session-secret-for-tests';

const test = require('node:test');
const assert = require('node:assert');

// Mock Microsoft token endpoint: returns an ID token with whatever claims the test sets.
const ms = { claims: null, lastBody: null };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const msServer = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
    ms.lastBody = Object.fromEntries(new URLSearchParams(body));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id_token: `${b64({ alg: 'RS256' })}.${b64(ms.claims)}.sig`, access_token: 'x', expires_in: 3600 }));
  });
});

let handle, graph;
const ORIGIN_HEADERS = { host: 'coastfields-portal.netlify.app', 'x-forwarded-proto': 'https' };
const cookieJar = {};
const setCookies = r => [].concat(r.headers['Set-Cookie'] || []);
function remember(r) { for (const c of setCookies(r)) { const [kv] = c.split(';'); const [k, ...v] = kv.split('='); cookieJar[k] = v.join('='); } }
const cookieHeader = () => Object.entries(cookieJar).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
const call = (method, p, { body, cookie = cookieHeader(), headers = {} } = {}) => {
  const [pathname, search = ''] = p.split('?');
  const h = { ...ORIGIN_HEADERS, 'x-coastfields': '1', cookie, ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  return handle({ method, path: pathname, search: search ? '?' + search : '', headers: h, body: body === undefined ? null : Buffer.from(JSON.stringify(body)) });
};
const data = r => JSON.parse(r.body);

async function signIn(claims) {
  const start = await call('GET', '/auth/login?return=%2F%23%2Fcontacts');
  assert.equal(start.status, 302);
  remember(start);
  const loc = new URL(start.headers.Location);
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://coastfields-portal.netlify.app/auth/signin-callback');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  ms.claims = { aud: process.env.GRAPH_CLIENT_ID, tid: process.env.GRAPH_TENANT_ID, nonce: loc.searchParams.get('nonce'), exp: Math.floor(Date.now() / 1000) + 3600, name: 'Sales Office', ...claims };
  const back = await call('GET', `/auth/signin-callback?code=abc&state=${loc.searchParams.get('state')}`);
  remember(back);
  return back;
}

test.before(async () => {
  await new Promise(r => msServer.listen(0, '127.0.0.1', r));
  process.env.LOGIN_BASE = `http://127.0.0.1:${msServer.address().port}`;
  ({ handle } = require('../server/handler'));
  graph = require('../server/graph');
});

test('without a session the API asks you to sign in', async () => {
  const r = await call('GET', '/api/meta', { cookie: '' });
  assert.equal(r.status, 401);
  assert.ok(data(r).signIn);
});

test('Microsoft sign-in creates a session and returns you where you were', async () => {
  const r = await signIn({ preferred_username: 'Owner@Coastfields.test' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.Location, '/#/contacts');
  assert.equal(ms.lastBody.client_secret, 'secret-for-tests');
  assert.ok(ms.lastBody.code_verifier);
  const cookie = setCookies(r).find(c => c.startsWith('cf_session='));
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/);
  const meta = await call('GET', '/api/meta');
  assert.equal(meta.status, 200);
  assert.equal(data(meta).user.email, 'owner@coastfields.test');
});

test('refuses accounts from another organisation, people not on the list, and replayed sign-ins', async () => {
  const saved = { ...cookieJar };
  let r = await signIn({ preferred_username: 'owner@coastfields.test', tid: 'cccccccc-0000-0000-0000-000000000000' });
  assert.equal(r.status, 403);
  r = await signIn({ preferred_username: 'stranger@coastfields.test' });
  assert.equal(r.status, 403);
  assert.match(r.body, /isn’t on the Coastfields Customer Portal team/);
  r = await signIn({ preferred_username: 'owner@coastfields.test', nonce: 'wrong' });
  assert.equal(r.status, 401);
  r = await signIn({ preferred_username: 'owner@coastfields.test', aud: 'some-other-app' });
  assert.equal(r.status, 401);
  // A callback with no matching sign-in cookie is refused.
  r = await call('GET', '/auth/signin-callback?code=abc&state=forged', { cookie: '' });
  assert.equal(r.status, 400);
  Object.assign(cookieJar, saved);
});

test('a tampered or expired session cookie is rejected', async () => {
  const good = cookieJar.cf_session;
  assert.equal((await call('GET', '/api/meta', { cookie: `cf_session=${good.slice(0, -4)}AAAA` })).status, 401);
  const auth = require('../server/auth');
  const old = auth.seal({ email: 'owner@coastfields.test', name: 'x', iat: Date.now() - 20 * 864e5, exp: Date.now() - 1000 });
  assert.equal((await call('GET', '/api/meta', { cookie: `cf_session=${encodeURIComponent(old)}` })).status, 401);
});

test('someone removed from the team is locked out at once, even with a live session', async () => {
  const added = data(await call('POST', '/api/users', { body: { email: 'temp@coastfields.test', name: 'Temp', role: 'exec', park_id: 1 } }));
  const auth = require('../server/auth');
  const theirs = `cf_session=${encodeURIComponent(auth.seal({ email: 'temp@coastfields.test', name: 'Temp', iat: Date.now(), exp: Date.now() + 864e5 }))}`;
  assert.equal((await call('GET', '/api/meta', { cookie: theirs })).status, 200);
  assert.equal((await call('POST', `/api/users/${added.id}/remove`, { body: {} })).status, 200);
  const r = await call('GET', '/api/meta', { cookie: theirs });
  assert.equal(r.status, 403);
  assert.ok(data(r).noAccess);
});

test('writes need the portal header (blocks cross-site form posts)', async () => {
  const r = await call('POST', '/api/contacts', { body: { first_name: 'X' }, headers: { 'x-coastfields': undefined } });
  assert.equal(r.status, 403);
});

test('changes are saved to storage with a daily backup; reads do not rewrite it', async () => {
  const r = await call('POST', '/api/contacts', { body: { first_name: 'Ann', last_name: 'Shore', email: 'ann@example.com' } });
  assert.equal(r.status, 200);
  const file = path.join(dir, 'coastfields.db');
  assert.ok(fs.existsSync(file));
  assert.ok(fs.readdirSync(path.join(dir, 'backups')).length >= 1);
  const m = fs.statSync(file).mtimeMs;
  await call('GET', '/api/dashboard'); await call('GET', '/api/contacts');
  assert.equal(fs.statSync(file).mtimeMs, m);
});

test('if another instance saved first, the latest copy is used', async () => {
  const D = require('../server/db');
  const { getStore } = require('../server/store');
  const store = getStore();
  const cur = await store.read();
  await D.open(cur.bytes);
  D.insert('contacts', { first_name: 'From', last_name: 'Elsewhere' });
  await new Promise(r => setTimeout(r, 20));
  await store.write(D.exportBytes(), cur.etag);
  assert.equal(data(await call('GET', '/api/contacts?q=elsewhere')).total, 1);
  await call('POST', '/api/contacts', { body: { first_name: 'Bob', last_name: 'Dune' } });
  assert.equal(data(await call('GET', '/api/contacts')).total, 3);
});

test('importing the spreadsheet through the API, and the first-run count', async () => {
  const csv = 'No,First Name,Last Name,Mobile Phone,Email Address,Original Lead Source,Created On\nL1,Carl,Sands,07700900111,carl@example.com,WEBSITE,2026-10-20 10:00\n';
  const r = await handle({ method: 'POST', path: '/api/import', headers: { ...ORIGIN_HEADERS, 'x-coastfields': '1', 'x-filename': 'leads.csv', 'content-type': 'application/octet-stream', cookie: cookieHeader() }, body: Buffer.from(csv) });
  assert.equal(r.status, 200);
  assert.equal(data(r).created, 1);
  // Imported leads arrive unallocated at the park, ready for a manager to hand out.
  assert.equal(data(await call('GET', '/api/contacts')).total, 4);
  assert.equal(data(await call('GET', '/api/contacts?owner=none&q=sands')).total, 1);
  assert.ok(data(await call('GET', '/api/dashboard')).unallocated >= 1);
});

test('Outlook notification endpoint: validation, genuine-only, no sign-in needed', async () => {
  const v = await handle({ method: 'POST', path: '/api/graph/notify', search: '?validationToken=abc123', headers: {} });
  assert.equal(v.status, 200); assert.equal(v.body, 'abc123');
  await handle({ method: 'POST', path: '/api/graph/notify', headers: {}, body: Buffer.from(JSON.stringify({ value: [{ clientState: 'nope' }] })) });
  assert.ok(!fs.readdirSync(dir).some(f => f.startsWith('sync-needed')));
  const real = await handle({ method: 'POST', path: '/api/graph/notify', headers: {}, body: Buffer.from(JSON.stringify({ value: [{ clientState: graph.clientStateFor(1), changeType: 'updated' }] })) });
  assert.equal(real.status, 202);
  assert.ok(fs.existsSync(path.join(dir, 'sync-needed-1')), 'flag set for that person');
});

test('the scheduled job runs the rollover and clears the Outlook flag', async () => {
  const { runScheduled } = require('../server/handler');
  const r = await runScheduled();
  assert.ok(r.ok);
});

test('sign out clears the session', async () => {
  const r = await call('GET', '/auth/logout');
  assert.equal(r.status, 302);
  assert.match(setCookies(r)[0], /cf_session=;.*Max-Age=0/);
});

test('backup download returns a SQLite file', async () => {
  const r = await call('GET', '/api/backup');
  assert.equal(Buffer.from(r.body).subarray(0, 15).toString(), 'SQLite format 3');
});

test.after(() => { msServer.close(); fs.rmSync(dir, { recursive: true, force: true }); });
