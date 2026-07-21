/**
 * Editable-step model for macro and keyboard-sequence payloads.
 *
 * Mirrors the runtime grammar exactly, so the step-list editor UI (MacroStepEditor)
 * can never produce a string the runtime dispatchers disagree with:
 *   - executeMacro            (main/actions/index.ts)    <-> parseMacroSteps / serializeMacroSteps
 *   - executeKeyboardSequence (main/actions/keyboard.ts) <-> parseSequenceSteps / serializeSequenceSteps
 * If either runtime dispatcher's grammar changes, update its matching pair here too.
 *
 * Pure module — no Node/Electron/DOM dependencies — safe to import anywhere.
 */

import { validateShortcut } from './shortcutParser';

export type MacroStepKind =
  | 'key' // a real key press: a chord or named key (Enter, Ctrl+A, F1...)
  | 'keys' // literal characters typed as real keystrokes (macro only)
  | 'text' // literal text typed via Unicode injection (macro only)
  | 'delay' // pause, in milliseconds
  | 'url' | 'app' | 'file' | 'folder' | 'command' // macro only, raw passthrough value
  | 'raw'; // anything that didn't parse cleanly — preserved verbatim, still editable

export interface MacroStep {
  kind: MacroStepKind;
  /** Meaning depends on kind: the shortcut string for 'key'; the digits for
   *  'delay'; the text after the prefix for every prefixed kind; the entire,
   *  unrecognized entry verbatim for 'raw'. */
  value: string;
}

/** Human-readable labels for the non-key step kinds, shown on their editor cells. */
export const MACRO_STEP_KIND_LABELS: Record<MacroStepKind, string> = {
  key: 'Key',
  keys: 'Types',
  text: 'Text',
  delay: 'Delay',
  url: 'URL',
  app: 'App',
  file: 'File',
  folder: 'Folder',
  command: 'Command',
  raw: 'Custom',
};

const MACRO_PREFIXES: ReadonlyArray<{ prefix: string; kind: MacroStepKind }> = [
  { prefix: 'delay:', kind: 'delay' },
  { prefix: 'url:', kind: 'url' },
  { prefix: 'app:', kind: 'app' },
  { prefix: 'file:', kind: 'file' },
  { prefix: 'folder:', kind: 'folder' },
  { prefix: 'command:', kind: 'command' },
  { prefix: 'keys:', kind: 'keys' },
  { prefix: 'text:', kind: 'text' },
];

const MACRO_KIND_PREFIX: Partial<Record<MacroStepKind, string>> = Object.fromEntries(
  MACRO_PREFIXES.map(({ prefix, kind }) => [kind, prefix])
);

/** A bare entry is a real key press when it is a valid, known chord. Anything
 *  else is preserved as 'raw' so a typo or unrecognized value stays fixable as
 *  text instead of being stuck as a chip nothing can edit. */
function bareStep(entry: string): MacroStep {
  return { kind: validateShortcut(entry) === null ? 'key' : 'raw', value: entry };
}

/** Parses an actionType:'macro' payload — see executeMacro for the runtime twin. */
export function parseMacroSteps(payload: string): MacroStep[] {
  return payload
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = MACRO_PREFIXES.find(({ prefix }) => entry.startsWith(prefix));
      return match ? { kind: match.kind, value: entry.slice(match.prefix.length) } : bareStep(entry);
    });
}

/** Serializes steps back into an actionType:'macro' payload. Inverse of parseMacroSteps.
 *  Deliberately does not drop empty-value steps — a just-added, not-yet-filled
 *  cell must round-trip back into view rather than vanish before the user can
 *  type into it. The runtime's own entry parsing already tolerates blank entries. */
export function serializeMacroSteps(steps: MacroStep[]): string {
  return steps.map(({ kind, value }) => `${MACRO_KIND_PREFIX[kind] ?? ''}${value}`).join('; ');
}

/** Parses an actionType:'keyboard-sequence' payload — see executeKeyboardSequence
 *  for the runtime twin. Only key presses and delays exist at this grammar level. */
export function parseSequenceSteps(payload: string): MacroStep[] {
  return payload
    .split(/[;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const delay = entry.match(/^(?:delay:)?(\d+)ms$/i);
      return delay ? { kind: 'delay' as const, value: delay[1] } : bareStep(entry);
    });
}

/** Serializes steps back into an actionType:'keyboard-sequence' payload. Inverse of parseSequenceSteps. */
export function serializeSequenceSteps(steps: MacroStep[]): string {
  return steps.map(({ kind, value }) => (kind === 'delay' ? `${value}ms` : value)).join('; ');
}
