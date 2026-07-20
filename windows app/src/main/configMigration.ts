/**
 * Pure configuration defaults, validation, and migration.
 *
 * Extracted from `store.ts` so this logic can be unit-tested without pulling in
 * `electron` / `electron-store` (which cannot be imported under Vitest). `store.ts`
 * owns persistence and re-exports nothing from here that touches the filesystem.
 */
import type { ActionAssignment, AppConfig, BubbleConfig, RingProfile } from '../shared/types';
import { DEFAULT_HOTKEY, DEFAULT_LABEL_SIZE, DEFAULT_RING_SIZE, DEFAULT_THEME } from '../shared/constants';
import {
  CONFIG_SCHEMA_VERSION,
  GENERAL_PROFILE_ID,
  appProfileToRingProfile,
  assignmentToBubble,
  bubbleToAssignment,
  createGeneralProfile,
  normalizeGroupLabel,
  ringProfileToAppProfile,
  slotsToBubbles,
} from '../shared/profileUtils';
import { ACTION_DEFINITIONS, validateAssignment } from '../shared/actionCatalog';
import {
  FIGMA_ACTIONS_PALETTE_DELAY_MS,
  FIGMA_ACTIONS_SHORTCUT,
  FIGMA_MACRO_QUERIES,
} from '../shared/defaultProfiles';

/**
 * Exact payloads emitted by the pre-Phase-5 Figma preset. Only these strings
 * are migrated; any edited/custom payload is intentionally left untouched.
 */
const LEGACY_FIGMA_MACRO_PAYLOADS: Record<string, string> = {
  'figma-tidy': 'Ctrl+/; delay:200; t; i; d; y; Space; u; p; Enter',
  'figma-copy-svg': 'Ctrl+/; delay:200; c; o; p; y; Space; a; s; Space; s; v; g; Enter',
  'figma-rasterize': 'Ctrl+/; delay:200; r; a; s; t; e; r; i; z; e; Space; s; e; l; e; c; t; i; o; n; Enter',
  'figma-same-fill': 'Ctrl+/; delay:200; s; a; m; e; Space; f; i; l; l; Enter',
  'figma-version-history': 'Ctrl+/; delay:200; s; h; o; w; Space; v; e; r; s; i; o; n; Space; h; i; s; t; o; r; y; Enter',
};

const CURRENT_FIGMA_MACRO_PAYLOADS: Record<string, string> = {
  'figma-tidy': `${FIGMA_ACTIONS_SHORTCUT}; delay:${FIGMA_ACTIONS_PALETTE_DELAY_MS}; text:${FIGMA_MACRO_QUERIES.tidy}; Enter`,
  'figma-copy-svg': `${FIGMA_ACTIONS_SHORTCUT}; delay:${FIGMA_ACTIONS_PALETTE_DELAY_MS}; text:${FIGMA_MACRO_QUERIES['copy-svg']}; Enter`,
  'figma-rasterize': `${FIGMA_ACTIONS_SHORTCUT}; delay:${FIGMA_ACTIONS_PALETTE_DELAY_MS}; text:${FIGMA_MACRO_QUERIES.rasterize}; Enter`,
  'figma-same-fill': `${FIGMA_ACTIONS_SHORTCUT}; delay:${FIGMA_ACTIONS_PALETTE_DELAY_MS}; text:${FIGMA_MACRO_QUERIES['same-fill']}; Enter`,
  'figma-version-history': `${FIGMA_ACTIONS_SHORTCUT}; delay:${FIGMA_ACTIONS_PALETTE_DELAY_MS}; text:${FIGMA_MACRO_QUERIES['version-history']}; Enter`,
};

function migrateFigmaMacroNode<T extends ActionAssignment | BubbleConfig>(node: T): T {
  const migratedPayload = node.definitionId
    ? LEGACY_FIGMA_MACRO_PAYLOADS[node.definitionId] === node.payload
      ? CURRENT_FIGMA_MACRO_PAYLOADS[node.definitionId]
      : node.payload
    : node.payload;
  const migratedChildren = node.children?.map((child) => migrateFigmaMacroNode(child));
  const payloadChanged = migratedPayload !== node.payload;
  const childrenChanged = migratedChildren
    ? migratedChildren.some((child, index) => child !== node.children?.[index])
    : false;
  if (!payloadChanged && !childrenChanged) return node;
  return {
    ...node,
    ...(payloadChanged ? { payload: migratedPayload } : {}),
    ...(childrenChanged ? { children: migratedChildren } : {}),
  } as T;
}

function isFigmaProfile(profile: RingProfile): boolean {
  const processName = profile.application?.processName?.trim().replace(/\.exe$/i, '').toLowerCase();
  return processName === 'figma';
}

function migrateFigmaProfile(profile: RingProfile): RingProfile {
  if (!isFigmaProfile(profile)) return profile;
  let changed = false;
  const slots = profile.slots.map((slot) => {
    if (!slot.assignment) return slot;
    const assignment = migrateFigmaMacroNode(slot.assignment);
    if (assignment === slot.assignment) return slot;
    changed = true;
    return { ...slot, assignment };
  });
  return changed ? { ...profile, slots } : profile;
}

export function createDefaultConfig(): AppConfig {
  const general = createGeneralProfile();
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    generalProfileId: GENERAL_PROFILE_ID,
    selectedGlobalProfileId: null,
    profiles: [general],
    hotkey: DEFAULT_HOTKEY,
    bubbles: [],
    launchAtStartup: false,
    ringEnabled: true,
    triggerMode: 'A',
    ringSize: DEFAULT_RING_SIZE,
    labelSize: DEFAULT_LABEL_SIZE,
    theme: DEFAULT_THEME,
    appProfiles: [],
  };
}

export function validateProfile(profile: RingProfile): string | null {
  if (!profile || typeof profile !== 'object') return 'Profile data is invalid.';
  if (typeof profile.id !== 'string' || typeof profile.name !== 'string' || !profile.id.trim() || !profile.name.trim()) {
    return 'Profile ID and name are required.';
  }
  if (!Array.isArray(profile.slots)) return 'Profile ring slots are invalid.';
  if (profile.slots.length < 2 || profile.slots.length > 12) return 'A ring must contain between two and twelve bubbles.';
  if (profile.slots.some((slot) => !slot || typeof slot.id !== 'string')) return 'Ring slot data is invalid.';
  if (new Set(profile.slots.map((slot) => slot.id)).size !== profile.slots.length) return 'Ring slot IDs must be unique.';
  const assignments = profile.slots.flatMap((slot) => slot.assignment ? [slot.assignment] : []);
  if (assignments.some((assignment) =>
    typeof assignment !== 'object' ||
    typeof assignment.id !== 'string' ||
    typeof assignment.label !== 'string' ||
    typeof assignment.definitionId !== 'string'
  )) return 'Assigned action data is invalid.';
  const assignmentIds = assignments.map((assignment) => assignment.id);
  if (new Set(assignmentIds).size !== assignmentIds.length) return 'Assigned action IDs must be unique within a profile.';
  for (const slot of profile.slots) {
    if (!slot.assignment) continue;
    if (!slot.assignment.label.trim()) return 'Assigned actions need a label.';
    const assignmentError = validateAssignment(slot.assignment);
    if (assignmentError) return assignmentError;
  }
  if (!['general', 'global', 'application'].includes(profile.kind)) return 'Profile type is invalid.';
  if (
    profile.kind === 'application' &&
    (typeof profile.application?.processName !== 'string' || !profile.application.processName.trim())
  ) {
    return 'Choose an application for this profile.';
  }
  return null;
}

export function syncCompatibilityViews(config: AppConfig): AppConfig {
  const general = config.profiles.find((profile) => profile.id === config.generalProfileId);
  const bubbles = general ? slotsToBubbles(general.slots) : [];
  const appProfiles = config.profiles.flatMap((profile) => {
    const legacy = ringProfileToAppProfile(profile);
    return legacy ? [legacy] : [];
  });
  return { ...config, bubbles, appProfiles };
}

export function migrateConfig(raw: Partial<AppConfig>): AppConfig {
  if (raw.schemaVersion === CONFIG_SCHEMA_VERSION && Array.isArray(raw.profiles)) {
    const hasGeneral = raw.profiles.some((profile) => profile.id === raw.generalProfileId);
    const sourceProfiles = (hasGeneral
      ? raw.profiles
      : [createGeneralProfile(Array.isArray(raw.bubbles) ? raw.bubbles : []), ...raw.profiles]);
    const profiles = sourceProfiles.map((profile) => {
      if (!profile || typeof profile !== 'object' || !Array.isArray(profile.slots)) {
        throw new Error('A V2 profile is missing its ring slots.');
      }
      const normalizedProfile: RingProfile = {
        ...profile,
        slots: profile.slots.map((slot, position) => {
          if (!slot || typeof slot !== 'object') throw new Error('A V2 ring slot is invalid.');
          if (!slot.assignment) return slot;
          const definitionId = ACTION_DEFINITIONS.has(slot.assignment.definitionId)
            ? slot.assignment.definitionId
            : bubbleToAssignment(assignmentToBubble(slot.assignment, position)).definitionId;
          const label = definitionId === 'morph-group'
            ? normalizeGroupLabel(slot.assignment.label)
            : slot.assignment.label;
          if (definitionId === slot.assignment.definitionId && label === slot.assignment.label) return slot;
          return { ...slot, assignment: { ...slot.assignment, definitionId, label } };
        }),
      };
      const migratedProfile = migrateFigmaProfile(normalizedProfile);
      const validationError = validateProfile(migratedProfile);
      if (validationError) throw new Error(validationError);
      return migratedProfile;
    });
    const selectedGlobalProfileId = profiles.some(
      (profile) => profile.id === raw.selectedGlobalProfileId && profile.kind === 'global' && profile.enabled
    ) ? raw.selectedGlobalProfileId ?? null : null;
    return syncCompatibilityViews({
      ...createDefaultConfig(),
      ...raw,
      schemaVersion: CONFIG_SCHEMA_VERSION,
      generalProfileId: hasGeneral ? raw.generalProfileId ?? GENERAL_PROFILE_ID : GENERAL_PROFILE_ID,
      selectedGlobalProfileId,
      profiles,
      ringSize: raw.ringSize ?? DEFAULT_RING_SIZE,
      labelSize: raw.labelSize ?? DEFAULT_LABEL_SIZE,
      theme: { ...DEFAULT_THEME, ...raw.theme },
    } as AppConfig);
  }

  const legacyBubbles = Array.isArray(raw.bubbles) ? raw.bubbles : [];
  const general = createGeneralProfile(legacyBubbles);
  const migratedProfiles = Array.isArray(raw.appProfiles)
    ? raw.appProfiles.map(appProfileToRingProfile).map(migrateFigmaProfile)
    : [];
  return syncCompatibilityViews({
    ...createDefaultConfig(),
    ...raw,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    generalProfileId: GENERAL_PROFILE_ID,
    selectedGlobalProfileId: null,
    profiles: [general, ...migratedProfiles],
    ringSize: raw.ringSize ?? DEFAULT_RING_SIZE,
    labelSize: raw.labelSize ?? DEFAULT_LABEL_SIZE,
    theme: { ...DEFAULT_THEME, ...raw.theme },
  } as AppConfig);
}
