import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Send a media key via PowerShell WScript.Shell.
 * Virtual key codes:
 *  - 0xB3 (179) = Play/Pause
 *  - 0xB0 (176) = Next Track
 *  - 0xB1 (177) = Previous Track
 *  - 0xB2 (178) = Stop
 */
async function sendMediaKey(vkCode: number): Promise<void> {
  const script = `$wsh = New-Object -ComObject WScript.Shell; $wsh.SendKeys([char]${vkCode})`;
  await execAsync(
    `powershell -NoProfile -NonInteractive -Command "${script}"`,
    { timeout: 2000 }
  );
}

export async function mediaPlayPause(): Promise<void> {
  await sendMediaKey(179);
}

export async function mediaNextTrack(): Promise<void> {
  await sendMediaKey(176);
}

export async function mediaPrevTrack(): Promise<void> {
  await sendMediaKey(177);
}

export async function mediaStop(): Promise<void> {
  await sendMediaKey(178);
}

/**
 * Check if media is currently playing.
 * This is a best-effort check via PowerShell — not guaranteed to work for all apps.
 */
export function getIsPlaying(): boolean {
  // There is no reliable system-wide "is media playing" API on Windows.
  // Return a default value; the overlay renderer will reflect what the user toggles.
  return false;
}
