import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// In-memory cache — populated lazily on first async read
let cachedBrightness = 0.5;
let confirmedBrightness = cachedBrightness;
let pendingBrightnessWrite: number | null = null;
let brightnessWritePromise: Promise<void> | null = null;

function clampBrightness(level: number): number {
  return Math.min(1, Math.max(0, level));
}

async function setSystemBrightness(level: number): Promise<void> {
  const percent = Math.round(clampBrightness(level) * 100);
  await execAsync(
    `powershell -NoProfile -NonInteractive -Command "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, ${percent})"`,
    { timeout: 3000 }
  );
}

function scheduleSystemBrightness(level: number): Promise<void> {
  pendingBrightnessWrite = clampBrightness(level);

  if (!brightnessWritePromise) {
    brightnessWritePromise = (async () => {
      while (pendingBrightnessWrite !== null) {
        const target = pendingBrightnessWrite;
        pendingBrightnessWrite = null;
        await setSystemBrightness(target);
        confirmedBrightness = target;
      }
    })().catch((error) => {
      pendingBrightnessWrite = null;
      cachedBrightness = confirmedBrightness;
      throw error;
    }).finally(() => {
      brightnessWritePromise = null;
    });
  }

  return brightnessWritePromise;
}

/**
 * Returns the cached brightness instantly — no PowerShell call.
 * Safe to call from hot paths (IPC handlers, ring open).
 */
export function getBrightness(): number {
  return cachedBrightness;
}

/**
 * Async version — queries PowerShell WMI and updates the cache.
 * Note: WMI brightness only works for laptop built-in displays.
 * External monitors keep the cached fallback value.
 */
export async function getBrightnessAsync(): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -NonInteractive -Command "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness"`,
      { timeout: 3000 }
    );
    const val = parseInt(stdout.trim(), 10);
    if (!isNaN(val)) {
      cachedBrightness = clampBrightness(val / 100);
      confirmedBrightness = cachedBrightness;
    }
  } catch {
    // Keep cached value — may be an external monitor or unsupported hardware
  }
  return cachedBrightness;
}

// Kick off an initial background read so the cache is warm before the first ring open
getBrightnessAsync().catch(() => {});

/**
 * Set display brightness (0..1) via PowerShell WMI.
 * Updates the cache optimistically so subsequent getBrightness() calls reflect
 * the intended value while the PowerShell command runs in the background.
 */
export async function setBrightness(level: number): Promise<void> {
  const clamped = clampBrightness(level);
  // Optimistic cache update so the UI reflects the change immediately
  cachedBrightness = clamped;
  try {
    await scheduleSystemBrightness(clamped);
  } catch (error) {
    throw new Error(
      `Brightness control is unavailable for this display: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function brightnessUp(): Promise<void> {
  await setBrightness(Math.min(1, cachedBrightness + 0.1));
}

export async function brightnessDown(): Promise<void> {
  await setBrightness(Math.max(0, cachedBrightness - 0.1));
}
