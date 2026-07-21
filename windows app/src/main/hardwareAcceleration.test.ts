import { describe, expect, it, vi } from 'vitest';
import {
  getGraphicsAccelerationStatus,
  initializeHardwareAcceleration,
  waitForGraphicsAccelerationStatus,
} from './hardwareAcceleration';

function createApp(gpuStatus: Record<string, string> = {
  gpu_compositing: 'enabled',
  rasterization: 'enabled',
}) {
  let gpuInfoListener: (() => void) | undefined;
  const app = {
    disableHardwareAcceleration: vi.fn(),
    getGPUFeatureStatus: vi.fn(() => gpuStatus),
    once: vi.fn((_event: string, listener: () => void) => {
      gpuInfoListener = listener;
    }),
  };
  return { app, emitGpuInfoUpdate: () => gpuInfoListener?.() };
}

describe('hardware acceleration startup', () => {
  it('disables Electron acceleration before readiness only when the startup preference is false', () => {
    const { app } = createApp();

    initializeHardwareAcceleration(app, false);

    expect(app.disableHardwareAcceleration).toHaveBeenCalledOnce();
    expect(app.once).toHaveBeenCalledWith('gpu-info-update', expect.any(Function));
    expect(getGraphicsAccelerationStatus(false)).toMatchObject({
      preferenceEnabled: false,
      startupPreferenceEnabled: false,
      restartRequired: false,
      statusReady: false,
      hardwareAccelerationEnabled: null,
    });
  });

  it('leaves Electron defaults enabled and reports cached GPU capabilities after gpu-info-update', () => {
    const { app, emitGpuInfoUpdate } = createApp();

    initializeHardwareAcceleration(app, true);
    emitGpuInfoUpdate();

    expect(app.disableHardwareAcceleration).not.toHaveBeenCalled();
    expect(getGraphicsAccelerationStatus(false)).toEqual({
      preferenceEnabled: false,
      startupPreferenceEnabled: true,
      restartRequired: true,
      statusReady: true,
      hardwareAccelerationEnabled: true,
      gpuCompositing: 'enabled',
      rasterization: 'enabled',
    });
  });

  it('waits for the one-time GPU report before returning the first dashboard status', async () => {
    const { app, emitGpuInfoUpdate } = createApp();
    initializeHardwareAcceleration(app, true);

    const pendingStatus = waitForGraphicsAccelerationStatus(true, 100);
    emitGpuInfoUpdate();

    await expect(pendingStatus).resolves.toMatchObject({
      statusReady: true,
      gpuCompositing: 'enabled',
    });
  });

  it('reports unavailable acceleration when Electron omits GPU feature fields', () => {
    const { app, emitGpuInfoUpdate } = createApp({});

    initializeHardwareAcceleration(app, true);
    expect(emitGpuInfoUpdate).not.toThrow();

    expect(getGraphicsAccelerationStatus(true)).toMatchObject({
      statusReady: true,
      hardwareAccelerationEnabled: false,
      gpuCompositing: null,
      rasterization: null,
    });
  });
});
