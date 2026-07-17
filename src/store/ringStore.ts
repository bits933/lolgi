import { create } from 'zustand';
import type { RingStore } from '../types/index';

export const useRingStore = create<RingStore>((set) => ({
  isOpen: false,
  mode: 'A',
  cursorPosition: { x: 0, y: 0 },
  hoveredIndex: null,

  openRing: (pos) =>
    set({ isOpen: true, cursorPosition: pos, hoveredIndex: null }),

  closeRing: () =>
    set({ isOpen: false, hoveredIndex: null }),

  setMode: (mode) => set({ mode }),

  setHoveredIndex: (idx) => set({ hoveredIndex: idx }),
}));
