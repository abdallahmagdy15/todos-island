'use strict';
let snap = null, currentTab = 'work';

const { esc, bangCls } = window.UI;
const $ = id => document.getElementById(id);

function taskRows() {
  if (!snap) return [];
  const sec = snap.sections.find(s => (currentTab === 'work' ? s.name === 'Work' : s.name === 'Personal'));
  return sec ? sec.items : [];
}

const closedRows = new Set(); // rows with details are OPEN by default (owner 2026-09-28); these were folded — survives refreshes
let freshFrom = null; // ids present before an add/undo — rows not in it get the "fresh ink" settle
let animating = 0, refreshPending = false; // a refresh mid-animation waits — re-rendering would kill the moving row
const fileErr = tag => (snap && snap.errors || []).find(e => e.file === tag);
function matches(t, q) {
  return !q || t.title.toLowerCase().includes(q)
    || t.subs.some(s => s.t.toLowerCase().includes(q))
    || (t.notes || []).some(n => n.toLowerCase().includes(q));
}
function renderDone(q) { // Done tab: both files, restore or delete (both undoable)
  const all = snap.done || [];
  const items = all.filter(d => !q || d.title.toLowerCase().includes(q));
  $('done-count').textContent = all.length ? `· ${all.length}` : '';
  $('btn-clear-done').hidden = !all.length;
  $('task-list').innerHTML = items.map(d => `
    <div class="fold" role="listitem"><div class="fold-in"><div class="wrow done" data-id="${esc(d.id)}" data-file="${d.file}" tabindex="-1" aria-label="Done: ${esc(d.title)}">
      <div class="wrow-main"><span class="wtitle"><span class="tt">${esc(d.title)}</span></span></div>
      <span class="wmeta"><span class="ftag">${d.file === 'work' ? 'work' : 'personal'}</span>${d.dueText ? `<span class="wdue">${esc(d.dueText)}</span>` : ''}<button class="btn-soft sm" data-restore="${esc(d.id)}" data-file="${d.file}" type="button">Restore</button><span class="wacts"><button class="wtrash" data-del="${esc(d.id)}" data-file="${d.file}" type="button" title="Delete" aria-label="Delete completed task"><svg class="ic" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg></button></span></span>
    </div></div></div>`).join('') || `<p class="empty">${q ? T('win.search.none') : T('win.empty.done')}</p>`;
}
function renderList() {
  if (!snap) return; // first snapshot not in yet (tab restore runs before refresh resolves)
  const q = $('search').value.trim().toLowerCase();
  const isDone = currentTab === 'done';
  $('done-head').hidden = !isDone;
  $('composer').hidden = isDone; // nothing to add to the Done list
  const hadFocus = $('task-list').contains(document.activeElement);
  if (isDone) { renderDone(q); markFresh(); settleFocus(hadFocus); restRestore(); $('btn-fold-all').hidden = true; return; }
  const all = taskRows();
  const rows = all.filter(t => matches(t, q));
  $('search-count').textContent = q ? `${rows.length} / ${all.length}` : '';
  $('task-list').innerHTML = rows.map(t => {
    const hasDetail = !!((t.notes || []).length || t.subs.length), open = hasDetail && !closedRows.has(t.id);
    const expandBody = open ? `<div class="wexp-body"><div class="wexp-inner">
      ${(t.notes || []).map(n => `<div class="wdesc">${esc(n)}</div>`).join('')}
      ${t.subs.map(s => `<div class="wsubrow ${s.done ? 'done' : ''}" data-sub="${esc(s.t)}" data-file="${t.file}" data-parent="${esc(t.id)}"><span class="sb">${s.done ? '[x]' : '[ ]'}</span><span class="st">${esc(s.t)}</span></div>`).join('')}
    </div></div>` : '';
    return `
    <div class="fold" role="listitem"><div class="fold-in"><div class="wrow ${open ? 'open' : ''} ${t.active ? 'is-now' : ''}" data-id="${esc(t.id)}" data-file="${t.file}" tabindex="-1" aria-label="${esc(rowLabel(t))}" draggable="true">
      <button class="chk" data-chk="${esc(t.id)}" data-file="${t.file}" type="button" tabindex="-1" aria-label="Complete: ${esc(t.title)}"></button>
      <div class="wrow-main">
        <span class="wtitle"><span class="tt">${esc(t.title)}</span></span>
        ${expandBody}
        ${!open && t.subs.length ? `<div class="wsub" data-exp="${esc(t.id)}">${t.subs.filter(s => !s.done).length}/${t.subs.length} subtasks</div>` : ''}
      </div>
      <span class="wmeta"><span class="bang ${bangCls(t.priority)}">${t.priority ? esc(t.priority) : ''}</span>${t.dueText ? `<span class="wdue ${t.dueState === 'today' ? 'today' : t.dueState === 'overdue' ? 'overdue' : ''}">${dueHtml(t)}</span>` : ''}${t.active ? '<span class="wstar">&#9733;</span>' : ''}${hasDetail ? `<button class="wexp ${open ? 'open' : ''}" data-exp="${esc(t.id)}" title="${open ? 'Collapse' : 'Expand'}" aria-label="${open ? 'Collapse task' : 'Expand task'}"><svg class="ic" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>` : ''}<span class="wacts"><button class="wtrash" data-del="${esc(t.id)}" data-file="${t.file}" type="button" title="Delete" aria-label="Delete task"><svg class="ic" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg></button></span></span>
    </div></div></div>`;
  }).join('') || emptyState(q);
  markFresh();
  settleFocus(hadFocus);
  restRestore();
  foldAllLabel(rows);
}
// ---- rest on a row (the island's hoverSec): the corner Edit tab (owner pick "D", 2026-09-28), the row's quiet actions
// (⌄ expand · delete) and its full title all arrive together. Passing over rows on the way to another shows none of it.
let restRow = null, restT = null, restId = null, restTab = null;
const editTabEl = () => restTab || (restTab = window.UI.editTab(document.querySelector('.list-sheet'), {
  onEdit: r => window.api.openEditor(r.dataset.file, r.dataset.id),
  onLeave: () => restClear()
}));
function restClear() {
  clearTimeout(restT);
  document.querySelectorAll('.wrow.dwelt').forEach(r => r.classList.remove('dwelt'));
  restRow = null; restId = null;
  editTabEl().hide();
}
function restOn(row) {
  row.classList.add('dwelt'); restRow = row; restId = row.dataset.id;
  if (!row.classList.contains('done')) editTabEl().show(row, T('isl.btn.editAria', { t: row.querySelector('.tt').textContent }));
}
function restRestore() { // a re-render keeps the rested task (same id) rested
  if (!restId) return;
  const again = [...document.querySelectorAll('#task-list .wrow')].find(r => r.dataset.id === restId);
  if (again) restOn(again); else restClear();
}
// overdue never relies on color alone: "2 Sep · 23d late"
function daysLate(t) {
  if (!t.dueTs) return 0;
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  return Math.round((today0.getTime() - (t.dueTs - 12 * 3600e3)) / 864e5); // dueTs is noon of the due day
}
// the meta shows the SHORT form only (owner 2026-09-28): today = "today", overdue = the date ⇄ "Nd late" in one slot
const dueHtml = t => t.dueState === 'overdue' && t.dueTs ? window.UI.lateFlip(t.dueText, t.dueTs) : esc(t.dueState === 'today' ? 'today' : t.dueText);
const dueLabel = t => (t.dueState === 'overdue' ? `${t.dueText} \u00B7 ${daysLate(t)}d late` : t.dueState === 'today' ? `${t.dueText} \u00B7 today` : t.dueText);
const PRIO_NAME = { '!!!': 'high', '!!': 'medium', '!': 'low' };
const rowLabel = t => [t.title, t.priority && `${PRIO_NAME[t.priority]} priority`, t.dueText && `due ${dueLabel(t)}`, t.active && 'Now'].filter(Boolean).join(', ');

// roving focus: ONE tab stop for the whole list; arrows move inside it
let focusId = null;
const rowEls = () => [...document.querySelectorAll('#task-list .wrow')];
function settleFocus(hadFocus) {
  const rows = rowEls();
  if (!rows.length) return;
  let cur = rows.find(r => r.dataset.id === focusId);
  if (!cur) cur = rows[Math.min(focusIndex, rows.length - 1)] || rows[0];
  rows.forEach(r => r.tabIndex = -1);
  cur.tabIndex = 0;
  if (hadFocus) cur.focus({ preventScroll: false });
}
let focusIndex = 0;
function focusRow(row) {
  if (!row) return;
  rowEls().forEach(r => r.tabIndex = -1);
  row.tabIndex = 0; row.focus();
  focusId = row.dataset.id; focusIndex = rowEls().indexOf(row);
}
$('task-list').addEventListener('focusin', e => {
  const row = e.target.closest('.wrow');
  if (row) { focusId = row.dataset.id; focusIndex = rowEls().indexOf(row); }
});

function emptyState(q) { // honest: a missing note is "unavailable", never "Nice."
  if (q) return `<p class="empty">${T('win.search.none')}</p>`;
  const err = fileErr(currentTab);
  if (err) return `<p class="empty bad">${T('win.empty.err', { sec: T(currentTab === 'work' ? 'win.tab.work' : 'win.tab.personal'), f: esc(err.name || err.path) })}</p>`;
  return `<p class="empty">${T('win.empty.open')}</p>`;
}
function markFresh() { // M5 — rows that just appeared (after add / undo) settle in with a fading highlight
  if (!freshFrom) return;
  const before = freshFrom; freshFrom = null;
  document.querySelectorAll('#task-list .wrow').forEach(r => { if (!before.has(r.dataset.id)) r.classList.add('fresh'); });
}
const visibleIds = () => new Set([...document.querySelectorAll('#task-list .wrow')].map(r => r.dataset.id));

// task mode: a one-note setup hides the other note's tab; the composer always targets a visible tab
const enabledNotes = () => { const m = (snap && snap.settings.mode) || 'both'; return m === 'both' ? ['work', 'personal'] : [m]; };
function applyMode() {
  const on = enabledNotes();
  for (const tag of ['work', 'personal']) $('tab-' + tag).hidden = !on.includes(tag);
  document.querySelectorAll('[data-note-row]').forEach(el => {
    const off = !on.includes(el.dataset.noteRow);
    if (el.classList.contains('path-edit')) { if (off) el.hidden = true; } // path editors open only on "Change path"
    else el.hidden = off;
  });
  if ((currentTab === 'work' || currentTab === 'personal') && !on.includes(currentTab)) {
    currentTab = on[0];
    if ($('view-settings').hidden) showTab(on[0]);
  }
}
let LANG = 'en'; // resolved language from the snapshot; notation/dates/numerals never translate
window.I18N.applyDoc(LANG); // placeholders/titles/aria have no inline fallback — apply once at load, not only on a language change
const T = (k, prm) => window.I18N.t(LANG, k, prm);
function updateTabCounts() {
  if (!snap) return;
  const n = name => { const s = snap.sections.find(x => x.name === name); return s ? s.items.length : 0; };
  // counts in mono; a broken source never reads as 0 — it reads "!"
  const label = (tag, name) => fileErr(tag) ? `${name}<span class="cnt bad" title="${T('win.tab.err')}">!</span>` : `${name}<span class="cnt">${n(name)}</span>`;
  $('tab-work').innerHTML = label('work', T('win.tab.work'));
  $('tab-personal').innerHTML = label('personal', T('win.tab.personal'));
  $('tab-done').innerHTML = `${T('win.tab.done')}<span class="cnt">${(snap.done || []).length}</span>`;
  moveTabCursor();
}
// M6 — the glass lens slides behind the active tab (spring easing lives in CSS: --ease-spring)
function moveTabCursor() {
  const cur = document.querySelector('.tab-cursor'), act = document.querySelector('nav .tab.active');
  if (!cur || !act) return;
  cur.style.width = act.offsetWidth + 'px';
  cur.style.transform = `translateX(${act.offsetLeft}px)`;
}
window.addEventListener('resize', moveTabCursor);
function renderChrome() { // status mark, error strip, status line — the notes-are-the-state layer
  const errs = snap.errors || [];
  const nowCount = snap.sections.flatMap(s => s.items).filter(t => t.active).length;
  const mark = $('mark');
  mark.textContent = errs.length ? '[!]' : nowCount ? '[\u2605]' : '[ ]';
  mark.className = 'mark' + (errs.length ? ' err' : nowCount ? ' now' : '');
  mark.title = errs.length ? T('win.mark.err') : nowCount ? T(nowCount === 1 ? 'win.mark.nowS' : 'win.mark.nowP', { n: nowCount }) : T('win.mark.none');
  const strip = $('err-strip');
  strip.hidden = !errs.length;
  strip.innerHTML = errs.map(e => `<span>${T('isl.err.banner', { f: esc(e.name || e.path) })}</span>`).join('') +
    (errs.length ? `<button class="btn-soft sm" data-retry type="button">${T('win.retry')}</button><button class="btn-accent sm" data-open-settings type="button">${T('isl.err.open')}</button>` : '');
  const src = snap.sources || {};
  $('st-src').innerHTML = enabledNotes().map(tag =>
    `<span class="${fileErr(tag) ? 'bad' : ''}">${esc(src[tag] || tag)}</span>`).join(' \u00B7 ');
  renderLastWrite();
}
// status line in plain words: "Saved work-tasks.md at 14:05" (an older day adds its date) · "Nothing saved yet".
// Times are notation: 24 h, Western digits, never translated.
const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const whenText = at => { const d = new Date(at); return d.toDateString() === new Date().toDateString() ? hhmm(d) : `${d.getDate()} ${window.UI.MONTHS[d.getMonth()]} ${hhmm(d)}`; };
let lastSeenWrite = 0;
function renderLastWrite() {
  const lw = snap && snap.lastWrite;
  const el = $('st-write');
  if (!lw) { el.textContent = T('win.st.none'); return; }
  el.textContent = T('win.st.last', { f: lw.file, t: whenText(lw.at) });
  if (lw.at !== lastSeenWrite) { // M8-style flash: a write just landed in the note
    const first = !lastSeenWrite; lastSeenWrite = lw.at;
    if (!first) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }
}
setInterval(() => { if (snap) renderLastWrite(); }, 30e3);

async function refresh() {
  if (animating) { refreshPending = true; return; }
  snap = await window.api.getSnapshot();
  if (snap && snap.lang && snap.lang !== LANG) { LANG = snap.lang; window.UI.setLang(LANG); window.I18N.applyDoc(LANG); }
  if (snap && snap.settings) { window.SFX.enabled = !!snap.settings.soundOn; window.UI.applyTheme(snap.settings); }
  applyMode();
  updateTabCounts();
  renderChrome();
  window.UI.renderUpdate($('btn-update'), snap && snap.update);
  renderList();
}
window.addEventListener('focus', refresh); // no file watcher: coming back to the window re-reads the notes

// M1 — ink strike: checkbox ticks, a pen line crosses the title, the row folds. Parallel to the write, never before it.
async function completeWithInk(chk) {
  const row = chk.closest('.wrow'), fold = row.closest('.fold'), tt = row.querySelector('.tt');
  window.SFX.play('complete');
  animating++;
  chk.classList.add('checked');
  try {
    await Promise.all([
      window.api.complete(chk.dataset.chk, chk.dataset.file),
      (async () => {
        tt.classList.add('striking');
        await window.Motion.play(tt, [{ backgroundSize: '0% 1.5px' }, { backgroundSize: '100% 1.5px' }], { duration: 220, delay: 120 });
        await window.Motion.play(fold, [{ gridTemplateRows: '1fr', opacity: 1 }, { gridTemplateRows: '0fr', opacity: 0 }], { duration: 180, easing: window.Motion.EASE_IN });
      })()
    ]);
  } catch (err) {
    fold.getAnimations().forEach(a => a.cancel()); tt.getAnimations().forEach(a => a.cancel());
    tt.classList.remove('striking'); chk.classList.remove('checked');
    notice("Couldn't complete — the note isn't reachable.", 'bad');
  } finally {
    animating--;
    if (!animating) { refreshPending = false; await refresh(); }
  }
}

$('task-list').addEventListener('click', onListAction);
// Expand all / Collapse all (owner 2026-09-28): one toggle above the list; it says what it will do
const foldable = rows => rows.filter(t => (t.notes || []).length || t.subs.length);
function foldAllLabel(rows) {
  const f = foldable(rows), btn = $('btn-fold-all');
  btn.hidden = !f.length;
  const anyOpen = f.some(t => !closedRows.has(t.id));
  btn.dataset.mode = anyOpen ? 'collapse' : 'expand';
  btn.querySelector('.fold-t').textContent = T(anyOpen ? 'win.fold.collapse' : 'win.fold.expand');
}
$('btn-fold-all').addEventListener('click', () => {
  window.SFX.play('tick');
  const f = foldable(taskRows());
  if ($('btn-fold-all').dataset.mode === 'collapse') f.forEach(t => closedRows.add(t.id)); else closedRows.clear();
  renderList();
});
$('task-list').addEventListener('mouseover', e => {
  const row = e.target.closest('.wrow');
  if (!row || row === restRow) return;
  restClear(); restRow = row; // resting starts now; restOn lands after hoverSec
  const sec = Math.max(0.2, (snap && snap.settings && snap.settings.hoverSec) || 1);
  restT = setTimeout(() => { if (row.isConnected) restOn(row); }, sec * 1000);
});
$('task-list').addEventListener('mouseout', e => {
  const row = e.target.closest('.wrow');
  if (row && row === restRow && !row.contains(e.relatedTarget) && !editTabEl().owns(e.relatedTarget)) restClear();
});
$('task-list').addEventListener('scroll', () => editTabEl().place());
// keyboard focus is intent: the focused row rests at once
$('task-list').addEventListener('focusin', e => { const row = e.target.closest('.wrow'); if (row && row === e.target && row.matches(':focus-visible') && row !== restRow) { restClear(); restOn(row); } });
$('task-list').addEventListener('keydown', async e => {
  const row = e.target.closest('.wrow');
  if (!row || e.target !== row || e.ctrlKey || e.altKey || e.metaKey) return; // buttons inside keep their native keys
  const rows = rowEls(), i = rows.indexOf(row);
  const id = row.dataset.id, file = row.dataset.file, done = row.classList.contains('done');
  const k = e.key;
  if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End') {
    e.preventDefault();
    focusRow(k === 'Home' ? rows[0] : k === 'End' ? rows[rows.length - 1] : rows[Math.max(0, Math.min(rows.length - 1, i + (k === 'ArrowDown' ? 1 : -1)))]);
    return;
  }
  if (k === 'Delete') { e.preventDefault(); focusIndex = i; window.SFX.play('delete'); await window.api.deleteTask(id, file); await refresh(); return; }
  if (done) { if (k === 'r' || k === 'Enter') { e.preventDefault(); window.SFX.play('add'); await window.api.uncomplete(id, file); await refresh(); } return; }
  if (k === 'Enter') { e.preventDefault(); window.api.openEditor(file, id); return; }
  if (k === ' ' || k === 'x') { e.preventDefault(); focusIndex = i; const chk = row.querySelector('.chk'); if (!chk.classList.contains('checked')) completeWithInk(chk); return; }
  if (k === '*' || k === 's') { e.preventDefault(); window.SFX.play(row.classList.contains('is-now') ? 'starOff' : 'starOn'); await window.api.toggleActive(id, file); await refresh(); return; }
  if (['0', '1', '2', '3'].includes(k)) {
    e.preventDefault();
    const res = await window.api.updateTask(file, id, { priority: ['', '!', '!!', '!!!'][+k] || null });
    if (res && res.id) focusId = res.id; // id changes with priority — keep focus on the same task
    window.SFX.play('tick');
    await refresh();
  }
});
async function onListAction(e) {
  const chk = e.target.closest('[data-chk]');
  if (chk) { if (!chk.classList.contains('checked')) completeWithInk(chk); return; }
  const exp = e.target.closest('[data-exp]');
  if (exp) {
    window.SFX.play('tick');
    const id = exp.dataset.exp;
    closedRows.has(id) ? closedRows.delete(id) : closedRows.add(id);
    renderList();
    return;
  }
  const sub = e.target.closest('[data-sub]');
  if (sub) { window.SFX.play('tick'); await window.api.toggleSubtask(sub.dataset.file, sub.dataset.parent, sub.dataset.sub); await refresh(); return; }
  const del = e.target.closest('[data-del]');
  if (del) { window.SFX.play('delete'); await window.api.deleteTask(del.dataset.del, del.dataset.file); await refresh(); return; }
  const res = e.target.closest('[data-restore]');
  if (res) { window.SFX.play('add'); await window.api.uncomplete(res.dataset.restore, res.dataset.file); await refresh(); return; }
  const row = e.target.closest('.wrow');
  if (row && !row.classList.contains('done')) { window.api.openEditor(row.dataset.file, row.dataset.id); }
}

$('btn-share').addEventListener('click', () => window.api.openShare());
$('btn-update').addEventListener('click', () => window.api.openUpdate());
$('btn-rerun-setup').addEventListener('click', () => { window.SFX.play('tick'); window.api.openOnboard(); }); // the wizard merges over current settings — cancel changes nothing
$('btn-reset-settings').addEventListener('click', async () => { // settings only: note files are never created, deleted, or modified
  window.SFX.play('delete');
  await window.api.resetSettings();
  await loadSettings(); // the form shows the defaults immediately; the undo bubble is the safety net
});
$('err-strip').addEventListener('click', e => {
  if (e.target.closest('[data-retry]')) refresh();
  if (e.target.closest('[data-open-settings]')) $('tab-settings').click();
});
$('btn-clear-done').addEventListener('click', async () => { // undoable — no native confirm
  window.SFX.play('delete');
  const n = await window.api.clearDoneAll();
  if (!n) notice('Nothing to clear.');
  await refresh();
});

// drag & drop reorder — hold a row, drop it on another (inserts before the target)
let dragId = null, lastOver = null;
$('task-list').addEventListener('dragstart', e => {
  const row = e.target.closest('.wrow');
  if (!row || row.classList.contains('done')) { e.preventDefault(); return; }
  dragId = row.dataset.id;
  row.classList.add('dragging');
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); }
});
$('task-list').addEventListener('dragover', e => {
  if (!dragId) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  const over = e.target.closest('.wrow');
  const target = over && over.dataset.id !== dragId ? over : null;
  if (target === lastOver) return; // dragover fires constantly — touch the DOM only when the target changes
  if (lastOver) lastOver.classList.remove('drop-above');
  if (target) target.classList.add('drop-above');
  lastOver = target;
});
$('task-list').addEventListener('drop', async e => {
  e.preventDefault();
  const over = e.target.closest('.wrow');
  const beforeId = over && over.dataset.id !== dragId ? over.dataset.id : null; // no target = move to end
  if (dragId) {
    window.SFX.play('tick');
    await window.api.reorderTask(currentTab, dragId, beforeId);
    await refresh();
  }
  dragId = null;
});
$('task-list').addEventListener('dragend', () => {
  dragId = null;
  document.querySelectorAll('.wrow.dragging, .wrow.drop-above').forEach(r => r.classList.remove('dragging', 'drop-above'));
  lastOver = null;
});

// ---- composer: type the task like you'd write it in the note; chips are the click route; preview shows the exact line ----
const composer = { prio: undefined, due: undefined, result: null, seq: 0 }; // undefined = no chip chosen (typed tokens win)
const prioCtl = window.UI.prioChips($('new-prio'), { onPick: p => { composer.prio = p; updatePreview(); } });
const dueCtl = window.UI.dueControl($('new-due'), { onPick: d => { composer.due = d; updatePreview(); } });
let pvT = null;
async function updatePreview() {
  clearTimeout(pvT);
  const my = ++composer.seq;
  const r = await window.api.composeTask({ text: $('new-title').value, priority: composer.prio, due: composer.due });
  if (my !== composer.seq) return r; // a newer keystroke already asked
  composer.result = r;
  prioCtl.set(r.priority); dueCtl.set(r.due); // chips mirror the final truth: typed token unless a chip was clicked
  return r;
}
function resetComposer() {
  $('new-title').value = ''; autoGrow($('new-title'));
  composer.prio = undefined; composer.due = undefined; composer.result = null;
  prioCtl.set(null); dueCtl.set(null);
}
let hintT = null;
function composerHint(msg) {
  $('new-hint').textContent = msg;
  clearTimeout(hintT);
  if (msg) hintT = setTimeout(() => { $('new-hint').textContent = ''; }, 3000);
}

function onSearch() { $('search-clear').hidden = !$('search').value; renderList(); }
$('search').addEventListener('input', onSearch);
$('search').addEventListener('keydown', e => { if (e.key === 'Escape' && $('search').value) { e.stopPropagation(); $('search').value = ''; onSearch(); } });
$('search-clear').addEventListener('click', () => { $('search').value = ''; onSearch(); $('search').focus(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('keys-pop').hidden) { toggleKeys(false); return; }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.target.closest('input, textarea, select, [contenteditable], .recorder')) return;
  if (e.key === '?') { e.preventDefault(); toggleKeys(); return; }
  if ($('view-tasks').hidden) return;
  if (e.key === '/') { e.preventDefault(); $('search').focus(); }
  else if (e.key === 'n' && !$('composer').hidden) { e.preventDefault(); $('new-title').focus(); }
});
function toggleKeys(force) {
  const open = force === undefined ? $('keys-pop').hidden : force;
  $('keys-pop').hidden = !open;
  $('st-keys').setAttribute('aria-expanded', open);
}
$('st-keys').addEventListener('click', () => toggleKeys());
document.addEventListener('click', e => { if (!$('keys-pop').hidden && !e.target.closest('#keys-pop, #st-keys')) toggleKeys(false); });
const MAX_LINES = 6; // the composer grows with each line up to 6, then scrolls inside
function autoGrow(ta) {
  const cs = getComputedStyle(ta), max = parseFloat(cs.lineHeight) * MAX_LINES + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, max) + 'px';
}
$('new-title').addEventListener('input', () => {
  autoGrow($('new-title'));
  $('new-title').classList.remove('invalid'); composerHint('');
  clearTimeout(pvT); pvT = setTimeout(updatePreview, 80);
});
$('new-title').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('btn-add').click(); } // Enter adds, Shift+Enter newlines
});
$('btn-add').addEventListener('click', async () => {
  const r = await updatePreview();
  if (!r || !r.ok) { // M9 — say why instead of silently doing nothing
    $('new-title').classList.add('invalid');
    composerHint(T('win.hint.title'));
    window.Motion.nudge($('new-title'));
    $('new-title').focus();
    return;
  }
  let res = null;
  try { res = await window.api.addTask(currentTab, { title: r.title, priority: r.priority, desc: r.desc, dueText: r.dueText, active: r.active }); } catch (err) {}
  if (!res || !res.ok) { composerHint(T('win.hint.addFail')); return; }
  window.SFX.play('add');
  freshFrom = visibleIds();
  resetComposer();
  $('new-title').focus();
  await refresh();
});

// ---- tabs ----
function showTab(tab) {
  currentTab = tab;
  localStorage.setItem('ti-tab', tab); // remember where you left off
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  $('tab-' + tab).classList.add('active');
  moveTabCursor();
  $('view-tasks').hidden = false; $('view-settings').hidden = true;
  renderList();
}
for (const tab of ['work', 'personal', 'done']) $('tab-' + tab).addEventListener('click', () => showTab(tab));
{ // restore last tab (or the one the island asked for)
  const asked = new URLSearchParams(location.search).get('tab');
  const saved = localStorage.getItem('ti-tab');
  if (asked === 'settings') setTimeout(() => $('tab-settings').click(), 0);
  else if (/^new-(work|personal)$/.test(asked || '')) setTimeout(() => openNew(asked.slice(4)), 0);
  else if (saved === 'personal' || saved === 'done') showTab(saved);
}
// "new-work" / "new-personal" (island +): open that tab and put the cursor in the composer
function openNew(tag) {
  const b = $('tab-' + tag);
  if (b && !b.hidden) b.click();
  setTimeout(() => { if (!$('composer').hidden) $('new-title').focus(); }, 60);
}
window.api.onShowTab(tab => {
  if (tab === 'settings') $('tab-settings').click();
  else if (/^new-(work|personal)$/.test(tab)) openNew(tab.slice(4));
  else if (['work', 'personal', 'done'].includes(tab)) $('tab-' + tab).click();
});

// ---- settings save themselves (owner, v1.11 — no Save button): picks (switches, steps, swatches, segments, selects)
// save at once; typed fields save when committed (Enter / leaving the field), so a half-typed number or path never
// saves. Every error and clamp is shown at its own field; the status line says "Settings saved". ----
let langSel = 'system';
let saveChain = Promise.resolve();
const autoSave = () => { saveChain = saveChain.then(saveSettings, saveSettings); return saveChain; }; // one write at a time, in order
for (const b of document.querySelectorAll('#lang-seg .seg-btn')) b.addEventListener('click', () => {
  langSel = b.dataset.lang;
  document.querySelectorAll('#lang-seg .seg-btn').forEach(x => {
    const on = x === b;
    x.classList.toggle('sel', on);
    x.setAttribute('aria-checked', on);
  });
  autoSave();
});
// Glass (frost) + text sizes: clickable stages that fill like a bar. Arrows move them (RTL-aware).
function stepper(id) {
  const steps = [...document.querySelectorAll('#' + id + ' .step')];
  const api = { value: 0, set(v) {
    api.value = v;
    steps.forEach(b => {
      const n = +b.dataset.glass, on = n === v;
      b.classList.toggle('sel', on); b.classList.toggle('fill', n <= v);
      b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1;
    });
  } };
  steps.forEach(b => b.addEventListener('click', () => { api.set(+b.dataset.glass); autoSave(); }));
  $(id).addEventListener('keydown', e => {
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const rtl = document.documentElement.dir === 'rtl' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft');
    const v = Math.max(0, Math.min(steps.length - 1, api.value + (rtl ? -d : d)));
    api.set(v); steps[v].focus(); autoSave();
  });
  return api;
}
const glassStep = stepper('glass-steps');
const labelStep = stepper('label-size-steps'), taskStep = stepper('task-size-steps');
// Theme color: one swatch per accent — a radiogroup (one tab stop, arrows move it, RTL-aware)
const swatches = [...document.querySelectorAll('#accent-sw .swatch')];
let accentSel = 'blue';
function setAccent(a) {
  accentSel = a;
  swatches.forEach(b => { const on = b.dataset.accent === a; b.classList.toggle('sel', on); b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; });
}
swatches.forEach(b => b.addEventListener('click', () => { setAccent(b.dataset.accent); autoSave(); }));
$('accent-sw').addEventListener('keydown', e => {
  const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!d) return;
  e.preventDefault();
  const rtl = document.documentElement.dir === 'rtl' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft');
  const i = swatches.findIndex(b => b.dataset.accent === accentSel), n = (i + (rtl ? -d : d) + swatches.length) % swatches.length;
  setAccent(swatches[n].dataset.accent); swatches[n].focus(); autoSave();
});
// Theme: one tile per island theme, a radiogroup like the swatches
const bgTiles = [...document.querySelectorAll('#bg-sw .bgsw')];
let bgSel = 'mist';
function setBg(t) {
  bgSel = t;
  bgTiles.forEach(b => { const on = b.dataset.bg === t; b.classList.toggle('sel', on); b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; });
}
bgTiles.forEach(b => b.addEventListener('click', () => { setBg(b.dataset.bg); autoSave(); }));
$('bg-sw').addEventListener('keydown', e => {
  const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!d) return;
  e.preventDefault();
  const rtl = document.documentElement.dir === 'rtl' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft');
  const i = bgTiles.findIndex(b => b.dataset.bg === bgSel), n = (i + (rtl ? -d : d) + bgTiles.length) % bgTiles.length;
  setBg(bgTiles[n].dataset.bg); bgTiles[n].focus(); autoSave();
});
// Appearance: System / Light / Dark for every window (main sets nativeTheme.themeSource on save)
let appearSel = 'system';
function setAppear(v) {
  appearSel = v;
  document.querySelectorAll('#appear-seg .seg-btn').forEach(b => { const on = b.dataset.appear === v; b.classList.toggle('sel', on); b.setAttribute('aria-checked', on); });
}
document.querySelectorAll('#appear-seg .seg-btn').forEach(b => b.addEventListener('click', () => { setAppear(b.dataset.appear); autoSave(); }));
// Advanced settings: collapsed by default; the open/closed choice is remembered per viewer (a convenience only)
function setAdvanced(open) {
  $('set-advanced').hidden = !open; $('adv-toggle').setAttribute('aria-expanded', String(open));
  try { localStorage.setItem('ti-adv-open', open ? '1' : '0'); } catch (e) {}
}
$('adv-toggle').addEventListener('click', () => setAdvanced($('set-advanced').hidden));
try { setAdvanced(localStorage.getItem('ti-adv-open') === '1'); } catch (e) { setAdvanced(false); }
window.api.onLangChanged(lang => { LANG = lang; window.UI.setLang(LANG); window.I18N.applyDoc(LANG); refresh(); });
function fstat(id, msg, kind) {
  const el = document.querySelector(`.fstat[data-for="${id}"]`);
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'fstat' + (kind ? ' ' + kind : '');
}
const baseName = p => String(p || '').split(/[\\/]/).pop();
async function loadSettings() {
  const s = (await window.api.getSnapshot()).settings;
  glassStep.set(Number.isInteger(s.glassLevel) ? s.glassLevel : 3);
  labelStep.set(Number.isInteger(s.labelSize) ? s.labelSize : 1); taskStep.set(Number.isInteger(s.taskSize) ? s.taskSize : 1);
  setAccent(window.UI.ACCENTS.includes(s.accent) ? s.accent : 'blue');
  setBg(window.UI.BG_THEMES.includes(s.islandTheme) ? s.islandTheme : 'mist');
  setAppear(s.appearance || 'system');
  $('set-work-rem').checked = s.workRemindersOn !== false; $('set-work-interval').value = s.workIntervalMin;
  $('set-off-rem').checked = s.offRemindersOn !== false; $('set-off-interval').value = s.offIntervalMin;
  $('set-work-interval').disabled = !$('set-work-rem').checked; $('set-off-interval').disabled = !$('set-off-rem').checked;
  $('set-start').value = s.dayStart; $('set-end').value = s.dayEnd;
  $('set-dismiss').value = s.dismissSec; $('set-undo').value = s.undoSec; $('set-hover').value = s.hoverSec;
  setShortcut(s.shortcut);
  $('set-work').value = s.workPath; $('set-personal').value = s.personalPath;
  $('work-name').textContent = baseName(s.workPath); $('work-name').title = s.workPath;
  $('personal-name').textContent = baseName(s.personalPath); $('personal-name').title = s.personalPath;
  $('set-weekend').checked = !!s.weekendAware; $('set-weekend-days').value = s.weekendDays || 'auto'; $('set-autostart').checked = !!s.autoStart; $('set-sound').checked = !!s.soundOn; $('set-update').checked = s.updateCheck !== false;
  $('set-focus').checked = !!s.focusByTime;
  $('set-mode').value = s.mode || 'both';
  langSel = s.uiLang || 'system';
  document.querySelectorAll('#lang-seg .seg-btn').forEach(b => {
    const on = b.dataset.lang === langSel;
    b.classList.toggle('sel', on);
    b.setAttribute('aria-checked', on);
  });
  document.querySelectorAll('.fstat').forEach(el => { el.textContent = ''; el.className = 'fstat'; });
  document.querySelectorAll('#settings-form .invalid').forEach(el => el.classList.remove('invalid'));
}
$('tab-settings').addEventListener('click', async () => {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  $('tab-settings').classList.add('active');
  moveTabCursor();
  $('view-tasks').hidden = true; $('view-settings').hidden = false;
  await saveChain; await loadSettings(); // a save still in flight lands first, then the form shows what is stored
});
// 'change' = a switch/select flipped, or a typed field committed (Enter / leaving it) — never per keystroke
$('settings-form').addEventListener('change', () => autoSave());
// a schedule's interval input greys out while its toggle is off
for (const [t, i] of [['set-work-rem', 'set-work-interval'], ['set-off-rem', 'set-off-interval']]) {
  $(t).addEventListener('change', () => { $(i).disabled = !$(t).checked; });
}
document.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
  const box = $('edit-' + b.dataset.edit);
  box.hidden = !box.hidden;
  b.setAttribute('aria-expanded', !box.hidden);
  if (!box.hidden) box.querySelector('input').focus();
}));
$('btn-open-work').addEventListener('click', () => window.api.openNote('work'));
$('btn-open-personal').addEventListener('click', () => window.api.openNote('personal'));

// shortcut recorder — press the combo instead of typing Electron accelerator syntax
let shortcutValue = '', recording = false;
function setShortcut(v) { shortcutValue = v || ''; $('set-shortcut').textContent = shortcutValue || T('set.shortcut.none'); $('set-shortcut').classList.remove('rec'); recording = false; }
const KEYMAP = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc', '+': 'Plus' };
$('set-shortcut').addEventListener('click', () => {
  recording = true;
  $('set-shortcut').textContent = T('set.shortcut.rec');
  $('set-shortcut').classList.add('rec');
  fstat('set-shortcut', '');
});
$('set-shortcut').addEventListener('blur', () => { if (recording) setShortcut(shortcutValue); });
$('set-shortcut').addEventListener('keydown', e => {
  if (!recording) return;
  e.preventDefault(); e.stopPropagation();
  if (e.key === 'Escape') { setShortcut(shortcutValue); return; }
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return; // wait for the real key
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  const key = KEYMAP[e.key] || (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  if (!mods.length && !/^F\d{1,2}$/.test(key)) { fstat('set-shortcut', T('set.shortcut.ctrl'), 'warn'); return; }
  setShortcut([...mods, key].join('+'));
  autoSave();
});

function readNumber(id, min, max, fallback) { // clamps are announced at the field, never silent
  // a plain text field (a native number input draws the OS locale's digits): typed Arabic-Indic digits / separator read too
  const raw = $(id).value.trim().replace(/[٠-٩۰-۹]/g, c => String(c.charCodeAt(0) & 0xF)).replace(/[٫,]/g, '.');
  const n = raw === '' ? NaN : +raw;
  const v = Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  if (!Number.isFinite(n)) fstat(id, T('set.clamp.empty', { v }), 'warn');
  else if (v !== n) fstat(id, T(v === min ? 'set.clamp.min' : 'set.clamp.max', { v }), 'warn');
  $(id).value = v;
  return v;
}
function readTime(id, fallback) { // "930" / "9:30" / Arabic-Indic digits → "09:30"; an unreadable time keeps the old one, said at the field
  const v = window.UI.normTime($(id).value);
  if (!v) fstat(id, T('set.time.bad', { v: fallback }), 'warn');
  $(id).value = v || fallback;
  return v || fallback;
}
async function saveSettings() {
  document.querySelectorAll('.fstat').forEach(el => { el.textContent = ''; el.className = 'fstat'; });
  document.querySelectorAll('#settings-form .invalid').forEach(el => el.classList.remove('invalid'));
  const res = await window.api.saveSettings({
    workIntervalMin: readNumber('set-work-interval', 5, 240, 60),
    offIntervalMin: readNumber('set-off-interval', 5, 240, 60),
    workRemindersOn: $('set-work-rem').checked, offRemindersOn: $('set-off-rem').checked,
    dayStart: readTime('set-start', (snap && snap.settings.dayStart) || '09:00'), dayEnd: readTime('set-end', (snap && snap.settings.dayEnd) || '17:00'),
    dismissSec: readNumber('set-dismiss', 5, 600, 10),
    undoSec: readNumber('set-undo', 5, 120, 5),
    hoverSec: readNumber('set-hover', 0.5, 10, 1),
    shortcut: shortcutValue || 'Control+Alt+T',
    weekendAware: $('set-weekend').checked, weekendDays: $('set-weekend-days').value, autoStart: $('set-autostart').checked, soundOn: $('set-sound').checked, updateCheck: $('set-update').checked,
    focusByTime: $('set-focus').checked,
    mode: $('set-mode').value,
    uiLang: langSel,
    glassLevel: glassStep.value, accent: accentSel, islandTheme: bgSel, appearance: appearSel, labelSize: labelStep.value, taskSize: taskStep.value,
    workPath: $('set-work').value.trim() || undefined,
    personalPath: $('set-personal').value.trim() || undefined
  });
  await refresh(); // a Tasks mode change shows/hides tabs right away
  if (res && !res.ok) { // every error at once, each at its own field
    const idMap = { shortcut: 'set-shortcut', workPath: 'set-work', personalPath: 'set-personal' };
    const keys = Object.keys(res.errors);
    for (const k of keys) {
      const id = idMap[k];
      if (!id) continue;
      $(id).classList.add('invalid');
      fstat(id, /^set\.err\./.test(res.errors[k]) ? T(res.errors[k]) : res.errors[k], 'bad');
      if (k === 'workPath') $('edit-work').hidden = false;
      if (k === 'personalPath') $('edit-personal').hidden = false;
    }
    if (res.errors.shortcut) setShortcut((await window.api.getSnapshot()).settings.shortcut);
    statusFlash(T('set.save.partial'), 'bad'); // everything else was saved; the bad fields say why
    return false;
  }
  const s = (await window.api.getSnapshot()).settings;
  $('work-name').textContent = baseName(s.workPath); $('work-name').title = s.workPath;
  $('personal-name').textContent = baseName(s.personalPath); $('personal-name').title = s.personalPath;
  statusFlash(T('set.save.saved'));
  return true;
}
// a short message in the status line's write slot, then back to the last note write
let flashT = null;
function statusFlash(msg, kind) {
  const el = $('st-write');
  clearTimeout(flashT);
  el.textContent = msg; el.classList.toggle('bad', kind === 'bad');
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  flashT = setTimeout(() => { el.classList.remove('bad'); renderLastWrite(); }, 2200);
}

// ---- small notices (honest one-liners: "Can't undo — note changed", etc.) ----
let noticeT = null;
function notice(msg, kind) {
  const el = $('notice');
  el.textContent = msg;
  el.className = 'notice' + (kind ? ' ' + kind : '');
  el.hidden = false;
  clearTimeout(noticeT);
  noticeT = setTimeout(() => { el.hidden = true; }, 4000);
}

// undo toast — shared UndoUI component; each action carries its own token, countdown end releases the entry
window.api.onShowUndo(d => {
  window.UI.mountUndo($('undo-toast'), d, {
    onExpire: token => window.api.undoExpire(token),
    onUndo: async token => {
      window.SFX.play('undo');
      freshFrom = visibleIds();
      const r = await window.api.undoAction(token);
      if (r && !r.ok) {
        freshFrom = null;
        notice(r.reason === 'changed' ? `Can't undo — ${r.files.join(', ')} changed since.` : 'Undo expired.', 'bad');
      }
      if (r && r.ok && d.kind === 'settings') { await loadSettings(); } // a settings reset came back — re-fill the form
    }
  });
});

window.api.onTasksChanged(refresh);
refresh();
