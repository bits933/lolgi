import React, { forwardRef, useCallback, useEffect, useRef } from 'react';
import * as LucideIcons from 'lucide-react';
import type { ActionType, BubbleConfig, BubblePosition } from '../../../../shared/types';
import {
  computeGroupDotAngle,
  computeRadialLabelOffsetY,
  computeRadialLabelSide,
} from '../../../../shared/ringGeometry';
import { useOverlayStore } from '../../store/overlayStore';
import { createWheelDispatcher, type WheelDispatcher, type WheelDirection } from './wheelDispatcher';
import {
  clamp,
  resolveStoredLevel,
} from './waveFill';
import {
  applyInfiniteFillWheelTick,
  getInfiniteFillSignedSteps,
} from './infiniteFillRuntime';
import {
  createInfiniteFillControllerLifecycle,
  createInfiniteFillAnimationController,
  type InfiniteFillControllerLifecycle,
  getInfiniteFillControllerIdentity,
  type InfiniteFillAnimationController,
} from './fillAnimationController';
import styles from './Bubble.module.css';

type AnyIconComponent = React.ComponentType<Record<string, unknown>>;

function resolveIcon(name: string): AnyIconComponent {
  const icons = LucideIcons as unknown as Record<string, AnyIconComponent>;
  return icons[name] ?? (LucideIcons.Circle as unknown as AnyIconComponent);
}

const SYSTEM_ACTIONS = new Set<string>([
  'volume-up', 'volume-down', 'volume-mute',
  'brightness-up', 'brightness-down',
  'media-play-pause', 'media-next', 'media-prev',
  'screenshot',
  'zoom-in', 'zoom-out',
]);
const VOLUME_ACTIONS = new Set<string>(['volume-up', 'volume-down']);
const BRIGHTNESS_ACTIONS = new Set<string>(['brightness-up', 'brightness-down']);

interface BubbleProps {
  config: BubbleConfig;
  position: BubblePosition;
  isHovered: boolean;
  onSelect: (config: BubbleConfig) => void;
  onActionError: (message: string) => void;
  isVisible: boolean;
  index: number;
  total: number;
  isClosing: boolean;
  /** 'hover' (default) reveals the label on hover; 'persistent' keeps it always shown (sub-ring). */
  labelMode?: 'hover' | 'persistent';
  /** Where a persistent label sits. 'radial' mirrors the main-ring outward placement. */
  labelSide?: 'radial' | 'above' | 'left' | 'right' | 'below';
}

type FillSource = 'volume' | 'brightness' | 'custom';

interface SystemAdjustmentRequest {
  action: ActionType;
  parameters: Record<string, string | number | boolean>;
}

function getFillSource(config: BubbleConfig): FillSource {
  if (config.type !== 'fill') return 'custom';
  const actions = [config.scrollUpAction, config.scrollDownAction];
  if (actions.some((action) => action && VOLUME_ACTIONS.has(action))) return 'volume';
  if (actions.some((action) => action && BRIGHTNESS_ACTIONS.has(action))) return 'brightness';
  return 'custom';
}

export const Bubble = forwardRef<HTMLDivElement, BubbleProps>(
  ({ config, position, isHovered, onSelect, onActionError, isVisible, index, total, isClosing, labelMode = 'hover', labelSide = 'below' }, ref) => {
    const fillSource = getFillSource(config);
    const volumeLevel = useOverlayStore((state) => fillSource === 'volume' ? state.systemState.volumeLevel : 0);
    const brightnessLevel = useOverlayStore((state) => fillSource === 'brightness' ? state.systemState.brightnessLevel : 0);
    const isMuted = useOverlayStore((state) => config.actionType === 'volume-mute' ? state.systemState.isMuted : false);
    const isPlaying = useOverlayStore((state) => config.actionType === 'media-play-pause' ? state.systemState.isPlaying : false);
    const updateSystemState = useOverlayStore((state) => state.updateSystemState);
    const storedFillLevel = useOverlayStore((state) => state.bubbleFillLevels[config.id]);
    const setBubbleFillLevel = useOverlayStore((state) => state.setBubbleFillLevel);
    const clickInFlightRef = useRef(false);
    const systemAdjustmentFrameRef = useRef<number | null>(null);
    const pendingSystemAdjustmentRef = useRef<SystemAdjustmentRequest | null>(null);
    const wheelDispatcherRef = useRef<WheelDispatcher | null>(null);
    const dispatchCustomTickRef = useRef<(direction: WheelDirection) => Promise<void>>(() => Promise.resolve());
    // The two physical layers have stable colors: A is color 1, B is color 2.
    // Their transform/z-index targets are derived from the raw level, never from
    // an animation-completion callback.
    const layerARef = useRef<HTMLDivElement>(null);
    const layerBRef = useRef<HTMLDivElement>(null);
    const fillAnimationControllerRef = useRef<InfiniteFillAnimationController | null>(null);
    const fillControllerLifecycleRef = useRef<InfiniteFillControllerLifecycle | null>(null);
    if (fillControllerLifecycleRef.current === null) {
      fillControllerLifecycleRef.current = createInfiniteFillControllerLifecycle(
        (layerA, layerB) => createInfiniteFillAnimationController(layerA, layerB),
      );
    }
    // The controller invalidates every replaced animation, so an old completion
    // can never overwrite a newer visual frame.
    const lastLevelRef = useRef<number>(storedFillLevel ?? 0);
    const hasSyncedInfiniteFrameRef = useRef(false);

    // Every scroll-adjustable bubble (volume, brightness, custom, and preset app
    // adjustments like zoom/brush size) shows the same accumulating fill meter so
    // they read as one consistent slider control.
    const showFillMeter = config.type === 'fill';
    // Relative-tick adjustments (brush size, zoom, scroll) have no readable
    // absolute value, so their meter is unbounded: it loops instead of capping at
    // 100%. Volume/brightness keep the real, bounded gauge.
    const isInfinite = showFillMeter && (config.parameters?.appAdjustment === true || config.parameters?.unbounded === true);
    const customFillLevel = storedFillLevel ?? 0.5;
    const isToggleActive =
      (config.type === 'toggle' && config.actionType === 'volume-mute' && isMuted) ||
      (config.type === 'toggle' && config.actionType === 'media-play-pause' && isPlaying);
    const fillLevel = !showFillMeter
      ? 0
      : fillSource === 'volume'
        ? volumeLevel
          : fillSource === 'brightness'
          ? brightnessLevel
          : customFillLevel;
    const fillPercent = Math.round(fillLevel * 100);
    // Signed count of wheel steps since the ring opened — shown next to the label
    // for infinite bubbles in place of a (meaningless) percentage.
    const infiniteStep = Math.min(20, Math.max(1, Number(config.parameters?.step ?? 5))) / 100;
    const netSteps = isInfinite ? getInfiniteFillSignedSteps(storedFillLevel ?? 0, infiniteStep) : 0;
    const infiniteControllerIdentity = getInfiniteFillControllerIdentity({
      bubbleId: config.id,
      definitionId: config.definitionId,
      actionType: config.actionType,
      scrollUpAction: config.scrollUpAction,
      scrollDownAction: config.scrollDownAction,
      fillSource,
      appAdjustment: config.parameters?.appAdjustment === true,
      unbounded: config.parameters?.unbounded === true,
      step: config.parameters?.step,
    });
    const Icon = resolveIcon(
      isToggleActive
        ? config.iconNameAlt ?? (config.actionType === 'media-play-pause' ? 'CirclePause' : config.iconName)
        : config.iconName,
    );
    const tx = position.x - 200;
    const ty = position.y - 200;
    const delay = isClosing ? (total - 1 - index) * 14 : index * 16;

    const reportResult = useCallback((result: Awaited<ReturnType<typeof window.electronAPI.executeAction>>) => {
      if (!result.success) {
        onActionError(result.message ?? result.error ?? 'This action could not be completed.');
        void window.electronAPI.getSystemState().then(updateSystemState).catch(() => {});
        return;
      }
      if (result.newState) updateSystemState(result.newState);
    }, [onActionError, updateSystemState]);

    const handleClick = useCallback(async () => {
      if (clickInFlightRef.current) return;

      if (config.type === 'toggle') {
        clickInFlightRef.current = true;
        const previousState = { isMuted, isPlaying };
        if (config.actionType === 'volume-mute') updateSystemState({ isMuted: !isMuted });
        if (config.actionType === 'media-play-pause') updateSystemState({ isPlaying: !isPlaying });
        try {
          const result = await window.electronAPI.executeAction({
            bubbleId: config.id,
            definitionId: config.definitionId,
            actionType: config.actionType,
            payload: config.payload,
            parameters: config.parameters,
            keepOpen: true,
          });
          if (!result.success) updateSystemState(previousState);
          reportResult(result);
        } catch (error) {
          console.error('[Bubble] toggle action failed:', error);
          updateSystemState(previousState);
          onActionError('The action service did not respond.');
        } finally {
          clickInFlightRef.current = false;
        }
        return;
      }

      if (config.type === 'fill') {
        const configuredClickAction = String(config.parameters?.clickAction ?? '').trim();
        const clickAction = configuredClickAction
          || (config.payload?.trim() ? config.actionType : 'do-nothing');
        if (!clickAction || clickAction === 'do-nothing') return;
        clickInFlightRef.current = true;
        try {
          reportResult(await window.electronAPI.executeAction({
            bubbleId: config.id,
            definitionId: config.definitionId,
            actionType: clickAction as ActionType,
            payload: config.payload,
            parameters: config.parameters,
            keepOpen: true,
          }));
        } catch (error) {
          console.error('[Bubble] fill click action failed:', error);
          onActionError('The action service did not respond.');
        } finally {
          clickInFlightRef.current = false;
        }
        return;
      }

      onSelect(config);
    }, [config, isMuted, isPlaying, onActionError, onSelect, reportResult, updateSystemState]);

    const dispatchSystemAdjustment = useCallback((request: SystemAdjustmentRequest) => {
      void window.electronAPI.executeAction({
        bubbleId: config.id,
        definitionId: config.definitionId,
        actionType: request.action,
        parameters: request.parameters,
        keepOpen: true,
      }).then(reportResult).catch((error) => {
        console.error('[Bubble] adjustment action failed:', error);
        onActionError('The adjustment service did not respond.');
      });
    }, [config.definitionId, config.id, onActionError, reportResult]);

    const flushSystemAdjustment = useCallback(() => {
      const request = pendingSystemAdjustmentRef.current;
      pendingSystemAdjustmentRef.current = null;
      if (request) dispatchSystemAdjustment(request);
    }, [dispatchSystemAdjustment]);

    useEffect(() => () => {
      if (systemAdjustmentFrameRef.current !== null) {
        cancelAnimationFrame(systemAdjustmentFrameRef.current);
        systemAdjustmentFrameRef.current = null;
        flushSystemAdjustment();
      }
    }, [flushSystemAdjustment]);

    // A controller owns the two live Web Animations. Recreate it whenever this
    // bubble changes identity/mode or leaves the ring, so an old ring session can
    // never write into a reused DOM node after a close/reopen.
    useEffect(() => {
      const level = storedFillLevel ?? 0;
      const controller = fillControllerLifecycleRef.current?.sync({
        identity: infiniteControllerIdentity,
        enabled: isInfinite && isVisible,
        layerA: layerARef.current,
        layerB: layerBRef.current,
        initialLevel: level,
      }) ?? null;
      fillAnimationControllerRef.current = controller;
      if (!controller) {
        hasSyncedInfiniteFrameRef.current = false;
        return;
      }
      lastLevelRef.current = level;
      hasSyncedInfiniteFrameRef.current = true;
    }, [infiniteControllerIdentity, isInfinite, isVisible]);

    useEffect(() => () => {
      fillControllerLifecycleRef.current?.clear();
      fillAnimationControllerRef.current = null;
      hasSyncedInfiniteFrameRef.current = false;
    }, []);

    // Store updates caused by the local wheel handler have already been applied
    // to the controller. Other updates (ring reset, imported profile, or an
    // external store write) intentionally snap to their deterministic frame.
    useEffect(() => {
      if (!isInfinite || !fillAnimationControllerRef.current) return;
      const level = storedFillLevel ?? 0;
      if (hasSyncedInfiniteFrameRef.current && level === lastLevelRef.current) return;
      fillAnimationControllerRef.current.snap(level);
      lastLevelRef.current = level;
      hasSyncedInfiniteFrameRef.current = true;
    }, [isInfinite, storedFillLevel]);

    const performSystemAdjustment = useCallback((increasing: boolean) => {
      // Volume/brightness fills track a real, persistent level: update the meter
      // optimistically and coalesce the backing system action to one dispatch per
      // animation frame (the last requested level wins).
      const baseStep = Math.min(20, Math.max(1, Number(config.parameters?.step ?? 5))) / 100;
      const signedStep = increasing ? baseStep : -baseStep;
      let targetLevel: number;
      if (fillSource === 'volume') {
        targetLevel = clamp(useOverlayStore.getState().systemState.volumeLevel + signedStep);
        updateSystemState({ volumeLevel: targetLevel });
      } else {
        targetLevel = clamp(useOverlayStore.getState().systemState.brightnessLevel + signedStep);
        updateSystemState({ brightnessLevel: targetLevel });
      }

      const action = increasing ? config.scrollUpAction : config.scrollDownAction;
      if (!action) return;
      pendingSystemAdjustmentRef.current = {
        action: action as ActionType,
        parameters: {
          ...config.parameters,
          step: Math.min(20, Math.max(1, Number(config.parameters?.step ?? 5))),
          targetLevel,
        },
      };
      if (systemAdjustmentFrameRef.current === null) {
        systemAdjustmentFrameRef.current = requestAnimationFrame(() => {
          systemAdjustmentFrameRef.current = null;
          flushSystemAdjustment();
        });
      }
    }, [config.parameters, config.scrollUpAction, config.scrollDownAction, fillSource, flushSystemAdjustment, updateSystemState]);

    const dispatchCustomTick = useCallback((direction: WheelDirection): Promise<void> => {
      const increasing = direction === 'up';
      const action = increasing ? config.scrollUpAction : config.scrollDownAction;
      if (!action) return Promise.resolve();
      const parameters = {
        ...config.parameters,
        step: Math.min(20, Math.max(1, Number(config.parameters?.step ?? 5))),
      };
      const request = SYSTEM_ACTIONS.has(action)
        ? window.electronAPI.executeAction({ bubbleId: config.id, definitionId: config.definitionId, actionType: action as ActionType, parameters, keepOpen: true })
        : window.electronAPI.executeAction({ bubbleId: config.id, definitionId: config.definitionId, actionType: 'keyboard-shortcut', payload: action, parameters, keepOpen: true });
      return request.then(reportResult).catch((error) => {
        console.error('[Bubble] adjustment action failed:', error);
        onActionError('The adjustment service did not respond.');
      });
    }, [config.definitionId, config.id, config.parameters, config.scrollUpAction, config.scrollDownAction, onActionError, reportResult]);

    // Keep the dispatcher's callback current without recreating the dispatcher
    // (which would drop its queue) on every config change.
    dispatchCustomTickRef.current = dispatchCustomTick;

    useEffect(() => {
      const dispatcher = createWheelDispatcher((direction) => dispatchCustomTickRef.current(direction));
      wheelDispatcherRef.current = dispatcher;
      return () => {
        dispatcher.dispose();
        wheelDispatcherRef.current = null;
      };
    }, []);

    const handleWheel = useCallback((event: React.WheelEvent) => {
      if (config.type !== 'fill') return;
      event.preventDefault();
      event.stopPropagation();
      if (event.deltaY === 0) return; // Ignore zero-delta events instead of treating them as "down".
      const increasing = event.deltaY < 0;

      if (fillSource === 'volume' || fillSource === 'brightness') {
        performSystemAdjustment(increasing);
        return;
      }

      // Custom / app-adjustment fills: move the meter immediately for visible
      // feedback, then pace the backing keyboard actions through the bounded,
      // ordered dispatcher.
      const baseStep = Math.min(20, Math.max(1, Number(config.parameters?.step ?? 5))) / 100;
      const defaultLevel = isInfinite ? 0 : 0.5;
      const current = useOverlayStore.getState().bubbleFillLevels[config.id] ?? defaultLevel;
      // Infinite fills go through the production wheel-to-fill seam: one logical
      // update drives the counter, semantic frame, and animation controller.
      // Bounded fills retain their existing clamped path.
      const next = isInfinite
        ? applyInfiniteFillWheelTick(fillAnimationControllerRef.current, current, increasing, baseStep).nextLevel
        : resolveStoredLevel(current, increasing ? baseStep : -baseStep, false);
      setBubbleFillLevel(config.id, next);
      if (isInfinite) {
        lastLevelRef.current = next;
      }
      wheelDispatcherRef.current?.push(increasing ? 'up' : 'down');
    }, [config.type, config.id, config.parameters, fillSource, isInfinite, performSystemAdjustment, setBubbleFillLevel]);

    const classList = [styles.bubble];
    if (isVisible) classList.push(styles.bubbleVisible);
    if (isHovered) classList.push(styles.hovered);
    if (isToggleActive) classList.push(styles.active);
    if (config.type === 'fill') classList.push(styles.noStroke);
    if (config.type === 'menu') classList.push(styles.groupBubble);

    const labelClassList = [styles.label];
    if (labelMode === 'persistent') labelClassList.push(styles.labelPersistent);

    // Radial labels follow the outward edge defined by the bubble's position
    // angle. Main-ring hover labels use this automatically; persistent sub-ring
    // labels can opt into the exact same placement with labelSide="radial".
    const usesRadialLabelPlacement = labelMode === 'hover' || labelSide === 'radial';
    const resolvedLabelSide = usesRadialLabelPlacement
      ? computeRadialLabelSide(position)
      : labelSide;
    if (resolvedLabelSide === 'above') labelClassList.push(styles.labelSideAbove);
    else if (resolvedLabelSide === 'right') labelClassList.push(styles.labelSideRight);
    else if (resolvedLabelSide === 'left') labelClassList.push(styles.labelSideLeft);
    else labelClassList.push(styles.labelSideBelow);

    const baseIconColor = isToggleActive ? 'var(--ring-on-accent)' : 'var(--bubble-icon)';
    let displayLabel = config.label;
    if (config.actionType === 'volume-mute') displayLabel = isMuted ? 'Unmute' : 'Mute';
    else if (config.actionType === 'media-play-pause') displayLabel = isPlaying ? 'Pause' : 'Play';
    else if (isInfinite) displayLabel = netSteps === 0 ? config.label : `${config.label} ${netSteps > 0 ? '+' : ''}${netSteps}`;
    else if (
      showFillMeter
      && (fillSource !== 'custom' || config.parameters?.showNumericValue === true)
    ) displayLabel = `${config.label} ${fillPercent}%`;

    return (
      <div
        ref={ref}
        className={classList.join(' ')}
        style={{
          transitionDelay: isHovered ? '0ms' : `${delay}ms`,
          '--tx': `${tx}px`,
          '--ty': `${ty}px`,
          '--group-dot-angle': `${computeGroupDotAngle(position)}rad`,
          '--label-outward-y': `${usesRadialLabelPlacement ? computeRadialLabelOffsetY(position) : 0}px`,
        } as React.CSSProperties}
        onClick={handleClick}
        onWheel={handleWheel}
        data-bubble="true"
        role="button"
        tabIndex={isHovered ? 0 : -1}
        aria-label={displayLabel}
        aria-pressed={config.type === 'toggle' ? isToggleActive : undefined}
      >
        <div
          className={`${styles.bubbleSurface}${showFillMeter && !isInfinite ? ` ${styles.fillSurface}` : ''}${isInfinite ? ` ${styles.infiniteSurface}` : ''}${config.type === 'menu' ? ` ${styles.groupSurface}` : ''}`}
          style={showFillMeter && !isInfinite ? { '--fill-percent': `${fillPercent}%` } as React.CSSProperties : undefined}
        >
          {isInfinite && (
            <>
              <div ref={layerARef} className={`${styles.fillLayer} ${styles.fillLayerA}`} aria-hidden="true" />
              <div ref={layerBRef} className={`${styles.fillLayer} ${styles.fillLayerB}`} aria-hidden="true" />
            </>
          )}
          <span className={styles.icon}>
            {config.iconDataUrl ? (
              <img src={config.iconDataUrl} alt="" draggable={false} width={26} height={26} />
            ) : (
              <Icon size={24} color={baseIconColor} strokeWidth={2} />
            )}
            {showFillMeter && !isInfinite && !config.iconDataUrl && (
              <div className={styles.iconOverlayWrapper} style={{ height: `${fillPercent}%` }}>
                <div className={styles.iconOverlayInner}><Icon size={24} color="var(--bubble-icon)" strokeWidth={2} /></div>
              </div>
            )}
          </span>
        </div>

        {config.type === 'menu' && <span className={styles.groupDot} aria-hidden="true" />}

        <span className={labelClassList.join(' ')}>{displayLabel}</span>
      </div>
    );
  }
);

Bubble.displayName = 'Bubble';
