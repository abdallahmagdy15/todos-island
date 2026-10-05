const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  onSnapshot: cb => ipcRenderer.on('snapshot', (_e, d) => cb(d)),
  toggleActive: (id, file) => ipcRenderer.invoke('toggle-active', id, file),
  toggleSubtask: (file, parentId, title, session) => ipcRenderer.invoke('toggle-subtask', file, parentId, title, session),
  complete: (id, file) => ipcRenderer.invoke('complete', id, file),
  undoAction: token => ipcRenderer.invoke('undo-action', token),
  undoExpire: token => ipcRenderer.invoke('undo-expire', token),
  onPlaySound: cb => ipcRenderer.on('play-sound', () => cb()),
  openWindow: tab => ipcRenderer.send('open-window', tab),
  onLangChanged: cb => ipcRenderer.on('lang-changed', (_e, lang) => cb(lang)),
  onShown: cb => ipcRenderer.on('island-shown', (_e, info) => cb(info || {})),
  onFocusRequest: cb => ipcRenderer.on('island-focus', () => cb()),
  onRetract: cb => ipcRenderer.on('retract-island', () => cb()),
  openShare: () => ipcRenderer.invoke('open-share'),
  openUpdate: () => ipcRenderer.invoke('open-update'),
  getSnapshot: () => ipcRenderer.invoke('get-snapshot'),
  copyText: text => ipcRenderer.invoke('copy-text', text), // the quick Copy tab
  saveShareFmt: fmt => ipcRenderer.invoke('save-settings', { shareFmt: fmt }), // the copy wheel's Markdown / plain petal
  openEditor: (file, id) => ipcRenderer.invoke('open-editor', file, id),
  reorderTask: (file, id, beforeId) => ipcRenderer.invoke('reorder-task', file, id, beforeId),
  timerStart: (file, id, title, min) => ipcRenderer.invoke('timer-start', file, id, title, min),
  timerStop: () => ipcRenderer.invoke('timer-stop'),
  onTimerEnded: cb => ipcRenderer.on('timer-ended', (_e, d) => cb(d)),
  hide: () => ipcRenderer.send('hide-island'),
  resize: (h, top) => ipcRenderer.send('island-size', h, top)
});
