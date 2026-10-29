import { get, esc, state, fmtDate, fmtAgo, fullName, options, fmtWhen, icon, isMgr, isGroupMgr, me, teamOptions, parkOptions, plural } from '../core.js';
import { contactDialog, allocateDialog } from '../dialogs.js';

let sourcesCache = null;
let selecting = false;
const selected = new Set();
const FILTER_KEYS = ['q', 'status', 'type', 'source', 'stage', 'interest', 'dups', 'owner', 'park'];

export async function render(el, { query }) {
  const m = state.meta;
  const qs = new URLSearchParams({ page: query.page || 1, pageSize: 50, sort: query.sort || 'recent' });
  for (const k of FILTER_KEYS) if (query[k]) qs.set(k, query[k]);
  const mgr = isMgr();
  if (!mgr) selecting = false;
  const [data, dupGroups] = await Promise.all([get('/api/contacts?' + qs), mgr ? get('/api/duplicates') : Promise.resolve([])]);
  if (!sourcesCache) sourcesCache = await get('/api/sources');
  const setQuery = patch => {
    const next = { ...query, ...patch };
    if (!('page' in patch)) next.page = 1;
    const s = new URLSearchParams(Object.entries(next).filter(([, v]) => v !== '' && v !== null && v !== undefined && !(v === 1 && false)));
    location.hash = '#/contacts?' + s;
  };
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const filtered = FILTER_KEYS.some(k => query[k]);
  const ownerCell = c => c.owner_id ? (c.owner_id === me().id ? 'You' : c.owner_name || '') : '<span class="badge amber" style="padding:0 6px">Unallocated</span>';
  const showOwner = mgr && (m.team || []).length > 1;
  const tick = c => selecting ? `<input type="checkbox" class="pick" data-pick="${c.id}" aria-label="Select ${esc(fullName(c))}" ${selected.has(c.id) ? 'checked' : ''}>` : '';

  el.innerHTML = `
    <div class="today-head"><h1>${mgr ? 'Leads' : 'My leads'}</h1><span class="muted">${data.total.toLocaleString('en-GB')} ${filtered ? 'matching' : 'in total'}</span><div class="spacer"></div>
      ${dupGroups.length ? `<a class="btn" href="#/contacts/duplicates">Review ${dupGroups.length} possible duplicates</a>` : ''}
      ${mgr && (m.team || []).length > 1 ? `<button class="btn" data-select aria-pressed="${selecting}">${selecting ? 'Done selecting' : 'Select to allocate'}</button>` : ''}
      ${mgr ? `<a class="btn desk-only" href="/api/export/contacts.csv?${new URLSearchParams(Object.fromEntries(['owner', 'park'].filter(k => query[k]).map(k => [k, query[k]])))}" download>Export CSV</a>` : ''}
      <button class="btn primary desk-only" data-new>+ Lead</button></div>
    ${mgr && (m.team || []).length > 1 ? `<div class="chips owner-chips" role="group" aria-label="Whose leads">
      ${[['', 'Everyone'], ['none', 'Unallocated'], ['me', 'Mine']].map(([v, l]) => `<button type="button" class="chip${(query.owner || '') === v ? ' on' : ''}" data-owner="${v}">${l}</button>`).join('')}
      <select data-f="owner" aria-label="Allocated to" class="${/^\d+$/.test(query.owner || '') ? 'on' : ''}"><option value="">Someone in the team…</option>${teamOptions(/^\d+$/.test(query.owner || '') ? query.owner : '')}</select>
      ${isGroupMgr() && (state.meta.parks || []).length > 1 ? `<select data-f="park" aria-label="Park">${parkOptions(query.park, { blank: 'All parks' })}</select>` : ''}
    </div>` : ''}
    ${selecting ? `<div class="select-bar" role="region" aria-label="Selection"><b data-selcount>${`${selected.size} selected`}</b>
      <button type="button" class="btn small" data-selpage>Select this page</button><button type="button" class="btn small ghost" data-selnone>Clear</button><div class="spacer"></div>
      <button type="button" class="btn primary small" data-allocate ${selected.size ? '' : 'disabled'}>Allocate…</button></div>` : ''}
    <div class="toolbar contacts-filters${filtered ? ' open' : ''}">
      <button type="button" class="btn filter-toggle" data-togglefilters aria-expanded="${filtered ? 'true' : 'false'}">${filtered ? 'Filters on' : 'Filter and sort'}</button>
      <input type="search" data-f="q" placeholder="Filter by name, park, phone, email, lead no." value="${esc(query.q || '')}" style="min-width:260px">
      <select data-f="status" aria-label="Lead status">${options(m.leadStatuses, query.status, { blank: 'Any status' })}</select>
      <select data-f="type" aria-label="Type">${options(m.contactTypes, query.type, { blank: 'Any type' })}</select>
      <select data-f="stage" aria-label="Deal stage">${options(m.stages, query.stage, { blank: 'Any deal stage' })}</select>
      <select data-f="interest" aria-label="Interested in">${options(m.products, query.interest, { blank: 'Any product' })}</select>
      <select data-f="source" aria-label="Lead source">${options(sourcesCache.map(s => ({ value: s.source, label: `${s.source} (${s.n})` })), query.source, { blank: 'Any source' })}</select>
      <div class="spacer"></div>
      <label class="small muted">Sort <select data-f="sort">${options([{ value: 'recent', label: 'Newest enquiry' }, { value: 'touched', label: 'Last contact' }, { value: 'company', label: 'Park name' }, { value: 'name', label: 'Surname' }], query.sort || 'recent')}</select></label>
      ${filtered ? '<button class="btn ghost small" data-clear>Clear filters</button>' : ''}
    </div>
    ${data.rows.length ? `<div class="table-wrap desk-only"><table class="list">
      <thead><tr>${selecting ? '<th class="pick-col"><span class="sr">Select</span></th>' : ''}<th>Name</th><th>Park</th><th class="hide-m">Phone</th><th>Status</th><th class="hide-m">Deal stage</th><th class="hide-m">Source</th><th>Enquired</th><th class="hide-m">Last contact</th>${showOwner ? '<th>Allocated to</th>' : ''}</tr></thead>
      <tbody>${data.rows.map(c => `<tr class="click" data-id="${c.id}" tabindex="0">
        ${selecting ? `<td class="pick-col">${tick(c)}</td>` : ''}<td class="name-cell"><strong>${esc(fullName(c))}</strong><span class="faint small">${esc(c.lead_no || c.type)}${c.dup_group && !c.dup_dismissed ? ' · <span class="badge amber" style="padding:0 6px">Possible duplicate</span>' : ''}${c.next_appt ? ` · next: ${esc(fmtWhen(c.next_appt))}` : ''}${c.open_tasks ? ` · ${c.open_tasks} open task${c.open_tasks > 1 ? 's' : ''}` : ''}</span></td>
        <td>${c.company && (c.first_name || c.last_name) ? esc(c.company) : ''}${c.units ? `<span class="faint small" style="display:block">${esc(c.units)} units</span>` : ''}</td>
        <td class="hide-m nowrap">${esc(c.mobile || '')}</td>
        <td><span class="status ${esc(c.lead_status)}">${esc(c.lead_status)}</span></td>
        <td class="hide-m">${esc(c.stage || '')}</td>
        <td class="hide-m small">${esc(c.lead_source || '')}</td>
        <td class="nowrap small">${esc(c.enquiry_date ? fmtDate(c.enquiry_date) : '')}</td>
        <td class="hide-m small">${esc(c.last_contact_at ? fmtAgo(c.last_contact_at) : '')}</td>
        ${showOwner ? `<td class="small">${ownerCell(c)}${isGroupMgr() && c.park_name && !query.park ? `<span class="faint small" style="display:block">${esc(c.park_name)}</span>` : ''}</td>` : ''}
      </tr>`).join('')}</tbody></table></div>
      <ul class="m-cards${selecting ? ' selecting' : ''}" aria-label="Contacts">${data.rows.map(c => `<li class="m-card" data-id="${c.id}">
        ${selecting ? `<label class="m-pick">${tick(c)}</label>` : ''}
        <a class="m-main" href="#/contacts/${c.id}"><b>${esc(fullName(c))}</b>${c.company && (c.first_name || c.last_name) ? `<span class="m-sub">${esc(c.company)}</span>` : ''}
          <span class="m-sub"><span class="status ${esc(c.lead_status)}">${esc(c.lead_status)}</span>${c.stage ? ` · ${esc(c.stage)}` : ''}${c.lead_source ? ` · ${esc(c.lead_source)}` : ''}</span>
          <span class="m-sub faint">${c.lead_no ? esc(c.lead_no) + ' · ' : ''}${c.next_appt ? `Next: ${esc(fmtWhen(c.next_appt))}` : c.enquiry_date ? `Enquired ${esc(fmtDate(c.enquiry_date))}` : ''}${c.open_tasks ? ` · ${c.open_tasks} open task${c.open_tasks > 1 ? 's' : ''}` : ''}${c.dup_group && !c.dup_dismissed ? ' · possible duplicate' : ''}</span>
          ${showOwner ? `<span class="m-sub">${c.owner_id ? `<span class="faint">Allocated to</span> ${esc(c.owner_id === me().id ? 'you' : c.owner_name || '')}` : '<span class="badge amber" style="padding:0 6px">Unallocated</span>'}</span>` : ''}</a>
        ${c.phone_e164 || c.mobile ? `<a class="m-call" href="tel:${esc(c.phone_e164 || c.mobile)}" aria-label="Call ${esc(fullName(c))}">${icon('phone')}</a>` : ''}
      </li>`).join('')}</ul>
      <div class="pager"><span>Page ${data.page} of ${pages}</span><span>
        <button class="btn small" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>Previous</button>
        <button class="btn small" data-page="${data.page + 1}" ${data.page >= pages ? 'disabled' : ''}>Next</button></span></div>`
      : `<div class="panel empty"><strong>No leads ${filtered ? 'match' : 'yet'}</strong>${filtered ? 'Try clearing a filter.' : 'Label an email “CRM Leads” in Gmail, add a lead with + Lead, or import a spreadsheet in Settings.'}</div>`}`;

  let t;
  el.querySelector('[data-f=q]').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => setQuery({ q: e.target.value.trim() }), 350); });
  el.querySelectorAll('select[data-f]').forEach(s => s.addEventListener('change', () => setQuery({ [s.dataset.f]: s.value })));
  el.querySelector('[data-clear]')?.addEventListener('click', () => { location.hash = '#/contacts'; });
  el.querySelector('[data-togglefilters]').addEventListener('click', e => {
    const box = el.querySelector('.contacts-filters'); box.classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', box.classList.contains('open'));
  });
  el.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => setQuery({ page: b.dataset.page })));
  el.querySelector('[data-new]').onclick = () => contactDialog(null, { onSaved: c => { location.hash = `#/contacts/${c.id}`; } });
  el.querySelectorAll('[data-owner]').forEach(b => b.addEventListener('click', () => setQuery({ owner: b.dataset.owner })));
  el.querySelector('[data-select]')?.addEventListener('click', () => { selecting = !selecting; selected.clear(); render(el, { query }); });
  const updateSel = () => {
    const n = el.querySelector('[data-selcount]'); if (n) n.textContent = `${selected.size} selected`;
    const a = el.querySelector('[data-allocate]'); if (a) a.disabled = !selected.size;
  };
  el.querySelectorAll('[data-pick]').forEach(cb => {
    cb.addEventListener('click', e => e.stopPropagation());
    cb.addEventListener('change', () => { const id = Number(cb.dataset.pick); if (cb.checked) selected.add(id); else selected.delete(id); el.querySelectorAll(`[data-pick="${id}"]`).forEach(x => { x.checked = cb.checked; }); updateSel(); });
  });
  el.querySelector('[data-selpage]')?.addEventListener('click', () => { data.rows.forEach(c => selected.add(c.id)); el.querySelectorAll('[data-pick]').forEach(x => { x.checked = true; }); updateSel(); });
  el.querySelector('[data-selnone]')?.addEventListener('click', () => { selected.clear(); el.querySelectorAll('[data-pick]').forEach(x => { x.checked = false; }); updateSel(); });
  el.querySelector('[data-allocate]')?.addEventListener('click', () => allocateDialog([...selected], { onDone: () => { selected.clear(); selecting = false; render(el, { query }); } }));
  el.querySelector('.m-cards.selecting')?.addEventListener('click', e => { const card = e.target.closest('.m-card'); if (!card || e.target.closest('.m-pick') || e.target.closest('.m-call')) return; e.preventDefault(); const cb = card.querySelector('[data-pick]'); cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); });
  el.querySelector('tbody')?.addEventListener('click', e => {
    if (selecting) { const r = e.target.closest('tr[data-id]'); if (r && !e.target.closest('[data-pick]')) { const cb = r.querySelector('[data-pick]'); cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); } return; }
    if (e.target.closest('a')) return; const r = e.target.closest('tr[data-id]'); if (r) location.hash = `#/contacts/${r.dataset.id}`; });
  el.querySelector('tbody')?.addEventListener('keydown', e => { if (e.key === 'Enter') { const r = e.target.closest('tr[data-id]'); if (r) location.hash = `#/contacts/${r.dataset.id}`; } });
  if (query.q && !document.activeElement.matches('input')) { const i = el.querySelector('[data-f=q]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}
