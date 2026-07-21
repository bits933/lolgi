import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Keyboard, X } from 'lucide-react';
import {
  parseMacroSteps,
  parseSequenceSteps,
  serializeMacroSteps,
  serializeSequenceSteps,
  MACRO_STEP_KIND_LABELS,
  type MacroStep,
  type MacroStepKind,
} from '../../../../shared/macroSteps';
import { shortcutFromKeyEvent, validateShortcut } from '../../../../shared/shortcutParser';
import styles from './MacroStepEditor.module.css';

interface MacroStepEditorProps {
  actionType: 'macro' | 'keyboard-sequence';
  value: string;
  onChange: (value: string) => void;
}

const CELL_PLACEHOLDERS: Partial<Record<MacroStepKind, string>> = {
  keys: 'PL',
  text: 'search text',
  delay: '250',
  raw: 'url:https://... / app:... / command:...',
};

/**
 * Step-list editor for macro / keyboard-sequence payloads. Replaces free-typed
 * text for key presses with a dedicated capture control: click the box, press
 * the physical key, and it lands as a locked chip that can only be removed and
 * re-recorded — never edited character by character like the letters someone
 * actually wants typed (a command alias, a search query). See macroSteps.ts for
 * the parse/serialize grammar this mirrors from the runtime dispatchers.
 */
export function MacroStepEditor({ actionType, value, onChange }: MacroStepEditorProps): React.ReactElement {
  const isMacro = actionType === 'macro';
  const steps = isMacro ? parseMacroSteps(value) : parseSequenceSteps(value);
  const serialize = isMacro ? serializeMacroSteps : serializeSequenceSteps;

  const [captureError, setCaptureError] = useState(false);
  const focusIndexRef = useRef<number | null>(null);
  const cellRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    const index = focusIndexRef.current;
    if (index === null) return;
    focusIndexRef.current = null;
    cellRefs.current[index]?.focus();
  }, [steps.length]);

  const commit = (next: MacroStep[]): void => onChange(serialize(next));
  const updateStep = (index: number, nextValue: string): void =>
    commit(steps.map((step, i) => (i === index ? { ...step, value: nextValue } : step)));
  const removeStep = (index: number): void => commit(steps.filter((_, i) => i !== index));
  const moveStep = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  };
  const addStep = (step: MacroStep): void => {
    focusIndexRef.current = steps.length;
    commit([...steps, step]);
  };

  const handleCaptureKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const shortcut = shortcutFromKeyEvent(event);
    if (!shortcut) return; // bare modifier — keep waiting for the full combo
    if (validateShortcut(shortcut) !== null) {
      setCaptureError(true);
      window.setTimeout(() => setCaptureError(false), 1200);
      return;
    }
    addStep({ kind: 'key', value: shortcut });
  };

  return (
    <div className={styles.editor}>
      <div className={styles.stepRow}>
        {steps.length === 0 && (
          <div className={styles.empty}>
            {isMacro
              ? 'No steps yet. Press a key, or add typed text / a delay below.'
              : 'No steps yet. Press a key, or add a delay below.'}
          </div>
        )}
        {steps.map((step, index) => (
          <StepCell
            key={index}
            step={step}
            isFirst={index === 0}
            isLast={index === steps.length - 1}
            cellRef={(el) => { cellRefs.current[index] = el; }}
            onChangeValue={(next) => updateStep(index, next)}
            onRemove={() => removeStep(index)}
            onMoveLeft={() => moveStep(index, -1)}
            onMoveRight={() => moveStep(index, 1)}
          />
        ))}
      </div>

      <div className={styles.addRow}>
        <input
          className={`${styles.captureInput}${captureError ? ` ${styles.captureError}` : ''}`}
          readOnly
          value=""
          placeholder="Click, then press a key"
          aria-label="Press a key to add it as a step"
          onKeyDown={handleCaptureKeyDown}
        />
        {isMacro && (
          <button type="button" onClick={() => addStep({ kind: 'keys', value: '' })}>+ Type</button>
        )}
        {isMacro && (
          <button type="button" onClick={() => addStep({ kind: 'text', value: '' })}>+ Text</button>
        )}
        <button type="button" onClick={() => addStep({ kind: 'delay', value: '250' })}>+ Delay</button>
        {isMacro && (
          <button type="button" onClick={() => addStep({ kind: 'raw', value: '' })}>+ Custom</button>
        )}
      </div>
      {captureError && <div className={styles.captureHint}>That key isn&rsquo;t supported yet.</div>}
    </div>
  );
}

interface StepCellProps {
  step: MacroStep;
  isFirst: boolean;
  isLast: boolean;
  cellRef: (el: HTMLInputElement | null) => void;
  onChangeValue: (value: string) => void;
  onRemove: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
}

function StepCell({
  step,
  isFirst,
  isLast,
  cellRef,
  onChangeValue,
  onRemove,
  onMoveLeft,
  onMoveRight,
}: StepCellProps): React.ReactElement {
  const isKey = step.kind === 'key';
  return (
    <div className={`${styles.cell} ${isKey ? styles.cellKey : styles.cellText}`}>
      <button type="button" className={styles.moveButton} onClick={onMoveLeft} disabled={isFirst} aria-label="Move step earlier">
        <ArrowLeft size={11} />
      </button>
      {isKey ? (
        <span className={styles.keyChip} title="Real key press — remove and re-record to change">
          <Keyboard size={11} />
          {step.value}
        </span>
      ) : (
        <span className={`${styles.textCell} ${step.kind === 'delay' ? styles.delayCell : ''}`}>
          <span className={styles.kindLabel}>{MACRO_STEP_KIND_LABELS[step.kind]}</span>
          <input
            ref={cellRef}
            value={step.value}
            placeholder={CELL_PLACEHOLDERS[step.kind]}
            onChange={(event) => onChangeValue(event.target.value)}
          />
          {step.kind === 'delay' && <span className={styles.msSuffix}>ms</span>}
        </span>
      )}
      <button type="button" className={styles.moveButton} onClick={onMoveRight} disabled={isLast} aria-label="Move step later">
        <ArrowRight size={11} />
      </button>
      <button type="button" className={styles.removeButton} onClick={onRemove} aria-label="Remove step">
        <X size={11} />
      </button>
    </div>
  );
}
