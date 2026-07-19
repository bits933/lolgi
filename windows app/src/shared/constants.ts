// ---------------------------------------------------------------------------
// Ring Geometry — must match web app values exactly
// ---------------------------------------------------------------------------

/** Ring container width and height in pixels */
export const RING_SIZE = 400;

/**
 * Unscaled transparent margin reserved around the ring for outward text pills.
 * A wrapped 180px label beside the left/right bubble fits inside this margin.
 */
export const RING_LABEL_SAFE_PADDING = 152;

/** Ring plus the label-safe margin on every side. */
export const OVERLAY_STAGE_SIZE = RING_SIZE + RING_LABEL_SAFE_PADDING * 2;

/** Distance from ring center to bubble center in pixels */
export const BUBBLE_RADIUS = 120;

/** Bubble diameter in pixels */
export const BUBBLE_SIZE = 56;

/** Half of RING_SIZE — used for clamping and centering */
export const RING_HALF = RING_SIZE / 2; // 200

/** Inner circle button diameter in pixels */
export const INNER_CIRCLE_SIZE = 48;

/**
 * Maximum number of bubbles allowed in the ring.
 * Used for validation only — geometry calculations use the actual bubble count,
 * not this constant, so the ring always distributes evenly regardless of how
 * many bubbles are active.
 */
export const MAX_BUBBLE_COUNT = 12;

/** Dead-zone radius around ring center — no bubble selected within this distance */
export const HOVER_DEADZONE_RADIUS = 40;

/** Distance from parent bubble center to child bubble center in the sub-ring arc (F4.1) */
export const SUB_RING_ARC_RADIUS = 124;

/** Base angular spacing between adjacent sub-ring children, in degrees */
export const SUB_RING_ARC_BASE_STEP_DEG = 42;

/** Maximum total angular span of the sub-ring arc, in degrees (children compress to fit) */
export const SUB_RING_ARC_MAX_SPAN_DEG = 240;

/** Maximum number of child actions a folder bubble can hold (PRD F4.1: 9 sub-bubbles) */
// Dashboard V3 product decision: submenus hold at most 5 actions (overrides PRD F4.1's 9).
export const MAX_FOLDER_CHILDREN = 5;

/** Extra clickable space around each visible bubble before an outside click dismisses the ring. */
export const OUTSIDE_BUBBLE_DISMISS_PADDING = 30;

// ---------------------------------------------------------------------------
// Animation Timing — mirrors animation_timing_validated memory
// ---------------------------------------------------------------------------

/** Entrance animation duration in ms */
export const ENTRANCE_DURATION_MS = 350;

/** Per-bubble stagger delay for entrance in ms */
export const ENTRANCE_STAGGER_MS = 40;

/** Exit animation duration in ms */
export const EXIT_DURATION_MS = 250;

/** Per-bubble stagger delay for exit in ms */
export const EXIT_STAGGER_MS = 20;

/** Total time to wait before unmounting after close (exit duration + max stagger) */
export const EXIT_UNMOUNT_DELAY_MS = 400;

// ---------------------------------------------------------------------------
// Ring Size Presets
// ---------------------------------------------------------------------------

import type { RingSize, ThemeConfig } from './types';

/** The default ring size used by new and existing configurations. */
export const DEFAULT_RING_SIZE: RingSize = 'medium';

// ---------------------------------------------------------------------------
// Theme Defaults
// ---------------------------------------------------------------------------

/** Brand accent color used by the Light and Dark theme presets. */
export const DEFAULT_ACCENT_COLOR = '#7b68ee';

/** Accessible fill used by filled controls in the non-custom themes. */
export const DEFAULT_ACCENT_FILL_COLOR = '#6350d8';

/** Default background color for the ring's action bubbles (the classic dark slate). */
export const DEFAULT_BUBBLE_COLOR = '#1e2128';

/** The default theme used by new and existing configurations. Follows the OS light/dark preference. */
export const DEFAULT_THEME: ThemeConfig = {
  mode: 'system',
  accentColor: DEFAULT_ACCENT_COLOR,
  bubbleColor: DEFAULT_BUBBLE_COLOR,
};

/** Visual scale for each PRD-defined ring-size preset. */
export const RING_SIZE_SCALE: Record<RingSize, number> = {
  small: 0.8,
  medium: 1,
  large: 1.2,
};

/**
 * Action-bubble diameters before the ring preset scale is applied. Medium gets
 * a slightly roomier target without changing the centre close control.
 */
export const ACTION_BUBBLE_SIZE: Record<RingSize, number> = {
  small: BUBBLE_SIZE,
  medium: 60,
  large: BUBBLE_SIZE,
};

/** Returns the unscaled action-bubble diameter for a ring-size preset. */
export function getActionBubbleSize(ringSize: RingSize): number {
  return ACTION_BUBBLE_SIZE[ringSize];
}

/** Returns the transparent overlay size required for a ring-size preset. */
export function getOverlayWindowSize(ringSize: RingSize): number {
  return Math.round(OVERLAY_STAGE_SIZE * RING_SIZE_SCALE[ringSize]);
}

// ---------------------------------------------------------------------------
// Window Dimensions
// ---------------------------------------------------------------------------

/** Default overlay window size (the medium ring). */
export const OVERLAY_WINDOW_SIZE = OVERLAY_STAGE_SIZE;

/** Dashboard window width */
export const DASHBOARD_WIDTH = 1280;

/** Dashboard window height */
export const DASHBOARD_HEIGHT = 760;

// ---------------------------------------------------------------------------
// Default Hotkey
// ---------------------------------------------------------------------------

export const DEFAULT_HOTKEY = 'Ctrl+Shift+Space';

// ---------------------------------------------------------------------------
// Electron-store key
// ---------------------------------------------------------------------------

export const CONFIG_STORE_KEY = 'config';
