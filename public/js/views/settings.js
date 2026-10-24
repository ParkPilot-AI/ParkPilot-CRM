import { get, post, patch, api, esc, state, toast, loadMeta, fmtDate, fmtAgo, options, modal, formData, confirmBox, isMgr, isGroupMgr, me, teamOptions, parkOptions, plural } from '../core.js';
import { importZone } from './importui.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Everyone: their profile and their own Outlook. Sales managers and above: the team, and the
// settings that shape everyone's diary and task list. Group sales managers: parks and backups.
export async function render(el, { query = {} } = {}) {
  const mgr = isMgr(), group = isGroupMgr(), u = me();
  const [{ settings: s, outlook: o }, jobs, teamData] = await Promise.all([get('/api/settings'), mgr ? get('/api/jobs') : [], mgr ? get('/api/team') : null]);
  const statusLine = !o.configured ? 'Not set up yet' : !o.connected ? 'Not connected' :
    `Connected as ${esc(o.account?.email || '')}${o.lastPull ? `, last checked ${esc(o.lastPull.slice(11, 16))}` : ''}`;

  el.innerHTML = `
    <div class="today-head"><h1>Settings</h1><div class="spacer"></div><span class="muted small">Signed in as ${esc(u.email)}</span><a class="btn small" href="/auth/logout">Sign out</a></div>
    <div class="settings-grid">
      <section class="panel">
        <div class="panel-head"><h2>You</h2></div>
        <dl class="kv"><dt>Name</dt><dd>${esc(u.name)}</dd><dt>Role</dt><dd>${esc(u.roleLabel)}</dd><dt>Park</dt><dd>${esc(group ? 'All parks' : u.park_name || '–')}</dd><dt>Email</dt><dd>${esc(u.email)}</dd></dl>
        <p class="faint small" style="margin:0;padding:0 18px 16px">${mgr ? '' : 'Your sales manager looks after the team, opening hours and other shared settings.'}</p>
      </section>

      <section class="panel" id="outlook">
        <div class="panel-head"><h2>Your Outlook</h2><div class="spacer"></div><span class="sync-pill"><span class="dot ${o.connected ? (o.lastError ? 'warn' : 'ok') : ''}"></span>${statusLine}</span></div>
        <div class="panel-body" style="display:flex;flex-direction:column;gap:14px">
          <p class="muted" style="margin:0">Appointments in your diary go straight into your own Outlook calendar, with the invite and Teams link sent from your mailbox. Anything you move or cancel in Outlook updates here within a few minutes. Your tasks also appear in Microsoft To Do under a “Coastfields CRM” list.</p>
          ${o.lastError ? `<div class="callout warn"><b>Last sync problem:</b> ${esc(o.lastError)}</div>` : ''}
          ${o.errors ? `<div class="callout warn">${o.errors} appointment(s) could not be sent to Outlook. <button class="btn small" data-retry>Try again</button></div>` : ''}
          ${o.connected ? `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-sync>Sync now</button><button class="btn danger" data-disconnect>Disconnect</button></div>`
          : o.managed ? `<p style="margin:0">Click below and sign in with your own Microsoft work account.</p><div><a class="btn primary" href="/api/auth/start">Connect my Outlook</a></div>`
          : `<div class="callout warn">The Outlook connection isn’t set up for the portal yet. ${mgr ? 'Add GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET and GRAPH_TENANT_ID in Netlify, redeploy, then reload this page.' : 'Ask your sales manager.'}</div>`}
          ${mgr ? `<label class="check"><input type="checkbox" data-todo ${s.todoMirror ? 'checked' : ''}> Copy everyone’s tasks to their Microsoft To Do</label>` : ''}
        </div>
      </section>

      ${mgr ? teamPanel(teamData, u, group) : ''}

      ${mgr ? `<section class="panel">
        <div class="panel-head"><h2>Opening hours and diary</h2><span class="faint small">All parks</span></div>
        <form class="panel-body" data-form="diary" style="display:flex;flex-direction:column;gap:14px">
          <div class="grid3">
            <label class="field">Opens<input type="time" name="open" value="${esc(s.openingHours.start)}"></label>
            <label class="field">Closes<input type="time" name="close" value="${esc(s.openingHours.end)}"></label>
            <label class="field">Gap after appointments<select name="buffer">${options([0, 10, 15, 20, 30].map(v => ({ value: v, label: v ? v + ' minutes' : 'None' })), s.bufferMinutes)}</select></label>
          </div>
          <div class="field"><span>Sales office closed on</span><div style="display:flex;gap:14px;flex-wrap:wrap">${[1, 2, 3, 4, 5, 6, 0].map(d => `<label class="check"><input type="checkbox" name="closed" value="${d}" ${s.closedDays.includes(d) ? 'checked' : ''}> ${DAYS[d].slice(0, 3)}</label>`).join('')}</div>
            <span class="faint small" style="font-weight:400">Tasks never roll onto a closed day, and no appointments are suggested then.</span></div>
          <div class="field"><span>Default appointment lengths (minutes)</span><div class="grid3">${Object.entries(s.durations).map(([k, v]) => `<label class="field" style="font-weight:500">${esc(k)}<input type="number" min="5" step="5" name="dur:${esc(k)}" value="${v}"></label>`).join('')}</div></div>
          <label class="field">Default location for visits<input name="officeLocation" value="${esc(s.officeLocation)}"></label>
          <div><button class="btn primary">Save diary settings</button></div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Task rollover</h2><span class="faint small">Everyone</span></div>
        <form class="panel-body" data-form="tasks" style="display:flex;flex-direction:column;gap:14px">
          <p class="muted" style="margin:0">Every night, unfinished tasks from earlier days move onto today’s list. They keep the date they were first due, and are coloured amber when 1–2 days late and red when 3 or more days late (or any late High-priority task).</p>
          <div class="grid3">
            <label class="field">Roll over at<input type="time" name="rolloverTime" value="${esc(s.rolloverTime)}"></label>
            <label class="field">Raise priority after<select name="escalateAfter">${options([2, 3, 4, 5].map(v => ({ value: v, label: v + ' rollovers' })), s.escalateAfter)}</select></label>
            <label class="field">Ask “still relevant?” after<select name="reviewAfter">${options([3, 5, 7, 10].map(v => ({ value: v, label: v + ' rollovers' })), s.reviewAfter)}</select></label>
          </div>
          <label class="field">Treat enquiries as active for<select name="activeLeadDays">${options([30, 60, 90, 180, 365].map(v => ({ value: v, label: v + ' days' })), s.activeLeadDays)}</select></label>
          <div style="display:flex;gap:8px"><button class="btn primary">Save rollover settings</button><button type="button" class="btn" data-rollnow>Roll over now</button></div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Import, export${group ? ' and backup' : ''}</h2></div>
        <div class="panel-body" style="display:flex;flex-direction:column;gap:14px">
          <div data-import></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn" href="/api/export/contacts.csv" download>Export ${group ? 'all' : 'your park’s'} contacts (CSV)</a>${group ? '<a class="btn" href="/api/backup" download>Download a backup</a>' : ''}</div>
          ${group ? '<p class="faint small" style="margin:0">Your data is kept in this site’s private Netlify Blobs storage, with a dated copy saved each day for 60 days. Download a backup now and then and keep it somewhere safe, such as SharePoint or OneDrive.</p>' : ''}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Recent activity</h2></div>
        ${jobs.length ? `<ul class="mini-list">${jobs.slice(0, 12).map(j => `<li><span>${esc(j.job)} <span class="faint small">${esc(summarise(j))}</span></span><span class="faint small nowrap">${esc(fmtDate(j.at))} ${esc(j.at.slice(11, 16))}</span></li>`).join('')}</ul>` : '<div class="empty small">Nothing yet.</div>'}
      </section>` : ''}
    </div>`;

  /* ---- Outlook ---- */
  el.querySelector('[data-sync]')?.addEventListener('click', async e => {
    e.target.disabled = true; e.target.textContent = 'Syncing…';
    const r = await post('/api/outlook/sync');
    if (r.result.error) toast('Sync problem: ' + r.result.error, { error: true });
    else toast(`Outlook synced${r.result.calendar ? summariseCounts(r.result.calendar) : ''}`);
    render(el);
  });
  el.querySelector('[data-disconnect]')?.addEventListener('click', async () => { await post('/api/outlook/disconnect'); await loadMeta(); toast('Outlook disconnected'); render(el); });
  el.querySelector('[data-retry]')?.addEventListener('click', async () => { await post('/api/outlook/retry'); toast('Trying again'); setTimeout(() => render(el), 2000); });
  el.querySelector('[data-todo]')?.addEventListener('change', async e => { await api('PUT', '/api/settings', { todoMirror: e.target.checked }); toast(e.target.checked ? 'Tasks will copy to To Do' : 'Stopped copying tasks to To Do'); });
  if (!mgr) return;

  bindTeam(el, teamData);

  /* ---- Diary ---- */
  el.querySelector('[data-form=diary]').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    if (f.open.value >= f.close.value) { toast('Closing time must be after opening time', { error: true }); return; }
    const durations = {};
    for (const inp of f.querySelectorAll('[name^="dur:"]')) durations[inp.name.slice(4)] = Number(inp.value) || 30;
    await api('PUT', '/api/settings', {
      openingHours: { start: f.open.value, end: f.close.value }, bufferMinutes: Number(f.buffer.value),
      closedDays: [...f.querySelectorAll('[name=closed]:checked')].map(i => Number(i.value)), durations, officeLocation: f.officeLocation.value || 'Sales office'
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
        <span class="small">${p.active ? `${plural(p.leads, 'open lead')}${p.overdue ? ` · <span class="badge red">${p.overdue} late</span>` : ''} · ${p.outlook ? 'Outlook connected' : '<span class="faint">Outlook not connected</span>'} · ${p.last_seen_at ? 'last in ' + esc(fmtAgo(p.last_seen_at)) : '<span class="faint">not signed in yet</span>'}` : '<span class="faint">No longer has access</span>'}</span></span>
      <span class="acts">${p.canEdit && !p.isMe ? (p.active ? `<button class="btn small" data-editperson="${p.id}">Edit</button> <button class="btn small ghost danger" data-removeperson="${p.id}">Remove</button>` : `<button class="btn small" data-restore="${p.id}">Restore</button>`) : ''}</span>
    </li>`;
  return `<section class="panel span2" id="team">
    <div class="panel-head"><h2>Team${group ? ' and parks' : ` at ${esc(u.park_name || 'your park')}`}</h2><div class="spacer"></div><button class="btn primary small" data-addperson>+ Add person</button></div>
    <div class="panel-body" style="padding-top:0">
      <p class="faint small" style="margin:6px 0 10px">People sign in with their own Microsoft work account. Add them here first${group ? '' : '; you can add sales executives at your park'}. Removing someone stops their access at once and hands their leads on.</p>
      <ul class="people">${active.map(row).join('')}</ul>
      ${gone.length ? `<details style="margin-top:8px"><summary class="small muted" style="cursor:pointer">${plural(gone.length, 'former team member')}</summary><ul class="people">${gone.map(row).join('')}</ul></details>` : ''}
      ${group ? `<h3 style="margin:18px 0 8px;font-size:15px">Parks</h3>
        <ul class="people">${t.parks.map(p => `<li class="person"><span class="who"><b>${esc(p.name)}</b><span class="faint small">${plural(p.people, 'person', 'people')} · ${plural(p.leads, 'lead')}</span></span><span class="acts"><button class="btn small" data-renamepark="${p.id}" data-name="${esc(p.name)}">Rename</button></span></li>`).join('')}</ul>
        <div style="margin-top:10px"><button class="btn small" data-addpark>+ Add park</button></div>` : ''}
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
      <label class="field">Work email<input name="email" type="email" value="${esc(p ? p.email : '')}" ${p ? 'disabled' : 'autofocus required'} placeholder="name@yourcompany.co.uk"></label>
      <label class="field">Name<input name="name" value="${esc(p ? p.name : '')}" placeholder="As it should appear to the team"></label>
      ${group ? `<div class="grid2">
        <label class="field">Role<select name="role">${options(Object.entries(roles).map(([value, label]) => ({ value, label })), p ? p.role : 'exec')}</select></label>
        <label class="field" data-parkrow>Park<select name="park_id">${parkOptions(p ? p.park_id : me().park_id)}</select></label></div>`
      : `<p class="faint small" style="margin:0">They’ll be a ${esc(roles.exec)} at ${esc(me().park_name || 'your park')}.</p>`}`,
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
        close(); toast(p ? 'Saved' : `${d.name || d.email} added. They can now sign in with their Microsoft account.`); done();
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
    title: park ? 'Rename park' : 'Add a park',
    body: `<label class="field">Park name<input name="name" value="${esc(park ? park.name : '')}" autofocus required></label>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" type="submit">${park ? 'Save' : 'Add park'}</button>`,
    onMount(root, close, form) {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!form.name.value.trim()) { form.name.focus(); return; }
        if (park) await patch(`/api/parks/${park.id}`, { name: form.name.value }); else await post('/api/parks', { name: form.name.value });
        close(); toast(park ? 'Park renamed' : 'Park added'); done();
      });
    }
  });
}

function summariseCounts(c) {
  const parts = [];
  if (c.moved) parts.push(`${c.moved} moved`);
  if (c.linked) parts.push(`${c.linked} linked`);
  if (c.cancelled || c.removed) parts.push(`${(c.cancelled || 0) + (c.removed || 0)} removed`);
  return parts.length ? ': ' + parts.join(', ') : ', no changes';
}
function summarise(j) {
  try {
    const d = JSON.parse(j.detail);
    if (j.job === 'import') return `${d.fileName}: ${d.created} new, ${d.updated} updated`;
    if (j.job === 'rollover') return `${d.count} task(s) brought forward`;
    if (j.job === 'outlook-sync') return summariseCounts(d || {}).replace(/^[:,] /, '');
    return typeof d === 'string' ? d : '';
  } catch { return j.detail || ''; }
}
void confirmBox;
