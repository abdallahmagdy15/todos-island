'use strict';
let snap = null, currentTab = 'work';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bangCls = p => ({ '!!!': 'p3', '!!': 'p2', '!': 'p1' }[p] || 'p0');
const $ = id => document.getElementById(id);

function taskRows() {
  const sec = snap.sections.find(s => (currentTab === 'work' ? s.name === 'Work' : s.name === 'Personal'));
  return sec ? sec.items : [];
}

const openRows = new Set(); // expanded rows survive refreshes
function matches(t, q) {
  return !q || t.title.toLowerCase().includes(q)
    || t.subs.some(s => s.t.toLowerCase().includes(q))
    || (t.notes || []).some(n => n.toLowerCase().includes(q));
}
function renderDone(q) { // Done tab: read-only, both files, restore only
  const items = (snap.done || []).filter(d => !q || d.title.toLowerCase().includes(q));
  $('task-list').innerHTML = items.map(d => `
    <div class="wrow done" data-id="${esc(d.id)}" data-file="${d.file}">
      <span class="dbadge">${d.file === 'work' ? 'Work' : 'Personal'}</span>
      <div class="wrow-main"><span class="wtitle">${esc(d.title)}</span></div>
      ${d.dueText ? `<span class="wdue">${esc(d.dueText)}</span>` : ''}
      <button class="btn-soft sm" data-restore="${esc(d.id)}" data-file="${d.file}" type="button">Restore</button>
    </div>`).join('') || `<p class="empty">${q ? 'No matches.' : 'Nothing done yet.'}</p>`;
}
function renderList() {
  const q = $('search').value.trim().toLowerCase();
  if (currentTab === 'done') { renderDone(q); return; }
  const rows = taskRows().filter(t => matches(t, q));
  $('task-list').innerHTML = rows.map(t => {
    const open = openRows.has(t.id);
    const expandBody = open ? `<div class="wexp-body">
      ${(t.notes || []).map(n => `<div class="wdesc">${esc(n)}</div>`).join('')}
      ${t.subs.map(s => `<div class="wsubrow ${s.done ? 'done' : ''}" data-sub="${esc(s.t)}" data-file="${t.file}" data-parent="${esc(t.id)}">${s.done ? '&#10003;' : '&#9634;'} ${esc(s.t)}</div>`).join('')}
    </div>` : '';
    return `
    <div class="wrow ${open ? 'open' : ''}" data-id="${esc(t.id)}" data-file="${t.file}" role="button" tabindex="0" aria-label="${esc(t.title)}" draggable="true">
      <span class="chk" data-chk="${esc(t.id)}" data-file="${t.file}" role="button" tabindex="0" aria-label="Complete task"><svg class="ic" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></span>
      <span class="bang ${bangCls(t.priority)}">${t.priority ? esc(t.priority) : ''}</span>
      ${t.active ? '<span class="wstar">&#9733;</span>' : ''}
      <div class="wrow-main">
        <span class="wtitle">${esc(t.title)}</span>
        ${expandBody}
        ${!open && t.subs.length ? `<div class="wsub">${t.subs.filter(s => !s.done).length}/${t.subs.length} subtasks</div>` : ''}
      </div>
      ${t.dueText ? `<span class="wdue ${t.dueState === 'today' ? 'today' : t.dueState === 'overdue' ? 'overdue' : ''}">${esc(t.dueText)}</span>` : ''}
      ${(t.notes || []).length || t.subs.length ? `<button class="wexp ${open ? 'open' : ''}" data-exp="${esc(t.id)}" title="${open ? 'Collapse' : 'Expand'}" aria-label="${open ? 'Collapse task' : 'Expand task'}"><svg class="ic" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>` : ''}
      <button class="wtrash" data-del="${esc(t.id)}" data-file="${t.file}" type="button" title="Delete" aria-label="Delete task"><svg class="ic" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg></button>
    </div>`;
  }).join('') || `<p class="empty">${q ? 'No matches.' : 'Nothing open here. Nice.'}</p>`;
}

function updateTabCounts() {
  const n = name => { const s = snap.sections.find(x => x.name === name); return s ? s.items.length : 0; };
  $('tab-work').textContent = `Work (${n('Work')})`;
  $('tab-personal').textContent = `Personal (${n('Personal')})`;
  $('tab-done').textContent = `Done (${(snap.done || []).length})`;
}

async function refresh() {
  snap = await window.api.getSnapshot();
  if (snap && snap.settings) window.SFX.enabled = !!snap.settings.soundOn;
  updateTabCounts();
  renderList();
}

$('task-list').addEventListener('click', onListAction);
$('task-list').addEventListener('keydown', async e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target.matches('[data-chk], [data-exp]')) { e.preventDefault(); onListAction(e); }
});
async function onListAction(e) {
  const chk = e.target.closest('[data-chk]');
  if (chk) { window.SFX.play('complete'); await window.api.complete(chk.dataset.chk, chk.dataset.file); await refresh(); return; }
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
// drag & drop reorder — hold a row, drop it on another (inserts before the target)
let dragId = null;
$('task-list').addEventListener('dragstart', e => {
  const row = e.target.closest('.wrow');
  if (!row || row.classList.contains('done')) { e.preventDefault(); return; }
  dragId = row.dataset.id;
  row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
});
$('task-list').addEventListener('dragover', e => {
  if (!dragId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
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

let newPrio = null;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const today = new Date();
function setDefaultDue() { // every form opens with sensible defaults: today's day + current month
  $('new-day').value = today.getDate();
  $('new-month').value = MONTHS[today.getMonth()];
}
$('new-prio').innerHTML = ['', '!', '!!', '!!!'].map(p =>
  `<button class="chip ${p === '' ? 'sel' : ''}" data-p="${p}" type="button">${p || '—'}</button>`).join('');
$('new-prio').querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
  $('new-prio').querySelectorAll('.chip').forEach(x => x.classList.remove('sel'));
  c.classList.add('sel'); newPrio = c.dataset.p || null;
}));
$('new-month').innerHTML = '<option value="">Month…</option>' + MONTHS.map(m => `<option>${m}</option>`).join('');
setDefaultDue();
$('btn-today').addEventListener('click', () => { $('new-day').value = today.getDate(); $('new-month').value = MONTHS[today.getMonth()]; });
$('btn-tomorrow').addEventListener('click', () => { // Date normalizes the rollover; MONTHS picks the right label
  const tmr = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  $('new-day').value = tmr.getDate();
  $('new-month').value = MONTHS[tmr.getMonth()];
});
$('search').addEventListener('input', renderList);
const MAX_TA = 212; // ≈ 10 visible lines, scrolls inside beyond
function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, MAX_TA) + 'px'; }
$('new-title').addEventListener('input', () => autoGrow($('new-title')));
$('new-title').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('btn-add').click(); } // Enter adds, Shift+Enter newlines
});
$('btn-add').addEventListener('click', async () => {
  const lines = $('new-title').value.split('\n').map(l => l.trim());
  const title = lines[0] || '';
  if (!title) return;
  const desc = lines.slice(1).filter(Boolean);
  const day = $('new-day').value.trim(), month = $('new-month').value;
  await window.api.addTask(currentTab, {
    title, priority: newPrio, desc,
    dueText: day && month ? `${day} ${month}` : null
  });
  window.SFX.play('add');
  $('new-title').value = ''; autoGrow($('new-title'));
  setDefaultDue();
  $('new-title').focus();
  await refresh();
});

for (const [id, tab] of [['tab-work', 'work'], ['tab-personal', 'personal'], ['tab-done', 'done']]) {
  $(id).addEventListener('click', () => {
    currentTab = tab;
    localStorage.setItem('ti-tab', tab); // remember where you left off
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    $(id).classList.add('active');
    $('view-tasks').hidden = false; $('view-settings').hidden = true;
    renderList();
  });
}
{ // restore last tab
  const saved = localStorage.getItem('ti-tab');
  if (saved === 'personal' || saved === 'done') $(saved === 'personal' ? 'tab-personal' : 'tab-done').click();
}
$('tab-settings').addEventListener('click', async () => {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  $('tab-settings').classList.add('active');
  $('view-tasks').hidden = true; $('view-settings').hidden = false;
  const s = (await window.api.getSnapshot()).settings;
  $('set-interval').value = s.intervalMin; $('set-start').value = s.dayStart; $('set-end').value = s.dayEnd;
  $('set-dismiss').value = s.dismissSec; $('set-undo').value = s.undoSec; $('set-hover').value = s.hoverSec;
  $('set-shortcut').value = s.shortcut; $('set-work').value = s.workPath; $('set-personal').value = s.personalPath;
  $('set-weekend').checked = !!s.weekendAware; $('set-autostart').checked = !!s.autoStart; $('set-sound').checked = !!s.soundOn;
});
$('btn-open-work').addEventListener('click', () => window.api.openNote('work'));
$('btn-open-personal').addEventListener('click', () => window.api.openNote('personal'));
$('btn-clear-done').addEventListener('click', async () => {
  if (!confirm('Remove ALL completed tasks from both notes? This cannot be undone.')) return;
  await window.api.clearDone('work');
  await window.api.clearDone('personal');
  refresh();
});
$('btn-save-settings').addEventListener('click', async () => {
  for (const id of ['set-shortcut', 'set-work', 'set-personal']) $(id).classList.remove('invalid');
  $('set-err').hidden = true;
  const res = await window.api.saveSettings({
    intervalMin: Math.max(5, Math.min(240, +$('set-interval').value || 30)),
    dayStart: $('set-start').value || '09:00', dayEnd: $('set-end').value || '17:00',
    dismissSec: Math.max(5, Math.min(600, +$('set-dismiss').value || 45)),
    undoSec: Math.max(5, Math.min(120, +$('set-undo').value || 30)),
    hoverSec: Math.max(0.5, Math.min(10, +$('set-hover').value || 2)),
    shortcut: $('set-shortcut').value.trim() || 'Control+Alt+T',
    weekendAware: $('set-weekend').checked, autoStart: $('set-autostart').checked, soundOn: $('set-sound').checked,
    workPath: $('set-work').value.trim() || undefined,
    personalPath: $('set-personal').value.trim() || undefined
  });
  if (res && !res.ok) {
    const key = Object.keys(res.errors)[0];
    const idMap = { shortcut: 'set-shortcut', workPath: 'set-work', personalPath: 'set-personal' };
    if (idMap[key]) $(idMap[key]).classList.add('invalid');
    $('set-err').textContent = res.errors[key];
    $('set-err').hidden = false;
    return;
  }
  $('set-saved').hidden = false;
  setTimeout(() => { $('set-saved').hidden = true; }, 1500);
});

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
  const verb = d.kind === 'delete' ? 'Deleted' : d.kind === 'toggle' ? (d.starring ? 'Starred' : 'Unstarred') : d.kind === 'reorder' ? 'Reordered' : 'Completed';
  toast.innerHTML = `<span class="undo-label">${verb}: ${esc(d.label)}</span>
    <button data-undo type="button">Undo</button><span class="undo-count">${left}s</span>
    <span class="undo-progress"><span class="undo-fill"></span></span>`;
  toast.hidden = false;
  runUndoToastProgress(left * 1000);
  toast.querySelector('[data-undo]').addEventListener('click', async () => {
    window.SFX.play('undo');
    await window.api.undoAction(d.token);
    toast.hidden = true; clearInterval(undoToastT);
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
