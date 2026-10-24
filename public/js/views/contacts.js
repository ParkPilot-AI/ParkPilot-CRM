import { get, esc, state, fmtDate, fmtAgo, fullName, options, fmtWhen } from '../core.js';
import { contactDialog } from '../dialogs.js';

let sourcesCache = null;

export async function render(el, { query }) {
  const m = state.meta;
  const qs = new URLSearchParams({ page: query.page || 1, pageSize: 50, sort: query.sort || 'recent' });
  for (const k of ['q', 'status', 'type', 'source', 'stage', 'dups']) if (query[k]) qs.set(k, query[k]);
  const [data, dupGroups] = await Promise.all([get('/api/contacts?' + qs), get('/api/duplicates')]);
  if (!sourcesCache) sourcesCache = await get('/api/sources');
  const setQuery = patch => {
    const next = { ...query, ...patch };
    if (!('page' in patch)) next.page = 1;
    const s = new URLSearchParams(Object.entries(next).filter(([, v]) => v !== '' && v !== null && v !== undefined && !(v === 1 && false)));
    location.hash = '#/contacts?' + s;
  };
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const filtered = ['q', 'status', 'type', 'source', 'stage', 'dups'].some(k => query[k]);

  el.innerHTML = `
    <div class="today-head"><h1>Contacts</h1><span class="muted">${data.total.toLocaleString('en-GB')} ${filtered ? 'matching' : 'in total'}</span><div class="spacer"></div>
      ${dupGroups.length ? `<a class="btn" href="#/contacts/duplicates">Review ${dupGroups.length} possible duplicates</a>` : ''}
      <a class="btn" href="/api/export/contacts.csv" download>Export CSV</a>
      <button class="btn primary" data-new>+ Contact</button></div>
    <div class="toolbar">
      <input type="search" data-f="q" placeholder="Filter by name, phone, email, lead no." value="${esc(query.q || '')}" style="min-width:260px">
      <select data-f="status" aria-label="Lead status">${options(m.leadStatuses, query.status, { blank: 'Any status' })}</select>
      <select data-f="type" aria-label="Type">${options(m.contactTypes, query.type, { blank: 'Any type' })}</select>
      <select data-f="stage" aria-label="Deal stage">${options(m.stages, query.stage, { blank: 'Any deal stage' })}</select>
      <select data-f="source" aria-label="Lead source">${options(sourcesCache.map(s => ({ value: s.source, label: `${s.source} (${s.n})` })), query.source, { blank: 'Any source' })}</select>
      <div class="spacer"></div>
      <label class="small muted">Sort <select data-f="sort">${options([{ value: 'recent', label: 'Newest enquiry' }, { value: 'touched', label: 'Last contact' }, { value: 'name', label: 'Surname' }], query.sort || 'recent')}</select></label>
      ${filtered ? '<button class="btn ghost small" data-clear>Clear filters</button>' : ''}
    </div>
    ${data.rows.length ? `<div class="table-wrap"><table class="list">
      <thead><tr><th>Name</th><th class="hide-m">Mobile</th><th class="hide-m">Email</th><th>Status</th><th class="hide-m">Deal stage</th><th class="hide-m">Source</th><th>Enquired</th><th class="hide-m">Last contact</th></tr></thead>
      <tbody>${data.rows.map(c => `<tr class="click" data-id="${c.id}" tabindex="0">
        <td class="name-cell"><strong>${esc(fullName(c))}</strong><span class="faint small">${esc(c.lead_no || c.type)}${c.dup_group && !c.dup_dismissed ? ' · <span class="badge amber" style="padding:0 6px">Possible duplicate</span>' : ''}${c.next_appt ? ` · next: ${esc(fmtWhen(c.next_appt))}` : ''}${c.open_tasks ? ` · ${c.open_tasks} open task${c.open_tasks > 1 ? 's' : ''}` : ''}</span></td>
        <td class="hide-m nowrap">${esc(c.mobile || '')}</td>
        <td class="hide-m">${esc(c.email || '')}</td>
        <td><span class="status ${esc(c.lead_status)}">${esc(c.lead_status)}</span></td>
        <td class="hide-m">${esc(c.stage || '')}</td>
        <td class="hide-m small">${esc(c.lead_source || '')}</td>
        <td class="nowrap small">${esc(c.enquiry_date ? fmtDate(c.enquiry_date) : '')}</td>
        <td class="hide-m small">${esc(c.last_contact_at ? fmtAgo(c.last_contact_at) : '')}</td>
      </tr>`).join('')}</tbody></table></div>
      <div class="pager"><span>Page ${data.page} of ${pages}</span><span>
        <button class="btn small" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>Previous</button>
        <button class="btn small" data-page="${data.page + 1}" ${data.page >= pages ? 'disabled' : ''}>Next</button></span></div>`
      : `<div class="panel empty"><strong>No contacts match</strong>${filtered ? 'Try clearing a filter.' : 'Add your first contact or import a spreadsheet in Settings.'}</div>`}`;

  let t;
  el.querySelector('[data-f=q]').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => setQuery({ q: e.target.value.trim() }), 350); });
  el.querySelectorAll('select[data-f]').forEach(s => s.addEventListener('change', () => setQuery({ [s.dataset.f]: s.value })));
  el.querySelector('[data-clear]')?.addEventListener('click', () => { location.hash = '#/contacts'; });
  el.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => setQuery({ page: b.dataset.page })));
  el.querySelector('[data-new]').onclick = () => contactDialog(null, { onSaved: c => { location.hash = `#/contacts/${c.id}`; } });
  el.querySelector('tbody')?.addEventListener('click', e => { if (e.target.closest('a')) return; const r = e.target.closest('tr[data-id]'); if (r) location.hash = `#/contacts/${r.dataset.id}`; });
  el.querySelector('tbody')?.addEventListener('keydown', e => { if (e.key === 'Enter') { const r = e.target.closest('tr[data-id]'); if (r) location.hash = `#/contacts/${r.dataset.id}`; } });
  if (query.q && !document.activeElement.matches('input')) { const i = el.querySelector('[data-f=q]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}
