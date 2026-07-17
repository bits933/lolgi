import { app } from 'electron';
import { promises as fs } from 'fs';
import { runPowerShell } from './foregroundApp';

// ---------------------------------------------------------------------------
// Application icon extraction
// ---------------------------------------------------------------------------
//
// Turns a launch target into a PNG data URL suitable for `<img src=...>`
// inside a bubble. Two routes:
//
//   1. Exe / lnk paths — Electron's built-in app.getFileIcon, which asks the
//      Windows shell for the file's associated icon (SHGetFileInfo). Fast,
//      in-process, no PowerShell.
//   2. `shell:AppsFolder\<AUMID>` targets (Microsoft Store / UWP apps, which
//      have no exe path) — IShellItemImageFactory via PowerShell P/Invoke,
//      which returns the exact icon the Start Menu shows for the app.
//
// Windows note: app.getFileIcon caps BOTH 'normal' and 'large' at 32x32, so we
// request 'large' (the platform ceiling — and genuinely bigger on Linux) and
// upscale to 64px for crispness at the 24-48px sizes the UI renders at.

const ICON_TARGET_SIZE = 64;

const SHELL_APPS_FOLDER = /^shell:appsfolder\\/i;

/** PNG magic bytes — reject anything that isn't a decodable PNG before storing. */
function toPngDataUrl(bytes: Buffer): string | null {
  if (bytes.length < 100) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

/**
 * True when a stored icon data URL is a plausibly renderable image. Used by the
 * startup self-heal to spot icons persisted by the old, unvalidated extraction
 * path (which could save junk that renders as a broken <img> in bubbles).
 * SVG data URLs (brand icons) are accepted as-is.
 */
export function isValidImageDataUrl(value: string | undefined | null): boolean {
  if (!value) return false;
  if (value.startsWith('data:image/svg+xml')) return value.length > 40;
  const match = value.match(/^data:image\/png;base64,(.+)$/);
  if (!match) return false;
  try {
    const bytes = Buffer.from(match[1], 'base64');
    return bytes.length >= 100 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  } catch {
    return false;
  }
}

/**
 * Primary route for Microsoft Store / UWP apps: read the app's real logo PNG
 * straight out of its package, as declared in AppxManifest.xml. Deterministic
 * file reads — unlike IShellItemImageFactory, which can fail outright or hand
 * back a generic placeholder tile for packaged apps (observed with WhatsApp).
 *
 * Asset selection: manifest logos are stems (Assets\AppList.png) whose real
 * files carry qualifiers. Prefer targetsize-* closest to 64px, with the
 * altform-unplated variant (the bare glyph, no tile plate — matches the
 * ring's dark bubbles) winning ties; then largest scale-*; then the stem.
 */
function buildStoreLogoScript(family: string, packageName: string, applicationId: string): string {
  const escape = (value: string) => value.replace(/'/g, "''");
  return `
$ErrorActionPreference = 'SilentlyContinue'
$pkg = Get-AppxPackage -Name '${escape(packageName)}' | Where-Object { $_.PackageFamilyName -eq '${escape(family)}' } | Select-Object -First 1
if (-not $pkg -or -not $pkg.InstallLocation) { return }
$manifestPath = Join-Path $pkg.InstallLocation 'AppxManifest.xml'
if (-not (Test-Path -LiteralPath $manifestPath)) { return }
[xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
$apps = @($manifest.Package.Applications.Application)
$app = $apps | Where-Object { $_.Id -eq '${escape(applicationId)}' } | Select-Object -First 1
if (-not $app) { $app = $apps | Select-Object -First 1 }
if (-not $app) { return }
$logoRel = $app.VisualElements.Square44x44Logo
if (-not $logoRel) { $logoRel = $app.VisualElements.Square150x150Logo }
if (-not $logoRel) { $logoRel = $manifest.Package.Properties.Logo }
if (-not $logoRel) { return }
$logoAbs = Join-Path $pkg.InstallLocation $logoRel
$dir = Split-Path -Parent $logoAbs
$stem = [System.IO.Path]::GetFileNameWithoutExtension($logoAbs)
$ext = [System.IO.Path]::GetExtension($logoAbs)
if (-not (Test-Path -LiteralPath $dir)) { return }
$files = @(Get-ChildItem -LiteralPath $dir -File -Filter ($stem + '*' + $ext))
$best = $null
$targets = foreach ($f in $files) {
  if ($f.Name -imatch ('^' + [regex]::Escape($stem) + '\\.targetsize-(\\d+)(_altform-unplated)?' + [regex]::Escape($ext) + '$')) {
    [PSCustomObject]@{ File = $f; Distance = [math]::Abs([int]$Matches[1] - 64); Plated = [int](-not $Matches[2]) }
  }
}
if ($targets) { $best = ($targets | Sort-Object Distance, Plated | Select-Object -First 1).File }
if (-not $best) {
  $scales = foreach ($f in $files) {
    if ($f.Name -imatch ('^' + [regex]::Escape($stem) + '\\.scale-(\\d+)' + [regex]::Escape($ext) + '$')) {
      [PSCustomObject]@{ File = $f; Scale = [int]$Matches[1] }
    }
  }
  if ($scales) { $best = ($scales | Sort-Object Scale -Descending | Select-Object -First 1).File }
}
if (-not $best -and (Test-Path -LiteralPath $logoAbs)) { $best = Get-Item -LiteralPath $logoAbs }
if (-not $best -and $files) { $best = $files[0] }
if ($best) { $best.FullName }
`;
}

async function extractStoreLogoIcon(aumid: string): Promise<string | null> {
  const separator = aumid.indexOf('!');
  if (separator <= 0) return null;
  const family = aumid.slice(0, separator);
  const applicationId = aumid.slice(separator + 1);
  // PackageFamilyName = <Name>_<publisher hash> — Get-AppxPackage matches on Name.
  const packageName = family.replace(/_[^_]+$/, '');
  try {
    const logoPath = await runPowerShell(buildStoreLogoScript(family, packageName, applicationId), 10000);
    if (!logoPath) return null;
    return toPngDataUrl(await fs.readFile(logoPath));
  } catch (err) {
    console.error(`[appIcon] Store logo extraction failed for "${aumid}":`, err);
    return null;
  }
}

/**
 * IShellItemImageFactory::GetImage over SHCreateItemFromParsingName — works
 * for any shell parsing name, including shell:AppsFolder AUMIDs. The
 * LockBits(Format32bppArgb) re-read is the standard trick to recover the
 * alpha channel that Image.FromHbitmap drops.
 */
function buildShellIconScript(parsingName: string, size: number): string {
  const psTarget = parsingName.replace(/'/g, "''");
  return `
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
public static class ShellIcon {
  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItemImageFactory {
    [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm);
  }
  [StructLayout(LayoutKind.Sequential)]
  private struct SIZE { public int cx; public int cy; }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  private static extern void SHCreateItemFromParsingName(string pszPath, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory ppv);
  [DllImport("gdi32.dll")]
  private static extern bool DeleteObject(IntPtr hObject);
  public static string GetIconBase64(string parsingName, int size) {
    Guid iid = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
    IShellItemImageFactory factory;
    SHCreateItemFromParsingName(parsingName, IntPtr.Zero, ref iid, out factory);
    SIZE dimensions; dimensions.cx = size; dimensions.cy = size;
    IntPtr hbm;
    int hr = factory.GetImage(dimensions, 0, out hbm);
    if (hr != 0) Marshal.ThrowExceptionForHR(hr);
    try {
      using (Bitmap source = Image.FromHbitmap(hbm)) {
        Bitmap argb;
        if (Image.GetPixelFormatSize(source.PixelFormat) == 32) {
          BitmapData data = source.LockBits(new Rectangle(0, 0, source.Width, source.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
          try { argb = new Bitmap(new Bitmap(source.Width, source.Height, data.Stride, PixelFormat.Format32bppArgb, data.Scan0)); }
          finally { source.UnlockBits(data); }
        } else {
          argb = new Bitmap(source);
        }
        using (argb)
        using (MemoryStream stream = new MemoryStream()) {
          argb.Save(stream, ImageFormat.Png);
          return Convert.ToBase64String(stream.ToArray());
        }
      }
    } finally { DeleteObject(hbm); }
  }
}
'@
[ShellIcon]::GetIconBase64('${psTarget}', ${size})
`;
}

async function extractShellItemIcon(parsingName: string): Promise<string | null> {
  try {
    // Add-Type compilation makes the first call slow (~1-2s) — allow headroom.
    const base64 = await runPowerShell(buildShellIconScript(parsingName, ICON_TARGET_SIZE), 12000);
    if (!base64) return null;
    // Validate: PowerShell noise or a truncated stream must never become a
    // broken <img> in a bubble.
    return toPngDataUrl(Buffer.from(base64, 'base64'));
  } catch (err) {
    console.error(`[appIcon] Shell icon extraction failed for "${parsingName}":`, err);
    return null;
  }
}

/** Only *successful* results are cached — failures may retry (they can be transient). */
const iconCache = new Map<string, string>();
/** De-duplicate concurrent extractions of the same path (mirrors foregroundApp.ts). */
const inFlight = new Map<string, Promise<string | null>>();

/**
 * Extract an application's icon as a PNG data URL.
 *
 * Accepts either an absolute .exe/.lnk path or a `shell:AppsFolder\<AUMID>`
 * target (Microsoft Store / UWP apps). Returns `null` (never throws) for a
 * missing/invalid target, an empty shell icon, or any failure — callers then
 * fall back to the bubble's Lucide glyph.
 *
 * @param filePath Launch target as stored in a bubble's payload.
 */
export async function extractAppIcon(filePath: string): Promise<string | null> {
  const key = filePath?.trim().toLowerCase();
  if (!key) return null;

  const cached = iconCache.get(key);
  if (cached) return cached;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = extractUncached(filePath)
    .then((result) => {
      if (result) iconCache.set(key, result); // never cache failures — allow retry
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

async function extractUncached(filePath: string): Promise<string | null> {
  const target = filePath.trim();
  if (SHELL_APPS_FOLDER.test(target)) {
    // Manifest logo first (real icon, plain file read); shell factory only as
    // fallback — it can return placeholder tiles for packaged apps.
    const aumid = target.replace(SHELL_APPS_FOLDER, '');
    return (await extractStoreLogoIcon(aumid)) ?? extractShellItemIcon(target);
  }
  try {
    // getFileIcon requires the app to be ready on Windows — guard defensively
    // in case this is ever reached outside the IPC (post-ready) path.
    if (!app.isReady()) await app.whenReady();

    const image = await app.getFileIcon(filePath, { size: 'large' });
    if (!image || image.isEmpty()) return null;

    const sized = image.resize({ width: ICON_TARGET_SIZE, height: ICON_TARGET_SIZE, quality: 'best' });
    const dataUrl = sized.toDataURL();

    // Belt-and-suspenders: reject a technically-non-empty but degenerate image.
    return dataUrl && dataUrl.length > 'data:image/png;base64,'.length ? dataUrl : null;
  } catch (err) {
    console.error(`[appIcon] Failed to extract icon for "${filePath}":`, err);
    return null;
  }
}
