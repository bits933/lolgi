import { HOVER_DEADZONE_RADIUS, RING_HALF, RING_SIZE } from '../../../../shared/constants';
import type { BubblePosition } from '../../../../shared/types';

export interface ViewportPoint {
  x: number;
  y: number;
}

/** The subset of DOMRect needed by the pure hover geometry. */
export interface RingViewportBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Converts a viewport pointer coordinate into the ring's unscaled 400px
 * coordinate system. `getBoundingClientRect()` already includes the active
 * CSS transform, so this works for every ring size and fractional bounds.
 */
export function viewportToRingLocal(
  point: ViewportPoint,
  bounds: RingViewportBounds,
): ViewportPoint | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null;

  return {
    x: ((point.x - bounds.left) / bounds.width) * RING_SIZE,
    y: ((point.y - bounds.top) / bounds.height) * RING_SIZE,
  };
}

export function isInsideRingInteractionBounds(point: ViewportPoint): boolean {
  return point.x >= 0 && point.x <= RING_SIZE && point.y >= 0 && point.y <= RING_SIZE;
}

function angleDelta(a: number, b: number): number {
  let diff = a - b;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return diff;
}

function nearestAngleIndex(cursorAngle: number, positions: BubblePosition[]): number | null {
  if (positions.length === 0) return null;

  let closestIndex = 0;
  let smallestAngleDiff = Infinity;
  positions.forEach((position, index) => {
    const difference = Math.abs(angleDelta(cursorAngle, position.angle));
    if (difference < smallestAngleDiff) {
      smallestAngleDiff = difference;
      closestIndex = index;
    }
  });
  return closestIndex;
}

function viewportToInteractiveLocal(
  point: ViewportPoint,
  bounds: RingViewportBounds,
): ViewportPoint | null {
  const local = viewportToRingLocal(point, bounds);
  return local && isInsideRingInteractionBounds(local) ? local : null;
}

/** Resolves main-ring hover while excluding transparent label-safe padding. */
export function resolveMainRingHover(
  point: ViewportPoint,
  bounds: RingViewportBounds,
  positions: BubblePosition[],
): number | null {
  const local = viewportToInteractiveLocal(point, bounds);
  if (!local) return null;

  const dx = local.x - RING_HALF;
  const dy = local.y - RING_HALF;
  if (Math.hypot(dx, dy) < HOVER_DEADZONE_RADIUS) return null;

  return nearestAngleIndex(Math.atan2(dy, dx), positions);
}

/** Resolves sub-ring hover with its existing parent dead-zone and arc span. */
export function resolveSubRingHover(
  point: ViewportPoint,
  bounds: RingViewportBounds,
  positions: BubblePosition[],
  parentPosition: ViewportPoint,
  axis: number,
  halfSpan: number,
): number | null {
  const local = viewportToInteractiveLocal(point, bounds);
  if (!local) return null;

  const dx = local.x - parentPosition.x;
  const dy = local.y - parentPosition.y;
  if (Math.hypot(dx, dy) < HOVER_DEADZONE_RADIUS) return null;

  const cursorAngle = Math.atan2(dy, dx);
  if (Math.abs(angleDelta(cursorAngle, axis)) > halfSpan) return null;

  return nearestAngleIndex(cursorAngle, positions);
}
