'use strict';
// Run with:  node --test test/
// Uses a throwaway database so your real data is never touched.
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parkpilot-test-'));
process.env.PARKPILOT_DATA = dir;

const test = require('node:test');
const assert = require('node:assert');
const { db, open, insert, get, setSetting, setState } = require('../server/db');
const L = require('../server/logic');
const U = require('../server/util');

const day = U.today();
let contactId, dealId;
test.before(async () => {
  await open();
  contactId = insert('contacts', { first_name: 'Test', last_name: 'Buyer', company: 'Seaview Holiday Park', units: 140, email: 'buyer@example.com', mobile: '07700900123', phone_e164: '+447700900123', lead_status: 'New' });
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
  insert('appointments', { type: 'Demo', title: 'Busy', start: `${tomorrow}T09:00`, end: `${tomorrow}T12:00`, status: 'Scheduled' });
  const { slots, duration } = L.suggestSlots({ type: 'Demo', from: tomorrow });
  assert.equal(duration, 30);
  assert.equal(slots.length, 3);
  assert.ok(slots[0].start >= `${tomorrow}T12:15`, 'first slot respects the 15-minute buffer');
});

test('booking a demo moves the deal to Demo booked, sets up Google Meet and creates prep and follow-up tasks', () => {
  const start = `${U.addDays(day, 2)}T10:30`;
  const id = L.createAppointment({ type: 'Demo', start, contact_id: contactId });
  const a = get('appointments', id);
  assert.equal(a.end, `${U.addDays(day, 2)}T11:00`); // 30-minute demo
  assert.equal(a.is_remote, 1);
  assert.equal(a.location, 'Google Meet');
  assert.equal(a.deal_id, dealId);
  assert.equal(get('deals', dealId).stage, 'Demo booked');
  const auto = db.prepare('SELECT auto_key FROM tasks WHERE appointment_id = ? ORDER BY auto_key').all(id).map(r => r.auto_key);
  assert.deepEqual(auto, [`appt:${id}:follow`, `appt:${id}:prep`]);
  L.updateAppointment(id, { start: `${U.addDays(day, 4)}T14:00` });
  assert.equal(db.prepare('SELECT due_date FROM tasks WHERE auto_key = ?').get(`appt:${id}:follow`).due_date, U.addDays(day, 5));
  // Demo held, interested in AI Professional, next step agreed -> Demo held with the next step as the task.
  L.recordOutcome(id, { result: 'held', outcome: 'Demo held', product: 'ParkPilot AI', plan: 'Professional', monthly: 995, next_steps: 'Send proposal and case study', next_step_date: U.addDays(day, 6) });
  const d = get('deals', dealId);
  assert.equal(d.stage, 'Demo held');
  assert.equal(d.deal_type, 'ParkPilot AI');
  assert.equal(d.plan, 'Professional');
  assert.equal(d.price, 995);
  const next = db.prepare("SELECT * FROM tasks WHERE title = 'Next step: Send proposal and case study'").get();
  assert.equal(next.due_date, U.addDays(day, 6));
  assert.ok(!db.prepare("SELECT 1 FROM tasks WHERE title = 'Send proposal' AND deal_id = ?").get(dealId), 'no duplicate stage task');
  assert.match(get('appointments', id).outcome, /£995\/month/);
});

test('a demo with the proposal sent goes to Proposal sent; winning makes them a customer with onboarding tasks', () => {
  const c = insert('contacts', { first_name: 'Dee', last_name: 'Mo', company: 'Lakeside Lodges', interest: 'ParkPilot CRM' });
  const id = L.createAppointment({ type: 'Demo', start: `${U.addDays(day, 1)}T11:00`, contact_id: c });
  const dealOf = () => db.prepare('SELECT * FROM deals WHERE contact_id = ?').get(c);
  assert.equal(dealOf().stage, 'Demo booked'); // a deal was created automatically for a contact with none
  assert.equal(dealOf().deal_type, 'ParkPilot CRM'); // from what they were interested in
  L.recordOutcome(id, { result: 'held', outcome: 'Demo held', plan: 'Professional', monthly: 299, proposal_sent: true });
  const d = dealOf();
  assert.equal(d.stage, 'Proposal sent');
  assert.equal(d.furthest_stage, 'Proposal sent');
  assert.ok(d.reserved_at);
  const titles = () => db.prepare("SELECT title FROM tasks WHERE deal_id = ? AND status = 'Open'").all(d.id).map(t => t.title);
  assert.ok(titles().includes('Follow up on proposal'));
  // Booking another call never moves it backwards.
  L.createAppointment({ type: 'Follow-up call', start: `${U.addDays(day, 3)}T15:00`, contact_id: c });
  assert.equal(dealOf().stage, 'Proposal sent');
  L.setDealStage(d.id, 'Won');
  assert.equal(dealOf().stage, 'Won');
  assert.ok(dealOf().completed_at);
  assert.equal(get('contacts', c).type, 'Customer');
  assert.equal(get('contacts', c).lead_status, 'Customer');
  assert.ok(titles().includes('Kick off onboarding and introduce their account manager'));
});

test('not a fit closes the deal as Lost', () => {
  const c = insert('contacts', { first_name: 'Not', last_name: 'Fit' });
  const id = L.createAppointment({ type: 'Demo', start: `${U.addDays(day, 1)}T14:00`, contact_id: c });
  L.recordOutcome(id, { result: 'not_fit', outcome: 'Not a fit' });
  const d = db.prepare('SELECT * FROM deals WHERE contact_id = ?').get(c);
  assert.equal(d.stage, 'Lost');
  assert.equal(d.lost_reason, 'Not a fit');
  assert.equal(get('contacts', c).lead_status, 'Lost');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tasks WHERE contact_id = ? AND status = 'Open'").get(c).n, 0);
});

test('a no-show keeps the deal at Demo booked and adds a rebook call', () => {
  const c = insert('contacts', { first_name: 'No', last_name: 'Show' });
  const id = L.createAppointment({ type: 'Demo', start: `${U.addDays(day, 1)}T16:00`, contact_id: c });
  L.recordOutcome(id, { result: 'no_show', outcome: 'Did not attend' });
  assert.equal(db.prepare('SELECT stage FROM deals WHERE contact_id = ?').get(c).stage, 'Demo booked');
  assert.ok(db.prepare("SELECT 1 FROM tasks WHERE auto_key = ? AND status = 'Open'").get(`appt:${id}:rebook`));
});

test('a discovery call does not move a lead along, and is a phone call by default', () => {
  const c = insert('contacts', { first_name: 'Phone', last_name: 'Only' });
  const d = insert('deals', { contact_id: c, stage: 'Enquiry' });
  const id = L.createAppointment({ type: 'Discovery call', start: `${U.addDays(day, 1)}T09:15`, contact_id: c });
  assert.equal(get('deals', d).stage, 'Enquiry');
  assert.equal(get('appointments', id).location, 'Phone');
  assert.equal(get('appointments', id).is_remote, 0);
});

test('the funnel counts how far deals got, including lost ones', () => {
  const f = L.funnel('all');
  const by = Object.fromEntries(f.stages.map(s => [s.stage, s]));
  assert.deepEqual(f.stages.map(s => s.stage), ['Enquiry', 'Demo booked', 'Demo held', 'Proposal sent', 'Won']);
  for (let i = 1; i < f.stages.length; i++) assert.ok(f.stages[i].reached <= f.stages[i - 1].reached);
  assert.equal(by.Enquiry.reached, f.total);
  // The "not a fit" deal was lost after reaching Demo booked: still counted there.
  const nf = db.prepare("SELECT * FROM deals WHERE lost_reason = 'Not a fit'").get();
  assert.equal(nf.furthest_stage, 'Demo booked');
  assert.ok(f.topLost.some(l => l.reason === 'Not a fit'));
  assert.ok(by.Won.reached >= 1);
  assert.equal(by['Proposal sent'].conversion, Math.round(100 * by['Proposal sent'].reached / by['Demo held'].reached));
  const leads = db.prepare("SELECT COUNT(*) n FROM contacts WHERE type <> 'Partner'").get().n;
  assert.equal(f.total, leads);
  const before = L.funnel('all').total;
  insert('contacts', { first_name: 'Brand', last_name: 'New', enquiry_date: day + 'T10:00' });
  insert('contacts', { first_name: 'Old', last_name: 'Lead', enquiry_date: '2023-03-01T10:00' });
  assert.equal(L.funnel('all').total, before + 2);
  assert.equal(L.funnel('30').stages[0].reached, L.funnel('30').total);
  assert.ok(L.funnel('30').total < L.funnel('all').total);
});

test('databases from the holiday-home portal are mapped onto the ParkPilot stages', async () => {
  const D = require('../server/db');
  const c = insert('contacts', { first_name: 'Old', last_name: 'Stages', type: 'Owner' });
  const ids = ['Appointment', 'Park Tour', 'Finance & Paperwork', 'Siting & Handover', 'Completed'].map(st => insert('deals', { contact_id: c, stage: st }));
  insert('appointments', { type: 'Park tour', title: 'Old', start: `${day}T09:00`, end: `${day}T10:00`, contact_id: c });
  db.prepare("INSERT INTO settings(key, value) VALUES('durations', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify({ 'Park tour': 90, Handover: 90 }));
  await D.open(D.exportBytes());
  assert.deepEqual(ids.map(id => get('deals', id).stage), ['Demo booked', 'Demo held', 'Proposal sent', 'Proposal sent', 'Won']);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM appointments WHERE type = 'Park tour'").get().n, 0);
  assert.equal(D.getSettings().durations.Demo, 30);
  assert.equal(get('contacts', c).type, 'Customer');
});

test('cancelling a demo drops its auto tasks and creates a rebook task', () => {
  const id = L.createAppointment({ type: 'Demo', start: `${U.addDays(day, 6)}T10:00`, contact_id: contactId });
  L.cancelAppointment(id, { message: 'Clash with a park event' });
  assert.equal(get('appointments', id).status, 'Cancelled');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tasks WHERE appointment_id = ? AND status = 'Open'").get(id).n, 0);
  assert.ok(db.prepare('SELECT 1 FROM tasks WHERE auto_key = ?').get(`appt:${id}:rebook`));
});

test('ParkPilot plans carry the published list prices', () => {
  assert.equal(L.PLANS['ParkPilot AI'].find(p => p.name === 'Professional').monthly, 995);
  assert.equal(L.PLANS['ParkPilot CRM'].find(p => p.name === 'Essentials').annual, 124);
  assert.ok(L.PRODUCTS.includes('AI + CRM'));
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
