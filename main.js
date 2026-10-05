'use strict';
// Todo Island — tray reminder over the two Obsidian notes.
// Sources are only written on the owner's own clicks in the app (owner's hands), never in bulk by the AI.
const { app, Tray, Menu, BrowserWindow, ipcMain, nativeImage, screen, globalShortcut, nativeTheme, shell, clipboard, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { NoteFile, resolveDue, MONTHS, stampMs, fmtTime, parseDueText } = require('./lib/parse.js');
// the due as the note writes it: "28 Sep", "28 Sep 2pm", or a bare "2pm" (= today) (#7)
const dueTextOf = t => [t.due ? `${t.due.d} ${t.due.m}` : null, t.time != null ? fmtTime(t.time) : null].filter(Boolean).join(' ') || null;
const { composeTask } = require('./lib/compose.js');
const { planSetup, NOTE_NAME } = require('./lib/setup.js');
const { makePngBuffer } = require('./lib/icon.js');

// test/dev isolation: point the app at a scratch userData (its own state.json → its own note paths).
// E2E runs use this so they never touch the owner's real notes.
const SANDBOX = !!process.env.TODO_ISLAND_USERDATA;
if (SANDBOX) app.setPath('userData', process.env.TODO_ISLAND_USERDATA);
const STATE_PATH = path.join(app.getPath('userData'), 'state.json'); // userData: writable in dev AND packaged (asar is read-only)
const LOGF = path.join(process.env.TEMP || __dirname, 'todo-island.log');
const LOG = m => { try { fs.appendFileSync(LOGF, `${new Date().toISOString()} ${m}\n`); } catch (e) {} };

// where skipped/unpicked notes are created; a sandbox run keeps them inside its own userData (never the real Documents)
const DEFAULT_DIR = SANDBOX ? path.join(app.getPath('userData'), 'Documents', 'todos-island') : path.join(require('os').homedir(), 'Documents', 'todos-island');
const DEFAULT_SETTINGS = {
  // defaults = the owner's own tuned setup (2026-09-25) — every new install starts from it
  workIntervalMin: 60, offIntervalMin: 60, workRemindersOn: true, offRemindersOn: true,
  dayStart: '09:00', dayEnd: '17:00',
  dismissSec: 7, undoSec: 5, hoverSec: 1, shortcut: 'Control+Alt+T', focusByTime: true,
  weekendAware: true, weekendDays: 'auto', // weekendDays: auto (the Windows region's) | sat-sun | fri-sat
  autoStart: true, soundOn: true, mode: 'both', uiLang: 'system', // mode: 'both' | 'work' | 'personal'; uiLang: 'system' | 'en' | 'ar'
  updateCheck: true, // one quiet GitHub check at startup + daily → a green "Update" pill, never a popup
  accent: 'teal', // owner default 2026-09-29 (was blue) — theme color: blue | violet | teal | pink | graphite (tokens.css [data-accent])
  labelSize: 0, taskSize: 1, // text sizes 0–3 = small · default · large · larger (UI.applyTheme → --ui-k / --task-k)
  appearance: 'system', // system | light | dark → nativeTheme.themeSource (every window follows)
  islandTheme: 'lagoon', // owner default 2026-09-29 (was mist) — the picture under the island's glass: mist | dusk | lagoon | bloom | dune
  shareFmt: 'text', // Share + the island's quick Copy: 'text' (plain, WhatsApp-friendly) | 'md' (the note as written)
  hideFromCapture: true, // the island stays on your screen but Teams / OBS / screenshots can't see it (Windows "exclude from capture")
  glassLevel: 3, // frost: 0 = solid · 1–4 = 15/25/38/50 % of the theme shows through the island's glass
  workPath: path.join(DEFAULT_DIR, NOTE_NAME.work),
  personalPath: path.join(DEFAULT_DIR, NOTE_NAME.personal)
};
const migrateSettings = s => {
  if (s.intervalMin !== undefined && s.workIntervalMin === undefined) s.workIntervalMin = s.intervalMin; // v1.2 single interval → work interval
  delete s.intervalMin;
  delete s.tintLevel; // v1.7 Tint setting — removed with the live screen glass (v1.8)
  if (s.islandTheme === 'wallpaper') s.islandTheme = 'mist'; // the Wallpaper theme was removed in v1.11 (owner)
  return s;
};
const saveState = () => fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
// onboarded: false only on a truly fresh install (no state.json) — existing installs never see the first-run setup
let state = { settings: { ...DEFAULT_SETTINGS }, lastShown: 0, onboarded: false };
try {
  const saved = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  state = { ...state, ...saved, settings: migrateSettings({ ...DEFAULT_SETTINGS, ...(saved.settings || {}) }) };
  delete state.activeId; delete state.activeFile; // dead since the * marker moved "active" into the notes
  if (saved.onboarded === undefined) state.onboarded = true; // pre-onboarding install
} catch (e) {
  // one-time migration: carry over a dev-era state.json that lived next to main.js — DEV ONLY.
  // A packaged build must never read one: v1.4.1 shipped the developer's state.json inside the asar,
  // so fresh installs adopted foreign note paths, skipped onboarding and opened on two "can't read" errors.
  const legacy = path.join(__dirname, 'state.json');
  if (!app.isPackaged && !SANDBOX && legacy !== STATE_PATH && fs.existsSync(legacy)) {
    try {
      const old = JSON.parse(fs.readFileSync(legacy, 'utf8'));
      state = { ...state, ...old, settings: migrateSettings({ ...DEFAULT_SETTINGS, ...(old.settings || {}) }) };
      delete state.activeId; delete state.activeFile;
      state.onboarded = true;
      saveState();
    } catch (e2) {}
  }
}

let tray = null, island = null, mainWin = null;
// native chrome colors — must match tokens.css (--paper / --head / --muted) so the title bar blends in
const THEME = {
  light: { bg: '#f7f6f2', symbol: '#5c5a55' },
  dark: { bg: '#121211', symbol: '#a9a69e' }
};
const theme = () => THEME[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];
// every window paints its own chrome (glass header over the theme scene, or paper), so the native controls always sit on a
// clear overlay. Height 50 = the header's (window.css): a floating glass header is 6 + 38 + 6, so the buttons center on it.
const overlay = () => ({ color: '#00000000', symbolColor: theme().symbol, height: 50 });
// in-memory undo log — one entry per interaction, tokened, countdown-driven cleanup.
// entries live ONLY for the undo window: each popup fires undo-expire(token) when its countdown ends,
// undo-action(token) consumes its entry; pushUndo lazily drops anything expired. Nothing on disk.
const undoLog = new Map();
function pushUndo(entry) {
  const now = Date.now();
  for (const [k, v] of undoLog) if (v.expires <= now) undoLog.delete(k); // lazy expiry — the only sweeper
  const token = now.toString(36) + Math.random().toString(36).slice(2, 7);
  undoLog.set(token, entry);
  return token;
}
function latestUndo() {
  const now = Date.now();
  let best = null, bestToken = null;
  for (const [k, v] of undoLog) if (v.expires > now && (!best || v.expires > best.expires)) { best = v; bestToken = k; }
  return best ? { token: bestToken, ...best } : null;
}

const noteOn = tag => { const m = state.settings.mode || 'both'; return m === 'both' || m === tag; };
function workFile() { return new NoteFile(state.settings.workPath, { doneHeading: '## Done', fileTag: 'work' }); }
function personalFile() { return new NoteFile(state.settings.personalPath, { fileTag: 'personal' }); }
// every write through fileFor() is recorded — the tasks window shows it ("wrote work-tasks.md · just now")
let lastWrite = null;
function fileFor(tag) {
  const f = tag === 'work' ? workFile() : personalFile();
  const save = f.save.bind(f);
  f.save = () => { save(); lastWrite = { file: path.basename(f.path), at: Date.now() }; };
  return f;
}

function inWorkday() {
  const now = new Date();
  if (state.settings.weekendAware && isWeekend(schedSettings(), now)) return false; // the weekend = off time
  const [sh, sm] = state.settings.dayStart.split(':').map(Number);
  const [eh, em] = state.settings.dayEnd.split(':').map(Number);
  const s = new Date(now); s.setHours(sh, sm, 0, 0);
  const e = new Date(now); e.setHours(eh, em, 0, 0);
  return now >= s && now <= e;
}

const { nextFireAt: scheduleNext, isWeekend } = require('./lib/schedule.js');
// 'auto' weekend = the Windows region's: Friday + Saturday across most of the Arab world and a few others, else Sat + Sun
const FRI_SAT = new Set(['EG', 'SA', 'KW', 'QA', 'BH', 'OM', 'JO', 'IQ', 'DZ', 'LY', 'SD', 'SY', 'YE', 'PS', 'IL', 'BD', 'MV']);
const weekendDays = () => { const w = state.settings.weekendDays; if (w === 'sat-sun' || w === 'fri-sat') return w; let cc = ''; try { cc = app.getLocaleCountryCode(); } catch (e) {} return FRI_SAT.has(cc) ? 'fri-sat' : 'sat-sun'; };
const schedSettings = () => ({ ...state.settings, weekendDays: weekendDays() });
const nextFireAt = () => scheduleNext(schedSettings(), state.lastShown, Date.now());

const RANK = { '!!!': 3, '!!': 2, '!': 1 };
function snapshot() {
  const collect = (f, group) => f.topTasks().filter(t => !t.checked).map(t => ({
    id: f.id(t), file: group, title: t.title, // raw: **bold** etc. render in the app (UI.inline)
    priority: t.priority, active: !!t.active,
    dueText: dueTextOf(t), dueTime: t.time != null ? fmtTime(t.time) : null,
      dueTs: t.due || t.time != null ? resolveDue(t.due, t.time) : null,
      notes: f.notesOf(t),
      subs: f.subtasksOf(t).map(s => ({ t: s.title, done: s.checked, p: s.priority || null, c: s.created || null, u: s.updated || null })), // t = the note's title = the address
      created: t.created, updated: t.updated, updatedTs: stampMs(t.updated),
      lines: f.blockLines(t) // Share → Markdown: the block as the note has it, stamp stripped
  }));
  const doneOf = (f, group) => f.topTasks().filter(t => t.checked).map(t => ({
    id: f.id(t), file: group, title: t.title, // raw: **bold** etc. render in the app (UI.inline)
    priority: t.priority, dueText: dueTextOf(t),
    notes: f.notesOf(t),
    subs: f.subtasksOf(t).map(s => ({ t: s.title, done: s.checked, p: s.priority || null, c: s.created || null, u: s.updated || null })), // t = the note's title = the address
    lines: f.blockLines(t),
    created: t.created, updated: t.updated, updatedTs: stampMs(t.updated)
  }));
  const safe = (group, path) => {
    try {
      const f = group === 'work' ? workFile() : personalFile();
      return { file: group, items: collect(f, group), done: doneOf(f, group), error: null };
    }
    catch (e) { LOG('SOURCE-ERROR ' + group + ' ' + e.message); return { file: group, items: [], done: [], error: path }; }
  };
  // task mode: a disabled note is never read — no section, no error, no source
  const on = tag => noteOn(tag);
  const off = group => ({ file: group, items: [], done: [], error: null });
  const work = on('work') ? safe('work', state.settings.workPath) : off('work');
  const personal = on('personal') ? safe('personal', state.settings.personalPath) : off('personal');
  const errors = [work, personal].filter(r => r.error).map(r => ({ file: r.file, path: r.error, name: path.basename(r.error || '') }));
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const dec = t => !t.dueTs ? 'none' : t.dueTs < today0.getTime() ? 'overdue' : t.dueTs < today0.getTime() + 864e5 ? 'today' : 'future';
  const sort = arr => arr.sort((a, b) =>
    // order (owner, 2026-09-27): Now first, then due date (soonest; none last), then priority, then last edit (newest).
    // Ties (e.g. no stamps) keep the note's own order: Array.sort is stable.
    ((b.active ? 1 : 0) - (a.active ? 1 : 0)) ||
    ((a.dueTs || Infinity) - (b.dueTs || Infinity)) ||
    ((RANK[b.priority] || 0) - (RANK[a.priority] || 0)) ||
    (b.updatedTs - a.updatedTs));
  sort(work.items).forEach(t => t.dueState = dec(t));
  sort(personal.items).forEach(t => t.dueState = dec(t));
  const sections = (inWorkday()
    ? [{ name: 'Work', items: work.items }, { name: 'Personal', items: personal.items }]
    : [{ name: 'Personal', items: personal.items }, { name: 'Work', items: work.items }]).filter(s => on(s.name.toLowerCase()));
  const lu = latestUndo();
  const undo = lu
    ? { token: lu.token, kind: lu.kind, label: lu.label, starring: lu.kind === 'toggle' ? lu.prev === false : undefined, left: Math.max(0, Math.round((lu.expires - Date.now()) / 1000)) }
    : null;
  const sources = {};
  for (const tag of ['work', 'personal']) if (on(tag)) sources[tag] = path.basename(state.settings[tag + 'Path'] || '');
  // Done: newest done first (the u stamp = done date); unstamped done tasks keep note order after them.
  // Work notes already file each newly done task at the top of ## Done, so the note reads in the same order.
  const done = [...work.done, ...personal.done].sort((a, b) => b.updatedTs - a.updatedTs);
  return { sections, errors, sources, lastWrite, done, workday: inWorkday(), nextFire: nextFireAt(), settings: state.settings, lang: uiLang(), undo, update };
}

function sendSnap() { if (island) island.webContents.send('snapshot', snapshot()); }

// ---- update check: one GET to GitHub's latest-release API at startup (then daily). No popup, no download:
// a newer release lights a green "Update" pill in the island + tasks-window top bars; a click opens its page.
// Offline / rate-limited / any failure = silence (no pill), next try tomorrow. Off in Settings → App.
const { pickUpdate, API: UPDATE_API } = require('./lib/update.js');
let update = null;
async function checkForUpdate() {
  const fake = process.env.TODO_ISLAND_UPDATE_TEST; // E2E: pretend this tag is the latest release (no network)
  if (!state.settings.updateCheck || (SANDBOX && !fake)) return;
  try {
    let release;
    if (fake) release = { tag_name: fake, html_url: 'https://github.com/abdallahmagdy15/todos-island/releases/tag/' + fake };
    else {
      const r = await net.fetch(UPDATE_API, { headers: { 'User-Agent': 'todos-island/' + app.getVersion(), Accept: 'application/vnd.github+json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      release = await r.json();
    }
    setUpdate(pickUpdate(release, app.getVersion()));
    LOG('UPDATE-CHECK ' + (update ? 'available ' + update.version : 'up to date ' + app.getVersion()));
  } catch (e) { LOG('UPDATE-CHECK-FAIL ' + e.message); }
}
function setUpdate(u) {
  if (JSON.stringify(u) === JSON.stringify(update)) return;
  update = u;
  sendSnap();
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('tasks-changed'); // the window re-reads its snapshot
}
ipcMain.handle('open-update', () => { if (update) shell.openExternal(update.url); });

// ---- island themes: the island paints its own picture under its glass (island.js). It no longer films the screen
// (owner, 2026-09-27: the live copy lagged behind scrolling and filmed the mouse pointer as a blurry ghost), so the
// island is an ordinary window again: it shows in screenshots and screen shares.
const SHOWCASE = !!process.env.TODO_ISLAND_SHOWCASE; // README screenshots: TODO_ISLAND_THEME forces light/dark
const applyAppearance = () => {
  const forced = SHOWCASE && /^(light|dark)$/.test(process.env.TODO_ISLAND_THEME || '') ? process.env.TODO_ISLAND_THEME : null;
  nativeTheme.themeSource = forced || (['light', 'dark'].includes(state.settings.appearance) ? state.settings.appearance : 'system');
};
applyAppearance();
async function showIsland(opts = {}) {
  if (!state.onboarded) { openOnboarding(); return; } // nothing to show until first-run setup picks the notes
  if (!island) return;
  const wasHidden = !island.isVisible();
  // focusable while shown: a non-focusable (WS_EX_NOACTIVATE) window that was hidden and shown again drops every real mouse
  // click on Windows — the island looked alive but ignored clicks after a timed pop (owner report, 2026-09-27; reproduced
  // with real OS clicks, CDP clicks never showed it). showInactive still never takes focus: only the user's own click does.
  sendSnap(); island.setFocusable(true); island.showInactive();
  island.webContents.send('island-shown', { fresh: !wasHidden }); // always: resets renderer state (cancels stuck animations, replays drop-in)
  if (state.settings.soundOn) island.webContents.send('play-sound');
  // keyboard summon only: the island takes focus so arrows/Enter/Space work. Timed pops NEVER steal focus.
  if (opts.focus) { island.setFocusable(true); island.focus(); island.webContents.send('island-focus'); }
}
function hideIsland() { if (island) { island.hide(); island.setFocusable(false); } }

function createIsland() {
  const wa = screen.getPrimaryDisplay().workArea;
  const W = 592;
  island = new BrowserWindow({
    width: W, height: 120, x: wa.x + Math.round((wa.width - W) / 2), y: wa.y + 10,
    frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true,
    focusable: false, alwaysOnTop: true, hasShadow: false, thickFrame: false, show: false,
    // no background throttling: a hidden/occluded island renderer had its timers + animations frozen, so a retract
    // never finished, the window stayed "visible" and the next shortcut press only dismissed it (needed twice)
    webPreferences: { preload: path.join(__dirname, 'island-preload.js'), backgroundThrottling: false }
  });
  island.setAlwaysOnTop(true, 'screen-saver');
  applyCaptureHide();
  lockZoom(island.webContents);
  island.loadFile('island.html');
}

// Hide from screen sharing (owner 2026-09-29): Windows' "exclude from capture" flag (SetWindowDisplayAffinity) —
// the island still pops on time on YOUR screen, but Teams, OBS, Zoom, screenshots and any future capture app see
// through it. Enforced by Windows, so no app detection. Island only: the tasks window is opened on purpose and may be
// shown. Showcase runs force it off so README captures keep the island.
function applyCaptureHide() {
  if (!island || island.isDestroyed()) return;
  const on = !!state.settings.hideFromCapture && !SHOWCASE;
  try { island.setContentProtection(on); } catch (e) { LOG('CAPTURE-HIDE-FAIL ' + e.message); }
}

function openWindow(tab) {
  if (typeof tab !== 'string') tab = null; // tray/menu callers pass event objects
  if (!state.onboarded) { openOnboarding(); return; }
  if (mainWin) {
    mainWin.show(); mainWin.focus();
    mainWin.webContents.send('window-opened'); // opening it again sorts it again (owner 2026-09-29); while open, rows stay put
    if (tab) mainWin.webContents.send('show-tab', tab);
    return;
  }
  mainWin = new BrowserWindow({
    width: 880, height: 660, minWidth: 660, minHeight: 540, // 880 by default (owner 2026-09-28: "slightly wider" — room for the side panel)
    backgroundColor: theme().bg,
    autoHideMenuBar: true, show: false,
    frame: false, titleBarStyle: 'hidden',
    // overlay must exist at creation — setTitleBarOverlay throws otherwise ("Titlebar overlay is not enabled")
    titleBarOverlay: overlay(),
    webPreferences: { preload: path.join(__dirname, 'window-preload.js') }
  });
  applyOverlay();
  lockZoom(mainWin.webContents);
  mainWin.webContents.on('console-message', (_e, _lvl, msg) => LOG('WIN-CONSOLE: ' + msg));
  mainWin.loadFile('window.html', tab ? { query: { tab } } : undefined);
  mainWin.once('ready-to-show', () => mainWin.show());
  if (SHOWCASE && process.env.TODO_ISLAND_SHOT) { // README screenshots: the window paints its own glass, so capturePage is exact
    mainWin.once('ready-to-show', () => setTimeout(async () => {
      if (!mainWin) return;
      fs.writeFileSync(process.env.TODO_ISLAND_SHOT, (await mainWin.webContents.capturePage()).toPNG()); LOG('SHOT ' + process.env.TODO_ISLAND_SHOT);
    }, 2500));
  }
  mainWin.on('render-process-gone', (_e, d) => LOG('WIN-GONE: ' + d.reason));
  mainWin.on('restore', () => mainWin.webContents.send('window-opened')); // un-minimized = opened again
  mainWin.on('closed', () => { mainWin = null; });
}

// Edit and Share are the tasks window's side panel (owner 2026-09-28: no popup windows). Callers outside the window
// (the island's ✎ Edit and Share) open the window and hand it the panel; a window still loading gets it once it's ready.
function sendPanel(p) {
  openWindow();
  if (!mainWin) return; // onboarding not done yet — openWindow showed the wizard instead
  const wc = mainWin.webContents;
  if (wc.isLoading()) wc.once('did-finish-load', () => setTimeout(() => wc.send('open-panel', p), 50));
  else wc.send('open-panel', p);
}
const openShare = () => sendPanel({ kind: 'share' });
const openEditor = (file, id) => sendPanel({ kind: 'edit', file: String(file), id: String(id) });
ipcMain.handle('open-share', () => openShare());
ipcMain.handle('export-md', async (_e, text) => {
  const { dialog } = require('electron');
  const d = new Date();
  const res = await dialog.showSaveDialog(mainWin || undefined, {
    title: 'Export progress as Markdown',
    defaultPath: path.join(require('os').homedir(), 'Downloads', `progress-${d.getDate()}-${MONTHS[d.getMonth()]}.md`),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (res.canceled || !res.filePath) return { ok: false };
  fs.writeFileSync(res.filePath, String(text || ''), 'utf8');
  return { ok: true, path: res.filePath };
});

// a new note in the v3 format — 'wx' so an existing file is NEVER overwritten (throws EEXIST instead)
function createNote(p, isWork) {
  const today = `${new Date().getDate()} ${MONTHS[new Date().getMonth()]}`;
  const lines = [
    `# ${isWork ? 'Work Tasks' : 'Personal Todos'}`, '',
    '> Format: `- [ ] /now !! 24 Sep -- Task title` — `/now` = working on it now, `!` priority, `D Mon` due (all optional, any order).',
    `> ${isWork ? 'Done tasks move under ## Done.' : 'Tick tasks when done.'} Edit freely — the app reads whatever you write.`, '',
    ...(isWork ? ['## Open', ''] : []),
    `- [ ] ${isWork ? '! ' : ''}${today} -- My first ${isWork ? 'work task' : 'todo'}`, '',
    ...(isWork ? ['## Done', ''] : []),
    ''
  ];
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.join('\n'), { flag: 'wx' });
}

// ---- first-run onboarding: 4 short screens → planSetup (lib/setup.js) → notes created/adopted → island pops ----
let onboardWin = null, onboardOpts = {};
// setup repair: an onboarded install whose EVERY enabled note is gone (moved, renamed, a foreign path) reopens setup
// instead of greeting the user with nothing but "can't read" errors. One missing note of two stays an honest error.
const missingNotes = () => ['work', 'personal'].filter(tag => noteOn(tag) && !fs.existsSync(state.settings[tag + 'Path'] || ''));
const needsRepair = () => { const on = ['work', 'personal'].filter(noteOn); return on.length > 0 && missingNotes().length === on.length; };
// opts: { rerun } — an existing install runs setup again (tray "Set up again…" or repair); Skip then just closes
function openOnboarding(opts = {}) {
  if (onboardWin && !onboardWin.isDestroyed()) { onboardWin.show(); onboardWin.focus(); return; }
  onboardOpts = { rerun: !!state.onboarded, repair: !!opts.repair };
  onboardWin = new BrowserWindow({
    width: 580, height: 700, resizable: false, maximizable: false, minimizable: false, center: true,
    backgroundColor: theme().bg,
    autoHideMenuBar: true, show: false, frame: false, titleBarStyle: 'hidden',
    titleBarOverlay: overlay(),
    webPreferences: { preload: path.join(__dirname, 'onboard-preload.js') }
  });
  lockZoom(onboardWin.webContents);
  onboardWin.webContents.on('console-message', (_e, _lvl, msg) => LOG('ONBOARD-CONSOLE: ' + msg));
  onboardWin.loadFile('onboard.html');
  onboardWin.once('ready-to-show', () => onboardWin.show());
  // closing mid-way = Skip, so the app is always usable afterwards
  onboardWin.on('closed', () => { onboardWin = null; if (!state.onboarded) { finishOnboarding({ skip: true }); setTimeout(showIsland, 400); } });
}
function finishOnboarding(answers) {
  const plan = planSetup(answers, { defaultDir: DEFAULT_DIR, exists: p => fs.existsSync(p) });
  const errors = [];
  for (const c of plan.create) {
    try { createNote(c.path, c.kind === 'work'); LOG('ONBOARD-CREATED ' + c.kind); }
    catch (e) { if (e.code !== 'EEXIST') errors.push({ kind: c.kind, message: e.message }); }
  }
  state.settings = { ...state.settings, ...plan.settings };
  state.onboarded = true;
  state.lastShown = Date.now(); // the next timed pop counts from the end of setup
  saveState();
  applyAutoStart(state.settings.autoStart);
  LOG('ONBOARD-DONE mode=' + state.settings.mode + (answers && answers.skip ? ' (skipped)' : ''));
  const name = p => path.basename(p);
  return {
    ok: !errors.length, errors, mode: state.settings.mode, shortcut: state.settings.shortcut,
    notes: [...plan.create.map(c => ({ kind: c.kind, name: name(c.path), path: c.path, created: true })),
      ...plan.adopt.map(c => ({ kind: c.kind, name: name(c.path), path: c.path, created: false }))]
  };
}
ipcMain.handle('onboard-defaults', () => ({
  lang: uiLang(), accent: state.settings.accent, rerun: onboardOpts.rerun,
  look: { accent: state.settings.accent, islandTheme: state.settings.islandTheme, glassLevel: state.settings.glassLevel, labelSize: state.settings.labelSize, taskSize: state.settings.taskSize }, repair: onboardOpts.repair, mode: state.settings.mode,
  missing: onboardOpts.repair ? missingNotes().map(tag => path.basename(state.settings[tag + 'Path'])) : [],
  defaultDir: DEFAULT_DIR, noteName: NOTE_NAME, shortcut: state.settings.shortcut,
  dayStart: state.settings.dayStart, dayEnd: state.settings.dayEnd,
  every: state.settings.workIntervalMin, offEvery: state.settings.offIntervalMin, autoStart: state.settings.autoStart
}));
ipcMain.handle('pick-path', async (_e, kind) => {
  // E2E: the native dialog can't be clicked by a script — a sandbox run hands the answer in
  if (SANDBOX && process.env.TODO_ISLAND_PICK) return { ok: true, path: process.env.TODO_ISLAND_PICK };
  const { dialog } = require('electron');
  const res = await dialog.showOpenDialog(onboardWin || mainWin || undefined, kind === 'folder'
    ? { title: 'Choose a folder for the note', properties: ['openDirectory', 'createDirectory'] }
    : { title: 'Choose your todo note', properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }] });
  if (res.canceled || !res.filePaths.length) return { ok: false };
  return { ok: true, path: res.filePaths[0] };
});
ipcMain.handle('inspect-path', (_e, kind, p, note) => {
  // what a pick resolves to — the same rule planSetup uses (folder → <folder>/<note name>)
  const target = kind === 'folder' ? path.join(String(p), NOTE_NAME[note] || NOTE_NAME.personal) : String(p);
  const out = { path: target, name: path.basename(target), exists: fs.existsSync(target), open: 0, error: null };
  if (out.exists) {
    try { const f = new NoteFile(target, { fileTag: note }); out.open = f.topTasks().filter(t => !t.checked).length; }
    catch (e) { out.error = 'Can’t read this file'; }
  }
  return out;
});
ipcMain.handle('onboard-finish', (_e, answers) => {
  const res = finishOnboarding(answers || {});
  sendSnap();
  setTimeout(showIsland, 700); // the real island drops in behind the Ready screen
  return res;
});
ipcMain.handle('onboard-close', (_e, then) => {
  if (onboardWin && !onboardWin.isDestroyed()) onboardWin.close();
  if (then === 'open') openWindow();
});

function lockZoom(wc) {
  wc.setZoomFactor(1);
  wc.on('zoom-changed', () => wc.setZoomFactor(1)); // accidental Ctrl+scroll/plus must never wreck the layout
}

function applyOverlay() { // Light/Dark switched: every open window's caption symbols follow
  for (const w of [mainWin, onboardWin]) {
    if (!w || w.isDestroyed()) continue;
    try { w.setTitleBarOverlay(overlay()); } catch (e) { LOG('OVERLAY-SKIP ' + e.message); }
  }
}
nativeTheme.on('updated', applyOverlay);

function registerShortcut() {
  globalShortcut.unregisterAll();
  const sc = (state.settings.shortcut || '').trim();
  if (!sc) return true;
  try {
    const ok = globalShortcut.register(sc, () => {
      // toggle: same key shows and dismisses — dismiss lets the pill retract (animated) via the renderer,
      // with a hard hide as backstop in case the renderer's animation promise dies silently
      if (island && island.isVisible()) { island.setFocusable(false); island.webContents.send('retract-island'); setTimeout(() => hideIsland(), 400); }
      else showIsland({ focus: true });
    });
    LOG(ok ? `SHORTCUT-OK ${sc}` : `SHORTCUT-FAILED ${sc}`);
    return !!ok;
  } catch (e) { LOG('SHORTCUT-ERROR ' + e.message); return false; }
}

function applyAutoStart(on) {
  // dev: electron.exe alone boots the default Electron welcome page — the app path must ride along.
  // --hidden marks a system launch (checked below) so boot stays quiet.
  if (SANDBOX) { LOG('AUTOSTART-SKIP sandbox ' + !!on); return; } // test runs must never rewrite the real login item
  const args = [];
  if (!app.isPackaged) args.push(app.getAppPath());
  args.push('--hidden');
  app.setLoginItemSettings({ openAtLogin: !!on, openAsHidden: true, args });
}

const { resolveLang, t: tt } = require('./lib/i18n.js');
const uiLang = () => resolveLang(state.settings.uiLang, app.getLocale()); // 'system' follows the OS
function rebuildTrayMenu() {
  if (!tray) return;
  const L = uiLang();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: tt(L, 'tray.show'), click: () => { state.lastShown = Date.now(); saveState(); showIsland(); } },
    { label: tt(L, 'tray.open'), click: openWindow },
    { label: tt(L, 'tray.setup'), click: () => openOnboarding() },
    { type: 'separator' },
    { label: tt(L, 'tray.capture'), type: 'checkbox', checked: !!state.settings.hideFromCapture, click: item => {
      state.settings.hideFromCapture = item.checked; saveState(); applyCaptureHide(); sendSnap();
      if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('tasks-changed'); // Settings switch follows
    } },
    { type: 'separator' },
    { label: tt(L, 'tray.quit'), click: () => app.quit() }
  ]));
}
// tray glyph [★]: brackets in the taskbar's own ink (light or dark taskbar), one sharp bitmap per display scale
function trayImage() {
  const dark = nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ?? nativeTheme.shouldUseDarkColors;
  const img = nativeImage.createEmpty();
  for (const [scaleFactor, px] of [[1, 16], [1.25, 20], [1.5, 24], [2, 32]]) img.addRepresentation({ scaleFactor, buffer: makePngBuffer(px, { tray: true, dark }) });
  return img;
}
function createTray() {
  tray = new Tray(trayImage());
  nativeTheme.on('updated', () => { if (tray && !tray.isDestroyed()) tray.setImage(trayImage()); }); // taskbar theme switched
  rebuildTrayMenu();
  tray.on('click', () => showIsland());
  const tick = () => {
    const nf = new Date(nextFireAt());
    const time = `${String(nf.getHours()).padStart(2, '0')}:${String(nf.getMinutes()).padStart(2, '0')}`;
    tray.setToolTip(tt(uiLang(), 'tray.tip', { t: time, sc: state.settings.shortcut }));
    if (state.onboarded && Date.now() >= nextFireAt()) { state.lastShown = Date.now(); saveState(); showIsland(); }
  };
  tick();
  setInterval(tick, 15000);
}

ipcMain.on('island-size', (_e, h, top = 0) => {
  if (!island) return;
  // island flush with screen top (wa.y), grows DOWN; hover cards may borrow space above via `top` (clamped to screen)
  const wa = screen.getPrimaryDisplay().workArea;
  const height = Math.max(70, Math.min(960, Math.round(h)));
  const topExtra = Math.max(0, Math.round(top || 0));
  const y = Math.max(wa.y, wa.y + 10 - topExtra);
  const b = island.getBounds();
  island.setBounds({ x: b.x, y, width: b.width, height });
});
ipcMain.on('hide-island', hideIsland);
ipcMain.on('open-window', (_e, tab) => openWindow(tab));
ipcMain.handle('toggle-active', (_e, id, file) => {
  const f = fileFor(file);
  const t = f.findById(id);
  if (!t) return;
  const prev = t.active, prevU = t.updated;
  const label = t.title.replace(/\*\*/g, '');
  f.toggleActive(id); f.save();
  const token = pushUndo({ kind: 'toggle', file, id, prev, prevU, label, expires: Date.now() + state.settings.undoSec * 1000 });
  sendSnap(); pushUndoToWindow(token);
  if (mainWin) mainWin.webContents.send('tasks-changed');
});
ipcMain.handle('toggle-subtask', (_e, file, parentId, subTitle, session) => subtaskWrite(file, parentId, session, f => f.toggleSubtask(parentId, subTitle)));
ipcMain.handle('subtask-priority', (_e, file, parentId, subTitle, p, session) => subtaskWrite(file, parentId, session, f => f.setSubtaskPriority(parentId, subTitle, p)));
ipcMain.handle('rename-subtask', (_e, file, parentId, subTitle, newTitle, session) => subtaskWrite(file, parentId, session, f => f.renameSubtask(parentId, subTitle, newTitle)));
function pushUndoToWindow(token) {
  const e = token && undoLog.get(token);
  if (mainWin && e) {
    mainWin.webContents.send('show-undo', {
      token,
      kind: e.kind, // without kind the window's Undo button picked the wrong channel — that bug is dead
      label: e.label,
      starring: e.kind === 'toggle' ? e.prev === false : undefined,
      left: Math.max(0, Math.round((e.expires - Date.now()) / 1000))
    });
  }
}
ipcMain.handle('complete', (_e, id, file) => {
  const f = fileFor(file);
  const cap = f.captureBlock(id);
  const t = f.findById(id);
  f.complete(id); f.save();
  if (cap) {
    const token = pushUndo({ kind: 'complete', file, cap, label: (t ? t.title.replace(/\*\*/g, '') : 'task'), expires: Date.now() + state.settings.undoSec * 1000 });
    pushUndoToWindow(token);
  }
  saveState(); sendSnap();
  if (mainWin) mainWin.webContents.send('tasks-changed');
});
// one-shot undo: each popup knows its token; rollback is exact (captured lines back at the captured index)
ipcMain.handle('undo-action', (_e, token) => {
  const e = undoLog.get(token);
  if (!e || Date.now() > e.expires) { undoLog.delete(token); return { ok: false }; }
  undoLog.delete(token); // one-time — consumed
  if (e.kind === 'clear') {
    // whole-file rollback, but only if nobody touched the note since the clear — never clobber edits made in Obsidian
    const changed = [];
    for (const c of e.caps) {
      let now = null;
      try { now = fs.readFileSync(c.path, 'utf8'); } catch (err) {}
      if (now !== c.after) { changed.push(path.basename(c.path)); continue; }
      writeNoteText(c.path, c.before);
      lastWrite = { file: path.basename(c.path), at: Date.now() };
    }
    sendSnap();
    if (mainWin) mainWin.webContents.send('tasks-changed');
    return changed.length ? { ok: false, reason: 'changed', files: changed } : { ok: true };
  }
  if (e.kind === 'settings') { // undo a reset: the captured settings object goes back, files were never touched
    const cur = state.settings;
    state.settings = e.prev;
    saveState();
    applySettingsSideEffects(cur);
    return { ok: true };
  }
  const f = fileFor(e.file);
  if (e.kind === 'toggle') {
    const t = f.findById(e.id);
    if (t) { t.active = e.prev; if (e.prevU !== undefined) t.updated = e.prevU; t.dirty = true; f.save(); } // exact rollback, stamp included
  } else if (e.kind === 'edit') { // the edited task (current title) goes; the block as the panel found it comes back in place
    f.removeByTitle(e.curTitle); f.insertBlockAt(e.cap.index, e.cap.lines); f.save();
  } else {
    f.restoreBlock(e.cap); f.save(); // complete / delete / reorder all roll back via the captured block
  }
  sendSnap();
  if (mainWin) mainWin.webContents.send('tasks-changed');
  return { ok: true };
});
ipcMain.handle('undo-expire', (_e, token) => { undoLog.delete(token); }); // fired by the popup's own countdown — memory released with the bubble
ipcMain.handle('get-snapshot', () => snapshot());
ipcMain.handle('open-editor', (_e, file, id) => openEditor(file, id));
ipcMain.handle('save-settings', (_e, s) => {
  const clean = Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined));
  const result = { ok: true, errors: {} };
  if (clean.shortcut !== undefined && clean.shortcut !== state.settings.shortcut) {
    const prev = state.settings.shortcut;
    state.settings.shortcut = clean.shortcut;
    if (!registerShortcut()) {
      state.settings.shortcut = prev; registerShortcut();
      result.ok = false; result.errors.shortcut = 'set.err.shortcut';
    }
  }
  if (clean.autoStart !== undefined && clean.autoStart !== state.settings.autoStart) {
    applyAutoStart(clean.autoStart);
  }
  for (const k of ['workPath', 'personalPath']) {
    if (clean[k] !== undefined && !fs.existsSync(clean[k])) {
      result.ok = false; result.errors[k] = 'set.err.file';
      delete clean[k];
    }
  }
  if (clean.mode !== undefined && !['both', 'work', 'personal'].includes(clean.mode)) delete clean.mode;
  if (clean.updateCheck !== undefined) clean.updateCheck = !!clean.updateCheck;
  if (clean.hideFromCapture !== undefined) clean.hideFromCapture = !!clean.hideFromCapture;
  if (clean.shareFmt !== undefined && !['text', 'md'].includes(clean.shareFmt)) delete clean.shareFmt;
  if (clean.accent !== undefined && !['blue', 'violet', 'teal', 'pink', 'graphite'].includes(clean.accent)) delete clean.accent;
  for (const k of ['labelSize', 'taskSize']) if (clean[k] !== undefined) { const v = Math.round(+clean[k]); if (v >= 0 && v <= 3) clean[k] = v; else delete clean[k]; }
  delete clean.tintLevel; // removed in v1.8
  for (const k of ['dayStart', 'dayEnd']) if (clean[k] !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(clean[k])) delete clean[k]; // the scheduler splits HH:MM
  if (clean.weekendDays !== undefined && !['auto', 'sat-sun', 'fri-sat'].includes(clean.weekendDays)) delete clean.weekendDays;
  if (clean.appearance !== undefined && !['system', 'light', 'dark'].includes(clean.appearance)) delete clean.appearance;
  if (clean.islandTheme !== undefined && !['mist', 'dusk', 'lagoon', 'bloom', 'dune'].includes(clean.islandTheme)) delete clean.islandTheme;
  if (clean.glassLevel !== undefined) { const g = Math.round(+clean.glassLevel); if (g >= 0 && g <= 4) clean.glassLevel = g; else delete clean.glassLevel; }
  const wasOn = { work: noteOn('work'), personal: noteOn('personal') };
  state.settings = { ...state.settings, ...clean };
  // switching a note ON creates it when its file doesn't exist yet (the user's own click — owner's hands)
  for (const tag of ['work', 'personal']) {
    const p = state.settings[tag + 'Path'];
    if (!wasOn[tag] && noteOn(tag) && p && !fs.existsSync(p)) {
      try { createNote(p, tag === 'work'); LOG('SEEDED ' + p); }
      catch (e) { result.ok = false; result.errors[tag + 'Path'] = 'set.err.create'; }
    }
  }
  saveState();
  if (!state.settings.updateCheck) setUpdate(null); else if (!update) checkForUpdate();
  applyAppearance(); // Light/Dark may have changed
  applyCaptureHide();
  rebuildTrayMenu(); // the tray's "Hide from screen sharing" tick follows the setting
  if (clean.uiLang !== undefined && clean.uiLang !== state.settings.uiLang) {
    // language switch: tray re-labels (above), every live window re-applies its chrome, island re-renders via snapshot
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('lang-changed', uiLang());
  }
  sendSnap();
  return result;
});
// ---- settings reset + setup re-run ----
// side effects shared by reset and its undo — everything EXCEPT file work. The reset itself writes
// state.json ONLY: no note file is ever created, deleted, or modified (owner's iron rule, 2026-09-27).
function applySettingsSideEffects(prev) {
  if (state.settings.shortcut !== prev.shortcut && !registerShortcut()) LOG('RESET-SHORTCUT-FAIL');
  if (state.settings.autoStart !== prev.autoStart) applyAutoStart(state.settings.autoStart);
  if (!state.settings.updateCheck) setUpdate(null); else if (!update) checkForUpdate();
  applyAppearance();
  applyCaptureHide();
  rebuildTrayMenu();
  if (uiLang() !== resolveLang(prev.uiLang, app.getLocale())) {
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('lang-changed', uiLang());
  }
  sendSnap();
  if (mainWin) mainWin.webContents.send('tasks-changed');
}
ipcMain.handle('reset-settings', () => {
  const prev = state.settings;
  state.settings = { ...DEFAULT_SETTINGS }; // paths revert to the default folder; the files on disk stay exactly where they were
  saveState();
  applySettingsSideEffects(prev);
  const token = pushUndo({ kind: 'settings', prev, label: null, expires: Date.now() + state.settings.undoSec * 1000 });
  pushUndoToWindow(token);
  LOG('SETTINGS-RESET');
  return { ok: true };
});
ipcMain.handle('open-onboarding', () => openOnboarding()); // Settings button = the tray's "Set up again…": merge-over, never a wipe
// The side-panel editor saves itself (owner 2026-09-28), so every save carries its panel `session`. The FIRST save of a
// session captures the task block as it was; each later save re-issues ONE undo bubble holding that same capture, so a
// single Undo rolls back everything changed since the panel opened (kind 'edit' in undo-action). A no-op save (the
// formatted block didn't change) writes nothing and shows nothing.
const editSessions = new Map(); // session → live undo token
function sessionWrite(f, file, t, session, before) { // after a REAL change: save + (re)issue the session's one undo bubble
  f.save();
  const prevTok = editSessions.get(session), prev = prevTok && undoLog.get(prevTok);
  if (prev) undoLog.delete(prevTok); // the old bubble's token dies; its capture (the task as the session found it) carries over
  const token = pushUndo({ kind: 'edit', file, cap: prev ? prev.cap : before, curTitle: t.title, label: t.title.replace(/\*\*/g, ''), expires: Date.now() + state.settings.undoSec * 1000 });
  editSessions.set(session, token);
  pushUndoToWindow(token);
  sendSnap(); if (mainWin) mainWin.webContents.send('tasks-changed');
}
// subtask changes (tick / add / delete / rename) with a session are undoable like edits; callers without a panel
// (the list's [ ], the island) pass a one-off session per click, so every subtask write gets its own Undo
function subtaskWrite(file, parentId, session, mutate) {
  const f = fileFor(file);
  const t = f.findById(parentId);
  if (!t) return { ok: false };
  const before = session ? f.captureBlock(parentId) : null, textBefore = f.text();
  mutate(f);
  if (f.text() === textBefore) return { ok: true, changed: false };
  if (session) sessionWrite(f, file, t, session, before);
  else { f.save(); sendSnap(); if (mainWin) mainWin.webContents.send('tasks-changed'); }
  return { ok: true, changed: true };
}
// "28 Sep 2pm" / "28 Sep" / "" → { due, time } for the note; 31 Feb clamps to 28/29 Feb; a bare time gets today's date
function dueFromText(text) {
  const r = parseDueText(text);
  if (r.due) {
    const mi = MONTHS.indexOf(r.due.m) + 1;
    r.due.d = Math.min(r.due.d, new Date(new Date().getFullYear(), mi, 0).getDate());
  } else if (r.time != null) { const n = new Date(); r.due = { d: n.getDate(), m: MONTHS[n.getMonth()] }; }
  return { due: r.due, time: r.due ? r.time : null };
}
ipcMain.handle('update-task', (_e, file, id, patch) => {
  const f = fileFor(file);
  const before = patch.session ? f.captureBlock(id) : null, textBefore = patch.session ? f.text() : null;
  let due = undefined, time = undefined;
  if (patch.dueText !== undefined) ({ due, time } = dueFromText(patch.dueText));
  const t = f.findById(id);
  const starToggled = t && patch.active !== undefined && !!patch.active !== !!t.active; // editor's ★ path counts as a star interaction
  f.update(id, { title: patch.title, priority: patch.priority, due, time, active: patch.active });
  if (patch.desc !== undefined) f.setNotes(id, patch.desc);
  if (patch.session && t) {
    const changed = f.text() !== textBefore; // captureBlock holds RAW lines (re-serialized only on save) — compare the real output
    if (!changed) return { id: f.id(t), changed: false };
    sessionWrite(f, file, t, patch.session, before);
    return { id: f.id(t), changed: true };
  }
  f.save();
  if (starToggled && t) {
    const token = pushUndo({ kind: 'toggle', file, id: f.id(t), prev: !patch.active, label: t.title.replace(/\*\*/g, ''), expires: Date.now() + state.settings.undoSec * 1000 });
    pushUndoToWindow(token);
  }
  sendSnap(); if (mainWin) mainWin.webContents.send('tasks-changed');
  return t ? { id: f.id(t) } : { id: null }; // id may change — editor adopts the new one
});
ipcMain.handle('compose-task', (_e, data) => composeTask(data || {})); // live "will write" preview — same serializer the note uses
ipcMain.handle('add-task', (_e, file, data) => {
  if (file !== 'work' && file !== 'personal') return { ok: false };
  const f = fileFor(file);
  const { due, time } = dueFromText(data.dueText);
  const t = f.addTask({ title: data.title, priority: data.priority || null, active: !!data.active, due, time });
  if (t && data.desc && data.desc.length) f.setNotes(f.id(t), data.desc);
  f.save(); sendSnap(); if (mainWin) mainWin.webContents.send('tasks-changed');
  return { ok: !!t, id: t ? f.id(t) : null };
});
ipcMain.handle('add-subtask', (_e, file, parentId, title, session) => {
  if (session) return subtaskWrite(file, parentId, session, f => f.addSubtask(parentId, title));
  const f = fileFor(file); f.addSubtask(parentId, title); f.save(); sendSnap();
  if (mainWin) mainWin.webContents.send('tasks-changed');
});
ipcMain.handle('delete-task', (_e, id, file) => {
  const f = fileFor(file);
  const cap = f.deleteTask(id); // cap captured BEFORE the splice — exact rollback material
  if (!cap) return;
  const token = pushUndo({ kind: 'delete', file, cap, label: (cap.title || 'task').replace(/\*\*/g, ''), expires: Date.now() + state.settings.undoSec * 1000 });
  f.save(); sendSnap(); pushUndoToWindow(token);
  if (mainWin) mainWin.webContents.send('tasks-changed');
});
ipcMain.handle('delete-subtask', (_e, file, parentId, title, session) => subtaskWrite(file, parentId, session, f => f.deleteSubtask(parentId, title)));
ipcMain.handle('uncomplete-task', (_e, id, file) => {
  const f = fileFor(file);
  f.uncomplete(id); f.save(); sendSnap();
  if (mainWin) mainWin.webContents.send('tasks-changed');
});
ipcMain.handle('move-task', (_e, file, id, dir) => {
  const f = fileFor(file);
  f.moveTask(id, dir); f.save(); sendSnap();
  if (mainWin) mainWin.webContents.send('tasks-changed');
});
ipcMain.handle('reorder-task', (_e, file, id, beforeId) => {
  const f = fileFor(file);
  const cap = f.captureBlock(id); // previous position + lines — rollback material for the reorder
  f.reorderTask(id, beforeId || null); f.save(); sendSnap();
  if (cap) {
    const token = pushUndo({ kind: 'reorder', file, cap, label: cap.title.replace(/\*\*/g, ''), expires: Date.now() + state.settings.undoSec * 1000 });
    pushUndoToWindow(token);
  }
  if (mainWin) mainWin.webContents.send('tasks-changed');
});
function writeNoteText(p, text) { // same atomic write NoteFile.save uses
  try { fs.writeFileSync(p + '.tmp', text); fs.renameSync(p + '.tmp', p); }
  catch (e) { fs.writeFileSync(p, text); }
}
// Clear all done tasks in both notes — undoable (whole-file capture, restored only if the note is unchanged since)
ipcMain.handle('clear-done-all', () => {
  const caps = []; let n = 0;
  for (const tag of ['work', 'personal']) {
    try {
      const f = fileFor(tag);
      const before = f.text();
      const c = f.clearDone();
      if (!c) continue;
      f.save(); n += c;
      caps.push({ path: f.path, before, after: fs.readFileSync(f.path, 'utf8') });
    } catch (e) { LOG('CLEAR-DONE-ERR ' + tag + ' ' + e.message); }
  }
  if (n) {
    const token = pushUndo({ kind: 'clear', caps, label: `${n} done task${n === 1 ? '' : 's'}`, expires: Date.now() + state.settings.undoSec * 1000 });
    pushUndoToWindow(token);
  }
  sendSnap();
  if (mainWin) mainWin.webContents.send('tasks-changed');
  return n;
});
// Share → WhatsApp (owner 2026-09-29): the installed app first (whatsapp://send → its contact / group picker), else
// WhatsApp Web (wa.me). Only these two URL shapes are ever opened; the text is also on the clipboard (a very long
// message can be cut by the link, pasting always works).
ipcMain.handle('open-whatsapp', async (_e, text) => {
  const body = String(text || '');
  await clipboard.writeText(body);
  if (SANDBOX || process.env.TODO_ISLAND_UNDO_TEST) { LOG('WHATSAPP-SANDBOX chars=' + body.length); return { ok: true, via: 'sandbox' }; } // tests never open apps
  const q = encodeURIComponent(body);
  // Windows answers an unknown protocol with a "find an app" prompt instead of an error — ask first who handles it
  const hasApp = !!app.getApplicationNameForProtocol('whatsapp://');
  try {
    await shell.openExternal((hasApp ? 'whatsapp://send?text=' : 'https://wa.me/?text=') + q);
    return { ok: true, via: hasApp ? 'app' : 'web' };
  } catch (e) { LOG('WHATSAPP-FAIL ' + e.message); return { ok: false }; }
});
ipcMain.handle('copy-text', async (_e, text) => { await clipboard.writeText(String(text || '')); return true; }); // Electron 44 clipboard is async — await so the invoke resolves after the write
ipcMain.handle('open-note', (_e, file) => {
  shell.openPath(file === 'work' ? state.settings.workPath : state.settings.personalPath);
});

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', () => { openWindow(); });
  app.whenReady().then(() => {
    LOG('APP-START');
    // self-heal: a default-folder note that went missing is re-created (enabled notes only; onboarding creates the rest)
    if (state.onboarded) {
      for (const tag of ['work', 'personal']) {
        const p = state.settings[tag + 'Path'];
        if (noteOn(tag) && p && p.startsWith(DEFAULT_DIR) && !fs.existsSync(p)) {
          try { createNote(p, tag === 'work'); LOG('SEEDED ' + p); } catch (e) { LOG('SEED-ERR ' + e.message); }
        }
      }
    }
    createIsland();
    createTray();
    registerShortcut();
    setTimeout(checkForUpdate, 8000); setInterval(checkForUpdate, 24 * 3600e3); // after boot settles; a tray app runs for days
    if (state.onboarded && state.settings.autoStart) applyAutoStart(true); // self-heal: rewrite any dev-era registration that boots bare electron.exe
    LOG('TRAY-READY');
    // one shakedown pop at launch — manual launches only; a system (--hidden) boot stays quiet
    const quietBoot = process.argv.includes('--hidden');
    if (!state.onboarded) openOnboarding(); // fresh install: first-run setup instead of the launch pop
    // every note gone → setup again (manual launches only: at login a synced folder may simply not be mounted yet)
    else if (!quietBoot && needsRepair()) { LOG('ONBOARD-REPAIR ' + missingNotes().join(',')); openOnboarding({ repair: true }); }
    else if (!quietBoot) setTimeout(showIsland, 1500);
    if (process.env.TODO_ISLAND_UNDO_TEST) {
      setTimeout(async () => {
        try {
          openWindow();
          await new Promise(r => setTimeout(r, 1800));
          const step = (name, js) => mainWin.webContents.executeJavaScript(js)
            .then(r => LOG(`UTEST ${name}: ${r}`)).catch(e => LOG(`UTEST ${name} ERR: ${e.message.slice(0, 120)}`));
          const undoClick = `const b=document.querySelector('#undo-toast [data-undo]'); if(!b) return 'no-toast'; b.click();`;
          await step('force-work-tab', `(async()=>{ document.getElementById('tab-work').click(); await new Promise(r=>setTimeout(r,400)); return document.querySelectorAll('.wrow').length + ' rows'; })()`);
          await step('complete+undo', `(async()=>{ const c=document.querySelector('.wrow .chk'); if(!c) return 'no-chk'; c.click(); await new Promise(r=>setTimeout(r,800)); ${undoClick} await new Promise(r=>setTimeout(r,800)); return 'ok'; })()`);
          // tasks window rest (owner 2026-09-28): 200 ms, then Edit + Delete tabs; nothing on a quicker pass
          await step('rest-edit-tab', `(async()=>{ const r=document.querySelector('#task-list .wrow:not(.done)'); if(!r) return 'no-row'; r.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); await new Promise(z=>setTimeout(z,80)); const early=!!document.querySelector('.etab.on')||r.classList.contains('dwelt'); await new Promise(z=>setTimeout(z,300)); const t=!!document.querySelector('.etab.on:not(.etab-del)'), d=!!document.querySelector('.etab-del.on'); r.dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body})); await new Promise(z=>setTimeout(z,150)); const gone=!document.querySelector('.etab.on'); return (early?'SHOWN-TOO-EARLY ':'quiet-pass ')+(t?'tab-after-rest ':'NO-TAB ')+(d?'del-tab ':'NO-DEL-TAB ')+(gone?'leave-hides':'TAB-STUCK'); })()`);
          await step('delete+undo', `(async()=>{ const r=document.querySelector('#task-list .wrow:not(.done)'); if(!r) return 'no-row'; r.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); await new Promise(z=>setTimeout(z,350)); const d=document.querySelector('.etab-del.on'); if(!d) return 'no-del-tab'; const n0=document.querySelectorAll('#task-list .wrow').length; d.click(); await new Promise(z=>setTimeout(z,800)); const n1=document.querySelectorAll('#task-list .wrow').length; ${undoClick} await new Promise(z=>setTimeout(z,800)); return 'rows '+n0+'→'+n1+'→'+document.querySelectorAll('#task-list .wrow').length; })()`);
          // row click folds/unfolds its details; the subtask text opens the editor, its [ ] ticks (owner 2026-09-28)
          await step('row-click-toggles', `(async()=>{ const r=document.querySelector('#task-list .wrow.has-detail'); if(!r) return 'no-detail-row'; const id=r.dataset.id, o0=r.classList.contains('open'); r.querySelector('.tt').click(); await new Promise(z=>setTimeout(z,300)); const r1=[...document.querySelectorAll('#task-list .wrow')].find(x=>x.dataset.id===id); const o1=r1.classList.contains('open'); r1.querySelector('.tt').click(); await new Promise(z=>setTimeout(z,300)); const o2=[...document.querySelectorAll('#task-list .wrow')].find(x=>x.dataset.id===id).classList.contains('open'); return 'open '+o0+'→'+o1+'→'+o2+(document.querySelector('.wexp')?' OLD-EXPAND-BTN':''); })()`);
          // owner 2026-09-29: the ☆ tab stages Now and the row STAYS where it is (order frozen while open); the side panel's
          // frost takes the clicks meant for the list. Both undone/closed after.
          await step('star-tab-stays+frost', `(async()=>{ const rows=[...document.querySelectorAll('#task-list .wrow:not(.is-now)')]; const r=rows[rows.length-1]; if(!r) return 'no-row'; const id=r.dataset.id, i0=[...document.querySelectorAll('#task-list .wrow')].indexOf(r); r.scrollIntoView({block:'center'}); r.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); await new Promise(z=>setTimeout(z,400)); const st=document.querySelector('.etab-star.on'); if(!st) return 'no-star-tab'; st.click(); await new Promise(z=>setTimeout(z,900)); const all=[...document.querySelectorAll('#task-list .wrow')]; const r1=all.find(x=>x.dataset.id===id); const out='idx '+i0+'→'+all.indexOf(r1)+' now='+r1.classList.contains('is-now'); await window.api.toggleActive(id, r1.dataset.file); await new Promise(z=>setTimeout(z,600)); document.getElementById('btn-share').click(); await new Promise(z=>setTimeout(z,700)); const r2=[...document.querySelectorAll('#task-list .wrow')].find(x=>x.dataset.id===id)||r1; const b=r2.getBoundingClientRect(); const hit=document.elementFromPoint(b.left+20,b.top+b.height/2); const frost=hit&&hit.id; window.Panels.close(); await new Promise(z=>setTimeout(z,500)); return out+' hitUnderPanel='+frost; })()`);
          const panelKind = () => mainWin.webContents.executeJavaScript('window.Panels.kind'); // the side panel that's open (null = none)
          const closePanel = () => mainWin.webContents.executeJavaScript('window.Panels.close()');
          LOG('UTEST row-click-opened-editor: ' + ((await panelKind()) ? 'UNEXPECTED' : 'no (correct)'));
          await step('subtask-text-edits', `(async()=>{ const s=document.querySelector('#task-list .wsubrow'); if(!s) return 'no-subtask'; const was=s.querySelector('.sb').textContent; s.querySelector('.st').click(); await new Promise(z=>setTimeout(z,900)); const again=[...document.querySelectorAll('#task-list .wsubrow')].find(x=>x.dataset.sub===s.dataset.sub); return 'bracket '+was+'→'+(again?again.querySelector('.sb').textContent:'gone'); })()`);
          LOG('UTEST subtask-text-edits(main): panel=' + (await panelKind()));
          await closePanel(); await new Promise(z => setTimeout(z, 500));
          await step('subtask-bracket-ticks', `(async()=>{ const s=document.querySelector('#task-list .wsubrow'); if(!s) return 'no-subtask'; const was=s.querySelector('.sb').textContent; s.querySelector('.sb').click(); await new Promise(z=>setTimeout(z,900)); const again=[...document.querySelectorAll('#task-list .wsubrow')].find(x=>x.dataset.sub===s.dataset.sub); const now=again?again.querySelector('.sb').textContent:'gone'; if(again) again.querySelector('.sb').click(); await new Promise(z=>setTimeout(z,800)); const back=[...document.querySelectorAll('#task-list .wsubrow')].find(x=>x.dataset.sub===s.dataset.sub); return 'bracket '+was+'→'+now+'→'+(back?back.querySelector('.sb').textContent:'gone'); })()`);
          await step('open-note-btn', `(async()=>{ const b=document.getElementById('btn-open-note'); const onWork=!b.hidden; document.getElementById('tab-done').click(); await new Promise(z=>setTimeout(z,300)); const onDone=!b.hidden; document.getElementById('tab-work').click(); await new Promise(z=>setTimeout(z,300)); return 'work='+(onWork?'shown':'HIDDEN')+' done='+(onDone?'SHOWN':'hidden')+' title='+b.title; })()`);
          const iStep = (name, js) => island.webContents.executeJavaScript(js)
            .then(r => LOG(`UTEST ${name}: ${r}`)).catch(e => LOG(`UTEST ${name} ERR: ${e.message.slice(0, 120)}`));
          await iStep('island-click-stages+undo', `(async()=>{ const t=document.querySelector('#body .row .rtitle'); if(!t) return 'no-row'; t.dispatchEvent(new MouseEvent('click',{bubbles:true})); await new Promise(r=>setTimeout(r,900)); const bar=document.getElementById('undo-bar'); const b=bar.querySelector('[data-undo]'); if(!b||bar.hidden) return 'NO-WRITE'; const lbl=bar.querySelector('.undo-label').textContent; b.click(); await new Promise(r=>setTimeout(r,900)); return 'ok ['+lbl+']'; })()`); // row click = stage as Now (owner 2026-09-25)
          LOG('UTEST island-click-opened-editor: ' + ((await panelKind()) ? 'UNEXPECTED' : 'no (correct)'));
          // corner Edit tab (owner pick D): nothing on a quick pass; after resting hoverSec the tab lands, and its click hands off to the editor
          await iStep('island-edit-handoff', `(async()=>{ const r0=document.querySelector('#body .row'); if(!r0) return 'no-row'; const sec=(snap&&snap.settings.hoverSec)||1; r0.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); await new Promise(z=>setTimeout(z,250)); if(document.querySelector('.etab.on')) return 'SHOWN-TOO-EARLY'; await new Promise(z=>setTimeout(z,sec*1000+300)); const t=document.querySelector('.etab.on'); if(!t) return 'NO-TAB-AFTER-REST'; t.click(); await new Promise(z=>setTimeout(z,900)); return 'tab after rest, clicked'; })()`);
          LOG('UTEST edit-handoff(main): panel=' + (await panelKind()) + ' main=' + !!(mainWin && !mainWin.isDestroyed() && mainWin.isVisible()) + ' islandVisible=' + (island ? island.isVisible() : 'n/a') + ' windows=' + BrowserWindow.getAllWindows().length);
          await closePanel(); await new Promise(z => setTimeout(z, 500));
          { // toggle-cycle: the shortcut's exact sequence through the real functions
            showIsland({ focus: true });
            await new Promise(r => setTimeout(r, 500));
            const v1 = island && island.isVisible();
            island.setFocusable(false); island.webContents.send('retract-island');
            setTimeout(() => hideIsland(), 400); // the backstop, same as the shortcut handler arms
            await new Promise(r => setTimeout(r, 700));
            const v2 = island && island.isVisible();
            showIsland({ focus: true });
            await new Promise(r => setTimeout(r, 500));
            const v3 = island && island.isVisible();
            LOG(`UTEST toggle-cycle: show=${v1} dismissed=${!v2} reshow=${v3}`);
          }
          await iStep('island-share', `(async()=>{ const b=document.getElementById('btn-share'); if(!b) return 'no-btn'; b.click(); await new Promise(r=>setTimeout(r,800)); return 'clicked'; })()`);
          LOG('UTEST island-share(main): panel=' + (await panelKind()) + ' islandVisible=' + (island ? island.isVisible() : 'n/a'));
          await closePanel(); await new Promise(z => setTimeout(z, 500));
          await iStep('island-check+undo', `(async()=>{ const r=document.querySelector('#body .row'); if(!r) return 'no-row'; if(r.querySelector('[data-chk]')) return 'row-still-has-chk'; r.focus(); r.dispatchEvent(new KeyboardEvent('keydown',{key:'x',bubbles:true})); await new Promise(r=>setTimeout(r,1200)); const b=document.querySelector('#undo-bar [data-undo]'); if(!b) return 'no-bar'; b.click(); await new Promise(r=>setTimeout(r,900)); return 'ok'; })()`);
          // more on scroll (owner 2026-09-28, round 2): 5 at first, a wheel-down loads up to 10 + a line to the tasks window; the undo bar never changes the island's height
          await iStep('island-scroll-more', `(async()=>{ const b=document.getElementById('body'); const n0=b.querySelectorAll('.row').length; const hint=b.classList.contains('has-more'); const pill=!!document.querySelector('.more-pill'); b.dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true})); await new Promise(z=>setTimeout(z,300)); const n1=b.querySelectorAll('.row').length; const rest=document.querySelector('[data-open-tasks]'); return 'rows '+n0+'→'+n1+(n0<=5?' few':' TOO-MANY')+(n1<=10?' capped':' OVER-CAP')+' fade='+hint+(pill?' OLD-PILL':'')+(rest?' rest-line='+rest.textContent.trim():' no-rest-line'); })()`);
          await iStep('island-undo-height', `(async()=>{ const h0=document.getElementById('wrap').offsetHeight; const r=document.querySelector('#body .row'); if(!r) return 'no-row'; r.focus(); r.dispatchEvent(new KeyboardEvent('keydown',{key:'x',bubbles:true})); await new Promise(z=>setTimeout(z,1300)); const bar=document.getElementById('undo-bar'); const shown=!bar.hidden; const h1=document.getElementById('wrap').offsetHeight; const b=bar.querySelector('[data-undo]'); if(b) b.click(); await new Promise(z=>setTimeout(z,900)); return 'bar='+shown+' pos='+getComputedStyle(bar).position+' height '+h0+'→'+h1+' (the completed row folds away; the bar adds nothing)'; })()`);
          showIsland({ focus: false }); await new Promise(z => setTimeout(z, 600));
          await iStep('island-reshow-few', `(async()=>{ return 'rows='+document.querySelectorAll('#body .row').length; })()`);
          await step('reorder+undo', `(async()=>{ const rows=document.querySelectorAll('.wrow'); if(rows.length<2) return 'need-2-rows'; rows[0].dispatchEvent(new DragEvent('dragstart',{bubbles:true})); rows[1].dispatchEvent(new DragEvent('drop',{bubbles:true})); await new Promise(r=>setTimeout(r,800)); ${undoClick} await new Promise(r=>setTimeout(r,800)); return 'ok'; })()`);
          await step('glass-window', `(async()=>{ const h=getComputedStyle(document.querySelector('header')); const t=getComputedStyle(document.getElementById('undo-toast')); return 'glassOn='+document.documentElement.classList.contains('glass-on')+' headerBackdrop='+h.backdropFilter+' toastBackdrop='+t.backdropFilter+' ambient='+getComputedStyle(document.querySelector('.ambient')).display; })()`);
          LOG('UTEST glass-level(main): ' + state.settings.glassLevel);
          await iStep('island-glass', `(async()=>{ const p=document.getElementById('pill'); const cs=getComputedStyle(p); const outer=cs.boxShadow.split(/,(?![^(]*[)])/).filter(x=>x.trim()!=='none'&&!x.includes('inset')).length; return 'mode='+document.body.dataset.glass+' outerShadows='+outer+' liveFrame='+document.body.classList.contains('gl-ready')+' alpha='+p.style.getPropertyValue('--g-alpha'); })()`);
          const wait = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
          const key = k => `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'${k}',bubbles:true}));`;
          await step('kbd-roving+priority', `(async()=>{ document.getElementById('tab-work').click(); ${wait(300)} const rows=[...document.querySelectorAll('#task-list .wrow')]; rows[0].focus(); ${key('ArrowDown')} const moved=document.activeElement===rows[1]; const stops=rows.filter(r=>r.tabIndex===0).length; ${key('3')} ${wait(700)} const b1=document.activeElement.querySelector('.wmeta .bang').textContent; ${key('0')} ${wait(700)} const b2=document.activeElement.querySelector('.wmeta .bang').textContent; return 'moved='+moved+' tabstops='+stops+' after3=['+b1+'] after0=['+b2+'] role='+document.querySelector('#task-list .fold').getAttribute('role'); })()`);
          showIsland({ focus: true });
          await iStep('island-kbd-summon', `(async()=>{ await new Promise(r=>setTimeout(r,600)); const a=document.activeElement; const onNav=!!(a&&a.hasAttribute&&a.hasAttribute('data-nav')); a.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})); const moved=document.activeElement!==a && document.activeElement.hasAttribute('data-nav'); const tab=document.querySelector('.etab.on'); return 'focused-nav='+onNav+' arrow-moved='+moved+(tab?' STRAY-EDIT-TAB':' no-stray-tab'); })()`);
          LOG('UTEST island-focusable-after-summon: ' + island.isFocusable());
          await step('kbd-complete+undo',`(async()=>{ const r=document.querySelector('#task-list .wrow'); r.focus(); const t=r.querySelector('.tt').textContent; ${key('x')} ${wait(900)} const gone=![...document.querySelectorAll('#task-list .tt')].some(e=>e.textContent===t); ${undoClick} ${wait(900)} const back=[...document.querySelectorAll('#task-list .tt')].some(e=>e.textContent===t); return 'gone='+gone+' back='+back+' live='+document.getElementById('undo-toast').getAttribute('aria-live'); })()`);
          await step('composer-empty-add',`(async()=>{ document.getElementById('new-title').value=''; document.getElementById('btn-add').click(); ${wait(300)} return 'hint=' + document.getElementById('new-hint').textContent; })()`);
          await step('composer-typed-add', `(async()=>{ const ta=document.getElementById('new-title'); ta.value='!! 26 Sep E2E composed task'; ta.dispatchEvent(new Event('input',{bubbles:true})); ${wait(400)} const sel=[...document.querySelectorAll('#new-prio .pchip.sel')].map(c=>c.dataset.p).join(); document.getElementById('btn-add').click(); ${wait(700)} const row=[...document.querySelectorAll('.wrow')].find(r=>r.textContent.includes('E2E composed task')); return 'chip=' + sel + ' row=' + (row ? row.querySelector('.bang').textContent + '|' + (row.querySelector('.wdue')||{}).textContent : 'MISSING'); })()`);
          await step('done-tab+clear+undo', `(async()=>{ document.getElementById('tab-done').click(); ${wait(400)} const n0=document.querySelectorAll('.wrow.done').length; document.getElementById('btn-clear-done').click(); ${wait(700)} const n1=document.querySelectorAll('.wrow.done').length; ${undoClick} ${wait(900)} const n2=document.querySelectorAll('.wrow.done').length; return n0+'→'+n1+'→'+n2; })()`);
          await step('settings-autosave', `(async()=>{ document.getElementById('tab-settings').click(); ${wait(500)} if(document.getElementById('set-advanced').hidden) document.getElementById('adv-toggle').click(); const d=document.getElementById('set-dismiss'); d.value='3'; d.dispatchEvent(new Event('input',{bubbles:true})); ${wait(300)} const typedSaved=(await window.api.getSnapshot()).settings.dismissSec; d.dispatchEvent(new Event('change',{bubbles:true})); ${wait(700)} const fs=document.querySelector('.fstat[data-for=set-dismiss]').textContent; const stored=(await window.api.getSnapshot()).settings.dismissSec; return 'typedSaved='+typedSaved+' clamp=['+fs+'] stored='+stored+' guard='+!!document.getElementById('dirty-guard'); })()`);
          { // hide from screen sharing (owner 2026-09-29): the switch flips Windows' exclude-from-capture flag on the island, both ways
            const prot = () => (typeof island.isContentProtected === 'function' ? island.isContentProtected() : 'n/a');
            const was = state.settings.hideFromCapture;
            await step('capture-hide', `(async()=>{ const c=document.getElementById('set-capture'); c.checked=!c.checked; c.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(z=>setTimeout(z,700)); return 'stored=' + (await window.api.getSnapshot()).settings.hideFromCapture; })()`);
            LOG('UTEST capture-hide(main): setting=' + state.settings.hideFromCapture + ' protected=' + prot());
            await step('capture-hide-back', `(async()=>{ const c=document.getElementById('set-capture'); c.checked=!c.checked; c.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(z=>setTimeout(z,700)); return 'stored=' + (await window.api.getSnapshot()).settings.hideFromCapture; })()`);
            LOG('UTEST capture-hide-back(main): setting=' + state.settings.hideFromCapture + ' protected=' + prot() + ' restored=' + (state.settings.hideFromCapture === was));
          }
          // time wheel (owner 2026-09-28): a click on the start time opens two wheels; turning the hour commits + autosaves; Esc closes. The start time is restored after.
          { const startWas = state.settings.dayStart;
            await step('time-wheel', `(async()=>{ if(document.getElementById('view-settings').hidden) document.getElementById('tab-settings').click(); await new Promise(z=>setTimeout(z,500)); const inp=document.getElementById('set-start'); inp.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); await new Promise(z=>setTimeout(z,300)); const pop=document.querySelector('.twheel'); if(!pop) return 'NO-WHEEL'; const [hc]=pop.querySelectorAll('.tw-col'); const items=hc.querySelectorAll('.tw-item').length; hc.scrollTo({top:7*32,behavior:'instant'}); hc.dispatchEvent(new Event('scrollend')); await new Promise(z=>setTimeout(z,700)); const v=inp.value; const curl=getComputedStyle(hc.querySelector('.tw-item')).animationName; document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await new Promise(z=>setTimeout(z,400)); const unit=getComputedStyle(document.querySelector('.unit-field .unit')).position; return 'wheel=yes hours='+items+' value='+v+' curl='+curl+' closed='+(!document.querySelector('.twheel.on'))+' unitInside='+unit; })()`);
            LOG('UTEST time-wheel(saved): dayStart=' + state.settings.dayStart);
            state.settings.dayStart = startWas; saveState();
            await step('time-wheel-restore', `(async()=>{ await loadSettings(); return document.getElementById('set-start').value; })()`);
          }
          { // reset + undo: settings revert to defaults, the note FILES on disk are never touched, undo restores
            const workBefore = state.settings.workPath, personalBefore = state.settings.personalPath;
            await step('reset-settings', `(async()=>{ document.getElementById('tab-settings').click(); ${wait(400)} const b=document.getElementById('btn-reset-settings'); if(!b) return 'no-btn'; b.click(); await new Promise(r=>setTimeout(r,1200)); const wp=document.getElementById('set-work').value; const g=document.querySelector('#glass-steps .step.sel'); const lang=document.querySelector('#lang-seg .seg-btn.sel'); const t=document.getElementById('undo-toast'); return 'reset='+(wp!==${JSON.stringify(workBefore)})+' glass='+(g?g.dataset.glass:'none')+' lang='+(lang?lang.dataset.lang:'none')+' toast='+!t.hidden; })()`);
            LOG('UTEST reset-files-intact(main): workExists=' + fs.existsSync(workBefore) + ' personalExists=' + fs.existsSync(personalBefore) + ' pathChanged=' + (state.settings.workPath !== workBefore));
            await step('reset-undo', `(async()=>{ const b=document.querySelector('#undo-toast [data-undo]'); if(!b) return 'no-toast'; b.click(); await new Promise(r=>setTimeout(r,1200)); const wp=document.getElementById('set-work').value; return 'restored='+(wp===${JSON.stringify(workBefore)}); })()`);
          }
          { // run setup again: the wizard opens in rerun mode; cancelling changes nothing
            await step('rerun-setup', `(async()=>{ const b=document.getElementById('btn-rerun-setup'); if(!b) return 'no-btn'; b.click(); await new Promise(r=>setTimeout(r,1200)); return 'clicked'; })()`);
            LOG('UTEST rerun-setup(main): wizard=' + !!(onboardWin && !onboardWin.isDestroyed()) + ' rerunFlag=' + onboardOpts.rerun);
            if (onboardWin && !onboardWin.isDestroyed()) onboardWin.close();
            await new Promise(r => setTimeout(r, 500));
            LOG('UTEST rerun-cancel(main): workStill=[' + state.settings.workPath + ']');
          }
          await step('lang-switch',`(async()=>{ document.getElementById('tab-settings').click(); ${wait(600)} const ar=document.querySelector('#lang-seg [data-lang=ar]'); if(!ar) return 'no-seg'; ar.click(); ${wait(1400)} const dir=document.documentElement.dir, hl=document.documentElement.lang; const tabW=document.getElementById('tab-work').textContent.trim(); const lbls=[...document.querySelectorAll('[data-i18n]')].slice(0,3).map(e=>e.textContent.trim()).join('|'); const saveBtn=document.querySelector('[data-i18n="set.h.look"]').textContent; const back=document.querySelector('#lang-seg [data-lang=system]'); back.click(); ${wait(1400)} return 'dir='+dir+' htmlLang='+hl+' tabWork=['+tabW+'] first3=['+lbls+'] lookHead=['+saveBtn+'] backDir='+document.documentElement.dir; })()`);
          { // side-panel editor (owner 2026-09-28): opens inside the window, saves itself, one Undo rolls the session back
            await step('force-work-tab-2', `(async()=>{ document.getElementById('tab-work').click(); await new Promise(z=>setTimeout(z,300)); return 'ok'; })()`);
            const t0 = snapshot().sections.flatMap(s => s.items).find(t => t.file === 'work');
            const before = fs.readFileSync(state.settings.workPath, 'utf8');
            const q = JSON.stringify;
            await step('panel-edit-noop', `(async()=>{ window.Panels.edit(${q(t0.file)}, ${q(t0.id)}); await new Promise(z=>setTimeout(z,700)); const open=document.getElementById('side').classList.contains('open'); const pv=document.getElementById('ed-preview-line').textContent; document.getElementById('ed-more').click(); const menu=!document.getElementById('ed-menu').hidden; document.getElementById('ed-more').click(); const save=!!document.getElementById('ed-save'); document.getElementById('side-close').click(); await new Promise(z=>setTimeout(z,700)); return 'open='+open+' preview=['+pv+'] menu='+menu+' saveBtn='+(save?'STILL-THERE':'gone')+' closedByX='+!document.getElementById('side').classList.contains('open'); })()`);
            LOG('UTEST panel-noop-roundtrip: ' + (fs.readFileSync(state.settings.workPath, 'utf8') === before ? 'byte-identical' : 'CHANGED'));
            await step('panel-autosave', `(async()=>{ window.Panels.edit(${q(t0.file)}, ${q(t0.id)}); await new Promise(z=>setTimeout(z,700)); const ta=document.getElementById('ed-title'); const lines=ta.value.split('\\n'); lines[0]+=' E2E-auto'; ta.value=lines.join('\\n'); ta.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(z=>setTimeout(z,1500)); const p3=[...document.querySelectorAll('#ed-prio .chip')].find(c=>c.textContent.trim()==='!!!'); if(p3) p3.click(); await new Promise(z=>setTimeout(z,900)); return 'toast='+!document.getElementById('undo-toast').hidden+' saved=['+document.getElementById('ed-saved').textContent+']'; })()`);
            const mid = fs.readFileSync(state.settings.workPath, 'utf8');
            LOG('UTEST panel-autosave(note): title=' + mid.includes('E2E-auto') + ' prio=' + /- \[ \][^\n]*!!![^\n]*E2E-auto/.test(mid));
            await step('panel-undo-session', `(async()=>{ const b=document.querySelector('#undo-toast [data-undo]'); if(!b) return 'no-toast'; b.click(); await new Promise(z=>setTimeout(z,900)); return 'undone'; })()`);
            LOG('UTEST panel-undo-roundtrip: ' + (fs.readFileSync(state.settings.workPath, 'utf8') === before ? 'byte-identical' : 'CHANGED'));
            await step('panel-dismiss', `(async()=>{ const side=document.getElementById('side'); const isOpen=()=>side.classList.contains('open'); const out=[]; window.Panels.edit(${q(t0.file)}, ${q(t0.id)}); await new Promise(z=>setTimeout(z,600)); document.querySelector('header .logo').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0})); await new Promise(z=>setTimeout(z,600)); out.push('outside='+(!isOpen()?'closes':'STAYS')); window.Panels.edit(${q(t0.file)}, ${q(t0.id)}); await new Promise(z=>setTimeout(z,600)); document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await new Promise(z=>setTimeout(z,600)); out.push('esc='+(!isOpen()?'closes':'STAYS')); document.getElementById('btn-share').click(); await new Promise(z=>setTimeout(z,600)); const sh=window.Panels.kind; document.getElementById('side-close').click(); await new Promise(z=>setTimeout(z,600)); out.push('share='+sh+' x='+(!isOpen()?'closes':'STAYS')); return out.join(' '); })()`);
            // panel subtasks (owner 2026-09-28): [ ] ticks, the text renames in place; ONE Undo rolls back both. The panel floats OVER the list at 70 % of the window.
            const withSubs = snapshot().sections.flatMap(s => s.items).find(t => t.file === 'work' && t.subs.length >= 1);
            if (withSubs) {
              const before2 = fs.readFileSync(state.settings.workPath, 'utf8');
              await step('panel-subtasks', `(async()=>{ const mainW0=document.querySelector('main').getBoundingClientRect().width; window.Panels.edit(${q(withSubs.file)}, ${q(withSubs.id)}); await new Promise(z=>setTimeout(z,800)); const side=document.getElementById('side').getBoundingClientRect(); const mainW1=document.querySelector('main').getBoundingClientRect().width; const li=document.querySelector('#ed-subs li[data-sub]'); if(!li) return 'no-sub'; li.querySelector('.st').click(); await new Promise(z=>setTimeout(z,100)); const inp=document.querySelector('#ed-subs .sub-edit'); if(!inp) return 'NO-RENAME-FIELD'; inp.value='E2E renamed sub'; inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); await new Promise(z=>setTimeout(z,900)); const li2=[...document.querySelectorAll('#ed-subs li[data-sub]')].find(x=>x.dataset.sub==='E2E renamed sub'); if(!li2) return 'RENAME-NOT-SHOWN'; const was=li2.querySelector('.sb').textContent; li2.querySelector('[data-subtick]').click(); await new Promise(z=>setTimeout(z,900)); const li3=[...document.querySelectorAll('#ed-subs li[data-sub]')].find(x=>x.dataset.sub==='E2E renamed sub'); return 'wide70='+(Math.abs(side.width-Math.max(340,innerWidth*0.7))<4?'yes':'NO('+Math.round(side.width)+'/'+innerWidth+')')+' overlay='+(Math.abs(mainW1-mainW0)<2?'yes':'SHRANK')+' renamed=yes tick '+was+'→'+(li3?li3.querySelector('.sb').textContent:'gone')+' toast='+!document.getElementById('undo-toast').hidden; })()`);
              const mid2 = fs.readFileSync(state.settings.workPath, 'utf8');
              LOG('UTEST panel-subtasks(note): renamed=' + mid2.includes('E2E renamed sub'));
              await step('panel-subtasks-undo', `(async()=>{ const b=document.querySelector('#undo-toast [data-undo]'); if(!b) return 'no-toast'; const lbl=document.querySelector('#undo-toast .undo-label').textContent; b.click(); await new Promise(z=>setTimeout(z,900)); window.Panels.close(); await new Promise(z=>setTimeout(z,500)); return 'undone ['+lbl+']'; })()`);
              LOG('UTEST panel-subtasks-roundtrip: ' + (fs.readFileSync(state.settings.workPath, 'utf8') === before2 ? 'byte-identical' : 'CHANGED'));
            }
          }
          // the tab lens (owner: "correct, not buggy"): it lands exactly under the active tab, moves on PRESS, and snaps back when a press slides off
          await step('tab-lens', `(async()=>{ const cur=document.querySelector('.tab-cursor'); const fit=t=>{ const a=cur.getBoundingClientRect(), b=t.getBoundingClientRect(); return Math.abs((a.left+a.width/2)-(b.left+b.width/2))<1.5 && Math.abs(a.width-b.width)<b.width*0.08; }; const out=[]; document.getElementById('tab-personal').click(); await new Promise(z=>setTimeout(z,700)); out.push('personal='+(fit(document.getElementById('tab-personal'))?'fits':'OFF')); const done=document.getElementById('tab-done'); done.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0})); await new Promise(z=>setTimeout(z,700)); out.push('press-moves='+(fit(done)?'yes':'NO')); window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true})); await new Promise(z=>setTimeout(z,700)); out.push('slide-off-snaps-back='+(fit(document.getElementById('tab-personal'))?'yes':'NO')); await refresh(); await new Promise(z=>setTimeout(z,80)); out.push('refresh-no-slide='+(fit(document.getElementById('tab-personal'))?'yes':'NO')); document.getElementById('tab-work').click(); await new Promise(z=>setTimeout(z,700)); out.push('work='+(fit(document.getElementById('tab-work'))?'fits':'OFF')); const a=cur.getBoundingClientRect(), b=document.getElementById('tab-work').getBoundingClientRect(); out.push('vis='+document.visibilityState+' cur='+Math.round(a.left)+'/'+Math.round(a.width)+' tab='+Math.round(b.left)+'/'+Math.round(b.width)); return out.join(' '); })()`);
          await step('open-share',`(async()=>{ document.getElementById('btn-share').click(); await new Promise(z=>setTimeout(z,900)); return 'panel='+window.Panels.kind+' windows-stay-one'; })()`);
          LOG('UTEST open-share(main): windows=' + BrowserWindow.getAllWindows().length);
          const shStep = step;
          await shStep('share-pick+copy-wa', `(async()=>{ const rows=document.querySelectorAll('.sh-row'); if(rows.length<2) return 'need-2-rows:'+rows.length; rows[0].click(); await new Promise(r=>setTimeout(r,150)); rows[rows.length-1].click(); await new Promise(r=>setTimeout(r,150)); document.getElementById('btn-copy').click(); await new Promise(r=>setTimeout(r,500)); return document.querySelectorAll('.sh-row.sel').length + ' selected'; })()`);
          LOG('CLIP-WA: ' + String((await clipboard.readText()) || '').split('\\n').join(' | ').slice(0, 160));
          await shStep('share-fmt-md+copy', `(async()=>{ document.querySelector('#fmt-seg .seg-btn[data-fmt=md]').click(); await new Promise(r=>setTimeout(r,150)); document.getElementById('btn-copy').click(); await new Promise(r=>setTimeout(r,500)); return 'ok'; })()`);
          // Share pages (owner 2026-09-29): pick on Work/Open, switch to Work/Done, pick there → ONE selection, one message
          await shStep('share-pages-one-selection', `(async()=>{ const w=ms=>new Promise(r=>setTimeout(r,ms)); document.getElementById('sel-clear-all').click(); await w(150); const pg=document.querySelector('#sh-page [data-page=work]'); if(pg) pg.click(); document.querySelector('#sh-sub [data-sub=open]').click(); await w(200); const o=document.querySelector('#share-list .sh-row'); if(!o) return 'no-open-row'; o.click(); document.querySelector('#sh-sub [data-sub=done]').click(); await w(200); const d=document.querySelector('#share-list .sh-row'); if(d) d.click(); await w(100); const hint=document.getElementById('sel-hint').textContent; const subCnt=[...document.querySelectorAll('#sh-sub .cnt')].map(c=>c.textContent).join('/'); document.querySelector('#fmt-seg [data-fmt=text]').click(); document.getElementById('btn-wa').click(); await w(500); document.querySelector('#sh-sub [data-sub=open]').click(); return 'hint=['+hint+'] openDone='+subCnt+' doneRow='+!!d; })()`);
          LOG('CLIP-MD: ' + String((await clipboard.readText()) || '').split('\\n').join(' | ').slice(0, 160));
          await closePanel();
          if (process.env.TODO_ISLAND_USERDATA) { // sandbox only: a vanished note must be admitted honestly, in both surfaces
            const wp = state.settings.workPath;
            fs.renameSync(wp, wp + '.gone');
            try {
              await step('missing-note-window', `(async()=>{ document.getElementById('tab-work').click(); await refresh(); await new Promise(r=>setTimeout(r,300)); return 'strip=' + !document.getElementById('err-strip').hidden + ' tab=' + document.getElementById('tab-work').textContent + ' mark=' + document.getElementById('mark').textContent + ' empty=' + (document.querySelector('#task-list .empty')||{}).textContent; })()`);
              sendSnap();
              await iStep('missing-note-island', `(async()=>{ await new Promise(r=>setTimeout(r,400)); const b=document.querySelector('.err-banner'); return 'mark=' + document.getElementById('mark').textContent + ' banner=' + (b ? b.textContent.replace(/\\s+/g,' ').trim() : 'NONE') + ' pinned=' + document.body.classList.contains('pinned'); })()`);
            } finally { fs.renameSync(wp + '.gone', wp); sendSnap(); }
          }
          LOG('UTEST-END undoLogSize=' + undoLog.size);
          if (process.env.TODO_ISLAND_USERDATA) app.quit(); // sandboxed runs clean up after themselves
        } catch (e) { LOG('UTEST-FATAL ' + (e && e.message)); }
        if (process.env.TODO_ISLAND_USERDATA) app.quit(); // sandbox runs ALWAYS clean up — even after a fatal step
      }, 2500);
    }
  });
  app.on('window-all-closed', e => e.preventDefault()); // tray keeps living
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
