'use strict';
// The Overview: headline sales numbers for the period, the funnel, leads waiting to be allocated,
// how each person in the team is doing, today's appointments and where leads come from.
const { db, get } = require('./db');
const L = require('./logic');
const U = require('./util');
const A = require('./access');
const graph = require('./google');

const DAYS = { '30': 30, '90': 90, '365': 365 };
const OPEN_LEAD = `c.lead_status IN ('New','Contacted','Nurture') OR EXISTS (SELECT 1 FROM deals d2 WHERE d2.contact_id = c.id AND d2.stage NOT IN ('Won','Lost'))`;
const UNALLOCATED = `c.owner_id IS NULL AND c.type <> 'Partner' AND c.lead_status NOT IN ('Lost','Customer')`;

function scopeFor(user, park) {
  if (park) {
    if (!A.isGroup(user) && park !== user.park_id) throw A.httpError(403, 'You can only see your own park.');
    return { sql: 'c.park_id = ?', args: [park] };
  }
  return A.contactWhere(user, 'c');
}

function unallocatedCount(user) {
  const sc = A.contactWhere(user, 'c');
  return db.prepare(`SELECT COUNT(*) n FROM contacts c WHERE ${UNALLOCATED} AND ${sc.sql}`).get(...sc.args).n;
}

// Headline numbers for a set of leads.
function kpis(sc, since, day, now) {
  const one = (sql, ...args) => db.prepare(sql).get(...args, ...sc.args);
  const enquiries = one(`SELECT COUNT(*) n FROM contacts c WHERE c.type <> 'Partner' AND substr(COALESCE(c.enquiry_date, c.created_at),1,10) >= ? AND ${sc.sql}`, since).n;
  const tours = one(`SELECT COUNT(*) n FROM appointments a JOIN contacts c ON c.id = a.contact_id
                     WHERE a.type IN ('Demo','Site visit') AND a.status = 'Completed' AND substr(a.start,1,10) >= ? AND ${sc.sql}`, since).n;
  const toursAhead = one(`SELECT COUNT(*) n FROM appointments a JOIN contacts c ON c.id = a.contact_id
                          WHERE a.type IN ('Demo','Site visit') AND a.status = 'Scheduled' AND a.start >= ? AND a.start < ? AND ${sc.sql}`, now, U.addDays(day, 14) + 'T00:00').n;
  const value = 'COALESCE(SUM(COALESCE(d.price,0)),0)';
  const reserved = one(`SELECT COUNT(*) n, ${value} v FROM deals d JOIN contacts c ON c.id = d.contact_id WHERE substr(d.reserved_at,1,10) >= ? AND ${sc.sql}`, since);
  const completed = one(`SELECT COUNT(*) n, ${value} v FROM deals d JOIN contacts c ON c.id = d.contact_id WHERE substr(d.completed_at,1,10) >= ? AND ${sc.sql}`, since);
  const pipeline = one(`SELECT COUNT(*) n, ${value} v FROM deals d JOIN contacts c ON c.id = d.contact_id
                        WHERE d.stage IN ('Demo booked','Demo held','Proposal sent') AND ${sc.sql}`);
  const lost = one(`SELECT COUNT(*) n FROM deals d JOIN contacts c ON c.id = d.contact_id WHERE d.stage = 'Lost' AND substr(d.stage_changed_at,1,10) >= ? AND ${sc.sql}`, since).n;
  const unallocated = one(`SELECT COUNT(*) n FROM contacts c WHERE ${UNALLOCATED} AND ${sc.sql}`).n;
  const overdue = one(`SELECT COUNT(*) n FROM tasks t JOIN contacts c ON c.id = t.contact_id WHERE t.status = 'Open' AND t.due_date < ? AND ${sc.sql}`, day).n;
  return { enquiries, tours, toursAhead, reserved, completed, pipeline, lost, unallocated, overdue,
    conversion: enquiries ? Math.round(1000 * completed.n / enquiries) / 10 : 0 };
}

function personStats(m, sc, since, day, now) {
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const leads = one(`SELECT COUNT(*) n FROM contacts c WHERE c.owner_id = ? AND (${OPEN_LEAD})`, m.id).n;
  const newLeads = one(`SELECT COUNT(*) n FROM contacts c WHERE c.owner_id = ? AND substr(c.assigned_at,1,10) >= ?`, m.id, since).n;
  const overdue = one(`SELECT COUNT(*) n FROM tasks WHERE owner_id = ? AND status = 'Open' AND due_date < ?`, m.id, day).n;
  const dueToday = one(`SELECT COUNT(*) n FROM tasks WHERE owner_id = ? AND status = 'Open' AND due_date = ?`, m.id, day).n;
  const doneToday = one(`SELECT COUNT(*) n FROM tasks WHERE owner_id = ? AND status = 'Done' AND substr(completed_at,1,10) = ?`, m.id, day).n;
  const appts = one(`SELECT COUNT(*) n FROM appointments WHERE owner_id = ? AND status = 'Scheduled' AND start >= ? AND start < ?`, m.id, now, U.addDays(day, 7) + 'T00:00').n;
  const tours = one(`SELECT COUNT(*) n FROM appointments WHERE owner_id = ? AND type IN ('Demo','Site visit') AND status = 'Completed' AND substr(start,1,10) >= ?`, m.id, since).n;
  const reserved = one(`SELECT COUNT(*) n, COALESCE(SUM(COALESCE(d.price,0)),0) v FROM deals d JOIN contacts c ON c.id = d.contact_id
                        WHERE c.owner_id = ? AND substr(d.completed_at,1,10) >= ?`, m.id, since);
  const cold = one(`SELECT COUNT(*) n FROM contacts c WHERE c.owner_id = ? AND c.lead_status IN ('New','Contacted','Nurture')
                    AND substr(COALESCE(c.last_contact_at, c.enquiry_date, c.created_at),1,10) < ?
                    AND EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.id AND d.stage IN ('Enquiry','Demo booked','Demo held','Proposal sent'))
                    AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.contact_id = c.id AND t.status = 'Open')
                    AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.contact_id = c.id AND a.status = 'Scheduled' AND a.start >= ?)`, m.id, U.addDays(day, -14), now).n;
  void sc;
  return {
    id: m.id, name: m.name || m.email, email: m.email, role: m.role, roleLabel: A.ROLE_LABELS[m.role], park_name: m.park_name,
    leads, newLeads, overdue, dueToday, doneToday, appts, tours, reserved, cold,
    tourRate: newLeads ? Math.round(100 * tours / newLeads) : null,
    lastSeen: m.last_seen_at, google: graph.isConnected(m.id)
  };
}

function log(user, { period = '90', park = null } = {}) {
  const day = U.today(), now = U.nowLocal();
  const days = DAYS[period];
  const since = days ? U.addDays(day, -days) : '0000-00-00';
  const sc = scopeFor(user, park);
  const headline = kpis(sc, since, day, now);
  const funnel = L.funnel(period, sc);

  const unallocated = db.prepare(`SELECT c.id, c.first_name, c.last_name, c.lead_source, c.enquiry_date, c.mobile, c.email, pk.name AS park_name,
      (SELECT stage FROM deals d WHERE d.contact_id = c.id ORDER BY (d.stage IN ('Won','Lost')), d.updated_at DESC LIMIT 1) AS stage
    FROM contacts c LEFT JOIN parks pk ON pk.id = c.park_id WHERE ${UNALLOCATED} AND ${sc.sql}
    ORDER BY COALESCE(c.enquiry_date, c.created_at) DESC LIMIT 15`).all(...sc.args);

  let members = A.team(user).filter(m => m.role !== 'group' || m.id === user.id || db.prepare('SELECT 1 FROM contacts WHERE owner_id = ? LIMIT 1').get(m.id));
  if (park) members = members.filter(m => m.park_id === park || (m.id === user.id && db.prepare('SELECT 1 FROM contacts WHERE owner_id = ? AND park_id = ? LIMIT 1').get(m.id, park)));
  const team = members.map(m => personStats(m, sc, since, day, now))
    .sort((a, b) => (b.reserved.n - a.reserved.n) || (b.tours - a.tours) || a.name.localeCompare(b.name));

  const todayAppts = db.prepare(`SELECT a.id, a.type, a.title, a.start, a.end, a.status, a.outcome, a.contact_id, c.first_name, c.last_name, ou.name AS owner_name
      FROM appointments a JOIN contacts c ON c.id = a.contact_id LEFT JOIN users ou ON ou.id = a.owner_id
      WHERE a.start >= ? AND a.start < ? AND a.status <> 'Cancelled' AND ${sc.sql} ORDER BY a.start`).all(day + 'T00:00', U.addDays(day, 1) + 'T00:00', ...sc.args);

  // Where leads come from, and which sources turn into demos and won deals.
  const sources = db.prepare(`SELECT COALESCE(c.lead_source, 'Not recorded') AS source, COUNT(*) AS enquiries,
      SUM(EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.id AND d.furthest_stage IN ('Demo held','Proposal sent','Won'))) AS tours,
      SUM(EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.id AND d.stage = 'Won')) AS sales
    FROM contacts c WHERE c.type <> 'Partner' AND substr(COALESCE(c.enquiry_date, c.created_at),1,10) >= ? AND ${sc.sql}
    GROUP BY COALESCE(c.lead_source, 'Not recorded') ORDER BY enquiries DESC LIMIT 8`).all(since, ...sc.args);

  let parks = null;
  if (A.isGroup(user) && !park) {
    parks = db.prepare('SELECT id, name FROM parks ORDER BY name').all().map(p => ({ id: p.id, name: p.name, ...kpis({ sql: 'c.park_id = ?', args: [p.id] }, since, day, now),
      people: db.prepare("SELECT COUNT(*) n FROM users WHERE park_id = ? AND active = 1 AND role <> 'group'").get(p.id).n }));
  }
  const parkRow = park ? get('parks', park) : null;
  return { period: days ? String(days) : 'all', since: days ? since : null, today: day, park: parkRow ? { id: parkRow.id, name: parkRow.name } : null,
    headline, funnel, unallocated, team, todayAppts, sources, parks };
}

module.exports = { log, unallocatedCount };
