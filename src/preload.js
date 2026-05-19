const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('balanceApp', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  refresh: () => ipcRenderer.invoke('balances:refresh'),
  refreshServers: () => ipcRenderer.invoke('servers:refresh'),
  setCompactMode: (compactMode) => ipcRenderer.invoke('window:compact', compactMode),
  previewOpacity: (opacity) => ipcRenderer.invoke('window:opacity-preview', opacity),
  hide: () => ipcRenderer.invoke('window:hide'),
  quit: () => ipcRenderer.invoke('window:quit'),
  onUpdate: (callback) => ipcRenderer.on('balances:update', (_event, payload) => callback(payload)),
  onServersUpdate: (callback) => ipcRenderer.on('servers:update', (_event, payload) => callback(payload)),
  onModeChange: (callback) => ipcRenderer.on('window:mode', (_event, payload) => callback(payload))
});
