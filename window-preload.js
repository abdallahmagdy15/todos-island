const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('api', {
  // the window's own frame (M7): buttons + edge resize; 'win-state' says whether it is maximized
  winCtl: act => ipcRenderer.send('win-ctl', act),
  winResize: (phase, edge, x, y) => ipcRenderer.send('win-resize', phase, edge, x, y),
  onWinState: cb => ipcRenderer.on('win-state', (_e, s) => cb(s)),
  getSnapshot: () => ipcRenderer.invoke('get-snapshot'),
  saveSettings: s => ipcRenderer.invoke('save-settings', s),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  applyTheme: id => ipcRenderer.invoke('apply-theme', id), // a theme tile = the whole look in one pick (owner 2026-10-18)
  exportSettings: () => ipcRenderer.invoke('export-settings'),
  importSettings: () => ipcRenderer.invoke('import-settings'),
  linkTask: (file, id, on) => ipcRenderer.invoke('link-task', file, id, on), // shadow in the other note (owner 2026-10-10)
  moveTaskNote: (file, id) => ipcRenderer.invoke('move-task-note', file, id), // the whole task to the other note
  taskInto: (file, id, targetId) => ipcRenderer.invoke('task-into', file, id, targetId), // drag a task INTO another → its subtask (owner 2026-10-29)
  openOnboard: () => ipcRenderer.invoke('open-onboarding'),
  updateTask: (file, id, patch) => ipcRenderer.invoke('update-task', file, id, patch),
  toggleActive: (id, file) => ipcRenderer.invoke('toggle-active', id, file),
  addTask: (file, data) => ipcRenderer.invoke('add-task', file, data),
  addSubtask: (file, parentId, title, session, under, notes) => ipcRenderer.invoke('add-subtask', file, parentId, title, session, under, notes), // under = a phase title → a step; notes = description lines (N2)
  toggleSubtask: (file, parentId, title, session) => ipcRenderer.invoke('toggle-subtask', file, parentId, title, session),
  subtaskPriority: (file, parentId, title, p, session) => ipcRenderer.invoke('subtask-priority', file, parentId, title, p, session),
  renameSubtask: (file, parentId, title, newTitle, session, notes) => ipcRenderer.invoke('rename-subtask', file, parentId, title, newTitle, session, notes),
  subtaskPhase: (file, parentId, title, on, session) => ipcRenderer.invoke('subtask-phase', file, parentId, title, on, session), // phases (owner 2026-10-29)
  subtaskNest: (file, parentId, title, dir, session) => ipcRenderer.invoke('subtask-nest', file, parentId, title, dir, session), // dir 1 = Tab, -1 = Shift+Tab
  subtaskUnder: (file, parentId, title, phaseTitle, session) => ipcRenderer.invoke('subtask-under', file, parentId, title, phaseTitle, session),
  subtaskReorder: (file, parentId, title, beforeTitle, underTitle, session) => ipcRenderer.invoke('subtask-reorder', file, parentId, title, beforeTitle, underTitle, session),
  complete: (id, file) => ipcRenderer.invoke('complete', id, file),
  deleteTask: (id, file) => ipcRenderer.invoke('delete-task', id, file),
  undoAction: token => ipcRenderer.invoke('undo-action', token),
  undoExpire: token => ipcRenderer.invoke('undo-expire', token),
  moveSubtask: (fromFile, fromId, title, toFile, toId, toPhase) => ipcRenderer.invoke('move-subtasks', fromFile, fromId, [title], toFile, toId, toPhase), // drag: one; toPhase = drop onto a phase
  moveSubtasks: (fromFile, fromId, titles, toFile, toId) => ipcRenderer.invoke('move-subtasks', fromFile, fromId, titles, toFile, toId), // editor: the picked ones
  deleteSubtask: (file, parentId, title, session) => ipcRenderer.invoke('delete-subtask', file, parentId, title, session),
  uncomplete: (id, file) => ipcRenderer.invoke('uncomplete-task', id, file),
  moveTask: (file, id, dir) => ipcRenderer.invoke('move-task', file, id, dir),
  reorderTask: (file, id, beforeId) => ipcRenderer.invoke('reorder-task', file, id, beforeId),
  clearDoneAll: () => ipcRenderer.invoke('clear-done-all'),
  composeTask: data => ipcRenderer.invoke('compose-task', data),
  openNote: file => ipcRenderer.invoke('open-note', file),
  attSessions: tool => ipcRenderer.invoke('att-sessions', tool), // attachments (owner 2026-10-09)
  attPick: kind => ipcRenderer.invoke('att-pick', kind),
  attSet: (file, id, list) => ipcRenderer.invoke('att-set', file, id, list),
  iconSet: (file, id, subTitle, name) => ipcRenderer.invoke('icon-set', file, id, subTitle, name), // the picked icon (owner 2026-10-15)
  attOpen: (file, id, index) => ipcRenderer.invoke('att-open', file, id, index),
  imgSave: bytes => ipcRenderer.invoke('img-save', bytes), // a pasted image → a file in <userData>/images (E2a)
  imgAttach: (file, parentId, subTitle, name, session) => ipcRenderer.invoke('img-attach', file, parentId, subTitle, name, session), // the link line lands under the subtask / task
  imgRemove: (file, parentId, subTitle, name, session) => ipcRenderer.invoke('img-remove', file, parentId, subTitle, name, session), // the line leaves; the FILE stays (Undo)
  imgOpen: name => ipcRenderer.invoke('img-open', name), // an image attachment (E2a)
  imgDiscard: name => ipcRenderer.invoke('img-discard', name), // a pending image's × — its file goes (owner 2026-11-12)
  pathOf: f => webUtils.getPathForFile(f), // a file dropped on the editor → its path on disk
  foldGet: () => ipcRenderer.invoke('fold-get'), // rows opened since the app started (main keeps them; the window dies on close)
  foldSet: (keys, open) => ipcRenderer.invoke('fold-set', keys, open),
  openUpdate: () => ipcRenderer.invoke('open-update'),
  checkUpdate: () => ipcRenderer.invoke('check-update'), // Settings → About "Check now"
  openAboutLink: kind => ipcRenderer.invoke('open-about-link', kind), // 'notes' | 'repo' — main owns the URLs
  exportMd: text => ipcRenderer.invoke('export-md', text),
  openWhatsApp: text => ipcRenderer.invoke('open-whatsapp', text),
  copyText: text => ipcRenderer.invoke('copy-text', text),
  timerStart: (file, id, title, min) => ipcRenderer.invoke('timer-start', file, id, title, min),
  timerStop: () => ipcRenderer.invoke('timer-stop'),
  onWindowOpened: cb => ipcRenderer.on('window-opened', () => cb()), // opened / brought forward / restored → sort again
  onTasksChanged: cb => ipcRenderer.on('tasks-changed', () => cb()),
  onShowUndo: cb => ipcRenderer.on('show-undo', (_e, d) => cb(d)),
  onLangChanged: cb => ipcRenderer.on('lang-changed', (_e, lang) => cb(lang)),
  onShowTab: cb => ipcRenderer.on('show-tab', (_e, tab) => cb(tab)),
  onOpenPanel: cb => ipcRenderer.on('open-panel', (_e, p) => cb(p)) // the island's Edit / Share open the side panel here
});
