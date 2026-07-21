import type { GraphicsAccelerationStatus } from '../shared/types';

interface GraphicsApp {
  disableHardwareAcceleration(): void;
  getGPUFeatureStatus(): unknown;
  once(event: 'gpu-info-update', listener: () => void): unknown;
}

let startupPreferenceEnabled = true;
let statusReady = false;
let hardwareAccelerationEnabled: boolean | null = null;
let gpuCompositing: string | null = null;
let rasterization: string | null = null;
let statusReadyPromise: Promise<void> = Promise.resolve();
let resolveStatusReady: (() => void) | null = null;

/**
 * Must run before app.whenReady(). Electron cannot change this setting live.
 */
export function initializeHardwareAcceleration(
  electronApp: GraphicsApp,
  preferenceEnabled: boolean
): void {
  startupPreferenceEnabled = preferenceEnabled;
  statusReady = false;
  hardwareAccelerationEnabled = null;
  gpuCompositing = null;
  rasterization = null;
  statusReadyPromise = new Promise((resolve) => {
    resolveStatusReady = resolve;
  });

  if (!preferenceEnabled) electronApp.disableHardwareAcceleration();

  electronApp.once('gpu-info-update', () => {
    const status = electronApp.getGPUFeatureStatus() as Record<string, string>;
    statusReady = true;
    gpuCompositing = status.gpu_compositing ?? null;
    rasterization = status.rasterization ?? null;
    // GPU compositing is the renderer path the whole ring uses. Electron 33
    // exposes it through getGPUFeatureStatus(), not a typed boolean accessor.
    hardwareAccelerationEnabled = gpuCompositing?.startsWith('enabled') ?? false;
    resolveStatusReady?.();
    resolveStatusReady = null;
  });
}

export function getGraphicsAccelerationStatus(
  preferenceEnabled: boolean
): GraphicsAccelerationStatus {
  return {
    preferenceEnabled,
    startupPreferenceEnabled,
    restartRequired: preferenceEnabled !== startupPreferenceEnabled,
    statusReady,
    hardwareAccelerationEnabled,
    gpuCompositing,
    rasterization,
  };
}

/** Wait briefly for Electron's one-time GPU report so the first dashboard read is useful. */
export async function waitForGraphicsAccelerationStatus(
  preferenceEnabled: boolean,
  timeoutMs = 2_000
): Promise<GraphicsAccelerationStatus> {
  if (!statusReady) {
    await Promise.race([
      statusReadyPromise,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }
  return getGraphicsAccelerationStatus(preferenceEnabled);
}
