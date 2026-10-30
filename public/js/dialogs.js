import { state, api, get, post, patch, del, esc, modal, formData, contactPicker, options, toast, changed, fmtWhen, fmtDate, fmtDay, fmtTime,
  today, addDays, nowLocal, fullName, money, icon, confirmBox, minutes, hhmm, me, isMgr, isGroupMgr, teamOptions, parkOptions, personName, plural, plans } from './core.js';

const M = () => state.meta;

/* ------------------------------------------------------------------ task */

export function taskDialog({ task = null, contact = null, dealId = null, due } = {}) {
  const t = task || {};
  const m = M();
  modal({
    title: task ? 'Edit task' : 'New task',
    body: `
      <label class="field">What needs doing<input name="title" required value="${esc(t.title || '')}" autofocus placeholder="e.g. Send proposal to Willow Lakes"></label>
      <div class="grid2">
        <div class="field"><span>Category</span><div class="chips" data-chips="category">${m.categories.map(c => `<button type="button" class="chip${(t.category || 'Follow-up') === c ? ' on' : ''}" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div><input type="hidden" name="category" value="${esc(t.category || 'Follow-up')}"></div>
        <div class="field"><span>Priority</span><div class="chips" data-chips="priority">${m.priorities.map(c => `<button type="button" class="chip${(t.priority || 'Medium') === c ? ' on' : ''}" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div><input type="hidden" name="priority" value="${esc(t.priority || 'Medium')}"></div>
        <label class="field">Due date<input type="date" name="due_date" value="${esc(t.due_date || due || today())}"></label>
        <label class="field">Time (optional)<input type="time" name="due_time" value="${esc(t.due_time || '')}"></label>
      </div>
      <div class="field"><span>Contact (optional)</span><div data-picker></div></div>
      ${isMgr() ? `<label class="field">Whose list<select name="owner_id">${teamOptions(t.owner_id || contact?.owner_id || me().id)}</select></label>` : ''}
      <label class="field">Notes<textarea name="notes" rows="2">${esc(t.notes || '')}</textarea></label>`,
    foot: `${task ? `<button type="button" class="btn danger" data-drop>Delete</button><div class="spacer"></div>` : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" type="submit">${task ? 'Save task' : 'Add task'}</button>`,
    onMount(root, close, form) {
      bindChips(root, form);
      contactPicker(root.querySelector('[data-picker]'), { value: t.contact_id || contact?.id, label: t.first_name ? fullName(t) : contact ? fullName(contact) : '' });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = formData(form);
        if (!d.title) { form.title.focus(); return; }
        d.contact_id = d.contact_id ? Number(d.contact_id) : null;
        if (d.owner_id) d.owner_id = Number(d.owner_id); else delete d.owner_id;
        if (dealId && !task) d.deal_id = dealId;
        if (task) await patch(`/api/tasks/${task.id}`, d); else await post('/api/tasks', d);
        const forWho = d.owner_id && d.owner_id !== me().id ? ` on ${personName(d.owner_id)}’s list` : '';
        close(); toast(task ? 'Task saved' : `Task added for ${fmtDay(d.due_date).toLowerCase() === 'today' ? 'today' : fmtDay(d.due_date)}${forWho}`); changed();
      });
      root.querySelector('[data-drop]')?.addEventListener('click', async () => {
        if (await confirmBox('Delete task?', `“${esc(t.title)}” will be removed from your list.`, { ok: 'Delete task', danger: true })) {
          await del(`/api/tasks/${task.id}`); close(); toast('Task deleted'); changed();
        }
      });
    }
  });
}

function bindChips(root, form) {
  root.querySelectorAll('[data-chips]').forEach(group => {
    group.addEventListener('click', e => {
      const b = e.target.closest('.chip'); if (!b) return;
      group.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b));
      form.elements[group.dataset.chips].value = b.dataset.v;
      form.elements[group.dataset.chips].dispatchEvent(new Event('change'));
    });
  });
}

/* ------------------------------------------------------------- booking */

export function bookDialog({ contact = null, dealId = null, start = null, type = 'Demo', title = '', notes = '', appt = null, ownerId = null } = {}) {
  const m = M();
  const s = m.settings;
  const editing = !!appt;
  let chosen = appt ? { start: appt.start, end: appt.end } : start ? { start, end: null } : null;
  let custom = !!start || editing;
  let currentContact = contact || (appt && appt.contact_id ? { id: appt.contact_id, first_name: appt.first_name, last_name: appt.last_name, email: appt.contact_email } : null);
  const t0 = appt ? appt.type : type;
  const durOf = ty => s.durations[ty] || 60;
  modal({
    title: editing ? 'Edit appointment' : 'Book an appointment',
    wide: true,
    body: `
      <div class="field"><span>Customer</span><div data-picker></div></div>
      ${isMgr() && !editing ? `<label class="field">In whose diary<select name="owner_id" data-owner>${teamOptions(ownerId || currentContact?.owner_id || me().id)}</select></label>` : ''}
      <div class="field"><span>Type</span><div class="chips" data-chips="type">${m.apptTypes.map(c => `<button type="button" class="chip${t0 === c ? ' on' : ''}" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div><input type="hidden" name="type" value="${esc(t0)}"></div>
      <div class="field"><span>When</span>
        <div data-slots class="${custom ? 'hidden' : ''}"><div class="slots"><div class="faint small">Finding free times…</div></div>
          <button type="button" class="btn ghost small" data-custom style="margin-top:6px">Choose another time</button></div>
        <div data-customrow class="grid3 ${custom ? '' : 'hidden'}">
          <label class="field">Date<input type="date" name="date" value="${esc((chosen && chosen.start || '').slice(0, 10) || today())}"></label>
          <label class="field">Start<input type="time" name="time" step="900" value="${esc(chosen ? chosen.start.slice(11, 16) : '10:00')}"></label>
          <label class="field">Length (minutes)<input type="number" name="duration" min="5" step="5" data-num value="${appt ? Math.round((Date.parse(appt.end + ':00Z') - Date.parse(appt.start + ':00Z')) / 60000) : durOf(t0)}"></label>
        </div>
      </div>
      <div class="grid2">
        <label class="field">Location<input name="location" value="${esc(appt ? appt.location || '' : '')}" placeholder="${esc(s.officeLocation)}"></label>
        <label class="field">Title<input name="title" value="${esc(appt ? appt.title : title)}" placeholder="Filled in automatically"></label>
      </div>
      <div style="display:flex;gap:22px;flex-wrap:wrap">
        <label class="check"><input type="checkbox" name="is_remote" ${appt ? (appt.is_remote ? 'checked' : '') : m.remoteTypes.includes(t0) ? 'checked' : ''}> Google Meet video call</label>
        ${editing ? '' : `<label class="check"><input type="checkbox" name="send_invite" checked> Email an invite to the customer</label>`}
      </div>
      <div data-invite-note class="faint small"></div>
      <label class="field">Notes for the appointment<textarea name="notes" rows="2" placeholder="What to show, who will join from the park, anything to prepare">${esc(appt ? appt.notes || '' : notes)}</textarea></label>`,
    foot: `${editing ? `<button type="button" class="btn danger" data-cancel-appt>Cancel appointment</button><div class="spacer"></div>` : ''}<button class="btn" data-close>Close</button><button class="btn primary" type="submit">${editing ? 'Save changes' : 'Book'}</button>`,
    onMount(root, close, form) {
      bindChips(root, form);
      const slotsBox = root.querySelector('[data-slots] .slots');
      const inviteNote = root.querySelector('[data-invite-note]');
      const updateInviteNote = () => {
        const out = [];
        if (!editing && form.send_invite && form.send_invite.checked) {
          if (!currentContact) out.push('Choose a customer to send an invite.');
          else if (!currentContact.email) out.push('No email address on file, so no invite will be sent.');
          else if (form.owner_id && Number(form.owner_id.value) !== me().id) out.push(`The invite is sent from ${personName(form.owner_id.value)}’s Google Calendar if they have connected Google.`);
          else if (!m.google.connected) out.push('Connect Google in Settings to send invites; it will be saved in the diary meanwhile.');
        }
        inviteNote.textContent = out.join(' ');
      };
      contactPicker(root.querySelector('[data-picker]'), {
        value: currentContact?.id, label: currentContact ? fullName(currentContact) : '',
        onPick: async c => {
          currentContact = c ? (c.email !== undefined && c.owner_id !== undefined ? c : (await get('/api/contacts/' + c.id)).contact) : null;
          // Book into the lead's owner's diary unless a diary was chosen by hand.
          const sel = form.owner_id;
          if (sel && !sel.dataset.touched && currentContact && currentContact.owner_id && [...sel.options].some(o => o.value === String(currentContact.owner_id))) { sel.value = String(currentContact.owner_id); loadSlots(); }
          updateInviteNote();
        }
      });
      form.owner_id?.addEventListener('change', () => { form.owner_id.dataset.touched = '1'; loadSlots(); updateInviteNote(); });
      const loadSlots = async () => {
        if (custom) return;
        const ty = form.type.value;
        slotsBox.innerHTML = '<div class="faint small">Finding free times…</div>';
        const r = await get(`/api/slots?type=${encodeURIComponent(ty)}${appt ? '&exclude=' + appt.id : ''}${form.owner_id ? '&owner=' + form.owner_id.value : ''}`);
        if (!r.slots.length) { slotsBox.innerHTML = '<div class="faint small">No free time in the next two weeks within opening hours. Choose another time.</div>'; return; }
        chosen = r.slots[0];
        slotsBox.innerHTML = r.slots.map((sl, i) => `<button type="button" class="slot${i === 0 ? ' on' : ''}" data-i="${i}"><b>${esc(fmtDay(sl.start))}</b><span>${esc(fmtTime(sl.start))} – ${esc(fmtTime(sl.end))}</span></button>`).join('');
        slotsBox.onclick = e => { const b = e.target.closest('.slot'); if (!b) return; chosen = r.slots[+b.dataset.i]; slotsBox.querySelectorAll('.slot').forEach(x => x.classList.toggle('on', x === b)); };
      };
      form.type.addEventListener('change', () => {
        const ty = form.type.value;
        form.duration.value = durOf(ty);
        form.is_remote.checked = m.remoteTypes.includes(ty);
        loadSlots();
      });
      root.querySelector('[data-custom]').onclick = () => { custom = true; root.querySelector('[data-slots]').classList.add('hidden'); root.querySelector('[data-customrow]').classList.remove('hidden'); if (chosen) { form.date.value = chosen.start.slice(0, 10); form.time.value = chosen.start.slice(11, 16); } form.date.focus(); };
      form.send_invite?.addEventListener('change', updateInviteNote);
      updateInviteNote();
      loadSlots();
      root.querySelector('[data-cancel-appt]')?.addEventListener('click', () => { close(); cancelDialog(appt); });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = formData(form);
        let startDt, duration;
        if (custom) {
          if (!d.date || !d.time) { toast('Choose a date and time', { error: true }); return; }
          startDt = `${d.date}T${d.time.slice(0, 5)}`; duration = d.duration || durOf(d.type);
        } else {
          if (!chosen) { toast('Choose a time', { error: true }); return; }
          startDt = chosen.start; duration = durOf(d.type);
        }
        const payload = { type: d.type, start: startDt, duration, location: d.location, title: d.title, notes: d.notes, is_remote: d.is_remote,
          contact_id: currentContact ? currentContact.id : null };
        if (editing) {
          await patch(`/api/appointments/${appt.id}`, payload);
          close(); toast(`${d.type} saved for ${fmtWhen(startDt)}`); changed(); return;
        }
        payload.send_invite = d.send_invite; payload.deal_id = dealId;
        if (d.owner_id) payload.owner_id = Number(d.owner_id);
        const a = await post('/api/appointments', payload);
        close();
        const mine = !payload.owner_id || payload.owner_id === me().id;
        const invited = d.send_invite && currentContact && currentContact.email && mine && m.google.connected;
        toast(`${a.type} booked for ${fmtWhen(a.start)}${mine ? '' : ` in ${personName(payload.owner_id)}’s diary`}${invited ? '. Invite on its way.' : ''}`);
        changed();
      });
    }
  });
}

export function cancelDialog(appt) {
  modal({
    title: `Cancel ${appt.type.toLowerCase()}?`,
    body: `<p style="margin:0">${esc(appt.title)}, ${esc(fmtWhen(appt.start))}.</p>
      <label class="field">Message for the customer (optional)<textarea name="message" rows="2" placeholder="Sorry, we need to rearrange. I’ll call you to find a new time."></textarea></label>
      ${M().tourTypes.includes(appt.type) ? '<div class="faint small">A “Rebook” task will be added to today’s list.</div>' : ''}`,
    foot: `<button class="btn" data-close>Keep it</button><button class="btn danger solid" type="submit">Cancel appointment</button>`,
    onMount(root, close, form) {
      form.addEventListener('submit', async e => { e.preventDefault(); await post(`/api/appointments/${appt.id}/cancel`, { message: form.message.value }); close(); toast('Appointment cancelled'); changed(); });
    }
  });
}

export async function apptDialog(id) {
  const a = await get(`/api/appointments/${id}`);
  const past = a.end <= nowLocal();
  modal({
    title: a.title,
    body: `
      <div class="callout">
        <div><b>${esc(fmtDate(a.start, { long: true }))}</b>, ${esc(fmtTime(a.start))} – ${esc(fmtTime(a.end))}</div>
        <div class="muted">${esc(a.type)}${a.location ? ', ' + esc(a.location) : ''}</div>
        ${a.contact_id ? `<div style="margin-top:6px"><a href="#/contacts/${a.contact_id}" data-close-nav>${esc(fullName(a))}</a>${a.mobile ? ` · <a href="tel:${esc(a.mobile)}">${esc(a.mobile)}</a>` : ''}</div>` : ''}
        ${a.contact_id && a.company ? `<div class="muted small">${esc(a.company)}${a.units ? ` · ${esc(a.units)} units` : ''}</div>` : ''}
        ${a.teams_url ? `<div style="margin-top:8px"><a class="btn small primary" href="${esc(a.teams_url)}" target="_blank" rel="noopener">${icon('video')} Join Google Meet</a></div>` : ''}
      </div>
      ${a.needs_review ? `<div class="callout warn">This was linked to ${esc(fullName(a))} automatically. <button type="button" class="btn small" data-confirm>Link is right</button></div>` : ''}
      ${a.conflict_note ? `<div class="callout warn">${esc(a.conflict_note)} <button type="button" class="btn small" data-confirm>OK</button></div>` : ''}
      ${a.status === 'Cancelled' ? '<div class="callout warn">This appointment was cancelled.</div>' : ''}
      ${a.outcome ? `<div><b>Outcome:</b> ${esc(a.outcome)}</div>` : ''}
      ${a.notes ? `<div class="muted" style="white-space:pre-wrap">${esc(a.notes)}</div>` : ''}
      <div class="faint small">${syncLabel(a)}</div>`,
    foot: `${a.status === 'Scheduled' ? `<button type="button" class="btn" data-edit>${icon('edit')} Edit or move</button>` : ''}
      ${a.status !== 'Cancelled' && (past || a.status === 'Completed') ? `<button type="button" class="btn primary" data-outcome>${a.outcome ? 'Update outcome' : 'Record outcome'}</button>` : ''}
      ${a.status === 'Scheduled' && !past ? '<button type="button" class="btn primary" data-outcome>Record outcome</button>' : ''}`,
    onMount(root, close) {
      root.querySelector('[data-edit]')?.addEventListener('click', () => { close(); bookDialog({ appt: a }); });
      root.querySelectorAll('[data-outcome]').forEach(b => b.addEventListener('click', () => { close(); outcomeDialog(a); }));
      root.querySelectorAll('[data-confirm]').forEach(b => b.addEventListener('click', async () => { await post(`/api/appointments/${a.id}/confirm`); close(); toast('Thanks, link confirmed'); changed(); }));
      root.querySelector('[data-close-nav]')?.addEventListener('click', () => close());
    }
  });
}

export function syncLabel(a) {
  return ({ Synced: 'In your Google Calendar', Pending: 'Sending to Google Calendar…', Error: `Not in Google Calendar yet: ${a.sync_error || 'sync error'}`, Local: 'Saved in the CRM only (Google not connected)' })[a.sync_status] || '';
}

export function outcomeDialog(a) {
  if (M().tourTypes.includes(a.type)) return demoOutcomeDialog(a);
  const presets = {
    'Discovery call': ['Interested – book a demo', 'Not right now', 'No answer', 'Not a fit'],
    'Follow-up call': ['Ready to go ahead', 'Needs more time', 'Questions answered', 'No answer'],
    'Onboarding call': ['Kick-off done', 'Set-up agreed', 'Gone live', 'Follow-up needed']
  }[a.type] || ['Done'];
  const m = M();
  modal({
    title: `How did the ${a.type.toLowerCase()} go?`,
    body: `
      <div class="chips" data-presets>${presets.map(p => `<button type="button" class="chip" data-v="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <label class="field">Outcome<input name="outcome" required value="${esc(a.outcome || '')}" placeholder="e.g. Keen on the Sales Agent, wants pricing for 2 parks"></label>
      <label class="field">Notes (optional)<textarea name="notes" rows="3"></textarea></label>
      ${a.deal_id ? `<label class="field">Move the deal to<select name="nextStage">${options(m.stages, '', { blank: 'Leave as it is (or move on automatically)' })}</select></label>` : ''}`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Save outcome</button>`,
    onMount(root, close, form) {
      root.querySelector('[data-presets]').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { form.outcome.value = b.dataset.v; form.outcome.focus(); } });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = formData(form);
        if (!d.outcome) { form.outcome.focus(); return; }
        if (d.nextStage === 'Lost') { close(); await post(`/api/appointments/${a.id}/outcome`, { outcome: d.outcome, notes: d.notes }); lostDialog(a.deal_id); return; }
        await post(`/api/appointments/${a.id}/outcome`, d);
        close(); toast('Outcome saved; follow-up task updated'); changed();
      });
    }
  });
}

// A demo (or site visit) is where the deal is shaped: what they'd buy, at what monthly price, and
// what happens next. Recording it moves the deal to Demo held (or Proposal sent if one went out),
// or closes it as Lost if ParkPilot isn't a fit.
export function demoOutcomeDialog(a) {
  const m = M();
  const results = [
    { v: 'held', label: `${a.type} held`, text: `${a.type} held` },
    { v: 'not_fit', label: 'Not a fit', text: 'Not a fit' },
    { v: 'no_show', label: 'Did not attend', text: 'Did not attend' }
  ];
  const product0 = a.deal_product && a.deal_product !== 'Not decided yet' ? a.deal_product : 'ParkPilot AI';
  modal({
    title: `Record the ${a.type.toLowerCase()}`,
    wide: true,
    body: `
      <div class="field"><span>How did it go?</span><div class="chips" data-chips="result">${results.map((r, i) => `<button type="button" class="chip${i === 0 ? ' on' : ''}" data-v="${r.v}">${esc(r.label)}</button>`).join('')}</div><input type="hidden" name="result" value="held"></div>
      <div data-held style="display:flex;flex-direction:column;gap:14px">
        <div class="grid3">
          <label class="field">Interested in<select name="product">${options(m.products, product0)}</select></label>
          <label class="field">Plan<select name="plan"></select></label>
          <label class="field">Monthly price (£)<input type="number" name="monthly" step="1" min="0" data-num value="${esc(a.deal_price ?? '')}"><span class="plan-hint" data-hint></span></label>
        </div>
        <label class="check"><input type="checkbox" name="proposal_sent"> Proposal already sent</label>
        <div class="grid2">
          <label class="field">Next step agreed<input name="next_steps" placeholder="e.g. Send proposal and the Mayville case study"></label>
          <label class="field">By when<input type="date" name="next_step_date" value="${addDays(today(), 2)}"></label>
        </div>
      </div>
      <div data-notfit class="callout warn hidden">The deal will be closed as <b>Lost</b> with the reason “Not a fit”.</div>
      <div data-noshow class="callout hidden">The ${esc(a.type.toLowerCase())} will be marked as not attended and a “Rebook” call added to today’s list.</div>
      <label class="field">Notes (optional)<textarea name="notes" rows="2" placeholder="Their current systems, who else needs to sign off, objections"></textarea></label>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Save</button>`,
    onMount(root, close, form) {
      bindChips(root, form);
      const fillPlans = keep => {
        const list = plans(form.product.value);
        form.plan.innerHTML = options(list.map(p => ({ value: p.name, label: p.name + (p.monthly ? ` – ${money(p.monthly)}/month` : ' – custom') })), keep || a.deal_plan || '', { blank: list.length ? 'Choose a plan' : 'Not decided yet' });
      };
      const fillPrice = () => {
        const p = plans(form.product.value).find(x => x.name === form.plan.value);
        if (p && p.monthly) form.monthly.value = p.monthly;
        root.querySelector('[data-hint]').textContent = p && p.annual ? `${money(p.annual)}/month if paid annually` : '';
      };
      const show = () => {
        const r = form.result.value;
        root.querySelector('[data-held]').style.display = r === 'held' ? 'flex' : 'none';
        root.querySelector('[data-notfit]').classList.toggle('hidden', r !== 'not_fit');
        root.querySelector('[data-noshow]').classList.toggle('hidden', r !== 'no_show');
      };
      fillPlans(); form.result.addEventListener('change', show); show();
      form.product.addEventListener('change', () => { fillPlans(''); fillPrice(); });
      form.plan.addEventListener('change', fillPrice);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = formData(form);
        const r = results.find(x => x.v === d.result);
        const payload = { result: d.result, outcome: r.text, notes: d.notes };
        if (d.result === 'held') Object.assign(payload, { product: d.product, plan: d.plan, monthly: d.monthly, proposal_sent: d.proposal_sent, next_steps: d.next_steps, next_step_date: d.next_step_date });
        await post(`/api/appointments/${a.id}/outcome`, payload);
        close();
        const msg = d.result === 'not_fit' ? 'Saved; deal closed as Lost (not a fit)'
          : d.result === 'no_show' ? 'Saved; rebook call added to today'
          : d.proposal_sent ? 'Saved; deal moved to Proposal sent with a follow-up in 3 days'
          : `Saved; deal moved to Demo held${d.next_steps ? ' with your next step as a task' : ' with “Send proposal” as a task'}`;
        toast(msg); changed();
      });
    }
  });
}

/* ------------------------------------------------------------ calls/notes */

export function callDialog(contact, { task = null } = {}) {
  const outcomes = [
    { v: 'Spoke – interested', days: 2 }, { v: 'Spoke – call back later', days: 7 }, { v: 'Spoke – not interested', days: 0 },
    { v: 'No answer', days: 1 }, { v: 'Left voicemail', days: 2 }, { v: 'Wrong number', days: 0 }
  ];
  modal({
    title: `Log a call with ${fullName(contact)}`,
    body: `
      ${contact.mobile ? `<div><a class="btn" href="tel:${esc(contact.phone_e164 || contact.mobile)}">${icon('phone')} Call ${esc(contact.mobile)}</a></div>` : ''}
      <div class="field"><span>Outcome</span><div class="chips" data-chips="outcome">${outcomes.map((o, i) => `<button type="button" class="chip${i === 0 ? ' on' : ''}" data-v="${esc(o.v)}" data-days="${o.days}">${esc(o.v)}</button>`).join('')}</div><input type="hidden" name="outcome" value="${esc(outcomes[0].v)}"></div>
      <label class="field">Notes<textarea name="notes" rows="3" autofocus placeholder="What was said, what they want next"></textarea></label>
      <label class="field">Follow-up task<select name="follow_up_days">${options([{ value: 0, label: 'No follow-up' }, { value: 1, label: 'Tomorrow' }, { value: 2, label: 'In 2 days' }, { value: 3, label: 'In 3 days' }, { value: 7, label: 'In a week' }, { value: 14, label: 'In two weeks' }, { value: 30, label: 'In a month' }], 2)}</select></label>
      ${task ? `<div class="faint small">This will complete “${esc(task.title)}”.</div>` : ''}`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Save call</button>`,
    onMount(root, close, form) {
      root.querySelector('[data-chips]').addEventListener('click', e => {
        const b = e.target.closest('.chip'); if (!b) return;
        root.querySelectorAll('[data-chips] .chip').forEach(x => x.classList.toggle('on', x === b));
        form.outcome.value = b.dataset.v; form.follow_up_days.value = b.dataset.days;
      });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = formData(form);
        await post(`/api/contacts/${contact.id}/call`, { outcome: d.outcome, notes: d.notes, follow_up_days: Number(d.follow_up_days), task_id: task ? task.id : null });
        close(); toast(Number(d.follow_up_days) ? `Call saved; follow-up added for ${fmtDay(addDays(today(), Number(d.follow_up_days)))}` : 'Call saved'); changed();
      });
    }
  });
}

export function noteDialog(contact = null) {
  modal({
    title: 'Add a note',
    body: `<div class="field"><span>Contact</span><div data-picker></div></div>
      <label class="field">Note<textarea name="summary" rows="4" placeholder="What happened, what they said"></textarea></label>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Save note</button>`,
    onMount(root, close, form) {
      contactPicker(root.querySelector('[data-picker]'), { value: contact?.id, label: contact ? fullName(contact) : '', onPick: () => form.summary.focus() });
      if (contact) setTimeout(() => form.summary.focus(), 0);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = formData(form);
        if (!d.contact_id) { toast('Choose a contact first', { error: true }); return; }
        if (!d.summary) { form.summary.focus(); return; }
        await post(`/api/contacts/${d.contact_id}/notes`, { summary: d.summary });
        close(); toast('Note saved'); changed();
      });
    }
  });
}

/* ---------------------------------------------------------------- contact */

export function contactDialog(c = null, { onSaved, prefill } = {}) {
  const m = M();
  const v = c || { type: 'Prospect', lead_status: 'New', ...(prefill || {}) };
  modal({
    title: c ? 'Edit lead' : 'New lead',
    wide: true,
    body: `
      <div class="grid2">
        <label class="field">Park or company<input name="company" value="${esc(v.company || '')}" ${c ? '' : 'autofocus'} placeholder="e.g. Willow Lakes Holiday Park"></label>
        <label class="field">Website<input name="website" value="${esc(v.website || '')}" placeholder="e.g. willowlakes.co.uk"></label>
        <label class="field">First name<input name="first_name" value="${esc(v.first_name || '')}"></label>
        <label class="field">Last name<input name="last_name" value="${esc(v.last_name || '')}"></label>
        <label class="field">Job title<input name="job_title" value="${esc(v.job_title || '')}" list="jobtitles-list" placeholder="e.g. General Manager"></label>
        <label class="field">Email<input name="email" type="email" value="${esc(v.email || '')}"></label>
        <label class="field">Phone<input name="mobile" type="tel" value="${esc(v.mobile || '')}"></label>
        <label class="field">County or area<input name="region" value="${esc(v.region || '')}" placeholder="e.g. Lincolnshire"></label>
      </div>
      <div class="grid3">
        <label class="field">Units on the park<input name="units" type="number" min="0" step="1" data-num value="${esc(v.units ?? '')}" placeholder="e.g. 120"></label>
        <label class="field">Number of parks<input name="sites" type="number" min="1" step="1" data-num value="${esc(v.sites ?? '')}" placeholder="1"></label>
        <label class="field">Interested in<select name="interest">${options(m.products, v.interest, { blank: 'Not known yet' })}</select></label>
        <label class="field">Lead status<select name="lead_status">${options(m.leadStatuses, v.lead_status)}</select></label>
        <label class="field">Type<select name="type">${options(m.contactTypes, v.type)}</select></label>
        <label class="field">Lead source<input name="lead_source" value="${esc(v.lead_source || '')}" list="sources-list" placeholder="e.g. Website form"></label>
      </div>
      <label class="field">Current systems<input name="current_systems" value="${esc(v.current_systems || '')}" placeholder="Park management system, CRM, booking engine they use today (for your notes only)"></label>
      <label class="field">Notes<textarea name="preferences" rows="2" placeholder="e.g. Busy sales office, misses evening enquiries, decision with the owner">${esc(v.preferences || '')}</textarea></label>
      <div class="field"><span>Marketing consent</span><div style="display:flex;gap:20px;flex-wrap:wrap">
        <label class="check"><input type="checkbox" name="consent_email" ${v.consent_email ? 'checked' : ''}> Email</label>
        <label class="check"><input type="checkbox" name="consent_sms" ${v.consent_sms ? 'checked' : ''}> Text message</label>
        <label class="check"><input type="checkbox" name="consent_post" ${v.consent_post ? 'checked' : ''}> Post</label>
      </div></div>
      ${!c && isMgr() && (M().team || []).length > 1 ? `<div class="grid2">
        <label class="field">Allocate to<select name="owner_id">${teamOptions(prefill && prefill.owner_id !== undefined ? prefill.owner_id : me().id, { unallocated: true, unallocatedLabel: 'Nobody yet (unallocated)' })}</select></label>
        ${isGroupMgr() && (M().parks || []).length > 1 ? `<label class="field">Team<select name="park_id">${parkOptions(me().park_id || M().parks[0].id)}</select><span class="faint small" style="font-weight:400">Used when unallocated; otherwise the person’s team.</span></label>` : ''}
      </div>` : ''}
      <datalist id="sources-list"></datalist>
      <datalist id="jobtitles-list">${(m.jobTitles || []).map(t => `<option value="${esc(t)}">`).join('')}</datalist>`,
    foot: `${c ? '<button type="button" class="btn danger" data-delete>Delete lead</button><div class="spacer"></div>' : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" type="submit">${c ? 'Save lead' : 'Add lead'}</button>`,
    async onMount(root, close, form) {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = formData(form);
        if ('owner_id' in d) d.owner_id = d.owner_id ? Number(d.owner_id) : null;
        if (!(d.first_name || d.last_name || d.company)) { toast('Enter a name or the park’s name', { error: true }); form.company.focus(); return; }
        const saved = c ? await patch(`/api/contacts/${c.id}`, d) : await post('/api/contacts', d);
        close(); toast(c ? 'Lead saved' : `${fullName(saved)} added`); changed();
        onSaved && onSaved(saved);
      });
      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (await confirmBox('Delete this lead?', `${esc(fullName(c))} and their deals, tasks and notes will be permanently deleted. This cannot be undone.`, { ok: 'Delete lead', danger: true })) {
          await del(`/api/contacts/${c.id}`); close(); toast('Lead deleted'); location.hash = '#/contacts';
        }
      });
      const src = await get('/api/sources');
      const known = ['Website form', 'Email', 'Phone', 'Referral', 'Event or show', 'LinkedIn', 'X (Twitter)', 'Clutch', 'Import'];
      root.querySelector('#sources-list').innerHTML = [...new Set([...known, ...src.filter(s => s.source !== '(none)').map(s => s.source)])].map(s => `<option value="${esc(s)}">`).join('');
    }
  });
}

/* ------------------------------------------------------------------ deals */

export function dealDialog({ deal = null, contact = null } = {}) {
  const m = M();
  const d = deal || { deal_type: contact && m.products.includes(contact.interest) ? contact.interest : 'ParkPilot AI', billing: 'Monthly', sites: contact && contact.sites };
  modal({
    title: deal ? 'Edit deal' : 'New deal',
    body: `
      <div class="grid2">
        <label class="field">Product<select name="deal_type">${options(m.products, d.deal_type)}</select></label>
        <label class="field">Plan<select name="plan"></select></label>
        <label class="field">Monthly value (£)<input type="number" step="1" min="0" name="price" data-num value="${esc(d.price ?? '')}"><span class="plan-hint" data-hint></span></label>
        <label class="field">Billing<select name="billing">${options(['Monthly', 'Annual'], d.billing || 'Monthly')}</select></label>
        <label class="field">Number of parks<input type="number" step="1" min="1" name="sites" data-num value="${esc(d.sites ?? '')}"></label>
        <label class="field">Expected to close<input type="date" name="expected_close" value="${esc(d.expected_close || '')}"></label>
      </div>
      <label class="field">Notes<textarea name="notes" rows="2" placeholder="What's included, discounts agreed, who signs off">${esc(d.notes || '')}</textarea></label>
      <p class="faint small" style="margin:0">List prices: ParkPilot AI from £495/month, ParkPilot CRM from £149 per park per month. Every plan includes a dedicated account manager.</p>`,
    foot: `${deal ? '<button type="button" class="btn danger" data-delete>Delete deal</button><div class="spacer"></div>' : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" type="submit">${deal ? 'Save deal' : 'Open deal'}</button>`,
    onMount(root, close, form) {
      const fillPlans = keep => {
        const list = plans(form.deal_type.value);
        form.plan.innerHTML = options(list.map(p => ({ value: p.name, label: p.name + (p.monthly ? ` – ${money(p.monthly)}/month` : ' – custom') })), keep ?? d.plan ?? '', { blank: list.length ? 'Choose a plan' : 'Not decided yet' });
        hint();
      };
      const current = () => plans(form.deal_type.value).find(x => x.name === form.plan.value);
      const hint = () => { const p = current(); root.querySelector('[data-hint]').textContent = p && p.annual ? `${money(p.annual)}/month on annual billing` : ''; };
      const price = () => {
        const p = current(); if (!p || !p.monthly) return;
        const each = form.billing.value === 'Annual' && p.annual ? p.annual : p.monthly;
        const perPark = form.deal_type.value === 'ParkPilot CRM';
        form.price.value = each * (perPark ? Math.max(1, Number(form.sites.value) || 1) : 1);
      };
      fillPlans();
      form.deal_type.addEventListener('change', () => { fillPlans(''); price(); });
      form.plan.addEventListener('change', () => { hint(); price(); });
      form.billing.addEventListener('change', price);
      form.sites.addEventListener('change', price);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const v = formData(form);
        if (deal) await patch(`/api/deals/${deal.id}`, v); else await post('/api/deals', { ...v, contact_id: contact.id });
        close(); toast(deal ? 'Deal saved' : 'Deal opened'); changed();
      });
      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (await confirmBox('Delete this deal?', 'The deal will be removed. Notes on the timeline stay.', { ok: 'Delete deal', danger: true })) { await del(`/api/deals/${deal.id}`); close(); changed(); }
      });
    }
  });
}

export function lostDialog(dealId) {
  const reasons = M().lostReasons;
  modal({
    title: 'Mark deal as lost',
    body: `<div class="chips" data-r>${reasons.map(r => `<button type="button" class="chip" data-v="${esc(r)}">${esc(r)}</button>`).join('')}</div>
      <label class="field">Reason<input name="reason" required placeholder="Why didn’t it go ahead?"></label>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn danger solid" type="submit">Mark as lost</button>`,
    onMount(root, close, form) {
      root.querySelector('[data-r]').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) form.reason.value = b.dataset.v; });
      form.addEventListener('submit', async e => { e.preventDefault(); await post(`/api/deals/${dealId}/stage`, { stage: 'Lost', lostReason: form.reason.value }); close(); toast('Deal marked as lost'); changed(); });
    }
  });
}

export async function moveStage(deal, stage) {
  if (stage === 'Lost') return lostDialog(deal.id);
  await post(`/api/deals/${deal.id}/stage`, { stage });
  toast(`Moved to ${stage}`); changed();
}

export { minutes, hhmm };

/* ------------------------------------------------------------ allocate */

// Hands one or more leads to a team member, or back to the unallocated list. Managers only.
export function allocateDialog(ids, { current = undefined, label = '', onDone } = {}) {
  const n = ids.length;
  const parks = M().parks || [];
  modal({
    title: n === 1 ? `Allocate ${label || 'this lead'}` : `Allocate ${plural(n, 'lead')}`,
    body: `
      <label class="field">Give ${n === 1 ? 'it' : 'them'} to<select name="owner_id" autofocus>${teamOptions(current === undefined ? '' : current, { unallocated: true, unallocatedLabel: 'Nobody (back to unallocated)' })}</select></label>
      ${isGroupMgr() && parks.length > 1 ? `<label class="field" data-parkrow>Team (when unallocated)<select name="park_id">${parkOptions('', { blank: 'Keep their current team' })}</select></label>` : ''}
      <p class="faint small" style="margin:0">Their open tasks move with them. Appointments already booked stay in the diary they were booked into.</p>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Allocate</button>`,
    onMount(root, close, form) {
      const row = root.querySelector('[data-parkrow]');
      const sync = () => row && row.classList.toggle('hidden', !!form.owner_id.value);
      form.owner_id.addEventListener('change', sync); sync();
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const owner = form.owner_id.value ? Number(form.owner_id.value) : null;
        const r = await post('/api/contacts/assign', { ids, owner_id: owner, park_id: form.park_id && !owner ? Number(form.park_id.value) || null : null });
        close();
        toast(owner ? `${plural(r.moved, 'lead')} allocated to ${personName(owner)}` : `${plural(r.moved, 'lead')} returned to unallocated`);
        onDone ? onDone(r) : changed();
      });
    }
  });
}
