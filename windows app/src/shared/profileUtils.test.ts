import { describe, expect, it } from 'vitest';
import type { BubbleConfig, RingProfile } from './types';
import {
  GENERAL_PROFILE_ID,
  bubblesToSlots,
  createEmptySlots,
  createGeneralProfile,
  resolveProfile,
  insertFolderChild,
  moveFolderChild,
  normalizeFolderChildren,
  removeFolderChild,
  replaceFolderChild,
  slotsToBubbles,
} from './profileUtils';

const bubble: BubbleConfig = {
  id: 'bubble-1',
  label: 'Copy',
  iconName: 'Copy',
  angleIndex: 0,
  actionType: 'clipboard-copy',
  type: 'default',
};

function profile(id: string, kind: RingProfile['kind'], processName?: string): RingProfile {
  return {
    id,
    name: id,
    kind,
    enabled: true,
    protected: kind === 'general',
    sortOrder: 0,
    slots: createEmptySlots(),
    application: processName ? { processName, displayName: processName } : undefined,
  };
}

describe('Dashboard V2 profile utilities', () => {
  it('creates five stable empty slots for a blank profile', () => {
    const slots = createEmptySlots();
    expect(slots).toHaveLength(5);
    expect(new Set(slots.map((slot) => slot.id)).size).toBe(5);
    expect(slots.every((slot) => slot.assignment === null)).toBe(true);
  });

  it('round-trips legacy bubbles without losing their IDs or action data', () => {
    const result = slotsToBubbles(bubblesToSlots([bubble]));
    expect(result).toEqual([{ ...bubble, definitionId: 'copy' }]);
  });

  it('maps legacy action types and fill bubbles to catalog definition IDs', () => {
    const copySlot = bubblesToSlots([{ ...bubble, actionType: 'clipboard-copy' }])[0];
    const volumeSlot = bubblesToSlots([{
      ...bubble,
      actionType: 'volume-up',
      type: 'fill',
      scrollUpAction: 'volume-up',
      scrollDownAction: 'volume-down',
    }])[0];
    expect(copySlot.assignment?.definitionId).toBe('copy');
    expect(volumeSlot.assignment?.definitionId).toBe('adjust-volume');
  });

  it('preserves explicit app-action definition IDs through bubble conversion', () => {
    const appBubble: BubbleConfig = {
      ...bubble,
      definitionId: 'photoshop-history',
      actionType: 'keyboard-shortcut',
      type: 'fill',
      payload: 'Ctrl+Z',
      scrollUpAction: 'Ctrl+Shift+Z',
      scrollDownAction: 'Ctrl+Z',
    };
    const result = slotsToBubbles(bubblesToSlots([appBubble]));
    expect(result).toEqual([appBubble]);
  });

  it('creates a protected General profile', () => {
    const general = createGeneralProfile();
    expect(general.id).toBe(GENERAL_PROFILE_ID);
    expect(general.protected).toBe(true);
    expect(general.slots).toHaveLength(5);
  });

  it('resolves manual, application, global, then General precedence', () => {
    const general = profile(GENERAL_PROFILE_ID, 'general');
    const global = profile('global', 'global');
    const chrome = profile('chrome', 'application', 'chrome');
    const profiles = [general, global, chrome];
    const foregroundApp = { processName: 'chrome.exe', executablePath: '', windowTitle: '' };

    expect(resolveProfile({ profiles, generalProfileId: general.id, selectedGlobalProfileId: global.id, foregroundApp, manualOverrideProfileId: general.id })?.id).toBe(general.id);
    expect(resolveProfile({ profiles, generalProfileId: general.id, selectedGlobalProfileId: global.id, foregroundApp })?.id).toBe(chrome.id);
    expect(resolveProfile({ profiles, generalProfileId: general.id, selectedGlobalProfileId: global.id, foregroundApp: null })?.id).toBe(global.id);
    expect(resolveProfile({ profiles, generalProfileId: general.id, selectedGlobalProfileId: null, foregroundApp: null })?.id).toBe(general.id);
  });

  it('round-trips morphing-group children without losing settings', () => {
    const child = { ...bubble, id: 'child-1', parameters: { step: 5 } };
    const menu = { ...bubble, id: 'menu-1', label: 'Tools', type: 'menu' as const, children: [child] };
    expect(slotsToBubbles(bubblesToSlots([menu]))).toEqual([
      { ...menu, definitionId: 'morph-group' },
    ]);
  });

  it('renames the legacy default group label without changing custom names', () => {
    const legacy = bubblesToSlots([{ ...bubble, type: 'menu', label: 'Morphing group', children: [] }])[0];
    const custom = bubblesToSlots([{ ...bubble, type: 'menu', label: 'Tools', children: [] }])[0];
    expect(legacy.assignment?.label).toBe('Submenu');
    expect(custom.assignment?.label).toBe('Tools');
  });

  it('inserts, replaces, reorders, and removes folder children immutably', () => {
    const parent = bubblesToSlots([{ ...bubble, id: 'menu', type: 'menu', children: [] }])[0].assignment!;
    const one = { ...bubble, id: 'one', angleIndex: 5 };
    const two = { ...bubble, id: 'two', angleIndex: 8 };
    const inserted = insertFolderChild(insertFolderChild(parent, 0, one), 1, two);
    expect(inserted.children?.map((child) => [child.id, child.angleIndex])).toEqual([['one', 0], ['two', 1]]);
    const moved = moveFolderChild(inserted, 'two', 0);
    expect(moved.children?.map((child) => child.id)).toEqual(['two', 'one']);
    const replaced = replaceFolderChild(moved, 'one', { ...one, label: 'Updated' });
    expect(replaced.children?.[1].label).toBe('Updated');
    expect(removeFolderChild(replaced, 'two').children?.map((child) => child.id)).toEqual(['one']);
    expect(parent.children).toEqual([]);
  });

  it('rejects duplicate IDs and more than five normalized children', () => {
    expect(() => normalizeFolderChildren([{ ...bubble }, { ...bubble }])).toThrow(/duplicate/i);
    expect(() => normalizeFolderChildren(Array.from({ length: 6 }, (_, index) => ({
      ...bubble,
      id: String(index),
      angleIndex: index,
    })))).toThrow(/at most 5/i);
  });
});
