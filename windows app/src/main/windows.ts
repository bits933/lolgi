import { BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { OVERLAY_WINDOW_SIZE, DASHBOARD_WIDTH, DASHBOARD_HEIGHT } from '../shared/constants';
import { DASHBOARD_CLOSE_REQUESTED, RING_CLOSE } from '../shared/ipcChannels';
import {
  registerOwnedWindowHandle,
  setForegroundPollingBusy,
  unregisterOwnedWindowHandle,
} from './utils/foregroundApp';
import { endActiveRingSession } from './profileRuntime';

let overlayWindow: BrowserWindow | null = null;
let dashboardWindow: BrowserWindow | null = null;
let overlayWindowHandle: string | null = null;
let dashboardWindowHandle: string | null = null;
let dashboardDirty = false;
let overlayHideSafetyTimer: ReturnType<typeof setTimeout> | null = null;
let pendingOverlayCloseId: string | null = null;
const overlayBlurDismissSuppressions = new Set<symbol>();
// While the ring owns the screen (and foreground focus), suspend background
// foreground polling so it cannot sample one of our own windows. Idempotent so
// unbalanced show/hide calls cannot leave polling permanently suspended.
let overlaySuspendsPolling = false;

export interface RingWindowDiagnosticState {
  overlay: {
    exists: boolean;
    visible: boolean;
    focused: boolean;
    focusable: boolean;
  };
  dashboard: {
    exists: boolean;
    visible: boolean;
    focused: boolean;
    focusable: boolean;
  };
}

function setOverlayPollingSuspended(suspended: boolean): void {
  if (suspended === overlaySuspendsPolling) return;
  overlaySuspendsPolling = suspended;
  setForegroundPollingBusy(suspended);
}

function clearOverlayHideSafetyTimer(): void {
  if (!overlayHideSafetyTimer) return;
  clearTimeout(overlayHideSafetyTimer);
  overlayHideSafetyTimer = null;
}

// ---------------------------------------------------------------------------
// Label-safe transparent overlay window, always on top
// ---------------------------------------------------------------------------

export function createOverlayWindow(): BrowserWindow {
  overlayWindow = new BrowserWindow({
    width: OVERLAY_WINDOW_SIZE,
    height: OVERLAY_WINDOW_SIZE,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    focusable: true,
    webPreferences: {
      preload: join(__dirname, 'preload-overlay.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Load overlay renderer
  if (process.env['ELECTRON_DEV']) {
    overlayWindow.loadURL('http://localhost:5173');
  } else {
    overlayWindow.loadFile(
      join(__dirname, 'renderer/overlay/index.html')
    );
  }

  // Only this bounded overlay is mouse-interactive. The rest of the desktop has
  // no Action Ring window above it, so the original click reaches the target app.
  overlayWindow.setIgnoreMouseEvents(false);

  overlayWindowHandle = registerOwnedWindowHandle(
    overlayWindow.getNativeWindowHandle()
  );
  const createdOverlayWindow = overlayWindow;
  const createdOverlayWindowHandle = overlayWindowHandle;
  createdOverlayWindow.on('closed', () => {
    unregisterOwnedWindowHandle(createdOverlayWindowHandle);
    if (overlayWindow === createdOverlayWindow) {
      overlayWindowHandle = null;
      clearOverlayHideSafetyTimer();
      pendingOverlayCloseId = null;
      overlayBlurDismissSuppressions.clear();
      setOverlayPollingSuspended(false);
      overlayWindow = null;
    }
  });
  createdOverlayWindow.on('blur', () => {
    if (overlayWindow !== createdOverlayWindow) return;
    if (!createdOverlayWindow.isVisible()) return;
    // IPC deliberately makes the overlay non-focusable while an action is sent
    // to its captured target. That handoff is not an outside click and must not
    // close a keep-open adjustment ring.
    if (
      overlayBlurDismissSuppressions.size > 0 ||
      !createdOverlayWindow.isFocusable()
    ) {
      return;
    }
    dismissOverlayFromOutsideClick();
  });
  createdOverlayWindow.webContents.on('render-process-gone', () => {
    if (overlayWindow !== createdOverlayWindow) return;
    createdOverlayWindow.hide();
    clearOverlayHideSafetyTimer();
    pendingOverlayCloseId = null;
    overlayBlurDismissSuppressions.clear();
    setOverlayPollingSuspended(false);
  });

  return overlayWindow;
}

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow;
}

/**
 * Privacy-safe native window state for correlated diagnostics. Deliberately
 * excludes titles, bounds, handles, process IDs, and document/app content.
 */
export function getRingWindowDiagnosticState(): RingWindowDiagnosticState {
  function describe(window: BrowserWindow | null) {
    const exists = Boolean(window && !window.isDestroyed());
    return {
      exists,
      visible: exists ? window!.isVisible() : false,
      focused: exists ? window!.isFocused() : false,
      focusable: exists ? window!.isFocusable() : false,
    };
  }

  return {
    overlay: describe(overlayWindow),
    dashboard: describe(dashboardWindow),
  };
}

export function showOverlay(x: number, y: number, size = OVERLAY_WINDOW_SIZE): void {
  if (!overlayWindow) return;
  // A reopened ring must not inherit a close fallback scheduled by the prior
  // interaction; otherwise it can disappear shortly after opening.
  clearOverlayHideSafetyTimer();
  pendingOverlayCloseId = null;
  overlayBlurDismissSuppressions.clear();

  setOverlayPollingSuspended(true);
  overlayWindow.setBounds({ x, y, width: size, height: size });
  overlayWindow.show();
  overlayWindow.focus();
  overlayWindow.moveTop();
}

export function hideOverlay(): void {
  clearOverlayHideSafetyTimer();
  overlayWindow?.hide();
  pendingOverlayCloseId = null;
  overlayBlurDismissSuppressions.clear();
  setOverlayPollingSuspended(false);
}

export function scheduleOverlayHideFallback(closeId: string): void {
  clearOverlayHideSafetyTimer();
  pendingOverlayCloseId = closeId;
  const safetyTimer = setTimeout(() => {
    if (
      overlayHideSafetyTimer !== safetyTimer ||
      pendingOverlayCloseId !== closeId
    ) {
      return;
    }
    overlayHideSafetyTimer = null;
    hideOverlay();
  }, 900);
  overlayHideSafetyTimer = safetyTimer;
}

export function completeOverlayClose(closeId: string | null | undefined): void {
  // A completion can arrive after another ring has opened and started closing.
  // Only the animation associated with the currently pending close may hide it.
  if (!closeId || pendingOverlayCloseId !== closeId) return;
  clearOverlayHideSafetyTimer();
  hideOverlay();
}

/**
 * Prevent an intentional focus handoff from being mistaken for an outside click.
 * The returned release function is idempotent, which makes it safe in `finally`.
 */
export function suppressOverlayBlurDismissal(): () => void {
  const suppression = Symbol('overlay-blur-dismissal');
  overlayBlurDismissSuppressions.add(suppression);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    overlayBlurDismissSuppressions.delete(suppression);
  };
}

export function dismissOverlayFromOutsideClick(): void {
  if (!overlayWindow?.isVisible() || pendingOverlayCloseId) return;
  const closeId = randomUUID();
  // Blur bypasses the legacy outside-click IPC route, so invalidate the bound
  // target immediately instead of leaving it actionable during the exit tween.
  endActiveRingSession();
  scheduleOverlayHideFallback(closeId);
  overlayWindow.webContents.send(RING_CLOSE, closeId);
}

// ---------------------------------------------------------------------------
// Dashboard Window (900×650, standard frame)
// ---------------------------------------------------------------------------

export function createDashboardWindow(): BrowserWindow {
  dashboardWindow = new BrowserWindow({
    width: DASHBOARD_WIDTH,
    height: DASHBOARD_HEIGHT,
    minWidth: 1040,
    minHeight: 680,
    frame: true,
    show: false,
    title: 'Lolgi Action Ring — Settings',
    webPreferences: {
      preload: join(__dirname, 'preload-dashboard.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env['ELECTRON_DEV']) {
    dashboardWindow.loadURL('http://localhost:5174');
  } else {
    dashboardWindow.loadFile(
      join(__dirname, 'renderer/dashboard/index.html')
    );
  }

  dashboardWindowHandle = registerOwnedWindowHandle(
    dashboardWindow.getNativeWindowHandle()
  );
  const createdDashboardWindow = dashboardWindow;
  const createdDashboardWindowHandle = dashboardWindowHandle;

  // Hide instead of close. Dirty drafts first go through the renderer guard.
  createdDashboardWindow.on('close', (e) => {
    const { getIsQuitting } = require('./main') as { getIsQuitting: () => boolean };
    if (!getIsQuitting()) {
      e.preventDefault();
      if (dashboardDirty) {
        createdDashboardWindow.webContents.send(DASHBOARD_CLOSE_REQUESTED);
      } else {
        createdDashboardWindow.hide();
      }
    }
  });

  createdDashboardWindow.on('closed', () => {
    unregisterOwnedWindowHandle(createdDashboardWindowHandle);
    if (dashboardWindow === createdDashboardWindow) {
      dashboardWindowHandle = null;
      dashboardWindow = null;
    }
  });

  return dashboardWindow;
}

export function getDashboardWindow(): BrowserWindow | null {
  return dashboardWindow;
}

export function showDashboard(): void {
  if (!dashboardWindow) {
    createDashboardWindow();
  }
  dashboardWindow?.show();
  dashboardWindow?.focus();
}

export function setDashboardDirty(value: boolean): void {
  dashboardDirty = value;
}

export function approveDashboardClose(): void {
  dashboardDirty = false;
  dashboardWindow?.hide();
}
