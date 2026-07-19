import React, { useState, useCallback, useEffect } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';
import styles from './HotkeyConfig.module.css';

/**
 * Hotkey recording UI.
 * Click "Record" then press the desired key combination to set a new hotkey.
 */
export function HotkeyConfig({ embedded = false }: { embedded?: boolean }): React.ReactElement {
  const config = useDashboardStore((s) => s.config);
  const setHotkey = useDashboardStore((s) => s.setHotkey);

  const [isRecording, setIsRecording] = useState(false);
  const [pendingKeys, setPendingKeys] = useState<string>('');

  const currentHotkey = config?.hotkey ?? 'Ctrl+Shift+Space';

  const handleStartRecording = useCallback(() => {
    setIsRecording(true);
    setPendingKeys('');
  }, []);

  useEffect(() => {
    if (!isRecording) return;

    function handleKeyDown(e: KeyboardEvent): void {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setPendingKeys('');
        setIsRecording(false);
        return;
      }

      const parts: string[] = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Meta');

      const key = e.key;
      // Skip modifier-only presses
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
        setPendingKeys(parts.join('+'));
        return;
      }

      parts.push(key.length === 1 ? key.toUpperCase() : key);
      const combo = parts.join('+');
      setPendingKeys(combo);
      setIsRecording(false);
      setHotkey(combo);
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isRecording, setHotkey]);

  return (
    <div className={`${styles.hotkeyConfig}${embedded ? ` ${styles.hotkeyConfigEmbedded}` : ''}`}>
      <div className={styles.section}>
        <div className={styles.label}>Global Hotkey</div>
        <div className={styles.recorder}>
          <div
            className={`${styles.input} ${isRecording ? styles.inputRecording : ''}`}
            aria-live="polite"
            aria-label={isRecording ? 'Recording shortcut' : `Current shortcut: ${currentHotkey}`}
          >
            {isRecording ? (
              <span className={styles.recordingLabel}>{pendingKeys || 'Press shortcut…'}</span>
            ) : (
              currentHotkey.split('+').map((key) => <kbd className={styles.keyChip} key={key}>{key}</kbd>)
            )}
          </div>
          <button
            type="button"
            className={styles.button}
            onClick={isRecording ? () => setIsRecording(false) : handleStartRecording}
          >
            {isRecording ? 'Cancel' : 'Record'}
          </button>
        </div>
        <div className={styles.hint}>
          Press Ctrl, Shift, or Alt with a key. Press Esc to cancel.
        </div>
      </div>
    </div>
  );
}
