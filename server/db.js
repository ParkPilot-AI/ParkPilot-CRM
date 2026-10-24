'use strict';
// Database layer: SQLite compiled to WebAssembly (sql.js), held in memory and persisted
// as one file by store.js (an Azure blob in production). `db` keeps the same small API the
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
  // October 2026: pipeline became Enquiry > Appointment > Park Tour > Finance & Paperwork > Siting & Handover.
  current.exec(`UPDATE deals SET stage = CASE stage
      WHEN 'Viewing booked' THEN 'Appointment' WHEN 'Viewed' THEN 'Park Tour' WHEN 'Proposal' THEN 'Park Tour'
      WHEN 'Reserved' THEN 'Finance & Paperwork' WHEN 'Finance and paperwork' THEN 'Finance & Paperwork'
      WHEN 'Siting and handover' THEN 'Siting & Handover' ELSE stage END
    WHERE stage IN ('Viewing booked','Viewed','Proposal','Reserved','Finance and paperwork','Siting and handover')`);
  current.exec("UPDATE appointments SET type = 'Park tour' WHERE type = 'Viewing'");
  const r = current.exec("SELECT value FROM settings WHERE key = 'durations'");
  if (r.length) {
    try {
      const d = JSON.parse(r[0].values[0][0]);
      if (d.Viewing !== undefined && d['Park tour'] === undefined) {
        d['Park tour'] = Math.max(d.Viewing, 90); delete d.Viewing;
        const st = current.prepare("UPDATE settings SET value = ? WHERE key = 'durations'"); st.run([JSON.stringify(d)]); st.free();
      }
    } catch { /* leave a malformed setting alone */ }
  }
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

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS job_log (id INTEGER PRIMARY KEY, job TEXT, at TEXT, detail TEXT);
`;

const DEFAULT_SETTINGS = {
  openingHours: { start: '09:00', end: '17:00' },
  closedDays: [],            // 0 = Sun … 6 = Sat; none closed by default
  durations: { 'Park tour': 90, 'Part-ex valuation': 45, 'Finance meeting': 45, 'Handover': 90, 'Phone call': 15, 'Teams call': 30 },
  bufferMinutes: 15,
  escalateAfter: 3,
  reviewAfter: 5,
  rolloverTime: '02:15',
  activeLeadDays: 90,
  todoMirror: true,
  officeLocation: 'Sales office'
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
