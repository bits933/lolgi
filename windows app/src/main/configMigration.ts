/**
 * Pure configuration defaults, validation, and migration.
 *
 * Extracted from `store.ts` so this logic can be unit-tested without pulling in
 * `electron` / `electron-store` (which cannot be imported under Vitest). `store.ts`
 * owns persistence and re-exports nothing from here that touches the filesystem.
 */
import type { ActionAssignment, AppConfig, AppProfile, BubbleConfig, RingProfile } from '../shared/types';
import { DEFAULT_HOTKEY, DEFAULT_LABEL_SIZE, DEFAULT_RING_SIZE, DEFAULT_THEME } from '../shared/constants';
import {
  CONFIG_SCHEMA_VERSION,
  GENERAL_PROFILE_ID,
  appProfileToRingProfile,
  assignmentToBubble,
  bubbleToAssignment,
  createGeneralProfile,
  normalizeGroupLabel,
} from '../shared/profileUtils';
import { ACTION_DEFINITIONS, validateAssignment } from '../shared/actionCatalog';
import {
  APP_ACTION_CATALOG,
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

const AUTOCAD_MACRO_PAYLOADS = new Map(
  APP_ACTION_CATALOG.flatMap(({ id, appId, actionType, defaultPayload }) =>
    appId === 'autocad' && actionType === 'macro' && defaultPayload
      ? [[id, defaultPayload] as const]
      : []
  )
);

/** Shape accepted from pre-V2 config files during one-time migration. */
type ConfigInput = Partial<AppConfig> & {
  bubbles?: BubbleConfig[];
  appProfiles?: AppProfile[];
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

function migrateAutoCadMacroNode<T extends ActionAssignment | BubbleConfig>(node: T): T {
  const macroPayload = node.definitionId ? AUTOCAD_MACRO_PAYLOADS.get(node.definitionId) : undefined;
  // Superseded forms auto-heal to the current macro so every AutoCAD action edits
  // through the step editor:
  //  - the original keyboard-sequence split each typed letter out ("keys:PL" was
  //    once stored as "P; L; Enter")
  //  - the short-lived text:/Unicode macro ("text:PL; Enter") is silently dropped
  //    by AutoCAD's command line, which is why it must become keys:
  //  - any non-macro action whose payload already equals the catalog macro
  //    verbatim — Save (Ctrl+S), Cancel (Esc; Esc), Repeat last (Enter) — which
  //    are macros now purely so they too open the multi-step editor.
  // Custom-edited payloads never match any of these forms, so they are untouched.
  const sequencePayload = macroPayload?.replace(/keys:([^;]+)/g, (_match, keys: string) => [...keys].join('; '));
  const unicodePayload = macroPayload?.replace(/keys:/g, 'text:');
  const shouldMigrate =
    macroPayload !== undefined &&
    ((node.actionType !== 'macro' && (node.payload === sequencePayload || node.payload === macroPayload)) ||
      (node.actionType === 'macro' && node.payload === unicodePayload && unicodePayload !== macroPayload));
  const migratedChildren = node.children?.map((child) => migrateAutoCadMacroNode(child));
  const childrenChanged = migratedChildren
    ? migratedChildren.some((child, index) => child !== node.children?.[index])
    : false;
  if (!shouldMigrate && !childrenChanged) return node;
  return {
    ...node,
    ...(shouldMigrate ? { actionType: 'macro' as const, payload: macroPayload } : {}),
    ...(childrenChanged ? { children: migratedChildren } : {}),
  } as T;
}

function migrateAutoCadProfile(profile: RingProfile): RingProfile {
  const processName = profile.application?.processName?.trim().replace(/\.exe$/i, '').toLowerCase();
  if (processName !== 'acad') return profile;
  let changed = false;
  const slots = profile.slots.map((slot) => {
    if (!slot.assignment) return slot;
    const assignment = migrateAutoCadMacroNode(slot.assignment);
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
    launchAtStartup: false,
    hardwareAcceleration: true,
    ringEnabled: true,
    triggerMode: 'A',
    ringSize: DEFAULT_RING_SIZE,
    labelSize: DEFAULT_LABEL_SIZE,
    theme: DEFAULT_THEME,
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

export function migrateConfig(raw: ConfigInput): AppConfig {
  const { bubbles: legacyBubbles, appProfiles: legacyAppProfiles, ...configInput } = raw;
  if (raw.schemaVersion === CONFIG_SCHEMA_VERSION && Array.isArray(raw.profiles)) {
    const hasGeneral = raw.profiles.some((profile) => profile.id === raw.generalProfileId);
    const sourceProfiles = (hasGeneral
      ? raw.profiles
      : [createGeneralProfile(Array.isArray(legacyBubbles) ? legacyBubbles : []), ...raw.profiles]);
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
      const migratedProfile = migrateAutoCadProfile(migrateFigmaProfile(normalizedProfile));
      const validationError = validateProfile(migratedProfile);
      if (validationError) throw new Error(validationError);
      return migratedProfile;
    });
    const selectedGlobalProfileId = profiles.some(
      (profile) => profile.id === raw.selectedGlobalProfileId && profile.kind === 'global' && profile.enabled
    ) ? raw.selectedGlobalProfileId ?? null : null;
    return {
      ...createDefaultConfig(),
      ...configInput,
      schemaVersion: CONFIG_SCHEMA_VERSION,
      generalProfileId: hasGeneral ? raw.generalProfileId ?? GENERAL_PROFILE_ID : GENERAL_PROFILE_ID,
      selectedGlobalProfileId,
      profiles,
      hardwareAcceleration: typeof raw.hardwareAcceleration === 'boolean' ? raw.hardwareAcceleration : true,
      ringSize: raw.ringSize ?? DEFAULT_RING_SIZE,
      labelSize: raw.labelSize ?? DEFAULT_LABEL_SIZE,
      theme: { ...DEFAULT_THEME, ...raw.theme },
    } as AppConfig;
  }

  const legacyProfileBubbles = Array.isArray(legacyBubbles) ? legacyBubbles : [];
  const general = createGeneralProfile(legacyProfileBubbles);
  const migratedProfiles = Array.isArray(legacyAppProfiles)
    ? legacyAppProfiles.map(appProfileToRingProfile).map(migrateFigmaProfile).map(migrateAutoCadProfile)
    : [];
  return {
    ...createDefaultConfig(),
    ...configInput,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    generalProfileId: GENERAL_PROFILE_ID,
    selectedGlobalProfileId: null,
    profiles: [general, ...migratedProfiles],
    hardwareAcceleration: typeof raw.hardwareAcceleration === 'boolean' ? raw.hardwareAcceleration : true,
    ringSize: raw.ringSize ?? DEFAULT_RING_SIZE,
    labelSize: raw.labelSize ?? DEFAULT_LABEL_SIZE,
    theme: { ...DEFAULT_THEME, ...raw.theme },
  } as AppConfig;
}
