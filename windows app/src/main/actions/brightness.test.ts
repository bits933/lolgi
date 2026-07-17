import { beforeEach, describe, expect, it, vi } from 'vitest';

const childProcessMock = vi.hoisted(() => ({
  exec: vi.fn(),
}));

vi.mock('child_process', () => ({ exec: childProcessMock.exec }));

import { getBrightness, getBrightnessAsync, setBrightness } from './brightness';

function resolveExec(stdout = ''): void {
  childProcessMock.exec.mockImplementation((_command, _options, callback) => {
    callback(null, { stdout, stderr: '' });
  });
}

describe('brightness state writes', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resolveExec('50');
    await getBrightnessAsync();
    vi.clearAllMocks();
  });

  it('rolls an optimistic value back when Windows rejects the write', async () => {
    childProcessMock.exec.mockImplementationOnce((_command, _options, callback) => {
      callback(new Error('Unsupported display'));
    });

    await expect(setBrightness(0.7)).rejects.toThrow('Brightness control is unavailable');
    expect(getBrightness()).toBe(0.5);
  });

  it('coalesces rapid changes and keeps the latest confirmed value', async () => {
    const callbacks: Array<(error: Error | null, result?: { stdout: string; stderr: string }) => void> = [];
    childProcessMock.exec.mockImplementation((_command, _options, callback) => {
      callbacks.push(callback);
    });

    const first = setBrightness(0.6);
    const second = setBrightness(0.8);

    expect(childProcessMock.exec).toHaveBeenCalledTimes(1);
    callbacks.shift()?.(null, { stdout: '', stderr: '' });
    await vi.waitFor(() => expect(childProcessMock.exec).toHaveBeenCalledTimes(2));
    callbacks.shift()?.(null, { stdout: '', stderr: '' });

    await Promise.all([first, second]);
    expect(getBrightness()).toBe(0.8);
  });
});
