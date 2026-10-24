import { get, post, esc, fmtDate, fmtAgo, fmtDay, fmtTime, fullName, money, plural, nowLocal, toast, changed, state } from '../core.js';
import { taskDialog, bookDialog } from '../dialogs.js';
import { taskRow, bindTasks, diaryCard, bindDiary } from './parts.js';
import { importZone } from './importui.js';
import { mountFunnel } from './funnelchart.js';

let showDone = false;

export async function render(el) {
  const d = await get('/api/dashboard');
  const late = d.overdue.length;
  const lc = document.getElementById('late-count');
  lc.textContent = late; lc.classList.toggle('hidden', !late);
  const hour = Number(d.now.slice(11, 13));
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const nApp = d.appts.filter(a => a.status !== 'Cancelled').length;
  const summary = [late ? `${plural(late, 'late task')} brought forward` : 'nothing overdue',
    `${plural(d.dueToday.length, 'task')} due today`, `${plural(nApp, 'appointment')}`].join(', ');

  const now = nowLocal();
  let nowShown = false;
  const diaryHtml = d.appts.length ? d.appts.map(a => {
    let line = '';
    if (!nowShown && a.start > now) { nowShown = true; line = `<div class="now-line">Now, ${esc(now.slice(11))}</div>`; }
    return line + diaryCard(a);
  }).join('') + (!nowShown && d.appts.length ? `<div class="now-line">Now, ${esc(now.slice(11))}</div>` : '')
    : `<div class="empty"><strong>Nothing booked today</strong>A quiet diary is a good time to call warm leads.</div>`;

  const welcome = d.contactCount === 0 ? `<section class="panel" style="margin-bottom:20px" aria-labelledby="welcome-h">
      <div class="panel-head"><h2 id="welcome-h">Welcome to the Coastfields Customer Portal</h2></div>
      <div class="panel-body"><p class="muted" style="margin-top:0">Start by importing your contacts from the previous CRM: drop the <b>My Opportunities</b> spreadsheet below. Enquiries from the last 90 days become open deals; older ones are kept as dormant contacts. Then connect Outlook under <a href="#/settings">Settings</a>.</p>
      <div data-welcome-import></div></div></section>` : '';
  el.innerHTML = welcome + `
    <div class="today-head">
      <div class="date"><img src="/img/mark.png" alt=""><div><h1>${esc(fmtDate(d.today, { long: true, year: false }))}</h1>
        <div class="day-sub">${greet}. ${esc(summary.charAt(0).toUpperCase() + summary.slice(1))}.</div></div></div>
      <div class="spacer"></div>
      <span class="desk-only-inline"><button class="btn" data-addtask>+ Task</button> <button class="btn" data-book>+ Appointment</button></span>
    </div>

    <div class="dash">
      <section class="panel" aria-labelledby="todo-h" id="todo">
        <div class="panel-head"><h2 id="todo-h">To-do today</h2><div class="spacer"></div>
          <span class="faint small">${d.rollover ? `Rolled over at ${esc(d.rollover.at.slice(11, 16))}` : ''}</span></div>
        ${late ? `<div class="group-title late">Overdue <span class="n">${late}</span></div>${d.overdue.map(t => taskRow(t)).join('')}` : ''}
        <div class="group-title">Due today <span class="n">${d.dueToday.length}</span></div>
        ${d.dueToday.length ? d.dueToday.map(t => taskRow(t)).join('') : `<div class="empty small" style="padding:8px 18px 14px">${late ? 'Clear the overdue ones first, then you are done for the day.' : 'All clear. Add a task or call a warm lead below.'}</div>`}
        ${d.doneToday.length ? `<div class="group-title"><button class="btn ghost small" data-toggle-done aria-expanded="${showDone}">${showDone ? 'Hide' : 'Show'} done today (${d.doneToday.length})</button></div>
          <div class="${showDone ? '' : 'hidden'}" data-done>${d.doneToday.map(t => taskRow(t)).join('')}</div>` : ''}
        ${d.upcoming.length ? `<div class="group-title">Next 7 days <span class="n">${d.upcoming.length}</span></div>${d.upcoming.slice(0, 6).map(t => taskRow(t)).join('')}${d.upcoming.length > 6 ? `<div class="faint small" style="padding:0 18px 10px">and ${d.upcoming.length - 6} more</div>` : ''}` : ''}
        <div style="height:10px"></div>
      </section>

      <div style="display:flex;flex-direction:column;gap:20px">
        <section class="panel" aria-labelledby="diary-h" id="diary-today">
          <div class="panel-head"><h2 id="diary-h">Today’s diary</h2><div class="spacer"></div><a class="small" href="#/diary">Open diary</a></div>
          ${diaryHtml}
          ${d.tomorrow.length ? `<div class="group-title">Tomorrow</div><ul class="mini-list">${d.tomorrow.map(a => `<li><span><b>${esc(fmtTime(a.start))}</b> ${esc(a.type)}${a.contact_id ? ' – ' + esc(fullName(a)) : ''}</span><button class="btn ghost small" data-open="${a.id}">Open</button></li>`).join('')}</ul>` : '<div style="height:6px"></div>'}
        </section>
        ${d.review.length ? `<section class="panel" id="review"><div class="panel-head"><h2>Check these Outlook links</h2></div>
          <ul class="mini-list">${d.review.map(a => `<li><span>${esc(fmtDay(a.start))} ${esc(fmtTime(a.start))} · ${esc(a.title)} → <a href="#/contacts/${a.contact_id}">${esc(fullName(a))}</a></span><span><button class="btn small" data-confirm="${a.id}">Right</button> <button class="btn small ghost" data-open="${a.id}">Open</button></span></li>`).join('')}</ul></section>` : ''}
      </div>
    </div>

    <section class="panel" style="margin-top:20px" aria-labelledby="funnel-h">
      <div class="panel-head"><h2 id="funnel-h">Sales funnel</h2><span class="faint small">${d.reserved.n ? `${money(d.reserved.v)} committed this month (${plural(d.reserved.n, 'deal')})` : 'No deposits or payments yet this month'}</span><div class="spacer"></div><a class="small" href="#/funnel">Open funnel</a></div>
      <div class="panel-body" data-funnel></div>
    </section>

    <div class="dash dash-half" style="margin-top:20px">
      <section class="panel" aria-labelledby="warm-h">
        <div class="panel-head"><h2 id="warm-h">Warm leads untouched for 7+ days</h2><span class="badge ${d.warm.count ? 'amber' : ''}">${d.warm.count}</span></div>
        ${d.warm.count ? `<ul class="mini-list">${d.warm.top.map(c => `<li><span><a href="#/contacts/${c.id}"><b>${esc(fullName(c))}</b></a> <span class="faint small">${esc(c.stage)}${c.lead_source ? ' · ' + esc(c.lead_source) : ''}</span></span>
          <span class="faint small nowrap">${esc(fmtAgo(c.last_touch))} <button class="btn small" data-fu="${c.id}" data-name="${esc(fullName(c))}">Follow up</button></span></li>`).join('')}</ul>
          ${d.warm.count > d.warm.top.length ? `<div class="faint small" style="padding:0 18px 14px"><a href="#/contacts?status=New&sort=touched">See all ${d.warm.count}</a></div>` : ''}`
          : '<div class="empty small">Every open enquiry has a next step.</div>'}
      </section>
      <section class="panel" aria-labelledby="up-h">
        <div class="panel-head"><h2 id="up-h">Upgrade candidates, next 90 days</h2><span class="badge ${d.upgrades.count ? 'sun' : ''}">${d.upgrades.count}</span></div>
        ${d.upgrades.count ? `<ul class="mini-list">${d.upgrades.top.map(h => `<li><span><a href="#/contacts/${h.contact_id}"><b>${esc(fullName(h))}</b></a> <span class="faint small">${esc([h.year, h.make, h.model].filter(Boolean).join(' '))}${h.plot_number ? ', plot ' + esc(h.plot_number) : ''}</span></span>
          <span class="faint small">${h.licence_expiry ? 'Licence ends ' + esc(fmtDate(h.licence_expiry)) : 'Home over 12 years old'}</span></li>`).join('')}</ul>`
          : `<div class="empty small">Owners appear here when their licence ends within 90 days or their home is over 12 years old. Add owners’ homes under <a href="#/stock">Homes and plots</a>.</div>`}
      </section>
    </div>`;

  const wi = el.querySelector('[data-welcome-import]');
  if (wi) importZone(wi, { onDone: () => setTimeout(() => changed(), 2500) });
  mountFunnel(el.querySelector('[data-funnel]'), d.funnel);
  bindTasks(el.querySelector('#todo'), [...d.overdue, ...d.dueToday, ...d.doneToday, ...d.upcoming]);
  bindDiary(el.querySelector('#diary-today'));
  el.querySelector('[data-toggle-done]')?.addEventListener('click', () => { showDone = !showDone; render(el); });
  el.querySelector('[data-addtask]').onclick = () => taskDialog();
  el.querySelector('[data-book]').onclick = () => bookDialog();
  const rv = el.querySelector('#review'); if (rv) bindDiary(rv);
  el.querySelectorAll('[data-confirm]').forEach(b => b.addEventListener('click', async () => { await post(`/api/appointments/${b.dataset.confirm}/confirm`); toast('Link confirmed'); changed(); }));
  el.querySelectorAll('[data-fu]').forEach(b => b.addEventListener('click', async () => {
    await post('/api/tasks', { title: `Follow up with ${b.dataset.name}`, category: 'Call', priority: 'Medium', contact_id: Number(b.dataset.fu) });
    toast(`Added to today: call ${b.dataset.name}`); changed();
  }));
  void state; void fmtDay;
}
