import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Virtual-key codes for a single atomic SendInput batch. Covers letters, digits, F-keys, and
 * the common navigation/editing keys. See:
 * https://learn.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes
 */
const VK: Record<string, number> = {
  // Letters
  a: 0x41, b: 0x42, c: 0x43, d: 0x44, e: 0x45, f: 0x46, g: 0x47, h: 0x48,
  i: 0x49, j: 0x4A, k: 0x4B, l: 0x4C, m: 0x4D, n: 0x4E, o: 0x4F, p: 0x50,
  q: 0x51, r: 0x52, s: 0x53, t: 0x54, u: 0x55, v: 0x56, w: 0x57, x: 0x58,
  y: 0x59, z: 0x5A,
  // Digits
  '0': 0x30, '1': 0x31, '2': 0x32, '3': 0x33, '4': 0x34,
  '5': 0x35, '6': 0x36, '7': 0x37, '8': 0x38, '9': 0x39,
  // Function keys
  f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73, f5: 0x74, f6: 0x75,
  f7: 0x76, f8: 0x77, f9: 0x78, f10: 0x79, f11: 0x7A, f12: 0x7B,
  // Modifiers
  shift: 0x10, ctrl: 0x11, control: 0x11, alt: 0x12, win: 0x5B, meta: 0x5B,
  // Navigation / editing
  enter: 0x0D, return: 0x0D, tab: 0x09, escape: 0x1B, esc: 0x1B, space: 0x20,
  backspace: 0x08, delete: 0x2E, insert: 0x2D,
  home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
  left: 0x25, up: 0x26, right: 0x27, down: 0x28,
  printscreen: 0x2C, prtsc: 0x2C,
  // Punctuation
  ';': 0xBA, '=': 0xBB, ',': 0xBC, '-': 0xBD, '.': 0xBE, '/': 0xBF,
  '`': 0xC0, '[': 0xDB, '\\': 0xDC, ']': 0xDD, "'": 0xDE,
};

interface ParsedShortcut {
  modifiers: number[]; // VK codes of modifiers
  key: number | null; // VK code of main key
  hasWin: boolean;
}

function parseShortcut(shortcut: string): ParsedShortcut {
  const parts = shortcut.split('+').map((p) => p.trim().toLowerCase());
  const modifiers: number[] = [];
  let key: number | null = null;
  let hasWin = false;

  for (const part of parts) {
    if (!part) continue;
    if (part === 'ctrl' || part === 'control') modifiers.push(VK.ctrl);
    else if (part === 'shift') modifiers.push(VK.shift);
    else if (part === 'alt') modifiers.push(VK.alt);
    else if (part === 'win' || part === 'meta' || part === 'super') {
      modifiers.push(VK.win);
      hasWin = true;
    } else {
      const vk = VK[part];
      if (vk !== undefined) key = vk;
    }
  }
  return { modifiers, key, hasWin };
}

/**
 * Execute a keyboard shortcut string.
 *
 * Uses the Windows SendInput API via PowerShell P/Invoke to synthesize a
 * proper chord atomically: all modifiers down, main key down+up, all modifiers up.
 * This is the only reliable way to send Win-key combos (WScript.Shell.SendKeys
 * does NOT support the Win key at all).
 *
 * Falls back to SendKeys only for complex sequences we can't chord (e.g.
 * multi-character sequences).
 */
export async function executeKeyboardShortcutAsync(shortcut: string): Promise<void> {
  const { modifiers, key, hasWin } = parseShortcut(shortcut);

  if (key === null && modifiers.length === 0) {
    console.warn(`[keyboard] Shortcut "${shortcut}" has no recognisable keys — skipping`);
    throw new Error(`Shortcut "${shortcut}" has no recognizable keys.`);
  }

  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
public class K {
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
  public struct INPUT { public uint type; public INPUTUNION u; }
  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint count, INPUT[] inputs, int size);

  private static INPUT Key(ushort vk, bool up) {
    INPUT input = new INPUT();
    input.type = 1;
    input.u.ki.wVk = vk;
    input.u.ki.dwFlags = up ? 2u : 0u;
    return input;
  }

  public static void SendChord(byte[] modifiers, byte key, bool hasKey) {
    List<INPUT> inputs = new List<INPUT>();
    foreach (byte modifier in modifiers) inputs.Add(Key(modifier, false));
    if (hasKey) {
      inputs.Add(Key(key, false));
      inputs.Add(Key(key, true));
    }
    for (int index = modifiers.Length - 1; index >= 0; index--) inputs.Add(Key(modifiers[index], true));
    INPUT[] batch = inputs.ToArray();
    uint sent = SendInput((uint)batch.Length, batch, Marshal.SizeOf(typeof(INPUT)));
    if (sent != batch.Length) throw new Win32Exception(Marshal.GetLastWin32Error());
  }
}
"@
[K]::SendChord([byte[]]@(${modifiers.join(',')}), [byte]${key ?? 0}, $${key !== null ? 'true' : 'false'})
`;

  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  await execAsync(
    `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
    { timeout: 4000 }
  ).catch((err) => {
    console.error(`[keyboard] Failed to execute shortcut "${shortcut}" (win=${hasWin}):`, err);
    throw err;
  });
}

/** Fire-and-forget compatibility wrapper used by older callers. */
export function executeKeyboardShortcut(shortcut: string): void {
  void executeKeyboardShortcutAsync(shortcut).catch(() => {});
}

export async function executeKeyboardSequence(payload: string): Promise<void> {
  const lines = payload
    .split(/[;\n]/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const delay = line.match(/^(?:delay:)?(\d+)ms$/i);
    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, Number(delay[1])));
      continue;
    }
    await executeKeyboardShortcutAsync(line);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
