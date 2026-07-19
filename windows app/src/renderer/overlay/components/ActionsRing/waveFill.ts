// Pure fill-level math shared by the adjustment bubbles. Kept free of React/DOM
// so the visual phase can be tested independently of wheel timing.

export type FillLayer = 'a' | 'b';

export interface InfiniteFillFrame {
  /** Absolute distance from the reset point, in complete waves plus a fraction. */
  magnitude: number;
  completedLaps: number;
  fraction: number;
  /** The physical color layer which is currently growing. */
  activeLayer: FillLayer;
  /** Stable transform targets for the two physical color layers. */
  layerAScale: number;
  layerBScale: number;
}

export type InfiniteFillTransitionMode = 'same-lap' | 'outward-boundary' | 'inward-boundary' | 'sign-crossing' | 'multi-lap';
export type FillOrigin = 'bottom' | 'top';

/**
 * A complete transition recipe. Boundary recipes deliberately include distinct
 * start scales: recycled layers are reset only while hidden below a full
 * backdrop, never tweened from a previous full state down to a new fraction.
 */
export interface InfiniteFillTransition {
  mode: InfiniteFillTransitionMode;
  origin: FillOrigin;
  frontLayer: FillLayer;
  startLayerAScale: number;
  startLayerBScale: number;
  endLayerAScale: number;
  endLayerBScale: number;
}

/** Clamp a bounded fill level to [0, 1]. */
export function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Position within the current wave (0..1) for an unbounded, looping fill level. */
export function waveFraction(level: number): number {
  return ((level % 1) + 1) % 1;
}

/** True when moving prev→next crosses an integer boundary — i.e. the wave loops. */
export function didWrap(prev: number, next: number): boolean {
  return Math.floor(next) !== Math.floor(prev);
}

/**
 * Next stored level after one wheel step. Infinite (unbounded) fills accumulate
 * freely so the meter can loop; bounded fills stay within [0, 1].
 */
export function resolveStoredLevel(current: number, delta: number, isInfinite: boolean): number {
  const next = current + delta;
  return isInfinite ? next : clamp(next);
}

/** Positive modulo-2 (0 or 1), used to alternate the two physical layers. */
export function mod2(n: number): number {
  return ((n % 2) + 2) % 2;
}

/**
 * Resolves any signed accumulated level into a complete, deterministic two-layer
 * frame. Layer A is always color 1 and B is always color 2. At each lap, the
 * previous color remains full as the backdrop while the other color rises above
 * it. Exact lap boundaries retain the outgoing color at full scale, so a layer is
 * never reset while it is still visible.
 */
export function getInfiniteFillFrame(level: number): InfiniteFillFrame {
  const magnitude = Math.abs(level);
  const completedLaps = Math.floor(magnitude);
  // Wheel-step decimals (for example 0.05) otherwise produce an avoidable
  // 0.049999… transform at boundaries after repeated accumulation.
  const fraction = Number((magnitude - completedLaps).toFixed(12));
  const activeLayer: FillLayer = mod2(completedLaps) === 0 ? 'a' : 'b';

  if (completedLaps === 0) {
    return {
      magnitude,
      completedLaps,
      fraction,
      activeLayer,
      layerAScale: fraction,
      layerBScale: 0,
    };
  }

  // The layer from the immediately preceding lap is the opaque backdrop.
  return activeLayer === 'a'
    ? {
        magnitude,
        completedLaps,
        fraction,
        activeLayer,
        layerAScale: fraction,
        layerBScale: 1,
      }
    : {
        magnitude,
        completedLaps,
        fraction,
        activeLayer,
        layerAScale: 1,
        layerBScale: fraction,
      };
}

/**
 * Derives the choreography as a complete frame-to-frame recipe. Layer roles are
 * resolved now, before animation starts, never inside an animation callback.
 */
export function getInfiniteFillTransition(previousLevel: number, nextLevel: number): InfiniteFillTransition {
  const previous = getInfiniteFillFrame(previousLevel);
  const next = getInfiniteFillFrame(nextLevel);
  // At exactly zero, retain the departing side's origin so the final sliver
  // drains through the edge it grew from instead of jumping across the bubble.
  const origin: FillOrigin = nextLevel === 0
    ? (previousLevel < 0 ? 'top' : 'bottom')
    : (nextLevel < 0 ? 'top' : 'bottom');
  const endLayerAScale = next.layerAScale;
  const endLayerBScale = next.layerBScale;
  const crossesZero = previousLevel !== 0 && nextLevel !== 0
    && Math.sign(previousLevel) !== Math.sign(nextLevel);
  const startsFromZero = previousLevel === 0 && nextLevel !== 0;

  // A sign change is two independent first-lap motions separated by the empty
  // reset point. Reusing a full layer across the origin would animate it through
  // the bubble in the wrong vertical direction.
  if (crossesZero || startsFromZero) {
    return {
      mode: 'sign-crossing',
      origin,
      frontLayer: next.activeLayer,
      startLayerAScale: 0,
      startLayerBScale: 0,
      endLayerAScale,
      endLayerBScale,
    };
  }

  if (next.completedLaps === previous.completedLaps) {
    return {
      mode: 'same-lap',
      origin,
      frontLayer: next.activeLayer,
      startLayerAScale: previous.layerAScale,
      startLayerBScale: previous.layerBScale,
      endLayerAScale,
      endLayerBScale,
    };
  }

  // Coalesced/free-spin wheel input can cross more than one full lap in a
  // single update. There is no safe way to visually replay unbounded missed
  // colors with two physical layers, so snap to the final complete composite.
  // This preserves parity and, crucially, never exposes the neutral surface.
  if (Math.abs(next.completedLaps - previous.completedLaps) > 1) {
    return {
      mode: 'multi-lap',
      origin,
      frontLayer: next.activeLayer,
      startLayerAScale: endLayerAScale,
      startLayerBScale: endLayerBScale,
      endLayerAScale,
      endLayerBScale,
    };
  }

  if (next.completedLaps > previous.completedLaps) {
    // The prior active color becomes the full backdrop. The new active color is
    // reset at zero only while completely covered, then grows over it.
    const outgoingBackdrop = previous.activeLayer;
    return {
      mode: 'outward-boundary',
      origin,
      frontLayer: next.activeLayer,
      startLayerAScale: outgoingBackdrop === 'a' ? 1 : 0,
      startLayerBScale: outgoingBackdrop === 'b' ? 1 : 0,
      endLayerAScale,
      endLayerBScale,
    };
  }

  // Moving back into the prior lap: establish its backdrop at full, then shrink
  // its active color from full to the target fraction above that backdrop.
  if (next.completedLaps === 0) {
    return {
      mode: 'inward-boundary',
      origin,
      frontLayer: next.activeLayer,
      startLayerAScale: 1,
      startLayerBScale: 0,
      endLayerAScale,
      endLayerBScale,
    };
  }

  return {
    mode: 'inward-boundary',
    origin,
    frontLayer: next.activeLayer,
    startLayerAScale: 1,
    startLayerBScale: 1,
    endLayerAScale,
    endLayerBScale,
  };
}
