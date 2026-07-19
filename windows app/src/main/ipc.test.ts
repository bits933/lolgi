import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTION_EXECUTE,
  CONFIG_SET_BUBBLES,
  CONFIG_UPDATE_BUBBLE,
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
  setBubbles: vi.fn(),
  updateBubble: vi.fn(),
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
    },
    ipcMain: {
      handle: electronHarness.handle,
      on: electronHarness.on,
    },
    dialog: {
      showOpenDialog: vi.fn(),
    },
    BrowserWindow,
  };
});

vi.mock('./actions/index', () => actionHarness);
vi.mock('./actions/system', () => systemHarness);
vi.mock('./windows', () => ({
  approveDashboardClose: vi.fn(),
  completeOverlayClose: windowHarness.completeOverlayClose,
  getDashboardWindow: vi.fn(() => null),
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
  getConfig: vi.fn(() => ({ bubbles: [] })),
  setHotkey: vi.fn(),
  setRingSize: vi.fn(),
  setTheme: vi.fn(),
  setLaunchAtStartup: vi.fn(),
  setRingEnabled: vi.fn(),
  setTriggerMode: vi.fn(),
  setBubbles: storeHarness.setBubbles,
  updateBubble: storeHarness.updateBubble,
  addBubble: vi.fn(),
  removeBubble: vi.fn(),
  reorderBubbles: vi.fn(),
  getAppProfiles: vi.fn(() => []),
  addAppProfile: vi.fn(),
  updateAppProfile: vi.fn(),
  removeAppProfile: vi.fn(),
  setProfileBubbles: vi.fn(),
  updateProfileBubble: vi.fn(),
  addProfileBubble: vi.fn(),
  removeProfileBubble: vi.fn(),
  saveProfile: vi.fn(),
  addProfile: vi.fn(),
  removeProfile: vi.fn(),
  setSelectedGlobalProfile: vi.fn(),
}));
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
      send: vi.fn(),
    },
  };
  return overlay;
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
  const pending = handler({}, payload) as Promise<ActionResult>;
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

    closeListener({}, 'old-session');

    expect(runtimeHarness.endRingSession).toHaveBeenCalledWith('old-session');
    expect(runtimeHarness.currentSessionId).toBe('new-session');
    expect(windowHarness.scheduleOverlayHideFallback).not.toHaveBeenCalled();

    closeListener({}, 'new-session');
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

    animationListener({}, 'old-session');

    expect(runtimeHarness.endRingSession).toHaveBeenCalledWith('old-session');
    expect(windowHarness.completeOverlayClose).toHaveBeenCalledWith(
      'old-session'
    );
  });

  it('persists legacy General bubble edits without replacing a live ring payload', () => {
    const setBubblesHandler = electronHarness.handlers.get(CONFIG_SET_BUBBLES);
    const updateBubbleHandler = electronHarness.handlers.get(
      CONFIG_UPDATE_BUBBLE
    );
    if (!setBubblesHandler || !updateBubbleHandler) {
      throw new Error('Legacy bubble handlers were not registered');
    }
    const generalBubbles = [
      {
        id: 'general-action',
        label: 'General action',
        type: 'action',
        actionType: 'do-nothing',
      },
    ] as any;

    expect(setBubblesHandler({}, generalBubbles)).toEqual({ success: true });
    expect(
      updateBubbleHandler({}, {
        id: 'general-action',
        patch: { label: 'Updated General action' },
      })
    ).toEqual({ success: true });

    expect(storeHarness.setBubbles).toHaveBeenCalledWith(generalBubbles);
    expect(storeHarness.updateBubble).toHaveBeenCalledWith('general-action', {
      label: 'Updated General action',
    });
    expect(windowHarness.overlay.webContents.send).not.toHaveBeenCalled();
  });
});
