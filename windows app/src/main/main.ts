import { app, BrowserWindow, Menu } from 'electron';
import { createOverlayWindow, createDashboardWindow, showDashboard } from './windows';
import { createTray } from './tray';
import { registerHotkey, unregisterAll } from './globalShortcut';
import { registerIpcHandlers } from './ipc';
import { getConfig } from './store';
import { startForegroundAppPolling, stopForegroundAppPolling } from './utils/foregroundApp';
import { healPersistedAppIcons } from './utils/iconHeal';

// The app can outlive the console that launched it. Ignore only the expected
// broken-pipe error so diagnostic logging cannot crash the main process.
function handleConsoleStreamError(error: NodeJS.ErrnoException): void {
  if (error.code !== 'EPIPE') {
    throw error;
  }
}

process.stdout.on('error', handleConsoleStreamError);
process.stderr.on('error', handleConsoleStreamError);

// Prevent garbage collection of windows
let overlayWindow: BrowserWindow | null = null;
let dashboardWindow: BrowserWindow | null = null;

// Flag used by windows.ts to distinguish close vs quit
let isQuitting = false;

export function getIsQuitting(): boolean {
  return isQuitting;
}

// Ensure single instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  // If a second instance is opened, show the dashboard
  const wins = BrowserWindow.getAllWindows();
  const dashboard = wins.find((w) => w.webContents.getURL().includes('dashboard'));
  if (dashboard) {
    dashboard.show();
    dashboard.focus();
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  // 1. Register all IPC handlers before creating windows
  registerIpcHandlers();

  // 2. Pre-create and hide overlay window (fast first-trigger)
  overlayWindow = createOverlayWindow();

  // 3. Create dashboard window (hidden until user opens settings)
  dashboardWindow = createDashboardWindow();

  // 4. Create system tray icon
  createTray();

  // 5. Show dashboard on startup so it's immediately visible
  showDashboard();

  // 5. Register global hotkey
  const config = getConfig();
  if (config.ringEnabled) {
    const success = registerHotkey(config.hotkey);
    if (!success) {
      console.warn(`[main] Failed to register hotkey: ${config.hotkey}`);
    }
  }

  // 6. Start foreground app polling for per-app profiles
  startForegroundAppPolling(1000);

  // 6b. Repair app icons persisted by the old extraction path (runs once,
  // in the background — dashboard/overlay pick the fix up on next load).
  void healPersistedAppIcons().catch((error) => console.error('[main] Icon heal failed:', error));

  // 7. Handle launch-at-startup
  if (process.platform === 'win32') {
    app.setLoginItemSettings({
      openAtLogin: config.launchAtStartup,
      path: process.execPath,
    });
  }
});

// Keep app running in tray when all windows are closed
app.on('window-all-closed', () => {
  // Intentional no-op: tray app stays alive
});

app.on('before-quit', () => {
  isQuitting = true;
  unregisterAll();
  stopForegroundAppPolling();
});

app.on('will-quit', () => {
  unregisterAll();
});
