import { describe, expect, it } from 'vitest';
import type { ActionType } from '../../shared/types';
import { requiresForegroundInput } from './system';

describe('foreground-input classification (H-01)', () => {
  it('requires focus handoff for every action that synthesizes keystrokes', () => {
    const keystrokeActions: ActionType[] = [
      'keyboard-shortcut',
      'keyboard-sequence',
      'macro',
      'screenshot',
      'clipboard-copy',
      'clipboard-paste',
      'screenshot-region',
      'zoom-in',
      'window-snap-left',
    ];
    for (const actionType of keystrokeActions) {
      expect(requiresForegroundInput(actionType), actionType).toBe(true);
    }
  });

  it('does not block actions that do not send input to the foreground app', () => {
    const backgroundActions: ActionType[] = [
      'volume-up',
      'brightness-down',
      'media-play-pause',
      'run-command',
      'app-launch',
      'url-open',
      'file-open',
      'do-nothing',
    ];
    for (const actionType of backgroundActions) {
      expect(requiresForegroundInput(actionType), actionType).toBe(false);
    }
  });
});
