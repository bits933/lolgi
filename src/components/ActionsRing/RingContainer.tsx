import { forwardRef, type ReactNode } from 'react';
import styles from './RingContainer.module.css';
import { RING_SIZE } from '../../types/index';

interface RingContainerProps {
  cursorX: number;
  cursorY: number;
  children: ReactNode;
}

export const RingContainer = forwardRef<HTMLDivElement, RingContainerProps>(
  ({ cursorX, cursorY, children }, ref) => (
    <div className={styles.overlay}>
      <div ref={ref} className={styles.ring} style={{ left: cursorX - RING_SIZE / 2, top: cursorY - RING_SIZE / 2 }}>
        {children}
      </div>
    </div>
  )
);

RingContainer.displayName = 'RingContainer';
