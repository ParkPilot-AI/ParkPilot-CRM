'use strict';
// Database layer: SQLite compiled to WebAssembly (sql.js), held in memory and persisted
// as one file by store.js (a Netlify Blobs entry in production). `db` keeps the same small API the
// rest of the code uses: db.prepare(sql).run/get/all(...args) and db.exec(sql).
const initSqlJs = require('sql.js');
const { nowStamp } = require('./util');

let SQL = null;
let current = null;

function norm(args) {
  return args.map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
}

class Statement {
  constructor(sql) { this.sql = sql; }
  _prep(args) { const st = current.prepare(this.sql); if (args.length) st.bind(norm(args)); return st; }
  run(...args) {
    const st = this._prep(args);
    try { st.step(); } finally { st.free(); }
    const changes = current.getRowsModified();
    const r = current.exec('SELECT last_insert_rowid() AS id');
    return { changes, lastInsertRowid: r.length ? r[0].values[0][0] : 0 };
  }
  get(...args) {
    const st = this._prep(args);
    try { return st.step() ? st.getAsObject() : undefined; } finally { st.free(); }
  }
  all(...args) {
    const st = this._prep(args), out = [];
    try { while (st.step()) out.push(st.getAsObject()); } finally { st.free(); }
    return out;
  }
}

const db = {
  prepare: sql => new Statement(sql),
  exec: sql => { current.exec(sql); },
  close: () => { if (current) current.close(); current = null; },
  get ready() { return !!current; }
};

async function init() { if (!SQL) SQL = await initSqlJs(); return SQL; }

// Opens a database from bytes (or a new empty one) and makes it the current one.
async function open(bytes) {
  await init();
  if (current) { try { current.close(); } catch { /* already closed */ } }
  current = bytes ? new SQL.Database(new Uint8Array(bytes)) : new SQL.Database();
  current.exec('PRAGMA foreign_keys = ON;');
  current.exec(SCHEMA);
  txDepth = 0;
  for (const k of Object.keys(columnsCache)) { delete columnsCache[k]; delete notNullCache[k]; }
  migrate();
  return db;
}
// Brings databases saved by earlier versions up to date. Every step is safe to run repeatedly.
function migrate() {
  const cols = t => (current.exec(`PRAGMA table_info(${t})`)[0] || { values: [] }).values.map(r => r[1]);
  if (!cols('deals').includes('payment_status')) current.exec('ALTER TABLE deals ADD COLUMN payment_status TEXT');
  // The furthest stage a deal has reached (kept when it is lost), used to draw the sales funnel.
  if (!cols('deals').includes('furthest_stage')) current.exec('ALTER TABLE deals ADD COLUMN furthest_stage TEXT');
  // ParkPilot pipeline: Enquiry > Demo booked > Demo held > Proposal sent > Won (or Lost).
  // Databases started from the holiday-home portal are mapped across.
  const stageMap = `CASE %s WHEN 'Appointment' THEN 'Demo booked' WHEN 'Viewing booked' THEN 'Demo booked'
      WHEN 'Park Tour' THEN 'Demo held' WHEN 'Viewed' THEN 'Demo held' WHEN 'Proposal' THEN 'Proposal sent'
      WHEN 'Finance & Paperwork' THEN 'Proposal sent' WHEN 'Reserved' THEN 'Proposal sent' WHEN 'Siting & Handover' THEN 'Proposal sent'
      WHEN 'Completed' THEN 'Won' ELSE %s END`;
  const oldStages = "('Appointment','Viewing booked','Park Tour','Viewed','Proposal','Finance & Paperwork','Reserved','Siting & Handover','Completed')";
  current.exec(`UPDATE deals SET stage = ${stageMap.replace(/%s/g, 'stage')} WHERE stage IN ${oldStages}`);
  current.exec(`UPDATE deals SET furthest_stage = ${stageMap.replace(/%s/g, 'furthest_stage')} WHERE furthest_stage IN ${oldStages}`);
  current.exec(`UPDATE appointments SET type = CASE type WHEN 'Park tour' THEN 'Demo' WHEN 'Viewing' THEN 'Demo' WHEN 'Teams call' THEN 'Demo'
      WHEN 'Phone call' THEN 'Discovery call' WHEN 'Handover' THEN 'Onboarding call' ELSE 'Site visit' END
    WHERE type IN ('Park tour','Viewing','Teams call','Phone call','Handover','Part-ex valuation','Finance meeting')`);
  current.exec("UPDATE deals SET furthest_stage = stage WHERE furthest_stage IS NULL AND stage <> 'Lost'");
  current.exec("UPDATE contacts SET type = 'Customer' WHERE type = 'Owner'");
  current.exec("DELETE FROM settings WHERE key IN ('durations','todoMirror','officeLocation') AND value LIKE '%Park tour%'");
  const add = (t, c, def) => { if (!cols(t).includes(c)) current.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };
  // A sales team ("parks" in the code are sales teams). Leads belong to a team and, once allocated, to a person.
  add('contacts', 'park_id', 'INTEGER'); add('contacts', 'owner_id', 'INTEGER'); add('contacts', 'assigned_at', 'TEXT');
  add('tasks', 'owner_id', 'INTEGER'); add('tasks', 'todo_user_id', 'INTEGER');
  add('appointments', 'owner_id', 'INTEGER'); add('outlook_events', 'user_id', 'INTEGER');
  add('homes', 'park_id', 'INTEGER'); add('plots', 'park_id', 'INTEGER');
  add('deals', 'reserved_at', 'TEXT'); add('deals', 'completed_at', 'TEXT');
  // ParkPilot: who the lead is (a park operator) and what they might buy.
  for (const c of ['company', 'job_title', 'region', 'website', 'interest', 'current_systems']) add('contacts', c, 'TEXT');
  add('contacts', 'units', 'INTEGER'); add('contacts', 'sites', 'INTEGER');
  add('deals', 'plan', 'TEXT'); add('deals', 'billing', 'TEXT'); add('deals', 'sites', 'INTEGER'); add('deals', 'expected_close', 'TEXT');
  add('interactions', 'link', 'TEXT');
  current.exec(`CREATE INDEX IF NOT EXISTS ix_contacts_owner ON contacts(owner_id);
    CREATE INDEX IF NOT EXISTS ix_contacts_park ON contacts(park_id, owner_id);
    CREATE INDEX IF NOT EXISTS ix_tasks_owner ON tasks(owner_id, status, due_date);
    CREATE INDEX IF NOT EXISTS ix_appts_owner ON appointments(owner_id, start);
    CREATE INDEX IF NOT EXISTS ix_oe_user ON outlook_events(user_id, start);`);
  if (!current.exec('SELECT 1 FROM parks LIMIT 1').length) {
    const t = nowStamp();
    const st = current.prepare('INSERT INTO parks(name, created_at, updated_at) VALUES(?, ?, ?)'); st.run(['ParkPilot', t, t]); st.free();
  }
  for (const t of ['contacts', 'homes', 'plots']) current.exec(`UPDATE ${t} SET park_id = (SELECT MIN(id) FROM parks) WHERE park_id IS NULL`);
  // reserved_at: when a proposal first went out; completed_at: when the deal was won.
  current.exec(`UPDATE deals SET reserved_at = COALESCE(stage_changed_at, updated_at) WHERE reserved_at IS NULL
                AND furthest_stage IN ('Proposal sent','Won')`);
  current.exec("UPDATE deals SET completed_at = COALESCE(stage_changed_at, updated_at) WHERE completed_at IS NULL AND stage = 'Won'");
  leadNumbers();
}

// Every lead has its own lead number. Leads imported from another system keep theirs;
// leads added here get the next PP number (PP000001, PP000002, …), a separate series so they
// can never clash with imported numbers. Numbers carry on from the highest ever issued,
// so one is never reused even after a lead is deleted. The database refuses duplicates, and triggers
// number any lead added without one, whichever way it arrives (typed in, imported, created from a search).
const LEAD_RE = "GLOB 'PP[0-9]*'";
function leadNumbers() {
  const one = sql => { const r = current.exec(sql); return r.length ? r[0].values[0][0] : null; };
  const run = (sql, args = []) => { const st = current.prepare(sql); try { st.run(args); } finally { st.free(); } };
  current.exec(`CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
    INSERT OR IGNORE INTO counters(name, value) VALUES('lead_no', 0);`);
  const highest = Number(one(`SELECT COALESCE(MAX(CAST(substr(lead_no, 3) AS INTEGER)), 0) FROM contacts WHERE lead_no ${LEAD_RE}`)) || 0;
  run("UPDATE counters SET value = MAX(value, ?) WHERE name = 'lead_no'", [highest]);
  const hasIndex = one("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'ux_contacts_lead_no'");
  if (!hasIndex) {
    // Tidy up before the rule is switched on: blanks become missing, and if a number is shared the
    // oldest record keeps it and the others are given new ones (noted on their timeline).
    current.exec("UPDATE contacts SET lead_no = NULL WHERE lead_no IS NOT NULL AND trim(lead_no) = ''");
    current.exec("UPDATE contacts SET lead_no = trim(lead_no) WHERE lead_no <> trim(lead_no)");
    const shared = current.exec(`SELECT c.id, c.lead_no FROM contacts c WHERE c.lead_no IS NOT NULL
      AND EXISTS (SELECT 1 FROM contacts o WHERE o.lead_no = c.lead_no AND o.id < c.id) ORDER BY c.id`);
    const now = nowStamp();
    for (const [id, old] of shared.length ? shared[0].values : []) {
      run('UPDATE contacts SET lead_no = NULL WHERE id = ?', [id]);
      run("INSERT INTO interactions(contact_id, type, at, summary, created_at) VALUES(?, 'Note', ?, ?, ?)",
        [id, now.slice(0, 16), `Lead number ${old} was also used by another record, so this one was given a new number.`, now]);
    }
  }
  // Number every lead that hasn't got one, oldest first.
  const missing = current.exec('SELECT id FROM contacts WHERE lead_no IS NULL ORDER BY COALESCE(enquiry_date, created_at), id');
  for (const [id] of missing.length ? missing[0].values : []) {
    run("UPDATE counters SET value = value + 1 WHERE name = 'lead_no'");
    run("UPDATE contacts SET lead_no = 'PP' || printf('%06d', (SELECT value FROM counters WHERE name = 'lead_no')) WHERE id = ?", [id]);
  }
  current.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_contacts_lead_no ON contacts(lead_no);
    CREATE TRIGGER IF NOT EXISTS trg_lead_no_issue AFTER INSERT ON contacts WHEN NEW.lead_no IS NULL OR trim(NEW.lead_no) = ''
    BEGIN
      UPDATE counters SET value = value + 1 WHERE name = 'lead_no';
      UPDATE contacts SET lead_no = 'PP' || printf('%06d', (SELECT value FROM counters WHERE name = 'lead_no')) WHERE id = NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS trg_lead_no_seen_insert AFTER INSERT ON contacts WHEN NEW.lead_no ${LEAD_RE}
    BEGIN UPDATE counters SET value = MAX(value, CAST(substr(NEW.lead_no, 3) AS INTEGER)) WHERE name = 'lead_no'; END;
    CREATE TRIGGER IF NOT EXISTS trg_lead_no_seen_update AFTER UPDATE OF lead_no ON contacts WHEN NEW.lead_no ${LEAD_RE}
    BEGIN UPDATE counters SET value = MAX(value, CAST(substr(NEW.lead_no, 3) AS INTEGER)) WHERE name = 'lead_no'; END;
    CREATE TRIGGER IF NOT EXISTS trg_lead_no_keep BEFORE UPDATE OF lead_no ON contacts WHEN NEW.lead_no IS NULL OR trim(NEW.lead_no) = ''
    BEGIN SELECT RAISE(ABORT, 'A lead number can’t be removed'); END;`);
}

function exportBytes() { return current.export(); }
function totalChanges() { const r = current.exec('SELECT total_changes()'); return r[0].values[0][0]; }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  lead_no TEXT, external_id TEXT UNIQUE,
  type TEXT NOT NULL DEFAULT 'Prospect',
  first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '',
  mobile TEXT, phone_e164 TEXT, email TEXT, address TEXT, postcode TEXT,
  lead_source TEXT, lead_status TEXT NOT NULL DEFAULT 'New',
  budget INTEGER, bedrooms TEXT, finance_needed INTEGER NOT NULL DEFAULT 0,
  consent_email INTEGER NOT NULL DEFAULT 0, consent_sms INTEGER NOT NULL DEFAULT 0,
  consent_post INTEGER NOT NULL DEFAULT 0, consent_date TEXT,
  preferences TEXT, enquiry_date TEXT, last_contact_at TEXT,
  dup_group TEXT, dup_dismissed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_contacts_name ON contacts(last_name, first_name);
CREATE INDEX IF NOT EXISTS ix_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS ix_contacts_phone ON contacts(phone_e164);
CREATE INDEX IF NOT EXISTS ix_contacts_status ON contacts(lead_status);

CREATE TABLE IF NOT EXISTS plots (
  id INTEGER PRIMARY KEY, plot_number TEXT NOT NULL, area TEXT, outlook TEXT,
  pitch_fee INTEGER, status TEXT NOT NULL DEFAULT 'Vacant', notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS homes (
  id INTEGER PRIMARY KEY, make TEXT, model TEXT, year INTEGER, size TEXT, bedrooms INTEGER,
  condition TEXT, status TEXT NOT NULL DEFAULT 'Available', price INTEGER,
  owner_contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  plot_id INTEGER REFERENCES plots(id) ON DELETE SET NULL,
  licence_expiry TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  home_id INTEGER REFERENCES homes(id) ON DELETE SET NULL,
  plot_id INTEGER REFERENCES plots(id) ON DELETE SET NULL,
  deal_type TEXT NOT NULL DEFAULT 'New sale', stage TEXT NOT NULL DEFAULT 'Enquiry',
  price INTEGER, part_ex_allowance INTEGER, deposit INTEGER, finance_status TEXT,
  target_handover TEXT, lost_reason TEXT, notes TEXT,
  stage_changed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_deals_contact ON deals(contact_id);
CREATE INDEX IF NOT EXISTS ix_deals_stage ON deals(stage);

CREATE TABLE IF NOT EXISTS valuations (
  id INTEGER PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  home_id INTEGER REFERENCES homes(id) ON DELETE SET NULL,
  description TEXT, condition_grade TEXT, offered_value INTEGER, valid_until TEXT,
  within_age_policy INTEGER NOT NULL DEFAULT 1, notes TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL,
  start TEXT NOT NULL, end TEXT NOT NULL, location TEXT, is_remote INTEGER NOT NULL DEFAULT 0,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  home_id INTEGER REFERENCES homes(id) ON DELETE SET NULL,
  notes TEXT, outcome TEXT, status TEXT NOT NULL DEFAULT 'Scheduled',
  outlook_event_id TEXT, ical_uid TEXT, change_key TEXT, teams_url TEXT,
  sync_status TEXT NOT NULL DEFAULT 'Local', sync_error TEXT, sync_attempts INTEGER NOT NULL DEFAULT 0,
  needs_review INTEGER NOT NULL DEFAULT 0, conflict_note TEXT, send_invite INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_appts_start ON appointments(start);
CREATE INDEX IF NOT EXISTS ix_appts_contact ON appointments(contact_id);
CREATE INDEX IF NOT EXISTS ix_appts_event ON appointments(outlook_event_id);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Follow-up', priority TEXT NOT NULL DEFAULT 'Medium',
  due_date TEXT, due_time TEXT, original_due_date TEXT,
  status TEXT NOT NULL DEFAULT 'Open', completed_at TEXT,
  rollover_count INTEGER NOT NULL DEFAULT 0, last_rolled_on TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0, drop_reason TEXT, notes TEXT,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  auto_key TEXT, todo_id TEXT, todo_hash TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_tasks_due ON tasks(status, due_date);
CREATE INDEX IF NOT EXISTS ix_tasks_contact ON tasks(contact_id);

CREATE TABLE IF NOT EXISTS interactions (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  type TEXT NOT NULL, at TEXT NOT NULL, summary TEXT NOT NULL,
  appointment_id INTEGER, task_id INTEGER, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_inter_contact ON interactions(contact_id, at);

CREATE TABLE IF NOT EXISTS outlook_events (
  id TEXT PRIMARY KEY, subject TEXT, start TEXT, end TEXT, is_all_day INTEGER, show_as TEXT,
  is_cancelled INTEGER, change_key TEXT, ical_uid TEXT, appointment_id INTEGER, attendees TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_oe_start ON outlook_events(start);

CREATE TABLE IF NOT EXISTS parks (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, role TEXT NOT NULL DEFAULT 'exec',
  park_id INTEGER, active INTEGER NOT NULL DEFAULT 1, funnel_period TEXT, last_seen_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS job_log (id INTEGER PRIMARY KEY, job TEXT, at TEXT, detail TEXT);
`;

const DEFAULT_SETTINGS = {
  openingHours: { start: '09:00', end: '17:30' },
  closedDays: [0, 6],        // 0 = Sun … 6 = Sat; weekends closed by default
  durations: { 'Demo': 30, 'Discovery call': 15, 'Follow-up call': 15, 'Site visit': 90, 'Onboarding call': 45 },
  bufferMinutes: 15,
  escalateAfter: 3,
  reviewAfter: 5,
  rolloverTime: '02:15',
  activeLeadDays: 90,
  funnelPeriod: '90',
  officeLocation: 'At the park',
  gmailLabel: 'CRM Leads',      // put this Gmail label on an email to turn it into a lead
  gmailDoneLabel: 'CRM Imported', // the CRM moves imported emails to this label
  gmailSkippedLabel: 'CRM Not imported', // emails with no name or contact details go here instead
  ownDomains: '',               // extra email domains that are yours (never treated as a lead)
  replyTask: true,              // add a "Reply to …" task for each new email
  calendarSync: true            // put appointments in your Google Calendar
};

function getSettings() {
  const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* ignore bad row */ }
  }
  return out;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}
function getState(key) { const r = db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key); return r ? JSON.parse(r.value) : null; }
function setState(key, value) {
  if (value === null || value === undefined) return db.prepare('DELETE FROM sync_state WHERE key = ?').run(key);
  db.prepare('INSERT INTO sync_state(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}
function logJob(job, detail) {
  db.prepare('INSERT INTO job_log(job, at, detail) VALUES(?, ?, ?)').run(job, nowStamp(), typeof detail === 'string' ? detail : JSON.stringify(detail));
  db.exec('DELETE FROM job_log WHERE id NOT IN (SELECT id FROM job_log ORDER BY id DESC LIMIT 500)');
}

// Re-entrant transactions: the outermost call is a real transaction, inner ones are savepoints.
let txDepth = 0;
function tx(fn) {
  const sp = `sp${txDepth}`;
  db.exec(txDepth === 0 ? 'BEGIN' : `SAVEPOINT ${sp}`);
  txDepth++;
  try {
    const r = fn();
    txDepth--;
    db.exec(txDepth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    txDepth--;
    db.exec(txDepth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
}

// Generic insert/update helpers restricted to known columns.
const columnsCache = {}, notNullCache = {};
function columns(table) {
  if (!columnsCache[table]) {
    const info = db.prepare(`PRAGMA table_info(${table})`).all();
    columnsCache[table] = info.map(c => c.name);
    notNullCache[table] = new Set(info.filter(c => c.notnull).map(c => c.name));
  }
  return columnsCache[table];
}
function clean(table, obj) {
  const cols = columns(table), out = {};
  for (const k of Object.keys(obj || {})) {
    if (k === 'id' || !cols.includes(k)) continue;
    let v = obj[k];
    if (v === '' && !notNullCache[table].has(k)) v = null;
    if ((v === null || v === undefined) && notNullCache[table].has(k)) continue; // let the column default apply
    if (typeof v === 'boolean') v = v ? 1 : 0;
    out[k] = v === undefined ? null : v;
  }
  return out;
}
function insert(table, obj) {
  const now = nowStamp();
  const data = clean(table, obj);
  const cols = columns(table);
  if (cols.includes('created_at') && !data.created_at) data.created_at = now;
  if (cols.includes('updated_at')) data.updated_at = now;
  const keys = Object.keys(data);
  const r = db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => data[k]));
  return Number(r.lastInsertRowid);
}
function update(table, id, obj, { touch = true } = {}) {
  const data = clean(table, obj);
  if (touch && columns(table).includes('updated_at')) data.updated_at = nowStamp();
  const keys = Object.keys(data);
  if (!keys.length) return;
  db.prepare(`UPDATE ${table} SET ${keys.map(k => k + ' = ?').join(', ')} WHERE id = ?`).run(...keys.map(k => data[k]), id);
}
function get(table, id) { return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) || null; }

module.exports = { db, init, open, exportBytes, totalChanges, getSettings, setSetting, getState, setState, logJob, tx, insert, update, get, DEFAULT_SETTINGS };
