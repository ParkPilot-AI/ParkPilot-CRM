'use strict';
// Date helpers. All CRM dates are stored as UK local time:
//   dates      'YYYY-MM-DD'
//   date-times 'YYYY-MM-DDTHH:MM'
// so British Summer Time changes never shift what you see.

const TZ = 'Europe/London';

function partsInZone(date = new Date()) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short'
  });
  const p = {};
  for (const x of f.formatToParts(date)) p[x.type] = x.value;
  return p;
}

function today(date = new Date()) {
  const p = partsInZone(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function nowLocal(date = new Date()) {
  const p = partsInZone(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function nowStamp() {
  const p = partsInZone();
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

// Pure calendar arithmetic on 'YYYY-MM-DD' strings (no time zones involved).
function addDays(d, n) {
  const [y, m, dd] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd + n));
  return t.toISOString().slice(0, 10);
}

function weekday(d) { // 0 = Sunday … 6 = Saturday
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
}

function daysBetween(a, b) { // b - a in whole days
  const ta = Date.parse(a + 'T00:00:00Z'), tb = Date.parse(b + 'T00:00:00Z');
  return Math.round((tb - ta) / 864e5);
}

function isOpenDay(d, closedDays) { return !closedDays.includes(weekday(d)); }

function nextOpenDay(d, closedDays, includeSelf = true) {
  let x = includeSelf ? d : addDays(d, 1);
  for (let i = 0; i < 8 && !isOpenDay(x, closedDays); i++) x = addDays(x, 1);
  return x;
}

function prevOpenDay(d, closedDays) {
  let x = addDays(d, -1);
  for (let i = 0; i < 8 && !isOpenDay(x, closedDays); i++) x = addDays(x, -1);
  return x;
}

function workingDaysBetween(a, b, closedDays) { // open days after a up to and including b
  if (b <= a) return 0;
  let n = 0, x = a;
  for (let i = 0; i < 4000 && x < b; i++) { x = addDays(x, 1); if (isOpenDay(x, closedDays)) n++; }
  return n;
}

function minutesOf(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
function hhmm(min) { return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }

function addMinutes(dt, n) { // 'YYYY-MM-DDTHH:MM' + n minutes, calendar arithmetic
  const [d, t] = dt.split('T');
  let total = minutesOf(t) + n, day = d;
  while (total < 0) { total += 1440; day = addDays(day, -1); }
  while (total >= 1440) { total -= 1440; day = addDays(day, 1); }
  return `${day}T${hhmm(total)}`;
}

// Normalise UK phone numbers to E.164 for tap-to-call links; keep anything odd as typed.
function normalisePhone(p) {
  if (!p) return '';
  let s = String(p).replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (/^0\d{9,10}$/.test(s)) s = '+44' + s.slice(1);
  if (/^44\d{10}$/.test(s)) s = '+' + s;
  return s;
}

function uid() { return require('node:crypto').randomUUID(); }

module.exports = {
  TZ, today, nowLocal, nowStamp, addDays, weekday, daysBetween, isOpenDay, nextOpenDay, prevOpenDay,
  workingDaysBetween, minutesOf, hhmm, addMinutes, normalisePhone, uid
};
