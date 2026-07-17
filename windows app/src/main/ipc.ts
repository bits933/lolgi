import { app, ipcMain, dialog } from 'electron';
import {
  ACTION_EXECUTE,
  ACTION_GET_DIAGNOSTICS,
  OVERLAY_CLOSE,
  OVERLAY_OUTSIDE_CLICK,
  OVERLAY_ANIMATION_COMPLETE,
  SYSTEM_GET_STATE,
  CONFIG_GET_BUBBLES,
  CONFIG_GET,
  CONFIG_SET_HOTKEY,
  CONFIG_SET_RING_SIZE,
  CONFIG_SET_THEME,
  CONFIG_SET_LAUNCH_AT_STARTUP,
  CONFIG_SET_RING_ENABLED,
  CONFIG_SET_TRIGGER_MODE,
  CONFIG_SET_BUBBLES,
  CONFIG_UPDATE_BUBBLE,
  CONFIG_ADD_BUBBLE,
  CONFIG_REMOVE_BUBBLE,
  CONFIG_REORDER_BUBBLES,
  DIALOG_PICK_FILE,
  DIALOG_PICK_FOLDER,
  PROFILE_V2_SAVE,
  PROFILE_V2_ADD,
  PROFILE_V2_REMOVE,
  PROFILE_V2_SET_GLOBAL,
  DASHBOARD_SET_DIRTY,
  DASHBOARD_CLOSE_APPROVE,
  CONFIG_UPDATED,
  PROFILE_GET_ALL,
  PROFILE_ADD,
  PROFILE_UPDATE,
  PROFILE_REMOVE,
  PROFILE_SET_BUBBLES,
  PROFILE_UPDATE_BUBBLE,
  PROFILE_ADD_BUBBLE,
  PROFILE_REMOVE_BUBBLE,
  APP_DETECT_FOREGROUND,
  APP_LIST_RUNNING,
  APP_LIST_INSTALLED,
  APP_LIST_ALL,
  APP_EXTRACT_ICON,
  APP_FETCH_URL_ICON,
} from '../shared/ipcChannels';
import type { ActionExecutePayload, AppProfile, BubbleConfig, RingProfile, RingSize, ThemeConfig } from '../shared/types';
import { dispatchAction, getSystemState } from './actions/index';
import { requiresForegroundInput } from './actions/system';
import {
  getConfig,
  setHotkey,
  setRingSize,
  setTheme,
  setLaunchAtStartup,
  setRingEnabled,
  setTriggerMode,
  setBubbles,
  updateBubble,
  addBubble,
  removeBubble,
  reorderBubbles,
  getAppProfiles,
  addAppProfile,
  updateAppProfile,
  removeAppProfile,
  setProfileBubbles,
  updateProfileBubble,
  addProfileBubble,
  removeProfileBubble,
  saveProfile,
  addProfile,
  removeProfile,
  setSelectedGlobalProfile,
} from './store';
import { approveDashboardClose, completeOverlayClose, dismissOverlayFromOutsideClick, hideOverlay, getDashboardWindow, getOverlayWindow, scheduleOverlayHideFallback, setDashboardDirty, showOverlay } from './windows';
import { registerHotkey, unregisterHotkey } from './globalShortcut';
import { updateTrayMenu } from './tray';
import { getForegroundApp, listRunningApps, listInstalledApps, listAllApps, setForegroundPollingBusy } from './utils/foregroundApp';
import { extractAppIcon } from './utils/appIcon';
import { fetchUrlIcon } from './utils/urlIcon';
import { getRecentActionResults } from './actions/diagnostics';

/**
 * Hide the overlay and wait for Windows to actually hand keyboard focus back to
 * the app beneath it, instead of guessing a fixed delay. A fixed delay that's
 * too short on a slower machine dispatches the action before focus has really
 * moved, so the input is lost or the now-invisible overlay keeps holding focus.
 * `blur` fires as soon as the OS completes the handoff; the timeout is only a
 * safety net for when the overlay never held focus to begin with.
 */
function hideOverlayAndWaitForBlur(overlay: Electron.BrowserWindow | null): Promise<void> {
  return new Promise((resolve) => {
    if (!overlay || overlay.isDestroyed() || !overlay.isFocused()) {
      hideOverlay();
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(safety);
      resolve();
    };
    overlay.once('blur', finish);
    const safety = setTimeout(finish, 150);
    hideOverlay();
  });
}

export function registerIpcHandlers(): void {
  // ---------------------------------------------------------------------------
  // Overlay → Main
  // ---------------------------------------------------------------------------

  ipcMain.handle(ACTION_EXECUTE, async (_event, payload: ActionExecutePayload) => {
    const overlay = getOverlayWindow();
    const restoreBounds = !payload.keepOpen && overlay?.isVisible() ? overlay.getBounds() : null;
    const requiresForegroundFocus = requiresForegroundInput(payload.actionType) ||
      ['keyboard-shortcut', 'keyboard-sequence'].includes(payload.actionType);
    const needsForegroundFocus = Boolean(payload.keepOpen && overlay?.isVisible() && requiresForegroundFocus);
    if (restoreBounds) {
      if (requiresForegroundFocus) {
        await hideOverlayAndWaitForBlur(overlay);
      } else {
        // Non-keyboard actions can begin immediately once the overlay is gone.
        // Their dispatch does not depend on Windows assigning focus elsewhere.
        hideOverlay();
      }
    } else if (needsForegroundFocus && overlay) {
      // Keep the ring visible while returning keyboard input to the target app.
      overlay.setFocusable(false);
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
    setForegroundPollingBusy(true);
    const result = await dispatchAction(payload).finally(() => {
      setForegroundPollingBusy(false);
      if (needsForegroundFocus && overlay && !overlay.isDestroyed() && overlay.isVisible()) {
        overlay.setFocusable(true);
        overlay.focus();
      }
    });
    if (restoreBounds && !result.success) {
      showOverlay(restoreBounds.x, restoreBounds.y, restoreBounds.width);
    }
    return result;
  });

  ipcMain.handle(ACTION_GET_DIAGNOSTICS, () => getRecentActionResults());

  ipcMain.on(OVERLAY_CLOSE, () => {
    scheduleOverlayHideFallback();
  });

  ipcMain.on(OVERLAY_OUTSIDE_CLICK, () => {
    dismissOverlayFromOutsideClick();
  });

  ipcMain.on(OVERLAY_ANIMATION_COMPLETE, () => {
    completeOverlayClose();
  });

  ipcMain.handle(SYSTEM_GET_STATE, async () => {
    return await getSystemState();
  });

  ipcMain.handle(CONFIG_GET_BUBBLES, () => {
    return getConfig().bubbles;
  });

  // ---------------------------------------------------------------------------
  // Dashboard → Main
  // ---------------------------------------------------------------------------

  ipcMain.handle(CONFIG_GET, () => {
    return getConfig();
  });

  ipcMain.handle(CONFIG_SET_HOTKEY, (_event, hotkey: string) => {
    const success = registerHotkey(hotkey);
    if (success) setHotkey(hotkey);
    updateTrayMenu();
    return { success };
  });

  ipcMain.handle(CONFIG_SET_RING_SIZE, (_event, ringSize: RingSize) => {
    setRingSize(ringSize);
    return { success: true };
  });

  ipcMain.handle(CONFIG_SET_THEME, (_event, theme: ThemeConfig) => {
    setTheme(theme);
    return { success: true };
  });

  ipcMain.handle(CONFIG_SET_LAUNCH_AT_STARTUP, (_event, value: boolean) => {
    setLaunchAtStartup(value);
    app.setLoginItemSettings({ openAtLogin: value });
    return { success: true };
  });

  ipcMain.handle(CONFIG_SET_RING_ENABLED, (_event, value: boolean) => {
    if (value) {
      const success = registerHotkey();
      if (!success) return { success: false };
    } else {
      unregisterHotkey();
    }
    setRingEnabled(value);
    updateTrayMenu();
    return { success: true };
  });

  ipcMain.handle(CONFIG_SET_TRIGGER_MODE, (_event, value: 'A' | 'B') => {
    setTriggerMode(value);
    return { success: true };
  });

  ipcMain.handle(CONFIG_SET_BUBBLES, (_event, bubbles: BubbleConfig[]) => {
    setBubbles(bubbles);
    // Notify overlay if it is open
    const overlay = getOverlayWindow();
    if (overlay && overlay.isVisible()) {
      overlay.webContents.send(CONFIG_UPDATED, bubbles);
    }
    return { success: true };
  });

  ipcMain.handle(CONFIG_UPDATE_BUBBLE, (_event, { id, patch }: { id: string; patch: Partial<BubbleConfig> }) => {
    updateBubble(id, patch);
    const overlay = getOverlayWindow();
    if (overlay && overlay.isVisible()) {
      overlay.webContents.send(CONFIG_UPDATED, getConfig().bubbles);
    }
    return { success: true };
  });

  ipcMain.handle(CONFIG_ADD_BUBBLE, (_event, bubble: BubbleConfig) => {
    addBubble(bubble);
    return { success: true };
  });

  ipcMain.handle(CONFIG_REMOVE_BUBBLE, (_event, id: string) => {
    removeBubble(id);
    return { success: true };
  });

  ipcMain.handle(CONFIG_REORDER_BUBBLES, (_event, orderedIds: string[]) => {
    reorderBubbles(orderedIds);
    return { success: true };
  });

  ipcMain.handle(DIALOG_PICK_FILE, async (event) => {
    const allWindows = require('electron').BrowserWindow.getAllWindows() as Electron.BrowserWindow[];
    const win = allWindows.find((w) => w.webContents.id === event.sender.id) ?? null;
    const result = await dialog.showOpenDialog(win ?? allWindows[0], {
      properties: ['openFile'],
      filters: [
        { name: 'Applications', extensions: ['exe', 'lnk', 'bat', 'cmd'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle(DIALOG_PICK_FOLDER, async (event) => {
    const allWindows = require('electron').BrowserWindow.getAllWindows() as Electron.BrowserWindow[];
    const win = allWindows.find((w) => w.webContents.id === event.sender.id) ?? null;
    const result = await dialog.showOpenDialog(win ?? allWindows[0], {
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle(PROFILE_V2_SAVE, (_event, profile: RingProfile) => saveProfile(profile));
  ipcMain.handle(PROFILE_V2_ADD, (_event, profile: RingProfile) => addProfile(profile));
  ipcMain.handle(PROFILE_V2_REMOVE, (_event, id: string) => removeProfile(id));
  ipcMain.handle(PROFILE_V2_SET_GLOBAL, (_event, id: string | null) => setSelectedGlobalProfile(id));

  ipcMain.on(DASHBOARD_SET_DIRTY, (_event, value: boolean) => {
    setDashboardDirty(value);
  });

  ipcMain.on(DASHBOARD_CLOSE_APPROVE, () => {
    approveDashboardClose();
  });

  // ---------------------------------------------------------------------------
  // Profile CRUD (Dashboard → Main)
  // ---------------------------------------------------------------------------

  ipcMain.handle(PROFILE_GET_ALL, () => {
    return getAppProfiles();
  });

  ipcMain.handle(PROFILE_ADD, (_event, profile: AppProfile) => {
    addAppProfile(profile);
    return { success: true };
  });

  ipcMain.handle(PROFILE_UPDATE, (_event, { id, patch }: { id: string; patch: Partial<AppProfile> }) => {
    updateAppProfile(id, patch);
    return { success: true };
  });

  ipcMain.handle(PROFILE_REMOVE, (_event, id: string) => {
    removeAppProfile(id);
    return { success: true };
  });

  ipcMain.handle(PROFILE_SET_BUBBLES, (_event, { profileId, bubbles }: { profileId: string; bubbles: BubbleConfig[] }) => {
    setProfileBubbles(profileId, bubbles);
    return { success: true };
  });

  ipcMain.handle(PROFILE_UPDATE_BUBBLE, (_event, { profileId, bubbleId, patch }: { profileId: string; bubbleId: string; patch: Partial<BubbleConfig> }) => {
    updateProfileBubble(profileId, bubbleId, patch);
    return { success: true };
  });

  ipcMain.handle(PROFILE_ADD_BUBBLE, (_event, { profileId, bubble }: { profileId: string; bubble: BubbleConfig }) => {
    addProfileBubble(profileId, bubble);
    return { success: true };
  });

  ipcMain.handle(PROFILE_REMOVE_BUBBLE, (_event, { profileId, bubbleId }: { profileId: string; bubbleId: string }) => {
    removeProfileBubble(profileId, bubbleId);
    return { success: true };
  });

  // ---------------------------------------------------------------------------
  // App Detection (Dashboard → Main)
  // ---------------------------------------------------------------------------

  ipcMain.handle(APP_DETECT_FOREGROUND, async () => {
    const dashboard = getDashboardWindow();
    dashboard?.hide();
    try {
      await new Promise((resolve) => setTimeout(resolve, 650));
      return await getForegroundApp();
    } finally {
      dashboard?.show();
      dashboard?.focus();
    }
  });

  ipcMain.handle(APP_LIST_RUNNING, async () => {
    return await listRunningApps();
  });

  ipcMain.handle(APP_LIST_INSTALLED, async () => {
    return await listInstalledApps();
  });

  ipcMain.handle(APP_LIST_ALL, async () => {
    return await listAllApps();
  });

  ipcMain.handle(APP_EXTRACT_ICON, async (_event, path: string) => {
    return await extractAppIcon(path);
  });

  ipcMain.handle(APP_FETCH_URL_ICON, async (_event, url: string) => {
    return await fetchUrlIcon(url);
  });
}
