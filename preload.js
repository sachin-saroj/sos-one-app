/* ═══════════════════════════════════════════════════════════
   SOS ONE — PRELOAD SCRIPT (Context Bridge)
   Secure bridge between Electron main process and renderer
   ═══════════════════════════════════════════════════════════ */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Expose a safe, limited API to the renderer process.
 * This avoids enabling nodeIntegration while still giving
 * the renderer access to native capabilities.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // Native notifications
  notifyAlertSent: (data) => ipcRenderer.send('sos:alert-sent', data),

  // Open URLs in system browser
  openExternal: (url) => ipcRenderer.send('open:external', url),

  // Platform info
  platform: process.platform,
  isElectron: true
});
