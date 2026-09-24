'use strict';
let snap = null, expanded = false, pinned = false;
let dismissT = null, remainMs = 0, dismissEnd = 0;
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
  return `<div class="row" data-id="${esc(t.id)}" data-file="${t.file}">
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

function renderUndo() {
  const bar = document.getElementById('undo-bar');
  clearInterval(undoT);
  if (!snap.undo) { bar.hidden = true; return; }
  const isDel = snap.undo.kind === 'delete';
  undoLeft = snap.undo.left;
  const text = `${isDel ? 'Deleted' : 'Completed'}: ${snap.undo.label}`;
  bar.innerHTML = `<span class="undo-label">${esc(text)}</span>
    <button data-undo>Undo</button><span class="undo-count">${undoLeft}s</span>`;
  bar.hidden = false;
  bar.querySelector('[data-undo]').addEventListener('click', () => {
    if (isDel) window.api.undoDelete(); else window.api.undoComplete();
    bar.hidden = true; clearInterval(undoT);
  });
  undoT = setInterval(() => {
    undoLeft--;
    const c = bar.querySelector('.undo-count');
    if (undoLeft <= 0) { bar.hidden = true; clearInterval(undoT); }
    else if (c) c.textContent = undoLeft + 's';
  }, 1000);
}

function render() {
  if (!snap) return;
  const hoverRowId = hoverRow ? hoverRow.dataset.id : null;
  clearTimeout(hoverT); hoverRow = null;
  const flat = snap.sections.flatMap(s => s.items);
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
        ? `<div class="ac-subs">${a.subs.map(s => `<div class="${s.done ? 'done' : ''}">${s.done ? '&#10003;' : '&#9634;'} ${esc(s.t)}</div>`).join('')}</div>` : '';
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
  } else {
    html += `<div class="hint">Click a task to mark it as what you're working on now (★).</div>`;
  }

  for (const sec of snap.sections) {
    const rest = sec.items.filter(t => !t.active);
    const items = expanded ? rest : rest.slice(0, 3);
    if (!items.length && !expanded) continue;
    html += `<div class="sec">${esc(sec.name)}</div>` + items.map(rowHtml).join('');
  }
  // one expand control, at the very bottom of the list — standard "show more" pattern
  const hiddenCount = flat.filter(t => !t.active).length -
    snap.sections.reduce((n, sec) => n + Math.min(3, sec.items.filter(t => !t.active).length), 0);
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
  if (!pinned) scheduleDismiss((snap.settings.dismissSec || 45) * 1000);
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

document.addEventListener('click', e => {
  if (e.target.closest('#expand-toggle')) { expanded = !expanded; render(); return; }
  const sub = e.target.closest('[data-sub]');
  if (sub) {
    const row = sub.closest('.row');
    if (row) { e.stopPropagation(); window.api.toggleSubtask(row.dataset.file, row.dataset.id, sub.dataset.sub); return; }
  }
  const done = e.target.closest('[data-done]');
  if (done) { window.api.complete(done.dataset.done, done.dataset.file); return; }
  const unstar = e.target.closest('[data-unstar]');
  if (unstar) { window.api.toggleActive(unstar.dataset.unstar, unstar.dataset.file); return; }
  const row = e.target.closest('.row');
  if (row) { window.api.toggleActive(row.dataset.id, row.dataset.file); return; }
});

document.getElementById('pill').addEventListener('mouseenter', () => { if (!pinned) pauseDismiss(); });
document.getElementById('pill').addEventListener('mouseleave', () => { if (!pinned && remainMs > 0) scheduleDismiss(remainMs); });

document.getElementById('btn-pin').addEventListener('click', () => {
  pinned = !pinned;
  if (pinned) {
    clearTimeout(dismissT);
    document.body.classList.add('pinned');
    document.getElementById('btn-pin').classList.add('pinned');
  } else {
    document.body.classList.remove('pinned');
    document.getElementById('btn-pin').classList.remove('pinned');
    scheduleDismiss((snap && snap.settings.dismissSec || 45) * 1000);
  }
});
document.getElementById('btn-expand').addEventListener('click', () => { expanded = !expanded; render(); });
document.getElementById('btn-gear').addEventListener('click', () => { window.api.openWindow(); window.api.hide(); });
document.getElementById('btn-close').addEventListener('click', () => window.api.hide());
document.addEventListener('keydown', e => { if (e.key === 'Escape') window.api.hide(); });

// soft two-note blip when the island shows — best-effort, never breaks the UI
let audioCtx = null;
window.api.onPlaySound(() => {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const t0 = audioCtx.currentTime;
    [[660, 0], [880, 0.07]].forEach(([freq, at]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t0 + at);
      gain.gain.linearRampToValueAtTime(0.06, t0 + at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.07);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.08);
    });
  } catch (e) { /* no audio — stay silent */ }
});

window.api.onSnapshot(s => {
  const firstTime = !snap;
  snap = s;
  if (firstTime) { expanded = false; }
  render();
});
