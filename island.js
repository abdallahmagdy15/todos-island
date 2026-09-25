'use strict';
let snap = null, expanded = false, pinned = false;
let dismissT = null, remainMs = 0, dismissEnd = 0;
let islandHovered = false; // cursor anywhere on the pill → countdown frozen, whatever re-renders happen
let undoT = null, undoLeft = 0;

const bangCls = p => ({ '!!!': 'p3', '!!': 'p2', '!': 'p1' }[p] || 'p0');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function dueHtml(t) {
  if (!t.dueText) return '';
  const cls = t.dueState === 'today' ? 'due today' : t.dueState === 'overdue' ? 'due overdue' : 'due';
  const label = t.dueState === 'today' ? 'Today' : t.dueText;
  return `<span class="${cls}">${esc(label)}</span>`;
}
function rowHtml(t) {
  const subsBadge = t.subs.length ? `<span class="row-sub">${t.subs.filter(s => !s.done).length}/${t.subs.length} steps</span>` : '';
  const hasDetail = (t.notes && t.notes.length) || t.subs.length;
  const detail = hasDetail
    ? `<div class="row-detail">${(t.notes || []).map(n => `<div class="rd-note">${esc(n)}</div>`).join('')}${t.subs.map(s => `<div class="${s.done ? 'done' : ''}" data-sub="${esc(s.t)}">${s.done ? '&#10003;' : '&#9634;'} ${esc(s.t)}</div>`).join('')}</div>` : '';
  return `<div class="row" data-id="${esc(t.id)}" data-file="${t.file}" draggable="true">
    <span class="bang ${bangCls(t.priority)}">${t.priority ? esc(t.priority) : ''}</span>
    <div class="row-main"><span class="rtitle">${esc(t.title)}</span>${detail}</div>
    ${subsBadge}${dueHtml(t)}
  </div>`;
}

function scheduleDismiss(ms) {
  clearTimeout(dismissT);
  const bar = document.getElementById('progress-fill');
  bar.style.transition = 'none';
  bar.style.width = '100%';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bar.style.transition = `width ${ms}ms linear`;
    bar.style.width = '0%';
  }));
  dismissEnd = Date.now() + ms;
  dismissT = setTimeout(() => { if (!pinned) window.api.hide(); }, ms);
}
function pauseDismiss() {
  clearTimeout(dismissT);
  remainMs = Math.max(0, dismissEnd - Date.now());
  const bar = document.getElementById('progress-fill');
  const px = bar.offsetWidth;
  const full = bar.parentElement.offsetWidth;
  bar.style.transition = 'none';
  bar.style.width = full ? (px / full * 100) + '%' : '0%';
}

function undoTextFor(u) {
  const verb = u.kind === 'delete' ? 'Deleted' : u.kind === 'toggle' ? (u.starring ? 'Starred' : 'Unstarred') : u.kind === 'reorder' ? 'Reordered' : 'Completed';
  return `${verb}: ${u.label}`;
}
function renderUndo() {
  const bar = document.getElementById('undo-bar');
  clearInterval(undoT);
  clearTimeout(undoEndT);
  if (!snap.undo) { bar.hidden = true; return; }
  const myToken = snap.undo.token;
  undoLeft = snap.undo.left;
  bar.innerHTML = `<span class="undo-label">${esc(undoTextFor(snap.undo))}</span>
    <button data-undo>Undo</button><span class="undo-count">${undoLeft}s</span>
    <span class="undo-progress"><span class="undo-fill"></span></span>`;
  bar.hidden = false;
  runUndoProgress(undoLeft * 1000);
  bar.querySelector('[data-undo]').addEventListener('click', () => {
    window.SFX.play('undo');
    window.api.undoAction(myToken);
    bar.hidden = true; clearInterval(undoT); clearTimeout(undoEndT);
  });
  undoT = setInterval(() => {
    undoLeft--;
    const c = bar.querySelector('.undo-count');
    if (undoLeft <= 0) { bar.hidden = true; clearInterval(undoT); window.api.undoExpire(myToken); } // bubble gone → memory released
    else if (c) c.textContent = undoLeft + 's';
  }, 1000);
}
// countdown bar — drains over the undo window, always ticking (hover-pause is a dismiss-bar-only idea)
let undoEndT = null;
function runUndoProgress(ms) {
  const fill = document.querySelector('#undo-bar .undo-fill');
  if (!fill) return;
  fill.style.transition = 'none';
  fill.style.width = '100%';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fill.style.transition = `width ${ms}ms linear`;
    fill.style.width = '0%';
  }));
  clearTimeout(undoEndT);
  undoEndT = setTimeout(() => { document.getElementById('undo-bar').hidden = true; clearInterval(undoT); }, ms);
}

function render() {
  if (!snap) return;
  const hoverRowId = hoverRow ? hoverRow.dataset.id : null;
  clearTimeout(hoverT); hoverRow = null;
  // focus by time: the pill mirrors the clock — work tasks in the workday, personal outside (toggle in Settings).
  // snapshot keeps both sections, so the tasks/share windows are never filtered — this is island-only.
  let sections = snap.sections;
  if (snap.settings.focusByTime) sections = sections.filter(s => s.name === (snap.workday ? 'Work' : 'Personal'));
  const flat = sections.flatMap(s => s.items);
  const total = flat.length;
  const actives = flat.filter(t => t.active);
  document.body.classList.toggle('expanded', expanded);
  document.body.classList.toggle('pinned', pinned);
  document.getElementById('btn-pin').classList.toggle('pinned', pinned);
  document.getElementById('head-title').textContent =
    actives.length === 1 ? actives[0].title : actives.length > 1 ? actives.length + ' active tasks' : 'Todo Island';
  document.getElementById('head-count').textContent =
    actives.length ? `${actives.length}\u2605 \u00B7 ${total} open` : `${total} open`;

  let html = '';
  if (snap.errors && snap.errors.length) {
    html += snap.errors.map(e =>
      `<div class="err-banner">${esc(e.file)} note not found: ${esc(e.path)}</div>`).join('');
  }
  if (actives.length) {
    html += `<div class="sec">Active now</div>`;
    for (const a of actives) {
      const subs = a.subs.length
        ? `<div class="ac-subs">${a.subs.map(s => `<div class="${s.done ? 'done' : ''}" data-sub="${esc(s.t)}" data-parent="${esc(a.id)}" data-file="${a.file}">${s.done ? '&#10003;' : '&#9634;'} ${esc(s.t)}</div>`).join('')}</div>` : '';
      html += `<div class="active-card">
        <div class="ac-head">
          <span class="star">&#9733;</span>
          <span class="bang ${bangCls(a.priority)}">${a.priority ? esc(a.priority) : ''}</span>
          <span class="ac-title">${esc(a.title)}</span>
          ${dueHtml(a)}
        </div>
        ${subs}
        <div class="ac-actions">
          <button class="btn-done" data-done="${esc(a.id)}" data-file="${a.file}"><svg class="ic" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>Done</button>
          <button class="btn-keep" data-unstar="${esc(a.id)}" data-file="${a.file}">Unstage</button>
        </div>
      </div>`;
    }
  } else if (!total) {
    html += `<div class="hint">${snap.settings.focusByTime
      ? (snap.workday ? 'No open work tasks — the workday list is clear.' : 'No open personal tasks — enjoy the off hours.')
      : 'Nothing open right now — add tasks in the tasks window.'}</div>`;
  } else {
    html += `<div class="hint">Click a task to mark it as what you're working on now (★).</div>`;
  }

  for (const sec of sections) {
    const rest = sec.items.filter(t => !t.active);
    const items = expanded ? rest : rest.slice(0, 3);
    if (!items.length && !expanded) continue;
    html += `<div class="sec">${esc(sec.name)}</div>` + items.map(rowHtml).join('');
  }
  // one expand control, at the very bottom of the list — standard "show more" pattern
  const hiddenCount = flat.filter(t => !t.active).length -
    sections.reduce((n, sec) => n + Math.min(3, sec.items.filter(t => !t.active).length), 0);
  if (expanded) {
    html += `<div class="expand-row" id="expand-toggle"><svg class="ic" viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6"/></svg>Show less</div>`;
  } else if (hiddenCount > 0) {
    html += `<div class="expand-row" id="expand-toggle">Show all ${flat.length} tasks<svg class="ic" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></div>`;
  }
  document.getElementById('body').innerHTML = html;
  if (hoverRowId) { // hover-unfold survives snapshot re-renders (re-applied to the same task)
    const again = document.getElementById('body').querySelector(`.row[data-id="${CSS.escape(hoverRowId)}"]`);
    if (again) { again.classList.add('hovered'); hoverRow = again; }
  }
  renderUndo();

  requestAnimationFrame(() => {
    const h = document.getElementById('wrap').offsetHeight;
    window.api.resize(h);
  });
  if (!pinned && !islandHovered) scheduleDismiss((snap.settings.dismissSec || 45) * 1000);
  else if (!pinned) pauseDismiss(); // hovered: freeze the countdown even after action-triggered re-renders
}

// ---- hover preview: rest on a row for 2s → the row itself unfolds (full title + subtasks) ----
let hoverT = null, hoverRow = null;
function clearHover() {
  clearTimeout(hoverT);
  if (hoverRow) hoverRow.classList.remove('hovered');
  const old = document.getElementById('body').querySelector('.row.hovered');
  if (old) old.classList.remove('hovered');
  hoverRow = null;
  setTimeout(() => window.api.resize(document.getElementById('wrap').offsetHeight, 0), 320);
}
document.getElementById('body').addEventListener('mouseover', e => {
  const row = e.target.closest('.row');
  if (!row) return;
  if (row !== hoverRow) {
    clearHover();
    hoverRow = row;
    hoverT = setTimeout(() => {
      row.classList.add('hovered');
      setTimeout(() => window.api.resize(document.getElementById('wrap').offsetHeight, 0), 320);
    }, Math.max(0.2, (snap && snap.settings.hoverSec) || 2) * 1000);
  }
});
document.getElementById('body').addEventListener('mouseout', e => {
  const row = e.target.closest('.row');
  if (row && hoverRow === row && !row.contains(e.relatedTarget)) clearHover();
});

document.addEventListener('dblclick', e => {
  const row = e.target.closest('.row'); // two single-clicks cancel each other's star toggle — dblclick is free
  if (row) window.api.openEditor(row.dataset.file, row.dataset.id);
});

// drag & drop reorder — same semantics as the main window (drop on a row = insert before it)
let dragId = null;
document.getElementById('body').addEventListener('dragstart', e => {
  const row = e.target.closest('.row');
  if (!row) { e.preventDefault(); return; }
  dragId = row.dataset.id;
  row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
});
document.getElementById('body').addEventListener('dragover', e => {
  if (!dragId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const over = e.target.closest('.row');
  document.querySelectorAll('.row.drop-above').forEach(r => r.classList.remove('drop-above'));
  if (over && over.dataset.id !== dragId) over.classList.add('drop-above');
});
document.getElementById('body').addEventListener('drop', async e => {
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
document.getElementById('body').addEventListener('dragend', () => {
  dragId = null;
  document.querySelectorAll('.row.dragging, .row.drop-above').forEach(r => r.classList.remove('dragging', 'drop-above'));
});

const findTask = id => snap && snap.sections.flatMap(s => s.items).find(t => t.id === id);

document.addEventListener('click', e => {
  if (e.target.closest('#expand-toggle')) { window.SFX.play('tick'); expanded = !expanded; render(); return; }
  const sub = e.target.closest('[data-sub]');
  if (sub) { // tick a subtask — works in hover-unfold rows AND in Active-now cards
    e.stopPropagation();
    window.SFX.play('tick');
    const row = sub.closest('.row');
    const file = row ? row.dataset.file : sub.dataset.file;
    const parent = row ? row.dataset.id : sub.dataset.parent;
    window.api.toggleSubtask(file, parent, sub.dataset.sub);
    return;
  }
  const done = e.target.closest('[data-done]');
  if (done) { window.SFX.play('complete'); window.api.complete(done.dataset.done, done.dataset.file); return; }
  const unstar = e.target.closest('[data-unstar]');
  if (unstar) { window.SFX.play('starOff'); window.api.toggleActive(unstar.dataset.unstar, unstar.dataset.file); return; }
  const row = e.target.closest('.row');
  if (row) {
    window.SFX.play(findTask(row.dataset.id) && findTask(row.dataset.id).active ? 'starOff' : 'starOn');
    window.api.toggleActive(row.dataset.id, row.dataset.file);
    return;
  }
});

document.getElementById('pill').addEventListener('mouseenter', () => { islandHovered = true; if (!pinned) pauseDismiss(); });
document.getElementById('pill').addEventListener('mouseleave', () => {
  islandHovered = false;
  if (!pinned) scheduleDismiss(((snap && snap.settings.dismissSec) || 45) * 1000); // fresh countdown once you leave
});

document.getElementById('btn-pin').addEventListener('click', () => {
  pinned = !pinned;
  window.SFX.play('pin');
  if (pinned) {
    clearTimeout(dismissT);
    document.body.classList.add('pinned');
    document.getElementById('btn-pin').classList.add('pinned');
  } else {
    document.body.classList.remove('pinned');
    document.getElementById('btn-pin').classList.remove('pinned');
    if (!islandHovered) scheduleDismiss((snap && snap.settings.dismissSec || 45) * 1000); // hovering the pin = still on the island
  }
});
document.getElementById('btn-expand').addEventListener('click', () => { window.SFX.play('tick'); expanded = !expanded; render(); });
document.getElementById('btn-gear').addEventListener('click', () => { window.api.openWindow(); window.api.hide(); });
document.getElementById('btn-close').addEventListener('click', () => window.api.hide());
document.addEventListener('keydown', e => { if (e.key === 'Escape') window.api.hide(); });

// soft blip when the island shows — synthesized in sfx.js, gated by the soundOn setting
window.api.onPlaySound(() => window.SFX.play('show'));

window.api.onSnapshot(s => {
  const firstTime = !snap;
  snap = s;
  if (snap && snap.settings) window.SFX.enabled = !!snap.settings.soundOn;
  if (firstTime) { expanded = false; }
  render();
});
