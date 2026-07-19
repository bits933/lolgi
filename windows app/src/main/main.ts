import { app, BrowserWindow, dialog, Menu } from 'electron';
import { createOverlayWindow, createDashboardWindow, showDashboard } from './windows';
import { createTray } from './tray';
import { registerHotkey, unregisterAll } from './globalShortcut';
import { registerIpcHandlers } from './ipc';
import { getConfig } from './store';
import { startForegroundAppWatcher, stopForegroundAppWatcher } from './utils/foregroundApp';
import { healPersistedAppIcons } from './utils/iconHeal';
import { formatRuntimeBuildIdentity, getRuntimeBuildIdentity } from './buildIdentity';
import { flushDiagnostics, initializeDiagnostics } from './actions/diagnostics';
import { shutdownTargetedInputBroker } from './actions/keyboard';

// The app can outlive the console that launched it. Ignore only the expected
// broken-pipe error so diagnostic logging cannot crash the main process.
function handleConsoleStreamError(error: NodeJS.ErrnoException): void {
  if (error.code !== 'EPIPE') throw error;
}

process.stdout.on('error', handleConsoleStreamError);
process.stderr.on('error', handleConsoleStreamError);

// Prevent garbage collection of windows.
let overlayWindow: BrowserWindow | null = null;
let dashboardWindow: BrowserWindow | null = null;

// Flag used by windows.ts to distinguish close vs quit.
let isQuitting = false;

export function getIsQuitting(): boolean {
  return isQuitting;
}

const startupIdentity = getRuntimeBuildIdentity();
const gotLock = app.requestSingleInstanceLock({
  version: startupIdentity.version,
  gitCommit: startupIdentity.gitCommit,
  dirty: startupIdentity.dirty,
  sourceFingerprint: startupIdentity.sourceFingerprint,
  execPath: startupIdentity.execPath,
  mode: startupIdentity.mode,
});

if (!gotLock) {
  const message = [
    'Another Logi Actions Ring instance is already running and owns the global hotkey.',
    '',
    `Attempted build: ${formatRuntimeBuildIdentity(startupIdentity)}`,
    '',
    'Open the existing dashboard from the system tray or quit it before launching this build.',
  ].join('\n');
  console.warn(`[main] ${message.replace(/\n/g, ' ')}`);
  dialog.showErrorBox('Logi Actions Ring is already running', message);
  app.exit(0);
} else {
  startPrimaryInstance();
}

function startPrimaryInstance(): void {
  console.log(`[main] Logi Actions Ring starting | ${formatRuntimeBuildIdentity(startupIdentity)}`);

  app.on('second-instance', (_event, _argv, _workingDirectory, additionalData) => {
    const attempted = additionalData as Record<string, unknown>;
    const attemptedVersion = typeof attempted.version === 'string' ? attempted.version : 'unknown';
    const attemptedExecPath = typeof attempted.execPath === 'string' ? attempted.execPath : 'unknown';
    console.warn(`[main] Blocked second instance v${attemptedVersion} from ${attemptedExecPath}`);

    const wins = BrowserWindow.getAllWindows();
    const dashboard = wins.find((window) => window.webContents.getURL().includes('dashboard'));
    if (dashboard) {
      dashboard.show();
      dashboard.focus();
    }
  });

  void app.whenReady()
    .then(async () => {
      Menu.setApplicationMenu(null);
      await initializeDiagnostics(app.getPath('userData'), startupIdentity);

      // Register IPC before creating renderer windows.
      registerIpcHandlers();

      // Create every hidden application window first. Their HWNDs are registered
      // by windows.ts so the foreground watcher can always distinguish self from
      // the external application context.
      overlayWindow = createOverlayWindow();
      dashboardWindow = createDashboardWindow();

      // Warm the foreground context before any app window is shown and before
      // the global hotkey can be triggered.
      await startForegroundAppWatcher();

      createTray();
      showDashboard();

      const config = getConfig();
      if (config.ringEnabled) {
        const success = registerHotkey(config.hotkey);
        if (!success) console.warn(`[main] Failed to register hotkey: ${config.hotkey}`);
      }

      // Repair icons persisted by the old extraction path in the background.
      void healPersistedAppIcons().catch((error) => console.error('[main] Icon heal failed:', error));

      if (process.platform === 'win32') {
        app.setLoginItemSettings({
          openAtLogin: config.launchAtStartup,
          path: process.execPath,
        });
      }
    })
    .catch((error) => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error('[main] Startup failed:', message);
      dialog.showErrorBox('Logi Actions Ring could not start', message);
      app.quit();
    });

  // Keep the tray application alive when renderer windows are closed.
  app.on('window-all-closed', () => {});

  app.on('before-quit', () => {
    isQuitting = true;
    unregisterAll();
    stopForegroundAppWatcher();
    shutdownTargetedInputBroker();
    void flushDiagnostics();
  });

  app.on('will-quit', () => {
    unregisterAll();
  });
}
