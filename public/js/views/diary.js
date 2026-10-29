import { get, patch, esc, state, today, addDays, parts, fmtDate, fmtTime, fullName, minutes, hhmm, nowLocal, toast, changed, typeClass, fmtDay, isPhone, isMgr, me, teamOptions, personName } from '../core.js';
import { bookDialog, apptDialog } from '../dialogs.js';
import { diaryCard, bindDiary } from './parts.js';

let mode = 'week';      // desktop: day, week or month
let phoneMode = 'agenda'; // phones: day or agenda (the next two weeks as a list)
let anchor = null;
let who = null; // managers can look at someone else's diary (null = their own)
const PX = 48 / 60; // pixels per minute
const MO = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const mondayOf = d => addDays(d, -((parts(d).wd + 6) % 7));

export async function render(el, { query }) {
  if (query.date) anchor = query.date;
  if (query.user) who = Number(query.user) || null;
  if (who && !isMgr()) who = null;
  const forParam = who ? `&user=${who}` : '';
  const book = (opts = {}) => bookDialog({ ownerId: who, ...opts });
  if (!anchor) anchor = today();
  const s = state.meta.settings;
  const phone = isPhone();
  const view = phone ? phoneMode : mode;
  let from, to;
  if (view === 'day') { from = to = anchor; }
  else if (view === 'agenda') { from = anchor; to = addDays(anchor, 13); }
  else if (view === 'week') { from = mondayOf(anchor); to = addDays(from, 6); }
  else { const p = parts(anchor); const first = `${p.y}-${String(p.m).padStart(2, '0')}-01`; from = mondayOf(first); to = addDays(from, 41); }
  const [data, tasks] = await Promise.all([
    get(`/api/appointments?from=${from}&to=${to}&cancelled=1${forParam}`),
    get('/api/tasks?scope=open' + forParam)
  ]);
  const days = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const unscheduled = tasks.filter(t => t.due_date && t.due_date <= addDays(today(), 7)).slice(0, 30);

  const title = view === 'month' ? `${MO[parts(anchor).m - 1]} ${parts(anchor).y}`
    : view === 'day' ? fmtDate(anchor, { long: true })
    : `${fmtDate(from)} – ${fmtDate(to)}`;

  el.innerHTML = `
    <div class="today-head"><h1>${who && who !== me().id ? `${esc(personName(who))}’s diary` : 'Diary'}</h1><span class="muted">${esc(title)}</span><div class="spacer"></div>
      <div class="seg" role="group" aria-label="View">${(phone ? ['day', 'agenda'] : ['day', 'week', 'month']).map(m => `<button type="button" data-mode="${m}" class="${view === m ? 'on' : ''}">${m === 'agenda' ? 'Next 2 weeks' : m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>
      <div class="seg"><button type="button" data-nav="-1" aria-label="Previous">‹</button><button type="button" data-nav="0">Today</button><button type="button" data-nav="1" aria-label="Next">›</button></div>
      <button class="btn primary desk-only" data-book>+ Appointment</button>
    </div>
    ${isMgr() && (state.meta.team || []).length > 1 ? `<div class="toolbar diary-for"><label class="small muted">Diary for <select data-who aria-label="Whose diary">${teamOptions(who || me().id)}</select></label>
      ${who && who !== me().id ? `<span class="faint small">${data.googleConnected ? 'Their Google Calendar is connected.' : 'Their Google Calendar isn’t connected.'}</span>` : ''}</div>` : ''}
    <div class="toolbar">
      <div class="legend">${state.meta.apptTypes.map(t => `<span class="${typeClass(t)}"><i></i>${esc(t)}</span>`).join('')}</div>
      <div class="spacer"></div>
      ${state.meta.google && state.meta.google.connected ? '<span class="faint small">Appointments are copied to your Google Calendar</span>' : ''}
    </div>
    <div class="cal-wrap">
      <div class="${view === 'agenda' ? 'agenda' : 'cal'}" id="cal">${view === 'agenda' ? agendaList(days, data) : view === 'month' ? monthGrid(days, data, anchor) : weekGrid(days, data, s)}</div>
      <aside class="panel side-panel">
        <div class="panel-head"><h2>Follow-ups this week</h2></div>
        <p class="faint small" style="margin:0 14px 10px">${phone ? 'Tap “Book time” to put one in the diary.' : 'Click “Book time”, or drag one onto the diary.'}</p>
        ${unscheduled.length ? unscheduled.map(t => `<div class="side-task" draggable="${phone ? 'false' : 'true'}" data-task="${t.id}"><div><b>${esc(t.title)}</b><div class="faint small">${esc(t.category)} · ${esc(fmtDay(t.due_date))}${t.contact_id ? ' · ' + esc(fullName(t)) : ''}</div></div><button type="button" class="btn small" data-booktask="${t.id}">Book time</button></div>`).join('')
          : '<div class="empty small">Nothing outstanding.</div>'}
      </aside>
    </div>`;

  el.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { if (phone) phoneMode = b.dataset.mode; else mode = b.dataset.mode; render(el, { query: {} }); }));
  el.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
    const n = Number(b.dataset.nav);
    if (n === 0) anchor = today();
    else if (view === 'day') anchor = addDays(anchor, n);
    else if (view === 'agenda') anchor = addDays(anchor, 14 * n);
    else if (view === 'week') anchor = addDays(anchor, 7 * n);
    else { const p = parts(anchor); const dt = new Date(Date.UTC(p.y, p.m - 1 + n, 1)); anchor = dt.toISOString().slice(0, 10); }
    render(el, { query: {} });
  }));
  el.querySelector('[data-book]').onclick = () => book();
  el.querySelector('[data-who]')?.addEventListener('change', e => { who = Number(e.target.value) === me().id ? null : Number(e.target.value); render(el, { query: {} }); });
  const bookTask = (taskId, start = null) => {
    const t = tasks.find(x => String(x.id) === String(taskId));
    if (!t) return;
    book({ start, contact: t.contact_id ? { id: t.contact_id, first_name: t.first_name, last_name: t.last_name, email: t.contact_email } : null,
      type: t.category === 'Call' ? 'Follow-up call' : 'Demo', title: t.title, notes: t.notes || '' });
  };
  el.querySelectorAll('[data-booktask]').forEach(b => b.addEventListener('click', () => bookTask(b.dataset.booktask)));
  if (view === 'agenda') {
    bindDiary(el.querySelector('#cal'));
    el.querySelectorAll('[data-dayadd]').forEach(b => b.addEventListener('click', () => book({ start: `${b.dataset.dayadd}T10:00` })));
    return;
  }
  el.querySelectorAll('[data-ev]').forEach(x => x.addEventListener('click', e => { e.stopPropagation(); apptDialog(x.dataset.ev); }));

  if (view === 'month') {
    el.querySelectorAll('.month .d').forEach(d => d.addEventListener('click', () => { anchor = d.dataset.day; mode = 'day'; render(el, { query: {} }); }));
    return;
  }

  // Week/day interactions: click to book, drag to move, drop a task to book time for it.
  const body = el.querySelector('.cal-body');
  const startMin = Number(body.dataset.start);
  const minuteAt = (col, clientY) => {
    const r = col.getBoundingClientRect();
    const m = startMin + Math.max(0, (clientY - r.top) / PX);
    return Math.round(m / 15) * 15;
  };
  let hint = null;
  const showHint = (col, m) => {
    if (!hint) { hint = document.createElement('div'); hint.className = 'slot-hint'; }
    hint.style.top = `${(m - startMin) * PX}px`;
    hint.textContent = hhmm(m);
    if (hint.parentNode !== col) col.appendChild(hint);
  };
  const clearHint = () => { hint && hint.remove(); el.querySelectorAll('.cal-col.drop').forEach(c => c.classList.remove('drop')); };

  el.querySelectorAll('.cal-col').forEach(col => {
    col.addEventListener('click', e => {
      if (e.target.closest('.ev')) return;
      const m = minuteAt(col, e.clientY);
      book({ start: `${col.dataset.day}T${hhmm(Math.floor(m / 15) * 15)}` });
    });
    col.addEventListener('mousemove', e => { if (!e.target.closest('.ev')) showHint(col, Math.floor(minuteAt(col, e.clientY) / 15) * 15); });
    col.addEventListener('mouseleave', clearHint);
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drop'); showHint(col, minuteAt(col, e.clientY)); });
    col.addEventListener('dragleave', () => col.classList.remove('drop'));
    col.addEventListener('drop', async e => {
      e.preventDefault(); clearHint();
      const m = minuteAt(col, e.clientY);
      const start = `${col.dataset.day}T${hhmm(m)}`;
      const apptId = e.dataTransfer.getData('text/appt'), taskId = e.dataTransfer.getData('text/task');
      if (apptId) {
        const a = data.appts.find(x => String(x.id) === apptId);
        if (!a || a.start === start) return;
        await patch(`/api/appointments/${apptId}`, { start });
        toast(`Moved to ${fmtDay(start)} ${hhmm(m)}${state.meta.google && state.meta.google.connected ? '; Google Calendar and the invite updated' : ''}`);
        changed();
      } else if (taskId) bookTask(taskId, start);
    });
  });
  el.querySelectorAll('.ev[draggable=true]').forEach(ev => ev.addEventListener('dragstart', e => { e.dataTransfer.setData('text/appt', ev.dataset.ev); e.dataTransfer.effectAllowed = 'move'; }));
  el.querySelectorAll('.side-task').forEach(t => t.addEventListener('dragstart', e => { e.dataTransfer.setData('text/task', t.dataset.task); }));
  // Scroll to the working day.
  const nowEl = body.querySelector('.now-bar');
  body.scrollTop = nowEl ? Math.max(0, parseFloat(nowEl.style.top) - 160) : Math.max(0, (minutes(state.meta.settings.openingHours.start) - startMin - 30) * PX);
}

// Phones: the next two weeks as a simple list, one heading per day.
function agendaList(days, data) {
  const td = today();
  const out = days.map(d => {
    const start = `${d}T00:00`, end = `${addDays(d, 1)}T00:00`;
    const appts = data.appts.filter(a => a.start < end && a.end > start && a.status !== 'Cancelled');
    const other = (data.outlook || []).filter(o => o.start < end && o.end > start);
    if (!appts.length && !other.length && d !== td) return '';
    return `<section class="ag-day"><div class="ag-head"><h3>${esc(d === td ? 'Today' : fmtDay(d))}<span class="faint"> ${esc(d === td || fmtDay(d) === 'Tomorrow' ? fmtDate(d) : '')}</span></h3>
      <button type="button" class="btn ghost small" data-dayadd="${d}" aria-label="Book on ${esc(fmtDate(d))}">+ Book</button></div>
      ${appts.map(a => diaryCard(a)).join('')}
      ${other.map(o => `<div class="ag-busy">${o.is_all_day ? 'All day' : `${esc(fmtTime(o.start))} – ${esc(fmtTime(o.end))}`} · ${esc(o.subject || 'Busy')}</div>`).join('')}
      ${!appts.length && !other.length ? '<div class="faint small" style="padding:4px 2px 10px">Nothing booked today.</div>' : ''}</section>`;
  }).join('');
  return out || '<div class="empty"><strong>Nothing booked in these two weeks</strong>Use + to book a demo.</div>';
}

function layoutDay(items) {
  // Greedy lanes so overlapping appointments sit side by side.
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
  const lanes = [];
  const groups = []; let group = [], groupEnd = '';
  for (const it of sorted) {
    if (group.length && it.start >= groupEnd) { groups.push(group); group = []; lanes.length = 0; }
    let lane = lanes.findIndex(end => end <= it.start);
    if (lane < 0) { lane = lanes.length; lanes.push(it.end); } else lanes[lane] = it.end;
    it._lane = lane; group.push(it); groupEnd = it.end > groupEnd ? it.end : groupEnd;
  }
  if (group.length) groups.push(group);
  for (const g of groups) { const n = Math.max(...g.map(i => i._lane)) + 1; g.forEach(i => { i._lanes = n; }); }
  return sorted;
}

function weekGrid(days, data, s) {
  const open = minutes(s.openingHours.start), close = minutes(s.openingHours.end);
  const startMin = Math.max(0, Math.floor(open / 60) * 60 - 60), endMin = Math.min(1440, Math.ceil(close / 60) * 60 + 120);
  const height = (endMin - startMin) * PX;
  const now = nowLocal(), td = today();
  const cols = `56px repeat(${days.length}, minmax(0, 1fr))`;
  const head = `<div class="cal-head" style="grid-template-columns:${cols}"><div></div>${days.map(d => {
    const closed = s.closedDays.includes(parts(d).wd);
    return `<div class="${d === td ? 'today' : ''}${closed ? ' closed' : ''}">${esc(fmtDate(d, { year: false }))}${closed ? ' · closed' : ''}</div>`;
  }).join('')}</div>`;
  const times = []; for (let m = startMin; m < endMin; m += 60) times.push(`<div>${hhmm(m)}</div>`);
  const colHtml = days.map(d => {
    const dayStart = `${d}T00:00`, dayEnd = `${addDays(d, 1)}T00:00`;
    const items = [
      ...data.appts.filter(a => a.start < dayEnd && a.end > dayStart).map(a => ({ ...a, kind: 'appt' })),
      ...(data.outlook || []).filter(o => !o.is_all_day && o.start < dayEnd && o.end > dayStart).map(o => ({ ...o, kind: 'outlook' }))
    ];
    const laid = layoutDay(items);
    const evs = laid.map(it => {
      const st = it.start < dayStart ? dayStart : it.start, en = it.end > dayEnd ? dayEnd : it.end;
      const sm = minutes(st.slice(11)), em = en === dayEnd ? 1440 : minutes(en.slice(11));
      const top = Math.max(0, (sm - startMin) * PX), h = Math.max(20, (em - Math.max(sm, startMin)) * PX - 2);
      if (em <= startMin || sm >= endMin) return '';
      const w = 100 / it._lanes, left = it._lane * w;
      const style = `top:${top}px;height:${h}px;left:calc(${left}% + 3px);width:calc(${w}% - 6px);right:auto`;
      if (it.kind === 'outlook') return `<div class="ev outlook" style="${style}" title="${esc(it.subject)}"><b>${esc(it.subject || 'Busy')}</b>${esc(fmtTime(it.start))}</div>`;
      const movable = it.status === 'Scheduled';
      return `<div class="ev ${typeClass(it.type)}${it.status === 'Cancelled' ? ' cancelled' : ''}${it.needs_review ? ' review' : ''}" style="${style}" data-ev="${it.id}" ${movable ? 'draggable="true"' : ''} tabindex="0" title="${esc(it.title)}">
        <b>${esc(it.contact_id ? fullName(it) : it.title)}</b>${esc(fmtTime(it.start))} ${esc(it.type)}${it.status === 'Completed' ? ' ✓' : ''}</div>`;
    }).join('');
    const nowBar = d === td && now.slice(11) >= hhmm(startMin) ? `<div class="now-bar" style="top:${(minutes(now.slice(11)) - startMin) * PX}px"></div>` : '';
    const closed = s.closedDays.includes(parts(d).wd);
    return `<div class="cal-col${closed ? ' closed' : ''}" data-day="${d}" style="height:${height}px" aria-label="${esc(fmtDate(d))}">${evs}${nowBar}</div>`;
  }).join('');
  return `${head}<div class="cal-body" data-start="${startMin}" style="grid-template-columns:${cols}"><div class="cal-times" style="height:${height}px">${times.join('')}</div>${colHtml}</div>`;
}

function monthGrid(days, data, anchorDay) {
  const m = parts(anchorDay).m, td = today();
  const head = `<div class="cal-head" style="grid-template-columns:repeat(7,1fr)">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => `<div>${x}</div>`).join('')}</div>`;
  return head + `<div class="month">${days.map(d => {
    const evs = data.appts.filter(a => a.start.slice(0, 10) === d && a.status !== 'Cancelled');
    const ol = (data.outlook || []).filter(o => o.start.slice(0, 10) === d);
    const all = [...evs.map(a => `<div class="m-ev ${typeClass(a.type)}" data-ev="${a.id}">${esc(fmtTime(a.start))} ${esc(a.contact_id ? fullName(a) : a.title)}</div>`),
      ...ol.map(o => `<div class="m-ev outlook">${o.is_all_day ? '' : esc(fmtTime(o.start)) + ' '}${esc(o.subject || 'Busy')}</div>`)];
    return `<div class="d${parts(d).m !== m ? ' other' : ''}${d === td ? ' today' : ''}" data-day="${d}"><span class="num">${parts(d).d}</span>${all.slice(0, 4).join('')}${all.length > 4 ? `<div class="faint">+${all.length - 4} more</div>` : ''}</div>`;
  }).join('')}</div>`;
}
