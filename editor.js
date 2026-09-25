'use strict';
const { esc, parseDueText, dueText } = window.UI;
const params = new URLSearchParams(location.search);
const FILE = params.get('file') || 'work';
let ID = params.get('id') || '';
const $ = id => document.getElementById(id);

let activeState = false;
const prioCtl = window.UI.prioChips($('ed-prio'));
const dueCtl = window.UI.dueControl($('ed-due'));

async function findTask() {
  const snap = await window.api.getSnapshot();
  return snap.sections.flatMap(s => s.items).find(t => t.id === ID) || null;
}

async function load(full = false) { // full = first open / after save; subtask edits keep unsaved field changes
  const s = await window.api.getSnapshot();
  if (s && s.settings) window.SFX.enabled = !!s.settings.soundOn;
  const t = s.sections.flatMap(x => x.items).find(x => x.id === ID) || null;
  $('ed-missing').hidden = !!t;
  $('ed-form').hidden = !t;
  if (!t) return;
  $('ed-badge').textContent = t.file === 'work' ? 'Work' : 'Personal';
  if (full) {
    $('ed-title').value = [t.title, ...(t.notes || [])].join('\n');
    autoGrow($('ed-title'));
    activeState = !!t.active;
    paintActive();
    prioCtl.set(t.priority);
    dueCtl.set(parseDueText(t.dueText));
  }
  $('ed-subs').innerHTML = t.subs.map(s =>
    `<li class="${s.done ? 'done' : ''}" data-sub="${esc(s.t)}">${s.done ? '&#10003;' : '&#9634;'} ${esc(s.t)}<button class="sub-del" type="button" aria-label="Delete subtask">&times;</button></li>`).join('')
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
  window.SFX.play(activeState ? 'starOn' : 'starOff');
  paintActive();
});
$('ed-addsub').addEventListener('click', async () => {
  window.SFX.play('tick');
  const v = $('ed-sub').value.trim();
  if (!v) return;
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
$('ed-title').addEventListener('input', () => { autoGrow($('ed-title')); $('ed-save').disabled = !$('ed-title').value.trim(); });

$('ed-save').addEventListener('click', async () => {
  const lines = $('ed-title').value.split('\n').map(l => l.trim());
  const title = lines[0] || '';
  if (!title) return; // guard: never save an empty title
  const desc = lines.slice(1).filter(Boolean);
  const res = await window.api.updateTask(FILE, ID, {
    title, priority: prioCtl.value, active: activeState, desc,
    dueText: dueText(dueCtl.value)
  });
  if (res && res.id) ID = res.id; // id changes with title/priority/due — adopt it or the editor loses the task
  window.SFX.play('tick');
  $('ed-saved').hidden = false;
  setTimeout(() => { $('ed-saved').hidden = true; }, 1400);
  load(true);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });
$('ed-complete').addEventListener('click', async () => {
  window.SFX.play('complete'); await window.api.complete(ID, FILE);
  window.close();
});
$('ed-up').addEventListener('click', async () => { window.SFX.play('tick'); await window.api.moveTask(FILE, ID, 'up'); load(); });
$('ed-down').addEventListener('click', async () => { window.SFX.play('tick'); await window.api.moveTask(FILE, ID, 'down'); load(); });
$('ed-delete').addEventListener('click', async () => {
  window.SFX.play('delete'); await window.api.deleteTask(ID, FILE);
  window.close();
});

load(true);
