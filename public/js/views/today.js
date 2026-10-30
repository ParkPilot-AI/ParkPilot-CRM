import { get, post, esc, fmtDate, fmtAgo, fmtDay, fmtTime, fullName, money, plural, nowLocal, toast, changed, state, isMgr } from '../core.js';
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
    : `<div class="empty"><strong>Nothing booked today</strong>A quiet diary is a good time to chase proposals and call warm leads.</div>`;

  const g = d.google || {};
  const welcome = !isMgr() && d.contactCount === 0 ? `<div class="callout" style="margin-bottom:16px"><b>Welcome.</b> No leads have been allocated to you yet; anyone you add yourself is yours. Connect Google in <a href="#/settings">Settings</a> so emails become leads and appointments go into your calendar.</div>`
    : d.visibleCount === 0 ? `<section class="panel" style="margin-bottom:20px" aria-labelledby="welcome-h">
      <div class="panel-head"><h2 id="welcome-h">Welcome to ParkPilot CRM</h2></div>
      <div class="panel-body"><ol class="google-steps">
        <li><b>${g.connected ? 'Gmail is connected.' : '<a href="#/settings">Connect Gmail and Google Calendar</a>'}</b> ${g.connected ? '' : '(one click, in Settings).'}</li>
        <li>In Gmail, put the <b>${esc(g.gmailLabel || 'CRM Leads')}</b> label on any enquiry, or set a Gmail filter to do it. It arrives here as a lead within 10 minutes.</li>
        <li>Book demos from a lead’s page; they go into Google Calendar with a Meet link and an invite.</li>
      </ol>
      <p class="muted" style="margin:14px 0 8px">Got an existing list of leads? Drop the spreadsheet here (CSV or Excel, with headings such as Park Name, First Name, Email):</p>
      <div data-welcome-import></div></div></section>`
    : !g.connected && g.configured ? `<div class="callout" style="margin-bottom:16px"><b>Gmail isn’t connected.</b> <a href="#/settings">Connect it in Settings</a> so labelled emails turn into leads automatically.</div>` : '';
  const pool = isMgr() && d.unallocated ? `<div class="callout pool-callout"><span><b>${plural(d.unallocated, 'lead')}</b> ${d.unallocated === 1 ? 'is' : 'are'} waiting to be allocated.</span>
    <a class="btn small primary" href="#/contacts?owner=none">Allocate</a> <a class="btn small" href="#/log">Overview</a></div>` : '';
  el.innerHTML = welcome + pool + `
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
        <section class="panel" aria-labelledby="fresh-h">
          <div class="panel-head"><h2 id="fresh-h">New leads this week</h2><span class="badge ${d.fresh.length ? 'green' : ''}">${d.fresh.length}</span><div class="spacer"></div>
            ${g.connected ? `<span class="faint small">${g.lastGmail ? 'Gmail checked ' + esc(g.lastGmail.slice(11, 16)) : 'Gmail connected'}</span>` : '<a class="small" href="#/settings">Connect Gmail</a>'}</div>
          ${d.fresh.length ? `<ul class="mini-list">${d.fresh.map(c => `<li><span><a href="#/contacts/${c.id}"><b>${esc(fullName(c))}</b></a> <span class="faint small">${esc([c.first_name || c.last_name ? c.company : null, c.lead_source].filter(Boolean).join(' · '))}</span></span>
            <span class="faint small nowrap">${esc(fmtAgo(c.enquiry_date))}</span></li>`).join('')}</ul>`
            : `<div class="empty small">No new leads in the last 7 days. Label an email “${esc(g.gmailLabel || 'CRM Leads')}” in Gmail to add one.</div>`}
        </section>
      </div>
    </div>

    <section class="panel" style="margin-top:20px" aria-labelledby="funnel-h">
      <div class="panel-head"><h2 id="funnel-h">Sales funnel</h2><span class="faint small">${d.won.n ? `${money(d.won.v)}/month won this month (${plural(d.won.n, 'deal')})` : 'No deals won yet this month'}</span><div class="spacer"></div><a class="small" href="#/funnel">Open pipeline</a></div>
      <div class="panel-body" data-funnel></div>
    </section>

    <div class="dash dash-half" style="margin-top:20px">
      <section class="panel" aria-labelledby="warm-h">
        <div class="panel-head"><h2 id="warm-h">Warm leads untouched for 7+ days</h2><span class="badge ${d.warm.count ? 'amber' : ''}">${d.warm.count}</span></div>
        ${d.warm.count ? `<ul class="mini-list">${d.warm.top.map(c => `<li><span><a href="#/contacts/${c.id}"><b>${esc(fullName(c))}</b></a> <span class="faint small">${esc(c.stage)}${c.lead_source ? ' · ' + esc(c.lead_source) : ''}</span></span>
          <span class="faint small nowrap">${esc(fmtAgo(c.last_touch))} <button class="btn small" data-fu="${c.id}" data-name="${esc(fullName(c))}">Follow up</button></span></li>`).join('')}</ul>
          ${d.warm.count > d.warm.top.length ? `<div class="faint small" style="padding:0 18px 14px"><a href="#/contacts?status=New&sort=touched">See all ${d.warm.count}</a></div>` : ''}`
          : '<div class="empty small">Every open lead has a next step.</div>'}
      </section>
      <section class="panel" aria-labelledby="prop-h">
        <div class="panel-head"><h2 id="prop-h">Proposals out</h2><span class="badge ${d.proposals.count ? 'sand' : ''}">${d.proposals.count}</span><div class="spacer"></div>${d.proposals.mrr ? `<span class="faint small mrr">${money(d.proposals.mrr)}/month in play</span>` : ''}</div>
        ${d.proposals.count ? `<ul class="mini-list">${d.proposals.top.map(p => `<li><span><a href="#/contacts/${p.contact_id}"><b>${esc(fullName(p))}</b></a> <span class="faint small">${esc([p.first_name || p.last_name ? p.company : null, p.deal_type, p.plan].filter(Boolean).join(' · '))}${p.price ? ' · ' + money(p.price) + '/month' : ''}</span></span>
          <span class="faint small nowrap">sent ${esc(fmtAgo(p.stage_changed_at))}</span></li>`).join('')}</ul>`
          : '<div class="empty small">No proposals waiting. When you record a demo with a proposal sent, it shows here until it’s won or lost.</div>'}
      </section>
    </div>`;

  const wi = el.querySelector('[data-welcome-import]');
  if (wi) importZone(wi, { onDone: () => setTimeout(() => changed(), 2500) });
  mountFunnel(el.querySelector('[data-funnel]'), d.funnel, 'mine=1');
  bindTasks(el.querySelector('#todo'), [...d.overdue, ...d.dueToday, ...d.doneToday, ...d.upcoming]);
  bindDiary(el.querySelector('#diary-today'));
  el.querySelector('[data-toggle-done]')?.addEventListener('click', () => { showDone = !showDone; render(el); });
  el.querySelector('[data-addtask]').onclick = () => taskDialog();
  el.querySelector('[data-book]').onclick = () => bookDialog();
  el.querySelectorAll('[data-confirm]').forEach(b => b.addEventListener('click', async () => { await post(`/api/appointments/${b.dataset.confirm}/confirm`); toast('Link confirmed'); changed(); }));
  el.querySelectorAll('[data-fu]').forEach(b => b.addEventListener('click', async () => {
    await post('/api/tasks', { title: `Follow up with ${b.dataset.name}`, category: 'Call', priority: 'Medium', contact_id: Number(b.dataset.fu) });
    toast(`Added to today: call ${b.dataset.name}`); changed();
  }));
  void state; void fmtDay; void fmtTime;
}
