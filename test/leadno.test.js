'use strict';
// Lead numbers: issued automatically, unique, never reused, never removed.
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parkpilot-leadno-'));
process.env.PARKPILOT_DATA = dir;
const test = require('node:test');
const assert = require('node:assert');
const D = require('../server/db');
const importer = require('../server/importer');

const no = id => D.get('contacts', id).lead_no;

test('an older database is tidied up: missing and shared numbers are fixed, old ones kept', async () => {
  // Build a database the way the previous version left it: no rule, some blanks, one shared number.
  await D.open();
  D.db.exec('DROP INDEX ux_contacts_lead_no; DROP TRIGGER trg_lead_no_issue; DROP TRIGGER trg_lead_no_seen_insert; DROP TRIGGER trg_lead_no_seen_update; DROP TRIGGER trg_lead_no_keep; DELETE FROM counters;');
  const a = D.insert('contacts', { first_name: 'Old', last_name: 'One', lead_no: 'L000010949' });
  const b = D.insert('contacts', { first_name: 'No', last_name: 'Number' });
  const c = D.insert('contacts', { first_name: 'Blank', last_name: 'Number', lead_no: '  ' });
  const d = D.insert('contacts', { first_name: 'Same', last_name: 'Number', lead_no: 'L000010949' });
  const bytes = D.exportBytes();
  await D.open(bytes); // migrates
  assert.equal(no(a), 'L000010949', 'imported numbers are kept');
  assert.equal(no(b), 'PP000001');
  assert.equal(no(c), 'PP000002');
  assert.equal(no(d), 'PP000003', 'the newer record sharing a number gets its own');
  assert.ok(D.db.prepare("SELECT 1 FROM interactions WHERE contact_id = ? AND summary LIKE '%L000010949 was also used%'").get(d));
  // Opening again changes nothing.
  await D.open(D.exportBytes());
  assert.equal(no(d), 'PP000003');
});

test('every new lead gets the next number, however it is added', () => {
  const x = D.insert('contacts', { first_name: 'New', last_name: 'Lead' });
  assert.equal(no(x), 'PP000004');
  const r = importer.importRows([['First Name', 'Last Name', 'No'], ['Imp', 'NoNumber', ''], ['Imp', 'WithNumber', 'L000020000']]);
  assert.equal(r.created, 2);
  assert.equal(D.db.prepare("SELECT lead_no FROM contacts WHERE last_name = 'NoNumber'").get().lead_no, 'PP000005');
  assert.equal(D.db.prepare("SELECT lead_no FROM contacts WHERE last_name = 'WithNumber'").get().lead_no, 'L000020000');
});

test('numbers are never shared, removed or reused', () => {
  const x = D.insert('contacts', { first_name: 'Del', last_name: 'Eted' });
  assert.equal(no(x), 'PP000006');
  D.db.prepare('DELETE FROM contacts WHERE id = ?').run(x);
  assert.equal(no(D.insert('contacts', { first_name: 'After', last_name: 'Delete' })), 'PP000007', 'a deleted number is not reused');
  assert.throws(() => D.insert('contacts', { first_name: 'Dup', last_name: 'Licate', lead_no: 'PP000007' }), /UNIQUE/);
  const y = D.insert('contacts', { first_name: 'Keep', last_name: 'Mine' });
  assert.throws(() => D.db.prepare('UPDATE contacts SET lead_no = NULL WHERE id = ?').run(y), /can’t be removed/);
  // A PP number arriving from elsewhere moves the series on past it.
  D.insert('contacts', { first_name: 'High', last_name: 'Number', lead_no: 'PP000050' });
  assert.equal(no(D.insert('contacts', { first_name: 'Next', last_name: 'One' })), 'PP000051');
  const all = D.db.prepare('SELECT lead_no FROM contacts').all().map(r => r.lead_no);
  assert.equal(new Set(all).size, all.length);
  assert.ok(all.every(Boolean));
});

test.after(() => { D.db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
