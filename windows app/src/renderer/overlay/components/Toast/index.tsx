import React, { useEffect, useRef, useState } from 'react';
import styles from './Toast.module.css';

interface ToastProps {
  message: string | null;
  duration?: number;
}

/**
 * Minimal toast notification.
 * Appears when `message` is set, auto-dismisses after `duration` ms.
 */
export function Toast({ message, duration = 1800 }: ToastProps): React.ReactElement | null {
  const [visible, setVisible] = useState(false);
  const [displayMessage, setDisplayMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!message) return;

    // Show new message
    setDisplayMessage(message);
    setVisible(true);

    // Clear existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Auto-dismiss
    timerRef.current = setTimeout(() => {
      setVisible(false);
    }, duration);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [message, duration]);

  if (!displayMessage) return null;

  return (
    <div className={`${styles.toast} ${visible ? styles.toastVisible : ''}`}>
      {displayMessage}
    </div>
  );
}
