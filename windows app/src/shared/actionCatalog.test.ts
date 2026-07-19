import { describe, expect, it } from 'vitest';
import { ACTION_CATALOG, createAssignmentFromDefinition, validateAssignment } from './actionCatalog';

describe('Dashboard V2 action catalog', () => {
  it('contains unique stable definition IDs', () => {
    const ids = ACTION_CATALOG.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers every requested action family', () => {
    expect(new Set(ACTION_CATALOG.map((item) => item.category))).toEqual(
      new Set(['system', 'adjustments', 'basic', 'structural', 'app', 'custom'])
    );
    for (const id of ['copy', 'screenshot-region', 'volume-up', 'adjust-volume', 'keystroke-sequence', 'open-folder', 'run-command', 'switch-profile', 'morph-group', 'photoshop-history', 'figma-auto-layout', 'easy-switch-1', 'custom-action']) {
      expect(ACTION_CATALOG.some((item) => item.id === id), id).toBe(true);
    }
  });

  it('creates assignments only for available actions', () => {
    expect(createAssignmentFromDefinition('copy')?.actionType).toBe('clipboard-copy');
    expect(createAssignmentFromDefinition('easy-switch-1')).toBeNull();
    expect(createAssignmentFromDefinition('adjust-plugin')).toBeNull();
    expect(createAssignmentFromDefinition('adjust-volume')?.parameters).toMatchObject({ step: 5, clickAction: 'volume-mute' });
    expect(createAssignmentFromDefinition('open-app')?.parameters?.focusIfRunning).toBe(true);
    expect(createAssignmentFromDefinition('morph-group')?.label).toBe('Submenu');
    const setupAction = createAssignmentFromDefinition('photoshop-brightness-contrast');
    expect(setupAction?.parameters).toMatchObject({ requiresSetup: true });
    expect(validateAssignment(setupAction!)).toBeNull();
    const aiLauncher = createAssignmentFromDefinition('ai-launcher');
    expect(aiLauncher?.label).toBe('ChatGPT');
    expect(aiLauncher?.payload).toBe('https://chatgpt.com');
    expect(aiLauncher?.parameters?.aiProvider).toBe('chatgpt');
    expect(aiLauncher?.iconDataUrl).toMatch(/^data:image\/svg\+xml/);
  });

  it('validates required targets and the five-child submenu limit', () => {
    const url = createAssignmentFromDefinition('open-url');
    expect(url).not.toBeNull();
    expect(validateAssignment(url!)).toMatch(/required/i);

    const group = createAssignmentFromDefinition('morph-group');
    expect(group).not.toBeNull();
    group!.children = Array.from({ length: 6 }, (_, index) => ({
      id: String(index),
      label: String(index),
      iconName: 'Circle',
      angleIndex: index,
      actionType: 'do-nothing',
    }));
    expect(validateAssignment(group!)).toMatch(/five/i);
  });

  it('validates required adjustment and macro fields', () => {
    const pair = createAssignmentFromDefinition('adjust-shortcut-pair');
    expect(pair).not.toBeNull();
    expect(validateAssignment(pair!)).toMatch(/required/i);

    pair!.scrollUpAction = 'Ctrl+Up';
    pair!.scrollDownAction = 'Ctrl+Down';
    expect(validateAssignment(pair!)).toBeNull();

    const macro = createAssignmentFromDefinition('custom-action');
    expect(macro).not.toBeNull();
    expect(validateAssignment(macro!)).toMatch(/required/i);

    const keyboardMacro = createAssignmentFromDefinition('keystroke-sequence')!;
    keyboardMacro.payload = 'Ctrl+K\n250ms\nCtrl+S';
    expect(validateAssignment(keyboardMacro)).toBeNull();
    keyboardMacro.payload = 'Ctrl+K\nnot/a/chord';
    expect(validateAssignment(keyboardMacro)).toMatch(/not a recognized key/i);
    keyboardMacro.payload = 'Ctrl+K\nCtrl';
    expect(validateAssignment(keyboardMacro)).toMatch(/main key/i);
  });

  it('validates child actions and blocks F4.2 nesting', () => {
    const group = createAssignmentFromDefinition('morph-group')!;
    const custom = createAssignmentFromDefinition('custom-action')!;
    custom.payload = 'Ctrl+Shift+P';
    group.children = [{
      id: custom.id,
      label: custom.label,
      iconName: custom.iconName,
      angleIndex: 0,
      actionType: custom.actionType,
      payload: custom.payload,
      type: custom.type,
    }];
    expect(validateAssignment(group)).toBeNull();
    group.children[0] = { ...group.children[0], type: 'menu' };
    expect(validateAssignment(group)).toMatch(/nested/i);
  });
});
