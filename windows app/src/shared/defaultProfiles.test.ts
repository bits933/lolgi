import { describe, expect, it } from 'vitest';
import { validateAssignment } from './actionCatalog';
import { validateShortcut } from './shortcutParser';
import type { SupportedAppId } from './types';
import { slotsToBubbles } from './profileUtils';
import {
  APP_ACTION_CATALOG,
  APP_PROFILE_PRESETS,
  FIGMA_ACTIONS_PALETTE_DELAY_MS,
  FIGMA_ACTIONS_SHORTCUT,
  FIGMA_MACRO_QUERIES,
  createAppProfileFromPreset,
  getSupportedAppId,
  materializeFigmaActionsBinding,
} from './defaultProfiles';

function allProfileIds(profile: ReturnType<typeof createAppProfileFromPreset>): string[] {
  return [
    profile.id,
    ...profile.slots.flatMap((slot) => [
      slot.id,
      ...(slot.assignment
        ? [
            slot.assignment.id,
            ...(slot.assignment.children ?? []).map((child) => child.id),
          ]
        : []),
    ]),
  ];
}

describe('curated app profiles', () => {
  it('offers the six planned Windows application presets', () => {
    expect(APP_PROFILE_PRESETS.map((preset) => [preset.id, `${preset.processName}.exe`])).toEqual([
      ['photoshop', 'Photoshop.exe'],
      ['blender', 'blender.exe'],
      ['resolve', 'Resolve.exe'],
      ['premiere', 'Adobe Premiere Pro.exe'],
      ['after-effects', 'AfterFX.exe'],
      ['figma', 'Figma.exe'],
    ]);
  });

  it('creates fresh application profiles with valid submenus', () => {
    // Figma gained a second alignment submenu (Distribute) to keep every
    // submenu at or under the 5-child cap; all other presets stay at eight.
    const expectedSlotCounts: Record<SupportedAppId, number> = {
      photoshop: 8,
      blender: 8,
      resolve: 8,
      premiere: 8,
      'after-effects': 8,
      figma: 9,
    };
    for (const preset of APP_PROFILE_PRESETS) {
      const profile = createAppProfileFromPreset(preset.id, 4);
      expect(profile.kind).toBe('application');
      expect(profile.sortOrder).toBe(4);
      expect(profile.slots).toHaveLength(expectedSlotCounts[preset.id]);
      expect(profile.slots.every((slot) => slot.assignment !== null)).toBe(true);

      for (const slot of profile.slots) {
        const assignment = slot.assignment!;
        expect(validateAssignment(assignment), `${preset.id}/${assignment.definitionId}`).toBeNull();
        expect(assignment.children?.length ?? 0).toBeLessThanOrEqual(5);
        expect(assignment.children?.every((child) => Boolean(child.definitionId)) ?? true).toBe(true);
      }
    }

    const first = createAppProfileFromPreset('photoshop', 1);
    const second = createAppProfileFromPreset('photoshop', 2);
    const firstIds = new Set(allProfileIds(first));
    expect(allProfileIds(second).every((id) => !firstIds.has(id))).toBe(true);
  });

  it('meets the per-app coverage contract, split by kind (M-06)', () => {
    // Locked, intentional per-app coverage. Update deliberately when curating
    // actions — a silent drop or uneven split should fail this test rather than
    // pass a loose total count. Known intentional exclusions (require live
    // verification before adding) include Photoshop Curves point navigation,
    // Blender proportional-edit falloff cycling, and Resolve Fairlight waveform
    // zoom — tracked in PLAN-5 Phase C, not shipped as defaults.
    const EXPECTED: Record<SupportedAppId, { standalone: number; fill: number; menu: number; macro: number }> = {
      photoshop: { standalone: 20, fill: 15, menu: 4, macro: 0 },
      blender: { standalone: 22, fill: 9, menu: 4, macro: 0 },
      resolve: { standalone: 18, fill: 13, menu: 3, macro: 0 },
      premiere: { standalone: 18, fill: 16, menu: 4, macro: 0 },
      'after-effects': { standalone: 27, fill: 14, menu: 6, macro: 0 },
      figma: { standalone: 15, fill: 16, menu: 4, macro: 7 },
    };
    for (const preset of APP_PROFILE_PRESETS) {
      const actions = APP_ACTION_CATALOG.filter((action) => action.appId === preset.id);
      const breakdown = {
        standalone: actions.filter((action) => action.bubbleType === 'default' && action.actionType !== 'macro').length,
        fill: actions.filter((action) => action.bubbleType === 'fill').length,
        menu: actions.filter((action) => action.bubbleType === 'menu').length,
        macro: actions.filter((action) => action.actionType === 'macro').length,
      };
      expect(breakdown, preset.id).toEqual(EXPECTED[preset.id]);
    }
  });

  it('gives every app fill a valid scroll pair and shortcut binding (M-03/M-06)', () => {
    for (const preset of APP_PROFILE_PRESETS) {
      const appActions = APP_ACTION_CATALOG.filter((action) => action.appId === preset.id);
      expect(appActions.some((action) => action.bubbleType === 'fill')).toBe(true);
      for (const action of appActions.filter((item) => item.bubbleType === 'fill')) {
        expect(action.editorFields.map((field) => field.key)).toEqual([
          'payload',
          'scrollUpAction',
          'scrollDownAction',
        ]);
      }
    }
    for (const action of APP_ACTION_CATALOG) {
      for (const field of action.editorFields) {
        if (field.type !== 'shortcut') continue;
        const value = field.key === 'payload'
          ? action.defaultPayload
          : field.key === 'scrollUpAction'
            ? action.scrollUpAction
            : field.key === 'scrollDownAction'
              ? action.scrollDownAction
              : undefined;
        if (typeof value === 'string' && value.trim()) {
          expect(validateShortcut(value), `${action.id}/${field.key}=${value}`).toBeNull();
        }
      }
    }
  });

  it('normalizes executable names and marks custom bindings for setup', () => {
    expect(getSupportedAppId('Photoshop.exe')).toBe('photoshop');
    expect(getSupportedAppId('afterfx')).toBe('after-effects');
    expect(getSupportedAppId('unknown.exe')).toBeNull();

    for (const id of [
      'photoshop-brightness-contrast',
      'photoshop-layer-mask',
      'photoshop-smart-object',
      'figma-quick-actions',
    ]) {
      const definition = APP_ACTION_CATALOG.find((action) => action.id === id);
      expect(definition?.availability).toBe('requires-setup');
      expect(definition?.setupInstructions).toMatch(/shortcut|action/i);
    }
    expect(
      APP_ACTION_CATALOG.find((action) => action.id === 'figma-quick-actions')
        ?.setupInstructions
    ).toMatch(/keyboard layout|Actions menu/i);
  });

  it('uses one Actions-menu shortcut and batched text queries for every Figma macro', () => {
    const queries = Object.values(FIGMA_MACRO_QUERIES);
    const macros = APP_ACTION_CATALOG.filter((action) => action.appId === 'figma' && action.actionType === 'macro');
    expect(macros).toHaveLength(7);
    const shortcutPattern = FIGMA_ACTIONS_SHORTCUT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const definition of macros) {
      expect(definition.defaultPayload).toMatch(
        new RegExp(`^${shortcutPattern}; delay:${FIGMA_ACTIONS_PALETTE_DELAY_MS}; text:.+; Enter$`)
      );
      expect(definition.defaultPayload).not.toMatch(/; [a-z];/i);
      const query = definition.defaultPayload?.match(/; text:(.*); Enter$/)?.[1];
      expect(query && queries.includes(query as (typeof queries)[number])).toBe(true);
    }
    expect(APP_ACTION_CATALOG.find((action) => action.id === 'figma-quick-actions')?.defaultPayload)
      .toBe(FIGMA_ACTIONS_SHORTCUT);
  });

  it('materializes an edited Quick Actions binding across untouched Figma macros only', () => {
    const profile = createAppProfileFromPreset('figma', 1);
    const quickActions = profile.slots.find(
      (slot) => slot.assignment?.definitionId === 'figma-quick-actions'
    )!.assignment!;
    quickActions.payload = 'Ctrl+.';
    const properties = profile.slots.find(
      (slot) => slot.assignment?.definitionId === 'figma-properties-menu'
    )!.assignment!;
    const copySvg = properties.children!.find(
      (child) => child.definitionId === 'figma-copy-svg'
    )!;
    copySvg.payload = 'Ctrl+Shift+S';

    const persistedBubbles = slotsToBubbles(profile.slots);
    const materialized = materializeFigmaActionsBinding(persistedBubbles);
    const distribute = materialized.find(
      (bubble) => bubble.definitionId === 'figma-distribute-menu'
    )!;
    const tidy = distribute.children!.find(
      (child) => child.definitionId === 'figma-tidy'
    )!;
    const materializedCopySvg = materialized.find(
      (bubble) => bubble.definitionId === 'figma-properties-menu'
    )!.children!.find((child) => child.definitionId === 'figma-copy-svg')!;

    expect(tidy.payload).toBe('Ctrl+.; delay:250; text:Tidy up; Enter');
    expect(materializedCopySvg.payload).toBe('Ctrl+Shift+S');
    expect(copySvg.payload).toBe('Ctrl+Shift+S');
    expect(materialized.map((bubble) => bubble.id)).toEqual(
      persistedBubbles.map((bubble) => bubble.id)
    );
  });

  it('marks undocumented Figma navigation/resize bindings as experimental', () => {
    for (const id of ['figma-resize-width', 'figma-resize-height', 'figma-walk-frames', 'figma-walk-pages']) {
      expect(APP_ACTION_CATALOG.find((action) => action.id === id)?.verification, id).toBe('unverified');
    }
    expect(APP_ACTION_CATALOG.find((action) => action.id === 'figma-copy-png')?.verification)
      .toBe('unverified');
  });
});
