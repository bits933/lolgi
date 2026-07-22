import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTION_EXECUTE,
  APP_RELAUNCH,
  PRIVACY_POLICY_OPEN,
  CONFIG_SET_HARDWARE_ACCELERATION,
  GRAPHICS_STATUS_GET,
  OVERLAY_ANIMATION_COMPLETE,
  OVERLAY_CLOSE,
} from '../shared/ipcChannels';
import type {
  ActionExecutePayload,
  ActionResult,
  ForegroundWindowTarget,
} from '../shared/types';

const electronHarness = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  handlers: new Map<string, (...args: any[]) => any>(),
  listeners: new Map<string, (...args: any[]) => any>(),
  getFocusedWindow: vi.fn(),
  relaunch: vi.fn(),
  exit: vi.fn(),
  openExternal: vi.fn(),
}));

const actionHarness = vi.hoisted(() => ({
  dispatchAction: vi.fn(),
  getSystemState: vi.fn(),
}));

const systemHarness = vi.hoisted(() => ({
  requiresForegroundInput: vi.fn(),
}));

const windowHarness = vi.hoisted(() => ({
  overlay: null as any,
  dashboard: null as any,
  hideOverlay: vi.fn(),
  showOverlay: vi.fn(),
  scheduleOverlayHideFallback: vi.fn(),
  completeOverlayClose: vi.fn(),
  suppressOverlayBlurDismissal: vi.fn(),
}));

const foregroundHarness = vi.hoisted(() => ({
  setForegroundPollingBusy: vi.fn(),
}));

const runtimeHarness = vi.hoisted(() => ({
  currentSessionId: 'current-session' as string | null,
  target: null as ForegroundWindowTarget | null,
  endRingSession: vi.fn(),
  getRingSessionTarget: vi.fn(),
  isRingSessionCurrent: vi.fn(),
}));

const diagnosticsHarness = vi.hoisted(() => ({
  recordActionResult: vi.fn(),
}));

const storeHarness = vi.hoisted(() => ({
  getConfig: vi.fn(() => ({ hardwareAcceleration: true })),
  setHardwareAcceleration: vi.fn(),
}));

const graphicsHarness = vi.hoisted(() => ({
  getGraphicsAccelerationStatus: vi.fn(),
  waitForGraphicsAccelerationStatus: vi.fn(),
}));

vi.mock('electron', () => {
  class BrowserWindow {}
  Object.assign(BrowserWindow, {
    getFocusedWindow: electronHarness.getFocusedWindow,
    getAllWindows: vi.fn(() => []),
  });
  return {
    app: {
      setLoginItemSettings: vi.fn(),
      relaunch: electronHarness.relaunch,
      exit: electronHarness.exit,
    },
    ipcMain: {
      handle: electronHarness.handle,
      on: electronHarness.on,
    },
    dialog: {
      showOpenDialog: vi.fn(),
    },
    shell: { openExternal: electronHarness.openExternal },
    BrowserWindow,
  };
});

vi.mock('./actions/index', () => actionHarness);
vi.mock('./actions/system', () => systemHarness);
vi.mock('./windows', () => ({
  approveDashboardClose: vi.fn(),
  completeOverlayClose: windowHarness.completeOverlayClose,
  getDashboardWindow: vi.fn(() => windowHarness.dashboard),
  getOverlayWindow: vi.fn(() => windowHarness.overlay),
  hideOverlay: windowHarness.hideOverlay,
  scheduleOverlayHideFallback: windowHarness.scheduleOverlayHideFallback,
  setDashboardDirty: vi.fn(),
  showOverlay: windowHarness.showOverlay,
  suppressOverlayBlurDismissal: windowHarness.suppressOverlayBlurDismissal,
}));
vi.mock('./utils/foregroundApp', () => ({
  getForegroundApp: vi.fn(),
  listRunningApps: vi.fn(),
  listInstalledApps: vi.fn(),
  listAllApps: vi.fn(),
  setForegroundPollingBusy: foregroundHarness.setForegroundPollingBusy,
}));
vi.mock('./profileRuntime', () => ({
  endRingSession: runtimeHarness.endRingSession,
  getRingSessionTarget: runtimeHarness.getRingSessionTarget,
  isRingSessionCurrent: runtimeHarness.isRingSessionCurrent,
}));
vi.mock('./actions/diagnostics', () => ({
  copyLastCorrelatedDiagnostic: vi.fn(),
  getRecentActionResults: vi.fn(() => []),
  getRecentDiagnosticEvents: vi.fn(() => []),
  recordActionResult: diagnosticsHarness.recordActionResult,
}));
vi.mock('./buildIdentity', () => ({
  getRuntimeBuildIdentity: vi.fn(),
}));
vi.mock('./store', () => ({
  getConfig: storeHarness.getConfig,
  setHotkey: vi.fn(),
  setRingSize: vi.fn(),
  setTheme: vi.fn(),
  setLaunchAtStartup: vi.fn(),
  setHardwareAcceleration: storeHarness.setHardwareAcceleration,
  setRingEnabled: vi.fn(),
  setTriggerMode: vi.fn(),
  saveProfile: vi.fn(),
  addProfile: vi.fn(),
  removeProfile: vi.fn(),
  setSelectedGlobalProfile: vi.fn(),
}));
vi.mock('./hardwareAcceleration', () => graphicsHarness);
vi.mock('./globalShortcut', () => ({
  registerHotkey: vi.fn(() => true),
  unregisterHotkey: vi.fn(),
}));
vi.mock('./tray', () => ({ updateTrayMenu: vi.fn() }));
vi.mock('./utils/appIcon', () => ({ extractAppIcon: vi.fn() }));
vi.mock('./utils/urlIcon', () => ({ fetchUrlIcon: vi.fn() }));

const target: ForegroundWindowTarget = {
  processName: 'Figma',
  executablePath: 'C:\\Program Files\\Figma\\Figma.exe',
  windowTitle: 'Design file',
  windowHandle: '424242',
  processId: 1234,
};

function createOverlay() {
  const overlay = {
    visible: true,
    destroyed: false,
    getBounds: vi.fn(() => ({ x: 120, y: 240, width: 520, height: 520 })),
    isVisible: vi.fn(() => overlay.visible),
    isDestroyed: vi.fn(() => overlay.destroyed),
    setFocusable: vi.fn(),
    focus: vi.fn(),
    webContents: {
      id: 101,
      send: vi.fn(),
    },
  };
  return overlay;
}

function overlayEvent() {
  return { sender: { id: 101 } };
}

function dashboardEvent() {
  return { sender: { id: 202 } };
}

async function registerHandlers(): Promise<void> {
  electronHarness.handle.mockImplementation((channel, handler) => {
    electronHarness.handlers.set(channel, handler);
  });
  electronHarness.on.mockImplementation((channel, listener) => {
    electronHarness.listeners.set(channel, listener);
  });
  const { registerIpcHandlers } = await import('./ipc');
  registerIpcHandlers();
}

async function execute(payload: ActionExecutePayload): Promise<ActionResult> {
  const handler = electronHarness.handlers.get(ACTION_EXECUTE);
  if (!handler) throw new Error('ACTION_EXECUTE handler was not registered');
  const pending = handler(overlayEvent(), payload) as Promise<ActionResult>;
  await vi.advanceTimersByTimeAsync(200);
  return await pending;
}

describe('ring session IPC action chain', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    electronHarness.handlers.clear();
    electronHarness.listeners.clear();
    electronHarness.getFocusedWindow.mockReturnValue(null);

    runtimeHarness.currentSessionId = 'current-session';
    runtimeHarness.target = target;
    runtimeHarness.isRingSessionCurrent.mockImplementation(
      (sessionId) => Boolean(sessionId && sessionId === runtimeHarness.currentSessionId)
    );
    runtimeHarness.getRingSessionTarget.mockImplementation((sessionId) =>
      sessionId === runtimeHarness.currentSessionId ? runtimeHarness.target : null
    );
    runtimeHarness.endRingSession.mockImplementation((sessionId) => {
      if (sessionId === runtimeHarness.currentSessionId) {
        runtimeHarness.currentSessionId = null;
        runtimeHarness.target = null;
      }
    });

    windowHarness.overlay = createOverlay();
    windowHarness.dashboard = {
      destroyed: false,
      isDestroyed: vi.fn(() => false),
      webContents: { id: 202 },
    };
    windowHarness.suppressOverlayBlurDismissal.mockReturnValue(vi.fn());
    systemHarness.requiresForegroundInput.mockImplementation(
      (actionType) => actionType === 'keyboard-shortcut'
    );
    actionHarness.dispatchAction.mockResolvedValue({
      status: 'success',
      success: true,
    });
    diagnosticsHarness.recordActionResult.mockReturnValue({
      eventId: 'diag0001-full-event-id',
    });

    await registerHandlers();
  });

  it('rejects action calls from the wrong renderer and malformed action payloads', async () => {
    const handler = electronHarness.handlers.get(ACTION_EXECUTE);
    if (!handler) throw new Error('ACTION_EXECUTE handler was not registered');
    const validPayload: ActionExecutePayload = {
      bubbleId: 'group',
      actionType: 'keyboard-shortcut',
      payload: 'Ctrl+G',
      ringSessionId: 'current-session',
    };

    expect(() => handler(dashboardEvent(), validPayload)).toThrow('IPC_SENDER_REJECTED');
    await expect(handler(overlayEvent(), {
      ...validPayload,
      actionType: 'not-an-action',
    })).rejects.toThrow('Action type is not supported');
  });

  it.each([
    {
      name: 'stale session',
      sessionId: 'stale-session',
      currentSessionId: 'current-session',
      currentTarget: target,
      expectedMessage: 'no longer active',
    },
    {
      name: 'current session without a captured target',
      sessionId: 'current-session',
      currentSessionId: 'current-session',
      currentTarget: null,
      expectedMessage: 'captured when the ring opened is unavailable',
    },
  ])('rejects a $name before dispatch and returns a visible diagnostic reference', async ({
    sessionId,
    currentSessionId,
    currentTarget,
    expectedMessage,
  }) => {
    runtimeHarness.currentSessionId = currentSessionId;
    runtimeHarness.target = currentTarget;

    const result = await execute({
      bubbleId: 'group',
      definitionId: 'figma.group',
      actionType: 'keyboard-shortcut',
      payload: 'Ctrl+G',
      ringSessionId: sessionId,
    });

    expect(result).toMatchObject({
      status: 'target_unavailable',
      success: false,
      diagnosticId: 'diag0001',
      message: expect.stringContaining(expectedMessage),
    });
    expect(result.message).toContain('Diagnostic diag0001');
    expect(actionHarness.dispatchAction).not.toHaveBeenCalled();
    expect(diagnosticsHarness.recordActionResult).toHaveBeenCalledWith(
      'keyboard-shortcut',
      expect.objectContaining({ status: 'target_unavailable', success: false }),
      0,
      expect.objectContaining({
        correlationId: sessionId,
        phase: 'rejected-before-dispatch',
        definitionId: 'figma.group',
        bubbleId: 'group',
      })
    );
  });

  it('passes the exact target captured for the current session to dispatch', async () => {
    const payload: ActionExecutePayload = {
      bubbleId: 'group',
      actionType: 'keyboard-shortcut',
      payload: 'Ctrl+G',
      ringSessionId: 'current-session',
    };

    await execute(payload);

    expect(actionHarness.dispatchAction).toHaveBeenCalledWith(payload, { target });
    expect(actionHarness.dispatchAction.mock.calls[0][1].target).toBe(target);
  });

  it('rejects a session replaced while the focus handoff is waiting', async () => {
    const releaseBlurSuppression = vi.fn();
    windowHarness.suppressOverlayBlurDismissal.mockReturnValueOnce(
      releaseBlurSuppression
    );
    const handler = electronHarness.handlers.get(ACTION_EXECUTE);
    if (!handler) throw new Error('ACTION_EXECUTE handler was not registered');

    const pending = handler(overlayEvent(), {
      bubbleId: 'zoom',
      actionType: 'keyboard-shortcut',
      payload: 'Ctrl+=',
      keepOpen: true,
      ringSessionId: 'current-session',
    }) as Promise<ActionResult>;

    runtimeHarness.currentSessionId = 'replacement-session';
    runtimeHarness.target = { ...target, windowHandle: '515151', processId: 5678 };
    await vi.advanceTimersByTimeAsync(200);

    await expect(pending).resolves.toMatchObject({
      status: 'target_unavailable',
      success: false,
      message: expect.stringContaining('no longer active'),
    });
    expect(actionHarness.dispatchAction).not.toHaveBeenCalled();
    expect(windowHarness.overlay.setFocusable).toHaveBeenNthCalledWith(1, false);
    expect(windowHarness.overlay.setFocusable).toHaveBeenLastCalledWith(true);
    expect(windowHarness.overlay.focus).toHaveBeenCalledOnce();
    expect(releaseBlurSuppression).toHaveBeenCalledOnce();
  });

  it('reopens a one-shot ring at its previous bounds when dispatch fails', async () => {
    actionHarness.dispatchAction.mockResolvedValueOnce({
      status: 'target_unavailable',
      success: false,
      diagnosticId: 'focus001',
      message: 'Target focus failed. Diagnostic focus001.',
    });

    const result = await execute({
      bubbleId: 'group',
      actionType: 'keyboard-shortcut',
      payload: 'Ctrl+G',
      ringSessionId: 'current-session',
    });

    expect(result.success).toBe(false);
    expect(windowHarness.hideOverlay).toHaveBeenCalledOnce();
    expect(windowHarness.showOverlay).toHaveBeenCalledWith(120, 240, 520);
  });

  it('suppresses blur during a keep-open focus handoff and restores ring focus', async () => {
    const releaseBlurSuppression = vi.fn();
    windowHarness.suppressOverlayBlurDismissal.mockReturnValueOnce(
      releaseBlurSuppression
    );

    await execute({
      bubbleId: 'zoom',
      actionType: 'keyboard-shortcut',
      payload: 'Ctrl+=',
      keepOpen: true,
      ringSessionId: 'current-session',
    });

    expect(windowHarness.suppressOverlayBlurDismissal).toHaveBeenCalledOnce();
    expect(windowHarness.overlay.setFocusable).toHaveBeenNthCalledWith(1, false);
    expect(windowHarness.overlay.setFocusable).toHaveBeenLastCalledWith(true);
    expect(windowHarness.overlay.focus).toHaveBeenCalledOnce();
    expect(releaseBlurSuppression).toHaveBeenCalledOnce();
    expect(windowHarness.hideOverlay).not.toHaveBeenCalled();
    expect(windowHarness.showOverlay).not.toHaveBeenCalled();
  });

  it('does not schedule a hide when OVERLAY_CLOSE belongs to an older session', () => {
    runtimeHarness.currentSessionId = 'new-session';
    runtimeHarness.target = target;
    const closeListener = electronHarness.listeners.get(OVERLAY_CLOSE);
    if (!closeListener) throw new Error('OVERLAY_CLOSE listener was not registered');

    closeListener(overlayEvent(), 'old-session');

    expect(runtimeHarness.endRingSession).toHaveBeenCalledWith('old-session');
    expect(runtimeHarness.currentSessionId).toBe('new-session');
    expect(windowHarness.scheduleOverlayHideFallback).not.toHaveBeenCalled();

    closeListener(overlayEvent(), 'new-session');
    expect(windowHarness.scheduleOverlayHideFallback).toHaveBeenCalledWith(
      'new-session'
    );
  });

  it('threads the completed session ID into the pending window close', () => {
    const animationListener = electronHarness.listeners.get(
      OVERLAY_ANIMATION_COMPLETE
    );
    if (!animationListener) {
      throw new Error('OVERLAY_ANIMATION_COMPLETE listener was not registered');
    }

    animationListener(overlayEvent(), 'old-session');

    expect(runtimeHarness.endRingSession).toHaveBeenCalledWith('old-session');
    expect(windowHarness.completeOverlayClose).toHaveBeenCalledWith(
      'old-session'
    );
  });

  it('persists only boolean hardware-acceleration preferences and reports restart state', () => {
    const handler = electronHarness.handlers.get(CONFIG_SET_HARDWARE_ACCELERATION);
    if (!handler) throw new Error('Hardware acceleration handler was not registered');
    const status = {
      preferenceEnabled: false,
      startupPreferenceEnabled: true,
      restartRequired: true,
      statusReady: false,
      hardwareAccelerationEnabled: null,
      gpuCompositing: null,
      rasterization: null,
    };
    graphicsHarness.getGraphicsAccelerationStatus.mockReturnValue(status);

    expect(handler(dashboardEvent(), false)).toEqual(status);
    expect(storeHarness.setHardwareAcceleration).toHaveBeenCalledWith(false);
    expect(graphicsHarness.getGraphicsAccelerationStatus).toHaveBeenCalledWith(false);
    expect(() => handler(dashboardEvent(), 'false')).toThrow('must be a boolean');
  });

  it('returns current graphics status and relaunches only through the explicit IPC', async () => {
    const statusHandler = electronHarness.handlers.get(GRAPHICS_STATUS_GET);
    const relaunchHandler = electronHarness.handlers.get(APP_RELAUNCH);
    if (!statusHandler || !relaunchHandler) throw new Error('Graphics handlers were not registered');
    const status = { preferenceEnabled: false };
    storeHarness.getConfig
      .mockReturnValueOnce({ hardwareAcceleration: true })
      .mockReturnValueOnce({ hardwareAcceleration: false });
    graphicsHarness.waitForGraphicsAccelerationStatus.mockResolvedValueOnce(status);
    graphicsHarness.getGraphicsAccelerationStatus.mockReturnValueOnce(status);

    await expect(statusHandler(dashboardEvent())).resolves.toBe(status);
    expect(graphicsHarness.waitForGraphicsAccelerationStatus).toHaveBeenCalledWith(true);
    expect(graphicsHarness.getGraphicsAccelerationStatus).toHaveBeenCalledWith(false);
    expect(relaunchHandler(dashboardEvent())).toBeUndefined();
    expect(electronHarness.relaunch).toHaveBeenCalledOnce();
    expect(electronHarness.exit).toHaveBeenCalledWith(0);
  });

  it('opens the fixed privacy-policy URL through the system browser', async () => {
    const handler = electronHarness.handlers.get(PRIVACY_POLICY_OPEN);
    if (!handler) throw new Error('Privacy policy handler was not registered');

    await handler(dashboardEvent());

    expect(electronHarness.openExternal).toHaveBeenCalledWith(
      'https://github.com/bits933/lolgi/blob/main/PRIVACY.txt'
    );
  });

});
