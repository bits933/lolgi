import { useRef, useEffect, useCallback } from 'react';
import { useRingStore } from '../../store/ringStore';
import { ACTIONS } from '../../utils/actions';
import { useRingGeometry, getBubbleCentersAbsolute } from './useRingGeometry';
import {
  ringEntranceAnimation, ringExitAnimation, runAnimation,
  runBubbleEntranceAll, runBubbleExitAll, bubbleSelectAnimation,
} from './animations';
import { RingContainer } from './RingContainer';
import { Bubble } from './Bubble';
import { RING_SIZE, RING_CLAMP_MARGIN } from '../../types/index';
import type { ActionItem } from '../../types/index';

function clampPosition(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(RING_CLAMP_MARGIN, Math.min(x, window.innerWidth - RING_CLAMP_MARGIN)),
    y: Math.max(RING_CLAMP_MARGIN, Math.min(y, window.innerHeight - RING_CLAMP_MARGIN)),
  };
}

export function ActionsRing(): React.ReactElement | null {
  const isOpen = useRingStore((s) => s.isOpen);
  const cursorPosition = useRingStore((s) => s.cursorPosition);
  const hoveredIndex = useRingStore((s) => s.hoveredIndex);
  const closeRing = useRingStore((s) => s.closeRing);
  const setHoveredIndex = useRingStore((s) => s.setHoveredIndex);

  const positions = useRingGeometry();
  const ringRef = useRef<HTMLDivElement>(null);
  const bubbleRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isClosingRef = useRef(false);

  const clamped = clampPosition(cursorPosition.x, cursorPosition.y);
  const ringLeft = clamped.x - RING_SIZE / 2;
  const ringTop = clamped.y - RING_SIZE / 2;

  useEffect(() => {
    if (!isOpen) return;
    isClosingRef.current = false;
    const ringEl = ringRef.current;
    if (!ringEl) return;
    const bubbleEls = bubbleRefs.current.filter(Boolean) as HTMLDivElement[];
    runAnimation(ringEl, ringEntranceAnimation).catch(console.error);
    runBubbleEntranceAll(bubbleEls).catch(console.error);
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isOpen) return;
    const centers = getBubbleCentersAbsolute(ringLeft, ringTop, positions);
    function handleMouseMove(e: MouseEvent): void {
      let closestIndex: number | null = null;
      let closestDist = Infinity;
      for (let i = 0; i < centers.length; i++) {
        const dx = e.clientX - centers[i].x;
        const dy = e.clientY - centers[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < closestDist) { closestDist = dist; closestIndex = i; }
      }
      const newIndex = closestDist <= 40 ? closestIndex : null;
      if (newIndex !== useRingStore.getState().hoveredIndex) setHoveredIndex(newIndex);
    }
    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, [isOpen, ringLeft, ringTop, positions, setHoveredIndex]);

  async function runExitSequence(): Promise<void> {
    const ringEl = ringRef.current;
    const bubbleEls = bubbleRefs.current.filter(Boolean) as HTMLDivElement[];
    await Promise.all([
      ringEl ? runAnimation(ringEl, ringExitAnimation) : Promise.resolve(),
      runBubbleExitAll(bubbleEls, positions.map((p) => p.angle)),
    ]);
  }

  const handleSelect = useCallback(async (action: ActionItem) => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    const selectedBubbleEl = bubbleRefs.current[action.angleIndex];
    if (selectedBubbleEl) await runAnimation(selectedBubbleEl, bubbleSelectAnimation);
    action.execute();
    await runExitSequence();
    closeRing();
  }, [closeRing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  return (
    <RingContainer ref={ringRef} cursorX={clamped.x} cursorY={clamped.y}>
      {ACTIONS.map((action, i) => (
        <Bubble
          key={action.id}
          ref={(el) => { bubbleRefs.current[i] = el; }}
          action={action}
          position={positions[i]}
          isHovered={hoveredIndex === i}
          onSelect={handleSelect}
        />
      ))}
    </RingContainer>
  );
}
