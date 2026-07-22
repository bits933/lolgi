import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RING_CLOSE } from '../shared/ipcChannels';

const electronHarness = vi.hoisted(() => ({
  BrowserWindow: vi.fn(),
  windows: [] as any[],
}));

const foregroundHarness = vi.hoisted(() => ({
  registerOwnedWindowHandle: vi.fn(() => 'owned-overlay-hwnd'),
  unregisterOwnedWindowHandle: vi.fn(),
  setForegroundPollingBusy: vi.fn(),
}));

const profileRuntimeHarness = vi.hoisted(() => ({
  endActiveRingSession: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: electronHarness.BrowserWindow,
}));

vi.mock('./utils/foregroundApp', () => foregroundHarness);
vi.mock('./profileRuntime', () => profileRuntimeHarness);

function createMockWindow(options: Record<string, unknown>): any {
  const windowHandlers = new Map<string, Array<(...args: any[]) => void>>();
  const contentHandlers = new Map<string, Array<(...args: any[]) => void>>();

  const window = {
    options,
    visible: false,
    destroyed: false,
    focusable: options.focusable !== false,
    focused: false,
    webContents: {
      send: vi.fn(),
      reload: vi.fn(),
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        const handlers = contentHandlers.get(event) ?? [];
        handlers.push(handler);
        contentHandlers.set(event, handlers);
      }),
      emit: (event: string, ...args: any[]) => {
        for (const handler of contentHandlers.get(event) ?? []) handler(...args);
      },
    },
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      const handlers = windowHandlers.get(event) ?? [];
      handlers.push(handler);
      windowHandlers.set(event, handlers);
    }),
    emit: (event: string, ...args: any[]) => {
      for (const handler of windowHandlers.get(event) ?? []) handler(...args);
    },
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    getNativeWindowHandle: vi.fn(() => Buffer.from([1])),
    setIgnoreMouseEvents: vi.fn(),
    setBounds: vi.fn(),
    show: vi.fn(() => {
      window.visible = true;
    }),
    hide: vi.fn(() => {
      window.visible = false;
      window.focused = false;
    }),
    focus: vi.fn(() => {
      window.focused = true;
    }),
    moveTop: vi.fn(),
    isVisible: vi.fn(() => window.visible),
    isDestroyed: vi.fn(() => window.destroyed),
    isFocused: vi.fn(() => window.focused),
    isFocusable: vi.fn(() => window.focusable),
    setFocusable: vi.fn((focusable: boolean) => {
      window.focusable = focusable;
    }),
  };

  electronHarness.windows.push(window);
  return window;
}

async function loadWindowsModule() {
  return await import('./windows');
}

describe('overlay outside-click behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    electronHarness.windows.length = 0;
    electronHarness.BrowserWindow.mockImplementation((options) =>
      createMockWindow(options)
    );
    foregroundHarness.registerOwnedWindowHandle.mockReturnValue('owned-overlay-hwnd');
  });

  it('creates only the bounded ring overlay and no full-desktop click catcher', async () => {
    const windows = await loadWindowsModule();

    windows.createOverlayWindow();
    windows.showOverlay(120, 240, 520);

    expect(electronHarness.BrowserWindow).toHaveBeenCalledTimes(1);
    const overlay = electronHarness.windows[0];
    expect(overlay.options.webPreferences.preload).toContain('preload-overlay');
    expect(overlay.options.focusable).toBe(true);
    expect(overlay.options.webPreferences.sandbox).toBe(true);
    expect(overlay.setBounds).toHaveBeenCalledWith({
      x: 120,
      y: 240,
      width: 520,
      height: 520,
    });
    expect(foregroundHarness.registerOwnedWindowHandle).toHaveBeenCalledTimes(1);
  });

  it('reports only privacy-safe boolean native window state', async () => {
    const windows = await loadWindowsModule();

    expect(windows.getRingWindowDiagnosticState()).toEqual({
      overlay: {
        exists: false,
        visible: false,
        focused: false,
        focusable: false,
      },
      dashboard: {
        exists: false,
        visible: false,
        focused: false,
        focusable: false,
      },
    });

    windows.createOverlayWindow();
    windows.showOverlay(0, 0);
    windows.createDashboardWindow();

    const state = windows.getRingWindowDiagnosticState();
    expect(state).toEqual({
      overlay: {
        exists: true,
        visible: true,
        focused: true,
        focusable: true,
      },
      dashboard: {
        exists: true,
        visible: false,
        focused: false,
        focusable: true,
      },
    });
    expect(
      Object.values(state)
        .flatMap((windowState) => Object.values(windowState))
        .every((value) => typeof value === 'boolean')
    ).toBe(true);
  });

  it('dismisses on a genuine blur without swallowing the underlying desktop click', async () => {
    const windows = await loadWindowsModule();
    const overlay = windows.createOverlayWindow() as any;
    windows.showOverlay(0, 0);

    overlay.emit('blur');
    overlay.emit('blur');

    expect(overlay.webContents.send).toHaveBeenCalledTimes(1);
    expect(overlay.webContents.send).toHaveBeenCalledWith(
      RING_CLOSE,
      expect.any(String)
    );
    expect(profileRuntimeHarness.endActiveRingSession).toHaveBeenCalledOnce();
    expect(overlay.hide).not.toHaveBeenCalled();

    vi.advanceTimersByTime(900);
    expect(overlay.hide).toHaveBeenCalledTimes(1);
    expect(foregroundHarness.setForegroundPollingBusy).toHaveBeenNthCalledWith(1, true);
    expect(foregroundHarness.setForegroundPollingBusy).toHaveBeenLastCalledWith(false);
  });

  it('does not treat an intentional action focus handoff as an outside click', async () => {
    const windows = await loadWindowsModule();
    const overlay = windows.createOverlayWindow() as any;
    windows.showOverlay(0, 0);

    const release = windows.suppressOverlayBlurDismissal();
    overlay.emit('blur');
    release();
    release();

    expect(overlay.webContents.send).not.toHaveBeenCalled();

    overlay.emit('blur');
    expect(overlay.webContents.send).toHaveBeenCalledOnce();
  });

  it('ignores blur while the overlay is non-focusable during keep-open input', async () => {
    const windows = await loadWindowsModule();
    const overlay = windows.createOverlayWindow() as any;
    windows.showOverlay(0, 0);

    overlay.setFocusable(false);
    overlay.emit('blur');
    expect(overlay.webContents.send).not.toHaveBeenCalled();

    overlay.setFocusable(true);
    overlay.emit('blur');
    expect(overlay.webContents.send).toHaveBeenCalledOnce();
  });

  it('does not let a stale close animation hide a reopened ring', async () => {
    const windows = await loadWindowsModule();
    const overlay = windows.createOverlayWindow() as any;
    windows.showOverlay(10, 10);
    overlay.emit('blur');
    const oldCloseId = overlay.webContents.send.mock.calls[0][1] as string;

    windows.showOverlay(20, 20);
    windows.completeOverlayClose(oldCloseId);

    expect(overlay.hide).not.toHaveBeenCalled();
    expect(overlay.isVisible()).toBe(true);
  });

  it('does not let an old completion consume a newer pending close', async () => {
    const windows = await loadWindowsModule();
    const overlay = windows.createOverlayWindow() as any;
    windows.showOverlay(10, 10);
    overlay.emit('blur');
    const oldCloseId = overlay.webContents.send.mock.calls[0][1] as string;

    windows.showOverlay(20, 20);
    windows.scheduleOverlayHideFallback('new-session');
    windows.completeOverlayClose(oldCloseId);

    expect(overlay.hide).not.toHaveBeenCalled();
    expect(overlay.isVisible()).toBe(true);

    windows.completeOverlayClose('new-session');
    expect(overlay.hide).toHaveBeenCalledOnce();
    expect(overlay.isVisible()).toBe(false);
  });

  it('unregisters the overlay HWND and releases polling if the window closes', async () => {
    const windows = await loadWindowsModule();
    const overlay = windows.createOverlayWindow() as any;
    windows.showOverlay(0, 0);

    overlay.emit('closed');

    expect(foregroundHarness.unregisterOwnedWindowHandle).toHaveBeenCalledWith(
      'owned-overlay-hwnd'
    );
    expect(foregroundHarness.setForegroundPollingBusy).toHaveBeenLastCalledWith(false);
    expect(windows.getOverlayWindow()).toBeNull();
  });

  it('invalidates the active session and reloads after an overlay renderer crash', async () => {
    const windows = await loadWindowsModule();
    const overlay = windows.createOverlayWindow() as any;
    windows.showOverlay(0, 0);

    overlay.webContents.emit('render-process-gone');

    expect(profileRuntimeHarness.endActiveRingSession).toHaveBeenCalledOnce();
    expect(overlay.hide).toHaveBeenCalledOnce();
    expect(overlay.setFocusable).toHaveBeenCalledWith(true);
    expect(foregroundHarness.setForegroundPollingBusy).toHaveBeenLastCalledWith(false);
    expect(overlay.webContents.reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);

    expect(overlay.webContents.reload).toHaveBeenCalledOnce();
  });
});
