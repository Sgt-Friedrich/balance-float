const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('balanceApp', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  refresh: () => ipcRenderer.invoke('balances:refresh'),
  hide: () => ipcRenderer.invoke('window:hide'),
  quit: () => ipcRenderer.invoke('window:quit'),
  onUpdate: (callback) => ipcRenderer.on('balances:update', (_event, payload) => callback(payload))
});
