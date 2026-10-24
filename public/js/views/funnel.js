import { get, esc, state, money, fullName, fmtAgo, fmtWhen } from '../core.js';
import { moveStage } from '../dialogs.js';
import { mountFunnel } from './funnelchart.js';

let showClosed = false;

export async function render(el) {
  const m = state.meta;
  const [data, f] = await Promise.all([get('/api/deals'), get('/api/funnel')]);
  const stages = showClosed ? m.stages : m.openStages;
  const openValue = m.openStages.reduce((s, st) => s + (st === 'Enquiry' ? 0 : data[st].value), 0);
  el.innerHTML = `
    <div class="today-head"><h1>Funnel</h1>
      <span class="muted">${m.openStages.reduce((s, st) => s + data[st].count, 0)} open deals${openValue ? `, ${money(openValue)} beyond enquiry` : ''}</span>
      <div class="spacer"></div>
      <label class="check small"><input type="checkbox" data-closed ${showClosed ? 'checked' : ''}> Show completed and lost (${data.Completed.count + data.Lost.count})</label>
    </div>
    <section class="panel" style="margin-bottom:18px"><div class="panel-body" style="padding-top:16px" data-funnel></div></section>
    <h2 style="margin:0 0 4px">Deals by stage</h2>
    <p class="faint small" style="margin:0 0 12px">Deals move on automatically as you book appointments and record tours and payments. You can also drag a card to move it.</p>
    <div class="board">${stages.map(st => {
      const col = data[st];
      return `<div class="col" data-stage="${esc(st)}"><div class="col-head"><h3>${esc(st)} <span class="faint">${col.count}</span></h3><span class="v">${col.value ? money(col.value) : ''}</span></div>
        ${col.rows.map(d => `<div class="card" draggable="true" data-deal="${d.id}" data-from="${esc(st)}">
          <b><a href="#/contacts/${d.contact_id}">${esc(fullName(d))}</a></b>
          <div class="meta"><span>${esc(d.deal_type)}</span>${d.make ? `<span>${esc([d.make, d.model].filter(Boolean).join(' '))}</span>` : ''}${d.plot_number ? `<span>Plot ${esc(d.plot_number)}</span>` : ''}
            ${d.price ? `<span>${money((d.price || 0) - (d.part_ex_allowance || 0))}</span>` : ''}</div>
          <div class="meta">${d.next_appt ? `<span>Next: ${esc(fmtWhen(d.next_appt))}</span>` : `<span>In stage ${esc(fmtAgo(d.stage_changed_at || d.created_at))}</span>`}${d.lead_source ? `<span>${esc(d.lead_source)}</span>` : ''}</div>
        </div>`).join('')}
        ${col.count > col.rows.length ? `<a class="small" href="#/contacts?stage=${encodeURIComponent(st)}">See all ${col.count}</a>` : ''}
        ${!col.count ? '<div class="faint small" style="padding:6px 4px">No deals</div>' : ''}
      </div>`;
    }).join('')}</div>`;

  mountFunnel(el.querySelector('[data-funnel]'), f);
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
