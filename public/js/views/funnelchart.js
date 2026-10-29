import { get, esc, money, plural } from '../core.js';

// Band colours run from sand (early stages) through navy, with Forest Green for won deals.
// Text colour is chosen per band for contrast.
const BANDS = {
  'Enquiry': ['#E6D9BF', 'var(--ink)'],
  'Demo booked': ['#D9C7A3', 'var(--ink)'],
  'Demo held': ['#3E4A5C', '#fff'],
  'Proposal sent': ['#0E1A2B', '#fff'],
  'Won': ['#2D7A4F', '#fff']
};
const PERIODS = [['30', '30 days'], ['90', '90 days'], ['365', '1 year'], ['all', 'All time']];
// Band widths use a square-root scale above a minimum, so the funnel keeps its shape (each stage
// narrower than the one above) even when early stages are far larger; the printed numbers are exact.
const MIN_WIDTH = 24; // %

function periodLabel(p) { return p === 'all' ? 'in total' : p === '365' ? 'in the last 12 months' : `in the last ${p} days`; }

export function funnelHtml(f) {
  const top = Math.max(1, f.stages[0].reached);
  const widths = f.stages.map(s => Math.round(MIN_WIDTH + (100 - MIN_WIDTH) * Math.sqrt(s.reached / top)));
  const completed = f.stages[f.stages.length - 1];
  const rows = f.stages.map((s, i) => {
    const w = widths[i], next = i < widths.length - 1 ? widths[i + 1] : w * 0.72;
    const inset = Math.max(0, ((1 - next / w) / 2) * 100).toFixed(1);
    const [bg, fg] = BANDS[s.stage] || ['#0E1A2B', '#fff'];
    const link = `#/contacts?stage=${encodeURIComponent(s.stage)}`;
    return `<a class="f-row" href="${link}" aria-label="${esc(s.stage)}: ${s.reached} reached, ${s.now} ${i === 0 ? 'with no demo yet' : 'here now'}">
      <div class="f-track"><div class="f-band" style="width:${w}%;--inset:${inset}%;background:${bg};color:${fg}"><span class="f-name">${esc(s.stage)}</span><b>${s.reached.toLocaleString('en-GB')}</b></div></div>
      <div class="f-side"><span class="f-mname">${esc(s.stage)}</span>${i === 0 ? `<b>${s.reached.toLocaleString('en-GB')}</b> ${s.reached === 1 ? 'enquiry' : 'enquiries'}` : `<b>${s.conversion}%</b> of the stage above`}
        <span>${s.stage === 'Won' ? `${s.now} won` : i === 0 ? `${s.now.toLocaleString('en-GB')} no demo yet` : `${s.now} here now`}${s.value ? ` · ${money(s.value)}/month` : ''}</span></div>
    </a>`;
  }).join('');
  const rate = f.stages[0].reached ? Math.round(100 * completed.reached / f.stages[0].reached) : 0;
  const lost = f.lost ? `${plural(f.lost, 'deal')} lost${f.topLost.length ? ': ' + f.topLost.map(l => `${esc(l.reason)} (${l.n})`).join(', ') : ''}` : 'No deals lost';
  return `<div class="funnel">${rows}</div>
    <div class="f-foot"><span><b>${rate < 1 && completed.reached ? '<1' : rate}%</b> of enquiries ${periodLabel(f.period)} were won</span><span>${lost}</span></div>`;
}

// Renders the funnel panel body into `holder` with a period switch; remembers the chosen period.
// `extra` is added to the request when the period changes (e.g. 'mine=1' or 'owner=5').
export function mountFunnel(holder, data, extra = '', { periodSwitch = true } = {}) {
  const draw = f => {
    holder.innerHTML = `<div class="f-head"><span class="muted small">${f.total ? `${f.total.toLocaleString('en-GB')} ${f.total === 1 ? 'enquiry' : 'enquiries'} ${periodLabel(f.period)}` : `No enquiries ${periodLabel(f.period)}`}</span>
      ${!periodSwitch ? '' : `<div class="seg" role="group" aria-label="Period">${PERIODS.map(([v, l]) => `<button type="button" data-period="${v}" class="${f.period === v ? 'on' : ''}">${l}</button>`).join('')}</div>`}</div>
      ${f.total ? funnelHtml(f) : '<div class="empty small">The funnel fills in as enquiries come in.</div>'}`;
    holder.querySelectorAll('[data-period]').forEach(b => b.addEventListener('click', async () => draw(await get(`/api/funnel?period=${b.dataset.period}&remember=1${extra ? '&' + extra : ''}`))));
  };
  draw(data);
  // Narrow holders can't fit stage names inside the bands.
  holder.classList.add('funnel-holder');
  const fit = () => holder.classList.toggle('compact', holder.clientWidth < 720);
  fit();
  if (window.ResizeObserver) new ResizeObserver(fit).observe(holder);
}
