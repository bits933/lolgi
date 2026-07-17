import type { ActionExecutePayload, ActionResult, SystemState } from '../../shared/types';
import { volumeStep, toggleMute, getVolumeState, getVolumeStateAsync, setVolume } from './volume';
import { brightnessUp, brightnessDown, getBrightness, getBrightnessAsync, setBrightness } from './brightness';
import { mediaPlayPause, mediaNextTrack, mediaPrevTrack } from './media';
import { executeKeyboardSequence, executeKeyboardShortcutAsync } from './keyboard';
import { launchApp, launchOrFocusApp, openPath, openUrl, runCommand } from './launcher';
import { takeScreenshot } from './screenshot';
import { executeSystemAction, supportsSystemAction } from './system';
import { recordActionResult } from './diagnostics';
import { getConfig } from '../store';
import { getCachedForegroundApp } from '../utils/foregroundApp';
import { clearManualProfileOverride, getRingForegroundApp, setManualProfileOverride } from '../profileRuntime';

function success(newState?: Partial<SystemState>, status: ActionResult['status'] = 'success'): ActionResult {
  return { status, success: true, newState };
}

function failure(status: ActionResult['status'], message: string): ActionResult {
  return { status, success: false, error: message, message };
}

async function executeMacro(payload: string): Promise<void> {
  const entries = payload.split(';').map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    if (entry.startsWith('delay:')) {
      const delay = Number(entry.slice(6).trim());
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(delay) ? delay : 50));
    } else if (entry.startsWith('url:')) {
      await openUrl(entry.slice(4).trim());
    } else if (entry.startsWith('app:')) {
      await launchApp(entry.slice(4).trim());
    } else if (entry.startsWith('file:') || entry.startsWith('folder:')) {
      await openPath(entry.slice(entry.indexOf(':') + 1).trim());
    } else if (entry.startsWith('command:')) {
      await runCommand(entry.slice(8).trim());
    } else {
      await executeKeyboardShortcutAsync(entry);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function execute(payload: ActionExecutePayload): Promise<ActionResult> {
  if (supportsSystemAction(payload.actionType)) {
    await executeSystemAction(payload.actionType);
    return success();
  }

  switch (payload.actionType) {
    case 'volume-up': {
      const step = Math.min(20, Math.max(1, Number(payload.parameters?.step ?? 5))) / 100;
      const targetLevel = Number(payload.parameters?.targetLevel);
      if (Number.isFinite(targetLevel)) await setVolume(targetLevel);
      else await volumeStep(1, step);
      const state = getVolumeState();
      return success({ volumeLevel: state.level, isMuted: state.isMuted });
    }
    case 'volume-down': {
      const step = Math.min(20, Math.max(1, Number(payload.parameters?.step ?? 5))) / 100;
      const targetLevel = Number(payload.parameters?.targetLevel);
      if (Number.isFinite(targetLevel)) await setVolume(targetLevel);
      else await volumeStep(-1, step);
      const state = getVolumeState();
      return success({ volumeLevel: state.level, isMuted: state.isMuted });
    }
    case 'volume-mute': {
      await toggleMute();
      const state = await getVolumeStateAsync();
      return success({ isMuted: state.isMuted, volumeLevel: state.level });
    }
    case 'brightness-up': {
      const targetLevel = Number(payload.parameters?.targetLevel);
      const configuredStep = Number(payload.parameters?.step);
      if (Number.isFinite(targetLevel)) await setBrightness(targetLevel);
      else if (Number.isFinite(configuredStep)) await setBrightness(getBrightness() + Math.min(20, Math.max(1, configuredStep)) / 100);
      else await brightnessUp();
      return success({ brightnessLevel: getBrightness() });
    }
    case 'brightness-down': {
      const targetLevel = Number(payload.parameters?.targetLevel);
      const configuredStep = Number(payload.parameters?.step);
      if (Number.isFinite(targetLevel)) await setBrightness(targetLevel);
      else if (Number.isFinite(configuredStep)) await setBrightness(getBrightness() - Math.min(20, Math.max(1, configuredStep)) / 100);
      else await brightnessDown();
      return success({ brightnessLevel: getBrightness() });
    }
    case 'media-play-pause':
      await mediaPlayPause();
      return success();
    case 'media-next':
      await mediaNextTrack();
      return success();
    case 'media-prev':
      await mediaPrevTrack();
      return success();
    case 'screenshot':
      payload.payload ? await executeKeyboardShortcutAsync(payload.payload) : takeScreenshot();
      return success(undefined, 'accepted');
    case 'keyboard-shortcut':
      if (!payload.payload) return failure('validation_error', 'No shortcut provided.');
      await executeKeyboardShortcutAsync(payload.payload);
      return success();
    case 'keyboard-sequence':
      if (!payload.payload) return failure('validation_error', 'No shortcut sequence provided.');
      await executeKeyboardSequence(payload.payload);
      return success();
    case 'app-launch':
      if (!payload.payload) return failure('validation_error', 'No application path provided.');
      if (payload.parameters?.focusIfRunning === false) {
        await launchApp(payload.payload, String(payload.parameters?.arguments ?? ''));
      } else {
        await launchOrFocusApp(payload.payload, String(payload.parameters?.arguments ?? ''));
      }
      return success();
    case 'file-open':
    case 'folder-open':
      if (!payload.payload) return failure('validation_error', 'No path provided.');
      await openPath(payload.payload);
      return success(undefined, 'accepted');
    case 'url-open':
      if (!payload.payload) return failure('validation_error', 'No URL provided.');
      await openUrl(payload.payload);
      return success(undefined, 'accepted');
    case 'run-command':
      if (!payload.payload) return failure('validation_error', 'No command provided.');
      await runCommand(payload.payload, {
        ...(typeof payload.parameters?.arguments === 'string' ? { arguments: payload.parameters.arguments } : {}),
        ...(typeof payload.parameters?.workingDirectory === 'string' ? { workingDirectory: payload.parameters.workingDirectory } : {}),
        ...(typeof payload.parameters?.hidden === 'boolean' ? { hidden: payload.parameters.hidden } : {}),
        ...(typeof payload.parameters?.runAsAdmin === 'boolean' ? { runAsAdmin: payload.parameters.runAsAdmin } : {}),
      });
      return success();
    case 'switch-profile': {
      if (!payload.payload) return failure('validation_error', 'No profile selected.');
      const profile = getConfig().profiles.find((item) => item.id === payload.payload && item.enabled);
      if (!profile) return failure('validation_error', 'The selected profile is unavailable.');
      setManualProfileOverride(profile.id, getRingForegroundApp() ?? getCachedForegroundApp());
      return success();
    }
    case 'return-to-auto':
      clearManualProfileOverride();
      return success();
    case 'do-nothing':
      return success();
    case 'easy-switch':
      return failure('unsupported', 'Easy-Switch requires a verified compatible-device adapter.');
    case 'macro':
      if (!payload.payload) return failure('validation_error', 'No macro steps provided.');
      await executeMacro(payload.payload);
      return success();
    default:
      return failure('unsupported', `Unknown action type: ${payload.actionType}`);
  }
}

export async function dispatchAction(payload: ActionExecutePayload): Promise<ActionResult> {
  const startedAt = performance.now();
  let result: ActionResult;
  try {
    result = await execute(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const permissionBlocked = /access|denied|privilege|elevat/i.test(message);
    const unsupported = /unsupported|unavailable|not supported/i.test(message);
    result = failure(permissionBlocked ? 'permission_blocked' : unsupported ? 'unsupported' : 'execution_error', message);
  }
  recordActionResult(payload.actionType, result, performance.now() - startedAt);
  return result;
}

export async function getSystemState(): Promise<SystemState> {
  const [volumeState, brightnessLevel] = await Promise.all([
    getVolumeStateAsync(),
    getBrightnessAsync(),
  ]);
  return {
    volumeLevel: volumeState.level,
    isMuted: volumeState.isMuted,
    brightnessLevel,
    isPlaying: false,
  };
}
