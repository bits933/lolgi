import { create } from 'zustand';
import type { OverlayStore, RingOpenPayload, SystemState } from '../../../shared/types';
import { DEFAULT_ACCENT_COLOR, DEFAULT_ACCENT_FILL_COLOR, DEFAULT_BUBBLE_COLOR, DEFAULT_LABEL_SIZE, DEFAULT_RING_SIZE } from '../../../shared/constants';
import { resolveBubbleSurface } from '../../../shared/themeColors';

const DEFAULT_SYSTEM_STATE: SystemState = {
  volumeLevel: 0.5,
  isMuted: false,
  brightnessLevel: 0.5,
  isPlaying: false,
};

export const useOverlayStore = create<OverlayStore>((set) => ({
  isOpen: false,
  hoveredIndex: null,
  bubbles: [],
  systemState: DEFAULT_SYSTEM_STATE,
  triggerMode: 'A',
  ringSize: DEFAULT_RING_SIZE,
  labelSize: DEFAULT_LABEL_SIZE,
  accentColor: DEFAULT_ACCENT_COLOR,
  accentFillColor: DEFAULT_ACCENT_FILL_COLOR,
  accentForegroundColor: '#ffffff',
  bubbleSurface: resolveBubbleSurface(DEFAULT_BUBBLE_COLOR),
  bubbleFillLevels: {},

  openRing: (payload: RingOpenPayload) =>
    set({
      isOpen: true,
      hoveredIndex: null,
      bubbles: payload.bubbles,
      systemState: payload.systemState,
      triggerMode: payload.triggerMode,
      ringSize: payload.ringSize,
      labelSize: payload.labelSize,
      accentColor: payload.accentColor,
      accentFillColor: payload.accentFillColor,
      accentForegroundColor: payload.accentForegroundColor,
      bubbleSurface: payload.bubbleSurface,
      // Reset per-bubble fill levels on each open so stale values don't persist
      bubbleFillLevels: {},
    }),

  closeRing: () =>
    set({ isOpen: false, hoveredIndex: null }),

  setHoveredIndex: (idx) => set({ hoveredIndex: idx }),

  updateSystemState: (patch: Partial<SystemState>) =>
    set((s) => ({ systemState: { ...s.systemState, ...patch } })),

  setBubbleFillLevel: (bubbleId: string, level: number) =>
    set((s) => ({
      bubbleFillLevels: { ...s.bubbleFillLevels, [bubbleId]: level },
    })),
}));
