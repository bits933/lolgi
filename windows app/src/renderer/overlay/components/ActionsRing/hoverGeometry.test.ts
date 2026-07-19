import { describe, expect, it } from 'vitest';
import {
  BUBBLE_RADIUS,
  getOverlayWindowSize,
  RING_SIZE,
  RING_SIZE_SCALE,
} from '../../../../shared/constants';
import { computeRingPositions, computeSubRingArcPositions } from '../../../../shared/ringGeometry';
import type { BubblePosition, RingSize } from '../../../../shared/types';
import {
  resolveMainRingHover,
  resolveSubRingHover,
  viewportToRingLocal,
  type RingViewportBounds,
} from './hoverGeometry';

const mainPositions = computeRingPositions(8, 200, 200, BUBBLE_RADIUS);

function boundsFor(size: RingSize): RingViewportBounds {
  const scale = RING_SIZE_SCALE[size];
  const stageSize = getOverlayWindowSize(size);
  const width = RING_SIZE * scale;
  return {
    left: (stageSize - width) / 2,
    top: (stageSize - width) / 2,
    width,
    height: width,
  };
}

function viewportPoint(local: { x: number; y: number }, bounds: RingViewportBounds) {
  return {
    x: bounds.left + (local.x / RING_SIZE) * bounds.width,
    y: bounds.top + (local.y / RING_SIZE) * bounds.height,
  };
}

describe('ring hover geometry', () => {
  it('maps the medium top bubble from its real viewport position to the top slot', () => {
    const bounds = boundsFor('medium');
    // In the label-safe 704px medium stage, this is viewport (352, 232),
    // not a point relative to the old 400px overlay origin.
    expect(resolveMainRingHover(viewportPoint(mainPositions[0], bounds), bounds, mainPositions)).toBe(0);
  });

  it.each(['small', 'medium', 'large'] as RingSize[])(
    'resolves every main bubble center at %s transformed bounds',
    (size) => {
      const bounds = boundsFor(size);
      mainPositions.forEach((position, index) => {
        expect(resolveMainRingHover(viewportPoint(position, bounds), bounds, mainPositions)).toBe(index);
      });
    },
  );

  it('returns null at the ring center and in label-safe padding', () => {
    const bounds = boundsFor('medium');
    expect(resolveMainRingHover(viewportPoint({ x: 200, y: 200 }, bounds), bounds, mainPositions)).toBeNull();
    expect(resolveMainRingHover({ x: bounds.left - 1, y: bounds.top + bounds.height / 2 }, bounds, mainPositions)).toBeNull();
  });

  it('keeps fractional transformed bounds and small-size rounding accurate', () => {
    const bounds = { left: 121.65, top: 121.4, width: 319.6, height: 320.2 };
    const topViewportPoint = viewportPoint(mainPositions[0], bounds);
    const local = viewportToRingLocal(topViewportPoint, bounds);
    expect(local?.x).toBeCloseTo(200, 10);
    expect(local?.y).toBeCloseTo(80, 10);
    expect(resolveMainRingHover(topViewportPoint, bounds, mainPositions)).toBe(0);
  });

  it('resolves sub-ring child centers through transformed viewport bounds', () => {
    const parent = { x: 88, y: 200 };
    const axis = 0;
    const children: BubblePosition[] = computeSubRingArcPositions(3, parent.x, parent.y, 200, 200, 124, 42, 240);
    const bounds = { left: 182.25, top: 182.75, width: 480.5, height: 479.75 };
    const halfSpan = (42 * Math.PI) / 180 + (21 * Math.PI) / 180 + (8 * Math.PI) / 180;

    children.forEach((child, index) => {
      expect(resolveSubRingHover(
        viewportPoint(child, bounds), bounds, children, parent, axis, halfSpan,
      )).toBe(index);
    });
  });
});
