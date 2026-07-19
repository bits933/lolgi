import { v4 as uuidv4 } from 'uuid';
import { MAX_FOLDER_CHILDREN } from './constants';
import type {
  ActionAssignment,
  AppProfile,
  BubbleConfig,
  ForegroundAppInfo,
  RingProfile,
  RingSlot,
} from './types';

export const CONFIG_SCHEMA_VERSION = 2 as const;
export const GENERAL_PROFILE_ID = 'profile-general';
export const DEFAULT_SLOT_COUNT = 5;

export function normalizeGroupLabel(label: string): string {
  const normalized = label.trim().toLocaleLowerCase();
  return normalized === 'morphing group' || normalized === 'group' ? 'Submenu' : label;
}

export function createEmptySlots(count = DEFAULT_SLOT_COUNT): RingSlot[] {
  return Array.from({ length: count }, (_, position) => ({
    id: uuidv4(),
    position,
    assignment: null,
  }));
}

export function bubbleToAssignment(bubble: BubbleConfig): ActionAssignment {
  const fillActions = [bubble.scrollUpAction, bubble.scrollDownAction];
  let definitionId: string = bubble.definitionId ?? '';
  if (!definitionId) {
    definitionId = bubble.actionType;
    if (bubble.type === 'fill') {
      if (fillActions.some((action) => action === 'volume-up' || action === 'volume-down')) definitionId = 'adjust-volume';
      else if (fillActions.some((action) => action === 'brightness-up' || action === 'brightness-down')) definitionId = 'adjust-brightness';
      else if (fillActions.some((action) => action === 'zoom-in' || action === 'zoom-out')) definitionId = 'adjust-zoom';
      else if (bubble.scrollUpAction === 'Up' && bubble.scrollDownAction === 'Down') definitionId = 'adjust-scroll';
      else definitionId = 'adjust-shortcut-pair';
    } else if (bubble.type === 'menu') {
      definitionId = 'morph-group';
    } else {
      const legacyDefinitionIds: Partial<Record<BubbleConfig['actionType'], string>> = {
        'clipboard-copy': 'copy',
        'clipboard-paste': 'paste',
        'clipboard-cut': 'cut',
        'clipboard-undo': 'undo',
        'clipboard-redo': 'redo',
        screenshot: 'screenshot-region',
        'keyboard-shortcut': 'keystroke',
        'keyboard-sequence': 'keystroke-sequence',
        'app-launch': 'open-app',
        'file-open': 'open-file',
        'folder-open': 'open-folder',
        'url-open': 'open-url',
        'run-command': 'run-command',
        macro: 'custom-action',
      };
      definitionId = legacyDefinitionIds[bubble.actionType] ?? bubble.actionType;
    }
  }
  return {
    id: bubble.id,
    definitionId,
    label: bubble.type === 'menu' ? normalizeGroupLabel(bubble.label) : bubble.label,
    iconName: bubble.iconName,
    iconNameAlt: bubble.iconNameAlt,
    iconDataUrl: bubble.iconDataUrl,
    actionType: bubble.actionType,
    payload: bubble.payload,
    type: bubble.type ?? 'default',
    scrollUpAction: bubble.scrollUpAction,
    scrollDownAction: bubble.scrollDownAction,
    children: bubble.children,
    parameters: bubble.parameters,
  };
}

export function bubblesToSlots(bubbles: BubbleConfig[], minimumCount = 0): RingSlot[] {
  const count = Math.max(bubbles.length, minimumCount);
  return Array.from({ length: count }, (_, position) => {
    const bubble = bubbles[position];
    return {
      id: bubble ? `slot-${bubble.id}` : uuidv4(),
      position,
      assignment: bubble ? bubbleToAssignment(bubble) : null,
    };
  });
}

export function assignmentToBubble(assignment: ActionAssignment, angleIndex: number): BubbleConfig {
  return {
    id: assignment.id,
    definitionId: assignment.definitionId,
    label: assignment.label,
    iconName: assignment.iconName,
    iconNameAlt: assignment.iconNameAlt,
    iconDataUrl: assignment.iconDataUrl,
    angleIndex,
    actionType: assignment.actionType,
    payload: assignment.payload,
    type: assignment.type,
    scrollUpAction: assignment.scrollUpAction,
    scrollDownAction: assignment.scrollDownAction,
    children: assignment.children,
    parameters: assignment.parameters,
  };
}

function assertFolderAssignment(parent: ActionAssignment): void {
  if (parent.type !== 'menu') throw new Error('Child actions can only be changed on a submenu.');
}

/** Returns a stable, contiguous child order without mutating persisted input. */
export function normalizeFolderChildren(children: BubbleConfig[] = []): BubbleConfig[] {
  if (children.length > MAX_FOLDER_CHILDREN) {
    throw new Error(`A submenu can contain at most ${MAX_FOLDER_CHILDREN} actions.`);
  }
  const ids = new Set<string>();
  for (const child of children) {
    if (ids.has(child.id)) throw new Error('A submenu cannot contain duplicate child IDs.');
    ids.add(child.id);
  }
  return [...children]
    .sort((a, b) => a.angleIndex - b.angleIndex)
    .map((child, angleIndex) => ({ ...child, angleIndex }));
}

export function insertFolderChild(
  parent: ActionAssignment,
  index: number,
  child: BubbleConfig
): ActionAssignment {
  assertFolderAssignment(parent);
  const children = normalizeFolderChildren(parent.children);
  if (children.length >= MAX_FOLDER_CHILDREN) {
    throw new Error(`A submenu can contain at most ${MAX_FOLDER_CHILDREN} actions.`);
  }
  const next = [...children];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, child);
  return {
    ...parent,
    children: normalizeFolderChildren(next.map((item, angleIndex) => ({ ...item, angleIndex }))),
  };
}

export function replaceFolderChild(
  parent: ActionAssignment,
  childId: string,
  child: BubbleConfig
): ActionAssignment {
  assertFolderAssignment(parent);
  const children = normalizeFolderChildren(parent.children);
  const index = children.findIndex((item) => item.id === childId);
  if (index === -1) throw new Error('The selected child action no longer exists.');
  const next = [...children];
  next[index] = { ...child, id: childId, angleIndex: index };
  return { ...parent, children: normalizeFolderChildren(next) };
}

export function removeFolderChild(parent: ActionAssignment, childId: string): ActionAssignment {
  assertFolderAssignment(parent);
  const children = normalizeFolderChildren(parent.children);
  return {
    ...parent,
    children: normalizeFolderChildren(children.filter((child) => child.id !== childId)),
  };
}

export function moveFolderChild(
  parent: ActionAssignment,
  childId: string,
  targetIndex: number
): ActionAssignment {
  assertFolderAssignment(parent);
  const children = normalizeFolderChildren(parent.children);
  const sourceIndex = children.findIndex((child) => child.id === childId);
  if (sourceIndex === -1) throw new Error('The selected child action no longer exists.');
  const next = [...children];
  const [child] = next.splice(sourceIndex, 1);
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, child);
  return {
    ...parent,
    children: normalizeFolderChildren(next.map((item, angleIndex) => ({ ...item, angleIndex }))),
  };
}

export function slotsToBubbles(slots: RingSlot[]): BubbleConfig[] {
  return [...slots]
    .sort((a, b) => a.position - b.position)
    .flatMap((slot, angleIndex) =>
      slot.assignment ? [assignmentToBubble(slot.assignment, angleIndex)] : []
    );
}

export function createGeneralProfile(bubbles: BubbleConfig[] = []): RingProfile {
  return {
    id: GENERAL_PROFILE_ID,
    name: 'General',
    kind: 'general',
    enabled: true,
    protected: true,
    sortOrder: 0,
    slots: bubbles.length > 0 ? bubblesToSlots(bubbles) : createEmptySlots(),
  };
}

export function appProfileToRingProfile(profile: AppProfile): RingProfile {
  return {
    id: profile.id,
    name: profile.app.displayName,
    kind: 'application',
    enabled: profile.enabled,
    protected: false,
    sortOrder: profile.sortOrder,
    slots: bubblesToSlots(profile.bubbles, DEFAULT_SLOT_COUNT),
    application: {
      processName: profile.app.processName,
      displayName: profile.app.displayName,
      iconDataUrl: profile.app.iconDataUrl,
    },
  };
}

export function ringProfileToAppProfile(profile: RingProfile): AppProfile | null {
  if (profile.kind !== 'application' || !profile.application) return null;
  return {
    id: profile.id,
    app: {
      processName: profile.application.processName,
      displayName: profile.application.displayName,
      iconDataUrl: profile.application.iconDataUrl,
    },
    bubbles: slotsToBubbles(profile.slots),
    enabled: profile.enabled,
    sortOrder: profile.sortOrder,
  };
}

export function normalizeProcessName(value: string): string {
  return value.trim().replace(/\.exe$/i, '').toLowerCase();
}

export interface ProfileResolutionInput {
  profiles: RingProfile[];
  generalProfileId: string;
  selectedGlobalProfileId: string | null;
  foregroundApp: ForegroundAppInfo | null;
  manualOverrideProfileId?: string | null;
}

export function resolveProfile({
  profiles,
  generalProfileId,
  selectedGlobalProfileId,
  foregroundApp,
  manualOverrideProfileId,
}: ProfileResolutionInput): RingProfile | null {
  const enabled = profiles.filter((profile) => profile.enabled);

  if (manualOverrideProfileId) {
    const override = enabled.find((profile) => profile.id === manualOverrideProfileId);
    if (override) return override;
  }

  if (foregroundApp) {
    const processName = normalizeProcessName(foregroundApp.processName);
    const applicationProfile = enabled.find(
      (profile) =>
        profile.kind === 'application' &&
        profile.application &&
        normalizeProcessName(profile.application.processName) === processName
    );
    if (applicationProfile) return applicationProfile;
  }

  if (selectedGlobalProfileId) {
    const globalProfile = enabled.find(
      (profile) => profile.kind === 'global' && profile.id === selectedGlobalProfileId
    );
    if (globalProfile) return globalProfile;
  }

  return enabled.find((profile) => profile.id === generalProfileId) ?? null;
}
