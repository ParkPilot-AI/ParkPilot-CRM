// Shared helpers: API calls, formatting, icons, modals, menus, toasts.

export const state = { meta: null };

export async function api(method, url, body, { raw = false, headers = {} } = {}) {
  const opts = { method, headers: { 'X-ParkPilot': '1', 'X-Requested-With': 'XMLHttpRequest', ...headers }, credentials: 'same-origin' };
  if (body !== undefined) {
    if (raw) opts.body = body;
    else { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  }
  let res;
  try { res = await fetch(url, opts); }
  catch { const e = new Error('The CRM is not responding. Check your internet connection.'); toast(e.message, { error: true }); throw e; }
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 && j.signIn) { location.href = '/auth/login?return=' + encodeURIComponent('/' + location.hash); const e = new Error('Signing you in…'); e.status = 401; e.silent = true; throw e; }
  if (res.status === 403 && j.noAccess) { showNoAccess(j.error); const e = new Error(j.error); e.status = 403; throw e; }
  if (!res.ok) { const e = new Error(j.error || `Request failed (${res.status})`); e.status = res.status; toast(e.message, { error: true }); throw e; }
  return j;
}
export function showNoAccess(message) {
  document.getElementById('view').innerHTML = `<div class="panel empty" style="margin-top:40px"><strong>No access</strong>${esc(message)}<p><a class="btn" href="/auth/login?prompt=select_account">Sign in as someone else</a></p></div>`;
}
export const get = url => api('GET', url);
export const post = (url, body = {}) => api('POST', url, body);
export const patch = (url, body) => api('PATCH', url, body);
export const del = url => api('DELETE', url);

export async function loadMeta() { state.meta = await get('/api/meta'); return state.meta; }

/* ------------------------------------------------------------ formatting */

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MOL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const parts = d => { const [y, m, dd] = d.slice(0, 10).split('-').map(Number); return { y, m, d: dd, wd: new Date(Date.UTC(y, m - 1, dd)).getUTCDay() }; };
export function today() { return state.meta ? state.meta.today : new Date().toISOString().slice(0, 10); }
export function nowLocal() {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = {}; for (const x of f.formatToParts(new Date())) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function addDays(d, n) { const { y, m, d: dd } = parts(d); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); }
export function daysBetween(a, b) { return Math.round((Date.parse(b.slice(0, 10) + 'T00:00:00Z') - Date.parse(a.slice(0, 10) + 'T00:00:00Z')) / 864e5); }
export function addMinutes(dt, n) { const t = Date.parse(dt + ':00Z') + n * 60e3; return new Date(t).toISOString().slice(0, 16); }
export function minutes(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
export function hhmm(min) { return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }

export function fmtDate(d, { long = false, year } = {}) {
  if (!d) return '';
  const p = parts(d);
  const showYear = year ?? p.y !== Number(today().slice(0, 4));
  return long ? `${WDL[p.wd]} ${p.d} ${MOL[p.m - 1]}${showYear ? ' ' + p.y : ''}` : `${WD[p.wd]} ${p.d} ${MO[p.m - 1]}${showYear ? ' ' + p.y : ''}`;
}
export function fmtDay(d) {
  if (!d) return '';
  const diff = daysBetween(today(), d);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return fmtDate(d);
}
export const fmtTime = dt => dt ? dt.slice(11, 16) : '';
export const fmtWhen = dt => dt ? `${fmtDay(dt)}, ${fmtTime(dt)}` : '';
export function fmtAgo(dt) {
  if (!dt) return 'never';
  const n = daysBetween(dt, today());
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 14) return `${n} days ago`;
  if (n < 60) return `${Math.round(n / 7)} weeks ago`;
  if (n < 730) return `${Math.round(n / 30.4)} months ago`;
  return `${Math.round(n / 365)} years ago`;
}
export const money = v => (v === null || v === undefined || v === '') ? '' : '£' + Number(v).toLocaleString('en-GB', { maximumFractionDigits: 0 });
export const fullName = o => `${o.first_name || ''} ${o.last_name || ''}`.trim() || o.company || 'Unnamed lead';
export const initials = o => ((o.first_name || o.company || '?')[0] + ((o.last_name || '')[0] || '')).toUpperCase();
export const typeClass = t => 'ty-' + String(t || '').replace(/[^A-Za-z]+/g, '-');
export const plans = product => ((state.meta && state.meta.plans) || {})[product] || [];
export const telHref = c => c.phone_e164 || c.mobile ? `tel:${esc(c.phone_e164 || c.mobile)}` : null;
export const plural = (n, w, p = w + 's') => `${n} ${n === 1 ? w : p}`;

/* ---------------------------------------------------------------- icons */

const ICONS = {
  check: '<path d="M5 12l5 5 9-10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  note: '<path d="M4 4h16v12l-4 4H4z"/><path d="M16 20v-4h4"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  task: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l3 3 5-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  deal: '<path d="M3 12l4-4 4 3 4-5 6 6"/><path d="M3 20h18"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14-5L4 8M4 4v4h4M4 13a8 8 0 0 0 14 5l2-2M20 20v-4h-4"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  left: '<path d="M15 18l-6-6 6-6"/>', right: '<path d="M9 18l6-6-6-6"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>'
};
export function icon(name, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* ---------------------------------------------------------------- toast */

export function toast(message, { error = false, action, onAction, ms = 4200 } = {}) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' err' : '');
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.remove(); onAction && onAction(); };
  box.appendChild(el);
  setTimeout(() => el.remove(), error ? 7000 : ms);
}

/* ---------------------------------------------------------------- modal */

const openModals = new Set();
// Closes every open dialog and menu sheet (used when the page changes, e.g. the phone's back gesture).
export function closeOverlays() {
  [...openModals].forEach(c => c());
  document.querySelectorAll('.menu, .sheet-backdrop').forEach(m => m.remove());
}

export function modal({ title, body, foot, wide = false, onMount, onClose }) {
  const back = document.createElement('div');
  back.className = 'backdrop';
  back.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="btn ghost icon" data-close aria-label="Close">${icon('x')}</button></div>
    <form class="modal-form" novalidate><div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</form></div>`;
  const prevFocus = document.activeElement;
  const close = () => { if (!openModals.delete(close)) return; back.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); prevFocus && prevFocus.focus && prevFocus.focus(); };
  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.picker .opts:not(.hidden)')) close(); };
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  back.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); close(); }));
  document.addEventListener('keydown', onKey);
  openModals.add(close);
  document.body.appendChild(back);
  const root = back.querySelector('.modal');
  const form = back.querySelector('form');
  onMount && onMount(root, close, form);
  const first = root.querySelector('[autofocus]') || root.querySelector('.modal-body input, .modal-body select, .modal-body textarea, .modal-body button');
  first && first.focus();
  return { root, close, form };
}

export function confirmBox(title, message, { ok = 'Confirm', danger = false } = {}) {
  return new Promise(resolve => {
    let answered = false;
    modal({
      title, body: `<p style="margin:0">${message}</p>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger solid' : 'primary'}" type="submit">${esc(ok)}</button>`,
      onMount: (root, close, form) => form.addEventListener('submit', e => { e.preventDefault(); answered = true; close(); resolve(true); }),
      onClose: () => { if (!answered) resolve(false); }
    });
  });
}

export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value === '' ? null : (el.dataset.num !== undefined ? Number(el.value) : el.value);
  }
  return out;
}

/* ----------------------------------------------------------------- menu */

export const isPhone = () => window.matchMedia('(max-width: 760px)').matches;

// A small menu next to its button on desktop; a sheet that slides up from the bottom on phones.
export function popMenu(anchor, items, { title } = {}) {
  document.querySelectorAll('.menu, .sheet-backdrop').forEach(m => m.remove());
  const sheet = isPhone();
  const m = document.createElement('div');
  m.className = 'menu' + (sheet ? ' sheet' : '');
  m.setAttribute('role', 'menu');
  m.innerHTML = (sheet && title ? `<div class="sheet-title">${esc(title)}</div>` : '') + items.map((it, i) => it === '-' ? '<hr style="border:0;border-top:1px solid var(--line-soft);margin:4px 0">' :
    `<button type="button" role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon ? icon(it.icon) : ''}${esc(it.label)}${it.kbd && !sheet ? `<kbd>${esc(it.kbd)}</kbd>` : ''}</button>`).join('')
    + (sheet ? '<button type="button" class="sheet-cancel" data-cancel>Cancel</button>' : '');
  let back = null;
  if (sheet) { back = document.createElement('div'); back.className = 'sheet-backdrop'; document.body.appendChild(back); }
  document.body.appendChild(m);
  if (!sheet) {
    const r = anchor.getBoundingClientRect();
    const w = m.offsetWidth;
    m.style.top = `${r.bottom + window.scrollY + 6}px`;
    m.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + window.scrollX}px`;
  }
  const close = () => { m.remove(); back && back.remove(); document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', key); };
  const outside = e => { if (!m.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); };
  const key = e => {
    if (e.key === 'Escape') { close(); anchor.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const bs = [...m.querySelectorAll('button[data-i]')]; const i = bs.indexOf(document.activeElement);
      bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus();
    }
  };
  m.addEventListener('click', e => {
    if (e.target.closest('[data-cancel]')) { close(); return; }
    const b = e.target.closest('button[data-i]'); if (b) { close(); items[+b.dataset.i].run(); }
  });
  back && back.addEventListener('click', close);
  setTimeout(() => { document.addEventListener('mousedown', outside); document.addEventListener('keydown', key); }, 0);
  if (!sheet) m.querySelector('button').focus();
}

/* -------------------------------------------------------- contact picker */

// Renders an autocomplete into `holder`; calls onPick({id, name}) and keeps a hidden input `name`.
export function contactPicker(holder, { name = 'contact_id', value = null, label = '', onPick, allowNew = true } = {}) {
  const render = () => {
    if (holder.dataset.id) {
      holder.innerHTML = `<input type="hidden" name="${name}" value="${esc(holder.dataset.id)}"><div class="picked"><span>${esc(holder.dataset.label)}</span><button type="button" class="btn ghost small" data-clear>Change</button></div>`;
      holder.querySelector('[data-clear]').onclick = () => { delete holder.dataset.id; render(); holder.querySelector('input').focus(); onPick && onPick(null); };
      return;
    }
    holder.innerHTML = `<div class="picker"><input class="input" type="text" placeholder="Type a name, park, phone or email" autocomplete="off" aria-label="Lead"><div class="opts hidden"></div></div>`;
    const input = holder.querySelector('input'), opts = holder.querySelector('.opts');
    let timer, results = [], sel = -1;
    const show = () => {
      opts.innerHTML = results.map((c, i) => `<button type="button" data-i="${i}" class="${i === sel ? 'sel' : ''}"><b>${esc(fullName(c))}</b> <span class="faint small">${esc([c.first_name || c.last_name ? c.company : null, c.mobile || c.email || c.lead_no].filter(Boolean).join(' · '))}</span></button>`).join('')
        + (allowNew && input.value.trim().length > 1 ? `<button type="button" data-new><b>+ New lead</b> <span class="faint small">"${esc(input.value.trim())}"</span></button>` : '');
      opts.classList.toggle('hidden', !opts.innerHTML);
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = input.value.trim();
        results = q.length >= 2 ? (await get('/api/search?q=' + encodeURIComponent(q))).contacts : [];
        sel = results.length ? 0 : -1; show();
      }, 160);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); show(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); show(); }
      else if (e.key === 'Enter' && sel >= 0 && !opts.classList.contains('hidden')) { e.preventDefault(); pick(results[sel]); }
      else if (e.key === 'Escape') { opts.classList.add('hidden'); }
    });
    opts.addEventListener('mousedown', e => e.preventDefault());
    opts.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.new !== undefined) {
        const [first, ...rest] = input.value.trim().split(/\s+/);
        const c = await post('/api/contacts', { first_name: first, last_name: rest.join(' '), lead_source: 'Phone' });
        toast(`Created ${fullName(c)}`);
        pick(c);
      } else pick(results[+b.dataset.i]);
    });
    input.addEventListener('blur', () => setTimeout(() => opts.classList.add('hidden'), 150));
  };
  const pick = c => { holder.dataset.id = c.id; holder.dataset.label = fullName(c); render(); onPick && onPick(c); };
  if (value) { holder.dataset.id = value; holder.dataset.label = label || 'Selected contact'; }
  render();
}

export function options(list, selected, { blank } = {}) {
  return (blank !== undefined ? `<option value="">${esc(blank)}</option>` : '') +
    list.map(v => { const val = typeof v === 'object' ? v.value : v, lab = typeof v === 'object' ? v.label : v; return `<option value="${esc(val)}"${String(val) === String(selected ?? '') ? ' selected' : ''}>${esc(lab)}</option>`; }).join('');
}

export const bus = new EventTarget(); // 'changed' => views refresh
export function changed() { bus.dispatchEvent(new Event('changed')); }

/* ------------------------------------------------------ people and roles */

export const me = () => (state.meta && state.meta.user) || {};
export const isMgr = () => !!me().isManager;
export const isGroupMgr = () => !!me().isGroup;
export const team = () => (state.meta && state.meta.team) || [];
export const personName = id => (team().find(x => x.id === Number(id)) || {}).name || '';
const multiPark = () => new Set(team().map(x => x.park_id)).size > 1;

// <option>s for choosing a team member (grouped by park for group managers), optionally with "Unallocated".
export function teamOptions(selected, { unallocated = false, unallocatedLabel = 'Unallocated' } = {}) {
  const opt = x => `<option value="${x.id}"${String(x.id) === String(selected ?? '') ? ' selected' : ''}>${esc(x.name)}${x.id === me().id ? ' (you)' : ''}</option>`;
  let html = unallocated ? `<option value=""${!selected ? ' selected' : ''}>${esc(unallocatedLabel)}</option>` : '';
  if (multiPark()) {
    const groups = new Map();
    for (const x of team()) { const k = x.park_name || 'All parks'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
    html += [...groups].map(([k, xs]) => `<optgroup label="${esc(k)}">${xs.map(opt).join('')}</optgroup>`).join('');
  } else html += team().map(opt).join('');
  return html;
}
export function parkOptions(selected, { blank } = {}) {
  return options(((state.meta && state.meta.parks) || []).map(p => ({ value: p.id, label: p.name })), selected, blank !== undefined ? { blank } : {});
}
