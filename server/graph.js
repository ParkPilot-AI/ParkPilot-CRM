'use strict';
// Microsoft Outlook integration through Microsoft Graph (delegated permissions).
//  - Connect: authorisation-code flow with PKCE and a client secret (Netlify environment variables),
//    redirecting to https://<your site>/api/auth/callback.
//  - CRM -> Outlook: changes are sent to Outlook before the request that made them finishes.
//  - Outlook -> CRM: Microsoft calls /api/graph/notify the moment your calendar changes; the
//    portal then reads the changes with a calendarView delta query. A delta check also runs
//    whenever the portal is open and the last one is more than a few minutes old.
//  - Tasks are mirrored to a "Coastfields CRM" list in Microsoft To Do; completions flow back.
const crypto = require('node:crypto');
const { db, tx, insert, update, get, getSettings, getState, setState, logJob } = require('./db');
const U = require('./util');

const GRAPH = process.env.GRAPH_BASE || 'https://graph.microsoft.com/v1.0';
const LOGIN = process.env.LOGIN_BASE || 'https://login.microsoftonline.com';
const SCOPES = 'offline_access openid profile User.Read Calendars.ReadWrite Tasks.ReadWrite';
const PROP_ID = 'String {6f1c2a7e-3b5d-4c8e-9a10-c0a57f1e1d5a} Name CoastfieldsApptId';
const CATEGORY = 'Coastfields CRM';
const TZ_HEADERS = { Prefer: 'outlook.timezone="Europe/London", IdType="ImmutableId"' };

const cancelMessages = new Map();
let busy = false;
const pending = { push: false, todo: false };
let origin = '';

function config() {
  return {
    clientId: (process.env.GRAPH_CLIENT_ID || '').trim(),
    secret: (process.env.GRAPH_CLIENT_SECRET || '').trim(),
    tenant: (process.env.GRAPH_TENANT_ID || 'organizations').trim() || 'organizations'
  };
}
function configured() { const c = config(); return !!(c.clientId && c.secret); }
function setOrigin(o) {
  origin = o || '';
  if (origin && getSettings().publicOrigin !== origin && /^https:\/\//.test(origin)) {
    db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('publicOrigin', JSON.stringify(origin));
  }
}
function siteOrigin() { return origin || getSettings().publicOrigin || ''; }
function redirectUri() { return `${siteOrigin()}/api/auth/callback`; }
function notifyUrl() { return `${siteOrigin()}/api/graph/notify`; }
function clientState() { return crypto.createHmac('sha256', config().secret || 'coastfields').update('graph-notify').digest('hex').slice(0, 64); }

// Refresh tokens are stored encrypted with a key derived from the client secret.
function key() { return crypto.createHash('sha256').update('coastfields-token:' + (config().secret || 'local')).digest(); }
function seal(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
}
function unseal(box) {
  if (!box) return null;
  try {
    const [iv, tag, enc] = box.split('.').map(x => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return null; }
}
function tokens() {
  const t = getState('msTokens');
  if (!t) return null;
  return { ...t, refresh_token: unseal(t.refresh_box), access_token: unseal(t.access_box) };
}
function isConnected() { const t = getState('msTokens'); return !!(t && t.refresh_box && configured()); }

function graphStatus() { return getState('graphStatus') || {}; }
function setGraphStatus(patch) { setState('graphStatus', { ...graphStatus(), ...patch }); }

/* ------------------------------------------------------------------ auth */

function b64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

function startAuth() {
  const { clientId, tenant } = config();
  if (!configured()) throw Object.assign(new Error('Outlook is not set up yet: add GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET and GRAPH_TENANT_ID in Netlify → Site configuration → Environment variables, then redeploy.'), { status: 400 });
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  setState('authPending', { state, verifier, created: Date.now(), redirect: redirectUri() });
  const q = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query',
    scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account'
  });
  return `${LOGIN}/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize?${q}`;
}

async function tokenRequest(params) {
  const { clientId, tenant, secret } = config();
  const res = await fetch(`${LOGIN}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, scope: SCOPES, ...params })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error_description ? j.error_description.split('\r\n')[0] : `Sign-in failed (${res.status})`);
  return j;
}

function saveTokens(j, account) {
  const prev = getState('msTokens') || {};
  setState('msTokens', {
    access_box: seal(j.access_token), refresh_box: j.refresh_token ? seal(j.refresh_token) : prev.refresh_box,
    expires_at: Date.now() + (Number(j.expires_in) || 3600) * 1000, account: account || prev.account || null
  });
}

async function finishAuth(query) {
  if (query.error) throw new Error(query.error_description || query.error);
  const p = getState('authPending');
  if (!p || p.state !== query.state || Date.now() - p.created > 20 * 60e3) throw new Error('This sign-in link has expired. Please try connecting again.');
  setState('authPending', null);
  const j = await tokenRequest({ grant_type: 'authorization_code', code: query.code, redirect_uri: p.redirect, code_verifier: p.verifier });
  saveTokens(j, null);
  const me = await graphFetch('GET', '/me?$select=displayName,mail,userPrincipalName');
  saveTokens(j, { name: me.displayName, email: me.mail || me.userPrincipalName });
  logJob('outlook', `Connected as ${me.mail || me.userPrincipalName}`);
  // Everything created before connecting gets pushed now.
  db.prepare("UPDATE appointments SET sync_status = 'Pending', sync_attempts = 0 WHERE status = 'Scheduled' AND outlook_event_id IS NULL AND start >= ?").run(U.addDays(U.today(), -1) + 'T00:00');
  pending.push = true; pending.todo = true;
  await syncNow({ budgetMs: 5e3 });
}

async function disconnect() {
  const sub = getState('subscription');
  if (sub && sub.id && isConnected()) await graphFetch('DELETE', `/subscriptions/${sub.id}`).catch(() => {});
  for (const k of ['msTokens', 'calDelta', 'todoList', 'todoDelta', 'subscription', 'graphStatus']) setState(k, null);
  db.prepare("UPDATE appointments SET sync_status = 'Local' WHERE sync_status IN ('Pending','Error')").run();
  db.prepare('DELETE FROM outlook_events').run();
  db.prepare('UPDATE tasks SET todo_id = NULL, todo_hash = NULL').run();
  logJob('outlook', 'Disconnected');
}

async function accessToken() {
  const t = tokens();
  if (!t || !t.refresh_token) throw new Error('Not connected to Outlook');
  if (t.access_token && t.expires_at - Date.now() > 5 * 60e3) return t.access_token;
  const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  saveTokens(j);
  return j.access_token;
}

async function graphFetch(method, path, body, extraHeaders = {}, attempt = 0) {
  const token = await accessToken();
  const url = path.startsWith('http') ? path : GRAPH + path;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 429 || res.status === 503 || res.status === 504) {
    if (attempt < 2) {
      const wait = Math.min(8, Number(res.headers.get('retry-after')) || 2 ** attempt * 2);
      await new Promise(r => setTimeout(r, wait * 1000));
      return graphFetch(method, path, body, extraHeaders, attempt + 1);
    }
  }
  if (res.status === 401 && attempt === 0) {
    const t = getState('msTokens'); if (t) setState('msTokens', { ...t, expires_at: 0 });
    return graphFetch(method, path, body, extraHeaders, 1);
  }
  if (res.status === 204 || res.status === 202) return {};
  const text = await res.text();
  let j = {}; try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
  if (!res.ok) {
    const e = new Error((j.error && j.error.message) || `Microsoft Graph error ${res.status}`);
    e.status = res.status; e.code = j.error && j.error.code;
    throw e;
  }
  return j;
}

/* ----------------------------------------------------- CRM -> Outlook push */

// Changes are marked here and sent by flush(), which the request handler awaits before saving.
function queuePush(apptId) {
  if (!isConnected()) return;
  if (apptId) db.prepare("UPDATE appointments SET sync_status = 'Pending', sync_attempts = 0 WHERE id = ? AND sync_status <> 'Pending'").run(apptId);
  pending.push = true;
}
function queueCancel(apptId, message) { if (message) cancelMessages.set(apptId, message); queuePush(null); }

function htmlEscape(s) { return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function eventBody(a) {
  const c = a.contact_id ? get('contacts', a.contact_id) : null;
  const home = a.home_id ? get('homes', a.home_id) : null;
  const lines = [];
  if (c) lines.push(`<b>Customer:</b> ${htmlEscape(c.first_name + ' ' + c.last_name)}${c.mobile ? ' · ' + htmlEscape(c.mobile) : ''}`);
  if (home) lines.push(`<b>Holiday home:</b> ${htmlEscape([home.year, home.make, home.model].filter(Boolean).join(' '))}`);
  if (a.notes) lines.push(htmlEscape(a.notes).replace(/\n/g, '<br>'));
  lines.push('<span style="color:#888">Booked in Coastfields Customer Portal</span>');
  const ev = {
    subject: a.title,
    body: { contentType: 'HTML', content: lines.join('<br>') },
    start: { dateTime: a.start + ':00', timeZone: U.TZ },
    end: { dateTime: a.end + ':00', timeZone: U.TZ },
    location: { displayName: a.location || '' },
    categories: [CATEGORY],
    attendees: a.send_invite && c && c.email ? [{ type: 'required', emailAddress: { address: c.email, name: `${c.first_name} ${c.last_name}`.trim() } }] : [],
    singleValueExtendedProperties: [{ id: PROP_ID, value: String(a.id) }],
    showAs: 'busy', isReminderOn: true, reminderMinutesBeforeStart: 30
  };
  if (a.is_remote) { ev.isOnlineMeeting = true; ev.onlineMeetingProvider = 'teamsForBusiness'; }
  return ev;
}

function recordEvent(a, ev) {
  update('appointments', a.id, {
    outlook_event_id: ev.id, ical_uid: ev.iCalUId || a.ical_uid, change_key: ev.changeKey,
    teams_url: (ev.onlineMeeting && ev.onlineMeeting.joinUrl) || a.teams_url,
    sync_status: 'Synced', sync_error: null, sync_attempts: 0
  }, { touch: false });
  cacheEvent(ev, a.id);
}

async function pushOne(a) {
  if (a.status === 'Cancelled') {
    if (a.outlook_event_id) {
      const msg = cancelMessages.get(a.id) || 'This appointment has been cancelled.';
      try {
        const hasAttendees = a.send_invite && a.contact_id && (get('contacts', a.contact_id) || {}).email;
        if (hasAttendees) await graphFetch('POST', `/me/events/${encodeURIComponent(a.outlook_event_id)}/cancel`, { comment: msg }, TZ_HEADERS);
        else await graphFetch('DELETE', `/me/events/${encodeURIComponent(a.outlook_event_id)}`, null, TZ_HEADERS);
      } catch (e) {
        if (e.status === 400 && /organizer/i.test(e.message)) await graphFetch('DELETE', `/me/events/${encodeURIComponent(a.outlook_event_id)}`, null, TZ_HEADERS);
        else if (e.status !== 404) throw e;
      }
      cancelMessages.delete(a.id);
      db.prepare('DELETE FROM outlook_events WHERE id = ?').run(a.outlook_event_id);
    }
    update('appointments', a.id, { sync_status: 'Synced', sync_error: null }, { touch: false });
    return;
  }
  const body = eventBody(a);
  if (!a.outlook_event_id) {
    body.transactionId = `coastfields-${a.id}-${crypto.createHash('sha1').update(a.created_at).digest('hex').slice(0, 10)}`;
    const ev = await graphFetch('POST', '/me/events', body, TZ_HEADERS);
    recordEvent(a, ev);
    return;
  }
  try {
    const ev = await graphFetch('PATCH', `/me/events/${encodeURIComponent(a.outlook_event_id)}`, body, TZ_HEADERS);
    recordEvent(a, ev);
  } catch (e) {
    if (e.status !== 404) throw e;
    // Deleted in Outlook while changed here: recreate it, since the latest action was in the CRM.
    const ev = await graphFetch('POST', '/me/events', body, TZ_HEADERS);
    recordEvent(a, ev);
  }
}

async function processPushQueue() {
  if (!isConnected() || busy) return;
  busy = true;
  try {
    const rows = db.prepare("SELECT * FROM appointments WHERE sync_status = 'Pending' ORDER BY updated_at LIMIT 25").all();
    for (const a of rows) {
      try { await pushOne(a); setGraphStatus({ lastPush: U.nowStamp() }); }
      catch (e) {
        const attempts = a.sync_attempts + 1;
        update('appointments', a.id, { sync_attempts: attempts, sync_error: e.message, sync_status: attempts >= 5 ? 'Error' : 'Pending' }, { touch: false });
        setGraphStatus({ lastError: e.message });
        if (/Not connected|invalid_grant|AADSTS/.test(e.message)) break;
      }
    }
  } finally { busy = false; }
}

/* ----------------------------------------------------- Outlook -> CRM pull */

const localDT = s => (s || '').slice(0, 16);

function cacheEvent(ev, apptId) {
  db.prepare(`INSERT INTO outlook_events(id, subject, start, end, is_all_day, show_as, is_cancelled, change_key, ical_uid, appointment_id, attendees, updated_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET subject=excluded.subject, start=excluded.start, end=excluded.end, is_all_day=excluded.is_all_day,
                show_as=excluded.show_as, is_cancelled=excluded.is_cancelled, change_key=excluded.change_key, ical_uid=excluded.ical_uid,
                appointment_id=COALESCE(excluded.appointment_id, outlook_events.appointment_id), attendees=excluded.attendees, updated_at=excluded.updated_at`)
    .run(ev.id, ev.subject || '', localDT(ev.start && ev.start.dateTime), localDT(ev.end && ev.end.dateTime), ev.isAllDay ? 1 : 0,
      ev.showAs || 'busy', ev.isCancelled ? 1 : 0, ev.changeKey || null, ev.iCalUId || null, apptId || null,
      JSON.stringify((ev.attendees || []).map(x => x.emailAddress && x.emailAddress.address).filter(Boolean)), U.nowStamp());
}

function guessType(ev) {
  const s = (ev.subject || '').toLowerCase();
  if (/valuation|part.?ex/.test(s)) return 'Part-ex valuation';
  if (/hand.?over|keys/.test(s)) return 'Handover';
  if (/financ/.test(s)) return 'Finance meeting';
  if (ev.isOnlineMeeting || /teams/.test(s)) return 'Teams call';
  if (/call|phone/.test(s)) return 'Phone call';
  return 'Viewing';
}

function applyEvent(ev) {
  const L = require('./logic');
  if (ev['@removed']) {
    const a = db.prepare('SELECT * FROM appointments WHERE outlook_event_id = ?').get(ev.id);
    db.prepare('DELETE FROM outlook_events WHERE id = ?').run(ev.id);
    if (a && a.status === 'Scheduled' && a.sync_status !== 'Pending' && a.end >= U.nowLocal()) L.cancelAppointment(a.id, { fromOutlook: true });
    else if (a) update('appointments', a.id, { outlook_event_id: null, change_key: null }, { touch: false });
    return 'removed';
  }
  if (ev.type === 'seriesMaster') return 'skip';
  let a = db.prepare('SELECT * FROM appointments WHERE outlook_event_id = ?').get(ev.id)
       || (ev.iCalUId ? db.prepare('SELECT * FROM appointments WHERE ical_uid = ? AND ical_uid IS NOT NULL').get(ev.iCalUId) : null);
  cacheEvent(ev, a ? a.id : null);
  if (a) {
    if (a.change_key && a.change_key === ev.changeKey) return 'echo';
    if (ev.isCancelled) { if (a.status === 'Scheduled') L.cancelAppointment(a.id, { fromOutlook: true }); return 'cancelled'; }
    const start = localDT(ev.start && ev.start.dateTime), end = localDT(ev.end && ev.end.dateTime);
    const loc = ev.location && ev.location.displayName;
    const moved = start && (start !== a.start || end !== a.end);
    const patch = { change_key: ev.changeKey, outlook_event_id: ev.id, ical_uid: ev.iCalUId || a.ical_uid,
      teams_url: (ev.onlineMeeting && ev.onlineMeeting.joinUrl) || a.teams_url };
    if (start) { patch.start = start; patch.end = end; }
    if (loc !== undefined && loc !== null && loc !== a.location) patch.location = loc;
    if (ev.subject && ev.subject !== a.title) patch.title = ev.subject;
    if (a.sync_status === 'Pending' && moved) {
      // Both sides changed: Outlook's time wins (it is what the customer's invite shows); CRM notes are kept.
      patch.conflict_note = `Time changed in both places; kept Outlook's time (${L.fmtWhen(start)}).`;
      patch.sync_status = 'Pending'; // still push our non-time fields
    } else if (a.sync_status !== 'Pending') patch.sync_status = 'Synced';
    if (a.status === 'Cancelled' && !ev.isCancelled) patch.status = 'Scheduled';
    update('appointments', a.id, patch, { touch: false });
    if (moved && a.contact_id) {
      insert('interactions', { contact_id: a.contact_id, deal_id: a.deal_id, type: 'Appointment', at: U.nowLocal(), appointment_id: a.id,
        summary: `${a.type} moved in Outlook from ${L.fmtWhen(a.start)} to ${L.fmtWhen(start)}.` });
      L.syncAutoTasks(get('appointments', a.id));
    }
    return moved ? 'moved' : 'updated';
  }
  // Unknown event. Events the CRM created are linked by its push, so leave them to it.
  if ((ev.categories || []).includes(CATEGORY) || ev.isCancelled || ev.isAllDay) return 'cached';
  const emails = (ev.attendees || []).map(x => (x.emailAddress && x.emailAddress.address || '').toLowerCase()).filter(Boolean);
  if (!emails.length) return 'cached';
  const contact = db.prepare(`SELECT * FROM contacts WHERE lower(email) IN (${emails.map(() => '?').join(',')}) ORDER BY updated_at DESC LIMIT 1`).get(...emails);
  if (!contact) return 'cached';
  const start = localDT(ev.start.dateTime), end = localDT(ev.end.dateTime);
  if (start < U.addDays(U.today(), -7) + 'T00:00') return 'cached';
  const type = guessType(ev);
  const deal = db.prepare("SELECT id FROM deals WHERE contact_id = ? AND stage NOT IN ('Completed','Lost') ORDER BY updated_at DESC LIMIT 1").get(contact.id);
  const id = insert('appointments', {
    type, title: ev.subject || type, start, end, location: ev.location && ev.location.displayName, is_remote: ev.isOnlineMeeting ? 1 : 0,
    contact_id: contact.id, deal_id: deal ? deal.id : null, outlook_event_id: ev.id, ical_uid: ev.iCalUId, change_key: ev.changeKey,
    teams_url: ev.onlineMeeting && ev.onlineMeeting.joinUrl, sync_status: 'Synced', needs_review: 1, send_invite: 0
  });
  db.prepare('UPDATE outlook_events SET appointment_id = ? WHERE id = ?').run(id, ev.id);
  insert('interactions', { contact_id: contact.id, deal_id: deal ? deal.id : null, type: 'Appointment', at: U.nowLocal(), appointment_id: id,
    summary: `${type} found in Outlook for ${L.fmtWhen(start)} and linked automatically (check the link).` });
  L.syncAutoTasks(get('appointments', id));
  return 'linked';
}

async function pullCalendar({ budgetMs = 20e3, forceFresh = false } = {}) {
  const deadline = Date.now() + budgetMs;
  let st = getState('calDelta');
  const fresh = forceFresh || !st || (!st.link && !st.next) || Date.now() - (st.createdAt || 0) > 7 * 864e5;
  let url;
  if (fresh) {
    const from = U.addDays(U.today(), -30), to = U.addDays(U.today(), 365);
    url = `${GRAPH}/me/calendarView/delta?startDateTime=${from}T00:00:00Z&endDateTime=${to}T00:00:00Z`;
    st = { createdAt: Date.now(), seen: [] , fresh: true };
  } else url = st.next || st.link;
  const counts = {};
  let finished = false;
  for (let page = 0; page < 200 && url; page++) {
    const j = await graphFetch('GET', url, null, { Prefer: 'outlook.timezone="Europe/London", IdType="ImmutableId", odata.maxpagesize=100' });
    tx(() => {
      for (const ev of j.value || []) {
        if (st.fresh) st.seen.push(ev.id);
        const r = applyEvent(ev);
        counts[r] = (counts[r] || 0) + 1;
      }
    });
    if (j['@odata.deltaLink']) { st.link = j['@odata.deltaLink']; st.next = null; url = null; finished = true; }
    else { url = j['@odata.nextLink']; st.next = url; }
    if (url && Date.now() > deadline) break; // carry on next time from st.next
  }
  if (finished && st.fresh) {
    // A fresh window lists every event in it; anything cached in that window but not listed has gone.
    const from = U.addDays(U.today(), -30) + 'T00:00';
    const seen = new Set(st.seen);
    db.prepare('DELETE FROM outlook_events WHERE start < ?').run(from);
    const stale = db.prepare('SELECT id FROM outlook_events WHERE start >= ?').all(from).filter(r => !seen.has(r.id));
    tx(() => { for (const r of stale) applyEvent({ id: r.id, '@removed': { reason: 'deleted' } }); });
    st.fresh = false; st.seen = [];
  }
  setState('calDelta', st);
  setGraphStatus({ lastPull: U.nowStamp(), lastPullMs: Date.now() });
  counts.complete = finished;
  return counts;
}

/* ------------------------------------------------------- Microsoft To Do */

function queueTodoSync() {
  if (!isConnected() || !getSettings().todoMirror) return;
  pending.todo = true;
}

async function todoListId() {
  const saved = getState('todoList');
  if (saved) return saved;
  const lists = await graphFetch('GET', '/me/todo/lists');
  let list = (lists.value || []).find(l => l.displayName === CATEGORY);
  if (!list) list = await graphFetch('POST', '/me/todo/lists', { displayName: CATEGORY });
  setState('todoList', list.id);
  return list.id;
}

function todoPayload(t) {
  const c = t.contact_id ? get('contacts', t.contact_id) : null;
  return {
    title: c ? `${t.title}` + (t.title.includes(c.last_name || '§') ? '' : ` – ${c.first_name} ${c.last_name}`.trimEnd()) : t.title,
    importance: t.priority === 'High' ? 'high' : t.priority === 'Low' ? 'low' : 'normal',
    status: t.status === 'Done' ? 'completed' : 'notStarted',
    dueDateTime: t.due_date ? { dateTime: `${t.due_date}T09:00:00`, timeZone: U.TZ } : null,
    categories: [t.category],
    body: { contentType: 'text', content: [t.notes, c && c.mobile ? 'Tel ' + c.mobile : '', 'From Coastfields Customer Portal'].filter(Boolean).join('\n') }
  };
}
const hashOf = o => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex');

let todoBusy = false;
async function syncTodo() {
  if (!isConnected() || !getSettings().todoMirror || todoBusy) return;
  todoBusy = true;
  try {
    const listId = await todoListId();
    // Pull completions first so a tick in To Do isn't overwritten.
    let dst = getState('todoDelta');
    let url = dst && dst.link ? dst.link : `${GRAPH}/me/todo/lists/${listId}/tasks/delta`;
    for (let page = 0; page < 50 && url; page++) {
      let j;
      try { j = await graphFetch('GET', url); }
      catch (e) { if (e.status === 410 || e.status === 400) { setState('todoDelta', null); url = `${GRAPH}/me/todo/lists/${listId}/tasks/delta`; continue; } throw e; }
      for (const item of j.value || []) {
        const t = db.prepare('SELECT * FROM tasks WHERE todo_id = ?').get(item.id);
        if (!t) continue;
        if (item['@removed']) { update('tasks', t.id, { todo_id: null, todo_hash: null }, { touch: false }); continue; }
        if (item.status === 'completed' && t.status === 'Open') {
          require('./logic').completeTask(t.id, true);
        }
      }
      if (j['@odata.deltaLink']) { setState('todoDelta', { link: j['@odata.deltaLink'] }); url = null; }
      else url = j['@odata.nextLink'];
    }
    // Push: open tasks, plus recently finished ones that are still mirrored.
    const rows = db.prepare(`SELECT * FROM tasks WHERE (status = 'Open') OR (todo_id IS NOT NULL)`).all();
    for (const t of rows) {
      try {
        if (t.status === 'Dropped') {
          if (t.todo_id) { await graphFetch('DELETE', `/me/todo/lists/${listId}/tasks/${t.todo_id}`).catch(e => { if (e.status !== 404) throw e; }); }
          update('tasks', t.id, { todo_id: null, todo_hash: null }, { touch: false });
          continue;
        }
        const body = todoPayload(t); const h = hashOf(body);
        if (t.todo_id && t.todo_hash === h) continue;
        if (t.todo_id) {
          try { await graphFetch('PATCH', `/me/todo/lists/${listId}/tasks/${t.todo_id}`, body); }
          catch (e) { if (e.status !== 404) throw e; const r = await graphFetch('POST', `/me/todo/lists/${listId}/tasks`, body); t.todo_id = r.id; }
        } else {
          if (t.status !== 'Open') continue;
          const r = await graphFetch('POST', `/me/todo/lists/${listId}/tasks`, body); t.todo_id = r.id;
        }
        update('tasks', t.id, { todo_id: t.status === 'Done' ? null : t.todo_id, todo_hash: t.status === 'Done' ? null : h }, { touch: false });
      } catch (e) {
        if (e.status === 404 && /list/i.test(e.message)) { setState('todoList', null); throw e; }
        setGraphStatus({ lastError: 'To Do: ' + e.message });
      }
    }
  } finally { todoBusy = false; }
}

/* ------------------------------------------------------- subscriptions */

// Keeps a Graph subscription alive so Microsoft notifies /api/graph/notify when the calendar changes.
async function ensureSubscription() {
  if (!isConnected() || !/^https:\/\//.test(siteOrigin()) || /localhost|127\.0\.0\.1/.test(siteOrigin())) return null;
  const sub = getState('subscription');
  const expiry = new Date(Date.now() + 10000 * 60e3).toISOString(); // just under the 10,080-minute maximum
  if (sub && sub.id && sub.url === notifyUrl()) {
    if (Date.parse(sub.expires) - Date.now() > 2 * 864e5) return sub;
    try {
      const r = await graphFetch('PATCH', `/subscriptions/${sub.id}`, { expirationDateTime: expiry });
      setState('subscription', { ...sub, expires: r.expirationDateTime || expiry });
      return getState('subscription');
    } catch (e) { if (e.status !== 404) throw e; }
  }
  const r = await graphFetch('POST', '/subscriptions', {
    changeType: 'created,updated,deleted', resource: '/me/events', notificationUrl: notifyUrl(), lifecycleNotificationUrl: notifyUrl(),
    expirationDateTime: expiry, clientState: clientState()
  });
  setState('subscription', { id: r.id, expires: r.expirationDateTime, url: notifyUrl() });
  logJob('outlook', 'Live updates from Outlook switched on');
  return getState('subscription');
}

// Checks a notification body from Microsoft. Returns what kind it is, or null if it isn't genuine.
function checkNotification(body) {
  const items = (body && body.value) || [];
  if (!items.length) return null;
  const cs = clientState();
  if (!items.every(i => i.clientState === cs)) return null;
  return items.some(i => i.lifecycleEvent) ? 'lifecycle:' + items.map(i => i.lifecycleEvent).filter(Boolean).join(',') : 'changed';
}

/* ------------------------------------------------------------ scheduling */

// Sends anything queued during this request (pushes, To Do changes) and keeps the subscription fresh.
async function flush({ budgetMs = 15e3 } = {}) {
  if (!isConnected()) { pending.push = pending.todo = false; return; }
  const t0 = Date.now();
  try {
    if (pending.push) { pending.push = false; await processPushQueue(); }
    if (pending.todo && getSettings().todoMirror && Date.now() - t0 < budgetMs) { pending.todo = false; await syncTodo(); }
    if (Date.now() - t0 < budgetMs) await ensureSubscription();
  } catch (e) { setGraphStatus({ lastError: e.message }); }
}

async function syncNow({ budgetMs = 20e3, forceFresh = false } = {}) {
  if (!isConnected()) return { connected: false };
  const result = {};
  try {
    await processPushQueue();
    result.calendar = await pullCalendar({ budgetMs, forceFresh });
    await processPushQueue();
    if (getSettings().todoMirror) await syncTodo();
    await ensureSubscription().catch(e => setGraphStatus({ lastError: 'Live updates: ' + e.message }));
    setGraphStatus({ lastError: null });
    logJob('outlook-sync', result.calendar);
  } catch (e) {
    setGraphStatus({ lastError: e.message });
    result.error = e.message;
  }
  return result;
}

function needsSync(maxAgeMs = 5 * 60e3) {
  if (!isConnected()) return false;
  const st = graphStatus(), cd = getState('calDelta');
  return !st.lastPullMs || Date.now() - st.lastPullMs > maxAgeMs || !!(cd && cd.next);
}

function status() {
  const t = getState('msTokens');
  const st = graphStatus();
  const sub = getState('subscription');
  return {
    configured: configured(), managed: configured(), connected: isConnected(), account: t && t.account, redirectUri: redirectUri(),
    lastPull: st.lastPull || null, lastPush: st.lastPush || null, lastError: st.lastError || null,
    live: !!(sub && sub.id && Date.parse(sub.expires) > Date.now()),
    pending: db.prepare("SELECT COUNT(*) n FROM appointments WHERE sync_status = 'Pending'").get().n,
    errors: db.prepare("SELECT COUNT(*) n FROM appointments WHERE sync_status = 'Error'").get().n
  };
}

function retryErrors() {
  db.prepare("UPDATE appointments SET sync_status = 'Pending', sync_attempts = 0 WHERE sync_status = 'Error'").run();
  pending.push = true;
}

module.exports = { setOrigin, startAuth, finishAuth, disconnect, isConnected, configured, queuePush, queueCancel, queueTodoSync, syncNow, flush, needsSync,
  status, retryErrors, graphFetch, checkNotification, ensureSubscription, clientState };
