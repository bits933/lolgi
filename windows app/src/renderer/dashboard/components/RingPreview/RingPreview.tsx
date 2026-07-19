import React, { useMemo, useState, useCallback } from 'react';
import * as LucideIcons from 'lucide-react';
import type { BubbleConfig } from '../../../../shared/types';
import { RING_SIZE, BUBBLE_RADIUS, MAX_BUBBLE_COUNT } from '../../../../shared/constants';
import styles from './RingPreview.module.css';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyIconComponent = React.ComponentType<any>;

function resolveIcon(name: string): AnyIconComponent {
  const icons = LucideIcons as unknown as Record<string, AnyIconComponent>;
  return icons[name] ?? (LucideIcons.Circle as AnyIconComponent);
}

interface RingPreviewProps {
  bubbles: BubbleConfig[];
  selectedId?: string | null;
  onSelectBubble?: (id: string) => void;
}

interface PreviewPosition {
  x: number;
  y: number;
}

function computePositions(count: number): PreviewPosition[] {
  const center = RING_SIZE / 2;
  const positions: PreviewPosition[] = [];
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + i * ((2 * Math.PI) / Math.max(count, 1));
    positions.push({
      x: center + Math.cos(angle) * BUBBLE_RADIUS,
      y: center + Math.sin(angle) * BUBBLE_RADIUS,
    });
  }
  return positions;
}

export function RingPreview({ bubbles, selectedId, onSelectBubble }: RingPreviewProps): React.ReactElement {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const count = Math.min(bubbles.length, MAX_BUBBLE_COUNT);
  const positions = useMemo(() => computePositions(count), [count]);

  const handleClick = useCallback(
    (id: string) => {
      onSelectBubble?.(id);
    },
    [onSelectBubble]
  );

  return (
    <div className={styles.ringPreview}>
      <div className={styles.scaleWrapper}>
      <div className={styles.container}>
        {/* Center dot */}
        <div className={styles.center} />

        {bubbles.slice(0, MAX_BUBBLE_COUNT).map((bubble, i) => {
          const pos = positions[i];
          if (!pos) return null;

          const Icon = resolveIcon(bubble.iconName);
          const isSelected = selectedId === bubble.id;
          const isHovered = hoveredId === bubble.id;

          const classList = [styles.bubble];
          if (isSelected) classList.push(styles.bubbleSelected);
          if (isHovered) classList.push(styles.bubbleHovered);
          if (bubble.type === 'fill') classList.push(styles.bubbleFill);

          return (
            <div
              key={bubble.id}
              className={classList.join(' ')}
              style={{
                transform: `translate(calc(-50% + ${pos.x - RING_SIZE / 2}px), calc(-50% + ${pos.y - RING_SIZE / 2}px))${isHovered ? ' scale(1.15)' : ''}`,
              }}
              onClick={() => handleClick(bubble.id)}
              onMouseEnter={() => setHoveredId(bubble.id)}
              onMouseLeave={() => setHoveredId(null)}
              title={`${bubble.label} — ${bubble.actionType}`}
            >
              {bubble.iconDataUrl ? (
                <img
                  src={bubble.iconDataUrl}
                  alt=""
                  draggable={false}
                  width={22}
                  height={22}
                  style={{ objectFit: 'contain', borderRadius: 5, display: 'block' }}
                />
              ) : (
                <Icon size={22} color={isSelected || isHovered ? 'var(--accent)' : 'var(--bubble-icon)'} strokeWidth={2} />
              )}

              {/* Label — shows on hover */}
              <span className={`${styles.bubbleLabel} ${isHovered || isSelected ? styles.bubbleLabelVisible : ''}`}>
                {bubble.label}
              </span>
            </div>
          );
        })}
      </div>
      </div>
      <div className={styles.previewTitle}>Ring Preview</div>
    </div>
  );
}
