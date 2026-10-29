'use strict';
// Gmail lead capture and Google Calendar – against a mock Google.
const os = require('node:os'), path = require('node:path'), fs = require('node:fs'), http = require('node:http');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parkpilot-google-'));
process.env.PARKPILOT_DATA = dir;
process.env.GOOGLE_CLIENT_ID = '1234-test.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'secret-for-tests';

const test = require('node:test');
const assert = require('node:assert');

/* ---------------------------------------------------------------- mock Google */

const b64 = s => Buffer.from(s, 'utf8').toString('base64url');
const mock = { labels: [{ id: 'INBOX', name: 'INBOX' }], messages: new Map(), events: new Map(), calls: [], scope: null, refreshToken: 'refresh-1' };
function addMessage(id, { from, replyTo, subject, text, html, at = Date.now(), labels = ['L_SOURCE'] }) {
  const headers = [{ name: 'From', value: from }, { name: 'Subject', value: subject }, { name: 'To', value: 'info@parkpilot.test' }];
  if (replyTo) headers.push({ name: 'Reply-To', value: replyTo });
  const parts = [];
  if (text) parts.push({ mimeType: 'text/plain', body: { data: b64(text) } });
  if (html) parts.push({ mimeType: 'text/html', body: { data: b64(html) } });
  mock.messages.set(id, { id, threadId: 't' + id, labelIds: labels, snippet: (text || '').slice(0, 60), internalDate: String(at), payload: { mimeType: 'multipart/alternative', headers, parts } });
}
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    const json = body && req.headers['content-type'] === 'application/json' ? JSON.parse(body) : null;
    mock.calls.push(`${req.method} ${u.pathname}${u.search}`);
    if (u.pathname === '/token') {
      const f = Object.fromEntries(new URLSearchParams(body));
      if (f.grant_type === 'refresh_token' && f.refresh_token !== mock.refreshToken) return send(400, { error: 'invalid_grant' });
      return send(200, { access_token: 'access-' + Date.now(), expires_in: 3600, ...(f.grant_type === 'authorization_code' ? { refresh_token: mock.refreshToken, scope: mock.scope } : {}) });
    }
    if (u.pathname === '/userinfo') return send(200, { email: 'info@parkpilot.test', name: 'Ryan Metcalfe' });
    if (u.pathname === '/gmail/labels' && req.method === 'GET') return send(200, { labels: mock.labels });
    if (u.pathname === '/gmail/labels' && req.method === 'POST') {
      const l = { id: json.name === 'CRM Leads' ? 'L_SOURCE' : 'L_DONE', name: json.name }; mock.labels.push(l); return send(200, l);
    }
    if (u.pathname === '/gmail/messages') {
      const label = u.searchParams.get('labelIds');
      return send(200, { messages: [...mock.messages.values()].filter(m => m.labelIds.includes(label)).reverse().map(m => ({ id: m.id, threadId: m.threadId })) });
    }
    let m = /^\/gmail\/messages\/([^/]+)(\/modify)?$/.exec(u.pathname);
    if (m) {
      const msg = mock.messages.get(m[1]); if (!msg) return send(404, { error: { message: 'Not found' } });
      if (m[2]) { msg.labelIds = msg.labelIds.filter(l => !json.removeLabelIds.includes(l)).concat(json.addLabelIds); return send(200, msg); }
      return send(200, msg);
    }
    if (u.pathname === '/cal/calendars/primary/events' && req.method === 'POST') {
      if (json.id && mock.events.has(json.id)) return send(409, { error: { message: 'The requested identifier already exists.' } });
      const ev = { ...json, id: json.id || 'gen' + mock.events.size, etag: '"1"', iCalUID: 'uid@google.com', sendUpdates: u.searchParams.get('sendUpdates') };
      if (json.conferenceData && json.conferenceData.createRequest) ev.hangoutLink = 'https://meet.google.com/abc-defg-hij';
      mock.events.set(ev.id, ev); return send(200, ev);
    }
    m = /^\/cal\/calendars\/primary\/events\/([^/]+)$/.exec(u.pathname);
    if (m) {
      const ev = mock.events.get(decodeURIComponent(m[1]));
      if (!ev) return send(404, { error: { message: 'Not Found' } });
      if (req.method === 'DELETE') { mock.events.delete(ev.id); res.writeHead(204); return res.end(); }
      Object.assign(ev, json, { etag: '"2"' }); return send(200, ev);
    }
    send(404, { error: { message: 'no route ' + u.pathname } });
  });
});

let D, L, A, G, uid;
test.before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(process.env, { GOOGLE_TOKEN_URL: base + '/token', GOOGLE_USERINFO_URL: base + '/userinfo', GOOGLE_REVOKE_URL: base + '/revoke', GMAIL_BASE: base + '/gmail', GCAL_BASE: base + '/cal' });
  D = require('../server/db'); L = require('../server/logic'); A = require('../server/access'); G = require('../server/google');
  await D.open();
  D.setSetting('closedDays', []);
  uid = D.insert('users', { email: 'info@parkpilot.test', name: 'Ryan', role: 'group', park_id: 1 });
  A.ctx.user = D.get('users', uid);
  G.setOrigin('https://crm.parkpilot.test');
});

/* ----------------------------------------------------------- reading emails */

test('reads a website form email field by field', () => {
  const m = { from: { name: 'ParkPilot Website', email: 'noreply@parkpilot.test' }, replyTo: null, subject: 'New Book a Demo request', snippet: '',
    text: 'You have a new demo request.\n\nName: sarah jones\nEmail: Sarah@WillowLakes.co.uk\nPhone: 07700 900456\nPark name: Willow Lakes Holiday Park\nNumber of units: 180 statics\nRole: General Manager\nCounty: North Yorkshire\nInterested in: AI agents and the CRM\nMessage: We miss lots of\nenquiries at weekends.\n\n--\nSent from parkpilot.test' };
  const lead = G.leadFromMessage(m, { own: ['parkpilot.test'] });
  assert.equal(lead.first_name, 'Sarah'); assert.equal(lead.last_name, 'Jones');
  assert.equal(lead.email, 'sarah@willowlakes.co.uk');
  assert.equal(lead.mobile, '07700 900456');
  assert.equal(lead.company, 'Willow Lakes Holiday Park');
  assert.equal(lead.units, 180);
  assert.equal(lead.job_title, 'General Manager');
  assert.equal(lead.region, 'North Yorkshire');
  assert.equal(lead.interest, 'AI + CRM');
  assert.equal(lead.message, 'We miss lots of\nenquiries at weekends.');
  assert.equal(lead.source, 'Website form');
});

test('reads form emails sent as an HTML table', () => {
  const text = G.htmlToText('<table><tr><td><b>Name</b></td><td>Tom O&#39;Neill</td></tr><tr><td>Email</td><td>tom@pinewood.example</td></tr><tr><td>Company</td><td>Pinewood &amp; Co</td></tr></table>');
  const f = G.formFields(text);
  assert.equal(f.name, 'Tom O\'Neill'); assert.equal(f.email, 'tom@pinewood.example'); assert.equal(f.company, 'Pinewood & Co');
});

test('a plain email: the sender is the lead; replies quoted below are left out', () => {
  const m = { from: { name: 'Dave Hughes', email: 'dave@sunnysands.example' }, replyTo: null, subject: 'Pricing for the CRM?', snippet: '',
    text: 'Hi Ryan,\nCould you send pricing for the CRM for our two parks?\nThanks, Dave\n\nOn Tue, 27 Oct 2026 at 10:00, Ryan wrote:\n> Hello' };
  const lead = G.leadFromMessage(m, { own: ['parkpilot.test'] });
  assert.equal(lead.first_name, 'Dave'); assert.equal(lead.last_name, 'Hughes');
  assert.equal(lead.email, 'dave@sunnysands.example');
  assert.equal(lead.interest, 'ParkPilot CRM');
  assert.equal(lead.source, 'Email');
  assert.match(lead.message, /two parks\?\nThanks, Dave$/);
});

test('an email you forwarded to yourself: the original sender is the lead', () => {
  const m = { from: { name: 'Ryan Metcalfe', email: 'ryan@parkpilot.test' }, replyTo: null, subject: 'Fwd: Enquiry', snippet: '',
    text: 'See below\n\n---------- Forwarded message ---------\nFrom: Jo Bloggs <jo@meadowview.example>\nDate: Mon, 26 Oct 2026\nSubject: Enquiry\n\nHi, keen to see a demo.' };
  const lead = G.leadFromMessage(m, { own: ['parkpilot.test'] });
  assert.equal(lead.email, 'jo@meadowview.example');
  assert.equal(lead.first_name, 'Jo'); assert.equal(lead.last_name, 'Bloggs');
});

test('reply-to is used when the form sends from a no-reply address, and names come from the address if needed', () => {
  const m = { from: { name: 'Forms', email: 'no-reply@forms.example' }, replyTo: { name: '', email: 'peter.smith@oakpark.example' }, subject: 'Contact form', snippet: '', text: 'Hello there' };
  const lead = G.leadFromMessage(m, { own: ['parkpilot.test'] });
  assert.equal(lead.email, 'peter.smith@oakpark.example');
  assert.equal(lead.first_name, 'Peter'); assert.equal(lead.last_name, 'Smith');
});

/* ------------------------------------------------------- connecting Google */

test('connecting refuses if Gmail or Calendar permission was not ticked', async () => {
  mock.scope = 'openid email https://www.googleapis.com/auth/calendar.events';
  await G.as(uid, async () => {
    const state = new URL(G.startAuth()).searchParams.get('state');
    await assert.rejects(G.finishAuth({ code: 'c', state }), /read and label your Gmail/);
    assert.equal(G.isConnected(uid), false);
  });
});

test('connecting creates the two Gmail labels and imports what is already labelled', async () => {
  mock.scope = 'openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.events';
  addMessage('m1', { from: 'ParkPilot Website <noreply@parkpilot.test>', subject: 'New Book a Demo request', at: Date.parse('2026-10-28T09:15:00Z'),
    text: 'Name: Sarah Jones\nEmail: sarah@willowlakes.co.uk\nPhone: 07700 900456\nPark: Willow Lakes Holiday Park\nUnits: 180\nMessage: Weekend enquiries are a problem.' });
  // The label doesn't exist yet in Gmail; the message carries the id the mock will give it.
  await G.as(uid, async () => {
    const state = new URL(G.startAuth()).searchParams.get('state');
    await G.finishAuth({ code: 'c', state });
  });
  assert.ok(G.isConnected(uid));
  assert.deepEqual(mock.labels.map(l => l.name).sort(), ['CRM Imported', 'CRM Leads', 'INBOX']);
  const c = D.db.prepare("SELECT * FROM contacts WHERE email = 'sarah@willowlakes.co.uk'").get();
  assert.ok(c, 'lead created');
  assert.equal(c.company, 'Willow Lakes Holiday Park');
  assert.equal(c.units, 180);
  assert.equal(c.owner_id, uid);
  assert.equal(c.lead_source, 'Website form');
  assert.equal(c.enquiry_date, '2026-10-28T09:15');
  assert.match(c.lead_no, /^PP\d{6}$/);
  const deal = D.db.prepare('SELECT * FROM deals WHERE contact_id = ?').get(c.id);
  assert.equal(deal.stage, 'Enquiry');
  const email = D.db.prepare("SELECT * FROM interactions WHERE contact_id = ? AND type = 'Email'").get(c.id);
  assert.match(email.summary, /New enquiry by email: “New Book a Demo request”/);
  assert.match(email.link, /mail\.google\.com\/mail\/u\/\?authuser=info%40parkpilot\.test#all\/tm1/);
  const task = D.db.prepare("SELECT * FROM tasks WHERE contact_id = ? AND status = 'Open'").get(c.id);
  assert.match(task.title, /^Reply to Sarah Jones \(Willow Lakes Holiday Park\)$/);
  assert.equal(task.priority, 'High');
  // Moved to the "CRM Imported" label so it is never imported twice.
  assert.deepEqual(mock.messages.get('m1').labelIds, ['L_DONE']);
  const st = G.status(uid);
  assert.equal(st.connected, true);
  assert.equal(st.account.email, 'info@parkpilot.test');
  assert.equal(st.gmailTotal, 1);
});

test('a second email from someone already in the CRM goes on their timeline, not a new lead', async () => {
  addMessage('m2', { from: 'Sarah Jones <sarah@willowlakes.co.uk>', subject: 'Re: Demo times', text: 'Thursday at 2pm works for us.' });
  addMessage('m3', { from: 'Dave Hughes <dave@sunnysands.example>', subject: 'CRM pricing', text: 'Could you send CRM pricing?' });
  const before = D.db.prepare('SELECT COUNT(*) n FROM contacts').get().n;
  const r = await G.as(uid, () => G.pullLeads());
  assert.deepEqual({ created: r.created, updated: r.updated }, { created: 1, updated: 1 });
  assert.equal(D.db.prepare('SELECT COUNT(*) n FROM contacts').get().n, before + 1);
  const sarah = D.db.prepare("SELECT id FROM contacts WHERE email = 'sarah@willowlakes.co.uk'").get().id;
  assert.equal(D.db.prepare("SELECT COUNT(*) n FROM interactions WHERE contact_id = ? AND type = 'Email'").get(sarah).n, 2);
  const dave = D.db.prepare("SELECT * FROM contacts WHERE email = 'dave@sunnysands.example'").get();
  assert.equal(dave.interest, 'ParkPilot CRM');
  assert.equal(D.db.prepare('SELECT deal_type FROM deals WHERE contact_id = ?').get(dave.id).deal_type, 'ParkPilot CRM');
  // Nothing left to import; running again changes nothing.
  const again = await G.as(uid, () => G.pullLeads());
  assert.equal(again.created + again.updated, 0);
});

test('an email that was imported but not relabelled (say, a timeout) is never imported twice', async () => {
  addMessage('m4', { from: 'New Person <new@lead.example>', subject: 'Hello', text: 'Hi' });
  await G.as(uid, () => G.pullLeads());
  mock.messages.get('m4').labelIds = ['L_SOURCE']; // pretend the relabel was lost
  const r = await G.as(uid, () => G.pullLeads());
  assert.equal(r.skipped, 1);
  assert.equal(D.db.prepare("SELECT COUNT(*) n FROM contacts WHERE email = 'new@lead.example'").get().n, 1);
  assert.deepEqual(mock.messages.get('m4').labelIds, ['L_DONE']);
});

/* ------------------------------------------------------- Google Calendar */

test('a demo goes into Google Calendar with a Meet link and an invite; moving and cancelling follow', async () => {
  const sarah = D.db.prepare("SELECT * FROM contacts WHERE email = 'sarah@willowlakes.co.uk'").get();
  const day = require('../server/util').addDays(require('../server/util').today(), 3);
  const id = L.createAppointment({ type: 'Demo', start: `${day}T14:00`, contact_id: sarah.id, owner_id: uid });
  assert.equal(D.get('appointments', id).sync_status, 'Pending');
  await G.flush();
  let a = D.get('appointments', id);
  assert.equal(a.sync_status, 'Synced', a.sync_error);
  assert.equal(a.teams_url, 'https://meet.google.com/abc-defg-hij');
  const ev = mock.events.get(a.outlook_event_id);
  assert.match(ev.id, /^[a-v0-9]+$/, 'Google event ids use letters a–v and digits only');
  assert.equal(ev.summary, 'Demo – Sarah Jones');
  assert.equal(ev.start.dateTime, `${day}T14:00:00`);
  assert.equal(ev.start.timeZone, 'Europe/London');
  assert.deepEqual(ev.attendees.map(x => x.email), ['sarah@willowlakes.co.uk']);
  assert.equal(ev.sendUpdates, 'all');
  assert.match(ev.description, /Willow Lakes Holiday Park/);
  L.updateAppointment(id, { start: `${day}T15:30` });
  await G.flush();
  assert.equal(mock.events.get(a.outlook_event_id).start.dateTime, `${day}T15:30:00`);
  L.cancelAppointment(id, { message: 'Sorry, need to rearrange' });
  await G.flush();
  a = D.get('appointments', id);
  assert.equal(mock.events.has(a.outlook_event_id), false);
  assert.equal(a.sync_status, 'Synced');
});

test('an event deleted in Google Calendar is added again when changed in the CRM', async () => {
  const day = require('../server/util').addDays(require('../server/util').today(), 5);
  const id = L.createAppointment({ type: 'Site visit', start: `${day}T10:00`, owner_id: uid, title: 'Visit Pinewood' });
  await G.flush();
  const first = D.get('appointments', id).outlook_event_id;
  assert.equal(mock.events.get(first).conferenceData, undefined, 'no Meet link for a visit on site');
  mock.events.delete(first);
  L.updateAppointment(id, { notes: 'Bring the tablet' });
  await G.flush();
  const a = D.get('appointments', id);
  assert.equal(a.sync_status, 'Synced');
  assert.ok(mock.events.has(a.outlook_event_id));
});

test('if Google access is withdrawn, the CRM says so instead of failing silently', async () => {
  mock.refreshToken = 'changed';
  await G.as(uid, async () => {
    const st = D.getState(`gTokens:${uid}`); D.setState(`gTokens:${uid}`, { ...st, expires_at: 0 });
    await G.pullLeads();
  });
  assert.match(G.status(uid).lastError, /Reconnect Google in Settings/);
});

test('disconnecting forgets the tokens', async () => {
  await G.as(uid, () => G.disconnect());
  assert.equal(G.isConnected(uid), false);
});

test.after(() => { server.close(); A.ctx.user = null; D.db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
