import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock child_process so getForegroundApp resolves a deterministic foreground app
// without spawning PowerShell. promisify(execFile) resolves with the callback's
// second argument, so we hand back a { stdout } object.
vi.mock('child_process', () => ({
  execFile: (
    _file: string,
    _args: string[],
    _options: unknown,
    callback: (error: null, result: { stdout: string; stderr: string }) => void
  ) => {
    callback(null, {
      stdout: JSON.stringify({
        Name: 'figma',
        Path: 'C:/Figma/Figma.exe',
        Title: 'Figma',
        Hwnd: '4242',
        Pid: 101,
      }),
      stderr: '',
    });
    return undefined as never;
  },
  spawn: vi.fn(),
}));

import {
  __foregroundTrackerTestApi,
  getCachedForegroundApp,
  getCachedForegroundAppAge,
  getForegroundApp,
} from './foregroundApp';

describe('foreground cache freshness (M-05)', () => {
  beforeEach(() => {
    __foregroundTrackerTestApi.reset();
  });

  it('treats the cache as infinitely stale before any successful query', () => {
    expect(getCachedForegroundAppAge()).toBe(Number.POSITIVE_INFINITY);
  });

  it('populates the cache and resets its age after a query', async () => {
    await getForegroundApp();
    expect(getCachedForegroundApp()?.processName).toBe('figma');
    expect(getCachedForegroundAppAge()).toBeLessThan(1000);
  });
});
