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
    : u.kind === 'edit' ? T('u.edited')
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

  // Overdue due date (owner, 2026-09-28): the date and its "Nd late" share ONE slot and swap every 2 s (tokens.css .flip2),
  // so the late hint never costs the title any width. Reduced motion shows the late hint only (the title attr has both).
  // ---- inline formatting (owner 2026-09-29) — the note keeps plain Markdown: **bold** · _italic_ (or *italic*) ·
  // ~~strike~~ · <u>underline</u> (Markdown has no underline; Obsidian and GitHub render the tag). The lists and the island
  // SHOW it; aria labels and other plain-text spots use plain().
  const EDGE = '(^|[\\s(\\[{"\'])', END = '(?=$|[\\s).,!?:;\\]}"\'])';
  const RX_EM_U = new RegExp(EDGE + '_(?!\\s)(.+?)(?<!\\s)_' + END, 'g'); // _x_ only as a whole word — snake_case stays
  const RX_EM_S = new RegExp(EDGE + '\\*(?![\\s*])(.+?)(?<![\\s*])\\*' + END, 'g');
  function inline(text) {
    return esc(text)
      .replace(/\*\*(?!\s)(.+?)(?<!\s)\*\*/g, '<strong>$1</strong>')
      .replace(/~~(?!\s)(.+?)(?<!\s)~~/g, '<s>$1</s>')
      .replace(/&lt;u&gt;(.+?)&lt;\/u&gt;/g, '<u>$1</u>')
      .replace(RX_EM_U, '$1<em>$2</em>')
      .replace(RX_EM_S, '$1<em>$2</em>');
  }
  const plain = text => String(text || '')
    .replace(/\*\*(?!\s)(.+?)(?<!\s)\*\*/g, '$1').replace(/~~(?!\s)(.+?)(?<!\s)~~/g, '$1').replace(/<u>(.+?)<\/u>/g, '$1')
    .replace(RX_EM_U, '$1$2').replace(RX_EM_S, '$1$2');

  // The formatting pop-up: select text in a task field → a small bar (B · I · S · U) above the selection; the same
  // marks on Ctrl+B / Ctrl+I / Ctrl+U / Ctrl+Shift+X. A mark toggles: applying it again removes it. Every change fires
  // 'input', so previews, autosave and auto-grow follow as if typed.
  const MARKS = { b: ['**', '**'], i: ['_', '_'], s: ['~~', '~~'], u: ['<u>', '</u>'] };
  function toggleMark(el, k) {
    const [open, close] = MARKS[k];
    let a = el.selectionStart, b = el.selectionEnd;
    const v = el.value;
    while (a < b && /\s/.test(v[a])) a++; // a mark hugs the words, never the spaces around them
    while (b > a && /\s/.test(v[b - 1])) b--;
    if (a === b) return false;
    const sel = v.slice(a, b);
    if (sel.length >= open.length + close.length && sel.startsWith(open) && sel.endsWith(close)) {
      const inner = sel.slice(open.length, sel.length - close.length);
      el.setRangeText(inner, a, b, 'select');
    } else if (v.slice(a - open.length, a) === open && v.slice(b, b + close.length) === close) {
      el.setRangeText(sel, a - open.length, b + close.length, 'select');
    } else {
      el.setRangeText(open + sel + close, a, b, 'end');
      el.setSelectionRange(a + open.length, b + open.length);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  let bar = null, barFor = null;
  function fmtBarEl() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.className = 'fmtbar'; bar.setAttribute('role', 'toolbar'); bar.hidden = true;
    bar.innerHTML = [['b', '<b>B</b>'], ['i', '<i>I</i>'], ['s', '<s>S</s>'], ['u', '<u>U</u>']]
      .map(([k, g]) => `<button type="button" data-mark="${k}" tabindex="-1">${g}</button>`).join('');
    bar.addEventListener('pointerdown', e => e.preventDefault()); // keep the field's focus and selection
    bar.addEventListener('click', e => { const b = e.target.closest('[data-mark]'); if (b && barFor) { toggleMark(barFor, b.dataset.mark); place(barFor); } });
    document.body.appendChild(bar);
    return bar;
  }
  let lastPt = null;
  function place(el, pt) {
    const b = fmtBarEl();
    if (document.activeElement !== el || el.selectionStart === el.selectionEnd) { b.hidden = true; return; }
    barFor = el;
    const labels = { b: T('fmt.bold'), i: T('fmt.italic'), s: T('fmt.strike'), u: T('fmt.underline') };
    b.querySelectorAll('[data-mark]').forEach(x => { x.title = labels[x.dataset.mark]; x.setAttribute('aria-label', labels[x.dataset.mark]); });
    b.hidden = false;
    const r = el.getBoundingClientRect(), w = b.offsetWidth, h = b.offsetHeight;
    const p = pt || lastPt;
    let x = p && p.el === el ? p.x - w / 2 : r.left + 12;
    let y = p && p.el === el ? p.y - h - 12 : r.top - h - 6;
    if (y < 4) y = (p && p.el === el ? p.y : r.bottom) + 14; // no room above → below
    b.style.left = Math.max(6, Math.min(x, innerWidth - w - 6)) + 'px';
    b.style.top = y + 'px';
  }
  function fmtBar(el) {
    if (!el || el._fmt) return;
    el._fmt = true;
    el.addEventListener('keydown', e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const mark = !e.shiftKey && k === 'b' ? 'b' : !e.shiftKey && k === 'i' ? 'i' : !e.shiftKey && k === 'u' ? 'u' : e.shiftKey && k === 'x' ? 's' : null;
      if (!mark) return;
      e.preventDefault();
      if (toggleMark(el, mark)) place(el);
    });
    el.addEventListener('pointerup', e => { lastPt = { el, x: e.clientX, y: e.clientY }; setTimeout(() => place(el, lastPt), 0); });
    el.addEventListener('keyup', e => { if (e.shiftKey || e.key === 'Shift' || (e.ctrlKey && e.key.toLowerCase() === 'a')) { lastPt = null; place(el); } else if (!e.ctrlKey && !['Control', 'Meta', 'Alt'].includes(e.key)) fmtBarEl().hidden = true; }); // letting go of Ctrl after Ctrl+Shift+← must not hide the bar
    el.addEventListener('input', () => { if (el.selectionStart === el.selectionEnd) fmtBarEl().hidden = true; });
    el.addEventListener('blur', () => { if (barFor === el) fmtBarEl().hidden = true; });
    el.addEventListener('scroll', () => { if (barFor === el) fmtBarEl().hidden = true; });
  }

  function lateFlip(dateText, dueTs) {
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const late = T('isl.due.late', { n: Math.round((today0.getTime() - (dueTs - 12 * 3600e3)) / 864e5) });
    return `<span class="flip2" title="${esc(dateText + ' · ' + late)}"><span class="f-a">${esc(dateText)}</span><span class="f-b">${esc(late)}</span></span>`;
  }

  // Corner edit tab (owner pick "D", 2026-09-28): ONE floating "✎ Edit" tab per list. The caller shows it on the row the
  // pointer has RESTED on (its hoverSec dwell), so passing over rows on the way to another shows nothing. It floats over
  // the row's top edge, outside the row's own box, so it never takes layout width and never gets clipped by the row.
  // onDelete (tasks window only — the island never deletes) adds a trash tab beside Edit, same glass, same rest
  function editTab(host, { onEdit, onStar, onDelete, onLeave }) {
    const tab = document.createElement('button');
    tab.type = 'button'; tab.className = 'etab'; tab.tabIndex = -1;
    tab.innerHTML = '<svg class="ic" viewBox="0 0 24 24"><path d="M17 3l4 4L8 20l-5 1 1-5L17 3z"/></svg><span class="etab-t"></span>';
    host.appendChild(tab);
    let del = null;
    if (onDelete) {
      del = document.createElement('button');
      del.type = 'button'; del.className = 'etab etab-del'; del.tabIndex = -1;
      del.innerHTML = '<svg class="ic" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>';
      host.appendChild(del);
    }
    let star = null; // quick Now (owner 2026-09-29): ☆ stages the rested task as Now in one click, ★ = Not now
    if (onStar) {
      star = document.createElement('button');
      star.type = 'button'; star.className = 'etab etab-star'; star.tabIndex = -1;
      star.innerHTML = '<span class="etab-g" aria-hidden="true"></span><span class="etab-t"></span>';
      host.appendChild(star);
    }
    // placed from the row's corner inward, so on screen they read ☆ Now · ✎ Edit · 🗑 (owner 2026-09-29: Now first)
    const tabs = [del, tab, star].filter(Boolean);
    let row = null;
    const place = () => {
      if (!row || !row.isConnected) { api.hide(); return; }
      const h = host.getBoundingClientRect(), b = row.getBoundingClientRect(), rtl = getComputedStyle(host).direction === 'rtl';
      // a row that isn't laid out yet (or scrolled out of the host) gets no tab — never park it somewhere else
      if (!b.height || b.bottom < h.top || b.top > h.bottom) { tabs.forEach(t => t.classList.remove('on')); return; }
      let edge = rtl ? b.left - h.left + 14 : h.right - b.right + 14;
      for (const t of tabs) { // the first sits at the corner; the rest line up just inside it
        t.style.top = Math.max(2, b.top - h.top - 11) + 'px';
        t.style.right = rtl ? '' : edge + 'px';
        t.style.left = rtl ? edge + 'px' : '';
        edge += t.offsetWidth + 6;
      }
    };
    const api = {
      show(r, label) {
        row = r;
        tab.querySelector('.etab-t').textContent = T('etab.label');
        tab.title = label; tab.setAttribute('aria-label', label);
        if (del) { const dl = T('etab.del'); del.title = dl; del.setAttribute('aria-label', dl); }
        if (star) api.setNow(r.classList.contains('is-now'));
        tabs.forEach(t => t.classList.add('on')); place();
      },
      hide() { row = null; tabs.forEach(t => t.classList.remove('on')); },
      place,
      setNow(now) {
        if (!star) return;
        star.querySelector('.etab-g').textContent = now ? '\u2605' : '\u2606';
        star.querySelector('.etab-t').textContent = T(now ? 'etab.notNow' : 'etab.now');
        star.classList.toggle('now', now);
      },
      get row() { return row; },
      owns: el => !!el && el.nodeType === 1 && tabs.some(t => t.contains(el))
    };
    tab.addEventListener('click', e => { e.stopPropagation(); if (row) onEdit(row); });
    if (del) del.addEventListener('click', e => { e.stopPropagation(); if (row) onDelete(row); });
    if (star) star.addEventListener('click', e => { e.stopPropagation(); if (row) onStar(row); });
    tabs.forEach(t => t.addEventListener('mouseleave', e => { if (row && !row.contains(e.relatedTarget) && !api.owns(e.relatedTarget) && onLeave) onLeave(); }));
    return api;
  }

  // Apple-style time wheel (owner 2026-09-28: "interactive, not only typing"). Clicking an HH:MM text field opens a
  // small popover with two snapping wheels (hours 00–23 · minutes 00–59) under it; the field stays typeable (a valid
  // typed time turns the wheels). The 3-D curl is a scroll-driven animation (compositor, no JS per frame); one mouse-wheel
  // notch = one step; a wheel settling commits: the field gets the value + 'input' and 'change' (settings autosave /
  // onboarding listen to those). Esc, Enter, a click outside or leaving the field closes it.
  const TW_ROW = 32;
  let twOpen = null; // the one open wheel: { input, pop, close }
  function timeWheel(input) {
    if (!input || input.dataset.wheel) return;
    input.dataset.wheel = '1';
    input.setAttribute('aria-haspopup', 'dialog');
    const col = (n, label) => `<div class="tw-col" tabindex="0" role="listbox" aria-label="${label}"><div class="tw-pad"></div>${
      Array.from({ length: n }, (_, i) => `<div class="tw-item" role="option" data-v="${i}">${String(i).padStart(2, '0')}</div>`).join('')}<div class="tw-pad"></div></div>`;
    function open() {
      if (twOpen && twOpen.input === input) return;
      if (twOpen) twOpen.close();
      const pop = document.createElement('div');
      pop.className = 'twheel'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', T('tw.aria'));
      pop.innerHTML = `<div class="tw-band" aria-hidden="true"></div>${col(24, T('tw.hours'))}<span class="tw-sep" aria-hidden="true">:</span>${col(60, T('tw.minutes'))}`;
      document.body.appendChild(pop);
      const [hc, mc] = pop.querySelectorAll('.tw-col');
      // anchor to the field (the popover grows out of it): below, or above when there's no room; end-aligned
      const rc = input.getBoundingClientRect(), ph = pop.offsetHeight, pw = pop.offsetWidth;
      const below = rc.bottom + 6 + ph <= innerHeight - 8;
      pop.style.top = (below ? rc.bottom + 6 : Math.max(8, rc.top - 6 - ph)) + 'px';
      pop.style.left = Math.max(8, Math.min(innerWidth - pw - 8, rc.right - pw)) + 'px';
      pop.style.transformOrigin = (below ? 'top ' : 'bottom ') + (rc.right - pw >= 8 ? 'right' : 'left');
      const cur = normTime(input.value) || '09:00';
      const setCol = (c, v, smooth) => c.scrollTo({ top: v * TW_ROW, behavior: smooth ? 'smooth' : 'instant' });
      setCol(hc, +cur.slice(0, 2)); setCol(mc, +cur.slice(3, 5));
      const commit = () => {
        const h = Math.round(hc.scrollTop / TW_ROW), m = Math.round(mc.scrollTop / TW_ROW);
        const v = String(Math.min(23, h)).padStart(2, '0') + ':' + String(Math.min(59, m)).padStart(2, '0');
        if (v === normTime(input.value)) return;
        input.value = v;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      for (const c of [hc, mc]) {
        c.addEventListener('scrollend', commit);
        c.addEventListener('wheel', e => { e.preventDefault(); c.scrollBy({ top: Math.sign(e.deltaY) * TW_ROW, behavior: 'smooth' }); }, { passive: false });
        c.addEventListener('click', e => { const it = e.target.closest('.tw-item'); if (it) setCol(c, +it.dataset.v, true); });
        c.addEventListener('keydown', e => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); c.scrollBy({ top: (e.key === 'ArrowDown' ? 1 : -1) * TW_ROW, behavior: 'smooth' }); }
          else if (e.key === 'ArrowRight' && c === hc) { e.preventDefault(); mc.focus(); }
          else if (e.key === 'ArrowLeft' && c === mc) { e.preventDefault(); hc.focus(); }
        });
      }
      const onType = () => { const v = normTime(input.value); if (v) { setCol(hc, +v.slice(0, 2), true); setCol(mc, +v.slice(3, 5), true); } };
      input.addEventListener('input', onType);
      const outside = e => { if (!pop.contains(e.target) && e.target !== input) close(); };
      const keys = e => { if (e.key === 'Escape' || e.key === 'Enter') { if (e.key === 'Escape') e.stopPropagation(); close(); if (document.activeElement !== input) input.focus(); } };
      const leave = () => setTimeout(() => { if (!pop.contains(document.activeElement) && document.activeElement !== input) close(); }, 0);
      document.addEventListener('pointerdown', outside, true);
      pop.addEventListener('keydown', keys); input.addEventListener('keydown', keys);
      pop.addEventListener('focusout', leave); input.addEventListener('blur', leave);
      requestAnimationFrame(() => pop.classList.add('on'));
      function close() {
        if (!twOpen || twOpen.pop !== pop) return;
        twOpen = null;
        document.removeEventListener('pointerdown', outside, true);
        input.removeEventListener('input', onType); input.removeEventListener('keydown', keys); input.removeEventListener('blur', leave);
        input.setAttribute('aria-expanded', 'false');
        pop.classList.remove('on');
        setTimeout(() => pop.remove(), 200); // leaves the way it came (scale back into the field)
      }
      twOpen = { input, pop, close };
      input.setAttribute('aria-expanded', 'true');
    }
    input.addEventListener('pointerdown', () => { if (!input.disabled) open(); });
    input.addEventListener('keydown', e => { if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); open(); } });
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
    // the scene behind the window follows the same steps (owner 2026-09-28: "relative to the transparency selected"):
    // the clearest step shows --scene-a in full (what the contrast gate checks), frostier steps show less of it
    r.style.setProperty('--scene-k', [0, 0.55, 0.7, 0.85, 1][g] ?? 0.85);
  }
  window.UI = { setLang: l => { LANG = l || 'en'; }, MONTHS, esc, inline, plain, fmtBar, toggleMark, bangCls, dueText, parseDueText, normTime, prioChips, dueControl, undoText, countdown, mountUndo, editTab, lateFlip, renderUpdate, applyTheme, timeWheel, ACCENTS, BG_THEMES };
})();
