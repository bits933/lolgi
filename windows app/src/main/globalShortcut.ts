import { globalShortcut } from 'electron';
import { getCursorPosition, getOverlayOrigin } from './utils/cursorPosition';
import {
  getOverlayWindow,
  getRingWindowDiagnosticState,
  hideOverlay,
  showOverlay,
} from './windows';
import { getConfig } from './store';
import { getOverlayWindowSize } from '../shared/constants';
import { RING_OPEN, SYSTEM_STATE_UPDATED } from '../shared/ipcChannels';
import type { ForegroundAppInfo, ForegroundWindowTarget, RingOpenPayload, SystemState } from '../shared/types';
import { getSystemState } from './actions/index';
import { getVolumeState } from './actions/volume';
import { getBrightness } from './actions/brightness';
import {
  getCachedForegroundAppAge,
  getForegroundAppForTrigger,
  getForegroundTrackerSnapshot,
} from './utils/foregroundApp';
import { slotsToBubbles } from '../shared/profileUtils';
import { materializeFigmaActionsBinding } from '../shared/defaultProfiles';
import { resolveThemeColors } from '../shared/themeColors';
import {
  beginRingSession,
  endActiveRingSession,
  endRingSession,
  resolveRuntimeProfile,
} from './profileRuntime';
import { recordRingDiagnostic } from './actions/diagnostics';

let currentHotkey: string | null = null;
let hotkeyTriggerEpoch = 0;

function invalidatePendingHotkeyTriggers(): void {
  hotkeyTriggerEpoch += 1;
}

function asForegroundWindowTarget(
  foregroundApp: ForegroundAppInfo | null
): ForegroundWindowTarget | null {
  if (!foregroundApp) return null;
  const candidate = foregroundApp as Partial<ForegroundWindowTarget>;
  if (
    !Number.isInteger(candidate.processId) ||
    Number(candidate.processId) <= 0 ||
    typeof candidate.windowHandle !== 'string' ||
    !/^-?\d+$/.test(candidate.windowHandle) ||
    candidate.windowHandle === '0'
  ) {
    return null;
  }
  return { ...foregroundApp, processId: candidate.processId!, windowHandle: candidate.windowHandle };
}

/**
 * Register the global shortcut for triggering the ring.
 * Unregisters any previously registered shortcut first.
 */
export function registerHotkey(hotkey?: string): boolean {
  const config = getConfig();
  const key = hotkey ?? config.hotkey;
  const previousHotkey = currentHotkey;

  if (previousHotkey === key && globalShortcut.isRegistered(key)) return true;

  // Rebinding changes which native callback is authoritative. Any callback
  // already waiting on foreground resolution belongs to the old registration
  // and must not be allowed to open or hide a ring afterward.
  invalidatePendingHotkeyTriggers();

  // Unregister existing shortcut
  if (previousHotkey) {
    globalShortcut.unregister(previousHotkey);
    currentHotkey = null;
  }

  let success = false;
  try {
    success = globalShortcut.register(key, handleHotkeyTrigger);
  } catch {
    success = false;
  }
  if (success) {
    currentHotkey = key;
  } else if (previousHotkey) {
    try {
      if (globalShortcut.register(previousHotkey, handleHotkeyTrigger)) currentHotkey = previousHotkey;
    } catch {
      currentHotkey = null;
    }
  }

  return success;
}

export function unregisterHotkey(): void {
  invalidatePendingHotkeyTriggers();
  if (currentHotkey) {
    globalShortcut.unregister(currentHotkey);
    currentHotkey = null;
  }
}

export function unregisterAll(): void {
  invalidatePendingHotkeyTriggers();
  globalShortcut.unregisterAll();
  currentHotkey = null;
}

async function handleHotkeyTrigger(): Promise<void> {
  const triggerEpoch = ++hotkeyTriggerEpoch;
  const isLatestTrigger = (): boolean => triggerEpoch === hotkeyTriggerEpoch;
  const config = getConfig();
  if (!config.ringEnabled) return;

  const overlayWin = getOverlayWindow();
  if (!overlayWin) return;

  // Synchronize with the already-running helper before resolving a profile.
  // This closes the gap where Windows has switched apps but the corresponding
  // event line has not reached Node. The request is strictly bounded and does
  // not create another PowerShell process.
  const queryStartedAtMs = Date.now();
  const queryStartedAt = new Date(queryStartedAtMs).toISOString();
  const fgApp = await getForegroundAppForTrigger();
  const queryCompletedAtMs = Date.now();
  const queryCompletedAt = new Date(queryCompletedAtMs).toISOString();
  const queryLatencyMs = Math.max(0, queryCompletedAtMs - queryStartedAtMs);
  if (!isLatestTrigger()) return;
  if (!fgApp) {
    // Self-focus with no previously verified external target, or a genuine
    // no-window observation, must not silently resolve and open General.
    endActiveRingSession();
    hideOverlay();
    return;
  }
  if (overlayWin.isDestroyed()) return;

  const matchedProfile = resolveRuntimeProfile(config, fgApp);
  const bubbles = matchedProfile
    ? materializeFigmaActionsBinding(slotsToBubbles(matchedProfile.slots))
    : [];
  const matchedApp = matchedProfile?.kind === 'application' ? matchedProfile.application ?? null : null;
  if (bubbles.length === 0) {
    endActiveRingSession();
    hideOverlay();
    return;
  }
  const ringSession = beginRingSession(asForegroundWindowTarget(fgApp));
  const foregroundState = getForegroundTrackerSnapshot();
  const cacheAgeMs = getCachedForegroundAppAge();
  const target = fgApp
    ? {
        hwnd: fgApp.windowHandle,
        pid: fgApp.processId,
        processName: fgApp.processName,
        executablePath: fgApp.executablePath,
      }
    : undefined;
  const raw = foregroundState.rawForeground
    ? {
        hwnd: foregroundState.rawForeground.windowHandle,
        pid: foregroundState.rawForeground.processId,
        processName: foregroundState.rawForeground.processName,
      }
    : undefined;
  const lastExternalForeground = foregroundState.lastExternalForeground
    ? {
        hwnd: foregroundState.lastExternalForeground.windowHandle,
        pid: foregroundState.lastExternalForeground.processId,
        processName: foregroundState.lastExternalForeground.processName,
      }
    : undefined;
  const fallbackReason = matchedProfile?.kind === 'application'
    ? 'application-process-match'
    : matchedProfile?.kind === 'global'
      ? 'selected-global-profile'
      : matchedProfile?.kind === 'general'
        ? 'unmatched-external-application'
        : 'no-enabled-profile';
  recordRingDiagnostic({
    correlationId: ringSession.id,
    phase: 'ring-open',
    foreground: target,
    lastExternalForeground,
    target,
    actual: raw,
    profileId: matchedProfile?.id,
    profileName: matchedProfile?.name,
    fallbackReason,
    cacheAgeMs: Number.isFinite(cacheAgeMs) ? cacheAgeMs : undefined,
    cacheGeneration: foregroundState.generation,
    queryStartedAt,
    queryCompletedAt,
    queryLatencyMs,
    windowState: getRingWindowDiagnosticState(),
  });

  const cursor = getCursorPosition();
  const overlaySize = getOverlayWindowSize(config.ringSize);
  const origin = getOverlayOrigin(cursor.x, cursor.y, overlaySize);

  // Diagnostic logging — visible in the terminal when run via run.bat
  console.log(
    `[ring] Foreground: ${fgApp?.processName ?? 'null'} | Profiles: ${config.profiles.length} | Matched: ${matchedProfile?.name ?? 'none'} | Bubbles: ${bubbles.length}`
  );

  // Use in-memory cached values — no PowerShell call, no latency
  const cachedVolume = getVolumeState();
  const systemState: SystemState = {
    volumeLevel: cachedVolume.level,
    isMuted: cachedVolume.isMuted,
    brightnessLevel: getBrightness(),
    isPlaying: false,
  };

  const themeColors = resolveThemeColors(config.theme);
  const payload: RingOpenPayload = {
    ringSessionId: ringSession.id,
    triggerMode: config.triggerMode,
    ringSize: config.ringSize,
    accentColor: themeColors.accent,
    accentFillColor: themeColors.accentFill,
    accentForegroundColor: themeColors.textOnAccent,
    bubbleSurface: themeColors.bubbleSurface,
    bubbles,
    systemState,
    matchedApp,
  };

  // Send ring:open immediately with cached state — ring opens without any delay
  try {
    overlayWin.webContents.send(RING_OPEN, payload);
    showOverlay(origin.x, origin.y, overlaySize);
    recordRingDiagnostic({
      correlationId: ringSession.id,
      phase: 'ring-visible',
      foreground: target,
      lastExternalForeground,
      target,
      actual: raw,
      profileId: matchedProfile?.id,
      profileName: matchedProfile?.name,
      fallbackReason,
      cacheAgeMs: Number.isFinite(cacheAgeMs) ? cacheAgeMs : undefined,
      cacheGeneration: foregroundState.generation,
      queryStartedAt,
      queryCompletedAt,
      queryLatencyMs,
      windowState: getRingWindowDiagnosticState(),
    });
  } catch (error) {
    endRingSession(ringSession.id);
    throw error;
  }

  // Refresh actual state from PowerShell in the background.
  // Only send a follow-up IPC message if values actually changed — avoids
  // a redundant re-render when the cache was already accurate.
  getSystemState().then((freshState) => {
    if (!isLatestTrigger() || overlayWin.isDestroyed()) return;
    if (
      freshState.volumeLevel !== systemState.volumeLevel ||
      freshState.isMuted !== systemState.isMuted ||
      freshState.brightnessLevel !== systemState.brightnessLevel
    ) {
      overlayWin.webContents.send(SYSTEM_STATE_UPDATED, freshState);
    }
  }).catch(() => {});
}
