import { exec } from 'child_process';
import { promisify } from 'util';
import type { ForegroundAppInfo, LaunchableAppInfo } from '../../shared/types';

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Utility: run a PowerShell script via -EncodedCommand (Base64 UTF-16LE).
// This avoids ALL quoting / escaping issues with heredoc (@"..."@), double
// quotes inside strings, and embedded newlines.
// ---------------------------------------------------------------------------

export function runPowerShell(script: string, timeout = 3000): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execAsync(
    `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
    { timeout, maxBuffer: 4 * 1024 * 1024 }
  ).then(({ stdout }) => stdout.trim());
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
  @{ Name = $p.ProcessName; Path = $p.Path; Title = $p.MainWindowTitle } | ConvertTo-Json -Compress
}
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
// Cache & polling
// ---------------------------------------------------------------------------

let cachedForegroundApp: ForegroundAppInfo | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let inFlightPromise: Promise<ForegroundAppInfo | null> | null = null;
let isPolling = false;
let actionDispatchDepth = 0;
let pollingIntervalMs = 1000;

/**
 * Query the foreground app via PowerShell.
 * Deduplicates concurrent calls (same pattern as volume.ts).
 */
export async function getForegroundApp(): Promise<ForegroundAppInfo | null> {
  if (inFlightPromise) return inFlightPromise;

  inFlightPromise = (async () => {
    try {
      const trimmed = await runPowerShell(FOREGROUND_SCRIPT, 3000);
      if (!trimmed) {
        inFlightPromise = null;
        return cachedForegroundApp;
      }

      const parsed = JSON.parse(trimmed);
       const nextForegroundApp = {
         processName: parsed.Name ?? '',
         executablePath: parsed.Path ?? '',
         windowTitle: parsed.Title ?? '',
       };
       const foregroundChanged =
         cachedForegroundApp?.processName !== nextForegroundApp.processName ||
         cachedForegroundApp?.executablePath !== nextForegroundApp.executablePath;
       cachedForegroundApp = nextForegroundApp;
       if (foregroundChanged && process.env['ELECTRON_DEV']) {
         console.debug('[foregroundApp] Detected:', cachedForegroundApp.processName);
       }
    } catch (err) {
      console.error('[foregroundApp] Detection failed:', err);
      // Keep cached value on failure
    }
    inFlightPromise = null;
    return cachedForegroundApp;
  })();

  return inFlightPromise;
}

/**
 * Returns the cached foreground app instantly — no PowerShell call.
 * Safe to call from the hotkey trigger hot path.
 */
export function getCachedForegroundApp(): ForegroundAppInfo | null {
  return cachedForegroundApp;
}

/**
 * Start background polling of the foreground application.
 * Each poll updates the in-memory cache so `getCachedForegroundApp()` is always fresh.
 */
function scheduleForegroundPoll(delayMs = pollingIntervalMs): void {
  if (!isPolling) return;
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    // Do not contend with an action for a fresh PowerShell process. The cached
    // foreground app remains available to the hotkey path while we defer.
    if (actionDispatchDepth === 0) await getForegroundApp().catch(() => {});
    scheduleForegroundPoll(pollingIntervalMs);
  }, delayMs);
}

export function setForegroundPollingBusy(isBusy: boolean): void {
  actionDispatchDepth = Math.max(0, actionDispatchDepth + (isBusy ? 1 : -1));
}

export function startForegroundAppPolling(intervalMs = 1000): void {
  if (isPolling) return;
  isPolling = true;
  pollingIntervalMs = Math.max(750, intervalMs);
  // Initial warm-up happens once; later polls are scheduled only after the
  // previous poll has settled, avoiding continuous PowerShell process churn.
  getForegroundApp().catch(() => {}).finally(() => scheduleForegroundPoll());
}

export function stopForegroundAppPolling(): void {
  isPolling = false;
  if (!pollTimer) return;
  clearTimeout(pollTimer);
  pollTimer = null;
}

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
