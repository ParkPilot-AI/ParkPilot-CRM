'use strict';
// The portal's JSON API. Every route receives the signed-in team member as `user`; access.js decides
// what they can see: executives their own leads, managers their park, group managers everything.
const { db, tx, insert, update, get, getSettings, setSetting, DEFAULT_SETTINGS, getState, exportBytes } = require('./db');
const L = require('./logic');
const U = require('./util');
const A = require('./access');
const graph = require('./graph');
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
  stages: L.STAGES, openStages: L.OPEN_STAGES, apptTypes: L.APPT_TYPES, categories: L.CATEGORIES, priorities: L.PRIORITIES,
  leadStatuses: L.LEAD_STATUSES, contactTypes: ['Prospect', 'Owner', 'Partner'],
  dealTypes: ['New sale', 'Upgrade with part-ex', 'Upgrade, no part-ex', 'Pre-owned sale'], paymentStatuses: L.PAYMENT_STATUSES,
  homeStatuses: ['Available', 'Reserved', 'Sold', 'Owner-held', 'Part-ex in'], plotStatuses: ['Vacant', 'Reserved', 'Occupied'],
  settings: getSettings(), funnelPeriod: user.funnel_period || getSettings().funnelPeriod || '90',
  today: U.today(), now: U.nowLocal(), outlook: graph.status(user.id)
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
  const reserved = db.prepare(`SELECT COALESCE(SUM(COALESCE(d.price,0) - COALESCE(d.part_ex_allowance,0)),0) v, COUNT(*) n FROM deals d JOIN contacts c ON c.id = d.contact_id
                               WHERE c.owner_id = ? AND d.stage IN ('Finance & Paperwork','Siting & Handover','Completed') AND substr(d.reserved_at,1,10) >= ?`).get(me, monthStart);
  const warmCut = U.addDays(day, -7);
  const warm = db.prepare(`SELECT c.id, c.first_name, c.last_name, c.lead_source, COALESCE(c.last_contact_at, c.enquiry_date) AS last_touch, d.stage
                           FROM contacts c JOIN deals d ON d.contact_id = c.id AND d.stage IN ('Enquiry','Appointment','Park Tour')
                           WHERE c.owner_id = ? AND c.lead_status IN ('New','Contacted','Nurture') AND substr(COALESCE(c.last_contact_at, c.enquiry_date, c.created_at),1,10) <= ?
                           AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.contact_id = c.id AND t.status = 'Open')
                           AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.contact_id = c.id AND a.status = 'Scheduled' AND a.start >= ?)
                           GROUP BY c.id ORDER BY last_touch DESC`).all(me, warmCut, day + 'T00:00');
  const ageLimit = Number(day.slice(0, 4)) - 12;
  const upgrades = db.prepare(`SELECT h.*, c.first_name, c.last_name, c.id AS contact_id, p.plot_number FROM homes h
                               JOIN contacts c ON c.id = h.owner_contact_id LEFT JOIN plots p ON p.id = h.plot_id
                               WHERE c.owner_id = ? AND h.status = 'Owner-held' AND ((h.licence_expiry IS NOT NULL AND h.licence_expiry <= ?) OR (h.year IS NOT NULL AND h.year <= ?))
                               AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.id AND d.stage NOT IN ('Completed','Lost'))
                               ORDER BY COALESCE(h.licence_expiry, '9999')`).all(me, U.addDays(day, 90), ageLimit);
  const review = apptRows('a.owner_id = ? AND a.needs_review = 1 AND a.status = ?', [me, 'Scheduled']);
  const unallocated = A.isManager(user) ? captain.unallocatedCount(user) : 0;
  const sc = A.contactWhere(user);
  const visibleCount = A.isManager(user) ? db.prepare(`SELECT COUNT(*) n FROM contacts c WHERE ${sc.sql}`).get(...sc.args).n : null;
  return {
    today: day, now: U.nowLocal(), contactCount: db.prepare('SELECT COUNT(*) n FROM contacts c WHERE c.owner_id = ?').get(me).n, overdue, dueToday, doneToday, upcoming, appts, tomorrow, funnel,
    reserved, warm: { count: warm.length, top: warm.slice(0, 8) }, upgrades: { count: upgrades.length, top: upgrades.slice(0, 8) },
    review, rollover: getState('lastRollover'), outlook: graph.status(me), unallocated, visibleCount
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
    const parts = [`lower(c.first_name || ' ' || c.last_name) LIKE ?`, 'lower(c.email) LIKE ?', 'lower(c.lead_no) LIKE ?', 'lower(c.postcode) LIKE ?'];
    args.push(like, like, like, like);
    if (digits.length >= 4) { parts.push("replace(replace(c.mobile,' ',''),'+','') LIKE ?", 'c.phone_e164 LIKE ?'); args.push(`%${digits}%`, `%${digits.replace(/^0/, '')}%`); }
    where.push('(' + parts.join(' OR ') + ')');
  }
  if (query.status) { where.push('c.lead_status = ?'); args.push(query.status); }
  if (query.type) { where.push('c.type = ?'); args.push(query.type); }
  if (query.source) { if (query.source === '(none)') where.push('c.lead_source IS NULL'); else { where.push('c.lead_source = ?'); args.push(query.source); } }
  if (query.dups === '1') where.push('c.dup_group IS NOT NULL AND c.dup_dismissed = 0');
  if (query.stage) { where.push('EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.id AND d.stage = ?)'); args.push(query.stage); }
  const sorts = { recent: 'COALESCE(c.enquiry_date, c.created_at) DESC', name: 'c.last_name COLLATE NOCASE, c.first_name COLLATE NOCASE',
    touched: 'COALESCE(c.last_contact_at, c.enquiry_date) DESC' };
  const order = sorts[query.sort] || sorts.recent;
  const w = 'WHERE ' + where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) n FROM contacts c ${w}`).get(...args).n;
  const size = Math.min(200, int(query.pageSize) || 50), page = Math.max(1, int(query.page) || 1);
  const rows = db.prepare(`SELECT c.id, c.lead_no, c.type, c.first_name, c.last_name, c.mobile, c.phone_e164, c.email, c.lead_source, c.lead_status,
      c.enquiry_date, c.last_contact_at, c.dup_group, c.dup_dismissed, c.owner_id, c.park_id, ou.name AS owner_name, pk.name AS park_name,
      (SELECT stage FROM deals d WHERE d.contact_id = c.id ORDER BY (d.stage IN ('Completed','Lost')), d.updated_at DESC LIMIT 1) AS stage,
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
  if (!(body.first_name || body.last_name || '').trim()) throw L.httpError(400, 'Enter a name');
  // Executives' new leads are theirs. Managers can give a lead to someone in their team or leave it unallocated.
  let owner = user.id, park = A.parkFor(user, body.park_id);
  if (A.isManager(user) && 'owner_id' in body) {
    owner = body.owner_id ? A.ownerFor(user, body.owner_id) : null;
    const ou = owner && get('users', owner);
    if (ou && ou.park_id) park = ou.park_id;
  }
  const data = { ...body }; delete data.owner_id; delete data.park_id;
  const id = tx(() => {
    const id = insert('contacts', { ...data, phone_e164: U.normalisePhone(body.mobile), email: body.email ? body.email.trim().toLowerCase() : null,
      enquiry_date: body.enquiry_date || U.nowLocal(), lead_status: body.lead_status || 'New', type: body.type || 'Prospect',
      consent_date: (body.consent_email || body.consent_sms || body.consent_post) ? U.today() : null,
      park_id: park, owner_id: owner, assigned_at: owner ? U.nowStamp() : null });
    insert('interactions', { contact_id: id, type: 'Note', at: U.nowLocal(), summary: `Contact created by ${user.name || user.email}${body.lead_source ? ' (source ' + body.lead_source + ')' : ''}${owner && owner !== user.id ? `, allocated to ${userName(owner)}` : !owner ? ', not yet allocated' : ''}.` });
    if (body.create_deal !== false && (body.type || 'Prospect') === 'Prospect') insert('deals', { contact_id: id, stage: 'Enquiry', stage_changed_at: U.nowStamp() });
    return id;
  });
  importer.recomputeDuplicates();
  return get('contacts', id);
});

route('GET', '/api/contacts/:id', ({ user, params }) => {
  const c = A.contact(user, params.id), id = c.id;
  const s = getSettings(), day = U.today();
  const deals = db.prepare(`SELECT d.*, h.make, h.model, h.year AS home_year, h.price AS home_price, p.plot_number FROM deals d
                            LEFT JOIN homes h ON h.id = d.home_id LEFT JOIN plots p ON p.id = d.plot_id WHERE d.contact_id = ?
                            ORDER BY (d.stage IN ('Completed','Lost')), d.updated_at DESC`).all(id);
  for (const d of deals) d.valuations = db.prepare(`SELECT v.*, h.make, h.model, h.year FROM valuations v LEFT JOIN homes h ON h.id = v.home_id WHERE v.deal_id = ? ORDER BY v.created_at DESC`).all(d.id);
  const tasks = taskRows("t.contact_id = ? AND t.status = 'Open'", [id], `COALESCE(t.due_date,'9999')`).map(t => L.decorateTask(t, s, day));
  const appts = apptRows('a.contact_id = ?', [id], 'a.start DESC');
  const timeline = db.prepare('SELECT * FROM interactions WHERE contact_id = ? ORDER BY at DESC, id DESC LIMIT 500').all(id);
  const homes = db.prepare('SELECT h.*, p.plot_number FROM homes h LEFT JOIN plots p ON p.id = h.plot_id WHERE h.owner_contact_id = ?').all(id);
  const sc = A.contactWhere(user);
  const dups = c.dup_group && !c.dup_dismissed ? db.prepare(`SELECT c.id, c.first_name, c.last_name, c.email, c.mobile, c.lead_no, c.enquiry_date FROM contacts c WHERE c.dup_group = ? AND c.id <> ? AND ${sc.sql}`).all(c.dup_group, id, ...sc.args) : [];
  const park = c.park_id ? get('parks', c.park_id) : null;
  return { contact: { ...c, owner_name: userName(c.owner_id), park_name: park ? park.name : null }, deals, tasks, appts, timeline, homes, dups };
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
  for (const k of ['external_id', 'dup_group', 'owner_id', 'park_id', 'assigned_at']) delete patch[k]; // allocation has its own route
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
    const limit = st === 'Enquiry' || st === 'Lost' || st === 'Completed' ? 40 : 200;
    const agg = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(COALESCE(d.price,0) - COALESCE(d.part_ex_allowance,0)),0) v FROM deals d JOIN contacts c ON c.id = d.contact_id
                            WHERE d.stage = ? AND ${sc.sql}`).get(st, ...sc.args);
    out[st] = {
      count: agg.n, value: agg.v,
      rows: db.prepare(`SELECT d.*, c.first_name, c.last_name, c.lead_source, c.type AS contact_type, c.owner_id, ou.name AS owner_name, h.make, h.model, p.plot_number,
          (SELECT MIN(start) FROM appointments a WHERE a.deal_id = d.id AND a.status = 'Scheduled' AND a.start >= ?) AS next_appt
        FROM deals d JOIN contacts c ON c.id = d.contact_id LEFT JOIN users ou ON ou.id = c.owner_id LEFT JOIN homes h ON h.id = d.home_id LEFT JOIN plots p ON p.id = d.plot_id
        WHERE d.stage = ? AND ${sc.sql} ORDER BY d.stage_changed_at DESC LIMIT ?`).all(U.nowLocal(), st, ...sc.args, limit)
    };
  }
  return out;
});
route('POST', '/api/deals', ({ user, body }) => {
  const c = A.contact(user, body.contact_id);
  const id = insert('deals', { ...body, contact_id: c.id, stage: 'Enquiry', stage_changed_at: U.nowStamp(),
    deal_type: body.deal_type || (c.type === 'Owner' ? 'Upgrade with part-ex' : 'New sale') });
  insert('interactions', { contact_id: c.id, deal_id: id, type: 'Deal', at: U.nowLocal(), summary: `New deal opened (${body.deal_type || (c.type === 'Owner' ? 'Upgrade with part-ex' : 'New sale')}).` });
  if (c.lead_status === 'Dormant' || c.lead_status === 'Lost') update('contacts', c.id, { lead_status: 'Contacted' });
  return get('deals', id);
});
route('PATCH', '/api/deals/:id', ({ user, params, body }) => {
  const d = A.deal(user, params.id);
  const patch = { ...body }; delete patch.stage; delete patch.contact_id; delete patch.reserved_at; delete patch.completed_at;
  if (patch.home_id) A.stockRow(user, 'homes', patch.home_id);
  if (patch.plot_id) A.stockRow(user, 'plots', patch.plot_id);
  update('deals', d.id, patch);
  if ('payment_status' in body && body.payment_status !== d.payment_status) L.paymentRecorded(d.id, body.payment_status);
  return get('deals', d.id);
});
route('POST', '/api/deals/:id/stage', ({ user, params, body }) => { A.deal(user, params.id); L.setDealStage(int(params.id), body.stage, { lostReason: body.lostReason }); return get('deals', int(params.id)); });
route('DELETE', '/api/deals/:id', ({ user, params }) => { A.deal(user, params.id); db.prepare('DELETE FROM deals WHERE id = ?').run(int(params.id)); return { ok: true }; });

route('POST', '/api/deals/:id/valuations', ({ user, params, body }) => {
  const d = A.deal(user, params.id);
  if (body.home_id) A.stockRow(user, 'homes', body.home_id);
  const id = tx(() => {
    const id = insert('valuations', { ...body, deal_id: d.id });
    if (body.offered_value) update('deals', d.id, { part_ex_allowance: body.offered_value, deal_type: d.deal_type === 'New sale' ? 'Upgrade with part-ex' : d.deal_type });
    insert('interactions', { contact_id: d.contact_id, deal_id: d.id, type: 'Deal', at: U.nowLocal(),
      summary: `Part-ex valuation recorded${body.offered_value ? ': £' + Number(body.offered_value).toLocaleString('en-GB') : ''}${body.valid_until ? ', valid until ' + body.valid_until : ''}.` });
    return id;
  });
  return db.prepare('SELECT * FROM valuations WHERE id = ?').get(id);
});
route('DELETE', '/api/valuations/:id', ({ user, params }) => {
  const v = need(db.prepare('SELECT * FROM valuations WHERE id = ?').get(int(params.id)), 'Valuation');
  A.deal(user, v.deal_id);
  db.prepare('DELETE FROM valuations WHERE id = ?').run(v.id);
  return { ok: true };
});

/* ----------------------------------------------------------- homes/plots */

route('GET', '/api/homes', ({ user, query }) => {
  const sc = A.parkWhere(user, 'h');
  const extra = query.park && A.isGroup(user) ? ' AND h.park_id = ' + int(query.park) : '';
  return db.prepare(`SELECT h.*, p.plot_number, c.first_name, c.last_name, pk.name AS park_name FROM homes h
    LEFT JOIN plots p ON p.id = h.plot_id LEFT JOIN contacts c ON c.id = h.owner_contact_id LEFT JOIN parks pk ON pk.id = h.park_id
    WHERE ${sc.sql}${extra} ORDER BY h.status, h.make, h.model`).all(...sc.args);
});
route('POST', '/api/homes', ({ user, body }) => get('homes', insert('homes', { ...body, park_id: A.parkFor(user, body.park_id) })));
route('PATCH', '/api/homes/:id', ({ user, params, body }) => { A.stockRow(user, 'homes', params.id); const b = { ...body }; if (!A.isGroup(user)) delete b.park_id; update('homes', int(params.id), b); return get('homes', int(params.id)); });
route('DELETE', '/api/homes/:id', ({ user, params }) => { A.stockRow(user, 'homes', params.id); db.prepare('DELETE FROM homes WHERE id = ?').run(int(params.id)); return { ok: true }; });
route('GET', '/api/plots', ({ user, query }) => {
  const sc = A.parkWhere(user, 'p');
  const extra = query.park && A.isGroup(user) ? ' AND p.park_id = ' + int(query.park) : '';
  return db.prepare(`SELECT p.*, pk.name AS park_name, (SELECT h.make || ' ' || COALESCE(h.model,'') FROM homes h WHERE h.plot_id = p.id LIMIT 1) AS home
    FROM plots p LEFT JOIN parks pk ON pk.id = p.park_id WHERE ${sc.sql}${extra} ORDER BY pk.name, CAST(p.plot_number AS INTEGER), p.plot_number`).all(...sc.args);
});
route('POST', '/api/plots', ({ user, body }) => { if (!body.plot_number) throw L.httpError(400, 'Enter a plot number'); return get('plots', insert('plots', { ...body, park_id: A.parkFor(user, body.park_id) })); });
route('PATCH', '/api/plots/:id', ({ user, params, body }) => { A.stockRow(user, 'plots', params.id); const b = { ...body }; if (!A.isGroup(user)) delete b.park_id; update('plots', int(params.id), b); return get('plots', int(params.id)); });
route('DELETE', '/api/plots/:id', ({ user, params }) => { A.stockRow(user, 'plots', params.id); db.prepare('DELETE FROM plots WHERE id = ?').run(int(params.id)); return { ok: true }; });

/* ---------------------------------------------------------- appointments */

function apptRows(where, args, order = 'a.start') {
  return db.prepare(`SELECT a.*, c.first_name, c.last_name, c.mobile, c.email AS contact_email, d.stage AS deal_stage, d.price AS deal_price,
      h.make, h.model, h.year AS home_year, ou.name AS owner_name,
      (SELECT summary FROM interactions i WHERE i.contact_id = a.contact_id AND i.type IN ('Note','Call','Meeting') ORDER BY i.at DESC LIMIT 1) AS last_note,
      (SELECT offered_value FROM valuations v WHERE v.deal_id = a.deal_id ORDER BY v.created_at DESC LIMIT 1) AS px_value,
      c.budget
    FROM appointments a LEFT JOIN contacts c ON c.id = a.contact_id LEFT JOIN deals d ON d.id = a.deal_id LEFT JOIN homes h ON h.id = a.home_id
    LEFT JOIN users ou ON ou.id = a.owner_id
    WHERE ${where} ORDER BY ${order}`).all(...args);
}
// A diary: the signed-in person's, or (for managers) someone's in their team.
route('GET', '/api/appointments', ({ user, query }) => {
  const who = whose(user, query.user);
  const from = (query.from || U.today()) + 'T00:00', to = U.addDays(query.to || U.addDays(U.today(), 7), 1) + 'T00:00';
  const appts = apptRows("a.owner_id = ? AND a.end > ? AND a.start < ? AND (a.status <> 'Cancelled' OR ? = '1')", [who, from, to, query.cancelled || '0']);
  const outlook = query.outlook === '1' ? db.prepare(`SELECT id, subject, start, end, is_all_day, show_as FROM outlook_events
      WHERE user_id = ? AND appointment_id IS NULL AND COALESCE(is_cancelled,0) = 0 AND end > ? AND start < ? ORDER BY start`).all(who, from, to) : [];
  return { appts, outlook, user: who, outlookConnected: graph.isConnected(who) };
});
route('GET', '/api/appointments/:id', ({ user, params }) => { A.appointment(user, params.id); return apptRows('a.id = ?', [int(params.id)])[0]; });
route('POST', '/api/appointments', ({ user, body }) => {
  const c = body.contact_id ? A.contact(user, body.contact_id) : null;
  if (body.deal_id) A.deal(user, body.deal_id);
  if (body.home_id) A.stockRow(user, 'homes', body.home_id);
  const owner = A.ownerFor(user, body.owner_id, user.id);
  void c;
  return apptRows('a.id = ?', [L.createAppointment({ ...body, owner_id: owner })])[0];
});
route('PATCH', '/api/appointments/:id', ({ user, params, body }) => {
  A.appointment(user, params.id);
  if (body.contact_id) A.contact(user, body.contact_id);
  if (body.deal_id) A.deal(user, body.deal_id);
  if (body.home_id) A.stockRow(user, 'homes', body.home_id);
  L.updateAppointment(int(params.id), body);
  return apptRows('a.id = ?', [int(params.id)])[0];
});
route('POST', '/api/appointments/:id/cancel', ({ user, params, body }) => { A.appointment(user, params.id); L.cancelAppointment(int(params.id), { message: body.message }); return { ok: true }; });
route('POST', '/api/appointments/:id/outcome', ({ user, params, body }) => {
  A.appointment(user, params.id);
  if (body.home_id) A.stockRow(user, 'homes', body.home_id);
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
  if (q.length < 2) return { contacts: [], plots: [] };
  const like = `%${q.toLowerCase()}%`, digits = q.replace(/\D/g, '');
  const sc = A.contactWhere(user), ps = A.parkWhere(user, 'p');
  const contacts = db.prepare(`SELECT c.id, c.first_name, c.last_name, c.mobile, c.email, c.lead_no, c.type, c.lead_status, c.owner_id, ou.name AS owner_name FROM contacts c
    LEFT JOIN users ou ON ou.id = c.owner_id
    WHERE (lower(c.first_name || ' ' || c.last_name) LIKE ? OR lower(c.email) LIKE ? OR lower(c.lead_no) LIKE ?
    ${digits.length >= 4 ? "OR replace(replace(c.mobile,' ',''),'+','') LIKE ? OR c.phone_e164 LIKE ?" : ''}) AND ${sc.sql}
    ORDER BY (lower(c.first_name || ' ' || c.last_name) LIKE ?) DESC, COALESCE(c.last_contact_at, c.enquiry_date) DESC LIMIT 12`)
    .all(like, like, like, ...(digits.length >= 4 ? [`%${digits}%`, `%${digits.replace(/^0/, '')}%`] : []), ...sc.args, q.toLowerCase() + '%');
  const plots = db.prepare(`SELECT p.id, p.plot_number, p.area, p.status FROM plots p WHERE (lower(p.plot_number) LIKE ? OR lower('plot ' || p.plot_number) LIKE ?) AND ${ps.sql} LIMIT 5`).all(like, like, ...ps.args);
  return { contacts, plots };
});

/* -------------------------------------------------------------- settings */

route('GET', '/api/settings', ({ user }) => ({ settings: getSettings(), outlook: graph.status(user.id), user: A.publicUser(user), hosted: true }));
route('PUT', '/api/settings', ({ user, body }) => {
  A.requireManager(user);
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in body) setSetting(k, body[k]);
  return { settings: getSettings() };
});

route('POST', '/api/import', ({ user, raw, headers }) => {
  A.requireManager(user);
  if (!raw || !raw.length) throw L.httpError(400, 'No file received');
  const name = decodeURIComponent(headers['x-filename'] || 'import.xlsx');
  // Imported leads land unallocated at the chosen park (a manager's own park), ready to hand out.
  return importer.importFile(raw, name, { parkId: A.parkFor(user, headers['x-park']) });
});

route('GET', '/api/jobs', ({ user }) => { A.requireManager(user); return db.prepare('SELECT * FROM job_log ORDER BY id DESC LIMIT 30').all(); });

route('GET', '/api/export/contacts.csv', ({ user, query }) => {
  A.requireManager(user);
  const sc = leadScope(user, query);
  const rows = db.prepare(`SELECT c.lead_no, c.type, c.first_name, c.last_name, c.mobile, c.email, c.postcode, c.lead_source, c.lead_status,
    c.enquiry_date, c.last_contact_at, c.consent_email, c.consent_sms, c.consent_post, pk.name AS park, ou.name AS owner,
    (SELECT stage FROM deals d WHERE d.contact_id = c.id ORDER BY d.updated_at DESC LIMIT 1) AS stage
    FROM contacts c LEFT JOIN parks pk ON pk.id = c.park_id LEFT JOIN users ou ON ou.id = c.owner_id WHERE ${sc.sql} ORDER BY c.last_name, c.first_name`).all(...sc.args);
  const cols = ['lead_no', 'type', 'first_name', 'last_name', 'mobile', 'email', 'postcode', 'lead_source', 'lead_status', 'stage', 'park', 'owner', 'enquiry_date', 'last_contact_at', 'consent_email', 'consent_sms', 'consent_post'];
  const esc = v => v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const csv = '﻿' + [cols.join(','), ...rows.map(r => cols.map(k => esc(r[k])).join(','))].join('\r\n');
  return raw(200, csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="coastfields-contacts-${U.today()}.csv"` });
});

route('GET', '/api/backup', ({ user }) => {
  A.requireGroup(user);
  return raw(200, Buffer.from(exportBytes()), { 'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="coastfields-${U.nowStamp().replace(/[:T]/g, '-')}.db"` });
});

/* ------------------------------------------------------------ team/parks */

function teamView(user) {
  const day = U.today();
  return A.team(user, { includeInactive: true }).map(m => ({
    ...m, roleLabel: A.ROLE_LABELS[m.role],
    leads: db.prepare("SELECT COUNT(*) n FROM contacts WHERE owner_id = ? AND lead_status NOT IN ('Lost','Customer','Dormant')").get(m.id).n,
    overdue: db.prepare("SELECT COUNT(*) n FROM tasks WHERE owner_id = ? AND status = 'Open' AND due_date < ?").get(m.id, day).n,
    outlook: graph.isConnected(m.id),
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
  if (!A.isGroup(user) && role !== 'exec') throw L.httpError(403, 'Sales managers can add sales executives. Ask a group sales manager to add managers.');
  let park = 'park_id' in body ? int(body.park_id) : existing ? existing.park_id : null;
  if (!A.isGroup(user)) park = user.park_id;
  if (role !== 'group' && !park) throw L.httpError(400, 'Choose which park they work at');
  if (park && !get('parks', park)) throw L.httpError(400, 'Choose which park they work at');
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
    if (!canManage(user, { ...existing, park_id: existing.park_id || park_id })) throw L.httpError(403, 'Ask a group sales manager to restore this person.');
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
  if (A.owners().includes(t.email.toLowerCase()) && patch.role && patch.role !== 'group') throw L.httpError(400, 'This person is a portal owner (OWNER_EMAILS) and is always a group sales manager.');
  update('users', t.id, patch);
  return get('users', t.id);
});

// Removes someone's access. Their leads go to another person or back to the unallocated list.
route('POST', '/api/users/:id/remove', ({ user, params, body }) => {
  A.requireManager(user);
  const t = need(get('users', int(params.id)), 'Person');
  if (!canManage(user, t)) throw L.httpError(403, 'You can’t remove this person.');
  if (t.id === user.id) throw L.httpError(400, 'You can’t remove yourself.');
  if (A.owners().includes(t.email.toLowerCase())) throw L.httpError(400, 'This person is a portal owner (OWNER_EMAILS). Remove them there first.');
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

/* --------------------------------------------------------------- outlook */

route('GET', '/api/outlook/status', ({ user }) => graph.status(user.id));
route('POST', '/api/outlook/sync', ({ user }) => graph.as(user.id, async () => ({ result: await graph.syncNow({ budgetMs: 6e3 }), status: graph.status() })));
route('POST', '/api/outlook/disconnect', ({ user }) => graph.as(user.id, async () => { await graph.disconnect(); return graph.status(); }));
route('GET', '/api/auth/start', ({ user }) => graph.withUser(user.id, () => raw(302, '', { Location: graph.startAuth() })));
route('GET', '/api/auth/callback', ({ user, query }) => graph.as(user.id, async () => {
  try { await graph.finishAuth(query); return raw(302, '', { Location: '/#/settings?connected=1' }); }
  catch (e) { return raw(200, page('Could not connect to Outlook', e.message), { 'Content-Type': 'text/html; charset=utf-8' }); }
}));
route('GET', '/api/me', ({ user }) => ({ user: A.publicUser(user), contacts: db.prepare('SELECT COUNT(*) n FROM contacts WHERE owner_id = ?').get(user.id).n }));
route('POST', '/api/outlook/retry', ({ user }) => graph.withUser(user.id, () => { graph.retryErrors(); return graph.status(); }));

function raw(status, body, headers = {}) { return { __raw: true, status, body, headers }; }
function page(title, message) {
  const e = t => String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><meta charset="utf-8"><title>${e(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <body style="font-family:system-ui,sans-serif;background:#eef3f6;display:grid;place-items:center;min-height:100vh;margin:0">
  <div style="background:#fff;padding:32px 36px;border-radius:14px;max-width:460px"><img src="/img/logo.png" alt="Coastfields" style="height:36px">
  <h2 style="margin:20px 0 8px;color:#b42318">${e(title)}</h2><p style="color:#555;line-height:1.5">${e(message)}</p><p><a href="/#/settings" style="color:#2f7fbf">Back to the portal</a></p></div></body>`;
}

module.exports = { match, fullName, raw, page };
