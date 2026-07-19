import { afterEach, describe, expect, it } from 'vitest';
import type { ForegroundWindowTarget } from '../shared/types';
import {
  beginRingSession,
  endActiveRingSession,
  endRingSession,
  getRingSessionTarget,
  isRingSessionCurrent,
} from './profileRuntime';

function target(windowHandle: string, processId: number): ForegroundWindowTarget {
  return {
    processName: 'Figma',
    executablePath: 'C:\\Figma\\Figma.exe',
    windowTitle: 'Design file',
    windowHandle,
    processId,
  };
}

describe('ring target sessions', () => {
  afterEach(() => endActiveRingSession());

  it('resolves only the target bound to the current opaque session', () => {
    const original = target('101', 11);
    const first = beginRingSession(original);
    original.windowHandle = '999';
    expect(isRingSessionCurrent(first.id)).toBe(true);
    expect(getRingSessionTarget(first.id)).toMatchObject({ windowHandle: '101', processId: 11 });

    const second = beginRingSession(target('202', 22));
    expect(isRingSessionCurrent(first.id)).toBe(false);
    expect(getRingSessionTarget(first.id)).toBeNull();
    expect(getRingSessionTarget(second.id)).toMatchObject({ windowHandle: '202', processId: 22 });
  });

  it('does not let a delayed close from an old ring clear the new session', () => {
    const stale = beginRingSession(target('303', 33));
    const current = beginRingSession(target('404', 44));

    endRingSession(stale.id);

    expect(isRingSessionCurrent(current.id)).toBe(true);
    expect(getRingSessionTarget(current.id)).toMatchObject({ windowHandle: '404', processId: 44 });
  });

  it('ends the matching session and rejects missing IDs', () => {
    const session = beginRingSession(target('505', 55));

    expect(getRingSessionTarget(undefined)).toBeNull();
    endRingSession(session.id);

    expect(isRingSessionCurrent(session.id)).toBe(false);
    expect(getRingSessionTarget(session.id)).toBeNull();
  });
});
