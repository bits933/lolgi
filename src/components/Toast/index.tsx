import { useEffect } from 'react';
import styles from './Toast.module.css';

interface ToastProps {
  message: string | null;
  onDismiss: () => void;
}

export function Toast({ message, onDismiss }: ToastProps): React.ReactElement | null {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, 2000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;
  return (
    <div className={styles.toast} role="status" aria-live="polite">
      {message}
    </div>
  );
}
