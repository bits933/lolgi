import { beforeEach, describe, expect, it, vi } from 'vitest';

const execState = vi.hoisted(() => ({
  helperPid: 81_234,
  settle: null as null | ((value: { stdout: string; stderr: string }) => void),
  reject: null as null | ((error: Error) => void),
}));

vi.mock('child_process', async () => {
  const { promisify } = await vi.importActual<typeof import('util')>('util');
  const execFile = vi.fn();
  Object.defineProperty(execFile, promisify.custom, {
    value: () => {
      const execution = new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execState.settle = resolve;
        execState.reject = reject;
      }) as Promise<{ stdout: string; stderr: string }> & {
        child: { pid: number };
      };
      execution.child = { pid: execState.helperPid };
      return execution;
    },
  });
  return { execFile, spawn: vi.fn() };
});

import {
  __foregroundTrackerTestApi,
  getForegroundTrackerSnapshot,
  runPowerShell,
} from './foregroundApp';

describe('one-shot helper ownership', () => {
  beforeEach(() => {
    __foregroundTrackerTestApi.reset();
    execState.settle = null;
    execState.reject = null;
  });

  it('owns the promisified exec child PID only for the helper lifetime', async () => {
    const execution = runPowerShell('Write-Output ok');

    expect(getForegroundTrackerSnapshot().ownedProcessIds).toContain(execState.helperPid);
    execState.settle?.({ stdout: 'ok\r\n', stderr: '' });
    await expect(execution).resolves.toBe('ok');
    expect(getForegroundTrackerSnapshot().ownedProcessIds).not.toContain(execState.helperPid);
  });

  it('unregisters the direct PowerShell PID when the one-shot query fails', async () => {
    const execution = runPowerShell('throw "failure"');

    expect(getForegroundTrackerSnapshot().ownedProcessIds).toContain(execState.helperPid);
    execState.reject?.(new Error('PowerShell failed'));
    await expect(execution).rejects.toThrow('PowerShell failed');
    expect(getForegroundTrackerSnapshot().ownedProcessIds).not.toContain(execState.helperPid);
  });
});
