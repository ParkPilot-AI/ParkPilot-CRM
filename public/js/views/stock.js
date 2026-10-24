import { get, esc, money, fullName, fmtDate } from '../core.js';
import { homeDialog, plotDialog } from '../dialogs.js';

export async function render(el, { query }) {
  const tab = query.tab === 'plots' ? 'plots' : 'homes';
  const [homes, plots] = await Promise.all([get('/api/homes'), get('/api/plots')]);
  const forSale = homes.filter(h => ['Available', 'Reserved', 'Part-ex in'].includes(h.status));
  el.innerHTML = `
    <div class="today-head"><h1>Homes and plots</h1><span class="muted">${forSale.length} homes for sale, ${plots.filter(p => p.status === 'Vacant').length} vacant plots</span>
      <div class="spacer"></div><button class="btn primary" data-add>${tab === 'homes' ? '+ Holiday home' : '+ Plot'}</button></div>
    <div class="tabs" role="tablist"><button role="tab" class="${tab === 'homes' ? 'on' : ''}" data-tab="homes">Holiday homes (${homes.length})</button><button role="tab" class="${tab === 'plots' ? 'on' : ''}" data-tab="plots">Plots (${plots.length})</button></div>
    ${tab === 'homes' ? (homes.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Home</th><th>Status</th><th>Price</th><th class="hide-m">Size</th><th class="hide-m">Beds</th><th>Plot</th><th class="hide-m">Owner</th><th class="hide-m">Licence ends</th></tr></thead><tbody>
      ${homes.map(h => `<tr class="click" data-home="${h.id}" tabindex="0"><td><strong>${esc([h.year, h.make, h.model].filter(Boolean).join(' ') || 'Holiday home')}</strong><div class="faint small">${esc(h.condition || '')}</div></td>
        <td><span class="badge ${h.status === 'Available' ? 'green' : h.status === 'Reserved' ? 'amber' : h.status === 'Owner-held' ? 'sun' : ''}">${esc(h.status)}</span></td>
        <td>${money(h.price)}</td><td class="hide-m">${esc(h.size || '')}</td><td class="hide-m">${esc(h.bedrooms ?? '')}</td><td>${esc(h.plot_number || '')}</td>
        <td class="hide-m">${h.owner_contact_id ? `<a href="#/contacts/${h.owner_contact_id}">${esc(fullName(h))}</a>` : ''}</td><td class="hide-m">${esc(h.licence_expiry ? fmtDate(h.licence_expiry) : '')}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="panel empty"><strong>No holiday homes yet</strong>Add your stock for sale, plus owners’ current homes so part-exchanges and licence renewals show up.</div>`)
    : (plots.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Plot</th><th>Area</th><th class="hide-m">Outlook</th><th>Status</th><th>Pitch fee</th><th class="hide-m">Home on it</th></tr></thead><tbody>
      ${plots.map(p => `<tr class="click" data-plot="${p.id}" tabindex="0"><td><strong>${esc(p.plot_number)}</strong></td><td>${esc(p.area || '')}</td><td class="hide-m">${esc(p.outlook || '')}</td>
        <td><span class="badge ${p.status === 'Vacant' ? 'green' : p.status === 'Reserved' ? 'amber' : ''}">${esc(p.status)}</span></td><td>${p.pitch_fee ? money(p.pitch_fee) + ' a year' : ''}</td><td class="hide-m">${esc(p.home || '')}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="panel empty"><strong>No plots yet</strong>Add plots to link homes and deals to a pitch.</div>`)}`;

  el.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { location.hash = '#/stock?tab=' + b.dataset.tab; }));
  el.querySelector('[data-add]').onclick = () => tab === 'homes' ? homeDialog() : plotDialog();
  const open = r => r.dataset.home ? homeDialog(homes.find(h => String(h.id) === r.dataset.home)) : plotDialog(plots.find(p => String(p.id) === r.dataset.plot));
  el.querySelectorAll('tr[data-home], tr[data-plot]').forEach(r => {
    r.addEventListener('click', e => { if (!e.target.closest('a')) open(r); });
    r.addEventListener('keydown', e => { if (e.key === 'Enter') open(r); });
  });
}
