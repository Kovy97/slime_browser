const { contextBridge, ipcRenderer } = require('electron');

// Slime Browser API - exposed to renderer via contextBridge
// All IPC channels are validated in main.js handlers
// Callback functions (on*) return cleanup functions for listener removal
contextBridge.exposeInMainWorld('slime', {
  // Webview preload path (for cosmetic ad filtering + anti-annoyance)
  getWebviewPreloadPath: () => ipcRenderer.invoke('get-webview-preload-path'),

  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Window state
  onWindowState: (callback) => {
    const handler = (_, state) => callback(state);
    ipcRenderer.on('window-state', handler);
    return () => ipcRenderer.removeListener('window-state', handler);
  },

  // Adblocker
  getBlockedCount: () => ipcRenderer.invoke('get-blocked-count'),
  onBlockedCountUpdated: (callback) => {
    const handler = (_, count) => callback(count);
    ipcRenderer.on('blocked-count-updated', handler);
    return () => ipcRenderer.removeListener('blocked-count-updated', handler);
  },

  // YouTube tools
  getYouTubeScript: () => ipcRenderer.invoke('get-youtube-script'),

  // Session restore
  saveSession: (tabsData) => {
    if (!Array.isArray(tabsData)) return;
    ipcRenderer.send('save-session', tabsData);
  },
  loadSession: () => ipcRenderer.invoke('load-session'),

  // Settings
  settingsGet: () => ipcRenderer.invoke('settings-get'),
  settingsSave: (settings) => {
    if (typeof settings !== 'object' || settings === null) return Promise.reject('Invalid settings');
    return ipcRenderer.invoke('settings-save', settings);
  },

  // History
  historyAdd: (entry) => {
    if (!entry || typeof entry.url !== 'string') return Promise.reject('Invalid entry');
    return ipcRenderer.invoke('history-add', entry);
  },
  historyGet: (query) => ipcRenderer.invoke('history-get', query),
  historyClear: () => ipcRenderer.invoke('history-clear'),

  // Bookmarks
  bookmarksGet: () => ipcRenderer.invoke('bookmarks-get'),
  bookmarksAdd: (bookmark) => {
    if (!bookmark || typeof bookmark.url !== 'string') return Promise.reject('Invalid bookmark');
    return ipcRenderer.invoke('bookmarks-add', bookmark);
  },
  bookmarksRemove: (url) => ipcRenderer.invoke('bookmarks-remove', url),
  bookmarksCheck: (url) => ipcRenderer.invoke('bookmarks-check', url),

  // Downloads
  onDownloadStarted: (cb) => {
    const handler = (_, d) => cb(d);
    ipcRenderer.on('download-started', handler);
    return () => ipcRenderer.removeListener('download-started', handler);
  },
  onDownloadUpdated: (cb) => {
    const handler = (_, d) => cb(d);
    ipcRenderer.on('download-updated', handler);
    return () => ipcRenderer.removeListener('download-updated', handler);
  },
  onDownloadDone: (cb) => {
    const handler = (_, d) => cb(d);
    ipcRenderer.on('download-done', handler);
    return () => ipcRenderer.removeListener('download-done', handler);
  },
  downloadOpen: (filePath) => {
    if (typeof filePath !== 'string') return Promise.reject('Invalid path');
    return ipcRenderer.invoke('download-open', filePath);
  },
  downloadShow: (filePath) => {
    if (typeof filePath !== 'string') return Promise.reject('Invalid path');
    return ipcRenderer.invoke('download-show', filePath);
  },
  downloadsGet: () => ipcRenderer.invoke('downloads-get'),

  // Passwords
  passwordsGet: () => ipcRenderer.invoke('passwords-get'),
  passwordsSave: (entry) => {
    if (!entry || typeof entry.url !== 'string' || typeof entry.password !== 'string') return Promise.reject('Invalid entry');
    return ipcRenderer.invoke('passwords-save', entry);
  },
  passwordsRemove: (data) => ipcRenderer.invoke('passwords-remove', data),
  passwordsFind: (url) => ipcRenderer.invoke('passwords-find', url),

  // Macros
  macros: {
    get: () => ipcRenderer.invoke('macros-get'),
    save: (macros) => {
      if (!Array.isArray(macros)) return Promise.reject('Invalid macros');
      return ipcRenderer.invoke('macros-save', macros);
    },
  },

  // HTTP Auth
  onAuthRequest: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('auth-request', handler);
    return () => ipcRenderer.removeListener('auth-request', handler);
  },
  authRespond: (response) => ipcRenderer.send('auth-response', response),

  // Context menu
  showContextMenu: (params) => ipcRenderer.send('show-context-menu', params),
  onContextAction: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('context-action', handler);
    return () => ipcRenderer.removeListener('context-action', handler);
  },

  // Open URL from external source (default browser)
  onOpenUrl: (callback) => {
    const handler = (_, url) => callback(url);
    ipcRenderer.on('open-url', handler);
    return () => ipcRenderer.removeListener('open-url', handler);
  },

  // Google Login (Firefox-UA BrowserWindow to bypass Google's embedded browser block)
  openGoogleLogin: (url) => {
    if (typeof url !== 'string') return Promise.reject('Invalid URL');
    return ipcRenderer.invoke('open-google-login', url);
  },
  onGoogleLoginComplete: (callback) => {
    const handler = (_, url) => callback(url);
    ipcRenderer.on('google-login-complete', handler);
    return () => ipcRenderer.removeListener('google-login-complete', handler);
  },
});
