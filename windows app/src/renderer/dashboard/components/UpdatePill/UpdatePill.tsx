import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { UpdateStatus } from '../../../../shared/types';
import styles from './UpdatePill.module.css';

/**
 * Accent pill that appears in the profile header when a newer release is found.
 * Auto-shimmers every 5s (pure CSS). Clicking it restarts into the new version
 * once the installer has finished downloading in the background.
 */
export function UpdatePill(): React.ReactElement | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => window.electronAPI.onUpdateAvailable(setStatus), []);

  if (!status) return null;

  const ready = status.downloaded;
  return (
    <button
      type="button"
      className={styles.pill}
      onClick={() => ready && window.electronAPI.installUpdate()}
      disabled={!ready}
      title={ready ? `Restart to update to v${status.version}` : `Downloading v${status.version}…`}
    >
      <Sparkles size={14} />
      <span>{ready ? 'Update available' : 'Downloading update…'}</span>
      <span className={styles.shimmer} aria-hidden />
    </button>
  );
}
