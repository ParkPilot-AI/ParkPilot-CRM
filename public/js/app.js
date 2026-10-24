import { state, get, loadMeta, esc, popMenu, fullName, bus, toast } from './core.js';
import { taskDialog, bookDialog, noteDialog, contactDialog } from './dialogs.js';
import * as today from './views/today.js';
import * as contacts from './views/contacts.js';
import * as contact from './views/contact.js';
import * as diary from './views/diary.js';
import * as pipeline from './views/pipeline.js';
import * as stock from './views/stock.js';
import * as settings from './views/settings.js';
import * as duplicates from './views/duplicates.js';

const view = document.getElementById('view');
let current = null;

const ROUTES = [
  [/^\/?$/, today, 'today'],
  [/^\/contacts\/duplicates$/, duplicates, 'contacts'],
  [/^\/contacts\/(\d+)$/, contact, 'contacts'],
  [/^\/contacts$/, contacts, 'contacts'],
  [/^\/diary$/, diary, 'diary'],
  [/^\/pipeline$/, pipeline, 'pipeline'],
  [/^\/stock$/, stock, 'stock'],
  [/^\/settings$/, settings, 'settings']
];

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

async function render({ keepScroll = false } = {}) {
  const { path, query } = parseHash();
  const r = ROUTES.find(([re]) => re.test(path)) || ROUTES[0];
  const match = path.match(r[0]);
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === r[2]));
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
    const st = await get('/api/outlook/status');
    state.meta.outlook = st;
    const foot = document.getElementById('rail-foot');
    const cls = !st.connected ? '' : st.lastError || st.errors ? 'warn' : 'ok';
    const label = !st.connected ? 'Outlook not connected' : st.lastError ? 'Outlook sync problem' : st.errors ? `${st.errors} not sent to Outlook` : 'Outlook connected';
    const who = state.meta.hosted && state.meta.user ? `<div style="margin-top:10px;line-height:1.4"><span class="faint">${esc(state.meta.user.name || state.meta.user.email)}</span><br><a href="/auth/logout">Sign out</a></div>` : '';
    foot.innerHTML = `<a class="sync-pill" href="#/settings"><span class="dot ${cls}"></span>${esc(label)}</a>${who}`;
  } catch { /* offline */ }
}

/* -------------------------------------------------------- global search */

const q = document.getElementById('q'), results = document.getElementById('q-results');
if (window.matchMedia('(max-width: 760px)').matches) q.placeholder = 'Search contacts';
let qTimer, qItems = [], qSel = -1;
function showResults() {
  if (!qItems.length) {
    results.innerHTML = q.value.trim().length >= 2 ? `<div class="empty small">No matches. <a href="#" data-newc>Add “${esc(q.value.trim())}” as a contact</a></div>` : '';
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
    qItems = [
      ...r.contacts.map(c => ({ href: `#/contacts/${c.id}`, label: fullName(c), sub: [c.mobile, c.email, c.lead_no].filter(Boolean)[0] || c.type })),
      ...r.plots.map(p => ({ href: '#/stock?tab=plots', label: `Plot ${p.plot_number}`, sub: p.area || p.status }))
    ];
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
    { label: 'Contact', icon: 'user', kbd: 'C', run: () => contactDialog(null, { onSaved: s => { location.hash = `#/contacts/${s.id}`; } }) }
  ]);
}
document.getElementById('new-btn').addEventListener('click', e => openNew(e.currentTarget));

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
window.addEventListener('hashchange', () => render());
bus.addEventListener('changed', () => render({ keepScroll: true }));

// Refresh the current view every two minutes (picks up Outlook changes and the nightly rollover).
setInterval(() => { if (!document.querySelector('.backdrop') && document.visibilityState === 'visible') render({ keepScroll: true }); }, 120e3);

(async () => {
  try { await loadMeta(); }
  catch (e) {
    if (e.status === 403) return; // the no-access message is already showing
    if (e.status === 401) return; // on its way to the Microsoft sign-in page
    view.innerHTML = '<div class="empty"><strong>Cannot reach the portal</strong>If it has been idle it may be waking up: wait a few seconds and reload this page.</div>'; return;
  }
  render();
  if (new URLSearchParams(location.search).get('connected')) toast('Outlook connected');
})();
