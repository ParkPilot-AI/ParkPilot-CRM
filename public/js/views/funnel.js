import { get, esc, state, money, fullName, fmtAgo, fmtWhen, icon, popMenu, isPhone, isMgr, isGroupMgr, me, teamOptions, parkOptions } from '../core.js';
import { moveStage } from '../dialogs.js';
import { mountFunnel } from './funnelchart.js';

let showClosed = false;
let phoneStage = 'Demo booked'; // phones show one stage at a time
let owner = '', park = ''; // managers: whose deals (''=everyone they can see, 'none', 'me' or a user id)

export async function render(el) {
  const m = state.meta;
  const mgr = isMgr();
  const qs = new URLSearchParams(Object.entries({ owner: mgr ? owner : '', park: isGroupMgr() ? park : '' }).filter(([, v]) => v)).toString();
  const [data, f] = await Promise.all([get('/api/deals?' + qs), get('/api/funnel?' + qs)]);
  const stages = showClosed ? m.stages : m.openStages;
  const phone = isPhone();
  if (!stages.includes(phoneStage)) phoneStage = stages[0];
  const openValue = m.openStages.reduce((s, st) => s + data[st].value, 0);
  el.innerHTML = `
    <div class="today-head"><h1>Pipeline</h1>
      <span class="muted">${m.openStages.reduce((s, st) => s + data[st].count, 0)} open deals${openValue ? `, <span class="mrr">${money(openValue)}/month</span> (${money(openValue * 12)} a year)` : ''}</span>
      <div class="spacer"></div>
      <label class="check small"><input type="checkbox" data-closed ${showClosed ? 'checked' : ''}> Show won and lost (${data.Won.count + data.Lost.count})</label>
    </div>
    ${mgr && (m.team || []).length > 1 ? `<div class="toolbar funnel-filters"><label class="small muted">Showing <select data-owner aria-label="Whose deals">
        <option value=""${!owner ? ' selected' : ''}>Everyone</option><option value="me"${owner === 'me' ? ' selected' : ''}>Just mine</option><option value="none"${owner === 'none' ? ' selected' : ''}>Unallocated leads</option>
        <optgroup label="One person">${teamOptions(/^\d+$/.test(owner) ? owner : '')}</optgroup></select></label>
      ${isGroupMgr() && (m.parks || []).length > 1 ? `<label class="small muted">Team <select data-park>${parkOptions(park, { blank: 'All teams' })}</select></label>` : ''}</div>` : ''}
    <section class="panel" style="margin-bottom:18px"><div class="panel-body" style="padding-top:16px" data-funnel></div></section>
    <h2 style="margin:0 0 4px">Deals by stage</h2>
    <p class="faint small" style="margin:0 0 12px">Deals move on automatically as you book and record demos. ${phone ? 'Use “Move” on a card to change its stage yourself.' : 'You can also drag a card, or use “Move”, to change its stage yourself.'}</p>
    ${phone ? `<div class="stage-tabs" role="tablist">${stages.map(st => `<button type="button" role="tab" class="chip${st === phoneStage ? ' on' : ''}" data-tab="${esc(st)}" aria-selected="${st === phoneStage}">${esc(st)} <span class="n">${data[st].count}</span></button>`).join('')}</div>` : ''}
    <div class="board${phone ? ' one' : ''}">${(phone ? [phoneStage] : stages).map(st => {
      const col = data[st];
      return `<div class="col" data-stage="${esc(st)}"><div class="col-head"><h3>${esc(st)} <span class="faint">${col.count}</span></h3><span class="v mrr">${col.value ? money(col.value) + '/mo' : ''}</span></div>
        ${col.rows.map(d => `<div class="card" draggable="${phone ? 'false' : 'true'}" data-deal="${d.id}" data-from="${esc(st)}">
          <div class="card-top"><b><a href="#/contacts/${d.contact_id}">${esc(fullName(d))}</a></b><button type="button" class="btn ghost small" data-move="${d.id}" aria-label="Move ${esc(fullName(d))} to another stage">Move</button></div>
          ${d.company && (d.first_name || d.last_name) ? `<div class="meta"><span>${esc(d.company)}${d.units ? ` · ${esc(d.units)} units` : ''}</span></div>` : ''}
          <div class="meta"><span>${esc(d.deal_type)}${d.plan ? ' ' + esc(d.plan) : ''}</span>${d.price ? `<span class="mrr">${money(d.price)}/mo</span>` : ''}</div>
          ${mgr && (m.team || []).length > 1 ? `<div class="meta owner">${d.owner_id ? esc(d.owner_id === me().id ? 'You' : d.owner_name || '') : '<span class="badge amber" style="padding:0 6px">Unallocated</span>'}</div>` : ''}
          <div class="meta">${d.next_appt ? `<span>Next: ${esc(fmtWhen(d.next_appt))}</span>` : `<span>In stage ${esc(fmtAgo(d.stage_changed_at || d.created_at))}</span>`}${d.lead_source ? `<span>${esc(d.lead_source)}</span>` : ''}</div>
        </div>`).join('')}
        ${col.count > col.rows.length ? `<a class="small" href="#/contacts?stage=${encodeURIComponent(st)}">See all ${col.count}</a>` : ''}
        ${!col.count ? '<div class="faint small" style="padding:6px 4px">No deals</div>' : ''}
      </div>`;
    }).join('')}</div>`;

  mountFunnel(el.querySelector('[data-funnel]'), f, qs);
  el.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { phoneStage = b.dataset.tab; render(el); }));
  el.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const from = b.closest('.card').dataset.from;
    popMenu(b, m.stages.filter(st => st !== from).map(st => ({ label: st, icon: st === 'Lost' ? 'x' : 'deal', danger: st === 'Lost', run: () => moveStage({ id: Number(b.dataset.move) }, st) })), { title: 'Move to' });
  }));
  el.querySelector('[data-owner]')?.addEventListener('change', e => { owner = e.target.value; render(el); });
  el.querySelector('[data-park]')?.addEventListener('change', e => { park = e.target.value; render(el); });
  el.querySelector('[data-closed]').onchange = e => { showClosed = e.target.checked; render(el); };
  el.querySelectorAll('.card').forEach(c => c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/deal', c.dataset.deal); e.dataTransfer.setData('text/from', c.dataset.from); }));
  el.querySelectorAll('.col').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drop'); });
    col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop'); });
    col.addEventListener('drop', async e => {
      e.preventDefault(); col.classList.remove('drop');
      const id = e.dataTransfer.getData('text/deal'), from = e.dataTransfer.getData('text/from');
      if (!id || from === col.dataset.stage) return;
      await moveStage({ id: Number(id) }, col.dataset.stage);
    });
  });
}
