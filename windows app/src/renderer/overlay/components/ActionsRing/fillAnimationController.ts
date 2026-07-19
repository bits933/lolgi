import {
  getInfiniteFillFrame,
  getInfiniteFillTransition,
  type FillLayer,
  type InfiniteFillTransition,
} from './waveFill';

export interface FillAnimationLike {
  cancel: () => void;
  finished: Promise<unknown>;
}

export interface FillLayerElement {
  style: Pick<CSSStyleDeclaration, 'transform' | 'transformOrigin' | 'zIndex'>;
  animate?: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => FillAnimationLike;
}

export interface FillAnimationControllerOptions {
  readScale?: (element: FillLayerElement, fallback: number) => number;
  prefersReducedMotion?: () => boolean;
}

export interface InfiniteFillAnimationController {
  apply: (previousLevel: number, nextLevel: number) => void;
  snap: (level: number) => void;
  dispose: () => void;
}

export interface InfiniteFillControllerLifecycleSync {
  identity: string;
  enabled: boolean;
  layerA: FillLayerElement | null;
  layerB: FillLayerElement | null;
  initialLevel: number;
}

export interface InfiniteFillControllerLifecycle {
  sync: (input: InfiniteFillControllerLifecycleSync) => InfiniteFillAnimationController | null;
  clear: () => void;
}

export type InfiniteFillAnimationControllerFactory = (
  layerA: FillLayerElement,
  layerB: FillLayerElement,
) => InfiniteFillAnimationController;

export interface InfiniteFillControllerIdentityInput {
  bubbleId: string;
  definitionId?: string;
  actionType: string;
  scrollUpAction?: string;
  scrollDownAction?: string;
  fillSource: string;
  appAdjustment: boolean;
  unbounded: boolean;
  step: string | number | boolean | undefined;
}

/**
 * Scalar effect key for Bubble. A slot can keep its id while its action binding
 * changes, so this includes the behavior-bearing fields without depending on a
 * newly allocated config object each render.
 */
export function getInfiniteFillControllerIdentity(input: InfiniteFillControllerIdentityInput): string {
  return JSON.stringify([
    input.bubbleId,
    input.definitionId ?? '',
    input.actionType,
    input.scrollUpAction ?? '',
    input.scrollDownAction ?? '',
    input.fillSource,
    input.appAdjustment,
    input.unbounded,
    input.step ?? '',
  ]);
}

interface LayerRuntime {
  element: FillLayerElement;
  animation: FillAnimationLike | null;
  committedScale: number;
  generation: number;
}

function clampScale(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Parse the two computed transform formats Electron can return for scaleY(). */
export function scaleYFromTransform(transform: string | null | undefined, fallback = 0): number {
  if (!transform || transform === 'none') return clampScale(fallback);
  const matrix3d = /matrix3d\(([^)]+)\)/.exec(transform);
  if (matrix3d) return clampScale(Number(matrix3d[1].split(',')[5]));
  const matrix = /matrix\(([^)]+)\)/.exec(transform);
  if (matrix) return clampScale(Number(matrix[1].split(',')[3]));
  return clampScale(fallback);
}

function readRenderedScale(element: FillLayerElement, fallback: number): number {
  if (typeof getComputedStyle !== 'function') return clampScale(fallback);
  return scaleYFromTransform(getComputedStyle(element as unknown as Element).transform, fallback);
}

function setScale(runtime: LayerRuntime, scale: number): void {
  const safeScale = clampScale(scale);
  runtime.committedScale = safeScale;
  runtime.element.style.transform = `scaleY(${safeScale})`;
}

function setOrigin(runtime: LayerRuntime, origin: 'top' | 'bottom'): void {
  runtime.element.style.transformOrigin = `${origin} center`;
}

function setFrontLayer(a: LayerRuntime, b: LayerRuntime, frontLayer: FillLayer): void {
  a.element.style.zIndex = frontLayer === 'a' ? '1' : '0';
  b.element.style.zIndex = frontLayer === 'b' ? '1' : '0';
}

/**
 * Owns both physical fill-layer animations. The controller deliberately keeps
 * semantic target selection in waveFill.ts while handling cancellation and DOM
 * continuity here, where the rendered scale is available.
 */
export function createInfiniteFillAnimationController(
  layerA: FillLayerElement,
  layerB: FillLayerElement,
  options: FillAnimationControllerOptions = {},
): InfiniteFillAnimationController {
  const readScale = options.readScale ?? readRenderedScale;
  const reducedMotion = options.prefersReducedMotion ?? (() => (
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  ));
  const a: LayerRuntime = { element: layerA, animation: null, committedScale: 0, generation: 0 };
  const b: LayerRuntime = { element: layerB, animation: null, committedScale: 0, generation: 0 };
  let disposed = false;

  const cancel = (runtime: LayerRuntime, preserveRenderedScale: boolean): number => {
    const scale = preserveRenderedScale ? clampScale(readScale(runtime.element, runtime.committedScale)) : runtime.committedScale;
    // Commit before cancel: cancel() otherwise restores the older inline value.
    setScale(runtime, scale);
    runtime.generation += 1;
    if (runtime.animation) {
      try { runtime.animation.cancel(); } catch { /* already canceled */ }
      runtime.animation = null;
    }
    return scale;
  };

  const start = (runtime: LayerRuntime, from: number, to: number): void => {
    const safeFrom = clampScale(from);
    const safeTo = clampScale(to);
    setScale(runtime, safeFrom);
    if (disposed || reducedMotion() || safeFrom === safeTo || typeof runtime.element.animate !== 'function') {
      setScale(runtime, safeTo);
      return;
    }

    const generation = runtime.generation + 1;
    runtime.generation = generation;
    const animation = runtime.element.animate(
      [{ transform: `scaleY(${safeFrom})` }, { transform: `scaleY(${safeTo})` }],
      { duration: 150, easing: 'ease-out', fill: 'forwards' },
    );
    runtime.animation = animation;
    animation.finished.then(() => {
      if (disposed || runtime.generation !== generation || runtime.animation !== animation) return;
      setScale(runtime, safeTo);
      runtime.animation = null;
      try { animation.cancel(); } catch { /* already finished */ }
    }).catch(() => { /* cancellation is an expected replacement path */ });
  };

  const prepare = (transition: InfiniteFillTransition, currentA: number, currentB: number) => {
    const useRenderedStart = transition.mode === 'same-lap';
    const startA = useRenderedStart ? currentA : transition.startLayerAScale;
    const startB = useRenderedStart ? currentB : transition.startLayerBScale;

    // All initial state is committed before animate() can flush styles. This is
    // especially important at a boundary: the full backdrop exists before the
    // zero-scale incoming layer moves to the front.
    setOrigin(a, transition.origin);
    setOrigin(b, transition.origin);
    setScale(a, startA);
    setScale(b, startB);
    setFrontLayer(a, b, transition.frontLayer);
    return { startA, startB };
  };

  return {
    apply(previousLevel, nextLevel) {
      if (disposed) return;
      const currentA = cancel(a, true);
      const currentB = cancel(b, true);
      const transition = getInfiniteFillTransition(previousLevel, nextLevel);
      const { startA, startB } = prepare(transition, currentA, currentB);
      start(a, startA, transition.endLayerAScale);
      start(b, startB, transition.endLayerBScale);
    },

    snap(level) {
      if (disposed) return;
      cancel(a, false);
      cancel(b, false);
      const frame = getInfiniteFillFrame(level);
      const origin = level < 0 ? 'top' : 'bottom';
      setOrigin(a, origin);
      setOrigin(b, origin);
      setScale(a, frame.layerAScale);
      setScale(b, frame.layerBScale);
      setFrontLayer(a, b, frame.activeLayer);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      cancel(a, true);
      cancel(b, true);
    },
  };
}

/**
 * Owns the controller instance across React renders. Bubble passes a scalar
 * action identity into this seam; replacing that identity disposes the old
 * controller before the same DOM layers are handed to a new one.
 */
export function createInfiniteFillControllerLifecycle(
  createController: InfiniteFillAnimationControllerFactory = createInfiniteFillAnimationController,
): InfiniteFillControllerLifecycle {
  let activeIdentity: string | null = null;
  let activeLayerA: FillLayerElement | null = null;
  let activeLayerB: FillLayerElement | null = null;
  let controller: InfiniteFillAnimationController | null = null;

  const clear = (): void => {
    controller?.dispose();
    controller = null;
    activeIdentity = null;
    activeLayerA = null;
    activeLayerB = null;
  };

  return {
    sync(input) {
      if (!input.enabled || !input.layerA || !input.layerB) {
        clear();
        return null;
      }

      if (
        controller
        && activeIdentity === input.identity
        && activeLayerA === input.layerA
        && activeLayerB === input.layerB
      ) {
        return controller;
      }

      clear();
      controller = createController(input.layerA, input.layerB);
      activeIdentity = input.identity;
      activeLayerA = input.layerA;
      activeLayerB = input.layerB;
      controller.snap(input.initialLevel);
      return controller;
    },

    clear,
  };
}
