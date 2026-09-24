'use strict';
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const params = new URLSearchParams(location.search);
const FILE = params.get('file') || 'work';
let ID = params.get('id') || '';
const $ = id => document.getElementById(id);

let prio = null;
let activeState = false;

async function findTask() {
  const snap = await window.api.getSnapshot();
  return snap.sections.flatMap(s => s.items).find(t => t.id === ID) || null;
}

async function load() {
  const s = await window.api.getSnapshot();
  if (s && s.settings) window.SFX.enabled = !!s.settings.soundOn;
  const t = s.sections.flatMap(x => x.items).find(x => x.id === ID) || null;
  $('ed-missing').hidden = !!t;
  $('ed-form').hidden = !t;
  if (!t) return;
  $('ed-badge').textContent = t.file === 'work' ? 'Work' : 'Personal';
  $('ed-title').value = [t.title, ...(t.notes || [])].join('\n');
  autoGrow($('ed-title'));
  prio = t.priority;
  activeState = !!t.active;
  $('ed-active').classList.toggle('sel', activeState);
  $('ed-prio').innerHTML = ['', '!', '!!', '!!!'].map(p =>
    `<button class="chip ${prio === p ? 'sel' : ''}" data-p="${p}" type="button">${p || '—'}</button>`).join('');
  $('ed-prio').querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
    $('ed-prio').querySelectorAll('.chip').forEach(x => x.classList.remove('sel'));
    c.classList.add('sel'); prio = c.dataset.p;
  }));
  const [d, m] = t.dueText ? [t.dueText.split(' ')[0], t.dueText.split(' ')[1]] : ['', ''];
  $('ed-day').value = d;
  $('ed-month').innerHTML = '<option value="">Month…</option>' +
    MONTHS.map(mm => `<option ${mm === m ? 'selected' : ''}>${mm}</option>`).join('');
  $('ed-subs').innerHTML = t.subs.map(s =>
    `<li class="${s.done ? 'done' : ''}" data-sub="${s.t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}">${s.done ? '&#10003;' : '&#9634;'} ${s.t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}<button class="sub-del" type="button" aria-label="Delete subtask">&times;</button></li>`).join('')
    || '<li class="none-yet">No subtasks yet.</li>';
}
$('ed-subs').addEventListener('click', async e => {
  const li = e.target.closest('li[data-sub]');
  if (!li) return;
  if (e.target.closest('.sub-del')) { window.SFX.play('delete'); await window.api.deleteSubtask(FILE, ID, li.dataset.sub); load(); return; }
  window.SFX.play('tick'); await window.api.toggleSubtask(FILE, ID, li.dataset.sub);
  load();
});

$('ed-clear-due').addEventListener('click', () => { $('ed-day').value = ''; $('ed-month').value = ''; });
$('ed-active').addEventListener('click', () => {
  activeState = !activeState;
  window.SFX.play(activeState ? 'starOn' : 'starOff');
  $('ed-active').classList.toggle('sel', activeState);
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
  const day = $('ed-day').value.trim(), month = $('ed-month').value;
  const res = await window.api.updateTask(FILE, ID, {
    title, priority: prio || null, active: activeState, desc,
    dueText: day && month ? `${day} ${month}` : null
  });
  if (res && res.id) ID = res.id; // id changes with title/priority/due — adopt it or the editor loses the task
  window.SFX.play('tick');
  $('ed-saved').hidden = false;
  setTimeout(() => { $('ed-saved').hidden = true; }, 1400);
  load();
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

load();
