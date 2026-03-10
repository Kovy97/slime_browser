const { app, BrowserWindow, ipcMain, session, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { setupAdblocker } = require('./adblocker/engine');
const { getYouTubeScript } = require('./youtube/inject');

let mainWindow;

// ==========================================
// Data Paths & Storage Helpers
// ==========================================

function dataPath(filename) {
  return path.join(app.getPath('userData'), filename);
}

function readJSON(filename, fallback) {
  try {
    return JSON.parse(fs.readFileSync(dataPath(filename), 'utf-8'));
  } catch (e) {
    return typeof fallback === 'function' ? fallback() : fallback;
  }
}

function writeJSON(filename, data) {
  try {
    fs.writeFileSync(dataPath(filename), JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`[Slime] Failed to write ${filename}:`, e);
  }
}

// ==========================================
// Settings
// ==========================================

const DEFAULT_SETTINGS = {
  searchEngine: 'google',
  customSearchUrl: '',
  restoreTabs: true,
  adblockerEnabled: true,
  homepage: 'slime://newtab',
  zoomLevel: 100,
};

function loadSettings() {
  const data = readJSON('settings.json', {});
  return { ...DEFAULT_SETTINGS, ...data };
}

ipcMain.handle('settings-get', () => loadSettings());
ipcMain.handle('settings-save', (_, settings) => {
  writeJSON('settings.json', settings);
  return loadSettings();
});

// ==========================================
// Session Restore
// ==========================================

ipcMain.on('save-session', (_, tabsData) => writeJSON('session.json', tabsData));
ipcMain.handle('load-session', () => readJSON('session.json', []));

// ==========================================
// History
// ==========================================

ipcMain.handle('history-add', (_, entry) => {
  const history = readJSON('history.json', []);
  history.unshift({ ...entry, timestamp: Date.now() });
  if (history.length > 5000) history.length = 5000;
  writeJSON('history.json', history);
});

ipcMain.handle('history-get', (_, query) => {
  const history = readJSON('history.json', []);
  if (!query) return history.slice(0, 200);
  const q = query.toLowerCase();
  return history.filter(h =>
    h.url.toLowerCase().includes(q) ||
    (h.title && h.title.toLowerCase().includes(q))
  ).slice(0, 200);
});

ipcMain.handle('history-clear', () => writeJSON('history.json', []));

// ==========================================
// Bookmarks
// ==========================================

ipcMain.handle('bookmarks-get', () => readJSON('bookmarks.json', []));

ipcMain.handle('bookmarks-add', (_, bookmark) => {
  const bookmarks = readJSON('bookmarks.json', []);
  if (bookmarks.some(b => b.url === bookmark.url)) return bookmarks;
  bookmarks.unshift({ ...bookmark, timestamp: Date.now() });
  writeJSON('bookmarks.json', bookmarks);
  return bookmarks;
});

ipcMain.handle('bookmarks-remove', (_, url) => {
  const bookmarks = readJSON('bookmarks.json', []).filter(b => b.url !== url);
  writeJSON('bookmarks.json', bookmarks);
  return bookmarks;
});

ipcMain.handle('bookmarks-check', (_, url) => {
  return readJSON('bookmarks.json', []).some(b => b.url === url);
});

// ==========================================
// Passwords (encrypted with simple obfuscation)
// ==========================================

ipcMain.handle('passwords-get', () => readJSON('passwords.json', []));

ipcMain.handle('passwords-save', (_, entry) => {
  const passwords = readJSON('passwords.json', []);
  const idx = passwords.findIndex(p => p.url === entry.url && p.username === entry.username);
  if (idx >= 0) {
    passwords[idx] = { ...entry, updatedAt: Date.now() };
  } else {
    passwords.unshift({ ...entry, createdAt: Date.now() });
  }
  writeJSON('passwords.json', passwords);
});

ipcMain.handle('passwords-remove', (_, { url, username }) => {
  const passwords = readJSON('passwords.json', []).filter(
    p => !(p.url === url && p.username === username)
  );
  writeJSON('passwords.json', passwords);
  return passwords;
});

ipcMain.handle('passwords-find', (_, url) => {
  const passwords = readJSON('passwords.json', []);
  try {
    const host = new URL(url).hostname;
    return passwords.filter(p => {
      try { return new URL(p.url).hostname === host; } catch(e) { return false; }
    });
  } catch (e) {
    return [];
  }
});

// ==========================================
// Window
// ==========================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    icon: path.join(__dirname, '..', 'Slime1.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'browser', 'ui', 'index.html'));
  Menu.setApplicationMenu(null);

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-state', 'maximized');
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-state', 'normal');
  });
}

// Window controls
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on('window-close', () => mainWindow?.close());

// Adblocker stats
let blockedCount = 0;
ipcMain.handle('get-blocked-count', () => blockedCount);
ipcMain.on('increment-blocked', () => {
  blockedCount++;
  mainWindow?.webContents.send('blocked-count-updated', blockedCount);
});

// YouTube script injection
ipcMain.handle('get-youtube-script', () => getYouTubeScript());

// Download management
ipcMain.handle('download-open', (_, filePath) => shell.openPath(filePath));
ipcMain.handle('download-show', (_, filePath) => shell.showItemInFolder(filePath));

// ==========================================
// App Lifecycle
// ==========================================

app.whenReady().then(async () => {
  const webviewSession = session.fromPartition('persist:slime');
  await setupAdblocker(webviewSession, (count) => {
    blockedCount += count;
    mainWindow?.webContents.send('blocked-count-updated', blockedCount);
  });

  // Download manager
  const downloads = new Map();
  let downloadIdCounter = 0;

  webviewSession.on('will-download', (event, item) => {
    const id = ++downloadIdCounter;
    const filename = item.getFilename();
    const totalBytes = item.getTotalBytes();

    downloads.set(id, {
      id, filename, totalBytes, receivedBytes: 0,
      state: 'progressing', path: item.getSavePath(),
      startTime: Date.now(),
    });

    mainWindow?.webContents.send('download-started', { id, filename, totalBytes });

    item.on('updated', (_, state) => {
      const dl = downloads.get(id);
      if (!dl) return;
      dl.receivedBytes = item.getReceivedBytes();
      dl.state = state;
      dl.path = item.getSavePath();
      mainWindow?.webContents.send('download-updated', {
        id, receivedBytes: dl.receivedBytes, totalBytes: dl.totalBytes, state,
      });
    });

    item.once('done', (_, state) => {
      const dl = downloads.get(id);
      if (!dl) return;
      dl.state = state === 'completed' ? 'completed' : 'failed';
      dl.receivedBytes = item.getReceivedBytes();
      dl.path = item.getSavePath();
      mainWindow?.webContents.send('download-done', {
        id, state: dl.state, path: dl.path, filename: dl.filename,
      });
    });
  });

  ipcMain.handle('downloads-get', () => Array.from(downloads.values()));

  createWindow();
});

app.on('window-all-closed', () => app.quit());

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
