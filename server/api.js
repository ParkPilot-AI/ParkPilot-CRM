'use strict';
// The portal's JSON API. Every route receives the signed-in team member as `user`; access.js decides
// what they can see: executives their own leads, managers their park, group managers everything.
const { db, tx, insert, update, get, getSettings, setSetting, DEFAULT_SETTINGS, getState, exportBytes } = require('./db');
const L = require('./logic');
const U = require('./util');
const A = require('./access');
const google = require('./google');
const importer = require('./importer');
const captain = require('./captain');

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
}
function match(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(pathname);
    if (m) { const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); return { handler: r.handler, params }; }
  }
  return null;
}
const int = v => (v === undefined || v === null || v === '' ? null : Number(v));
const need = (row, what = 'Record') => { if (!row) throw L.httpError(404, `${what} not found`); return row; };
const fullName = c => c ? `${c.first_name || ''} ${c.last_name || ''}`.trim() : '';
const PERIODS = ['30', '90', '365', 'all'];

// Leads someone has chosen to look at (owner / park filters), within what they're allowed to see.
function leadScope(user, query = {}, a = 'c') {
  const base = A.contactWhere(user, a);
  const sql = [base.sql], args = [...base.args];
  if (query.owner === 'none') sql.push(`${a}.owner_id IS NULL`);
  else if (query.owner === 'me') { sql.push(`${a}.owner_id = ?`); args.push(user.id); }
  else if (query.owner) { sql.push(`${a}.owner_id = ?`); args.push(int(query.owner)); }
  if (query.park && A.isGroup(user)) { sql.push(`${a}.park_id = ?`); args.push(int(query.park)); }
  return { sql: sql.join(' AND '), args };
}
const mine = (user, a = 'c') => ({ sql: `${a}.owner_id = ?`, args: [user.id] });
// Whose tasks/diary to show: themselves unless a manager asks for someone in their team.
function whose(user, requested) { return A.ownerFor(user, requested, user.id); }
function userName(id) { const u = id && get('users', id); return u ? (u.name || u.email) : null; }

/* ------------------------------------------------------------------ meta */

function parksList() { return db.prepare('SELECT id, name FROM parks ORDER BY name').all(); }

route('GET', '/api/meta', ({ user }) => ({
  hosted: true, user: A.publicUser(user), roles: A.ROLE_LABELS,
  parks: parksList(), team: A.team(user).map(m => ({ id: m.id, name: m.name || m.email, role: m.role, park_id: m.park_id, park_name: m.park_name })),
  stages: L.STAGES, openStages: L.OPEN_STAGES, apptTypes: L.APPT_TYPES, remoteTypes: L.REMOTE_TYPES, tourTypes: L.TOUR_TYPES,
  categories: L.CATEGORIES, priorities: L.PRIORITIES, leadStatuses: L.LEAD_STATUSES, contactTypes: ['Prospect', 'Customer', 'Partner'],
  products: L.PRODUCTS, plans: L.PLANS, lostReasons: L.LOST_REASONS,
  jobTitles: ['Owner', 'Managing Director', 'General Manager', 'Sales Manager', 'Operations Manager', 'Marketing Manager', 'Other'],
  settings: getSettings(), funnelPeriod: user.funnel_period || getSettings().funnelPeriod || '90',
  today: U.today(), now: U.nowLocal(), google: google.status(user.id)
}));

/* ------------------------------------------------------------- dashboard */

function taskRows(where, args, order = 'due_date, due_time') {
  return db.prepare(`SELECT t.*, c.first_name, c.last_name, c.mobile, c.phone_e164, c.email AS contact_email, ou.name AS owner_name
                     FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id LEFT JOIN users ou ON ou.id = t.owner_id
                     WHERE ${where} ORDER BY ${order}`).all(...args);
}
const URG_ORDER = { red: 0, amber: 1, today: 2, future: 3, none: 4, done: 5 };
const PRI_ORDER = { High: 0, Medium: 1, Low: 2 };
function sortTasks(list) {
  return list.sort((a, b) => (URG_ORDER[a.urgency] - URG_ORDER[b.urgency]) || (b.days_late - a.days_late) ||
    (PRI_ORDER[a.priority] - PRI_ORDER[b.priority]) || String(a.due_time || '99').localeCompare(String(b.due_time || '99')) || a.id - b.id);
}

// "Today": the signed-in person's own day – their tasks, their diary, their leads.
route('GET', '/api/dashboard', ({ user }) => {
  L.maybeScheduledRollover();
  const s = getSettings(), day = U.today(), me = user.id;
  const open = taskRows("t.owner_id = ? AND t.status = 'Open' AND t.due_date IS NOT NULL AND t.due_date <= ?", [me, day]).map(t => L.decorateTask(t, s, day));
  const overdue = sortTasks(open.filter(t => t.urgency === 'red' || t.urgency === 'amber'));
  const dueToday = sortTasks(open.filter(t => t.urgency === 'today'));
  const doneToday = taskRows("t.owner_id = ? AND t.status = 'Done' AND substr(t.completed_at, 1, 10) = ?", [me, day], 't.completed_at DESC').map(t => L.decorateTask(t, s, day));
  const upcoming = taskRows("t.owner_id = ? AND t.status = 'Open' AND t.due_date > ? AND t.due_date <= ?", [me, day, U.addDays(day, 7)]).map(t => L.decorateTask(t, s, day));
  const appts = apptRows('a.owner_id = ? AND a.start < ? AND a.end > ? AND a.status <> ?', [me, U.addDays(day, 1) + 'T00:00', day + 'T00:00', 'Cancelled']);
  const tomorrow = apptRows('a.owner_id = ? AND a.start >= ? AND a.start < ? AND a.status = ?', [me, U.addDays(day, 1) + 'T00:00', U.addDays(day, 2) + 'T00:00', 'Scheduled']);
  const funnel = L.funnel(user.funnel_period || s.funnelPeriod || '90', mine(user));
  const monthStart = day.slice(0, 8) + '01';
  // Won this month, as new monthly recurring revenue.
  const won = db.prepare(`SELECT COALESCE(SUM(COALESCE(d.price,0)),0) v, COUNT(*) n FROM deals d JOIN contacts c ON c.id = d.contact_id
                          WHERE c.owner_id = ? AND d.stage = 'Won' AND substr(d.completed_at,1,10) >= ?`).get(me, monthStart);
  const warmCut = U.addDays(day, -7);
  const warm = db.prepare(`SELECT c.id, c.first_name, c.last_name, c.company, c.lead_source, COALESCE(c.last_contact_at, c.enquiry_date) AS last_touch, d.stage
                           FROM contacts c JOIN deals d ON d.contact_id = c.id AND d.stage IN ('Enquiry','Demo booked','Demo held','Proposal sent')
                           WHERE c.owner_id = ? AND c.lead_status IN ('New','Contacted','Nurture') AND substr(COALESCE(c.last_contact_at, c.enquiry_date, c.created_at),1,10) <= ?
                           AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.contact_id = c.id AND t.status = 'Open')
                           AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.contact_id = c.id AND a.status = 'Scheduled' AND a.start >= ?)
                           GROUP BY c.id ORDER BY last_touch DESC`).all(me, warmCut, day + 'T00:00');
  // Proposals out, oldest first: the ones to chase.
  const proposals = db.prepare(`SELECT d.id, d.contact_id, d.deal_type, d.plan, d.price, d.stage_changed_at, c.first_name, c.last_name, c.company FROM deals d
                                JOIN contacts c ON c.id = d.contact_id WHERE c.owner_id = ? AND d.stage = 'Proposal sent' ORDER BY d.stage_changed_at`).all(me);
  // New leads from Gmail and elsewhere in the last 7 days.
  const fresh = db.prepare(`SELECT c.id, c.first_name, c.last_name, c.company, c.lead_source, c.enquiry_date FROM contacts c
                            WHERE c.owner_id = ? AND c.lead_status = 'New' AND substr(COALESCE(c.enquiry_date, c.created_at),1,10) >= ? ORDER BY COALESCE(c.enquiry_date, c.created_at) DESC LIMIT 8`).all(me, U.addDays(day, -7));
  const review = apptRows('a.owner_id = ? AND a.needs_review = 1 AND a.status = ?', [me, 'Scheduled']);
  const unallocated = A.isManager(user) ? captain.unallocatedCount(user) : 0;
  const sc = A.contactWhere(user);
  const visibleCount = A.isManager(user) ? db.prepare(`SELECT COUNT(*) n FROM contacts c WHERE ${sc.sql}`).get(...sc.args).n : null;
  return {
    today: day, now: U.nowLocal(), contactCount: db.prepare('SELECT COUNT(*) n FROM contacts c WHERE c.owner_id = ?').get(me).n, overdue, dueToday, doneToday, upcoming, appts, tomorrow, funnel,
    won, warm: { count: warm.length, top: warm.slice(0, 8) }, proposals: { count: proposals.length, top: proposals.slice(0, 8), mrr: proposals.reduce((s, p) => s + (p.price || 0), 0) },
    fresh, review, rollover: getState('lastRollover'), google: google.status(me), unallocated, visibleCount
  };
});

/* ------------------------------------------------------- captain's log */

route('GET', '/api/captains-log', ({ user, query }) => {
  A.requireManager(user);
  const period = PERIODS.includes(query.period) ? query.period : (user.funnel_period || getSettings().funnelPeriod || '90');
  return captain.log(user, { period, park: A.isGroup(user) ? int(query.park) : user.park_id });
});

/* ----------------------------------------------------------------- tasks */

route('GET', '/api/tasks', ({ user, query }) => {
  const s = getSettings(), day = U.today();
  const where = [], args = [];
  const scope = query.scope || 'open';
  if (scope === 'open') where.push("t.status = 'Open'");
  else if (scope === 'done') where.push("t.status IN ('Done','Dropped')");
  if (query.contact_id) { A.contact(user, query.contact_id); where.push('t.contact_id = ?'); args.push(int(query.contact_id)); }
  else { where.push('t.owner_id = ?'); args.push(whose(user, query.user)); }
  if (query.category) { where.push('t.category = ?'); args.push(query.category); }
  const rows = taskRows(where.join(' AND '), args, scope === 'done' ? 't.completed_at DESC LIMIT 300' : `COALESCE(t.due_date, '9999'), t.due_time`)
    .map(t => L.decorateTask(t, s, day));
  return scope === 'done' ? rows : sortTasks(rows);
});
route('POST', '/api/tasks', ({ user, body }) => {
  if (body.contact_id) A.contact(user, body.contact_id);
  const id = L.createTask({ ...body, owner_id: A.ownerFor(user, body.owner_id, user.id) });
  if (body.contact_id) db.prepare('UPDATE contacts SET updated_at = ? WHERE id = ?').run(U.nowStamp(), body.contact_id);
  return get('tasks', id);
});
route('PATCH', '/api/tasks/:id', ({ user, params, body }) => {
  const t = A.task(user, params.id);
  const patch = {};
  for (const k of ['title', 'category', 'priority', 'due_time', 'notes', 'contact_id', 'deal_id']) if (k in body) patch[k] = body[k];
  if (patch.contact_id) A.contact(user, patch.contact_id);
  if ('owner_id' in body && body.owner_id) patch.owner_id = A.ownerFor(user, body.owner_id, t.owner_id);
  if ('due_date' in body && body.due_date !== t.due_date) { patch.due_date = body.due_date; patch.original_due_date = null; patch.needs_review = 0; patch.last_rolled_on = null; }
  update('tasks', t.id, patch);
  return get('tasks', t.id);
});
route('POST', '/api/tasks/:id/complete', ({ user, params, body }) => { A.task(user, params.id); L.completeTask(int(params.id), body.done !== false); return { ok: true }; });
route('POST', '/api/tasks/:id/snooze', ({ user, params, body }) => { A.task(user, params.id); return { due_date: L.snoozeTask(int(params.id), Number(body.days) || 1) }; });
route('POST', '/api/tasks/:id/review', ({ user, params, body }) => { A.task(user, params.id); L.reviewTask(int(params.id), body.action, body); return { ok: true }; });
route('DELETE', '/api/tasks/:id', ({ user, params }) => { A.task(user, params.id); L.reviewTask(int(params.id), 'drop', { reason: 'Deleted' }); return { ok: true }; });
route('POST', '/api/rollover', () => L.rollOverTasks({ reason: 'manual' }));

/* -------------------------------------------------------------- contacts */

route('GET', '/api/contacts', ({ user, query }) => {
  const sc = leadScope(user, query);
  const where = [sc.sql], args = [...sc.args];
  const q = (query.q || '').trim();
  if (q) {
    const like = `%${q.toLowerCase()}%`;
    const digits = q.replace(/\D/g, '');
    const parts = [`lower(c.first_name || ' ' || c.last_name) LIKE ?`, 'lower(c.email) LIKE ?', 'lower(c.lead_no) LIKE ?', 'lower(c.postcode) LIKE ?', 'lower(c.company) LIKE ?'];
    args.push(like, like, like, like, like);
    if (digits.length >= 4) { parts.push("replace(replace(c.mobile,' ',''),'+','') LIKE ?", 'c.phone_e164 LIKE ?'); args.push(`%${digits}%`, `%${digits.replace(/^0/, '')}%`); }
    where.push('(' + parts.join(' OR ') + ')');
  }
  if (query.status) { where.push('c.lead_status = ?'); args.push(query.status); }
  if (query.type) { where.push('c.type = ?'); args.push(query.type); }
  if (query.source) { if (query.source === '(none)') where.push('c.lead_source IS NULL'); else { where.push('c.lead_source = ?'); args.push(query.source); } }
  if (query.dups === '1') where.push('c.dup_group IS NOT NULL AND c.dup_dismissed = 0');
  if (query.stage) { where.push('EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.id AND d.stage = ?)'); args.push(query.stage); }
  if (query.interest) { where.push('c.interest = ?'); args.push(query.interest); }
  const sorts = { recent: 'COALESCE(c.enquiry_date, c.created_at) DESC', name: 'c.last_name COLLATE NOCASE, c.first_name COLLATE NOCASE', company: "COALESCE(NULLIF(c.company,''), 'zzz') COLLATE NOCASE, c.last_name COLLATE NOCASE",
    touched: 'COALESCE(c.last_contact_at, c.enquiry_date) DESC' };
  const order = sorts[query.sort] || sorts.recent;
  const w = 'WHERE ' + where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) n FROM contacts c ${w}`).get(...args).n;
  const size = Math.min(200, int(query.pageSize) || 50), page = Math.max(1, int(query.page) || 1);
  const rows = db.prepare(`SELECT c.id, c.lead_no, c.type, c.first_name, c.last_name, c.company, c.units, c.interest, c.mobile, c.phone_e164, c.email, c.lead_source, c.lead_status,
      c.enquiry_date, c.last_contact_at, c.dup_group, c.dup_dismissed, c.owner_id, c.park_id, ou.name AS owner_name, pk.name AS park_name,
      (SELECT stage FROM deals d WHERE d.contact_id = c.id ORDER BY (d.stage IN ('Won','Lost')), d.updated_at DESC LIMIT 1) AS stage,
      (SELECT COUNT(*) FROM tasks t WHERE t.contact_id = c.id AND t.status = 'Open') AS open_tasks,
      (SELECT MIN(start) FROM appointments a WHERE a.contact_id = c.id AND a.status = 'Scheduled' AND a.start >= ?) AS next_appt
    FROM contacts c LEFT JOIN users ou ON ou.id = c.owner_id LEFT JOIN parks pk ON pk.id = c.park_id ${w} ORDER BY ${order} LIMIT ? OFFSET ?`).all(U.nowLocal(), ...args, size, (page - 1) * size);
  return { total, page, pageSize: size, rows };
});

route('GET', '/api/sources', ({ user }) => {
  const sc = A.contactWhere(user);
  return db.prepare(`SELECT COALESCE(c.lead_source, '(none)') source, COUNT(*) n FROM contacts c WHERE ${sc.sql} GROUP BY c.lead_source ORDER BY n DESC`).all(...sc.args);
});

route('POST', '/api/contacts', ({ user, body }) => {
  if (!(body.first_name || body.last_name || body.company || '').trim()) throw L.httpError(400, 'Enter a name or the park’s name');
  // Executives' new leads are theirs. Managers can give a lead to someone in their team or leave it unallocated.
  let owner = user.id, park = A.parkFor(user, body.park_id);
  if (A.isManager(user) && 'owner_id' in body) {
    owner = body.owner_id ? A.ownerFor(user, body.owner_id) : null;
    const ou = owner && get('users', owner);
    if (ou && ou.park_id) park = ou.park_id;
  }
  const data = { ...body }; delete data.owner_id; delete data.park_id; delete data.lead_no; delete data.external_id; // lead numbers are issued automatically
  const id = tx(() => {
    const id = insert('contacts', { ...data, phone_e164: U.normalisePhone(body.mobile), email: body.email ? body.email.trim().toLowerCase() : null,
      enquiry_date: body.enquiry_date || U.nowLocal(), lead_status: body.lead_status || 'New', type: body.type || 'Prospect',
      consent_date: (body.consent_email || body.consent_sms || body.consent_post) ? U.today() : null,
      park_id: park, owner_id: owner, assigned_at: owner ? U.nowStamp() : null });
    insert('interactions', { contact_id: id, type: 'Note', at: U.nowLocal(), summary: `Contact created by ${user.name || user.email}${body.lead_source ? ' (source ' + body.lead_source + ')' : ''}${owner && owner !== user.id ? `, allocated to ${userName(owner)}` : !owner ? ', not yet allocated' : ''}.` });
    if (body.create_deal !== false && (body.type || 'Prospect') === 'Prospect') insert('deals', { contact_id: id, stage: 'Enquiry', furthest_stage: 'Enquiry', stage_changed_at: U.nowStamp(), deal_type: L.PRODUCTS.includes(body.interest) ? body.interest : 'Not decided yet' });
    return id;
  });
  importer.recomputeDuplicates();
  return get('contacts', id);
});

route('GET', '/api/contacts/:id', ({ user, params }) => {
  const c = A.contact(user, params.id), id = c.id;
  const s = getSettings(), day = U.today();
  const deals = db.prepare(`SELECT d.* FROM deals d WHERE d.contact_id = ? ORDER BY (d.stage IN ('Won','Lost')), d.updated_at DESC`).all(id);
  const tasks = taskRows("t.contact_id = ? AND t.status = 'Open'", [id], `COALESCE(t.due_date,'9999')`).map(t => L.decorateTask(t, s, day));
  const appts = apptRows('a.contact_id = ?', [id], 'a.start DESC');
  const timeline = db.prepare('SELECT * FROM interactions WHERE contact_id = ? ORDER BY at DESC, id DESC LIMIT 500').all(id);
  const sc = A.contactWhere(user);
  const dups = c.dup_group && !c.dup_dismissed ? db.prepare(`SELECT c.id, c.first_name, c.last_name, c.email, c.mobile, c.lead_no, c.enquiry_date FROM contacts c WHERE c.dup_group = ? AND c.id <> ? AND ${sc.sql}`).all(c.dup_group, id, ...sc.args) : [];
  const park = c.park_id ? get('parks', c.park_id) : null;
  return { contact: { ...c, owner_name: userName(c.owner_id), park_name: park ? park.name : null }, deals, tasks, appts, timeline, dups };
});

route('PATCH', '/api/contacts/:id', ({ user, params, body }) => {
  const c = A.contact(user, params.id);
  const patch = { ...body };
  if ('mobile' in body) patch.phone_e164 = U.normalisePhone(body.mobile);
  if ('email' in body && body.email) patch.email = body.email.trim().toLowerCase();
  const consentChanged = ['consent_email', 'consent_sms', 'consent_post'].some(k => k in body && !!body[k] !== !!c[k]);
  if (consentChanged) {
    patch.consent_date = U.today();
    const labels = ['consent_email', 'consent_sms', 'consent_post'].map(k => `${k.slice(8).toUpperCase()} ${(k in body ? body[k] : c[k]) ? 'yes' : 'no'}`).join(', ');
    insert('interactions', { contact_id: c.id, type: 'Note', at: U.nowLocal(), summary: `Marketing consent updated: ${labels}.` });
  }
  for (const k of ['external_id', 'dup_group', 'owner_id', 'park_id', 'assigned_at', 'lead_no']) delete patch[k]; // allocation has its own route; lead numbers never change
  update('contacts', c.id, patch);
  if ('email' in body || 'mobile' in body) importer.recomputeDuplicates();
  return get('contacts', c.id);
});
route('DELETE', '/api/contacts/:id', ({ user, params }) => {
  const c = A.contact(user, params.id);
  db.prepare('DELETE FROM contacts WHERE id = ?').run(c.id);
  if (c.external_id) db.prepare('INSERT OR IGNORE INTO sync_state(key, value) VALUES(?, ?)').run('merged:' + c.external_id, '0');
  importer.recomputeDuplicates();
  return { ok: true };
});
route('POST', '/api/contacts/:id/notes', ({ user, params, body }) => {
  const c = A.contact(user, params.id);
  const id = L.addInteraction({ contact_id: c.id, deal_id: body.deal_id, type: body.type || 'Note', summary: body.summary });
  return db.prepare('SELECT * FROM interactions WHERE id = ?').get(id);
});
route('DELETE', '/api/interactions/:id', ({ user, params }) => {
  const i = need(db.prepare('SELECT * FROM interactions WHERE id = ?').get(int(params.id)), 'Note');
  A.contact(user, i.contact_id);
  db.prepare("DELETE FROM interactions WHERE id = ? AND type IN ('Note','Call','Email','SMS')").run(i.id);
  return { ok: true };
});
route('POST', '/api/contacts/:id/call', ({ user, params, body }) => {
  const c = A.contact(user, params.id);
  if (body.task_id) A.task(user, body.task_id);
  return L.logCall(c.id, { outcome: body.outcome, notes: body.notes, taskId: int(body.task_id), followUpDays: int(body.follow_up_days) });
});

// Hands leads to someone (or back to the unallocated list). Managers and group managers only.
route('POST', '/api/contacts/assign', ({ user, body }) => {
  A.requireManager(user);
  const ids = [...new Set((body.ids || []).map(Number).filter(Boolean))];
  if (!ids.length) throw L.httpError(400, 'Choose at least one contact');
  if (ids.length > 5000) throw L.httpError(400, 'Too many at once');
  const owner = body.owner_id ? A.ownerFor(user, body.owner_id) : null;
  let park = null;
  if (owner) park = (get('users', owner) || {}).park_id || null;
  else if (body.park_id && A.isGroup(user)) park = A.parkFor(user, body.park_id);
  const contacts = ids.map(id => A.contact(user, id));
  return L.assignContacts(contacts, owner, park, user);
});

route('GET', '/api/duplicates', ({ user }) => {
  A.requireManager(user);
  const sc = A.contactWhere(user);
  const rows = db.prepare(`SELECT c.id, c.first_name, c.last_name, c.email, c.mobile, c.lead_no, c.lead_source, c.enquiry_date, c.dup_group, ou.name AS owner_name,
      (SELECT COUNT(*) FROM interactions i WHERE i.contact_id = c.id) AS activity,
      (SELECT stage FROM deals d WHERE d.contact_id = c.id ORDER BY d.updated_at DESC LIMIT 1) AS stage
    FROM contacts c LEFT JOIN users ou ON ou.id = c.owner_id WHERE c.dup_group IS NOT NULL AND c.dup_dismissed = 0 AND ${sc.sql} ORDER BY c.dup_group, c.enquiry_date DESC`).all(...sc.args);
  const groups = {};
  for (const r of rows) (groups[r.dup_group] = groups[r.dup_group] || []).push(r);
  return Object.entries(groups).filter(([, v]) => v.length > 1).map(([group, members]) => ({ group, members }));
});
route('POST', '/api/duplicates/merge', ({ user, body }) => {
  A.requireManager(user);
  const keep = A.contact(user, body.keep);
  const others = (body.others || []).map(id => A.contact(user, id).id);
  L.mergeContacts(keep.id, others);
  return { ok: true };
});
route('POST', '/api/duplicates/dismiss', ({ user, body }) => {
  A.requireManager(user);
  const sc = A.contactWhere(user);
  db.prepare(`UPDATE contacts SET dup_dismissed = 1 WHERE dup_group = ? AND id IN (SELECT c.id FROM contacts c WHERE ${sc.sql})`).run(body.group, ...sc.args);
  return { ok: true };
});

/* ----------------------------------------------------------------- deals */

route('GET', '/api/funnel', ({ user, query }) => {
  const period = PERIODS.includes(query.period) ? query.period : (user.funnel_period || getSettings().funnelPeriod || '90');
  if (query.remember === '1' && user.funnel_period !== period) update('users', user.id, { funnel_period: period }, { touch: false });
  return L.funnel(period, query.mine === '1' ? mine(user) : leadScope(user, query));
});

route('GET', '/api/deals', ({ user, query }) => {
  const stages = query.stage ? [query.stage] : L.STAGES;
  const sc = leadScope(user, query);
  const out = {};
  for (const st of stages) {
    const limit = st === 'Lost' || st === 'Won' ? 40 : 200;
    const agg = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(COALESCE(d.price,0)),0) v FROM deals d JOIN contacts c ON c.id = d.contact_id
                            WHERE d.stage = ? AND ${sc.sql}`).get(st, ...sc.args);
    out[st] = {
      count: agg.n, value: agg.v,
      rows: db.prepare(`SELECT d.*, c.first_name, c.last_name, c.company, c.units, c.lead_source, c.type AS contact_type, c.owner_id, ou.name AS owner_name,
          (SELECT MIN(start) FROM appointments a WHERE a.deal_id = d.id AND a.status = 'Scheduled' AND a.start >= ?) AS next_appt
        FROM deals d JOIN contacts c ON c.id = d.contact_id LEFT JOIN users ou ON ou.id = c.owner_id
        WHERE d.stage = ? AND ${sc.sql} ORDER BY d.stage_changed_at DESC LIMIT ?`).all(U.nowLocal(), st, ...sc.args, limit)
    };
  }
  return out;
});
route('POST', '/api/deals', ({ user, body }) => {
  const c = A.contact(user, body.contact_id);
  const product = L.PRODUCTS.includes(body.deal_type) ? body.deal_type : (L.PRODUCTS.includes(c.interest) ? c.interest : 'Not decided yet');
  const data = { ...body }; for (const k of ['stage', 'furthest_stage', 'reserved_at', 'completed_at', 'stage_changed_at']) delete data[k];
  const id = insert('deals', { ...data, contact_id: c.id, stage: 'Enquiry', furthest_stage: 'Enquiry', stage_changed_at: U.nowStamp(), deal_type: product });
  insert('interactions', { contact_id: c.id, deal_id: id, type: 'Deal', at: U.nowLocal(), summary: `New deal opened (${product}${body.plan ? ' ' + body.plan : ''}).` });
  if (c.lead_status === 'Dormant' || c.lead_status === 'Lost') update('contacts', c.id, { lead_status: 'Contacted' });
  return get('deals', id);
});
route('PATCH', '/api/deals/:id', ({ user, params, body }) => {
  const d = A.deal(user, params.id);
  const patch = { ...body }; for (const k of ['stage', 'furthest_stage', 'contact_id', 'reserved_at', 'completed_at', 'stage_changed_at']) delete patch[k];
  update('deals', d.id, patch);
  return get('deals', d.id);
});
route('POST', '/api/deals/:id/stage', ({ user, params, body }) => { A.deal(user, params.id); L.setDealStage(int(params.id), body.stage, { lostReason: body.lostReason }); return get('deals', int(params.id)); });
route('DELETE', '/api/deals/:id', ({ user, params }) => { A.deal(user, params.id); db.prepare('DELETE FROM deals WHERE id = ?').run(int(params.id)); return { ok: true }; });

/* ---------------------------------------------------------- appointments */

function apptRows(where, args, order = 'a.start') {
  return db.prepare(`SELECT a.*, c.first_name, c.last_name, c.mobile, c.email AS contact_email, c.company, c.units, c.current_systems,
      d.stage AS deal_stage, d.price AS deal_price, d.deal_type AS deal_product, d.plan AS deal_plan, ou.name AS owner_name,
      (SELECT summary FROM interactions i WHERE i.contact_id = a.contact_id AND i.type IN ('Note','Call','Meeting','Email') ORDER BY i.at DESC LIMIT 1) AS last_note
    FROM appointments a LEFT JOIN contacts c ON c.id = a.contact_id LEFT JOIN deals d ON d.id = a.deal_id
    LEFT JOIN users ou ON ou.id = a.owner_id
    WHERE ${where} ORDER BY ${order}`).all(...args);
}
// A diary: the signed-in person's, or (for managers) someone's in their team.
route('GET', '/api/appointments', ({ user, query }) => {
  const who = whose(user, query.user);
  const from = (query.from || U.today()) + 'T00:00', to = U.addDays(query.to || U.addDays(U.today(), 7), 1) + 'T00:00';
  const appts = apptRows("a.owner_id = ? AND a.end > ? AND a.start < ? AND (a.status <> 'Cancelled' OR ? = '1')", [who, from, to, query.cancelled || '0']);
  return { appts, user: who, googleConnected: google.isConnected(who) };
});
route('GET', '/api/appointments/:id', ({ user, params }) => { A.appointment(user, params.id); return apptRows('a.id = ?', [int(params.id)])[0]; });
route('POST', '/api/appointments', ({ user, body }) => {
  const c = body.contact_id ? A.contact(user, body.contact_id) : null;
  if (body.deal_id) A.deal(user, body.deal_id);
  const owner = A.ownerFor(user, body.owner_id, user.id);
  void c;
  return apptRows('a.id = ?', [L.createAppointment({ ...body, owner_id: owner })])[0];
});
route('PATCH', '/api/appointments/:id', ({ user, params, body }) => {
  A.appointment(user, params.id);
  if (body.contact_id) A.contact(user, body.contact_id);
  if (body.deal_id) A.deal(user, body.deal_id);
  L.updateAppointment(int(params.id), body);
  return apptRows('a.id = ?', [int(params.id)])[0];
});
route('POST', '/api/appointments/:id/cancel', ({ user, params, body }) => { A.appointment(user, params.id); L.cancelAppointment(int(params.id), { message: body.message }); return { ok: true }; });
route('POST', '/api/appointments/:id/outcome', ({ user, params, body }) => {
  A.appointment(user, params.id);
  L.recordOutcome(int(params.id), body); return { ok: true };
});
route('POST', '/api/appointments/:id/confirm', ({ user, params }) => { A.appointment(user, params.id); update('appointments', int(params.id), { needs_review: 0, conflict_note: null }, { touch: false }); return { ok: true }; });
route('GET', '/api/slots', ({ user, query }) => {
  let owner = whose(user, query.owner);
  if (query.exclude) owner = A.appointment(user, query.exclude).owner_id || owner;
  return L.suggestSlots({ type: query.type, from: query.from, excludeApptId: int(query.exclude), duration: int(query.duration), days: int(query.days) || 14, ownerId: owner });
});

/* ---------------------------------------------------------------- search */

route('GET', '/api/search', ({ user, query }) => {
  const q = (query.q || '').trim();
  if (q.length < 2) return { contacts: [] };
  const like = `%${q.toLowerCase()}%`, digits = q.replace(/\D/g, '');
  const sc = A.contactWhere(user);
  const contacts = db.prepare(`SELECT c.id, c.first_name, c.last_name, c.company, c.mobile, c.email, c.lead_no, c.type, c.lead_status, c.owner_id, ou.name AS owner_name FROM contacts c
    LEFT JOIN users ou ON ou.id = c.owner_id
    WHERE (lower(c.first_name || ' ' || c.last_name) LIKE ? OR lower(c.email) LIKE ? OR lower(c.lead_no) LIKE ? OR lower(c.company) LIKE ?
    ${digits.length >= 4 ? "OR replace(replace(c.mobile,' ',''),'+','') LIKE ? OR c.phone_e164 LIKE ?" : ''}) AND ${sc.sql}
    ORDER BY (lower(c.first_name || ' ' || c.last_name) LIKE ? OR lower(c.company) LIKE ?) DESC, COALESCE(c.last_contact_at, c.enquiry_date) DESC LIMIT 12`)
    .all(like, like, like, like, ...(digits.length >= 4 ? [`%${digits}%`, `%${digits.replace(/^0/, '')}%`] : []), ...sc.args, q.toLowerCase() + '%', q.toLowerCase() + '%');
  return { contacts };
});

/* -------------------------------------------------------------- settings */

route('GET', '/api/settings', ({ user }) => ({ settings: getSettings(), google: google.status(user.id), user: A.publicUser(user), hosted: true }));
route('PUT', '/api/settings', ({ user, body }) => {
  A.requireManager(user);
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in body) setSetting(k, body[k]);
  if ('gmailLabel' in body || 'gmailDoneLabel' in body) db.prepare("DELETE FROM sync_state WHERE key LIKE 'gLabels:%'").run(); // looked up again next time
  return { settings: getSettings() };
});

route('POST', '/api/import', ({ user, raw, headers }) => {
  A.requireManager(user);
  if (!raw || !raw.length) throw L.httpError(400, 'No file received');
  const name = decodeURIComponent(headers['x-filename'] || 'import.xlsx');
  // With one person on the team, imported leads are theirs; otherwise they land unallocated, ready to hand out.
  const solo = A.team(user).length <= 1;
  return importer.importFile(raw, name, { parkId: A.parkFor(user, headers['x-park']), ownerId: solo ? user.id : null });
});

route('GET', '/api/jobs', ({ user }) => { A.requireManager(user); return db.prepare('SELECT * FROM job_log ORDER BY id DESC LIMIT 30').all(); });

route('GET', '/api/export/contacts.csv', ({ user, query }) => {
  A.requireManager(user);
  const sc = leadScope(user, query);
  const rows = db.prepare(`SELECT c.lead_no, c.type, c.first_name, c.last_name, c.job_title, c.company, c.units, c.sites, c.region, c.website, c.interest, c.current_systems,
    c.mobile, c.email, c.postcode, c.lead_source, c.lead_status, c.enquiry_date, c.last_contact_at, c.consent_email, c.consent_sms, c.consent_post, ou.name AS owner,
    (SELECT stage FROM deals d WHERE d.contact_id = c.id ORDER BY d.updated_at DESC LIMIT 1) AS stage,
    (SELECT price FROM deals d WHERE d.contact_id = c.id ORDER BY d.updated_at DESC LIMIT 1) AS monthly_value
    FROM contacts c LEFT JOIN users ou ON ou.id = c.owner_id WHERE ${sc.sql} ORDER BY c.company, c.last_name, c.first_name`).all(...sc.args);
  const cols = ['lead_no', 'type', 'first_name', 'last_name', 'job_title', 'company', 'units', 'sites', 'region', 'website', 'interest', 'current_systems', 'mobile', 'email', 'postcode',
    'lead_source', 'lead_status', 'stage', 'monthly_value', 'owner', 'enquiry_date', 'last_contact_at', 'consent_email', 'consent_sms', 'consent_post'];
  const esc = v => v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const csv = '﻿' + [cols.join(','), ...rows.map(r => cols.map(k => esc(r[k])).join(','))].join('\r\n');
  return raw(200, csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="parkpilot-leads-${U.today()}.csv"` });
});

route('GET', '/api/backup', ({ user }) => {
  A.requireGroup(user);
  return raw(200, Buffer.from(exportBytes()), { 'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="parkpilot-crm-${U.nowStamp().replace(/[:T]/g, '-')}.db"` });
});

/* ------------------------------------------------------------ team/parks */

function teamView(user) {
  const day = U.today();
  return A.team(user, { includeInactive: true }).map(m => ({
    ...m, roleLabel: A.ROLE_LABELS[m.role],
    leads: db.prepare("SELECT COUNT(*) n FROM contacts WHERE owner_id = ? AND lead_status NOT IN ('Lost','Customer','Dormant')").get(m.id).n,
    overdue: db.prepare("SELECT COUNT(*) n FROM tasks WHERE owner_id = ? AND status = 'Open' AND due_date < ?").get(m.id, day).n,
    google: google.isConnected(m.id),
    canEdit: canManage(user, m), isMe: m.id === user.id
  }));
}
// Managers look after the executives at their park; group managers look after everyone.
function canManage(user, target) {
  if (A.isGroup(user)) return true;
  return user.role === 'manager' && target.role === 'exec' && target.park_id === user.park_id;
}

route('GET', '/api/team', ({ user }) => {
  A.requireManager(user);
  const parks = db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM users u WHERE u.park_id = p.id AND u.active = 1) AS people,
      (SELECT COUNT(*) FROM contacts c WHERE c.park_id = p.id) AS leads FROM parks p ORDER BY p.name`).all();
  return { people: teamView(user), parks: A.isGroup(user) ? parks : parks.filter(p => p.id === user.park_id), roles: A.ROLE_LABELS };
});

function checkPerson(user, body, existing) {
  const role = body.role || (existing && existing.role) || 'exec';
  if (!A.ROLES.includes(role)) throw L.httpError(400, 'Choose a role');
  if (!A.isGroup(user) && role !== 'exec') throw L.httpError(403, 'Sales managers can add sales executives. Ask an admin to add managers.');
  let park = 'park_id' in body ? int(body.park_id) : existing ? existing.park_id : null;
  if (!A.isGroup(user)) park = user.park_id;
  if (role !== 'group' && !park) throw L.httpError(400, 'Choose which team they work in');
  if (park && !get('parks', park)) throw L.httpError(400, 'Choose which team they work in');
  return { role, park_id: park };
}

route('POST', '/api/users', ({ user, body }) => {
  A.requireManager(user);
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw L.httpError(400, 'Enter their work email address');
  const existing = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email);
  const { role, park_id } = checkPerson(user, body, null);
  if (existing) {
    if (existing.active) throw L.httpError(400, `${email} is already on the team`);
    if (!canManage(user, { ...existing, park_id: existing.park_id || park_id })) throw L.httpError(403, 'Ask an admin to restore this person.');
    update('users', existing.id, { active: 1, role, park_id, name: (body.name || '').trim() || existing.name });
    return get('users', existing.id);
  }
  const id = insert('users', { email, name: (body.name || '').trim() || email, role, park_id, active: 1 });
  require('./db').logJob('team', `${user.email} added ${email} as ${A.ROLE_LABELS[role]}`);
  return get('users', id);
});

route('PATCH', '/api/users/:id', ({ user, params, body }) => {
  A.requireManager(user);
  const t = need(get('users', int(params.id)), 'Person');
  if (!canManage(user, t)) throw L.httpError(403, 'You can’t change this person.');
  const patch = {};
  if ('name' in body) patch.name = String(body.name || '').trim() || t.email;
  if ('role' in body || 'park_id' in body) Object.assign(patch, checkPerson(user, body, t));
  if (t.id === user.id && patch.role && patch.role !== t.role) throw L.httpError(400, 'You can’t change your own role.');
  if (A.owners().includes(t.email.toLowerCase()) && patch.role && patch.role !== 'group') throw L.httpError(400, 'This person is a CRM owner (OWNER_EMAILS) and is always an admin.');
  update('users', t.id, patch);
  return get('users', t.id);
});

// Removes someone's access. Their leads go to another person or back to the unallocated list.
route('POST', '/api/users/:id/remove', ({ user, params, body }) => {
  A.requireManager(user);
  const t = need(get('users', int(params.id)), 'Person');
  if (!canManage(user, t)) throw L.httpError(403, 'You can’t remove this person.');
  if (t.id === user.id) throw L.httpError(400, 'You can’t remove yourself.');
  if (A.owners().includes(t.email.toLowerCase())) throw L.httpError(400, 'This person is a CRM owner (OWNER_EMAILS). Remove them there first.');
  const to = body.transfer_to ? A.ownerFor(user, body.transfer_to) : null;
  if (to === t.id) throw L.httpError(400, 'Choose someone else to take their leads.');
  const leads = db.prepare('SELECT * FROM contacts WHERE owner_id = ?').all(t.id);
  const moved = leads.length ? L.assignContacts(leads, to, to ? (get('users', to) || {}).park_id : null, user).moved : 0;
  // Their other open tasks (not about a lead) go with the leads, or to the person removing them.
  db.prepare("UPDATE tasks SET owner_id = ? WHERE owner_id = ? AND status = 'Open'").run(to || user.id, t.id);
  update('users', t.id, { active: 0 });
  require('./db').logJob('team', `${user.email} removed ${t.email}; ${moved} leads ${to ? 'to ' + userName(to) : 'unallocated'}`);
  return { ok: true, moved };
});

route('POST', '/api/parks', ({ user, body }) => {
  A.requireGroup(user);
  const name = String(body.name || '').trim();
  if (!name) throw L.httpError(400, 'Enter the park’s name');
  if (db.prepare('SELECT 1 FROM parks WHERE lower(name) = lower(?)').get(name)) throw L.httpError(400, 'There is already a park with that name');
  return get('parks', insert('parks', { name }));
});
route('PATCH', '/api/parks/:id', ({ user, params, body }) => {
  A.requireGroup(user);
  const p = need(get('parks', int(params.id)), 'Park');
  const name = String(body.name || '').trim();
  if (!name) throw L.httpError(400, 'Enter the park’s name');
  update('parks', p.id, { name });
  return get('parks', p.id);
});

/* ---------------------------------------------------------------- google */

route('GET', '/api/google/status', ({ user }) => google.status(user.id));
route('POST', '/api/google/sync', ({ user }) => google.as(user.id, async () => ({ result: await google.syncNow({ budgetMs: 8e3 }), status: google.status() })));
route('POST', '/api/google/disconnect', ({ user }) => google.as(user.id, async () => { await google.disconnect(); return google.status(); }));
route('GET', '/api/google/start', ({ user }) => google.withUser(user.id, () => raw(302, '', { Location: google.startAuth() })));
route('GET', '/api/google/callback', ({ user, query }) => google.as(user.id, async () => {
  try { await google.finishAuth(query); return raw(302, '', { Location: '/#/settings?connected=1' }); }
  catch (e) { return raw(200, page('Could not connect Google', e.message), { 'Content-Type': 'text/html; charset=utf-8' }); }
}));
route('POST', '/api/google/retry', ({ user }) => google.withUser(user.id, () => { google.retryErrors(); return google.status(); }));
route('GET', '/api/me', ({ user }) => ({ user: A.publicUser(user), contacts: db.prepare('SELECT COUNT(*) n FROM contacts WHERE owner_id = ?').get(user.id).n }));

function raw(status, body, headers = {}) { return { __raw: true, status, body, headers }; }
function page(title, message) {
  const e = t => String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><html lang="en-GB"><meta charset="utf-8"><title>${e(title)} – ParkPilot CRM</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="icon" type="image/png" href="/img/favicon.png"><link rel="stylesheet" href="/css/page.css">
  <body class="plain"><div class="box"><span class="wordmark"><img src="/img/mark.png" alt=""><span class="wm">ParkPilot</span><span class="crm">CRM</span></span>
  <h2 class="err">${e(title)}</h2><p>${e(message)}</p><p><a class="btn" href="/#/settings">Back to Settings</a></p></div></body></html>`;
}

module.exports = { match, fullName, raw, page };
