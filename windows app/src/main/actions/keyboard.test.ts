import { EventEmitter } from 'events';
import { gunzipSync } from 'zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ForegroundWindowTarget, InputDispatchReceipt } from '../../shared/types';

const spawnMock = vi.hoisted(() => vi.fn());
const foregroundProcessMocks = vi.hoisted(() => ({
  registerOwnedProcessId: vi.fn(),
  unregisterOwnedProcessId: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: spawnMock,
}));
vi.mock('../utils/foregroundApp', () => foregroundProcessMocks);

import {
  executeKeyboardShortcutAsync,
  executeKeyboardTextAsync,
  shutdownTargetedInputBroker,
  TargetFocusError,
} from './keyboard';

interface WireRequest {
  id: string;
  kind: 'chord' | 'text';
  targetWindowHandle: string;
  targetProcessId: number;
  deadlineUnixMs: number;
  modifiers?: number[];
  key?: number;
  textBase64?: string;
}

interface MockBrokerChild extends EventEmitter {
  stdin: EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  killed: boolean;
  pid: number;
  exitCode: number | null;
  kill: ReturnType<typeof vi.fn>;
  requests: WireRequest[];
}

type RequestHandler = (request: WireRequest, child: MockBrokerChild) => void;
let nextMockProcessId = 9000;

const target: ForegroundWindowTarget = {
  processName: 'Figma',
  executablePath: 'C:\\Figma\\Figma.exe',
  windowTitle: 'Design',
  windowHandle: '424242',
  processId: 1234,
};

function inputCount(request: WireRequest): number {
  if (request.kind === 'chord') return ((request.modifiers?.length ?? 0) * 2) + 2;
  return Buffer.from(request.textBase64 ?? '', 'base64').toString('utf16le').length * 2;
}

function receiptFor(request: WireRequest): InputDispatchReceipt {
  const count = inputCount(request);
  return {
    kind: request.kind,
    targetWindowHandle: request.targetWindowHandle,
    targetProcessId: request.targetProcessId,
    actualWindowHandle: request.targetWindowHandle,
    actualProcessId: request.targetProcessId,
    requestedInputCount: count,
    sentInputCount: count,
  };
}

function respond(
  child: MockBrokerChild,
  response: Record<string, unknown>
): void {
  child.stdout.emit('data', `${JSON.stringify({ type: 'response', ...response })}\r\n`);
}

function respondSuccess(child: MockBrokerChild, request: WireRequest): void {
  respond(child, { id: request.id, ok: true, receipt: receiptFor(request) });
}

function createMockBroker(onRequest?: RequestHandler): MockBrokerChild {
  const stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  const stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  const stdin = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    destroy: vi.fn(),
  });
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr,
    killed: false,
    pid: nextMockProcessId++,
    exitCode: null,
    requests: [] as WireRequest[],
    kill: vi.fn(),
  }) as MockBrokerChild;

  child.kill.mockImplementation(() => {
    child.killed = true;
    queueMicrotask(() => child.emit('exit', null, 'SIGTERM'));
    return true;
  });
  child.stdin.write.mockImplementation(
    (
      line: string,
      _encoding: BufferEncoding,
      callback?: (error?: Error | null) => void
    ) => {
      callback?.(null);
      const request = JSON.parse(line.trim()) as WireRequest;
      child.requests.push(request);
      onRequest?.(request, child);
      return true;
    }
  );

  // startBroker installs its listeners synchronously after spawn returns.
  queueMicrotask(() => {
    child.stdout.emit('data', `${JSON.stringify({ type: 'ready', protocol: 1 })}\n`);
  });
  return child;
}

function autoSuccess(request: WireRequest, child: MockBrokerChild): void {
  queueMicrotask(() => respondSuccess(child, request));
}

function decodedBrokerScript(): string {
  const args = spawnMock.mock.calls[0][1] as string[];
  const payload = args[3].match(/\$payload='([A-Za-z0-9+/=]+)'/)?.[1];
  if (!payload) throw new Error('Broker bootstrap did not contain a gzip payload.');
  return gunzipSync(Buffer.from(payload, 'base64')).toString('utf8');
}

describe('persistent targeted keyboard broker', () => {
  beforeEach(() => {
    shutdownTargetedInputBroker();
    spawnMock.mockReset();
    foregroundProcessMocks.registerOwnedProcessId.mockReset();
    foregroundProcessMocks.unregisterOwnedProcessId.mockReset();
    nextMockProcessId = 9000;
    vi.useRealTimers();
  });

  afterEach(() => {
    shutdownTargetedInputBroker();
    vi.useRealTimers();
  });

  it('lazily starts one hidden helper and serializes correlated requests without overlap', async () => {
    let child: MockBrokerChild | undefined;
    spawnMock.mockImplementationOnce(() => {
      child = createMockBroker();
      return child;
    });

    const first = executeKeyboardShortcutAsync('Ctrl+G', target);
    const second = executeKeyboardShortcutAsync('Ctrl+Shift+G', target);

    await vi.waitFor(() => expect(child?.requests).toHaveLength(1));
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(foregroundProcessMocks.registerOwnedProcessId).toHaveBeenCalledWith(child!.pid);
    expect(spawnMock.mock.calls[0][0]).toBe('powershell.exe');
    expect((spawnMock.mock.calls[0][1] as string[])[2]).toBe('-Command');
    expect((spawnMock.mock.calls[0][1] as string[])[3].length).toBeLessThan(32000);
    expect(spawnMock.mock.calls[0][2]).toMatchObject({
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const firstRequest = child!.requests[0];
    respond(child!, {
      id: 'a-different-request-id',
      ok: true,
      receipt: receiptFor(firstRequest),
    });
    await Promise.resolve();
    expect(child!.requests).toHaveLength(1);

    respondSuccess(child!, firstRequest);
    await expect(first).resolves.toMatchObject({ kind: 'chord', sentInputCount: 4 });
    await vi.waitFor(() => expect(child?.requests).toHaveLength(2));

    const secondRequest = child!.requests[1];
    expect(secondRequest.id).not.toBe(firstRequest.id);
    respondSuccess(child!, secondRequest);
    await expect(second).resolves.toMatchObject({ kind: 'chord', sentInputCount: 6 });
    expect(spawnMock).toHaveBeenCalledTimes(1);

    const script = decodedBrokerScript();
    expect(script).toContain('while ($null -ne ($line = [Console]::In.ReadLine()))');
    expect(script).toMatch(
      /ThrowIfExpired\(deadlineUnixMs\);\s*uint sent = SendInput/
    );
    expect(script.indexOf('IntPtr actualForeground = GetForegroundWindow();'))
      .toBeLessThan(script.indexOf('uint sent = SendInput'));
    expect(script).toContain('GetKeyboardLayout(targetThread)');
    expect(script).toContain('MapVirtualKeyEx');
    expect(script).toContain('KEYEVENTF_SCANCODE');
    expect(script).toContain('KEYEVENTF_EXTENDEDKEY');
    expect(script).toContain('[KEY_LAYOUT_UNMAPPABLE]');
    expect(script).toMatch(
      /inputs\.Add\(ScanCodeKey\(key, true, keyboardLayout\)\);[\s\S]*return FocusVerifyAndSend/
    );
  });

  it('frames arbitrary Unicode text as base64 and sends it as one helper request', async () => {
    let child: MockBrokerChild | undefined;
    spawnMock.mockImplementationOnce(() => {
      child = createMockBroker(autoSuccess);
      return child;
    });
    const text = 'Line one\n\u2713 \ud83d\ude80';

    await expect(executeKeyboardTextAsync(text, target)).resolves.toMatchObject({
      kind: 'text',
      requestedInputCount: text.length * 2,
      sentInputCount: text.length * 2,
    });

    expect(child?.requests).toHaveLength(1);
    const request = child!.requests[0];
    expect(request.textBase64).toBe(Buffer.from(text, 'utf16le').toString('base64'));
    expect(Buffer.from(request.textBase64!, 'base64').toString('utf16le')).toBe(text);
    const writtenLine = child!.stdin.write.mock.calls[0][0] as string;
    expect(writtenLine).not.toContain(text);
    expect(decodedBrokerScript()).toContain('[Convert]::FromBase64String');
  });

  it('maps focus failure metadata without window or document titles', async () => {
    spawnMock.mockImplementationOnce(() =>
      createMockBroker((request, child) => {
        queueMicrotask(() => respond(child, {
          id: request.id,
          ok: false,
          error:
            '[TARGET_FOCUS_FAILED] intendedHwnd=424242 intendedPid=1234 ' +
            'actualHwnd=777777 actualPid=4321 foreground verification failed',
        }));
      })
    );

    await expect(executeKeyboardShortcutAsync('Ctrl+G', target)).rejects.toMatchObject({
      name: 'TargetFocusError',
      code: 'TARGET_FOCUS_FAILED',
      intendedWindowHandle: '424242',
      intendedProcessId: 1234,
      actualWindowHandle: '777777',
      actualProcessId: 4321,
    });
  });

  it('maps PID-reuse metadata to the captured HWND and observed owner PID', async () => {
    spawnMock.mockImplementationOnce(() =>
      createMockBroker((request, child) => {
        queueMicrotask(() => respond(child, {
          id: request.id,
          ok: false,
          error:
            '[TARGET_PID_MISMATCH] intendedHwnd=424242 intendedPid=1234 ' +
            'actualHwnd=424242 actualPid=9999 target was reused',
        }));
      })
    );

    const error = await executeKeyboardShortcutAsync('Ctrl+G', target).catch((reason) => reason);
    expect(error).toBeInstanceOf(TargetFocusError);
    expect(error).toMatchObject({
      code: 'TARGET_PID_MISMATCH',
      intendedWindowHandle: '424242',
      intendedProcessId: 1234,
      actualWindowHandle: '424242',
      actualProcessId: 9999,
    });
  });

  it('keeps partial SendInput failures as execution errors rather than success receipts', async () => {
    spawnMock.mockImplementationOnce(() =>
      createMockBroker((request, child) => {
        queueMicrotask(() => respond(child, {
          id: request.id,
          ok: false,
          error: '[SEND_INPUT_PARTIAL] SendInput accepted 2 of 4 events.',
        }));
      })
    );

    const error = await executeKeyboardShortcutAsync('Ctrl+G', target).catch((reason) => reason);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TargetFocusError);
    expect(error.message).toContain('SEND_INPUT_PARTIAL');
  });

  it('fails closed when the target-thread keyboard layout cannot map a chord key', async () => {
    spawnMock.mockImplementationOnce(() =>
      createMockBroker((request, child) => {
        queueMicrotask(() => respond(child, {
          id: request.id,
          ok: false,
          error: '[KEY_LAYOUT_UNMAPPABLE] Target keyboard layout cannot map virtual key 186.',
        }));
      })
    );

    const error = await executeKeyboardShortcutAsync('Ctrl+;', target).catch((reason) => reason);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TargetFocusError);
    expect(error.message).toContain('KEY_LAYOUT_UNMAPPABLE');
  });

  it('times out, kills the stale helper, ignores its late response, and restarts cleanly', async () => {
    vi.useFakeTimers();
    let staleChild: MockBrokerChild | undefined;
    let replacementChild: MockBrokerChild | undefined;
    spawnMock
      .mockImplementationOnce(() => {
        staleChild = createMockBroker();
        return staleChild;
      })
      .mockImplementationOnce(() => {
        replacementChild = createMockBroker(autoSuccess);
        return replacementChild;
      });

    const staleRequest = executeKeyboardShortcutAsync('Ctrl+G', target);
    const queuedStaleRequest = executeKeyboardShortcutAsync('Ctrl+Shift+G', target);
    const staleExpectation = expect(staleRequest).rejects.toThrow('INPUT_BROKER_TIMEOUT');
    const queuedStaleExpectation = expect(queuedStaleRequest).rejects.toThrow(
      'INPUT_BROKER_TIMEOUT'
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(staleChild?.requests).toHaveLength(1);
    const helperDeadline = staleChild!.requests[0].deadlineUnixMs;
    expect(helperDeadline).toBeLessThan(Date.now() + 5000);

    await vi.advanceTimersByTimeAsync(5000);
    await staleExpectation;
    await queuedStaleExpectation;
    expect(staleChild?.kill).toHaveBeenCalledTimes(1);
    expect(foregroundProcessMocks.unregisterOwnedProcessId)
      .toHaveBeenCalledWith(staleChild!.pid);
    expect(staleChild?.requests).toHaveLength(1);

    respondSuccess(staleChild!, staleChild!.requests[0]);
    const replacementRequest = executeKeyboardShortcutAsync('Ctrl+Shift+G', target);
    await vi.advanceTimersByTimeAsync(0);
    await expect(replacementRequest).resolves.toMatchObject({
      kind: 'chord',
      sentInputCount: 6,
    });
    expect(replacementChild?.requests).toHaveLength(1);
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an in-flight request on child crash and starts a fresh helper next time', async () => {
    spawnMock
      .mockImplementationOnce(() =>
        createMockBroker((_request, child) => {
          queueMicrotask(() => {
            child.stderr.emit('data', 'unexpected helper failure');
            child.emit('exit', 17, null);
          });
        })
      )
      .mockImplementationOnce(() => createMockBroker(autoSuccess));

    await expect(executeKeyboardShortcutAsync('Ctrl+G', target)).rejects.toThrow(
      /INPUT_BROKER_EXIT.*unexpected helper failure/
    );
    expect(foregroundProcessMocks.unregisterOwnedProcessId).toHaveBeenCalledWith(9000);
    await expect(executeKeyboardShortcutAsync('Ctrl+G', target)).resolves.toMatchObject({
      kind: 'chord',
      sentInputCount: 4,
    });
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('shutdown kills active work, cancels queued work, and permits a later lazy restart', async () => {
    let activeChild: MockBrokerChild | undefined;
    spawnMock
      .mockImplementationOnce(() => {
        activeChild = createMockBroker();
        return activeChild;
      })
      .mockImplementationOnce(() => createMockBroker(autoSuccess));

    const active = executeKeyboardShortcutAsync('Ctrl+G', target);
    const queued = executeKeyboardShortcutAsync('Ctrl+Shift+G', target);
    const activeExpectation = expect(active).rejects.toThrow('INPUT_BROKER_SHUTDOWN');
    const queuedExpectation = expect(queued).rejects.toThrow('INPUT_BROKER_SHUTDOWN');
    await vi.waitFor(() => expect(activeChild?.requests).toHaveLength(1));

    shutdownTargetedInputBroker();

    await activeExpectation;
    await queuedExpectation;
    expect(activeChild?.kill).toHaveBeenCalledTimes(1);
    expect(foregroundProcessMocks.unregisterOwnedProcessId)
      .toHaveBeenCalledWith(activeChild!.pid);
    expect(activeChild?.requests).toHaveLength(1);

    await expect(executeKeyboardShortcutAsync('Ctrl+G', target)).resolves.toMatchObject({
      sentInputCount: 4,
    });
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});
