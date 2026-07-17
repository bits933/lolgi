import { useMemo, useEffect, useState } from 'react';
import { BUBBLE_RADIUS, RING_SIZE, type BubblePosition } from '../../types/index';

function computePositions(): BubblePosition[] {
  const center = RING_SIZE / 2;
  return Array.from({ length: 8 }, (_, i) => {
    const angle = -Math.PI / 2 + i * (Math.PI / 4);
    return { x: center + Math.cos(angle) * BUBBLE_RADIUS, y: center + Math.sin(angle) * BUBBLE_RADIUS, angle };
  });
}

// Recomputes on resize so clamping stays accurate if window changes
export function useRingGeometry(): BubblePosition[] {
  const [windowSize, setWindowSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    function handleResize(): void { setWindowSize({ w: window.innerWidth, h: window.innerHeight }); }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => computePositions(), [windowSize]);
}

export function getBubbleCentersAbsolute(
  ringLeft: number,
  ringTop: number,
  positions: BubblePosition[]
): Array<{ x: number; y: number }> {
  return positions.map((p) => ({ x: ringLeft + p.x, y: ringTop + p.y }));
}
