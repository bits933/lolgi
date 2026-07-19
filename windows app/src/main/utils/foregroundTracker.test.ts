import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ForegroundWindowTarget } from '../../shared/types';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

import {
  __foregroundTrackerTestApi,
  getCachedForegroundApp,
  getForegroundTrackerSnapshot,
  registerOwnedWindowHandle,
  setForegroundPollingBusy,
  unregisterOwnedWindowHandle,
} from './foregroundApp';

function target(
  processName: string,
  processId: number,
  windowHandle: string
): ForegroundWindowTarget {
  return {
    processName,
    processId,
    windowHandle,
    executablePath: `C:/${processName}/${processName}.exe`,
    windowTitle: `${processName} document`,
  };
}

function watcherLine(
  value: ForegroundWindowTarget,
  sourceSequence: number,
  source: 'snapshot' | 'event' = 'event',
  observedAt = sourceSequence * 100
): string {
  return JSON.stringify({
    kind: 'foreground',
    source,
    sourceSequence,
    observedAt,
    ...value,
  });
}

describe('event-driven foreground tracker', () => {
  beforeEach(() => {
    __foregroundTrackerTestApi.reset();
  });

  it('applies ordered helper messages with monotonic Node generations', () => {
    const figma = target('Figma', 101, '4101');
    const chrome = target('chrome', 202, '4202');

    expect(__foregroundTrackerTestApi.applyWatcherLine(watcherLine(figma, 1, 'snapshot'))).toBe(true);
    expect(__foregroundTrackerTestApi.applyWatcherLine(watcherLine(chrome, 2))).toBe(true);

    const snapshot = getForegroundTrackerSnapshot();
    expect(snapshot.generation).toBe(2);
    expect(snapshot.rawForeground).toMatchObject({
      processName: 'chrome',
      generation: 2,
      source: 'event',
    });
    expect(snapshot.lastExternalForeground).toMatchObject({
      processName: 'chrome',
      generation: 2,
    });
  });

  it('rejects duplicate and out-of-order helper sequence numbers', () => {
    const figma = target('Figma', 101, '4101');
    const chrome = target('chrome', 202, '4202');

    expect(__foregroundTrackerTestApi.applyWatcherLine(watcherLine(figma, 7))).toBe(true);
    expect(__foregroundTrackerTestApi.applyWatcherLine(watcherLine(chrome, 7))).toBe(false);
    expect(__foregroundTrackerTestApi.applyWatcherLine(watcherLine(chrome, 6))).toBe(false);
    expect(getCachedForegroundApp()?.processName).toBe('Figma');
    expect(getForegroundTrackerSnapshot().generation).toBe(1);
  });

  it('filters this exact PID and registered native HWNDs', () => {
    const figma = target('Figma', 101, '4101');
    const ownPid = target('renamed-host', process.pid, '4999');
    const ownedHandle = target('some-other-name', 303, '4888');

    __foregroundTrackerTestApi.observe(figma);
    __foregroundTrackerTestApi.observe(ownPid);
    expect(getCachedForegroundApp()).toMatchObject({ processName: 'Figma' });

    expect(registerOwnedWindowHandle('4888')).toBe('4888');
    __foregroundTrackerTestApi.observe(ownedHandle);
    expect(getCachedForegroundApp()).toMatchObject({ processName: 'Figma' });

    unregisterOwnedWindowHandle('4888');
    __foregroundTrackerTestApi.observe(ownedHandle);
    expect(getCachedForegroundApp()).toMatchObject({ processName: 'some-other-name' });
  });

  it('does not broadly suppress an unrelated Electron application', () => {
    const unrelatedElectron = target('electron', process.pid + 1000, '4777');

    __foregroundTrackerTestApi.observe(unrelatedElectron);

    expect(getCachedForegroundApp()).toMatchObject({
      processName: 'electron',
      processId: process.pid + 1000,
      windowHandle: '4777',
    });
  });

  it('keeps raw foreground separate while suspended and safely promotes on resume', () => {
    const figma = target('Figma', 101, '4101');
    const ownOverlay = target('logi-actions-ring', process.pid, '4999');
    const chrome = target('chrome', 202, '4202');

    __foregroundTrackerTestApi.observe(figma);
    setForegroundPollingBusy(true);
    __foregroundTrackerTestApi.observe(ownOverlay);

    expect(getForegroundTrackerSnapshot().rawForeground?.processId).toBe(process.pid);
    expect(getCachedForegroundApp()?.processName).toBe('Figma');

    __foregroundTrackerTestApi.observe(chrome);
    expect(getForegroundTrackerSnapshot().rawForeground?.processName).toBe('chrome');
    expect(getCachedForegroundApp()?.processName).toBe('Figma');

    setForegroundPollingBusy(false);
    expect(getCachedForegroundApp()?.processName).toBe('chrome');
    expect(getForegroundTrackerSnapshot().suspensionDepth).toBe(0);
  });

  it('uses suspension depth and only resumes after the final release', () => {
    const figma = target('Figma', 101, '4101');
    const chrome = target('chrome', 202, '4202');

    __foregroundTrackerTestApi.observe(figma);
    setForegroundPollingBusy(true);
    setForegroundPollingBusy(true);
    __foregroundTrackerTestApi.observe(chrome);
    setForegroundPollingBusy(false);
    expect(getCachedForegroundApp()?.processName).toBe('Figma');
    expect(getForegroundTrackerSnapshot().suspensionDepth).toBe(1);

    setForegroundPollingBusy(false);
    expect(getCachedForegroundApp()?.processName).toBe('chrome');
  });

  it('rejects a delayed one-shot result after a newer event generation', () => {
    const figma = target('Figma', 101, '4101');
    const chrome = target('chrome', 202, '4202');
    const token = __foregroundTrackerTestApi.beginOneShot();

    __foregroundTrackerTestApi.observe(chrome);

    expect(__foregroundTrackerTestApi.completeOneShot(token, figma)).toBe(false);
    expect(getCachedForegroundApp()?.processName).toBe('chrome');
    expect(getForegroundTrackerSnapshot().generation).toBe(1);
  });

  it('never overwrites the last external target with null or an owned target', () => {
    const figma = target('Figma', 101, '4101');
    const ownOverlay = target('logi-actions-ring', process.pid, '4999');

    __foregroundTrackerTestApi.observe(figma);
    __foregroundTrackerTestApi.observe(null);
    expect(getCachedForegroundApp()?.processName).toBe('Figma');

    __foregroundTrackerTestApi.observe(ownOverlay);
    expect(getCachedForegroundApp()?.processName).toBe('Figma');
  });

  it('preserves Figma through more than five repeated owned overlay observations', () => {
    const figma = target('Figma', 101, '4101');
    const ownProcessOverlay = target('logi-actions-ring', process.pid, '4998');
    const ownedHandleOverlay = target('renderer-host', 303, '4999');

    registerOwnedWindowHandle(ownedHandleOverlay.windowHandle);
    __foregroundTrackerTestApi.observe(figma, 'snapshot', 100);

    for (let cycle = 1; cycle <= 8; cycle += 1) {
      __foregroundTrackerTestApi.observe(
        cycle % 2 === 0 ? ownedHandleOverlay : ownProcessOverlay,
        'event',
        100 + cycle
      );
      expect(getCachedForegroundApp()).toMatchObject({
        processName: 'Figma',
        processId: 101,
        windowHandle: '4101',
      });
    }

    expect(getForegroundTrackerSnapshot()).toMatchObject({
      generation: 9,
      rawForeground: {
        processName: 'renderer-host',
        generation: 9,
      },
      lastExternalForeground: {
        processName: 'Figma',
        generation: 1,
        observedAt: 100,
      },
    });
  });

  it('redacts executable paths and window titles from diagnostic snapshots', () => {
    __foregroundTrackerTestApi.observe(target('Figma', 101, '4101'));

    const snapshotText = JSON.stringify(getForegroundTrackerSnapshot());
    expect(snapshotText).not.toContain('C:/Figma/Figma.exe');
    expect(snapshotText).not.toContain('Figma document');
    expect(getForegroundTrackerSnapshot().lastExternalForeground).toMatchObject({
      processName: 'Figma',
      processId: 101,
      windowHandle: '4101',
    });
  });
});
