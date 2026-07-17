import { BrowserWindow, screen } from 'electron';
import type { Rectangle } from 'electron';
import { join } from 'path';
import { OVERLAY_WINDOW_SIZE, DASHBOARD_WIDTH, DASHBOARD_HEIGHT } from '../shared/constants';
import { DASHBOARD_CLOSE_REQUESTED, RING_CLOSE } from '../shared/ipcChannels';

let overlayWindow: BrowserWindow | null = null;
let outsideClickWindow: BrowserWindow | null = null;
let dashboardWindow: BrowserWindow | null = null;
let dashboardDirty = false;
let overlayHideSafetyTimer: ReturnType<typeof setTimeout> | null = null;

function clearOverlayHideSafetyTimer(): void {
  if (!overlayHideSafetyTimer) return;
  clearTimeout(overlayHideSafetyTimer);
  overlayHideSafetyTimer = null;
}

function getDesktopBounds(): Rectangle {
  const displays = screen.getAllDisplays();
  const left = Math.min(...displays.map((display) => display.bounds.x));
  const top = Math.min(...displays.map((display) => display.bounds.y));
  const right = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width));
  const bottom = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function createOutsideClickWindow(): BrowserWindow {
  const bounds = getDesktopBounds();
  outsideClickWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    focusable: true,
    fullscreenable: false,
    hasShadow: false,
    movable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, 'preload-outside-click.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  outsideClickWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(
      '<!doctype html><html><body style="margin:0;width:100vw;height:100vh;background:rgba(0,0,0,0.004)"></body></html>'
    )}`
  );
  outsideClickWindow.on('closed', () => {
    outsideClickWindow = null;
  });
  // The transparent page can miss its first mouse event on Windows. A desktop
  // click still focuses this native window, so keep a main-process fallback.
  outsideClickWindow.on('focus', dismissOverlayFromOutsideClick);

  return outsideClickWindow;
}

// ---------------------------------------------------------------------------
// Overlay Window (400×400 transparent, always on top)
// ---------------------------------------------------------------------------

export function createOverlayWindow(): BrowserWindow {
  createOutsideClickWindow();

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

  // Make the window click-through when mouse is not over a bubble
  overlayWindow.setIgnoreMouseEvents(false);

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  return overlayWindow;
}

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow;
}

export function showOverlay(x: number, y: number, size = OVERLAY_WINDOW_SIZE): void {
  if (!overlayWindow) return;
  // A reopened ring must not inherit a close fallback scheduled by the prior
  // interaction; otherwise it can disappear shortly after opening.
  clearOverlayHideSafetyTimer();
  if (!outsideClickWindow || outsideClickWindow.isDestroyed()) {
    createOutsideClickWindow();
  }

  outsideClickWindow?.setBounds(getDesktopBounds());
  outsideClickWindow?.showInactive();
  overlayWindow.setBounds({ x, y, width: size, height: size });
  overlayWindow.show();
  overlayWindow.focus();
  overlayWindow.moveTop();
}

export function hideOverlay(): void {
  clearOverlayHideSafetyTimer();
  outsideClickWindow?.hide();
  overlayWindow?.hide();
}

export function scheduleOverlayHideFallback(): void {
  clearOverlayHideSafetyTimer();
  overlayHideSafetyTimer = setTimeout(() => {
    overlayHideSafetyTimer = null;
    hideOverlay();
  }, 900);
}

export function completeOverlayClose(): void {
  clearOverlayHideSafetyTimer();
  hideOverlay();
}

export function dismissOverlayFromOutsideClick(): void {
  if (!overlayWindow?.isVisible()) return;
  overlayWindow.webContents.send(RING_CLOSE);
  scheduleOverlayHideFallback();
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
    title: 'Logi Actions Ring — Settings',
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

  // Hide instead of close. Dirty drafts first go through the renderer guard.
  dashboardWindow.on('close', (e) => {
    const { getIsQuitting } = require('./main') as { getIsQuitting: () => boolean };
    if (!getIsQuitting()) {
      e.preventDefault();
      if (dashboardDirty) {
        dashboardWindow?.webContents.send(DASHBOARD_CLOSE_REQUESTED);
      } else {
        dashboardWindow?.hide();
      }
    }
  });

  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
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
