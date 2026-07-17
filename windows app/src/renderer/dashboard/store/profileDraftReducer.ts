import type { ActionAssignment, RingProfile, RingSlot } from '../../../shared/types';

export interface ProfileDraftState {
  baseProfile: RingProfile | null;
  workingProfile: RingProfile | null;
  selectedSlotId: string | null;
  past: RingSlot[][];
  future: RingSlot[][];
  dirty: boolean;
}

export type ProfileDraftAction =
  | { type: 'load'; profile: RingProfile }
  | { type: 'select-slot'; slotId: string | null }
  | { type: 'replace-assignment'; slotId: string; assignment: ActionAssignment | null }
  | { type: 'replace-slots'; slots: RingSlot[]; selectedSlotId?: string | null }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'cancel' }
  | { type: 'saved'; profile: RingProfile }
  | { type: 'close-editor' };

export const INITIAL_PROFILE_DRAFT: ProfileDraftState = {
  baseProfile: null,
  workingProfile: null,
  selectedSlotId: null,
  past: [],
  future: [],
  dirty: false,
};

function applySlots(
  state: ProfileDraftState,
  slots: RingSlot[],
  selectedSlotId = state.selectedSlotId
): ProfileDraftState {
  if (!state.workingProfile) return state;
  const nextPast = [...state.past, state.workingProfile.slots].slice(-50);
  return {
    ...state,
    workingProfile: { ...state.workingProfile, slots },
    selectedSlotId,
    past: nextPast,
    future: [],
    dirty: true,
  };
}

export function profileDraftReducer(
  state: ProfileDraftState,
  action: ProfileDraftAction
): ProfileDraftState {
  switch (action.type) {
    case 'load':
      return {
        baseProfile: action.profile,
        workingProfile: action.profile,
        selectedSlotId: null,
        past: [],
        future: [],
        dirty: false,
      };
    case 'select-slot':
      return { ...state, selectedSlotId: action.slotId };
    case 'replace-assignment': {
      if (!state.workingProfile) return state;
      const slots = state.workingProfile.slots.map((slot) =>
        slot.id === action.slotId ? { ...slot, assignment: action.assignment } : slot
      );
      return applySlots(state, slots, action.slotId);
    }
    case 'replace-slots':
      return applySlots(state, action.slots, action.selectedSlotId);
    case 'undo': {
      if (!state.workingProfile || state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        ...state,
        workingProfile: { ...state.workingProfile, slots: previous },
        past: state.past.slice(0, -1),
        future: [state.workingProfile.slots, ...state.future],
        dirty: JSON.stringify(previous) !== JSON.stringify(state.baseProfile?.slots ?? []),
      };
    }
    case 'redo': {
      if (!state.workingProfile || state.future.length === 0) return state;
      const next = state.future[0];
      return {
        ...state,
        workingProfile: { ...state.workingProfile, slots: next },
        past: [...state.past, state.workingProfile.slots].slice(-50),
        future: state.future.slice(1),
        dirty: true,
      };
    }
    case 'cancel':
      if (!state.baseProfile) return INITIAL_PROFILE_DRAFT;
      return {
        ...state,
        workingProfile: state.baseProfile,
        selectedSlotId: null,
        past: [],
        future: [],
        dirty: false,
      };
    case 'saved':
      return {
        baseProfile: action.profile,
        workingProfile: action.profile,
        selectedSlotId: null,
        past: [],
        future: [],
        dirty: false,
      };
    case 'close-editor':
      return state.dirty ? state : { ...state, selectedSlotId: null };
    default:
      return state;
  }
}
