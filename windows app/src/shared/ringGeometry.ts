import { MAX_FOLDER_CHILDREN } from './constants';
import type { BubblePosition } from './types';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function computeRingPositions(
  count: number,
  centerX: number,
  centerY: number,
  radius: number,
  clampBounds?: { min: number; max: number }
): BubblePosition[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + index * ((2 * Math.PI) / count);
    const rawX = centerX + Math.cos(angle) * radius;
    const rawY = centerY + Math.sin(angle) * radius;
    return {
      x: clampBounds ? clamp(rawX, clampBounds.min, clampBounds.max) : rawX,
      y: clampBounds ? clamp(rawY, clampBounds.min, clampBounds.max) : rawY,
      angle,
    };
  });
}

/** Points a root group marker away from the ring centre at its current slot. */
export function computeGroupDotAngle(position: BubblePosition): number {
  return Math.atan2(Math.sin(position.angle), Math.cos(position.angle));
}

const DEG_TO_RAD = Math.PI / 180;

/**
 * The axis a folder's sub-ring fans along: the direction from the parent bubble
 * toward the ring center. This is the only direction guaranteed to have room
 * inside the fixed overlay window (the other main-ring bubbles are hidden while
 * a folder is expanded), so children and their labels never clip the edge.
 */
export function computeSubRingAxis(
  parentX: number,
  parentY: number,
  ringCenterX: number,
  ringCenterY: number
): number {
  return Math.atan2(ringCenterY - parentY, ringCenterX - parentX);
}

/**
 * F4.1 sub-ring layout: children fan out in an arc centered on the parent
 * bubble, symmetric around the parent→ring-center axis. Spacing is
 * `baseStepDeg` until the arc would exceed `maxSpanDeg`, after which children
 * compress evenly so up to MAX_FOLDER_CHILDREN never overlap. Each returned `angle` is measured
 * from the parent (used by hover matching in SubRing).
 */
export function computeSubRingArcPositions(
  count: number,
  parentX: number,
  parentY: number,
  ringCenterX: number,
  ringCenterY: number,
  radius: number,
  baseStepDeg: number,
  maxSpanDeg: number,
  clampBounds?: { min: number; max: number }
): BubblePosition[] {
  if (count <= 0) return [];
  const axis = computeSubRingAxis(parentX, parentY, ringCenterX, ringCenterY);
  const stepDeg = count > 1 ? Math.min(baseStepDeg, maxSpanDeg / (count - 1)) : 0;
  const step = stepDeg * DEG_TO_RAD;
  const mid = (count - 1) / 2;
  return Array.from({ length: count }, (_, index) => {
    const angle = axis + (index - mid) * step;
    const rawX = parentX + Math.cos(angle) * radius;
    const rawY = parentY + Math.sin(angle) * radius;
    return {
      x: clampBounds ? clamp(rawX, clampBounds.min, clampBounds.max) : rawX,
      y: clampBounds ? clamp(rawY, clampBounds.min, clampBounds.max) : rawY,
      angle,
    };
  });
}

/**
 * Which side of each sub-bubble its persistent label sits on. Labels go on the
 * outer side of the arc (the axis direction) so they read away from the parent;
 * a near-vertical axis falls back to below the bubble.
 */
export function computeArcLabelSide(
  parentX: number,
  parentY: number,
  ringCenterX: number,
  ringCenterY: number
): 'left' | 'right' | 'below' {
  const axisCos = Math.cos(computeSubRingAxis(parentX, parentY, ringCenterX, ringCenterY));
  if (axisCos > 0.5) return 'right';
  if (axisCos < -0.5) return 'left';
  return 'below';
}

export interface FolderLayoutItem extends BubblePosition {
  labelSide: 'left' | 'right' | 'below';
  visualIndex: number;
}

export interface FolderLayout {
  parent: BubblePosition;
  children: FolderLayoutItem[];
  insertionTargets: FolderLayoutItem[];
  axis: number;
}

export interface FolderLayoutOptions {
  width: number;
  height: number;
  bubbleDiameter: number;
  childCount: number;
  includeInsertionTargets?: boolean;
  radius?: number;
  baseStepDeg?: number;
  maxSpanDeg?: number;
  interactionScale?: number;
}

/**
 * Canonical F4.1 composition shared by the dashboard and overlay. The selected
 * parent always settles left of centre and its children form a right-facing arc,
 * regardless of which root-ring slot opened the group.
 */
export function computeFolderLayout({
  width,
  height,
  bubbleDiameter,
  childCount,
  includeInsertionTargets = false,
  radius = 124 * (width / 400),
  baseStepDeg = 42,
  maxSpanDeg = 240,
  interactionScale = 1.15,
}: FolderLayoutOptions): FolderLayout {
  const safeCount = Math.max(0, Math.floor(childCount));
  const insertionCount = includeInsertionTargets && safeCount < MAX_FOLDER_CHILDREN
    ? safeCount === 0 ? 1 : 2
    : 0;
  const visualCount = safeCount + insertionCount;
  const stepDeg = visualCount > 1 ? Math.min(baseStepDeg, maxSpanDeg / (visualCount - 1)) : 0;
  const clearanceDiameter = bubbleDiameter * interactionScale;
  const minimumRadius = visualCount > 1 && stepDeg > 0
    ? (clearanceDiameter + 8) / (2 * Math.sin((stepDeg * DEG_TO_RAD) / 2))
    : radius;
  const resolvedRadius = Math.max(radius, minimumRadius);
  const bubbleRadius = clearanceDiameter / 2;
  const initialParent = {
    x: Math.max(bubbleRadius + 8, width * 0.22),
    y: height / 2,
    angle: 0,
  };
  const positions = computeSubRingArcPositions(
    visualCount,
    initialParent.x,
    initialParent.y,
    initialParent.x + 1,
    initialParent.y,
    resolvedRadius,
    baseStepDeg,
    maxSpanDeg
  );

  const allPoints = [initialParent, ...positions];
  const minX = Math.min(...allPoints.map((point) => point.x - bubbleRadius));
  const maxX = Math.max(...allPoints.map((point) => point.x + bubbleRadius));
  const minY = Math.min(...allPoints.map((point) => point.y - bubbleRadius));
  const maxY = Math.max(...allPoints.map((point) => point.y + bubbleRadius));
  const padding = 4;
  let shiftX = minX < padding ? padding - minX : 0;
  if (maxX + shiftX > width - padding) shiftX += width - padding - (maxX + shiftX);
  let shiftY = minY < padding ? padding - minY : 0;
  if (maxY + shiftY > height - padding) shiftY += height - padding - (maxY + shiftY);

  const parent = { ...initialParent, x: initialParent.x + shiftX, y: initialParent.y + shiftY };
  const shifted = positions.map((position, visualIndex): FolderLayoutItem => {
    const x = position.x + shiftX;
    const y = position.y + shiftY;
    const angle = Math.atan2(y - parent.y, x - parent.x);
    return { x, y, angle, labelSide: 'right', visualIndex };
  });

  if (insertionCount === 0) {
    return { parent, children: shifted, insertionTargets: [], axis: 0 };
  }
  if (safeCount === 0) {
    return { parent, children: [], insertionTargets: shifted, axis: 0 };
  }
  return {
    parent,
    children: shifted.slice(1, shifted.length - 1),
    insertionTargets: [shifted[0], shifted[shifted.length - 1]],
    axis: 0,
  };
}
