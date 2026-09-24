const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  onSnapshot: cb => ipcRenderer.on('snapshot', (_e, d) => cb(d)),
  toggleActive: (id, file) => ipcRenderer.invoke('toggle-active', id, file),
  toggleSubtask: (file, parentId, title) => ipcRenderer.invoke('toggle-subtask', file, parentId, title),
  complete: (id, file) => ipcRenderer.invoke('complete', id, file),
  undoComplete: () => ipcRenderer.invoke('undo-complete'),
  undoDelete: () => ipcRenderer.invoke('undo-delete'),
  onPlaySound: cb => ipcRenderer.on('play-sound', () => cb()),
  openWindow: () => ipcRenderer.send('open-window'),
  openEditor: (file, id) => ipcRenderer.invoke('open-editor', file, id),
  reorderTask: (file, id, beforeId) => ipcRenderer.invoke('reorder-task', file, id, beforeId),
  hide: () => ipcRenderer.send('hide-island'),
  resize: (h, top) => ipcRenderer.send('island-size', h, top)
});
