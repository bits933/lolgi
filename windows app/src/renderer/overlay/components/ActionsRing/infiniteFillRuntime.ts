import type { InfiniteFillAnimationController } from './fillAnimationController';
import { getInfiniteFillFrame, resolveStoredLevel, type InfiniteFillFrame } from './waveFill';

export interface InfiniteFillWheelTick {
  previousLevel: number;
  nextLevel: number;
  signedSteps: number;
  frame: InfiniteFillFrame;
}

/** The signed label shown by Bubble for an unbounded adjustment. */
export function getInfiniteFillSignedSteps(level: number, step: number): number {
  return Math.round(level / step);
}

/**
 * Production wheel-to-fill seam used by Bubble. It keeps the ordered logical
 * transition, display count, semantic frame, and live controller update in one
 * place so they cannot silently diverge.
 */
export function applyInfiniteFillWheelTick(
  controller: InfiniteFillAnimationController | null,
  currentLevel: number,
  increasing: boolean,
  step: number,
): InfiniteFillWheelTick {
  const nextLevel = resolveStoredLevel(currentLevel, increasing ? step : -step, true);
  controller?.apply(currentLevel, nextLevel);
  return {
    previousLevel: currentLevel,
    nextLevel,
    signedSteps: getInfiniteFillSignedSteps(nextLevel, step),
    frame: getInfiniteFillFrame(nextLevel),
  };
}
