'use strict';
const { db, tx, insert, update, get, getSettings, setSetting, DEFAULT_SETTINGS, getState, exportBytes } = require('./db');
const L = require('./logic');
const U = require('./util');
const graph = require('./graph');
const importer = require('./importer');

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

/* ------------------------------------------------------------------ meta */

route('GET', '/api/meta', ({ user }) => ({
  hosted: true, user,
  stages: L.STAGES, openStages: L.OPEN_STAGES, apptTypes: L.APPT_TYPES, categories: L.CATEGORIES, priorities: L.PRIORITIES,
  leadStatuses: L.LEAD_STATUSES, contactTypes: ['Prospect', 'Owner', 'Partner'],
  dealTypes: ['New sale', 'Upgrade with part-ex', 'Upgrade, no part-ex', 'Pre-owned sale'], paymentStatuses: L.PAYMENT_STATUSES,
  homeStatuses: ['Available', 'Reserved', 'Sold', 'Owner-held', 'Part-ex in'], plotStatuses: ['Vacant', 'Reserved', 'Occupied'],
  settings: getSettings(), today: U.today(), now: U.nowLocal(), outlook: graph.status()
}));

/* ------------------------------------------------------------- dashboard */

function taskRows(where, args, order = 'due_date, due_time') {
  return db.prepare(`SELECT t.*, c.first_name, c.last_name, c.mobile, c.phone_e164, c.email AS contact_email
                     FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id WHERE ${where} ORDER BY ${order}`).all(...args);
}
const URG_ORDER = { red: 0, amber: 1, today: 2, future: 3, none: 4, done: 5 };
const PRI_ORDER = { High: 0, Medium: 1, Low: 2 };
function sortTasks(list) {
  return list.sort((a, b) => (URG_ORDER[a.urgency] - URG_ORDER[b.urgency]) || (b.days_late - a.days_late) ||
    (PRI_ORDER[a.priority] - PRI_ORDER[b.priority]) || String(a.due_time || '99').localeCompare(String(b.due_time || '99')) || a.id - b.id);
}

route('GET', '/api/dashboard', () => {
  L.maybeScheduledRollover();
  const s = getSettings(), day = U.today();
  const open = taskRows("t.status = 'Open' AND t.due_date IS NOT NULL AND t.due_date <= ?", [day]).map(t => L.decorateTask(t, s, day));
  const overdue = sortTasks(open.filter(t => t.urgency === 'red' || t.urgency === 'amber'));
  const dueToday = sortTasks(open.filter(t => t.urgency === 'today'));
  const doneToday = taskRows("t.status = 'Done' AND substr(t.completed_at, 1, 10) = ?", [day], 't.completed_at DESC').map(t => L.decorateTask(t, s, day));
  const upcoming = taskRows("t.status = 'Open' AND t.due_date > ? AND t.due_date <= ?", [day, U.addDays(day, 7)]).map(t => L.decorateTask(t, s, day));
  const appts = apptRows('a.start < ? AND a.end > ? AND a.status <> ?', [U.addDays(day, 1) + 'T00:00', day + 'T00:00', 'Cancelled']);
  const tomorrow = apptRows('a.start >= ? AND a.start < ? AND a.status = ?', [U.addDays(day, 1) + 'T00:00', U.addDays(day, 2) + 'T00:00', 'Scheduled']);
  const funnel = L.funnel(getSettings().funnelPeriod || '90');
  const monthStart = day.slice(0, 8) + '01';
  const reserved = db.prepare(`SELECT COALESCE(SUM(COALESCE(price,0) - COALESCE(part_ex_allowance,0)),0) v, COUNT(*) n FROM deals
                               WHERE stage IN ('Finance & Paperwork','Siting & Handover','Completed') AND substr(stage_changed_at,1,10) >= ?`).get(monthStart);
  const warmCut = U.addDays(day, -7);
  const warm = db.prepare(`SELECT c.id, c.first_name, c.last_name, c.lead_source, COALESCE(c.last_contact_at, c.enquiry_date) AS last_touch, d.stage
                           FROM contacts c JOIN deals d ON d.contact_id = c.id AND d.stage IN ('Enquiry','Appointment','Park Tour')
                           WHERE c.lead_status IN ('New','Contacted','Nurture') AND substr(COALESCE(c.last_contact_at, c.enquiry_date, c.created_at),1,10) <= ?
                           AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.contact_id = c.id AND t.status = 'Open')
                           AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.contact_id = c.id AND a.status = 'Scheduled' AND a.start >= ?)
                           GROUP BY c.id ORDER BY last_touch DESC`).all(warmCut, day + 'T00:00');
  const ageLimit = Number(day.slice(0, 4)) - 12;
  const upgrades = db.prepare(`SELECT h.*, c.first_name, c.last_name, c.id AS contact_id, p.plot_number FROM homes h
                               JOIN contacts c ON c.id = h.owner_contact_id LEFT JOIN plots p ON p.id = h.plot_id
                               WHERE h.status = 'Owner-held' AND ((h.licence_expiry IS NOT NULL AND h.licence_expiry <= ?) OR (h.year IS NOT NULL AND h.year <= ?))
                               AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.id AND d.stage NOT IN ('Completed','Lost'))
                               ORDER BY COALESCE(h.licence_expiry, '9999')`).all(U.addDays(day, 90), ageLimit);
  const review = apptRows('a.needs_review = 1 AND a.status = ?', ['Scheduled']);
  return {
    today: day, now: U.nowLocal(), contactCount: db.prepare('SELECT COUNT(*) n FROM contacts').get().n, overdue, dueToday, doneToday, upcoming, appts, tomorrow, funnel,
    reserved, warm: { count: warm.length, top: warm.slice(0, 8) }, upgrades: { count: upgrades.length, top: upgrades.slice(0, 8) },
    review, rollover: getState('lastRollover'), outlook: graph.status()
  };
});

/* ----------------------------------------------------------------- tasks */

route('GET', '/api/tasks', ({ query }) => {
  const s = getSettings(), day = U.today();
  const where = [], args = [];
  const scope = query.scope || 'open';
  if (scope === 'open') where.push("t.status = 'Open'");
  else if (scope === 'done') where.push("t.status IN ('Done','Dropped')");
  if (query.contact_id) { where.push('t.contact_id = ?'); args.push(int(query.contact_id)); }
  if (query.category) { where.push('t.category = ?'); args.push(query.category); }
  const rows = taskRows(where.join(' AND ') || '1', args, scope === 'done' ? 't.completed_at DESC LIMIT 300' : `COALESCE(t.due_date, '9999'), t.due_time`)
    .map(t => L.decorateTask(t, s, day));
  return scope === 'done' ? rows : sortTasks(rows);
});
route('POST', '/api/tasks', ({ body }) => {
  const id = L.createTask(body);
  if (body.contact_id) db.prepare('UPDATE contacts SET updated_at = ? WHERE id = ?').run(U.nowStamp(), body.contact_id);
  return get('tasks', id);
});
route('PATCH', '/api/tasks/:id', ({ params, body }) => {
  const t = need(get('tasks', int(params.id)), 'Task');
  const patch = {};
  for (const k of ['title', 'category', 'priority', 'due_time', 'notes', 'contact_id', 'deal_id']) if (k in body) patch[k] = body[k];
  if ('due_date' in body && body.due_date !== t.due_date) { patch.due_date = body.due_date; patch.original_due_date = null; patch.needs_review = 0; patch.last_rolled_on = null; }
  update('tasks', t.id, patch);
  graph.queueTodoSync();
  return get('tasks', t.id);
});
route('POST', '/api/tasks/:id/complete', ({ params, body }) => { L.completeTask(int(params.id), body.done !== false); return { ok: true }; });
route('POST', '/api/tasks/:id/snooze', ({ params, body }) => ({ due_date: L.snoozeTask(int(params.id), Number(body.days) || 1) }));
route('POST', '/api/tasks/:id/review', ({ params, body }) => { L.reviewTask(int(params.id), body.action, body); return { ok: true }; });
route('DELETE', '/api/tasks/:id', ({ params }) => { L.reviewTask(int(params.id), 'drop', { reason: 'Deleted' }); return { ok: true }; });
route('POST', '/api/rollover', () => L.rollOverTasks({ reason: 'manual' }));

/* -------------------------------------------------------------- contacts */

route('GET', '/api/contacts', ({ query }) => {
  const where = [], args = [];
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
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM contacts c ${w}`).get(...args).n;
  const size = Math.min(200, int(query.pageSize) || 50), page = Math.max(1, int(query.page) || 1);
  const rows = db.prepare(`SELECT c.id, c.lead_no, c.type, c.first_name, c.last_name, c.mobile, c.phone_e164, c.email, c.lead_source, c.lead_status,
      c.enquiry_date, c.last_contact_at, c.dup_group, c.dup_dismissed,
      (SELECT stage FROM deals d WHERE d.contact_id = c.id ORDER BY (d.stage IN ('Completed','Lost')), d.updated_at DESC LIMIT 1) AS stage,
      (SELECT COUNT(*) FROM tasks t WHERE t.contact_id = c.id AND t.status = 'Open') AS open_tasks,
      (SELECT MIN(start) FROM appointments a WHERE a.contact_id = c.id AND a.status = 'Scheduled' AND a.start >= ?) AS next_appt
    FROM contacts c ${w} ORDER BY ${order} LIMIT ? OFFSET ?`).all(U.nowLocal(), ...args, size, (page - 1) * size);
  return { total, page, pageSize: size, rows };
});

route('GET', '/api/sources', () => db.prepare('SELECT COALESCE(lead_source, \'(none)\') source, COUNT(*) n FROM contacts GROUP BY lead_source ORDER BY n DESC').all());

route('POST', '/api/contacts', ({ body }) => {
  if (!(body.first_name || body.last_name || '').trim()) throw L.httpError(400, 'Enter a name');
  const id = tx(() => {
    const id = insert('contacts', { ...body, phone_e164: U.normalisePhone(body.mobile), email: body.email ? body.email.trim().toLowerCase() : null,
      enquiry_date: body.enquiry_date || U.nowLocal(), lead_status: body.lead_status || 'New', type: body.type || 'Prospect',
      consent_date: (body.consent_email || body.consent_sms || body.consent_post) ? U.today() : null });
    insert('interactions', { contact_id: id, type: 'Note', at: U.nowLocal(), summary: `Contact created${body.lead_source ? ' (source ' + body.lead_source + ')' : ''}.` });
    if (body.create_deal !== false && (body.type || 'Prospect') === 'Prospect') insert('deals', { contact_id: id, stage: 'Enquiry', stage_changed_at: U.nowStamp() });
    return id;
  });
  importer.recomputeDuplicates();
  return get('contacts', id);
});

route('GET', '/api/contacts/:id', ({ params }) => {
  const id = int(params.id);
  const c = need(get('contacts', id), 'Contact');
  const s = getSettings(), day = U.today();
  const deals = db.prepare(`SELECT d.*, h.make, h.model, h.year AS home_year, h.price AS home_price, p.plot_number FROM deals d
                            LEFT JOIN homes h ON h.id = d.home_id LEFT JOIN plots p ON p.id = d.plot_id WHERE d.contact_id = ?
                            ORDER BY (d.stage IN ('Completed','Lost')), d.updated_at DESC`).all(id);
  for (const d of deals) d.valuations = db.prepare(`SELECT v.*, h.make, h.model, h.year FROM valuations v LEFT JOIN homes h ON h.id = v.home_id WHERE v.deal_id = ? ORDER BY v.created_at DESC`).all(d.id);
  const tasks = taskRows("t.contact_id = ? AND t.status = 'Open'", [id], `COALESCE(t.due_date,'9999')`).map(t => L.decorateTask(t, s, day));
  const appts = apptRows('a.contact_id = ?', [id], 'a.start DESC');
  const timeline = db.prepare('SELECT * FROM interactions WHERE contact_id = ? ORDER BY at DESC, id DESC LIMIT 500').all(id);
  const homes = db.prepare('SELECT h.*, p.plot_number FROM homes h LEFT JOIN plots p ON p.id = h.plot_id WHERE h.owner_contact_id = ?').all(id);
  const dups = c.dup_group && !c.dup_dismissed ? db.prepare('SELECT id, first_name, last_name, email, mobile, lead_no, enquiry_date FROM contacts WHERE dup_group = ? AND id <> ?').all(c.dup_group, id) : [];
  return { contact: c, deals, tasks, appts, timeline, homes, dups };
});

route('PATCH', '/api/contacts/:id', ({ params, body }) => {
  const c = need(get('contacts', int(params.id)), 'Contact');
  const patch = { ...body };
  if ('mobile' in body) patch.phone_e164 = U.normalisePhone(body.mobile);
  if ('email' in body && body.email) patch.email = body.email.trim().toLowerCase();
  const consentChanged = ['consent_email', 'consent_sms', 'consent_post'].some(k => k in body && !!body[k] !== !!c[k]);
  if (consentChanged) {
    patch.consent_date = U.today();
    const labels = ['consent_email', 'consent_sms', 'consent_post'].map(k => `${k.slice(8).toUpperCase()} ${(k in body ? body[k] : c[k]) ? 'yes' : 'no'}`).join(', ');
    insert('interactions', { contact_id: c.id, type: 'Note', at: U.nowLocal(), summary: `Marketing consent updated: ${labels}.` });
  }
  delete patch.external_id; delete patch.dup_group;
  update('contacts', c.id, patch);
  if ('email' in body || 'mobile' in body) importer.recomputeDuplicates();
  return get('contacts', c.id);
});
route('DELETE', '/api/contacts/:id', ({ params }) => {
  const c = need(get('contacts', int(params.id)), 'Contact');
  db.prepare('DELETE FROM contacts WHERE id = ?').run(c.id);
  if (c.external_id) db.prepare('INSERT OR IGNORE INTO sync_state(key, value) VALUES(?, ?)').run('merged:' + c.external_id, '0');
  importer.recomputeDuplicates();
  return { ok: true };
});
route('POST', '/api/contacts/:id/notes', ({ params, body }) => {
  const c = need(get('contacts', int(params.id)), 'Contact');
  const id = L.addInteraction({ contact_id: c.id, deal_id: body.deal_id, type: body.type || 'Note', summary: body.summary });
  return db.prepare('SELECT * FROM interactions WHERE id = ?').get(id);
});
route('DELETE', '/api/interactions/:id', ({ params }) => { db.prepare("DELETE FROM interactions WHERE id = ? AND type IN ('Note','Call','Email','SMS')").run(int(params.id)); return { ok: true }; });
route('POST', '/api/contacts/:id/call', ({ params, body }) => {
  const c = need(get('contacts', int(params.id)), 'Contact');
  return L.logCall(c.id, { outcome: body.outcome, notes: body.notes, taskId: int(body.task_id), followUpDays: int(body.follow_up_days) });
});

route('GET', '/api/duplicates', () => {
  const rows = db.prepare(`SELECT id, first_name, last_name, email, mobile, lead_no, lead_source, enquiry_date, dup_group,
      (SELECT COUNT(*) FROM interactions i WHERE i.contact_id = c.id) AS activity,
      (SELECT stage FROM deals d WHERE d.contact_id = c.id ORDER BY d.updated_at DESC LIMIT 1) AS stage
    FROM contacts c WHERE dup_group IS NOT NULL AND dup_dismissed = 0 ORDER BY dup_group, enquiry_date DESC`).all();
  const groups = {};
  for (const r of rows) (groups[r.dup_group] = groups[r.dup_group] || []).push(r);
  return Object.entries(groups).filter(([, v]) => v.length > 1).map(([group, members]) => ({ group, members }));
});
route('POST', '/api/duplicates/merge', ({ body }) => { L.mergeContacts(int(body.keep), (body.others || []).map(Number)); return { ok: true }; });
route('POST', '/api/duplicates/dismiss', ({ body }) => { db.prepare('UPDATE contacts SET dup_dismissed = 1 WHERE dup_group = ?').run(body.group); return { ok: true }; });

/* ----------------------------------------------------------------- deals */

route('GET', '/api/funnel', ({ query }) => {
  const period = ['30', '90', '365', 'all'].includes(query.period) ? query.period : (getSettings().funnelPeriod || '90');
  if (query.remember === '1' && getSettings().funnelPeriod !== period) setSetting('funnelPeriod', period);
  return L.funnel(period);
});

route('GET', '/api/deals', ({ query }) => {
  const stages = query.stage ? [query.stage] : L.STAGES;
  const out = {};
  for (const st of stages) {
    const limit = st === 'Enquiry' || st === 'Lost' || st === 'Completed' ? 40 : 200;
    out[st] = {
      count: db.prepare('SELECT COUNT(*) n FROM deals WHERE stage = ?').get(st).n,
      value: db.prepare('SELECT COALESCE(SUM(COALESCE(price,0) - COALESCE(part_ex_allowance,0)),0) v FROM deals WHERE stage = ?').get(st).v,
      rows: db.prepare(`SELECT d.*, c.first_name, c.last_name, c.lead_source, c.type AS contact_type, h.make, h.model, p.plot_number,
          (SELECT MIN(start) FROM appointments a WHERE a.deal_id = d.id AND a.status = 'Scheduled' AND a.start >= ?) AS next_appt
        FROM deals d JOIN contacts c ON c.id = d.contact_id LEFT JOIN homes h ON h.id = d.home_id LEFT JOIN plots p ON p.id = d.plot_id
        WHERE d.stage = ? ORDER BY d.stage_changed_at DESC LIMIT ?`).all(U.nowLocal(), st, limit)
    };
  }
  return out;
});
route('POST', '/api/deals', ({ body }) => {
  const c = need(get('contacts', int(body.contact_id)), 'Contact');
  const id = insert('deals', { ...body, contact_id: c.id, stage: 'Enquiry', stage_changed_at: U.nowStamp(),
    deal_type: body.deal_type || (c.type === 'Owner' ? 'Upgrade with part-ex' : 'New sale') });
  insert('interactions', { contact_id: c.id, deal_id: id, type: 'Deal', at: U.nowLocal(), summary: `New deal opened (${body.deal_type || (c.type === 'Owner' ? 'Upgrade with part-ex' : 'New sale')}).` });
  if (c.lead_status === 'Dormant' || c.lead_status === 'Lost') update('contacts', c.id, { lead_status: 'Contacted' });
  return get('deals', id);
});
route('PATCH', '/api/deals/:id', ({ params, body }) => {
  const d = need(get('deals', int(params.id)), 'Deal');
  const patch = { ...body }; delete patch.stage; delete patch.contact_id;
  update('deals', d.id, patch);
  if ('payment_status' in body && body.payment_status !== d.payment_status) L.paymentRecorded(d.id, body.payment_status);
  return get('deals', d.id);
});
route('POST', '/api/deals/:id/stage', ({ params, body }) => { L.setDealStage(int(params.id), body.stage, { lostReason: body.lostReason }); return get('deals', int(params.id)); });
route('DELETE', '/api/deals/:id', ({ params }) => { db.prepare('DELETE FROM deals WHERE id = ?').run(int(params.id)); return { ok: true }; });

route('POST', '/api/deals/:id/valuations', ({ params, body }) => {
  const d = need(get('deals', int(params.id)), 'Deal');
  const id = tx(() => {
    const id = insert('valuations', { ...body, deal_id: d.id });
    if (body.offered_value) update('deals', d.id, { part_ex_allowance: body.offered_value, deal_type: d.deal_type === 'New sale' ? 'Upgrade with part-ex' : d.deal_type });
    insert('interactions', { contact_id: d.contact_id, deal_id: d.id, type: 'Deal', at: U.nowLocal(),
      summary: `Part-ex valuation recorded${body.offered_value ? ': £' + Number(body.offered_value).toLocaleString('en-GB') : ''}${body.valid_until ? ', valid until ' + body.valid_until : ''}.` });
    return id;
  });
  return db.prepare('SELECT * FROM valuations WHERE id = ?').get(id);
});
route('DELETE', '/api/valuations/:id', ({ params }) => { db.prepare('DELETE FROM valuations WHERE id = ?').run(int(params.id)); return { ok: true }; });

/* ----------------------------------------------------------- homes/plots */

route('GET', '/api/homes', () => db.prepare(`SELECT h.*, p.plot_number, c.first_name, c.last_name FROM homes h
  LEFT JOIN plots p ON p.id = h.plot_id LEFT JOIN contacts c ON c.id = h.owner_contact_id ORDER BY h.status, h.make, h.model`).all());
route('POST', '/api/homes', ({ body }) => get('homes', insert('homes', body)));
route('PATCH', '/api/homes/:id', ({ params, body }) => { need(get('homes', int(params.id)), 'Home'); update('homes', int(params.id), body); return get('homes', int(params.id)); });
route('DELETE', '/api/homes/:id', ({ params }) => { db.prepare('DELETE FROM homes WHERE id = ?').run(int(params.id)); return { ok: true }; });
route('GET', '/api/plots', () => db.prepare(`SELECT p.*, (SELECT h.make || ' ' || COALESCE(h.model,'') FROM homes h WHERE h.plot_id = p.id LIMIT 1) AS home
  FROM plots p ORDER BY CAST(p.plot_number AS INTEGER), p.plot_number`).all());
route('POST', '/api/plots', ({ body }) => { if (!body.plot_number) throw L.httpError(400, 'Enter a plot number'); return get('plots', insert('plots', body)); });
route('PATCH', '/api/plots/:id', ({ params, body }) => { need(get('plots', int(params.id)), 'Plot'); update('plots', int(params.id), body); return get('plots', int(params.id)); });
route('DELETE', '/api/plots/:id', ({ params }) => { db.prepare('DELETE FROM plots WHERE id = ?').run(int(params.id)); return { ok: true }; });

/* ---------------------------------------------------------- appointments */

function apptRows(where, args, order = 'a.start') {
  return db.prepare(`SELECT a.*, c.first_name, c.last_name, c.mobile, c.email AS contact_email, d.stage AS deal_stage, d.price AS deal_price,
      h.make, h.model, h.year AS home_year,
      (SELECT summary FROM interactions i WHERE i.contact_id = a.contact_id AND i.type IN ('Note','Call','Meeting') ORDER BY i.at DESC LIMIT 1) AS last_note,
      (SELECT offered_value FROM valuations v WHERE v.deal_id = a.deal_id ORDER BY v.created_at DESC LIMIT 1) AS px_value,
      c.budget
    FROM appointments a LEFT JOIN contacts c ON c.id = a.contact_id LEFT JOIN deals d ON d.id = a.deal_id LEFT JOIN homes h ON h.id = a.home_id
    WHERE ${where} ORDER BY ${order}`).all(...args);
}
route('GET', '/api/appointments', ({ query }) => {
  const from = (query.from || U.today()) + 'T00:00', to = U.addDays(query.to || U.addDays(U.today(), 7), 1) + 'T00:00';
  const appts = apptRows("a.end > ? AND a.start < ? AND (a.status <> 'Cancelled' OR ? = '1')", [from, to, query.cancelled || '0']);
  const outlook = query.outlook === '1' ? db.prepare(`SELECT id, subject, start, end, is_all_day, show_as FROM outlook_events
      WHERE appointment_id IS NULL AND COALESCE(is_cancelled,0) = 0 AND end > ? AND start < ? ORDER BY start`).all(from, to) : [];
  return { appts, outlook };
});
route('GET', '/api/appointments/:id', ({ params }) => need(apptRows('a.id = ?', [int(params.id)])[0], 'Appointment'));
route('POST', '/api/appointments', ({ body }) => apptRows('a.id = ?', [L.createAppointment(body)])[0]);
route('PATCH', '/api/appointments/:id', ({ params, body }) => { L.updateAppointment(int(params.id), body); return apptRows('a.id = ?', [int(params.id)])[0]; });
route('POST', '/api/appointments/:id/cancel', ({ params, body }) => { L.cancelAppointment(int(params.id), { message: body.message }); return { ok: true }; });
route('POST', '/api/appointments/:id/outcome', ({ params, body }) => { L.recordOutcome(int(params.id), body); return { ok: true }; });
route('POST', '/api/appointments/:id/confirm', ({ params }) => { update('appointments', int(params.id), { needs_review: 0, conflict_note: null }, { touch: false }); return { ok: true }; });
route('GET', '/api/slots', ({ query }) => L.suggestSlots({ type: query.type, from: query.from, excludeApptId: int(query.exclude), duration: int(query.duration), days: int(query.days) || 14 }));

/* ---------------------------------------------------------------- search */

route('GET', '/api/search', ({ query }) => {
  const q = (query.q || '').trim();
  if (q.length < 2) return { contacts: [], plots: [] };
  const like = `%${q.toLowerCase()}%`, digits = q.replace(/\D/g, '');
  const contacts = db.prepare(`SELECT id, first_name, last_name, mobile, email, lead_no, type, lead_status FROM contacts
    WHERE lower(first_name || ' ' || last_name) LIKE ? OR lower(email) LIKE ? OR lower(lead_no) LIKE ?
    ${digits.length >= 4 ? "OR replace(replace(mobile,' ',''),'+','') LIKE ? OR phone_e164 LIKE ?" : ''}
    ORDER BY (lower(first_name || ' ' || last_name) LIKE ?) DESC, COALESCE(last_contact_at, enquiry_date) DESC LIMIT 12`)
    .all(like, like, like, ...(digits.length >= 4 ? [`%${digits}%`, `%${digits.replace(/^0/, '')}%`] : []), q.toLowerCase() + '%');
  const plots = db.prepare(`SELECT p.id, p.plot_number, p.area, p.status FROM plots p WHERE lower(p.plot_number) LIKE ? OR lower('plot ' || p.plot_number) LIKE ? LIMIT 5`).all(like, like);
  return { contacts, plots };
});

/* -------------------------------------------------------------- settings */

route('GET', '/api/settings', ({ user }) => ({ settings: getSettings(), outlook: graph.status(), user, hosted: true }));
route('PUT', '/api/settings', ({ body }) => {
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in body) setSetting(k, body[k]);
  return { settings: getSettings() };
});

route('POST', '/api/import', ({ raw, headers }) => {
  if (!raw || !raw.length) throw L.httpError(400, 'No file received');
  const name = decodeURIComponent(headers['x-filename'] || 'import.xlsx');
  return importer.importFile(raw, name);
});

route('GET', '/api/jobs', () => db.prepare('SELECT * FROM job_log ORDER BY id DESC LIMIT 30').all());

route('GET', '/api/export/contacts.csv', () => {
  const rows = db.prepare(`SELECT c.lead_no, c.type, c.first_name, c.last_name, c.mobile, c.email, c.postcode, c.lead_source, c.lead_status,
    c.enquiry_date, c.last_contact_at, c.consent_email, c.consent_sms, c.consent_post,
    (SELECT stage FROM deals d WHERE d.contact_id = c.id ORDER BY d.updated_at DESC LIMIT 1) AS stage FROM contacts c ORDER BY c.last_name, c.first_name`).all();
  const cols = ['lead_no', 'type', 'first_name', 'last_name', 'mobile', 'email', 'postcode', 'lead_source', 'lead_status', 'stage', 'enquiry_date', 'last_contact_at', 'consent_email', 'consent_sms', 'consent_post'];
  const esc = v => v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const csv = '﻿' + [cols.join(','), ...rows.map(r => cols.map(k => esc(r[k])).join(','))].join('\r\n');
  return raw(200, csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="coastfields-contacts-${U.today()}.csv"` });
});

route('GET', '/api/backup', () => raw(200, Buffer.from(exportBytes()), { 'Content-Type': 'application/octet-stream',
  'Content-Disposition': `attachment; filename="coastfields-${U.nowStamp().replace(/[:T]/g, '-')}.db"` }));

/* --------------------------------------------------------------- outlook */

route('GET', '/api/outlook/status', () => graph.status());
route('POST', '/api/outlook/sync', async () => ({ result: await graph.syncNow({ budgetMs: 6e3 }), status: graph.status() }));
route('POST', '/api/outlook/disconnect', async () => { await graph.disconnect(); return graph.status(); });
route('GET', '/api/auth/start', () => raw(302, '', { Location: graph.startAuth() }));
route('GET', '/api/auth/callback', async ({ query }) => {
  try { await graph.finishAuth(query); return raw(302, '', { Location: '/#/settings?connected=1' }); }
  catch (e) { return raw(200, page('Could not connect to Outlook', e.message), { 'Content-Type': 'text/html; charset=utf-8' }); }
});
route('GET', '/api/me', ({ user }) => ({ user, contacts: db.prepare('SELECT COUNT(*) n FROM contacts').get().n }));
route('POST', '/api/outlook/retry', () => { graph.retryErrors(); return graph.status(); });

function raw(status, body, headers = {}) { return { __raw: true, status, body, headers }; }
function page(title, message) {
  const e = t => String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><meta charset="utf-8"><title>${e(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <body style="font-family:system-ui,sans-serif;background:#eef3f6;display:grid;place-items:center;min-height:100vh;margin:0">
  <div style="background:#fff;padding:32px 36px;border-radius:14px;max-width:460px"><img src="/img/logo.png" alt="Coastfields" style="height:36px">
  <h2 style="margin:20px 0 8px;color:#b42318">${e(title)}</h2><p style="color:#555;line-height:1.5">${e(message)}</p><p><a href="/#/settings" style="color:#2f7fbf">Back to the portal</a></p></div></body>`;
}

module.exports = { match, fullName, raw, page };
