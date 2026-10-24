import { state, api, get, post, patch, del, esc, modal, formData, contactPicker, options, toast, changed, fmtWhen, fmtDate, fmtDay, fmtTime,
  today, addDays, nowLocal, fullName, money, icon, confirmBox, minutes, hhmm } from './core.js';

const M = () => state.meta;

/* ------------------------------------------------------------------ task */

export function taskDialog({ task = null, contact = null, dealId = null, due } = {}) {
  const t = task || {};
  const m = M();
  modal({
    title: task ? 'Edit task' : 'New task',
    body: `
      <label class="field">What needs doing<input name="title" required value="${esc(t.title || '')}" autofocus placeholder="e.g. Call back about plot 42"></label>
      <div class="grid2">
        <div class="field"><span>Category</span><div class="chips" data-chips="category">${m.categories.map(c => `<button type="button" class="chip${(t.category || 'Follow-up') === c ? ' on' : ''}" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div><input type="hidden" name="category" value="${esc(t.category || 'Follow-up')}"></div>
        <div class="field"><span>Priority</span><div class="chips" data-chips="priority">${m.priorities.map(c => `<button type="button" class="chip${(t.priority || 'Medium') === c ? ' on' : ''}" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div><input type="hidden" name="priority" value="${esc(t.priority || 'Medium')}"></div>
        <label class="field">Due date<input type="date" name="due_date" value="${esc(t.due_date || due || today())}"></label>
        <label class="field">Time (optional)<input type="time" name="due_time" value="${esc(t.due_time || '')}"></label>
      </div>
      <div class="field"><span>Contact (optional)</span><div data-picker></div></div>
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
        if (dealId && !task) d.deal_id = dealId;
        if (task) await patch(`/api/tasks/${task.id}`, d); else await post('/api/tasks', d);
        close(); toast(task ? 'Task saved' : `Task added for ${fmtDay(d.due_date).toLowerCase() === 'today' ? 'today' : fmtDay(d.due_date)}`); changed();
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

export function bookDialog({ contact = null, dealId = null, start = null, type = 'Park tour', title = '', notes = '', appt = null } = {}) {
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
        <label class="check"><input type="checkbox" name="is_remote" ${appt ? (appt.is_remote ? 'checked' : '') : t0 === 'Teams call' ? 'checked' : ''}> Microsoft Teams meeting</label>
        ${editing ? '' : `<label class="check"><input type="checkbox" name="send_invite" checked> Email an invite to the customer</label>`}
      </div>
      <div data-invite-note class="faint small"></div>
      <label class="field">Notes for the appointment<textarea name="notes" rows="2" placeholder="Homes to show, what to bring, anything to prepare">${esc(appt ? appt.notes || '' : notes)}</textarea></label>`,
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
          else if (!m.outlook.connected) out.push('Connect Outlook in Settings to send invites; it will be saved in the diary meanwhile.');
        }
        inviteNote.textContent = out.join(' ');
      };
      contactPicker(root.querySelector('[data-picker]'), {
        value: currentContact?.id, label: currentContact ? fullName(currentContact) : '',
        onPick: async c => { currentContact = c ? (c.email !== undefined ? c : (await get('/api/contacts/' + c.id)).contact) : null; updateInviteNote(); }
      });
      const loadSlots = async () => {
        if (custom) return;
        const ty = form.type.value;
        slotsBox.innerHTML = '<div class="faint small">Finding free times…</div>';
        const r = await get(`/api/slots?type=${encodeURIComponent(ty)}${appt ? '&exclude=' + appt.id : ''}`);
        if (!r.slots.length) { slotsBox.innerHTML = '<div class="faint small">No free time in the next two weeks within opening hours. Choose another time.</div>'; return; }
        chosen = r.slots[0];
        slotsBox.innerHTML = r.slots.map((sl, i) => `<button type="button" class="slot${i === 0 ? ' on' : ''}" data-i="${i}"><b>${esc(fmtDay(sl.start))}</b><span>${esc(fmtTime(sl.start))} – ${esc(fmtTime(sl.end))}</span></button>`).join('');
        slotsBox.onclick = e => { const b = e.target.closest('.slot'); if (!b) return; chosen = r.slots[+b.dataset.i]; slotsBox.querySelectorAll('.slot').forEach(x => x.classList.toggle('on', x === b)); };
      };
      form.type.addEventListener('change', () => {
        const ty = form.type.value;
        form.duration.value = durOf(ty);
        if (ty === 'Teams call') form.is_remote.checked = true;
        if (ty === 'Park tour' || ty === 'Handover' || ty === 'Part-ex valuation') form.is_remote.checked = false;
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
        const a = await post('/api/appointments', payload);
        close();
        const invited = d.send_invite && currentContact && currentContact.email && m.outlook.connected;
        toast(`${a.type} booked for ${fmtWhen(a.start)}${invited ? '. Invite on its way.' : ''}`);
        changed();
      });
    }
  });
}

export function cancelDialog(appt) {
  modal({
    title: `Cancel ${appt.type.toLowerCase()}?`,
    body: `<p style="margin:0">${esc(appt.title)}, ${esc(fmtWhen(appt.start))}.</p>
      <label class="field">Message for the customer (optional)<textarea name="message" rows="2" placeholder="Sorry, we need to rearrange. I'll call you to find a new time."></textarea></label>
      ${appt.type === 'Park tour' ? '<div class="faint small">A “Rebook” task will be added to today’s list.</div>' : ''}`,
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
        ${a.teams_url ? `<div style="margin-top:8px"><a class="btn small primary" href="${esc(a.teams_url)}" target="_blank" rel="noopener">${icon('video')} Join Teams meeting</a></div>` : ''}
      </div>
      ${a.needs_review ? `<div class="callout warn">This was found in Outlook and linked to ${esc(fullName(a))} automatically. <button type="button" class="btn small" data-confirm>Link is right</button></div>` : ''}
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
  return ({ Synced: 'In your Outlook calendar', Pending: 'Sending to Outlook…', Error: `Not in Outlook yet: ${a.sync_error || 'sync error'}`, Local: 'Saved in the portal only (Outlook not connected)' })[a.sync_status] || '';
}

export function outcomeDialog(a) {
  if (a.type === 'Park tour') return parkTourOutcomeDialog(a);
  const presets = {
    'Part-ex valuation': ['Valuation given', 'Thinking it over', 'Accepted part-ex offer', 'Declined'],
    'Finance meeting': ['Application submitted', 'Approved', 'Declined', 'Needs more documents'],
    'Handover': ['Keys handed over', 'Snags to fix', 'Rearranged'],
    'Phone call': ['Spoke – interested', 'Spoke – not now', 'No answer'],
    'Teams call': ['Spoke – interested', 'Spoke – not now', 'Did not join']
  }[a.type] || ['Done'];
  const m = M();
  modal({
    title: `How did the ${a.type.toLowerCase()} go?`,
    body: `
      <div class="chips" data-presets>${presets.map(p => `<button type="button" class="chip" data-v="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <label class="field">Outcome<input name="outcome" required value="${esc(a.outcome || '')}" placeholder="e.g. Loved plot 42, wants prices"></label>
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

// The park tour is the full presentation: quote, deposit or payment, and agreed next steps.
// Recording it moves the deal to Park Tour (and on to Finance & Paperwork if money was taken),
// or closes it as Lost if the park wasn't right for the customer.
export async function parkTourOutcomeDialog(a) {
  const m = M();
  const homes = (await get('/api/homes')).filter(h => ['Available', 'Reserved', 'Part-ex in'].includes(h.status) || h.id === a.home_id);
  const results = [
    { v: 'presented', label: 'Presentation given', text: 'Presentation given' },
    { v: 'not_right', label: 'Park not right for them', text: 'Park not right for customer' },
    { v: 'no_show', label: 'Did not attend', text: 'Did not attend' }
  ];
  modal({
    title: 'Record the park tour',
    wide: true,
    body: `
      <div class="field"><span>How did it go?</span><div class="chips" data-chips="result">${results.map((r, i) => `<button type="button" class="chip${i === 0 ? ' on' : ''}" data-v="${r.v}">${esc(r.label)}</button>`).join('')}</div><input type="hidden" name="result" value="presented"></div>
      <div data-presented style="display:flex;flex-direction:column;gap:14px">
        <div class="grid2">
          <label class="field">Holiday home quoted<select name="home_id">${options(homes.map(h => ({ value: h.id, label: `${[h.year, h.make, h.model].filter(Boolean).join(' ')}${h.price ? ' – ' + money(h.price) : ''}` })), a.home_id, { blank: homes.length ? 'Choose a home (optional)' : 'No stock added yet' })}</select></label>
          <label class="field">Quote (£)<input type="number" name="quote_price" step="100" min="0" data-num placeholder="e.g. 54995"></label>
        </div>
        <div class="field"><span>Payment taken</span><div class="chips" data-chips="payment_type">${m.paymentStatuses.map((p, i) => `<button type="button" class="chip${i === 0 ? ' on' : ''}" data-v="${esc(p)}">${esc(p)}</button>`).join('')}</div><input type="hidden" name="payment_type" value="${esc(m.paymentStatuses[0])}"></div>
        <label class="field hidden" data-amount>Amount taken (£)<input type="number" name="payment_amount" step="50" min="0" data-num></label>
        <div class="grid2">
          <label class="field">Next steps agreed<input name="next_steps" placeholder="e.g. Send finance application; call Friday to confirm plot"></label>
          <label class="field">By when<input type="date" name="next_step_date" value="${addDays(today(), 2)}"></label>
        </div>
      </div>
      <div data-notright class="callout warn hidden">The deal will be closed as <b>Lost</b> with the reason “Park not right for customer”.</div>
      <div data-noshow class="callout hidden">The tour will be marked as not attended and a “Rebook park tour” call added to today’s list.</div>
      <label class="field">Notes (optional)<textarea name="notes" rows="2" placeholder="Anything worth remembering from the tour"></textarea></label>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Save</button>`,
    onMount(root, close, form) {
      bindChips(root, form);
      const show = () => {
        const r = form.result.value, pay = form.payment_type.value;
        root.querySelector('[data-presented]').style.display = r === 'presented' ? 'flex' : 'none';
        root.querySelector('[data-notright]').classList.toggle('hidden', r !== 'not_right');
        root.querySelector('[data-noshow]').classList.toggle('hidden', r !== 'no_show');
        root.querySelector('[data-amount]').classList.toggle('hidden', pay === 'None yet');
      };
      form.result.addEventListener('change', show);
      form.payment_type.addEventListener('change', () => {
        show();
        if (form.payment_type.value === 'Paid in full' && form.quote_price.value && !form.payment_amount.value) form.payment_amount.value = form.quote_price.value;
      });
      form.home_id.addEventListener('change', () => { const h = homes.find(x => String(x.id) === form.home_id.value); if (h && h.price && !form.quote_price.value) form.quote_price.value = h.price; });
      show();
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = formData(form);
        const r = results.find(x => x.v === d.result);
        const payload = { result: d.result, outcome: r.text, notes: d.notes };
        if (d.result === 'presented') Object.assign(payload, { home_id: d.home_id ? Number(d.home_id) : null, quote_price: d.quote_price, payment_type: d.payment_type,
          payment_amount: d.payment_type === 'None yet' ? null : d.payment_amount, next_steps: d.next_steps, next_step_date: d.next_step_date });
        await post(`/api/appointments/${a.id}/outcome`, payload);
        close();
        const msg = d.result === 'not_right' ? 'Saved; deal closed as Lost (park not right)'
          : d.result === 'no_show' ? 'Saved; rebook call added to today'
          : d.payment_type !== 'None yet' ? `Saved; deal moved to Finance & Paperwork (${d.payment_type.toLowerCase()} taken)`
          : `Saved; deal moved to Park Tour${d.next_steps ? ' with your next step as a task' : ''}`;
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
    title: c ? 'Edit contact' : 'New contact',
    wide: true,
    body: `
      <div class="grid2">
        <label class="field">First name<input name="first_name" value="${esc(v.first_name || '')}" autofocus></label>
        <label class="field">Last name<input name="last_name" value="${esc(v.last_name || '')}"></label>
        <label class="field">Mobile<input name="mobile" type="tel" value="${esc(v.mobile || '')}"></label>
        <label class="field">Email<input name="email" type="email" value="${esc(v.email || '')}"></label>
        <label class="field">Address<input name="address" value="${esc(v.address || '')}"></label>
        <label class="field">Postcode<input name="postcode" value="${esc(v.postcode || '')}"></label>
      </div>
      <div class="grid3">
        <label class="field">Type<select name="type">${options(m.contactTypes, v.type)}</select></label>
        <label class="field">Lead status<select name="lead_status">${options(m.leadStatuses, v.lead_status)}</select></label>
        <label class="field">Lead source<input name="lead_source" value="${esc(v.lead_source || '')}" list="sources-list" placeholder="e.g. WEBSITE"></label>
        <label class="field">Budget (£)<input name="budget" type="number" step="500" data-num value="${esc(v.budget ?? '')}"></label>
        <label class="field">Bedrooms wanted<select name="bedrooms">${options(['', '1', '2', '3', '4+'], v.bedrooms)}</select></label>
        <label class="field">Finance needed<select name="finance_needed">${options([{ value: 0, label: 'No' }, { value: 1, label: 'Yes' }], v.finance_needed ? 1 : 0)}</select></label>
      </div>
      <label class="field">Preferences and notes<textarea name="preferences" rows="2" placeholder="e.g. Lakeside plot, prefers weekends, dog owner">${esc(v.preferences || '')}</textarea></label>
      <div class="field"><span>Marketing consent</span><div style="display:flex;gap:20px;flex-wrap:wrap">
        <label class="check"><input type="checkbox" name="consent_email" ${v.consent_email ? 'checked' : ''}> Email</label>
        <label class="check"><input type="checkbox" name="consent_sms" ${v.consent_sms ? 'checked' : ''}> Text message</label>
        <label class="check"><input type="checkbox" name="consent_post" ${v.consent_post ? 'checked' : ''}> Post</label>
      </div></div>
      <datalist id="sources-list"></datalist>`,
    foot: `${c ? '<button type="button" class="btn danger" data-delete>Delete contact</button><div class="spacer"></div>' : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" type="submit">${c ? 'Save contact' : 'Add contact'}</button>`,
    async onMount(root, close, form) {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = formData(form);
        d.finance_needed = Number(d.finance_needed);
        if (!(d.first_name || d.last_name)) { toast('Enter a name', { error: true }); form.first_name.focus(); return; }
        const saved = c ? await patch(`/api/contacts/${c.id}`, d) : await post('/api/contacts', d);
        close(); toast(c ? 'Contact saved' : `${fullName(saved)} added`); changed();
        onSaved && onSaved(saved);
      });
      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (await confirmBox('Delete this contact?', `${esc(fullName(c))} and their deals, tasks and notes will be permanently deleted. This cannot be undone.`, { ok: 'Delete contact', danger: true })) {
          await del(`/api/contacts/${c.id}`); close(); toast('Contact deleted'); location.hash = '#/contacts';
        }
      });
      const src = await get('/api/sources');
      root.querySelector('#sources-list').innerHTML = src.filter(s => s.source !== '(none)').map(s => `<option value="${esc(s.source)}">`).join('');
    }
  });
}

/* ------------------------------------------------------------------ deals */

export async function dealDialog({ deal = null, contact = null } = {}) {
  const m = M();
  const [homes, plots] = await Promise.all([get('/api/homes'), get('/api/plots')]);
  const d = deal || { deal_type: contact && contact.type === 'Owner' ? 'Upgrade with part-ex' : 'New sale' };
  modal({
    title: deal ? 'Edit deal' : 'New deal',
    body: `
      <div class="grid2">
        <label class="field">Deal type<select name="deal_type">${options(m.dealTypes, d.deal_type)}</select></label>
        <label class="field">Target handover<input type="date" name="target_handover" value="${esc(d.target_handover || '')}"></label>
        <label class="field">Holiday home<select name="home_id">${options(homes.filter(h => ['Available', 'Reserved', 'Part-ex in'].includes(h.status) || h.id === d.home_id).map(h => ({ value: h.id, label: `${[h.year, h.make, h.model].filter(Boolean).join(' ')}${h.price ? ' – ' + money(h.price) : ''} (${h.status})` })), d.home_id, { blank: 'Not chosen yet' })}</select></label>
        <label class="field">Plot<select name="plot_id">${options(plots.filter(p => p.status !== 'Occupied' || p.id === d.plot_id).map(p => ({ value: p.id, label: `Plot ${p.plot_number}${p.area ? ', ' + p.area : ''} (${p.status})` })), d.plot_id, { blank: 'Not chosen yet' })}</select></label>
        <label class="field">Price (£)<input type="number" step="100" name="price" data-num value="${esc(d.price ?? '')}"></label>
        <label class="field">Deposit or payment taken (£)<input type="number" step="100" name="deposit" data-num value="${esc(d.deposit ?? '')}"></label>
        <label class="field">Part-ex allowance (£)<input type="number" step="100" name="part_ex_allowance" data-num value="${esc(d.part_ex_allowance ?? '')}"></label>
        <label class="field">Finance status<select name="finance_status">${options(['', 'Not needed', 'To apply', 'Applied', 'Approved', 'Declined'], d.finance_status)}</select></label>
        <label class="field">Payment<select name="payment_status">${options(m.paymentStatuses, d.payment_status || 'None yet')}</select></label>
      </div>
      <label class="field">Notes<textarea name="notes" rows="2">${esc(d.notes || '')}</textarea></label>
      ${!homes.length ? '<div class="faint small">Add your stock under Homes and plots to pick a home here.</div>' : ''}`,
    foot: `${deal ? '<button type="button" class="btn danger" data-delete>Delete deal</button><div class="spacer"></div>' : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" type="submit">${deal ? 'Save deal' : 'Open deal'}</button>`,
    onMount(root, close, form) {
      form.home_id.addEventListener('change', () => { const h = homes.find(x => String(x.id) === form.home_id.value); if (h && h.price && !form.price.value) form.price.value = h.price; if (h && h.plot_id && !form.plot_id.value) form.plot_id.value = h.plot_id; });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const v = formData(form);
        v.home_id = v.home_id ? Number(v.home_id) : null; v.plot_id = v.plot_id ? Number(v.plot_id) : null;
        if (deal) await patch(`/api/deals/${deal.id}`, v); else await post('/api/deals', { ...v, contact_id: contact.id });
        close(); toast(deal ? 'Deal saved' : 'Deal opened'); changed();
      });
      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (await confirmBox('Delete this deal?', 'The deal and its valuations will be removed. Notes on the timeline stay.', { ok: 'Delete deal', danger: true })) { await del(`/api/deals/${deal.id}`); close(); changed(); }
      });
    }
  });
}

export function lostDialog(dealId) {
  const reasons = ['Price', 'Bought elsewhere', 'Site fees', 'Finance declined', 'Changed plans', 'No response'];
  modal({
    title: 'Mark deal as lost',
    body: `<div class="chips" data-r>${reasons.map(r => `<button type="button" class="chip" data-v="${esc(r)}">${esc(r)}</button>`).join('')}</div>
      <label class="field">Reason<input name="reason" required placeholder="Why didn't it go ahead?"></label>`,
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

export async function valuationDialog(deal, contact) {
  const homes = (await get('/api/homes')).filter(h => h.owner_contact_id === contact.id);
  const validDefault = addDays(today(), 30);
  modal({
    title: 'Part-ex valuation',
    body: `
      <label class="field">Their current home<select name="home_id">${options(homes.map(h => ({ value: h.id, label: [h.year, h.make, h.model].filter(Boolean).join(' ') + (h.plot_number ? ', plot ' + h.plot_number : '') })), homes[0]?.id, { blank: homes.length ? 'Choose…' : 'Not on file – describe it below' })}</select></label>
      <label class="field">Description<input name="description" placeholder="e.g. 2014 Willerby Rio, 35x12, 2 bed"></label>
      <div class="grid3">
        <label class="field">Condition<select name="condition_grade">${options(['Excellent', 'Good', 'Fair', 'Poor'], 'Good')}</select></label>
        <label class="field">Offered value (£)<input type="number" step="100" name="offered_value" data-num required></label>
        <label class="field">Valid until<input type="date" name="valid_until" value="${validDefault}"></label>
      </div>
      <label class="check"><input type="checkbox" name="within_age_policy" checked> Within the park’s age policy</label>
      <label class="field">Notes<textarea name="notes" rows="2"></textarea></label>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Save valuation</button>`,
    onMount(root, close, form) {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const v = formData(form);
        if (!v.offered_value) { form.offered_value.focus(); return; }
        v.home_id = v.home_id ? Number(v.home_id) : null;
        await post(`/api/deals/${deal.id}/valuations`, v);
        close(); toast('Valuation saved and applied to the deal'); changed();
      });
    }
  });
}

/* ------------------------------------------------------------ homes/plots */

export async function homeDialog(home = null, { ownerId = null, ownerName = '' } = {}) {
  const m = M();
  const plots = await get('/api/plots');
  const h = home || { status: ownerId ? 'Owner-held' : 'Available', owner_contact_id: ownerId };
  modal({
    title: home ? 'Edit holiday home' : 'Add holiday home',
    wide: true,
    body: `
      <div class="grid3">
        <label class="field">Make<input name="make" value="${esc(h.make || '')}" autofocus placeholder="e.g. Willerby"></label>
        <label class="field">Model<input name="model" value="${esc(h.model || '')}" placeholder="e.g. Sierra"></label>
        <label class="field">Year<input name="year" type="number" data-num value="${esc(h.year ?? '')}"></label>
        <label class="field">Size<input name="size" value="${esc(h.size || '')}" placeholder="e.g. 38x12"></label>
        <label class="field">Bedrooms<input name="bedrooms" type="number" data-num value="${esc(h.bedrooms ?? '')}"></label>
        <label class="field">Condition<select name="condition">${options(['', 'New', 'Excellent', 'Good', 'Fair', 'Poor'], h.condition)}</select></label>
        <label class="field">Status<select name="status">${options(m.homeStatuses, h.status)}</select></label>
        <label class="field">Price (£)<input name="price" type="number" step="100" data-num value="${esc(h.price ?? '')}"></label>
        <label class="field">Plot<select name="plot_id">${options(plots.map(p => ({ value: p.id, label: 'Plot ' + p.plot_number + (p.area ? ', ' + p.area : '') })), h.plot_id, { blank: 'None' })}</select></label>
      </div>
      <div class="grid2">
        <div class="field"><span>Owner (for owners’ homes)</span><div data-picker></div></div>
        <label class="field">Licence expiry<input type="date" name="licence_expiry" value="${esc(h.licence_expiry || '')}"></label>
      </div>
      <label class="field">Notes<textarea name="notes" rows="2">${esc(h.notes || '')}</textarea></label>`,
    foot: `${home ? '<button type="button" class="btn danger" data-delete>Delete</button><div class="spacer"></div>' : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Save home</button>`,
    onMount(root, close, form) {
      contactPicker(root.querySelector('[data-picker]'), { name: 'owner_contact_id', value: h.owner_contact_id, label: home && home.first_name ? fullName(home) : ownerName, allowNew: false });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const v = formData(form);
        v.plot_id = v.plot_id ? Number(v.plot_id) : null; v.owner_contact_id = v.owner_contact_id ? Number(v.owner_contact_id) : null;
        if (home) await patch(`/api/homes/${home.id}`, v); else await post('/api/homes', v);
        close(); toast('Holiday home saved'); changed();
      });
      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (await confirmBox('Delete this home?', 'It will be removed from stock and from any deals.', { ok: 'Delete', danger: true })) { await del(`/api/homes/${home.id}`); close(); changed(); }
      });
    }
  });
}

export function plotDialog(plot = null) {
  const m = M();
  const p = plot || { status: 'Vacant' };
  modal({
    title: plot ? `Edit plot ${plot.plot_number}` : 'Add plot',
    body: `<div class="grid2">
        <label class="field">Plot number<input name="plot_number" value="${esc(p.plot_number || '')}" autofocus required></label>
        <label class="field">Area<input name="area" value="${esc(p.area || '')}" placeholder="e.g. Meadow View"></label>
        <label class="field">Outlook<input name="outlook" value="${esc(p.outlook || '')}" placeholder="e.g. Lakeside"></label>
        <label class="field">Annual pitch fee (£)<input name="pitch_fee" type="number" step="10" data-num value="${esc(p.pitch_fee ?? '')}"></label>
        <label class="field">Status<select name="status">${options(m.plotStatuses, p.status)}</select></label>
      </div>
      <label class="field">Notes<textarea name="notes" rows="2">${esc(p.notes || '')}</textarea></label>`,
    foot: `${plot ? '<button type="button" class="btn danger" data-delete>Delete</button><div class="spacer"></div>' : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Save plot</button>`,
    onMount(root, close, form) {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const v = formData(form);
        if (!v.plot_number) { form.plot_number.focus(); return; }
        if (plot) await patch(`/api/plots/${plot.id}`, v); else await post('/api/plots', v);
        close(); toast('Plot saved'); changed();
      });
      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (await confirmBox('Delete this plot?', 'Homes and deals on it will be unlinked.', { ok: 'Delete', danger: true })) { await del(`/api/plots/${plot.id}`); close(); changed(); }
      });
    }
  });
}

export { minutes, hhmm };
