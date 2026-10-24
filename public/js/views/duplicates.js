import { get, post, esc, fullName, fmtDate, toast } from '../core.js';

export async function render(el) {
  const groups = await get('/api/duplicates');
  el.innerHTML = `
    <div style="margin-top:8px"><a href="#/contacts" class="small">‹ All contacts</a></div>
    <div class="today-head"><h1>Possible duplicates</h1><span class="muted">${groups.length} groups share an email address or phone number</span></div>
    <p class="muted" style="margin:-8px 0 16px">Pick the record to keep; notes, deals, tasks and appointments from the others move onto it and any blank details are filled in.</p>
    ${groups.length ? groups.map(g => `<section class="panel" style="margin-bottom:14px" data-group="${esc(g.group)}">
      <div class="dup-cards">${g.members.map((c, i) => `<label class="dup-card"><input type="radio" name="keep-m-${esc(g.group)}" value="${c.id}" ${i === 0 ? 'checked' : ''}>
        <span><b>${esc(fullName(c))}</b><span class="m-sub">${esc([c.mobile, c.email].filter(Boolean).join(' · '))}</span>
        <span class="m-sub faint">${esc([c.lead_no, c.lead_source, c.enquiry_date ? fmtDate(c.enquiry_date) : '', c.stage].filter(Boolean).join(' · '))}</span></span></label>`).join('')}
        <p class="faint small" style="margin:6px 2px 0">Choose the record to keep.</p></div>
      <table class="list desk-only" style="border-radius:var(--radius-l)"><thead><tr><th style="width:70px">Keep</th><th>Name</th><th>Mobile</th><th>Email</th><th>Lead</th><th>Source</th><th>Enquired</th><th>Stage</th></tr></thead><tbody>
      ${g.members.map((c, i) => `<tr><td><input type="radio" name="keep-${esc(g.group)}" value="${c.id}" ${i === 0 ? 'checked' : ''} aria-label="Keep ${esc(fullName(c))}"></td>
        <td><a href="#/contacts/${c.id}"><b>${esc(fullName(c))}</b></a></td><td class="nowrap">${esc(c.mobile || '')}</td><td>${esc(c.email || '')}</td>
        <td class="small">${esc(c.lead_no || '')}</td><td class="small">${esc(c.lead_source || '')}</td><td class="small nowrap">${esc(c.enquiry_date ? fmtDate(c.enquiry_date) : '')}</td><td class="small">${esc(c.stage || '')}</td></tr>`).join('')}
      </tbody></table>
      <div style="display:flex;gap:8px;justify-content:flex-end;padding:10px 14px"><button class="btn ghost" data-dismiss>Different people</button><button class="btn primary" data-merge>Merge</button></div>
    </section>`).join('') : '<div class="panel empty"><strong>No duplicates left</strong>Every contact has its own email and phone number.</div>'}`;

  el.querySelectorAll('[data-group]').forEach(sec => {
    const g = groups.find(x => x.group === sec.dataset.group);
    sec.querySelector('[data-merge]').onclick = async () => {
      const radios = [...sec.querySelectorAll('input[type=radio]:checked')].filter(r => r.offsetParent !== null);
      const keep = Number((radios[0] || sec.querySelector('input[type=radio]:checked')).value);
      await post('/api/duplicates/merge', { keep, others: g.members.map(m => m.id).filter(id => id !== keep) });
      sec.remove(); toast('Merged');
    };
    sec.querySelector('[data-dismiss]').onclick = async () => { await post('/api/duplicates/dismiss', { group: g.group }); sec.remove(); toast('Kept as separate contacts'); };
  });
}
