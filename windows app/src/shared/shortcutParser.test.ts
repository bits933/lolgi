import { describe, expect, it } from 'vitest';
import { parseShortcut, planKeystrokes, shortcutFromKeyEvent, validateShortcut } from './shortcutParser';

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

describe('keys: keystroke planner', () => {
  it('explodes a command alias into one typed keystroke per character', () => {
    expect(planKeystrokes('PL')).toEqual(['P', 'L']);
    expect(planKeystrokes('LAYISO')).toEqual(['L', 'A', 'Y', 'I', 'S', 'O']);
    expect(planKeystrokes('C')).toEqual(['C']);
  });

  it('keeps named keys and modifier chords whole so they are pressed, not typed', () => {
    expect(planKeystrokes('Enter')).toEqual(['Enter']);
    expect(planKeystrokes('Tab')).toEqual(['Tab']);
    expect(planKeystrokes('Ctrl+A')).toEqual(['Ctrl+A']);
    expect(planKeystrokes('Shift+Enter')).toEqual(['Shift+Enter']);
    expect(planKeystrokes('F1')).toEqual(['F1']);
  });

  it('mixes typed command text with real key presses in one directive', () => {
    expect(planKeystrokes('PL Enter')).toEqual(['P', 'L', 'Enter']);
    expect(planKeystrokes('LAYISO Enter')).toEqual(['L', 'A', 'Y', 'I', 'S', 'O', 'Enter']);
    expect(planKeystrokes('REC Enter Ctrl+A')).toEqual(['R', 'E', 'C', 'Enter', 'Ctrl+A']);
  });

  it('ignores surrounding and repeated whitespace', () => {
    expect(planKeystrokes('  PL   Enter  ')).toEqual(['P', 'L', 'Enter']);
    expect(planKeystrokes('')).toEqual([]);
    expect(planKeystrokes('   ')).toEqual([]);
  });
});

describe('shortcutFromKeyEvent', () => {
  const press = (overrides: Partial<{ key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }>) => ({
    key: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...overrides,
  });

  it('waits for a full combo — a bare modifier press resolves to null', () => {
    expect(shortcutFromKeyEvent(press({ key: 'Control', ctrlKey: true }))).toBeNull();
    expect(shortcutFromKeyEvent(press({ key: 'Shift', shiftKey: true }))).toBeNull();
    expect(shortcutFromKeyEvent(press({ key: 'Tab' }))).toBeNull();
  });

  it('builds a canonical combo from held modifiers plus the main key', () => {
    expect(shortcutFromKeyEvent(press({ key: 's', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+S');
    expect(shortcutFromKeyEvent(press({ key: 'Enter' }))).toBe('Enter');
    expect(shortcutFromKeyEvent(press({ key: 'Escape' }))).toBe('Escape');
    expect(shortcutFromKeyEvent(press({ key: 'F1' }))).toBe('F1');
  });

  it('produces a shortcut that parseShortcut/validateShortcut accept', () => {
    const combo = shortcutFromKeyEvent(press({ key: 'a', ctrlKey: true }));
    expect(combo).toBe('Ctrl+A');
    expect(validateShortcut(combo)).toBeNull();
  });
});
