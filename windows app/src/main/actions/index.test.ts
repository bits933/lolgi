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
vi.mock('./keyboard', () => ({ executeKeyboardSequence: vi.fn(), executeKeyboardShortcutAsync: vi.fn() }));
vi.mock('./launcher', () => ({
  launchApp: vi.fn(),
  launchOrFocusApp: vi.fn(),
  openPath: vi.fn(),
  openUrl: vi.fn(),
  runCommand: vi.fn(),
}));
vi.mock('./screenshot', () => ({ takeScreenshot: vi.fn() }));
vi.mock('./system', () => ({ supportsSystemAction: vi.fn(() => false), executeSystemAction: vi.fn() }));
vi.mock('./diagnostics', () => ({ recordActionResult: vi.fn() }));
vi.mock('../store', () => ({ getConfig: vi.fn(() => ({ profiles: [] })) }));
vi.mock('../utils/foregroundApp', () => ({ getCachedForegroundApp: vi.fn(() => null) }));
vi.mock('../profileRuntime', () => ({
  clearManualProfileOverride: vi.fn(),
  getRingForegroundApp: vi.fn(() => null),
  setManualProfileOverride: vi.fn(),
}));

import { executeKeyboardShortcutAsync } from './keyboard';
import { mediaPlayPause } from './media';
import { runCommand } from './launcher';
import { dispatchAction } from './index';

describe('action execution result contract', () => {
  beforeEach(() => vi.clearAllMocks());

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
    await expect(dispatchAction({ bubbleId: 'one', actionType: 'keyboard-shortcut', payload: 'Ctrl+C' })).resolves.toMatchObject({
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
});
