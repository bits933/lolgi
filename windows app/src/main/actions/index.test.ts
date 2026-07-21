import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./volume', () => ({
  volumeStep: vi.fn(),
  toggleMute: vi.fn(),
  getVolumeState: vi.fn(() => ({ level: 0.5, isMuted: false })),
  getVolumeStateAsync: vi.fn(async () => ({ level: 0.5, isMuted: false })),
  setVolume: vi.fn(),
}));
vi.mock('./brightness', () => ({
  brightnessUp: vi.fn(),
  brightnessDown: vi.fn(),
  getBrightness: vi.fn(() => 0.5),
  getBrightnessAsync: vi.fn(async () => 0.5),
  setBrightness: vi.fn(),
}));
vi.mock('./media', () => ({ mediaPlayPause: vi.fn(), mediaNextTrack: vi.fn(), mediaPrevTrack: vi.fn() }));
vi.mock('./keyboard', () => {
  class TargetFocusError extends Error {
    readonly code: string;
    readonly intendedWindowHandle?: string;
    readonly intendedProcessId?: number;
    readonly actualWindowHandle?: string;
    readonly actualProcessId?: number;

    constructor(
      message: string,
      code: string,
      metadata: {
        intendedWindowHandle?: string;
        intendedProcessId?: number;
        actualWindowHandle?: string;
        actualProcessId?: number;
      } = {}
    ) {
      super(message);
      this.name = 'TargetFocusError';
      this.code = code;
      Object.assign(this, metadata);
    }
  }
  return {
    executeKeyboardSequence: vi.fn(),
    executeKeyboardShortcutAsync: vi.fn(),
    executeKeyboardTextAsync: vi.fn(),
    executeKeyboardTypeAsync: vi.fn(),
    TargetFocusError,
  };
});
vi.mock('./launcher', () => ({
  launchApp: vi.fn(),
  launchOrFocusApp: vi.fn(),
  openPath: vi.fn(),
  openUrl: vi.fn(),
  runCommand: vi.fn(),
}));
vi.mock('./system', () => ({ supportsSystemAction: vi.fn(() => false), executeSystemAction: vi.fn() }));
vi.mock('./diagnostics', () => ({ recordActionResult: vi.fn() }));
vi.mock('../store', () => ({ getConfig: vi.fn(() => ({ profiles: [] })) }));
vi.mock('../utils/foregroundApp', () => ({ getCachedForegroundApp: vi.fn(() => null) }));
vi.mock('../profileRuntime', () => ({
  clearManualProfileOverride: vi.fn(),
  getRingForegroundApp: vi.fn(() => null),
  setManualProfileOverride: vi.fn(),
}));

import {
  executeKeyboardSequence,
  executeKeyboardShortcutAsync,
  executeKeyboardTextAsync,
  executeKeyboardTypeAsync,
  TargetFocusError,
} from './keyboard';
import { mediaPlayPause } from './media';
import { runCommand } from './launcher';
import { recordActionResult } from './diagnostics';
import { dispatchAction } from './index';
import type { ForegroundWindowTarget, InputDispatchReceipt } from '../../shared/types';

const target: ForegroundWindowTarget = {
  processName: 'Figma',
  executablePath: 'C:\\Figma\\Figma.exe',
  windowTitle: 'Design',
  windowHandle: '424242',
  processId: 1234,
};
const chordReceipt: InputDispatchReceipt = {
  kind: 'chord',
  targetWindowHandle: target.windowHandle,
  targetProcessId: target.processId,
  actualWindowHandle: target.windowHandle,
  actualProcessId: target.processId,
  requestedInputCount: 4,
  sentInputCount: 4,
};
const textReceipt: InputDispatchReceipt = {
  ...chordReceipt,
  kind: 'text',
  requestedInputCount: 10,
  sentInputCount: 10,
};

describe('action execution result contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeKeyboardShortcutAsync).mockResolvedValue(chordReceipt);
    vi.mocked(executeKeyboardSequence).mockResolvedValue([chordReceipt]);
    vi.mocked(executeKeyboardTextAsync).mockResolvedValue(textReceipt);
    vi.mocked(executeKeyboardTypeAsync).mockResolvedValue([chordReceipt]);
    vi.mocked(recordActionResult).mockReturnValue({ eventId: 'diag1234-full' } as never);
  });

  it('reports a successful inert action without side effects', async () => {
    await expect(dispatchAction({ bubbleId: 'one', actionType: 'do-nothing' })).resolves.toMatchObject({
      status: 'success',
      success: true,
    });
  });

  it('keeps missing action data as a validation error', async () => {
    await expect(dispatchAction({ bubbleId: 'one', actionType: 'keyboard-shortcut' })).resolves.toMatchObject({
      status: 'validation_error',
      success: false,
    });
  });

  it('reports capability-gated actions as unsupported', async () => {
    await expect(dispatchAction({ bubbleId: 'one', actionType: 'easy-switch' })).resolves.toMatchObject({
      status: 'unsupported',
      success: false,
    });
  });

  it('classifies elevated-target failures as permission blocked', async () => {
    vi.mocked(executeKeyboardShortcutAsync).mockRejectedValueOnce(new Error('Access denied by elevated target'));
    await expect(dispatchAction(
      { bubbleId: 'one', actionType: 'keyboard-shortcut', payload: 'Ctrl+C' },
      { target }
    )).resolves.toMatchObject({
      status: 'permission_blocked',
      success: false,
    });
  });

  it('waits for media delivery and reports executor failures', async () => {
    vi.mocked(mediaPlayPause).mockRejectedValueOnce(new Error('Media endpoint unavailable'));

    await expect(dispatchAction({ bubbleId: 'one', actionType: 'media-play-pause' })).resolves.toMatchObject({
      status: 'unsupported',
      success: false,
    });
  });

  it('does not overwrite command JSON options when editor parameters are absent', async () => {
    const payload = JSON.stringify({ command: 'example.exe', hidden: false, arguments: '--safe' });

    await dispatchAction({ bubbleId: 'one', actionType: 'run-command', payload });

    expect(runCommand).toHaveBeenCalledWith(payload, {});
  });

  it('fails closed when an input action has no verified target', async () => {
    await expect(dispatchAction({
      bubbleId: 'one',
      actionType: 'keyboard-shortcut',
      payload: 'Ctrl+G',
    })).resolves.toMatchObject({
      status: 'target_unavailable',
      success: false,
      diagnosticId: 'diag1234',
      message: expect.stringContaining('Diagnostic diag1234'),
    });
    expect(executeKeyboardShortcutAsync).not.toHaveBeenCalled();
  });

  it('reports a partial SendInput batch as an execution error, never success', async () => {
    vi.mocked(executeKeyboardShortcutAsync).mockRejectedValueOnce(
      new Error('[SEND_INPUT_PARTIAL] SendInput accepted 2 of 4 events.')
    );

    await expect(dispatchAction(
      { bubbleId: 'one', actionType: 'keyboard-shortcut', payload: 'Ctrl+G' },
      { target }
    )).resolves.toMatchObject({
      status: 'execution_error',
      success: false,
    });
  });

  it('records the actual foreground HWND/PID when exact target focus fails', async () => {
    vi.mocked(executeKeyboardShortcutAsync).mockRejectedValueOnce(
      new TargetFocusError(
        'Windows could not focus the captured application window.',
        'TARGET_FOCUS_FAILED',
        {
          intendedWindowHandle: target.windowHandle,
          intendedProcessId: target.processId,
          actualWindowHandle: '777777',
          actualProcessId: 4321,
        }
      )
    );

    await dispatchAction(
      { bubbleId: 'one', actionType: 'keyboard-shortcut', payload: 'Ctrl+G' },
      { target }
    );

    expect(recordActionResult).toHaveBeenLastCalledWith(
      'keyboard-shortcut',
      expect.objectContaining({ status: 'target_unavailable', success: false }),
      expect.any(Number),
      expect.objectContaining({
        target: expect.objectContaining({ hwnd: target.windowHandle, pid: target.processId }),
        actual: { hwnd: '777777', pid: 4321 },
        input: {
          transport: 'send-input',
          failureCode: 'TARGET_FOCUS_FAILED',
        },
      })
    );
  });

  it('routes a legacy payload-less screenshot through the verified target contract', async () => {
    await expect(dispatchAction(
      { bubbleId: 'legacy-screenshot', actionType: 'screenshot' },
      { target }
    )).resolves.toMatchObject({
      status: 'accepted',
      success: true,
    });

    expect(executeKeyboardShortcutAsync).toHaveBeenCalledWith('Win+Shift+S', target);
  });

  it('passes the exact captured target to static shortcuts and keyboard sequences', async () => {
    await expect(dispatchAction(
      { bubbleId: 'static-shortcut', actionType: 'keyboard-shortcut', payload: 'Ctrl+Alt+K' },
      { target }
    )).resolves.toMatchObject({ status: 'success', success: true });
    expect(executeKeyboardShortcutAsync).toHaveBeenLastCalledWith('Ctrl+Alt+K', target);

    await expect(dispatchAction(
      { bubbleId: 'shortcut-sequence', actionType: 'keyboard-sequence', payload: 'Ctrl+C;Ctrl+V' },
      { target }
    )).resolves.toMatchObject({ status: 'success', success: true });
    expect(executeKeyboardSequence).toHaveBeenLastCalledWith('Ctrl+C;Ctrl+V', target);
  });

  it('uses one Unicode batch for text macro steps and retains legacy chord steps', async () => {
    const result = await dispatchAction(
      { bubbleId: 'one', actionType: 'macro', payload: 'text:Hello;Ctrl+G' },
      { target }
    );

    expect(executeKeyboardTextAsync).toHaveBeenCalledWith('Hello', target);
    expect(executeKeyboardShortcutAsync).toHaveBeenCalledWith('Ctrl+G', target);
    expect(result).toMatchObject({
      status: 'success',
      success: true,
    });
    expect(result).not.toHaveProperty('inputReceipts');
    expect(recordActionResult).toHaveBeenLastCalledWith(
      'macro',
      expect.objectContaining({ status: 'success', success: true }),
      expect.any(Number),
      expect.objectContaining({
        target: expect.objectContaining({ hwnd: target.windowHandle, pid: target.processId }),
        actual: expect.objectContaining({ hwnd: target.windowHandle, pid: target.processId }),
        input: {
          transport: 'send-input',
          requestedEventCount: 14,
          sentEventCount: 14,
        },
      })
    );
  });

  it('types keys macro steps as real keystrokes rather than injected Unicode', async () => {
    const result = await dispatchAction(
      { bubbleId: 'one', actionType: 'macro', payload: 'keys:PL; Enter' },
      { target }
    );

    expect(executeKeyboardTypeAsync).toHaveBeenCalledWith('PL', target);
    expect(executeKeyboardTextAsync).not.toHaveBeenCalled();
    expect(executeKeyboardShortcutAsync).toHaveBeenCalledWith('Enter', target);
    expect(result).toMatchObject({ status: 'success', success: true });
  });
});
