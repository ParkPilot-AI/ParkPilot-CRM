'use strict';
const { db, tx, insert, update, getSettings, logJob } = require('./db');
const { readFirstSheet, serialToLocal, readCsv } = require('./xlsx');
const { normalisePhone, today, addDays, nowStamp } = require('./util');

// Recognised column headings (first match wins). Anything else in the sheet is ignored.
const HEADER_MAP = {
  external_id: [/^\(do not modify\).*lead$/i, /^lead id$/i, /^external id$/i],
  lead_no: [/^no$/i, /^lead no/i, /^lead number/i],
  first_name: [/^first name$/i, /^forename$/i],
  last_name: [/^last name$/i, /^surname$/i],
  full_name: [/^(full |contact )?name$/i],
  company: [/^park( name)?$/i, /^company( name)?$/i, /^business( name)?$/i, /^organi[sz]ation$/i, /^account( name)?$/i],
  job_title: [/job title/i, /^role$/i, /^position$/i],
  units: [/units/i, /pitches/i, /holiday homes/i],
  sites: [/no\.? of parks/i, /number of parks/i, /^sites$/i, /^parks$/i],
  region: [/^county$/i, /^region$/i, /^location$/i, /^town$/i, /^city$/i],
  website: [/website/i, /^url$/i, /^web$/i],
  interest: [/interest/i, /^product/i],
  current_systems: [/current (system|pms|crm|software)/i, /^pms$/i, /^crm$/i],
  mobile: [/mobile/i, /^phone/i, /telephone/i],
  email: [/e-?mail/i],
  lead_source: [/lead source/i, /^source$/i],
  enquiry_date: [/^created on$/i, /enquiry date/i, /^created$/i, /^date$/i],
  postcode: [/post ?code/i],
  notes: [/^notes?$/i, /^comments?$/i]
};

function mapHeaders(header) {
  const map = {};
  header.forEach((h, i) => {
    const name = String(h || '').trim();
    for (const [field, pats] of Object.entries(HEADER_MAP)) {
      if (map[field] === undefined && pats.some(p => p.test(name))) { map[field] = i; break; }
    }
  });
  return map;
}

const tidyName = s => {
  s = String(s || '').trim().replace(/\s+/g, ' ');
  if (s && s === s.toLowerCase()) s = s.replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  return s;
};

function asDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return serialToLocal(v);
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4] || '09'}:${m[5] || '00'}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s); // UK dd/mm/yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${(m[4] || '09').padStart(2, '0')}:${m[5] || '00'}`;
  return null;
}

function importRows(rows, { fileName = 'import', parkId = null, ownerId = null } = {}) {
  if (!rows.length) throw new Error('The file is empty.');
  const map = mapHeaders(rows[0]);
  if (map.first_name === undefined && map.last_name === undefined && map.full_name === undefined && map.email === undefined && map.company === undefined)
    throw new Error('Could not find name, park or email columns. Expected headings such as "First Name", "Last Name", "Park Name", "Email".');
  const settings = getSettings();
  const activeFrom = addDays(today(), -settings.activeLeadDays);
  const stats = { rows: rows.length - 1, created: 0, updated: 0, unchanged: 0, skipped: 0, deals: 0 };

  const findByExt = db.prepare('SELECT * FROM contacts WHERE external_id = ?');
  const findByLead = db.prepare('SELECT * FROM contacts WHERE lead_no = ?');
  const findByEmail = db.prepare('SELECT * FROM contacts WHERE lower(email) = ? ORDER BY id LIMIT 1');
  const wasMerged = db.prepare('SELECT 1 FROM sync_state WHERE key = ?');
  const now = nowStamp();

  tx(() => {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const val = f => (map[f] === undefined ? null : r[map[f]]);
      let first = tidyName(val('first_name')), last = tidyName(val('last_name'));
      if (!first && !last && val('full_name')) { const parts = tidyName(val('full_name')).split(' '); first = parts[0]; last = parts.slice(1).join(' '); }
      const email = val('email') ? String(val('email')).trim().toLowerCase() : null;
      const mobile = val('mobile') ? String(val('mobile')).trim() : null;
      const text = f => (val(f) === null || val(f) === undefined || String(val(f)).trim() === '' ? null : String(val(f)).trim());
      const num = f => { const m = String(val(f) ?? '').match(/\d[\d,]*/); return m ? Number(m[0].replace(/,/g, '')) : null; };
      const extra = { company: text('company'), job_title: text('job_title'), units: num('units'), sites: num('sites'), region: text('region'),
        website: text('website'), current_systems: text('current_systems'), postcode: text('postcode') };
      const interestRaw = String(val('interest') || '').toLowerCase();
      extra.interest = /crm/.test(interestRaw) && /\bai\b|agent/.test(interestRaw) ? 'AI + CRM' : /crm/.test(interestRaw) ? 'ParkPilot CRM' : /\bai\b|agent/.test(interestRaw) ? 'ParkPilot AI' : null;
      if (!first && !last && !email && !mobile && !extra.company) { stats.skipped++; continue; }
      const ext = val('external_id') ? String(val('external_id')).trim() : null;
      const leadNo = val('lead_no') ? String(val('lead_no')).trim() : null;
      const enquiry = asDate(val('enquiry_date'));
      const source = val('lead_source') ? String(val('lead_source')).trim() : null;

      if (ext && wasMerged.get('merged:' + ext)) { stats.unchanged++; continue; }
      const existing = (ext && findByExt.get(ext)) || (leadNo && findByLead.get(leadNo)) || (email && findByEmail.get(email)) || null;
      if (existing) {
        // Fill gaps only: never overwrite something edited in the portal.
        const patch = {};
        if (!existing.first_name && first) patch.first_name = first;
        if (!existing.last_name && last) patch.last_name = last;
        if (!existing.email && email) patch.email = email;
        if (!existing.mobile && mobile) { patch.mobile = mobile; patch.phone_e164 = normalisePhone(mobile); }
        if (!existing.lead_source && source) patch.lead_source = source;
        if (!existing.lead_no && leadNo && !findByLead.get(leadNo)) patch.lead_no = leadNo;
        if (!existing.external_id && ext) patch.external_id = ext;
        for (const [k, v] of Object.entries(extra)) if ((existing[k] === null || existing[k] === '') && v !== null) patch[k] = v;
        if (Object.keys(patch).length) { update('contacts', existing.id, patch); stats.updated++; }
        else stats.unchanged++;
        continue;
      }
      const day = enquiry ? enquiry.slice(0, 10) : today();
      const active = day >= activeFrom;
      const id = insert('contacts', {
        external_id: ext, lead_no: leadNo, type: 'Prospect', first_name: first, last_name: last,
        mobile, phone_e164: normalisePhone(mobile), email, lead_source: source || 'Import', ...extra,
        lead_status: active ? 'New' : 'Dormant', enquiry_date: enquiry, created_at: enquiry ? enquiry + ':00' : now,
        park_id: parkId || (db.prepare('SELECT MIN(id) id FROM parks').get() || {}).id || null, owner_id: ownerId, assigned_at: ownerId ? now : null
      });
      insert('interactions', {
        contact_id: id, type: 'Note', at: enquiry || now.slice(0, 16),
        summary: `Imported from ${fileName}${leadNo ? ' (' + leadNo + ')' : ''}${source ? ', source ' + source : ''}.${text('notes') ? '\n' + text('notes') : ''}`
      });
      if (active) {
        insert('deals', { contact_id: id, deal_type: extra.interest || 'Not decided yet', stage: 'Enquiry', furthest_stage: 'Enquiry', stage_changed_at: enquiry || now, created_at: enquiry ? enquiry + ':00' : now });
        stats.deals++;
      }
      stats.created++;
    }
  });
  const dups = recomputeDuplicates();
  stats.duplicateGroups = dups;
  logJob('import', { fileName, ...stats });
  return stats;
}

function importFile(buf, fileName, opts = {}) {
  const isCsv = /\.csv$/i.test(fileName) || (buf[0] !== 0x50 || buf[1] !== 0x4b);
  const { rows } = isCsv ? readCsv(buf.toString('utf8')) : readFirstSheet(buf);
  return importRows(rows, { fileName, ...opts });
}

// Group contacts sharing an email address or phone number (union-find), ignoring dismissed pairs.
function recomputeDuplicates() {
  const list = db.prepare('SELECT id, email, phone_e164 FROM contacts').all();
  const parent = new Map(list.map(c => [c.id, c.id]));
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent.set(Math.max(a, b), Math.min(a, b)); };
  const byKey = new Map();
  for (const c of list) {
    for (const k of [c.email && 'e:' + c.email.toLowerCase(), c.phone_e164 && c.phone_e164.length > 8 && 'p:' + c.phone_e164]) {
      if (!k) continue;
      if (byKey.has(k)) union(byKey.get(k), c.id); else byKey.set(k, c.id);
    }
  }
  const groups = new Map();
  for (const c of list) { const g = find(c.id); groups.set(g, (groups.get(g) || 0) + 1); }
  const setGroup = db.prepare('UPDATE contacts SET dup_group = ? WHERE id = ?');
  let n = 0;
  tx(() => {
    for (const c of list) {
      const g = find(c.id);
      setGroup.run(groups.get(g) > 1 ? 'g' + g : null, c.id);
    }
  });
  for (const v of groups.values()) if (v > 1) n++;
  return n;
}

module.exports = { importFile, importRows, recomputeDuplicates };
