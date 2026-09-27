'use strict';
// window.UI — helpers + small components shared by every window (one copy, no drift).
(() => {
  let LANG = 'en'; // set by each window on snapshot/boot via UI.setLang
  const T = (k, prm) => window.I18N.t(LANG, k, prm);
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bangCls = p => ({ '!!!': 'p3', '!!': 'p2', '!': 'p1' }[p] || 'p0');
  const dueOf = dt => ({ d: dt.getDate(), m: MONTHS[dt.getMonth()] });
  const dueText = d => (d ? `${d.d} ${d.m}` : null);
  const parseDueText = s => {
    const m = String(s || '').match(/^(\d{1,2})\s+([A-Za-z]{3})/);
    return m ? { d: +m[1], m: m[2][0].toUpperCase() + m[2].slice(1).toLowerCase() } : null;
  };
  // a typed time → "HH:MM" (24 h, Western digits) or null: "9" · "930" · "0930" · "9:30" · "09.30" · Arabic-Indic digits
  const normTime = s => {
    const w = String(s || '').trim().replace(/[٠-٩۰-۹]/g, c => String(c.charCodeAt(0) & 0xF));
    const m = w.match(/^(\d{1,2})(?:[:.]?(\d{2}))?$/);
    if (!m) return null;
    const h = +m[1], mi = m[2] === undefined ? 0 : +m[2];
    return h < 24 && mi < 60 ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : null;
  };
  const sameDue = (a, b) => !!a && !!b && a.d === b.d && a.m === b.m;
  const iso = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const dayOffset = n => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); };

  // Priority chips — each chip wears its own bang hue (never the accent). onPick(p) fires on user clicks only.
  function prioChips(el, { onPick } = {}) {
    let value = null;
    el.setAttribute('role', 'radiogroup');
    el.innerHTML = [['', T('prio.none')], ['!', T('prio.low')], ['!!', T('prio.medium')], ['!!!', T('prio.high')]].map(([p, name]) =>
      `<button class="chip pchip ${bangCls(p)}" data-p="${p}" type="button" role="radio" aria-label="${esc(T('prio.aria', { name }))}" title="${esc(name)}">${p || '—'}</button>`).join('');
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
      <button class="chip dchip" data-due="none" type="button" role="radio">${T('dc.none')}</button>
      <button class="chip dchip" data-due="today" type="button" role="radio">${T('dc.today')}</button>
      <button class="chip dchip" data-due="tomorrow" type="button" role="radio">${T('dc.tomorrow')}</button>
      <span class="pick-wrap">
        <button class="chip dchip dpick" data-due="pick" type="button" role="radio" aria-label="${esc(T('dc.pickAria'))}">${T('dc.pick')}</button>
        <input class="date-proxy" type="date" tabindex="-1" aria-hidden="true">
      </span>`;
    const proxy = el.querySelector('.date-proxy');
    const kindOf = v => (!v ? 'none' : sameDue(v, dueOf(dayOffset(0))) ? 'today' : sameDue(v, dueOf(dayOffset(1))) ? 'tomorrow' : 'pick');
    const paint = () => {
      const k = kindOf(value);
      el.querySelectorAll('.dchip').forEach(c => { const on = c.dataset.due === k; c.classList.toggle('sel', on); c.setAttribute('aria-checked', on); });
      const pick = el.querySelector('.dpick');
      pick.textContent = k === 'pick' ? dueText(value) : T('dc.pick');
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
  const undoVerb = u => u.kind === 'delete' ? T('u.deleted')
    : u.kind === 'toggle' ? (u.starring ? T('u.markedNow') : T('u.clearedNow'))
    : u.kind === 'reorder' ? T('u.moved')
    : u.kind === 'clear' ? T('u.cleared')
    : u.kind === 'settings' ? T('u.reset')
    : T('u.completed');
  const undoText = u => u.label ? `${undoVerb(u)}: ${u.label}` : undoVerb(u); // a settings reset has no task label

  // Countdown hairline (M7): drains with transform scaleX, never width. Pause math uses elapsed time, not layout.
  function countdown(fill) {
    let total = 0, left = 0, startedAt = 0;
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const paint = (from, ms) => {
      fill.style.transition = 'none';
      fill.style.transform = `scaleX(${from})`;
      if (reduced() || ms <= 0) return; // no motion: the seconds counter still tells the time
      void fill.offsetWidth; // commit the start frame before transitioning
      fill.style.transition = `transform ${ms}ms linear`;
      fill.style.transform = 'scaleX(0)';
    };
    return {
      start(ms) { total = ms; left = ms; startedAt = Date.now(); paint(1, ms); },
      pause() { left = Math.max(0, left - (Date.now() - startedAt)); paint(total ? left / total : 0, 0); },
      resume() { startedAt = Date.now(); paint(total ? left / total : 0, left); },
      get remaining() { return Math.max(0, left - (Date.now() - startedAt)); }
    };
  }

  // Undo bubble — one component for the window toast and the island bar.
  // d = { token, kind, label, starring, left }; the entry is released (onExpire) when the countdown ends.
  function mountUndo(el, d, { onUndo, onExpire } = {}) {
    if (el._undo) el._undo.dispose();
    let secs = d.left;
    el.innerHTML = `<span class="undo-label">${esc(undoText(d))}</span>
      <button class="undo-btn" data-undo type="button">${T('u.undo')}</button><span class="undo-count">${T('u.secs', { n: secs })}</span>
      <span class="undo-progress"><span class="undo-fill"></span></span>`;
    el.hidden = false;
    const cd = countdown(el.querySelector('.undo-fill'));
    cd.start(secs * 1000);
    const tick = setInterval(() => {
      secs--;
      if (secs <= 0) { dispose(); el.hidden = true; if (onExpire) onExpire(d.token); }
      else el.querySelector('.undo-count').textContent = T('u.secs', { n: secs });
    }, 1000);
    const dispose = () => { clearInterval(tick); el._undo = null; };
    el.querySelector('[data-undo]').addEventListener('click', () => { dispose(); el.hidden = true; if (onUndo) onUndo(d.token); });
    el._undo = { dispose };
    return el._undo;
  }

  // the green Update pill (island + tasks window): shown only while a newer release exists; tooltip names the version
  function renderUpdate(btn, update) {
    if (!btn) return;
    btn.hidden = !update;
    if (!update) return;
    const tip = T('upd.title', { v: update.version });
    btn.title = tip; btn.setAttribute('aria-label', tip);
  }
  // theme color + text sizes from settings (every window calls this with each snapshot's settings)
  const ACCENTS = ['blue', 'violet', 'teal', 'pink', 'graphite'], BG_THEMES = ['mist', 'dusk', 'lagoon', 'bloom', 'dune'], SIZE_K = [0.92, 1, 1.1, 1.2];
  function applyTheme(s) {
    if (!s) return;
    const r = document.documentElement, a = ACCENTS.includes(s.accent) ? s.accent : 'blue';
    if (a === 'blue') delete r.dataset.accent; else r.dataset.accent = a;
    r.dataset.bg = BG_THEMES.includes(s.islandTheme) ? s.islandTheme : 'mist'; // island theme → the tasks window's color field too
    r.style.setProperty('--ui-k', SIZE_K[s.labelSize] ?? 1);
    r.style.setProperty('--task-k', SIZE_K[s.taskSize] ?? 1);
    // Glass (0 = solid, 1–4): the scene + glass panels in every window that paints a scene (.ambient: tasks, editor, share).
    // The chrome never goes as clear as the island's — it sits over text you read.
    const g = Number.isInteger(s.glassLevel) ? s.glassLevel : 3;
    r.classList.toggle('glass-on', g > 0 && !!document.querySelector('.ambient'));
    r.style.setProperty('--g-chrome', [1, 0.8, 0.66, 0.54, 0.42][g] ?? 0.54);
    // the reading panels follow the same Glass steps as the island (Solid · 20 · 35 · 50 · 65 % of the scene through);
    // the last value = tokens.css --sheet, the contrast gate's worst case
    r.style.setProperty('--g-sheet', [1, 0.76, 0.62, 0.5, 0.38][g] ?? 0.5);
  }
  window.UI = { setLang: l => { LANG = l || 'en'; }, MONTHS, esc, bangCls, dueText, parseDueText, normTime, prioChips, dueControl, undoText, countdown, mountUndo, renderUpdate, applyTheme, ACCENTS, BG_THEMES };
})();
