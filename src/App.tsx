import React, { useState, useEffect, useCallback } from 'react';
import { ActionsRing } from './components/ActionsRing/index';
import { Toast } from './components/Toast/index';
import { useRingStore } from './store/ringStore';
import { setExecuteCallback } from './utils/actions';
import { useMousePosition } from './hooks/useMousePosition';
import { useTrigger } from './hooks/useTrigger';
import styles from './App.module.css';

function DebugPanel(): React.ReactElement {
  const hoveredIndex = useRingStore((s) => s.hoveredIndex);
  const mode = useRingStore((s) => s.mode);
  const setMode = useRingStore((s) => s.setMode);
  const isOpen = useRingStore((s) => s.isOpen);

  // Ref-based cursor display avoids re-renders on every mousemove
  const mouseRef = useMousePosition();
  const [displayPos, setDisplayPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const interval = setInterval(() => {
      if (mouseRef.current) {
        setDisplayPos({ x: mouseRef.current.x, y: mouseRef.current.y });
      }
    }, 100);
    return () => clearInterval(interval);
  }, [mouseRef]);

  return (
    <div className={styles.debugPanel}>
      <div className={styles.debugTitle}>Debug Panel</div>
      <div className={styles.debugRow}>
        <span className={styles.debugLabel}>Mouse</span>
        <span className={styles.debugValue}>{displayPos.x}, {displayPos.y}</span>
      </div>
      <div className={styles.debugRow}>
        <span className={styles.debugLabel}>Hovered</span>
        <span className={styles.debugValue}>{hoveredIndex !== null ? `Bubble ${hoveredIndex}` : 'none'}</span>
      </div>
      <div className={styles.debugRow}>
        <span className={styles.debugLabel}>Ring open</span>
        <span className={styles.debugValue}>{isOpen ? 'yes' : 'no'}</span>
      </div>
      <div className={styles.debugRow}>
        <span className={styles.debugLabel}>Mode</span>
        <span className={styles.debugValue}>{mode}</span>
      </div>
      <div className={styles.debugRow}>
        <button className={styles.modeButton} onClick={() => setMode(mode === 'A' ? 'B' : 'A')}>
          Switch to Mode {mode === 'A' ? 'B' : 'A'}
        </button>
      </div>
      <div className={styles.debugHint}>
        {mode === 'A' ? 'Ctrl+Shift+Space to open' : 'Hold Space to open'}
      </div>
    </div>
  );
}

export default function App(): React.ReactElement {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const mousePositionRef = useMousePosition();

  useEffect(() => {
    setExecuteCallback((label: string) => setToastMessage(`Executed: ${label}`));
  }, []);

  const handleToastDismiss = useCallback(() => setToastMessage(null), []);

  useTrigger(mousePositionRef);

  return (
    <>
      <DebugPanel />
      <ActionsRing />
      <Toast message={toastMessage} onDismiss={handleToastDismiss} />
    </>
  );
}
