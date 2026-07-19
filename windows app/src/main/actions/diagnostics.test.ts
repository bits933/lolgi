import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeBuildIdentity } from '../../shared/buildInfo';

const clipboardWriteText = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  clipboard: {
    writeText: clipboardWriteText,
  },
}));

const temporaryDirectories: string[] = [];

beforeEach(() => {
  clipboardWriteText.mockReset();
  vi.resetModules();
});

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('bounded diagnostics', () => {
  it('keeps the original recordActionResult signature and returns an event ID', async () => {
    const diagnostics = await import('./diagnostics');
    const event = diagnostics.recordActionResult(
      'keyboard-shortcut',
      { status: 'success', success: true },
      12,
    );

    expect(event.kind).toBe('action');
    expect(event.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(diagnostics.getRecentActionResults()).toHaveLength(1);
  });

  it('persists a redacted bounded snapshot without window or document titles', async () => {
    const diagnostics = await import('./diagnostics');
    const userData = await mkdtemp(join(tmpdir(), 'logi-diagnostics-'));
    temporaryDirectories.push(userData);
    const build: RuntimeBuildIdentity = {
      version: '1.0.1',
      gitCommit: '0123456789abcdef0123456789abcdef01234567',
      dirty: true,
      builtAtUtc: '2026-07-18T17:00:00.000Z',
      sourceFingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      mode: 'development',
      isPackaged: false,
      execPath: 'C:\\tools\\electron.exe',
    };

    await diagnostics.initializeDiagnostics(userData, build);
    diagnostics.recordRingDiagnostic({
      correlationId: 'ring-1',
      phase: 'resolved',
      foreground: {
        processName: 'Figma',
        executablePath: 'C:\\Apps\\Figma.exe',
        windowTitle: 'Secret design document',
      } as never,
      lastExternalForeground: {
        hwnd: '12345',
        pid: 456,
        processName: 'Figma',
      },
      profileName: 'Figma Ring',
      queryStartedAt: '2026-07-18T17:00:00.000Z',
      queryCompletedAt: '2026-07-18T17:00:00.007Z',
      windowState: {
        overlay: { exists: true, visible: true, focused: true, focusable: true },
        dashboard: { exists: true, visible: false, focused: false, focusable: true },
      },
    });
    diagnostics.recordActionResult(
      'keyboard-shortcut',
      { status: 'target_unavailable', success: false, message: 'Focus verification failed.' },
      25,
      { correlationId: 'ring-1', bubbleId: 'bubble-1' },
    );
    await diagnostics.flushDiagnostics();

    const persisted = await readFile(join(userData, 'diagnostics', 'recent.json'), 'utf8');
    expect(persisted).toContain('"processName": "Figma"');
    expect(persisted).toContain('"target_unavailable"');
    expect(persisted).toContain('"sourceFingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"');
    expect(persisted).toContain('"windowState"');
    expect(persisted).toContain('"focused": true');
    expect(persisted).toContain('"lastExternalForeground"');
    expect(persisted).toContain('"queryStartedAt": "2026-07-18T17:00:00.000Z"');
    expect(persisted).toContain('"queryCompletedAt": "2026-07-18T17:00:00.007Z"');
    expect(persisted).not.toContain('Secret design document');
    expect(persisted).not.toContain('windowTitle');
  });

  it('copies the latest complete correlation through Electron clipboard', async () => {
    const diagnostics = await import('./diagnostics');
    diagnostics.recordRingDiagnostic({ correlationId: 'ring-2', phase: 'opened', profileName: 'Figma Ring' });
    diagnostics.recordActionResult(
      'keyboard-shortcut',
      { status: 'success', success: true },
      8,
      { correlationId: 'ring-2', bubbleId: 'quick-actions' },
    );

    const result = diagnostics.copyLastCorrelatedDiagnostic();
    expect(result).toMatchObject({ copied: true, correlationId: 'ring-2', eventCount: 2 });
    expect(clipboardWriteText).toHaveBeenCalledOnce();
    expect(clipboardWriteText.mock.calls[0][0]).toContain('"correlationId": "ring-2"');
  });
});
