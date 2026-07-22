import { app, ipcMain, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { UPDATE_AVAILABLE, UPDATE_INSTALL } from '../shared/ipcChannels';
import type { UpdateStatus } from '../shared/types';

// Re-check every 6 hours for long-running sessions; the first check runs on launch.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Wire up GitHub-backed auto-updates and notify the dashboard when a newer
 * release is available or downloaded. No-op in dev (unpackaged) where there is
 * no app-update.yml and electron-updater would throw.
 */
export function initAutoUpdater(dashboardWindow: BrowserWindow | null): void {
  if (!app.isPackaged) return;

  const notify = (status: UpdateStatus) => {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.webContents.send(UPDATE_AVAILABLE, status);
    }
  };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => notify({ version: info.version, downloaded: false }));
  autoUpdater.on('update-downloaded', (info) => notify({ version: info.version, downloaded: true }));
  autoUpdater.on('error', (error) => console.error('[autoUpdater]', error instanceof Error ? error.message : error));

  // ponytail: spawn-and-forget install; if quitAndInstall can't run it stays on
  // autoInstallOnAppQuit, so the update still lands on next close.
  ipcMain.on(UPDATE_INSTALL, () => autoUpdater.quitAndInstall());

  const check = () => void autoUpdater.checkForUpdates().catch((error) => {
    console.error('[autoUpdater] check failed:', error instanceof Error ? error.message : error);
  });

  check();
  const timer = setInterval(check, CHECK_INTERVAL_MS);
  app.on('before-quit', () => clearInterval(timer));
}
