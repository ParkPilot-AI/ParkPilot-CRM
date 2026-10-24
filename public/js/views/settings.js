import { get, post, api, esc, state, toast, loadMeta, fmtDate, options } from '../core.js';
import { importZone } from './importui.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export async function render(el) {
  const [{ settings: s, outlook: o, dataDir, hosted }, jobs] = await Promise.all([get('/api/settings'), get('/api/jobs')]);
  const statusLine = !o.configured ? 'Not set up yet' : !o.connected ? 'Ready to connect' :
    `Connected as ${esc(o.account?.email || '')}${o.lastPull ? `, last checked ${esc(o.lastPull.slice(11, 16))}` : ''}`;

  el.innerHTML = `
    <div class="today-head"><h1>Settings</h1><div class="spacer"></div>${hosted && state.meta.user ? `<span class="muted small">Signed in as ${esc(state.meta.user.email)}</span><a class="btn small" href="/auth/logout">Sign out</a>` : ''}</div>
    <div class="settings-grid">
      <section class="panel" id="outlook">
        <div class="panel-head"><h2>Microsoft Outlook</h2><div class="spacer"></div><span class="sync-pill"><span class="dot ${o.connected ? (o.lastError ? 'warn' : 'ok') : ''}"></span>${statusLine}</span></div>
        <div class="panel-body" style="display:flex;flex-direction:column;gap:14px">
          <p class="muted" style="margin:0">Appointments you book here go straight into your Outlook calendar, with the invite and Teams link sent by Outlook. Anything you move or cancel in Outlook updates here within a few minutes, even when the portal isn’t open. Tasks also appear in Microsoft To Do under a “Coastfields CRM” list.</p>
          ${o.lastError ? `<div class="callout warn"><b>Last sync problem:</b> ${esc(o.lastError)}</div>` : ''}
          ${o.errors ? `<div class="callout warn">${o.errors} appointment(s) could not be sent to Outlook. <button class="btn small" data-retry>Try again</button></div>` : ''}
          ${o.connected ? `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-sync>Sync now</button><button class="btn danger" data-disconnect>Disconnect</button></div>
            <label class="check"><input type="checkbox" data-todo ${s.todoMirror ? 'checked' : ''}> Copy tasks to Microsoft To Do</label>`
          : o.managed ? `<p style="margin:0">Your organisation’s Outlook connection is set up. Click below and sign in with the Microsoft account whose calendar you use for viewings.</p>
            <div><a class="btn primary" href="/api/auth/start">Connect Outlook</a></div>`
          : hosted ? `<div class="callout warn">The Outlook connection details aren’t set yet. Add GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET and GRAPH_TENANT_ID in Netlify (see the setup guide), redeploy, then reload this page.</div>`
          : `<details ${o.configured ? '' : 'open'}><summary style="cursor:pointer;font-weight:700">One-time setup (about 5 minutes, needs a Microsoft 365 admin)</summary>
              <div class="callout" style="margin-top:10px"><ol>
                <li>Go to <b>entra.microsoft.com</b> → Applications → <b>App registrations</b> → <b>New registration</b>.</li>
                <li>Name it <b>Coastfields Customer Portal</b>, choose <b>Accounts in this organisational directory only</b>.</li>
                <li>Under Redirect URI choose platform <b>Public client/native (mobile &amp; desktop)</b> and enter <code>${esc(o.redirectUri)}</code>. Register.</li>
                <li>Open <b>API permissions</b> → Add → Microsoft Graph → <b>Delegated</b>: <code>Calendars.ReadWrite</code>, <code>Tasks.ReadWrite</code>, <code>User.Read</code>, <code>offline_access</code>. Click <b>Grant admin consent</b>.</li>
                <li>Copy the <b>Application (client) ID</b> and <b>Directory (tenant) ID</b> from the Overview page into the boxes below.</li>
              </ol></div></details>
            <div class="grid2">
              <label class="field">Application (client) ID<input data-k="clientId" value="${esc(s.outlook.clientId)}" placeholder="00000000-0000-0000-0000-000000000000"></label>
              <label class="field">Directory (tenant) ID<input data-k="tenant" value="${esc(s.outlook.tenant === 'organizations' ? '' : s.outlook.tenant)}" placeholder="Leave blank to use your work account"></label>
            </div>
            <div style="display:flex;gap:8px"><button class="btn" data-saveoutlook>Save</button><button class="btn primary" data-connect ${s.outlook.clientId ? '' : 'disabled'}>Connect Outlook</button></div>`}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Opening hours and diary</h2></div>
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
        <div class="panel-head"><h2>Task rollover</h2></div>
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
        <div class="panel-head"><h2>Import, export and backup</h2></div>
        <div class="panel-body" style="display:flex;flex-direction:column;gap:14px">
          <div data-import></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn" href="/api/export/contacts.csv" download>Export contacts (CSV)</a><a class="btn" href="/api/backup" download>Download a backup</a></div>
          <p class="faint small" style="margin:0">${hosted ? 'Your data is kept in this site’s private Netlify Blobs storage, with a dated copy saved each day for 60 days. Download a backup now and then and keep it somewhere safe, such as SharePoint or OneDrive.' : `Your data lives in <code>${esc(dataDir)}</code>. Each backup is also kept in its <code>backups</code> folder.`}</p>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Recent activity</h2></div>
        ${jobs.length ? `<ul class="mini-list">${jobs.slice(0, 12).map(j => `<li><span>${esc(j.job)} <span class="faint small">${esc(summarise(j))}</span></span><span class="faint small nowrap">${esc(fmtDate(j.at))} ${esc(j.at.slice(11, 16))}</span></li>`).join('')}</ul>` : '<div class="empty small">Nothing yet.</div>'}
      </section>
    </div>`;

  /* ---- Outlook ---- */
  el.querySelector('[data-k=clientId]')?.addEventListener('input', e => { el.querySelector('[data-connect]').disabled = !/^[0-9a-f-]{36}$/i.test(e.target.value.trim()); });
  el.querySelector('[data-saveoutlook]')?.addEventListener('click', async () => { await saveOutlook(el, s); toast('Saved'); render(el); });
  el.querySelector('[data-connect]')?.addEventListener('click', async () => { await saveOutlook(el, s); location.href = '/api/auth/start'; });
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

  /* ---- Import ---- */
  importZone(el.querySelector('[data-import]'));
  void state;
}

async function saveOutlook(el, s) {
  const clientId = el.querySelector('[data-k=clientId]').value.trim();
  const tenant = el.querySelector('[data-k=tenant]').value.trim() || 'organizations';
  await api('PUT', '/api/settings', { outlook: { ...s.outlook, clientId, tenant } });
  await loadMeta();
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
