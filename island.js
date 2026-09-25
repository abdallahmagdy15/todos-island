'use strict';
let snap = null, expanded = false, pinned = false;
let dismissT = null, remainMs = 0, dismissEnd = 0;
let islandHovered = false; // cursor anywhere on the pill → countdown frozen, whatever re-renders happen
let animating = 0, pendingSnap = null; // a snapshot arriving mid-animation waits — re-rendering would kill the moving row
let prevActive = null; // ids that were Now last render — newly-Now titles get the highlighter swipe

const { esc, bangCls } = window.UI;
const $ = id => document.getElementById(id);
let LANG = 'en';
const T = (k, prm) => window.I18N.t(LANG, k, prm);

function dueHtml(t) {
  if (!t.dueText) return '';
  const cls = t.dueState === 'today' ? 'due today' : t.dueState === 'overdue' ? 'due overdue' : 'due';
  let label = t.dueState === 'today' ? T('isl.due.today') : t.dueText;
  if (t.dueState === 'overdue' && t.dueTs) { // overdue never relies on color alone
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    label += ` \u00B7 ${T('isl.due.late', { n: Math.round((today0.getTime() - (t.dueTs - 12 * 3600e3)) / 864e5) })}`;
  }
  return `<span class="${cls}">${esc(label)}</span>`;
}
function rowHtml(t) {
  const subsBadge = t.subs.length ? `<span class="row-sub">${T('isl.sub.badge', { a: t.subs.filter(s => !s.done).length, b: t.subs.length })}</span>` : '';
  const lines = [
    ...(t.notes || []).map(n => `<div class="rd-note">${esc(n)}</div>`),
    ...t.subs.map(s => `<div class="${s.done ? 'done' : ''}" data-sub="${esc(s.t)}">${s.done ? '&#10003;' : '&#9634;'} ${esc(s.t)}</div>`)
  ].map((l, i) => l.replace('<div ', `<div style="--i:${Math.min(i, 6)}" `));
  const detail = lines.length ? `<div class="rd-wrap"><div class="rd-inner">${lines.join('')}</div></div>` : '';
  return `<div class="fold"><div class="fold-in"><div class="row" data-id="${esc(t.id)}" data-file="${t.file}" data-nav tabindex="-1" aria-label="${esc(t.title)}" draggable="true">
    <button class="rchk" data-chk type="button" title="${esc(T('isl.btn.complete'))}" aria-label="${esc(T('isl.btn.completeAria', { t: t.title }))}">[ ]</button>
    <span class="bang ${bangCls(t.priority)}">${t.priority ? esc(t.priority) : ''}</span>
    <div class="row-main"><span class="rtitle"><span class="tt">${esc(t.title)}</span></span>${detail}</div>
    ${subsBadge}${dueHtml(t)}
    <button class="redit" data-edit type="button" title="${esc(T('isl.btn.editTitle'))}" aria-label="${esc(T('isl.btn.editAria', { t: t.title }))}"><svg class="ic" viewBox="0 0 24 24"><path d="M17 3l4 4L8 20l-5 1 1-5L17 3z"/></svg></button>
  </div></div></div>`;
}

let dismissBar = null;
function scheduleDismiss(ms) {
  clearTimeout(dismissT);
  if (!dismissBar) dismissBar = window.UI.countdown($('progress-fill'));
  dismissBar.start(ms);
  dismissEnd = Date.now() + ms;
  dismissT = setTimeout(() => { if (!pinned && !hasErrors()) retract(); }, ms);
}
function pauseDismiss() {
  clearTimeout(dismissT);
  remainMs = Math.max(0, dismissEnd - Date.now());
  if (dismissBar) dismissBar.pause();
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
function scheduleResize(delay = 0) {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => window.api.resize($('wrap').offsetHeight, 0), delay);
}

function render() {
  if (!snap) return;
  const hoverRowId = hoverRow ? hoverRow.dataset.id : null;
  const focusedId = kbdActive && document.activeElement && document.activeElement.dataset ? (document.activeElement.dataset.id || document.activeElement.dataset.card) : null;
  clearTimeout(hoverT); hoverRow = null;
  // focus by time: the pill mirrors the clock — work tasks in the workday, personal outside (toggle in Settings).
  // snapshot keeps both sections, so the tasks/share windows are never filtered — this is island-only.
  let sections = snap.sections;
  // focus-by-time only makes sense with both notes — a one-note user would get an empty island half the day
  const focus = snap.settings.focusByTime && (snap.settings.mode || 'both') === 'both';
  if (focus) sections = sections.filter(s => s.name === (snap.workday ? 'Work' : 'Personal'));
  const flat = sections.flatMap(s => s.items);
  const total = flat.length;
  const actives = flat.filter(t => t.active);
  const errs = hasErrors();
  document.body.classList.toggle('expanded', expanded);
  document.body.classList.toggle('pinned', pinned || errs); // a broken source keeps the pill up until you've seen it
  $('btn-pin').classList.toggle('pinned', pinned);
  $('head-title').textContent =
    actives.length === 1 ? actives[0].title : actives.length > 1 ? T('isl.head.titleP', { n: actives.length }) : T('app.name');
  $('head-count').textContent =
    actives.length ? T('isl.head.active', { n: actives.length, m: total }) : T('isl.head.count', { m: total });
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
      const subs = a.subs.length
        ? `<div class="ac-subs">${a.subs.map(s => `<div class="${s.done ? 'done' : ''}" data-sub="${esc(s.t)}" data-parent="${esc(a.id)}" data-file="${a.file}">${s.done ? '&#10003;' : '&#9634;'} ${esc(s.t)}</div>`).join('')}</div>` : '';
      html += `<div class="fold"><div class="fold-in"><div class="active-card rim" data-card="${esc(a.id)}" data-file="${a.file}" data-nav tabindex="-1" aria-label="${esc(T('isl.cardAria', { t: a.title }))}">
        <div class="ac-head">
          <span class="star">&#9733;</span>
          <span class="bang ${bangCls(a.priority)}">${a.priority ? esc(a.priority) : ''}</span>
          <span class="ac-title"><span class="hl"><span class="tt">${esc(a.title)}</span></span></span>
          ${dueHtml(a)}
        </div>
        ${subs}
        <div class="ac-actions">
          <button class="btn-done rim" data-done="${esc(a.id)}" data-file="${a.file}"><svg class="ic" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>${T('isl.btn.done')}</button>
          <button class="btn-keep" data-unstar="${esc(a.id)}" data-file="${a.file}">${T('isl.btn.notNow')}</button>
        </div>
      </div></div></div>`;
    }
  } else if (!total && !errs) {
    html += `<div class="hint">${focus
      ? (snap.workday ? T('isl.hint.emptyWork') : T('isl.hint.emptyPersonal'))
      : T('isl.hint.empty')}</div>`;
  } else if (total) {
    html += `<div class="hint">${esc(T('isl.hint.star')).replace(/\[ \]/g, '<span class="kbd">[ ]</span>')}</div>`;
  }

  for (const sec of sections) {
    const rest = sec.items.filter(t => !t.active);
    const items = expanded ? rest : rest.slice(0, 3);
    if (!items.length && !expanded) continue;
    html += `<div class="sec"><span class="hash">##</span> ${esc(sec.name === 'Work' ? T('isl.sec.work') : T('isl.sec.personal'))}</div>` + items.map(rowHtml).join('');
  }
  // one expand control, at the very bottom of the list — standard "show more" pattern
  const hiddenCount = flat.filter(t => !t.active).length -
    sections.reduce((n, sec) => n + Math.min(3, sec.items.filter(t => !t.active).length), 0);
  if (expanded) {
    html += `<div class="expand-row" id="expand-toggle"><svg class="ic" viewBox="0 0 24 24"><path d="M18 15l-6-6-6-6"/></svg>${T('isl.expand.less')}</div>`;
  } else if (hiddenCount > 0) {
    html += `<div class="expand-row" id="expand-toggle">${T('isl.expand.all', { n: flat.length })}<svg class="ic" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></div>`;
  }
  $('body').innerHTML = html;
  if (hoverRowId) { // hover-unfold survives snapshot re-renders (re-applied to the same task)
    const again = $('body').querySelector(`.row[data-id="${CSS.escape(hoverRowId)}"]`);
    if (again) { again.classList.add('hovered'); hoverRow = again; }
  }
  // M2 — a task that just became Now gets the highlighter swipe behind its title
  const nowIds = new Set(actives.map(a => a.id));
  if (prevActive) {
    for (const id of nowIds) {
      if (prevActive.has(id)) continue;
      const hl = $('body').querySelector(`[data-card="${CSS.escape(id)}"] .hl`);
      window.Motion.play(hl, [{ backgroundSize: '0% 72%' }, { backgroundSize: '100% 72%' }], { duration: 260, fill: 'none' });
    }
  }
  prevActive = nowIds;
  if (kbdActive) { // keyboard mode survives re-renders: focus returns to the same task (or the first one)
    const navs = [...$('body').querySelectorAll('[data-nav]')];
    const again = navs.find(n => (n.dataset.id || n.dataset.card) === focusedId) || navs[0];
    if (again) again.focus();
  }
  renderUndo();

  requestAnimationFrame(() => window.api.resize($('wrap').offsetHeight));
  if (errs) { clearTimeout(dismissT); return; }
  if (!pinned && !islandHovered && !kbdActive) scheduleDismiss((snap.settings.dismissSec || 10) * 1000);
  else if (!pinned) pauseDismiss(); // hovered / keyboard-driven: freeze the countdown even after action-triggered re-renders
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
let hoverT = null, hoverRow = null;
function clearHover() {
  clearTimeout(hoverT);
  $('body').querySelectorAll('.row.hovered, .row.dwelling').forEach(r => r.classList.remove('hovered', 'dwelling'));
  hoverRow = null;
  scheduleResize(300);
}
$('body').addEventListener('mouseover', e => {
  const row = e.target.closest('.row');
  if (!row || row === hoverRow) return;
  clearHover();
  hoverRow = row;
  const sec = Math.max(0.2, (snap && snap.settings.hoverSec) || 1);
  if (row.querySelector('.rd-wrap') || row.querySelector('.rtitle').scrollHeight > row.querySelector('.rtitle').clientHeight + 1) {
    row.style.setProperty('--dwell', sec + 's');
    requestAnimationFrame(() => row.classList.add('dwelling')); // M3 — the charge is visible, so the unfold never surprises
  }
  hoverT = setTimeout(() => {
    row.classList.remove('dwelling');
    row.classList.add('hovered');
    scheduleResize(300);
  }, sec * 1000);
});
$('body').addEventListener('mouseout', e => {
  const row = e.target.closest('.row');
  if (row && hoverRow === row && !row.contains(e.relatedTarget)) clearHover();
});

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
  if (e.target.closest('#expand-toggle')) { window.SFX.play('tick'); expanded = !expanded; render(); return; }
  if (e.target.closest('[data-open-settings]')) { window.api.openWindow('settings'); return; }
  const sub = e.target.closest('[data-sub]');
  if (sub) { // tick a subtask — works in hover-unfold rows AND in Now cards
    e.stopPropagation();
    window.SFX.play('tick');
    const row = sub.closest('.row');
    const file = row ? row.dataset.file : sub.dataset.file;
    const parent = row ? row.dataset.id : sub.dataset.parent;
    window.api.toggleSubtask(file, parent, sub.dataset.sub);
    return;
  }
  const chk = e.target.closest('[data-chk]');
  if (chk) {
    const row = chk.closest('.row');
    completeWithInk(row.dataset.id, row.dataset.file, row.closest('.fold'), row.querySelector('.tt'), chk);
    return;
  }
  const edit = e.target.closest('[data-edit]');
  if (edit) {
    const row = edit.closest('.row');
    editFromIsland(row.dataset.file, row.dataset.id);
    return;
  }
  const done = e.target.closest('[data-done]');
  if (done) {
    const card = done.closest('.active-card');
    completeWithInk(done.dataset.done, done.dataset.file, card.closest('.fold'), card.querySelector('.tt'), null);
    return;
  }
  const unstar = e.target.closest('[data-unstar]');
  if (unstar) { window.SFX.play('starOff'); window.api.toggleActive(unstar.dataset.unstar, unstar.dataset.file); return; }
  const row = e.target.closest('.row');
  if (row) { window.SFX.play('starOn'); window.api.toggleActive(row.dataset.id, row.dataset.file); return; } // row click = stage as Now
});

$('pill').addEventListener('mouseenter', () => { islandHovered = true; if (!pinned) pauseDismiss(); });
$('pill').addEventListener('mouseleave', () => {
  islandHovered = false;
  if (!pinned && !hasErrors()) scheduleDismiss(((snap && snap.settings.dismissSec) || 10) * 1000); // fresh countdown once you leave
});

$('btn-pin').addEventListener('click', () => {
  pinned = !pinned;
  window.SFX.play('pin');
  if (pinned) {
    clearTimeout(dismissT);
    document.body.classList.add('pinned');
    $('btn-pin').classList.add('pinned');
  } else {
    document.body.classList.toggle('pinned', hasErrors());
    $('btn-pin').classList.remove('pinned');
    if (!islandHovered && !hasErrors()) scheduleDismiss((snap && snap.settings.dismissSec || 10) * 1000); // hovering the pin = still on the island
  }
});

// M4 — the pill retracts upward instead of vanishing; the drop-in entry replays on every show
let retracting = false;
function retract() {
  if (retracting) return;
  retracting = true;
  clearTimeout(dismissT);
  window.Motion.play($('pill'), [{ transform: 'none', opacity: 1 }, { transform: 'translateY(-8px)', opacity: 0 }], { duration: 180, easing: window.Motion.EASE_IN })
    .then(() => { window.api.hide(); retracting = false; });
}
// edit hand-off: the pill steps aside, the tasks window takes over, the editor opens on top for that task
function editFromIsland(file, id) {
  retract();
  window.SFX.play('tick');
  window.api.openWindow();
  window.api.openEditor(file, id);
}
window.api.onShown(() => {
  retracting = false; // heal a retract whose animation promise died silently — the pill is visible again
  const pill = $('pill');
  pill.getAnimations().forEach(a => a.cancel());
  window.Motion.play(pill, [{ transform: 'translateY(-115%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 340, easing: 'cubic-bezier(.22,.9,.36,1)', fill: 'none' });
});

$('btn-expand').addEventListener('click', () => { window.SFX.play('tick'); expanded = !expanded; render(); });
$('btn-gear').addEventListener('click', () => { window.api.openWindow(); retract(); });
$('btn-close').addEventListener('click', () => retract());
// ---- keyboard (only reachable when summoned by the shortcut — the window is focusable just then) ----
let kbdActive = false;
window.api.onRetract(() => retract()); // shortcut toggle: dismiss side
window.api.onFocusRequest(() => {
  kbdActive = true;
  pauseDismiss();
  const first = $('body').querySelector('[data-nav]');
  if (first) first.focus(); else $('btn-close').focus();
});
window.addEventListener('blur', () => {
  if (!kbdActive) return;
  kbdActive = false;
  if (!pinned && !islandHovered && !hasErrors()) scheduleDismiss(((snap && snap.settings.dismissSec) || 10) * 1000);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { retract(); return; }
  const el = document.activeElement && document.activeElement.closest ? document.activeElement.closest('[data-nav]') : null;
  if (!el || e.target !== el) return;
  const navs = [...$('body').querySelectorAll('[data-nav]')], i = navs.indexOf(el);
  const k = e.key;
  if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); const n = navs[i + (k === 'ArrowDown' ? 1 : -1)]; if (n) n.focus(); return; }
  const isCard = el.classList.contains('active-card');
  const id = isCard ? el.dataset.card : el.dataset.id, file = el.dataset.file;
  if (k === 'Enter') { e.preventDefault(); editFromIsland(file, id); return; }
  if (k === ' ' || k === 'x') { e.preventDefault(); (isCard ? el.querySelector('[data-done]') : el.querySelector('[data-chk]')).click(); return; }
  if (k === '*' || k === 's') {
    e.preventDefault();
    if (isCard) el.querySelector('[data-unstar]').click();
    else { window.SFX.play('starOn'); window.api.toggleActive(id, file); } // row click semantics
  }
});

// soft blip when the island shows — synthesized in sfx.js, gated by the soundOn setting
window.api.onPlaySound(() => window.SFX.play('show'));

window.api.onSnapshot(s => {
  if (s && s.lang && s.lang !== LANG) { LANG = s.lang; window.UI.setLang(LANG); window.I18N.applyDoc(LANG); }
  if (s && s.settings) window.SFX.enabled = !!s.settings.soundOn;
  if (!snap) expanded = false;
  if (animating) { pendingSnap = s; return; }
  snap = s;
  render();
});
