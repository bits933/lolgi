import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RING_OPEN, SYSTEM_STATE_UPDATED } from '../shared/ipcChannels';
import type {
  AppConfig,
  ForegroundWindowTarget,
  RingProfile,
  SystemState,
} from '../shared/types';

type HotkeyCallback = () => void | Promise<void>;

const harness = vi.hoisted(() => ({
  callback: null as HotkeyCallback | null,
  config: null as AppConfig | null,
  overlayWindow: null as any,
  foregroundResults: [] as Array<Promise<ForegroundWindowTarget | null>>,
  systemStateResults: [] as Array<Promise<SystemState>>,
  register: vi.fn(),
  isRegistered: vi.fn(),
  unregister: vi.fn(),
  unregisterAll: vi.fn(),
  getConfig: vi.fn(),
  getOverlayWindow: vi.fn(),
  hideOverlay: vi.fn(),
  showOverlay: vi.fn(),
  getRingWindowDiagnosticState: vi.fn(),
  getForegroundAppForTrigger: vi.fn(),
  getForegroundTrackerSnapshot: vi.fn(),
  getCachedForegroundAppAge: vi.fn(),
  getSystemState: vi.fn(),
  beginRingSession: vi.fn(),
  endActiveRingSession: vi.fn(),
  endRingSession: vi.fn(),
  recordRingDiagnostic: vi.fn(),
}));

vi.mock('electron', () => ({
  globalShortcut: {
    register: harness.register,
    isRegistered: harness.isRegistered,
    unregister: harness.unregister,
    unregisterAll: harness.unregisterAll,
  },
}));

vi.mock('./store', () => ({
  getConfig: harness.getConfig,
}));

vi.mock('./windows', () => ({
  getOverlayWindow: harness.getOverlayWindow,
  getRingWindowDiagnosticState: harness.getRingWindowDiagnosticState,
  hideOverlay: harness.hideOverlay,
  showOverlay: harness.showOverlay,
}));

vi.mock('./utils/cursorPosition', () => ({
  getCursorPosition: vi.fn(() => ({ x: 300, y: 200 })),
  getOverlayOrigin: vi.fn(() => ({ x: 100, y: 50 })),
}));

vi.mock('./utils/foregroundApp', () => ({
  getForegroundAppForTrigger: harness.getForegroundAppForTrigger,
  getForegroundTrackerSnapshot: harness.getForegroundTrackerSnapshot,
  getCachedForegroundAppAge: harness.getCachedForegroundAppAge,
}));

vi.mock('./actions/index', () => ({
  getSystemState: harness.getSystemState,
}));

vi.mock('./actions/volume', () => ({
  getVolumeState: vi.fn(() => ({ level: 0.2, isMuted: false })),
}));

vi.mock('./actions/brightness', () => ({
  getBrightness: vi.fn(() => 0.3),
}));

vi.mock('../shared/defaultProfiles', () => ({
  materializeFigmaActionsBinding: vi.fn((bubbles) => bubbles),
}));

vi.mock('./profileRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./profileRuntime')>();
  return {
    ...actual,
    beginRingSession: harness.beginRingSession,
    endActiveRingSession: harness.endActiveRingSession,
    endRingSession: harness.endRingSession,
  };
});

vi.mock('./actions/diagnostics', () => ({
  recordRingDiagnostic: harness.recordRingDiagnostic,
}));

function createProfile(
  id: string,
  name: string,
  kind: RingProfile['kind'],
  processName?: string
): RingProfile {
  return {
    id,
    name,
    kind,
    enabled: true,
    protected: kind === 'general',
    sortOrder: kind === 'general' ? 0 : 1,
    slots: [
      {
        id: `slot-${id}`,
        position: 0,
        assignment: {
          id: `action-${id}`,
          definitionId: 'keyboard-shortcut',
          label: `${name} action`,
          iconName: 'Command',
          actionType: 'keyboard-shortcut',
          payload: 'Ctrl+Shift+K',
          type: 'default',
        },
      },
    ],
    application: kind === 'application'
      ? {
          processName: processName!,
          displayName: name,
        }
      : undefined,
  };
}

function createConfig(): AppConfig {
  const general = createProfile('general', 'General', 'general');
  const oldApp = createProfile('old-profile', 'Old App', 'application', 'old-app');
  const newApp = createProfile('new-profile', 'New App', 'application', 'new-app');
  return {
    schemaVersion: 2,
    generalProfileId: general.id,
    selectedGlobalProfileId: null,
    profiles: [general, oldApp, newApp],
    hotkey: 'CommandOrControl+Space',
    bubbles: [],
    launchAtStartup: false,
    ringEnabled: true,
    triggerMode: 'A',
    ringSize: 'medium',
    labelSize: 'medium',
    theme: {
      mode: 'dark',
      accentColor: '#6750a4',
      bubbleColor: '#242424',
    },
    appProfiles: [],
  };
}

function target(
  processName: string,
  processId: number,
  windowHandle: string
): ForegroundWindowTarget {
  return {
    processName,
    processId,
    windowHandle,
    executablePath: `C:\\Apps\\${processName}`,
    windowTitle: `${processName} document`,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function registerAndGetCallback(): Promise<HotkeyCallback> {
  const { registerHotkey } = await import('./globalShortcut');
  expect(registerHotkey()).toBe(true);
  expect(harness.callback).not.toBeNull();
  return harness.callback!;
}

function ringOpenPayloads(): any[] {
  return harness.overlayWindow.webContents.send.mock.calls
    .filter(([channel]: [string]) => channel === RING_OPEN)
    .map(([, payload]: [string, unknown]) => payload);
}

function systemStateUpdates(): SystemState[] {
  return harness.overlayWindow.webContents.send.mock.calls
    .filter(([channel]: [string]) => channel === SYSTEM_STATE_UPDATED)
    .map(([, state]: [string, SystemState]) => state);
}

describe('global hotkey trigger reentrancy', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    harness.callback = null;
    harness.config = createConfig();
    harness.foregroundResults.length = 0;
    harness.systemStateResults.length = 0;
    harness.overlayWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: {
        send: vi.fn(),
      },
    };

    harness.register.mockImplementation((_key: string, callback: HotkeyCallback) => {
      harness.callback = callback;
      return true;
    });
    harness.isRegistered.mockReturnValue(false);
    harness.getConfig.mockImplementation(() => harness.config);
    harness.getOverlayWindow.mockImplementation(() => harness.overlayWindow);
    harness.getRingWindowDiagnosticState.mockReturnValue({
      overlay: { exists: true, visible: false, focused: false, focusable: true },
      dashboard: { exists: false, visible: false, focused: false, focusable: false },
    });
    harness.getForegroundAppForTrigger.mockImplementation(() => {
      const result = harness.foregroundResults.shift();
      if (!result) throw new Error('Missing fake foreground result');
      return result;
    });
    harness.getForegroundTrackerSnapshot.mockReturnValue({
      rawForeground: null,
      generation: 1,
    });
    harness.getCachedForegroundAppAge.mockReturnValue(4);
    harness.getSystemState.mockImplementation(() => {
      return harness.systemStateResults.shift() ?? new Promise<SystemState>(() => {});
    });
    harness.beginRingSession.mockImplementation((ringTarget: ForegroundWindowTarget | null) => ({
      id: `session-${ringTarget?.processId ?? 'none'}`,
      target: ringTarget,
    }));
  });

  it('keeps the latest target and application profile when lookups finish out of order', async () => {
    const oldLookup = deferred<ForegroundWindowTarget | null>();
    const newLookup = deferred<ForegroundWindowTarget | null>();
    harness.foregroundResults.push(oldLookup.promise, newLookup.promise);
    const callback = await registerAndGetCallback();

    const oldTrigger = Promise.resolve(callback());
    const newTrigger = Promise.resolve(callback());

    const newTarget = target('new-app.exe', 202, '2202');
    newLookup.resolve(newTarget);
    await newTrigger;

    expect(harness.beginRingSession).toHaveBeenCalledOnce();
    expect(harness.beginRingSession).toHaveBeenCalledWith(newTarget);
    expect(ringOpenPayloads()).toEqual([
      expect.objectContaining({
        ringSessionId: 'session-202',
        matchedApp: expect.objectContaining({
          processName: 'new-app',
          displayName: 'New App',
        }),
        bubbles: [
          expect.objectContaining({
            id: 'action-new-profile',
            label: 'New App action',
          }),
        ],
      }),
    ]);

    oldLookup.resolve(target('old-app.exe', 101, '1101'));
    await oldTrigger;

    expect(harness.beginRingSession).toHaveBeenCalledOnce();
    expect(ringOpenPayloads()).toHaveLength(1);
    expect(harness.showOverlay).toHaveBeenCalledOnce();
    expect(harness.hideOverlay).not.toHaveBeenCalled();
    expect(harness.endActiveRingSession).not.toHaveBeenCalled();
  });

  it('opens General for an unmatched external process and ignores an older null/self result', async () => {
    const staleLookup = deferred<ForegroundWindowTarget | null>();
    const latestLookup = deferred<ForegroundWindowTarget | null>();
    harness.foregroundResults.push(staleLookup.promise, latestLookup.promise);
    const callback = await registerAndGetCallback();

    const staleTrigger = Promise.resolve(callback());
    const latestTrigger = Promise.resolve(callback());

    const unmatchedExternal = target('unconfigured-tool.exe', 303, '3303');
    latestLookup.resolve(unmatchedExternal);
    await latestTrigger;

    expect(harness.beginRingSession).toHaveBeenCalledWith(unmatchedExternal);
    expect(ringOpenPayloads()).toEqual([
      expect.objectContaining({
        ringSessionId: 'session-303',
        matchedApp: null,
        bubbles: [
          expect.objectContaining({
            id: 'action-general',
            label: 'General action',
          }),
        ],
      }),
    ]);

    staleLookup.resolve(null);
    await staleTrigger;

    expect(ringOpenPayloads()).toHaveLength(1);
    expect(harness.hideOverlay).not.toHaveBeenCalled();
    expect(harness.endActiveRingSession).not.toHaveBeenCalled();
  });

  it('lets a newer disabled trigger invalidate an older in-flight lookup', async () => {
    const staleLookup = deferred<ForegroundWindowTarget | null>();
    harness.foregroundResults.push(staleLookup.promise);
    const callback = await registerAndGetCallback();

    const staleTrigger = Promise.resolve(callback());
    harness.config = { ...harness.config!, ringEnabled: false };
    await Promise.resolve(callback());

    staleLookup.resolve(target('old-app.exe', 404, '4404'));
    await staleTrigger;

    expect(harness.beginRingSession).not.toHaveBeenCalled();
    expect(ringOpenPayloads()).toHaveLength(0);
    expect(harness.showOverlay).not.toHaveBeenCalled();
    expect(harness.hideOverlay).not.toHaveBeenCalled();
    expect(harness.endActiveRingSession).not.toHaveBeenCalled();
  });

  it('invalidates a pending callback when the native hotkey is rebound', async () => {
    const staleLookup = deferred<ForegroundWindowTarget | null>();
    harness.foregroundResults.push(staleLookup.promise);
    const oldCallback = await registerAndGetCallback();
    const staleTrigger = Promise.resolve(oldCallback());

    const { registerHotkey } = await import('./globalShortcut');
    expect(registerHotkey('CommandOrControl+Shift+Space')).toBe(true);
    expect(harness.unregister).toHaveBeenCalledWith('CommandOrControl+Space');

    staleLookup.resolve(target('old-app.exe', 707, '7707'));
    await staleTrigger;

    expect(harness.beginRingSession).not.toHaveBeenCalled();
    expect(ringOpenPayloads()).toHaveLength(0);
    expect(harness.showOverlay).not.toHaveBeenCalled();
    expect(harness.hideOverlay).not.toHaveBeenCalled();
  });

  it('does not deliver an older background system-state refresh into the latest ring', async () => {
    const oldSystemState = deferred<SystemState>();
    const newSystemState = deferred<SystemState>();
    harness.foregroundResults.push(
      Promise.resolve(target('old-app.exe', 505, '5505')),
      Promise.resolve(target('new-app.exe', 606, '6606'))
    );
    harness.systemStateResults.push(oldSystemState.promise, newSystemState.promise);
    const callback = await registerAndGetCallback();

    await Promise.resolve(callback());
    await Promise.resolve(callback());

    const latestState: SystemState = {
      volumeLevel: 0.7,
      isMuted: true,
      brightnessLevel: 0.8,
      isPlaying: false,
    };
    newSystemState.resolve(latestState);
    await Promise.resolve();
    expect(systemStateUpdates()).toEqual([latestState]);

    oldSystemState.resolve({
      volumeLevel: 0.9,
      isMuted: false,
      brightnessLevel: 0.1,
      isPlaying: false,
    });
    await Promise.resolve();

    expect(systemStateUpdates()).toEqual([latestState]);
    expect(ringOpenPayloads().map((payload) => payload.ringSessionId)).toEqual([
      'session-505',
      'session-606',
    ]);
  });
});
