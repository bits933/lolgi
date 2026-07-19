import { describe, expect, it, vi } from 'vitest';
import {
  createInfiniteFillAnimationController,
  createInfiniteFillControllerLifecycle,
  getInfiniteFillControllerIdentity,
  type FillAnimationLike,
  type FillLayerElement,
} from './fillAnimationController';
import { applyInfiniteFillWheelTick, getInfiniteFillSignedSteps } from './infiniteFillRuntime';
import { getInfiniteFillFrame } from './waveFill';

class DeferredAnimation implements FillAnimationLike {
  readonly cancel = vi.fn();
  private resolveFinished!: () => void;
  readonly finished = new Promise<void>((resolve) => { this.resolveFinished = resolve; });

  finish(): void {
    this.resolveFinished();
  }
}

class FakeLayer implements FillLayerElement {
  style = { transform: 'scaleY(0)', transformOrigin: 'bottom center', zIndex: '0' } as CSSStyleDeclaration;
  readonly animations: Array<{ keyframes: Keyframe[]; animation: DeferredAnimation }> = [];

  animate = (keyframes: Keyframe[]): DeferredAnimation => {
    const animation = new DeferredAnimation();
    this.animations.push({ keyframes, animation });
    return animation;
  };
}

function scaleOf(layer: FakeLayer): number {
  return Number(/scaleY\(([^)]+)\)/.exec(layer.style.transform)?.[1]);
}

function expectFrame(a: FakeLayer, b: FakeLayer, level: number): void {
  const frame = getInfiniteFillFrame(level);
  expect(scaleOf(a)).toBeCloseTo(frame.layerAScale);
  expect(scaleOf(b)).toBeCloseTo(frame.layerBScale);
  expect(a.style.zIndex).toBe(frame.activeLayer === 'a' ? '1' : '0');
  expect(b.style.zIndex).toBe(frame.activeLayer === 'b' ? '1' : '0');
  expect(scaleOf(a)).toBeGreaterThanOrEqual(0);
  expect(scaleOf(a)).toBeLessThanOrEqual(1);
  expect(scaleOf(b)).toBeGreaterThanOrEqual(0);
  expect(scaleOf(b)).toBeLessThanOrEqual(1);
  if (Math.abs(level) >= 1) expect(Math.max(scaleOf(a), scaleOf(b))).toBe(1);
}

describe('Bubble production wheel-to-fill runtime', () => {
  it('keeps 20 rapid same-direction wheel events in one logical/display/animation chain', () => {
    const a = new FakeLayer();
    const b = new FakeLayer();
    const controller = createInfiniteFillAnimationController(a, b);
    let level = 0;
    controller.snap(level);

    for (let index = 1; index <= 20; index += 1) {
      const tick = applyInfiniteFillWheelTick(controller, level, true, 0.05);
      level = tick.nextLevel;
      expect(tick.previousLevel).toBeCloseTo((index - 1) * 0.05);
      expect(tick.signedSteps).toBe(index);
      expect(tick.frame).toEqual(getInfiniteFillFrame(level));
      if (index < 20) {
        const target = a.animations.at(-1)?.keyframes[1]?.transform;
        expect(target).toBe(`scaleY(${tick.frame.layerAScale})`);
      }
    }

    expect(level).toBeCloseTo(1);
    expect(getInfiniteFillSignedSteps(level, 0.05)).toBe(20);
    expect(a.animations).toHaveLength(19);
    for (const { animation } of a.animations) {
      expect(animation.cancel).toHaveBeenCalledOnce();
    }
    expect(b.animations).toHaveLength(0);
    expectFrame(a, b, level);
  });

  it('preserves staged parity and full coverage through later lap boundaries', () => {
    const a = new FakeLayer();
    const b = new FakeLayer();
    const controller = createInfiniteFillAnimationController(a, b, {
      prefersReducedMotion: () => true,
    });
    const stagedLevels = [0, 0.25, 0.75, 1, 1.05, 1.95, 2, 2.05, 2.95, 3, 3.05];

    let level = stagedLevels[0];
    controller.snap(level);
    expectFrame(a, b, level);
    for (const target of stagedLevels.slice(1)) {
      const increasing = target > level;
      const steps = Math.round(Math.abs(target - level) / 0.05);
      for (let index = 0; index < steps; index += 1) {
        const tick = applyInfiniteFillWheelTick(controller, level, increasing, 0.05);
        level = tick.nextLevel;
      }
      expect(level).toBeCloseTo(target);
      expectFrame(a, b, level);
    }
  });

  it('commits pause targets between unfinished bursts without losing logical/display ordering', async () => {
    const a = new FakeLayer();
    const b = new FakeLayer();
    const controller = createInfiniteFillAnimationController(a, b);
    let level = 0;
    controller.snap(level);

    for (const burstLength of [4, 3, 5, 6]) {
      for (let index = 0; index < burstLength; index += 1) {
        const tick = applyInfiniteFillWheelTick(controller, level, true, 0.05);
        level = tick.nextLevel;
        expect(tick.signedSteps).toBeCloseTo(level / 0.05);
        expect(tick.frame).toEqual(getInfiniteFillFrame(level));
      }
      const pauseAnimation = a.animations.at(-1)?.animation;
      if (!pauseAnimation) throw new Error('Expected an unfinished Color A animation at the pause');
      pauseAnimation.finish();
      await Promise.resolve();
      expectFrame(a, b, level);
    }

    for (let index = 0; index < 2; index += 1) {
      level = applyInfiniteFillWheelTick(controller, level, true, 0.05).nextLevel;
    }
    expect(level).toBeCloseTo(1);
    expectFrame(a, b, level);

    for (let index = 0; index < 5; index += 1) {
      level = applyInfiniteFillWheelTick(controller, level, true, 0.05).nextLevel;
    }
    const colorBPause = b.animations.at(-1)?.animation;
    if (!colorBPause) throw new Error('Expected an unfinished Color B animation at the pause');
    colorBPause.finish();
    await Promise.resolve();
    expect(level).toBeCloseTo(1.25);
    expectFrame(a, b, level);
  });

  it('replaces a completion resolved at the next update boundary before its microtask can write', async () => {
    const a = new FakeLayer();
    const b = new FakeLayer();
    const controller = createInfiniteFillAnimationController(a, b, {
      readScale: (_element, fallback) => fallback,
    });
    let level = 0;
    controller.snap(level);

    level = applyInfiniteFillWheelTick(controller, level, true, 0.05).nextLevel;
    const first = a.animations[0]?.animation;
    if (!first) throw new Error('Expected the first wheel animation');
    first.finish();
    level = applyInfiniteFillWheelTick(controller, level, true, 0.05).nextLevel;
    const replacement = a.animations[1]?.animation;
    if (!replacement) throw new Error('Expected the replacement wheel animation');
    await Promise.resolve();

    expect(first.cancel).toHaveBeenCalledOnce();
    expect(scaleOf(a)).toBe(0);
    expect(level).toBeCloseTo(0.1);

    replacement.finish();
    await Promise.resolve();
    expectFrame(a, b, level);
  });

  it('reverses a genuinely in-flight outward boundary without an old completion changing the target', async () => {
    const a = new FakeLayer();
    const b = new FakeLayer();
    const controller = createInfiniteFillAnimationController(a, b, {
      readScale: (_element, fallback) => fallback,
    });
    let level = 0.95;
    controller.snap(level);

    const outward = applyInfiniteFillWheelTick(controller, level, true, 0.1);
    level = outward.nextLevel;
    const oldBoundaryAnimation = b.animations.at(-1)?.animation;
    if (!oldBoundaryAnimation) throw new Error('Expected Color B to animate across the outward boundary');

    const reversal = applyInfiniteFillWheelTick(controller, level, false, 0.1);
    level = reversal.nextLevel;
    oldBoundaryAnimation.finish();
    await Promise.resolve();

    expect(level).toBeCloseTo(0.95);
    expect(reversal.signedSteps).toBe(10);
    expect(oldBoundaryAnimation.cancel).toHaveBeenCalledOnce();
    expect(scaleOf(b)).toBe(0);

    const currentAnimation = a.animations.at(-1)?.animation;
    if (!currentAnimation) throw new Error('Expected Color A to shrink after the reversal');
    currentAnimation.finish();
    await Promise.resolve();
    expectFrame(a, b, level);
  });

  it('disposes a replaced action controller and an unmounted controller before old callbacks can write', async () => {
    const a = new FakeLayer();
    const b = new FakeLayer();
    const lifecycle = createInfiniteFillControllerLifecycle((layerA, layerB) => (
      createInfiniteFillAnimationController(layerA, layerB, { readScale: (_element, fallback) => fallback })
    ));
    const identity = (definitionId: string) => getInfiniteFillControllerIdentity({
      bubbleId: 'slot', definitionId, actionType: 'keyboard-shortcut',
      scrollUpAction: ']', scrollDownAction: '[', fillSource: 'custom',
      appAdjustment: true, unbounded: false, step: 5,
    });
    const first = lifecycle.sync({ identity: identity('brush-size'), enabled: true, layerA: a, layerB: b, initialLevel: 0 });
    if (!first) throw new Error('Expected controller');
    applyInfiniteFillWheelTick(first, 0, true, 0.05);
    const oldAnimation = a.animations[0].animation;

    const replacement = lifecycle.sync({ identity: identity('brush-hardness'), enabled: true, layerA: a, layerB: b, initialLevel: 0 });
    if (!replacement) throw new Error('Expected replacement controller');
    oldAnimation.finish();
    await Promise.resolve();
    expect(oldAnimation.cancel).toHaveBeenCalled();
    expectFrame(a, b, 0);

    applyInfiniteFillWheelTick(replacement, 0, true, 0.05);
    const unmountedAnimation = a.animations.at(-1)?.animation;
    lifecycle.clear();
    unmountedAnimation?.finish();
    await Promise.resolve();
    expect(unmountedAnimation?.cancel).toHaveBeenCalled();
  });
});
