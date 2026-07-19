import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import type { ActionType, ForegroundWindowTarget, InputDispatchReceipt } from '../../shared/types';
import { executeKeyboardShortcutAsync, TargetFocusError } from './keyboard';

const execFileAsync = promisify(execFile);

const SHORTCUTS: Partial<Record<ActionType, string>> = {
  'clipboard-copy': 'Ctrl+C',
  'clipboard-paste': 'Ctrl+V',
  'clipboard-cut': 'Ctrl+X',
  'clipboard-undo': 'Ctrl+Z',
  'clipboard-redo': 'Ctrl+Y',
  'screenshot-region': 'Win+Shift+S',
  'screenshot-window': 'Alt+PrintScreen',
  'screenshot-full': 'PrintScreen',
  'lock-workstation': 'Win+L',
  'show-desktop': 'Win+D',
  'window-snap-left': 'Win+Left',
  'window-snap-right': 'Win+Right',
  'window-maximize': 'Win+Up',
  'window-minimize': 'Win+Down',
  'app-switcher': 'Alt+Tab',
  'virtual-desktop-next': 'Ctrl+Win+Right',
  'virtual-desktop-prev': 'Ctrl+Win+Left',
  'emoji-picker': 'Win+.',
  'clipboard-history': 'Win+V',
  'os-search': 'Win+S',
  'zoom-in': 'Ctrl+=',
  'zoom-out': 'Ctrl+-',
};

async function sleepDisplays(): Promise<void> {
  const script = `
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);' -Name Native -Namespace Display
[Display.Native]::SendMessage([IntPtr]0xffff, 0x0112, [IntPtr]0xf170, [IntPtr]2) | Out-Null
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    timeout: 4000,
    windowsHide: true,
  });
}

async function openNewNote(): Promise<void> {
  const child = spawn('notepad.exe', [], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

export function supportsSystemAction(actionType: ActionType): boolean {
  return actionType in SHORTCUTS || actionType === 'sleep-displays' || actionType === 'new-note';
}

/**
 * True for any action that synthesizes keystrokes into the app beneath the
 * overlay. All of these need the overlay to yield foreground input focus first,
 * otherwise the first key can land on the overlay (or the wrong window) instead
 * of the intended target. Covers system shortcuts, direct keyboard shortcuts,
 * keyboard sequences, and macros (which begin with keyboard steps).
 */
export function requiresForegroundInput(actionType: ActionType): boolean {
  return (
    actionType in SHORTCUTS ||
    actionType === 'screenshot' ||
    actionType === 'keyboard-shortcut' ||
    actionType === 'keyboard-sequence' ||
    actionType === 'macro'
  );
}

export async function executeSystemAction(
  actionType: ActionType,
  target: ForegroundWindowTarget | null
): Promise<InputDispatchReceipt | null> {
  if (actionType === 'sleep-displays') {
    await sleepDisplays();
    return null;
  }
  if (actionType === 'new-note') {
    await openNewNote();
    return null;
  }
  const shortcut = SHORTCUTS[actionType];
  if (!shortcut) throw new Error(`Unsupported system action: ${actionType}`);
  if (!target) {
    throw new TargetFocusError(
      'No verified application target is available for this input action.',
      'TARGET_SESSION_MISSING'
    );
  }
  return executeKeyboardShortcutAsync(shortcut, target);
}
