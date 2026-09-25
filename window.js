'use strict';
let snap = null, currentTab = 'work';

const { esc, bangCls } = window.UI;
const $ = id => document.getElementById(id);

function taskRows() {
  if (!snap) return [];
  const sec = snap.sections.find(s => (currentTab === 'work' ? s.name === 'Work' : s.name === 'Personal'));
  return sec ? sec.items : [];
}

const openRows = new Set(); // expanded rows survive refreshes
let freshFrom = null; // ids present before an add/undo — rows not in it get the "fresh ink" settle
let prevNow = null; // ids that were Now last render — newly-Now titles get the highlighter swipe
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
    <div class="wrow done" data-id="${esc(d.id)}" data-file="${d.file}">
      <span class="ftag">${d.file === 'work' ? 'work' : 'personal'}</span>
      <div class="wrow-main"><span class="wtitle"><span class="tt">${esc(d.title)}</span></span></div>
      ${d.dueText ? `<span class="wdue">${esc(d.dueText)}</span>` : ''}
      <button class="btn-soft sm" data-restore="${esc(d.id)}" data-file="${d.file}" type="button">Restore</button>
      <button class="wtrash" data-del="${esc(d.id)}" data-file="${d.file}" type="button" title="Delete" aria-label="Delete completed task"><svg class="ic" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg></button>
    </div>`).join('') || `<p class="empty">${q ? 'No matches.' : 'Nothing done yet.'}</p>`;
}
function renderList() {
  if (!snap) return; // first snapshot not in yet (tab restore runs before refresh resolves)
  const q = $('search').value.trim().toLowerCase();
  const isDone = currentTab === 'done';
  $('done-head').hidden = !isDone;
  $('composer').hidden = isDone; // nothing to add to the Done list
  if (isDone) { renderDone(q); markFresh(); return; }
  const all = taskRows();
  const rows = all.filter(t => matches(t, q));
  $('search-count').textContent = q ? `${rows.length} / ${all.length}` : '';
  $('task-list').innerHTML = rows.map(t => {
    const open = openRows.has(t.id);
    const expandBody = open ? `<div class="wexp-body">
      ${(t.notes || []).map(n => `<div class="wdesc">${esc(n)}</div>`).join('')}
      ${t.subs.map(s => `<div class="wsubrow ${s.done ? 'done' : ''}" data-sub="${esc(s.t)}" data-file="${t.file}" data-parent="${esc(t.id)}">${s.done ? '&#10003;' : '&#9634;'} ${esc(s.t)}</div>`).join('')}
    </div>` : '';
    return `
    <div class="fold"><div class="fold-in"><div class="wrow ${open ? 'open' : ''} ${t.active ? 'is-now' : ''}" data-id="${esc(t.id)}" data-file="${t.file}" role="button" tabindex="0" aria-label="${esc(t.title)}" draggable="true">
      <span class="chk" data-chk="${esc(t.id)}" data-file="${t.file}" role="button" tabindex="0" aria-label="Complete task"><svg class="ic" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></span>
      <span class="bang ${bangCls(t.priority)}">${t.priority ? esc(t.priority) : ''}</span>
      ${t.active ? '<span class="wstar">&#9733;</span>' : ''}
      <div class="wrow-main">
        <span class="wtitle">${t.active ? `<span class="hl"><span class="tt">${esc(t.title)}</span></span>` : `<span class="tt">${esc(t.title)}</span>`}</span>
        ${expandBody}
        ${!open && t.subs.length ? `<div class="wsub">${t.subs.filter(s => !s.done).length}/${t.subs.length} subtasks</div>` : ''}
      </div>
      ${t.dueText ? `<span class="wdue ${t.dueState === 'today' ? 'today' : t.dueState === 'overdue' ? 'overdue' : ''}">${esc(t.dueText)}</span>` : ''}
      ${(t.notes || []).length || t.subs.length ? `<button class="wexp ${open ? 'open' : ''}" data-exp="${esc(t.id)}" title="${open ? 'Collapse' : 'Expand'}" aria-label="${open ? 'Collapse task' : 'Expand task'}"><svg class="ic" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>` : ''}
      <button class="wtrash" data-del="${esc(t.id)}" data-file="${t.file}" type="button" title="Delete" aria-label="Delete task"><svg class="ic" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg></button>
    </div></div></div>`;
  }).join('') || emptyState(q);
  markFresh();
  // M2 — a task that just became Now gets the highlighter swipe behind its title
  const nowIds = new Set(all.filter(t => t.active).map(t => t.id));
  if (prevNow && prevNow.tab === currentTab) {
    for (const id of nowIds) {
      if (prevNow.ids.has(id)) continue;
      const hl = document.querySelector(`#task-list .wrow[data-id="${CSS.escape(id)}"] .hl`);
      window.Motion.play(hl, [{ backgroundSize: '0% 72%' }, { backgroundSize: '100% 72%' }], { duration: 260, fill: 'none' });
    }
  }
  prevNow = { tab: currentTab, ids: nowIds };
}
function emptyState(q) { // honest: a missing note is "unavailable", never "Nice."
  if (q) return '<p class="empty">No matches.</p>';
  const err = fileErr(currentTab);
  if (err) return `<p class="empty bad">${currentTab === 'work' ? 'Work' : 'Personal'} tasks unavailable — <code>${esc(err.name || err.path)}</code> can't be read.</p>`;
  return '<p class="empty">Nothing open here. Nice.</p>';
}
function markFresh() { // M5 — rows that just appeared (after add / undo) settle in with a fading highlight
  if (!freshFrom) return;
  const before = freshFrom; freshFrom = null;
  document.querySelectorAll('#task-list .wrow').forEach(r => { if (!before.has(r.dataset.id)) r.classList.add('fresh'); });
}
const visibleIds = () => new Set([...document.querySelectorAll('#task-list .wrow')].map(r => r.dataset.id));

function updateTabCounts() {
  if (!snap) return;
  const n = name => { const s = snap.sections.find(x => x.name === name); return s ? s.items.length : 0; };
  const label = (tag, name) => fileErr(tag) ? `${name} \u00B7!` : `${name} (${n(name)})`; // a broken source never reads as (0)
  $('tab-work').textContent = label('work', 'Work');
  $('tab-personal').textContent = label('personal', 'Personal');
  $('tab-done').textContent = `Done (${(snap.done || []).length})`;
}
function renderChrome() { // status mark, error strip, status line — the notes-are-the-state layer
  const errs = snap.errors || [];
  const nowCount = snap.sections.flatMap(s => s.items).filter(t => t.active).length;
  const mark = $('mark');
  mark.textContent = errs.length ? '[!]' : nowCount ? '[\u2605]' : '[ ]';
  mark.className = 'mark' + (errs.length ? ' err' : nowCount ? ' now' : '');
  mark.title = errs.length ? 'A note can\'t be read' : nowCount ? `${nowCount} task${nowCount === 1 ? '' : 's'} Now` : 'Nothing marked Now';
  const strip = $('err-strip');
  strip.hidden = !errs.length;
  strip.innerHTML = errs.map(e => `<span>Can't read <code>${esc(e.name || e.path)}</code> — moved or renamed?</span>`).join('') +
    (errs.length ? '<button class="btn-soft sm" data-retry type="button">Retry</button><button class="btn-accent sm" data-open-settings type="button">Open settings</button>' : '');
  const src = snap.sources || {};
  $('st-src').innerHTML = ['work', 'personal'].map(tag =>
    `<span class="${fileErr(tag) ? 'bad' : ''}">${esc(src[tag] || tag)}</span>`).join(' \u00B7 ');
  renderLastWrite();
}
const ago = ms => ms < 45e3 ? 'just now' : ms < 3600e3 ? `${Math.round(ms / 60e3)}m ago` : ms < 86400e3 ? `${Math.round(ms / 3600e3)}h ago` : `${Math.round(ms / 86400e3)}d ago`;
let lastSeenWrite = 0;
function renderLastWrite() {
  const lw = snap && snap.lastWrite;
  const el = $('st-write');
  if (!lw) { el.textContent = 'no writes this session'; return; }
  el.textContent = `last write ${lw.file} \u00B7 ${ago(Date.now() - lw.at)}`;
  if (lw.at !== lastSeenWrite) { // M8-style flash: a write just landed in the note
    const first = !lastSeenWrite; lastSeenWrite = lw.at;
    if (!first) { el.textContent = `wrote ${lw.file}`; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }
}
setInterval(() => { if (snap) renderLastWrite(); }, 30e3);

async function refresh() {
  if (animating) { refreshPending = true; return; }
  snap = await window.api.getSnapshot();
  if (snap && snap.settings) window.SFX.enabled = !!snap.settings.soundOn;
  updateTabCounts();
  renderChrome();
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
$('task-list').addEventListener('keydown', async e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target.matches('[data-chk], [data-exp]')) { e.preventDefault(); onListAction(e); }
});
async function onListAction(e) {
  const chk = e.target.closest('[data-chk]');
  if (chk) { if (!chk.classList.contains('checked')) completeWithInk(chk); return; }
  const exp = e.target.closest('[data-exp]');
  if (exp) {
    window.SFX.play('tick');
    const id = exp.dataset.exp;
    openRows.has(id) ? openRows.delete(id) : openRows.add(id);
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
let dragId = null;
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
  document.querySelectorAll('.wrow.drop-above').forEach(r => r.classList.remove('drop-above'));
  if (over && over.dataset.id !== dragId) over.classList.add('drop-above');
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
  $('new-preview').hidden = !r.ok;
  $('new-preview-line').textContent = r.line || '';
  return r;
}
function resetComposer() {
  $('new-title').value = ''; autoGrow($('new-title'));
  composer.prio = undefined; composer.due = undefined; composer.result = null;
  prioCtl.set(null); dueCtl.set(null);
  $('new-preview').hidden = true;
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
  if (e.key !== '/' || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (!$('view-tasks').hidden) { e.preventDefault(); $('search').focus(); }
});
const MAX_TA = 212; // ≈ 10 visible lines, scrolls inside beyond
function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, MAX_TA) + 'px'; }
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
    composerHint('Type a title first.');
    window.Motion.nudge($('new-title'));
    $('new-title').focus();
    return;
  }
  let res = null;
  try { res = await window.api.addTask(currentTab, { title: r.title, priority: r.priority, desc: r.desc, dueText: r.dueText, active: r.active }); } catch (err) {}
  if (!res || !res.ok) { composerHint("Couldn't add — the note can't be read."); return; }
  window.SFX.play('add');
  freshFrom = visibleIds();
  resetComposer();
  $('new-title').focus();
  await refresh();
});

// ---- tabs (Settings guards unsaved edits instead of silently dropping them) ----
let pendingTab = null;
function showTab(tab) {
  currentTab = tab;
  localStorage.setItem('ti-tab', tab); // remember where you left off
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  $('tab-' + tab).classList.add('active');
  $('view-tasks').hidden = false; $('view-settings').hidden = true;
  $('dirty-guard').hidden = true;
  renderList();
}
for (const tab of ['work', 'personal', 'done']) {
  $('tab-' + tab).addEventListener('click', () => {
    if (settingsDirty && !$('view-settings').hidden) { pendingTab = tab; $('dirty-guard').hidden = false; $('guard-save').focus(); return; }
    showTab(tab);
  });
}
{ // restore last tab (or the one the island asked for)
  const asked = new URLSearchParams(location.search).get('tab');
  const saved = localStorage.getItem('ti-tab');
  if (asked === 'settings') setTimeout(() => $('tab-settings').click(), 0);
  else if (saved === 'personal' || saved === 'done') showTab(saved);
}
window.api.onShowTab(tab => { if (tab === 'settings') $('tab-settings').click(); else if (['work', 'personal', 'done'].includes(tab)) $('tab-' + tab).click(); });

// ---- settings: manual Save, visible dirty state, every error and clamp shown at its own field ----
let settingsDirty = false;
function setDirty(on) {
  settingsDirty = on;
  $('settings-dirty').hidden = !on;
  $('set-dirty-note').hidden = !on;
  $('btn-save-settings').classList.toggle('attn', on);
  if (on) $('set-saved').hidden = true;
}
function fstat(id, msg, kind) {
  const el = document.querySelector(`.fstat[data-for="${id}"]`);
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'fstat' + (kind ? ' ' + kind : '');
}
const baseName = p => String(p || '').split(/[\\/]/).pop();
async function loadSettings() {
  const s = (await window.api.getSnapshot()).settings;
  $('set-work-rem').checked = s.workRemindersOn !== false; $('set-work-interval').value = s.workIntervalMin;
  $('set-off-rem').checked = s.offRemindersOn !== false; $('set-off-interval').value = s.offIntervalMin;
  $('set-work-interval').disabled = !$('set-work-rem').checked; $('set-off-interval').disabled = !$('set-off-rem').checked;
  $('set-start').value = s.dayStart; $('set-end').value = s.dayEnd;
  $('set-dismiss').value = s.dismissSec; $('set-undo').value = s.undoSec; $('set-hover').value = s.hoverSec;
  setShortcut(s.shortcut);
  $('set-work').value = s.workPath; $('set-personal').value = s.personalPath;
  $('work-name').textContent = baseName(s.workPath); $('work-name').title = s.workPath;
  $('personal-name').textContent = baseName(s.personalPath); $('personal-name').title = s.personalPath;
  $('set-weekend').checked = !!s.weekendAware; $('set-autostart').checked = !!s.autoStart; $('set-sound').checked = !!s.soundOn;
  $('set-focus').checked = !!s.focusByTime;
  document.querySelectorAll('.fstat').forEach(el => { el.textContent = ''; el.className = 'fstat'; });
  document.querySelectorAll('#settings-form .invalid').forEach(el => el.classList.remove('invalid'));
  $('set-err').hidden = true;
  setDirty(false);
}
$('tab-settings').addEventListener('click', async () => {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  $('tab-settings').classList.add('active');
  $('view-tasks').hidden = true; $('view-settings').hidden = false;
  if (!settingsDirty) await loadSettings(); // coming back to unsaved edits keeps them
});
$('settings-form').addEventListener('input', () => setDirty(true));
$('settings-form').addEventListener('change', () => setDirty(true));
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
function setShortcut(v) { shortcutValue = v || ''; $('set-shortcut').textContent = shortcutValue || 'None'; $('set-shortcut').classList.remove('rec'); recording = false; }
const KEYMAP = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc', '+': 'Plus' };
$('set-shortcut').addEventListener('click', () => {
  recording = true;
  $('set-shortcut').textContent = 'Press keys…';
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
  if (!mods.length && !/^F\d{1,2}$/.test(key)) { fstat('set-shortcut', 'Add Ctrl or Alt', 'warn'); return; }
  setShortcut([...mods, key].join('+'));
  setDirty(true);
});

function readNumber(id, min, max, fallback) { // clamps are announced at the field, never silent
  const raw = $(id).value.trim();
  const n = raw === '' ? NaN : +raw;
  const v = Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  if (!Number.isFinite(n)) fstat(id, `→ ${v} (was empty)`, 'warn');
  else if (v !== n) fstat(id, `→ ${v} (${v === min ? 'min' : 'max'})`, 'warn');
  $(id).value = v;
  return v;
}
async function saveSettings() {
  document.querySelectorAll('.fstat').forEach(el => { el.textContent = ''; el.className = 'fstat'; });
  document.querySelectorAll('#settings-form .invalid').forEach(el => el.classList.remove('invalid'));
  $('set-err').hidden = true;
  const res = await window.api.saveSettings({
    workIntervalMin: readNumber('set-work-interval', 5, 240, 30),
    offIntervalMin: readNumber('set-off-interval', 5, 240, 60),
    workRemindersOn: $('set-work-rem').checked, offRemindersOn: $('set-off-rem').checked,
    dayStart: $('set-start').value || '09:00', dayEnd: $('set-end').value || '17:00',
    dismissSec: readNumber('set-dismiss', 5, 600, 45),
    undoSec: readNumber('set-undo', 5, 120, 30),
    hoverSec: readNumber('set-hover', 0.5, 10, 2),
    shortcut: shortcutValue || 'Control+Alt+T',
    weekendAware: $('set-weekend').checked, autoStart: $('set-autostart').checked, soundOn: $('set-sound').checked,
    focusByTime: $('set-focus').checked,
    workPath: $('set-work').value.trim() || undefined,
    personalPath: $('set-personal').value.trim() || undefined
  });
  if (res && !res.ok) { // every error at once, each at its own field
    const idMap = { shortcut: 'set-shortcut', workPath: 'set-work', personalPath: 'set-personal' };
    const keys = Object.keys(res.errors);
    for (const k of keys) {
      const id = idMap[k];
      if (!id) continue;
      $(id).classList.add('invalid');
      fstat(id, res.errors[k], 'bad');
      if (k === 'workPath') $('edit-work').hidden = false;
      if (k === 'personalPath') $('edit-personal').hidden = false;
    }
    $('set-err').textContent = keys.length === 1 ? 'One setting needs fixing — the rest were saved.' : `${keys.length} settings need fixing — the rest were saved.`;
    $('set-err').hidden = false;
    if (res.errors.shortcut) setShortcut((await window.api.getSnapshot()).settings.shortcut);
    setDirty(true);
    return false;
  }
  const s = (await window.api.getSnapshot()).settings;
  $('work-name').textContent = baseName(s.workPath); $('work-name').title = s.workPath;
  $('personal-name').textContent = baseName(s.personalPath); $('personal-name').title = s.personalPath;
  setDirty(false);
  $('set-saved').hidden = false;
  setTimeout(() => { $('set-saved').hidden = true; }, 1500);
  return true;
}
$('btn-save-settings').addEventListener('click', saveSettings);
$('guard-save').addEventListener('click', async () => { if (await saveSettings() && pendingTab) showTab(pendingTab); pendingTab = null; });
$('guard-discard').addEventListener('click', () => { setDirty(false); if (pendingTab) showTab(pendingTab); pendingTab = null; });

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

// undo toast — each action carries its own token; countdown end releases the entry from memory
let undoToastT = null;
function runUndoToastProgress(ms) {
  const fill = document.querySelector('#undo-toast .undo-fill');
  if (!fill) return;
  fill.style.transition = 'none';
  fill.style.width = '100%';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fill.style.transition = `width ${ms}ms linear`;
    fill.style.width = '0%';
  }));
}
window.api.onShowUndo(d => {
  const toast = $('undo-toast');
  clearInterval(undoToastT);
  let left = d.left;
  toast.innerHTML = `<span class="undo-label">${esc(window.UI.undoText(d))}</span>
    <button data-undo type="button">Undo</button><span class="undo-count">${left}s</span>
    <span class="undo-progress"><span class="undo-fill"></span></span>`;
  toast.hidden = false;
  runUndoToastProgress(left * 1000);
  toast.querySelector('[data-undo]').addEventListener('click', async () => {
    window.SFX.play('undo');
    freshFrom = visibleIds();
    toast.hidden = true; clearInterval(undoToastT);
    const r = await window.api.undoAction(d.token);
    if (r && !r.ok) {
      freshFrom = null;
      notice(r.reason === 'changed' ? `Can't undo — ${r.files.join(', ')} changed since.` : 'Undo expired.', 'bad');
    }
  });
  undoToastT = setInterval(() => {
    left--;
    const c = toast.querySelector('.undo-count');
    if (left <= 0) { toast.hidden = true; clearInterval(undoToastT); window.api.undoExpire(d.token); } // bubble gone → log entry released
    else if (c) c.textContent = left + 's';
  }, 1000);
});

window.api.onTasksChanged(refresh);
refresh();
