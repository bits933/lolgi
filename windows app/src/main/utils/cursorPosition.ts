import { screen } from 'electron';

export interface CursorPoint {
  x: number;
  y: number;
}

/**
 * Returns the current cursor position in screen coordinates.
 * Uses Electron's screen.getCursorScreenPoint() which works correctly
 * across multiple monitors with different DPI scaling.
 */
export function getCursorPosition(): CursorPoint {
  return screen.getCursorScreenPoint();
}

/**
 * Given a cursor position in screen coordinates, returns the top-left
 * corner for the overlay window such that the ring center aligns with
 * the cursor, clamped within the display's work area.
 */
export function getOverlayOrigin(
  cursorX: number,
  cursorY: number,
  overlaySize: number
): CursorPoint {
  const display = screen.getDisplayNearestPoint({ x: cursorX, y: cursorY });
  const { x: wa_x, y: wa_y, width: wa_w, height: wa_h } = display.workArea;

  const half = overlaySize / 2;

  const left = Math.max(wa_x, Math.min(cursorX - half, wa_x + wa_w - overlaySize));
  const top = Math.max(wa_y, Math.min(cursorY - half, wa_y + wa_h - overlaySize));

  return { x: left, y: top };
}
