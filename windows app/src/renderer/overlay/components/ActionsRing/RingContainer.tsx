import React, { forwardRef } from 'react';
import { getActionBubbleSize, LABEL_PILL_SIZE, RING_SIZE_SCALE } from '../../../../shared/constants';
import type { BubbleSurfaceTokens, LabelSize, RingSize } from '../../../../shared/types';
import styles from './RingContainer.module.css';

interface RingContainerProps {
  children: React.ReactNode;
  ringSize: RingSize;
  labelSize: LabelSize;
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
  ({ children, ringSize, labelSize, accentColor, accentFillColor, accentForegroundColor, bubbleSurface }, ref) => {
    const actionBubbleSize = getActionBubbleSize(ringSize);
    const labelPillSize = LABEL_PILL_SIZE[labelSize];

    return (
      <div
        ref={ref}
        className={styles.ring}
        style={{
          transform: `translate(-50%, -50%) scale(${RING_SIZE_SCALE[ringSize]}) translateZ(0)`,
          '--action-bubble-size': `${actionBubbleSize}px`,
          '--action-bubble-radius': `${actionBubbleSize / 2}px`,
          '--label-font-size': `${labelPillSize.fontSize}px`,
          '--label-line-height': String(labelPillSize.lineHeight),
          '--label-padding-y': `${labelPillSize.paddingY}px`,
          '--label-padding-x': `${labelPillSize.paddingX}px`,
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
