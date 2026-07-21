/**
 * Shared keyboard-shortcut vocabulary, parser, and validator.
 *
 * This is the single source of truth for what a valid shortcut chord looks like.
 * The main process (`actions/keyboard.ts`) uses `VK` + `parseShortcut` to
 * synthesize input via SendInput; the dashboard (`actionCatalog.ts`) uses
 * `validateShortcut` to reject malformed bindings before they are saved. Keeping
 * both on the same vocabulary prevents a shortcut that "saves fine" but then
 * sends a bare modifier with no main key at runtime.
 *
 * Pure module — no Node/Electron/DOM dependencies — safe to import anywhere.
 */

/**
 * Virtual-key codes for a single atomic SendInput batch. Covers letters, digits,
 * F-keys, and the common navigation/editing/punctuation keys. See:
 * https://learn.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes
 */
export const VK: Record<string, number> = {
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

export type CanonicalModifier = 'ctrl' | 'shift' | 'alt' | 'win';

/** Maps every accepted modifier spelling to its canonical form, or null. */
export function canonicalModifier(token: string): CanonicalModifier | null {
  switch (token) {
    case 'ctrl':
    case 'control':
      return 'ctrl';
    case 'shift':
      return 'shift';
    case 'alt':
      return 'alt';
    case 'win':
    case 'meta':
    case 'super':
    case 'cmd':
    case 'command':
      return 'win';
    default:
      return null;
  }
}

export interface ParsedShortcut {
  /** VK codes of the modifiers, in the order encountered. */
  modifiers: number[];
  /** VK code of the main (non-modifier) key, or null if none was given. */
  key: number | null;
  /** True when a Windows/Meta key is part of the chord. */
  hasWin: boolean;
  /** Raw token used as the main key (for messages), or null. */
  keyToken: string | null;
  /** Tokens that are neither a modifier nor a known key. */
  unknownTokens: string[];
  /** True when the same modifier appears more than once (e.g. Ctrl+Ctrl+C). */
  duplicateModifiers: boolean;
  /** Additional main keys beyond the first (a chord should have exactly one). */
  extraKeys: string[];
}

/**
 * Parse a shortcut string such as "Ctrl+Shift+S" into modifier/key VK codes.
 * Recognition is case-insensitive. Unknown, duplicate, and extra tokens are
 * recorded rather than thrown so both the runtime and the validator can decide
 * how strict to be.
 */
export function parseShortcut(shortcut: string): ParsedShortcut {
  const parts = shortcut.split('+').map((part) => part.trim().toLowerCase());
  const modifiers: number[] = [];
  const seenModifiers = new Set<CanonicalModifier>();
  const unknownTokens: string[] = [];
  const extraKeys: string[] = [];
  let key: number | null = null;
  let keyToken: string | null = null;
  let hasWin = false;
  let duplicateModifiers = false;

  for (const part of parts) {
    if (!part) continue;
    const modifier = canonicalModifier(part);
    if (modifier) {
      if (seenModifiers.has(modifier)) {
        duplicateModifiers = true;
        continue;
      }
      seenModifiers.add(modifier);
      if (modifier === 'win') hasWin = true;
      modifiers.push(VK[modifier === 'ctrl' ? 'ctrl' : modifier]);
      continue;
    }
    const vk = VK[part];
    if (vk !== undefined) {
      if (key !== null && keyToken !== null) extraKeys.push(keyToken);
      key = vk;
      keyToken = part;
      continue;
    }
    unknownTokens.push(part);
  }

  return { modifiers, key, hasWin, keyToken, unknownTokens, duplicateModifiers, extraKeys };
}

/**
 * Validate a single shortcut chord for saving. Returns a human-readable reason
 * when the chord is unusable, or null when it is valid. Rejects: empty strings,
 * unknown key tokens, modifier-only chords (no main key), duplicate modifiers,
 * and multiple main keys.
 */
export function validateShortcut(shortcut: string | undefined | null): string | null {
  const raw = (shortcut ?? '').trim();
  if (!raw) return 'Enter a keyboard shortcut.';

  const parsed = parseShortcut(raw);
  if (parsed.unknownTokens.length > 0) {
    return `"${parsed.unknownTokens.join('", "')}" is not a recognized key.`;
  }
  if (parsed.duplicateModifiers) {
    return 'Remove the duplicate modifier key.';
  }
  if (parsed.key === null) {
    return 'Add a main key — a shortcut needs more than modifier keys.';
  }
  if (parsed.extraKeys.length > 0) {
    return 'Use only one main key per shortcut.';
  }
  return null;
}

/** The subset of a keydown event needed to derive a shortcut string — structurally
 *  compatible with both DOM KeyboardEvent and React's synthetic KeyboardEvent, so
 *  callers never need to import a DOM lib type into this dependency-free module. */
export interface KeyPressLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * Converts a physical keydown event into a canonical shortcut string such as
 * "Ctrl+Shift+S". Shared by every key-capture control (ActionToolbar's shortcut
 * fields, MacroStepEditor's key chips, HotkeyConfig's global-hotkey recorder) so
 * a captured press always round-trips through the exact vocabulary parseShortcut
 * reads back. Returns null for a bare modifier press (Control/Alt/Shift/Meta
 * alone) or Tab, so the caller can keep listening for a fuller combo.
 */
export function shortcutFromKeyEvent(event: KeyPressLike): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta', 'Tab'].includes(event.key)) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  parts.push(key);
  return parts.join('+');
}

/**
 * True when a `keys:` token should be sent as a single key press rather than
 * typed character by character: a valid chord that either carries a modifier
 * (Ctrl+A, Shift+Enter) or names a multi-character key (Enter, Tab, Esc, F1,
 * arrows). A bare single character returns false so it is typed — pressing its
 * key and typing it produce the identical SendInput.
 */
function isPressableKeyToken(token: string): boolean {
  const parsed = parseShortcut(token);
  const isSingleValidKey =
    parsed.key !== null &&
    parsed.unknownTokens.length === 0 &&
    parsed.extraKeys.length === 0 &&
    !parsed.duplicateModifiers;
  if (!isSingleValidKey) return false;
  return parsed.modifiers.length > 0 || token.length > 1;
}

/**
 * Plan a `keys:` directive into an ordered list of shortcut strings, one per
 * SendInput dispatch. Whitespace separates tokens. A token that names a real key
 * or chord (Enter, Tab, F1, Ctrl+A, Shift+Enter) is kept whole so it is pressed
 * as a key; every other token is a run of literal characters — a command alias
 * such as "PL" — and is exploded into one keystroke per character so it is typed,
 * not interpreted. This lets a single `keys:` step mix typed command text with
 * real Enter/modifier presses (e.g. "PL Enter" or "LAYISO Enter").
 */
export function planKeystrokes(sequence: string): string[] {
  const plan: string[] = [];
  for (const token of sequence.split(/\s+/)) {
    if (!token) continue;
    if (isPressableKeyToken(token)) {
      plan.push(token);
    } else {
      for (const character of token) plan.push(character);
    }
  }
  return plan;
}
