import { describe, expect, it, vi } from 'vitest';
import {
  createInfiniteFillAnimationController,
  createInfiniteFillControllerLifecycle,
  getInfiniteFillControllerIdentity,
  scaleYFromTransform,
  type FillAnimationLike,
  type FillLayerElement,
} from './fillAnimationController';

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
  onAnimate: (() => void) | null = null;

  animate = (keyframes: Keyframe[]): DeferredAnimation => {
    this.onAnimate?.();
    const animation = new DeferredAnimation();
    this.animations.push({ keyframes, animation });
    return animation;
  };
}

function transformOf(keyframe: Keyframe | undefined): string | undefined {
  return keyframe?.transform as string | undefined;
}

describe('infinite fill animation controller', () => {
  it('restarts a same-lap animation from the sampled rendered scale', () => {
    const a = new FakeLayer();
    const b = new FakeLayer();
    const rendered = new Map<FillLayerElement, number>();
    const controller = createInfiniteFillAnimationController(a, b, {
      readScale: (element, fallback) => rendered.get(element) ?? fallback,
    });

    controller.apply(0, 0.4);
    rendered.set(a, 0.27);
    controller.apply(0.4, 0.6);

    expect(a.animations).toHaveLength(2);
    expect(a.animations[0].animation.cancel).toHaveBeenCalledOnce();
    expect(transformOf(a.animations[1].keyframes[0])).toBe('scaleY(0.27)');
    expect(transformOf(a.animations[1].keyframes[1])).toBe('scaleY(0.6)');
  });

  it('establishes the full backdrop before bringing an incoming boundary layer forward', () => {
    const a = new FakeLayer();
    const b = new FakeLayer();
    const controller = createInfiniteFillAnimationController(a, b, { readScale: (_element, fallback) => fallback });

    controller.apply(0.95, 1.05);

    expect(a.style.transform).toBe('scaleY(1)');
    expect(a.style.zIndex).toBe('0');
    expect(b.style.transform).toBe('scaleY(0)');
    expect(b.style.zIndex).toBe('1');
    expect(a.animations).toHaveLength(0);
    expect(transformOf(b.animations[0].keyframes[0])).toBe('scaleY(0)');
    expect(transformOf(b.animations[0].keyframes[1])).toBe('scaleY(0.05)');
  });

  it('ignores a completion that resolved just before a newer animation replaced it', async () => {
    const a = new FakeLayer();
    const b = new FakeLayer();
    const rendered = new Map<FillLayerElement, number>();
    const controller = createInfiniteFillAnimationController(a, b, {
      readScale: (element, fallback) => rendered.get(element) ?? fallback,
    });

    controller.apply(0, 0.4);
    const first = a.animations[0].animation;
    first.finish();
    rendered.set(a, 0.25);
    controller.apply(0.4, 0.6);
    const second = a.animations[1].animation;

    await Promise.resolve();
    expect(a.style.transform).toBe('scaleY(0.25)');

    second.finish();
    await Promise.resolve();
    expect(a.style.transform).toBe('scaleY(0.6)');
  });

  it('snaps a multi-lap batch to the final parity without animating through neutral space', () => {
    const a = new FakeLayer();
    const b = new FakeLayer();
    const controller = createInfiniteFillAnimationController(a, b, { readScale: (_element, fallback) => fallback });

    controller.apply(0.8, 2.2);

    expect(a.style.transform).toBe('scaleY(0.2)');
    expect(b.style.transform).toBe('scaleY(1)');
    expect(a.style.zIndex).toBe('1');
    expect(b.style.zIndex).toBe('0');
    expect(a.animations).toHaveLength(0);
    expect(b.animations).toHaveLength(0);

    controller.apply(-0.8, -2.2);
    expect(a.style.transform).toBe('scaleY(0.2)');
    expect(b.style.transform).toBe('scaleY(1)');
    expect(a.style.transformOrigin).toBe('top center');
    expect(b.style.transformOrigin).toBe('top center');
    expect(a.animations).toHaveLength(0);
    expect(b.animations).toHaveLength(0);
  });

  it('prepares both layers, origins, and stack order before the first boundary animation starts', () => {
    const a = new FakeLayer();
    const b = new FakeLayer();
    let snapshot: Record<string, string> | null = null;
    b.onAnimate = () => {
      snapshot = {
        aTransform: a.style.transform,
        bTransform: b.style.transform,
        aOrigin: a.style.transformOrigin,
        bOrigin: b.style.transformOrigin,
        aZ: a.style.zIndex,
        bZ: b.style.zIndex,
      };
    };
    const controller = createInfiniteFillAnimationController(a, b, { readScale: (_element, fallback) => fallback });

    controller.apply(0.95, 1.05);

    expect(snapshot).toEqual({
      aTransform: 'scaleY(1)', bTransform: 'scaleY(0)',
      aOrigin: 'bottom center', bOrigin: 'bottom center', aZ: '0', bZ: '1',
    });
  });

  it('prepares the full B backdrop before A animates at the alternating outward boundary', () => {
    const a = new FakeLayer();
    const b = new FakeLayer();
    let snapshot: Record<string, string> | null = null;
    a.onAnimate = () => {
      snapshot = {
        aTransform: a.style.transform,
        bTransform: b.style.transform,
        aOrigin: a.style.transformOrigin,
        bOrigin: b.style.transformOrigin,
        aZ: a.style.zIndex,
        bZ: b.style.zIndex,
      };
    };
    const controller = createInfiniteFillAnimationController(a, b, {
      readScale: (_element, fallback) => fallback,
    });

    controller.apply(1.95, 2.05);

    expect(snapshot).toEqual({
      aTransform: 'scaleY(0)', bTransform: 'scaleY(1)',
      aOrigin: 'bottom center', bOrigin: 'bottom center', aZ: '1', bZ: '0',
    });
  });

  it('shrinks an inward boundary over a full backdrop and drains exact zero through its departing edge', () => {
    const a = new FakeLayer();
    const b = new FakeLayer();
    const rendered = new Map<FillLayerElement, number>([[a, 1], [b, 1]]);
    const controller = createInfiniteFillAnimationController(a, b, {
      readScale: (element, fallback) => rendered.get(element) ?? fallback,
    });

    controller.apply(2.05, 1.95);
    expect(a.style.transform).toBe('scaleY(1)');
    expect(b.style.zIndex).toBe('1');
    expect(transformOf(b.animations[0].keyframes[0])).toBe('scaleY(1)');
    expect(transformOf(b.animations[0].keyframes[1])).toBe('scaleY(0.95)');

    rendered.set(a, 0.05);
    rendered.set(b, 0);
    controller.apply(-0.05, 0);
    expect(a.style.transformOrigin).toBe('top center');
    expect(transformOf(a.animations.at(-1)?.keyframes[1])).toBe('scaleY(0)');
  });

  it('keeps one live animation owner per layer through repeated replacement and supports no-WAAPI fallback', () => {
    const a = new FakeLayer();
    const b = new FakeLayer();
    const rendered = new Map<FillLayerElement, number>();
    const controller = createInfiniteFillAnimationController(a, b, {
      readScale: (element, fallback) => rendered.get(element) ?? fallback,
    });

    controller.apply(0, 0.2);
    rendered.set(a, 0.1);
    controller.apply(0.2, 0.4);
    rendered.set(a, 0.3);
    controller.apply(0.4, 0.6);
    expect(a.animations).toHaveLength(3);
    expect(a.animations[0].animation.cancel).toHaveBeenCalledOnce();
    expect(a.animations[1].animation.cancel).toHaveBeenCalledOnce();
    expect(a.animations[2].animation.cancel).not.toHaveBeenCalled();

    const noApiA = new FakeLayer();
    const noApiB = new FakeLayer();
    noApiA.animate = undefined as unknown as typeof noApiA.animate;
    noApiB.animate = undefined as unknown as typeof noApiB.animate;
    const noApi = createInfiniteFillAnimationController(noApiA, noApiB, { readScale: (_element, fallback) => fallback });
    noApi.apply(1.95, 2.05);
    expect(noApiA.style.transform).toBe('scaleY(0.05)');
    expect(noApiB.style.transform).toBe('scaleY(1)');
    expect(noApiA.style.transformOrigin).toBe('bottom center');
  });

  it('uses the same target frame for reduced motion and prevents writes after disposal', async () => {
    const a = new FakeLayer();
    const b = new FakeLayer();
    const reduced = createInfiniteFillAnimationController(a, b, {
      readScale: (_element, fallback) => fallback,
      prefersReducedMotion: () => true,
    });
    reduced.apply(-1.95, -2.05);
    expect(a.style.transform).toBe('scaleY(0.05)');
    expect(b.style.transform).toBe('scaleY(1)');
    expect(a.style.transformOrigin).toBe('top center');
    expect(a.animations).toHaveLength(0);

    const c = new FakeLayer();
    const d = new FakeLayer();
    const controller = createInfiniteFillAnimationController(c, d, { readScale: (_element, fallback) => fallback });
    controller.apply(0, 0.5);
    const animation = c.animations[0].animation;
    controller.dispose();
    animation.finish();
    await Promise.resolve();
    expect(animation.cancel).toHaveBeenCalled();
    expect(c.style.transform).toBe('scaleY(0)');
  });
});

describe('infinite fill controller lifecycle identity', () => {
  it('changes when a same-slot action binding changes but remains stable for equivalent input', () => {
    const base = {
      bubbleId: 'slot-1', definitionId: 'zoom-in', actionType: 'keyboard-shortcut',
      scrollUpAction: 'ctrl+=', scrollDownAction: 'ctrl+-', fillSource: 'custom',
      appAdjustment: true, unbounded: false, step: 5,
    };
    expect(getInfiniteFillControllerIdentity(base)).toBe(getInfiniteFillControllerIdentity({ ...base }));
    expect(getInfiniteFillControllerIdentity({ ...base, definitionId: 'brush-size-up' }))
      .not.toBe(getInfiniteFillControllerIdentity(base));
    expect(getInfiniteFillControllerIdentity({ ...base, scrollUpAction: ']' }))
      .not.toBe(getInfiniteFillControllerIdentity(base));
  });

  it('uses the production lifecycle seam to dispose an in-flight same-slot controller on action replacement', async () => {
    const a = new FakeLayer();
    const b = new FakeLayer();
    const lifecycle = createInfiniteFillControllerLifecycle(
      (layerA, layerB) => createInfiniteFillAnimationController(layerA, layerB, {
        readScale: (_element, fallback) => fallback,
      }),
    );
    const firstIdentity = getInfiniteFillControllerIdentity({
      bubbleId: 'slot-1', definitionId: 'zoom-in', actionType: 'keyboard-shortcut',
      scrollUpAction: 'ctrl+=', scrollDownAction: 'ctrl+-', fillSource: 'custom',
      appAdjustment: true, unbounded: false, step: 5,
    });
    const controller = lifecycle.sync({
      identity: firstIdentity,
      enabled: true,
      layerA: a,
      layerB: b,
      initialLevel: 0,
    });
    if (!controller) throw new Error('Expected the enabled lifecycle to create a controller');
    controller.apply(0, 0.5);
    const oldAnimation = a.animations[0].animation;
    const replacementIdentity = getInfiniteFillControllerIdentity({
      bubbleId: 'slot-1', definitionId: 'brush-size-up', actionType: 'keyboard-shortcut',
      scrollUpAction: ']', scrollDownAction: '[', fillSource: 'custom',
      appAdjustment: true, unbounded: false, step: 5,
    });

    const replacement = lifecycle.sync({
      identity: replacementIdentity,
      enabled: true,
      layerA: a,
      layerB: b,
      initialLevel: 0,
    });
    oldAnimation.finish();
    await Promise.resolve();

    expect(replacement).not.toBe(controller);
    expect(oldAnimation.cancel).toHaveBeenCalled();
    expect(a.style.transform).toBe('scaleY(0)');
  });
});

describe('scaleYFromTransform', () => {
  it('reads matrix and matrix3d values and preserves a valid fallback', () => {
    expect(scaleYFromTransform('matrix(1, 0, 0, 0.42, 0, 0)')).toBeCloseTo(0.42);
    expect(scaleYFromTransform('matrix3d(1, 0, 0, 0, 0, 0.63, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)')).toBeCloseTo(0.63);
    expect(scaleYFromTransform('none', 0.37)).toBeCloseTo(0.37);
    expect(scaleYFromTransform('unparseable', 0.37)).toBeCloseTo(0.37);
  });
});
