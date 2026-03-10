const { app, BrowserWindow, ipcMain, session, Menu, shell, safeStorage, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { setupAdblocker } = require('./adblocker/engine');
const { getYouTubeScript } = require('./youtube/inject');
const { execFile } = require('child_process');
const pkg = require('../package.json');

// Chromium performance flags (must be set before app.whenReady)
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');  // Enable WebGL on all GPUs
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');

// ==========================================
// Single Instance & URL Handling (default browser support)
// ==========================================

function getUrlFromArgs(args) {
  for (const arg of args) {
    if (arg.startsWith('http://') || arg.startsWith('https://') || arg.endsWith('.html') || arg.endsWith('.htm')) {
      return arg;
    }
  }
  return null;
}

let pendingUrl = getUrlFromArgs(process.argv.slice(1));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', (_, argv) => {
  const url = getUrlFromArgs(argv.slice(1));
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    if (url) mainWindow.webContents.send('open-url', url);
  }
});

let mainWindow;

// ==========================================
// Data Paths & Storage Helpers (with in-memory cache)
// ==========================================

const jsonCache = new Map();

function dataPath(filename) {
  return path.join(app.getPath('userData'), filename);
}

function readJSON(filename, fallback) {
  if (jsonCache.has(filename)) {
    return jsonCache.get(filename);
  }
  try {
    const data = JSON.parse(fs.readFileSync(dataPath(filename), 'utf-8'));
    jsonCache.set(filename, data);
    return data;
  } catch (e) {
    const result = typeof fallback === 'function' ? fallback() : fallback;
    return result;
  }
}

function writeJSON(filename, data) {
  jsonCache.set(filename, data);
  fs.writeFile(dataPath(filename), JSON.stringify(data, null, 2), (err) => {
    if (err) console.error(`[Slime] Failed to write ${filename}:`, err);
  });
}

// ==========================================
// Debounce utility
// ==========================================

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
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
  return { ...DEFAULT_SETTINGS, ...settings };
});

// ==========================================
// Session Restore (debounced save)
// ==========================================

const debouncedSaveSession = debounce((tabsData) => {
  writeJSON('session.json', tabsData);
}, 500);

ipcMain.on('save-session', (_, tabsData) => debouncedSaveSession(tabsData));
ipcMain.handle('load-session', () => readJSON('session.json', []));

// ==========================================
// History
// ==========================================

ipcMain.handle('history-add', (_, entry) => {
  const history = readJSON('history.json', []);
  history.unshift({ ...entry, timestamp: Date.now() });
  if (history.length > 5000) history.length = 5000;
  writeJSON('history.json', history);
  return true;
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

ipcMain.handle('history-clear', () => {
  writeJSON('history.json', []);
  return true;
});

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
// Password encryption helpers (encrypted with Electron safeStorage)
// ==========================================

function encryptPassword(password) {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(password).toString('base64');
  }
  return password; // fallback to plain if encryption unavailable
}

function decryptPassword(encrypted) {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch (e) {
      return encrypted; // fallback if decryption fails (old plaintext entry)
    }
  }
  return encrypted;
}

// ==========================================
// Passwords (encrypted with Electron safeStorage)
// ==========================================

ipcMain.handle('passwords-get', () => {
  const passwords = readJSON('passwords.json', []);
  return passwords.map(p => ({ ...p, password: decryptPassword(p.password) }));
});

ipcMain.handle('passwords-save', (_, entry) => {
  const passwords = readJSON('passwords.json', []);
  const encryptedEntry = { ...entry, password: encryptPassword(entry.password) };
  const idx = passwords.findIndex(p => p.url === entry.url && p.username === entry.username);
  if (idx >= 0) {
    passwords[idx] = { ...encryptedEntry, updatedAt: Date.now() };
  } else {
    passwords.unshift({ ...encryptedEntry, createdAt: Date.now() });
  }
  writeJSON('passwords.json', passwords);
  return true;
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
    }).map(p => ({ ...p, password: decryptPassword(p.password) }));
  } catch (e) {
    return [];
  }
});

// ==========================================
// Macros
// ==========================================

ipcMain.handle('macros-get', () => readJSON('macros.json', []));
ipcMain.handle('macros-save', (_, macros) => {
  writeJSON('macros.json', macros);
  return macros;
});

// Paths
ipcMain.handle('get-webview-preload-path', () => {
  return path.join(__dirname, 'browser', 'ui', 'webview-preload.js');
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
    show: false,
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

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Open URL from command line args (default browser)
    if (pendingUrl) {
      setTimeout(() => {
        mainWindow.webContents.send('open-url', pendingUrl);
        pendingUrl = null;
      }, 500);
    }
  });

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
ipcMain.handle('download-open', (_, filePath) => {
  if (!filePath || typeof filePath !== 'string') return;
  return shell.openPath(path.resolve(filePath));
});
ipcMain.handle('download-show', (_, filePath) => {
  if (!filePath || typeof filePath !== 'string') return;
  return shell.showItemInFolder(path.resolve(filePath));
});

// ==========================================
// App Lifecycle
// ==========================================

app.whenReady().then(async () => {
  const webviewSession = session.fromPartition('persist:slime');

  // Set Chrome user-agent so Google/YouTube trust the browser
  const chromeVersion = process.versions.chrome;
  const chromeUA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  webviewSession.setUserAgent(chromeUA);

  await setupAdblocker(webviewSession, (count) => {
    blockedCount += count;
    mainWindow?.webContents.send('blocked-count-updated', blockedCount);
  });

  // Download manager
  const downloads = new Map();
  let downloadIdCounter = 0;

  // Cleanup completed/failed downloads after 1 hour
  const DOWNLOAD_TTL = 60 * 60 * 1000;
  setInterval(() => {
    const now = Date.now();
    for (const [id, dl] of downloads) {
      if ((dl.state === 'completed' || dl.state === 'failed') &&
          (now - dl.startTime) >= DOWNLOAD_TTL) {
        downloads.delete(id);
      }
    }
  }, 5 * 60 * 1000);

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

  // ==========================================
  // Asar Hot-Update System
  // ==========================================
  setTimeout(() => checkForAsarUpdate(), 3000);
  ipcMain.handle('check-for-updates', () => checkForAsarUpdate());

// ==========================================
// Asar Hot-Update Functions
// ==========================================

function isNewerVersion(latest, current) {
  const l = latest.split('.').map(Number);
  const c = current.split('.').map(Number);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    if ((l[i] || 0) > (c[i] || 0)) return true;
    if ((l[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

function checkForAsarUpdate() {
  const request = net.request('https://api.github.com/repos/Kovy97/slime_browser/releases/latest');
  request.setHeader('Accept', 'application/vnd.github+json');
  request.setHeader('User-Agent', 'SlimeBrowser/' + pkg.version);

  let body = '';
  request.on('response', (response) => {
    response.on('data', (chunk) => { body += chunk.toString(); });
    response.on('end', () => {
      try {
        const release = JSON.parse(body);
        const latest = release.tag_name?.replace(/^v/, '');
        if (!latest || !isNewerVersion(latest, pkg.version)) return;

        const asarAsset = release.assets?.find(a => a.name === 'app.asar');
        if (!asarAsset) {
          console.log('[Slime Updater] No app.asar in release, skipping');
          return;
        }

        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Update verfügbar',
          message: `Slime Browser ${latest} ist verfügbar! (Aktuell: ${pkg.version})`,
          detail: 'Das Update wird im Hintergrund heruntergeladen und beim Neustart angewendet.',
          buttons: ['Jetzt updaten', 'Später'],
          defaultId: 0,
        }).then(({ response: btn }) => {
          if (btn === 0) downloadAsarUpdate(asarAsset.browser_download_url, latest);
        });
      } catch (e) {
        console.log('[Slime Updater] Check failed:', e.message);
      }
    });
  });
  request.on('error', () => { /* no internet */ });
  request.end();
}

function downloadAsarUpdate(url, version) {
  const updateDir = path.join(app.getPath('userData'), 'pending-update');
  if (!fs.existsSync(updateDir)) fs.mkdirSync(updateDir, { recursive: true });

  const tempPath = path.join(updateDir, 'app.asar');
  const versionPath = path.join(updateDir, 'version.txt');
  const file = fs.createWriteStream(tempPath);

  mainWindow?.webContents.send('update-status', { status: 'downloading', version });

  const request = net.request(url);
  request.on('response', (response) => {
    // Handle GitHub redirect
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      file.close();
      const redirectUrl = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location;
      downloadAsarUpdate(redirectUrl, version);
      return;
    }

    const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
    let receivedBytes = 0;

    response.on('data', (chunk) => {
      file.write(chunk);
      receivedBytes += chunk.length;
      if (totalBytes > 0) {
        const percent = Math.round((receivedBytes / totalBytes) * 100);
        mainWindow?.webContents.send('update-status', { status: 'progress', percent, version });
      }
    });

    response.on('end', () => {
      file.end(() => {
        fs.writeFileSync(versionPath, version, 'utf-8');
        console.log(`[Slime Updater] Downloaded v${version} app.asar (${receivedBytes} bytes)`);

        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Update bereit',
          message: `Slime Browser ${version} wurde heruntergeladen.`,
          detail: 'Jetzt neu starten um das Update anzuwenden?',
          buttons: ['Jetzt neu starten', 'Beim nächsten Start'],
          defaultId: 0,
        }).then(({ response: btn }) => {
          if (btn === 0) applyUpdateAndRestart();
        });
      });
    });
  });
  request.on('error', (err) => {
    file.close();
    console.log('[Slime Updater] Download failed:', err.message);
  });
  request.end();
}

function applyUpdateAndRestart() {
  const updateDir = path.join(app.getPath('userData'), 'pending-update');
  const newAsar = path.join(updateDir, 'app.asar');

  if (!fs.existsSync(newAsar)) return;

  // The app.asar is inside resources/ next to the executable
  const resourcesDir = path.join(path.dirname(app.getPath('exe')), 'resources');
  const targetAsar = path.join(resourcesDir, 'app.asar');
  const exePath = app.getPath('exe');

  // Write a PowerShell update script that runs after app exits
  const scriptPath = path.join(updateDir, 'update.ps1');
  const script = `
Start-Sleep -Seconds 2
try {
  Copy-Item -Path '${newAsar.replace(/'/g, "''")}' -Destination '${targetAsar.replace(/'/g, "''")}' -Force
  Remove-Item -Path '${updateDir.replace(/'/g, "''")}' -Recurse -Force
  Start-Process '${exePath.replace(/'/g, "''")}'
} catch {
  # If copy fails (e.g. permissions), try with elevation
  Start-Process powershell -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -Command \\"Copy-Item -Path '${newAsar.replace(/'/g, "''")}' -Destination '${targetAsar.replace(/'/g, "''")}' -Force; Remove-Item -Path '${updateDir.replace(/'/g, "''")}' -Recurse -Force; Start-Process '${exePath.replace(/'/g, "''")}'\\""
}
`;
  fs.writeFileSync(scriptPath, script, 'utf-8');

  // Launch the updater script detached, then quit
  const child = execFile('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  app.quit();
}

// Apply pending update on startup (if previous graceful update didn't trigger)
function applyPendingUpdate() {
  const updateDir = path.join(app.getPath('userData'), 'pending-update');
  const newAsar = path.join(updateDir, 'app.asar');
  if (!fs.existsSync(newAsar)) return false;

  try {
    const resourcesDir = path.join(path.dirname(app.getPath('exe')), 'resources');
    const targetAsar = path.join(resourcesDir, 'app.asar');
    fs.copyFileSync(newAsar, targetAsar);
    fs.rmSync(updateDir, { recursive: true, force: true });
    console.log('[Slime Updater] Applied pending update on startup');
    return true;
  } catch (e) {
    console.log('[Slime Updater] Could not apply pending update:', e.message);
    return false;
  }
}

app.on('window-all-closed', () => app.quit());

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
