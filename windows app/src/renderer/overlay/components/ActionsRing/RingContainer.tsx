import React, { forwardRef } from 'react';
import { getActionBubbleSize, RING_SIZE_SCALE } from '../../../../shared/constants';
import type { BubbleSurfaceTokens, RingSize } from '../../../../shared/types';
import styles from './RingContainer.module.css';

interface RingContainerProps {
  children: React.ReactNode;
  ringSize: RingSize;
  accentColor: string;
  accentFillColor: string;
  accentForegroundColor: string;
  bubbleSurface: BubbleSurfaceTokens;
}

/**
 * In the Electron overlay the window IS the ring.
 * The overlay window is positioned by the main process so its center
 * aligns with the cursor — no viewport-relative positioning needed here.
 */
export const RingContainer = forwardRef<HTMLDivElement, RingContainerProps>(
  ({ children, ringSize, accentColor, accentFillColor, accentForegroundColor, bubbleSurface }, ref) => {
    const actionBubbleSize = getActionBubbleSize(ringSize);

    return (
      <div
        ref={ref}
        className={styles.ring}
        style={{
          transform: `translate(-50%, -50%) scale(${RING_SIZE_SCALE[ringSize]}) translateZ(0)`,
          '--action-bubble-size': `${actionBubbleSize}px`,
          '--action-bubble-radius': `${actionBubbleSize / 2}px`,
          '--ring-accent': accentColor,
          '--ring-accent-fill': accentFillColor,
          '--ring-on-accent': accentForegroundColor,
          // Bubble surface tokens — override the static defaults so the user's
          // chosen bubble color drives fill, hover, border, and icon contrast.
          '--bubble-fill': bubbleSurface.fill,
          '--bubble-stroke': bubbleSurface.stroke,
          '--bubble-icon': bubbleSurface.onSurface,
          '--bubble-adjustment-fill': bubbleSurface.adjustmentFill,
          '--ring-surface': bubbleSurface.fill,
          '--ring-surface-hover': bubbleSurface.surfaceHover,
          '--ring-on-surface': bubbleSurface.onSurface,
          '--ring-border-default': bubbleSurface.stroke,
          '--ring-border-hover': bubbleSurface.borderHover,
        } as React.CSSProperties}
      >
        {children}
      </div>
    );
  }
);

RingContainer.displayName = 'RingContainer';
