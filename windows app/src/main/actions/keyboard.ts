import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { randomUUID } from 'crypto';
import { gzipSync } from 'zlib';
import type { ForegroundWindowTarget, InputDispatchReceipt } from '../../shared/types';
import { parseShortcut, planKeystrokes } from '../../shared/shortcutParser';
import { registerOwnedProcessId, unregisterOwnedProcessId } from '../utils/foregroundApp';

const BROKER_PROTOCOL_VERSION = 1;
const BROKER_REQUEST_TIMEOUT_MS = 5000;
// The helper must stop before Node declares the request timed out. This margin
// leaves enough time to serialize the expiry error and avoids a timeout racing
// a just-about-to-run SendInput call.
const HELPER_DEADLINE_MARGIN_MS = 250;
const MAX_STDERR_TAIL_LENGTH = 8192;

export type TargetFocusFailureCode =
  | 'TARGET_SESSION_MISSING'
  | 'TARGET_WINDOW_INVALID'
  | 'TARGET_PID_MISMATCH'
  | 'TARGET_FOCUS_FAILED';

export interface TargetFocusMetadata {
  intendedWindowHandle?: string;
  intendedProcessId?: number;
  actualWindowHandle?: string;
  actualProcessId?: number;
}

/**
 * Signals that input was deliberately not sent because the captured target
 * could not be proven to be the same foreground HWND/PID immediately before
 * SendInput.
 */
export class TargetFocusError extends Error {
  readonly code: TargetFocusFailureCode;
  readonly intendedWindowHandle?: string;
  readonly intendedProcessId?: number;
  readonly actualWindowHandle?: string;
  readonly actualProcessId?: number;

  constructor(
    message: string,
    code: TargetFocusFailureCode,
    metadata: TargetFocusMetadata = {}
  ) {
    super(message);
    this.name = 'TargetFocusError';
    this.code = code;
    this.intendedWindowHandle = metadata.intendedWindowHandle;
    this.intendedProcessId = metadata.intendedProcessId;
    this.actualWindowHandle = metadata.actualWindowHandle;
    this.actualProcessId = metadata.actualProcessId;
  }
}

const TARGETED_INPUT_TYPE = String.raw`
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;

public sealed class DispatchReceipt {
  public long TargetWindowHandle;
  public uint TargetProcessId;
  public long ActualWindowHandle;
  public uint ActualProcessId;
  public int RequestedInputCount;
  public int SentInputCount;
}

public static class TargetedInputDispatcher {
  private const uint INPUT_KEYBOARD = 1;
  private const uint KEYEVENTF_KEYUP = 0x0002;
  private const uint KEYEVENTF_UNICODE = 0x0004;
  private const uint KEYEVENTF_SCANCODE = 0x0008;
  private const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
  private const uint MAPVK_VK_TO_VSC_EX = 4;
  private const int SW_RESTORE = 9;
  private const long UNIX_EPOCH_TICKS = 621355968000000000L;

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct HARDWAREINPUT {
    public uint uMsg;
    public ushort wParamL;
    public ushort wParamH;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public HARDWAREINPUT hi;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public INPUTUNION u;
  }

  [DllImport("user32.dll", SetLastError = true)]
  private static extern uint SendInput(uint count, INPUT[] inputs, int size);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool IsWindow(IntPtr window);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool IsIconic(IntPtr window);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool ShowWindow(IntPtr window, int command);

  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", SetLastError = true)]
  private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

  [DllImport("user32.dll")]
  private static extern IntPtr GetKeyboardLayout(uint threadId);

  [DllImport("user32.dll")]
  private static extern uint MapVirtualKeyEx(uint code, uint mapType, IntPtr keyboardLayout);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool SetForegroundWindow(IntPtr window);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool BringWindowToTop(IntPtr window);

  [DllImport("user32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool AttachThreadInput(uint attach, uint attachTo, bool value);

  [DllImport("kernel32.dll")]
  private static extern uint GetCurrentThreadId();

  private static INPUT ScanCodeKey(ushort virtualKey, bool keyUp, IntPtr keyboardLayout) {
    uint mapped = MapVirtualKeyEx(virtualKey, MAPVK_VK_TO_VSC_EX, keyboardLayout);
    ushort scanCode = (ushort)(mapped & 0xFFu);
    if (scanCode == 0) {
      throw new InvalidOperationException(
        "[KEY_LAYOUT_UNMAPPABLE] Target keyboard layout cannot map virtual key " + virtualKey + "."
      );
    }
    INPUT input = new INPUT();
    input.type = INPUT_KEYBOARD;
    input.u.ki.wScan = scanCode;
    input.u.ki.dwFlags = KEYEVENTF_SCANCODE | (keyUp ? KEYEVENTF_KEYUP : 0u);
    uint prefix = mapped & 0xFF00u;
    if (prefix == 0xE000u || prefix == 0xE100u) {
      input.u.ki.dwFlags |= KEYEVENTF_EXTENDEDKEY;
    }
    return input;
  }

  private static INPUT UnicodeKey(ushort codeUnit, bool keyUp) {
    INPUT input = new INPUT();
    input.type = INPUT_KEYBOARD;
    input.u.ki.wScan = codeUnit;
    input.u.ki.dwFlags = KEYEVENTF_UNICODE | (keyUp ? KEYEVENTF_KEYUP : 0u);
    return input;
  }

  private static long UnixTimeMilliseconds() {
    return (DateTime.UtcNow.Ticks - UNIX_EPOCH_TICKS) / TimeSpan.TicksPerMillisecond;
  }

  private static void ThrowIfExpired(long deadlineUnixMs) {
    if (UnixTimeMilliseconds() >= deadlineUnixMs) {
      throw new InvalidOperationException(
        "[INPUT_REQUEST_EXPIRED] Input request expired before SendInput."
      );
    }
  }

  private static uint GetOwnerProcessId(IntPtr window) {
    uint processId;
    uint threadId = GetWindowThreadProcessId(window, out processId);
    return threadId == 0 ? 0u : processId;
  }

  private static uint VerifyTarget(IntPtr target, uint expectedProcessId) {
    if (target == IntPtr.Zero || !IsWindow(target)) {
      throw new InvalidOperationException(
        "[TARGET_WINDOW_INVALID] intendedHwnd=" + target.ToInt64() +
        " intendedPid=" + expectedProcessId +
        " actualHwnd=0 actualPid=0 Captured target HWND no longer exists."
      );
    }
    uint actualProcessId = GetOwnerProcessId(target);
    if (actualProcessId != expectedProcessId) {
      throw new InvalidOperationException(
        "[TARGET_PID_MISMATCH] intendedHwnd=" + target.ToInt64() +
        " intendedPid=" + expectedProcessId +
        " actualHwnd=" + target.ToInt64() +
        " actualPid=" + actualProcessId +
        " Captured target HWND is no longer owned by the captured PID."
      );
    }
    return actualProcessId;
  }

  private static bool Attach(uint first, uint second) {
    return first != 0u && second != 0u && first != second && AttachThreadInput(first, second, true);
  }

  private static void Detach(uint first, uint second, bool attached) {
    if (attached) AttachThreadInput(first, second, false);
  }

  private static void ActivateWithBoundedRetries(
    IntPtr target,
    uint expectedProcessId,
    long deadlineUnixMs
  ) {
    ThrowIfExpired(deadlineUnixMs);
    VerifyTarget(target, expectedProcessId);
    if (GetForegroundWindow() == target) return;
    if (IsIconic(target)) ShowWindow(target, SW_RESTORE);

    int[] retryDelaysMs = new int[] { 20, 40, 80, 120 };
    for (int attempt = 0; attempt < retryDelaysMs.Length; attempt++) {
      ThrowIfExpired(deadlineUnixMs);
      VerifyTarget(target, expectedProcessId);
      IntPtr foreground = GetForegroundWindow();
      uint ignoredProcessId;
      uint foregroundThread = foreground == IntPtr.Zero
        ? 0u
        : GetWindowThreadProcessId(foreground, out ignoredProcessId);
      uint targetThread = GetWindowThreadProcessId(target, out ignoredProcessId);
      uint currentThread = GetCurrentThreadId();

      bool attachedCurrentForeground = Attach(currentThread, foregroundThread);
      bool attachedCurrentTarget = Attach(currentThread, targetThread);
      bool attachedForegroundTarget = Attach(foregroundThread, targetThread);
      try {
        BringWindowToTop(target);
        SetForegroundWindow(target);
      } finally {
        Detach(foregroundThread, targetThread, attachedForegroundTarget);
        Detach(currentThread, targetThread, attachedCurrentTarget);
        Detach(currentThread, foregroundThread, attachedCurrentForeground);
      }

      if (GetForegroundWindow() == target) return;
      Thread.Sleep(retryDelaysMs[attempt]);
    }
  }

  private static DispatchReceipt FocusVerifyAndSend(
    long targetWindowHandle,
    uint expectedProcessId,
    INPUT[] inputs,
    long deadlineUnixMs
  ) {
    IntPtr target = new IntPtr(targetWindowHandle);
    ActivateWithBoundedRetries(target, expectedProcessId, deadlineUnixMs);

    // Re-check HWND ownership and foreground identity in this same persistent
    // helper immediately before its only SendInput call.
    VerifyTarget(target, expectedProcessId);
    IntPtr actualForeground = GetForegroundWindow();
    uint actualProcessId = actualForeground == IntPtr.Zero
      ? 0u
      : GetOwnerProcessId(actualForeground);
    if (actualForeground != target || actualProcessId != expectedProcessId) {
      throw new InvalidOperationException(
        "[TARGET_FOCUS_FAILED] intendedHwnd=" + target.ToInt64() +
        " intendedPid=" + expectedProcessId +
        " actualHwnd=" + actualForeground.ToInt64() +
        " actualPid=" + actualProcessId +
        " Windows did not make the captured HWND/PID foreground."
      );
    }

    // This helper-side deadline is deliberately earlier than Node's timeout.
    // A timed-out or stale request cannot proceed to SendInput.
    ThrowIfExpired(deadlineUnixMs);
    uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (sent != inputs.Length) {
      throw new Win32Exception(
        Marshal.GetLastWin32Error(),
        "[SEND_INPUT_PARTIAL] SendInput accepted " + sent + " of " + inputs.Length + " events."
      );
    }

    return new DispatchReceipt {
      TargetWindowHandle = target.ToInt64(),
      TargetProcessId = expectedProcessId,
      ActualWindowHandle = actualForeground.ToInt64(),
      ActualProcessId = actualProcessId,
      RequestedInputCount = inputs.Length,
      SentInputCount = (int)sent
    };
  }

  public static DispatchReceipt SendChord(
    long targetWindowHandle,
    uint expectedProcessId,
    byte[] modifiers,
    byte key,
    long deadlineUnixMs
  ) {
    IntPtr target = new IntPtr(targetWindowHandle);
    VerifyTarget(target, expectedProcessId);
    uint observedProcessId;
    uint targetThread = GetWindowThreadProcessId(target, out observedProcessId);
    IntPtr keyboardLayout = GetKeyboardLayout(targetThread);
    if (targetThread == 0u || keyboardLayout == IntPtr.Zero) {
      throw new InvalidOperationException(
        "[KEY_LAYOUT_UNAVAILABLE] Target thread keyboard layout is unavailable."
      );
    }

    List<INPUT> inputs = new List<INPUT>();
    foreach (byte modifier in modifiers) inputs.Add(ScanCodeKey(modifier, false, keyboardLayout));
    inputs.Add(ScanCodeKey(key, false, keyboardLayout));
    inputs.Add(ScanCodeKey(key, true, keyboardLayout));
    for (int index = modifiers.Length - 1; index >= 0; index--) {
      inputs.Add(ScanCodeKey(modifiers[index], true, keyboardLayout));
    }
    return FocusVerifyAndSend(
      targetWindowHandle,
      expectedProcessId,
      inputs.ToArray(),
      deadlineUnixMs
    );
  }

  public static DispatchReceipt SendText(
    long targetWindowHandle,
    uint expectedProcessId,
    string text,
    long deadlineUnixMs
  ) {
    List<INPUT> inputs = new List<INPUT>(text.Length * 2);
    foreach (char codeUnit in text) {
      inputs.Add(UnicodeKey(codeUnit, false));
      inputs.Add(UnicodeKey(codeUnit, true));
    }
    return FocusVerifyAndSend(
      targetWindowHandle,
      expectedProcessId,
      inputs.ToArray(),
      deadlineUnixMs
    );
  }
}
`;

const BROKER_POWERSHELL_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Add-Type -TypeDefinition @"
${TARGETED_INPUT_TYPE}
"@

function Write-ProtocolMessage {
  param([object]$Message)
  $json = $Message | ConvertTo-Json -Compress -Depth 4
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

Write-ProtocolMessage ([ordered]@{
  type = 'ready'
  protocol = ${BROKER_PROTOCOL_VERSION}
})

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ([string]::IsNullOrWhiteSpace($line)) {
    continue
  }

  $requestId = $null
  try {
    $request = $line | ConvertFrom-Json
    $requestId = [string]$request.id
    if ([string]::IsNullOrWhiteSpace($requestId)) {
      throw '[INPUT_PROTOCOL_ERROR] Request ID is required.'
    }

    if ([string]$request.kind -eq 'chord') {
      [byte[]]$modifiers = @($request.modifiers | ForEach-Object { [byte]$_ })
      $result = [TargetedInputDispatcher]::SendChord(
        [long]$request.targetWindowHandle,
        [uint32]$request.targetProcessId,
        $modifiers,
        [byte]$request.key,
        [long]$request.deadlineUnixMs
      )
    } elseif ([string]$request.kind -eq 'text') {
      $text = [System.Text.Encoding]::Unicode.GetString(
        [Convert]::FromBase64String([string]$request.textBase64)
      )
      $result = [TargetedInputDispatcher]::SendText(
        [long]$request.targetWindowHandle,
        [uint32]$request.targetProcessId,
        $text,
        [long]$request.deadlineUnixMs
      )
    } else {
      throw '[INPUT_PROTOCOL_ERROR] Unknown input request kind.'
    }

    $receipt = [ordered]@{
      kind = [string]$request.kind
      targetWindowHandle = [string]$result.TargetWindowHandle
      targetProcessId = [uint32]$result.TargetProcessId
      actualWindowHandle = [string]$result.ActualWindowHandle
      actualProcessId = [uint32]$result.ActualProcessId
      requestedInputCount = [int]$result.RequestedInputCount
      sentInputCount = [int]$result.SentInputCount
    }
    Write-ProtocolMessage ([ordered]@{
      type = 'response'
      id = $requestId
      ok = $true
      receipt = $receipt
    })
  } catch {
    Write-ProtocolMessage ([ordered]@{
      type = 'response'
      id = [string]$requestId
      ok = $false
      error = [string]$_.Exception.ToString()
    })
  }
}
`;

interface BrokerRequestBase {
  id: string;
  kind: InputDispatchReceipt['kind'];
  targetWindowHandle: string;
  targetProcessId: number;
  deadlineUnixMs: number;
}

interface BrokerChordRequest extends BrokerRequestBase {
  kind: 'chord';
  modifiers: number[];
  key: number;
}

interface BrokerTextRequest extends BrokerRequestBase {
  kind: 'text';
  textBase64: string;
}

type BrokerRequest = BrokerChordRequest | BrokerTextRequest;
type BrokerRequestWithoutDeadline =
  | Omit<BrokerChordRequest, 'deadlineUnixMs'>
  | Omit<BrokerTextRequest, 'deadlineUnixMs'>;

interface BrokerResponse {
  type?: string;
  protocol?: number;
  id?: string;
  ok?: boolean;
  receipt?: Partial<InputDispatchReceipt>;
  error?: string;
}

interface ActiveBrokerRequest {
  id: string;
  kind: InputDispatchReceipt['kind'];
  target: ForegroundWindowTarget;
  resolve: (receipt: InputDispatchReceipt) => void;
  reject: (error: Error) => void;
}

interface BrokerState {
  child: ChildProcessWithoutNullStreams;
  generation: number;
  ready: boolean;
  terminated: boolean;
  readyPromise: Promise<void>;
  resolveReady: () => void;
  rejectReady: (error: Error) => void;
  active: ActiveBrokerRequest | null;
  stdoutBuffer: string;
  stderrTail: string;
  ownedProcessId: number | null;
}

let brokerState: BrokerState | null = null;
let nextBrokerGeneration = 1;
let dispatchEpoch = 0;
let dispatchTail: Promise<void> = Promise.resolve();

function validateTarget(target: ForegroundWindowTarget): void {
  if (
    !target ||
    !Number.isInteger(target.processId) ||
    target.processId <= 0 ||
    target.processId > 0xffff_ffff ||
    typeof target.windowHandle !== 'string' ||
    !/^[1-9]\d*$/.test(target.windowHandle)
  ) {
    throw new TargetFocusError(
      'The ring did not capture a valid target window.',
      'TARGET_SESSION_MISSING'
    );
  }
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const detail = error as Error & { stderr?: string | Buffer; stdout?: string | Buffer };
  return [detail.message, detail.stderr?.toString(), detail.stdout?.toString()]
    .filter(Boolean)
    .join('\n');
}

function parseTargetFocusMetadata(
  message: string,
  fallbackTarget?: ForegroundWindowTarget
): TargetFocusMetadata {
  const stringField = (name: string): string | undefined =>
    message.match(new RegExp(`\\b${name}=(-?\\d+)`))?.[1];
  const numberField = (name: string): number | undefined => {
    const raw = stringField(name);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  };
  return {
    intendedWindowHandle: stringField('intendedHwnd') ?? fallbackTarget?.windowHandle,
    intendedProcessId: numberField('intendedPid') ?? fallbackTarget?.processId,
    actualWindowHandle: stringField('actualHwnd'),
    actualProcessId: numberField('actualPid'),
  };
}

function targetErrorFrom(
  error: unknown,
  fallbackTarget?: ForegroundWindowTarget
): TargetFocusError | null {
  const message = errorText(error);
  const markers: Array<[RegExp, TargetFocusFailureCode, string]> = [
    [/TARGET_WINDOW_INVALID/, 'TARGET_WINDOW_INVALID', 'The captured application window no longer exists.'],
    [/TARGET_PID_MISMATCH/, 'TARGET_PID_MISMATCH', 'The captured window now belongs to a different process.'],
    [/TARGET_FOCUS_FAILED/, 'TARGET_FOCUS_FAILED', 'Windows could not focus the captured application window.'],
  ];
  const match = markers.find(([pattern]) => pattern.test(message));
  return match
    ? new TargetFocusError(match[2], match[1], parseTargetFocusMetadata(message, fallbackTarget))
    : null;
}

function validateReceipt(
  parsed: Partial<InputDispatchReceipt>,
  kind: InputDispatchReceipt['kind'],
  target: ForegroundWindowTarget
): InputDispatchReceipt {
  if (
    parsed.kind !== kind ||
    parsed.targetWindowHandle !== target.windowHandle ||
    parsed.targetProcessId !== target.processId ||
    parsed.actualWindowHandle !== target.windowHandle ||
    parsed.actualProcessId !== target.processId ||
    !Number.isInteger(parsed.requestedInputCount) ||
    !Number.isInteger(parsed.sentInputCount) ||
    Number(parsed.requestedInputCount) <= 0 ||
    parsed.sentInputCount !== parsed.requestedInputCount
  ) {
    throw new Error('Targeted input returned an invalid dispatch receipt.');
  }
  return parsed as InputDispatchReceipt;
}

function brokerExitError(state: BrokerState, code: number | null, signal: NodeJS.Signals | null): Error {
  const status = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
  const detail = state.stderrTail.trim();
  return new Error(
    `[INPUT_BROKER_EXIT] Persistent input helper stopped with ${status}${detail ? `: ${detail}` : '.'}`
  );
}

function terminateBroker(state: BrokerState, error: Error): void {
  if (state.terminated) return;
  state.terminated = true;
  if (brokerState === state) brokerState = null;
  if (state.ownedProcessId !== null) {
    unregisterOwnedProcessId(state.ownedProcessId);
    state.ownedProcessId = null;
  }
  state.rejectReady(error);

  const active = state.active;
  state.active = null;
  active?.reject(error);

  try {
    state.child.stdin.destroy();
  } catch {
    // The stream can already be gone after a child crash.
  }
  try {
    if (!state.child.killed && state.child.exitCode === null) state.child.kill();
  } catch {
    // Shutdown is best-effort after the request has already failed closed.
  }
}

function handleProtocolLine(state: BrokerState, line: string): void {
  if (state.terminated || line.trim().length === 0) return;

  let response: BrokerResponse;
  try {
    response = JSON.parse(line) as BrokerResponse;
  } catch {
    terminateBroker(state, new Error('[INPUT_PROTOCOL_ERROR] Input helper returned malformed JSON.'));
    return;
  }

  if (response.type === 'ready') {
    if (response.protocol !== BROKER_PROTOCOL_VERSION) {
      terminateBroker(state, new Error('[INPUT_PROTOCOL_ERROR] Input helper protocol version mismatch.'));
      return;
    }
    state.ready = true;
    state.resolveReady();
    return;
  }

  if (response.type !== 'response') {
    terminateBroker(state, new Error('[INPUT_PROTOCOL_ERROR] Input helper returned an unknown message.'));
    return;
  }

  const active = state.active;
  // Late output from a completed request is never allowed to settle the current
  // request. The current request keeps waiting for its own correlated ID.
  if (!active || response.id !== active.id) return;
  state.active = null;

  if (response.ok === true && response.receipt) {
    try {
      active.resolve(validateReceipt(response.receipt, active.kind, active.target));
    } catch (error) {
      const receiptError = error instanceof Error ? error : new Error(String(error));
      active.reject(receiptError);
      terminateBroker(state, receiptError);
    }
    return;
  }

  const responseError = new Error(response.error || 'Persistent input helper rejected the request.');
  active.reject(targetErrorFrom(responseError, active.target) ?? responseError);
}

function startBroker(): BrokerState {
  // The uncompressed helper exceeds Windows' command-line limit once encoded
  // as UTF-16. Gzip keeps the bootstrap comfortably below that limit while
  // leaving stdin exclusively available for the line protocol.
  const compressedScript = gzipSync(
    Buffer.from(BROKER_POWERSHELL_SCRIPT, 'utf8')
  ).toString('base64');
  const bootstrapCommand = [
    `$payload='${compressedScript}'`,
    '$bytes=[Convert]::FromBase64String($payload)',
    '$memory=New-Object System.IO.MemoryStream(,$bytes)',
    '$gzip=New-Object System.IO.Compression.GzipStream($memory,[System.IO.Compression.CompressionMode]::Decompress)',
    '$reader=New-Object System.IO.StreamReader($gzip,[System.Text.Encoding]::UTF8)',
    '& ([ScriptBlock]::Create($reader.ReadToEnd()))',
  ].join(';');
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', bootstrapCommand],
    {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  ) as ChildProcessWithoutNullStreams;
  const ownedProcessId = Number.isInteger(child.pid) && Number(child.pid) > 0
    ? Number(child.pid)
    : null;
  if (ownedProcessId !== null) registerOwnedProcessId(ownedProcessId);

  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const state: BrokerState = {
    child,
    generation: nextBrokerGeneration++,
    ready: false,
    terminated: false,
    readyPromise,
    resolveReady,
    rejectReady,
    active: null,
    stdoutBuffer: '',
    stderrTail: '',
    ownedProcessId,
  };
  brokerState = state;

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string | Buffer) => {
    if (state.terminated) return;
    state.stdoutBuffer += chunk.toString();
    const lines = state.stdoutBuffer.split(/\r?\n/);
    state.stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) handleProtocolLine(state, line);
  });
  child.stderr.on('data', (chunk: string | Buffer) => {
    state.stderrTail = `${state.stderrTail}${chunk.toString()}`.slice(-MAX_STDERR_TAIL_LENGTH);
  });
  child.on('error', (error) => {
    terminateBroker(state, new Error(`[INPUT_BROKER_ERROR] ${error.message}`));
  });
  child.on('exit', (code, signal) => {
    if (!state.terminated) terminateBroker(state, brokerExitError(state, code, signal));
  });

  return state;
}

async function ensureBroker(): Promise<BrokerState> {
  const state = brokerState && !brokerState.terminated ? brokerState : startBroker();
  await state.readyPromise;
  if (state.terminated) {
    throw new Error('[INPUT_BROKER_EXIT] Persistent input helper stopped during startup.');
  }
  return state;
}

function dispatchToBroker(
  request: BrokerRequestWithoutDeadline,
  target: ForegroundWindowTarget,
  expectedEpoch: number,
  nodeDeadlineUnixMs: number
): Promise<InputDispatchReceipt> {
  const wireRequest: BrokerRequest = {
    ...request,
    deadlineUnixMs: nodeDeadlineUnixMs - HELPER_DEADLINE_MARGIN_MS,
  } as BrokerRequest;

  return new Promise<InputDispatchReceipt>((resolve, reject) => {
    let settled = false;

    const finish = (
      callback: (value: InputDispatchReceipt | Error) => void,
      value: InputDispatchReceipt | Error
    ): void => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const finishResolve = (receipt: InputDispatchReceipt): void =>
      finish((value) => resolve(value as InputDispatchReceipt), receipt);
    const finishReject = (error: Error): void =>
      finish((value) => reject(value as Error), error);

    void ensureBroker().then((state) => {
      if (settled) return;
      if (expectedEpoch !== dispatchEpoch) {
        finishReject(new Error('[INPUT_BROKER_SHUTDOWN] Input request was cancelled during shutdown.'));
        return;
      }
      if (Date.now() >= wireRequest.deadlineUnixMs) {
        finishReject(new Error(
          `[INPUT_BROKER_TIMEOUT] Input request ${request.id} expired before helper dispatch.`
        ));
        return;
      }
      if (state.active) {
        const overlapError = new Error('[INPUT_BROKER_OVERLAP] Input helper received overlapping requests.');
        terminateBroker(state, overlapError);
        finishReject(overlapError);
        return;
      }

      state.active = {
        id: request.id,
        kind: request.kind,
        target,
        resolve: finishResolve,
        reject: finishReject,
      };

      try {
        state.child.stdin.write(`${JSON.stringify(wireRequest)}\n`, 'utf8', (error) => {
          if (!error || settled || state.active?.id !== request.id) return;
          const writeError = new Error(`[INPUT_BROKER_WRITE] ${error.message}`);
          terminateBroker(state, writeError);
          finishReject(writeError);
        });
      } catch (error) {
        const writeError = error instanceof Error ? error : new Error(String(error));
        terminateBroker(state, writeError);
        finishReject(writeError);
      }
    }).catch((error) => {
      finishReject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function enqueueTargetedInput(
  request: BrokerRequestWithoutDeadline,
  target: ForegroundWindowTarget
): Promise<InputDispatchReceipt> {
  validateTarget(target);
  const targetSnapshot = { ...target };
  const queuedEpoch = dispatchEpoch;
  const nodeDeadlineUnixMs = Date.now() + BROKER_REQUEST_TIMEOUT_MS;
  const timeoutError = new Error(
    `[INPUT_BROKER_TIMEOUT] Input helper did not complete request ${request.id} within ${BROKER_REQUEST_TIMEOUT_MS}ms.`
  );
  let publicSettled = false;
  let timedOut = false;
  let resolvePublic!: (receipt: InputDispatchReceipt) => void;
  let rejectPublic!: (error: Error) => void;
  const publicPromise = new Promise<InputDispatchReceipt>((resolve, reject) => {
    resolvePublic = resolve;
    rejectPublic = reject;
  });
  const settlePublic = (
    callback: (value: InputDispatchReceipt | Error) => void,
    value: InputDispatchReceipt | Error
  ): void => {
    if (publicSettled) return;
    publicSettled = true;
    clearTimeout(timeout);
    callback(value);
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    const state = brokerState;
    if (
      state &&
      !state.terminated &&
      (!state.ready || state.active?.id === request.id)
    ) {
      terminateBroker(state, timeoutError);
    }
    settlePublic((value) => rejectPublic(value as Error), timeoutError);
  }, BROKER_REQUEST_TIMEOUT_MS);

  const operation = dispatchTail.then(() => {
    if (queuedEpoch !== dispatchEpoch) {
      throw new Error('[INPUT_BROKER_SHUTDOWN] Queued input request was cancelled during shutdown.');
    }
    if (timedOut || Date.now() >= nodeDeadlineUnixMs) throw timeoutError;
    return dispatchToBroker(request, targetSnapshot, queuedEpoch, nodeDeadlineUnixMs);
  });
  dispatchTail = operation.then(
    () => undefined,
    () => undefined
  );
  void operation.then(
    (receipt) =>
      settlePublic((value) => resolvePublic(value as InputDispatchReceipt), receipt),
    (error) =>
      settlePublic(
        (value) => rejectPublic(value as Error),
        error instanceof Error ? error : new Error(String(error))
      )
  );
  return publicPromise;
}

/**
 * Terminates the persistent helper and cancels work that was queued before the
 * shutdown. A later request can lazily start a fresh helper; app quit wiring
 * therefore does not need to await process teardown.
 */
export function shutdownTargetedInputBroker(): void {
  dispatchEpoch += 1;
  const state = brokerState;
  if (state) {
    terminateBroker(
      state,
      new Error('[INPUT_BROKER_SHUTDOWN] Persistent input helper was shut down.')
    );
  }
}

/**
 * Focus the captured HWND, verify its PID and foreground identity, then send
 * one atomic modifier/key batch through the serialized persistent helper.
 */
export async function executeKeyboardShortcutAsync(
  shortcut: string,
  target: ForegroundWindowTarget
): Promise<InputDispatchReceipt> {
  const { modifiers, key } = parseShortcut(shortcut);
  if (key === null) {
    throw new Error(`Shortcut "${shortcut}" has no recognizable main key.`);
  }

  return enqueueTargetedInput(
    {
      id: randomUUID(),
      kind: 'chord',
      targetWindowHandle: target.windowHandle,
      targetProcessId: target.processId,
      modifiers: [...modifiers],
      key,
    },
    target
  );
}

/**
 * Sends all UTF-16 code units as one KEYEVENTF_UNICODE SendInput batch. Text is
 * base64 on the line protocol, so newlines and arbitrary Unicode stay framed.
 */
export async function executeKeyboardTextAsync(
  text: string,
  target: ForegroundWindowTarget
): Promise<InputDispatchReceipt> {
  if (text.length === 0) throw new Error('Text input cannot be empty.');
  return enqueueTargetedInput(
    {
      id: randomUUID(),
      kind: 'text',
      targetWindowHandle: target.windowHandle,
      targetProcessId: target.processId,
      textBase64: Buffer.from(text, 'utf16le').toString('base64'),
    },
    target
  );
}

/**
 * Sends a `keys:` directive as real virtual-key keystrokes by reusing the
 * targeted chord path. Unlike executeKeyboardTextAsync (KEYEVENTF_UNICODE),
 * every event is a genuine scan-code key press — native command lines such as
 * AutoCAD's accept these but silently drop synthetic Unicode text. The directive
 * is planned by planKeystrokes: whitespace-separated named keys and chords
 * (Enter, Tab, Ctrl+A, Shift+Enter) are pressed as keys, while runs of literal
 * characters (command aliases like "PL") are typed one keystroke per character.
 * Every dispatched token must resolve to the shared VK vocabulary.
 */
export async function executeKeyboardTypeAsync(
  sequence: string,
  target: ForegroundWindowTarget
): Promise<InputDispatchReceipt[]> {
  const keystrokes = planKeystrokes(sequence);
  if (keystrokes.length === 0) throw new Error('Keystroke text cannot be empty.');
  const receipts: InputDispatchReceipt[] = [];
  for (const keystroke of keystrokes) {
    receipts.push(await executeKeyboardShortcutAsync(keystroke, target));
  }
  return receipts;
}

export async function executeKeyboardSequence(
  payload: string,
  target: ForegroundWindowTarget
): Promise<InputDispatchReceipt[]> {
  const lines = payload
    .split(/[;\n]/)
    .map((line) => line.trim())
    .filter(Boolean);
  const receipts: InputDispatchReceipt[] = [];

  for (const line of lines) {
    const delay = line.match(/^(?:delay:)?(\d+)ms$/i);
    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, Number(delay[1])));
      continue;
    }
    receipts.push(await executeKeyboardShortcutAsync(line, target));
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return receipts;
}
