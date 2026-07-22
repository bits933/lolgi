import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const childProcessMocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: childProcessMocks.execFile,
  spawn: childProcessMocks.spawn,
}));

import {
  __foregroundTrackerTestApi,
  getCachedForegroundApp,
  getForegroundAppForTrigger,
  getForegroundTrackerSnapshot,
  startForegroundAppWatcher,
  stopForegroundAppWatcher,
} from './foregroundApp';

class FakeWatcherChild extends EventEmitter {
  readonly pid: number;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  private inputText = '';
  readonly kill = vi.fn(() => {
    this.emit('close', null, 'SIGTERM');
    return true;
  });

  constructor(pid: number) {
    super();
    this.pid = pid;
    this.stdin.on('data', (chunk) => {
      this.inputText += chunk.toString('utf8');
    });
  }

  latestRequestId(): string {
    const lines = this.inputText.trim().split(/\r?\n/);
    const latest = lines.at(-1) ?? '';
    const [command, requestId] = latest.split('\t');
    if (command !== 'snapshot' || !requestId) throw new Error('No snapshot request received');
    return requestId;
  }

  emitForeground(
    processName: string,
    processId: number,
    windowHandle: string,
    options: {
      source?: 'snapshot' | 'event' | 'barrier';
      sourceSequence?: number;
      requestId?: string;
    } = {}
  ): void {
    this.stdout.write(`${JSON.stringify({
      kind: 'foreground',
      source: options.source ?? 'snapshot',
      sourceSequence: options.sourceSequence ?? 1,
      ...(options.requestId ? { requestId: options.requestId } : {}),
      observedAt: Date.now(),
      processName,
      processId,
      windowHandle,
      executablePath: `C:/${processName}.exe`,
      windowTitle: `${processName} window`,
    })}\n`);
  }
}

const watcherDescribe = process.platform === 'win32' ? describe : describe.skip;

watcherDescribe('persistent foreground helper lifecycle', () => {
  const children: FakeWatcherChild[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    __foregroundTrackerTestApi.reset();
    children.length = 0;
    childProcessMocks.spawn.mockReset();
    childProcessMocks.execFile.mockReset();
    childProcessMocks.spawn.mockImplementation(() => {
      const child = new FakeWatcherChild(70_000 + children.length);
      children.push(child);
      return child;
    });
    childProcessMocks.execFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: null, result: { stdout: string; stderr: string }) => void
      ) => {
        callback(null, {
          stdout: JSON.stringify({
            Name: 'Figma',
            Path: 'C:/Figma/Figma.exe',
            Title: 'Figma fallback',
            Hwnd: '5101',
            Pid: 501,
          }),
          stderr: '',
        });
        return undefined as never;
      }
    );
  });

  afterEach(() => {
    stopForegroundAppWatcher();
    vi.useRealTimers();
  });

  it('starts one hidden helper, becomes ready on its snapshot, and stops cleanly', async () => {
    const ready = startForegroundAppWatcher();

    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(1);
    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining(['-EncodedCommand']),
      expect.objectContaining({ windowsHide: true })
    );

    children[0].emitForeground('Figma', 101, '4101');
    await ready;

    expect(getCachedForegroundApp()).toMatchObject({
      processName: 'Figma',
      processId: 101,
      windowHandle: '4101',
    });
    expect(getForegroundTrackerSnapshot().watcher.running).toBe(true);
    expect(getForegroundTrackerSnapshot().ownedProcessIds).toContain(children[0].pid);

    stopForegroundAppWatcher();
    expect(children[0].kill).toHaveBeenCalledTimes(1);
    expect(getForegroundTrackerSnapshot().watcher.running).toBe(false);
    expect(getForegroundTrackerSnapshot().ownedProcessIds).not.toContain(children[0].pid);
  });

  it('barriers immediate Figma-to-other-app and reverse switches on the same helper', async () => {
    const ready = startForegroundAppWatcher();
    children[0].emitForeground('Figma', 101, '4101');
    await ready;

    const chromeResult = getForegroundAppForTrigger();
    const chromeRequestId = children[0].latestRequestId();
    children[0].emitForeground('chrome', 202, '4202', {
      source: 'barrier',
      sourceSequence: 2,
      requestId: chromeRequestId,
    });
    await expect(chromeResult).resolves.toMatchObject({
      processName: 'chrome',
      processId: 202,
      windowHandle: '4202',
    });

    const figmaResult = getForegroundAppForTrigger();
    const figmaRequestId = children[0].latestRequestId();
    children[0].emitForeground('Figma', 101, '4101', {
      source: 'barrier',
      sourceSequence: 3,
      requestId: figmaRequestId,
    });
    await expect(figmaResult).resolves.toMatchObject({
      processName: 'Figma',
      processId: 101,
      windowHandle: '4101',
    });
    expect(getForegroundTrackerSnapshot().generation).toBe(3);
    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(1);
    expect(childProcessMocks.execFile).not.toHaveBeenCalled();
  });

  it('falls back to the freshest event cache when the trigger barrier times out', async () => {
    const ready = startForegroundAppWatcher();
    children[0].emitForeground('Figma', 101, '4101');
    await ready;

    const result = getForegroundAppForTrigger(80);
    children[0].emitForeground('chrome', 202, '4202', {
      source: 'event',
      sourceSequence: 2,
    });
    await vi.advanceTimersByTimeAsync(79);
    expect(childProcessMocks.execFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toMatchObject({
      processName: 'chrome',
      processId: 202,
      windowHandle: '4202',
    });
    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(1);
  });

  it('uses the verified external cache on timeout when our own window is foreground', async () => {
    const ready = startForegroundAppWatcher();
    children[0].emitForeground('Figma', 101, '4101');
    await ready;
    children[0].emitForeground('lolgi-actions-ring', process.pid, '4999', {
      source: 'event',
      sourceSequence: 2,
    });

    const result = getForegroundAppForTrigger(80);
    await vi.advanceTimersByTimeAsync(80);

    await expect(result).resolves.toMatchObject({
      processName: 'Figma',
      processId: 101,
      windowHandle: '4101',
    });
    expect(getCachedForegroundApp()?.processName).toBe('Figma');
  });

  it('rejects a stale correlated response without overwriting newer event evidence', async () => {
    const ready = startForegroundAppWatcher();
    children[0].emitForeground('Figma', 101, '4101');
    await ready;

    const result = getForegroundAppForTrigger();
    const requestId = children[0].latestRequestId();
    children[0].emitForeground('chrome', 202, '4202', {
      source: 'event',
      sourceSequence: 3,
    });
    children[0].emitForeground('Figma', 101, '4101', {
      source: 'barrier',
      sourceSequence: 2,
      requestId,
    });

    await expect(result).resolves.toMatchObject({
      processName: 'chrome',
      processId: 202,
      windowHandle: '4202',
    });
    expect(getCachedForegroundApp()?.processName).toBe('chrome');
    expect(getForegroundTrackerSnapshot().generation).toBe(2);
  });

  it.each([50, 500, 1000, 2000])(
    'bounds a stale barrier delayed by %i ms, fails closed, and preserves Figma',
    async (responseDelayMs) => {
      const ready = startForegroundAppWatcher();
      children[0].emitForeground('Figma', 101, '4101', {
        sourceSequence: 1,
      });
      await ready;

      const result = getForegroundAppForTrigger(responseDelayMs);
      const requestId = children[0].latestRequestId();

      // Newer evidence says there is no usable foreground window. The older
      // correlated response must not revive its Chrome sample when it arrives.
      children[0].emitForeground('', 0, '0', {
        source: 'event',
        sourceSequence: 3,
      });
      setTimeout(() => {
        children[0].emitForeground('chrome', 202, '4202', {
          source: 'barrier',
          sourceSequence: 2,
          requestId,
        });
      }, responseDelayMs);

      let settled = false;
      void result.then(() => {
        settled = true;
      });
      const boundedDelayMs = Math.min(responseDelayMs, 200);
      await vi.advanceTimersByTimeAsync(boundedDelayMs - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
      await expect(result).resolves.toBeNull();

      await vi.advanceTimersByTimeAsync(responseDelayMs - boundedDelayMs);
      expect(getForegroundTrackerSnapshot()).toMatchObject({
        generation: 2,
        rawForeground: {
          processId: 0,
          windowHandle: '0',
          generation: 2,
        },
        lastExternalForeground: {
          processName: 'Figma',
          generation: 1,
        },
      });
      expect(getCachedForegroundApp()?.processName).toBe('Figma');
    }
  );

  it('resolves reversed concurrent barriers from the newest generation only', async () => {
    const ready = startForegroundAppWatcher();
    children[0].emitForeground('Figma', 101, '4101');
    await ready;

    const firstResult = getForegroundAppForTrigger();
    const firstRequestId = children[0].latestRequestId();
    const secondResult = getForegroundAppForTrigger();
    const secondRequestId = children[0].latestRequestId();

    children[0].emitForeground('chrome', 202, '4202', {
      source: 'barrier',
      sourceSequence: 3,
      requestId: secondRequestId,
    });
    await expect(secondResult).resolves.toMatchObject({
      processName: 'chrome',
      processId: 202,
      windowHandle: '4202',
    });

    children[0].emitForeground('slack', 303, '4303', {
      source: 'barrier',
      sourceSequence: 2,
      requestId: firstRequestId,
    });
    await expect(firstResult).resolves.toMatchObject({
      processName: 'chrome',
      processId: 202,
      windowHandle: '4202',
    });
    expect(getForegroundTrackerSnapshot()).toMatchObject({
      generation: 2,
      rawForeground: {
        processName: 'chrome',
        generation: 2,
      },
      lastExternalForeground: {
        processName: 'chrome',
        generation: 2,
      },
    });
  });

  it('resolves an owned helper snapshot through the verified external cache', async () => {
    const ready = startForegroundAppWatcher();
    children[0].emitForeground('Figma', 101, '4101');
    await ready;

    const result = getForegroundAppForTrigger();
    const requestId = children[0].latestRequestId();
    children[0].emitForeground('powershell', children[0].pid, '4999', {
      source: 'barrier',
      sourceSequence: 2,
      requestId,
    });

    await expect(result).resolves.toMatchObject({
      processName: 'Figma',
      processId: 101,
      windowHandle: '4101',
    });
    expect(getCachedForegroundApp()?.processName).toBe('Figma');
  });

  it('returns null for an owned helper snapshot when no external target exists', async () => {
    const ready = startForegroundAppWatcher();
    children[0].emitForeground('powershell', children[0].pid, '4999');
    await ready;

    const result = getForegroundAppForTrigger();
    const requestId = children[0].latestRequestId();
    children[0].emitForeground('powershell', children[0].pid, '4999', {
      source: 'barrier',
      sourceSequence: 2,
      requestId,
    });

    await expect(result).resolves.toBeNull();
    expect(getCachedForegroundApp()).toBeNull();
  });

  it('fails closed on a genuine no-window response even with older external cache', async () => {
    const ready = startForegroundAppWatcher();
    children[0].emitForeground('Figma', 101, '4101');
    await ready;

    const result = getForegroundAppForTrigger();
    const requestId = children[0].latestRequestId();
    children[0].emitForeground('', 0, '0', {
      source: 'barrier',
      sourceSequence: 2,
      requestId,
    });

    await expect(result).resolves.toBeNull();
    expect(getCachedForegroundApp()?.processName).toBe('Figma');
  });

  it('restarts with exponential backoff after short-lived helper failures', async () => {
    const ready = startForegroundAppWatcher();
    children[0].emitForeground('Figma', 101, '4101');
    await ready;

    children[0].emit('close', 1, null);
    expect(getForegroundTrackerSnapshot().ownedProcessIds).not.toContain(children[0].pid);
    await vi.advanceTimersByTimeAsync(249);
    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(2);
    expect(getForegroundTrackerSnapshot().ownedProcessIds).toContain(children[1].pid);

    children[1].emitForeground('chrome', 202, '4202');
    children[1].emit('close', 1, null);
    await vi.advanceTimersByTimeAsync(499);
    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(3);
    expect(getForegroundTrackerSnapshot().watcher.restartAttempt).toBe(2);
  });

  it('uses a bounded one-shot fallback when helper startup times out', async () => {
    const ready = startForegroundAppWatcher();

    await vi.advanceTimersByTimeAsync(2500);
    await ready;

    expect(children[0].kill).toHaveBeenCalledTimes(1);
    expect(getForegroundTrackerSnapshot().ownedProcessIds).not.toContain(children[0].pid);
    expect(getCachedForegroundApp()).toMatchObject({
      processName: 'Figma',
      processId: 501,
      windowHandle: '5101',
    });
    expect(getForegroundTrackerSnapshot().watcher.lastError).toBe('helper-startup-timeout');

    await vi.advanceTimersByTimeAsync(249);
    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(2);
  });

  it('unregisters an errored helper PID before its replacement starts', async () => {
    const ready = startForegroundAppWatcher();
    children[0].emitForeground('Figma', 101, '4101');
    await ready;

    children[0].emit('error', new Error('broken pipe'));
    expect(getForegroundTrackerSnapshot().ownedProcessIds).not.toContain(children[0].pid);

    await vi.advanceTimersByTimeAsync(250);
    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(2);
    expect(getForegroundTrackerSnapshot().ownedProcessIds).toContain(children[1].pid);
  });

  it('also times out a hung replacement helper and continues backing off', async () => {
    const ready = startForegroundAppWatcher();
    children[0].emitForeground('Figma', 101, '4101');
    await ready;

    children[0].emit('close', 1, null);
    await vi.advanceTimersByTimeAsync(250);
    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2500);
    expect(children[1].kill).toHaveBeenCalledTimes(1);
    expect(getForegroundTrackerSnapshot().ownedProcessIds).not.toContain(children[1].pid);
    await vi.advanceTimersByTimeAsync(499);
    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(3);
  });

  it('cancels a pending restart when stopped', async () => {
    const ready = startForegroundAppWatcher();
    children[0].emitForeground('Figma', 101, '4101');
    await ready;

    children[0].emit('close', 1, null);
    stopForegroundAppWatcher();
    await vi.advanceTimersByTimeAsync(5000);

    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(1);
    expect(getForegroundTrackerSnapshot().watcher.running).toBe(false);
  });
});
