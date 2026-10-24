'use strict';
const { db, tx, insert, update, get, getSettings, setState, getState, logJob } = require('./db');
const U = require('./util');

const STAGES = ['Enquiry', 'Viewing booked', 'Viewed', 'Proposal', 'Reserved', 'Finance and paperwork', 'Siting and handover', 'Completed', 'Lost'];
const OPEN_STAGES = STAGES.slice(0, 7);
const APPT_TYPES = ['Viewing', 'Part-ex valuation', 'Finance meeting', 'Handover', 'Phone call', 'Teams call'];
const CATEGORIES = ['Follow-up', 'Call', 'Email', 'Admin'];
const PRIORITIES = ['High', 'Medium', 'Low'];
const LEAD_STATUSES = ['New', 'Contacted', 'Nurture', 'Dormant', 'Customer', 'Lost'];

const graph = () => require('./graph'); // late require (graph depends on this module)

/* ------------------------------------------------------------------ tasks */

function urgencyOf(t, settings = getSettings(), day = U.today()) {
  if (t.status !== 'Open') return 'done';
  if (!t.due_date) return 'none';
  if (t.due_date > day) return 'future';
  const from = t.original_due_date || t.due_date;
  const late = from < day ? U.workingDaysBetween(from, day, settings.closedDays) : 0;
  if (late >= 3 || (late >= 1 && t.priority === 'High')) return 'red';
  if (late >= 1) return 'amber';
  return 'today';
}

function decorateTask(t, settings, day) {
  const from = t.original_due_date || t.due_date;
  t.days_late = t.status === 'Open' && from && from < day ? U.workingDaysBetween(from, day, settings.closedDays) : 0;
  t.urgency = urgencyOf(t, settings, day);
  return t;
}

const ESCALATE = { Low: 'Medium', Medium: 'High', High: 'High' };

// Moves every unfinished task from earlier days onto today (or the next open day), keeping the
// original due date, escalating after N rollovers and asking for review after M. Idempotent.
function rollOverTasks({ reason = 'manual' } = {}) {
  const s = getSettings();
  const day = U.today();
  const target = U.nextOpenDay(day, s.closedDays);
  const tasks = db.prepare(`SELECT * FROM tasks WHERE status = 'Open' AND due_date IS NOT NULL AND due_date < ?
                             AND (last_rolled_on IS NULL OR last_rolled_on < ?)`).all(day, day);
  tx(() => {
    for (const t of tasks) {
      const count = t.rollover_count + 1;
      const patch = {
        original_due_date: t.original_due_date || t.due_date,
        due_date: target, rollover_count: count, last_rolled_on: day
      };
      if (count === s.escalateAfter) patch.priority = ESCALATE[t.priority] || t.priority;
      if (count >= s.reviewAfter) patch.needs_review = 1;
      update('tasks', t.id, patch);
    }
  });
  setState('lastRollover', { date: day, at: U.nowStamp(), count: tasks.length, reason });
  if (tasks.length) logJob('rollover', { count: tasks.length, reason });
  if (tasks.length) graph().queueTodoSync();
  return { rolled: tasks.length, date: day };
}

function maybeScheduledRollover() {
  const s = getSettings();
  const last = getState('lastRollover');
  const nowT = U.nowLocal().slice(11);
  if ((!last || last.date < U.today()) && nowT >= s.rolloverTime) rollOverTasks({ reason: 'nightly' });
}

function createTask(data) {
  const s = getSettings();
  const t = {
    title: (data.title || '').trim() || 'Untitled task',
    category: CATEGORIES.includes(data.category) ? data.category : 'Follow-up',
    priority: PRIORITIES.includes(data.priority) ? data.priority : 'Medium',
    due_date: data.due_date === undefined ? U.today() : data.due_date,
    due_time: data.due_time, notes: data.notes,
    contact_id: data.contact_id || null, deal_id: data.deal_id || null, appointment_id: data.appointment_id || null,
    auto_key: data.auto_key || null
  };
  if (t.auto_key) {
    const ex = db.prepare('SELECT id FROM tasks WHERE auto_key = ?').get(t.auto_key);
    if (ex) return ex.id;
  }
  const id = insert('tasks', t);
  graph().queueTodoSync();
  void s;
  return id;
}

function completeTask(id, done = true) {
  const t = get('tasks', id);
  if (!t) throw httpError(404, 'Task not found');
  if (done) {
    update('tasks', id, { status: 'Done', completed_at: U.nowStamp(), needs_review: 0 });
    if (t.contact_id) {
      insert('interactions', { contact_id: t.contact_id, deal_id: t.deal_id, type: 'Task', at: U.nowLocal(), summary: `Completed: ${t.title}`, task_id: id });
      touchContact(t.contact_id);
    }
  } else {
    update('tasks', id, { status: 'Open', completed_at: null });
  }
  graph().queueTodoSync();
}

function snoozeTask(id, days = 1) {
  const t = get('tasks', id);
  if (!t) throw httpError(404, 'Task not found');
  const s = getSettings();
  const base = t.due_date && t.due_date > U.today() ? t.due_date : U.today();
  const due = U.nextOpenDay(U.addDays(base, days), s.closedDays);
  // Snoozing is a deliberate reschedule, so it resets the lateness clock.
  update('tasks', id, { due_date: due, original_due_date: null, needs_review: 0, last_rolled_on: null });
  graph().queueTodoSync();
  return due;
}

function reviewTask(id, action, { date, reason } = {}) {
  const t = get('tasks', id);
  if (!t) throw httpError(404, 'Task not found');
  const day = U.today();
  if (action === 'today') update('tasks', id, { due_date: day, needs_review: 0, rollover_count: 0, original_due_date: null, priority: 'High' });
  else if (action === 'reschedule') update('tasks', id, { due_date: date || U.addDays(day, 7), needs_review: 0, rollover_count: 0, original_due_date: null, last_rolled_on: null });
  else if (action === 'drop') {
    update('tasks', id, { status: 'Dropped', drop_reason: reason || 'No longer relevant', completed_at: U.nowStamp(), needs_review: 0 });
    if (t.contact_id) insert('interactions', { contact_id: t.contact_id, type: 'Task', at: U.nowLocal(), summary: `Dropped: ${t.title}${reason ? ' (' + reason + ')' : ''}`, task_id: id });
  } else throw httpError(400, 'Unknown review action');
  graph().queueTodoSync();
}

/* -------------------------------------------------------------- contacts */

function touchContact(id) {
  db.prepare("UPDATE contacts SET last_contact_at = ?, lead_status = CASE WHEN lead_status IN ('New','Dormant') THEN 'Contacted' ELSE lead_status END WHERE id = ?")
    .run(U.nowLocal(), id);
}

function addInteraction({ contact_id, deal_id, type = 'Note', summary, at }) {
  if (!summary || !summary.trim()) throw httpError(400, 'Write something first');
  const id = insert('interactions', { contact_id, deal_id: deal_id || null, type, summary: summary.trim(), at: at || U.nowLocal() });
  if (contact_id && type !== 'Note') touchContact(contact_id);
  if (contact_id && type === 'Note') db.prepare('UPDATE contacts SET last_contact_at = COALESCE(last_contact_at, ?) WHERE id = ?').run(U.nowLocal(), contact_id);
  return id;
}

function logCall(contactId, { outcome, notes, taskId, followUpDays }) {
  const summary = `Call: ${outcome || 'Spoke'}${notes ? ' – ' + notes : ''}`;
  insert('interactions', { contact_id: contactId, type: 'Call', at: U.nowLocal(), summary, task_id: taskId || null });
  touchContact(contactId);
  if (taskId) {
    const t = get('tasks', taskId);
    if (t && t.status === 'Open') update('tasks', taskId, { status: 'Done', completed_at: U.nowStamp(), needs_review: 0 });
  }
  let followId = null;
  if (followUpDays) {
    const s = getSettings();
    followId = createTask({ title: `Follow up: ${outcome || 'call'}`, category: outcome === 'No answer' ? 'Call' : 'Follow-up',
      priority: outcome === 'No answer' ? 'Medium' : 'High', due_date: U.nextOpenDay(U.addDays(U.today(), followUpDays), s.closedDays), contact_id: contactId });
  }
  graph().queueTodoSync();
  return { followId };
}

function mergeContacts(keepId, otherIds) {
  const keep = get('contacts', keepId);
  if (!keep) throw httpError(404, 'Contact not found');
  tx(() => {
    for (const oid of otherIds) {
      if (oid === keepId) continue;
      const o = get('contacts', oid);
      if (!o) continue;
      const patch = {};
      for (const k of ['email', 'mobile', 'phone_e164', 'address', 'postcode', 'lead_source', 'budget', 'bedrooms', 'preferences', 'lead_no', 'enquiry_date']) {
        if ((keep[k] === null || keep[k] === '') && o[k]) { patch[k] = o[k]; keep[k] = o[k]; }
      }
      if (o.enquiry_date && keep.enquiry_date && o.enquiry_date < keep.enquiry_date) patch.enquiry_date = o.enquiry_date;
      if (Object.keys(patch).length) update('contacts', keepId, patch);
      for (const t of ['deals', 'tasks', 'appointments', 'interactions']) db.prepare(`UPDATE ${t} SET contact_id = ? WHERE contact_id = ?`).run(keepId, oid);
      db.prepare('UPDATE homes SET owner_contact_id = ? WHERE owner_contact_id = ?').run(keepId, oid);
      insert('interactions', { contact_id: keepId, type: 'Note', at: U.nowLocal(), summary: `Merged duplicate record: ${o.first_name} ${o.last_name}${o.lead_no ? ' (' + o.lead_no + ')' : ''}.` });
      // Keep the old external id so a re-import doesn't recreate the duplicate.
      db.prepare('DELETE FROM contacts WHERE id = ?').run(oid);
      if (o.external_id) db.prepare('INSERT OR IGNORE INTO sync_state(key, value) VALUES(?, ?)').run('merged:' + o.external_id, JSON.stringify(keepId));
    }
  });
  require('./importer').recomputeDuplicates();
}

/* ----------------------------------------------------------------- deals */

const STAGE_TASKS = {
  'Viewed': [{ title: 'Send price and plot details', category: 'Email', priority: 'High', days: 2 }],
  'Proposal': [{ title: 'Chase decision on proposal', category: 'Call', priority: 'Medium', days: 3 }],
  'Reserved': [
    { title: 'Chase finance decision', category: 'Follow-up', priority: 'High', days: 5 },
    { title: 'Book handover', category: 'Admin', priority: 'Medium', handoverOffset: -14, days: 14 }
  ],
  'Finance and paperwork': [
    { title: 'Send licence agreement', category: 'Email', priority: 'Medium', days: 2 },
    { title: 'Confirm balance payment date', category: 'Call', priority: 'Medium', days: 7 }
  ],
  'Siting and handover': [{ title: 'Confirm siting, connections and keys', category: 'Admin', priority: 'High', days: 3 }],
  'Completed': [{ title: 'Welcome call after first stay', category: 'Call', priority: 'Low', days: 14 }]
};

function setDealStage(dealId, stage, { lostReason } = {}) {
  if (!STAGES.includes(stage)) throw httpError(400, 'Unknown stage');
  const d = get('deals', dealId);
  if (!d) throw httpError(404, 'Deal not found');
  if (d.stage === stage) return;
  const s = getSettings();
  tx(() => {
    update('deals', dealId, { stage, stage_changed_at: U.nowStamp(), lost_reason: stage === 'Lost' ? (lostReason || d.lost_reason) : d.lost_reason });
    insert('interactions', { contact_id: d.contact_id, deal_id: dealId, type: 'Deal', at: U.nowLocal(), summary: `Deal moved from ${d.stage} to ${stage}${stage === 'Lost' && lostReason ? ' – ' + lostReason : ''}.` });
    for (const tpl of STAGE_TASKS[stage] || []) {
      let due = U.addDays(U.today(), tpl.days);
      if (tpl.handoverOffset && d.target_handover) due = U.addDays(d.target_handover, tpl.handoverOffset);
      if (due < U.today()) due = U.today();
      createTask({ title: tpl.title, category: tpl.category, priority: tpl.priority, due_date: U.nextOpenDay(due, s.closedDays),
        contact_id: d.contact_id, deal_id: dealId, auto_key: `deal:${dealId}:${stage}:${tpl.title}` });
    }
    if (d.stage === 'Lost' && OPEN_STAGES.includes(stage)) db.prepare("UPDATE contacts SET lead_status = 'Contacted' WHERE id = ? AND lead_status = 'Lost'").run(d.contact_id);
    if (stage === 'Reserved') {
      if (d.home_id) update('homes', d.home_id, { status: 'Reserved' });
      if (d.plot_id) update('plots', d.plot_id, { status: 'Reserved' });
    }
    if (stage === 'Completed') {
      update('contacts', d.contact_id, { type: 'Owner', lead_status: 'Customer' });
      if (d.home_id) update('homes', d.home_id, { status: 'Owner-held', owner_contact_id: d.contact_id, plot_id: d.plot_id || null });
      if (d.plot_id) update('plots', d.plot_id, { status: 'Occupied' });
      for (const v of db.prepare('SELECT home_id FROM valuations WHERE deal_id = ? AND home_id IS NOT NULL').all(dealId))
        update('homes', v.home_id, { status: 'Part-ex in', owner_contact_id: null });
    }
    if (stage === 'Lost') {
      if (d.home_id) db.prepare("UPDATE homes SET status = 'Available' WHERE id = ? AND status = 'Reserved'").run(d.home_id);
      if (d.plot_id) db.prepare("UPDATE plots SET status = 'Vacant' WHERE id = ? AND status = 'Reserved'").run(d.plot_id);
      const open = db.prepare("SELECT COUNT(*) n FROM deals WHERE contact_id = ? AND stage NOT IN ('Lost','Completed') AND id <> ?").get(d.contact_id, dealId).n;
      if (!open) db.prepare("UPDATE contacts SET lead_status = 'Lost' WHERE id = ? AND type = 'Prospect'").run(d.contact_id);
    }
  });
  graph().queueTodoSync();
}

/* ---------------------------------------------------------- appointments */

function busyBlocks(fromDay, toDay, excludeApptId) {
  const from = fromDay + 'T00:00', to = U.addDays(toDay, 1) + 'T00:00';
  const appts = db.prepare(`SELECT id, start, end FROM appointments WHERE status = 'Scheduled' AND end > ? AND start < ? AND id IS NOT ?`)
    .all(from, to, excludeApptId || null);
  const ext = db.prepare(`SELECT start, end, is_all_day, show_as FROM outlook_events
                          WHERE appointment_id IS NULL AND COALESCE(is_cancelled,0) = 0 AND COALESCE(show_as,'busy') NOT IN ('free','workingElsewhere')
                          AND end > ? AND start < ?`).all(from, to);
  return [...appts, ...ext].map(b => ({ start: b.start, end: b.end }));
}

function suggestSlots({ type = 'Viewing', from, days = 14, count = 3, excludeApptId, duration } = {}) {
  const s = getSettings();
  const dur = Number(duration) || s.durations[type] || 60;
  const buffer = s.bufferMinutes || 0;
  const startDay = from && from > U.today() ? from : U.today();
  const endDay = U.addDays(startDay, days);
  const busy = busyBlocks(startDay, endDay, excludeApptId);
  const now = U.nowLocal();
  const earliest = U.addMinutes(now, 30);
  const open = U.minutesOf(s.openingHours.start), close = U.minutesOf(s.openingHours.end);
  const all = [];
  for (let day = startDay; day <= endDay && all.length < 200; day = U.addDays(day, 1)) {
    if (!U.isOpenDay(day, s.closedDays)) continue;
    for (let m = open; m + dur <= close; m += 15) {
      const st = `${day}T${U.hhmm(m)}`, en = U.addMinutes(st, dur);
      if (st < earliest) continue;
      const clash = busy.some(b => U.addMinutes(b.start, -buffer) < en && U.addMinutes(b.end, buffer) > st);
      if (!clash) all.push({ start: st, end: en });
    }
  }
  // Offer variety: the earliest slot, then ones at least 2 hours apart or on later days.
  const picks = [];
  for (const sl of all) {
    if (picks.every(p => p.start.slice(0, 10) !== sl.start.slice(0, 10) || Math.abs(U.minutesOf(p.start.slice(11)) - U.minutesOf(sl.start.slice(11))) >= 120)) picks.push(sl);
    if (picks.length >= count) break;
  }
  return { duration: dur, slots: picks, all: all.slice(0, 60) };
}

function apptTitle(type, contact) {
  const name = contact ? `${contact.first_name} ${contact.last_name}`.trim() : '';
  return name ? `${type} – ${name}` : type;
}

function syncAutoTasks(appt) {
  const s = getSettings();
  const day = appt.start.slice(0, 10);
  const contact = appt.contact_id ? get('contacts', appt.contact_id) : null;
  const who = contact ? ` – ${contact.first_name} ${contact.last_name}`.trimEnd() : '';
  const lower = appt.type.toLowerCase();
  const prepDue = U.prevOpenDay(day, s.closedDays);
  const followDue = U.nextOpenDay(U.addDays(day, 1), s.closedDays);
  const prepKey = `appt:${appt.id}:prep`, followKey = `appt:${appt.id}:follow`;
  const isCall = appt.type === 'Phone call';
  const prep = db.prepare('SELECT * FROM tasks WHERE auto_key = ?').get(prepKey);
  const follow = db.prepare('SELECT * FROM tasks WHERE auto_key = ?').get(followKey);
  if (!isCall && day > U.today()) {
    if (prep) { if (prep.status === 'Open') update('tasks', prep.id, { due_date: prepDue < U.today() ? U.today() : prepDue, original_due_date: null }); }
    else createTask({ title: `Prepare for ${lower}${who}`, category: 'Admin', priority: 'Medium', due_date: prepDue < U.today() ? U.today() : prepDue,
      contact_id: appt.contact_id, deal_id: appt.deal_id, appointment_id: appt.id, auto_key: prepKey });
  }
  if (follow) { if (follow.status === 'Open') update('tasks', follow.id, { due_date: followDue, original_due_date: null }); }
  else createTask({ title: `Follow up after ${lower}${who}`, category: 'Follow-up', priority: 'High', due_date: followDue,
    contact_id: appt.contact_id, deal_id: appt.deal_id, appointment_id: appt.id, auto_key: followKey });
}

function createAppointment(data) {
  const s = getSettings();
  const type = APPT_TYPES.includes(data.type) ? data.type : 'Viewing';
  if (!data.start) throw httpError(400, 'Choose a start time');
  const dur = Number(data.duration) || s.durations[type] || 60;
  const end = data.end || U.addMinutes(data.start, dur);
  const contact = data.contact_id ? get('contacts', data.contact_id) : null;
  let dealId = data.deal_id || null;
  if (!dealId && contact) {
    const d = db.prepare("SELECT id FROM deals WHERE contact_id = ? AND stage NOT IN ('Completed','Lost') ORDER BY updated_at DESC LIMIT 1").get(contact.id);
    if (d) dealId = d.id;
  }
  const isRemote = data.is_remote ? 1 : (type === 'Teams call' ? 1 : 0);
  const id = tx(() => {
    const id = insert('appointments', {
      type, title: (data.title || '').trim() || apptTitle(type, contact), start: data.start, end,
      location: data.location || (isRemote ? 'Microsoft Teams' : (type === 'Phone call' ? 'Phone' : s.officeLocation)),
      is_remote: isRemote, contact_id: contact ? contact.id : null, deal_id: dealId, home_id: data.home_id || null,
      notes: data.notes, send_invite: data.send_invite === false || data.send_invite === 0 ? 0 : 1,
      sync_status: graph().isConnected() ? 'Pending' : 'Local'
    });
    if (contact) {
      insert('interactions', { contact_id: contact.id, deal_id: dealId, type: 'Appointment', at: U.nowLocal(), appointment_id: id,
        summary: `${type} booked for ${fmtWhen(data.start)}.` });
      touchContact(contact.id);
    }
    if (type === 'Viewing' && dealId) {
      const d = get('deals', dealId);
      if (d && d.stage === 'Enquiry') {
        update('deals', dealId, { stage: 'Viewing booked', stage_changed_at: U.nowStamp() });
        insert('interactions', { contact_id: d.contact_id, deal_id: dealId, type: 'Deal', at: U.nowLocal(), summary: 'Deal moved from Enquiry to Viewing booked.' });
      }
    }
    if (type === 'Part-ex valuation' && dealId) {
      const d = get('deals', dealId);
      if (d && d.deal_type === 'New sale' && contact && contact.type === 'Owner') update('deals', dealId, { deal_type: 'Upgrade with part-ex' });
    }
    syncAutoTasks(get('appointments', id));
    return id;
  });
  graph().queuePush(id);
  return id;
}

function updateAppointment(id, data) {
  const a = get('appointments', id);
  if (!a) throw httpError(404, 'Appointment not found');
  const patch = {};
  for (const k of ['title', 'type', 'location', 'notes', 'is_remote', 'home_id', 'deal_id', 'contact_id']) if (k in data) patch[k] = data[k];
  if (data.start) {
    patch.start = data.start;
    const dur = U.minutesOf(a.end.slice(11)) - U.minutesOf(a.start.slice(11)) + (a.end.slice(0, 10) !== a.start.slice(0, 10) ? 1440 : 0);
    patch.end = data.end || U.addMinutes(data.start, data.duration ? Number(data.duration) : dur);
  } else if (data.end) patch.end = data.end;
  if ('needs_review' in data) patch.needs_review = data.needs_review ? 1 : 0;
  if ('conflict_note' in data) patch.conflict_note = data.conflict_note;
  const moved = patch.start && patch.start !== a.start;
  if (graph().isConnected() && a.status === 'Scheduled') patch.sync_status = 'Pending';
  update('appointments', id, patch);
  const now = get('appointments', id);
  if (moved && now.contact_id) {
    insert('interactions', { contact_id: now.contact_id, deal_id: now.deal_id, type: 'Appointment', at: U.nowLocal(), appointment_id: id,
      summary: `${now.type} moved from ${fmtWhen(a.start)} to ${fmtWhen(now.start)}.` });
  }
  if (moved) syncAutoTasks(now);
  graph().queuePush(id);
  return now;
}

function cancelAppointment(id, { message, fromOutlook = false } = {}) {
  const a = get('appointments', id);
  if (!a) throw httpError(404, 'Appointment not found');
  if (a.status === 'Cancelled') return;
  tx(() => {
    update('appointments', id, { status: 'Cancelled', sync_status: !fromOutlook && graph().isConnected() && a.outlook_event_id ? 'Pending' : a.sync_status, sync_error: null });
    db.prepare("UPDATE tasks SET status = 'Dropped', drop_reason = 'Appointment cancelled', completed_at = ? WHERE appointment_id = ? AND status = 'Open' AND auto_key IS NOT NULL").run(U.nowStamp(), id);
    if (a.contact_id) {
      insert('interactions', { contact_id: a.contact_id, deal_id: a.deal_id, type: 'Appointment', at: U.nowLocal(), appointment_id: id,
        summary: `${a.type} on ${fmtWhen(a.start)} cancelled${fromOutlook ? ' in Outlook' : ''}${message ? ': ' + message : '.'}` });
      if (fromOutlook || a.type === 'Viewing') {
        const c = get('contacts', a.contact_id);
        createTask({ title: `Rebook ${a.type.toLowerCase()} with ${c ? (c.first_name + ' ' + c.last_name).trim() : 'customer'}`, category: 'Follow-up', priority: 'High',
          due_date: U.today(), contact_id: a.contact_id, deal_id: a.deal_id, auto_key: `appt:${id}:rebook` });
      }
    }
  });
  if (!fromOutlook) graph().queueCancel(id, message);
  graph().queueTodoSync();
}

function recordOutcome(id, { outcome, notes, nextStage }) {
  const a = get('appointments', id);
  if (!a) throw httpError(404, 'Appointment not found');
  tx(() => {
    update('appointments', id, { outcome, status: a.status === 'Cancelled' ? 'Cancelled' : 'Completed', notes: notes ? [a.notes, notes].filter(Boolean).join('\n') : a.notes });
    if (a.contact_id) {
      insert('interactions', { contact_id: a.contact_id, deal_id: a.deal_id, type: 'Meeting', at: U.nowLocal(), appointment_id: id,
        summary: `${a.type} outcome: ${outcome}${notes ? ' – ' + notes : ''}` });
      touchContact(a.contact_id);
    }
    const follow = db.prepare("SELECT * FROM tasks WHERE auto_key = ? AND status = 'Open'").get(`appt:${id}:follow`);
    if (follow) update('tasks', follow.id, { title: `Follow up: ${outcome}` });
    db.prepare("UPDATE tasks SET status = 'Done', completed_at = ? WHERE auto_key = ? AND status = 'Open'").run(U.nowStamp(), `appt:${id}:prep`);
  });
  if (a.deal_id) {
    const d = get('deals', a.deal_id);
    let stage = nextStage;
    if (!stage && a.type === 'Viewing' && d && ['Enquiry', 'Viewing booked'].includes(d.stage)) stage = 'Viewed';
    if (stage && d && d.stage !== stage) setDealStage(a.deal_id, stage);
  }
  graph().queueTodoSync();
}

function fmtWhen(dt) {
  const d = dt.slice(0, 10), t = dt.slice(11, 16);
  const [y, m, dd] = d.split('-').map(Number);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][U.weekday(d)];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return `${wd} ${dd} ${mon}${y !== Number(U.today().slice(0, 4)) ? ' ' + y : ''}, ${t}`;
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

module.exports = {
  STAGES, OPEN_STAGES, APPT_TYPES, CATEGORIES, PRIORITIES, LEAD_STATUSES,
  urgencyOf, decorateTask, rollOverTasks, maybeScheduledRollover, createTask, completeTask, snoozeTask, reviewTask,
  addInteraction, logCall, mergeContacts, touchContact, setDealStage,
  suggestSlots, createAppointment, updateAppointment, cancelAppointment, recordOutcome, fmtWhen, httpError, syncAutoTasks
};
