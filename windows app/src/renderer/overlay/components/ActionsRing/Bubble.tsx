import React, { forwardRef, useCallback, useEffect, useRef } from 'react';
import * as LucideIcons from 'lucide-react';
import type { ActionType, BubbleConfig, BubblePosition } from '../../../../shared/types';
import { computeGroupDotAngle } from '../../../../shared/ringGeometry';
import { useOverlayStore } from '../../store/overlayStore';
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
  /** Where a persistent label sits relative to the bubble. Ignored in hover mode. */
  labelSide?: 'left' | 'right' | 'below';
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

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export const Bubble = forwardRef<HTMLDivElement, BubbleProps>(
  ({ config, position, isHovered, onSelect, onActionError, isVisible, index, total, isClosing, labelMode = 'hover', labelSide = 'below' }, ref) => {
    const fillSource = getFillSource(config);
    const volumeLevel = useOverlayStore((state) => fillSource === 'volume' ? state.systemState.volumeLevel : 0);
    const brightnessLevel = useOverlayStore((state) => fillSource === 'brightness' ? state.systemState.brightnessLevel : 0);
    const isMuted = useOverlayStore((state) => config.actionType === 'volume-mute' ? state.systemState.isMuted : false);
    const isPlaying = useOverlayStore((state) => config.actionType === 'media-play-pause' ? state.systemState.isPlaying : false);
    const updateSystemState = useOverlayStore((state) => state.updateSystemState);
    const customFillLevel = useOverlayStore((state) => state.bubbleFillLevels[config.id] ?? 0.5);
    const setBubbleFillLevel = useOverlayStore((state) => state.setBubbleFillLevel);
    const clickInFlightRef = useRef(false);
    const systemAdjustmentFrameRef = useRef<number | null>(null);
    const pendingSystemAdjustmentRef = useRef<SystemAdjustmentRequest | null>(null);
    const isToggleActive =
      (config.type === 'toggle' && config.actionType === 'volume-mute' && isMuted) ||
      (config.type === 'toggle' && config.actionType === 'media-play-pause' && isPlaying);
    const fillLevel = config.type !== 'fill'
      ? 0
      : fillSource === 'volume'
        ? volumeLevel
          : fillSource === 'brightness'
          ? brightnessLevel
          : customFillLevel;
    const fillPercent = Math.round(fillLevel * 100);
    const Icon = resolveIcon(isToggleActive && config.iconNameAlt ? config.iconNameAlt : config.iconName);
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
        const clickAction = String(config.parameters?.clickAction ?? 'do-nothing');
        if (!clickAction || clickAction === 'do-nothing') return;
        clickInFlightRef.current = true;
        try {
          reportResult(await window.electronAPI.executeAction({
            bubbleId: config.id,
            actionType: clickAction as ActionType,
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
        actionType: request.action,
        parameters: request.parameters,
        keepOpen: true,
      }).then(reportResult).catch((error) => {
        console.error('[Bubble] adjustment action failed:', error);
        onActionError('The adjustment service did not respond.');
      });
    }, [config.id, onActionError, reportResult]);

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

    const performAdjustment = useCallback((increasing: boolean, multiplier = 1) => {
      if (config.type !== 'fill') return;
      const baseStep = Math.min(20, Math.max(1, Number(config.parameters?.step ?? 5))) / 100;
      const signedStep = (increasing ? baseStep : -baseStep) * multiplier;
      let targetLevel: number | undefined;

      if (fillSource === 'volume') {
        targetLevel = clamp(useOverlayStore.getState().systemState.volumeLevel + signedStep);
        updateSystemState({ volumeLevel: targetLevel });
      } else if (fillSource === 'brightness') {
        targetLevel = clamp(useOverlayStore.getState().systemState.brightnessLevel + signedStep);
        updateSystemState({ brightnessLevel: targetLevel });
      } else {
        const current = useOverlayStore.getState().bubbleFillLevels[config.id] ?? 0.5;
        setBubbleFillLevel(config.id, clamp(current + signedStep));
      }

      const action = increasing ? config.scrollUpAction : config.scrollDownAction;
      if (!action) return;
      const parameters = {
        ...config.parameters,
        step: Math.min(20, Math.max(1, Number(config.parameters?.step ?? 5))) * multiplier,
        ...(targetLevel === undefined ? {} : { targetLevel }),
      };

      if (targetLevel !== undefined) {
        pendingSystemAdjustmentRef.current = {
          action: action as ActionType,
          parameters,
        };
        if (systemAdjustmentFrameRef.current === null) {
          systemAdjustmentFrameRef.current = requestAnimationFrame(() => {
            systemAdjustmentFrameRef.current = null;
            flushSystemAdjustment();
          });
        }
        return;
      }

      const repeats = targetLevel === undefined ? multiplier : 1;

      for (let repeat = 0; repeat < repeats; repeat += 1) {
        const request = SYSTEM_ACTIONS.has(action)
          ? window.electronAPI.executeAction({
              bubbleId: config.id,
              actionType: action as ActionType,
              parameters,
              keepOpen: true,
            })
          : window.electronAPI.executeAction({
              bubbleId: config.id,
              actionType: 'keyboard-shortcut',
              payload: action,
              parameters,
              keepOpen: true,
            });
        void request.then(reportResult).catch((error) => {
          console.error('[Bubble] adjustment action failed:', error);
          onActionError('The adjustment service did not respond.');
        });
      }
    }, [config, fillSource, flushSystemAdjustment, onActionError, reportResult, setBubbleFillLevel, updateSystemState]);

    const handleWheel = useCallback((event: React.WheelEvent) => {
      if (config.type !== 'fill') return;
      event.preventDefault();
      event.stopPropagation();
      performAdjustment(event.deltaY < 0);
    }, [config.type, performAdjustment]);

    const classList = [styles.bubble];
    if (isVisible) classList.push(styles.bubbleVisible);
    if (isHovered) classList.push(styles.hovered);
    if (isToggleActive) classList.push(styles.active);
    if (config.type === 'fill') classList.push(styles.noStroke);
    if (config.type === 'menu') classList.push(styles.groupBubble);

    const labelClassList = [styles.label];
    if (labelMode === 'persistent') {
      labelClassList.push(styles.labelPersistent);
      if (labelSide === 'right') labelClassList.push(styles.labelSideRight);
      else if (labelSide === 'left') labelClassList.push(styles.labelSideLeft);
    }

    const baseIconColor = isToggleActive ? 'var(--ring-on-accent)' : 'var(--bubble-icon)';
    let displayLabel = config.label;
    if (config.actionType === 'volume-mute') displayLabel = isMuted ? 'Unmute' : 'Mute';
    else if (config.actionType === 'media-play-pause') displayLabel = isPlaying ? 'Pause' : 'Play';
    else if (config.type === 'fill') displayLabel = `${config.label} ${fillPercent}%`;

    return (
      <div
        ref={ref}
        className={classList.join(' ')}
        style={{
          transitionDelay: isHovered ? '0ms' : `${delay}ms`,
          '--tx': `${tx}px`,
          '--ty': `${ty}px`,
          '--group-dot-angle': `${computeGroupDotAngle(position)}rad`,
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
          className={`${styles.bubbleSurface}${config.type === 'fill' ? ` ${styles.fillSurface}` : ''}${config.type === 'menu' ? ` ${styles.groupSurface}` : ''}`}
          style={config.type === 'fill' ? { '--fill-percent': `${fillPercent}%` } as React.CSSProperties : undefined}
        >
          <span className={styles.icon}>
            {config.iconDataUrl ? (
              <img src={config.iconDataUrl} alt="" draggable={false} width={26} height={26} />
            ) : (
              <Icon size={24} color={baseIconColor} strokeWidth={2} />
            )}
            {config.type === 'fill' && !config.iconDataUrl && (
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
