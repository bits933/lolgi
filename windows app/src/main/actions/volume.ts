import loudness from 'loudness';

interface VolumeState {
  level: number;
  isMuted: boolean;
}

const VOLUME_STEP = 0.05;

let cachedVolumeState: VolumeState = { level: 0.5, isMuted: false };
let volumeStatePromise: Promise<VolumeState> | null = null;
let hasLoadedVolumeState = false;
let pendingVolumeWrite: number | null = null;
let volumeWritePromise: Promise<void> | null = null;
let confirmedVolumeLevel = cachedVolumeState.level;

function clampVolume(level: number): number {
  return Math.min(1, Math.max(0, level));
}

async function setSystemVolume(level: number): Promise<void> {
  try {
    await loudness.setVolume(Math.round(clampVolume(level) * 100));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`System volume is unavailable${detail ? `: ${detail}` : '.'}`);
  }
}

/**
 * Coalesce rapid wheel events while preserving write order. Callers receive the
 * active writer promise, so IPC only reports success after Windows is updated.
 */
function scheduleSystemVolume(level: number): Promise<void> {
  pendingVolumeWrite = clampVolume(level);

  if (!volumeWritePromise) {
    volumeWritePromise = (async () => {
      while (pendingVolumeWrite !== null) {
        const target = pendingVolumeWrite;
        pendingVolumeWrite = null;
        await setSystemVolume(target);
        confirmedVolumeLevel = target;
      }
    })().catch((error) => {
      pendingVolumeWrite = null;
      cachedVolumeState = { ...cachedVolumeState, level: confirmedVolumeLevel };
      throw error;
    }).finally(() => {
      volumeWritePromise = null;
    });
  }

  return volumeWritePromise!;
}

export function getVolumeState(): VolumeState {
  return cachedVolumeState;
}

export async function getVolumeStateAsync(): Promise<VolumeState> {
  if (volumeStatePromise) return volumeStatePromise;

  volumeStatePromise = (async () => {
    try {
      const [volume, isMuted] = await Promise.all([
        loudness.getVolume(),
        loudness.getMuted(),
      ]);
      cachedVolumeState = {
        level: clampVolume(volume / 100),
        isMuted,
      };
      confirmedVolumeLevel = cachedVolumeState.level;
      hasLoadedVolumeState = true;
    } catch {
      // Retain the last known state if Windows has no active audio endpoint.
    }

    return cachedVolumeState;
  })().finally(() => {
    volumeStatePromise = null;
  });

  return volumeStatePromise;
}

// Warm the cache before the first ring invocation.
getVolumeStateAsync().catch(() => {});

export async function volumeStep(steps: number, stepSize = VOLUME_STEP): Promise<void> {
  if (steps === 0) return;

  if (!hasLoadedVolumeState) {
    await getVolumeStateAsync();
  }

  const count = Math.min(50, Math.abs(steps));
  const normalizedStep = Math.min(0.2, Math.max(0.01, stepSize));
  const delta = (steps > 0 ? normalizedStep : -normalizedStep) * count;
  const level = clampVolume(cachedVolumeState.level + delta);
  cachedVolumeState = { ...cachedVolumeState, level };
  await scheduleSystemVolume(level);
}

export async function volumeUp(): Promise<void> {
  await volumeStep(1);
}

export async function volumeDown(): Promise<void> {
  await volumeStep(-1);
}

export async function toggleMute(): Promise<void> {
  const isMuted = await loudness.getMuted();
  await loudness.setMuted(!isMuted);
  cachedVolumeState = { ...cachedVolumeState, isMuted: !isMuted };
}

export async function setVolume(level: number): Promise<void> {
  const clamped = clampVolume(level);
  cachedVolumeState = { ...cachedVolumeState, level: clamped };
  await scheduleSystemVolume(clamped);
}
