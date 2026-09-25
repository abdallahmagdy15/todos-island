const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  defaults: () => ipcRenderer.invoke('onboard-defaults'),
  pickPath: kind => ipcRenderer.invoke('pick-path', kind),
  inspectPath: (kind, p, note) => ipcRenderer.invoke('inspect-path', kind, p, note),
  finish: answers => ipcRenderer.invoke('onboard-finish', answers),
  close: then => ipcRenderer.invoke('onboard-close', then)
});
