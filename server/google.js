'use strict';
// Google Workspace: Gmail lead capture and Google Calendar (delegated access, one person at a time).
//
//  - Connect: authorisation-code flow with PKCE and the app's client secret, redirecting to
//    https://<your site>/api/google/callback. Asks for Gmail (read and label) and Calendar events.
//  - Gmail -> CRM: any email carrying the "CRM Leads" label (put there by hand or by a Gmail filter)
//    becomes a lead. Website form emails are read field by field (Name:, Email:, Phone:, Park: …).
//    If the sender is already a contact the email is added to their timeline instead. Each email is
//    then moved to the "CRM Imported" label, so it is only ever imported once.
//  - CRM -> Google Calendar: appointments are added to the owner's calendar before the request that
//    made them finishes, with a Google Meet link for online demos and an invite to the customer.
//
// Each member of the team connects their own Google account. `as(userId, fn)` sets who; their tokens
// and state are kept under keys ending ":<userId>". Leads from someone's Gmail are theirs.
const crypto = require('node:crypto');
const { db, tx, insert, update, get, getSettings, getState, setState, logJob } = require('./db');
const U = require('./util');

const GMAIL = process.env.GMAIL_BASE || 'https://gmail.googleapis.com/gmail/v1/users/me';
const CAL = process.env.GCAL_BASE || 'https://www.googleapis.com/calendar/v3';
const AUTH_URL = process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const USERINFO = process.env.GOOGLE_USERINFO_URL || 'https://openidconnect.googleapis.com/v1/userinfo';
const REVOKE_URL = process.env.GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke';
const SCOPE_GMAIL = 'https://www.googleapis.com/auth/gmail.modify';
const SCOPE_CAL = 'https://www.googleapis.com/auth/calendar.events';
const SCOPES = `openid email profile ${SCOPE_GMAIL} ${SCOPE_CAL}`;
const MAX_PER_RUN = 25;

const cancelMessages = new Map();
let busy = false, gmailBusy = false;
let origin = '';
let gu = null; // the person whose Google account we are working with

async function as(uid, fn) { const prev = gu; gu = uid ? Number(uid) : null; try { return await fn(); } finally { gu = prev; } }
function withUser(uid, fn) { const prev = gu; gu = Number(uid || gu || currentUserId()) || null; try { return fn(); } finally { gu = prev; } }
function currentUserId() { return gu || (require('./access').ctx.user || {}).id || null; }
const cur = () => currentUserId();
const K = name => `${name}:${cur()}`;

function config() {
  return { clientId: (process.env.GOOGLE_CLIENT_ID || '').trim(), secret: (process.env.GOOGLE_CLIENT_SECRET || '').trim() };
}
function configured() { const c = config(); return !!(c.clientId && c.secret); }
function setOrigin(o) {
  origin = o || '';
  if (origin && getSettings().publicOrigin !== origin && /^https:\/\//.test(origin)) {
    db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('publicOrigin', JSON.stringify(origin));
  }
}
function siteOrigin() { return origin || getSettings().publicOrigin || ''; }
function redirectUri() { return `${siteOrigin()}/api/google/callback`; }

// Refresh tokens are stored encrypted with a key derived from the client secret.
function key() { return crypto.createHash('sha256').update('parkpilot-token:' + (config().secret || 'local')).digest(); }
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
  const t = getState(K('gTokens'));
  if (!t) return null;
  return { ...t, refresh_token: unseal(t.refresh_box), access_token: unseal(t.access_box) };
}
function isConnected(uid) {
  const id = uid === undefined ? cur() : uid;
  if (!id) return false;
  const t = getState(`gTokens:${id}`);
  return !!(t && t.refresh_box && configured());
}
function connectedUsers() {
  return db.prepare("SELECT key FROM sync_state WHERE key LIKE 'gTokens:%'").all().map(r => Number(r.key.split(':')[1]))
    .filter(id => isConnected(id) && (get('users', id) || {}).active);
}
function gStatus() { return getState(K('gStatus')) || {}; }
function setGStatus(patch) { setState(K('gStatus'), { ...gStatus(), ...patch }); }

/* ------------------------------------------------------------------ auth */

const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function startAuth() {
  if (!configured()) throw Object.assign(new Error('Google isn’t set up yet: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Netlify → Site configuration → Environment variables, then redeploy.'), { status: 400 });
  const verifier = b64url(crypto.randomBytes(48));
  const state = b64url(crypto.randomBytes(16));
  setState(K('gAuthPending'), { state, verifier, created: Date.now(), redirect: redirectUri() });
  const me = get('users', cur());
  const q = new URLSearchParams({
    client_id: config().clientId, response_type: 'code', redirect_uri: redirectUri(), scope: SCOPES, state,
    code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true'
  });
  if (me && me.email) q.set('login_hint', me.email);
  return `${AUTH_URL}?${q}`;
}

async function tokenRequest(params) {
  const { clientId, secret } = config();
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, ...params })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(j.error === 'invalid_grant' ? 'Google access has expired or was removed. Reconnect Google in Settings.' : (j.error_description || `Google sign-in failed (${res.status})`));
    e.code = j.error; throw e;
  }
  return j;
}

function saveTokens(j, account) {
  const prev = getState(K('gTokens')) || {};
  setState(K('gTokens'), {
    access_box: seal(j.access_token), refresh_box: j.refresh_token ? seal(j.refresh_token) : prev.refresh_box,
    expires_at: Date.now() + (Number(j.expires_in) || 3600) * 1000, account: account || prev.account || null,
    scope: j.scope || prev.scope || ''
  });
}

async function finishAuth(query) {
  if (query.error) throw new Error(query.error === 'access_denied' ? 'Connection was cancelled.' : (query.error_description || query.error));
  const p = getState(K('gAuthPending'));
  if (!p || p.state !== query.state || Date.now() - p.created > 20 * 60e3) throw new Error('This connection link has expired. Please try connecting again.');
  setState(K('gAuthPending'), null);
  const j = await tokenRequest({ grant_type: 'authorization_code', code: query.code, redirect_uri: p.redirect, code_verifier: p.verifier });
  const granted = String(j.scope || '').split(/\s+/);
  const lacking = [[SCOPE_GMAIL, 'read and label your Gmail'], [SCOPE_CAL, 'add events to your Google Calendar']].filter(([s]) => !granted.includes(s)).map(([, l]) => l);
  if (lacking.length) throw new Error(`Google didn’t give the CRM permission to ${lacking.join(' or ')}. Try again and tick every box on Google’s permission page.`);
  if (!j.refresh_token) throw new Error('Google didn’t return a long-lasting key. Remove the CRM under myaccount.google.com → Security → Third-party connections, then connect again.');
  saveTokens(j, null);
  const me = await gFetch('GET', USERINFO);
  saveTokens(j, { name: me.name || me.email, email: (me.email || '').toLowerCase() });
  logJob('google', `Connected as ${me.email}`);
  // Everything of theirs booked before connecting goes into their calendar now.
  db.prepare("UPDATE appointments SET sync_status = 'Pending', sync_attempts = 0 WHERE owner_id = ? AND status = 'Scheduled' AND outlook_event_id IS NULL AND start >= ?").run(cur(), U.addDays(U.today(), -1) + 'T00:00');
  await ensureLabels().catch(e => setGStatus({ lastError: 'Gmail labels: ' + e.message }));
  await syncNow({ budgetMs: 6e3 });
}

async function disconnect() {
  const t = tokens();
  if (t && t.refresh_token) await fetch(`${REVOKE_URL}?token=${encodeURIComponent(t.refresh_token)}`, { method: 'POST' }).catch(() => {});
  for (const k of ['gTokens', 'gStatus', 'gLabels', 'gAuthPending']) setState(K(k), null);
  db.prepare("UPDATE appointments SET sync_status = 'Local' WHERE owner_id = ? AND sync_status IN ('Pending','Error')").run(cur());
  logJob('google', `Disconnected (user ${cur()})`);
}

async function accessToken() {
  const t = tokens();
  if (!t || !t.refresh_token) throw new Error('Google isn’t connected');
  if (t.access_token && t.expires_at - Date.now() > 5 * 60e3) return t.access_token;
  const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  saveTokens(j);
  return j.access_token;
}

async function gFetch(method, url, body, attempt = 0) {
  const token = await accessToken();
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 2) {
    await new Promise(r => setTimeout(r, Math.min(8, Number(res.headers.get('retry-after')) || 2 ** attempt * 2) * 1000));
    return gFetch(method, url, body, attempt + 1);
  }
  if (res.status === 401 && attempt === 0) {
    const t = getState(K('gTokens')); if (t) setState(K('gTokens'), { ...t, expires_at: 0 });
    return gFetch(method, url, body, 1);
  }
  if (res.status === 204) return {};
  const text = await res.text();
  let j = {}; try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
  if (!res.ok) {
    const e = new Error((j.error && (j.error.message || j.error_description)) || `Google error ${res.status}`);
    e.status = res.status; throw e;
  }
  return j;
}

/* ---------------------------------------------------- CRM -> Google Calendar */

// Changes are marked here and sent by flush(), which the request handler awaits before saving.
function queuePush(apptId) {
  const a = apptId && get('appointments', apptId);
  if (!a || !isConnected(a.owner_id) || getSettings().calendarSync === false) return;
  db.prepare("UPDATE appointments SET sync_status = 'Pending', sync_attempts = 0 WHERE id = ? AND sync_status <> 'Pending'").run(apptId);
}
function queueCancel(apptId, message) { if (message) cancelMessages.set(apptId, message); }
function queueTodoSync() {} // tasks stay in the CRM

// Google lets the app choose the event id (letters a–v and digits), so a retried insert can't duplicate.
function eventId(a) { return `ppcrm${a.id}t${crypto.createHash('sha1').update(String(a.created_at)).digest('hex').slice(0, 12)}`; }

function eventBody(a, { newMeet = false } = {}) {
  const c = a.contact_id ? get('contacts', a.contact_id) : null;
  const lines = [];
  if (c) lines.push(`${`${c.first_name} ${c.last_name}`.trim()}${c.company ? ', ' + c.company : ''}${c.mobile ? ' · ' + c.mobile : ''}`);
  if (a.notes) lines.push('', a.notes);
  lines.push('', 'Booked in ParkPilot CRM');
  const ev = {
    summary: a.title,
    description: lines.join('\n'),
    location: a.is_remote ? '' : (a.location || ''),
    start: { dateTime: a.start + ':00', timeZone: U.TZ },
    end: { dateTime: a.end + ':00', timeZone: U.TZ },
    attendees: a.send_invite && c && c.email ? [{ email: c.email, displayName: `${c.first_name} ${c.last_name}`.trim() }] : [],
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
    extendedProperties: { private: { parkpilotApptId: String(a.id) } }
  };
  if (a.is_remote && newMeet) ev.conferenceData = { createRequest: { requestId: `pp-${a.id}-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  if (!a.is_remote) ev.conferenceData = null;
  return ev;
}

function recordEvent(a, ev) {
  update('appointments', a.id, {
    outlook_event_id: ev.id, ical_uid: ev.iCalUID || a.ical_uid, change_key: ev.etag || null,
    teams_url: a.is_remote ? (ev.hangoutLink || a.teams_url) : null,
    sync_status: 'Synced', sync_error: null, sync_attempts: 0
  }, { touch: false });
}

const evUrl = (id, invite) => `${CAL}/calendars/primary/events/${encodeURIComponent(id)}?conferenceDataVersion=1&sendUpdates=${invite ? 'all' : 'none'}`;

async function pushOne(a) {
  const invite = !!(a.send_invite && a.contact_id && (get('contacts', a.contact_id) || {}).email);
  if (a.status === 'Cancelled') {
    if (a.outlook_event_id) {
      const msg = cancelMessages.get(a.id);
      try {
        if (msg && invite) await gFetch('PATCH', evUrl(a.outlook_event_id, false), { description: `Cancelled: ${msg}` });
        await gFetch('DELETE', evUrl(a.outlook_event_id, invite));
      } catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
      cancelMessages.delete(a.id);
    }
    update('appointments', a.id, { sync_status: 'Synced', sync_error: null }, { touch: false });
    return;
  }
  if (!a.outlook_event_id) {
    const body = { id: eventId(a), ...eventBody(a, { newMeet: true }) };
    if (body.conferenceData === null) delete body.conferenceData;
    try { recordEvent(a, await gFetch('POST', `${CAL}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=${invite ? 'all' : 'none'}`, body)); }
    catch (e) {
      if (e.status !== 409) throw e; // already there from an earlier try: update it instead
      recordEvent(a, await gFetch('PATCH', evUrl(body.id, invite), eventBody(a, { newMeet: !!a.is_remote && !a.teams_url })));
    }
    return;
  }
  try { recordEvent(a, await gFetch('PATCH', evUrl(a.outlook_event_id, invite), eventBody(a, { newMeet: !!a.is_remote && !a.teams_url }))); }
  catch (e) {
    if (e.status !== 404 && e.status !== 410) throw e;
    // Deleted in Google Calendar while changed here: add it again, since the latest change was in the CRM.
    update('appointments', a.id, { outlook_event_id: null, teams_url: null }, { touch: false });
    const body = { ...eventBody(a, { newMeet: true }) };
    if (body.conferenceData === null) delete body.conferenceData;
    recordEvent(a, await gFetch('POST', `${CAL}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=${invite ? 'all' : 'none'}`, body));
  }
}

async function processPushQueue() {
  if (!isConnected(cur()) || busy) return;
  busy = true;
  try {
    const rows = db.prepare("SELECT * FROM appointments WHERE owner_id = ? AND sync_status = 'Pending' ORDER BY updated_at LIMIT 25").all(cur());
    for (const a of rows) {
      try { await pushOne(a); setGStatus({ lastPush: U.nowStamp() }); }
      catch (e) {
        const attempts = a.sync_attempts + 1;
        update('appointments', a.id, { sync_attempts: attempts, sync_error: e.message, sync_status: attempts >= 5 ? 'Error' : 'Pending' }, { touch: false });
        setGStatus({ lastError: e.message });
        if (/isn’t connected|expired or was removed/.test(e.message)) break;
      }
    }
  } finally { busy = false; }
}

/* ------------------------------------------------------------- Gmail -> CRM */

// Finds (or makes) the two labels: the one you put on leads, and the one the CRM moves them to.
async function ensureLabels() {
  const s = getSettings();
  const want = { source: (s.gmailLabel || 'CRM Leads').trim(), done: (s.gmailDoneLabel || 'CRM Imported').trim() };
  const saved = getState(K('gLabels'));
  if (saved && saved.source && saved.source.name === want.source && saved.done && saved.done.name === want.done) return saved;
  const list = (await gFetch('GET', `${GMAIL}/labels`)).labels || [];
  const out = {};
  for (const [k, name] of Object.entries(want)) {
    let l = list.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!l) l = await gFetch('POST', `${GMAIL}/labels`, { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' });
    out[k] = { name: l.name, id: l.id };
  }
  setState(K('gLabels'), out);
  return out;
}

const b64 = s => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', hellip: '…' };
function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li|tr|table)>/gi, '\n')
    .replace(/<\/t[dh]>[ \t]*/gi, '\t').replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m))
    .replace(/[  ]+/g, ' ').replace(/ *\t */g, '\t').replace(/\t+\n/g, '\n').replace(/\n[ \t]*\n[ \t\n]*/g, '\n\n').trim();
}
function bodyText(payload) {
  let plain = null, html = null;
  const walk = p => {
    if (!p) return;
    if (p.mimeType === 'text/plain' && p.body && p.body.data && plain === null && !(p.filename)) plain = b64(p.body.data);
    else if (p.mimeType === 'text/html' && p.body && p.body.data && html === null && !(p.filename)) html = b64(p.body.data);
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  if (plain && plain.trim()) return plain.replace(/\r\n/g, '\n').trim();
  return html ? htmlToText(html) : '';
}
function parseAddress(v) {
  const s = String(v || '').trim();
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(s);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  const e = /[^\s<>"]+@[^\s<>"]+/.exec(s);
  return { name: '', email: e ? e[0].toLowerCase() : '' };
}

// The useful parts of a Gmail message (format=full).
function parseMessage(msg) {
  const h = {};
  for (const x of (msg.payload && msg.payload.headers) || []) h[x.name.toLowerCase()] = x.value;
  return {
    id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds || [],
    from: parseAddress(h.from), replyTo: h['reply-to'] ? parseAddress(h['reply-to']) : null, to: h.to || '',
    subject: (h.subject || '').trim(), snippet: msg.snippet || '',
    at: msg.internalDate ? U.nowLocal(new Date(Number(msg.internalDate))) : U.nowLocal(),
    text: bodyText(msg.payload)
  };
}

const FIELDS = {
  name: ['name', 'fullname', 'yourname', 'contactname'],
  first_name: ['firstname', 'forename', 'givenname'],
  last_name: ['lastname', 'surname', 'familyname'],
  email: ['email', 'emailaddress', 'youremail', 'workemail', 'youremailaddress'],
  mobile: ['phone', 'telephone', 'mobile', 'phonenumber', 'tel', 'contactnumber', 'mobilenumber', 'telephonenumber', 'yourphone'],
  company: ['park', 'parkname', 'company', 'companyname', 'business', 'businessname', 'organisation', 'organization', 'holidaypark', 'parkgroup', 'yourpark', 'nameofpark'],
  units: ['units', 'numberofunits', 'noofunits', 'pitches', 'numberofpitches', 'parksize', 'numberofholidayhomes', 'unitcount', 'howmanyunits'],
  sites: ['numberofparks', 'noofparks', 'numberofsites', 'howmanyparks'],
  job_title: ['role', 'jobtitle', 'position', 'yourrole'],
  region: ['location', 'county', 'town', 'region', 'city', 'parklocation', 'area'],
  website: ['website', 'url', 'parkwebsite', 'web'],
  interest: ['interest', 'interestedin', 'product', 'products', 'service', 'enquirytype', 'whichproduct', 'subject', 'topic'],
  message: ['message', 'enquiry', 'inquiry', 'comments', 'comment', 'details', 'howcanwehelp', 'question', 'notes', 'yourmessage', 'additionalinformation']
};
const FIELD_OF = new Map(Object.entries(FIELDS).flatMap(([f, keys]) => keys.map(k => [k, f])));

// Reads "Label: value" lines (or table cells) from a form email.
function formFields(text) {
  const out = {}; let lastKey = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) { lastKey = lastKey === 'message' ? 'message' : null; continue; }
    const m = /^\*{0,2}([A-Za-z][A-Za-z0-9 /&()'?.-]{0,40}?)\*{0,2}\s*(?::|\t)\s*(.*)$/.exec(line);
    const f = m && FIELD_OF.get(m[1].toLowerCase().replace(/[^a-z]/g, ''));
    if (f) {
      if (out[f] === undefined || out[f] === '') out[f] = m[2].trim();
      lastKey = f; continue;
    }
    if (lastKey === 'message' && !/^(--|sent from|this e-?mail was sent)/i.test(line)) out.message = (out.message ? out.message + '\n' : '') + line;
  }
  return out;
}

function splitName(full) {
  const s = String(full || '').trim().replace(/\s+/g, ' ').replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, '');
  if (!s) return { first_name: '', last_name: '' };
  const parts = s.split(' ');
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}
const tidy = s => { s = String(s || '').trim(); return s && s === s.toLowerCase() ? s.replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : s; };
function nameFromEmail(email) {
  const local = String(email || '').split('@')[0];
  if (!local || /^(info|hello|enquiries|enquiry|sales|admin|office|reception|contact|bookings|no-?reply|mail|team)$/i.test(local)) return { first_name: '', last_name: '' };
  return splitName(tidy(local.replace(/[._-]+/g, ' ').replace(/\d+/g, '').trim()));
}
function productFrom(text) {
  const s = String(text || '').toLowerCase();
  const crm = /\bcrm\b/.test(s), ai = /\bai\b|agent|chatbot|automation/.test(s);
  if (crm && ai) return 'AI + CRM';
  if (crm) return 'ParkPilot CRM';
  if (ai) return 'ParkPilot AI';
  return null;
}
const isNoReply = e => /(^|[._-])(no-?reply|do-?not-?reply|mailer-daemon|notifications?|postmaster)@/i.test(e || '');

// Turns a parsed email into a lead. `own` lists our own email domains (their mail is never the lead).
function leadFromMessage(m, { own = [] } = {}) {
  const isOwn = e => !e || own.includes(String(e).split('@')[1]) || isNoReply(e);
  let text = m.text || '';
  // Forwarded into the inbox by one of us: the person who wrote originally is the lead.
  let fwd = null;
  if (isOwn(m.from.email)) {
    const fm = /(?:forwarded message|original message)[\s\S]{0,200}?\n\s*From:\s*([^\n]+)/i.exec(text);
    if (fm) { fwd = parseAddress(fm[1]); text = text.slice(fm.index); }
  }
  const f = formFields(text);
  const formish = ['name', 'first_name', 'email', 'mobile', 'company', 'message'].filter(k => f[k]).length >= 2;
  const emailField = f.email && /@/.test(f.email) ? parseAddress(f.email).email : '';
  const email = emailField || (fwd && !isOwn(fwd.email) && fwd.email) || (m.replyTo && !isOwn(m.replyTo.email) && m.replyTo.email) || (!isOwn(m.from.email) && m.from.email) || '';
  let name = f.first_name || f.last_name ? { first_name: tidy(f.first_name), last_name: tidy(f.last_name) } : f.name ? splitName(tidy(f.name)) : null;
  if (!name || !(name.first_name || name.last_name)) {
    const display = (fwd && fwd.email === email && fwd.name) || (m.replyTo && m.replyTo.email === email && m.replyTo.name) || (m.from.email === email && m.from.name) || '';
    name = display && !/@/.test(display) ? splitName(display) : nameFromEmail(email);
  }
  const units = f.units ? Number((String(f.units).match(/\d[\d,]*/) || [''])[0].replace(/,/g, '')) || null : null;
  const sites = f.sites ? Number((String(f.sites).match(/\d+/) || [''])[0]) || null : null;
  let message = f.message || '';
  if (!formish && !message) message = text.split(/\n(?:--\s*\n|On .{5,80} wrote:)/)[0].trim();
  return {
    first_name: name.first_name || '', last_name: name.last_name || '', email: email || null,
    mobile: f.mobile ? f.mobile.replace(/[^\d+ ()-]/g, '').trim() || null : null,
    company: f.company || null, job_title: f.job_title || null, units, sites, region: f.region || null, website: f.website || null,
    interest: productFrom(f.interest) || productFrom(m.subject) || productFrom(message) || null,
    message: message.slice(0, 4000), source: formish ? 'Website form' : 'Email', formish
  };
}

function ownDomains(userEmail) {
  const s = getSettings();
  return [...new Set([String(userEmail || '').split('@')[1], ...String(s.ownDomains || '').split(/[,;\s]+/)].map(d => (d || '').trim().toLowerCase()).filter(Boolean))];
}

// Adds one email to the CRM for `ownerId`. Returns 'created', 'updated' or 'skipped'.
function importMessage(m, ownerId, { account } = {}) {
  if (getState('gmail:' + m.id)) return 'skipped';
  const L = require('./logic');
  const owner = get('users', ownerId);
  const lead = leadFromMessage(m, { own: ownDomains(owner && owner.email) });
  const link = `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(account || (owner && owner.email) || '')}#all/${m.threadId}`;
  const subject = m.subject || '(no subject)';
  const s = getSettings();
  let result = 'created';
  tx(() => {
    let c = lead.email ? db.prepare('SELECT * FROM contacts WHERE lower(email) = ? ORDER BY id LIMIT 1').get(lead.email) : null;
    if (c) {
      result = 'updated';
      const patch = {};
      for (const k of ['first_name', 'last_name', 'mobile', 'company', 'job_title', 'units', 'sites', 'region', 'website']) if (!c[k] && lead[k]) patch[k] = lead[k];
      if (patch.mobile) patch.phone_e164 = U.normalisePhone(patch.mobile);
      if (Object.keys(patch).length) update('contacts', c.id, patch);
      if (['Dormant', 'Lost'].includes(c.lead_status) || c.type === 'Prospect') L.ensureDeal(c.id);
    } else {
      const id = insert('contacts', {
        type: 'Prospect', first_name: lead.first_name, last_name: lead.last_name, email: lead.email, mobile: lead.mobile, phone_e164: U.normalisePhone(lead.mobile),
        company: lead.company, job_title: lead.job_title, units: lead.units, sites: lead.sites, region: lead.region, website: lead.website, interest: lead.interest,
        lead_source: lead.source, lead_status: 'New', enquiry_date: m.at, owner_id: ownerId, park_id: owner ? owner.park_id : null, assigned_at: U.nowStamp()
      });
      c = get('contacts', id);
      insert('deals', { contact_id: id, stage: 'Enquiry', furthest_stage: 'Enquiry', stage_changed_at: U.nowStamp(), deal_type: lead.interest || 'Not decided yet' });
    }
    insert('interactions', { contact_id: c.id, type: 'Email', at: m.at, link,
      summary: `${result === 'created' ? 'New enquiry by email' : 'Email received'}: “${subject}”${lead.message ? '\n' + lead.message.slice(0, 1500) : m.snippet ? '\n' + m.snippet : ''}` });
    db.prepare('UPDATE contacts SET last_contact_at = CASE WHEN last_contact_at IS NULL OR last_contact_at < ? THEN ? ELSE last_contact_at END WHERE id = ?').run(m.at, m.at, c.id);
    if (s.replyTask !== false) {
      const who = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || 'enquiry';
      L.createTask({ title: `Reply to ${who}${c.company ? ' (' + c.company + ')' : ''}`, category: 'Email', priority: 'High', due_date: U.today(),
        contact_id: c.id, owner_id: c.owner_id || ownerId, auto_key: `gmail:${m.id}`, notes: `Email: ${subject}` });
    }
    setState('gmail:' + m.id, { at: U.nowStamp(), contact: c.id });
  });
  return result;
}

async function pullLeads({ budgetMs = 15e3 } = {}) {
  if (!isConnected(cur()) || gmailBusy) return { connected: isConnected(cur()) };
  gmailBusy = true;
  const counts = { created: 0, updated: 0, skipped: 0, failed: 0 };
  const deadline = Date.now() + budgetMs;
  try {
    let labels;
    try { labels = await ensureLabels(); }
    catch (e) { setGStatus({ lastError: 'Gmail: ' + e.message, lastGmailMs: Date.now() }); counts.error = e.message; return counts; }
    const account = ((getState(K('gTokens')) || {}).account || {}).email;
    let list;
    try { list = await gFetch('GET', `${GMAIL}/messages?labelIds=${encodeURIComponent(labels.source.id)}&maxResults=${MAX_PER_RUN}`); }
    catch (e) {
      if (e.status === 404) setState(K('gLabels'), null); // label deleted in Gmail: made again next time
      setGStatus({ lastError: 'Gmail: ' + e.message, lastGmailMs: Date.now() }); counts.error = e.message; return counts;
    }
    // Oldest first, so leads arrive in the order they wrote.
    for (const ref of (list.messages || []).reverse()) {
      if (Date.now() > deadline) break;
      try {
        const msg = await gFetch('GET', `${GMAIL}/messages/${ref.id}?format=full`);
        const m = parseMessage(msg);
        const r = m.labelIds.includes(labels.done.id) && getState('gmail:' + m.id) ? 'skipped' : importMessage(m, cur(), { account });
        counts[r]++;
        await gFetch('POST', `${GMAIL}/messages/${ref.id}/modify`, { addLabelIds: [labels.done.id], removeLabelIds: [labels.source.id] });
      } catch (e) { counts.failed++; setGStatus({ lastError: 'Gmail: ' + e.message }); if (/isn’t connected|expired or was removed/.test(e.message)) break; }
    }
    if (counts.created || counts.updated) require('./importer').recomputeDuplicates();
    const total = (gStatus().gmailTotal || 0) + counts.created;
    setGStatus({ lastGmail: U.nowStamp(), lastGmailMs: Date.now(), gmailTotal: total, lastGmailCounts: counts, ...(counts.failed ? {} : { lastError: null }) });
    if (counts.created || counts.updated || counts.failed) logJob('gmail', counts);
  } finally { gmailBusy = false; }
  return counts;
}

/* ------------------------------------------------------------ scheduling */

// Sends anything changed during this request to its owner's Google Calendar.
async function flush({ budgetMs = 15e3 } = {}) {
  const t0 = Date.now();
  const me = currentUserId();
  const users = connectedUsers().sort((a, b) => (b === me) - (a === me));
  for (const uid of users) {
    if (Date.now() - t0 > budgetMs) break;
    await as(uid, async () => {
      try { if (db.prepare("SELECT 1 FROM appointments WHERE owner_id = ? AND sync_status = 'Pending' LIMIT 1").get(uid)) await processPushQueue(); }
      catch (e) { setGStatus({ lastError: e.message }); }
    });
  }
}

async function syncNow({ budgetMs = 15e3 } = {}) {
  if (!isConnected(cur())) return { connected: false };
  const result = {};
  try {
    await processPushQueue();
    result.gmail = await pullLeads({ budgetMs });
  } catch (e) { setGStatus({ lastError: e.message }); result.error = e.message; }
  return result;
}

function needsSync(maxAgeMs = 5 * 60e3) {
  if (!isConnected(cur())) return false;
  const st = gStatus();
  return !st.lastGmailMs || Date.now() - st.lastGmailMs > maxAgeMs;
}

function status(uid) {
  return withUser(uid, () => {
    const t = getState(K('gTokens'));
    const st = gStatus();
    const s = getSettings();
    return {
      configured: configured(), connected: isConnected(cur()), account: t && t.account, redirectUri: redirectUri(),
      gmailLabel: s.gmailLabel || 'CRM Leads', gmailDoneLabel: s.gmailDoneLabel || 'CRM Imported',
      lastGmail: st.lastGmail || null, lastGmailCounts: st.lastGmailCounts || null, gmailTotal: st.gmailTotal || 0,
      lastPush: st.lastPush || null, lastError: st.lastError || null,
      pending: db.prepare("SELECT COUNT(*) n FROM appointments WHERE owner_id = ? AND sync_status = 'Pending'").get(cur()).n,
      errors: db.prepare("SELECT COUNT(*) n FROM appointments WHERE owner_id = ? AND sync_status = 'Error'").get(cur()).n
    };
  });
}

function retryErrors() {
  db.prepare("UPDATE appointments SET sync_status = 'Pending', sync_attempts = 0 WHERE owner_id = ? AND sync_status = 'Error'").run(cur());
}

module.exports = {
  setOrigin, startAuth, finishAuth, disconnect, isConnected, configured, queuePush, queueCancel, queueTodoSync, syncNow, pullLeads, flush, needsSync,
  status, retryErrors, gFetch, as, withUser, connectedUsers, ensureLabels, importMessage,
  // pure helpers, exported for tests
  parseMessage, leadFromMessage, formFields, htmlToText, splitName, productFrom, eventId, eventBody
};
