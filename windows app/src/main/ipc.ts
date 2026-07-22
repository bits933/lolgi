import { app, ipcMain, dialog, BrowserWindow, shell } from 'electron';
import {
  ACTION_EXECUTE,
  ACTION_GET_DIAGNOSTICS,
  BUILD_IDENTITY_GET,
  DIAGNOSTICS_GET_RECENT,
  DIAGNOSTICS_COPY_LAST,
  OVERLAY_CLOSE,
  OVERLAY_ANIMATION_COMPLETE,
  SYSTEM_GET_STATE,
  CONFIG_GET,
  CONFIG_SET_HOTKEY,
  CONFIG_SET_LABEL_SIZE,
  CONFIG_SET_RING_SIZE,
  CONFIG_SET_THEME,
  CONFIG_SET_LAUNCH_AT_STARTUP,
  CONFIG_SET_HARDWARE_ACCELERATION,
  CONFIG_SET_RING_ENABLED,
  CONFIG_SET_TRIGGER_MODE,
  GRAPHICS_STATUS_GET,
  APP_RELAUNCH,
  PRIVACY_POLICY_OPEN,
  DIALOG_PICK_FILE,
  DIALOG_PICK_FOLDER,
  PROFILE_V2_SAVE,
  PROFILE_V2_ADD,
  PROFILE_V2_REMOVE,
  PROFILE_V2_SET_GLOBAL,
  DASHBOARD_SET_DIRTY,
  DASHBOARD_CLOSE_APPROVE,
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
  ForegroundWindowTarget,
  LabelSize,
  RingProfile,
  RingSize,
  ThemeConfig,
} from '../shared/types';
import { ACTION_CATALOG } from '../shared/actionCatalog';
import { APP_ACTION_CATALOG } from '../shared/defaultProfiles';
import { dispatchAction, getSystemState } from './actions/index';
import { requiresForegroundInput } from './actions/system';
import {
  getConfig,
  setHotkey,
  setLabelSize,
  setRingSize,
  setTheme,
  setLaunchAtStartup,
  setHardwareAcceleration,
  setRingEnabled,
  setTriggerMode,
  saveProfile,
  addProfile,
  removeProfile,
  setSelectedGlobalProfile,
} from './store';
import {
  getGraphicsAccelerationStatus,
  waitForGraphicsAccelerationStatus,
} from './hardwareAcceleration';
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

type IpcSource = 'overlay' | 'dashboard';

const KNOWN_ACTION_TYPES = new Set([
  ...ACTION_CATALOG.map((definition) => definition.actionType),
  ...APP_ACTION_CATALOG.map((definition) => definition.actionType),
]);
const RING_SIZES = new Set<RingSize>(['small', 'medium', 'large']);
const LABEL_SIZES = new Set<LabelSize>(['small', 'medium', 'large']);
const THEME_MODES = new Set<ThemeConfig['mode']>(['system', 'light', 'dark', 'custom']);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const PRIVACY_POLICY_URL = 'https://github.com/bits933/lolgi/blob/main/PRIVACY.txt';

function expectedWindow(source: IpcSource): BrowserWindow | null {
  return source === 'overlay' ? getOverlayWindow() : getDashboardWindow();
}

function assertIpcSender(
  event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
  source: IpcSource,
  channel: string
): void {
  const expected = expectedWindow(source);
  if (
    !expected
    || expected.isDestroyed()
    || event.sender.id !== expected.webContents.id
  ) {
    throw new Error(`[IPC_SENDER_REJECTED] ${channel}`);
  }
}

function handleFrom(
  channel: string,
  source: IpcSource,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertIpcSender(event, source, channel);
    return listener(event, ...args);
  });
}

function onFrom(
  channel: string,
  source: IpcSource,
  listener: (event: Electron.IpcMainEvent, ...args: any[]) => void
): void {
  ipcMain.on(channel, (event, ...args) => {
    try {
      assertIpcSender(event, source, channel);
    } catch (error) {
      console.warn(`[ipc] Rejected one-way message on ${channel}:`, error);
      return;
    }
    listener(event, ...args);
  });
}

function requireString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new TypeError(`${name} must be a non-empty string no longer than ${maxLength} characters.`);
  }
  return value;
}

function assertActionExecutePayload(value: unknown): asserts value is ActionExecutePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Action payload must be an object.');
  }
  const payload = value as Partial<ActionExecutePayload>;
  requireString(payload.bubbleId, 'Bubble ID', 160);
  if (typeof payload.actionType !== 'string' || !KNOWN_ACTION_TYPES.has(payload.actionType)) {
    throw new TypeError('Action type is not supported.');
  }
  if (payload.definitionId !== undefined) requireString(payload.definitionId, 'Definition ID', 160);
  if (payload.ringSessionId !== undefined) requireString(payload.ringSessionId, 'Ring session ID', 100);
  if (payload.payload !== undefined && (typeof payload.payload !== 'string' || payload.payload.length > 65_536)) {
    throw new TypeError('Action data must be a string no longer than 65536 characters.');
  }
  if (payload.keepOpen !== undefined && typeof payload.keepOpen !== 'boolean') {
    throw new TypeError('keepOpen must be a boolean.');
  }
  if (payload.parameters !== undefined) {
    if (!payload.parameters || typeof payload.parameters !== 'object' || Array.isArray(payload.parameters)) {
      throw new TypeError('Action parameters must be an object.');
    }
    const entries = Object.entries(payload.parameters);
    if (entries.length > 64 || entries.some(([key, entry]) => (
      !key
      || key.length > 100
      || !['string', 'number', 'boolean'].includes(typeof entry)
      || (typeof entry === 'string' && entry.length > 8_192)
      || (typeof entry === 'number' && !Number.isFinite(entry))
    ))) {
      throw new TypeError('Action parameters are invalid.');
    }
  }
}

function assertTheme(value: unknown): asserts value is ThemeConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Theme must be an object.');
  }
  const theme = value as Partial<ThemeConfig>;
  if (
    !theme.mode
    || !THEME_MODES.has(theme.mode)
    || typeof theme.accentColor !== 'string'
    || !HEX_COLOR.test(theme.accentColor)
    || typeof theme.bubbleColor !== 'string'
    || !HEX_COLOR.test(theme.bubbleColor)
  ) {
    throw new TypeError('Theme settings are invalid.');
  }
}

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

function rejectStaleAction(
  payload: ActionExecutePayload,
  target: ForegroundWindowTarget | null
): ActionResult {
  return addRejectedActionDiagnostic(payload, {
    status: 'target_unavailable',
    success: false,
    error: 'The ring session is no longer active.',
    message: 'The ring session is no longer active.',
  }, target);
}

export function registerIpcHandlers(): void {
  // ---------------------------------------------------------------------------
  // Overlay → Main
  // ---------------------------------------------------------------------------

  handleFrom(ACTION_EXECUTE, 'overlay', async (_event, payload: unknown) => {
    assertActionExecutePayload(payload);
    const overlay = getOverlayWindow();
    const overlayVisible = Boolean(overlay && !overlay.isDestroyed() && overlay.isVisible());
    const restoreBounds = !payload.keepOpen && overlayVisible ? overlay!.getBounds() : null;
    const needsTarget = requiresForegroundInput(payload.actionType);
    const sessionIsCurrent = isRingSessionCurrent(payload.ringSessionId);
    const sessionTarget = getRingSessionTarget(payload.ringSessionId);

    // The preload attaches the opaque ID from ring:open. Reject delayed renderer
    // work from a previous ring before it can launch anything or synthesize input.
    if (!sessionIsCurrent) {
      return rejectStaleAction(payload, sessionTarget);
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

    // A second hotkey can replace the ring session while the focus handoff is
    // awaiting Windows. Revalidate at the last possible point so an old click
    // can never dispatch to the window captured by a superseded ring.
    if (!isRingSessionCurrent(payload.ringSessionId)) {
      if (
        yieldForegroundFocus
        && payload.keepOpen
        && overlay
        && !overlay.isDestroyed()
        && overlay.isVisible()
      ) {
        overlay.setFocusable(true);
        overlay.focus();
      }
      releaseBlurDismissal?.();
      return rejectStaleAction(payload, sessionTarget);
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

  handleFrom(ACTION_GET_DIAGNOSTICS, 'overlay', () => getRecentActionResults());
  handleFrom(BUILD_IDENTITY_GET, 'dashboard', () => getRuntimeBuildIdentity());
  handleFrom(DIAGNOSTICS_GET_RECENT, 'dashboard', () => getRecentDiagnosticEvents());
  handleFrom(DIAGNOSTICS_COPY_LAST, 'dashboard', () => copyLastCorrelatedDiagnostic());

  onFrom(OVERLAY_CLOSE, 'overlay', (_event, ringSessionId?: unknown) => {
    if (ringSessionId !== undefined && typeof ringSessionId !== 'string') return;
    const closeIsCurrent = isRingSessionCurrent(ringSessionId);
    endRingSession(ringSessionId);
    if (closeIsCurrent && ringSessionId) {
      scheduleOverlayHideFallback(ringSessionId);
    }
  });

  onFrom(OVERLAY_ANIMATION_COMPLETE, 'overlay', (_event, ringSessionId?: unknown) => {
    if (ringSessionId !== undefined && typeof ringSessionId !== 'string') return;
    endRingSession(ringSessionId);
    completeOverlayClose(ringSessionId);
  });

  handleFrom(SYSTEM_GET_STATE, 'overlay', async () => {
    return await getSystemState();
  });

  // ---------------------------------------------------------------------------
  // Dashboard → Main
  // ---------------------------------------------------------------------------

  handleFrom(CONFIG_GET, 'dashboard', () => {
    return getConfig();
  });

  handleFrom(CONFIG_SET_HOTKEY, 'dashboard', (_event, hotkey: unknown) => {
    const validatedHotkey = requireString(hotkey, 'Hotkey', 100);
    const success = registerHotkey(validatedHotkey);
    if (success) setHotkey(validatedHotkey);
    updateTrayMenu();
    return { success };
  });

  handleFrom(CONFIG_SET_RING_SIZE, 'dashboard', (_event, ringSize: unknown) => {
    if (typeof ringSize !== 'string' || !RING_SIZES.has(ringSize as RingSize)) {
      throw new TypeError('Ring size is invalid.');
    }
    setRingSize(ringSize as RingSize);
    return { success: true };
  });

  handleFrom(CONFIG_SET_LABEL_SIZE, 'dashboard', (_event, labelSize: unknown) => {
    if (typeof labelSize !== 'string' || !LABEL_SIZES.has(labelSize as LabelSize)) {
      throw new TypeError('Label size is invalid.');
    }
    setLabelSize(labelSize as LabelSize);
    return { success: true };
  });

  handleFrom(CONFIG_SET_THEME, 'dashboard', (_event, theme: unknown) => {
    assertTheme(theme);
    setTheme(theme);
    return { success: true };
  });

  handleFrom(CONFIG_SET_LAUNCH_AT_STARTUP, 'dashboard', (_event, value: unknown) => {
    if (typeof value !== 'boolean') throw new TypeError('Launch-at-startup preference must be a boolean.');
    setLaunchAtStartup(value);
    app.setLoginItemSettings({ openAtLogin: value, path: process.execPath });
    return { success: true };
  });

  handleFrom(CONFIG_SET_HARDWARE_ACCELERATION, 'dashboard', (_event, value: unknown) => {
    if (typeof value !== 'boolean') {
      throw new TypeError('Hardware acceleration preference must be a boolean.');
    }
    setHardwareAcceleration(value);
    return getGraphicsAccelerationStatus(value);
  });

  handleFrom(GRAPHICS_STATUS_GET, 'dashboard', async () => {
    await waitForGraphicsAccelerationStatus(getConfig().hardwareAcceleration);
    return getGraphicsAccelerationStatus(getConfig().hardwareAcceleration);
  });

  handleFrom(APP_RELAUNCH, 'dashboard', () => {
    app.relaunch();
    app.exit(0);
  });

  handleFrom(PRIVACY_POLICY_OPEN, 'dashboard', async () => {
    await shell.openExternal(PRIVACY_POLICY_URL);
  });

  handleFrom(CONFIG_SET_RING_ENABLED, 'dashboard', (_event, value: unknown) => {
    if (typeof value !== 'boolean') throw new TypeError('Ring enabled preference must be a boolean.');
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

  handleFrom(CONFIG_SET_TRIGGER_MODE, 'dashboard', (_event, value: unknown) => {
    if (value !== 'A' && value !== 'B') throw new TypeError('Trigger mode must be A or B.');
    setTriggerMode(value);
    return { success: true };
  });

  handleFrom(DIALOG_PICK_FILE, 'dashboard', async (event) => {
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

  handleFrom(DIALOG_PICK_FOLDER, 'dashboard', async (event) => {
    const allWindows = require('electron').BrowserWindow.getAllWindows() as Electron.BrowserWindow[];
    const win = allWindows.find((w) => w.webContents.id === event.sender.id) ?? null;
    const result = await dialog.showOpenDialog(win ?? allWindows[0], {
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  handleFrom(PROFILE_V2_SAVE, 'dashboard', (_event, profile: RingProfile) => saveProfile(profile));
  handleFrom(PROFILE_V2_ADD, 'dashboard', (_event, profile: RingProfile) => addProfile(profile));
  handleFrom(PROFILE_V2_REMOVE, 'dashboard', (_event, id: unknown) => removeProfile(requireString(id, 'Profile ID', 160)));
  handleFrom(PROFILE_V2_SET_GLOBAL, 'dashboard', (_event, id: unknown) => {
    if (id !== null && typeof id !== 'string') throw new TypeError('Global profile ID is invalid.');
    if (typeof id === 'string') requireString(id, 'Global profile ID', 160);
    return setSelectedGlobalProfile(id as string | null);
  });

  onFrom(DASHBOARD_SET_DIRTY, 'dashboard', (_event, value: unknown) => {
    if (typeof value !== 'boolean') return;
    setDashboardDirty(value);
  });

  onFrom(DASHBOARD_CLOSE_APPROVE, 'dashboard', () => {
    approveDashboardClose();
  });

  // ---------------------------------------------------------------------------
  // App Detection (Dashboard → Main)
  // ---------------------------------------------------------------------------

  handleFrom(APP_DETECT_FOREGROUND, 'dashboard', async () => {
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

  handleFrom(APP_LIST_RUNNING, 'dashboard', async () => {
    return await listRunningApps();
  });

  handleFrom(APP_LIST_INSTALLED, 'dashboard', async () => {
    return await listInstalledApps();
  });

  handleFrom(APP_LIST_ALL, 'dashboard', async () => {
    return await listAllApps();
  });

  handleFrom(APP_EXTRACT_ICON, 'dashboard', async (_event, path: unknown) => {
    return await extractAppIcon(requireString(path, 'Application path', 32_768));
  });

  handleFrom(APP_FETCH_URL_ICON, 'dashboard', async (_event, url: unknown) => {
    return await fetchUrlIcon(requireString(url, 'URL', 8_192));
  });
}
