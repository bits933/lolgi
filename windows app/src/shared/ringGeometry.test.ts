import { describe, expect, it } from 'vitest';
import {
  computeRingPositions,
  computeSubRingArcPositions,
  computeSubRingAxis,
  computeArcLabelSide,
  computeFolderLayout,
  computeGroupDotAngle,
} from './ringGeometry';

const RING_CENTER = 200;
const BUBBLE_RADIUS = 120;
const ARC_RADIUS = 124;
const BASE_STEP = 42;
const MAX_SPAN = 240;

// The eight main-ring slots, as (x, y) in the 400px ring space.
const MAIN_SLOTS = computeRingPositions(8, RING_CENTER, RING_CENTER, BUBBLE_RADIUS);
function mainSlot(index: number): { x: number; y: number } {
  return { x: MAIN_SLOTS[index].x, y: MAIN_SLOTS[index].y };
}

describe('computeGroupDotAngle', () => {
  it('faces the marker outward from top, right, bottom, and left slots', () => {
    const positions = computeRingPositions(4, RING_CENTER, RING_CENTER, BUBBLE_RADIUS);
    expect(computeGroupDotAngle(positions[0])).toBeCloseTo(-Math.PI / 2, 5);
    expect(computeGroupDotAngle(positions[1])).toBeCloseTo(0, 5);
    expect(computeGroupDotAngle(positions[2])).toBeCloseTo(Math.PI / 2, 5);
    expect(Math.abs(computeGroupDotAngle(positions[3]))).toBeCloseTo(Math.PI, 5);
  });
});

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('computeSubRingArcPositions', () => {
  it('returns nothing for a non-positive count', () => {
    expect(computeSubRingArcPositions(0, 80, 200, 200, 200, ARC_RADIUS, BASE_STEP, MAX_SPAN)).toEqual([]);
  });

  it('places a single child straight along the parent→center axis', () => {
    // Left slot → axis points right (0 rad).
    const [child] = computeSubRingArcPositions(1, 80, 200, 200, 200, ARC_RADIUS, BASE_STEP, MAX_SPAN);
    expect(child.angle).toBeCloseTo(0, 5);
    expect(child.x).toBeCloseTo(80 + ARC_RADIUS, 5);
    expect(child.y).toBeCloseTo(200, 5);
  });

  it('keeps every child at the arc radius from the parent (unclamped)', () => {
    const parent = { x: 80, y: 200 };
    const positions = computeSubRingArcPositions(
      4, parent.x, parent.y, 200, 200, ARC_RADIUS, BASE_STEP, MAX_SPAN
    );
    for (const p of positions) {
      expect(dist(p, parent)).toBeCloseTo(ARC_RADIUS, 4);
    }
  });

  it('fans children symmetrically around the axis at the base step until the span cap', () => {
    // 4 children → span 3*42 = 126 < 240, so base step is used.
    const positions = computeSubRingArcPositions(
      4, 80, 200, 200, 200, ARC_RADIUS, BASE_STEP, MAX_SPAN
    );
    const angles = positions.map((p) => (p.angle * 180) / Math.PI);
    expect(angles).toHaveLength(4);
    expect(angles[0]).toBeCloseTo(-63, 4);
    expect(angles[1]).toBeCloseTo(-21, 4);
    expect(angles[2]).toBeCloseTo(21, 4);
    expect(angles[3]).toBeCloseTo(63, 4);
  });

  it('compresses spacing so the arc never exceeds the max span', () => {
    // 9 children at base step would span 8*42 = 336 > 240, so it compresses to 240/8 = 30.
    const positions = computeSubRingArcPositions(
      9, 80, 200, 200, 200, ARC_RADIUS, BASE_STEP, MAX_SPAN
    );
    const angles = positions.map((p) => (p.angle * 180) / Math.PI);
    const totalSpan = angles[angles.length - 1] - angles[0];
    expect(totalSpan).toBeCloseTo(MAX_SPAN, 4);
    // Adjacent step is uniform at 30°.
    for (let i = 1; i < angles.length; i++) {
      expect(angles[i] - angles[i - 1]).toBeCloseTo(30, 4);
    }
  });

  it('never overlaps 9 sub-bubbles (chord between neighbours exceeds bubble diameter)', () => {
    const positions = computeSubRingArcPositions(
      9, 80, 200, 200, 200, ARC_RADIUS, BASE_STEP, MAX_SPAN
    );
    for (let i = 1; i < positions.length; i++) {
      expect(dist(positions[i], positions[i - 1])).toBeGreaterThan(56);
    }
  });

  it('orients the arc toward the ring center for every main-ring slot', () => {
    for (let slot = 0; slot < 8; slot++) {
      const parent = mainSlot(slot);
      const axis = computeSubRingAxis(parent.x, parent.y, RING_CENTER, RING_CENTER);
      // The axis must point from the parent toward the center.
      const towardCenter = Math.atan2(RING_CENTER - parent.y, RING_CENTER - parent.x);
      expect(axis).toBeCloseTo(towardCenter, 5);
      // The arc's midpoint child should be closer to center than the parent.
      const positions = computeSubRingArcPositions(
        3, parent.x, parent.y, RING_CENTER, RING_CENTER, ARC_RADIUS, BASE_STEP, MAX_SPAN
      );
      const midChild = positions[1];
      expect(dist(midChild, { x: RING_CENTER, y: RING_CENTER })).toBeLessThan(
        dist(parent, { x: RING_CENTER, y: RING_CENTER })
      );
    }
  });

  it('clamps positions inside the given viewport bounds', () => {
    const bounds = { min: 32, max: 368 };
    const positions = computeSubRingArcPositions(
      9, 80, 200, 200, 200, ARC_RADIUS, BASE_STEP, MAX_SPAN, bounds
    );
    for (const p of positions) {
      expect(p.x).toBeGreaterThanOrEqual(bounds.min);
      expect(p.x).toBeLessThanOrEqual(bounds.max);
      expect(p.y).toBeGreaterThanOrEqual(bounds.min);
      expect(p.y).toBeLessThanOrEqual(bounds.max);
    }
  });
});

describe('computeArcLabelSide', () => {
  it('puts labels on the right when the arc opens rightward (left slot)', () => {
    expect(computeArcLabelSide(80, 200, 200, 200)).toBe('right');
  });

  it('puts labels on the left when the arc opens leftward (right slot)', () => {
    expect(computeArcLabelSide(320, 200, 200, 200)).toBe('left');
  });

  it('falls back to below for a near-vertical axis (top/bottom slots)', () => {
    expect(computeArcLabelSide(200, 80, 200, 200)).toBe('below');
    expect(computeArcLabelSide(200, 320, 200, 200)).toBe('below');
  });
});

describe('computeFolderLayout', () => {
  it('uses one canonical left-side parent for every folder', () => {
    const layout = computeFolderLayout({ width: 400, height: 400, bubbleDiameter: 56, childCount: 4 });
    expect(layout.parent.x).toBeLessThan(200);
    expect(layout.parent.y).toBeCloseTo(200, 4);
    expect(layout.children.map((child) => (child.angle * 180) / Math.PI)).toEqual([
      expect.closeTo(-63, 3),
      expect.closeTo(-21, 3),
      expect.closeTo(21, 3),
      expect.closeTo(63, 3),
    ]);
  });

  it('adds editor insertion targets without persisting them as children', () => {
    const layout = computeFolderLayout({
      width: 420,
      height: 420,
      bubbleDiameter: 72,
      childCount: 4,
      includeInsertionTargets: true,
    });
    expect(layout.children).toHaveLength(4);
    expect(layout.insertionTargets).toHaveLength(2);
    expect(layout.insertionTargets[0].visualIndex).toBe(0);
  });

  it('keeps five overlay bubbles inside the canvas without overlap', () => {
    const layout = computeFolderLayout({ width: 400, height: 400, bubbleDiameter: 56, childCount: 5 });
    const interactiveDiameter = 56 * 1.15;
    expect(layout.children).toHaveLength(5);
    for (const child of layout.children) {
      expect(child.x).toBeGreaterThanOrEqual(interactiveDiameter / 2);
      expect(child.x).toBeLessThanOrEqual(400 - interactiveDiameter / 2);
      expect(child.y).toBeGreaterThanOrEqual(interactiveDiameter / 2);
      expect(child.y).toBeLessThanOrEqual(400 - interactiveDiameter / 2);
      expect(dist(child, layout.parent)).toBeCloseTo(dist(layout.children[0], layout.parent), 4);
    }
    for (let index = 0; index < layout.children.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < layout.children.length; otherIndex += 1) {
        expect(dist(layout.children[index], layout.children[otherIndex])).toBeGreaterThanOrEqual(interactiveDiameter);
      }
    }
  });
});
