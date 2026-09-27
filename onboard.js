'use strict';
// First-run setup — 4 steps, answers go to main (onboard-finish → lib/setup.js planSetup). Skip is always safe.
// The stage above the steps is one miniature desktop: each step changes its scene (welcome → notes → day → ready),
// so every choice is shown working before it is saved. The stage is illustration only (aria-hidden).
const $ = id => document.getElementById(id);
const M = window.Motion;
let LANG = 'en';
const T = (key, params) => window.I18N.t(LANG, key, params);

const ans = {
  mode: 'both',
  work: { kind: null, path: null }, personal: { kind: null, path: null },
  reminders: { on: true, dayStart: '09:00', dayEnd: '17:00', every: 60 },
  autoStart: true
};
let defs = null, step = 1, first = 1, busy = false;
const fileInfo = { work: null, personal: null }; // what the last pick resolved to (null = the default, created by the app)
const screens = [...document.querySelectorAll('.screen')];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortDir = p => { const parts = String(p).split(/[\\/]/).filter(Boolean); return (parts.length > 2 ? '…\\' : '') + parts.slice(-2).join('\\'); };
const dirOf = p => String(p).replace(/[\\/][^\\/]*$/, '');
const notesOn = () => ans.mode === 'both' ? ['work', 'personal'] : [ans.mode];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const today = () => { const d = new Date(); return `${d.getDate()} ${MON[d.getMonth()]}`; }; // notation never translates
const toMin = hhmm => { const m = /^(\d{2}):(\d{2})$/.exec(hhmm || ''); return m ? +m[1] * 60 + +m[2] : null; };
const hhmm = min => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// ---- radiogroups: one tab stop, arrows move the choice (RTL-aware) ----
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
    const rtl = document.documentElement.dir === 'rtl';
    const fwd = e.key === 'ArrowDown' || e.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
    const back = e.key === 'ArrowUp' || e.key === (rtl ? 'ArrowRight' : 'ArrowLeft');
    if (!fwd && !back) return;
    e.preventDefault();
    set(items[(i + (fwd ? 1 : -1) + items.length) % items.length], true);
  });
  return value => set(items.find(b => Object.values(b.dataset).includes(String(value))) || items[0]);
}

// ================= stage =================
const stage = $('stage');
let playToken = 0; // bumps on every scene change, so a scene's running sequence stops the moment you leave it
const wait = ms => new Promise(r => setTimeout(r, ms));
const alive = tok => tok === playToken;

// the mini island: an independent X/Y spring drop, the same gel as the real island (island.js gelDrop)
const pill = $('st-pill');
function pillSet({ mark = '[★]', open = false, title = '', bang = '', due = '' }) {
  $('sp-mark').textContent = mark; $('sp-mark').classList.toggle('open', open);
  $('sp-title').textContent = title;
  $('sp-bang').textContent = bang; $('sp-bang').hidden = !bang;
  $('sp-due').textContent = due; $('sp-due').hidden = !due;
}
function pillDown() {
  if (!pill.classList.contains('up')) return Promise.resolve();
  pill.classList.remove('up');
  if (M.reduced) return Promise.resolve();
  const H = pill.offsetHeight + 16;
  const fy = M.spring({ bounce: 0.2, response: 0.5 }), fx = M.spring({ bounce: 0.3, response: 0.55 }), fs = M.spring({ bounce: 0.3, response: 0.45 });
  const lerp = (a, b, p) => a + (b - a) * p;
  const D = 950, N = 57, frames = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * D / 1000;
    frames.push({ translate: `0 ${lerp(-H, 0, fy(t)).toFixed(2)}px`, scale: `${lerp(0.55, 1, fx(t)).toFixed(4)} ${lerp(0.4, 1, fs(t)).toFixed(4)}`, opacity: Math.min(1, t / 0.12) });
  }
  frames[N] = { translate: '0 0', scale: '1 1', opacity: 1 };
  $('st-sweep').animate([{ backgroundPosition: '130% 0' }, { backgroundPosition: '-30% 0' }], { duration: 1100, delay: 420, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'none' });
  return pill.animate(frames, { duration: D, easing: 'linear', fill: 'none' }).finished.catch(() => {}); // fill none: never hold a filled animation on glass
}
const pillUp = () => pill.classList.add('up');

// 1 · welcome — a note line types itself, lights up, and becomes the island
function lineSegs() {
  return [['- [ ] '], ['*', 'tk-now'], [' '], ['!!', 'tk-p2'], [' '], [today(), 'tk-due'], [' — '], [T('ob.demo.task'), 'tk-t']];
}
function renderLine(el, segs, upto = Infinity) {
  let left = upto, html = '';
  for (const [text, cls] of segs) {
    if (left <= 0) break;
    const part = text.slice(0, left); left -= part.length;
    html += cls ? `<span class="${cls}">${esc(part)}</span>` : esc(part);
  }
  el.innerHTML = html;
}
function welcomeFinal() {
  renderLine($('st-type'), lineSegs());
  $('st-type').style.backgroundSize = '';
  $('st-caret').classList.remove('on');
  pillSet({ title: T('ob.demo.task'), bang: '!!', due: today() });
}
async function playWelcome(tok) {
  $('st-file').textContent = defs.noteName.work;
  $('st-line2').textContent = '- [ ] ! ' + T('ob.demo.task2');
  if (M.reduced) { welcomeFinal(); pill.classList.remove('up'); return; }
  pillUp();
  const segs = lineSegs(), total = segs.reduce((n, [t]) => n + t.length, 0), type = $('st-type');
  type.style.backgroundSize = '0% 100%';
  renderLine(type, segs, 0);
  $('st-caret').classList.add('on');
  await wait(520);
  for (let i = 1; i <= total; i++) {
    if (!alive(tok)) return;
    renderLine(type, segs, i);
    await wait(i < 12 ? 70 : 34); // the tokens are typed deliberately, the title quickly
  }
  $('st-caret').classList.remove('on');
  await wait(260); if (!alive(tok)) return;
  await M.play(type, [{ backgroundSize: '0% 100%' }, { backgroundSize: '100% 100%' }], { duration: 380, fill: 'none' });
  type.style.backgroundSize = '';
  if (!alive(tok)) return;
  pillSet({ title: T('ob.demo.task'), bang: '!!', due: today() });
  pillDown();
}

// 2 · notes — the files the island will read, and what each pick resolved to
function statHtml(note) {
  const info = fileInfo[note];
  if (!info) return `<span class="ok">+</span> ${esc(T('ob.stat.new', { name: defs.noteName[note], dir: shortDir(defs.defaultDir) }))}`;
  if (info.error) return `<span class="bad">✗</span> ${esc(T('ob.stat.err', { name: info.name }))}`;
  if (info.exists) return `<span class="ok">✓</span> ${esc(info.open ? T(info.open === 1 ? 'ob.stat.found1' : 'ob.stat.found', { name: info.name, n: info.open }) : T('ob.stat.empty', { name: info.name }))}`;
  return `<span class="ok">+</span> ${esc(T('ob.stat.new', { name: info.name, dir: shortDir(dirOf(info.path)) }))}`;
}
// the stage card says it in a few words; the full path is in the picker row below
function shortStat(note) {
  const info = fileInfo[note];
  if (info && info.error) return `<span class="bad">✗</span> ${esc(T('ob.fstat.err'))}`;
  if (info && info.exists) return `<span class="ok">✓</span> ${esc(info.open ? T(info.open === 1 ? 'ob.fstat.found1' : 'ob.fstat.found', { n: info.open }) : T('ob.fstat.empty'))}`;
  return `<span class="ok">+</span> ${esc(T('ob.fstat.new'))}`;
}
function renderFiles() {
  const lines = {
    work: ['- [ ] * !! ' + today() + ' — ' + T('ob.demo.task'), '- [ ] ! ' + T('ob.demo.task2')],
    personal: ['- [ ] ! ' + T('ob.demo.task3'), '- [ ] ' + T('ob.demo.task4')]
  };
  document.querySelectorAll('.file').forEach(f => {
    const note = f.dataset.file, info = fileInfo[note];
    f.classList.toggle('off', !notesOn().includes(note));
    f.querySelector('[data-fname]').textContent = info && !info.error ? info.name : defs.noteName[note];
    f.querySelector('[data-fstat]').innerHTML = shortStat(note);
    f.querySelector('[data-fline="1"]').textContent = lines[note][0];
    f.querySelector('[data-fline="2"]').textContent = lines[note][1];
  });
}

// 3 · day — when the island drops in, drawn from the same rule planSetup writes
function dropTimes() {
  const r = ans.reminders, s = toMin(r.dayStart) ?? 540, e = Math.max(toMin(r.dayEnd) ?? 1020, s), every = r.every;
  const off = ans.mode === 'personal' ? every : (defs.offEvery || 60);
  if (!r.on) return [];
  const out = [];
  if (ans.mode === 'personal') { for (let t = s + every; t < 1440; t += every) out.push({ t, w: false }); return out; }
  for (let t = s + every; t <= e; t += every) out.push({ t, w: true });
  if (ans.mode === 'both') for (let t = (out.length ? out[out.length - 1].t : s) + off; t < 1440; t += off) out.push({ t, w: false });
  return out;
}
function renderDay() {
  const r = ans.reminders, s = toMin(r.dayStart) ?? 540, e = Math.max(toMin(r.dayEnd) ?? 1020, s);
  const pct = m => (m / 1440 * 100).toFixed(2) + '%';
  $('rb-night').style.width = pct(s);
  const personal = ans.mode === 'personal';
  $('rb-work').hidden = personal;
  $('rb-work').style.left = pct(s); $('rb-work').style.width = pct(e - s);
  $('lg-work-wrap').hidden = personal;
  $('lg-off-wrap').hidden = ans.mode === 'work';
  $('lg-work').textContent = T('ob.day.work');
  const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  $('rb-now').style.left = pct(nowMin);
  const times = dropTimes(), next = times.find(x => x.t > nowMin && nowMin >= s);
  $('rb-ticks').innerHTML = times.map(x => `<i class="tick${x.w || personal ? ' w' : ''}${x === next ? ' next' : ''}" style="left:${pct(x.t)}"></i>`).join('');
  $('ribbon').classList.toggle('off', !r.on);
  if (!r.on) { $('day-count').textContent = T('ob.day.none'); $('day-next').textContent = ''; return; }
  $('day-count').textContent = T(times.length === 1 ? 'ob.day.count1' : 'ob.day.count', { n: times.length });
  $('day-next').textContent = next ? T('ob.day.next', { t: hhmm(next.t) }) : times.length ? T('ob.day.tomorrow', { t: hhmm(times[0].t) }) : '';
}

// 4 · ready — the shortcut presses itself, and the island answers
function capsHtml(acc) {
  const names = { Control: 'Ctrl', CommandOrControl: 'Ctrl', CmdOrCtrl: 'Ctrl', Super: 'Win', Meta: 'Win' };
  return String(acc || '').split('+').filter(Boolean).map(k => names[k] || k);
}
async function playReady(tok, title) {
  const keys = capsHtml(defs.shortcut);
  $('st-caps').innerHTML = keys.map(k => `<span class="cap glass">${esc(k)}</span>`).join('<span class="cap-plus">+</span>');
  pillSet({ mark: '[ ]', open: true, title });
  if (M.reduced || !keys.length) { pill.classList.remove('up'); return; }
  pillUp();
  await wait(700);
  for (const cap of document.querySelectorAll('.cap')) { if (!alive(tok)) return; cap.classList.add('down'); await wait(170); }
  if (!alive(tok)) return;
  pillDown();
  await wait(360);
  document.querySelectorAll('.cap').forEach(c => c.classList.remove('down'));
}

let readyTitle = '';
function scene(n) {
  const tok = ++playToken;
  stage.dataset.scene = ['welcome', 'notes', 'day', 'ready'][n - 1];
  if (n === 1) playWelcome(tok);
  else if (n === 4) playReady(tok, readyTitle);
  else pillUp();
  if (n === 2) renderFiles();
  if (n === 3) renderDay();
}

// ================= step controls =================
// 2 · which tasks + where they live
const setMode = radio(document.querySelector('.modes'), b => {
  ans.mode = b.dataset.mode;
  document.querySelectorAll('.note-pick').forEach(c => { c.hidden = !notesOn().includes(c.dataset.note); });
  const hasWork = ans.mode !== 'personal';
  $('hours-label').textContent = T(hasWork ? 'ob.r.hours' : 'ob.r.day');
  $('hours-hint').textContent = T(ans.mode === 'both' ? 'ob.r.hours.both' : hasWork ? 'ob.r.hours.work' : 'ob.r.day.hint');
  if (defs) renderFiles();
});
function renderStat(note) {
  const card = document.querySelector(`.note-pick[data-note="${note}"]`);
  const stat = card.querySelector('[data-stat]'), info = fileInfo[note];
  card.querySelector('[data-reset]').hidden = !ans[note].kind;
  stat.innerHTML = statHtml(note);
  stat.title = info ? info.path : defs.defaultDir + '\\' + defs.noteName[note];
  renderFiles();
}
document.querySelectorAll('.note-pick').forEach(card => {
  const note = card.dataset.note;
  card.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', async () => {
    const kind = b.dataset.pick;
    const r = await window.api.pickPath(kind);
    if (!r || !r.ok) return;
    const info = await window.api.inspectPath(kind, r.path, note);
    fileInfo[note] = info;
    if (info.error) { ans[note] = { kind: null, path: null }; renderStat(note); M.nudge(card); return; }
    ans[note] = { kind, path: r.path };
    renderStat(note);
  }));
  card.querySelector('[data-reset]').addEventListener('click', () => { ans[note] = { kind: null, path: null }; fileInfo[note] = null; renderStat(note); });
});

// 3 · reminders — every change redraws the day ribbon live
const setEvery = radio(document.querySelector('.freq'), b => { ans.reminders.every = +b.dataset.every; if (defs) renderDay(); });
$('ob-rem').addEventListener('change', () => {
  ans.reminders.on = $('ob-rem').checked;
  document.querySelectorAll('[data-needs-rem]').forEach(r => r.classList.toggle('off', !ans.reminders.on));
  renderDay();
});
$('ob-auto').addEventListener('change', () => { ans.autoStart = $('ob-auto').checked; });
for (const [id, key, dflt] of [['ob-start', 'dayStart', '09:00'], ['ob-end', 'dayEnd', '17:00']]) {
  $(id).addEventListener('input', () => { ans.reminders[key] = $(id).value || dflt; renderDay(); });
}

// 4 · ready
function renderReady(res) {
  const keys = capsHtml(res.shortcut);
  $('keys').innerHTML = keys.length ? keys.map(k => `<kbd>${esc(k)}</kbd>`).join('<span class="plus">+</span>') : esc(T('ob.ready.tray'));
  $('made').innerHTML = (res.notes || []).map(n => n.created
    ? `<li><span>${esc(T('ob.ready.created', { name: '\u0000', dir: shortDir(dirOf(n.path)) })).replace('\u0000', `<code>${esc(n.name)}</code>`)}</span></li>`
    : `<li><span>${esc(T('ob.ready.using', { name: '\u0000' })).replace('\u0000', `<code>${esc(n.name)}</code>`)}</span></li>`).join('');
  const created = (res.notes || []).find(n => n.created);
  readyTitle = T(created ? (created.kind === 'work' ? 'ob.ready.first.work' : 'ob.ready.first') : 'ob.ready.next');
  const errs = res.errors || [];
  $('finish-err').hidden = !errs.length;
  $('finish-err').textContent = errs.map(e => T('ob.ready.err', { kind: T('ob.kind.' + e.kind), msg: e.message })).join(' ');
}

// ---- navigation ----
function chrome() {
  $('step-count').textContent = `${step} / 4`;
  document.querySelectorAll('.dots i').forEach((d, i) => { d.className = i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''; });
  $('btn-skip').hidden = step === 4;
  $('btn-skip').textContent = T(defs && defs.rerun ? 'ob.btn.cancel' : 'ob.btn.skip');
  $('btn-back').hidden = step === first || step === 4;
  $('btn-open').hidden = step !== 4;
  $('btn-next').textContent = T(step === 1 ? 'ob.btn.start' : step === 2 ? 'ob.btn.continue' : step === 3 ? 'ob.btn.finish' : 'ob.btn.done');
}
async function go(to) {
  const from = screens[step - 1], next = screens[to - 1], dir = (to > step ? 1 : -1) * (document.documentElement.dir === 'rtl' ? -1 : 1);
  step = to; chrome();
  scene(to);
  await M.play(from, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-12 * dir}px)` }], { duration: 120, easing: M.EASE_IN, fill: 'none' });
  from.hidden = true; next.hidden = false;
  next.querySelector('[tabindex="-1"]').focus({ preventScroll: true });
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
    M.nudge($('btn-next'));
  } finally { busy = false; $('btn-next').disabled = false; }
}
async function skip() {
  if (busy) return;
  if (defs && defs.rerun) return window.api.close(); // an existing install: cancelling changes nothing
  busy = true;
  try { await window.api.finish({ skip: true }); } finally { window.api.close(); }
}
$('btn-next').addEventListener('click', next);
$('btn-back').addEventListener('click', () => { if (!busy && step > first && step < 4) go(step - 1); });
$('btn-skip').addEventListener('click', skip);
$('btn-open').addEventListener('click', () => window.api.close('open'));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); step === 4 ? window.api.close() : skip(); }
  else if (e.key === 'Enter' && !e.target.closest('button, input')) { e.preventDefault(); next(); }
});

(async () => {
  defs = await window.api.defaults();
  LANG = defs.lang || 'en';
  window.I18N.applyDoc(LANG);
  ans.reminders.dayStart = $('ob-start').value = defs.dayStart || '09:00';
  ans.reminders.dayEnd = $('ob-end').value = defs.dayEnd || '17:00';
  ans.autoStart = $('ob-auto').checked = defs.autoStart !== false;
  setMode(defs.rerun && defs.mode ? defs.mode : 'both');
  setEvery([15, 30, 60, 90].includes(+defs.every) ? +defs.every : 60);
  renderStat('work'); renderStat('personal');
  if (defs.repair) { // every note went missing: straight to the notes step, saying which ones
    $('repair').textContent = T('ob.repair', { names: defs.missing.join(' · ') });
    $('repair').hidden = false;
    first = step = 2;
    screens[0].hidden = true; screens[1].hidden = false;
  }
  chrome();
  scene(step);
  screens[step - 1].querySelector('[tabindex="-1"]').focus({ preventScroll: true });
})();
