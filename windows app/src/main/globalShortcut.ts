import { globalShortcut } from 'electron';
import { getCursorPosition, getOverlayOrigin } from './utils/cursorPosition';
import { hideOverlay, showOverlay, getOverlayWindow } from './windows';
import { getConfig } from './store';
import { getOverlayWindowSize } from '../shared/constants';
import { RING_OPEN, SYSTEM_STATE_UPDATED } from '../shared/ipcChannels';
import type { RingOpenPayload, SystemState } from '../shared/types';
import { getSystemState } from './actions/index';
import { getVolumeState } from './actions/volume';
import { getBrightness } from './actions/brightness';
import { getCachedForegroundApp } from './utils/foregroundApp';
import { slotsToBubbles } from '../shared/profileUtils';
import { resolveThemeColors } from '../shared/themeColors';
import { resolveRuntimeProfile, setRingForegroundApp } from './profileRuntime';

let currentHotkey: string | null = null;

/**
 * Register the global shortcut for triggering the ring.
 * Unregisters any previously registered shortcut first.
 */
export function registerHotkey(hotkey?: string): boolean {
  const config = getConfig();
  const key = hotkey ?? config.hotkey;
  const previousHotkey = currentHotkey;

  if (previousHotkey === key && globalShortcut.isRegistered(key)) return true;

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
  if (currentHotkey) {
    globalShortcut.unregister(currentHotkey);
    currentHotkey = null;
  }
}

export function unregisterAll(): void {
  globalShortcut.unregisterAll();
  currentHotkey = null;
}

async function handleHotkeyTrigger(): Promise<void> {
  const config = getConfig();
  if (!config.ringEnabled) return;

  const overlayWin = getOverlayWindow();
  if (!overlayWin) return;

  // Position the overlay window before anything else — zero delay
  const fgApp = getCachedForegroundApp();
  setRingForegroundApp(fgApp);
  const matchedProfile = resolveRuntimeProfile(config, fgApp);
  const bubbles = matchedProfile ? slotsToBubbles(matchedProfile.slots) : [];
  const matchedApp = matchedProfile?.kind === 'application' ? matchedProfile.application ?? null : null;
  if (bubbles.length === 0) {
    hideOverlay();
    return;
  }

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
    triggerMode: config.triggerMode,
    ringSize: config.ringSize,
    accentColor: themeColors.accent,
    accentFillColor: themeColors.accentFill,
    accentForegroundColor: themeColors.textOnAccent,
    bubbles,
    systemState,
    matchedApp,
  };

  // Send ring:open immediately with cached state — ring opens without any delay
  overlayWin.webContents.send(RING_OPEN, payload);
  showOverlay(origin.x, origin.y, overlaySize);

  // Refresh actual state from PowerShell in the background.
  // Only send a follow-up IPC message if values actually changed — avoids
  // a redundant re-render when the cache was already accurate.
  getSystemState().then((freshState) => {
    if (overlayWin.isDestroyed()) return;
    if (
      freshState.volumeLevel !== systemState.volumeLevel ||
      freshState.isMuted !== systemState.isMuted ||
      freshState.brightnessLevel !== systemState.brightnessLevel
    ) {
      overlayWin.webContents.send(SYSTEM_STATE_UPDATED, freshState);
    }
  }).catch(() => {});
}
