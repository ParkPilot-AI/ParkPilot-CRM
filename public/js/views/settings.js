import { get, post, patch, api, esc, state, toast, loadMeta, fmtDate, fmtAgo, options, modal, formData, confirmBox, isMgr, isGroupMgr, me, teamOptions, parkOptions, plural } from '../core.js';
import { importZone } from './importui.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Everyone: their profile and their own Google connection (Gmail leads and Google Calendar).
// Managers and admins: the team, lead capture and the settings that shape the diary and task list.
// Admins: backups and teams.
export async function render(el, { query = {} } = {}) {
  const mgr = isMgr(), group = isGroupMgr(), u = me();
  const [{ settings: s, google: o }, jobs, teamData, unnamed] = await Promise.all([get('/api/settings'), mgr ? get('/api/jobs') : [], mgr ? get('/api/team') : null, mgr ? get('/api/google/unnamed') : { count: 0 }]);
  const statusLine = !o.configured ? 'Not set up yet' : !o.connected ? 'Not connected' :
    `Connected as ${esc(o.account?.email || '')}${o.lastGmail ? `, Gmail checked ${esc(o.lastGmail.slice(11, 16))}` : ''}`;

  el.innerHTML = `
    <div class="today-head"><h1>Settings</h1><div class="spacer"></div><span class="muted small">Signed in as ${esc(u.email)}</span><a class="btn small" href="/auth/logout">Sign out</a></div>
    <div class="settings-grid">
      <section class="panel">
        <div class="panel-head"><h2>You</h2></div>
        <dl class="kv"><dt>Name</dt><dd>${esc(u.name)}</dd><dt>Role</dt><dd>${esc(u.roleLabel)}${group ? ' (full access)' : ''}</dd><dt>Email</dt><dd>${esc(u.email)}</dd></dl>
        <p class="faint small" style="margin:0;padding:0 18px 16px">${group ? 'As an admin you can change every setting, manage the team and download backups.' : mgr ? '' : 'Your sales manager looks after the team, opening hours and other shared settings.'}</p>
      </section>

      <section class="panel" id="google">
        <div class="panel-head"><h2>Gmail and Google Calendar</h2><div class="spacer"></div><span class="sync-pill"><span class="dot ${o.connected ? (o.lastError ? 'warn' : 'ok') : ''}"></span>${statusLine}</span></div>
        <div class="panel-body" style="display:flex;flex-direction:column;gap:14px">
          <ol class="google-steps">
            <li>Put the <b>${esc(o.gmailLabel)}</b> label on an enquiry in Gmail (or let a Gmail filter do it). Within 10 minutes it becomes a lead here, with a “Reply to…” task for today. Emails from people already in the CRM go on their timeline instead.</li>
            <li>Only emails with a <b>name</b> and an <b>email address or phone number</b> become leads. The CRM moves them to <b>${esc(o.gmailDoneLabel)}</b>, so nothing is imported twice. Emails without those details go to <b>${esc(o.gmailSkippedLabel)}</b> instead; if one is a real enquiry, add the person here with + New → Lead.</li>
            <li>Demos and calls you book here go into your Google Calendar, with a Google Meet link and an invite to the customer.</li>
          </ol>
          ${o.lastError ? `<div class="callout warn"><b>Last problem:</b> ${esc(o.lastError)}</div>` : ''}
          ${o.errors ? `<div class="callout warn">${o.errors} appointment(s) could not be added to Google Calendar. <button class="btn small" data-retry>Try again</button></div>` : ''}
          ${unnamed.count ? `<div class="callout warn">${plural(unnamed.count, 'lead')} from Gmail ${unnamed.count === 1 ? 'has' : 'have'} no name or no contact details. <button class="btn small" data-unnamed>Remove ${unnamed.count === 1 ? 'it' : 'them'}</button></div>` : ''}
          ${o.connected ? `<div class="faint small">${o.gmailTotal ? `${plural(o.gmailTotal, 'lead')} created from Gmail so far.` : 'No leads from Gmail yet.'}${o.lastGmailCounts && (o.lastGmailCounts.created || o.lastGmailCounts.updated || o.lastGmailCounts.incomplete) ? ` Last check: ${o.lastGmailCounts.created} new, ${o.lastGmailCounts.updated} added to existing leads${o.lastGmailCounts.incomplete ? `, ${o.lastGmailCounts.incomplete} not imported (no name or contact details)` : ''}.` : ''}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-sync>Check Gmail now</button><button class="btn danger" data-disconnect>Disconnect</button></div>`
          : o.configured ? `<div><a class="btn primary" href="/api/google/start">Connect Gmail and Google Calendar</a></div>
            <p class="faint small" style="margin:0">Sign in with ${esc(u.email)} and tick every box on Google’s permission page.</p>`
          : `<div class="callout warn">Google isn’t set up for the CRM yet. ${mgr ? 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Netlify, redeploy, then reload this page.' : 'Ask your sales manager.'}</div>`}
        </div>
      </section>

      ${mgr ? `<section class="panel">
        <div class="panel-head"><h2>Lead capture</h2></div>
        <form class="panel-body" data-form="leads" style="display:flex;flex-direction:column;gap:14px">
          <div class="grid2">
            <label class="field">Gmail label for new leads<input name="gmailLabel" value="${esc(s.gmailLabel)}" required></label>
            <label class="field">Label after importing<input name="gmailDoneLabel" value="${esc(s.gmailDoneLabel)}" required></label>
            <label class="field">Label for emails not imported<input name="gmailSkippedLabel" value="${esc(s.gmailSkippedLabel || 'CRM Not imported')}" required><span class="plan-hint">No name, or no email or phone number.</span></label>
          </div>
          <label class="field">Your own email domains<input name="ownDomains" value="${esc(s.ownDomains || '')}" placeholder="e.g. parkpilot.uk"><span class="plan-hint">Emails from these addresses are never treated as the lead (your own domain is always included). Separate several with commas.</span></label>
          <label class="check"><input type="checkbox" name="replyTask" ${s.replyTask !== false ? 'checked' : ''}> Add a “Reply to…” task for today for every new email</label>
          <label class="check"><input type="checkbox" name="calendarSync" ${s.calendarSync !== false ? 'checked' : ''}> Put appointments in Google Calendar</label>
          <div><button class="btn primary">Save lead capture settings</button></div>
        </form>
      </section>` : ''}

      ${mgr ? teamPanel(teamData, u, group) : ''}

      ${mgr ? `<section class="panel">
        <div class="panel-head"><h2>Working hours and diary</h2></div>
        <form class="panel-body" data-form="diary" style="display:flex;flex-direction:column;gap:14px">
          <div class="grid3">
            <label class="field">Opens<input type="time" name="open" value="${esc(s.openingHours.start)}"></label>
            <label class="field">Closes<input type="time" name="close" value="${esc(s.openingHours.end)}"></label>
            <label class="field">Gap after appointments<select name="buffer">${options([0, 10, 15, 20, 30].map(v => ({ value: v, label: v ? v + ' minutes' : 'None' })), s.bufferMinutes)}</select></label>
          </div>
          <div class="field"><span>Not working on</span><div style="display:flex;gap:14px;flex-wrap:wrap">${[1, 2, 3, 4, 5, 6, 0].map(d => `<label class="check"><input type="checkbox" name="closed" value="${d}" ${s.closedDays.includes(d) ? 'checked' : ''}> ${DAYS[d].slice(0, 3)}</label>`).join('')}</div>
            <span class="faint small" style="font-weight:400">Tasks never roll onto a closed day, and no appointments are suggested then.</span></div>
          <div class="field"><span>Default appointment lengths (minutes)</span><div class="grid3">${Object.entries(s.durations).map(([k, v]) => `<label class="field" style="font-weight:500">${esc(k)}<input type="number" min="5" step="5" name="dur:${esc(k)}" value="${v}"></label>`).join('')}</div></div>
          <label class="field">Default location for site visits<input name="officeLocation" value="${esc(s.officeLocation)}"></label>
          <div><button class="btn primary">Save diary settings</button></div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Task rollover</h2></div>
        <form class="panel-body" data-form="tasks" style="display:flex;flex-direction:column;gap:14px">
          <p class="muted" style="margin:0">Every night, unfinished tasks from earlier days move onto today’s list. They keep the date they were first due, and are coloured amber when 1–2 days late and red when 3 or more days late (or any late High-priority task).</p>
          <div class="grid3">
            <label class="field">Roll over at<input type="time" name="rolloverTime" value="${esc(s.rolloverTime)}"></label>
            <label class="field">Raise priority after<select name="escalateAfter">${options([2, 3, 4, 5].map(v => ({ value: v, label: v + ' rollovers' })), s.escalateAfter)}</select></label>
            <label class="field">Ask “still relevant?” after<select name="reviewAfter">${options([3, 5, 7, 10].map(v => ({ value: v, label: v + ' rollovers' })), s.reviewAfter)}</select></label>
          </div>
          <label class="field">Imported enquiries count as active if newer than<select name="activeLeadDays">${options([30, 60, 90, 180, 365].map(v => ({ value: v, label: v + ' days' })), s.activeLeadDays)}</select></label>
          <div style="display:flex;gap:8px"><button class="btn primary">Save rollover settings</button><button type="button" class="btn" data-rollnow>Roll over now</button></div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Import, export${group ? ' and backup' : ''}</h2></div>
        <div class="panel-body" style="display:flex;flex-direction:column;gap:14px">
          <div data-import></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn" href="/api/export/contacts.csv" download>Export ${group ? 'all' : 'your team’s'} leads (CSV)</a>${group ? '<a class="btn" href="/api/backup" download>Download a backup</a>' : ''}</div>
          ${group ? '<p class="faint small" style="margin:0">Your data is kept in this site’s private Netlify Blobs storage, with a dated copy saved each day for 60 days. Download a backup now and then and keep it somewhere safe, such as Google Drive.</p>' : ''}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Recent activity</h2></div>
        ${jobs.length ? `<ul class="mini-list">${jobs.slice(0, 12).map(j => `<li><span>${esc(j.job)} <span class="faint small">${esc(summarise(j))}</span></span><span class="faint small nowrap">${esc(fmtDate(j.at))} ${esc(j.at.slice(11, 16))}</span></li>`).join('')}</ul>` : '<div class="empty small">Nothing yet.</div>'}
      </section>` : ''}
    </div>`;

  /* ---- Google ---- */
  el.querySelector('[data-sync]')?.addEventListener('click', async e => {
    e.target.disabled = true; e.target.textContent = 'Checking…';
    const r = await post('/api/google/sync');
    const g = r.result.gmail || {};
    if (r.result.error || g.error) toast('Problem: ' + (r.result.error || g.error), { error: true });
    else toast(g.created || g.updated || g.incomplete ? `Gmail checked: ${plural(g.created || 0, 'new lead')}${g.updated ? `, ${g.updated} added to existing leads` : ''}${g.incomplete ? `, ${g.incomplete} not imported (no name or contact details)` : ''}` : `Gmail checked: nothing labelled “${o.gmailLabel}”`);
    render(el);
  });
  el.querySelector('[data-disconnect]')?.addEventListener('click', async () => {
    if (!await confirmBox('Disconnect Google?', 'New emails will stop becoming leads and appointments won’t go into Google Calendar until you connect again. Nothing already in the CRM is removed.', { ok: 'Disconnect', danger: true })) return;
    await post('/api/google/disconnect'); await loadMeta(); toast('Google disconnected'); render(el);
  });
  el.querySelector('[data-unnamed]')?.addEventListener('click', async () => {
    if (!await confirmBox('Remove unnamed leads?', `${plural(unnamed.count, 'lead')} imported from Gmail without a name or contact details, and not worked on since, will be deleted. The emails stay in Gmail.`, { ok: 'Remove', danger: true })) return;
    const r = await post('/api/google/unnamed/remove'); toast(`${plural(r.removed, 'lead')} removed`); render(el);
  });
  el.querySelector('[data-retry]')?.addEventListener('click', async () => { await post('/api/google/retry'); toast('Trying again'); setTimeout(() => render(el), 2000); });
  if (query.connected) toast('Google connected. Labelled emails will now become leads.');
  if (!mgr) return;

  bindTeam(el, teamData);

  /* ---- Lead capture ---- */
  el.querySelector('[data-form=leads]').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const names = [f.gmailLabel, f.gmailDoneLabel, f.gmailSkippedLabel].map(i => i.value.trim().toLowerCase());
    if (new Set(names).size < 3) { toast('Use three different labels', { error: true }); return; }
    await api('PUT', '/api/settings', { gmailLabel: f.gmailLabel.value.trim(), gmailDoneLabel: f.gmailDoneLabel.value.trim(), gmailSkippedLabel: f.gmailSkippedLabel.value.trim(), ownDomains: f.ownDomains.value.trim(),
      replyTask: f.replyTask.checked, calendarSync: f.calendarSync.checked });
    await loadMeta(); toast('Lead capture settings saved'); render(el);
  });

  /* ---- Diary ---- */
  el.querySelector('[data-form=diary]').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    if (f.open.value >= f.close.value) { toast('Closing time must be after opening time', { error: true }); return; }
    const durations = {};
    for (const inp of f.querySelectorAll('[name^="dur:"]')) durations[inp.name.slice(4)] = Number(inp.value) || 30;
    await api('PUT', '/api/settings', {
      openingHours: { start: f.open.value, end: f.close.value }, bufferMinutes: Number(f.buffer.value),
      closedDays: [...f.querySelectorAll('[name=closed]:checked')].map(i => Number(i.value)), durations, officeLocation: f.officeLocation.value || 'At the park'
    });
    await loadMeta(); toast('Diary settings saved');
  });
  /* ---- Tasks ---- */
  el.querySelector('[data-form=tasks]').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    await api('PUT', '/api/settings', { rolloverTime: f.rolloverTime.value || '02:15', escalateAfter: Number(f.escalateAfter.value), reviewAfter: Number(f.reviewAfter.value), activeLeadDays: Number(f.activeLeadDays.value) });
    await loadMeta(); toast('Rollover settings saved');
  });
  el.querySelector('[data-rollnow]').addEventListener('click', async () => { const r = await post('/api/rollover'); toast(r.rolled ? `${r.rolled} task(s) brought forward to today` : 'Nothing to roll over'); });

  importZone(el.querySelector('[data-import]'));
  if (query.section === 'team') el.querySelector('#team')?.scrollIntoView({ block: 'start' });
}

/* ------------------------------------------------------------------ team */

function teamPanel(t, u, group) {
  const active = t.people.filter(p => p.active), gone = t.people.filter(p => !p.active);
  const row = p => `<li class="person${p.active ? '' : ' gone'}">
      <span class="who"><b>${esc(p.name || p.email)}${p.isMe ? ' (you)' : ''}</b><span class="faint small">${esc(p.roleLabel)}${group && p.park_name ? ' · ' + esc(p.park_name) : ''} · ${esc(p.email)}</span>
        <span class="small">${p.active ? `${plural(p.leads, 'open lead')}${p.overdue ? ` · <span class="badge red">${p.overdue} late</span>` : ''} · ${p.google ? 'Google connected' : '<span class="faint">Google not connected</span>'} · ${p.last_seen_at ? 'last in ' + esc(fmtAgo(p.last_seen_at)) : '<span class="faint">not signed in yet</span>'}` : '<span class="faint">No longer has access</span>'}</span></span>
      <span class="acts">${p.canEdit && !p.isMe ? (p.active ? `<button class="btn small" data-editperson="${p.id}">Edit</button> <button class="btn small ghost danger" data-removeperson="${p.id}">Remove</button>` : `<button class="btn small" data-restore="${p.id}">Restore</button>`) : ''}</span>
    </li>`;
  return `<section class="panel span2" id="team">
    <div class="panel-head"><h2>Team</h2><div class="spacer"></div><button class="btn primary small" data-addperson>+ Add person</button></div>
    <div class="panel-body" style="padding-top:0">
      <p class="faint small" style="margin:6px 0 10px">People sign in with their own Google account. ${t.people.filter(p => p.active).length <= 1 ? 'It’s just you for now. When someone joins, add them here first; they’ll then be able to sign in.' : `Add them here first${group ? '' : '; you can add sales executives to your team'}. Removing someone stops their access at once and hands their leads on.`}</p>
      <ul class="people">${active.map(row).join('')}</ul>
      ${gone.length ? `<details style="margin-top:8px"><summary class="small muted" style="cursor:pointer">${plural(gone.length, 'former team member')}</summary><ul class="people">${gone.map(row).join('')}</ul></details>` : ''}
      ${group && t.parks.length > 1 ? `<h3 style="margin:18px 0 8px;font-size:15px">Sales teams</h3>
        <ul class="people">${t.parks.map(p => `<li class="person"><span class="who"><b>${esc(p.name)}</b><span class="faint small">${plural(p.people, 'person', 'people')} · ${plural(p.leads, 'lead')}</span></span><span class="acts"><button class="btn small" data-renamepark="${p.id}" data-name="${esc(p.name)}">Rename</button></span></li>`).join('')}</ul>` : ''}
    </div>
  </section>`;
}

function bindTeam(el, t) {
  const find = id => t.people.find(p => String(p.id) === String(id));
  const refresh = async () => { await loadMeta(); render(el, { query: { section: 'team' } }); };
  el.querySelector('[data-addperson]')?.addEventListener('click', () => personDialog(null, refresh));
  el.querySelectorAll('[data-editperson]').forEach(b => b.addEventListener('click', () => personDialog(find(b.dataset.editperson), refresh)));
  el.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', async () => {
    const p = find(b.dataset.restore);
    await post('/api/users', { email: p.email, name: p.name, role: p.role, park_id: p.park_id });
    toast(`${p.name} can sign in again`); refresh();
  }));
  el.querySelectorAll('[data-removeperson]').forEach(b => b.addEventListener('click', () => removeDialog(find(b.dataset.removeperson), refresh)));
  el.querySelector('[data-addpark]')?.addEventListener('click', () => parkDialog(null, refresh));
  el.querySelectorAll('[data-renamepark]').forEach(b => b.addEventListener('click', () => parkDialog({ id: b.dataset.renamepark, name: b.dataset.name }, refresh)));
}

function personDialog(p, done) {
  const group = isGroupMgr();
  const roles = state.meta.roles;
  modal({
    title: p ? `Edit ${p.name}` : 'Add someone to the team',
    body: `
      <label class="field">Google account email<input name="email" type="email" value="${esc(p ? p.email : '')}" ${p ? 'disabled' : 'autofocus required'} placeholder="name@parkpilot.uk"></label>
      <label class="field">Name<input name="name" value="${esc(p ? p.name : '')}" placeholder="As it should appear to the team"></label>
      ${group ? `<div class="grid2">
        <label class="field">Role<select name="role">${options(Object.entries(roles).map(([value, label]) => ({ value, label })), p ? p.role : 'exec')}</select></label>
        <label class="field" data-parkrow>Team<select name="park_id">${parkOptions(p ? p.park_id : me().park_id)}</select></label></div>
        <p class="faint small" style="margin:0">${esc(roles.exec)}: their own leads. ${esc(roles.manager)}: the whole team’s leads and settings. ${esc(roles.group)}: full access.</p>`
      : `<p class="faint small" style="margin:0">They’ll be a ${esc(roles.exec)} in your team.</p>`}`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" type="submit">${p ? 'Save' : 'Add to team'}</button>`,
    onMount(root, close, form) {
      const sync = () => { const r = root.querySelector('[data-parkrow]'); if (r) r.querySelector('select').disabled = false; };
      sync();
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = formData(form);
        if (!p && !d.email) { form.email.focus(); return; }
        if (d.park_id) d.park_id = Number(d.park_id);
        if (p) await patch(`/api/users/${p.id}`, d); else await post('/api/users', d);
        close(); toast(p ? 'Saved' : `${d.name || d.email} added. They can now sign in with their Google account.`); done();
      });
    }
  });
}

function removeDialog(p, done) {
  modal({
    title: `Remove ${p.name}?`,
    body: `<p style="margin:0">${esc(p.name)} won’t be able to sign in any more. They have ${plural(p.leads, 'open lead')}.</p>
      <label class="field">Hand their leads and open tasks to<select name="transfer_to">${teamOptions('', { unallocated: true, unallocatedLabel: 'Nobody: put the leads back to unallocated' }).replace(`<option value="${p.id}">`, `<option value="${p.id}" disabled>`)}</select></label>
      <p class="faint small" style="margin:0">Appointments already booked stay in their diary so you can see them; rebook them with someone else if needed.</p>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn danger solid" type="submit">Remove</button>`,
    onMount(root, close, form) {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const to = form.transfer_to.value ? Number(form.transfer_to.value) : null;
        const r = await post(`/api/users/${p.id}/remove`, { transfer_to: to });
        close(); toast(`${p.name} removed; ${plural(r.moved, 'lead')} ${to ? 'handed on' : 'back to unallocated'}`); done();
      });
    }
  });
}

function parkDialog(park, done) {
  modal({
    title: park ? 'Rename team' : 'Add a team',
    body: `<label class="field">Team name<input name="name" value="${esc(park ? park.name : '')}" autofocus required></label>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" type="submit">${park ? 'Save' : 'Add team'}</button>`,
    onMount(root, close, form) {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!form.name.value.trim()) { form.name.focus(); return; }
        if (park) await patch(`/api/parks/${park.id}`, { name: form.name.value }); else await post('/api/parks', { name: form.name.value });
        close(); toast(park ? 'Team renamed' : 'Team added'); done();
      });
    }
  });
}

function summarise(j) {
  try {
    const d = JSON.parse(j.detail);
    if (j.job === 'import') return `${d.fileName}: ${d.created} new, ${d.updated} updated`;
    if (j.job === 'rollover') return `${d.count} task(s) brought forward`;
    if (j.job === 'gmail') return `${d.created || 0} new lead(s), ${d.updated || 0} added to existing${d.incomplete ? `, ${d.incomplete} not imported` : ''}${d.failed ? `, ${d.failed} failed` : ''}`;
    return typeof d === 'string' ? d : '';
  } catch { return j.detail || ''; }
}
void confirmBox;
