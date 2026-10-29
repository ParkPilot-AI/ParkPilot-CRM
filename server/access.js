'use strict';
// People and who can see what. ("Parks" in the code are sales teams; ParkPilot starts with one.)
//
//  Sales Executive  – works the leads allocated to them; can connect their own Google account.
//  Sales Manager    – everything in their team: all its leads (including unallocated ones),
//                     the Overview, the team, allocation and the deeper settings.
//  Admin            – full access to everything: every lead, every setting, the team, backups.
//                     Whoever is in OWNER_EMAILS (and the very first person to sign in) is an Admin.
//
// The signed-in person for the current request is kept in `ctx.user` (requests run one at a time).
const { db, insert, update, get } = require('./db');
const U = require('./util');

const ROLES = ['exec', 'manager', 'group'];
const ROLE_LABELS = { exec: 'Sales Executive', manager: 'Sales Manager', group: 'Admin' };
const rank = r => ROLES.indexOf(r);
const isManager = u => !!u && rank(u.role) >= 1;
const isGroup = u => !!u && u.role === 'group';

const ctx = { user: null };

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
function requireManager(u) { if (!isManager(u)) throw httpError(403, 'Only sales managers can do that.'); }
function requireGroup(u) { if (!isGroup(u)) throw httpError(403, 'Only admins can do that.'); }

/* ---------------------------------------------------------------- scope */

// SQL condition limiting contacts (alias `a`) to the ones this person may see.
function contactWhere(u, a = 'c') {
  if (isGroup(u)) return { sql: '1=1', args: [] };
  if (u.role === 'manager') return u.park_id ? { sql: `${a}.park_id = ?`, args: [u.park_id] } : { sql: '0=1', args: [] };
  return { sql: `${a}.owner_id = ?`, args: [u.id] };
}
function canSeeContact(u, c) {
  if (!c) return false;
  if (isGroup(u)) return true;
  if (u.role === 'manager') return !!u.park_id && c.park_id === u.park_id;
  return c.owner_id === u.id;
}
// The contact, or a 404 if it doesn't exist or isn't theirs to see.
function contact(u, id) {
  const c = id ? get('contacts', Number(id)) : null;
  if (!c || !canSeeContact(u, c)) throw httpError(404, 'Contact not found');
  return c;
}
function maybeContact(u, id) { return id ? contact(u, id) : null; }

// The people whose work this person can see and act for (always including themselves).
function team(u, { includeInactive = false } = {}) {
  const act = includeInactive ? '' : 'AND u.active = 1';
  const sel = `SELECT u.id, u.email, u.name, u.role, u.park_id, u.active, u.last_seen_at, p.name AS park_name FROM users u LEFT JOIN parks p ON p.id = u.park_id`;
  if (isGroup(u)) return db.prepare(`${sel} WHERE 1=1 ${act} ORDER BY p.name, u.name`).all();
  // A park's team is its managers and executives (group managers sit above every park).
  if (u.role === 'manager') return db.prepare(`${sel} WHERE ((u.park_id = ? AND u.role <> 'group') OR u.id = ?) ${act} ORDER BY u.name`).all(u.park_id || -1, u.id);
  return db.prepare(`${sel} WHERE u.id = ?`).all(u.id);
}
function canActFor(u, userId) {
  if (!userId || Number(userId) === u.id) return true;
  return team(u).some(m => m.id === Number(userId));
}
// Checks a chosen owner (for a task, appointment or lead); falls back to `fallback`.
function ownerFor(u, requested, fallback = u.id) {
  if (requested === undefined || requested === null || requested === '') return fallback;
  if (!canActFor(u, requested)) throw httpError(403, 'You can only assign work to people in your team.');
  return Number(requested);
}

function canSeeRow(u, row) {
  if (!row) return false;
  if (row.owner_id === u.id || isGroup(u)) return true;
  if (row.contact_id && canSeeContact(u, get('contacts', row.contact_id))) return true;
  return isManager(u) && !!row.owner_id && team(u).some(m => m.id === row.owner_id);
}
function task(u, id) { const t = get('tasks', Number(id)); if (!canSeeRow(u, t)) throw httpError(404, 'Task not found'); return t; }
function appointment(u, id) { const a = get('appointments', Number(id)); if (!canSeeRow(u, a)) throw httpError(404, 'Appointment not found'); return a; }
function deal(u, id) { const d = get('deals', Number(id)); if (!d || !canSeeContact(u, get('contacts', d.contact_id))) throw httpError(404, 'Deal not found'); return d; }

// Homes and plots belong to a park: managers and executives see their own park's; group sees all.
function parkWhere(u, a) {
  if (isGroup(u)) return { sql: '1=1', args: [] };
  return { sql: `${a}.park_id = ?`, args: [u.park_id || -1] };
}
function stockRow(u, table, id) {
  const r = get(table, Number(id));
  if (!r || !(isGroup(u) || r.park_id === u.park_id)) throw httpError(404, 'Not found');
  return r;
}
// The park new records go into: a group manager's choice (or the first park), otherwise their own.
function parkFor(u, requested) {
  if (isGroup(u)) {
    const id = Number(requested) || u.park_id || (db.prepare('SELECT MIN(id) id FROM parks').get() || {}).id;
    if (!get('parks', id)) throw httpError(400, 'Choose a park');
    return id;
  }
  return u.park_id;
}

/* ---------------------------------------------------------------- people */

function owners() { return (process.env.OWNER_EMAILS || '').split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean); }

// The very first person to sign in takes over everything made while the portal was single-user.
function claimLegacy(uid) {
  db.prepare('UPDATE contacts SET owner_id = ?, assigned_at = COALESCE(assigned_at, enquiry_date, created_at) WHERE owner_id IS NULL').run(uid);
  db.prepare('UPDATE tasks SET owner_id = ? WHERE owner_id IS NULL').run(uid);
  db.prepare('UPDATE appointments SET owner_id = ? WHERE owner_id IS NULL').run(uid);
}

// Finds (or, for OWNER_EMAILS and the very first sign-in, creates) the person signing in.
// Returns null if they don't have access.
function resolveUser(email, name) {
  email = String(email || '').toLowerCase();
  if (!email) return null;
  const list = owners();
  let u = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email);
  if (!u) {
    const first = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
    if (!(list.includes(email) || (first && !list.length))) return null;
    const park = (db.prepare('SELECT MIN(id) id FROM parks').get() || {}).id || null;
    const id = insert('users', { email, name: name || email, role: 'group', park_id: park, last_seen_at: U.nowStamp() });
    if (first) claimLegacy(id);
    u = get('users', id);
  }
  if (!u.active) return null;
  const patch = {};
  if (list.includes(email) && u.role !== 'group') patch.role = 'group'; // the named owners can never be locked out
  if (name && (!u.name || u.name === u.email) && name !== email) patch.name = name;
  if (!u.last_seen_at || u.last_seen_at < U.addMinutes(U.nowLocal(), -15)) patch.last_seen_at = U.nowStamp();
  if (Object.keys(patch).length) { update('users', u.id, patch, { touch: false }); u = get('users', u.id); }
  const park = u.park_id ? get('parks', u.park_id) : null;
  return { ...u, park_name: park ? park.name : null };
}

function publicUser(u) {
  return u && { id: u.id, email: u.email, name: u.name || u.email, role: u.role, roleLabel: ROLE_LABELS[u.role], park_id: u.park_id, park_name: u.park_name,
    isManager: isManager(u), isGroup: isGroup(u) };
}

module.exports = {
  ROLES, ROLE_LABELS, ctx, isManager, isGroup, requireManager, requireGroup, contactWhere, canSeeContact, contact, maybeContact,
  team, canActFor, ownerFor, task, appointment, deal, parkWhere, stockRow, parkFor, resolveUser, publicUser, owners, claimLegacy, httpError
};
