'use strict';
// window.UI — helpers + small components shared by every window (one copy, no drift).
(() => {
  let LANG = 'en'; // set by each window on snapshot/boot via UI.setLang
  const T = (k, prm) => window.I18N.t(LANG, k, prm);
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bangCls = p => ({ '!!!': 'p3', '!!': 'p2', '!': 'p1' }[p] || 'p0');
  const dueOf = dt => ({ d: dt.getDate(), m: MONTHS[dt.getMonth()] });
  // due time (#7, owner 2026-10-05): minutes after midnight, written 12 h like the note ("2pm", "2:30pm")
  const fmtTime = min => { if (min == null) return ''; const h = Math.floor(min / 60), mi = min % 60; return `${h % 12 || 12}${mi ? ':' + String(mi).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`; };
  const timeMin = s => { const t = normTime(s); return t ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null; };
  const dueText = d => (d ? `${d.d} ${d.m}${d.time != null ? ' ' + fmtTime(d.time) : ''}` : null);
  const parseDueText = s => {
    const m = String(s || '').match(/^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?(?:\s+(.+))?$/);
    if (!m) return null;
    const time = m[3] ? timeMin(m[3]) : null;
    return { d: +m[1], m: m[2][0].toUpperCase() + m[2].slice(1).toLowerCase(), ...(time != null ? { time } : {}) };
  };
  // a typed time → "HH:MM" (24 h, Western digits) or null: "9" · "930" · "0930" · "9:30" · "09.30" · Arabic-Indic digits
  // also "2pm" · "2:30 pm" · "12am" (the due-time field shows the note's 12 h form)
  function normTime(s) {
    const w = String(s || '').trim().replace(/[٠-٩۰-۹]/g, c => String(c.charCodeAt(0) & 0xF));
    const ap = w.match(/^(\d{1,2})(?:[:.](\d{2}))?\s?([ap])\.?m\.?$/i);
    if (ap) {
      const h12 = +ap[1], mi12 = ap[2] === undefined ? 0 : +ap[2];
      if (h12 < 1 || h12 > 12 || mi12 > 59) return null;
      const h24 = h12 % 12 + (ap[3].toLowerCase() === 'p' ? 12 : 0);
      return `${String(h24).padStart(2, '0')}:${String(mi12).padStart(2, '0')}`;
    }
    const m = w.match(/^(\d{1,2})(?:[:.]?(\d{2}))?$/);
    if (!m) return null;
    const h = +m[1], mi = m[2] === undefined ? 0 : +m[2];
    return h < 24 && mi < 60 ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : null;
  }
  const sameDue = (a, b) => !!a && !!b && a.d === b.d && a.m === b.m;
  const iso = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const dayOffset = n => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate() + n); };

  // ---- ONE icon set for the whole app (owner 2026-10-05: "unified design"): Lucide (ISC licence, lucide.dev) path
  // data, 24×24, stroke = currentColor, so every window draws the same family. UI.icon(name) → an <svg class="ic">;
  // static markup writes <svg class="ic" data-icon="name" viewBox="0 0 24 24"></svg> and UI.hydrateIcons() fills it.
  const ICONS = {
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
    share: '<path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>',
    tasks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
    pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    timer: '<path d="M10 2h4"/><path d="m12 14 3-3"/><circle cx="12" cy="14" r="8"/>',
    star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronsUpDown: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    arrowUpRight: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
    swap: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    // the copy wheel's petals (#5): open subtasks / all subtasks · today / all days · Markdown / plain text
    subsOpen: '<rect x="3" y="4" width="6" height="6" rx="1.5"/><rect x="3" y="14" width="6" height="6" rx="1.5"/><path d="M13 7h8"/><path d="M13 17h8"/>',
    subsAll: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
    today: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><circle cx="12" cy="15.5" r="1.6" fill="currentColor" stroke="none"/>',
    allDays: '<path d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4Zm0 0c2 2.67 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.33-6 4Z"/>',
    markdown: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 15V9l3 3 3-3v6"/><path d="M17 9v6"/><path d="m14.5 12.5 2.5 2.5 2.5-2.5"/>',
    text: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>'
  };
  const icon = (name, cls = '') => `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  function hydrateIcons(root = document) {
    root.querySelectorAll('svg[data-icon]').forEach(el => { if (!el.childElementCount) { el.innerHTML = ICONS[el.dataset.icon] || ''; el.setAttribute('aria-hidden', 'true'); } });
  }

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
      </span>
      <input class="time-in dtime" type="text" inputmode="numeric" lang="en" dir="ltr" placeholder="${esc(T('dc.time'))}" aria-label="${esc(T('dc.timeAria'))}" title="${esc(T('dc.timeAria'))}">`;
    const proxy = el.querySelector('.date-proxy');
    // optional time (#7): typed ("2pm", "14:30") or the time wheel; no date yet → today (owner: a time alone means today)
    const tf = el.querySelector('.dtime');
    timeWheel(tf);
    tf.addEventListener('change', () => {
      const raw = tf.value.trim();
      const tm = raw ? timeMin(raw) : null;
      if (raw && tm == null) { tf.value = value && value.time != null ? fmtTime(value.time) : ''; return; }
      const base = value ? { d: value.d, m: value.m } : (tm != null ? dueOf(dayOffset(0)) : null);
      set(base ? (tm != null ? { ...base, time: tm } : base) : null, true);
    });
    const kindOf = v => (!v ? 'none' : sameDue(v, dueOf(dayOffset(0))) ? 'today' : sameDue(v, dueOf(dayOffset(1))) ? 'tomorrow' : 'pick');
    const paint = () => {
      const k = kindOf(value);
      if (document.activeElement !== tf) tf.value = value && value.time != null ? fmtTime(value.time) : '';
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
      const keep = d => (value && value.time != null ? { ...d, time: value.time } : d); // a new day keeps the chosen time
      if (k === 'none') return set(null, true);
      if (k === 'today') return set(keep(dueOf(dayOffset(0))), true);
      if (k === 'tomorrow') return set(keep(dueOf(dayOffset(1))), true);
      proxy.min = iso(dayOffset(-45)); // the note infers the year: >45 days back would read as next year
      if (value) { const mi = MONTHS.indexOf(value.m); if (mi >= 0) proxy.value = iso(new Date(new Date().getFullYear(), mi, value.d)); }
      try { proxy.showPicker(); } catch (err) { proxy.focus(); proxy.click(); }
    });
    proxy.addEventListener('change', () => {
      if (!proxy.value) return;
      const [y, m, d] = proxy.value.split('-').map(Number);
      set(value && value.time != null ? { ...dueOf(new Date(y, m - 1, d)), time: value.time } : dueOf(new Date(y, m - 1, d)), true);
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

  // ---- focus timer (owner 2026-10-05, tasks #10 + #6; demo pick C "arc dial") ----
  const TIMER_IC = icon('timer');
  // remaining time as notation: "1:42" (h:mm) from an hour up, "42m" below, "<1m" at the end
  function timerLeft(timer, now = Date.now()) {
    const ms = Math.max(0, timer.endsAt - now), m = Math.ceil(ms / 60000);
    if (ms < 60000) return '<1m';
    return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : `${m}m`;
  }
  const fmtMin = m => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`);
  // a small ring chip: ⏱ + the time left; the ring drains as the timer runs
  function timerChip(timer) {
    const k = Math.max(0, Math.min(1, (timer.endsAt - Date.now()) / (timer.total || 1))), c = 2 * Math.PI * 5.5;
    return `<svg class="tring" viewBox="0 0 14 14" aria-hidden="true"><circle class="bg" cx="7" cy="7" r="5.5"/><circle class="fg" cx="7" cy="7" r="5.5" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - k)).toFixed(2)}"/></svg><span class="tleft">${timerLeft(timer)}</span>`;
  }
  // The arc dial: a half circle you drag around (5-minute steps up to 4 h; on release it snaps to 15m · 30m · 45m ·
  // 1h · 1h30 · 2h · 3h · 4h when within 5 minutes). It sweeps in from 0 to the current value. Mouse wheel / arrow keys
  // step 5 minutes; Enter starts. host = the positioned container; anchor = the ⏱ tab it grows out of.
  const DIAL_MAX = 240, DIAL_SNAP = [15, 30, 45, 60, 90, 120, 180, 240];
  let dialOpen = null;
  function arcDial(host, anchor, { minutes = 120, running = false, onStart, onStop, onClose } = {}) {
    if (dialOpen) dialOpen.close();
    const W = 210, cx = 105, cy = 104, r = 82;
    const pt = m => { const a = Math.PI + (m / DIAL_MAX) * Math.PI; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    const path = m => { const [x, y] = pt(Math.max(0.5, m)); return `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`; };
    const ticks = [0, 60, 120, 180, 240].map(m => { const a = Math.PI + (m / DIAL_MAX) * Math.PI; return `<text class="tk" x="${(cx + (r + 15) * Math.cos(a)).toFixed(1)}" y="${(cy + (r + 15) * Math.sin(a) + 3).toFixed(1)}" text-anchor="middle">${m / 60}h</text>`; }).join('');
    const el = document.createElement('div');
    el.className = 'arcdial'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', T('timer.aria'));
    el.innerHTML = `<svg viewBox="0 -16 ${W} 128" class="ad-svg" tabindex="0" role="slider" aria-valuemin="5" aria-valuemax="${DIAL_MAX}" aria-label="${esc(T('timer.aria'))}"><path class="ad-trk" d="${path(DIAL_MAX)}"/><path class="ad-val"/>${ticks}<circle class="ad-knob" r="9"/></svg>
      <div class="ad-read" aria-live="polite"></div>
      <div class="ad-acts">${running ? `<button class="ad-btn ad-stop" type="button">${esc(T('timer.stop'))}</button>` : ''}<button class="ad-btn ad-go" type="button">${esc(T('timer.start'))}</button></div>`;
    host.appendChild(el);
    const svg = el.querySelector('.ad-svg'), val = el.querySelector('.ad-val'), knob = el.querySelector('.ad-knob'), read = el.querySelector('.ad-read');
    let value = Math.max(5, Math.min(DIAL_MAX, minutes));
    const set = m => {
      value = m; val.setAttribute('d', path(m)); const [x, y] = pt(m); knob.setAttribute('cx', x.toFixed(1)); knob.setAttribute('cy', y.toFixed(1));
      read.textContent = fmtMin(Math.round(m)); svg.setAttribute('aria-valuenow', Math.round(m)); svg.setAttribute('aria-valuetext', fmtMin(Math.round(m)));
    };
    // place it under the anchor, end-aligned (RTL: start-aligned), inside the host
    const hb = host.getBoundingClientRect(), ab = anchor.getBoundingClientRect(), rtl = getComputedStyle(host).direction === 'rtl';
    el.style.top = (ab.bottom - hb.top + host.scrollTop + 6) + 'px';
    if (rtl) el.style.left = Math.max(6, ab.left - hb.left) + 'px'; else el.style.right = Math.max(6, hb.right - ab.right) + 'px';
    // the sweep: 0 → value, critically damped (no motion when reduced)
    const target = value;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) set(target);
    else { let t0 = 0; requestAnimationFrame(function step(ts) { if (!el.isConnected) return; t0 = t0 || ts; const k = Math.min(1, (ts - t0) / 520), e = 1 - Math.pow(1 - k, 3); set(Math.max(1, target * e)); if (k < 1) requestAnimationFrame(step); else set(target); }); }
    const snapTo = () => { const near = DIAL_SNAP.find(p => Math.abs(p - value) <= 5); set(near || Math.round(value / 5) * 5); };
    const fromEvt = e => {
      const b = svg.getBoundingClientRect(), x = (e.clientX - b.left) / b.width * W, y = (e.clientY - b.top) / b.height * 128 - 16;
      let a = Math.atan2(y - cy, x - cx); // -π..π; the dial is the upper half (a in -π..0)
      if (a > 0) a = x < cx ? -Math.PI : 0;
      return Math.max(5, Math.min(DIAL_MAX, Math.round((a + Math.PI) / Math.PI * DIAL_MAX / 5) * 5));
    };
    let dragging = false;
    svg.addEventListener('pointerdown', e => {
      e.preventDefault(); svg.setPointerCapture(e.pointerId); set(fromEvt(e)); dragging = true;
      const mv = ev => set(fromEvt(ev));
      svg.addEventListener('pointermove', mv);
      svg.addEventListener('pointerup', ev => { svg.removeEventListener('pointermove', mv); snapTo(); dragging = false; if (!el.contains(document.elementFromPoint(ev.clientX, ev.clientY))) away({ relatedTarget: null }); }, { once: true });
    });
    svg.addEventListener('wheel', e => { e.preventDefault(); set(Math.max(5, Math.min(DIAL_MAX, Math.round(value / 5) * 5 + (e.deltaY < 0 ? 5 : -5)))); }, { passive: false });
    el.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); set(Math.min(DIAL_MAX, Math.round(value / 5) * 5 + 5)); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); set(Math.max(5, Math.round(value / 5) * 5 - 5)); }
      else if (e.key === 'Enter') { e.preventDefault(); el.querySelector('.ad-go').click(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); api.close(); }
    });
    el.querySelector('.ad-go').addEventListener('click', e => { e.stopPropagation(); const m = Math.round(value); api.close(); if (onStart) onStart(m); });
    const stop = el.querySelector('.ad-stop');
    if (stop) stop.addEventListener('click', e => { e.stopPropagation(); api.close(); if (onStop) onStop(); });
    const outside = e => { if (!el.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) api.close(); };
    // hover out → it dismisses itself after 1 s (owner 2026-10-05); coming back (dial or its tab) within that second keeps it
    let leaveT = null;
    const inside = n => !!n && (el.contains(n) || anchor.contains(n));
    const away = e => { if (dragging || inside(e.relatedTarget)) return; clearTimeout(leaveT); leaveT = setTimeout(() => api.close(), 1000); };
    const back = () => clearTimeout(leaveT);
    el.addEventListener('pointerleave', away); anchor.addEventListener('pointerleave', away);
    el.addEventListener('pointerenter', back); anchor.addEventListener('pointerenter', back);
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
    const api = {
      el,
      close() {
        if (!el.isConnected) return;
        document.removeEventListener('pointerdown', outside, true);
        clearTimeout(leaveT); anchor.removeEventListener('pointerleave', away); anchor.removeEventListener('pointerenter', back);
        el.classList.add('out');
        setTimeout(() => el.remove(), 140);
        if (dialOpen === api) dialOpen = null;
        if (onClose) onClose();
      }
    };
    dialOpen = api;
    svg.focus({ preventScroll: true });
    return api;
  }
  // the end alert (#6): a soft gel bounce + an accent wash on the task's row / card (owner pick "gel bounce")
  function gelHit(el) {
    if (!el) return;
    el.classList.remove('gel-hit'); void el.offsetWidth; el.classList.add('gel-hit');
    const wash = document.createElement('span'); wash.className = 'gel-wash'; wash.setAttribute('aria-hidden', 'true'); el.appendChild(wash);
    setTimeout(() => { el.classList.remove('gel-hit'); wash.remove(); }, 2600);
  }

  // the wheel's remembered choices: subtasks + day per viewer (localStorage), the format = the Share setting (shareFmt)
  function copyPrefs(getFmt, saveFmt) {
    let o = { subs: 'all', day: 'all' };
    try { o = { ...o, ...JSON.parse(localStorage.getItem('copy.wheel') || '{}') }; } catch (e) {}
    return {
      get: () => ({ ...o, fmt: getFmt() }),
      set: (k, v) => { if (k === 'fmt') { saveFmt(v); return; } o[k] = v; try { localStorage.setItem('copy.wheel', JSON.stringify(o)); } catch (e) {} },
      // one task → the text the wheel's choices ask for ('' = nothing left, e.g. nothing changed today)
      text: (t, fmtNow) => { const f = fmtNow || getFmt(); return window.ShareText.taskText(t, f === 'md' ? 'md' : 'text', { subs: o.subs, day: o.day === 'today' ? window.ShareText.dayRange(new Date()) : null }); }
    };
  }

  // ---- popovers that hang under a row tab: the copy list (#5) and the running-timer pill (#10) ----
  // Both: solid (no backdrop-filter, perf rule), centred under their tab and kept inside the host, close 1 s after the
  // pointer leaves the pop AND its tab (coming back keeps it), on Esc, or on a click outside.
  function underTab(host, tab, el, kind, onClose) {
    const hb = host.getBoundingClientRect(), tb = tab.getBoundingClientRect();
    host.appendChild(el);
    const w = el.offsetWidth;
    el.style.top = (tb.bottom - hb.top + host.scrollTop + 6) + 'px';
    el.style.left = Math.max(6, Math.min(hb.width - w - 6, tb.left - hb.left + tb.width / 2 - w / 2)) + 'px';
    el.style.transformOrigin = `${Math.round(tb.left - hb.left + tb.width / 2 - parseFloat(el.style.left))}px 0`;
    let t = null, done = false;
    const api = {
      el, kind,
      hold() { clearTimeout(t); },
      later() { clearTimeout(t); t = setTimeout(() => api.close(true), 1000); },
      close(fromLeave) {
        if (done) return; done = true; clearTimeout(t);
        document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', esc, true);
        el.classList.add('out'); setTimeout(() => el.remove(), 140);
        if (onClose) onClose(fromLeave);
      }
    };
    const outside = e => { if (!el.contains(e.target) && !tab.contains(e.target)) api.close(); };
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); api.close(); } };
    setTimeout(() => { if (!done) { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', esc, true); } }, 0);
    el.addEventListener('pointerenter', () => api.hold());
    el.addEventListener('pointerleave', e => { if (!tab.contains(e.relatedTarget)) api.later(); });
    return api;
  }
  const COPY_GROUPS = [['subs', 'cw.grp.subs', [['open', 'subsOpen', 'cw.subsOpen'], ['all', 'subsAll', 'cw.subsAll']]],
    ['day', 'cw.grp.day', [['today', 'today', 'cw.today'], ['all', 'allDays', 'cw.allDays']]],
    ['fmt', 'cw.grp.fmt', [['md', 'markdown', 'cw.md'], ['text', 'text', 'cw.text']]]];
  function copyListOpen(host, tab, { opts, onPick, onCopy, onClose }) {
    const el = document.createElement('div');
    el.className = 'clist'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', T('etab.copy'));
    el.innerHTML = COPY_GROUPS.map(([k, g, two]) => `<div class="cl-grp">${esc(T(g))}</div><div class="cl-seg" role="radiogroup" data-k="${k}">${
      two.map(([v, ic, lb]) => `<button type="button" role="radio" data-v="${v}" class="${opts[k] === v ? 'sel' : ''}" aria-checked="${opts[k] === v}">${icon(ic)}<span>${esc(T(lb))}</span></button>`).join('')}</div>`).join('') +
      `<button class="cl-go" type="button">${icon('copy')}<span>${esc(T('etab.copy'))}</span></button>`;
    const api = underTab(host, tab, el, 'copy', onClose);
    el.addEventListener('click', async e => {
      e.stopPropagation();
      const b = e.target.closest('.cl-seg button');
      if (b) {
        const k = b.parentElement.dataset.k;
        b.parentElement.querySelectorAll('button').forEach(x => { const on = x === b; x.classList.toggle('sel', on); x.setAttribute('aria-checked', on); });
        onPick(k, b.dataset.v); return;
      }
      const go = e.target.closest('.cl-go');
      if (go) {
        const ok = await onCopy();
        if (ok === false) { go.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }], { duration: 240 }); return; } // nothing to copy (e.g. nothing today)
        go.innerHTML = icon('check') + `<span>${esc(T('etab.copied'))}</span>`; go.classList.add('done');
        setTimeout(() => api.close(), 380);
      }
    });
    return api;
  }
  function timerPill(host, tab, tm, { onStop, onClose }) {
    const r = 9, len = 2 * Math.PI * r;
    const el = document.createElement('div');
    el.className = 'tpill'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', T('timer.on'));
    el.innerHTML = `<svg class="tp-ring" viewBox="0 0 24 24" aria-hidden="true"><circle class="bg" cx="12" cy="12" r="${r}"/><circle class="fg" cx="12" cy="12" r="${r}" stroke-dasharray="${len.toFixed(2)}"/></svg>
      <div class="tp-txt"><div class="tp-left"></div><div class="tp-of"></div></div>
      <button class="tp-stop" type="button">${icon('x')}<span>${esc(T('timer.stop'))}</span></button>`;
    const paint = () => {
      const k = Math.max(0, Math.min(1, (tm.endsAt - Date.now()) / (tm.total || 1)));
      el.querySelector('.fg').style.strokeDashoffset = (len * (1 - k)).toFixed(2);
      el.querySelector('.tp-left').textContent = timerLeft(tm);
      el.querySelector('.tp-of').textContent = T('timer.leftOf', { t: fmtMin(Math.round((tm.total || 0) / 60000)) });
    };
    paint();
    const iv = setInterval(paint, 1000);
    const api = underTab(host, tab, el, 'pill', fromLeave => { clearInterval(iv); if (onClose) onClose(fromLeave); });
    el.querySelector('.tp-stop').addEventListener('click', e => { e.stopPropagation(); api.close(); if (onStop) onStop(); });
    return api;
  }

  // the subtask Copy button (owner 2026-10-05, pick D2; replaced copy-on-rest): an icon at the end of each subtask row
  const subCopyHtml = () => `<button class="scopy" type="button" data-subcopy title="${esc(T('sub.copy'))}" aria-label="${esc(T('sub.copy'))}">${icon('copy')}</button>`;
  // a click on it: copy that subtask as plain words (no bangs, no ** _ ~~ marks), the icon turns into a check
  async function subCopyClick(btn, copy) {
    const row = btn.closest('[data-sub]');
    if (!row) return;
    await copy(plain(row.dataset.sub));
    btn.innerHTML = icon('check'); btn.classList.add('done');
    setTimeout(() => { btn.innerHTML = icon('copy'); btn.classList.remove('done'); }, 1100);
  }

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
  // Row tabs (owner 2026-10-05, demo pick A2): icon + WORD again, a little closer together, a darker shadow under
  // each so they read clearly over any row. Delete stays an icon (its word is the tooltip). Placed from the row's corner
  // inward: Now · Copy · Timer · Edit · Delete in the tasks window, Copy · Timer · Edit in the island.
  function editTab(host, { onEdit, onStar, onDelete, onCopy, copyLabel, copyOpts, onTimer, timerOf, onTimerStop, onLeave }) {
    const mk = (cls, html) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'etab ' + cls; b.tabIndex = -1; b.innerHTML = html; host.appendChild(b); return b; };
    const tab = mk('etab-edit', icon('pencil') + '<span class="etab-t"></span>');
    const del = onDelete ? mk('etab-ic etab-del', icon('trash')) : null;
    const star = onStar ? mk('etab-star', icon('star', 'etab-g') + '<span class="etab-t"></span>') : null; // quick Now (owner 2026-09-29)
    const copy = onCopy ? mk('etab-copy', '<span class="cw-fill" aria-hidden="true"></span>' + icon('copy') + '<span class="etab-t"></span>') : null;
    const timer = onTimer ? mk('etab-timer', icon('timer') + '<span class="etab-t"></span>') : null; // focus timer (#10)
    const tabs = [del, tab, timer, copy, star].filter(Boolean);
    const word = (b, w) => { b.querySelector('.etab-t').textContent = w; };
    let row = null, pop = null; // pop = the copy list or the running-timer pill hanging under a tab
    const place = () => {
      if (!row || !row.isConnected) { api.hide(); return; }
      const h = host.getBoundingClientRect(), b = row.getBoundingClientRect(), rtl = getComputedStyle(host).direction === 'rtl';
      // a row that isn't laid out yet (or scrolled out of the host) gets no tab — never park it somewhere else
      if (!b.height || b.bottom < h.top || b.top > h.bottom) { tabs.forEach(t => t.classList.remove('on')); return; }
      let edge = rtl ? b.left - h.left + 14 : h.right - b.right + 14;
      for (const t of tabs) { // the first sits at the corner; the rest line up just inside it
        t.style.top = Math.max(2, b.top - h.top - 12) + 'px';
        t.style.right = rtl ? '' : edge + 'px';
        t.style.left = rtl ? edge + 'px' : '';
        edge += t.offsetWidth + 4;
      }
    };
    const paintTimer = () => {
      if (!timer || !row) return;
      const tm = timerOf ? timerOf(row) : null;
      timer.classList.toggle('timing', !!tm);
      word(timer, tm ? timerLeft(tm) : T('etab.timer')); // a running timer shows its time left on the tab
      const tl = tm ? T('timer.chipTitle', { t: '', left: timerLeft(tm) }).replace(/^\W+/, '') : T('etab.timerTitle');
      timer.title = tm ? T('timer.on') : T('etab.timerTitle'); timer.setAttribute('aria-label', tm ? T('timer.on') : tl);
    };
    const closePop = () => { if (pop) { const p = pop; pop = null; p.close(); } };
    const api = {
      show(r, label) {
        if (row !== r) closePop();
        row = r;
        word(tab, T('etab.label')); tab.title = label; tab.setAttribute('aria-label', label);
        if (del) { const dl = T('etab.del'); del.title = dl; del.setAttribute('aria-label', dl); }
        if (star) api.setNow(r.classList.contains('is-now'));
        paintTimer();
        if (copy) { word(copy, T('etab.copy')); const cl = copyLabel ? copyLabel() : T('etab.copy'); copy.title = cl; copy.setAttribute('aria-label', cl); }
        tabs.forEach(t => t.classList.add('on')); place();
      },
      hide() { closePop(); row = null; tabs.forEach(t => t.classList.remove('on')); },
      place,
      setNow(now) {
        if (!star) return;
        star.querySelector('.etab-g').classList.toggle('filled', now); // ★ filled = it is Now, ☆ outline = make it Now
        word(star, T(now ? 'etab.notNow' : 'etab.now'));
        star.classList.toggle('now', now);
      },
      get row() { return row; },
      get timerTab() { return timer; },
      owns: el => !!el && el.nodeType === 1 && (tabs.some(t => t.contains(el)) || !!(pop && pop.el.contains(el)))
    };
    const leftAll = n => !(row && row.contains(n)) && !api.owns(n);
    const popClosed = () => { pop = null; if (row && !row.matches(':hover') && onLeave) onLeave(); };
    // ---- Copy (#5, owner pick E1): hover — NO timer — the tab fills with the accent, then a small list drops below it:
    // Subtasks (open only · all) · Day (today · all days) · Format (Markdown · plain) + a Copy button. A plain click on
    // the tab copies at once with the current choices.
    if (copy && copyOpts) {
      let over = false;
      const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
      copy.addEventListener('pointerenter', () => {
        over = true;
        if (pop && pop.kind === 'copy') { pop.hold(); return; }
        if (!row) return;
        copy.classList.remove('filling'); void copy.offsetWidth; copy.classList.add('filling');
        const go = () => { copy.classList.remove('filling'); if (over && row && !(pop && pop.kind === 'copy')) { closePop(); const r = row; pop = copyListOpen(host, copy, { opts: copyOpts.get(), onPick: (k, v) => copyOpts.set(k, v), onCopy: () => doCopy(r), onClose: popClosed }); } };
        if (reduced()) go(); else copy.querySelector('.cw-fill').addEventListener('animationend', go, { once: true });
      });
      copy.addEventListener('pointerleave', e => { over = false; if (!pop) copy.classList.remove('filling'); else if (pop.kind === 'copy' && !pop.el.contains(e.relatedTarget)) pop.later(); });
    }
    const flashCopied = () => {
      const swap = n => { const old = copy.querySelector('svg.ic'); if (old) old.outerHTML = icon(n); };
      swap('check'); word(copy, T('etab.copied')); copy.classList.add('done');
      setTimeout(() => { swap('copy'); word(copy, T('etab.copy')); copy.classList.remove('done'); }, 1100);
    };
    const doCopy = async r => { const ok = await onCopy(r); if (ok !== false && copy) flashCopied(); return ok; };
    // ---- Timer: not running → a click opens the arc dial; running → hovering (or clicking) the tab shows the pill
    // (ring · time left · Stop), owner pick F1. Both close 1 s after the pointer leaves.
    if (timer) {
      timer.addEventListener('pointerenter', () => {
        const tm = row && timerOf ? timerOf(row) : null;
        if (!tm) return;
        if (pop && pop.kind === 'pill') { pop.hold(); return; }
        closePop();
        pop = timerPill(host, timer, tm, { onStop: () => onTimerStop && onTimerStop(), onClose: popClosed });
      });
      timer.addEventListener('pointerleave', e => { if (pop && pop.kind === 'pill' && !pop.el.contains(e.relatedTarget)) pop.later(); });
    }
    tab.addEventListener('click', e => { e.stopPropagation(); if (row) onEdit(row); });
    if (del) del.addEventListener('click', e => { e.stopPropagation(); if (row) onDelete(row); });
    if (star) star.addEventListener('click', e => { e.stopPropagation(); if (row) onStar(row); });
    if (timer) timer.addEventListener('click', e => {
      e.stopPropagation();
      if (!row) return;
      if (timerOf && timerOf(row)) { if (!pop) timer.dispatchEvent(new PointerEvent('pointerenter')); return; } // running: the pill, not a new dial
      closePop(); onTimer(row, timer);
    });
    if (copy) copy.addEventListener('click', async e => { e.stopPropagation(); if (row) { closePop(); await doCopy(row); } });
    tabs.forEach(t => t.addEventListener('mouseleave', e => { if (row && leftAll(e.relatedTarget) && !pop && onLeave) onLeave(); }));
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
  window.UI = { setLang: l => { LANG = l || 'en'; }, MONTHS, esc, icon, copyPrefs, hydrateIcons, ICONS, fmtTime, timerLeft, timerChip, arcDial, gelHit, TIMER_IC, inline, plain, fmtBar, toggleMark, bangCls, dueText, parseDueText, normTime, prioChips, dueControl, undoText, countdown, mountUndo, editTab, subCopyHtml, subCopyClick, lateFlip, renderUpdate, applyTheme, timeWheel, ACCENTS, BG_THEMES };
})();
