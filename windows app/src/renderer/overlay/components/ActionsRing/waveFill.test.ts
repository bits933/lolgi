import { describe, expect, it } from 'vitest';
import {
  clamp,
  didWrap,
  getInfiniteFillFrame,
  getInfiniteFillTransition,
  mod2,
  resolveStoredLevel,
  waveFraction,
} from './waveFill';

describe('bounded versus unbounded level storage', () => {
  it('preserves unbounded accumulation above and below zero', () => {
    expect(resolveStoredLevel(0.95, 0.1, true)).toBeCloseTo(1.05);
    expect(resolveStoredLevel(2.4, 0.1, true)).toBeCloseTo(2.5);
    expect(resolveStoredLevel(0, -0.1, true)).toBeCloseTo(-0.1);
  });

  it('continues to clamp bounded meters', () => {
    expect(clamp(-0.3)).toBe(0);
    expect(resolveStoredLevel(0.95, 0.1, false)).toBe(1);
    expect(resolveStoredLevel(0, -0.1, false)).toBe(0);
  });
});

describe('infinite two-layer frames', () => {
  it('keeps the exact staged positive and negative lap table fully covered after each completed lap', () => {
    const cases = [
      { level: 0, activeLayer: 'a', a: 0, b: 0, origin: 'bottom' },
      { level: 0.25, activeLayer: 'a', a: 0.25, b: 0, origin: 'bottom' },
      { level: 0.75, activeLayer: 'a', a: 0.75, b: 0, origin: 'bottom' },
      { level: 1, activeLayer: 'b', a: 1, b: 0, origin: 'bottom' },
      { level: 1.05, activeLayer: 'b', a: 1, b: 0.05, origin: 'bottom' },
      { level: 1.95, activeLayer: 'b', a: 1, b: 0.95, origin: 'bottom' },
      { level: 2, activeLayer: 'a', a: 0, b: 1, origin: 'bottom' },
      { level: 2.05, activeLayer: 'a', a: 0.05, b: 1, origin: 'bottom' },
      { level: 2.95, activeLayer: 'a', a: 0.95, b: 1, origin: 'bottom' },
      { level: 3, activeLayer: 'b', a: 1, b: 0, origin: 'bottom' },
      { level: 3.05, activeLayer: 'b', a: 1, b: 0.05, origin: 'bottom' },
      { level: 0, activeLayer: 'a', a: 0, b: 0, origin: 'bottom' },
      { level: -0.25, activeLayer: 'a', a: 0.25, b: 0, origin: 'top' },
      { level: -0.75, activeLayer: 'a', a: 0.75, b: 0, origin: 'top' },
      { level: -1, activeLayer: 'b', a: 1, b: 0, origin: 'top' },
      { level: -1.05, activeLayer: 'b', a: 1, b: 0.05, origin: 'top' },
    ] as const;

    for (const expected of cases) {
      const frame = getInfiniteFillFrame(expected.level);
      expect(frame.activeLayer).toBe(expected.activeLayer);
      expect(frame.layerAScale).toBeCloseTo(expected.a);
      expect(frame.layerBScale).toBeCloseTo(expected.b);
      expect(frame.layerAScale).toBeGreaterThanOrEqual(0);
      expect(frame.layerAScale).toBeLessThanOrEqual(1);
      expect(frame.layerBScale).toBeGreaterThanOrEqual(0);
      expect(frame.layerBScale).toBeLessThanOrEqual(1);
      if (Math.abs(expected.level) >= 1) expect(Math.max(frame.layerAScale, frame.layerBScale)).toBe(1);
      expect(expected.level < 0 ? 'top' : 'bottom').toBe(expected.origin);
    }
  });

  it('starts the first positive lap with color 1 rising from the bottom', () => {
    expect(getInfiniteFillFrame(0)).toMatchObject({ activeLayer: 'a', layerAScale: 0, layerBScale: 0 });
    expect(getInfiniteFillFrame(0.25)).toMatchObject({ completedLaps: 0, activeLayer: 'a', layerAScale: 0.25, layerBScale: 0 });
  });

  it('alternates stable physical colors through the first three positive laps', () => {
    expect(getInfiniteFillFrame(1.25)).toMatchObject({ completedLaps: 1, activeLayer: 'b', layerAScale: 1, layerBScale: 0.25 });
    expect(getInfiniteFillFrame(2.25)).toMatchObject({ completedLaps: 2, activeLayer: 'a', layerAScale: 0.25, layerBScale: 1 });
    expect(getInfiniteFillFrame(3.25)).toMatchObject({ completedLaps: 3, activeLayer: 'b', layerAScale: 1, layerBScale: 0.25 });
  });

  it('holds the outgoing color full at exact integer boundaries', () => {
    expect(getInfiniteFillFrame(1)).toMatchObject({ completedLaps: 1, activeLayer: 'b', layerAScale: 1, layerBScale: 0 });
    expect(getInfiniteFillFrame(2)).toMatchObject({ completedLaps: 2, activeLayer: 'a', layerAScale: 0, layerBScale: 1 });
    expect(getInfiniteFillFrame(3)).toMatchObject({ completedLaps: 3, activeLayer: 'b', layerAScale: 1, layerBScale: 0 });
  });

  it('uses the same seamless phase model for negative/downward laps', () => {
    expect(getInfiniteFillFrame(-0.4)).toMatchObject({ completedLaps: 0, activeLayer: 'a', layerAScale: 0.4, layerBScale: 0 });
    const secondNegativeLap = getInfiniteFillFrame(-1.4);
    expect(secondNegativeLap).toMatchObject({ completedLaps: 1, activeLayer: 'b', layerAScale: 1 });
    expect(secondNegativeLap.layerBScale).toBeCloseTo(0.4);
    const thirdNegativeLap = getInfiniteFillFrame(-2.4);
    expect(thirdNegativeLap).toMatchObject({ completedLaps: 2, activeLayer: 'a', layerBScale: 1 });
    expect(thirdNegativeLap.layerAScale).toBeCloseTo(0.4);
  });
});

describe('boundary and reversal choreography', () => {
  it('uses live same-lap targets in both directions', () => {
    expect(getInfiniteFillTransition(0.35, 0.55)).toMatchObject({
      mode: 'same-lap', origin: 'bottom', frontLayer: 'a',
      startLayerAScale: 0.35, startLayerBScale: 0,
      endLayerAScale: 0.55, endLayerBScale: 0,
    });
    expect(getInfiniteFillTransition(1.55, 1.35)).toMatchObject({
      mode: 'same-lap', origin: 'bottom', frontLayer: 'b',
      startLayerAScale: 1, startLayerBScale: 0.55,
      endLayerAScale: 1, endLayerBScale: 0.35,
    });
  });

  it('resets the incoming color under a full backdrop at the first outward boundary', () => {
    expect(getInfiniteFillTransition(0.95, 1.05)).toMatchObject({
      mode: 'outward-boundary', origin: 'bottom', frontLayer: 'b',
      startLayerAScale: 1, startLayerBScale: 0,
      endLayerAScale: 1, endLayerBScale: 0.05,
    });
  });

  it('never drops a reused full layer at later outward boundaries', () => {
    expect(getInfiniteFillTransition(1.95, 2.05)).toMatchObject({
      mode: 'outward-boundary', origin: 'bottom', frontLayer: 'a',
      startLayerAScale: 0, startLayerBScale: 1,
      endLayerAScale: 0.05, endLayerBScale: 1,
    });
  });

  it('shrinks the current color over a full prior backdrop at inward boundaries', () => {
    expect(getInfiniteFillTransition(2.05, 1.95)).toMatchObject({
      mode: 'inward-boundary', origin: 'bottom', frontLayer: 'b',
      startLayerAScale: 1, startLayerBScale: 1,
      endLayerAScale: 1, endLayerBScale: 0.95,
    });
    expect(getInfiniteFillTransition(1.05, 0.95)).toMatchObject({
      mode: 'inward-boundary', origin: 'bottom', frontLayer: 'a',
      startLayerAScale: 1, startLayerBScale: 0,
      endLayerAScale: 0.95, endLayerBScale: 0,
    });
  });

  it('mirrors negative outward and inward laps from the top edge', () => {
    expect(getInfiniteFillTransition(-1.95, -2.05)).toMatchObject({
      mode: 'outward-boundary', origin: 'top', frontLayer: 'a',
      startLayerAScale: 0, startLayerBScale: 1,
      endLayerAScale: 0.05, endLayerBScale: 1,
    });
    expect(getInfiniteFillTransition(-2.05, -1.95)).toMatchObject({
      mode: 'inward-boundary', origin: 'top', frontLayer: 'b',
      startLayerAScale: 1, startLayerBScale: 1,
      endLayerAScale: 1, endLayerBScale: 0.95,
    });
  });

  it('resets safely through the empty state on a sign crossing', () => {
    expect(getInfiniteFillTransition(0.05, -0.05)).toMatchObject({
      mode: 'sign-crossing', origin: 'top', frontLayer: 'a',
      startLayerAScale: 0, startLayerBScale: 0,
      endLayerAScale: 0.05, endLayerBScale: 0,
    });
  });

  it('preserves the departing origin while draining exactly to zero', () => {
    expect(getInfiniteFillTransition(-0.05, 0)).toMatchObject({
      mode: 'same-lap', origin: 'top', frontLayer: 'a',
      startLayerAScale: 0.05, startLayerBScale: 0,
      endLayerAScale: 0, endLayerBScale: 0,
    });
    expect(getInfiniteFillTransition(0.05, 0)).toMatchObject({
      mode: 'same-lap', origin: 'bottom', frontLayer: 'a',
      startLayerAScale: 0.05, startLayerBScale: 0,
      endLayerAScale: 0, endLayerBScale: 0,
    });
  });

  it('always starts a new nonzero direction from an empty frame', () => {
    expect(getInfiniteFillTransition(0, -0.05)).toMatchObject({
      mode: 'sign-crossing', origin: 'top', frontLayer: 'a',
      startLayerAScale: 0, startLayerBScale: 0,
      endLayerAScale: 0.05, endLayerBScale: 0,
    });
    expect(getInfiniteFillTransition(0, 0.05)).toMatchObject({
      mode: 'sign-crossing', origin: 'bottom', frontLayer: 'a',
      startLayerAScale: 0, startLayerBScale: 0,
      endLayerAScale: 0.05, endLayerBScale: 0,
    });
  });

  it('snaps multi-lap wheel batches to their final complete composite', () => {
    expect(getInfiniteFillTransition(0.8, 2.2)).toMatchObject({
      mode: 'multi-lap', origin: 'bottom', frontLayer: 'a',
      startLayerAScale: 0.2, startLayerBScale: 1,
      endLayerAScale: 0.2, endLayerBScale: 1,
    });
    expect(getInfiniteFillTransition(-0.8, -2.2)).toMatchObject({
      mode: 'multi-lap', origin: 'top', frontLayer: 'a',
      startLayerAScale: 0.2, startLayerBScale: 1,
      endLayerAScale: 0.2, endLayerBScale: 1,
    });
  });

  it('keeps rapid zero-crossing sequences tied to their correct edges', () => {
    const negativeDrain = getInfiniteFillTransition(-0.05, 0);
    const positiveRestart = getInfiniteFillTransition(0, 0.05);
    expect(negativeDrain.origin).toBe('top');
    expect(negativeDrain.endLayerAScale).toBe(0);
    expect(positiveRestart.origin).toBe('bottom');
    expect(positiveRestart.startLayerAScale).toBe(0);

    const positiveDrain = getInfiniteFillTransition(0.05, 0);
    const negativeRestart = getInfiniteFillTransition(0, -0.05);
    expect(positiveDrain.origin).toBe('bottom');
    expect(positiveDrain.endLayerAScale).toBe(0);
    expect(negativeRestart.origin).toBe('top');
    expect(negativeRestart.startLayerAScale).toBe(0);
  });
});

describe('legacy helpers', () => {
  it('retains wrap and modulo semantics used by existing consumers', () => {
    expect(waveFraction(-0.25)).toBeCloseTo(0.75);
    expect(didWrap(0.9, 1.1)).toBe(true);
    expect(didWrap(0.2, 0.4)).toBe(false);
    expect(mod2(-1)).toBe(1);
  });
});
