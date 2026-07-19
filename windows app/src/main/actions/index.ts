import type {
  ActionExecutePayload,
  ActionResult,
  ForegroundWindowTarget,
  InputDispatchReceipt,
  SystemState,
} from '../../shared/types';
import { volumeStep, toggleMute, getVolumeState, getVolumeStateAsync, setVolume } from './volume';
import { brightnessUp, brightnessDown, getBrightness, getBrightnessAsync, setBrightness } from './brightness';
import { mediaPlayPause, mediaNextTrack, mediaPrevTrack } from './media';
import {
  executeKeyboardSequence,
  executeKeyboardShortcutAsync,
  executeKeyboardTextAsync,
  TargetFocusError,
} from './keyboard';
import { launchApp, launchOrFocusApp, openPath, openUrl, runCommand } from './launcher';
import { executeSystemAction, supportsSystemAction } from './system';
import { recordActionResult } from './diagnostics';
import { getConfig } from '../store';
import { getCachedForegroundApp } from '../utils/foregroundApp';
import { clearManualProfileOverride, getRingForegroundApp, setManualProfileOverride } from '../profileRuntime';

export interface ActionExecutionContext {
  target?: ForegroundWindowTarget | null;
}

interface InternalActionResult extends ActionResult {
  inputReceipts?: InputDispatchReceipt[];
}

function success(
  newState?: Partial<SystemState>,
  status: ActionResult['status'] = 'success',
  inputReceipts?: InputDispatchReceipt[]
): InternalActionResult {
  return { status, success: true, newState, inputReceipts };
}

function failure(status: ActionResult['status'], message: string): InternalActionResult {
  return { status, success: false, error: message, message };
}

function requireTarget(context: ActionExecutionContext): ForegroundWindowTarget {
  if (context.target) return context.target;
  throw new TargetFocusError(
    'No verified application target is available for this input action.',
    'TARGET_SESSION_MISSING'
  );
}

async function executeMacro(
  payload: string,
  target: ForegroundWindowTarget
): Promise<InputDispatchReceipt[]> {
  const entries = payload.split(';').map((entry) => entry.trim()).filter(Boolean);
  const receipts: InputDispatchReceipt[] = [];
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
    } else if (entry.startsWith('text:')) {
      receipts.push(await executeKeyboardTextAsync(entry.slice(5), target));
    } else {
      receipts.push(await executeKeyboardShortcutAsync(entry, target));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return receipts;
}

async function execute(
  payload: ActionExecutePayload,
  context: ActionExecutionContext
): Promise<InternalActionResult> {
  if (supportsSystemAction(payload.actionType)) {
    const receipt = await executeSystemAction(payload.actionType, context.target ?? null);
    return success(undefined, 'success', receipt ? [receipt] : undefined);
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
    case 'screenshot': {
      // Legacy profiles store this action without a payload. Route them through
      // the same captured-HWND/PID contract as every newer screenshot action
      // instead of falling back to an unverified, fire-and-forget SendInput path.
      const receipt = await executeKeyboardShortcutAsync(
        payload.payload?.trim() || 'Win+Shift+S',
        requireTarget(context)
      );
      return success(undefined, 'accepted', [receipt]);
    }
    case 'keyboard-shortcut':
      if (!payload.payload) return failure('validation_error', 'No shortcut provided.');
      return success(
        undefined,
        'success',
        [await executeKeyboardShortcutAsync(payload.payload, requireTarget(context))]
      );
    case 'keyboard-sequence':
      if (!payload.payload) return failure('validation_error', 'No shortcut sequence provided.');
      return success(
        undefined,
        'success',
        await executeKeyboardSequence(payload.payload, requireTarget(context))
      );
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
      return success(undefined, 'accepted');
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
      return success(
        undefined,
        'success',
        await executeMacro(payload.payload, requireTarget(context))
      );
    default:
      return failure('unsupported', `Unknown action type: ${payload.actionType}`);
  }
}

export async function dispatchAction(
  payload: ActionExecutePayload,
  context: ActionExecutionContext = {}
): Promise<ActionResult> {
  const startedAt = performance.now();
  let internalResult: InternalActionResult;
  let focusFailure: TargetFocusError | null = null;
  try {
    internalResult = await execute(payload, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof TargetFocusError) {
      focusFailure = error;
      internalResult = failure('target_unavailable', message);
    } else {
      const permissionBlocked = /access|denied|privilege|elevat/i.test(message);
      const unsupported = /unsupported|unavailable|not supported/i.test(message);
      internalResult = failure(permissionBlocked ? 'permission_blocked' : unsupported ? 'unsupported' : 'execution_error', message);
    }
  }
  const { inputReceipts = [], ...publicResult } = internalResult;
  let result: ActionResult = publicResult;
  const lastReceipt = inputReceipts.at(-1);
  const requestedEventCount = inputReceipts.reduce(
    (total, receipt) => total + receipt.requestedInputCount,
    0
  );
  const sentEventCount = inputReceipts.reduce(
    (total, receipt) => total + receipt.sentInputCount,
    0
  );
  const diagnostic = recordActionResult(
    payload.actionType,
    result,
    performance.now() - startedAt,
    {
      correlationId: payload.ringSessionId,
      phase: 'completed',
      definitionId: payload.definitionId,
      bubbleId: payload.bubbleId,
      target: context.target
        ? {
            hwnd: context.target.windowHandle,
            pid: context.target.processId,
            processName: context.target.processName,
            executablePath: context.target.executablePath,
          }
        : undefined,
      actual: lastReceipt
        ? {
            hwnd: lastReceipt.actualWindowHandle,
            pid: lastReceipt.actualProcessId,
          }
        : (focusFailure?.actualWindowHandle || focusFailure?.actualProcessId !== undefined)
          ? {
              hwnd: focusFailure.actualWindowHandle,
              pid: focusFailure.actualProcessId,
            }
        : undefined,
      input: inputReceipts.length > 0 || focusFailure
        ? {
            transport: 'send-input',
            ...(inputReceipts.length > 0
              ? { requestedEventCount, sentEventCount }
              : {}),
            ...(focusFailure ? { failureCode: focusFailure.code } : {}),
          }
        : undefined,
    }
  );
  if (!result.success && diagnostic?.eventId) {
    const diagnosticId = diagnostic.eventId.slice(0, 8);
    result = {
      ...result,
      diagnosticId,
      message: `${result.message ?? result.error ?? 'The action failed.'} Diagnostic ${diagnosticId}.`,
    };
  }
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
