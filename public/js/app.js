import { state, get, post, loadMeta, esc, popMenu, fullName, bus, toast, isPhone, closeOverlays, isMgr, isGroupMgr, me } from './core.js';
import { taskDialog, bookDialog, noteDialog, contactDialog } from './dialogs.js';
import * as today from './views/today.js';
import * as contacts from './views/contacts.js';
import * as contact from './views/contact.js';
import * as diary from './views/diary.js';
import * as funnel from './views/funnel.js';
import * as settings from './views/settings.js';
import * as duplicates from './views/duplicates.js';
import * as captain from './views/captain.js';

const view = document.getElementById('view');
let current = null;

// Everyone lands on Today; managers and admins also have the Overview.
const ROUTES = [
  [/^\/?$/, today, 'today'],
  [/^\/today$/, today, 'today'],
  [/^\/log$/, captain, 'log'],
  [/^\/contacts\/duplicates$/, duplicates, 'contacts'],
  [/^\/contacts\/(\d+)$/, contact, 'contacts'],
  [/^\/contacts$/, contacts, 'contacts'],
  [/^\/diary$/, diary, 'diary'],
  [/^\/(funnel|pipeline)$/, funnel, 'funnel'],
  [/^\/settings$/, settings, 'settings']
];

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

async function render({ keepScroll = false } = {}) {
  const { path, query } = parseHash();
  let r = ROUTES.find(([re]) => re.test(path)) || ROUTES[0];
  const match = path.match(r[0]);
  const key = r[2];
  const navKey = isPhone() && (key === 'settings' || key === 'log') ? 'more' : key;
  r = [r[0], r[1], key];
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === navKey || (a.dataset.nav === r[2] && !isPhone())));
  document.body.dataset.route = r[2];
  const same = current && current.mod === r[1] && current.path === path;
  const y = window.scrollY;
  current = { mod: r[1], path };
  try {
    await r[1].render(view, { params: match.slice(1), query, refresh: same });
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty"><strong>This page could not load</strong>${esc(e.message)}</div>`;
  }
  if (keepScroll || same) window.scrollTo(0, y); else window.scrollTo(0, 0);
  updateRail();
}

async function updateRail() {
  try {
    const st = await get('/api/google/status');
    state.meta.google = st;
    const foot = document.getElementById('rail-foot');
    const cls = !st.connected ? '' : st.lastError || st.errors ? 'warn' : 'ok';
    const label = !st.connected ? 'Gmail not connected' : st.lastError ? 'Google sync problem' : st.errors ? `${st.errors} not in Google Calendar` : 'Gmail and Calendar connected';
    const u = state.meta.user;
    const who = u ? `<div style="margin-top:10px;line-height:1.4"><span class="faint">${esc(u.name || u.email)}</span><br><span class="faint small">${esc(u.roleLabel)}</span><br><a href="/auth/logout">Sign out</a></div>` : '';
    foot.innerHTML = `<a class="sync-pill" href="#/settings"><span class="dot ${cls}"></span>${esc(label)}</a>${who}`;
  } catch { /* offline */ }
}

// Shows the Overview to managers and admins.
function applyRole() {
  document.body.classList.toggle('is-mgr', isMgr());
  document.body.classList.toggle('is-group', isGroupMgr());
}

/* -------------------------------------------------------- global search */

const q = document.getElementById('q'), results = document.getElementById('q-results');
if (window.matchMedia('(max-width: 760px)').matches) q.placeholder = 'Search leads and parks';
let qTimer, qItems = [], qSel = -1;
function showResults() {
  if (!qItems.length) {
    results.innerHTML = q.value.trim().length >= 2 ? `<div class="empty small">No matches. <a href="#" data-newc>Add “${esc(q.value.trim())}” as a lead</a></div>` : '';
  } else {
    results.innerHTML = qItems.map((it, i) => `<a href="${it.href}" class="${i === qSel ? 'sel' : ''}" role="option"><span><b>${esc(it.label)}</b></span><span class="faint small">${esc(it.sub)}</span></a>`).join('');
  }
  results.classList.toggle('hidden', !results.innerHTML);
  results.querySelector('[data-newc]')?.addEventListener('click', e => {
    e.preventDefault(); const [first, ...rest] = q.value.trim().split(/\s+/);
    hideResults(); q.value = '';
    contactDialog(null, { prefill: { first_name: first, last_name: rest.join(' ') }, onSaved: c => { location.hash = `#/contacts/${c.id}`; } });
  });
}
function hideResults() { results.classList.add('hidden'); }
q.addEventListener('input', () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(async () => {
    const term = q.value.trim();
    if (term.length < 2) { qItems = []; showResults(); return; }
    const r = await get('/api/search?q=' + encodeURIComponent(term));
    qItems = r.contacts.map(c => ({ href: `#/contacts/${c.id}`, label: c.first_name || c.last_name ? fullName(c) : (c.company || 'Unnamed lead'),
      sub: [c.first_name || c.last_name ? c.company : null, c.mobile || c.email || c.lead_no].filter(Boolean).join(' · ') || c.type }));
    qSel = qItems.length ? 0 : -1;
    showResults();
  }, 140);
});
q.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); qSel = Math.min(qItems.length - 1, qSel + 1); showResults(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); qSel = Math.max(0, qSel - 1); showResults(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (qItems[qSel]) { location.hash = qItems[qSel].href; q.value = ''; hideResults(); q.blur(); }
    else if (q.value.trim()) { location.hash = '#/contacts?q=' + encodeURIComponent(q.value.trim()); hideResults(); }
  } else if (e.key === 'Escape') { hideResults(); q.blur(); }
});
q.addEventListener('blur', () => setTimeout(hideResults, 180));
results.addEventListener('click', e => { if (e.target.closest('a[href^="#/"]')) { q.value = ''; hideResults(); } });

/* ------------------------------------------------------------ + New menu */

function contactFromRoute() {
  const m = parseHash().path.match(/^\/contacts\/(\d+)$/);
  return m && contact.currentContact && String(contact.currentContact.id) === m[1] ? contact.currentContact : null;
}
function openNew(anchor) {
  const c = contactFromRoute();
  popMenu(anchor, [
    { label: 'Note', icon: 'note', kbd: 'N', run: () => noteDialog(c) },
    { label: 'Task', icon: 'task', kbd: 'T', run: () => taskDialog({ contact: c }) },
    { label: 'Appointment', icon: 'cal', kbd: 'A', run: () => bookDialog({ contact: c }) },
    { label: 'Lead', icon: 'user', kbd: 'C', run: () => contactDialog(null, { onSaved: s => { location.hash = `#/contacts/${s.id}`; } }) }
  ], { title: c ? `New for ${fullName(c)}` : 'Add new' });
}
document.getElementById('new-btn').addEventListener('click', e => openNew(e.currentTarget));
document.getElementById('fab').addEventListener('click', e => openNew(e.currentTarget));

// Phones: "More" holds the pages that don't fit in the bottom bar.
document.getElementById('more-btn').addEventListener('click', e => {
  popMenu(e.currentTarget, [
    ...(isMgr() ? [{ label: 'Overview', icon: 'deal', run: () => { location.hash = '#/log'; } }] : []),
    { label: 'Settings', icon: 'edit', run: () => { location.hash = '#/settings'; } },
    ...(isMgr() ? [
      { label: 'Team', icon: 'user', run: () => { location.hash = '#/settings?section=team'; } },
      { label: 'Possible duplicates', icon: 'user', run: () => { location.hash = '#/contacts/duplicates'; } },
      { label: 'Export leads (CSV)', icon: 'note', run: () => { location.href = '/api/export/contacts.csv'; } }] : []),
    '-',
    { label: 'Sign out', icon: 'x', danger: true, run: () => { location.href = '/auth/logout'; } }
  ], { title: me().email ? `${me().name || me().email} · ${me().roleLabel}` : 'More' });
});

// Keyboard shortcuts when not typing: / search, N note, T task, A appointment, C contact.
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable || document.querySelector('.backdrop')) return;
  const c = contactFromRoute();
  const k = e.key.toLowerCase();
  if (k === '/') { e.preventDefault(); q.focus(); }
  else if (k === 'n') { e.preventDefault(); noteDialog(c); }
  else if (k === 't') { e.preventDefault(); taskDialog({ contact: c }); }
  else if (k === 'a') { e.preventDefault(); bookDialog({ contact: c }); }
  else if (k === 'c') { e.preventDefault(); contactDialog(null, { onSaved: s => { location.hash = `#/contacts/${s.id}`; } }); }
});

window.addEventListener('scroll', () => document.getElementById('topbar').classList.toggle('scrolled', window.scrollY > 4), { passive: true });
window.addEventListener('hashchange', () => { closeOverlays(); render(); });
bus.addEventListener('changed', () => render({ keepScroll: true }));

// Installed as an app there's no browser refresh button, so refresh whenever the app comes back to the front.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 30e3 && !document.querySelector('.backdrop')) render({ keepScroll: true });
});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

// Every two minutes: check Gmail for new leads (when it's due) and refresh the view (also picks up the nightly rollover).
setInterval(async () => {
  if (document.visibilityState !== 'visible') return;
  let fresh = false;
  try { fresh = (await post('/api/ping')).changed; } catch { /* offline */ }
  if (fresh) toast('New email in from Gmail', { action: 'See leads', onAction: () => { location.hash = '#/contacts'; } });
  if (!document.querySelector('.backdrop')) render({ keepScroll: true });
}, 120e3);

(async () => {
  try { await loadMeta(); applyRole(); }
  catch (e) {
    if (e.status === 403) return; // the no-access message is already showing
    if (e.status === 401) return; // on its way to the Google sign-in page
    view.innerHTML = '<div class="empty"><strong>Cannot reach the CRM</strong>If it has been idle it may be waking up: wait a few seconds and reload this page.</div>'; return;
  }
  render();
})();
