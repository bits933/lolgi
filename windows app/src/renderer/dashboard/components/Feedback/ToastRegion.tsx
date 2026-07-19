import React, { useEffect } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import styles from './ToastRegion.module.css';

export interface DashboardToast {
  id: number;
  message: string;
  tone?: 'success' | 'neutral';
}

interface ToastRegionProps {
  toasts: DashboardToast[];
  onDismiss: (id: number) => void;
}

/** Dashboard-only mutation feedback. It deliberately caps at two messages. */
export function ToastRegion({ toasts, onDismiss }: ToastRegionProps): React.ReactElement {
  useEffect(() => {
    const timers = toasts.map((toast) => window.setTimeout(() => onDismiss(toast.id), 5_000));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [onDismiss, toasts]);

  return (
    <div className={styles.region} aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div className={styles.toast} key={toast.id} role="status">
          {toast.tone === 'success' && <CheckCircle2 size={16} className={styles.successIcon} aria-hidden="true" />}
          <span>{toast.message}</span>
          <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
