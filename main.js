/* ═══════════════════════════════════════════════════════════
   SOS ONE — ELECTRON MAIN PROCESS
   Window management, system tray, native integrations
   ═══════════════════════════════════════════════════════════ */

const { app, BrowserWindow, Menu, shell, ipcMain, Notification } = require('electron');
const path = require('path');

// Keep a global reference to prevent garbage collection
let mainWindow = null;

/**
 * Create the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 700,
    minWidth: 380,
    minHeight: 600,
    maxWidth: 500,
    maxHeight: 850,
    resizable: true,
    frame: false,           // Remove default title bar for system-app feel
    transparent: false,
    backgroundColor: '#F5F5F7',
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
      devTools: process.argv.includes('--dev')
    },
    show: false,            // Don't show until ready (prevents flash)
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    center: true,
  });

  // Remove application menu entirely
  Menu.setApplicationMenu(null);

  // Load the renderer HTML
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Show window when ready (smooth launch)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Handle external links — open in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Intercept link navigation (tel:, sms:, https:)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('tel:') || url.startsWith('sms:') || url.startsWith('https:') || url.startsWith('http:')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Open devtools in dev mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* ═══ IPC HANDLERS ═══ */

// Window controls (minimize, maximize, close)
ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

// System notification for SOS alert
ipcMain.on('sos:alert-sent', (event, data) => {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: '🚨 SOS Alert Sent!',
      body: `Emergency alert sent to ${data.contactCount} contact(s). ${data.hasLocation ? 'Location included.' : 'Location unavailable.'}`,
      icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
      urgency: 'critical',
      silent: false
    });
    notification.show();
  }
});

// Open URL in system browser
ipcMain.on('open:external', (event, url) => {
  shell.openExternal(url);
});


/* ═══ APP LIFECYCLE ═══ */

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    // macOS: re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Quit on all platforms (including macOS for this utility app)
  app.quit();
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Focus existing window if user tries to open another instance
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
