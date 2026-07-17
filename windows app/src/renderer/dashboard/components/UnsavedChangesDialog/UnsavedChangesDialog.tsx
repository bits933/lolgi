import React, { useEffect, useRef } from 'react';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import styles from './UnsavedChangesDialog.module.css';

interface UnsavedChangesDialogProps {
  saving: boolean;
  error?: string | null;
  onSave: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
}

export function UnsavedChangesDialog({
  saving,
  error,
  onSave,
  onDiscard,
  onKeepEditing,
}: UnsavedChangesDialogProps): React.ReactElement {
  const dialogRef = useRef<HTMLElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    keepEditingRef.current?.focus();
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onKeepEditing();
      return;
    }
    if (event.key !== 'Tab') return;
    const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    if (buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className={styles.overlay} role="presentation">
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-title"
        aria-describedby={error ? 'unsaved-description unsaved-error' : 'unsaved-description'}
        aria-busy={saving}
        onKeyDown={handleKeyDown}
      >
        <span className={styles.icon}><AlertTriangle size={22} /></span>
        <div className={styles.copy}>
          <h2 id="unsaved-title">Save changes to this profile?</h2>
          <p id="unsaved-description">Your ring edits are still a local draft. Leaving now without saving will restore the last saved layout.</p>
        </div>
        {error && <div id="unsaved-error" className={styles.error}><AlertCircle size={15} /><span>{error}</span></div>}
        <div className={styles.actions}>
          <button ref={keepEditingRef} type="button" className={styles.keep} onClick={onKeepEditing}>Keep editing</button>
          <button type="button" className={styles.discard} onClick={onDiscard} disabled={saving}>Discard</button>
          <button type="button" className={styles.save} onClick={onSave} disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>
        </div>
      </section>
    </div>
  );
}
