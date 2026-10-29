import { esc, icon, fullName, fmtDay, fmtDate, post, toast, changed, plural, typeClass, fmtTime, money, nowLocal } from '../core.js';
import { taskDialog, callDialog, apptDialog, syncLabel } from '../dialogs.js';

export function lateBadge(t) {
  if (t.status !== 'Open') return '';
  if (t.urgency === 'red') return `<span class="badge red">${t.days_late ? plural(t.days_late, 'day') + ' late' : 'Overdue'}</span>`;
  if (t.urgency === 'amber') return `<span class="badge amber">${plural(t.days_late, 'day')} late</span>`;
  if (t.urgency === 'today') return `<span class="badge blue">${t.due_time ? 'Today ' + esc(t.due_time) : 'Today'}</span>`;
  if (t.urgency === 'future') return `<span class="badge">${esc(fmtDay(t.due_date))}</span>`;
  return '';
}

export function taskRow(t, { showContact = true } = {}) {
  const done = t.status !== 'Open';
  const contact = t.contact_id && showContact ? `<a href="#/contacts/${t.contact_id}">${esc(fullName(t))}</a>` : '';
  const meta = [esc(t.category), contact, t.rollover_count > 0 && !done ? `rolled over ${plural(t.rollover_count, 'time')}` : '',
    t.original_due_date && !done ? `first due ${esc(fmtDate(t.original_due_date))}` : ''].filter(Boolean).join('<span class="faint">·</span>');
  return `<div class="task u-${t.urgency}${done ? ' done' : ''}" data-task="${t.id}">
    <span class="stripe"></span>
    <button class="tick" data-act="tick" aria-label="${done ? 'Mark as not done' : 'Mark as done'}: ${esc(t.title)}" title="${done ? 'Mark as not done' : 'Done'}">${icon('check')}</button>
    <div class="t-main"><div class="t-title">${esc(t.title)}</div><div class="t-meta">${meta}</div></div>
    <div class="t-side">
      ${lateBadge(t)}
      <span class="pri ${esc(t.priority)}">${esc(t.priority)}</span>
      <span class="t-actions">
        ${!done && t.contact_id && (t.category === 'Call' || t.category === 'Follow-up') ? `<button class="btn ghost icon" data-act="call" title="Log a call" aria-label="Log a call">${icon('phone')}</button>` : ''}
        ${!done ? `<button class="btn ghost icon" data-act="snooze" title="Move to tomorrow" aria-label="Move to tomorrow">${icon('clock')}</button>` : ''}
        <button class="btn ghost icon" data-act="edit" title="Edit" aria-label="Edit task">${icon('edit')}</button>
      </span>
    </div>
    ${t.needs_review && !done ? `<div class="review"><strong>Still relevant?</strong> <span class="muted">This has rolled over ${t.rollover_count} times.</span>
      <button class="btn small" data-act="r-today">Do today</button><button class="btn small" data-act="r-week">Reschedule a week</button><button class="btn small danger" data-act="r-drop">Drop it</button></div>` : ''}
  </div>`;
}

export function bindTasks(container, tasks) {
  const byId = new Map(tasks.map(t => [String(t.id), t]));
  container.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const row = b.closest('[data-task]'); if (!row) return;
    const t = byId.get(row.dataset.task); if (!t) return;
    const act = b.dataset.act;
    if (act === 'tick') {
      const done = t.status === 'Open';
      row.classList.toggle('done', done);
      await post(`/api/tasks/${t.id}/complete`, { done });
      if (done) toast(`Done: ${t.title}`, { action: 'Undo', onAction: async () => { await post(`/api/tasks/${t.id}/complete`, { done: false }); changed(); } });
      changed();
    } else if (act === 'snooze') {
      const r = await post(`/api/tasks/${t.id}/snooze`, { days: 1 });
      toast(`Moved to ${fmtDay(r.due_date).toLowerCase() === 'tomorrow' ? 'tomorrow' : fmtDay(r.due_date)}`); changed();
    } else if (act === 'edit') taskDialog({ task: t });
    else if (act === 'call') callDialog({ id: t.contact_id, first_name: t.first_name, last_name: t.last_name, mobile: t.mobile, phone_e164: t.phone_e164 }, { task: t });
    else if (act === 'r-today') { await post(`/api/tasks/${t.id}/review`, { action: 'today' }); toast('Kept for today, marked High'); changed(); }
    else if (act === 'r-week') { await post(`/api/tasks/${t.id}/review`, { action: 'reschedule' }); toast('Rescheduled for next week'); changed(); }
    else if (act === 'r-drop') {
      const reason = prompt('Why drop it? (optional)', 'No longer relevant');
      if (reason === null) return;
      await post(`/api/tasks/${t.id}/review`, { action: 'drop', reason }); toast('Task dropped'); changed();
    }
  });
}

export function diaryCard(a, { showDate = false } = {}) {
  const past = a.end <= nowLocal();
  const prep = [
    a.company ? ['Park', esc(a.company) + (a.units ? ` · ${esc(a.units)} units` : '')] : null,
    a.deal_stage ? ['Deal stage', esc(a.deal_stage)] : null,
    a.deal_product && a.deal_product !== 'Not decided yet' ? ['Interested in', esc(a.deal_product + (a.deal_plan ? ' ' + a.deal_plan : '')) + (a.deal_price ? ` · ${money(a.deal_price)}/month` : '')] : null,
    a.current_systems ? ['Current systems', esc(a.current_systems)] : null,
    a.last_note ? ['Last note', esc(a.last_note)] : null,
    a.notes ? ['Notes', esc(a.notes)] : null
  ].filter(Boolean);
  return `<div class="diary-card ${typeClass(a.type)}${past ? ' past' : ''}" data-appt="${a.id}">
    <div class="row"><div>
      <div class="when">${showDate ? esc(fmtDay(a.start)) + ', ' : ''}${esc(fmtTime(a.start))} – ${esc(fmtTime(a.end))}
        ${a.status === 'Completed' ? '<span class="badge green">Done</span>' : ''}${a.status === 'Cancelled' ? '<span class="badge red">Cancelled</span>' : ''}
        ${a.needs_review ? '<span class="badge amber">Check link</span>' : ''}${a.sync_status === 'Error' ? `<span class="badge red" title="${esc(syncLabel(a))}">Not in Google Calendar</span>` : ''}</div>
      <div class="what">${esc(a.type)}${a.contact_id ? ` – <a href="#/contacts/${a.contact_id}">${esc(fullName(a))}</a>${a.company && (a.first_name || a.last_name) ? ` <span class="faint small">${esc(a.company)}</span>` : ''}` : a.title && a.title !== a.type ? ' – ' + esc(a.title) : ''}</div>
      <div class="where">${esc(a.location || '')}${a.outcome ? ` · ${esc(a.outcome)}` : ''}</div>
    </div>
    <div style="display:flex;gap:6px;flex-direction:column;align-items:flex-end">
      ${a.teams_url && !past ? `<a class="btn small primary" href="${esc(a.teams_url)}" target="_blank" rel="noopener">Join Meet</a>` : ''}
      ${past && a.status === 'Scheduled' ? `<button class="btn small" data-outcome="${a.id}">Record outcome</button>` : `<button class="btn small ghost" data-open="${a.id}">Open</button>`}
    </div></div>
    ${prep.length ? `<details><summary>Preparation</summary><dl class="prep">${prep.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></details>` : ''}
  </div>`;
}

export function bindDiary(container) {
  container.addEventListener('click', async e => {
    const o = e.target.closest('[data-open]'); if (o) { apptDialog(o.dataset.open); return; }
    const oc = e.target.closest('[data-outcome]');
    if (oc) { const { outcomeDialog } = await import('../dialogs.js'); const { get } = await import('../core.js'); outcomeDialog(await get(`/api/appointments/${oc.dataset.outcome}`)); }
  });
}
