'use strict';
// Roles and teams: what sales executives, sales managers and admins can see and do.
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parkpilot-roles-'));
process.env.PARKPILOT_DATA = dir;
process.env.OWNER_EMAILS = 'boss@parkpilot.test';
process.env.GOOGLE_CLIENT_ID = '1234-test.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'secret-for-tests';
process.env.SESSION_SECRET = 'session-secret-for-tests';

const test = require('node:test');
const assert = require('node:assert');
const { handle } = require('../server/handler');
const auth = require('../server/auth');
const U = require('../server/util');

const H = { host: 'portal.test', 'x-forwarded-proto': 'https' };
const cookieFor = email => `pp_session=${encodeURIComponent(auth.seal({ email, name: email.split('@')[0], iat: Date.now(), exp: Date.now() + 864e5 }))}`;
function as(email) {
  const cookie = cookieFor(email);
  const call = async (method, p, body) => {
    const [pathname, search = ''] = p.split('?');
    const headers = { ...H, cookie, 'x-parkpilot': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) };
    const r = await handle({ method, path: pathname, search: search ? '?' + search : '', headers, body: body === undefined ? null : Buffer.from(JSON.stringify(body)) });
    let json = null; try { json = JSON.parse(r.body); } catch { /* not JSON */ }
    return { status: r.status, json };
  };
  return { get: p => call('GET', p), post: (p, b = {}) => call('POST', p, b), patch: (p, b) => call('PATCH', p, b), put: (p, b) => call('PUT', p, b) };
}
const boss = as('boss@parkpilot.test'), mia = as('mia@parkpilot.test'), max = as('max@parkpilot.test');
const ed = as('ed@parkpilot.test'), eve = as('eve@parkpilot.test'), zed = as('zed@parkpilot.test');
const ids = {};

test('the owner signs in as admin and sets up teams and people', async () => {
  const me = await boss.get('/api/meta');
  assert.equal(me.status, 200);
  assert.equal(me.json.user.role, 'group');
  assert.equal(me.json.parks[0].name, 'ParkPilot');
  const p2 = await boss.post('/api/parks', { name: 'Seaview' });
  assert.equal(p2.status, 200);
  ids.p1 = me.json.parks[0].id; ids.p2 = p2.json.id;
  for (const [k, email, role, park] of [['mia', 'mia@parkpilot.test', 'manager', ids.p1], ['max', 'max@parkpilot.test', 'manager', ids.p2],
    ['ed', 'ed@parkpilot.test', 'exec', ids.p1], ['eve', 'eve@parkpilot.test', 'exec', ids.p1], ['zed', 'zed@parkpilot.test', 'exec', ids.p2]]) {
    const r = await boss.post('/api/users', { email, name: k, role, park_id: park });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    ids[k] = r.json.id;
  }
  // Leads arriving unallocated at each park.
  ids.c1 = (await boss.post('/api/contacts', { first_name: 'Una', last_name: 'Lloyd', park_id: ids.p1, owner_id: '' })).json.id;
  ids.c2 = (await boss.post('/api/contacts', { first_name: 'Sea', last_name: 'Lead', park_id: ids.p2, owner_id: '' })).json.id;
  assert.equal((await boss.get(`/api/contacts/${ids.c1}`)).json.contact.owner_id, null);
});

test('people not on the team can’t get in', async () => {
  const r = await as('stranger@parkpilot.test').get('/api/meta');
  assert.equal(r.status, 403);
  assert.ok(r.json.noAccess);
});

test('a sales manager sees their own park only, and allocates leads to their team', async () => {
  assert.equal((await mia.get(`/api/contacts/${ids.c1}`)).status, 200);
  assert.equal((await mia.get(`/api/contacts/${ids.c2}`)).status, 404);
  assert.equal((await max.get(`/api/contacts/${ids.c1}`)).status, 404);
  // Can't hand a lead to someone at another park.
  assert.equal((await mia.post('/api/contacts/assign', { ids: [ids.c1], owner_id: ids.zed })).status, 403);
  // Can't allocate a lead they can't see.
  assert.equal((await mia.post('/api/contacts/assign', { ids: [ids.c2], owner_id: ids.ed })).status, 404);
  const r = await mia.post('/api/contacts/assign', { ids: [ids.c1], owner_id: ids.ed });
  assert.equal(r.status, 200);
  assert.equal(r.json.moved, 1);
  const tl = (await mia.get(`/api/contacts/${ids.c1}`)).json;
  assert.equal(tl.contact.owner_id, ids.ed);
  assert.ok(tl.timeline.some(i => /Allocated to ed/.test(i.summary)));
});

test('a sales executive sees only their own leads', async () => {
  const mine = (await ed.get('/api/contacts')).json;
  assert.deepEqual(mine.rows.map(r => r.id), [ids.c1]);
  assert.equal((await eve.get('/api/contacts')).json.total, 0);
  assert.equal((await eve.get(`/api/contacts/${ids.c1}`)).status, 404);
  assert.equal((await eve.post(`/api/contacts/${ids.c1}/notes`, { summary: 'sneaky' })).status, 404);
  assert.equal((await eve.get('/api/search?q=una')).json.contacts.length, 0);
  assert.equal((await ed.get('/api/search?q=una')).json.contacts.length, 1);
  // New leads they add are theirs, at their park, whatever they ask for.
  const c = (await eve.post('/api/contacts', { first_name: 'Eve', last_name: 'Own', owner_id: ids.ed, park_id: ids.p2 })).json;
  assert.equal(c.owner_id, ids.eve); assert.equal(c.park_id, ids.p1);
  ids.c3 = c.id;
});

test('executives can’t reach the deeper settings, the team or the Overview', async () => {
  assert.equal((await ed.put('/api/settings', { bufferMinutes: 0 })).status, 403);
  assert.equal((await ed.get('/api/team')).status, 403);
  assert.equal((await ed.get('/api/captains-log')).status, 403);
  assert.equal((await ed.post('/api/contacts/assign', { ids: [ids.c1], owner_id: ids.eve })).status, 403);
  assert.equal((await ed.get('/api/duplicates')).status, 403);
  assert.equal((await ed.get('/api/export/contacts.csv')).status, 403);
  assert.equal((await mia.get('/api/backup')).status, 403);
  // …but can see and connect their own Google account.
  const s = await ed.get('/api/settings');
  assert.equal(s.status, 200);
  assert.equal(s.json.google.connected, false);
  assert.equal((await mia.put('/api/settings', { bufferMinutes: 10 })).status, 200);
});

test('work goes in the right diary; managers can see their team’s, others can’t', async () => {
  const day = U.addDays(U.today(), 2);
  const a = await ed.post('/api/appointments', { type: 'Demo', start: `${day}T10:00`, contact_id: ids.c1 });
  assert.equal(a.status, 200);
  assert.equal(a.json.owner_id, ids.ed);
  assert.equal((await ed.get(`/api/appointments?from=${day}&to=${day}`)).json.appts.length, 1);
  assert.equal((await mia.get(`/api/appointments?from=${day}&to=${day}&user=${ids.ed}`)).json.appts.length, 1);
  assert.equal((await eve.get(`/api/appointments?from=${day}&to=${day}&user=${ids.ed}`)).status, 403);
  assert.equal((await max.get(`/api/appointments?from=${day}&to=${day}&user=${ids.ed}`)).status, 403);
  assert.equal((await eve.get(`/api/appointments/${a.json.id}`)).status, 404);
  // An exec can't give work to someone else.
  assert.equal((await ed.post('/api/tasks', { title: 'x', owner_id: ids.eve })).status, 403);
  // A manager can book into an exec's diary.
  const b = await mia.post('/api/appointments', { type: 'Discovery call', start: `${day}T14:00`, contact_id: ids.c1, owner_id: ids.ed });
  assert.equal(b.json.owner_id, ids.ed);
  // The booked demo moved the deal on and created prep/follow-up tasks for Ed.
  const tasks = (await ed.get('/api/tasks')).json;
  assert.ok(tasks.some(t => /Prepare for demo/.test(t.title)));
  assert.equal((await ed.get(`/api/contacts/${ids.c1}`)).json.deals[0].stage, 'Demo booked');
  ids.appt = a.json.id;
});

test('a sales manager can add executives at their park, not managers or people elsewhere', async () => {
  assert.equal((await mia.post('/api/users', { email: 'boss2@parkpilot.test', role: 'manager' })).status, 403);
  const r = await mia.post('/api/users', { email: 'new@parkpilot.test', name: 'New', role: 'exec', park_id: ids.p2 });
  assert.equal(r.status, 200);
  assert.equal(r.json.park_id, ids.p1, 'always their own park');
  assert.equal((await mia.patch(`/api/users/${ids.zed}`, { name: 'Z' })).status, 403);
  assert.equal((await mia.patch(`/api/users/${ids.max}`, { name: 'M' })).status, 403);
  const team = (await mia.get('/api/team')).json;
  assert.ok(team.people.every(p => p.park_id === ids.p1));
  assert.deepEqual(team.parks.map(p => p.id), [ids.p1]);
  assert.equal((await mia.post('/api/parks', { name: 'Mine' })).status, 403);
});

test('the Overview: managers see their team, admins compare teams', async () => {
  const log = (await mia.get('/api/captains-log?period=30')).json;
  assert.equal(log.park.id, ids.p1);
  const edRow = log.team.find(p => p.id === ids.ed);
  assert.equal(edRow.leads, 1);
  assert.equal(edRow.appts, 2);
  assert.ok(log.headline.enquiries >= 2);
  assert.equal(log.todayAppts.length, 0);
  assert.equal((await mia.get(`/api/captains-log?park=${ids.p2}`)).json.park.id, ids.p1, 'a manager can’t switch park');
  const all = (await boss.get('/api/captains-log?period=30')).json;
  assert.deepEqual(all.parks.map(p => p.name).sort(), ['ParkPilot', 'Seaview']);
  assert.equal(all.parks.find(p => p.id === ids.p2).unallocated, 1);
  const sea = (await boss.get(`/api/captains-log?period=30&park=${ids.p2}`)).json;
  assert.equal(sea.unallocated.length, 1);
  assert.equal(sea.parks, null);
});

test('removing someone hands their leads and open tasks to a colleague', async () => {
  const r = await mia.post(`/api/users/${ids.ed}/remove`, { transfer_to: ids.eve });
  assert.equal(r.status, 200);
  assert.equal(r.json.moved, 1);
  assert.equal((await eve.get(`/api/contacts/${ids.c1}`)).status, 200);
  const evesTasks = (await eve.get('/api/tasks')).json;
  assert.ok(evesTasks.some(t => t.contact_id === ids.c1));
  assert.equal((await ed.get('/api/meta')).status, 403);
  // The appointment Ed booked stays in his (now closed) diary, still visible to his manager.
  assert.equal((await mia.get(`/api/appointments/${ids.appt}`)).status, 200);
});

test('only admins can download a backup or add teams', async () => {
  assert.equal((await boss.get('/api/backup')).status, 200);
  assert.equal((await mia.get('/api/backup')).status, 403);
  assert.equal((await mia.post('/api/parks', { name: 'Another' })).status, 403);
});

test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
