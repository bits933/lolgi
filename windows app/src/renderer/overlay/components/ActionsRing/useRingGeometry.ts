import { useMemo } from 'react';
import {
  BUBBLE_RADIUS,
  BUBBLE_SIZE,
  RING_SIZE,
} from '../../../../shared/constants';
import type { BubblePosition } from '../../../../shared/types';
import { computeFolderLayout, computeRingPositions, type FolderLayout } from '../../../../shared/ringGeometry';

export function useRingGeometry(count: number): BubblePosition[] {
  return useMemo(
    () => computeRingPositions(count, RING_SIZE / 2, RING_SIZE / 2, BUBBLE_RADIUS),
    [count]
  );
}

/**
 * Canonical F4.1 folder layout shared with Dashboard V2: the parent settles
 * left of centre and children fan out to its right.
 */
export function useSubRingGeometry(
  count: number,
  bubbleDiameter = BUBBLE_SIZE,
): FolderLayout {
  return useMemo(
    () => computeFolderLayout({
      width: RING_SIZE,
      height: RING_SIZE,
      bubbleDiameter,
      childCount: count,
    }),
    [bubbleDiameter, count]
  );
}
