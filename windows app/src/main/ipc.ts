import { app, ipcMain, dialog, BrowserWindow } from 'electron';
import {
  ACTION_EXECUTE,
  ACTION_GET_DIAGNOSTICS,
  BUILD_IDENTITY_GET,
  DIAGNOSTICS_GET_RECENT,
  DIAGNOSTICS_COPY_LAST,
  OVERLAY_CLOSE,
  OVERLAY_ANIMATION_COMPLETE,
  SYSTEM_GET_STATE,
  CONFIG_GET_BUBBLES,
  CONFIG_GET,
  CONFIG_SET_HOTKEY,
  CONFIG_SET_LABEL_SIZE,
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
import type {
  ActionExecutePayload,
  ActionResult,
  AppProfile,
  BubbleConfig,
  ForegroundWindowTarget,
  LabelSize,
  RingProfile,
  RingSize,
  ThemeConfig,
} from '../shared/types';
import { dispatchAction, getSystemState } from './actions/index';
import { requiresForegroundInput } from './actions/system';
import {
  getConfig,
  setHotkey,
  setLabelSize,
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
import {
  approveDashboardClose,
  completeOverlayClose,
  getDashboardWindow,
  getOverlayWindow,
  hideOverlay,
  scheduleOverlayHideFallback,
  setDashboardDirty,
  showOverlay,
  suppressOverlayBlurDismissal,
} from './windows';
import { registerHotkey, unregisterHotkey } from './globalShortcut';
import { updateTrayMenu } from './tray';
import { getForegroundApp, listRunningApps, listInstalledApps, listAllApps, setForegroundPollingBusy } from './utils/foregroundApp';
import { extractAppIcon } from './utils/appIcon';
import { fetchUrlIcon } from './utils/urlIcon';
import {
  copyLastCorrelatedDiagnostic,
  getRecentActionResults,
  getRecentDiagnosticEvents,
  recordActionResult,
} from './actions/diagnostics';
import { getRuntimeBuildIdentity } from './buildIdentity';
import {
  endRingSession,
  getRingSessionTarget,
  isRingSessionCurrent,
} from './profileRuntime';

/**
 * Milliseconds to let Windows re-activate the app beneath the ring after we make
 * the overlay non-focusable, before we synthesize input into it. The overlay
 * grabs keyboard focus when it opens (`showOverlay` calls `.focus()`), so every
 * action that types into the app under it must hand that focus back first. This
 * is the value the wheel-driven adjustment path has always used successfully.
 */
const FOREGROUND_HANDOFF_MS = 45;

function addRejectedActionDiagnostic(
  payload: ActionExecutePayload,
  result: ActionResult,
  target: ForegroundWindowTarget | null
): ActionResult {
  const event = recordActionResult(payload.actionType, result, 0, {
    correlationId: payload.ringSessionId,
    phase: 'rejected-before-dispatch',
    definitionId: payload.definitionId,
    bubbleId: payload.bubbleId,
    target: target
      ? {
          hwnd: target.windowHandle,
          pid: target.processId,
          processName: target.processName,
          executablePath: target.executablePath,
        }
      : undefined,
  });
  const diagnosticId = event.eventId.slice(0, 8);
  return {
    ...result,
    diagnosticId,
    message: `${result.message ?? result.error ?? 'The action was rejected.'} Diagnostic ${diagnosticId}.`,
  };
}

export function registerIpcHandlers(): void {
  // ---------------------------------------------------------------------------
  // Overlay → Main
  // ---------------------------------------------------------------------------

  ipcMain.handle(ACTION_EXECUTE, async (_event, payload: ActionExecutePayload) => {
    const overlay = getOverlayWindow();
    const overlayVisible = Boolean(overlay && !overlay.isDestroyed() && overlay.isVisible());
    const restoreBounds = !payload.keepOpen && overlayVisible ? overlay!.getBounds() : null;
    const needsTarget = requiresForegroundInput(payload.actionType);
    const sessionIsCurrent = isRingSessionCurrent(payload.ringSessionId);
    const sessionTarget = getRingSessionTarget(payload.ringSessionId);

    // The preload attaches the opaque ID from ring:open. Reject delayed renderer
    // work from a previous ring before it can launch anything or synthesize input.
    if (!sessionIsCurrent) {
      const staleResult: ActionResult = {
        status: 'target_unavailable',
        success: false,
        error: 'The ring session is no longer active.',
        message: 'The ring session is no longer active.',
      };
      return addRejectedActionDiagnostic(payload, staleResult, sessionTarget);
    }
    if (needsTarget && !sessionTarget) {
      const unavailableResult: ActionResult = {
        status: 'target_unavailable',
        success: false,
        error: 'The application window captured when the ring opened is unavailable.',
        message: 'The application window captured when the ring opened is unavailable.',
      };
      return addRejectedActionDiagnostic(payload, unavailableResult, sessionTarget);
    }
    // Any action that types into the app under the ring must first hand keyboard
    // focus back to that app — the overlay stole it on open. Use the one hand-off
    // that reliably works for BOTH keep-open adjustments and one-shot clicks: make
    // the ring non-focusable (Windows re-activates the previously-active app),
    // wait a beat for that hand-off to settle, and only then send input.
    //
    // The old one-shot path instead hid the ring and raced its `blur` event,
    // dispatching before the target app was actually foreground again — so
    // click-triggered shortcuts like Figma's Ctrl+G (group) were silently
    // dropped, while wheel-driven zoom (which never takes focus) still worked.
    const yieldForegroundFocus = Boolean(overlay && overlayVisible && requiresForegroundInput(payload.actionType));

    let releaseBlurDismissal: (() => void) | null = null;
    try {
      if (yieldForegroundFocus && overlay) {
        releaseBlurDismissal = suppressOverlayBlurDismissal();
        overlay.setFocusable(false);
        await new Promise((resolve) => setTimeout(resolve, FOREGROUND_HANDOFF_MS));
        if (restoreBounds) {
          // One-shot action: focus is now on the target app. Dismiss the ring; the
          // hidden, non-focused overlay does not pull focus back off that app.
          hideOverlay();
          overlay.setFocusable(true); // ready to grab focus again on the next open
        }
        // Safety net: if any Action Ring window still holds focus, the synthesized
        // keystroke would land on us instead of the target app. Nudge focus off it
        // and give the OS a moment more before dispatch.
        const stillFocused = BrowserWindow.getFocusedWindow();
        if (stillFocused) {
          stillFocused.blur();
          await new Promise((resolve) => setTimeout(resolve, FOREGROUND_HANDOFF_MS));
        }
      } else if (restoreBounds) {
        // Non-keyboard action (launch, URL, file…): the ring can go immediately.
        hideOverlay();
      }
    } catch (error) {
      releaseBlurDismissal?.();
      throw error;
    }

    setForegroundPollingBusy(true);
    const result = await dispatchAction(payload, { target: sessionTarget }).finally(() => {
      setForegroundPollingBusy(false);
      // Keep-open adjustments: return focus to the still-visible ring so it keeps
      // receiving input for the next wheel tick or click.
      if (yieldForegroundFocus && payload.keepOpen && overlay && !overlay.isDestroyed() && overlay.isVisible()) {
        overlay.setFocusable(true);
        overlay.focus();
      }
      releaseBlurDismissal?.();
    });
    if (restoreBounds && !result.success) {
      showOverlay(restoreBounds.x, restoreBounds.y, restoreBounds.width);
    }
    return result;
  });

  ipcMain.handle(ACTION_GET_DIAGNOSTICS, () => getRecentActionResults());
  ipcMain.handle(BUILD_IDENTITY_GET, () => getRuntimeBuildIdentity());
  ipcMain.handle(DIAGNOSTICS_GET_RECENT, () => getRecentDiagnosticEvents());
  ipcMain.handle(DIAGNOSTICS_COPY_LAST, () => copyLastCorrelatedDiagnostic());

  ipcMain.on(OVERLAY_CLOSE, (_event, ringSessionId?: string) => {
    const closeIsCurrent = isRingSessionCurrent(ringSessionId);
    endRingSession(ringSessionId);
    if (closeIsCurrent && ringSessionId) {
      scheduleOverlayHideFallback(ringSessionId);
    }
  });

  ipcMain.on(OVERLAY_ANIMATION_COMPLETE, (_event, ringSessionId?: string) => {
    endRingSession(ringSessionId);
    completeOverlayClose(ringSessionId);
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

  ipcMain.handle(CONFIG_SET_LABEL_SIZE, (_event, labelSize: LabelSize) => {
    setLabelSize(labelSize);
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
    return { success: true };
  });

  ipcMain.handle(CONFIG_UPDATE_BUBBLE, (_event, { id, patch }: { id: string; patch: Partial<BubbleConfig> }) => {
    updateBubble(id, patch);
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
