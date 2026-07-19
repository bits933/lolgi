import { describe, expect, it } from 'vitest';
import {
  getOverlayWindowSize,
  OVERLAY_STAGE_SIZE,
  OVERLAY_WINDOW_SIZE,
  RING_LABEL_SAFE_PADDING,
  RING_SIZE,
} from './constants';

describe('overlay label-safe sizing', () => {
  it('reserves symmetric room for outward labels at every ring scale', () => {
    expect(OVERLAY_STAGE_SIZE).toBe(RING_SIZE + RING_LABEL_SAFE_PADDING * 2);
    expect(OVERLAY_WINDOW_SIZE).toBe(OVERLAY_STAGE_SIZE);
    expect(getOverlayWindowSize('small')).toBe(Math.round(OVERLAY_STAGE_SIZE * 0.8));
    expect(getOverlayWindowSize('medium')).toBe(OVERLAY_STAGE_SIZE);
    expect(getOverlayWindowSize('large')).toBe(Math.round(OVERLAY_STAGE_SIZE * 1.2));
  });
});
