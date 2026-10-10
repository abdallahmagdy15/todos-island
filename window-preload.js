const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getSnapshot: () => ipcRenderer.invoke('get-snapshot'),
  saveSettings: s => ipcRenderer.invoke('save-settings', s),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  exportSettings: () => ipcRenderer.invoke('export-settings'),
  importSettings: () => ipcRenderer.invoke('import-settings'),
  linkTask: (file, id, on) => ipcRenderer.invoke('link-task', file, id, on), // shadow in the other note (owner 2026-10-10)
  moveTaskNote: (file, id) => ipcRenderer.invoke('move-task-note', file, id), // the whole task to the other note
  openOnboard: () => ipcRenderer.invoke('open-onboarding'),
  updateTask: (file, id, patch) => ipcRenderer.invoke('update-task', file, id, patch),
  toggleActive: (id, file) => ipcRenderer.invoke('toggle-active', id, file),
  addTask: (file, data) => ipcRenderer.invoke('add-task', file, data),
  addSubtask: (file, parentId, title, session) => ipcRenderer.invoke('add-subtask', file, parentId, title, session),
  toggleSubtask: (file, parentId, title, session) => ipcRenderer.invoke('toggle-subtask', file, parentId, title, session),
  subtaskPriority: (file, parentId, title, p, session) => ipcRenderer.invoke('subtask-priority', file, parentId, title, p, session),
  renameSubtask: (file, parentId, title, newTitle, session) => ipcRenderer.invoke('rename-subtask', file, parentId, title, newTitle, session),
  complete: (id, file) => ipcRenderer.invoke('complete', id, file),
  deleteTask: (id, file) => ipcRenderer.invoke('delete-task', id, file),
  undoAction: token => ipcRenderer.invoke('undo-action', token),
  undoExpire: token => ipcRenderer.invoke('undo-expire', token),
  moveSubtask: (fromFile, fromId, title, toFile, toId) => ipcRenderer.invoke('move-subtasks', fromFile, fromId, [title], toFile, toId), // drag: one
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
  attOpen: (file, id, index) => ipcRenderer.invoke('att-open', file, id, index),
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
