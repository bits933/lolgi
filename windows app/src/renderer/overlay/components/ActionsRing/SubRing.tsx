import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as LucideIcons from 'lucide-react';
import type { BubbleConfig, BubblePosition, RingSize } from '../../../../shared/types';
import {
  HOVER_DEADZONE_RADIUS,
  MAX_FOLDER_CHILDREN,
  RING_SIZE_SCALE,
  SUB_RING_ARC_BASE_STEP_DEG,
} from '../../../../shared/constants';
import { useSubRingGeometry } from './useRingGeometry';
import { Bubble } from './Bubble';
import ringStyles from './RingContainer.module.css';

interface SubRingProps {
  parent: BubbleConfig;
  parentPosition: BubblePosition;
  ringSize: RingSize;
  isVisible: boolean;
  isClosing: boolean;
  onBack: () => void;
  onSelect: (config: BubbleConfig) => void;
  onActionError: (message: string) => void;
}

type AnyIconComponent = React.ComponentType<Record<string, unknown>>;

function resolveIcon(name: string): AnyIconComponent {
  const icons = LucideIcons as unknown as Record<string, AnyIconComponent>;
  return icons[name] ?? (LucideIcons.Folder as unknown as AnyIconComponent);
}

function angleDelta(a: number, b: number): number {
  let diff = a - b;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return diff;
}

export function SubRing({
  parent,
  parentPosition,
  ringSize,
  isVisible,
  isClosing,
  onBack,
  onSelect,
  onActionError,
}: SubRingProps): React.ReactElement | null {
  const children = useMemo(
    () => [...(parent.children ?? [])]
      .sort((a, b) => a.angleIndex - b.angleIndex)
      .slice(0, MAX_FOLDER_CHILDREN),
    [parent.children]
  );
  const layout = useSubRingGeometry(children.length);
  const positions = layout.children;
  const nestedParentPosition = layout.parent;
  const axis = layout.axis;
  const axisDeg = (axis * 180) / Math.PI;

  const halfSpan = useMemo(() => {
    if (positions.length === 0) return 0;
    const spread = Math.max(...positions.map((position) => Math.abs(angleDelta(position.angle, axis))));
    const stepRad = (SUB_RING_ARC_BASE_STEP_DEG * Math.PI) / 180;
    return spread + stepRad / 2 + (8 * Math.PI) / 180;
  }, [axis, positions]);

  const bubbleRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [hoveredSubIndex, setHoveredSubIndex] = useState<number | null>(null);
  const [anchorVisible, setAnchorVisible] = useState(false);

  useEffect(() => {
    if (isVisible) {
      setHoveredSubIndex(0);
      let raf1 = 0;
      let raf2 = 0;
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setAnchorVisible(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    setAnchorVisible(false);
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible || isClosing) {
      setHoveredSubIndex(null);
      return;
    }

    const centerX = nestedParentPosition.x;
    const centerY = nestedParentPosition.y;
    const mouse = { x: 0, y: 0, pending: false };
    let rafId = 0;

    function processHover(): void {
      mouse.pending = false;
      const scale = RING_SIZE_SCALE[ringSize];
      const dx = mouse.x / scale - centerX;
      const dy = mouse.y / scale - centerY;
      if (Math.hypot(dx, dy) < HOVER_DEADZONE_RADIUS) {
        setHoveredSubIndex(null);
        return;
      }

      const cursorAngle = Math.atan2(dy, dx);
      if (Math.abs(angleDelta(cursorAngle, axis)) > halfSpan) {
        setHoveredSubIndex(null);
        return;
      }

      let closestIndex = 0;
      let smallestDifference = Infinity;
      positions.forEach((position, index) => {
        const difference = Math.abs(angleDelta(cursorAngle, position.angle));
        if (difference < smallestDifference) {
          smallestDifference = difference;
          closestIndex = index;
        }
      });
      setHoveredSubIndex(closestIndex);
    }

    function handleMouseMove(event: MouseEvent): void {
      mouse.x = event.clientX;
      mouse.y = event.clientY;
      if (mouse.pending) return;
      mouse.pending = true;
      rafId = requestAnimationFrame(processHover);
    }

    document.addEventListener('mousemove', handleMouseMove);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(rafId);
      setHoveredSubIndex(null);
    };
  }, [axis, halfSpan, isClosing, isVisible, nestedParentPosition.x, nestedParentPosition.y, positions, ringSize]);

  const handleSelect = useCallback((config: BubbleConfig) => {
    if (!isClosing) onSelect(config);
  }, [isClosing, onSelect]);

  useEffect(() => {
    if (hoveredSubIndex === null) return;
    bubbleRefs.current[hoveredSubIndex]?.focus({ preventScroll: true });
  }, [hoveredSubIndex]);

  useEffect(() => {
    if (!isVisible || isClosing || children.length === 0) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-subring-back="true"]')) return;
      const current = hoveredSubIndex ?? 0;
      if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
        setHoveredSubIndex((current + direction + children.length) % children.length);
      // Digits 1-9; effective range is capped by MAX_FOLDER_CHILDREN.
      } else if (/^[1-9]$/.test(event.key)) {
        const selectedIndex = Number(event.key) - 1;
        if (selectedIndex < children.length) {
          event.preventDefault();
          setHoveredSubIndex(selectedIndex);
        }
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        onBack();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        bubbleRefs.current[current]?.click();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [children, hoveredSubIndex, isClosing, isVisible, onBack]);

  if (children.length === 0) return null;
  const ParentIcon = resolveIcon(parent.iconName);

  return (
    <>
      <button
        type="button"
        className={`${ringStyles.subRingParentAnchor}${anchorVisible ? ` ${ringStyles.subRingParentAnchorVisible}` : ''}`}
        style={{
          left: nestedParentPosition.x,
          top: nestedParentPosition.y,
          '--parent-from-x': `${parentPosition.x - nestedParentPosition.x}px`,
          '--parent-from-y': `${parentPosition.y - nestedParentPosition.y}px`,
          '--axis-deg': `${axisDeg}deg`,
        } as React.CSSProperties}
        onClick={onBack}
        data-ring-control="true"
        data-subring-back="true"
        aria-label={`Back from ${parent.label || 'folder'}`}
      >
        <span className={ringStyles.subRingParentSurface}>
          {parent.iconDataUrl ? (
            <img src={parent.iconDataUrl} alt="" draggable={false} width={26} height={26} />
          ) : (
            <ParentIcon size={24} color="var(--ring-on-surface)" strokeWidth={2} />
          )}
        </span>
        <span className={ringStyles.connectorDot} />
      </button>

      {children.map((config, index) => (
        <Bubble
          key={config.id}
          ref={(element) => { bubbleRefs.current[index] = element; }}
          config={config}
          position={positions[index] ?? positions[0]}
          isHovered={hoveredSubIndex === index}
          onSelect={handleSelect}
          onActionError={onActionError}
          isVisible={isVisible && !isClosing}
          index={index}
          total={children.length}
          isClosing={isClosing}
          labelMode="persistent"
          labelSide="right"
        />
      ))}
    </>
  );
}
