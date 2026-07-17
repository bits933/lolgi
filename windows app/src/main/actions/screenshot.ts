import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Trigger the Windows Snipping Tool. Three-tier fallback:
 *
 *   1. `explorer.exe ms-screenclip:` — launches the Store Snipping Tool's
 *      screen-snip mode directly on Windows 10/11. This is the modern,
 *      supported approach and works reliably even when SnippingTool.exe
 *      has been removed by Microsoft's latest Windows 11 updates.
 *   2. SendInput chord of Win+Shift+S via PowerShell. Uses SendInput (not
 *      keybd_event) because SendInput is atomic — the whole chord is
 *      delivered in one kernel call, preventing the Start menu from opening
 *      when Win is observed in isolation.
 *   3. SnippingTool.exe /clip — last-resort legacy fallback for older
 *      Windows 10 builds.
 */
export function takeScreenshot(): void {
  // Tier 1: modern Windows 10/11 URI protocol handler.
  // `explorer ms-screenclip:` is what Windows uses internally when you press
  // Win+Shift+S, so this is the most direct path.
  try {
    const child = spawn('explorer.exe', ['ms-screenclip:'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    child.on('error', () => {
      triggerViaSendInput();
    });
    return;
  } catch {
    triggerViaSendInput();
  }
}

/**
 * Fallback: synthesize Win+Shift+S using SendInput (atomic keyboard chord).
 */
function triggerViaSendInput(): void {
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class SendInputChord {
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)] public KEYBDINPUT ki;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public INPUTUNION u;
  }

  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

  public const uint INPUT_KEYBOARD = 1;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const ushort VK_LWIN  = 0x5B;
  public const ushort VK_SHIFT = 0x10;
  public const ushort VK_S     = 0x53;

  public static void WinShiftS() {
    INPUT[] inputs = new INPUT[6];
    // Press Win, Shift, S
    inputs[0] = MakeKey(VK_LWIN,  false);
    inputs[1] = MakeKey(VK_SHIFT, false);
    inputs[2] = MakeKey(VK_S,     false);
    // Release S, Shift, Win (reverse order)
    inputs[3] = MakeKey(VK_S,     true);
    inputs[4] = MakeKey(VK_SHIFT, true);
    inputs[5] = MakeKey(VK_LWIN,  true);
    SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  private static INPUT MakeKey(ushort vk, bool up) {
    INPUT i = new INPUT();
    i.type = INPUT_KEYBOARD;
    i.u.ki.wVk = vk;
    i.u.ki.wScan = 0;
    i.u.ki.dwFlags = up ? KEYEVENTF_KEYUP : 0;
    i.u.ki.time = 0;
    i.u.ki.dwExtraInfo = IntPtr.Zero;
    return i;
  }
}
"@
[SendInputChord]::WinShiftS()
`;

  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  execAsync(
    `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
    { timeout: 5000 }
  ).catch((err) => {
    console.error('[screenshot] SendInput fallback failed, trying SnippingTool.exe:', err);
    triggerSnippingToolExe();
  });
}

/**
 * Final fallback: legacy SnippingTool.exe (Windows 10 only).
 */
function triggerSnippingToolExe(): void {
  try {
    const child = spawn('SnippingTool.exe', ['/clip'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    child.on('error', (err) => {
      console.error('[screenshot] All screenshot methods failed:', err);
    });
  } catch (err) {
    console.error('[screenshot] All screenshot methods failed:', err);
  }
}
