const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('slime', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Window state
  onWindowState: (callback) => {
    ipcRenderer.on('window-state', (_, state) => callback(state));
  },

  // Adblocker
  getBlockedCount: () => ipcRenderer.invoke('get-blocked-count'),
  onBlockedCountUpdated: (callback) => {
    ipcRenderer.on('blocked-count-updated', (_, count) => callback(count));
  },

  // YouTube tools
  getYouTubeScript: () => ipcRenderer.invoke('get-youtube-script'),
});
