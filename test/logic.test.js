'use strict';
// Run with:  node --test test/
// Uses a throwaway database so your real data is never touched.
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coastfields-test-'));
process.env.COASTFIELDS_DATA = dir;

const test = require('node:test');
const assert = require('node:assert');
const { db, open, insert, get, setSetting, setState } = require('../server/db');
const L = require('../server/logic');
const U = require('../server/util');

const day = U.today();
let contactId, dealId;
test.before(async () => {
  await open();
  contactId = insert('contacts', { first_name: 'Test', last_name: 'Buyer', email: 'buyer@example.com', mobile: '07700900123', phone_e164: '+447700900123', lead_status: 'New' });
  dealId = insert('deals', { contact_id: contactId, stage: 'Enquiry' });
});

test('date helpers', () => {
  assert.equal(U.addDays('2026-10-24', 8), '2026-11-01');
  assert.equal(U.addMinutes('2026-10-24T23:30', 45), '2026-10-25T00:15');
  assert.equal(U.weekday('2026-10-24'), 6); // Saturday
  assert.equal(U.nextOpenDay('2026-10-25', [0]), '2026-10-26');
  assert.equal(U.workingDaysBetween('2026-10-23', '2026-10-27', [0]), 3); // Sat, Mon, Tue
  assert.equal(U.normalisePhone('07516 350984'), '+447516350984');
});

test('rollover moves overdue tasks to today, keeps the original date, escalates and flags review', () => {
  setSetting('closedDays', []);
  const a = L.createTask({ title: 'Old low task', priority: 'Low', due_date: U.addDays(day, -4), contact_id: contactId });
  const b = L.createTask({ title: 'Due today', due_date: day });
  const c = L.createTask({ title: 'Future', due_date: U.addDays(day, 3) });
  const r = L.rollOverTasks();
  assert.equal(r.rolled, 1);
  const ta = get('tasks', a);
  assert.equal(ta.due_date, day);
  assert.equal(ta.original_due_date, U.addDays(day, -4));
  assert.equal(ta.rollover_count, 1);
  assert.equal(L.urgencyOf(ta), 'red');            // 4 days late
  assert.equal(L.urgencyOf(get('tasks', b)), 'today');
  assert.equal(get('tasks', c).due_date, U.addDays(day, 3));
  // Running again the same day changes nothing (idempotent).
  assert.equal(L.rollOverTasks().rolled, 0);
  // Simulate further nights: escalation at 3 rollovers, review flag at 5.
  for (let n = 2; n <= 5; n++) {
    db.prepare('UPDATE tasks SET due_date = ?, last_rolled_on = ? WHERE id = ?').run(U.addDays(day, -1), U.addDays(day, -1), a);
    L.rollOverTasks();
    const t = get('tasks', a);
    if (n === 3) assert.equal(t.priority, 'Medium');
    if (n === 5) { assert.equal(t.needs_review, 1); assert.equal(t.rollover_count, 5); }
  }
});

test('amber for 1-2 days late, red for any late High task', () => {
  const t = { status: 'Open', due_date: day, original_due_date: U.addDays(day, -1), priority: 'Medium' };
  assert.equal(L.urgencyOf(t), 'amber');
  assert.equal(L.urgencyOf({ ...t, priority: 'High' }), 'red');
});

test('closed days: rollover lands on the next open day', () => {
  const closed = [U.weekday(day)]; // pretend the office is closed today
  setSetting('closedDays', closed);
  const id = L.createTask({ title: 'Closed-day task', due_date: U.addDays(day, -1) });
  L.rollOverTasks();
  assert.equal(get('tasks', id).due_date, U.nextOpenDay(day, closed));
  setSetting('closedDays', []);
});

test('snooze and review actions', () => {
  const id = L.createTask({ title: 'Snooze me', due_date: day });
  const due = L.snoozeTask(id, 1);
  assert.equal(due, U.addDays(day, 1));
  L.reviewTask(id, 'drop', { reason: 'Bought elsewhere' });
  assert.equal(get('tasks', id).status, 'Dropped');
});

test('slot suggestions avoid busy time and respect buffer', () => {
  setSetting('openingHours', { start: '09:00', end: '17:00' });
  const tomorrow = U.addDays(day, 1);
  insert('appointments', { type: 'Viewing', title: 'Busy', start: `${tomorrow}T09:00`, end: `${tomorrow}T12:00`, status: 'Scheduled' });
  const { slots, duration } = L.suggestSlots({ type: 'Viewing', from: tomorrow });
  assert.equal(duration, 60);
  assert.equal(slots.length, 3);
  assert.ok(slots[0].start >= `${tomorrow}T12:15`, 'first slot respects the 15-minute buffer');
});

test('booking a viewing moves the deal on and creates prep and follow-up tasks', () => {
  const start = `${U.addDays(day, 2)}T10:30`;
  const id = L.createAppointment({ type: 'Viewing', start, contact_id: contactId });
  const a = get('appointments', id);
  assert.equal(a.end, `${U.addDays(day, 2)}T11:30`);
  assert.equal(a.deal_id, dealId);
  assert.equal(get('deals', dealId).stage, 'Viewing booked');
  const auto = db.prepare('SELECT auto_key FROM tasks WHERE appointment_id = ? ORDER BY auto_key').all(id).map(r => r.auto_key);
  assert.deepEqual(auto, [`appt:${id}:follow`, `appt:${id}:prep`]);
  // Moving it shifts the follow-up.
  L.updateAppointment(id, { start: `${U.addDays(day, 4)}T14:00` });
  const follow = db.prepare('SELECT due_date FROM tasks WHERE auto_key = ?').get(`appt:${id}:follow`);
  assert.equal(follow.due_date, U.addDays(day, 5));
  // Outcome moves the deal to Viewed and creates the stage task.
  L.recordOutcome(id, { outcome: 'Interested in plot 42' });
  assert.equal(get('deals', dealId).stage, 'Viewed');
  assert.ok(db.prepare("SELECT 1 FROM tasks WHERE title = 'Send price and plot details' AND deal_id = ?").get(dealId));
});

test('cancelling a viewing drops its auto tasks and creates a rebook task', () => {
  const id = L.createAppointment({ type: 'Viewing', start: `${U.addDays(day, 6)}T10:00`, contact_id: contactId });
  L.cancelAppointment(id, { message: 'Car trouble' });
  assert.equal(get('appointments', id).status, 'Cancelled');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tasks WHERE appointment_id = ? AND status = 'Open'").get(id).n, 0);
  assert.ok(db.prepare('SELECT 1 FROM tasks WHERE auto_key = ?').get(`appt:${id}:rebook`));
});

test('completing a deal turns the buyer into an owner', () => {
  const plot = insert('plots', { plot_number: '42' });
  const home = insert('homes', { make: 'Willerby', model: 'Sierra', status: 'Available', plot_id: plot });
  const d = insert('deals', { contact_id: contactId, stage: 'Siting and handover', home_id: home, plot_id: plot });
  L.setDealStage(d, 'Completed');
  assert.equal(get('contacts', contactId).type, 'Owner');
  assert.equal(get('homes', home).owner_contact_id, contactId);
  assert.equal(get('plots', plot).status, 'Occupied');
});

test('merging duplicates moves activity to the kept record', () => {
  const a = insert('contacts', { first_name: 'Ray', last_name: 'Giles', email: 'ray@example.com' });
  const b = insert('contacts', { first_name: 'Roy', last_name: 'Giles', email: 'ray@example.com', mobile: '07700900999' });
  insert('interactions', { contact_id: b, type: 'Note', at: day + 'T09:00', summary: 'Called about lodges' });
  L.mergeContacts(a, [b]);
  assert.equal(get('contacts', b), null);
  assert.equal(get('contacts', a).mobile, '07700900999');
  assert.ok(db.prepare("SELECT 1 FROM interactions WHERE contact_id = ? AND summary = 'Called about lodges'").get(a));
});

test.after(() => { setState('x', null); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
