const { app, BrowserWindow, ipcMain, session, Menu } = require('electron');
const path = require('path');
const { setupAdblocker } = require('./adblocker/engine');
const { getYouTubeScript } = require('./youtube/inject');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'browser', 'ui', 'index.html'));

  // Hide default menu
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

app.whenReady().then(async () => {
  // Setup adblocker on the session used by webviews
  const webviewSession = session.fromPartition('persist:slime');
  await setupAdblocker(webviewSession, (count) => {
    blockedCount += count;
    mainWindow?.webContents.send('blocked-count-updated', blockedCount);
  });

  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
