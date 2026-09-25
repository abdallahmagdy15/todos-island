'use strict';
// First-run setup — 4 screens, answers go to main (onboard-finish → lib/setup.js planSetup). Skip is always safe.
const $ = id => document.getElementById(id);
const M = window.Motion;
if (new URLSearchParams(location.search).get('mica') === '1') document.documentElement.classList.add('mica');

const ans = {
  mode: 'both',
  work: { kind: null, path: null }, personal: { kind: null, path: null },
  reminders: { on: true, dayStart: '09:00', dayEnd: '17:00', every: 60 },
  autoStart: true
};
let defs = null, step = 1, busy = false;
const screens = [...document.querySelectorAll('.screen')];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortDir = p => { const parts = String(p).split(/[\\/]/).filter(Boolean); return (parts.length > 2 ? '…\\' : '') + parts.slice(-2).join('\\'); };
const dirOf = p => String(p).replace(/[\\/][^\\/]*$/, '');
const notesOn = () => ans.mode === 'both' ? ['work', 'personal'] : [ans.mode];

// ---- radiogroups: one tab stop, arrows move the choice ----
function radio(group, pick) {
  const items = [...group.querySelectorAll('[role=radio]')];
  const set = (el, focus) => {
    items.forEach(b => { const on = b === el; b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; b.classList.toggle('sel', on); });
    if (focus) el.focus();
    pick(el);
  };
  items.forEach(b => b.addEventListener('click', () => set(b)));
  group.addEventListener('keydown', e => {
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    set(items[(i + d + items.length) % items.length], true);
  });
  return value => set(items.find(b => Object.values(b.dataset).includes(String(value))) || items[0]);
}

// ---- 2 · which tasks + where they live ----
const setMode = radio(document.querySelector('.modes'), b => {
  ans.mode = b.dataset.mode;
  document.querySelectorAll('.note-pick').forEach(c => { c.hidden = !notesOn().includes(c.dataset.note); });
  const hasWork = ans.mode !== 'personal';
  $('hours-label').textContent = hasWork ? 'Work hours' : 'Your day';
  $('hours-hint').textContent = ans.mode === 'both' ? 'work tasks lead inside these hours' : hasWork ? 'reminders run inside these hours' : 'quiet overnight until your day starts';
});
function renderStat(note, info) {
  const card = document.querySelector(`.note-pick[data-note="${note}"]`);
  const stat = card.querySelector('[data-stat]');
  card.querySelector('[data-reset]').hidden = !ans[note].kind;
  if (!info) { // default: created by the app in the default folder
    const name = defs.noteName[note];
    stat.innerHTML = `<span class="ok">+</span> new ${esc(name)} · in ${esc(shortDir(defs.defaultDir))}`;
    stat.title = defs.defaultDir + '\\' + name;
    return;
  }
  stat.title = info.path;
  if (info.error) stat.innerHTML = `<span class="bad">✗</span> ${esc(info.name)} · ${esc(info.error)}`;
  else if (info.exists) stat.innerHTML = `<span class="ok">✓</span> ${esc(info.name)} · ${info.open ? `${info.open} open task${info.open === 1 ? '' : 's'} found` : 'no tasks yet, new ones go here'}`;
  else stat.innerHTML = `<span class="ok">+</span> new ${esc(info.name)} · in ${esc(shortDir(dirOf(info.path)))}`;
}
document.querySelectorAll('.note-pick').forEach(card => {
  const note = card.dataset.note;
  card.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', async () => {
    const kind = b.dataset.pick;
    const r = await window.api.pickPath(kind);
    if (!r || !r.ok) return;
    const info = await window.api.inspectPath(kind, r.path, note);
    if (info.error) { ans[note] = { kind: null, path: null }; renderStat(note, info); card.querySelector('[data-reset]').hidden = true; M.nudge(card); return; }
    ans[note] = { kind, path: r.path };
    renderStat(note, info);
  }));
  card.querySelector('[data-reset]').addEventListener('click', () => { ans[note] = { kind: null, path: null }; renderStat(note, null); });
});

// ---- 3 · reminders ----
const setEvery = radio(document.querySelector('.freq'), b => { ans.reminders.every = +b.dataset.every; });
$('ob-rem').addEventListener('change', () => {
  ans.reminders.on = $('ob-rem').checked;
  document.querySelectorAll('[data-needs-rem]').forEach(r => r.classList.toggle('off', !ans.reminders.on));
});
$('ob-auto').addEventListener('change', () => { ans.autoStart = $('ob-auto').checked; });
$('ob-start').addEventListener('change', () => { ans.reminders.dayStart = $('ob-start').value || '09:00'; });
$('ob-end').addEventListener('change', () => { ans.reminders.dayEnd = $('ob-end').value || '17:00'; });

// ---- 4 · ready ----
function keycaps(acc) {
  const names = { Control: 'Ctrl', CommandOrControl: 'Ctrl', CmdOrCtrl: 'Ctrl', Super: 'Win', Meta: 'Win' };
  const keys = String(acc || '').split('+').filter(Boolean).map(k => names[k] || k);
  return keys.map(k => `<kbd>${esc(k)}</kbd>`).join('<span class="plus">+</span>');
}
function renderReady(res) {
  $('keys').innerHTML = res.shortcut ? keycaps(res.shortcut) : '<span class="plus">the tray icon</span>';
  $('made').innerHTML = (res.notes || []).map(n => n.created
    ? `<li>Created <code>${esc(n.name)}</code> in ${esc(shortDir(dirOf(n.path)))}</li>`
    : `<li>Using <code>${esc(n.name)}</code></li>`).join('');
  const created = (res.notes || []).find(n => n.created);
  $('ready-title').textContent = created ? (created.kind === 'work' ? 'My first work task' : 'My first todo') : 'Your next task';
  const errs = res.errors || [];
  $('finish-err').hidden = !errs.length;
  $('finish-err').textContent = errs.map(e => `Couldn’t create the ${e.kind} note: ${e.message}`).join(' ');
}

// ---- navigation ----
function chrome() {
  $('step-count').textContent = `${step} / 4`;
  document.querySelectorAll('.dots i').forEach((d, i) => { d.className = i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''; });
  $('btn-skip').hidden = step === 4;
  $('btn-back').hidden = step === 1 || step === 4;
  $('btn-open').hidden = step !== 4;
  $('btn-next').textContent = step === 1 ? 'Get started' : step === 2 ? 'Continue' : step === 3 ? 'Finish setup' : 'Done';
}
async function go(to) {
  const from = screens[step - 1], next = screens[to - 1], dir = to > step ? 1 : -1;
  step = to; chrome();
  await M.play(from, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-12 * dir}px)` }], { duration: 120, easing: M.EASE_IN, fill: 'none' });
  from.hidden = true; next.hidden = false;
  next.querySelector('[tabindex="-1"]').focus({ preventScroll: true });
  if (to === 4) dropPill($('ready-pill'), 250);
  await M.play(next, [{ opacity: 0, transform: `translateX(${12 * dir}px)` }, { opacity: 1, transform: 'none' }], { duration: 200, fill: 'none' });
}
async function next() {
  if (busy) return;
  if (step < 3) return go(step + 1);
  if (step === 4) return window.api.close();
  busy = true; $('btn-next').disabled = true;
  try {
    const res = await window.api.finish({ mode: ans.mode, work: ans.work, personal: ans.personal, reminders: { ...ans.reminders }, autoStart: ans.autoStart });
    renderReady(res);
    await go(4);
  } catch (e) {
    $('btn-next').disabled = false; M.nudge($('btn-next'));
  } finally { busy = false; $('btn-next').disabled = false; }
}
async function skip() {
  if (busy) return;
  busy = true;
  try { await window.api.finish({ skip: true }); } finally { window.api.close(); }
}
$('btn-next').addEventListener('click', next);
$('btn-back').addEventListener('click', () => { if (!busy && step > 1 && step < 4) go(step - 1); });
$('btn-skip').addEventListener('click', skip);
$('btn-open').addEventListener('click', () => window.api.close('open'));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); step === 4 ? window.api.close() : skip(); }
  else if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); next(); }
});

// ---- hero: note line → highlighter swipe → thread → the island drops in. Once, no loop. ----
function dropPill(el, delay) {
  return M.play(el, [{ opacity: 0, transform: 'translate(-50%, -140%)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 420, delay, fill: 'both' });
}
function playHero() {
  M.play($('hero-note'), [{ opacity: 0, transform: 'translate(-50%, 8px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 260, delay: 150, fill: 'both' });
  M.play($('hero-hl'), [{ backgroundSize: '0% 100%' }, { backgroundSize: '100% 100%' }], { duration: 380, delay: 500, fill: 'both' });
  M.play($('hero-thread'), [{ opacity: 0, transform: 'scaleY(0)' }, { opacity: 1, transform: 'scaleY(1)' }], { duration: 240, delay: 880, fill: 'both' });
  dropPill($('hero-pill'), 1060);
}

(async () => {
  defs = await window.api.defaults();
  ans.reminders.dayStart = $('ob-start').value = defs.dayStart || '09:00';
  ans.reminders.dayEnd = $('ob-end').value = defs.dayEnd || '17:00';
  ans.autoStart = $('ob-auto').checked = defs.autoStart !== false;
  setMode('both');
  setEvery([15, 30, 60, 90].includes(+defs.every) ? +defs.every : 60);
  renderStat('work', null); renderStat('personal', null);
  chrome();
  playHero();
  $('h1').focus({ preventScroll: true });
})();
