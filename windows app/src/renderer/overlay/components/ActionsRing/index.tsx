import React, { useRef, useEffect, useCallback } from 'react';
import { useOverlayStore } from '../../store/overlayStore';
import { useRingGeometry } from './useRingGeometry';
import { RingContainer } from './RingContainer';
import { Bubble } from './Bubble';
import { SubRing } from './SubRing';
import {
  BUBBLE_SIZE,
  HOVER_DEADZONE_RADIUS,
  EXIT_UNMOUNT_DELAY_MS,
  OUTSIDE_BUBBLE_DISMISS_PADDING,
  RING_SIZE_SCALE,
} from '../../../../shared/constants';
import type { BubbleConfig, BubblePosition } from '../../../../shared/types';
import ringStyles from './RingContainer.module.css';

const POINTER_GEOMETRY_EPSILON_PX = 0.01;

export function ActionsRing(): React.ReactElement | null {
  const isOpen = useOverlayStore((s) => s.isOpen);
  const hoveredIndex = useOverlayStore((s) => s.hoveredIndex);
  const bubbles = useOverlayStore((s) => s.bubbles);
  const ringSize = useOverlayStore((s) => s.ringSize);
  const accentColor = useOverlayStore((s) => s.accentColor);
  const accentFillColor = useOverlayStore((s) => s.accentFillColor);
  const accentForegroundColor = useOverlayStore((s) => s.accentForegroundColor);
  const closeRing = useOverlayStore((s) => s.closeRing);
  const setHoveredIndex = useOverlayStore((s) => s.setHoveredIndex);

  const positions = useRingGeometry(bubbles.length);
  const ringRef = useRef<HTMLDivElement>(null);
  const bubbleRefs = useRef<(HTMLDivElement | null)[]>([]);
  const actionInFlightRef = useRef(false);

  const [shouldRender, setShouldRender] = React.useState(false);
  const [isVisible, setIsVisible] = React.useState(false);
  const [isClosing, setIsClosing] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // Sub-ring state — purely local, transient UI
  const [subRingParent, setSubRingParent] = React.useState<BubbleConfig | null>(null);
  const [subRingParentPos, setSubRingParentPos] = React.useState<BubblePosition | null>(null);
  const [isSubRingVisible, setIsSubRingVisible] = React.useState(false);
  const [isSubRingClosing, setIsSubRingClosing] = React.useState(false);

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
  }, [isOpen, setHoveredIndex]);

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

    const ringCenterX = 200;
    const ringCenterY = 200;
    const mouse = { x: 0, y: 0, pending: false };
    let rafId = 0;

    function processHover(): void {
      mouse.pending = false;

      // Pointer events use scaled window pixels; geometry remains in 400px space.
      const scale = RING_SIZE_SCALE[ringSize];
      const dx = mouse.x / scale - ringCenterX;
      const dy = mouse.y / scale - ringCenterY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < HOVER_DEADZONE_RADIUS) {
        if (useOverlayStore.getState().hoveredIndex !== null) {
          setHoveredIndex(null);
        }
        return;
      }

      const cursorAngle = Math.atan2(dy, dx);

      let closestIndex = 0;
      let smallestAngleDiff = Infinity;

      for (let i = 0; i < positions.length; i++) {
        let diff = cursorAngle - positions[i].angle;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        const absDiff = Math.abs(diff);

        if (absDiff < smallestAngleDiff) {
          smallestAngleDiff = absDiff;
          closestIndex = i;
        }
      }

      if (closestIndex !== useOverlayStore.getState().hoveredIndex) {
        setHoveredIndex(closestIndex);
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
  }, [isVisible, isClosing, subRingParent, positions, ringSize, setHoveredIndex]);

  useEffect(() => {
    if (!isOpen || isClosing) return;

    function handleOutsideMouseDown(e: MouseEvent): void {
      if (e.button !== 0) return;

      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('[data-ring-control="true"]')) return;

      const visibleBubbles = document.querySelectorAll<HTMLElement>('[data-bubble="true"]');
      const bubbleRadius = (BUBBLE_SIZE * RING_SIZE_SCALE[ringSize]) / 2;
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
  }, [isOpen, isClosing, closeRing, ringSize]);

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
  const handleSelect = useCallback(
    async (config: BubbleConfig) => {
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

      if (actionInFlightRef.current) return;
      actionInFlightRef.current = true;
      try {
        const result = await window.electronAPI.executeAction({
          bubbleId: config.id,
          actionType: config.actionType,
          payload: config.payload,
          parameters: config.parameters,
        });
        if (!result.success) {
          setActionError(result.message ?? result.error ?? 'This action could not be completed.');
          return;
        }
        closeRing();
        window.electronAPI.closeOverlay();
      } catch (err) {
        console.error('[ActionsRing] executeAction failed:', err);
        setActionError('The action service did not respond.');
      } finally {
        actionInFlightRef.current = false;
      }
    },
    [closeRing, isClosing, bubbles, positions]
  );

  // Sub-bubble selected — execute action and close overlay
  const handleSubSelect = useCallback(
    async (config: BubbleConfig) => {
      if (isClosing || isSubRingClosing) return;
      if (actionInFlightRef.current) return;
      actionInFlightRef.current = true;

      try {
        const result = await window.electronAPI.executeAction({
          bubbleId: config.id,
          actionType: config.actionType,
          payload: config.payload,
          parameters: config.parameters,
        });
        if (!result.success) {
          setActionError(result.message ?? result.error ?? 'This action could not be completed.');
          return;
        }
        setSubRingParent(null);
        setSubRingParentPos(null);
        setIsSubRingVisible(false);
        closeRing();
        window.electronAPI.closeOverlay();
      } catch (err) {
        console.error('[ActionsRing] sub-bubble executeAction failed:', err);
        setActionError('The action service did not respond.');
      } finally {
        actionInFlightRef.current = false;
      }
    },
    [closeRing, isClosing, isSubRingClosing]
  );

  // Sub-ring back button — animate out, restore main ring
  const handleSubRingBack = useCallback(() => {
    if (isSubRingClosing) return;
    setIsSubRingClosing(true);
    setIsSubRingVisible(false);
    setTimeout(() => {
      setSubRingParent(null);
      setSubRingParentPos(null);
      setIsSubRingClosing(false);
    }, EXIT_UNMOUNT_DELAY_MS);
  }, [isSubRingClosing]);

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
      accentColor={accentColor}
      accentFillColor={accentFillColor}
      accentForegroundColor={accentForegroundColor}
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
          stroke="var(--ring-on-surface)"
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
