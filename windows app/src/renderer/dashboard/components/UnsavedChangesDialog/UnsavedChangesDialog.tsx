import React, { useEffect, useRef } from 'react';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import styles from './UnsavedChangesDialog.module.css';

interface UnsavedChangesDialogProps {
  profileName: string;
  saving: boolean;
  error?: string | null;
  onSave: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
}

export function UnsavedChangesDialog({
  profileName,
  saving,
  error,
  onSave,
  onDiscard,
  onKeepEditing,
}: UnsavedChangesDialogProps): React.ReactElement {
  const dialogRef = useRef<HTMLElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    saveRef.current?.focus();
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
          <h2 id="unsaved-title">Unsaved Changes</h2>
          <p id="unsaved-description">You have unsaved changes to &lsquo;{profileName}&rsquo;. Save before closing?</p>
        </div>
        {error && <div id="unsaved-error" className={styles.error}><AlertCircle size={15} /><span>{error}</span></div>}
        <div className={styles.actions}>
          <button type="button" className={styles.keep} onClick={onKeepEditing}>Cancel</button>
          <button type="button" className={styles.discard} onClick={onDiscard} disabled={saving}>Discard Changes</button>
          <button ref={saveRef} type="button" className={styles.save} onClick={onSave} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
        </div>
      </section>
    </div>
  );
}
