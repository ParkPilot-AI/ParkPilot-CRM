'use strict';
// One person to start with: whoever signs in first (with no OWNER_EMAILS set) becomes the Admin,
// with full access to everything. Nobody else gets in until the Admin adds them.
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parkpilot-solo-'));
process.env.PARKPILOT_DATA = dir;
delete process.env.OWNER_EMAILS;
process.env.GOOGLE_CLIENT_ID = '1234-test.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'secret-for-tests';
process.env.SESSION_SECRET = 'session-secret-for-tests';

const test = require('node:test');
const assert = require('node:assert');
const { handle } = require('../server/handler');
const auth = require('../server/auth');

const H = { host: 'crm.test', 'x-forwarded-proto': 'https' };
function as(email) {
  const cookie = `pp_session=${encodeURIComponent(auth.seal({ email, name: 'Ryan Metcalfe', iat: Date.now(), exp: Date.now() + 864e5 }))}`;
  return async (method, p, body) => {
    const [pathname, search = ''] = p.split('?');
    const r = await handle({ method, path: pathname, search: search ? '?' + search : '', headers: { ...H, cookie, 'x-parkpilot': '1', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? Buffer.from(JSON.stringify(body)) : null });
    let json = null; try { json = JSON.parse(r.body); } catch { /* not JSON */ }
    return { status: r.status, json };
  };
}

test('the first person to sign in is the Admin, with full access', async () => {
  const ryan = as('info@parkpilot.test');
  const meta = await ryan('GET', '/api/meta');
  assert.equal(meta.status, 200);
  assert.equal(meta.json.user.roleLabel, 'Admin');
  assert.ok(meta.json.user.isGroup && meta.json.user.isManager);
  for (const [m, p, b] of [['GET', '/api/team'], ['GET', '/api/captains-log'], ['GET', '/api/jobs'], ['GET', '/api/duplicates'],
    ['PUT', '/api/settings', { bufferMinutes: 10, gmailLabel: 'Leads' }], ['POST', '/api/parks', { name: 'Second team' }], ['GET', '/api/export/contacts.csv']]) {
    assert.equal((await ryan(m, p, b)).status, 200, `${m} ${p}`);
  }
  assert.equal((await ryan('GET', '/api/settings')).json.settings.gmailLabel, 'Leads');
  // Nobody else gets in until they are added.
  assert.equal((await as('someone@else.test')('GET', '/api/meta')).status, 403);
});

test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
