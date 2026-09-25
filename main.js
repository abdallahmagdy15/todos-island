'use strict';
// Todo Island — tray reminder over the two Obsidian notes.
// Sources are only written on the owner's own clicks in the app (owner's hands), never in bulk by the AI.
const { app, Tray, Menu, BrowserWindow, ipcMain, nativeImage, screen, globalShortcut, nativeTheme, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { NoteFile, resolveDue, MONTHS } = require('./lib/parse.js');
const { composeTask } = require('./lib/compose.js');
const { makePngBuffer } = require('./lib/icon.js');

// test/dev isolation: point the app at a scratch userData (its own state.json → its own note paths).
// E2E runs use this so they never touch the owner's real notes.
if (process.env.TODO_ISLAND_USERDATA) app.setPath('userData', process.env.TODO_ISLAND_USERDATA);
const STATE_PATH = path.join(app.getPath('userData'), 'state.json'); // userData: writable in dev AND packaged (asar is read-only)
const LOGF = path.join(process.env.TEMP || __dirname, 'todo-island.log');
const LOG = m => { try { fs.appendFileSync(LOGF, `${new Date().toISOString()} ${m}\n`); } catch (e) {} };

const DEFAULT_SETTINGS = {
  workIntervalMin: 30, offIntervalMin: 60, workRemindersOn: true, offRemindersOn: true,
  dayStart: '09:00', dayEnd: '17:00',
  dismissSec: 45, undoSec: 30, hoverSec: 2, shortcut: 'Control+Alt+T', focusByTime: true,
  weekendAware: false, autoStart: false, soundOn: false,
  workPath: path.join(require('os').homedir(), 'Documents', 'todos-island', 'work-tasks.md'),
  personalPath: path.join(require('os').homedir(), 'Documents', 'todos-island', 'personal.md')
};
const migrateSettings = s => {
  if (s.intervalMin !== undefined && s.workIntervalMin === undefined) s.workIntervalMin = s.intervalMin; // v1.2 single interval → work interval
  delete s.intervalMin;
  return s;
};
const saveState = () => fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
let state = { settings: { ...DEFAULT_SETTINGS }, lastShown: 0 };
try {
  const saved = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  state = { ...state, ...saved, settings: migrateSettings({ ...DEFAULT_SETTINGS, ...(saved.settings || {}) }) };
  delete state.activeId; delete state.activeFile; // dead since the * marker moved "active" into the notes
} catch (e) {
  // one-time migration: carry over a dev-era state.json that lived next to main.js
  const legacy = path.join(__dirname, 'state.json');
  if (legacy !== STATE_PATH && fs.existsSync(legacy)) {
    try {
      const old = JSON.parse(fs.readFileSync(legacy, 'utf8'));
      state = { ...state, ...old, settings: migrateSettings({ ...DEFAULT_SETTINGS, ...(old.settings || {}) }) };
      delete state.activeId; delete state.activeFile;
      saveState();
    } catch (e2) {}
  }
}

let tray = null, island = null, mainWin = null;
// native chrome colors — must match tokens.css (--paper / --head / --muted) so the title bar blends in
const THEME = {
  light: { bg: '#f7f6f2', overlay: '#f7f6f2', symbol: '#5c5a55' },
  dark: { bg: '#121211', overlay: '#121211', symbol: '#a9a69e' }
};
const theme = () => THEME[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];
// G5: real Windows 11 Mica behind the tasks window — only on 22H2+ (build >= 22621); older builds keep the solid paper.
// (a frameless window with a transparent background but NO material would show the raw desktop.)
const MICA = process.platform === 'win32' && +String(require('os').release()).split('.')[2] >= 22621 && !process.env.TODO_ISLAND_NO_MICA;
const overlay = (mica = false) => ({ color: mica ? '#00000000' : theme().overlay, symbolColor: theme().symbol, height: 46 });
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
  if (state.settings.weekendAware && (now.getDay() === 0 || now.getDay() === 6)) return false; // Sat/Sun = off
  const [sh, sm] = state.settings.dayStart.split(':').map(Number);
  const [eh, em] = state.settings.dayEnd.split(':').map(Number);
  const s = new Date(now); s.setHours(sh, sm, 0, 0);
  const e = new Date(now); e.setHours(eh, em, 0, 0);
  return now >= s && now <= e;
}

const { nextFireAt: scheduleNext } = require('./lib/schedule.js');
const nextFireAt = () => scheduleNext(state.settings, state.lastShown, Date.now());

const RANK = { '!!!': 3, '!!': 2, '!': 1 };
function snapshot() {
  const collect = (f, group) => f.topTasks().filter(t => !t.checked).map(t => ({
    id: f.id(t), file: group, title: t.title.replace(/\*\*/g, ''),
    priority: t.priority, active: !!t.active,
    dueText: t.due ? `${t.due.d} ${t.due.m}` : null,
      dueTs: t.due ? resolveDue(t.due) : null,
      notes: f.notesOf(t).map(n => n.replace(/\*\*/g, '')),
      subs: f.subtasksOf(t).map(s => ({ t: s.title.replace(/\*\*/g, ''), done: s.checked }))
  }));
  const doneOf = (f, group) => f.topTasks().filter(t => t.checked).map(t => ({
    id: f.id(t), file: group, title: t.title.replace(/\*\*/g, ''),
    dueText: t.due ? `${t.due.d} ${t.due.m}` : null
  }));
  const safe = (group, path) => {
    try {
      const f = group === 'work' ? workFile() : personalFile();
      return { file: group, items: collect(f, group), done: doneOf(f, group), error: null };
    }
    catch (e) { LOG('SOURCE-ERROR ' + group + ' ' + e.message); return { file: group, items: [], done: [], error: path }; }
  };
  const work = safe('work', state.settings.workPath);
  const personal = safe('personal', state.settings.personalPath);
  const errors = [work, personal].filter(r => r.error).map(r => ({ file: r.file, path: r.error, name: path.basename(r.error || '') }));
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const dec = t => !t.dueTs ? 'none' : t.dueTs < today0.getTime() ? 'overdue' : t.dueTs < today0.getTime() + 864e5 ? 'today' : 'future';
  const sort = arr => arr.sort((a, b) =>
    ((b.active ? 1 : 0) - (a.active ? 1 : 0)) ||
    ((RANK[b.priority] || 0) - (RANK[a.priority] || 0)) ||
    ((a.dueTs || Infinity) - (b.dueTs || Infinity)));
  sort(work.items).forEach(t => t.dueState = dec(t));
  sort(personal.items).forEach(t => t.dueState = dec(t));
  const sections = inWorkday()
    ? [{ name: 'Work', items: work.items }, { name: 'Personal', items: personal.items }]
    : [{ name: 'Personal', items: personal.items }, { name: 'Work', items: work.items }];
  const lu = latestUndo();
  const undo = lu
    ? { token: lu.token, kind: lu.kind, label: lu.label, starring: lu.kind === 'toggle' ? lu.prev === false : undefined, left: Math.max(0, Math.round((lu.expires - Date.now()) / 1000)) }
    : null;
  const sources = { work: path.basename(state.settings.workPath || ''), personal: path.basename(state.settings.personalPath || '') };
  return { sections, errors, sources, lastWrite, done: [...work.done, ...personal.done], workday: inWorkday(), nextFire: nextFireAt(), settings: state.settings, undo };
}

function sendSnap() { if (island) island.webContents.send('snapshot', snapshot()); }
function showIsland(opts = {}) {
  if (!island) return;
  const wasVisible = island.isVisible();
  sendSnap(); island.showInactive();
  if (!wasVisible) island.webContents.send('island-shown'); // replays the drop-in entry
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
    webPreferences: { preload: path.join(__dirname, 'island-preload.js') }
  });
  island.setAlwaysOnTop(true, 'screen-saver');
  lockZoom(island.webContents);
  island.loadFile('island.html');
}

function openWindow(tab) {
  if (typeof tab !== 'string') tab = null; // tray/menu callers pass event objects
  if (mainWin) { mainWin.show(); mainWin.focus(); if (tab) mainWin.webContents.send('show-tab', tab); return; }
  mainWin = new BrowserWindow({
    width: 920, height: 660, minWidth: 760, minHeight: 540,
    backgroundColor: MICA ? '#00000000' : theme().bg,
    ...(MICA ? { backgroundMaterial: 'mica' } : {}),
    autoHideMenuBar: true, show: false,
    frame: false, titleBarStyle: 'hidden',
    // overlay must exist at creation — setTitleBarOverlay throws otherwise ("Titlebar overlay is not enabled")
    titleBarOverlay: overlay(MICA),
    webPreferences: { preload: path.join(__dirname, 'window-preload.js') }
  });
  applyOverlay();
  lockZoom(mainWin.webContents);
  mainWin.webContents.on('console-message', (_e, _lvl, msg) => LOG('WIN-CONSOLE: ' + msg));
  const query = { ...(tab ? { tab } : {}), ...(MICA ? { mica: '1' } : {}) };
  mainWin.loadFile('window.html', Object.keys(query).length ? { query } : undefined);
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.on('render-process-gone', (_e, d) => LOG('WIN-GONE: ' + d.reason));
  mainWin.on('closed', () => { mainWin = null; });
}

let editorWin = null;
let shareWin = null;
function openShare() {
  if (shareWin && !shareWin.isDestroyed()) { shareWin.show(); shareWin.focus(); }
  else {
    shareWin = new BrowserWindow({
      width: 620, height: 680, minWidth: 480, minHeight: 480,
      backgroundColor: theme().bg,
      autoHideMenuBar: true, show: false, parent: mainWin || undefined,
      frame: false, titleBarStyle: 'hidden',
      titleBarOverlay: overlay(),
      webPreferences: { preload: path.join(__dirname, 'window-preload.js') }
    });
    shareWin.once('ready-to-show', () => shareWin.show());
    shareWin.on('closed', () => { shareWin = null; });
    lockZoom(shareWin.webContents);
  }
  shareWin.loadFile('share.html');
}
ipcMain.handle('open-share', () => openShare());
ipcMain.handle('export-md', async (_e, text) => {
  const { dialog } = require('electron');
  const d = new Date();
  const res = await dialog.showSaveDialog(shareWin || mainWin || undefined, {
    title: 'Export progress as Markdown',
    defaultPath: path.join(require('os').homedir(), 'Downloads', `progress-${d.getDate()}-${MONTHS[d.getMonth()]}.md`),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (res.canceled || !res.filePath) return { ok: false };
  fs.writeFileSync(res.filePath, String(text || ''), 'utf8');
  return { ok: true, path: res.filePath };
});

function openEditor(file, id) {
  if (editorWin && !editorWin.isDestroyed()) { editorWin.show(); editorWin.focus(); }
  else {
    editorWin = new BrowserWindow({
      width: 480, height: 620, minWidth: 420, minHeight: 500,
      backgroundColor: theme().bg,
      autoHideMenuBar: true, show: false, parent: mainWin || undefined,
      frame: false, titleBarStyle: 'hidden',
      titleBarOverlay: overlay(),
      webPreferences: { preload: path.join(__dirname, 'window-preload.js') }
    });
    editorWin.once('ready-to-show', () => editorWin.show());
    editorWin.on('closed', () => { editorWin = null; });
  }
  editorWin.loadFile('editor.html', { query: { file: String(file), id: String(id) } });
}

function lockZoom(wc) {
  wc.setZoomFactor(1);
  wc.on('zoom-changed', () => wc.setZoomFactor(1)); // accidental Ctrl+scroll/plus must never wreck the layout
}

function applyOverlay() {
  if (!mainWin) return;
  try {
    mainWin.setTitleBarOverlay(overlay(MICA));
  } catch (e) { LOG('OVERLAY-SKIP ' + e.message); }
}
nativeTheme.on('updated', applyOverlay);

function registerShortcut() {
  globalShortcut.unregisterAll();
  const sc = (state.settings.shortcut || '').trim();
  if (!sc) return true;
  try {
    const ok = globalShortcut.register(sc, () => {
      // toggle: same key shows and dismisses — dismiss lets the pill retract (animated) via the renderer
      if (island && island.isVisible()) { island.setFocusable(false); island.webContents.send('retract-island'); }
      else showIsland({ focus: true });
    });
    LOG(ok ? `SHORTCUT-OK ${sc}` : `SHORTCUT-FAILED ${sc}`);
    return !!ok;
  } catch (e) { LOG('SHORTCUT-ERROR ' + e.message); return false; }
}

function applyAutoStart(on) {
  // dev: electron.exe alone boots the default Electron welcome page — the app path must ride along.
  // --hidden marks a system launch (checked below) so boot stays quiet.
  const args = [];
  if (!app.isPackaged) args.push(app.getAppPath());
  args.push('--hidden');
  app.setLoginItemSettings({ openAtLogin: !!on, openAsHidden: true, args });
}

function createTray() {
  const img = nativeImage.createFromBuffer(makePngBuffer(32));
  tray = new Tray(img);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show island now', click: () => { state.lastShown = Date.now(); saveState(); showIsland(); } },
    { label: 'Open tasks window', click: openWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]));
  tray.on('click', () => showIsland());
  const tick = () => {
    const nf = new Date(nextFireAt());
    tray.setToolTip(`Todo Island — next ${String(nf.getHours()).padStart(2, '0')}:${String(nf.getMinutes()).padStart(2, '0')} (${state.settings.shortcut})`);
    if (Date.now() >= nextFireAt()) { state.lastShown = Date.now(); saveState(); showIsland(); }
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
  const prev = t.active;
  const label = t.title.replace(/\*\*/g, '');
  f.toggleActive(id); f.save();
  const token = pushUndo({ kind: 'toggle', file, id, prev, label, expires: Date.now() + state.settings.undoSec * 1000 });
  sendSnap(); pushUndoToWindow(token);
  if (mainWin) mainWin.webContents.send('tasks-changed');
});
ipcMain.handle('toggle-subtask', (_e, file, parentId, subTitle) => {
  const f = fileFor(file);
  f.toggleSubtask(parentId, subTitle); f.save();
  sendSnap(); if (mainWin) mainWin.webContents.send('tasks-changed');
});
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
  const f = fileFor(e.file);
  if (e.kind === 'toggle') {
    const t = f.findById(e.id);
    if (t) { t.active = e.prev; t.dirty = true; f.save(); }
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
      result.ok = false; result.errors.shortcut = 'Registration failed — invalid or already taken';
    }
  }
  if (clean.autoStart !== undefined && clean.autoStart !== state.settings.autoStart) {
    applyAutoStart(clean.autoStart);
  }
  for (const k of ['workPath', 'personalPath']) {
    if (clean[k] !== undefined && !fs.existsSync(clean[k])) {
      result.ok = false; result.errors[k] = 'File not found';
      delete clean[k];
    }
  }
  state.settings = { ...state.settings, ...clean };
  saveState(); sendSnap();
  return result;
});
ipcMain.handle('update-task', (_e, file, id, patch) => {
  const f = fileFor(file);
  let due = undefined;
  if (patch.dueText !== undefined) {
    const m = String(patch.dueText || '').match(/^(\d{1,2})\s+([A-Za-z]{3})/);
    if (m) {
      const mi = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[2][0].toUpperCase() + m[2].slice(1).toLowerCase()) + 1;
      const dim = new Date(new Date().getFullYear(), mi, 0).getDate(); // clamp: 31 Feb → 28/29 Feb
      due = { d: Math.min(+m[1], dim), m: m[2][0].toUpperCase() + m[2].slice(1).toLowerCase() };
    } else due = null;
  }
  const t = f.findById(id);
  const starToggled = t && patch.active !== undefined && !!patch.active !== !!t.active; // editor's ★ path counts as a star interaction
  f.update(id, { title: patch.title, priority: patch.priority, due, active: patch.active });
  if (patch.desc !== undefined) f.setNotes(id, patch.desc);
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
  const m = String(data.dueText || '').match(/^(\d{1,2})\s+([A-Za-z]{3})/);
  const t = f.addTask({ title: data.title, priority: data.priority || null, active: !!data.active, due: m ? { d: +m[1], m: m[2][0].toUpperCase() + m[2].slice(1).toLowerCase() } : null });
  if (t && data.desc && data.desc.length) f.setNotes(f.id(t), data.desc);
  f.save(); sendSnap(); if (mainWin) mainWin.webContents.send('tasks-changed');
  return { ok: !!t, id: t ? f.id(t) : null };
});
ipcMain.handle('add-subtask', (_e, file, parentId, title) => {
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
ipcMain.handle('delete-subtask', (_e, file, parentId, title) => {
  const f = fileFor(file);
  f.deleteSubtask(parentId, title); f.save(); sendSnap();
  if (mainWin) mainWin.webContents.send('tasks-changed');
});
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
ipcMain.handle('copy-text', async (_e, text) => { await clipboard.writeText(String(text || '')); return true; }); // Electron 44 clipboard is async — await so the invoke resolves after the write
ipcMain.handle('open-note', (_e, file) => {
  shell.openPath(file === 'work' ? state.settings.workPath : state.settings.personalPath);
});

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', () => { openWindow(); });
  app.whenReady().then(() => {
    LOG('APP-START');
    // first-run: create starter notes when the user still has the default paths
    const seedNote = (p, isWork) => {
      const today = `${new Date().getDate()} ${MONTHS[new Date().getMonth()]}`;
      const lines = [
        `# ${isWork ? 'Work Tasks' : 'Personal Todos'}`, '',
        '> Format: `- [ ] * !! 24 Sep — Task title` — `*` active, `!` priority, `D Mon` due (all optional, any order).',
        `> ${isWork ? 'Done tasks move under ## Done.' : 'Tick tasks when done.'} Edit freely — the app reads whatever you write.`, '',
        ...(isWork ? ['## Open', ''] : []),
        `- [ ] ${isWork ? '! ' : ''}${today} — My first ${isWork ? 'work task' : 'todo'}`, '',
        ...(isWork ? ['## Done', ''] : []),
        ''
      ];
      fs.writeFileSync(p, lines.join('\n'));
    };
    for (const [p, isWork] of [[state.settings.workPath, true], [state.settings.personalPath, false]]) {
      if (p.startsWith(path.join(require('os').homedir(), 'Documents', 'todos-island')) && !fs.existsSync(p)) {
        try {
          fs.mkdirSync(path.dirname(p), { recursive: true });
          seedNote(p, isWork);
          LOG('SEEDED ' + p);
        } catch (e) { LOG('SEED-ERR ' + e.message); }
      }
    }
    createIsland();
    createTray();
    registerShortcut();
    if (state.settings.autoStart) applyAutoStart(true); // self-heal: rewrite any dev-era registration that boots bare electron.exe
    LOG('TRAY-READY');
    // one shakedown pop at launch — manual launches only; a system (--hidden) boot stays quiet
    if (!process.argv.includes('--hidden')) setTimeout(showIsland, 1500);
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
          await step('delete+undo', `(async()=>{ const d=document.querySelector('.wtrash'); if(!d) return 'no-trash'; d.click(); await new Promise(r=>setTimeout(r,800)); ${undoClick} await new Promise(r=>setTimeout(r,800)); return 'ok'; })()`);
          const iStep = (name, js) => island.webContents.executeJavaScript(js)
            .then(r => LOG(`UTEST ${name}: ${r}`)).catch(e => LOG(`UTEST ${name} ERR: ${e.message.slice(0, 120)}`));
          await iStep('island-click-stages+undo', `(async()=>{ const t=document.querySelector('#body .row .rtitle'); if(!t) return 'no-row'; t.dispatchEvent(new MouseEvent('click',{bubbles:true})); await new Promise(r=>setTimeout(r,900)); const bar=document.getElementById('undo-bar'); const b=bar.querySelector('[data-undo]'); if(!b||bar.hidden) return 'NO-WRITE'; const lbl=bar.querySelector('.undo-label').textContent; b.click(); await new Promise(r=>setTimeout(r,900)); return 'ok ['+lbl+']'; })()`); // row click = stage as Now (owner 2026-09-25)
          LOG('UTEST island-click-opened-editor: ' + (editorWin && !editorWin.isDestroyed() ? 'UNEXPECTED' : 'no (correct)'));
          await iStep('island-edit-handoff', `(async()=>{ const e0=document.querySelector('#body .row [data-edit]'); if(!e0) return 'no-edit-btn'; e0.click(); await new Promise(r=>setTimeout(r,900)); return 'clicked'; })()`);
          LOG('UTEST edit-handoff(main): editor=' + !!(editorWin && !editorWin.isDestroyed()) + ' main=' + !!(mainWin && !mainWin.isDestroyed() && mainWin.isVisible()) + ' islandVisible=' + (island ? island.isVisible() : 'n/a'));
          if (editorWin && !editorWin.isDestroyed()) editorWin.close();
          await iStep('island-check+undo', `(async()=>{ const c=document.querySelector('#body .row [data-chk]'); if(!c) return 'no-chk'; c.click(); await new Promise(r=>setTimeout(r,1200)); const b=document.querySelector('#undo-bar [data-undo]'); if(!b) return 'no-bar'; b.click(); await new Promise(r=>setTimeout(r,900)); return 'ok'; })()`);
          await step('reorder+undo', `(async()=>{ const rows=document.querySelectorAll('.wrow'); if(rows.length<2) return 'need-2-rows'; rows[0].dispatchEvent(new DragEvent('dragstart',{bubbles:true})); rows[1].dispatchEvent(new DragEvent('drop',{bubbles:true})); await new Promise(r=>setTimeout(r,800)); ${undoClick} await new Promise(r=>setTimeout(r,800)); return 'ok'; })()`);
          await step('glass+mica', `(async()=>{ const t=document.getElementById('undo-toast'); const bf=getComputedStyle(t).backdropFilter; return 'micaClass='+document.documentElement.classList.contains('mica')+' bodyBg='+getComputedStyle(document.body).backgroundColor+' toastBackdrop='+bf; })()`);
          LOG('UTEST mica-enabled(main): ' + MICA + ' os=' + require('os').release());
          await iStep('island-rim', `(async()=>{ const p=document.getElementById('pill'); const cs=getComputedStyle(p); return 'rimClass='+p.classList.contains('rim')+' pillShadow='+cs.boxShadow+' before='+getComputedStyle(p,'::before').content+' sheen='+getComputedStyle(p,'::after').content; })()`);
          const wait = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
          const key = k => `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'${k}',bubbles:true}));`;
          await step('kbd-roving+priority', `(async()=>{ document.getElementById('tab-work').click(); ${wait(300)} const rows=[...document.querySelectorAll('#task-list .wrow')]; rows[0].focus(); ${key('ArrowDown')} const moved=document.activeElement===rows[1]; const stops=rows.filter(r=>r.tabIndex===0).length; ${key('3')} ${wait(700)} const b1=document.activeElement.querySelector('.bang').textContent; ${key('0')} ${wait(700)} const b2=document.activeElement.querySelector('.bang').textContent; return 'moved='+moved+' tabstops='+stops+' after3=['+b1+'] after0=['+b2+'] role='+document.querySelector('#task-list .fold').getAttribute('role'); })()`);
          showIsland({ focus: true });
          await iStep('island-kbd-summon', `(async()=>{ await new Promise(r=>setTimeout(r,600)); const a=document.activeElement; const onNav=!!(a&&a.hasAttribute&&a.hasAttribute('data-nav')); a.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})); const moved=document.activeElement!==a && document.activeElement.hasAttribute('data-nav'); return 'focused-nav='+onNav+' arrow-moved='+moved; })()`);
          LOG('UTEST island-focusable-after-summon: ' + island.isFocusable());
          await step('kbd-complete+undo',`(async()=>{ const r=document.querySelector('#task-list .wrow'); r.focus(); const t=r.querySelector('.tt').textContent; ${key('x')} ${wait(900)} const gone=![...document.querySelectorAll('#task-list .tt')].some(e=>e.textContent===t); ${undoClick} ${wait(900)} const back=[...document.querySelectorAll('#task-list .tt')].some(e=>e.textContent===t); return 'gone='+gone+' back='+back+' live='+document.getElementById('undo-toast').getAttribute('aria-live'); })()`);
          await step('composer-empty-add',`(async()=>{ document.getElementById('new-title').value=''; document.getElementById('btn-add').click(); ${wait(300)} return 'hint=' + document.getElementById('new-hint').textContent; })()`);
          await step('composer-typed-add', `(async()=>{ const ta=document.getElementById('new-title'); ta.value='!! 26 Sep E2E composed task'; ta.dispatchEvent(new Event('input',{bubbles:true})); ${wait(400)} const pv=document.getElementById('new-preview-line').textContent; const sel=[...document.querySelectorAll('#new-prio .pchip.sel')].map(c=>c.dataset.p).join(); document.getElementById('btn-add').click(); ${wait(700)} const row=[...document.querySelectorAll('.wrow')].find(r=>r.textContent.includes('E2E composed task')); return 'preview=[' + pv + '] chip=' + sel + ' row=' + (row ? row.querySelector('.bang').textContent + '|' + (row.querySelector('.wdue')||{}).textContent : 'MISSING'); })()`);
          await step('done-tab+clear+undo', `(async()=>{ document.getElementById('tab-done').click(); ${wait(400)} const n0=document.querySelectorAll('.wrow.done').length; document.getElementById('btn-clear-done').click(); ${wait(700)} const n1=document.querySelectorAll('.wrow.done').length; ${undoClick} ${wait(900)} const n2=document.querySelectorAll('.wrow.done').length; return n0+'→'+n1+'→'+n2; })()`);
          await step('settings-dirty-guard', `(async()=>{ document.getElementById('tab-settings').click(); ${wait(500)} const d=document.getElementById('set-dismiss'); d.value='3'; d.dispatchEvent(new Event('input',{bubbles:true})); const dot=!document.getElementById('settings-dirty').hidden; document.getElementById('tab-work').click(); ${wait(200)} const guard=!document.getElementById('dirty-guard').hidden; document.getElementById('guard-save').click(); ${wait(700)} const fs=document.querySelector('.fstat[data-for=set-dismiss]').textContent; return 'dot='+dot+' guard='+guard+' clamp=['+fs+'] tab='+document.querySelector('.tab.active').id; })()`);
          { // quick editor: preview line, ⋯ menu, and a no-change Save must round-trip the note byte-identically
            const t0 = snapshot().sections.flatMap(s => s.items).find(t => t.file === 'work');
            const before = fs.readFileSync(state.settings.workPath, 'utf8');
            openEditor(t0.file, t0.id);
            await new Promise(r => setTimeout(r, 1500));
            const eStep = (name, js) => editorWin.webContents.executeJavaScript(js)
              .then(r => LOG(`UTEST ${name}: ${r}`)).catch(e => LOG(`UTEST ${name} ERR: ${e.message.slice(0, 120)}`));
            await eStep('editor-preview+menu+save', `(async()=>{ await new Promise(r=>setTimeout(r,300)); const pv=document.getElementById('ed-preview-line').textContent; document.getElementById('ed-more').click(); const menuOpen=!document.getElementById('ed-menu').hidden; document.getElementById('ed-more').click(); document.getElementById('ed-save').click(); await new Promise(r=>setTimeout(r,700)); return 'preview=['+pv+'] menu='+menuOpen+' saved='+!document.getElementById('ed-saved').hidden; })()`);
            LOG('UTEST editor-save-roundtrip: ' + (fs.readFileSync(state.settings.workPath, 'utf8') === before ? 'byte-identical' : 'CHANGED'));
            if (editorWin && !editorWin.isDestroyed()) editorWin.close();
          }
          await step('open-share',`(async()=>{ document.getElementById('btn-share').click(); await new Promise(r=>setTimeout(r,900)); return 'clicked'; })()`);
          const shStep = (name, js) => (shareWin && shareWin.webContents.executeJavaScript(js))
            .then(r => LOG(`UTEST ${name}: ${r}`)).catch(e => LOG(`UTEST ${name} ERR: ${e.message.slice(0, 120)}`));
          await shStep('share-pick+copy-wa', `(async()=>{ const rows=document.querySelectorAll('.sh-row'); if(rows.length<2) return 'need-2-rows:'+rows.length; rows[0].click(); await new Promise(r=>setTimeout(r,150)); rows[rows.length-1].click(); await new Promise(r=>setTimeout(r,150)); document.getElementById('btn-copy').click(); await new Promise(r=>setTimeout(r,500)); return document.querySelectorAll('.sh-row.sel').length + ' selected'; })()`);
          LOG('CLIP-WA: ' + String((await clipboard.readText()) || '').split('\\n').join(' | ').slice(0, 160));
          await shStep('share-fmt-md+copy', `(async()=>{ document.querySelector('.seg-btn[data-fmt=md]').click(); await new Promise(r=>setTimeout(r,150)); document.getElementById('btn-copy').click(); await new Promise(r=>setTimeout(r,500)); return 'ok'; })()`);
          LOG('CLIP-MD: ' + String((await clipboard.readText()) || '').split('\\n').join(' | ').slice(0, 160));
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
        } catch (e) { LOG('UTEST-FATAL ' + e.message); }
      }, 2500);
    }
  });
  app.on('window-all-closed', e => e.preventDefault()); // tray keeps living
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
