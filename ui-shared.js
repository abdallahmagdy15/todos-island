'use strict';
// window.UI — helpers + small components shared by every window (one copy, no drift).
(() => {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bangCls = p => ({ '!!!': 'p3', '!!': 'p2', '!': 'p1' }[p] || 'p0');
  const dueOf = dt => ({ d: dt.getDate(), m: MONTHS[dt.getMonth()] });
  const dueText = d => (d ? `${d.d} ${d.m}` : null);
  const parseDueText = s => {
    const m = String(s || '').match(/^(\d{1,2})\s+([A-Za-z]{3})/);
    return m ? { d: +m[1], m: m[2][0].toUpperCase() + m[2].slice(1).toLowerCase() } : null;
  };
  const sameDue = (a, b) => !!a && !!b && a.d === b.d && a.m === b.m;
  const iso = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const dayOffset = n => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); };

  // Priority chips — each chip wears its own bang hue (never the accent). onPick(p) fires on user clicks only.
  function prioChips(el, { onPick } = {}) {
    let value = null;
    el.setAttribute('role', 'radiogroup');
    el.innerHTML = [['', 'No priority'], ['!', 'Low'], ['!!', 'Medium'], ['!!!', 'High']].map(([p, name]) =>
      `<button class="chip pchip ${bangCls(p)}" data-p="${p}" type="button" role="radio" aria-label="${name} priority" title="${name}">${p || '—'}</button>`).join('');
    const paint = () => el.querySelectorAll('.pchip').forEach(c => {
      const on = (c.dataset.p || null) === value;
      c.classList.toggle('sel', on); c.setAttribute('aria-checked', on);
    });
    el.addEventListener('click', e => {
      const c = e.target.closest('.pchip');
      if (!c) return;
      value = c.dataset.p || null; paint();
      if (onPick) onPick(value);
    });
    paint();
    return { get value() { return value; }, set(p) { value = p || null; paint(); } };
  }

  // Due control — one route: No date / Today / Tomorrow / Pick… (native calendar, so "31 Feb" can't happen).
  function dueControl(el, { onPick } = {}) {
    let value = null;
    el.setAttribute('role', 'radiogroup');
    el.innerHTML = `
      <button class="chip dchip" data-due="none" type="button" role="radio">No date</button>
      <button class="chip dchip" data-due="today" type="button" role="radio">Today</button>
      <button class="chip dchip" data-due="tomorrow" type="button" role="radio">Tomorrow</button>
      <span class="pick-wrap">
        <button class="chip dchip dpick" data-due="pick" type="button" role="radio" aria-label="Pick a date">Pick…</button>
        <input class="date-proxy" type="date" tabindex="-1" aria-hidden="true">
      </span>`;
    const proxy = el.querySelector('.date-proxy');
    const kindOf = v => (!v ? 'none' : sameDue(v, dueOf(dayOffset(0))) ? 'today' : sameDue(v, dueOf(dayOffset(1))) ? 'tomorrow' : 'pick');
    const paint = () => {
      const k = kindOf(value);
      el.querySelectorAll('.dchip').forEach(c => { const on = c.dataset.due === k; c.classList.toggle('sel', on); c.setAttribute('aria-checked', on); });
      const pick = el.querySelector('.dpick');
      pick.textContent = k === 'pick' ? dueText(value) : 'Pick…';
      pick.classList.toggle('mono', k === 'pick');
    };
    const set = (v, user) => { value = v; paint(); if (user && onPick) onPick(value); };
    el.addEventListener('click', e => {
      const c = e.target.closest('.dchip');
      if (!c) return;
      const k = c.dataset.due;
      if (k === 'none') return set(null, true);
      if (k === 'today') return set(dueOf(dayOffset(0)), true);
      if (k === 'tomorrow') return set(dueOf(dayOffset(1)), true);
      proxy.min = iso(dayOffset(-45)); // the note infers the year: >45 days back would read as next year
      if (value) { const mi = MONTHS.indexOf(value.m); if (mi >= 0) proxy.value = iso(new Date(new Date().getFullYear(), mi, value.d)); }
      try { proxy.showPicker(); } catch (err) { proxy.focus(); proxy.click(); }
    });
    proxy.addEventListener('change', () => {
      if (!proxy.value) return;
      const [y, m, d] = proxy.value.split('-').map(Number);
      set(dueOf(new Date(y, m - 1, d)), true);
    });
    paint();
    return { get value() { return value; }, set: v => set(v || null, false) };
  }

  // one vocabulary everywhere: the * state is "Now" (★); clearing it is "Not now"; children are "subtasks"
  const undoVerb = u => u.kind === 'delete' ? 'Deleted'
    : u.kind === 'toggle' ? (u.starring ? 'Marked Now' : 'Cleared Now')
    : u.kind === 'reorder' ? 'Moved'
    : u.kind === 'clear' ? 'Cleared'
    : 'Completed';
  const undoText = u => `${undoVerb(u)}: ${u.label}`;

  window.UI = { MONTHS, esc, bangCls, dueText, parseDueText, prioChips, dueControl, undoText };
})();
