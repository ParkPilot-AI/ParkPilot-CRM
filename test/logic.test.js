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
  insert('appointments', { type: 'Park tour', title: 'Busy', start: `${tomorrow}T09:00`, end: `${tomorrow}T12:00`, status: 'Scheduled' });
  const { slots, duration } = L.suggestSlots({ type: 'Park tour', from: tomorrow });
  assert.equal(duration, 90);
  assert.equal(slots.length, 3);
  assert.ok(slots[0].start >= `${tomorrow}T12:15`, 'first slot respects the 15-minute buffer');
});

test('booking a park tour moves the deal to Appointment and creates prep and follow-up tasks', () => {
  const start = `${U.addDays(day, 2)}T10:30`;
  const id = L.createAppointment({ type: 'Park tour', start, contact_id: contactId });
  const a = get('appointments', id);
  assert.equal(a.end, `${U.addDays(day, 2)}T12:00`); // 90-minute presentation
  assert.equal(a.deal_id, dealId);
  assert.equal(get('deals', dealId).stage, 'Appointment');
  const auto = db.prepare('SELECT auto_key FROM tasks WHERE appointment_id = ? ORDER BY auto_key').all(id).map(r => r.auto_key);
  assert.deepEqual(auto, [`appt:${id}:follow`, `appt:${id}:prep`]);
  L.updateAppointment(id, { start: `${U.addDays(day, 4)}T14:00` });
  assert.equal(db.prepare('SELECT due_date FROM tasks WHERE auto_key = ?').get(`appt:${id}:follow`).due_date, U.addDays(day, 5));
  // Presentation given, quote but no payment yet, next step agreed -> Park Tour with the next step as the task.
  L.recordOutcome(id, { result: 'presented', outcome: 'Presentation given', quote_price: 54995, payment_type: 'None yet', next_steps: 'Call Friday about plot 42', next_step_date: U.addDays(day, 6) });
  const d = get('deals', dealId);
  assert.equal(d.stage, 'Park Tour');
  assert.equal(d.price, 54995);
  const next = db.prepare("SELECT * FROM tasks WHERE title = 'Next step: Call Friday about plot 42'").get();
  assert.equal(next.due_date, U.addDays(day, 6));
  assert.ok(!db.prepare("SELECT 1 FROM tasks WHERE title = 'Follow up on quote and next steps' AND deal_id = ?").get(dealId), 'no duplicate follow-up');
  assert.match(get('appointments', id).outcome, /quoted £54,995/);
});

test('taking a deposit moves the deal to Finance & Paperwork and reserves the home', () => {
  const c = insert('contacts', { first_name: 'Dee', last_name: 'Posit', finance_needed: 1 });
  const home = insert('homes', { make: 'Swift', model: 'Bordeaux', status: 'Available', price: 62495 });
  const id = L.createAppointment({ type: 'Park tour', start: `${U.addDays(day, 1)}T11:00`, contact_id: c });
  const dealOf = () => db.prepare('SELECT * FROM deals WHERE contact_id = ?').get(c);
  assert.equal(dealOf().stage, 'Appointment'); // a deal was created automatically for a contact with none
  L.recordOutcome(id, { result: 'presented', outcome: 'Presentation given', home_id: home, quote_price: 62495, payment_type: 'Deposit', payment_amount: 2000 });
  const d = dealOf();
  assert.equal(d.stage, 'Finance & Paperwork');
  assert.equal(d.payment_status, 'Deposit');
  assert.equal(d.deposit, 2000);
  assert.equal(get('homes', home).status, 'Reserved');
  const titles = db.prepare("SELECT title FROM tasks WHERE deal_id = ? AND status = 'Open'").all(d.id).map(t => t.title);
  assert.ok(titles.includes('Chase finance decision'));
  assert.ok(titles.includes('Send licence agreement'));
  assert.ok(titles.includes('Follow up on quote and next steps')); // passed through Park Tour with no next step given
  // Booking another appointment never moves it backwards.
  L.createAppointment({ type: 'Teams call', start: `${U.addDays(day, 3)}T15:00`, contact_id: c });
  assert.equal(dealOf().stage, 'Finance & Paperwork');
  // Booking the handover moves it on; keys handed over completes it.
  const h = L.createAppointment({ type: 'Handover', start: `${U.addDays(day, 20)}T10:00`, contact_id: c });
  assert.equal(dealOf().stage, 'Siting & Handover');
  L.recordOutcome(h, { outcome: 'Keys handed over' });
  assert.equal(dealOf().stage, 'Completed');
  assert.equal(get('contacts', c).type, 'Owner');
});

test('park not right for the customer closes the deal as Lost', () => {
  const c = insert('contacts', { first_name: 'Not', last_name: 'Right' });
  const id = L.createAppointment({ type: 'Park tour', start: `${U.addDays(day, 1)}T14:00`, contact_id: c });
  L.recordOutcome(id, { result: 'not_right', outcome: 'Park not right for customer' });
  const d = db.prepare('SELECT * FROM deals WHERE contact_id = ?').get(c);
  assert.equal(d.stage, 'Lost');
  assert.equal(d.lost_reason, 'Park not right for customer');
  assert.equal(get('contacts', c).lead_status, 'Lost');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tasks WHERE contact_id = ? AND status = 'Open'").get(c).n, 0);
});

test('a no-show keeps the deal at Appointment and adds a rebook call', () => {
  const c = insert('contacts', { first_name: 'No', last_name: 'Show' });
  const id = L.createAppointment({ type: 'Park tour', start: `${U.addDays(day, 1)}T16:00`, contact_id: c });
  L.recordOutcome(id, { result: 'no_show', outcome: 'Did not attend' });
  assert.equal(db.prepare('SELECT stage FROM deals WHERE contact_id = ?').get(c).stage, 'Appointment');
  assert.ok(db.prepare("SELECT 1 FROM tasks WHERE auto_key = ? AND status = 'Open'").get(`appt:${id}:rebook`));
});

test('a quick phone call does not move a lead into the pipeline', () => {
  const c = insert('contacts', { first_name: 'Phone', last_name: 'Only' });
  const d = insert('deals', { contact_id: c, stage: 'Enquiry' });
  L.createAppointment({ type: 'Phone call', start: `${U.addDays(day, 1)}T09:15`, contact_id: c });
  assert.equal(get('deals', d).stage, 'Enquiry');
});

test('recording a payment on the deal later also moves it to Finance & Paperwork', () => {
  const c = insert('contacts', { first_name: 'Later', last_name: 'Payer' });
  const d = insert('deals', { contact_id: c, stage: 'Park Tour' });
  L.paymentRecorded(d, 'Paid in full');
  assert.equal(get('deals', d).stage, 'Finance & Paperwork');
});

test('databases from the earlier version are migrated to the new stages', async () => {
  const D = require('../server/db');
  const bytes = D.exportBytes();
  const c = insert('contacts', { first_name: 'Old', last_name: 'Stages' });
  const ids = ['Viewing booked', 'Viewed', 'Proposal', 'Reserved', 'Finance and paperwork', 'Siting and handover'].map(st => insert('deals', { contact_id: c, stage: st }));
  insert('appointments', { type: 'Viewing', title: 'Old', start: `${day}T09:00`, end: `${day}T10:00`, contact_id: c });
  db.prepare("INSERT INTO settings(key, value) VALUES('durations', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ Viewing: 60, Handover: 90 }));
  await D.open(D.exportBytes());
  assert.deepEqual(ids.map(id => get('deals', id).stage), ['Appointment', 'Park Tour', 'Park Tour', 'Finance & Paperwork', 'Finance & Paperwork', 'Siting & Handover']);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM appointments WHERE type = 'Viewing'").get().n, 0);
  assert.equal(D.getSettings().durations['Park tour'], 90);
  void bytes;
});

test('cancelling a park tour drops its auto tasks and creates a rebook task', () => {
  const id = L.createAppointment({ type: 'Park tour', start: `${U.addDays(day, 6)}T10:00`, contact_id: contactId });
  L.cancelAppointment(id, { message: 'Car trouble' });
  assert.equal(get('appointments', id).status, 'Cancelled');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tasks WHERE appointment_id = ? AND status = 'Open'").get(id).n, 0);
  assert.ok(db.prepare('SELECT 1 FROM tasks WHERE auto_key = ?').get(`appt:${id}:rebook`));
});

test('completing a deal turns the buyer into an owner', () => {
  const plot = insert('plots', { plot_number: '42' });
  const home = insert('homes', { make: 'Willerby', model: 'Sierra', status: 'Available', plot_id: plot });
  const d = insert('deals', { contact_id: contactId, stage: 'Siting & Handover', home_id: home, plot_id: plot });
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
