import { get, post, del, esc, state, icon, fmtDate, fmtAgo, fmtWhen, fmtDay, fmtTime, fullName, initials, money, toast, changed, telHref, typeClass, nowLocal, isMgr, isGroupMgr, me } from '../core.js';
import { taskDialog, bookDialog, callDialog, contactDialog, dealDialog, moveStage, valuationDialog, homeDialog, apptDialog, allocateDialog } from '../dialogs.js';
import { taskRow, bindTasks } from './parts.js';

export let currentContact = null;
let filter = 'All';
const TL_ICON = { Note: 'note', Call: 'phone', Email: 'mail', Appointment: 'cal', Meeting: 'cal', Task: 'task', Deal: 'deal', SMS: 'mail' };
const FILTERS = { All: null, Notes: ['Note', 'Call', 'Email', 'SMS'], Appointments: ['Appointment', 'Meeting'], Deals: ['Deal'], Tasks: ['Task'] };

export async function render(el, { params }) {
  const id = params[0];
  const d = await get(`/api/contacts/${id}`);
  const c = d.contact;
  currentContact = c;
  const m = state.meta;
  const now = nowLocal();
  const upcoming = d.appts.filter(a => a.status === 'Scheduled' && a.end >= now).sort((a, b) => a.start.localeCompare(b.start));
  const tl = FILTERS[filter] ? d.timeline.filter(i => FILTERS[filter].includes(i.type)) : d.timeline;
  const lastTouch = c.last_contact_at || c.enquiry_date;

  el.innerHTML = `
    <div style="margin-top:8px"><a href="#/contacts" class="small">${'‹'} All contacts</a></div>
    <div class="c-head">
      <div class="avatar" aria-hidden="true">${esc(initials(c))}</div>
      <div class="c-title">
        <h1>${esc(fullName(c))}</h1>
        <div class="line">
          <span class="badge ${c.type === 'Owner' ? 'sun' : c.type === 'Partner' ? '' : 'blue'}">${esc(c.type)}</span>
          <span class="status ${esc(c.lead_status)}">${esc(c.lead_status)}</span>
          ${c.mobile ? `<a href="${telHref(c)}">${esc(c.mobile)}</a>` : '<span class="faint">No phone</span>'}
          ${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '<span class="faint">No email</span>'}
          <span class="consent" title="Marketing consent"><span class="${c.consent_email ? 'on' : ''}">Email</span><span class="${c.consent_sms ? 'on' : ''}">SMS</span><span class="${c.consent_post ? 'on' : ''}">Post</span></span>
        </div>
        <div class="line"><span>${c.lead_source ? `Source ${esc(c.lead_source)}` : 'Source unknown'}</span><span>Enquired ${esc(c.enquiry_date ? fmtDate(c.enquiry_date) : 'unknown')}</span><span>Last contact ${esc(fmtAgo(lastTouch))}</span>${c.lead_no ? `<span class="faint">${esc(c.lead_no)}</span>` : ''}</div>
        ${isMgr() ? `<div class="line owner-line">${c.owner_id ? `<span>Allocated to <b>${esc(c.owner_id === me().id ? 'you' : c.owner_name || 'someone')}</b></span>` : '<span class="badge amber">Not yet allocated</span>'}${isGroupMgr() && c.park_name ? `<span>${esc(c.park_name)}</span>` : ''}<button type="button" class="linkbtn" data-a="allocate">${c.owner_id ? 'Reallocate' : 'Allocate'}</button></div>` : ''}
      </div>
      <div class="actionbar">
        <button class="btn" data-a="note">${icon('note')} Note</button>
        <button class="btn primary" data-a="book">${icon('cal')} Book</button>
        <button class="btn" data-a="task">${icon('task')} Task</button>
        <button class="btn" data-a="call">${icon('phone')} Log call</button>
      </div>
    </div>

    ${d.dups.length ? `<div class="dup-banner">${icon('warn')} <span>This may be the same person as ${d.dups.map(x => `<a href="#/contacts/${x.id}">${esc(fullName(x))}</a> (${esc(x.email || x.mobile || x.lead_no || '')})`).join(', ')}.</span>
      <button class="btn small" data-merge>Merge into this record</button><button class="btn small ghost" data-notdup>Not the same</button></div>` : ''}

    <div class="c-grid">
      <div class="col-details" style="display:flex;flex-direction:column;gap:18px">
        <section class="panel">
          <div class="panel-head"><h2>Details</h2><div class="spacer"></div><button class="btn ghost small" data-a="edit">${icon('edit')} Edit</button></div>
          <dl class="kv">
            <dt>Mobile</dt><dd>${esc(c.mobile || '–')}</dd>
            <dt>Email</dt><dd>${esc(c.email || '–')}</dd>
            <dt>Address</dt><dd>${esc([c.address, c.postcode].filter(Boolean).join(', ') || '–')}</dd>
            <dt>Budget</dt><dd>${c.budget ? money(c.budget) : '–'}</dd>
            <dt>Bedrooms</dt><dd>${esc(c.bedrooms || '–')}</dd>
            <dt>Finance</dt><dd>${c.finance_needed ? 'Needed' : 'Not needed'}</dd>
            <dt>Preferences</dt><dd>${esc(c.preferences || '–')}</dd>
            <dt>Consent</dt><dd>${c.consent_date ? `Updated ${esc(fmtDate(c.consent_date))}` : 'Not recorded'}</dd>
          </dl>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Holiday homes owned</h2><div class="spacer"></div><button class="btn ghost small" data-a="addhome">+ Add</button></div>
          ${d.homes.length ? `<ul class="mini-list">${d.homes.map(h => `<li><span><b>${esc([h.year, h.make, h.model].filter(Boolean).join(' ') || 'Holiday home')}</b><br><span class="faint small">${h.plot_number ? 'Plot ' + esc(h.plot_number) : 'No plot'}${h.licence_expiry ? ' · licence ends ' + esc(fmtDate(h.licence_expiry)) : ''}</span></span><button class="btn ghost small" data-home="${h.id}">Edit</button></li>`).join('')}</ul>`
            : `<div class="empty small">${c.type === 'Owner' ? 'Add their current home to track licence expiry and part-exchange.' : 'None yet.'}</div>`}
        </section>
      </div>

      <section class="panel col-timeline" aria-label="Timeline">
        <div class="note-box">
          <label class="sr" for="quick-note">Add a note</label>
          <textarea id="quick-note" class="input" placeholder="Add a note and press Enter (Shift+Enter for a new line)"></textarea>
          <div class="row"><div class="chips" data-tlf>${Object.keys(FILTERS).map(f => `<button type="button" class="chip${f === filter ? ' on' : ''}" data-v="${f}">${f}</button>`).join('')}</div>
            <button class="btn primary small" data-savenote>Save note</button></div>
        </div>
        ${upcoming.length ? `<div class="pinned">
          ${upcoming.map(a => `<div class="p">${icon('cal')} <span><b>${esc(fmtWhen(a.start))}</b> ${esc(a.type)}${a.location ? ', ' + esc(a.location) : ''}</span>${a.teams_url ? ` <a class="btn small primary" href="${esc(a.teams_url)}" target="_blank" rel="noopener">Join</a>` : ''} <button class="btn ghost small" data-appt="${a.id}">Open</button></div>`).join('')}
        </div>` : ''}
        ${d.tasks.length ? `<div id="c-tasks" style="padding-top:10px">${d.tasks.map(t => taskRow(t, { showContact: false })).join('')}</div>` : ''}
        <ul class="timeline">${tl.length ? tl.map(i => `<li data-int="${i.id}"><span class="ic ${esc(i.type)}">${icon(TL_ICON[i.type] || 'note')}</span>
          <div><div class="when">${esc(i.type)} · ${esc(fmtDay(i.at))} ${esc(fmtTime(i.at))}${i.appointment_id ? ` · <a href="#" data-appt="${i.appointment_id}">appointment</a>` : ''}</div><div class="txt">${esc(i.summary)}</div></div></li>`).join('')
          : '<li><span></span><div class="faint">Nothing here yet.</div></li>'}</ul>
      </section>

      <div class="col-deals" style="display:flex;flex-direction:column;gap:18px">
        <section class="panel">
          <div class="panel-head"><h2>Deals</h2><div class="spacer"></div><button class="btn ghost small" data-a="newdeal">+ New deal</button></div>
          ${d.deals.length ? d.deals.map(dl => dealCard(dl, m)).join('') : '<div class="empty small">No deal yet. Open one when they show buying interest.</div>'}
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Appointments</h2></div>
          ${d.appts.length ? `<ul class="mini-list">${d.appts.slice(0, 12).map(a => `<li class="${typeClass(a.type)}"><span><b>${esc(fmtDate(a.start))}</b> ${esc(fmtTime(a.start))} · ${esc(a.type)}<br><span class="faint small">${esc(a.status === 'Scheduled' ? (a.end < now ? 'Outcome not recorded' : 'Booked') : a.status)}${a.outcome ? ' – ' + esc(a.outcome) : ''}</span></span><button class="btn ghost small" data-appt="${a.id}">Open</button></li>`).join('')}</ul>`
            : '<div class="empty small">None booked.</div>'}
        </section>
      </div>
    </div>`;

  /* ----- actions ----- */
  const act = {
    note: () => el.querySelector('#quick-note').focus(),
    book: () => bookDialog({ contact: c }),
    task: () => taskDialog({ contact: c }),
    call: () => callDialog(c),
    edit: () => contactDialog(c),
    newdeal: () => dealDialog({ contact: c }),
    addhome: () => homeDialog(null, { ownerId: c.id, ownerName: fullName(c) }),
    allocate: () => allocateDialog([c.id], { current: c.owner_id, label: fullName(c) })
  };
  el.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => act[b.dataset.a]()));
  const noteEl = el.querySelector('#quick-note');
  const saveNote = async () => {
    const v = noteEl.value.trim(); if (!v) { noteEl.focus(); return; }
    await post(`/api/contacts/${c.id}/notes`, { summary: v });
    noteEl.value = ''; toast('Note saved'); changed();
  };
  noteEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveNote(); } });
  el.querySelector('[data-savenote]').onclick = saveNote;
  el.querySelector('[data-tlf]').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { filter = b.dataset.v; render(el, { params }); } });
  el.querySelectorAll('[data-appt]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); apptDialog(b.dataset.appt); }));
  el.querySelectorAll('[data-home]').forEach(b => b.addEventListener('click', () => homeDialog(d.homes.find(h => String(h.id) === b.dataset.home))));
  if (d.tasks.length) bindTasks(el.querySelector('#c-tasks'), d.tasks);
  el.querySelectorAll('[data-deal]').forEach(card => {
    const dl = d.deals.find(x => String(x.id) === card.dataset.deal);
    card.querySelectorAll('[data-stage]').forEach(b => b.addEventListener('click', () => moveStage(dl, b.dataset.stage)));
    card.querySelector('[data-editdeal]').onclick = () => dealDialog({ deal: dl, contact: c });
    card.querySelector('[data-px]')?.addEventListener('click', () => valuationDialog(dl, c));
    card.querySelector('[data-lost]')?.addEventListener('click', () => moveStage(dl, 'Lost'));
    card.querySelector('[data-reopen]')?.addEventListener('click', () => moveStage(dl, 'Enquiry'));
    card.querySelectorAll('[data-delval]').forEach(b => b.addEventListener('click', async () => { await del(`/api/valuations/${b.dataset.delval}`); changed(); }));
  });
  el.querySelector('[data-merge]')?.addEventListener('click', async () => {
    await post('/api/duplicates/merge', { keep: c.id, others: d.dups.map(x => x.id) });
    toast('Records merged'); changed();
  });
  el.querySelector('[data-notdup]')?.addEventListener('click', async () => { await post('/api/duplicates/dismiss', { group: c.dup_group }); toast('Marked as different people'); changed(); });
}

function dealCard(dl, m) {
  const idx = m.stages.indexOf(dl.stage);
  const closed = dl.stage === 'Completed' || dl.stage === 'Lost';
  const net = (dl.price || 0) - (dl.part_ex_allowance || 0);
  const next = !closed && idx < m.openStages.length ? m.stages[idx + 1] : null;
  return `<div class="deal" data-deal="${dl.id}">
    <div class="top"><b>${esc(dl.deal_type)}</b><span class="badge ${dl.stage === 'Lost' ? 'red' : dl.stage === 'Completed' ? 'green' : 'blue'}">${esc(dl.stage)}</span></div>
    ${!closed ? `<div class="stepper" role="group" aria-label="Move deal stage">${m.openStages.concat('Completed').map((s, i) => `<button type="button" data-stage="${esc(s)}" class="${i < idx ? 'done' : i === idx ? 'cur' : ''}" title="${esc(s)}" aria-label="Move to ${esc(s)}"></button>`).join('')}</div>
      <div class="small muted">${next ? `Next: <button type="button" class="linkbtn" data-stage="${esc(next)}">${esc(next)}</button>` : ''}</div>` : dl.lost_reason ? `<div class="small muted">Reason: ${esc(dl.lost_reason)}</div>` : ''}
    <div class="small" style="margin-top:6px">${dl.make ? esc([dl.home_year, dl.make, dl.model].filter(Boolean).join(' ')) : '<span class="faint">No home chosen</span>'}${dl.plot_number ? ', plot ' + esc(dl.plot_number) : ''}</div>
    ${dl.price || dl.part_ex_allowance ? `<div class="money"><span>Price</span><span>${money(dl.price) || '–'}</span>
      ${dl.part_ex_allowance ? `<span>Part-ex allowance</span><span>− ${money(dl.part_ex_allowance)}</span>` : ''}
      <span class="net">To pay</span><span class="net">${money(net)}</span>
      ${dl.payment_status && dl.payment_status !== 'None yet' ? `<span>${esc(dl.payment_status)} taken</span><span>${dl.deposit ? money(dl.deposit) : '✓'}</span>` : dl.deposit ? `<span class="faint">Deposit taken</span><span class="faint">${money(dl.deposit)}</span>` : ''}</div>` : ''}
    ${dl.valuations.length ? `<div class="small" style="margin-top:8px">${dl.valuations.map(v => `<div>Part-ex: <b>${money(v.offered_value)}</b> for ${esc(v.description || [v.year, v.make, v.model].filter(Boolean).join(' ') || 'their home')}${v.valid_until ? `, valid until ${esc(fmtDate(v.valid_until))}` : ''}${!v.within_age_policy ? ' <span class="badge amber">Outside age policy</span>' : ''} <button class="btn ghost small" data-delval="${v.id}" aria-label="Delete valuation">${icon('x')}</button></div>`).join('')}</div>` : ''}
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
      <button class="btn small" data-editdeal>Edit</button>
      ${!closed && dl.deal_type !== 'New sale' && dl.deal_type !== 'Pre-owned sale' ? '<button class="btn small" data-px>Part-ex valuation</button>' : ''}
      ${!closed ? '<button class="btn small ghost danger" data-lost>Lost</button>' : '<button class="btn small ghost" data-reopen>Reopen</button>'}
    </div>
  </div>`;
}
