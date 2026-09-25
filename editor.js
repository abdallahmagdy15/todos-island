'use strict';
const { esc, parseDueText } = window.UI;
const params = new URLSearchParams(location.search);
const FILE = params.get('file') || 'work';
let ID = params.get('id') || '';
const $ = id => document.getElementById(id);

let activeState = false;
const touched = {}; // fields the user set with a control since load — those override typed notation
const prioCtl = window.UI.prioChips($('ed-prio'), { onPick: () => { touched.priority = true; schedulePreview(0); } });
const dueCtl = window.UI.dueControl($('ed-due'), { onPick: () => { touched.due = true; schedulePreview(0); } });

async function load(full = false) { // full = first open / after save; subtask edits keep unsaved field changes
  const s = await window.api.getSnapshot();
  if (s && s.settings) window.SFX.enabled = !!s.settings.soundOn;
  const t = s.sections.flatMap(x => x.items).find(x => x.id === ID) || null;
  $('ed-missing').hidden = !!t;
  $('ed-form').hidden = !t;
  if (!t) return;
  $('ed-badge').textContent = t.file === 'work' ? 'work' : 'personal';
  if (full) {
    $('ed-title').value = [t.title, ...(t.notes || [])].join('\n');
    autoGrow($('ed-title'));
    activeState = !!t.active;
    paintActive();
    prioCtl.set(t.priority);
    dueCtl.set(parseDueText(t.dueText));
    for (const k of Object.keys(touched)) delete touched[k];
    updatePreview();
  }
  $('ed-subs').innerHTML = t.subs.map(s =>
    `<li class="${s.done ? 'done' : ''}" data-sub="${esc(s.t)}">${s.done ? '&#10003;' : '&#9634;'} ${esc(s.t)}<button class="sub-del" type="button" aria-label="Delete subtask ${esc(s.t)}">&times;</button></li>`).join('')
    || '<li class="none-yet">No subtasks yet.</li>';
}
$('ed-subs').addEventListener('click', async e => {
  const li = e.target.closest('li[data-sub]');
  if (!li) return;
  if (e.target.closest('.sub-del')) { window.SFX.play('delete'); await window.api.deleteSubtask(FILE, ID, li.dataset.sub); load(); return; }
  window.SFX.play('tick'); await window.api.toggleSubtask(FILE, ID, li.dataset.sub);
  load();
});

function paintActive() {
  $('ed-active').classList.toggle('sel', activeState);
  $('ed-active').setAttribute('aria-pressed', activeState);
  $('ed-mark').textContent = activeState ? '[★]' : '[ ]';
  $('ed-mark').classList.toggle('now', activeState);
}
$('ed-active').addEventListener('click', () => {
  activeState = !activeState;
  touched.active = true;
  window.SFX.play(activeState ? 'starOn' : 'starOff');
  paintActive();
  // M2 — the Now chip gets the highlighter sweep when switched on
  if (activeState) window.Motion.play($('ed-active'), [{ backgroundSize: '0% 100%' }, { backgroundSize: '100% 100%' }], { duration: 260, fill: 'none' });
  schedulePreview(0);
});
$('ed-addsub').addEventListener('click', async () => {
  const v = $('ed-sub').value.trim();
  if (!v) { window.Motion.nudge($('ed-sub')); $('ed-sub').focus(); return; }
  window.SFX.play('tick');
  await window.api.addSubtask(FILE, ID, v);
  $('ed-sub').value = '';
  load();
});
$('ed-sub').addEventListener('keydown', e => { if (e.key === 'Enter') $('ed-addsub').click(); });
// multiline task field: grows while typing, caps at 10 visible lines, scrolls inside beyond
const MAX_TA = 212; // ≈ 10 lines at 13.5px/1.55 line-height + padding
function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, MAX_TA) + 'px';
}

// "will write" — the exact line Save puts in the note (same serializer the note uses; typed notation is honored)
let pvT = null, pvSeq = 0, last = null;
function schedulePreview(ms = 80) { clearTimeout(pvT); pvT = setTimeout(updatePreview, ms); }
async function updatePreview() {
  clearTimeout(pvT);
  const my = ++pvSeq;
  const r = await window.api.composeTask({
    text: $('ed-title').value,
    priority: touched.priority ? prioCtl.value : undefined,
    due: touched.due ? dueCtl.value : undefined,
    active: touched.active ? activeState : undefined,
    fallback: { priority: prioCtl.value, due: dueCtl.value, active: activeState }
  });
  if (my !== pvSeq) return r;
  last = r;
  prioCtl.set(r.priority); dueCtl.set(r.due);
  if (r.active !== activeState) { activeState = r.active; paintActive(); }
  $('ed-preview-line').textContent = r.ok ? r.line : 'a task needs a title';
  $('ed-preview-line').classList.toggle('bad', !r.ok);
  $('ed-save').disabled = !r.ok;
  return r;
}
$('ed-title').addEventListener('input', () => { autoGrow($('ed-title')); schedulePreview(); });

$('ed-save').addEventListener('click', async () => {
  const r = await updatePreview();
  if (!r || !r.ok) { window.Motion.nudge($('ed-title')); return; } // guard: never save an empty title
  const res = await window.api.updateTask(FILE, ID, {
    title: r.title, priority: r.priority, active: r.active, desc: r.desc, dueText: r.dueText
  });
  if (res && res.id) ID = res.id; // id changes with title/priority/due — adopt it or the editor loses the task
  window.SFX.play('tick');
  $('ed-saved').hidden = false;
  setTimeout(() => { $('ed-saved').hidden = true; }, 1400);
  load(true);
});

// ⋯ menu — the rare, structural actions live here, out of the way
function toggleMenu(open) {
  const m = $('ed-menu');
  open = open === undefined ? m.hidden : open;
  m.hidden = !open;
  $('ed-more').setAttribute('aria-expanded', open);
  if (open) m.querySelector('[role=menuitem]').focus();
}
$('ed-more').addEventListener('click', () => toggleMenu());
document.addEventListener('click', e => { if (!$('ed-menu').hidden && !e.target.closest('.menu-wrap')) toggleMenu(false); });
$('ed-menu').addEventListener('keydown', e => {
  const items = [...$('ed-menu').querySelectorAll('[role=menuitem]')], i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!$('ed-menu').hidden) { toggleMenu(false); $('ed-more').focus(); return; }
    window.close();
  }
  if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); $('ed-save').click(); } // Ctrl+Enter saves from anywhere
});

// Complete — M1 on the preview line itself: the checkbox ticks and the line is struck through, then the window closes
$('ed-complete').addEventListener('click', async () => {
  window.SFX.play('complete');
  const line = $('ed-preview-line');
  if (last && last.ok) line.textContent = last.line.replace('- [ ]', '- [x]');
  line.classList.add('tt', 'striking');
  try {
    await Promise.all([
      window.api.complete(ID, FILE),
      window.Motion.play(line, [{ backgroundSize: '0% 1.5px' }, { backgroundSize: '100% 1.5px' }], { duration: 220, delay: 120 })
    ]);
    await new Promise(r => setTimeout(r, window.Motion.reduced ? 0 : 160)); // let the strike land before the window goes
    window.close();
  } catch (err) {
    line.classList.remove('striking');
    updatePreview();
  }
});
$('ed-up').addEventListener('click', async () => { toggleMenu(false); window.SFX.play('tick'); await window.api.moveTask(FILE, ID, 'up'); load(); });
$('ed-down').addEventListener('click', async () => { toggleMenu(false); window.SFX.play('tick'); await window.api.moveTask(FILE, ID, 'down'); load(); });
$('ed-delete').addEventListener('click', async () => {
  window.SFX.play('delete'); await window.api.deleteTask(ID, FILE); // undo lives in the tasks window's toast
  window.close();
});

load(true);
