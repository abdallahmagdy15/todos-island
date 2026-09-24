const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getSnapshot: () => ipcRenderer.invoke('get-snapshot'),
  openEditor: (file, id) => ipcRenderer.invoke('open-editor', file, id),
  saveSettings: s => ipcRenderer.invoke('save-settings', s),
  updateTask: (file, id, patch) => ipcRenderer.invoke('update-task', file, id, patch),
  addTask: (file, data) => ipcRenderer.invoke('add-task', file, data),
  addSubtask: (file, parentId, title) => ipcRenderer.invoke('add-subtask', file, parentId, title),
  toggleSubtask: (file, parentId, title) => ipcRenderer.invoke('toggle-subtask', file, parentId, title),
  complete: (id, file) => ipcRenderer.invoke('complete', id, file),
  undoComplete: () => ipcRenderer.invoke('undo-complete'),
  deleteTask: (id, file) => ipcRenderer.invoke('delete-task', id, file),
  undoDelete: () => ipcRenderer.invoke('undo-delete'),
  deleteSubtask: (file, parentId, title) => ipcRenderer.invoke('delete-subtask', file, parentId, title),
  uncomplete: (id, file) => ipcRenderer.invoke('uncomplete-task', id, file),
  moveTask: (file, id, dir) => ipcRenderer.invoke('move-task', file, id, dir),
  reorderTask: (file, id, beforeId) => ipcRenderer.invoke('reorder-task', file, id, beforeId),
  clearDone: file => ipcRenderer.invoke('clear-done', file),
  openNote: file => ipcRenderer.invoke('open-note', file),
  onTasksChanged: cb => ipcRenderer.on('tasks-changed', () => cb()),
  onShowUndo: cb => ipcRenderer.on('show-undo', (_e, d) => cb(d))
});
