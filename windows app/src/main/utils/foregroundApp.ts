import { execFile, spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { promisify } from 'util';
import { basename } from 'path';
import { createInterface } from 'readline';
import type { Interface as ReadLineInterface } from 'readline';
import type {
  ForegroundAppInfo,
  ForegroundWindowTarget,
  LaunchableAppInfo,
} from '../../shared/types';

const execFileAsync = promisify(execFile);

// Exact ownership is determined from PID + registered native HWNDs. Executable
// matching is only a packaged-build fallback; matching every process named
// "electron" would incorrectly suppress unrelated Electron development apps.
const OWN_EXECUTABLE_PATH = process.execPath.toLowerCase();
const OWN_PROCESS_NAME = basename(process.execPath).replace(/\.exe$/i, '').toLowerCase();
const GENERIC_HOST_PROCESS_NAMES = new Set(['electron', 'node', 'nodejs']);
const CAN_USE_EXECUTABLE_FALLBACK =
  !GENERIC_HOST_PROCESS_NAMES.has(OWN_PROCESS_NAME) &&
  !(process as NodeJS.Process & { defaultApp?: boolean }).defaultApp;

export type NativeWindowHandle = Buffer | string | number | bigint;

function normalizeWindowHandle(value: NativeWindowHandle | null | undefined): string | null {
  try {
    if (Buffer.isBuffer(value)) {
      if (value.length >= 8) return value.readBigInt64LE(0).toString(10);
      if (value.length >= 4) return BigInt(value.readInt32LE(0)).toString(10);
      if (value.length === 0) return null;
      let result = 0n;
      for (let index = value.length - 1; index >= 0; index -= 1) {
        result = (result << 8n) | BigInt(value[index]);
      }
      return result.toString(10);
    }
    if (typeof value === 'bigint') return value.toString(10);
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) return null;
      return BigInt(value).toString(10);
    }
    const trimmed = value?.trim();
    if (!trimmed) return null;
    return BigInt(trimmed).toString(10);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Utility: run a PowerShell script via -EncodedCommand (Base64 UTF-16LE).
// This avoids ALL quoting / escaping issues with heredoc (@"..."@), double
// quotes inside strings, and embedded newlines.
// ---------------------------------------------------------------------------

export function runPowerShell(script: string, timeout = 3000): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const execution = execFileAsync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true }
  ) as Promise<{ stdout: string; stderr: string }> & { child?: ChildProcess };
  const helperProcessId = execution.child?.pid;
  if (helperProcessId) registerOwnedProcessId(helperProcessId);
  return execution
    .then(({ stdout }) => stdout.trim())
    .finally(() => {
      if (helperProcessId) unregisterOwnedProcessId(helperProcessId);
    });
}

// ---------------------------------------------------------------------------
// PowerShell scripts
// ---------------------------------------------------------------------------

/**
 * Uses -MemberDefinition (avoids heredoc @"..."@ entirely) to P/Invoke
 * GetForegroundWindow + GetWindowThreadProcessId.
 * Returns JSON with Name, Path, Title.
 *
 * NOTE: Uses $procId instead of $pid to avoid conflict with PowerShell's
 * automatic $PID variable.
 */
const FOREGROUND_SCRIPT = `
Add-Type -MemberDefinition '
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
' -Name FGHelper -Namespace Win32 -ErrorAction SilentlyContinue

$hwnd = [Win32.FGHelper]::GetForegroundWindow()
$procId = [uint32]0
[Win32.FGHelper]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
$p = Get-Process -Id $procId -ErrorAction SilentlyContinue
if ($p) {
  @{
    Name = $p.ProcessName
    Path = $p.Path
    Title = $p.MainWindowTitle
    Hwnd = $hwnd.ToInt64().ToString([Globalization.CultureInfo]::InvariantCulture)
    Pid = $procId
  } | ConvertTo-Json -Compress
}
`;

/**
 * One long-lived helper replaces recurring PowerShell process creation. Its C#
 * WinEvent hook emits exactly one JSON object per line: an initial snapshot,
 * then every EVENT_SYSTEM_FOREGROUND notification in callback order.
 */
const FOREGROUND_WATCHER_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class RingForegroundWatcher {
  private const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
  private const uint WINEVENT_OUTOFCONTEXT = 0x0000;
  private static long sequence = 0;
  private static readonly WinEventDelegate callback = OnWinEvent;
  private static readonly object emitLock = new object();

  private delegate void WinEventDelegate(
    IntPtr hook,
    uint eventType,
    IntPtr hwnd,
    int objectId,
    int childId,
    uint eventThread,
    uint eventTime
  );

  [StructLayout(LayoutKind.Sequential)]
  private struct MSG {
    public IntPtr hwnd;
    public uint message;
    public UIntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public int pointX;
    public int pointY;
    public uint privateValue;
  }

  [DllImport("user32.dll")]
  private static extern IntPtr SetWinEventHook(
    uint eventMin,
    uint eventMax,
    IntPtr module,
    WinEventDelegate callback,
    uint processId,
    uint threadId,
    uint flags
  );

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool UnhookWinEvent(IntPtr hook);

  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);

  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern int GetWindowTextLength(IntPtr hwnd);

  [DllImport("user32.dll")]
  private static extern int GetMessage(out MSG message, IntPtr hwnd, uint min, uint max);

  [DllImport("user32.dll")]
  private static extern bool TranslateMessage(ref MSG message);

  [DllImport("user32.dll")]
  private static extern IntPtr DispatchMessage(ref MSG message);

  public static int Run() {
    IntPtr hook = SetWinEventHook(
      EVENT_SYSTEM_FOREGROUND,
      EVENT_SYSTEM_FOREGROUND,
      IntPtr.Zero,
      callback,
      0,
      0,
      WINEVENT_OUTOFCONTEXT
    );
    if (hook == IntPtr.Zero) {
      Console.Out.WriteLine("{\\"kind\\":\\"fatal\\",\\"reason\\":\\"hook-registration-failed\\"}");
      Console.Out.Flush();
      return 2;
    }

    Thread controlThread = new Thread(ControlLoop);
    controlThread.IsBackground = true;
    controlThread.Name = "RingForegroundControl";
    controlThread.Start();

    EmitCurrent("snapshot", "");
    try {
      MSG message;
      while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) {
        TranslateMessage(ref message);
        DispatchMessage(ref message);
      }
    } finally {
      UnhookWinEvent(hook);
    }
    return 0;
  }

  private static void OnWinEvent(
    IntPtr hook,
    uint eventType,
    IntPtr hwnd,
    int objectId,
    int childId,
    uint eventThread,
    uint eventTime
  ) {
    // Re-read the current HWND inside the serialized emitter. A queued callback
    // can otherwise describe a window that has already lost foreground focus.
    EmitCurrent("event", "");
  }

  private static void ControlLoop() {
    try {
      string line;
      while ((line = Console.In.ReadLine()) != null) {
        const string prefix = "snapshot\\t";
        if (!line.StartsWith(prefix, StringComparison.Ordinal)) continue;
        string requestId = line.Substring(prefix.Length);
        if (!IsValidRequestId(requestId)) continue;
        EmitCurrent("barrier", requestId);
      }
    } catch {}
  }

  private static bool IsValidRequestId(string requestId) {
    if (String.IsNullOrEmpty(requestId) || requestId.Length > 96) return false;
    foreach (char character in requestId) {
      if (
        !((character >= 'a' && character <= 'z') ||
          (character >= 'A' && character <= 'Z') ||
          (character >= '0' && character <= '9') ||
          character == '-')
      ) return false;
    }
    return true;
  }

  private static void EmitCurrent(string source, string requestId) {
    lock (emitLock) {
      IntPtr hwnd = GetForegroundWindow();
      uint processId = 0;
      string processName = "";
      string executablePath = "";
      string windowTitle = "";

      if (hwnd != IntPtr.Zero) {
        GetWindowThreadProcessId(hwnd, out processId);
        windowTitle = ReadWindowTitle(hwnd);
        if (processId != 0) {
          try {
            using (Process process = Process.GetProcessById((int)processId)) {
              processName = process.ProcessName ?? "";
              try {
                if (process.MainModule != null) executablePath = process.MainModule.FileName ?? "";
              } catch {}
            }
          } catch {}
        }
      }

      long currentSequence = Interlocked.Increment(ref sequence);
      long observedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
      string handle = hwnd.ToInt64().ToString(CultureInfo.InvariantCulture);
      string json =
        "{\\"kind\\":\\"foreground\\"" +
        ",\\"source\\":" + Quote(source) +
        ",\\"requestId\\":" + Quote(requestId) +
        ",\\"sourceSequence\\":" + currentSequence.ToString(CultureInfo.InvariantCulture) +
        ",\\"observedAt\\":" + observedAt.ToString(CultureInfo.InvariantCulture) +
        ",\\"windowHandle\\":" + Quote(handle) +
        ",\\"processId\\":" + processId.ToString(CultureInfo.InvariantCulture) +
        ",\\"processName\\":" + Quote(processName) +
        ",\\"executablePath\\":" + Quote(executablePath) +
        ",\\"windowTitle\\":" + Quote(windowTitle) +
        "}";
      Console.Out.WriteLine(json);
      Console.Out.Flush();
    }
  }

  private static string ReadWindowTitle(IntPtr hwnd) {
    int length = GetWindowTextLength(hwnd);
    if (length <= 0) return "";
    StringBuilder text = new StringBuilder(length + 1);
    return GetWindowText(hwnd, text, text.Capacity) > 0 ? text.ToString() : "";
  }

  private static string Quote(string value) {
    if (value == null) value = "";
    StringBuilder escaped = new StringBuilder(value.Length + 2);
    escaped.Append('"');
    foreach (char character in value) {
      switch (character) {
        case '"': escaped.Append("\\\\\\""); break;
        case '\\\\': escaped.Append("\\\\\\\\"); break;
        case '\\b': escaped.Append("\\\\b"); break;
        case '\\f': escaped.Append("\\\\f"); break;
        case '\\n': escaped.Append("\\\\n"); break;
        case '\\r': escaped.Append("\\\\r"); break;
        case '\\t': escaped.Append("\\\\t"); break;
        default:
          if (character < 32) {
            escaped.Append("\\\\u");
            escaped.Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
          } else {
            escaped.Append(character);
          }
          break;
      }
    }
    escaped.Append('"');
    return escaped.ToString();
  }
}
'@
exit [RingForegroundWatcher]::Run()
`;

/**
 * Lists all running processes that have a visible main window.
 * Returns a JSON array of { Name, Path, Title } objects.
 */
const LIST_RUNNING_SCRIPT = `
Get-Process | Where-Object { $_.MainWindowTitle -ne '' } |
  Select-Object ProcessName, Path, MainWindowTitle -Unique |
  ForEach-Object { @{ Name = $_.ProcessName; Path = $_.Path; Title = $_.MainWindowTitle } } |
  ConvertTo-Json -Compress
`;

/**
 * Lists installed applications from Start Menu shortcuts (.lnk files).
 * Returns a JSON array of { Name, ProcessName, Path } objects.
 *
 * Uses PSCustomObject (not hashtable) so Sort-Object -Unique works correctly,
 * and collects via an ArrayList to avoid scope issues with ForEach-Object.
 */
const LIST_INSTALLED_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$shell = New-Object -ComObject WScript.Shell
$results = New-Object System.Collections.ArrayList
$dirs = @(
  [Environment]::GetFolderPath('CommonStartMenu') + '\\Programs',
  [Environment]::GetFolderPath('StartMenu') + '\\Programs'
)
foreach ($dir in $dirs) {
  if (Test-Path $dir) {
    $lnks = Get-ChildItem -Path $dir -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue
    foreach ($f in $lnks) {
      try {
        $lnk = $shell.CreateShortcut($f.FullName)
        $target = $lnk.TargetPath
        if ($target -and $target.ToLower().EndsWith('.exe') -and (Test-Path $target)) {
          $obj = [PSCustomObject]@{
            Name = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
            ProcessName = [System.IO.Path]::GetFileNameWithoutExtension($target)
            Path = $target
          }
          [void]$results.Add($obj)
        }
      } catch {}
    }
  }
}
$unique = $results | Sort-Object -Property Name -Unique
if ($unique.Count -eq 0) {
  '[]'
} else {
  $unique | ConvertTo-Json -Compress
}
`;

// ---------------------------------------------------------------------------
// Foreground state + persistent watcher
// ---------------------------------------------------------------------------

type ForegroundObservationSource = 'snapshot' | 'event' | 'barrier' | 'oneshot';

interface TrackedForegroundTarget extends ForegroundWindowTarget {
  generation: number;
  observedAt: number;
  source: ForegroundObservationSource;
  sourceSequence?: number;
}

interface ForegroundWatcherMessage {
  kind: 'foreground';
  source: 'snapshot' | 'event' | 'barrier';
  requestId?: string;
  sourceSequence: number;
  observedAt: number;
  windowHandle: string;
  processId: number;
  processName: string;
  executablePath: string;
  windowTitle: string;
}

interface OneShotGenerationToken {
  baselineGeneration: number;
}

interface PendingTriggerBarrier {
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: TriggerBarrierResolution) => void;
}

type TriggerBarrierResolution =
  | { kind: 'observed'; target: ForegroundWindowTarget | null }
  | { kind: 'fallback' };

export interface RedactedForegroundTarget {
  processName: string;
  processId: number;
  windowHandle: string;
  generation: number;
  observedAt: number;
  source: ForegroundObservationSource;
}

export interface ForegroundTrackerSnapshot {
  generation: number;
  suspensionDepth: number;
  rawForeground: RedactedForegroundTarget | null;
  lastExternalForeground: RedactedForegroundTarget | null;
  ownedProcessIds: number[];
  ownedWindowHandles: string[];
  watcher: {
    running: boolean;
    restartAttempt: number;
    lastMessageAt: number | null;
    lastError: string | null;
  };
}

const ownedProcessIds = new Set<number>([process.pid]);
const ownedWindowHandles = new Set<string>();
const watcherChildProcessIds = new Map<ChildProcess, number>();

let rawForeground: TrackedForegroundTarget | null = null;
let lastExternalForeground: TrackedForegroundTarget | null = null;
let lastExternalForegroundAt = 0;
let nextGeneration = 0;
let suspensionDepth = 0;
let inFlightPromise: Promise<ForegroundWindowTarget | null> | null = null;

let watcherEnabled = false;
let watcherProcess: ChildProcess | null = null;
let watcherReader: ReadLineInterface | null = null;
let watcherRestartTimer: ReturnType<typeof setTimeout> | null = null;
let watcherHandshakeTimer: ReturnType<typeof setTimeout> | null = null;
let watcherStableTimer: ReturnType<typeof setTimeout> | null = null;
let watcherRestartAttempt = 0;
let watcherLastSourceSequence = 0;
let watcherLastMessageAt: number | null = null;
let watcherLastError: string | null = null;
let watcherReadyPromise: Promise<void> | null = null;
let resolveWatcherReady: (() => void) | null = null;
let nextTriggerBarrierId = 0;
const pendingTriggerBarriers = new Map<string, PendingTriggerBarrier>();

const WATCHER_STARTUP_TIMEOUT_MS = 2500;
const WATCHER_FALLBACK_BUDGET_MS = 1000;
const WATCHER_RESTART_BASE_MS = 250;
const WATCHER_RESTART_MAX_MS = 5000;
const WATCHER_STABLE_RESET_MS = 10_000;
const TRIGGER_BARRIER_DEFAULT_MS = 120;
const TRIGGER_BARRIER_MAX_MS = 200;

export function registerOwnedWindowHandle(value: NativeWindowHandle): string | null {
  const handle = normalizeWindowHandle(value);
  if (!handle || handle === '0') return null;
  ownedWindowHandles.add(handle);
  return handle;
}

export function unregisterOwnedWindowHandle(value: NativeWindowHandle | null | undefined): void {
  const handle = normalizeWindowHandle(value);
  if (handle) ownedWindowHandles.delete(handle);
}

export function registerOwnedProcessId(processId: number): void {
  if (Number.isInteger(processId) && processId > 0) ownedProcessIds.add(processId);
}

export function unregisterOwnedProcessId(processId: number): void {
  if (processId !== process.pid) ownedProcessIds.delete(processId);
}

function registerWatcherChildProcess(child: ChildProcess): void {
  const processId = child.pid;
  if (!processId) return;
  watcherChildProcessIds.set(child, processId);
  registerOwnedProcessId(processId);
}

function unregisterWatcherChildProcess(child: ChildProcess): void {
  const processId = watcherChildProcessIds.get(child);
  if (!processId) return;
  watcherChildProcessIds.delete(child);
  unregisterOwnedProcessId(processId);
}

function isOwnTarget(target: ForegroundWindowTarget): boolean {
  if (ownedProcessIds.has(target.processId)) return true;
  if (ownedWindowHandles.has(target.windowHandle)) return true;
  return Boolean(
    CAN_USE_EXECUTABLE_FALLBACK &&
    target.executablePath &&
    target.executablePath.toLowerCase() === OWN_EXECUTABLE_PATH
  );
}

function isUsableExternalTarget(target: ForegroundWindowTarget): boolean {
  return (
    target.processId > 0 &&
    target.windowHandle !== '0' &&
    target.processName.trim() !== '' &&
    !isOwnTarget(target)
  );
}

function resolveObservedTriggerTarget(
  target: ForegroundWindowTarget
): ForegroundWindowTarget | null {
  if (isOwnTarget(target)) return lastExternalForeground;
  if (!isUsableExternalTarget(target)) return null;
  // Preserve the broader action/overlay suspension contract. A concurrently
  // observed external target is not allowed to replace the active ring context.
  return suspensionDepth === 0 ? target : lastExternalForeground;
}

function toRedactedTarget(target: TrackedForegroundTarget | null): RedactedForegroundTarget | null {
  if (!target) return null;
  return {
    processName: target.processName,
    processId: target.processId,
    windowHandle: target.windowHandle,
    generation: target.generation,
    observedAt: target.observedAt,
    source: target.source,
  };
}

function updateLastExternal(target: TrackedForegroundTarget): void {
  const changed =
    lastExternalForeground?.processId !== target.processId ||
    lastExternalForeground?.windowHandle !== target.windowHandle;
  lastExternalForeground = target;
  lastExternalForegroundAt = target.observedAt;
  if (changed && process.env['ELECTRON_DEV']) {
    console.debug('[foregroundApp] External foreground:', target.processName);
  }
}

function observeForeground(
  target: ForegroundWindowTarget | null,
  source: ForegroundObservationSource,
  observedAt = Date.now(),
  sourceSequence?: number
): number {
  const generation = ++nextGeneration;
  if (!target) {
    rawForeground = null;
    return generation;
  }

  const tracked: TrackedForegroundTarget = {
    ...target,
    generation,
    observedAt,
    source,
    ...(sourceSequence === undefined ? {} : { sourceSequence }),
  };
  rawForeground = tracked;

  if (suspensionDepth === 0 && isUsableExternalTarget(tracked)) {
    updateLastExternal(tracked);
  }
  return generation;
}

function promoteRawForegroundAfterResume(): void {
  if (
    suspensionDepth === 0 &&
    rawForeground &&
    isUsableExternalTarget(rawForeground) &&
    (!lastExternalForeground || rawForeground.generation > lastExternalForeground.generation)
  ) {
    updateLastExternal(rawForeground);
  }
}

function parseForegroundTarget(value: {
  windowHandle?: unknown;
  processId?: unknown;
  processName?: unknown;
  executablePath?: unknown;
  windowTitle?: unknown;
  Hwnd?: unknown;
  Pid?: unknown;
  Name?: unknown;
  Path?: unknown;
  Title?: unknown;
}): ForegroundWindowTarget | null {
  const windowHandle = normalizeWindowHandle(
    (value.windowHandle ?? value.Hwnd) as NativeWindowHandle | undefined
  );
  const processId = Number(value.processId ?? value.Pid ?? 0);
  if (!windowHandle || !Number.isInteger(processId) || processId < 0) return null;
  return {
    windowHandle,
    processId,
    processName: String(value.processName ?? value.Name ?? ''),
    executablePath: String(value.executablePath ?? value.Path ?? ''),
    windowTitle: String(value.windowTitle ?? value.Title ?? ''),
  };
}

function parseWatcherMessage(line: string): ForegroundWatcherMessage | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed['kind'] !== 'foreground') return null;
    const source = parsed['source'];
    if (source !== 'snapshot' && source !== 'event' && source !== 'barrier') return null;
    const target = parseForegroundTarget(parsed);
    const sourceSequence = Number(parsed['sourceSequence']);
    const observedAt = Number(parsed['observedAt']);
    const requestId = typeof parsed['requestId'] === 'string' ? parsed['requestId'] : undefined;
    if (
      !target ||
      !Number.isInteger(sourceSequence) ||
      sourceSequence <= 0 ||
      !Number.isFinite(observedAt) ||
      (source === 'barrier' && (!requestId || !/^[A-Za-z0-9-]{1,96}$/.test(requestId)))
    ) {
      return null;
    }
    return {
      kind: 'foreground',
      source,
      ...(requestId ? { requestId } : {}),
      sourceSequence,
      observedAt,
      ...target,
    };
  } catch {
    return null;
  }
}

function settleWatcherReady(): void {
  const resolve = resolveWatcherReady;
  resolveWatcherReady = null;
  resolve?.();
}

function settleTriggerBarrier(
  requestId: string | undefined,
  resolution: TriggerBarrierResolution
): void {
  if (!requestId) return;
  const pending = pendingTriggerBarriers.get(requestId);
  if (!pending) return;
  pendingTriggerBarriers.delete(requestId);
  clearTimeout(pending.timer);
  pending.resolve(resolution);
}

function settleAllTriggerBarriers(): void {
  for (const [requestId] of pendingTriggerBarriers) {
    settleTriggerBarrier(requestId, { kind: 'fallback' });
  }
}

function handleWatcherLine(line: string): boolean {
  const message = parseWatcherMessage(line);
  if (!message) {
    try {
      const control = JSON.parse(line) as { kind?: string; reason?: string };
      if (control.kind === 'fatal') {
        watcherLastError = control.reason === 'hook-registration-failed'
          ? 'hook-registration-failed'
          : 'helper-fatal';
      }
    } catch {
      // Ignore non-protocol PowerShell noise without exposing it to diagnostics.
    }
    return false;
  }
  if (message.sourceSequence <= watcherLastSourceSequence) {
    // A response can be delayed in tests or by a stale helper teardown. Resolve
    // its waiter from current state, but never apply its older observation.
    if (message.source === 'barrier') {
      settleTriggerBarrier(message.requestId, { kind: 'fallback' });
    }
    return false;
  }
  watcherLastSourceSequence = message.sourceSequence;
  watcherLastMessageAt = Date.now();
  watcherLastError = null;
  if (watcherHandshakeTimer) {
    clearTimeout(watcherHandshakeTimer);
    watcherHandshakeTimer = null;
  }
  const target: ForegroundWindowTarget = {
    processName: message.processName,
    executablePath: message.executablePath,
    windowTitle: message.windowTitle,
    windowHandle: message.windowHandle,
    processId: message.processId,
  };
  observeForeground(
    target,
    message.source,
    message.observedAt,
    message.sourceSequence
  );
  if (message.source === 'barrier') {
    settleTriggerBarrier(message.requestId, {
      kind: 'observed',
      target: resolveObservedTriggerTarget(target),
    });
  }
  settleWatcherReady();
  return true;
}

function beginOneShotGeneration(): OneShotGenerationToken {
  return { baselineGeneration: nextGeneration };
}

function completeOneShotGeneration(
  token: OneShotGenerationToken,
  target: ForegroundWindowTarget | null,
  observedAt = Date.now()
): boolean {
  // Any watcher observation after this request began is newer evidence. Do not
  // let the delayed process result overwrite it.
  if (nextGeneration !== token.baselineGeneration) return false;
  observeForeground(target, 'oneshot', observedAt);
  return true;
}

/**
 * Explicit one-shot detection retained for dashboard "detect app" and as a
 * helper-start fallback. Normal contextual updates come from the WinEvent helper.
 */
export async function getForegroundApp(): Promise<ForegroundWindowTarget | null> {
  if (inFlightPromise) return inFlightPromise;

  const token = beginOneShotGeneration();
  inFlightPromise = (async () => {
    try {
      const trimmed = await runPowerShell(FOREGROUND_SCRIPT, 3000);
      if (!trimmed) return lastExternalForeground;
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const target = parseForegroundTarget(parsed);
      if (target) completeOneShotGeneration(token, target);
    } catch (error) {
      watcherLastError = 'oneshot-detection-failed';
      console.error('[foregroundApp] Detection failed:', error);
    }
    return lastExternalForeground;
  })().finally(() => {
    inFlightPromise = null;
  });

  return inFlightPromise;
}

/** Returns the last verified external target without touching PowerShell. */
export function getCachedForegroundApp(): ForegroundWindowTarget | null {
  return lastExternalForeground;
}

function getSafeTriggerFallback(): ForegroundWindowTarget | null {
  if (!rawForeground) return null;
  // Our overlay/dashboard/helper is transparent to profile context: it may sit
  // in front of the previously verified external target without replacing it.
  if (isOwnTarget(rawForeground)) return lastExternalForeground;
  // A real no-window/invalid observation is different and must fail closed.
  if (!isUsableExternalTarget(rawForeground)) return null;
  return lastExternalForeground;
}

/**
 * Ask the already-running helper to sample the foreground at trigger time.
 * The bound is intentionally below a perceptible quarter-second and never
 * starts another PowerShell process. A timeout can use the newest verified
 * external cache while the latest event is external or one of our transparent
 * windows. A genuine null/no-window observation still fails closed.
 */
export async function getForegroundAppForTrigger(
  timeoutMs = TRIGGER_BARRIER_DEFAULT_MS
): Promise<ForegroundWindowTarget | null> {
  const child = watcherProcess;
  const input = child?.stdin;
  if (
    !watcherEnabled ||
    !child ||
    !input ||
    input.destroyed ||
    input.writableEnded ||
    !input.writable
  ) {
    return getSafeTriggerFallback();
  }

  nextTriggerBarrierId += 1;
  const requestId = `${process.pid}-${nextTriggerBarrierId}`;
  const requestedTimeout = Number.isFinite(timeoutMs)
    ? Math.floor(timeoutMs)
    : TRIGGER_BARRIER_DEFAULT_MS;
  const boundedTimeout = Math.max(1, Math.min(TRIGGER_BARRIER_MAX_MS, requestedTimeout));
  const resolution = await new Promise<TriggerBarrierResolution>((resolve) => {
    const timer = setTimeout(() => {
      settleTriggerBarrier(requestId, { kind: 'fallback' });
    }, boundedTimeout);
    pendingTriggerBarriers.set(requestId, { timer, resolve });

    try {
      input.write(`snapshot\t${requestId}\n`, 'utf8', (error?: Error | null) => {
        if (error) settleTriggerBarrier(requestId, { kind: 'fallback' });
      });
    } catch {
      settleTriggerBarrier(requestId, { kind: 'fallback' });
    }
  });

  return resolution.kind === 'observed' ? resolution.target : getSafeTriggerFallback();
}

export function getCachedForegroundAppAge(): number {
  if (lastExternalForegroundAt === 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, Date.now() - lastExternalForegroundAt);
}

export function getForegroundTrackerSnapshot(): ForegroundTrackerSnapshot {
  return {
    generation: nextGeneration,
    suspensionDepth,
    rawForeground: toRedactedTarget(rawForeground),
    lastExternalForeground: toRedactedTarget(lastExternalForeground),
    ownedProcessIds: [...ownedProcessIds].sort((left, right) => left - right),
    ownedWindowHandles: [...ownedWindowHandles].sort(),
    watcher: {
      running: Boolean(watcherProcess),
      restartAttempt: watcherRestartAttempt,
      lastMessageAt: watcherLastMessageAt,
      lastError: watcherLastError,
    },
  };
}

export function setForegroundPollingBusy(isBusy: boolean): void {
  const previousDepth = suspensionDepth;
  suspensionDepth = Math.max(0, suspensionDepth + (isBusy ? 1 : -1));
  if (previousDepth > 0 && suspensionDepth === 0) promoteRawForegroundAfterResume();
}

function runFallbackSnapshot(): void {
  void Promise.race([
    getForegroundApp().catch(() => null),
    new Promise((resolve) => setTimeout(resolve, WATCHER_FALLBACK_BUDGET_MS)),
  ]).finally(settleWatcherReady);
}

function scheduleWatcherRestart(): void {
  if (!watcherEnabled || watcherRestartTimer) return;
  runFallbackSnapshot();
  const delay = Math.min(
    WATCHER_RESTART_BASE_MS * (2 ** watcherRestartAttempt),
    WATCHER_RESTART_MAX_MS
  );
  watcherRestartAttempt += 1;
  watcherRestartTimer = setTimeout(() => {
    watcherRestartTimer = null;
    launchForegroundWatcher();
  }, delay);
}

function handleWatcherExit(child: ChildProcess, reason: string): void {
  unregisterWatcherChildProcess(child);
  if (watcherProcess !== child) return;
  if (watcherHandshakeTimer) {
    clearTimeout(watcherHandshakeTimer);
    watcherHandshakeTimer = null;
  }
  if (watcherStableTimer) {
    clearTimeout(watcherStableTimer);
    watcherStableTimer = null;
  }
  watcherReader?.close();
  watcherReader = null;
  watcherProcess = null;
  settleAllTriggerBarriers();
  if (watcherLastError !== 'hook-registration-failed') watcherLastError = reason;
  if (watcherEnabled) scheduleWatcherRestart();
}

function launchForegroundWatcher(): void {
  if (!watcherEnabled || watcherProcess) return;
  if (process.platform !== 'win32') {
    watcherLastError = 'unsupported-platform';
    runFallbackSnapshot();
    return;
  }

  watcherLastSourceSequence = 0;
  const encoded = Buffer.from(FOREGROUND_WATCHER_SCRIPT, 'utf16le').toString('base64');
  let child: ChildProcess;
  try {
    child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch {
    watcherLastError = 'helper-spawn-failed';
    scheduleWatcherRestart();
    return;
  }

  watcherProcess = child;
  registerWatcherChildProcess(child);
  watcherLastError = null;
  watcherHandshakeTimer = setTimeout(() => {
    if (watcherProcess !== child) return;
    watcherHandshakeTimer = null;
    watcherLastError = 'helper-startup-timeout';
    watcherProcess = null;
    unregisterWatcherChildProcess(child);
    watcherReader?.close();
    watcherReader = null;
    if (watcherStableTimer) {
      clearTimeout(watcherStableTimer);
      watcherStableTimer = null;
    }
    settleAllTriggerBarriers();
    child.kill();
    scheduleWatcherRestart();
  }, WATCHER_STARTUP_TIMEOUT_MS);
  watcherStableTimer = setTimeout(() => {
    watcherStableTimer = null;
    if (watcherProcess === child) watcherRestartAttempt = 0;
  }, WATCHER_STABLE_RESET_MS);
  let finished = false;
  const finish = (reason: string) => {
    if (finished) return;
    finished = true;
    handleWatcherExit(child, reason);
  };

  if (child.stdout) {
    watcherReader = createInterface({ input: child.stdout });
    watcherReader.on('line', handleWatcherLine);
  }
  child.stdin?.once('error', () => {
    finish('helper-stdin-error');
    child.kill();
  });
  child.stderr?.on('data', () => {
    if (!watcherLastError) watcherLastError = 'helper-stderr';
  });
  child.once('error', () => finish('helper-spawn-error'));
  child.once('close', (code, signal) => {
    finish(code === 0 ? 'helper-closed' : `helper-exit-${code ?? signal ?? 'unknown'}`);
  });
}

export function startForegroundAppWatcher(): Promise<void> {
  if (watcherEnabled) return watcherReadyPromise ?? Promise.resolve();
  watcherEnabled = true;
  watcherRestartAttempt = 0;
  watcherLastError = null;
  watcherReadyPromise = new Promise<void>((resolve) => {
    resolveWatcherReady = resolve;
  });
  launchForegroundWatcher();
  return watcherReadyPromise;
}

export function stopForegroundAppWatcher(): void {
  watcherEnabled = false;
  if (watcherRestartTimer) {
    clearTimeout(watcherRestartTimer);
    watcherRestartTimer = null;
  }
  if (watcherHandshakeTimer) {
    clearTimeout(watcherHandshakeTimer);
    watcherHandshakeTimer = null;
  }
  if (watcherStableTimer) {
    clearTimeout(watcherStableTimer);
    watcherStableTimer = null;
  }
  watcherReader?.close();
  watcherReader = null;
  const child = watcherProcess;
  watcherProcess = null;
  if (child) unregisterWatcherChildProcess(child);
  settleAllTriggerBarriers();
  child?.kill();
  settleWatcherReady();
  watcherReadyPromise = null;
}

export const __foregroundTrackerTestApi = {
  reset(): void {
    stopForegroundAppWatcher();
    rawForeground = null;
    lastExternalForeground = null;
    lastExternalForegroundAt = 0;
    nextGeneration = 0;
    suspensionDepth = 0;
    inFlightPromise = null;
    watcherRestartAttempt = 0;
    watcherLastSourceSequence = 0;
    watcherLastMessageAt = null;
    watcherLastError = null;
    nextTriggerBarrierId = 0;
    pendingTriggerBarriers.clear();
    watcherChildProcessIds.clear();
    ownedProcessIds.clear();
    ownedProcessIds.add(process.pid);
    ownedWindowHandles.clear();
  },
  applyWatcherLine: handleWatcherLine,
  observe(
    target: ForegroundWindowTarget | null,
    source: 'snapshot' | 'event' = 'event',
    observedAt = Date.now()
  ): number {
    return observeForeground(target, source, observedAt);
  },
  beginOneShot: beginOneShotGeneration,
  completeOneShot: completeOneShotGeneration,
  isOwnTarget,
  normalizeWindowHandle,
};

/**
 * List all running applications with visible windows.
 * Used by the dashboard "Browse Running Apps" picker.
 */
export async function listRunningApps(): Promise<ForegroundAppInfo[]> {
  try {
    const trimmed = await runPowerShell(LIST_RUNNING_SCRIPT, 5000);
    if (!trimmed) return [];

    const parsed = JSON.parse(trimmed);
    // PowerShell returns a single object (not array) when there's exactly 1 result
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.map((p: { Name?: string; Path?: string; Title?: string }) => ({
      processName: p.Name ?? '',
      executablePath: p.Path ?? '',
      windowTitle: p.Title ?? '',
    }));
  } catch {
    return [];
  }
}

/** Info about an installed application (from Start Menu shortcuts) */
export interface InstalledAppInfo {
  displayName: string;
  processName: string;
  executablePath: string;
}

/**
 * Lists every app registered in the Windows Start Menu via Get-StartApps —
 * classic desktop apps AND Microsoft Store / UWP apps. AppID is either an
 * exe path, a known-folder-GUID-prefixed path, or an AppUserModelID
 * (AUMIDs for Store apps contain "!").
 */
const LIST_START_APPS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$apps = Get-StartApps | Where-Object { $_.Name -and $_.AppID }
if (-not $apps) { '[]' } else {
  $apps | ForEach-Object { [PSCustomObject]@{ Name = [string]$_.Name; AppID = [string]$_.AppID } } |
    Sort-Object -Property Name | ConvertTo-Json -Compress
}
`;

/**
 * List every launchable application for the "Open application" action picker:
 * desktop apps and Microsoft Store (UWP) apps, sorted by display name.
 *
 * Strategy: Get-StartApps is the master list (it is exactly what the Start
 * Menu shows). Each entry's AppID decides the launch target:
 *   - contains "!"            → Store/UWP AUMID → shell:AppsFolder\<AUMID>
 *   - drive-letter .exe path  → use the path directly (focus-if-running works)
 *   - anything else (GUID-prefixed path or registered AUMID) → recover the
 *     real exe path from the Start Menu .lnk scan by display name when
 *     possible, otherwise fall back to shell:AppsFolder activation.
 * If Get-StartApps is unavailable, degrade to the .lnk scan alone.
 */
export async function listAllApps(): Promise<LaunchableAppInfo[]> {
  const [startAppsRaw, lnkApps] = await Promise.all([
    runPowerShell(LIST_START_APPS_SCRIPT, 15000).catch((err) => {
      console.error('[foregroundApp] Get-StartApps failed:', err);
      return '';
    }),
    listInstalledApps().catch(() => [] as InstalledAppInfo[]),
  ]);

  const lnkByName = new Map(lnkApps.map((app) => [app.displayName.trim().toLowerCase(), app]));

  let startApps: Array<{ Name?: string; AppID?: string }> = [];
  try {
    const parsed = startAppsRaw && startAppsRaw !== '[]' ? JSON.parse(startAppsRaw) : [];
    startApps = Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    console.error('[foregroundApp] Failed to parse Get-StartApps output:', err);
  }

  // Fallback: no Start Apps data — surface the .lnk scan as desktop apps.
  if (startApps.length === 0) {
    return lnkApps
      .map((app) => ({ displayName: app.displayName, launchTarget: app.executablePath, kind: 'desktop' as const }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  const seen = new Set<string>();
  const result: LaunchableAppInfo[] = [];
  for (const entry of startApps) {
    const name = (entry.Name ?? '').trim();
    const appId = (entry.AppID ?? '').trim();
    if (!name || !appId || seen.has(appId)) continue;
    seen.add(appId);

    const isStore = appId.includes('!');
    const isDrivePath = /^[a-z]:\\.+\.exe$/i.test(appId);
    let launchTarget: string;
    if (isStore) {
      launchTarget = `shell:AppsFolder\\${appId}`;
    } else if (isDrivePath) {
      launchTarget = appId;
    } else {
      // Registered AUMID or {KNOWNFOLDERID}\...\app.exe — prefer the .lnk
      // scan's real exe path (enables focus-if-running), else shell-activate.
      launchTarget = lnkByName.get(name.toLowerCase())?.executablePath ?? `shell:AppsFolder\\${appId}`;
    }
    result.push({ displayName: name, launchTarget, kind: isStore ? 'store' : 'desktop' });
  }
  console.log(`[foregroundApp] listAllApps: ${result.length} apps (${result.filter((a) => a.kind === 'store').length} store)`);
  return result;
}

/**
 * List installed applications by scanning Start Menu shortcuts.
 * Used by the dashboard "Installed Apps" picker tab.
 */
export async function listInstalledApps(): Promise<InstalledAppInfo[]> {
  try {
    const trimmed = await runPowerShell(LIST_INSTALLED_SCRIPT, 15000);
    if (!trimmed || trimmed === '[]') {
      console.warn('[foregroundApp] listInstalledApps returned empty');
      return [];
    }

    const parsed = JSON.parse(trimmed);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const result = items
      .filter((p: { Name?: string; ProcessName?: string; Path?: string }) => p.Name && p.Path)
      .map((p: { Name?: string; ProcessName?: string; Path?: string }) => ({
        displayName: p.Name ?? '',
        processName: p.ProcessName ?? '',
        executablePath: p.Path ?? '',
      }));
    console.log(`[foregroundApp] Installed apps: found ${result.length}`);
    return result;
  } catch (err) {
    console.error('[foregroundApp] listInstalledApps failed:', err);
    return [];
  }
}
