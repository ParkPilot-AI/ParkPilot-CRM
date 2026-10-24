'use strict';
// Exercises the Outlook sync against a local mock of Microsoft Graph (no real account needed).
// Run with:  node --test test/graph.test.js
const os = require('node:os'), path = require('node:path'), fs = require('node:fs'), http = require('node:http');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coastfields-graph-'));
process.env.COASTFIELDS_DATA = dir;

const test = require('node:test');
const assert = require('node:assert');

/* --------------------------------------------------------- mock Graph */
const mock = { events: new Map(), todo: new Map(), lists: [], seq: 0, calls: [], deltaRound: 0 };
function evt(e) { return { ...e, changeKey: 'ck' + (++mock.seq) }; }
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const json = body ? (req.headers['content-type'] || '').includes('json') ? JSON.parse(body) : Object.fromEntries(new URLSearchParams(body)) : {};
    mock.calls.push(`${req.method} ${p}`);
    const out = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    if (p.endsWith('/oauth2/v2.0/token')) { mock.lastTokenBody = json; return out(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }); }
    if (p === '/v1.0/subscriptions' && req.method === 'POST') { mock.subscription = json; return out(201, { id: 'sub1', expirationDateTime: json.expirationDateTime }); }
    if (p === '/v1.0/me') return out(200, { displayName: 'Sales Office', mail: 'sales@coastfields.test' });
    if (p === '/v1.0/me/events' && req.method === 'POST') {
      const id = 'evt' + (++mock.seq);
      const e = evt({ ...json, id, iCalUId: 'uid-' + id, onlineMeeting: json.isOnlineMeeting ? { joinUrl: 'https://teams.test/' + id } : null });
      mock.events.set(id, e); return out(201, e);
    }
    let m = /^\/v1\.0\/me\/events\/([^/]+)(\/cancel)?$/.exec(p);
    if (m) {
      const e = mock.events.get(m[1]);
      if (!e) return out(404, { error: { code: 'ErrorItemNotFound', message: 'Not found' } });
      if (m[2]) { mock.events.delete(m[1]); mock.cancelled = json.comment; return out(202); }
      if (req.method === 'DELETE') { mock.events.delete(m[1]); return out(204); }
      if (req.method === 'PATCH') { const n = evt({ ...e, ...json }); mock.events.set(e.id, n); return out(200, n); }
    }
    if (p === '/v1.0/me/calendarView/delta') {
      // Full list on every call (enough for the tests) plus removals queued by the test.
      const value = [...mock.events.values()].map(e => ({ ...e, start: { dateTime: e.start.dateTime + '.0000000', timeZone: 'Europe/London' }, end: { dateTime: e.end.dateTime + '.0000000', timeZone: 'Europe/London' } }));
      for (const id of mock.removed || []) value.push({ id, '@removed': { reason: 'deleted' } });
      mock.removed = [];
      return out(200, { value, '@odata.deltaLink': 'http://127.0.0.1:' + server.address().port + '/v1.0/me/calendarView/delta?token=' + (++mock.deltaRound) });
    }
    if (p === '/v1.0/me/todo/lists' && req.method === 'GET') return out(200, { value: mock.lists });
    if (p === '/v1.0/me/todo/lists' && req.method === 'POST') { const l = { id: 'list1', displayName: json.displayName }; mock.lists.push(l); return out(201, l); }
    m = /^\/v1\.0\/me\/todo\/lists\/list1\/tasks(?:\/(delta|[^/]+))?$/.exec(p);
    if (m) {
      if (m[1] === 'delta') return out(200, { value: [...mock.todo.values()], '@odata.deltaLink': 'http://127.0.0.1:' + server.address().port + '/v1.0/me/todo/lists/list1/tasks/delta?t=1' });
      if (!m[1] && req.method === 'POST') { const id = 'todo' + (++mock.seq); const t = { ...json, id }; mock.todo.set(id, t); return out(201, t); }
      const t = mock.todo.get(m[1]);
      if (!t) return out(404, { error: { message: 'Not found' } });
      if (req.method === 'PATCH') { Object.assign(t, json); return out(200, t); }
      if (req.method === 'DELETE') { mock.todo.delete(m[1]); return out(204); }
    }
    out(404, { error: { message: 'Unhandled ' + req.method + ' ' + p } });
  });
});

let graph, L, D, U, uid, other;
test.before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  process.env.GRAPH_BASE = `http://127.0.0.1:${port}/v1.0`;
  process.env.LOGIN_BASE = `http://127.0.0.1:${port}`;
  process.env.GRAPH_CLIENT_ID = '00000000-1111-2222-3333-444444444444';
  process.env.GRAPH_CLIENT_SECRET = 'test-secret';
  D = require('../server/db'); L = require('../server/logic'); graph = require('../server/graph'); U = require('../server/util');
  await D.open();
  // Two people on the team; the tests act as the first (whose Outlook gets connected).
  uid = D.insert('users', { email: 'sales@coastfields.test', name: 'Sales Office', role: 'manager', park_id: 1 });
  other = D.insert('users', { email: 'sam@coastfields.test', name: 'Sam', role: 'exec', park_id: 1 });
  require('../server/access').ctx.user = D.get('users', uid);
  graph.setOrigin('https://coastfields.example.net');
});

const settle = () => graph.flush();

test('sign-in with PKCE stores tokens and the account', async () => {
  const authUrl = new URL(graph.startAuth());
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authUrl.searchParams.get('redirect_uri'), 'https://coastfields.example.net/api/auth/callback');
  await graph.finishAuth({ code: 'abc', state: authUrl.searchParams.get('state') });
  assert.equal(mock.lastTokenBody.client_secret, 'test-secret');
  assert.ok(graph.isConnected());
  assert.equal(graph.status().account.email, 'sales@coastfields.test');
  // The refresh token is stored encrypted, never in plain text.
  assert.ok(!JSON.stringify(D.getState(`msTokens:${uid}`)).includes('RT'));
  assert.equal(graph.isConnected(other), false, 'connecting is per person');
  // Live updates: a subscription pointing at the portal's notify address.
  assert.equal(mock.subscription.notificationUrl, 'https://coastfields.example.net/api/graph/notify');
  assert.equal(mock.subscription.resource, '/me/events');
  assert.deepEqual(graph.checkNotification({ value: [{ clientState: mock.subscription.clientState, changeType: 'updated' }] }), [{ uid, kind: 'changed' }]);
  assert.equal(graph.checkNotification({ value: [{ clientState: 'forged', changeType: 'updated' }] }), null);
  // Someone else's id with this person's signature is refused too.
  assert.equal(graph.checkNotification({ value: [{ clientState: mock.subscription.clientState.replace(/^\d+/, String(other)), changeType: 'updated' }] }), null);
});

let contactId, apptId;
test('booking pushes an Outlook event with invite, Teams link and CRM id', async () => {
  contactId = D.insert('contacts', { first_name: 'Ann', last_name: 'Shore', email: 'ann@example.com', park_id: 1, owner_id: uid });
  apptId = L.createAppointment({ type: 'Teams call', start: `${U.addDays(U.today(), 3)}T15:30`, contact_id: contactId });
  await settle();
  const a = D.get('appointments', apptId);
  assert.equal(a.sync_status, 'Synced');
  const e = mock.events.get(a.outlook_event_id);
  assert.equal(e.attendees[0].emailAddress.address, 'ann@example.com');
  assert.equal(e.start.timeZone, 'Europe/London');
  assert.equal(e.singleValueExtendedProperties[0].value, String(apptId));
  assert.ok(a.teams_url.startsWith('https://teams.test/'));
});

test('an appointment in the diary of someone not connected stays in the portal only', async () => {
  const before = mock.events.size;
  const id = L.createAppointment({ type: 'Park tour', start: `${U.addDays(U.today(), 3)}T10:00`, contact_id: contactId, owner_id: other });
  await settle();
  assert.equal(D.get('appointments', id).sync_status, 'Local');
  assert.equal(mock.events.size, before);
  // Its prep and follow-up tasks are Sam's, not on the connected person's To Do.
  assert.ok(D.db.prepare("SELECT COUNT(*) n FROM tasks WHERE appointment_id = ? AND owner_id = ?").get(id, other).n >= 1);
  L.cancelAppointment(id, {});
});

test('delta pull ignores our own echo, then applies a move made in Outlook', async () => {
  let r = await graph.syncNow();
  assert.equal(r.calendar.echo, 1);
  const a = D.get('appointments', apptId);
  const e = mock.events.get(a.outlook_event_id);
  const newStart = `${U.addDays(U.today(), 4)}T11:00`;
  mock.events.set(e.id, { ...e, start: { dateTime: newStart + ':00', timeZone: 'Europe/London' }, end: { dateTime: `${U.addDays(U.today(), 4)}T11:30:00`, timeZone: 'Europe/London' }, changeKey: 'moved1' });
  r = await graph.syncNow();
  assert.equal(r.calendar.moved, 1);
  assert.equal(D.get('appointments', apptId).start, newStart);
  assert.ok(D.db.prepare("SELECT 1 FROM interactions WHERE appointment_id = ? AND summary LIKE '%moved in Outlook%'").get(apptId));
});

test('an Outlook event with a known customer is linked automatically; personal events are only cached', async () => {
  const id1 = 'ext1', id2 = 'ext2';
  const when = U.addDays(U.today(), 5);
  mock.events.set(id1, { id: id1, changeKey: 'x1', subject: 'Part-ex valuation', start: { dateTime: `${when}T10:00:00` }, end: { dateTime: `${when}T10:45:00` }, attendees: [{ emailAddress: { address: 'Ann@Example.com' } }], categories: [] });
  mock.events.set(id2, { id: id2, changeKey: 'x2', subject: 'Dentist', start: { dateTime: `${when}T16:00:00` }, end: { dateTime: `${when}T17:00:00` }, attendees: [], categories: [] });
  await graph.syncNow();
  const linked = D.db.prepare('SELECT * FROM appointments WHERE outlook_event_id = ?').get(id1);
  assert.equal(linked.type, 'Part-ex valuation');
  assert.equal(linked.contact_id, contactId);
  assert.equal(linked.needs_review, 1);
  assert.equal(D.db.prepare('SELECT COUNT(*) n FROM appointments WHERE outlook_event_id = ?').get(id2).n, 0);
  assert.ok(D.db.prepare('SELECT 1 FROM outlook_events WHERE id = ?').get(id2));
  // The cached personal event blocks slot suggestions.
  const { all } = L.suggestSlots({ type: 'Park tour', from: when, days: 0 });
  assert.ok(!all.some(s => s.start < `${when}T17:15` && s.end > `${when}T15:45`));
});

test('deleting in Outlook cancels the CRM appointment and creates a rebook task', async () => {
  const linked = D.db.prepare("SELECT * FROM appointments WHERE outlook_event_id = 'ext1'").get();
  mock.events.delete('ext1'); mock.removed = ['ext1'];
  await graph.syncNow();
  assert.equal(D.get('appointments', linked.id).status, 'Cancelled');
  assert.ok(D.db.prepare("SELECT 1 FROM tasks WHERE auto_key = ? AND status = 'Open'").get(`appt:${linked.id}:rebook`));
});

test('cancelling in the CRM sends an Outlook cancellation with the message', async () => {
  const a = D.get('appointments', apptId);
  L.cancelAppointment(apptId, { message: 'Sorry, we need to rearrange' });
  await settle();
  assert.equal(mock.cancelled, 'Sorry, we need to rearrange');
  assert.ok(!mock.events.has(a.outlook_event_id));
});

test('tasks mirror to a Coastfields CRM list in To Do; ticking one off there completes it here', async () => {
  await graph.syncNow();
  assert.equal(mock.lists[0].displayName, 'Coastfields CRM');
  const t = D.db.prepare("SELECT * FROM tasks WHERE status = 'Open' AND todo_id IS NOT NULL LIMIT 1").get();
  assert.ok(t, 'an open task was mirrored');
  mock.todo.get(t.todo_id).status = 'completed';
  await graph.syncNow();
  assert.equal(D.get('tasks', t.id).status, 'Done');
});

test('disconnect clears tokens and sync state', async () => {
  await graph.disconnect();
  assert.equal(graph.isConnected(), false);
});

test.after(() => { server.close(); D.db.close(); fs.rmSync(dir, { recursive: true, force: true }); setTimeout(() => process.exit(0), 50); });
