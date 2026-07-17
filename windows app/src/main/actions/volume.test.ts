import { beforeEach, describe, expect, it, vi } from 'vitest';

const loudnessMock = vi.hoisted(() => ({
  getVolume: vi.fn(async () => 50),
  getMuted: vi.fn(async () => false),
  setVolume: vi.fn(async () => undefined),
  setMuted: vi.fn(async () => undefined),
}));

vi.mock('loudness', () => ({ default: loudnessMock }));

import { getVolumeState, getVolumeStateAsync, setVolume, volumeStep } from './volume';

describe('volume state writes', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    loudnessMock.getVolume.mockResolvedValue(50);
    loudnessMock.getMuted.mockResolvedValue(false);
    loudnessMock.setVolume.mockResolvedValue(undefined);
    await getVolumeStateAsync();
  });

  it('rolls an optimistic step back when Windows rejects the write', async () => {
    loudnessMock.setVolume.mockRejectedValueOnce(new Error('No audio endpoint'));

    await expect(volumeStep(1)).rejects.toThrow('System volume is unavailable');
    expect(getVolumeState().level).toBe(0.5);
  });

  it('rolls back to the latest confirmed level after a later write fails', async () => {
    await setVolume(0.7);
    expect(getVolumeState().level).toBe(0.7);

    loudnessMock.setVolume.mockRejectedValueOnce(new Error('Device disconnected'));
    await expect(setVolume(0.9)).rejects.toThrow('System volume is unavailable');
    expect(getVolumeState().level).toBe(0.7);
  });
});
