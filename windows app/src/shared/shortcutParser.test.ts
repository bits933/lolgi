import { describe, expect, it } from 'vitest';
import { parseShortcut, validateShortcut } from './shortcutParser';

describe('shortcut parser', () => {
  it('accepts the punctuation and modifier chords shipped in the app presets', () => {
    const chords = [
      'Ctrl+C', 'Ctrl+Shift+S', 'Alt+[', 'Alt+]', 'Ctrl+=', 'Ctrl+-', 'Ctrl+/', 'Ctrl+`',
      'Ctrl+.', 'Ctrl+,', 'Ctrl+Shift+.', 'Ctrl+Shift+,', 'Alt+Shift+.', 'Alt+.', 'Alt+,',
      'Right', 'Left', 'Up', 'Down', 'Shift+Right', 'Ctrl+Down', 'Ctrl+Shift+]', 'Ctrl+]', 'Ctrl+[',
      'F5', 'Win+Shift+S', "Ctrl+'", 'Shift+1', 'Ctrl+0', 'Ctrl+Alt+Shift+N',
    ];
    for (const chord of chords) {
      expect(validateShortcut(chord), chord).toBeNull();
    }
  });

  it('rejects unknown key tokens', () => {
    expect(validateShortcut('Ctrl+NotAKey')).toMatch(/not a recognized key/i);
    expect(validateShortcut('Frobnicate')).toMatch(/not a recognized key/i);
  });

  it('rejects modifier-only chords', () => {
    expect(validateShortcut('Ctrl')).toMatch(/main key/i);
    expect(validateShortcut('Ctrl+Shift')).toMatch(/main key/i);
    expect(validateShortcut('Ctrl+')).toMatch(/main key/i);
  });

  it('rejects empty input', () => {
    expect(validateShortcut('')).toBeTruthy();
    expect(validateShortcut('   ')).toBeTruthy();
    expect(validateShortcut(undefined)).toBeTruthy();
    expect(validateShortcut(null)).toBeTruthy();
  });

  it('rejects duplicate and multiple main keys', () => {
    expect(validateShortcut('Ctrl+Ctrl+C')).toMatch(/duplicate/i);
    expect(validateShortcut('Ctrl+C+V')).toMatch(/one main key/i);
  });

  it('parses modifiers and the main key to virtual-key codes', () => {
    const parsed = parseShortcut('Ctrl+Shift+S');
    expect(parsed.key).toBe(0x53);
    expect(parsed.modifiers).toEqual([0x11, 0x10]);
    expect(parsed.hasWin).toBe(false);
    expect(parsed.unknownTokens).toEqual([]);
  });

  it('flags the Windows key and records unknown tokens', () => {
    expect(parseShortcut('Win+D').hasWin).toBe(true);
    expect(parseShortcut('Ctrl+Nope').unknownTokens).toEqual(['nope']);
  });
});
