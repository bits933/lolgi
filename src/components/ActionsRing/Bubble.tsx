import { forwardRef } from 'react';
import type { ActionItem, BubblePosition } from '../../types/index';
import { BUBBLE_SIZE } from '../../types/index';
import styles from './Bubble.module.css';

interface BubbleProps {
  action: ActionItem;
  position: BubblePosition;
  isHovered: boolean;
  onSelect: (action: ActionItem) => void;
}

export const Bubble = forwardRef<HTMLDivElement, BubbleProps>(
  ({ action, position, isHovered, onSelect }, ref) => {
    const Icon = action.icon;
    return (
      <div
        ref={ref}
        className={`${styles.bubble} ${isHovered ? styles.hovered : ''}`}
        style={{ left: position.x - BUBBLE_SIZE / 2, top: position.y - BUBBLE_SIZE / 2 }}
        onClick={() => onSelect(action)}
        data-bubble="true"
      >
        <span className={`${styles.icon} ${isHovered ? styles.iconLifted : ''}`}>
          <Icon size={24} color="white" strokeWidth={1.5} />
        </span>
        <span className={styles.label}>{action.label}</span>
      </div>
    );
  }
);

Bubble.displayName = 'Bubble';
