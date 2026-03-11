const { app, BrowserWindow, ipcMain, session, Menu, shell, safeStorage, dialog, net, clipboard, Notification, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const originalFs = require('original-fs');
const { setupAdblocker } = require('./adblocker/engine');
const { getYouTubeScript } = require('./youtube/inject');
const { setupEmail } = require('./email/client');
const { execFile, spawn } = require('child_process');
const crypto = require('crypto');
const os = require('os');
const pkg = require('../package.json');

// Catch uncaught exceptions from network libs (e.g. ImapFlow ECONNRESET)
// to prevent Electron from showing fatal error dialogs
process.on('uncaughtException', (err) => {
  const ignorable = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'];
  if (ignorable.some(code => err.message?.includes(code) || err.code === code)) {
    console.log('[Slime] Ignored network error:', err.message);
    return;
  }
  console.error('[Slime] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || String(reason);
  const ignorable = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'];
  if (ignorable.some(code => msg.includes(code))) {
    console.log('[Slime] Ignored unhandled rejection:', msg);
    return;
  }
  console.error('[Slime] Unhandled rejection:', reason);
});

// ==========================================
// IPC Input Validation Helpers
// ==========================================

function validateString(val, maxLen = 2048) {
  return typeof val === 'string' && val.length <= maxLen;
}
function validateUrl(val) {
  if (!validateString(val, 4096)) return false;
  try { new URL(val); return true; } catch { return false; }
}
function validateSettings(settings) {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return null;
  const clean = {};
  const allowed = ['searchEngine', 'customSearchUrl', 'homepage', 'sessionRestore', 'cookieAutoDismiss', 'accentColor', 'bgColor', 'bgOpacity', 'glassMorphism', 'startupPages'];
  for (const key of allowed) {
    if (key in settings) clean[key] = settings[key];
  }
  if (clean.accentColor && !/^#[0-9a-fA-F]{6}$/.test(clean.accentColor)) delete clean.accentColor;
  if (clean.bgColor && !/^#[0-9a-fA-F]{6}$/.test(clean.bgColor)) delete clean.bgColor;
  if (clean.bgOpacity != null) clean.bgOpacity = Math.max(30, Math.min(100, Number(clean.bgOpacity) || 100));
  return clean;
}

// Chromium performance flags (must be set before app.whenReady)
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');  // Enable WebGL on all GPUs
// NOTE: disable-background-networking and disable-component-update removed
// — they are bot indicators that trigger Cloudflare and Google detection

// Anti-bot detection: remove navigator.webdriver flag
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

// ==========================================
// Single Instance & URL Handling (default browser support)
// ==========================================

function getUrlFromArgs(args) {
  for (const arg of args) {
    if (arg.startsWith('http://') || arg.startsWith('https://')) {
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
  if (mainWindow && !mainWindow.isDestroyed()) {
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
    jsonCache.set(filename, result);
    return result;
  }
}

function writeJSON(filename, data) {
  jsonCache.set(filename, data);
  try {
    fs.writeFileSync(dataPath(filename), JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`[Slime] Failed to write ${filename}:`, err.message);
  }
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
  cookieAutoDismiss: true,
  homepage: 'slime://newtab',
  zoomLevel: 100,
  accentColor: '#4ade80',
  bgColor: '#0c0c0c',
  bgOpacity: 100,
  glassMorphism: false,
  startupPages: [],
};

function loadSettings() {
  const data = readJSON('settings.json', {});
  return { ...DEFAULT_SETTINGS, ...data };
}

ipcMain.handle('settings-get', () => loadSettings());
ipcMain.handle('settings-save', (_, settings) => {
  const clean = validateSettings(settings);
  if (!clean) return loadSettings();
  writeJSON('settings.json', clean);
  return { ...DEFAULT_SETTINGS, ...clean };
});

// ==========================================
// Session Restore (debounced save)
// ==========================================

const debouncedSaveSession = debounce((tabsData) => {
  writeJSON('session.json', tabsData);
}, 500);

ipcMain.on('save-session', (_, tabsData) => {
  if (!Array.isArray(tabsData)) return;
  const clean = tabsData.filter(t => t && typeof t === 'object' && typeof t.url === 'string');
  debouncedSaveSession(clean);
});
ipcMain.handle('load-session', () => {
  const data = readJSON('session.json', []);
  if (!Array.isArray(data)) return [];
  return data.filter(t => t && typeof t === 'object' && typeof t.url === 'string');
});

// ==========================================
// History
// ==========================================

ipcMain.handle('history-add', (_, entry) => {
  if (!entry || typeof entry !== 'object') return false;
  if (!validateString(entry.url, 4096) || !validateString(entry.title, 1024)) return false;
  const history = readJSON('history.json', []);
  history.unshift({ url: entry.url, title: entry.title, timestamp: Date.now() });
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
  if (!bookmark || typeof bookmark !== 'object') return readJSON('bookmarks.json', []);
  if (!validateUrl(bookmark.url) || !validateString(bookmark.title, 1024)) return readJSON('bookmarks.json', []);
  const bookmarks = readJSON('bookmarks.json', []);
  if (bookmarks.some(b => b.url === bookmark.url)) return bookmarks;
  bookmarks.unshift({ url: bookmark.url, title: bookmark.title, timestamp: Date.now() });
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
  console.warn('[Slime] Encryption unavailable - password not saved securely');
  return '__UNENCRYPTED__' + Buffer.from(password).toString('base64');
}

function decryptPassword(encrypted) {
  if (typeof encrypted === 'string' && encrypted.startsWith('__UNENCRYPTED__')) {
    return Buffer.from(encrypted.slice(15), 'base64').toString('utf-8');
  }
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch (e) {
      return encrypted;
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
  if (!entry || typeof entry !== 'object') return false;
  if (!validateUrl(entry.url)) return false;
  if (!validateString(entry.username, 255)) return false;
  if (!validateString(entry.password, 1024)) return false;
  const passwords = readJSON('passwords.json', []);
  const encryptedEntry = { url: entry.url, username: entry.username, password: encryptPassword(entry.password) };
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
  if (!Array.isArray(macros) || macros.length > 50) return readJSON('macros.json', []);
  const clean = macros.filter(m =>
    m && typeof m === 'object' &&
    validateString(m.name, 256) &&
    Array.isArray(m.steps)
  );
  writeJSON('macros.json', clean);
  return clean;
});

// Tab preview capture
ipcMain.handle('capture-tab', async (_, webContentsId) => {
  try {
    const wc = webContents.fromId(webContentsId);
    if (!wc || wc.isDestroyed() || wc.getType() !== 'webview') return null;
    const image = await wc.capturePage();
    const resized = image.resize({ width: 300 });
    return resized.toDataURL();
  } catch (e) { return null; }
});

// ==========================================
// Notes
// ==========================================

ipcMain.handle('notes-get', () => {
  const notes = readJSON('notes.json', []);
  return notes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
});

ipcMain.handle('notes-save', (_, note) => {
  if (!note || typeof note !== 'object') return false;
  if (note.title && !validateString(note.title, 1024)) return false;
  if (note.content && !validateString(note.content, 50000)) return false;
  const notes = readJSON('notes.json', []);
  const now = Date.now();
  const id = note.id || crypto.randomUUID();
  const idx = notes.findIndex(n => n.id === id);
  const entry = {
    id,
    title: note.title || '',
    content: note.content || '',
    createdAt: idx >= 0 ? notes[idx].createdAt : now,
    updatedAt: now,
    reminder: note.reminder || null,
  };
  if (idx >= 0) {
    notes[idx] = entry;
  } else {
    notes.unshift(entry);
  }
  writeJSON('notes.json', notes);
  return entry;
});

ipcMain.handle('notes-delete', (_, id) => {
  if (!id || typeof id !== 'string') return false;
  const notes = readJSON('notes.json', []).filter(n => n.id !== id);
  writeJSON('notes.json', notes);
  return true;
});

// Paths (internal-only: returns preload path for webview setup, not exposed to web content)
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

  mainWindow.on('closed', () => { mainWindow = null; });

  let pendingUrlTimer = null;
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
    // Open URL from command line args (default browser)
    if (pendingUrl) {
      pendingUrlTimer = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('open-url', pendingUrl);
        }
        pendingUrl = null;
        pendingUrlTimer = null;
      }, 500);
    }
  });

  mainWindow.on('close', () => {
    if (pendingUrlTimer) {
      clearTimeout(pendingUrlTimer);
      pendingUrlTimer = null;
    }
  });

  mainWindow.on('maximize', () => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('window-state', 'maximized');
  });

  mainWindow.on('unmaximize', () => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('window-state', 'normal');
  });

  // Forward keyboard shortcuts to renderer even when webview has focus
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const shift = input.shift;
    const alt = input.alt;
    const key = input.key.toLowerCase();

    let handled = false;

    if (ctrl && !shift && key === 't') handled = true;  // New tab
    if (ctrl && !shift && key === 'w') handled = true;  // Close tab
    if (ctrl && !shift && key === 'l') handled = true;  // Focus URL bar
    if (ctrl && !shift && key === 'f') handled = true;  // Find
    if (ctrl && !shift && key === 'd') handled = true;  // Bookmark
    if (ctrl && !shift && key === 'r') handled = true;  // Reload
    if (ctrl && shift && key === 'n') handled = true;   // Incognito
    if (ctrl && shift && key === 't') handled = true;   // Reopen closed tab
    if (!ctrl && !alt && key === 'f5') handled = true;  // Reload
    if (alt && !ctrl && key === 'arrowleft') handled = true;  // Back
    if (alt && !ctrl && key === 'arrowright') handled = true; // Forward
    if (ctrl && key === 'tab') handled = true;           // Tab cycling
    if (ctrl && !shift && /^[1-9]$/.test(key)) handled = true; // Tab 1-9

    if (handled) {
      event.preventDefault();
      mainWindow.webContents.send('shortcut', { key, ctrl, shift, alt });
    }
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

// Google Login — Firefox-UA BrowserWindow.
// Google blocks Chromium-embedded browsers but cannot detect a spoofed Firefox,
// because there are no Chromium-specific JS APIs to fingerprint.
// Uses a SEPARATE session partition for the login window so the Firefox UA +
// removed Client Hints don't conflict with the main webview session's header hooks.
// After login, cookies are copied to the main persist:slime session.
let googleLoginWin = null;
ipcMain.handle('open-google-login', async (_, url) => {
  if (!validateUrl(url)) return;
  if (googleLoginWin && !googleLoginWin.isDestroyed()) {
    googleLoginWin.focus();
    return;
  }

  const firefoxUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0';

  // Use a separate session for login so Firefox UA settings don't affect main browsing
  const loginSession = session.fromPartition('persist:slime-login');
  loginSession.setUserAgent(firefoxUA);

  // Remove ALL Chromium Client Hints — Firefox never sends these
  loginSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    const chHints = Object.keys(headers).filter(k => k.toLowerCase().startsWith('sec-ch-'));
    for (const h of chHints) delete headers[h];
    callback({ requestHeaders: headers });
  });

  googleLoginWin = new BrowserWindow({
    width: 500,
    height: 700,
    parent: mainWindow,
    modal: false,
    icon: path.join(__dirname, '..', 'Slime1.ico'),
    title: 'Google Sign-In',
    webPreferences: {
      partition: 'persist:slime-login',
      // contextIsolation OFF intentionally - login-preload.js needs direct DOM access
      // to override navigator properties for Firefox disguise (Google login detection).
      // sandbox OFF for the same reason. nodeIntegration remains OFF for safety.
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'browser', 'ui', 'login-preload.js'),
    },
  });

  googleLoginWin.setMenuBarVisibility(false);
  googleLoginWin.webContents.loadURL(url);

  // When login finishes, copy Google cookies to main session and close
  googleLoginWin.webContents.on('did-navigate', async (_, navUrl) => {
    try {
      const host = new URL(navUrl).hostname;
      if (!host.includes('accounts.google.com') &&
          !host.includes('accounts.youtube.com') &&
          !host.includes('myaccount.google.com') &&
          !host.includes('gds.google.com') &&
          !host.includes('consent.google.com')) {
        // Copy all Google/YouTube cookies to the main session
        const mainSession = session.fromPartition('persist:slime');
        const domains = ['.google.com', '.youtube.com', '.googlevideo.com', '.gstatic.com', '.googleapis.com'];
        for (const domain of domains) {
          const cookies = await loginSession.cookies.get({ domain });
          for (const cookie of cookies) {
            const cookieObj = {
              url: `https://${cookie.domain.replace(/^\./, '')}${cookie.path || '/'}`,
              name: cookie.name,
              value: cookie.value,
              domain: cookie.domain,
              path: cookie.path,
              secure: cookie.secure,
              httpOnly: cookie.httpOnly,
              sameSite: cookie.sameSite || 'no_restriction',
            };
            if (cookie.expirationDate) cookieObj.expirationDate = cookie.expirationDate;
            try { await mainSession.cookies.set(cookieObj); } catch (e) {}
          }
        }
        setTimeout(() => {
          if (googleLoginWin && !googleLoginWin.isDestroyed()) {
            googleLoginWin.close();
          }
        }, 500);
      }
    } catch (e) {}
  });

  googleLoginWin.on('closed', () => {
    googleLoginWin = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('google-login-complete', url);
    }
  });
});

// Context menu for webviews
ipcMain.on('show-context-menu', (_, params) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { x, y, linkURL, srcURL, pageURL, selectionText, isEditable, mediaType } = params || {};

  const template = [];

  // Link options
  if (linkURL) {
    template.push(
      { label: 'Open Link in New Tab', click: () => mainWindow?.webContents.send('context-action', { action: 'open-link-new-tab', url: linkURL }) },
      { label: 'Copy Link Address', click: () => clipboard.writeText(linkURL) },
      { type: 'separator' }
    );
  }

  // Image options
  if (mediaType === 'image' && srcURL) {
    template.push(
      { label: 'Open Image in New Tab', click: () => mainWindow?.webContents.send('context-action', { action: 'open-link-new-tab', url: srcURL }) },
      { label: 'Copy Image Address', click: () => clipboard.writeText(srcURL) },
      { type: 'separator' }
    );
  }

  // Text selection
  if (selectionText) {
    template.push(
      { label: 'Copy', click: () => mainWindow?.webContents.send('context-action', { action: 'copy' }) },
      { label: `Search "${selectionText.substring(0, 30)}${selectionText.length > 30 ? '...' : ''}"`, click: () => mainWindow?.webContents.send('context-action', { action: 'search', text: selectionText }) },
      { type: 'separator' }
    );
  }

  // Editable field options
  if (isEditable) {
    template.push(
      { label: 'Cut', click: () => mainWindow?.webContents.send('context-action', { action: 'cut' }) },
      { label: 'Copy', click: () => mainWindow?.webContents.send('context-action', { action: 'copy' }) },
      { label: 'Paste', click: () => mainWindow?.webContents.send('context-action', { action: 'paste' }) },
      { label: 'Select All', click: () => mainWindow?.webContents.send('context-action', { action: 'select-all' }) },
      { type: 'separator' }
    );
  }

  // Navigation
  template.push(
    { label: 'Back', click: () => mainWindow?.webContents.send('context-action', { action: 'back' }) },
    { label: 'Forward', click: () => mainWindow?.webContents.send('context-action', { action: 'forward' }) },
    { label: 'Reload', click: () => mainWindow?.webContents.send('context-action', { action: 'reload' }) },
    { type: 'separator' }
  );

  // Developer tools
  template.push(
    { label: 'Inspect Element', click: () => mainWindow?.webContents.send('context-action', { action: 'inspect', x, y }) },
    { label: 'Open DevTools', click: () => mainWindow?.webContents.send('context-action', { action: 'devtools' }) }
  );

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: mainWindow });
});

// Adblocker stats
let blockedCount = 0;
ipcMain.handle('get-blocked-count', () => blockedCount);
ipcMain.handle('get-app-version', () => pkg.version);

// System info (RAM usage)
// Use PowerShell to get actual Private Bytes (matches Task Manager)
let cachedSlimeMB = Math.round(process.memoryUsage().rss / (1024 * 1024));
let psFailCount = 0;

const slimeProcessName = path.basename(process.execPath, '.exe');

function refreshSlimeMemory() {
  execFile('powershell.exe', [
    '-NoProfile', '-NoLogo', '-Command',
    `[math]::Round((Get-Process '${slimeProcessName}' -EA 0 | Measure-Object PM -Sum).Sum / 1MB)`
  ], { timeout: 5000 }, (err, stdout) => {
    if (!err && stdout.trim()) {
      cachedSlimeMB = parseInt(stdout.trim()) || cachedSlimeMB;
      psFailCount = 0;
    } else {
      psFailCount++;
    }
  });
}

refreshSlimeMemory();
setInterval(() => {
  if (psFailCount < 3) {
    refreshSlimeMemory();
  }
}, 10000);
// Slower fallback interval for when PowerShell is repeatedly failing
setInterval(() => {
  if (psFailCount >= 3) {
    refreshSlimeMemory();
  }
}, 60000);

ipcMain.handle('get-system-info', () => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    slimeMB: cachedSlimeMB,
    systemUsedMB: Math.round((totalMem - freeMem) / (1024 * 1024)),
    systemTotalMB: Math.round(totalMem / (1024 * 1024)),
  };
});
ipcMain.on('increment-blocked', () => {
  blockedCount++;
  mainWindow?.webContents.send('blocked-count-updated', blockedCount);
});

// YouTube script injection
ipcMain.handle('get-youtube-script', () => getYouTubeScript());

// Open external URL (protocol-restricted)
ipcMain.handle('open-external', (_, url) => {
  if (!url || typeof url !== 'string') return;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return;
    shell.openExternal(url);
  } catch (e) { /* invalid URL */ }
});

// Download management (restricted to safe directories)
ipcMain.handle('download-open', (_, filePath) => {
  if (!filePath || typeof filePath !== 'string') return;
  const resolved = path.resolve(filePath);
  const validDirs = [app.getPath('downloads'), app.getPath('userData'), app.getPath('desktop')];
  if (!validDirs.some(dir => resolved.startsWith(dir))) return { error: 'Invalid path' };
  return shell.openPath(resolved);
});
ipcMain.handle('download-show', (_, filePath) => {
  if (!filePath || typeof filePath !== 'string') return;
  const resolved = path.resolve(filePath);
  const validDirs = [app.getPath('downloads'), app.getPath('userData'), app.getPath('desktop')];
  if (!validDirs.some(dir => resolved.startsWith(dir))) return { error: 'Invalid path' };
  shell.showItemInFolder(resolved);
});

// ==========================================
// App Lifecycle
// ==========================================

app.whenReady().then(async () => {
  try {
    // Apply pending asar update from previous download (before anything else)
    applyPendingUpdate();

    const webviewSession = session.fromPartition('persist:slime');

    // Set Chrome user-agent so Google/YouTube trust the browser
    const chromeVersion = process.versions.chrome;
    const chromeMajor = chromeVersion.split('.')[0];
    const chromeUA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    webviewSession.setUserAgent(chromeUA);

    // NOTE: Sec-CH-UA header override is now in adblocker/engine.js (merged into
    // the single onBeforeSendHeaders handler to avoid Electron replacing it)

    // Anti-detection script injected into EVERY webview's main world via main process.
    // This is the most reliable method — it bypasses contextIsolation entirely because
    // executeJavaScript always runs in the main world from the main process.
    const antiDetectionScript = `(function() {
      if (window.__slimeAntiDetect) return;
      window.__slimeAntiDetect = true;

      // navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });

      // window.chrome (real Chrome always has this)
      if (!window.chrome) window.chrome = {};
      if (!window.chrome.runtime) window.chrome.runtime = { connect: function(){}, sendMessage: function(){} };
      if (!window.chrome.csi) window.chrome.csi = function() { return {}; };
      if (!window.chrome.loadTimes) window.chrome.loadTimes = function() { return {}; };

      // navigator.plugins
      var pd = { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' };
      var fp = {
        length: 5,
        0: { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: pd.description, length: 1, 0: pd, item: function(i){return this[i]||null}, namedItem: function(){return pd} },
        1: { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1, 0: pd, item: function(i){return this[i]||null}, namedItem: function(){return pd} },
        2: { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 0, item: function(){return null}, namedItem: function(){return null} },
        3: { name: 'Chromium PDF Plugin', filename: 'internal-pdf-viewer', description: pd.description, length: 1, 0: pd, item: function(i){return this[i]||null}, namedItem: function(){return pd} },
        4: { name: 'Chromium PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1, 0: pd, item: function(i){return this[i]||null}, namedItem: function(){return pd} },
        item: function(i) { return this[i] || null; },
        namedItem: function(n) { for (var i=0;i<this.length;i++) if(this[i].name===n) return this[i]; return null; },
        refresh: function() {}
      };
      Object.defineProperty(navigator, 'plugins', { get: function() { return fp; }, configurable: true });

      // navigator.mimeTypes
      var fm = {
        length: 2,
        0: { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: fp[0] },
        1: { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: fp[1] },
        item: function(i) { return this[i] || null; },
        namedItem: function(n) { for (var i=0;i<this.length;i++) if(this[i].type===n) return this[i]; return null; }
      };
      Object.defineProperty(navigator, 'mimeTypes', { get: function() { return fm; }, configurable: true });

      // navigator.userAgentData
      var cm = '${chromeMajor}';
      var cv = '${chromeVersion}';
      var uad = {
        brands: [
          { brand: 'Google Chrome', version: cm },
          { brand: 'Chromium', version: cm },
          { brand: 'Not_A Brand', version: '24' }
        ],
        mobile: false,
        platform: 'Windows',
        getHighEntropyValues: function() {
          return Promise.resolve({
            brands: this.brands, mobile: false, platform: 'Windows',
            platformVersion: '15.0.0', architecture: 'x86', bitness: '64',
            model: '', uaFullVersion: cv,
            fullVersionList: [
              { brand: 'Google Chrome', version: cv },
              { brand: 'Chromium', version: cv },
              { brand: 'Not_A Brand', version: '24.0.0.0' }
            ]
          });
        },
        toJSON: function() { return { brands: this.brands, mobile: this.mobile, platform: this.platform }; }
      };
      Object.defineProperty(navigator, 'userAgentData', { get: function() { return uad; }, configurable: true });

      // navigator.languages
      if (!navigator.languages || navigator.languages.length === 0) {
        Object.defineProperty(navigator, 'languages', { get: function() { return ['de-DE','de','en-US','en']; }, configurable: true });
      }

      // Clean UA string
      var ua = navigator.userAgent;
      var cleanUA = ua.replace(/\\s*Electron\\/[\\d.]+/g, '').replace(/\\s*SlimeBrowser\\/[\\d.]+/g, '');
      if (cleanUA !== ua) {
        Object.defineProperty(navigator, 'userAgent', { get: function() { return cleanUA; }, configurable: true });
        Object.defineProperty(navigator, 'appVersion', { get: function() { return cleanUA.replace('Mozilla/',''); }, configurable: true });
      }

      // Permissions API fix
      var origQuery = navigator.permissions && navigator.permissions.query && navigator.permissions.query.bind(navigator.permissions);
      if (origQuery) {
        navigator.permissions.query = function(p) {
          if (p.name === 'notifications') return Promise.resolve({ state: Notification.permission, onchange: null });
          return origQuery(p);
        };
      }
    })();`;

    // Helper: inject anti-detection into a frame and all its children recursively
    function injectAllFrames(mainFrame) {
      try {
        mainFrame.executeJavaScript(antiDetectionScript).catch(() => {});
        for (const child of mainFrame.frames) {
          injectAllFrames(child);
        }
      } catch (e) {}
    }

    // Inject into every webview — ALL frames including Cloudflare Turnstile iframes
    // Also intercept window.open / target="_blank" to open in new tab instead of popup
    app.on('web-contents-created', (_, contents) => {
      if (contents.getType() === 'webview') {
        // Intercept popups: open in new tab instead of a separate window
        contents.setWindowOpenHandler(({ url }) => {
          if (url && url !== 'about:blank') {
            mainWindow?.webContents.send('open-url-new-tab', url);
          }
          return { action: 'deny' };
        });

        // Inject into main frame at navigation start
        contents.on('did-start-navigation', (event, url, isInPlace, isMainFrame) => {
          if (isMainFrame) {
            contents.executeJavaScript(antiDetectionScript).catch(() => {});
          }
        });

        // Inject into ALL frames (main + child iframes like Turnstile) at dom-ready
        contents.on('dom-ready', () => {
          try { injectAllFrames(contents.mainFrame); } catch (e) {}
        });

        // Inject into new iframes as they finish loading (catches Turnstile iframe)
        contents.on('did-frame-finish-load', (event, isMainFrame) => {
          try { injectAllFrames(contents.mainFrame); } catch (e) {}
        });

        // Also catch frames created after initial load (lazy-loaded Turnstile)
        contents.on('frame-created', (event, details) => {
          // Small delay to let the frame initialize its JS context
          setTimeout(() => {
            try { injectAllFrames(contents.mainFrame); } catch (e) {}
          }, 100);
        });
      }
    });

    // HTTP Basic/Digest Auth popup
    let authRequestId = 0;
    app.on('login', (event, webContents, details, authInfo, callback) => {
      event.preventDefault();
      if (!mainWindow) return callback();
      const requestId = ++authRequestId;
      mainWindow.webContents.send('auth-request', {
        url: details.url,
        host: authInfo.host,
        realm: authInfo.realm,
        scheme: authInfo.scheme,
        requestId,
      });
      ipcMain.once(`auth-response-${requestId}`, (_, response) => {
        if (response && response.username) {
          callback(response.username, response.password);
        } else {
          callback();
        }
      });
    });

    await setupAdblocker(webviewSession, (count) => {
      blockedCount += count;
      mainWindow?.webContents.send('blocked-count-updated', blockedCount);
    }, { chromeMajor, chromeVersion });

    // Incognito session — ephemeral (no persist: prefix), with adblocker + anti-detection
    const incognitoSession = session.fromPartition('incognito');
    incognitoSession.setUserAgent(chromeUA);
    await setupAdblocker(incognitoSession, (count) => {
      blockedCount += count;
      mainWindow?.webContents.send('blocked-count-updated', blockedCount);
    }, { chromeMajor, chromeVersion });

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

    // Also handle downloads from incognito session
    incognitoSession.on('will-download', (event, item) => {
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

    // Notes reminder check (every 30 seconds)
    setInterval(() => {
      const notes = readJSON('notes.json', []);
      const now = Date.now();
      let changed = false;
      for (const note of notes) {
        if (note.reminder && note.reminder <= now) {
          const notif = new Notification({
            title: 'Reminder: ' + (note.title || 'Note'),
            body: note.content?.substring(0, 100) || '',
            icon: path.join(__dirname, '..', 'Slime1.ico'),
          });
          notif.show();
          notif.on('click', () => {
            const w = mainWindow;
            if (w) { w.show(); w.focus(); }
          });
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('note-reminder', { id: note.id, title: note.title });
          }
          note.reminder = null;
          changed = true;
        }
      }
      if (changed) writeJSON('notes.json', notes);
    }, 30000);

    // Email client (IMAP/SMTP)
    setupEmail(ipcMain, encryptPassword, decryptPassword, readJSON, writeJSON, dataPath, () => mainWindow);

    // ==========================================
    // Asar Hot-Update System
    // ==========================================
    setTimeout(() => checkForAsarUpdate(), 3000);
    ipcMain.handle('check-for-updates', () => checkForAsarUpdate());
  } catch (err) {
    console.error('[Slime] Fatal error during app initialization:', err);
  }
});

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
  console.log('[Slime Updater] Checking for updates... (current: ' + pkg.version + ')');
  const request = net.request('https://api.github.com/repos/Kovy97/slime_browser/releases/latest');
  request.setHeader('Accept', 'application/vnd.github+json');
  request.setHeader('User-Agent', 'SlimeBrowser');

  let body = '';
  request.on('response', (response) => {
    console.log('[Slime Updater] GitHub API response:', response.statusCode);
    response.on('data', (chunk) => { body += chunk.toString(); });
    response.on('end', () => {
      try {
        const release = JSON.parse(body);
        const latest = release.tag_name?.replace(/^v/, '');
        console.log('[Slime Updater] Latest version:', latest, '| Current:', pkg.version, '| Newer:', latest ? isNewerVersion(latest, pkg.version) : 'N/A');
        if (!latest || !isNewerVersion(latest, pkg.version)) return;

        const asarAsset = release.assets?.find(a => a.name === 'app.asar');
        if (!asarAsset) {
          console.log('[Slime Updater] No app.asar in release, skipping');
          return;
        }

        const dialogOpts = {
          type: 'info',
          title: 'Update verfügbar',
          message: `Slime Browser ${latest} ist verfügbar! (Aktuell: ${pkg.version})`,
          detail: 'Das Update wird im Hintergrund heruntergeladen und beim Neustart angewendet.',
          buttons: ['Jetzt updaten', 'Später'],
          defaultId: 0,
        };
        const dialogPromise = mainWindow ? dialog.showMessageBox(mainWindow, dialogOpts) : dialog.showMessageBox(dialogOpts);
        dialogPromise.then(({ response: btn }) => {
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

function downloadAsarUpdate(url, version, maxRedirects = 5) {
  const updateDir = path.join(app.getPath('userData'), 'pending-update');
  if (!fs.existsSync(updateDir)) fs.mkdirSync(updateDir, { recursive: true });

  const tempPath = path.join(updateDir, 'app.asar');
  const versionPath = path.join(updateDir, 'version.txt');
  const file = originalFs.createWriteStream(tempPath);

  mainWindow?.webContents.send('update-status', { status: 'downloading', version });

  const request = net.request(url);
  request.on('response', (response) => {
    // Handle GitHub redirect
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      file.close();
      if (maxRedirects <= 0) {
        console.log('[Slime Updater] Too many redirects, aborting update');
        fs.unlink(tempPath, () => {});
        return;
      }
      const redirectUrl = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location;
      downloadAsarUpdate(redirectUrl, version, maxRedirects - 1);
      return;
    }

    const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
    const MAX_UPDATE_SIZE = 10 * 1024 * 1024; // 10MB
    if (totalBytes > MAX_UPDATE_SIZE) {
      file.close();
      fs.unlink(tempPath, () => {});
      console.log('[Slime Updater] Update too large, skipping');
      return;
    }
    let receivedBytes = 0;
    let aborted = false;

    response.on('data', (chunk) => {
      if (aborted) return;
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_UPDATE_SIZE) {
        aborted = true;
        response.destroy();
        file.close(() => {
          fs.unlink(tempPath, () => {});
        });
        console.log('[Slime Updater] Update too large during download, skipping');
        return;
      }
      file.write(chunk);
      if (totalBytes > 0) {
        const percent = Math.round((receivedBytes / totalBytes) * 100);
        mainWindow?.webContents.send('update-status', { status: 'progress', percent, version });
      }
    });

    response.on('end', () => {
      if (aborted) return;
      file.end(() => {
        fs.writeFileSync(versionPath, version, 'utf-8');
        // Log SHA256 checksum for integrity verification
        try {
          const fileData = originalFs.readFileSync(tempPath);
          const hash = crypto.createHash('sha256').update(fileData).digest('hex');
          console.log(`[Slime Updater] Downloaded v${version} app.asar (${receivedBytes} bytes, SHA256: ${hash})`);
        } catch (e) {
          console.log(`[Slime Updater] Downloaded v${version} app.asar (${receivedBytes} bytes, checksum unavailable)`);
        }

        const dialogOpts = {
          type: 'info',
          title: 'Update bereit',
          message: `Slime Browser ${version} wurde heruntergeladen.`,
          detail: 'Jetzt neu starten um das Update anzuwenden?',
          buttons: ['Jetzt neu starten', 'Beim nächsten Start'],
          defaultId: 0,
        };
        const dialogPromise = mainWindow ? dialog.showMessageBox(mainWindow, dialogOpts) : dialog.showMessageBox(dialogOpts);
        dialogPromise.then(({ response: btn }) => {
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

  if (!originalFs.existsSync(newAsar)) return;

  // The app.asar is inside resources/ next to the executable
  const resourcesDir = path.join(path.dirname(app.getPath('exe')), 'resources');
  const targetAsar = path.join(resourcesDir, 'app.asar');
  const exePath = app.getPath('exe');

  // Write a batch update script that runs after app exits
  const scriptPath = path.join(updateDir, 'update.cmd');
  const logPath = path.join(updateDir, 'update.log');
  const script = `@echo off\r
echo [%date% %time%] Update starting... > "${logPath}"\r
timeout /t 3 /nobreak > nul\r
echo [%date% %time%] Copying asar... >> "${logPath}"\r
copy /Y "${newAsar}" "${targetAsar}" >> "${logPath}" 2>&1\r
if errorlevel 1 (\r
  echo [%date% %time%] Copy failed, retrying... >> "${logPath}"\r
  timeout /t 2 /nobreak > nul\r
  copy /Y "${newAsar}" "${targetAsar}" >> "${logPath}" 2>&1\r
)\r
echo [%date% %time%] Starting browser... >> "${logPath}"\r
start "" "${exePath}"\r
echo [%date% %time%] Cleaning up... >> "${logPath}"\r
del "${newAsar}" 2>nul\r
del "${path.join(updateDir, 'version.txt')}" 2>nul\r
`;
  originalFs.writeFileSync(scriptPath, script, 'utf-8');

  // Launch the updater script detached, then quit
  const child = spawn('cmd.exe', ['/c', scriptPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  app.quit();
}

// Apply pending update on startup (if previous graceful update didn't trigger)
function applyPendingUpdate() {
  const updateDir = path.join(app.getPath('userData'), 'pending-update');
  const newAsar = path.join(updateDir, 'app.asar');
  if (!originalFs.existsSync(newAsar)) return false;

  try {
    const resourcesDir = path.join(path.dirname(app.getPath('exe')), 'resources');
    const targetAsar = path.join(resourcesDir, 'app.asar');
    originalFs.copyFileSync(newAsar, targetAsar);
    originalFs.rmSync(updateDir, { recursive: true, force: true });
    console.log('[Slime Updater] Applied pending update on startup');
    return true;
  } catch (e) {
    console.log('[Slime Updater] Could not apply pending update:', e.message);
    return false;
  }
}

app.on('before-quit', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('force-save-session'); } catch(e) {}
  }
});

app.on('window-all-closed', () => app.quit());

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
