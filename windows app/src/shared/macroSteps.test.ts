import { describe, expect, it } from 'vitest';
import {
  parseMacroSteps,
  parseSequenceSteps,
  serializeMacroSteps,
  serializeSequenceSteps,
  type MacroStep,
} from './macroSteps';

describe('macro steps (actionType: macro)', () => {
  it('classifies every prefix kind and bare valid keys', () => {
    expect(parseMacroSteps('delay:250')).toEqual([{ kind: 'delay', value: '250' }]);
    expect(parseMacroSteps('url:https://example.com')).toEqual([{ kind: 'url', value: 'https://example.com' }]);
    expect(parseMacroSteps('app:notepad')).toEqual([{ kind: 'app', value: 'notepad' }]);
    expect(parseMacroSteps('file:C:\\a.txt')).toEqual([{ kind: 'file', value: 'C:\\a.txt' }]);
    expect(parseMacroSteps('folder:C:\\docs')).toEqual([{ kind: 'folder', value: 'C:\\docs' }]);
    expect(parseMacroSteps('command:ping 1.1.1.1')).toEqual([{ kind: 'command', value: 'ping 1.1.1.1' }]);
    expect(parseMacroSteps('keys:PL')).toEqual([{ kind: 'keys', value: 'PL' }]);
    expect(parseMacroSteps('text:hello')).toEqual([{ kind: 'text', value: 'hello' }]);
    expect(parseMacroSteps('Ctrl+S')).toEqual([{ kind: 'key', value: 'Ctrl+S' }]);
    expect(parseMacroSteps('Enter')).toEqual([{ kind: 'key', value: 'Enter' }]);
  });

  it('falls back to raw for a bare entry that is not a recognized key', () => {
    // Legacy/hand-typed data such as a stray command alias without its prefix,
    // or a mistyped prefix (case-sensitive, same as the runtime dispatcher).
    expect(parseMacroSteps('REC')).toEqual([{ kind: 'raw', value: 'REC' }]);
    expect(parseMacroSteps('Delay:100')).toEqual([{ kind: 'raw', value: 'Delay:100' }]);
  });

  it('round-trips the real AutoCAD polyline macro exactly', () => {
    const payload = 'keys:PL; Enter';
    const steps = parseMacroSteps(payload);
    expect(steps).toEqual([
      { kind: 'keys', value: 'PL' },
      { kind: 'key', value: 'Enter' },
    ]);
    expect(serializeMacroSteps(steps)).toBe(payload);
  });

  it('round-trips the real AutoCAD zoom-extents macro (two keys: steps)', () => {
    const payload = 'keys:Z; Enter; keys:E; Enter';
    const steps = parseMacroSteps(payload);
    expect(serializeMacroSteps(steps)).toBe(payload);
  });

  it('round-trips the real Figma tidy macro, preserving spaces inside text:', () => {
    const payload = 'Ctrl+K; delay:250; text:Tidy up; Enter';
    const steps = parseMacroSteps(payload);
    expect(steps).toEqual([
      { kind: 'key', value: 'Ctrl+K' },
      { kind: 'delay', value: '250' },
      { kind: 'text', value: 'Tidy up' },
      { kind: 'key', value: 'Enter' },
    ]);
    expect(serializeMacroSteps(steps)).toBe(payload);
  });

  it('keeps an empty-value step in the serialized output so an in-progress cell does not vanish', () => {
    const steps: MacroStep[] = [{ kind: 'key', value: 'Ctrl+S' }, { kind: 'delay', value: '' }];
    expect(serializeMacroSteps(steps)).toBe('Ctrl+S; delay:');
    expect(parseMacroSteps(serializeMacroSteps(steps))).toEqual(steps);
  });

  it('parses an empty payload as no steps', () => {
    expect(parseMacroSteps('')).toEqual([]);
    expect(parseMacroSteps('   ')).toEqual([]);
  });
});

describe('sequence steps (actionType: keyboard-sequence)', () => {
  it('round-trips the real AutoCAD cancel sequence', () => {
    const payload = 'Esc; Esc';
    const steps = parseSequenceSteps(payload);
    expect(steps).toEqual([
      { kind: 'key', value: 'Esc' },
      { kind: 'key', value: 'Esc' },
    ]);
    expect(serializeSequenceSteps(steps)).toBe(payload);
  });

  it('recognizes bare and delay:-prefixed millisecond delays', () => {
    expect(parseSequenceSteps('250ms')).toEqual([{ kind: 'delay', value: '250' }]);
    expect(parseSequenceSteps('delay:250ms')).toEqual([{ kind: 'delay', value: '250' }]);
  });

  it('splits on both semicolons and newlines', () => {
    const steps = parseSequenceSteps('Ctrl+C\nCtrl+V;250ms');
    expect(steps).toEqual([
      { kind: 'key', value: 'Ctrl+C' },
      { kind: 'key', value: 'Ctrl+V' },
      { kind: 'delay', value: '250' },
    ]);
  });

  it('serializes delay steps with the bare "Nms" form', () => {
    expect(serializeSequenceSteps([{ kind: 'delay', value: '250' }])).toBe('250ms');
  });

  it('falls back to raw for an unrecognized bare entry', () => {
    expect(parseSequenceSteps('NotAKey')).toEqual([{ kind: 'raw', value: 'NotAKey' }]);
  });
});
