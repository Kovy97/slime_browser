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

  // Session restore
  saveSession: (tabsData) => ipcRenderer.send('save-session', tabsData),
  loadSession: () => ipcRenderer.invoke('load-session'),

  // Settings
  settingsGet: () => ipcRenderer.invoke('settings-get'),
  settingsSave: (settings) => ipcRenderer.invoke('settings-save', settings),

  // History
  historyAdd: (entry) => ipcRenderer.invoke('history-add', entry),
  historyGet: (query) => ipcRenderer.invoke('history-get', query),
  historyClear: () => ipcRenderer.invoke('history-clear'),

  // Bookmarks
  bookmarksGet: () => ipcRenderer.invoke('bookmarks-get'),
  bookmarksAdd: (bookmark) => ipcRenderer.invoke('bookmarks-add', bookmark),
  bookmarksRemove: (url) => ipcRenderer.invoke('bookmarks-remove', url),
  bookmarksCheck: (url) => ipcRenderer.invoke('bookmarks-check', url),

  // Downloads
  onDownloadStarted: (cb) => ipcRenderer.on('download-started', (_, d) => cb(d)),
  onDownloadUpdated: (cb) => ipcRenderer.on('download-updated', (_, d) => cb(d)),
  onDownloadDone: (cb) => ipcRenderer.on('download-done', (_, d) => cb(d)),
  downloadOpen: (p) => ipcRenderer.invoke('download-open', p),
  downloadShow: (p) => ipcRenderer.invoke('download-show', p),
  downloadsGet: () => ipcRenderer.invoke('downloads-get'),

  // Passwords
  passwordsGet: () => ipcRenderer.invoke('passwords-get'),
  passwordsSave: (entry) => ipcRenderer.invoke('passwords-save', entry),
  passwordsRemove: (data) => ipcRenderer.invoke('passwords-remove', data),
  passwordsFind: (url) => ipcRenderer.invoke('passwords-find', url),

  // Macros
  macros: {
    get: () => ipcRenderer.invoke('macros-get'),
    save: (macros) => ipcRenderer.invoke('macros-save', macros),
  },
});
