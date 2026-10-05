'use strict';
let snap = null, expanded = false, pinned = false;
// few first, more on scroll (owner 2026-09-28, round 2 — the "N more" pill is gone): every appearance lists ISLAND_FEW
// tasks; scrolling down (wheel, or ↓ past the last row) loads up to ISLAND_CAP; past that, one line to the tasks window.
const ISLAND_FEW = 5, ISLAND_CAP = 10;
let dismissT = null;
let islandHovered = false; // pointer anywhere on the island window → the timer sits FULL, whatever you click
let counting = false; // a dismiss countdown is running (re-renders never restart or pause it)
let animating = 0, pendingSnap = null; // a snapshot arriving mid-animation waits — re-rendering would kill the moving row

const { esc, bangCls, inline, plain } = window.UI;
const $ = id => document.getElementById(id);
let LANG = 'en';
window.I18N.applyDoc(LANG); // placeholders/titles/aria have no inline fallback — apply once at load, not only on a language change
const T = (k, prm) => window.I18N.t(LANG, k, prm);

function dueHtml(t) {
  if (!t.dueText) return '';
  const cls = t.dueState === 'today' ? 'due today' : t.dueState === 'overdue' ? 'due overdue' : 'due';
  // overdue never relies on color alone: the date and "Nd late" swap in one slot (UI.lateFlip)
  if (t.dueState === 'overdue' && t.dueTs) return `<span class="${cls}">${window.UI.lateFlip(t.dueText, t.dueTs)}</span>`;
  return `<span class="${cls}">${esc(t.dueState === 'today' ? T('isl.due.today') + (t.dueTime ? ' ' + t.dueTime : '') : t.dueText)}</span>`;
}
// subtasks: the note's own [ ] / [x] brackets (like the parent task). Open ones always show; done ones fold behind
// one quiet "[x] N done" line and unfold while the pointer rests on it (owner, 2026-09-27).
const RANK_SUB = { '!!!': 3, '!!': 2, '!': 1 };
const subBang = s => s.p ? `<span class="bang sbang ${bangCls(s.p)}">${esc(s.p)}</span>` : '';
function subsHtml(subs, attrs = '') {
  const one = (s, i) => `<div class="sub${s.done ? ' done' : ''}" style="--i:${Math.min(i, 6)}" data-sub="${esc(s.t)}"${attrs}><span class="sb">${s.done ? '[x]' : '[ ]'}</span>${subBang(s)}<span class="st">${inline(s.t)}</span></div>`;
  // open subtasks lead with the most important (owner 2026-09-29): !!! → !! → ! → none; ties keep note order (stable)
  const open = subs.filter(x => !x.done).sort((a, b) => (RANK_SUB[b.p] || 0) - (RANK_SUB[a.p] || 0)), done = subs.filter(x => x.done);
  const fold = done.length ? `<div class="subs-done"><div class="sd-sum">${esc(T('isl.sub.doneN', { n: done.length }))}</div><div class="sd-wrap"><div class="sd-in">${done.map(one).join('')}</div></div></div>` : '';
  return open.map(one).join('') + fold;
}
// priority sits on the right with the date; no priority → nothing (no placeholder dot)
const bangHtml = t => t.priority ? `<span class="bang ${bangCls(t.priority)}">${esc(t.priority)}</span>` : '';
function rowHtml(t) {
  const subsBadge = t.subs.length ? `<span class="row-sub">${T('isl.sub.badge', { a: t.subs.filter(s => !s.done).length, b: t.subs.length })}</span>` : '';
  const notes = (t.notes || []).map((n, i) => `<div class="rd-note" style="--i:${Math.min(i, 6)}">${inline(n)}</div>`).join('');
  const detail = notes || t.subs.length ? `<div class="rd-wrap"><div class="rd-inner">${notes}${subsHtml(t.subs)}</div></div>` : '';
  const timed = snap && snap.timer && snap.timer.id === t.id;
  return `<div class="fold"><div class="fold-in"><div class="row${timed ? ' timed' : ''}" data-id="${esc(t.id)}" data-file="${t.file}" data-nav tabindex="-1" aria-label="${esc(plain(t.title))}" draggable="true">
    <div class="row-main"><span class="rtitle"><span class="tt">${inline(t.title)}</span></span>${detail}</div>
    <span class="meta">${timed ? `<span class="tmark" title="${esc(T('timer.on'))}">⏱</span>` : ''}${subsBadge}${bangHtml(t)}${dueHtml(t)}</span>
  </div></div></div>`;
}

// Dismiss timer. ONE rule, applied by armDismiss() after anything that could matter (render, hover, pin, keys):
//   pinned / broken note → no timer · pointer on the island or keyboard mode → timer held FULL
//   otherwise → a full countdown, started once; re-renders from clicks never restart or pause it.
let dismissBar = null;
const bar = () => { // the glass's own top highlight is the clock (owner pick 'D'): the arc and its blue core shrink to the center
  if (!dismissBar) {
    const core = window.UI.countdown($('progress-fill')), arc = window.UI.countdown($('gl-arc'));
    dismissBar = { start: t => { core.start(t); arc.start(t); } };
  }
  return dismissBar;
};
const dismissMs = () => ((snap && snap.settings.dismissSec) || 7) * 1000;
function scheduleDismiss(ms) {
  clearTimeout(dismissT);
  bar().start(ms);
  counting = true;
  dismissT = setTimeout(() => { counting = false; if (!pinned && !hasErrors()) retract(); }, ms);
}
function holdFull() { clearTimeout(dismissT); counting = false; bar().start(0); } // start(0) = painted full, no motion
function armDismiss() {
  if (pinned || hasErrors()) { holdFull(); return; }
  if (islandHovered || kbdActive) { holdFull(); return; }
  if (!counting) scheduleDismiss(dismissMs());
}
const hasErrors = () => !!(snap && snap.errors && snap.errors.length);

function renderUndo() {
  const bar = $('undo-bar');
  if (!snap.undo) { if (bar._undo) bar._undo.dispose(); bar.hidden = true; bar.dataset.token = ''; return; }
  if (bar.dataset.token === snap.undo.token && !bar.hidden) return; // same bubble — keep its countdown running
  bar.dataset.token = snap.undo.token;
  window.UI.mountUndo(bar, snap.undo, {
    onExpire: token => window.api.undoExpire(token), // bubble gone → memory released
    onUndo: token => { window.SFX.play('undo'); window.api.undoAction(token); }
  });
}

// one resize timer — unfold/fold transitions finish first, stacked timeouts never pile up
let resizeT = null;
// the window's height: the pill, or further down while the timer dial hangs below it
let dial = null;
const islandH = () => Math.max($('wrap').offsetHeight, dial && dial.el.isConnected ? dial.el.offsetTop + dial.el.offsetHeight + 12 : 0);
function scheduleResize(delay = 0) {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => window.api.resize(islandH(), 0), delay);
}

// cold start: the pill can appear before the first snapshot lands — Facebook-style shimmer rows,
// never an empty "stock" island. Skeleton swaps for real content the moment a snapshot arrives.
function renderSkeleton() {
  $('head-title').textContent = T('app.name');
  $('head-count').textContent = '';
  const row = i => `<div class="sk-row" style="--i:${i}"><span class="sk sk-bang"></span><span class="sk sk-title" style="--w:${58 + (i * 13) % 30}%"></span><span class="sk sk-due"></span></div>`;
  $('body').innerHTML = row(0) + row(1) + row(2);
  document.body.classList.remove('expanded');
  requestAnimationFrame(() => window.api.resize(islandH()));
}
// the note header; with focus-by-time it is the peek switch (⇄ = flip to the other note for this showing)
let peekOther = false;
function secHtml(name, peek) {
  const label = esc(name === 'Work' ? T('isl.sec.work') : T('isl.sec.personal'));
  if (!peek) return `<div class="sec"><span class="hash">##</span> ${label}</div>`;
  const other = name === 'Work' ? T('isl.sec.personal') : T('isl.sec.work');
  return `<button class="sec sec-peek${peekOther ? ' peeking' : ''}" data-peek type="button" title="${esc(T('isl.peek.title', { n: other }))}" aria-label="${esc(T('isl.peek.title', { n: other }))}"><span class="hash">##</span> ${label} <span class="swap" aria-hidden="true">⇄</span></button>`;
}
// ---- focus timer (#10 + #6): the ⏱ tab opens the arc dial; the top bar shows ⏱ + time left (click = stop) ----
let timerIv = null;
function paintTimer() {
  const t = snap && snap.timer, chip = $('timer-chip');
  chip.hidden = !t;
  clearInterval(timerIv); timerIv = null;
  if (!t) return;
  const paint = () => {
    chip.innerHTML = window.UI.timerChip(t);
    const tip = T('timer.chipTitle', { t: plain(t.title), left: window.UI.timerLeft(t) });
    chip.title = tip; chip.setAttribute('aria-label', tip);
  };
  paint(); timerIv = setInterval(paint, 15000);
}
$('timer-chip').addEventListener('click', async () => { window.SFX.play('tick'); await window.api.timerStop(); });
function openDial(r, anchor) {
  const id = r.dataset.id || r.dataset.card, file = r.dataset.file;
  const t = snap && snap.sections.flatMap(x => x.items).find(x => x.id === id);
  if (!t) return;
  let last = 120; try { last = +localStorage.getItem('timer.last') || 120; } catch (e) {}
  const running = !!(snap.timer && snap.timer.id === id);
  dial = window.UI.arcDial($('wrap'), anchor, {
    minutes: running ? Math.round(snap.timer.total / 60000) : last, running,
    onStart: async m => { try { localStorage.setItem('timer.last', String(m)); } catch (e) {} window.SFX.play('starOn'); await window.api.timerStart(file, id, t.title, m); },
    onStop: async () => { window.SFX.play('starOff'); await window.api.timerStop(); },
    onClose: () => { dial = null; scheduleResize(160); }
  });
  scheduleResize(0); armDismiss();
}
window.api.onTimerEnded(d => {
  // time's up: the island is already dropping in (main showIsland); pin it and give the task the gel highlight
  pinned = true;
  if (snap) render();
  setTimeout(() => {
    window.SFX.play('complete');
    const el = $('body').querySelector(`[data-card="${CSS.escape(d.id)}"], .row[data-id="${CSS.escape(d.id)}"]`);
    window.UI.gelHit(el);
    const b = document.createElement('div');
    b.className = 'time-up'; b.setAttribute('role', 'status');
    b.innerHTML = `${window.UI.TIMER_IC}<span>${esc(T('timer.ended', { t: plain(d.title) }))}</span>`;
    $('body').prepend(b); scheduleResize(0);
    setTimeout(() => { b.remove(); scheduleResize(0); }, 9000);
  }, 420);
});

// card flip (owner pick A): the list turns on a horizontal hinge, the other note comes up on its back, a small overshoot
async function flipPeek() {
  if (animating) return;
  const body = $('body');
  animating++;
  window.SFX.play('tick');
  try {
    await window.Motion.play(body, [{ transform: 'perspective(900px) rotateX(0)', opacity: 1 }, { transform: 'perspective(900px) rotateX(-90deg)', opacity: 0.6 }], { duration: 170, easing: window.Motion.EASE_IN });
    peekOther = !peekOther;
    render();
    await window.Motion.play(body, [{ transform: 'perspective(900px) rotateX(90deg)', opacity: 0.6 }, { transform: 'perspective(900px) rotateX(-8deg)', opacity: 1, offset: 0.7 }, { transform: 'perspective(900px) rotateX(0)', opacity: 1 }], { duration: 380, easing: window.Motion.EASE_OUT });
  } finally {
    body.getAnimations().forEach(a => a.cancel()); // never leave a filled transform on the list
    animating--;
    flush();
  }
}
function render() {
  if (!snap) { renderSkeleton(); return; }
  const hoverRowId = hoverRow ? hoverRow.dataset.id : null;
  const focusedId = kbdActive && document.activeElement && document.activeElement.dataset ? (document.activeElement.dataset.id || document.activeElement.dataset.card) : null;
  clearTimeout(hoverT); hoverRow = null;
  // focus by time: the pill mirrors the clock — work tasks in the workday, personal outside (toggle in Settings).
  // snapshot keeps both sections, so the tasks/share windows are never filtered — this is island-only.
  let sections = snap.sections;
  // focus-by-time only makes sense with both notes — a one-note user would get an empty island half the day
  const focus = snap.settings.focusByTime && (snap.settings.mode || 'both') === 'both';
  // peek (owner 2026-10-05, task #9): a click on the "## Work/Personal" header flips to the OTHER note for this showing
  const timeNote = snap.workday ? 'Work' : 'Personal';
  if (focus) sections = sections.filter(s => s.name === (peekOther ? (timeNote === 'Work' ? 'Personal' : 'Work') : timeNote));
  const flat = sections.flatMap(s => s.items);
  const total = flat.length;
  const actives = flat.filter(t => t.active);
  const errs = hasErrors();
  document.body.classList.toggle('expanded', expanded);
  document.body.classList.toggle('pinned', pinned || errs); // a broken source keeps the pill up until you've seen it
  $('btn-pin').classList.toggle('pinned', pinned);
  $('head-title').textContent = T('app.name'); // the Now task lives in its card below — echoing it up here was a distraction (owner)
  window.UI.renderUpdate($('btn-update'), snap.update);
  $('head-count').textContent =
    actives.length ? T('isl.head.active', { n: actives.length, m: total }) : T('isl.head.count', { m: total });
  paintTimer();
  const mark = $('mark'); // live status mark, not decoration: [!] broken source · [★] something is Now · [ ] idle
  mark.textContent = errs ? '[!]' : actives.length ? '[★]' : '[ ]';
  mark.className = 'mark' + (errs ? ' err' : actives.length ? ' now' : '');

  let html = '';
  if (errs) {
    html += snap.errors.map(e =>
      `<div class="err-banner" role="alert"><span>${esc(T('isl.err.banner', { f: e.name || e.path }))}</span><button data-open-settings type="button">${T('isl.err.open')}</button></div>`).join('');
  }
  if (actives.length) {
    html += `<div class="sec"><span class="hash">##</span> ${esc(T('isl.sec.now'))}</div>`;
    for (const a of actives) {
      const subs = a.subs.length ? `<div class="ac-subs">${subsHtml(a.subs, ` data-parent="${esc(a.id)}" data-file="${a.file}"`)}</div>` : '';
      html += `<div class="fold"><div class="fold-in"><div class="active-card rim${snap.timer && snap.timer.id === a.id ? ' timed' : ''}" data-card="${esc(a.id)}" data-file="${a.file}" data-nav tabindex="-1" aria-label="${esc(T('isl.cardAria', { t: a.title }))}">
        <div class="ac-head">
          <button class="rchk" data-done="${esc(a.id)}" data-file="${a.file}" type="button" title="${esc(T('isl.btn.complete'))}" aria-label="${esc(T('isl.btn.completeAria', { t: a.title }))}">[ ]</button>
          <span class="ac-title" data-unstar="${esc(a.id)}" data-file="${a.file}"><span class="tt">${inline(a.title)}</span></span>
          <span class="meta">${snap.timer && snap.timer.id === a.id ? `<span class="tmark" title="${esc(T('timer.on'))}">⏱</span>` : ''}${bangHtml(a)}${dueHtml(a)}<button class="star" data-unstar="${esc(a.id)}" data-file="${a.file}" type="button" title="${esc(T('isl.btn.notNow'))}" aria-label="${esc(T('isl.btn.notNowAria', { t: a.title }))}">&#9733;</button></span>
        </div>
        ${subs}
      </div></div></div>`;
    }
  } else if (!total && !errs) {
    html += `<div class="hint">${focus
      ? (snap.workday ? T('isl.hint.emptyWork') : T('isl.hint.emptyPersonal'))
      : T('isl.hint.empty')}</div>`;
  } else if (total) {
    html += `<div class="hint">${esc(T('isl.hint.star')).replace(/\[ \]/g, '<span class="kbd">[ ]</span>')}</div>`;
  }

  // collapsed: ISLAND_FEW tasks in all; expanded (you scrolled): ISLAND_CAP, scrolling inside #body's cap
  let budget = expanded ? ISLAND_CAP : ISLAND_FEW, shown = 0;
  for (const sec of sections) {
    const rest = sec.items.filter(t => !t.active);
    const items = rest.slice(0, budget);
    budget -= items.length; shown += items.length;
    if (!items.length && !focus) continue;
    html += secHtml(sec.name, focus) + items.map(rowHtml).join('');
  }
  // no button: a collapsed list with more behind it fades at its bottom edge (the hint), and scrolling loads the rest
  const hiddenCount = flat.filter(t => !t.active).length - shown;
  $('body').classList.toggle('has-more', !expanded && hiddenCount > 0);
  if (expanded && hiddenCount > 0) html += `<div class="more-rest" data-open-tasks role="button">${esc(T('isl.expand.rest', { n: hiddenCount }))}<svg class="ic" viewBox="0 0 24 24"><path d="M7 17L17 7M8 7h9v9"/></svg></div>`;
  $('body').innerHTML = html;
  if (hoverRowId) { // hover-unfold survives snapshot re-renders (re-applied to the same task)
    const again = $('body').querySelector(`.row[data-id="${CSS.escape(hoverRowId)}"]`);
    if (again) { again.classList.add('hovered'); hoverRow = again; showEdit(again); }
  }
  if (etab.row && !etab.row.isConnected) etab.hide(); // the rested card/row was re-rendered away
  if (kbdActive) { // keyboard mode survives re-renders: focus returns to the same task (or the first one)
    const navs = [...$('body').querySelectorAll('[data-nav]')];
    const again = navs.find(n => (n.dataset.id || n.dataset.card) === focusedId) || navs[0];
    if (again) again.focus();
  }
  renderUndo();

  requestAnimationFrame(() => window.api.resize(islandH()));
  armDismiss();
}

function flush() {
  if (animating || !pendingSnap) return;
  snap = pendingSnap; pendingSnap = null;
  render();
}

// M1 — ink strike: the literal checkbox ticks, a pen line crosses the title, the row folds away.
// Runs in parallel with the write (never before it) and is timed to the 'complete' arpeggio.
async function inkStrike(fold, tt, chk) {
  if (chk) { chk.textContent = '[x]'; chk.classList.add('checked'); }
  if (tt) tt.classList.add('striking');
  await window.Motion.play(tt, [{ backgroundSize: '0% 1.5px' }, { backgroundSize: '100% 1.5px' }], { duration: 220, delay: 120 });
  await window.Motion.play(fold, [{ gridTemplateRows: '1fr', opacity: 1 }, { gridTemplateRows: '0fr', opacity: 0 }], { duration: 180, easing: window.Motion.EASE_IN });
}
async function completeWithInk(id, file, fold, tt, chk) {
  window.SFX.play('complete');
  animating++;
  try {
    await Promise.all([window.api.complete(id, file), inkStrike(fold, tt, chk)]);
  } catch (err) {
    fold.getAnimations().forEach(a => a.cancel());
    if (tt) { tt.classList.remove('striking'); tt.getAnimations().forEach(a => a.cancel()); }
    if (chk) { chk.textContent = '[ ]'; chk.classList.remove('checked'); }
    showNotice("Couldn't complete — the note isn't reachable.");
  } finally {
    animating--;
    flush();
    scheduleResize(0);
  }
}
function showNotice(msg) {
  const el = document.createElement('div');
  el.className = 'err-banner'; el.setAttribute('role', 'alert'); el.textContent = msg;
  $('body').prepend(el);
  scheduleResize(0);
  setTimeout(() => { el.remove(); scheduleResize(0); }, 4000);
}

// ---- dwell → unfold → settle: rest on a row; a hairline charges for hoverSec, then the row itself unfolds ----
// The same rest shows the corner Edit tab (owner pick "D", 2026-09-28) on rows AND the Now card: passing over rows on the
// way to another one shows nothing, so the tab never flickers across the list.
let hoverT = null, hoverRow = null;
const etab = window.UI.editTab($('wrap'), {
  onEdit: r => editFromIsland(r.dataset.file, r.dataset.id || r.dataset.card),
  // quick Copy (owner 2026-09-29): the task in the Share format (Settings shareFmt: plain text or Markdown); no note write
  onCopy: async r => {
    const id = r.dataset.id || r.dataset.card;
    const t = snap && snap.sections.flatMap(s => s.items).find(x => x.id === id);
    if (!t) return false;
    const fmt = snap.settings.shareFmt === 'md' ? 'md' : 'text';
    await window.api.copyText(window.ShareText.taskText(t, fmt));
    window.SFX.play('tick');
    return true;
  },
  onTimer: (r, tab) => openDial(r, tab),
  copyLabel: () => T('etab.copyTitle', { f: snap && snap.settings.shareFmt === 'md' ? 'Markdown' : T('sh.fmt.text') }),
  onLeave: () => clearHover()
});
const showEdit = r => etab.show(r, T('isl.btn.editAria', { t: r.querySelector('.tt').textContent }));
function clearHover() {
  clearTimeout(hoverT);
  $('body').querySelectorAll('.hovered, .dwelling').forEach(r => r.classList.remove('hovered', 'dwelling'));
  hoverRow = null;
  etab.hide();
  scheduleResize(300);
}
$('body').addEventListener('scroll', () => etab.place());
// rest 1 s on a subtask's text → copy it as plain words (#4, owner 2026-10-05)
window.UI.restCopy($('body'), { ms: 1000, copy: async t => { await window.api.copyText(t); window.SFX.play('tick'); return true; } });
$('body').addEventListener('mouseover', e => {
  const row = e.target.closest('.row, .active-card');
  if (!row || row === hoverRow) return;
  clearHover();
  hoverRow = row;
  const sec = Math.max(0.2, (snap && snap.settings.hoverSec) || 1);
  if (row.matches('.row') && (row.querySelector('.rd-wrap') || row.querySelector('.rtitle').scrollHeight > row.querySelector('.rtitle').clientHeight + 1)) {
    row.style.setProperty('--dwell', sec + 's');
    requestAnimationFrame(() => row.classList.add('dwelling')); // M3 — the charge is visible, so the unfold never surprises
  }
  hoverT = setTimeout(() => {
    row.classList.remove('dwelling');
    row.classList.add('hovered');
    showEdit(row);
    scheduleResize(300);
  }, sec * 1000);
});
const SD_OPEN_MS = 1000 + 500; // the done-subtasks fold: 1 s rest + its reveal (island.css .sd-wrap)
$('body').addEventListener('mouseover', e => { const sd = e.target.closest('.subs-done'); if (sd && !sd.contains(e.relatedTarget)) scheduleResize(SD_OPEN_MS); });
$('body').addEventListener('mouseout', e => { const sd = e.target.closest('.subs-done'); if (sd && !sd.contains(e.relatedTarget)) scheduleResize(300); });
$('body').addEventListener('mouseout', e => {
  const row = e.target.closest('.row, .active-card');
  if (row && hoverRow === row && !row.contains(e.relatedTarget) && !etab.owns(e.relatedTarget)) clearHover();
});

// scroll = more: the collapsed list is short enough not to scroll, so a wheel-down on it is the ask
function showMore() {
  if (expanded || !$('body').classList.contains('has-more')) return false;
  expanded = true; render();
  return true;
}
$('body').addEventListener('wheel', e => { if (e.deltaY > 0) showMore(); }, { passive: true });

// drag & drop reorder — same semantics as the main window (drop on a row = insert before it)
let dragId = null, lastOver = null;
$('body').addEventListener('dragstart', e => {
  const row = e.target.closest('.row');
  if (!row) { e.preventDefault(); return; }
  dragId = row.dataset.id;
  row.classList.add('dragging');
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); }
});
$('body').addEventListener('dragover', e => {
  if (!dragId) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  const over = e.target.closest('.row');
  const target = over && over.dataset.id !== dragId ? over : null;
  if (target === lastOver) return; // dragover fires constantly — touch the DOM only when the target changes
  if (lastOver) lastOver.classList.remove('drop-above');
  if (target) target.classList.add('drop-above');
  lastOver = target;
});
$('body').addEventListener('drop', async e => {
  e.preventDefault();
  const over = e.target.closest('.row');
  const beforeId = over && over.dataset.id !== dragId ? over.dataset.id : null;
  if (dragId && over) {
    const file = over.dataset.file; // rows within one section reorder in that section's file
    window.SFX.play('tick');
    await window.api.reorderTask(file, dragId, beforeId);
  }
  dragId = null;
});
$('body').addEventListener('dragend', () => {
  dragId = null;
  document.querySelectorAll('.row.dragging, .row.drop-above').forEach(r => r.classList.remove('dragging', 'drop-above'));
  lastOver = null;
});

// clicks never write as a side effect of looking: row = open the editor; explicit [ ] / ☆ / Done / Not now controls write
document.addEventListener('click', e => {
  if (e.target.closest('[data-peek]')) { flipPeek(); return; }
  if (e.target.closest('[data-open-tasks]')) { window.SFX.play('tick'); window.api.openWindow(); retract(); return; }
  if (e.target.closest('[data-open-settings]')) { window.api.openWindow('settings'); return; }
  const sub = e.target.closest('[data-sub]');
  if (sub) { // tick a subtask — works in hover-unfold rows AND in Now cards
    e.stopPropagation();
    window.SFX.play('tick');
    const row = sub.closest('.row');
    const file = row ? row.dataset.file : sub.dataset.file;
    const parent = row ? row.dataset.id : sub.dataset.parent;
    window.api.toggleSubtask(file, parent, sub.dataset.sub, 'isl' + Date.now()); // a one-off session: every subtask tick gets its own Undo
    return;
  }
  const edit = e.target.closest('[data-edit]');
  if (edit) {
    const row = edit.closest('.row, .active-card');
    editFromIsland(row.dataset.file, row.dataset.id || row.dataset.card);
    return;
  }
  const done = e.target.closest('[data-done]');
  if (done) {
    const card = done.closest('.active-card');
    completeWithInk(done.dataset.done, done.dataset.file, card.closest('.fold'), card.querySelector('.tt'), done);
    return;
  }
  const unstar = e.target.closest('[data-unstar]');
  if (unstar) { window.SFX.play('starOff'); window.api.toggleActive(unstar.dataset.unstar, unstar.dataset.file); return; }
  const row = e.target.closest('.row');
  if (row) { window.SFX.play('starOn'); window.api.toggleActive(row.dataset.id, row.dataset.file); return; } // row click = stage as Now
});


$('btn-add').addEventListener('click', () => {
  const mode = (snap && snap.settings.mode) || 'both';
  const tag = mode !== 'both' ? mode : snap && snap.workday ? 'work' : 'personal';
  retract();
  window.SFX.play('tick');
  window.api.openWindow('new-' + tag);
});
$('btn-pin').addEventListener('click', () => {
  pinned = !pinned;
  window.SFX.play('pin');
  if (pinned) {
    document.body.classList.add('pinned');
    $('btn-pin').classList.add('pinned');
  } else {
    document.body.classList.toggle('pinned', hasErrors());
    $('btn-pin').classList.remove('pinned');
  }
  armDismiss(); // hovering the pin = still on the island → held full
});

// M4 — the pill retracts upward instead of vanishing; the drop-in entry replays on every show
let retracting = false;
function retract() {
  if (retracting) return;
  retracting = true;
  peekOther = false; // a peek lasts one showing: the next pop is the time-based note again
  islandHovered = false; counting = false; // a hidden window never gets its mouseleave
  clearHover(); // …so the rested row and its Edit tab reset too
  clearTimeout(dismissT);
  const anim = window.Motion.play($('pill'), [{ transform: 'none', opacity: 1 }, { transform: 'translateY(-8px)', opacity: 0 }], { duration: 180, easing: window.Motion.EASE_IN });
  // backstop: the window must really hide even if the animation stalls, or the next shortcut press only "dismisses"
  Promise.race([anim, new Promise(r => setTimeout(r, 320))]).then(() => { if (retracting) { window.api.hide(); retracting = false; } });
}
// edit hand-off: the pill steps aside, the tasks window takes over, the editor opens on top for that task
function editFromIsland(file, id) {
  retract();
  window.SFX.play('tick');
  window.api.openWindow();
  window.api.openEditor(file, id);
}
window.api.onShown(info => {
  retracting = false;
  if (peekOther) { peekOther = false; if (snap) render(); }
  if (expanded) { expanded = false; if (snap) render(); } // each appearance starts with the few (owner 2026-09-28)
  $('body').scrollTop = 0;
  // hover is only trusted if the island was already up; a fresh pop starts un-hovered and counts down at once
  islandHovered = info.fresh && document.documentElement.matches(':hover');
  counting = false; armDismiss(); // every show: a fresh full countdown (or held full, if the pointer is already on it)
  const pill = $('pill');
  pill.getAnimations().forEach(a => a.cancel());
  gelDrop(pill);
});

// ---- glass over a drawn theme ----
// The island no longer films the screen (owner, 2026-09-27: the live copy lagged behind scrolling and filmed the
// mouse pointer as a blurry ghost). Instead it paints its chosen theme into the #gl-bd canvas — a soft mesh
// gradient — and every glass layer stays on top: the lens bends it at the edges, the frost (--g-alpha) covers it at
// the chosen level, the rim, arc and inner shading give it thickness.
// Painted only when something changes (size, theme, light/dark); nothing runs per frame.
// Softer (owner 2026-09-28): every step frosts thicker than before (was .8/.65/.5/.35) and the picture is desaturated
// (island.css .gl-bd saturate(--isl-sat)). The clearest step is now .5 — exactly what the contrast gate checks.
const GLASS_ALPHA = [1, 0.85, 0.75, 0.62, 0.5]; // Frost (Settings → Glass): 0 = solid · 1–4 = 15/25/38/50 % of the theme shows
const GL_PAD = 16; // the backdrop canvas overhangs the pill so the blur never pulls in transparent edges
// mesh gradients: four soft color points over a base, as fractions of the pill box ([color, x, y, rx, ry]).
// Colors are tokens (--bg-<theme>-0..4, light + dark in tokens.css, gated by contrast.js).
const MESH = {
  mist: [[4, 0.3, 0.9, 0.35, 0.6], [3, 0.7, 0.95, 0.4, 0.7], [2, 0.88, 0.1, 0.45, 0.8], [1, 0.12, 0.2, 0.4, 0.7]],
  dusk: [[2, 0.3, 1, 0.4, 0.7], [3, 0.92, 0.55, 0.45, 0.8], [4, 0.55, 0.05, 0.4, 0.7], [1, 0.08, 0.15, 0.45, 0.75]],
  lagoon: [[4, 0.9, 0.95, 0.35, 0.6], [2, 0.5, 0.1, 0.4, 0.7], [3, 0.85, 0.2, 0.4, 0.7], [1, 0.15, 0.85, 0.45, 0.8]],
  bloom: [[4, 0.25, 0.95, 0.35, 0.6], [2, 0.6, 1, 0.4, 0.7], [3, 0.1, 0.3, 0.4, 0.7], [1, 0.9, 0.15, 0.45, 0.8]],
  dune: [[3, 0.95, 0.95, 0.35, 0.6], [2, 0.35, 1, 0.4, 0.7], [1, 0.8, 0.25, 0.4, 0.7], [4, 0.1, 0.1, 0.45, 0.8]]
};
let glassLevel = 3, bgTheme = 'mist', haveFrame = false;
document.documentElement.addEventListener('mouseenter', () => { islandHovered = true; armDismiss(); });
document.documentElement.addEventListener('mouseleave', () => { islandHovered = false; armDismiss(); }); // leave → fresh full countdown
function applyGlass() {
  const lens = glassLevel > 0;
  document.body.dataset.glass = lens ? 'lens' : 'solid';
  document.body.classList.toggle('gl-ready', haveFrame);
  $('pill').style.setProperty('--g-alpha', lens ? GLASS_ALPHA[glassLevel].toFixed(2) : '1');
  if (lens) { const c = $('gl-bd'); c.width = 0; sizeCanvas(); } // width 0 forces sizeCanvas to reallocate + paint (theme / level change)
}
function sizeCanvas() {
  const pill = $('pill'), c = $('gl-bd'), w = pill.clientWidth + 2 * GL_PAD, h = pill.clientHeight + 2 * GL_PAD;
  if (w > 2 * GL_PAD && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; paint(); } // resizing clears — repaint now
}
function paintMesh(ctx, w, h) {
  const cs = getComputedStyle(document.documentElement), t = MESH[bgTheme] ? bgTheme : 'mist';
  const col = i => cs.getPropertyValue(`--bg-${t}-${i}`).trim() || '#888';
  const pw = w - 2 * GL_PAD, ph = h - 2 * GL_PAD;
  ctx.fillStyle = col(0); ctx.fillRect(0, 0, w, h);
  for (const [i, x, y, rx, ry] of MESH[t]) { // an ellipse = a unit circle gradient under a scaled transform
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    const c = col(i); // fade to the same color at 0 alpha — canvas gradients to 'transparent' pass through grey
    g.addColorStop(0, c); g.addColorStop(0.7, c.length === 7 ? c + '00' : 'transparent');
    ctx.save(); ctx.translate(GL_PAD + x * pw, GL_PAD + y * ph); ctx.scale(rx * pw, ry * ph);
    ctx.fillStyle = g; ctx.fillRect(-10, -10, 20, 20); ctx.restore();
  }
}
// PERF (owner 2026-09-28: "laggy, heavy"): the lens used to be a CSS `filter: url(#isl-lens)` (3 SVG displacement passes).
// Chromium re-ran it EVERY frame — idle 72 fps and scroll 48 fps on a 144 Hz screen, measured. Now the lens and the
// softening are BAKED into the canvas pixels once per paint (same math as feDisplacementMap: sample at
// p + scale·(map − .5), one scale per color channel), so the page shows a plain static bitmap: 0 per-frame cost.
const LENS_SCALES = [110, 123, 136]; // R, G, B bend by slightly different amounts (the old filter's chromatic split)
let lensCache = { key: '', idx: null };
function lensIndex(w, h) { // per pixel, per channel: WHERE to sample (a source byte offset) — cached per size, so a repaint is lookups only
  const key = w + 'x' + h;
  if (lensCache.key === key) return lensCache.idx;
  const r = 25, bezel = 34, idx = [new Int32Array(w * h), new Int32Array(w * h), new Int32Array(w * h)];
  const iw = w - 2 * GL_PAD, ih = h - 2 * GL_PAD, hx = iw / 2 - r, hy = ih / 2 - r;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = x + 0.5 - w / 2, py = y + 0.5 - h / 2, ax = Math.abs(px), ay = Math.abs(py);
    const qx = ax - hx, qy = ay - hy;
    let dist, nx = 0, ny = 0;
    if (qx > 0 && qy > 0) { const L = Math.hypot(qx, qy) || 1; dist = r - L; nx = Math.sign(px) * qx / L; ny = Math.sign(py) * qy / L; }
    else if (qx > qy) { dist = iw / 2 - ax; nx = Math.sign(px); }
    else { dist = ih / 2 - ay; ny = Math.sign(py); }
    const t = Math.min(1, Math.max(0, 1 - dist / bezel)), m = t * t * t, i = y * w + x;
    const vx = -nx * m * 127 / 255, vy = -ny * m * 127 / 255; // pixels near the edge sample from further in
    for (let k = 0; k < 3; k++) {
      const sx = Math.min(w - 1, Math.max(0, Math.round(x + LENS_SCALES[k] * vx))), sy = Math.min(h - 1, Math.max(0, Math.round(y + LENS_SCALES[k] * vy)));
      idx[k][i] = (sy * w + sx) * 4 + k; // nearest sample, clamped to the canvas (the pad keeps it off the visible edge)
    }
  }
  lensCache = { key, idx };
  return idx;
}
function paint() {
  const c = $('gl-bd');
  if (!c.width) return;
  const w = c.width, h = c.height;
  const src = document.createElement('canvas'); src.width = w; src.height = h;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  paintMesh(sctx, w, h);
  const sd = sctx.getImageData(0, 0, w, h).data, ctx = c.getContext('2d'), out = ctx.createImageData(w, h), od = out.data;
  const [i0, i1, i2] = lensIndex(w, h);
  const sat = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--isl-sat')) || 1; // CSS saturate() matrix
  const a = 0.213 + 0.787 * sat, b = 0.715 - 0.715 * sat, cc = 0.072 - 0.072 * sat, d = 0.213 - 0.213 * sat, e = 0.715 + 0.285 * sat, f = 0.072 + 0.928 * sat;
  for (let i = 0, n = w * h; i < n; i++) {
    const R = sd[i0[i]], G = sd[i1[i]], B = sd[i2[i]], o = i * 4;
    od[o] = a * R + b * G + cc * B; od[o + 1] = d * R + e * G + cc * B; od[o + 2] = d * R + b * G + f * B; od[o + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  haveFrame = true; document.body.classList.add('gl-ready');
}
const repaint = () => { if (glassLevel > 0) { sizeCanvas(); paint(); } };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaint); // Light/Dark switched: new token colors
// PERF: while the pill resizes (a hover unfold animates its height every frame) the canvas is NOT reallocated per
// frame — the last bitmap simply stretches with the pill (it's sized in CSS, a free GPU scale) and ONE repaint runs
// once the size has settled. (Repainting inside the ResizeObserver cost a 49 ms hitch per unfold, measured.)
let resizePaintT = null;
new ResizeObserver(() => {
  if (document.body.dataset.glass !== 'lens') return;
  clearTimeout(resizePaintT);
  resizePaintT = setTimeout(sizeCanvas, 140);
}).observe($('pill'));
// gel drop-in: the pill falls from the screen edge on a spring, X and Y settling on their own springs,
// so it lands like a drop of liquid. No light sweep (owner: distracting). Reduced motion: no motion.
function gelDrop(pill) {
  const M = window.Motion;
  if (M.reduced) return;
  const H = pill.offsetHeight + 16;
  const fy = M.spring({ bounce: 0.2, response: 0.5 }), fx = M.spring({ bounce: 0.3, response: 0.55 }), fs = M.spring({ bounce: 0.3, response: 0.45 });
  const lerp = (a, b, p) => a + (b - a) * p;
  const T = 950, N = 57, frames = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * T / 1000;
    frames.push({ translate: `0 ${lerp(-H, 0, fy(t)).toFixed(2)}px`, scale: `${lerp(0.55, 1, fx(t)).toFixed(4)} ${lerp(0.4, 1, fs(t)).toFixed(4)}`, opacity: Math.min(1, t / 0.12) });
  }
  frames[N] = { translate: '0 0', scale: '1 1', opacity: 1 };
  pill.animate(frames, { duration: T, easing: 'linear', fill: 'none' });
}
// gel press: the glass squishes under a press and wobbles back from wherever it is (buttons keep their own press)
(() => {
  const pill = $('pill'), M = window.Motion;
  let held = false, pressAnim = null;
  const cur = () => { const v = getComputedStyle(pill).scale; if (!v || v === 'none') return [1, 1]; const p = v.split(' ').map(Number); return [p[0], p[1] ?? p[0]]; };
  pill.addEventListener('pointerdown', e => {
    if (M.reduced || e.button !== 0 || e.target.closest('button, input, textarea')) return;
    held = true;
    const [x, y] = cur();
    if (pressAnim) pressAnim.cancel();
    pressAnim = pill.animate([{ scale: `${x} ${y}` }, { scale: '1.008 0.978' }], { duration: 130, easing: M.EASE_OUT, fill: 'forwards' });
  });
  const release = () => {
    if (!held) return;
    held = false;
    const [x, y] = cur();
    if (pressAnim) pressAnim.cancel();
    const fx = M.spring({ bounce: 0.5, response: 0.36 }), fy = M.spring({ bounce: 0.45, response: 0.32 }), frames = [];
    for (let i = 0; i <= 40; i++) { const t = i / 40 * 0.7; frames.push({ scale: `${(x + (1 - x) * fx(t)).toFixed(4)} ${(y + (1 - y) * fy(t)).toFixed(4)}` }); }
    frames[40] = { scale: '1 1' };
    pressAnim = pill.animate(frames, { duration: 700, easing: 'linear', fill: 'none' });
  };
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) pill.addEventListener(ev, release);
})();

$('btn-update').addEventListener('click', () => { window.api.openUpdate(); retract(); });
$('btn-share').addEventListener('click', () => { window.SFX.play('tick'); window.api.openShare(); retract(); }); // pill steps aside, share window takes over
$('btn-gear').addEventListener('click', () => { window.api.openWindow(); retract(); });
$('btn-close').addEventListener('click', () => retract());
// ---- keyboard (only reachable when summoned by the shortcut — the window is focusable just then) ----
let kbdActive = false;
window.api.onRetract(() => retract()); // shortcut toggle: dismiss side
window.api.onFocusRequest(() => {
  kbdActive = true;
  armDismiss();
  const first = $('body').querySelector('[data-nav]');
  if (first) first.focus(); else $('btn-close').focus();
});
window.addEventListener('blur', () => {
  if (!kbdActive) return;
  kbdActive = false;
  armDismiss();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { retract(); return; }
  const el = document.activeElement && document.activeElement.closest ? document.activeElement.closest('[data-nav]') : null;
  if (!el || e.target !== el) return;
  const navs = [...$('body').querySelectorAll('[data-nav]')], i = navs.indexOf(el);
  const k = e.key;
  if (k === 'ArrowDown' || k === 'ArrowUp') {
    e.preventDefault();
    if (k === 'ArrowDown' && i === navs.length - 1 && showMore()) { const m = [...$('body').querySelectorAll('[data-nav]')]; if (m[i + 1]) m[i + 1].focus(); return; } // ↓ past the last row = scroll for more
    const n = navs[i + (k === 'ArrowDown' ? 1 : -1)]; if (n) n.focus(); return;
  }
  const isCard = el.classList.contains('active-card');
  const id = isCard ? el.dataset.card : el.dataset.id, file = el.dataset.file;
  if (k === 'Enter') { e.preventDefault(); editFromIsland(file, id); return; }
  if (k === ' ' || k === 'x') { e.preventDefault(); if (isCard) el.querySelector('[data-done]').click(); else completeWithInk(id, file, el.closest('.fold'), el.querySelector('.tt'), null); return; }
  if (k === '*' || k === 's') {
    e.preventDefault();
    if (isCard) el.querySelector('[data-unstar]').click();
    else { window.SFX.play('starOn'); window.api.toggleActive(id, file); } // row click semantics
  }
});

// soft blip when the island shows — synthesized in sfx.js, gated by the soundOn setting
window.api.onPlaySound(() => window.SFX.play('show'));

function handleSnap(s) {
  if (s && s.lang && s.lang !== LANG) { LANG = s.lang; window.UI.setLang(LANG); window.I18N.applyDoc(LANG); }
  if (s && s.settings) {
    window.SFX.enabled = !!s.settings.soundOn;
    window.UI.applyTheme(s.settings);
    const g = Number.isInteger(s.settings.glassLevel) ? s.settings.glassLevel : 3;
    const t = window.UI.BG_THEMES.includes(s.settings.islandTheme) ? s.settings.islandTheme : 'mist';
    if (g !== glassLevel || t !== bgTheme) { glassLevel = g; bgTheme = t; applyGlass(); }
  }
  if (!snap) expanded = false;
  if (animating) { pendingSnap = s; return; }
  snap = s;
  render();
}
window.api.onSnapshot(handleSnap);
// main's first sendSnap can beat this renderer's listeners — fetch once so the skeleton never sticks
(async () => { try { const s = await window.api.getSnapshot(); if (s && !snap) handleSnap(s); } catch (e) {} })();
applyGlass();
render(); // skeleton until the first snapshot lands
