import React, { useRef, useEffect, useCallback } from 'react';
import { useOverlayStore } from '../../store/overlayStore';
import { useRingGeometry } from './useRingGeometry';
import { RingContainer } from './RingContainer';
import { Bubble } from './Bubble';
import { SubRing } from './SubRing';
import {
  getActionBubbleSize,
  EXIT_UNMOUNT_DELAY_MS,
  OUTSIDE_BUBBLE_DISMISS_PADDING,
  RING_SIZE_SCALE,
} from '../../../../shared/constants';
import type { BubbleConfig, BubblePosition } from '../../../../shared/types';
import ringStyles from './RingContainer.module.css';
import {
  ACTION_PENDING_MESSAGE,
  observeActionExecution,
  type ActionExecutionController,
  type ActionTerminalOutcome,
} from './actionExecutionObserver';
import { resolveMainRingHover } from './hoverGeometry';

const POINTER_GEOMETRY_EPSILON_PX = 0.01;

// Mode B ("hold and release") release-point hit test: mirrors the pointer-events/
// opacity interactivity check handleOutsideMouseDown uses below.
function isInteractiveBubbleElement(element: Element): boolean {
  const style = window.getComputedStyle(element);
  return style.pointerEvents !== 'none' && Number(style.opacity) >= 0.1;
}

export function ActionsRing(): React.ReactElement | null {
  const isOpen = useOverlayStore((s) => s.isOpen);
  const triggerMode = useOverlayStore((s) => s.triggerMode);
  const hoveredIndex = useOverlayStore((s) => s.hoveredIndex);
  const bubbles = useOverlayStore((s) => s.bubbles);
  const ringSize = useOverlayStore((s) => s.ringSize);
  const labelSize = useOverlayStore((s) => s.labelSize);
  const accentColor = useOverlayStore((s) => s.accentColor);
  const accentFillColor = useOverlayStore((s) => s.accentFillColor);
  const accentForegroundColor = useOverlayStore((s) => s.accentForegroundColor);
  const bubbleSurface = useOverlayStore((s) => s.bubbleSurface);
  const closeRing = useOverlayStore((s) => s.closeRing);
  const setHoveredIndex = useOverlayStore((s) => s.setHoveredIndex);

  const positions = useRingGeometry(bubbles.length);
  const ringRef = useRef<HTMLDivElement>(null);
  const bubbleRefs = useRef<(HTMLDivElement | null)[]>([]);
  const pressBubbleElRef = useRef<HTMLElement | null>(null);
  const actionInFlightRef = useRef(false);
  const activeActionExecutionRef = useRef<ActionExecutionController | null>(null);

  const [shouldRender, setShouldRender] = React.useState(false);
  const [isVisible, setIsVisible] = React.useState(false);
  const [isClosing, setIsClosing] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // Sub-ring state — purely local, transient UI
  const [subRingParent, setSubRingParent] = React.useState<BubbleConfig | null>(null);
  const [subRingParentPos, setSubRingParentPos] = React.useState<BubblePosition | null>(null);
  const [isSubRingVisible, setIsSubRingVisible] = React.useState(false);
  const [isSubRingClosing, setIsSubRingClosing] = React.useState(false);
  const subRingBackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSubRingBackTimer = useCallback(() => {
    if (subRingBackTimerRef.current === null) return;
    clearTimeout(subRingBackTimerRef.current);
    subRingBackTimerRef.current = null;
  }, []);

  const cancelActiveActionExecution = useCallback(() => {
    activeActionExecutionRef.current?.cancel();
    activeActionExecutionRef.current = null;
    actionInFlightRef.current = false;
  }, []);

  useEffect(() => {
    if (!isOpen) cancelActiveActionExecution();
  }, [isOpen, cancelActiveActionExecution]);

  useEffect(
    () => () => {
      cancelActiveActionExecution();
      clearSubRingBackTimer();
    },
    [cancelActiveActionExecution, clearSubRingBackTimer]
  );

  // ---------------------------------------------------------------------------
  // Entrance / Exit state machine
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
      setActionError(null);
      setHoveredIndex(0);
      let raf1 = 0;
      let raf2 = 0;
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setIsVisible(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    } else {
      // Force-clear sub-ring immediately — window is hiding, no exit animation needed
      clearSubRingBackTimer();
      setSubRingParent(null);
      setSubRingParentPos(null);
      setIsSubRingVisible(false);
      setIsSubRingClosing(false);

      setIsVisible(false);
      setIsClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
        window.electronAPI.notifyAnimationComplete();
      }, EXIT_UNMOUNT_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [clearSubRingBackTimer, isOpen, setHoveredIndex]);

  useEffect(() => {
    if (!subRingParent) {
      setIsSubRingVisible(false);
      return;
    }
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setIsSubRingVisible(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [subRingParent]);

  // A new ring session replaces the main bubble array even when the overlay
  // was already open. Cancel an old folder's exit callback before it can
  // mutate the replacement session.
  useEffect(() => {
    clearSubRingBackTimer();
    setSubRingParent(null);
    setSubRingParentPos(null);
    setIsSubRingVisible(false);
    setIsSubRingClosing(false);
  }, [bubbles, clearSubRingBackTimer]);

  useEffect(() => {
    if (!actionError) return;
    const timer = setTimeout(() => setActionError(null), 3200);
    return () => clearTimeout(timer);
  }, [actionError]);

  useEffect(() => {
    if (hoveredIndex === null || subRingParent) return;
    bubbleRefs.current[hoveredIndex]?.focus({ preventScroll: true });
  }, [hoveredIndex, subRingParent]);

  // ---------------------------------------------------------------------------
  // Hover detection — paused when sub-ring is open (SubRing handles its own)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isVisible || isClosing || subRingParent) {
      setHoveredIndex(null);
      return;
    }

    const mouse = { x: 0, y: 0, pending: false };
    let rafId = 0;

    function processHover(): void {
      mouse.pending = false;

      const ring = ringRef.current;
      const nextHoveredIndex = ring
        ? resolveMainRingHover(mouse, ring.getBoundingClientRect(), positions)
        : null;
      if (nextHoveredIndex !== useOverlayStore.getState().hoveredIndex) {
        setHoveredIndex(nextHoveredIndex);
      }
    }

    function handleMouseMove(e: MouseEvent): void {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      if (mouse.pending) return;
      mouse.pending = true;
      rafId = requestAnimationFrame(processHover);
    }

    document.addEventListener('mousemove', handleMouseMove);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(rafId);
      setHoveredIndex(null);
    };
  }, [isVisible, isClosing, subRingParent, positions, setHoveredIndex]);

  useEffect(() => {
    // Mode B handles its own press/release dismissal below — a mousedown-based
    // dismiss here would close the ring the instant the user presses down.
    if (!isOpen || isClosing || triggerMode === 'B') return;

    function handleOutsideMouseDown(e: MouseEvent): void {
      if (e.button !== 0) return;

      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('[data-ring-control="true"]')) return;

      const visibleBubbles = document.querySelectorAll<HTMLElement>('[data-bubble="true"]');
      const bubbleRadius = (getActionBubbleSize(ringSize) * RING_SIZE_SCALE[ringSize]) / 2;
      const isNearBubble = Array.from(visibleBubbles).some((bubble) => {
        const computedStyle = window.getComputedStyle(bubble);
        if (computedStyle.pointerEvents === 'none' || Number(computedStyle.opacity) < 0.1) {
          return false;
        }

        const bounds = bubble.getBoundingClientRect();
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;
        return Math.hypot(e.clientX - centerX, e.clientY - centerY)
          <= bubbleRadius + OUTSIDE_BUBBLE_DISMISS_PADDING + POINTER_GEOMETRY_EPSILON_PX;
      });
      if (isNearBubble) return;

      setSubRingParent(null);
      setSubRingParentPos(null);
      setIsSubRingVisible(false);
      setIsSubRingClosing(false);
      closeRing();
      window.electronAPI.closeOverlay();
    }

    document.addEventListener('mousedown', handleOutsideMouseDown, true);
    return () => document.removeEventListener('mousedown', handleOutsideMouseDown, true);
  }, [isOpen, isClosing, triggerMode, closeRing, ringSize]);

  // ---------------------------------------------------------------------------
  // Mode B ("hold and release"): the user may press down on empty space, the
  // center button's surroundings, or a bubble, then drag and release over a
  // (possibly different) bubble to select it. Release outside any bubble/control
  // dismisses the ring, mirroring handleOutsideMouseDown's dismiss above.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isOpen || isClosing || triggerMode !== 'B') return;

    // Reset at attach time so a stray mouseup can't reference a stale bubble
    // from a previous ring session.
    pressBubbleElRef.current = null;

    function handlePressTrack(e: MouseEvent): void {
      if (e.button !== 0) return;
      const target = e.target instanceof Element ? e.target : null;
      pressBubbleElRef.current = (target?.closest('[data-bubble="true"]') as HTMLElement | null) ?? null;
    }

    function handleReleaseSelect(e: MouseEvent): void {
      if (e.button !== 0) return;

      const atPoint = document.elementFromPoint(e.clientX, e.clientY);
      const releaseBubbleEl = atPoint?.closest('[data-bubble="true"]') as HTMLElement | null;

      if (releaseBubbleEl && isInteractiveBubbleElement(releaseBubbleEl)) {
        // Same-element press+release already fires a native click — synthesizing
        // one here would double-fire the action.
        if (releaseBubbleEl !== pressBubbleElRef.current) releaseBubbleEl.click();
        return;
      }

      if (atPoint?.closest('[data-ring-control="true"]')) return;

      setSubRingParent(null);
      setSubRingParentPos(null);
      setIsSubRingVisible(false);
      setIsSubRingClosing(false);
      closeRing();
      window.electronAPI.closeOverlay();
    }

    document.addEventListener('mousedown', handlePressTrack, true);
    document.addEventListener('mouseup', handleReleaseSelect, true);
    return () => {
      document.removeEventListener('mousedown', handlePressTrack, true);
      document.removeEventListener('mouseup', handleReleaseSelect, true);
    };
  }, [isOpen, isClosing, triggerMode, closeRing]);

  // ---------------------------------------------------------------------------
  // Right-click dismisses the ring. Keyboard navigation is registered below
  // after the selection callbacks are available.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isOpen) return;

    function handleContextMenu(e: MouseEvent): void {
      e.preventDefault();
      if (isClosing) return;
      setSubRingParent(null);
      setSubRingParentPos(null);
      setIsSubRingVisible(false);
      setIsSubRingClosing(false);
      closeRing();
      window.electronAPI.closeOverlay();
    }

    window.addEventListener('contextmenu', handleContextMenu);
    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [isOpen, closeRing, isClosing]);

  // ---------------------------------------------------------------------------
  // Selection handler
  // ---------------------------------------------------------------------------
  const executeBubbleAction = useCallback(
    (config: BubbleConfig, fromSubRing: boolean) => {
      if (actionInFlightRef.current) return;

      // A previous invocation can only remain here after the user explicitly
      // dismissed/reopened the ring; its IPC promise is still safely consumed.
      activeActionExecutionRef.current?.cancel();
      actionInFlightRef.current = true;

      let controller: ActionExecutionController;
      controller = observeActionExecution(
        () =>
          window.electronAPI.executeAction({
            bubbleId: config.id,
            definitionId: config.definitionId,
            actionType: config.actionType,
            payload: config.payload,
            parameters: config.parameters,
          }),
        {
          onPending: () => {
            setActionError(ACTION_PENDING_MESSAGE);
          },
          onRelease: (reason) => {
            // An unknown, timed-out outcome must not allow a second action to be
            // launched on top of one that may still complete. The ring itself
            // remains dismissible; closing it cancels this UI observer.
            if (
              reason === 'settled' &&
              activeActionExecutionRef.current === controller
            ) {
              actionInFlightRef.current = false;
            }
          },
          onSuccess: () => {
            // Closing is justified only by an explicit successful ActionResult,
            // including a success that arrives after the pending threshold.
            if (fromSubRing) {
              setSubRingParent(null);
              setSubRingParentPos(null);
              setIsSubRingVisible(false);
            }
            closeRing();
            window.electronAPI.closeOverlay();
          },
          onFailure: (message: string, outcome: ActionTerminalOutcome) => {
            if (outcome.kind === 'rejection') {
              console.error('[ActionsRing] executeAction failed:', outcome.error);
            }
            setActionError(message);
          },
          onObserverError: (error) => {
            console.error('[ActionsRing] action observer callback failed:', error);
            setActionError('The action result could not be displayed. The ring has stayed open.');
          },
        }
      );

      activeActionExecutionRef.current = controller;
      void controller.completion.then(() => {
        if (activeActionExecutionRef.current === controller) {
          activeActionExecutionRef.current = null;
          actionInFlightRef.current = false;
        }
      });
    },
    [closeRing]
  );

  const handleSelect = useCallback(
    (config: BubbleConfig) => {
      if (isClosing) return;

      if (config.type === 'menu') {
        if (!config.children?.length) {
          setActionError(`${config.label || 'This submenu'} has no actions yet.`);
          return;
        }
        const i = bubbles.findIndex((b) => b.id === config.id);
        if (i === -1) return;
        setSubRingParent(config);
        setSubRingParentPos(positions[i]);
        return;
      }

      executeBubbleAction(config, false);
    },
    [isClosing, bubbles, positions, executeBubbleAction]
  );

  // Sub-bubble selected — execute action and close overlay
  const handleSubSelect = useCallback(
    (config: BubbleConfig) => {
      if (isClosing || isSubRingClosing) return;
      executeBubbleAction(config, true);
    },
    [isClosing, isSubRingClosing, executeBubbleAction]
  );

  // Sub-ring back button — animate out, restore main ring
  const handleSubRingBack = useCallback(() => {
    if (isSubRingClosing) return;
    clearSubRingBackTimer();
    setIsSubRingClosing(true);
    setIsSubRingVisible(false);
    subRingBackTimerRef.current = setTimeout(() => {
      subRingBackTimerRef.current = null;
      setSubRingParent(null);
      setSubRingParentPos(null);
      setIsSubRingClosing(false);
    }, EXIT_UNMOUNT_DELAY_MS);
  }, [clearSubRingBackTimer, isSubRingClosing]);

  // Center button — always closes the whole ring. While a folder is expanded the
  // parent anchor (rendered by SubRing) is the "back" affordance, and the center
  // button is hidden so it never collides with children fanning toward the center.
  const handleCenterClose = useCallback(() => {
    if (isClosing) return;
    closeRing();
    window.electronAPI.closeOverlay();
  }, [closeRing, isClosing]);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.code === 'Escape') {
        event.preventDefault();
        if (subRingParent) {
          handleSubRingBack();
        } else {
          closeRing();
          window.electronAPI.closeOverlay();
        }
        return;
      }

      if (subRingParent || bubbles.length === 0) return;
      const current = useOverlayStore.getState().hoveredIndex ?? 0;
      if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
        setHoveredIndex((current + direction + bubbles.length) % bubbles.length);
        return;
      }

      if (/^[1-9]$/.test(event.key)) {
        const index = Number(event.key) - 1;
        if (index < bubbles.length) {
          event.preventDefault();
          setHoveredIndex(index);
        }
        return;
      }

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        bubbleRefs.current[useOverlayStore.getState().hoveredIndex ?? 0]?.click();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [bubbles, closeRing, handleSubRingBack, isOpen, setHoveredIndex, subRingParent]);

  if (!shouldRender || bubbles.length === 0) return null;

  const subRingOpen = !!subRingParent;

  return (
    <RingContainer
      ref={ringRef}
      ringSize={ringSize}
      labelSize={labelSize}
      accentColor={accentColor}
      accentFillColor={accentFillColor}
      accentForegroundColor={accentForegroundColor}
      bubbleSurface={bubbleSurface}
    >
      {/* Center close button — hidden while a folder is expanded */}
      <button
        type="button"
        className={`${ringStyles.centerBtn}${isVisible && !subRingOpen ? ` ${ringStyles.centerBtnVisible}` : ''}`}
        style={{ pointerEvents: isVisible && !subRingOpen ? 'auto' : 'none' }}
        onClick={handleCenterClose}
        role="button"
        tabIndex={subRingOpen ? -1 : 0}
        data-ring-control="true"
        aria-hidden={subRingOpen}
        aria-label="Close actions ring"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          stroke="var(--bubble-icon)"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <line x1="4" y1="4" x2="14" y2="14" />
          <line x1="14" y1="4" x2="4" y2="14" />
        </svg>
      </button>

      {/* Main ring bubbles — collapse when sub-ring opens */}
      {bubbles.map((config, i) => (
        <Bubble
          key={config.id}
          ref={(el) => {
            bubbleRefs.current[i] = el;
          }}
          config={config}
          position={positions[i] ?? positions[0]}
          isHovered={!subRingOpen && hoveredIndex === i}
          onSelect={handleSelect}
          onActionError={setActionError}
          isVisible={isVisible && !subRingOpen}
          index={i}
          total={bubbles.length}
          isClosing={isClosing || subRingOpen}
        />
      ))}

      {/* Sub-ring — rendered when a menu bubble was clicked */}
      {subRingParent && subRingParentPos && (
        <SubRing
          parent={subRingParent}
          parentPosition={subRingParentPos}
          ringSize={ringSize}
          isVisible={isSubRingVisible}
          isClosing={isSubRingClosing}
          ringRef={ringRef}
          onBack={handleSubRingBack}
          onSelect={handleSubSelect}
          onActionError={setActionError}
        />
      )}

      {actionError && (
        <div className={ringStyles.actionError} role="status" aria-live="polite">
          {actionError}
        </div>
      )}
    </RingContainer>
  );
}
