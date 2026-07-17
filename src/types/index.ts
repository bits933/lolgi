import type { LucideIcon } from 'lucide-react';

export interface ActionItem {
  id: string;
  label: string;
  icon: LucideIcon;
  angleIndex: number; // 0-7, 0 = 12 o'clock
  execute: () => void;
}

export interface BubblePosition {
  x: number;
  y: number;
  angle: number; // radians, used for exit scatter direction
}

export type TriggerMode = 'A' | 'B';

export interface RingStore {
  isOpen: boolean;
  mode: TriggerMode;
  cursorPosition: { x: number; y: number };
  hoveredIndex: number | null;
  openRing: (pos: { x: number; y: number }) => void;
  closeRing: () => void;
  setMode: (mode: TriggerMode) => void;
  setHoveredIndex: (idx: number | null) => void;
}

export const RING_SIZE = 400;
export const BUBBLE_RADIUS = 120;
export const BUBBLE_SIZE = 56;
export const RING_CLAMP_MARGIN = RING_SIZE / 2;
