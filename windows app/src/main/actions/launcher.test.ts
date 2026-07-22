import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  getApplicationInfoForProtocol: vi.fn(),
  getCachedForegroundApp: vi.fn(() => null),
  openExternal: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getApplicationInfoForProtocol: mocks.getApplicationInfoForProtocol },
  shell: { openExternal: mocks.openExternal, openPath: vi.fn() },
}));
vi.mock('child_process', () => ({ exec: mocks.exec, spawn: vi.fn() }));
vi.mock('../utils/foregroundApp', () => ({ getCachedForegroundApp: mocks.getCachedForegroundApp }));

import { openUrl } from './launcher';

describe('URL launcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApplicationInfoForProtocol.mockResolvedValue({
      path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    });
    mocks.openExternal.mockResolvedValue(undefined);
    mocks.exec.mockImplementation((_command, _options, callback) => {
      callback(null, { stdout: 'OK', stderr: '' });
    });
  });

  it('focuses the remembered browser when the same URL is clicked again', async () => {
    await openUrl('https://www.youtube.com');
    await openUrl('https://www.youtube.com');

    expect(mocks.openExternal).toHaveBeenCalledTimes(1);
    expect(mocks.openExternal).toHaveBeenCalledWith('https://www.youtube.com/');
    expect(mocks.exec).toHaveBeenCalledTimes(1);
  });

  it.each(['javascript:alert(1)', 'file:///C:/secret.txt', 'data:text/plain,hello'])(
    'rejects the unsafe protocol in %s',
    async (url) => {
      await expect(openUrl(url)).rejects.toThrow();
      expect(mocks.openExternal).not.toHaveBeenCalled();
    },
  );

  it('allows mailto links through the system handler', async () => {
    await openUrl('mailto:hello@example.com');

    expect(mocks.openExternal).toHaveBeenCalledWith('mailto:hello@example.com');
  });
});
