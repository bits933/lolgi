import React, { forwardRef } from 'react';
import { RING_SIZE_SCALE } from '../../../../shared/constants';
import type { RingSize } from '../../../../shared/types';
import styles from './RingContainer.module.css';

interface RingContainerProps {
  children: React.ReactNode;
  ringSize: RingSize;
  accentColor: string;
  accentFillColor: string;
  accentForegroundColor: string;
}

/**
 * In the Electron overlay the window IS the ring.
 * The overlay window is positioned by the main process so its center
 * aligns with the cursor — no viewport-relative positioning needed here.
 */
export const RingContainer = forwardRef<HTMLDivElement, RingContainerProps>(
  ({ children, ringSize, accentColor, accentFillColor, accentForegroundColor }, ref) => {
    return (
      <div
        ref={ref}
        className={styles.ring}
        style={{
          transform: `scale(${RING_SIZE_SCALE[ringSize]}) translateZ(0)`,
          '--ring-accent': accentColor,
          '--ring-accent-fill': accentFillColor,
          '--ring-on-accent': accentForegroundColor,
        } as React.CSSProperties}
      >
        {children}
      </div>
    );
  }
);

RingContainer.displayName = 'RingContainer';
