import { describe, expect, it } from 'vitest';
import { createGeneralProfile } from '../../../shared/profileUtils';
import { createAssignmentFromDefinition } from '../../../shared/actionCatalog';
import { assignmentToBubble } from '../../../shared/profileUtils';
import { INITIAL_PROFILE_DRAFT, profileDraftReducer } from './profileDraftReducer';

describe('profile draft reducer', () => {
  it('keeps assignment edits local and cancel restores the base profile', () => {
    const profile = createGeneralProfile();
    let state = profileDraftReducer(INITIAL_PROFILE_DRAFT, { type: 'load', profile });
    state = profileDraftReducer(state, {
      type: 'replace-assignment',
      slotId: profile.slots[0].id,
      assignment: createAssignmentFromDefinition('copy'),
    });
    expect(state.dirty).toBe(true);
    expect(state.workingProfile?.slots[0].assignment?.definitionId).toBe('copy');
    expect(state.baseProfile?.slots[0].assignment).toBeNull();

    state = profileDraftReducer(state, { type: 'cancel' });
    expect(state.dirty).toBe(false);
    expect(state.workingProfile?.slots[0].assignment).toBeNull();
  });

  it('supports undo and redo for slot edits', () => {
    const profile = createGeneralProfile();
    let state = profileDraftReducer(INITIAL_PROFILE_DRAFT, { type: 'load', profile });
    state = profileDraftReducer(state, {
      type: 'replace-assignment',
      slotId: profile.slots[0].id,
      assignment: createAssignmentFromDefinition('copy'),
    });
    state = profileDraftReducer(state, { type: 'undo' });
    expect(state.workingProfile?.slots[0].assignment).toBeNull();
    state = profileDraftReducer(state, { type: 'redo' });
    expect(state.workingProfile?.slots[0].assignment?.definitionId).toBe('copy');
  });

  it('keeps morphing-group child edits in undo, redo, and cancel history', () => {
    const profile = createGeneralProfile();
    const group = createAssignmentFromDefinition('morph-group')!;
    const copy = createAssignmentFromDefinition('copy')!;
    group.children = [assignmentToBubble(copy, 0)];
    profile.slots[0] = { ...profile.slots[0], assignment: group };

    let state = profileDraftReducer(INITIAL_PROFILE_DRAFT, { type: 'load', profile });
    const changed = {
      ...group,
      children: group.children.map((child) => ({ ...child, label: 'Updated child' })),
    };
    state = profileDraftReducer(state, {
      type: 'replace-assignment',
      slotId: profile.slots[0].id,
      assignment: changed,
    });
    expect(state.workingProfile?.slots[0].assignment?.children?.[0].label).toBe('Updated child');
    state = profileDraftReducer(state, { type: 'undo' });
    expect(state.workingProfile?.slots[0].assignment?.children?.[0].label).toBe('Copy');
    state = profileDraftReducer(state, { type: 'redo' });
    expect(state.workingProfile?.slots[0].assignment?.children?.[0].label).toBe('Updated child');
    state = profileDraftReducer(state, { type: 'cancel' });
    expect(state.workingProfile?.slots[0].assignment?.children?.[0].label).toBe('Copy');
  });
});
