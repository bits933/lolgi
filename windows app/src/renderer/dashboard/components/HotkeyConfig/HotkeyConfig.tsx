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
          <div className={`${styles.input} ${isRecording ? styles.inputRecording : ''}`}>
            {isRecording
              ? pendingKeys
                ? pendingKeys + '...'
                : 'Press keys...'
              : currentHotkey}
          </div>
          <button
            className={styles.button}
            onClick={isRecording ? () => setIsRecording(false) : handleStartRecording}
          >
            {isRecording ? 'Cancel' : 'Record'}
          </button>
        </div>
        <div className={styles.hint}>
          Press Ctrl, Shift, Alt in combination with a letter or function key.
        </div>
      </div>
    </div>
  );
}
