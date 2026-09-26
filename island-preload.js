const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  onSnapshot: cb => ipcRenderer.on('snapshot', (_e, d) => cb(d)),
  toggleActive: (id, file) => ipcRenderer.invoke('toggle-active', id, file),
  toggleSubtask: (file, parentId, title) => ipcRenderer.invoke('toggle-subtask', file, parentId, title),
  complete: (id, file) => ipcRenderer.invoke('complete', id, file),
  undoAction: token => ipcRenderer.invoke('undo-action', token),
  undoExpire: token => ipcRenderer.invoke('undo-expire', token),
  onPlaySound: cb => ipcRenderer.on('play-sound', () => cb()),
  openWindow: tab => ipcRenderer.send('open-window', tab),
  onLangChanged: cb => ipcRenderer.on('lang-changed', (_e, lang) => cb(lang)),
  onShown: cb => ipcRenderer.on('island-shown', () => cb()),
  onFocusRequest: cb => ipcRenderer.on('island-focus', () => cb()),
  onRetract: cb => ipcRenderer.on('retract-island', () => cb()),
  openShare: () => ipcRenderer.invoke('open-share'),
  getSnapshot: () => ipcRenderer.invoke('get-snapshot'),
  openEditor: (file, id) => ipcRenderer.invoke('open-editor', file, id),
  reorderTask: (file, id, beforeId) => ipcRenderer.invoke('reorder-task', file, id, beforeId),
  hide: () => ipcRenderer.send('hide-island'),
  resize: (h, top) => ipcRenderer.send('island-size', h, top)
});
