import { beforeEach, describe, expect, it, vi } from 'vitest';

// Make the foreground query report THIS process (as if the Action Ring's own
// overlay/catcher were foreground). getForegroundApp must refuse to cache it.
vi.mock('child_process', () => ({
  execFile: (
    _file: string,
    _args: string[],
    _options: unknown,
    callback: (error: null, result: { stdout: string; stderr: string }) => void
  ) => {
    callback(null, {
      stdout: JSON.stringify({
        Name: 'lolgi-actions-ring',
        Path: process.execPath,
        Title: 'Lolgi Action Ring',
        Hwnd: '9001',
        Pid: process.pid,
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
  getForegroundApp,
} from './foregroundApp';

describe('foreground self-filter (F-01/F-02)', () => {
  beforeEach(() => {
    __foregroundTrackerTestApi.reset();
  });

  it("never caches the Action Ring's own window as the foreground app", async () => {
    const result = await getForegroundApp();
    // The own-process sample is ignored, so the previously cached external app
    // (null on cold start here) is left untouched rather than poisoned.
    expect(getCachedForegroundApp()).toBeNull();
    expect(result).toBeNull();
  });
});
