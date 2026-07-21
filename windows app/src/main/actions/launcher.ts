import { app, shell } from 'electron';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { getCachedForegroundApp } from '../utils/foregroundApp';

const execAsync = promisify(exec);
const openedUrlHandlers = new Map<string, string>();

// ---------------------------------------------------------------------------
// PowerShell helper — mirrors utils/foregroundApp.ts: pass the script as a
// Base64 UTF-16LE -EncodedCommand so we never fight quoting/escaping.
// ---------------------------------------------------------------------------

function runPowerShell(script: string, timeout = 4000): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execAsync(
    `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
    { timeout }
  ).then(({ stdout }) => stdout.trim());
}

/**
 * Launch an application by file path or executable name.
 */
function splitArguments(value: string): string[] {
  return Array.from(value.matchAll(/(?:[^\s"]+|"[^"]*")+/g), (match) => match[0].replace(/^"|"$/g, ''));
}

/** Matches `shell:AppsFolder\<AUMID>` launch targets (Microsoft Store / UWP apps). */
const SHELL_APPS_FOLDER = /^shell:appsfolder\\/i;

/**
 * Activate an app by its shell:AppsFolder parsing name. This is the only way
 * to launch Microsoft Store / UWP apps (they have no launchable exe path) and
 * also works for desktop apps registered by AUMID. UWP activation is
 * single-instance by design, so an already-running app is focused natively.
 */
function launchShellApp(target: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('explorer.exe', [target], { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export async function launchApp(targetPath: string, argumentsText = ''): Promise<void> {
  if (SHELL_APPS_FOLDER.test(targetPath.trim())) {
    // Arguments cannot be passed through shell activation — the AUMID target
    // is launched exactly as the Start Menu would.
    await launchShellApp(targetPath.trim());
    return;
  }
  if (argumentsText.trim()) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(targetPath, splitArguments(argumentsText), {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
    return;
  }
  const errorMessage = await shell.openPath(targetPath);
  if (errorMessage) throw new Error(errorMessage);
}

// ---------------------------------------------------------------------------
// Focus-if-running (F3.3: "open application — launch or focus-if-running")
// ---------------------------------------------------------------------------
//
// Finds a running process that matches the target (by full exe path when
// available, else by process base name) AND owns a visible main window, then
// brings that window to the foreground. Windows' foreground lock makes a bare
// SetForegroundWindow unreliable, so we use the AttachThreadInput trick plus a
// SW_RESTORE for minimized windows — the well-established robust incantation.

/**
 * Build the PowerShell activation script for a given target path.
 * Outputs "OK" if an existing window was focused, "NONE" if the app isn't
 * running with a visible window.
 */
function buildFocusScript(targetPath: string): string {
  // Base process name without extension, e.g. "C:\\...\\chrome.exe" -> "chrome"
  const baseName = path.basename(targetPath).replace(/\.(exe|lnk|bat|cmd)$/i, '');
  // Escape single quotes for safe embedding in a single-quoted PS string literal.
  const psPath = targetPath.replace(/'/g, "''");
  const psBase = baseName.replace(/'/g, "''");

  return `
Add-Type -MemberDefinition '
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
' -Name FGWin -Namespace Win32 -ErrorAction SilentlyContinue

$target = '${psPath}'
$base = '${psBase}'
$proc = Get-Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.MainWindowHandle -ne 0 -and (
      ($_.Path -and $_.Path -ieq $target) -or ($_.ProcessName -ieq $base)
    )
  } | Select-Object -First 1

if (-not $proc) { 'NONE'; return }

$h = $proc.MainWindowHandle
# SW_RESTORE = 9 — un-minimize without changing a normal/maximized window.
if ([Win32.FGWin]::IsIconic($h)) { [Win32.FGWin]::ShowWindow($h, 9) | Out-Null }

$appThread = [Win32.FGWin]::GetCurrentThreadId()
$fgWin = [Win32.FGWin]::GetForegroundWindow()
$procIdOut = [uint32]0
$fgThread = [Win32.FGWin]::GetWindowThreadProcessId($fgWin, [ref]$procIdOut)

if ($fgThread -ne $appThread) {
  [Win32.FGWin]::AttachThreadInput($fgThread, $appThread, $true) | Out-Null
  [Win32.FGWin]::BringWindowToTop($h) | Out-Null
  [Win32.FGWin]::SetForegroundWindow($h) | Out-Null
  [Win32.FGWin]::AttachThreadInput($fgThread, $appThread, $false) | Out-Null
} else {
  [Win32.FGWin]::BringWindowToTop($h) | Out-Null
  [Win32.FGWin]::SetForegroundWindow($h) | Out-Null
}
'OK'
`;
}

/**
 * If the target application is already running with a visible window, bring it
 * to the foreground and return true. Returns false if it isn't running (so the
 * caller should launch it) or on any failure.
 */
export async function focusRunningApp(targetPath: string): Promise<boolean> {
  if (!targetPath) return false;
  const foreground = getCachedForegroundApp();
  const targetBaseName = path.basename(targetPath).replace(/\.(exe|lnk|bat|cmd)$/i, '').toLowerCase();
  const foregroundBaseName = foreground?.processName.replace(/\.exe$/i, '').toLowerCase();
  const sameExecutable = Boolean(
    foreground?.executablePath &&
    path.normalize(foreground.executablePath).toLowerCase() === path.normalize(targetPath).toLowerCase()
  );
  if (sameExecutable || (targetBaseName && targetBaseName === foregroundBaseName)) {
    // The requested app already owns the foreground window; avoid an otherwise
    // expensive process scan and foreground activation round-trip.
    return true;
  }
  try {
    const out = await runPowerShell(buildFocusScript(targetPath), 4000);
    return out.includes('OK');
  } catch (err) {
    console.error(`[launcher] focusRunningApp failed for "${targetPath}":`, err);
    return false;
  }
}

/**
 * F3.3 "switch-to" semantics: focus the app if it's already running, otherwise
 * launch it.
 */
export async function launchOrFocusApp(targetPath: string, argumentsText = ''): Promise<void> {
  // shell:AppsFolder activation already focuses a running instance (UWP apps
  // are single-instance activated) — skip the exe-based process scan.
  if (SHELL_APPS_FOLDER.test(targetPath.trim())) {
    await launchShellApp(targetPath.trim());
    return;
  }
  const focused = await focusRunningApp(targetPath);
  if (focused) return;
  await launchApp(targetPath, argumentsText);
}

/**
 * Open a URL in the default browser.
 */
export async function openUrl(url: string): Promise<void> {
  const normalizedUrl = url.includes('://') || url.startsWith('mailto:') ? url : `https://${url}`;
  const parsed = new URL(normalizedUrl);
  if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
    throw new Error('Only http, https, and mailto URLs are allowed.');
  }
  const targetUrl = parsed.toString();
  const isWebUrl = parsed.protocol === 'http:' || parsed.protocol === 'https:';
  const previousHandler = isWebUrl ? openedUrlHandlers.get(targetUrl) : undefined;
  if (previousHandler && await focusRunningApp(previousHandler)) return;

  const handler = isWebUrl
    ? await app.getApplicationInfoForProtocol(targetUrl).then((info) => info.path).catch(() => '')
    : '';
  await shell.openExternal(targetUrl);
  if (handler) openedUrlHandlers.set(targetUrl, handler);
  else openedUrlHandlers.delete(targetUrl);
}

export async function openPath(targetPath: string): Promise<void> {
  if (!targetPath.trim()) throw new Error('No file or folder path provided.');
  const errorMessage = await shell.openPath(targetPath);
  if (errorMessage) throw new Error(errorMessage);
}

export interface CommandPayload {
  command: string;
  arguments?: string;
  workingDirectory?: string;
  hidden?: boolean;
  runAsAdmin?: boolean;
}

/**
 * Quote a command token for cmd.exe if it contains whitespace, e.g. an
 * unquoted "C:\Program Files\App\app.exe" gets split at the first space and
 * cmd.exe tries to run the nonexistent "C:\Program". Node's `exec()` on
 * Windows (`cmd /d /s /c`) correctly re-parses a leading quoted token
 * followed by trailing arguments, so quoting only the command is sufficient.
 */
function quoteCommandToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || (trimmed.startsWith('"') && trimmed.endsWith('"'))) return trimmed;
  return /\s/.test(trimmed) ? `"${trimmed}"` : trimmed;
}

export async function runCommand(payload: string, overrides: Partial<CommandPayload> = {}): Promise<void> {
  let config: CommandPayload;
  try {
    const parsed = JSON.parse(payload) as Partial<CommandPayload>;
    config = {
      command: parsed.command ?? '',
      arguments: parsed.arguments,
      workingDirectory: parsed.workingDirectory ?? (parsed as { cwd?: string }).cwd,
      hidden: parsed.hidden,
      runAsAdmin: parsed.runAsAdmin,
    };
  } catch {
    config = { command: payload };
  }
  config = { ...config, ...overrides };
  if (!config.command.trim()) throw new Error('No command provided.');
  const commandLine = [quoteCommandToken(config.command), config.arguments].filter(Boolean).join(' ');
  if (config.runAsAdmin) {
    const escapePowerShell = (value: string) => value.replace(/'/g, "''");
    const workingDirectory = config.workingDirectory
      ? ` -WorkingDirectory '${escapePowerShell(config.workingDirectory)}'`
      : '';
    await runPowerShell(
      `Start-Process -FilePath 'powershell.exe' -Verb RunAs${workingDirectory} -ArgumentList @('-NoProfile','-Command','${escapePowerShell(commandLine)}')`,
      30000
    );
    return;
  }
  // Spawn detached and resolve as soon as the process starts, instead of blocking
  // until it exits. A launcher-style action should report "started" quickly;
  // awaiting the full process lifetime (previously up to 30s) held the ring's
  // selection lock and made the UI feel frozen for long-running commands. The
  // trade-off is that a non-zero exit code is no longer surfaced as a failure —
  // consistent with how file-open / url-open already behave.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(commandLine, {
      cwd: config.workingDirectory || undefined,
      windowsHide: config.hidden ?? true,
      detached: true,
      stdio: 'ignore',
      shell: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
