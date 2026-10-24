// The Captain's Log: the sales managers' overview of their park (group sales managers: every park).
import { get, esc, state, money, plural, fmtTime, fmtAgo, fullName, isGroupMgr, me, parkOptions, icon } from '../core.js';
import { allocateDialog, apptDialog } from '../dialogs.js';
import { mountFunnel } from './funnelchart.js';

const PERIODS = [['30', '30 days'], ['90', '90 days'], ['365', '1 year'], ['all', 'All time']];
let period = null, park = '';

const periodText = p => p === 'all' ? 'all time' : p === '365' ? 'the last 12 months' : `the last ${p} days`;
const num = n => Number(n || 0).toLocaleString('en-GB');
const pct = (a, b) => b && a ? `${Math.round(100 * a / b)}%` : '';

function tile(label, value, sub = '', { href, tone } = {}) {
  const inner = `<span class="k-label">${tone ? `<span class="k-flag ${tone}">${icon(tone === 'red' ? 'warn' : 'clock')}</span>` : ''}${esc(label)}</span><span class="k-value">${value}</span>${sub ? `<span class="k-sub">${sub}</span>` : ''}`;
  return href ? `<a class="kpi${tone ? ' ' + tone : ''}" href="${href}">${inner}</a>` : `<div class="kpi">${inner}</div>`;
}

export async function render(el) {
  if (!period) period = state.meta.funnelPeriod || '90';
  const group = isGroupMgr();
  const qs = new URLSearchParams({ period, ...(group && park ? { park } : {}) });
  const d = await get('/api/captains-log?' + qs);
  const h = d.headline;
  const where = d.park ? d.park.name : group ? 'All parks' : (me().park_name || 'Your park');
  const ownerLink = id => `#/contacts?owner=${id}`;

  el.innerHTML = `
    <div class="today-head log-head">
      <div class="date"><span class="log-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2.2"/><path d="M12 7.2V21M7 11h10M4 14a8 8 0 0 0 16 0"/></svg></span>
        <div><h1>Captain’s Log</h1><div class="day-sub">${esc(where)} · ${esc(periodText(d.period))}</div></div></div>
      <div class="spacer"></div>
      ${group && (state.meta.parks || []).length > 1 ? `<label class="small muted">Park <select data-park>${parkOptions(park, { blank: 'All parks' })}</select></label>` : ''}
      <div class="seg" role="group" aria-label="Period">${PERIODS.map(([v, l]) => `<button type="button" data-period="${v}" class="${d.period === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    </div>

    <div class="kpis">
      ${tile('Enquiries', num(h.enquiries))}
      ${tile('Park tours held', num(h.tours), h.toursAhead ? `${plural(h.toursAhead, 'more')} booked, next 2 weeks` : 'None booked in the next 2 weeks')}
      ${tile('Sales', num(h.reserved.n), h.reserved.v ? `${money(h.reserved.v)} · deposit or paid` : 'Deposit or paid in full')}
      ${tile('Handovers', num(h.completed.n), h.completed.v ? money(h.completed.v) : 'Keys handed over')}
      ${tile('Enquiry to sale', h.enquiries ? `${h.conversion}%` : '–', `${num(h.lost)} lost`)}
      ${tile('In the pipeline', money(h.pipeline.v) || '£0', `${plural(h.pipeline.n, 'deal')} from tour onwards`)}
      ${tile('Unallocated', num(h.unallocated), h.unallocated ? 'Waiting for an owner' : 'Every lead has an owner', { href: '#/contacts?owner=none' + (park ? '&park=' + park : ''), tone: h.unallocated ? 'amber' : '' })}
      ${tile('Overdue tasks', num(h.overdue), h.overdue ? 'Across the team' : 'Nothing overdue', { tone: h.overdue ? 'red' : '' })}
    </div>

    <div class="dash log-top">
      <section class="panel" aria-labelledby="lf-h">
        <div class="panel-head"><h2 id="lf-h">Sales funnel</h2><div class="spacer"></div><a class="small" href="#/funnel">Open funnel</a></div>
        <div class="panel-body" data-funnel></div>
      </section>
      <section class="panel" aria-labelledby="un-h" id="unallocated">
        <div class="panel-head"><h2 id="un-h">Waiting to be allocated</h2><span class="badge ${h.unallocated ? 'amber' : ''}">${num(h.unallocated)}</span><div class="spacer"></div>
          ${d.unallocated.length ? `<button class="btn small primary" data-allocall>Allocate ${d.unallocated.length === h.unallocated ? 'all' : 'these ' + d.unallocated.length}</button>` : ''}</div>
        ${d.unallocated.length ? `<ul class="mini-list">${d.unallocated.map(c => `<li><span><a href="#/contacts/${c.id}"><b>${esc(fullName(c))}</b></a>
            <span class="faint small">${esc([c.lead_source, c.stage, group && !d.park ? c.park_name : null].filter(Boolean).join(' · '))}</span></span>
            <span class="faint small nowrap">${esc(c.enquiry_date ? fmtAgo(c.enquiry_date) : '')} <button class="btn small" data-alloc="${c.id}" data-name="${esc(fullName(c))}">Allocate</button></span></li>`).join('')}</ul>
          ${h.unallocated > d.unallocated.length ? `<div class="faint small" style="padding:0 18px 14px"><a href="#/contacts?owner=none${park ? '&park=' + park : ''}">See all ${num(h.unallocated)} and allocate in bulk</a></div>` : ''}`
          : '<div class="empty small">Every lead has someone looking after it.</div>'}
      </section>
    </div>

    <section class="panel" style="margin-top:20px" aria-labelledby="team-h">
      <div class="panel-head"><h2 id="team-h">The team</h2><span class="faint small">Sales and tours in ${esc(periodText(d.period))}; tasks and diary as of today</span><div class="spacer"></div>
        <a class="small" href="#/settings?section=team">Manage the team</a></div>
      ${d.team.length ? `<div class="table-wrap desk-only"><table class="list team-table">
        <thead><tr><th>Name</th><th class="num">Open leads</th><th class="num">New</th><th class="num">Overdue</th><th class="num">Due today</th><th class="num">Next 7 days</th><th class="num">Tours</th><th class="num">Sales</th><th class="num">Gone quiet</th><th>Outlook</th><th>Last in</th></tr></thead>
        <tbody>${d.team.map(p => `<tr>
          <td class="name-cell"><a href="${ownerLink(p.id)}"><strong>${esc(p.name)}${p.id === me().id ? ' (you)' : ''}</strong></a><span class="faint small">${esc(p.roleLabel)}${group && !d.park && p.park_name ? ' · ' + esc(p.park_name) : ''}</span></td>
          <td class="num"><a href="${ownerLink(p.id)}">${num(p.leads)}</a></td>
          <td class="num">${num(p.newLeads)}</td>
          <td class="num">${p.overdue ? `<span class="badge red">${num(p.overdue)} late</span>` : '0'}</td>
          <td class="num">${num(p.dueToday)}${p.doneToday ? `<span class="faint small" style="display:block">${num(p.doneToday)} done</span>` : ''}</td>
          <td class="num"><a href="#/diary?user=${p.id}">${plural(p.appts, 'appt')}</a></td>
          <td class="num">${num(p.tours)}</td>
          <td class="num"><b>${num(p.reserved.n)}</b>${p.reserved.v ? `<span class="faint small" style="display:block">${money(p.reserved.v)}</span>` : ''}</td>
          <td class="num">${p.cold ? `<a href="${ownerLink(p.id)}&sort=touched"><span class="badge amber">${num(p.cold)}</span></a>` : '0'}</td>
          <td>${p.outlook ? '<span class="sync-pill"><span class="dot ok"></span>Connected</span>' : '<span class="faint small">Not connected</span>'}</td>
          <td class="small faint nowrap">${p.lastSeen ? esc(fmtAgo(p.lastSeen)) : 'Never'}</td>
        </tr>`).join('')}</tbody></table></div>
        <ul class="m-cards team-cards" aria-label="The team">${d.team.map(p => `<li class="m-card">
          <a class="m-main" href="${ownerLink(p.id)}"><b>${esc(p.name)}${p.id === me().id ? ' (you)' : ''}</b>
            <span class="m-sub faint">${esc(p.roleLabel)}${group && !d.park && p.park_name ? ' · ' + esc(p.park_name) : ''} · last in ${p.lastSeen ? esc(fmtAgo(p.lastSeen)) : 'never'}</span>
            <span class="m-stats"><span><b>${num(p.leads)}</b> leads</span><span><b>${num(p.tours)}</b> tours</span><span><b>${num(p.reserved.n)}</b> sales</span><span><b>${num(p.appts)}</b> next 7 days</span></span>
            <span class="m-sub">${p.overdue ? `<span class="badge red">${num(p.overdue)} late</span> ` : ''}${p.cold ? `<span class="badge amber">${num(p.cold)} gone quiet</span> ` : ''}${p.outlook ? '' : '<span class="faint">Outlook not connected</span>'}</span></a>
        </li>`).join('')}</ul>`
        : `<div class="empty small">No one on the team yet. <a href="#/settings?section=team">Add your sales executives</a>.</div>`}
      <p class="faint small" style="margin:0;padding:10px 18px 14px">“Gone quiet” means open leads with no contact for 14 days and nothing planned: no task and no appointment.</p>
    </section>

    ${d.parks ? `<section class="panel" style="margin-top:20px" aria-labelledby="parks-h">
      <div class="panel-head"><h2 id="parks-h">Parks side by side</h2><span class="faint small">${esc(periodText(d.period))}</span></div>
      <div class="table-wrap"><table class="list team-table">
        <thead><tr><th>Park</th><th class="num">People</th><th class="num">Enquiries</th><th class="num">Tours</th><th class="num">Sales</th><th class="num">Enquiry to sale</th><th class="num">Pipeline</th><th class="num">Unallocated</th><th class="num">Overdue</th></tr></thead>
        <tbody>${d.parks.map(p => `<tr class="click" data-gopark="${p.id}" tabindex="0">
          <td><strong>${esc(p.name)}</strong></td><td class="num">${num(p.people)}</td><td class="num">${num(p.enquiries)}</td><td class="num">${num(p.tours)}</td>
          <td class="num"><b>${num(p.reserved.n)}</b>${p.reserved.v ? `<span class="faint small" style="display:block">${money(p.reserved.v)}</span>` : ''}</td>
          <td class="num">${p.enquiries ? p.conversion + '%' : '–'}</td><td class="num">${money(p.pipeline.v) || '£0'}</td>
          <td class="num">${p.unallocated ? `<span class="badge amber">${num(p.unallocated)}</span>` : '0'}</td>
          <td class="num">${p.overdue ? `<span class="badge red">${num(p.overdue)}</span>` : '0'}</td></tr>`).join('')}</tbody></table></div>
    </section>` : ''}

    <div class="dash dash-half" style="margin-top:20px">
      <section class="panel" aria-labelledby="td-h">
        <div class="panel-head"><h2 id="td-h">Today across the team</h2><span class="badge">${d.todayAppts.length}</span></div>
        ${d.todayAppts.length ? `<ul class="mini-list">${d.todayAppts.map(a => `<li><span><b>${esc(fmtTime(a.start))}</b> ${esc(a.type)} – <a href="#/contacts/${a.contact_id}">${esc(fullName(a))}</a>
            <span class="faint small" style="display:block">${esc(a.owner_name || 'Unassigned diary')}${a.status === 'Completed' ? ' · done' + (a.outcome ? ': ' + esc(a.outcome) : '') : ''}</span></span>
            <button class="btn ghost small" data-appt="${a.id}">Open</button></li>`).join('')}</ul>`
          : '<div class="empty small">Nothing booked today.</div>'}
      </section>
      <section class="panel" aria-labelledby="src-h">
        <div class="panel-head"><h2 id="src-h">Where leads come from</h2><span class="faint small">${esc(periodText(d.period))}</span></div>
        ${d.sources.length ? `<div class="table-wrap"><table class="list src-table"><thead><tr><th>Source</th><th class="num">Enquiries</th><th class="num">Reached tour</th><th class="num">Sales</th></tr></thead>
          <tbody>${d.sources.map(s => `<tr><td>${esc(s.source)}</td><td class="num">${num(s.enquiries)}</td><td class="num">${num(s.tours)} <span class="faint small">${pct(s.tours, s.enquiries)}</span></td><td class="num">${num(s.sales)} <span class="faint small">${pct(s.sales, s.enquiries)}</span></td></tr>`).join('')}</tbody></table></div>`
          : '<div class="empty small">No enquiries in this period.</div>'}
      </section>
    </div>`;

  const scopeQs = group && park ? `park=${park}` : '';
  mountFunnel(el.querySelector('[data-funnel]'), d.funnel, scopeQs, { periodSwitch: false });
  el.querySelectorAll('[data-period]').forEach(b => b.addEventListener('click', () => { period = b.dataset.period; render(el); }));
  el.querySelector('[data-park]')?.addEventListener('change', e => { park = e.target.value; render(el); });
  el.querySelectorAll('[data-gopark]').forEach(r => r.addEventListener('click', () => { park = r.dataset.gopark; render(el); window.scrollTo(0, 0); }));
  el.querySelectorAll('[data-alloc]').forEach(b => b.addEventListener('click', () => allocateDialog([Number(b.dataset.alloc)], { label: b.dataset.name })));
  el.querySelector('[data-allocall]')?.addEventListener('click', () => allocateDialog(d.unallocated.map(c => c.id)));
  el.querySelectorAll('[data-appt]').forEach(b => b.addEventListener('click', () => apptDialog(b.dataset.appt)));
}
