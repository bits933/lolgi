import { describe, expect, it } from 'vitest';
import type { ActionAssignment, AppConfig, BubbleConfig, RingProfile } from '../shared/types';
import { APP_PROFILE_PRESETS, createAppProfileFromPreset } from '../shared/defaultProfiles';
import { createDefaultConfig, migrateConfig } from './configMigration';

const LEGACY_TIDY = 'Ctrl+/; delay:200; t; i; d; y; Space; u; p; Enter';
const LEGACY_COPY_SVG = 'Ctrl+/; delay:200; c; o; p; y; Space; a; s; Space; s; v; g; Enter';
const LEGACY_VERSION_HISTORY = 'Ctrl+/; delay:200; s; h; o; w; Space; v; e; r; s; i; o; n; Space; h; i; s; t; o; r; y; Enter';

function mapAssignment(
  assignment: ActionAssignment,
  definitionId: string,
  update: (assignment: ActionAssignment) => ActionAssignment
): ActionAssignment {
  const children = assignment.children?.map((child) => {
    const childAssignment = child as ActionAssignment;
    return mapAssignment(childAssignment, definitionId, update) as BubbleConfig;
  });
  const withChildren = children ? { ...assignment, children } : assignment;
  return withChildren.definitionId === definitionId ? update(withChildren) : withChildren;
}

function mapProfileAssignment(
  profile: RingProfile,
  definitionId: string,
  update: (assignment: ActionAssignment) => ActionAssignment
): RingProfile {
  return {
    ...profile,
    slots: profile.slots.map((slot) =>
      slot.assignment
        ? { ...slot, assignment: mapAssignment(slot.assignment, definitionId, update) }
        : slot
    ),
  };
}

function configWithAllPresets(): { config: AppConfig; presetIds: string[] } {
  const base = createDefaultConfig();
  const presetProfiles = APP_PROFILE_PRESETS.map((preset, index) =>
    createAppProfileFromPreset(preset.id, index + 1)
  );
  return {
    config: { ...base, profiles: [...base.profiles, ...presetProfiles] },
    presetIds: presetProfiles.map((profile) => profile.id),
  };
}

describe('config migration round-trip (M-07)', () => {
  it('preserves every preset profile through JSON serialize + migrate', () => {
    const { config } = configWithAllPresets();
    const original = config.profiles.filter((profile) => profile.kind === 'application');
    const migrated = migrateConfig(JSON.parse(JSON.stringify(config)));

    for (const before of original) {
      const after = migrated.profiles.find((profile) => profile.id === before.id);
      expect(after, before.name).toBeTruthy();
      expect(after!.name).toBe(before.name);
      expect(after!.kind).toBe(before.kind);
      expect(after!.application?.processName).toBe(before.application?.processName);
      expect(after!.slots).toHaveLength(before.slots.length);

      before.slots.forEach((beforeSlot, index) => {
        const afterSlot = after!.slots[index];
        expect(afterSlot.id).toBe(beforeSlot.id);
        expect(afterSlot.position).toBe(beforeSlot.position);
        const a = beforeSlot.assignment!;
        const b = afterSlot.assignment!;
        expect(b.id).toBe(a.id);
        expect(b.definitionId).toBe(a.definitionId);
        expect(b.actionType).toBe(a.actionType);
        expect(b.payload).toBe(a.payload);
        expect(b.scrollUpAction).toBe(a.scrollUpAction);
        expect(b.scrollDownAction).toBe(a.scrollDownAction);
        expect((b.children ?? []).map((child) => child.id)).toEqual((a.children ?? []).map((child) => child.id));
        expect(b.parameters).toEqual(a.parameters);
      });
    }
  });

  it('is idempotent across a second migrate', () => {
    const { config } = configWithAllPresets();
    const once = migrateConfig(JSON.parse(JSON.stringify(config)));
    const twice = migrateConfig(JSON.parse(JSON.stringify(once)));
    expect(twice.profiles.map((profile) => profile.id)).toEqual(once.profiles.map((profile) => profile.id));
    expect(JSON.stringify(twice.profiles)).toEqual(JSON.stringify(once.profiles));
  });

  it('updates only exact legacy Figma macro payloads', () => {
    const base = createDefaultConfig();
    const figma = createAppProfileFromPreset('figma', 1);
    const legacy = mapProfileAssignment(figma, 'figma-tidy', (assignment) => ({
      ...assignment,
      payload: LEGACY_TIDY,
    }));
    const customized = mapProfileAssignment(legacy, 'figma-copy-svg', (assignment) => ({
      ...assignment,
      payload: `${LEGACY_COPY_SVG} ; custom`,
    }));
    const config = { ...base, profiles: [...base.profiles, customized] };
    const migrated = migrateConfig(JSON.parse(JSON.stringify(config)));
    const result = migrated.profiles.find((profile) => profile.id === figma.id)!;
    const tidy = result.slots.find((slot) => slot.assignment?.definitionId === 'figma-distribute-menu')!
      .assignment!.children!.find((child) => child.definitionId === 'figma-tidy')!;
    const properties = result.slots.find((slot) => slot.assignment?.definitionId === 'figma-properties-menu')!
      .assignment!.children!.find((child) => child.definitionId === 'figma-copy-svg')!;
    expect(tidy.payload).toBe('Ctrl+K; delay:250; text:Tidy up; Enter');
    expect(properties.payload).toBe(`${LEGACY_COPY_SVG} ; custom`);
  });

  it('migrates nested children while preserving IDs, positions, and custom fields', () => {
    const base = createDefaultConfig();
    const figma = createAppProfileFromPreset('figma', 2);
    const propertiesSlot = figma.slots.find((slot) => slot.assignment?.definitionId === 'figma-properties-menu')!;
    const properties = propertiesSlot.assignment!;
    const copySvg = properties.children!.find((child) => child.definitionId === 'figma-copy-svg')!;
    const nestedLegacy: BubbleConfig = {
      ...copySvg,
      id: 'nested-version-history',
      definitionId: 'figma-version-history',
      payload: LEGACY_VERSION_HISTORY,
      angleIndex: 4,
      parameters: { customFlag: true },
    };
    propertiesSlot.assignment = {
      ...properties,
      children: [...properties.children!, nestedLegacy],
      parameters: { menuSetting: 'keep-me' },
    };
    const config = { ...base, profiles: [...base.profiles, figma] };
    const migrated = migrateConfig(JSON.parse(JSON.stringify(config)));
    const result = migrated.profiles.find((profile) => profile.id === figma.id)!;
    const resultPropertiesSlot = result.slots.find((slot) => slot.id === propertiesSlot.id)!;
    const resultProperties = resultPropertiesSlot.assignment!;
    const version = resultProperties.children!.find((child) => child.id === 'nested-version-history')!;
    expect(version.payload).toBe('Ctrl+K; delay:250; text:Show version history; Enter');
    expect(version.id).toBe(nestedLegacy.id);
    expect(version.angleIndex).toBe(nestedLegacy.angleIndex);
    expect(version.parameters).toEqual(nestedLegacy.parameters);
    expect(resultPropertiesSlot.position).toBe(propertiesSlot.position);
    expect(resultProperties.parameters).toEqual({ menuSetting: 'keep-me' });
  });

  it('does not rewrite customized or already-migrated payloads on subsequent runs', () => {
    const base = createDefaultConfig();
    const figma = createAppProfileFromPreset('figma', 3);
    const customized = mapProfileAssignment(figma, 'figma-tidy', (assignment) => ({
      ...assignment,
      payload: 'Ctrl+K; delay:500; text:Tidy up; Enter',
    }));
    const config = { ...base, profiles: [...base.profiles, customized] };
    const once = migrateConfig(JSON.parse(JSON.stringify(config)));
    const twice = migrateConfig(JSON.parse(JSON.stringify(once)));
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    const result = twice.profiles.find((profile) => profile.id === figma.id)!;
    const tidy = result.slots.find((slot) => slot.assignment?.definitionId === 'figma-distribute-menu')!
      .assignment!.children!.find((child) => child.definitionId === 'figma-tidy')!;
    expect(tidy.payload).toBe('Ctrl+K; delay:500; text:Tidy up; Enter');
  });
});
