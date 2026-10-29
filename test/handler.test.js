'use strict';
// Google sign-in, sessions, saving and conflicts – against a mock Google token endpoint.
const os = require('node:os'), path = require('node:path'), fs = require('node:fs'), http = require('node:http');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parkpilot-netlify-'));
process.env.PARKPILOT_DATA = dir;
process.env.OWNER_EMAILS = 'owner@parkpilot.test, second@parkpilot.test';
process.env.GOOGLE_CLIENT_ID = '1234-test.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'secret-for-tests';
process.env.GOOGLE_WORKSPACE_DOMAIN = 'parkpilot.test';
process.env.SESSION_SECRET = 'session-secret-for-tests';

const test = require('node:test');
const assert = require('node:assert');

// Mock Google token endpoint: returns an ID token with whatever claims the test sets.
const g = { claims: null, lastBody: null };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const gServer = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
    g.lastBody = Object.fromEntries(new URLSearchParams(body));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id_token: `${b64({ alg: 'RS256' })}.${b64(g.claims)}.sig`, access_token: 'x', expires_in: 3600 }));
  });
});

let handle;
const ORIGIN_HEADERS = { host: 'parkpilot-crm.netlify.app', 'x-forwarded-proto': 'https' };
const cookieJar = {};
const setCookies = r => [].concat(r.headers['Set-Cookie'] || []);
function remember(r) { for (const c of setCookies(r)) { const [kv] = c.split(';'); const [k, ...v] = kv.split('='); cookieJar[k] = v.join('='); } }
const cookieHeader = () => Object.entries(cookieJar).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
const call = (method, p, { body, cookie = cookieHeader(), headers = {} } = {}) => {
  const [pathname, search = ''] = p.split('?');
  const h = { ...ORIGIN_HEADERS, 'x-parkpilot': '1', cookie, ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  return handle({ method, path: pathname, search: search ? '?' + search : '', headers: h, body: body === undefined ? null : Buffer.from(JSON.stringify(body)) });
};
const data = r => JSON.parse(r.body);

async function signIn(claims) {
  const start = await call('GET', '/auth/login?return=%2F%23%2Fcontacts');
  assert.equal(start.status, 302);
  remember(start);
  const loc = new URL(start.headers.Location);
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://parkpilot-crm.netlify.app/auth/signin-callback');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(loc.searchParams.get('hd'), 'parkpilot.test');
  g.claims = { iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, hd: 'parkpilot.test', email_verified: true,
    nonce: loc.searchParams.get('nonce'), exp: Math.floor(Date.now() / 1000) + 3600, name: 'Ryan Metcalfe', ...claims };
  const back = await call('GET', `/auth/signin-callback?code=abc&state=${loc.searchParams.get('state')}`);
  remember(back);
  return back;
}

test.before(async () => {
  await new Promise(r => gServer.listen(0, '127.0.0.1', r));
  process.env.GOOGLE_TOKEN_URL = `http://127.0.0.1:${gServer.address().port}/token`;
  ({ handle } = require('../server/handler'));
});

test('without a session the API asks you to sign in', async () => {
  const r = await call('GET', '/api/meta', { cookie: '' });
  assert.equal(r.status, 401);
  assert.ok(data(r).signIn);
});

test('Google sign-in creates a session, makes the owner an admin and returns you where you were', async () => {
  const r = await signIn({ email: 'Owner@ParkPilot.test' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.Location, '/#/contacts');
  assert.equal(g.lastBody.client_secret, 'secret-for-tests');
  assert.ok(g.lastBody.code_verifier);
  const cookie = setCookies(r).find(c => c.startsWith('pp_session='));
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/);
  const meta = await call('GET', '/api/meta');
  assert.equal(meta.status, 200);
  assert.equal(data(meta).user.email, 'owner@parkpilot.test');
  assert.equal(data(meta).user.role, 'group');
  assert.equal(data(meta).user.roleLabel, 'Admin');
  assert.ok(data(meta).user.isGroup && data(meta).user.isManager);
});

test('refuses other domains, unverified emails, people not on the list, and forged or replayed sign-ins', async () => {
  const saved = { ...cookieJar };
  let r = await signIn({ email: 'owner@parkpilot.test', hd: 'gmail.com' });
  assert.equal(r.status, 403);
  r = await signIn({ email: 'owner@parkpilot.test', email_verified: false });
  assert.equal(r.status, 403);
  r = await signIn({ email: 'stranger@parkpilot.test' });
  assert.equal(r.status, 403);
  assert.match(r.body, /isn’t on the ParkPilot CRM team/);
  r = await signIn({ email: 'owner@parkpilot.test', nonce: 'wrong' });
  assert.equal(r.status, 401);
  r = await signIn({ email: 'owner@parkpilot.test', aud: 'some-other-app' });
  assert.equal(r.status, 401);
  r = await signIn({ email: 'owner@parkpilot.test', iss: 'https://evil.example' });
  assert.equal(r.status, 401);
  // A callback with no matching sign-in cookie is refused.
  r = await call('GET', '/auth/signin-callback?code=abc&state=forged', { cookie: '' });
  assert.equal(r.status, 400);
  Object.assign(cookieJar, saved);
});

test('a tampered or expired session cookie is rejected', async () => {
  const good = cookieJar.pp_session;
  assert.equal((await call('GET', '/api/meta', { cookie: `pp_session=${good.slice(0, -4)}AAAA` })).status, 401);
  const auth = require('../server/auth');
  const old = auth.seal({ email: 'owner@parkpilot.test', name: 'x', iat: Date.now() - 20 * 864e5, exp: Date.now() - 1000 });
  assert.equal((await call('GET', '/api/meta', { cookie: `pp_session=${encodeURIComponent(old)}` })).status, 401);
});

test('someone removed from the team is locked out at once, even with a live session', async () => {
  const added = data(await call('POST', '/api/users', { body: { email: 'temp@parkpilot.test', name: 'Temp', role: 'exec', park_id: 1 } }));
  const auth = require('../server/auth');
  const theirs = `pp_session=${encodeURIComponent(auth.seal({ email: 'temp@parkpilot.test', name: 'Temp', iat: Date.now(), exp: Date.now() + 864e5 }))}`;
  assert.equal((await call('GET', '/api/meta', { cookie: theirs })).status, 200);
  assert.equal((await call('POST', `/api/users/${added.id}/remove`, { body: {} })).status, 200);
  const r = await call('GET', '/api/meta', { cookie: theirs });
  assert.equal(r.status, 403);
  assert.ok(data(r).noAccess);
});

test('writes need the portal header (blocks cross-site form posts)', async () => {
  const r = await call('POST', '/api/contacts', { body: { first_name: 'X' }, headers: { 'x-parkpilot': undefined } });
  assert.equal(r.status, 403);
});

test('changes are saved to storage with a daily backup; reads do not rewrite it', async () => {
  const r = await call('POST', '/api/contacts', { body: { first_name: 'Ann', last_name: 'Shore', email: 'ann@example.com' } });
  assert.equal(r.status, 200);
  const file = path.join(dir, 'parkpilot-crm.db');
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

test('importing a lead list through the API: a solo admin owns what they import', async () => {
  const csv = 'Park Name,First Name,Last Name,Mobile,Email,Units,County,Lead Source,Created On\nSandy Bay Park,Carl,Sands,07700900111,carl@sandybay.example,120,Norfolk,Show,2026-10-20 10:00\n';
  const r = await handle({ method: 'POST', path: '/api/import', headers: { ...ORIGIN_HEADERS, 'x-parkpilot': '1', 'x-filename': 'leads.csv', 'content-type': 'application/octet-stream', cookie: cookieHeader() }, body: Buffer.from(csv) });
  assert.equal(r.status, 200);
  assert.equal(data(r).created, 1);
  assert.equal(data(await call('GET', '/api/contacts')).total, 4);
  const row = data(await call('GET', '/api/contacts?owner=me&q=sandy')).rows[0];
  assert.equal(row.company, 'Sandy Bay Park');
  assert.equal(row.units, 120);
  assert.equal(row.stage, 'Enquiry');
});

test('the scheduled job runs the rollover', async () => {
  const { runScheduled } = require('../server/handler');
  const r = await runScheduled();
  assert.ok(r.ok);
});

test('Google connection status is reported and the connect link asks for Gmail and Calendar', async () => {
  const st = data(await call('GET', '/api/google/status'));
  assert.equal(st.configured, true);
  assert.equal(st.connected, false);
  assert.equal(st.gmailLabel, 'CRM Leads');
  assert.equal(st.redirectUri, 'https://parkpilot-crm.netlify.app/api/google/callback');
  const r = await call('GET', '/api/google/start');
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.Location);
  assert.match(loc.searchParams.get('scope'), /gmail\.modify/);
  assert.match(loc.searchParams.get('scope'), /calendar\.events/);
  assert.equal(loc.searchParams.get('access_type'), 'offline');
  assert.equal(loc.searchParams.get('login_hint'), 'owner@parkpilot.test');
});

test('sign out clears the session', async () => {
  const r = await call('GET', '/auth/logout');
  assert.equal(r.status, 302);
  assert.match(setCookies(r)[0], /pp_session=;.*Max-Age=0/);
});

test('backup download returns a SQLite file', async () => {
  const r = await call('GET', '/api/backup');
  assert.equal(Buffer.from(r.body).subarray(0, 15).toString(), 'SQLite format 3');
});

test.after(() => { gServer.close(); fs.rmSync(dir, { recursive: true, force: true }); });
