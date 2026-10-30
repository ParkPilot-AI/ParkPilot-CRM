import { api, esc, state, isGroupMgr, parkOptions } from '../core.js';

// A drop zone that imports a lead list (.xlsx or .csv).
export function importZone(holder, { onDone } = {}) {
  const choosePark = isGroupMgr() && (state.meta.parks || []).length > 1;
  holder.innerHTML = `${choosePark ? `<label class="field" style="margin-bottom:10px">Import into team<select data-importpark>${parkOptions(state.meta.user.park_id || state.meta.parks[0].id)}</select></label>` : ''}
    <div class="dropzone" data-drop tabindex="0" role="button">Drop an .xlsx or .csv file of leads here, or click to choose a file.<br><span class="faint small">Recognised headings include Park Name, First Name, Last Name, Email, Phone, Job Title, Units, County, Website, Lead Source and Notes. Existing leads are matched by email or lead number and only blank fields are filled; nothing you edited here is overwritten.</span></div>
    <input type="file" accept=".xlsx,.csv" class="hidden" data-file>
    <div data-importresult style="margin-top:12px"></div>`;
  const drop = holder.querySelector('[data-drop]'), file = holder.querySelector('[data-file]'), out = holder.querySelector('[data-importresult]');
  const doImport = async f => {
    if (!f) return;
    out.innerHTML = `<div class="callout">Importing ${esc(f.name)}…</div>`;
    try {
      const r = await api('POST', '/api/import', await f.arrayBuffer(), { raw: true, headers: { 'X-Filename': encodeURIComponent(f.name), 'Content-Type': 'application/octet-stream', ...(holder.querySelector('[data-importpark]') ? { 'X-Park': holder.querySelector('[data-importpark]').value } : {}) } });
      out.innerHTML = `<div class="callout ok"><b>${esc(f.name)}</b>: ${r.created} new leads (${r.deals} open enquiries${r.created ? ', <a href="#/contacts">see leads</a>' : ''}), ${r.updated} updated, ${r.unchanged} already up to date${r.skipped ? `, ${r.skipped} empty rows skipped` : ''}. ${r.duplicateGroups ? `${r.duplicateGroups} possible duplicate groups to <a href="#/contacts/duplicates">review</a>.` : ''}</div>`;
      onDone && onDone(r);
    } catch (e) { out.innerHTML = `<div class="callout warn">${esc(e.message)}</div>`; }
  };
  drop.addEventListener('click', () => file.click());
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
  file.addEventListener('change', () => doImport(file.files[0]));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); doImport(e.dataTransfer.files[0]); });
}
