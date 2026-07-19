import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTION_EXECUTE,
  OVERLAY_ANIMATION_COMPLETE,
  OVERLAY_CLOSE,
  RING_CLOSE,
  RING_OPEN,
} from '../shared/ipcChannels';
import type { RingOpenPayload } from '../shared/types';

const electronHarness = vi.hoisted(() => ({
  exposedApi: null as any,
  listeners: new Map<string, Array<(...args: any[]) => void>>(),
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electronHarness.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: electronHarness.invoke,
    on: electronHarness.on,
    removeListener: electronHarness.removeListener,
    send: electronHarness.send,
  },
}));

const ringOpenPayload = (ringSessionId: string): RingOpenPayload => ({
  ringSessionId,
  triggerMode: 'A',
  ringSize: 'medium',
  accentColor: '#ff0000',
  accentFillColor: '#ff0000',
  accentForegroundColor: '#ffffff',
  bubbleSurface: {
    fill: '#202020',
    surfaceHover: '#303030',
    stroke: '#404040',
    borderHover: '#505050',
    adjustmentFill: '#ff0000',
    onSurface: '#ffffff',
  },
  bubbles: [],
  systemState: {
    volumeLevel: 0.5,
    isMuted: false,
    brightnessLevel: 0.5,
    isPlaying: false,
  },
});

function emit(channel: string, ...args: any[]): void {
  for (const listener of electronHarness.listeners.get(channel) ?? []) {
    listener({}, ...args);
  }
}

async function loadApi(): Promise<any> {
  electronHarness.exposeInMainWorld.mockImplementation((_name, api) => {
    electronHarness.exposedApi = api;
  });
  electronHarness.on.mockImplementation((channel, listener) => {
    const listeners = electronHarness.listeners.get(channel) ?? [];
    listeners.push(listener);
    electronHarness.listeners.set(channel, listeners);
  });
  electronHarness.removeListener.mockImplementation((channel, listener) => {
    const listeners = electronHarness.listeners.get(channel) ?? [];
    electronHarness.listeners.set(
      channel,
      listeners.filter((candidate) => candidate !== listener)
    );
  });
  electronHarness.invoke.mockResolvedValue({ status: 'success', success: true });

  await import('./overlay');
  return electronHarness.exposedApi;
}

describe('overlay preload ring-session boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    electronHarness.exposedApi = null;
    electronHarness.listeners.clear();
  });

  it('overwrites a renderer-supplied session ID with the active ring-open ID', async () => {
    const api = await loadApi();
    const onOpen = vi.fn();
    api.onRingOpen(onOpen);
    emit(RING_OPEN, ringOpenPayload('captured-session'));

    await api.executeAction({
      bubbleId: 'group',
      actionType: 'keyboard-shortcut',
      payload: 'Ctrl+G',
      ringSessionId: 'renderer-forged-session',
    });

    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ ringSessionId: 'captured-session' })
    );
    expect(electronHarness.invoke).toHaveBeenCalledWith(
      ACTION_EXECUTE,
      expect.objectContaining({
        bubbleId: 'group',
        ringSessionId: 'captured-session',
      })
    );
  });

  it('keeps a new session active when an older direct close animation completes', async () => {
    const api = await loadApi();
    api.onRingOpen(vi.fn());
    emit(RING_OPEN, ringOpenPayload('old-session'));

    api.closeOverlay();
    expect(electronHarness.send).toHaveBeenLastCalledWith(
      OVERLAY_CLOSE,
      'old-session'
    );

    emit(RING_OPEN, ringOpenPayload('new-session'));
    api.notifyAnimationComplete();

    expect(electronHarness.send).toHaveBeenLastCalledWith(
      OVERLAY_ANIMATION_COMPLETE,
      'old-session'
    );

    await api.executeAction({
      bubbleId: 'new-action',
      actionType: 'do-nothing',
      ringSessionId: 'old-session',
    });
    expect(electronHarness.invoke).toHaveBeenLastCalledWith(
      ACTION_EXECUTE,
      expect.objectContaining({ ringSessionId: 'new-session' })
    );
  });

  it('does not relabel an old animation completion when the newer ring is also closing', async () => {
    const api = await loadApi();
    api.onRingOpen(vi.fn());

    emit(RING_OPEN, ringOpenPayload('old-session'));
    api.closeOverlay();
    emit(RING_OPEN, ringOpenPayload('new-session'));
    api.closeOverlay();
    api.notifyAnimationComplete();

    expect(electronHarness.send).toHaveBeenNthCalledWith(
      1,
      OVERLAY_CLOSE,
      'old-session'
    );
    expect(electronHarness.send).toHaveBeenNthCalledWith(
      2,
      OVERLAY_CLOSE,
      'new-session'
    );
    expect(electronHarness.send).toHaveBeenNthCalledWith(
      3,
      OVERLAY_ANIMATION_COMPLETE,
      'old-session'
    );

    await api.executeAction({
      bubbleId: 'new-action',
      actionType: 'do-nothing',
    });
    expect(electronHarness.invoke).toHaveBeenLastCalledWith(
      ACTION_EXECUTE,
      expect.objectContaining({ ringSessionId: 'new-session' })
    );
  });

  it('snapshots the session being closed by main so its animation cannot clear a newer ring', async () => {
    const api = await loadApi();
    api.onRingOpen(vi.fn());
    api.onRingClose(vi.fn());

    emit(RING_OPEN, ringOpenPayload('old-session'));
    emit(RING_CLOSE);
    emit(RING_OPEN, ringOpenPayload('new-session'));
    api.notifyAnimationComplete();

    expect(electronHarness.send).toHaveBeenLastCalledWith(
      OVERLAY_ANIMATION_COMPLETE,
      'old-session'
    );

    await api.executeAction({
      bubbleId: 'new-action',
      actionType: 'do-nothing',
    });
    expect(electronHarness.invoke).toHaveBeenLastCalledWith(
      ACTION_EXECUTE,
      expect.objectContaining({ ringSessionId: 'new-session' })
    );
  });

  it('returns a main-generated outside-click close ID without losing the ring session boundary', async () => {
    const api = await loadApi();
    api.onRingOpen(vi.fn());
    api.onRingClose(vi.fn());

    emit(RING_OPEN, ringOpenPayload('ring-session'));
    emit(RING_CLOSE, 'outside-close');
    api.notifyAnimationComplete();

    expect(electronHarness.send).toHaveBeenLastCalledWith(
      OVERLAY_ANIMATION_COMPLETE,
      'outside-close'
    );

    await api.executeAction({
      bubbleId: 'stale-action',
      actionType: 'do-nothing',
    });
    expect(electronHarness.invoke).toHaveBeenLastCalledWith(
      ACTION_EXECUTE,
      expect.objectContaining({ ringSessionId: undefined })
    );
  });
});
