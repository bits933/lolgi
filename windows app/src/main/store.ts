import Store from 'electron-store';
import { app } from 'electron';
import { copyFileSync, existsSync } from 'fs';
import { join } from 'path';
import type {
  AppConfig,
  AppProfile,
  BubbleConfig,
  MutationResult,
  RingProfile,
  RingSize,
  ThemeConfig,
} from '../shared/types';
import {
  appProfileToRingProfile,
  bubblesToSlots,
  normalizeProcessName,
  ringProfileToAppProfile,
  slotsToBubbles,
} from '../shared/profileUtils';
import {
  createDefaultConfig,
  migrateConfig,
  syncCompatibilityViews,
  validateProfile,
} from './configMigration';

let _store: Store<AppConfig> | null = null;
let cachedConfig: AppConfig | null = null;

function backupCorruptConfig(error: unknown): void {
  const configPath = join(app.getPath('userData'), 'config.json');
  if (!existsSync(configPath)) return;
  try {
    const backupPath = join(app.getPath('userData'), `config.corrupt.${Date.now()}.json`);
    copyFileSync(configPath, backupPath);
    console.error(`[store] Invalid configuration backed up to ${backupPath}:`, error);
  } catch (backupError) {
    console.error('[store] Invalid configuration could not be backed up:', backupError);
  }
}

export function getConfigStore(): Store<AppConfig> {
  if (!_store) {
    try {
      _store = new Store<AppConfig>();
    } catch (error) {
      backupCorruptConfig(error);
      _store = new Store<AppConfig>({ clearInvalidConfig: true });
    }
  }
  return _store;
}

function writeConfig(config: AppConfig): AppConfig {
  const normalized = syncCompatibilityViews(config);
  // Keep reads on the hot path entirely in memory. `set` preserves unrelated
  // store metadata (for example the icon-heal marker) that is not AppConfig.
  getConfigStore().set(normalized);
  cachedConfig = normalized;
  return normalized;
}

export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const store = getConfigStore();
  const raw = store.store as Partial<AppConfig>;
  try {
    const config = Object.keys(raw).length === 0 ? createDefaultConfig() : migrateConfig(raw);
    // Persist once to materialize defaults/migrations, then serve every later
    // call from the in-memory snapshot without touching the disk-backed store.
    return writeConfig(config);
  } catch (error) {
    backupCorruptConfig(error);
    store.clear();
    cachedConfig = null;
    return writeConfig(createDefaultConfig());
  }
}

export function replaceConfig(config: AppConfig): AppConfig {
  return writeConfig(migrateConfig(config));
}

export function setHotkey(hotkey: string): void {
  writeConfig({ ...getConfig(), hotkey });
}

export function setRingSize(ringSize: RingSize): void {
  writeConfig({ ...getConfig(), ringSize });
}

export function setTheme(theme: ThemeConfig): void {
  writeConfig({ ...getConfig(), theme });
}

export function setLaunchAtStartup(value: boolean): void {
  writeConfig({ ...getConfig(), launchAtStartup: value });
}

export function setRingEnabled(value: boolean): void {
  writeConfig({ ...getConfig(), ringEnabled: value });
}

export function setTriggerMode(value: AppConfig['triggerMode']): void {
  writeConfig({ ...getConfig(), triggerMode: value });
}

export function getProfiles(): RingProfile[] {
  return getConfig().profiles;
}

export function saveProfile(profile: RingProfile): MutationResult<RingProfile> {
  const config = getConfig();
  const incomingValidationError = validateProfile(profile);
  if (incomingValidationError) return { status: 'validation_error', message: incomingValidationError };
  const index = config.profiles.findIndex((item) => item.id === profile.id);
  if (index === -1) return { status: 'not_found', message: 'Profile not found.' };
  const existing = config.profiles[index];
  const normalizedProfile = existing.protected
    ? { ...profile, id: existing.id, name: existing.name, kind: existing.kind, enabled: true, protected: true, application: existing.application }
    : profile;
  const validationError = validateProfile(normalizedProfile);
  if (validationError) return { status: 'validation_error', message: validationError };
  if (normalizedProfile.kind === 'application') {
    const processName = normalizeProcessName(normalizedProfile.application?.processName ?? '');
    const duplicate = config.profiles.some(
      (item) => item.id !== normalizedProfile.id && item.kind === 'application' && normalizeProcessName(item.application?.processName ?? '') === processName
    );
    if (duplicate) return { status: 'duplicate', message: 'An application profile already exists for this process.' };
  }
  const profiles = [...config.profiles];
  profiles[index] = {
    ...normalizedProfile,
    slots: [...normalizedProfile.slots].sort((a, b) => a.position - b.position).map((slot, position) => ({ ...slot, position })),
  };
  writeConfig({ ...config, profiles });
  return { status: 'ok', value: profiles[index] };
}

export function addProfile(profile: RingProfile): MutationResult<RingProfile> {
  const config = getConfig();
  const validationError = validateProfile(profile);
  if (validationError) return { status: 'validation_error', message: validationError };
  if (config.profiles.some((item) => item.id === profile.id)) {
    return { status: 'duplicate', message: 'A profile with this ID already exists.' };
  }
  if (profile.kind === 'general' || profile.protected) {
    return { status: 'conflict', message: 'Only the built-in General profile can use the protected fallback type.' };
  }
  if (profile.kind === 'application') {
    const processName = normalizeProcessName(profile.application?.processName ?? '');
    if (!processName) return { status: 'validation_error', message: 'Choose an application for this profile.' };
    const duplicate = config.profiles.some(
      (item) =>
        item.kind === 'application' &&
        normalizeProcessName(item.application?.processName ?? '') === processName
    );
    if (duplicate) return { status: 'duplicate', message: 'An application profile already exists for this process.' };
  }
  const normalizedProfile = {
    ...profile,
    slots: [...profile.slots].sort((a, b) => a.position - b.position).map((slot, position) => ({ ...slot, position })),
  };
  writeConfig({ ...config, profiles: [...config.profiles, normalizedProfile] });
  return { status: 'ok', value: normalizedProfile };
}

export function removeProfile(id: string): MutationResult {
  const config = getConfig();
  const profile = config.profiles.find((item) => item.id === id);
  if (!profile) return { status: 'not_found', message: 'Profile not found.' };
  if (profile.protected || id === config.generalProfileId) {
    return { status: 'conflict', message: 'The General profile cannot be deleted.' };
  }
  const selectedGlobalProfileId = config.selectedGlobalProfileId === id ? null : config.selectedGlobalProfileId;
  writeConfig({
    ...config,
    selectedGlobalProfileId,
    profiles: config.profiles.filter((item) => item.id !== id),
  });
  return { status: 'ok' };
}

export function setSelectedGlobalProfile(id: string | null): MutationResult {
  const config = getConfig();
  if (id !== null && !config.profiles.some((profile) => profile.id === id && profile.kind === 'global' && profile.enabled)) {
    return { status: 'not_found', message: 'Global profile not found.' };
  }
  writeConfig({ ...config, selectedGlobalProfileId: id });
  return { status: 'ok' };
}

// ---------------------------------------------------------------------------
// Legacy compatibility mutations. Dashboard V2 does not call these directly.
// ---------------------------------------------------------------------------

export function setBubbles(bubbles: BubbleConfig[]): void {
  const config = getConfig();
  const profiles = config.profiles.map((profile) =>
    profile.id === config.generalProfileId ? { ...profile, slots: bubblesToSlots(bubbles) } : profile
  );
  writeConfig({ ...config, profiles });
}

export function updateBubble(id: string, patch: Partial<BubbleConfig>): MutationResult {
  const config = getConfig();
  const general = config.profiles.find((profile) => profile.id === config.generalProfileId);
  if (!general) return { status: 'not_found', message: 'General profile not found.' };
  const bubbles = slotsToBubbles(general.slots);
  const index = bubbles.findIndex((bubble) => bubble.id === id);
  if (index === -1) return { status: 'not_found', message: 'Bubble not found.' };
  bubbles[index] = { ...bubbles[index], ...patch };
  setBubbles(bubbles);
  return { status: 'ok' };
}

export function addBubble(bubble: BubbleConfig): void {
  setBubbles([...getConfig().bubbles, bubble]);
}

export function removeBubble(id: string): MutationResult {
  const current = getConfig().bubbles;
  if (!current.some((bubble) => bubble.id === id)) return { status: 'not_found', message: 'Bubble not found.' };
  setBubbles(current.filter((bubble) => bubble.id !== id));
  return { status: 'ok' };
}

export function reorderBubbles(orderedIds: string[]): void {
  const map = new Map(getConfig().bubbles.map((bubble) => [bubble.id, bubble]));
  setBubbles(orderedIds.flatMap((id) => {
    const bubble = map.get(id);
    return bubble ? [bubble] : [];
  }));
}

export function getAppProfiles(): AppProfile[] {
  return getConfig().appProfiles;
}

export function addAppProfile(profile: AppProfile): MutationResult<RingProfile> {
  return addProfile(appProfileToRingProfile(profile));
}

export function updateAppProfile(id: string, patch: Partial<AppProfile>): MutationResult<RingProfile> {
  const current = getConfig().profiles.find((profile) => profile.id === id);
  if (!current || current.kind !== 'application') return { status: 'not_found', message: 'Profile not found.' };
  const legacy = ringProfileToAppProfile(current);
  if (!legacy) return { status: 'validation_error', message: 'Invalid application profile.' };
  return saveProfile(appProfileToRingProfile({ ...legacy, ...patch }));
}

export function removeAppProfile(id: string): MutationResult {
  return removeProfile(id);
}

export function setProfileBubbles(profileId: string, bubbles: BubbleConfig[]): MutationResult<RingProfile> {
  const profile = getConfig().profiles.find((item) => item.id === profileId);
  if (!profile) return { status: 'not_found', message: 'Profile not found.' };
  return saveProfile({ ...profile, slots: bubblesToSlots(bubbles) });
}

export function updateProfileBubble(profileId: string, bubbleId: string, patch: Partial<BubbleConfig>): MutationResult<RingProfile> {
  const profile = getConfig().profiles.find((item) => item.id === profileId);
  if (!profile) return { status: 'not_found', message: 'Profile not found.' };
  const bubbles = slotsToBubbles(profile.slots);
  const index = bubbles.findIndex((bubble) => bubble.id === bubbleId);
  if (index === -1) return { status: 'not_found', message: 'Bubble not found.' };
  bubbles[index] = { ...bubbles[index], ...patch };
  return saveProfile({ ...profile, slots: bubblesToSlots(bubbles) });
}

export function addProfileBubble(profileId: string, bubble: BubbleConfig): MutationResult<RingProfile> {
  const profile = getConfig().profiles.find((item) => item.id === profileId);
  if (!profile) return { status: 'not_found', message: 'Profile not found.' };
  return saveProfile({ ...profile, slots: bubblesToSlots([...slotsToBubbles(profile.slots), bubble]) });
}

export function removeProfileBubble(profileId: string, bubbleId: string): MutationResult<RingProfile> {
  const profile = getConfig().profiles.find((item) => item.id === profileId);
  if (!profile) return { status: 'not_found', message: 'Profile not found.' };
  const bubbles = slotsToBubbles(profile.slots);
  if (!bubbles.some((bubble) => bubble.id === bubbleId)) return { status: 'not_found', message: 'Bubble not found.' };
  return saveProfile({ ...profile, slots: bubblesToSlots(bubbles.filter((bubble) => bubble.id !== bubbleId)) });
}
