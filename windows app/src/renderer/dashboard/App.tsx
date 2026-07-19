import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  CopyPlus,
  Globe2,
  Pencil,
  Power,
  PowerOff,
  Redo2,
  Save,
  Trash2,
  Undo2,
} from 'lucide-react';
import { ACTION_DEFINITIONS, createAssignmentFromDefinition, validateAssignment } from '../../shared/actionCatalog';
import {
  assignmentToBubble,
  bubbleToAssignment,
  insertFolderChild,
  moveFolderChild,
  removeFolderChild,
  replaceFolderChild,
} from '../../shared/profileUtils';
import type { MutationResult, RingProfile, RingSlot } from '../../shared/types';
import { Sidebar, type SidebarPage } from './components/Layout/Sidebar';
import { EditableRing } from './components/RingPreview/EditableRing';
import { ActionLibrary, type LibraryMode } from './components/ActionLibrary/ActionLibrary';
import { ActionToolbar } from './components/ActionToolbar/ActionToolbar';
import { GeneralSettings } from './components/General/GeneralSettings';
import { NewProfileModal } from './components/ProfileCreator/NewProfileModal';
import { UnsavedChangesDialog } from './components/UnsavedChangesDialog/UnsavedChangesDialog';
import { ToastRegion, type DashboardToast } from './components/Feedback/ToastRegion';
import { useDashboardStore } from './store/dashboardStore';
import { INITIAL_PROFILE_DRAFT, profileDraftReducer } from './store/profileDraftReducer';
import { useConfig } from './hooks/useConfig';
import { useTheme } from './hooks/useTheme';
import styles from './App.module.css';

type TransitionAction = (profile: RingProfile | null) => void;
type PendingAction = TransitionAction | null;
interface FolderViewState {
  parentSlotId: string;
  selectedChildId: string | null;
}

function cloneProfile(profile: RingProfile, profiles: RingProfile[]): RingProfile {
  return {
    ...profile,
    id: uuidv4(),
    name: `${profile.name} copy`,
    kind: 'global',
    protected: false,
    sortOrder: Math.max(0, ...profiles.map((item) => item.sortOrder)) + 1,
    application: undefined,
    slots: profile.slots.map((slot, position) => ({
      id: uuidv4(),
      position,
      assignment: slot.assignment
        ? {
            ...slot.assignment,
            id: uuidv4(),
            children: slot.assignment.children?.map((child, angleIndex) => ({
              ...child,
              id: uuidv4(),
              angleIndex,
            })),
          }
        : null,
    })),
  };
}

function reindexSlots(slots: RingSlot[]): RingSlot[] {
  return slots.map((slot, position) => ({ ...slot, position }));
}

export function App(): React.ReactElement {
  const [page, setPage] = useState<SidebarPage>('profile');
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [libraryMode, setLibraryMode] = useState<LibraryMode>('actions');
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string | null>(null);
  const [folderView, setFolderView] = useState<FolderViewState | null>(null);
  const [showNewProfile, setShowNewProfile] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<DashboardToast[]>([]);
  const [editingHeaderName, setEditingHeaderName] = useState(false);
  const [draft, dispatchDraft] = useReducer(profileDraftReducer, INITIAL_PROFILE_DRAFT);
  const draftRef = useRef(draft);
  const headerNameRef = useRef<HTMLHeadingElement | null>(null);
  const lastEditedSlotIdRef = useRef<string | null>(null);
  const wasToolbarOpenRef = useRef(false);
  draftRef.current = draft;

  const showToast = useCallback((message: string, tone: DashboardToast['tone'] = 'neutral') => {
    const toast = { id: Date.now() + Math.random(), message, tone };
    setToasts((current) => [...current, toast].slice(-2));
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const { config, isLoading } = useConfig();
  useTheme();
  const saveProfile = useDashboardStore((state) => state.saveProfile);
  const addProfile = useDashboardStore((state) => state.addProfile);
  const removeProfile = useDashboardStore((state) => state.removeProfile);
  const setSelectedGlobalProfile = useDashboardStore((state) => state.setSelectedGlobalProfile);

  const profiles = config?.profiles ?? [];
  const workingProfile = draft.workingProfile;
  const selectedSlot = workingProfile?.slots.find((slot) => slot.id === draft.selectedSlotId) ?? null;
  const baseSelectedSlot = draft.baseProfile?.slots.find((slot) => slot.id === draft.selectedSlotId) ?? null;
  const folderParentSlot = folderView
    ? workingProfile?.slots.find((slot) => slot.id === folderView.parentSlotId) ?? null
    : null;
  const folderParentAssignment = folderParentSlot?.assignment?.type === 'menu'
    ? folderParentSlot.assignment
    : null;
  const selectedChild = folderView?.selectedChildId
    ? folderParentAssignment?.children?.find((child) => child.id === folderView.selectedChildId) ?? null
    : null;
  const toolbarAssignment = selectedChild
    ? bubbleToAssignment(selectedChild)
    : selectedSlot?.assignment ?? null;
  const toolbarOpen = Boolean(
    draft.selectedSlotId && (toolbarAssignment || baseSelectedSlot?.assignment)
  );

  useEffect(() => {
    const wasOpen = wasToolbarOpenRef.current;
    wasToolbarOpenRef.current = toolbarOpen;
    if (!wasOpen || toolbarOpen || !lastEditedSlotIdRef.current) return;
    const slotId = lastEditedSlotIdRef.current;
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-ring-slot-id="${CSS.escape(slotId)}"]`)?.focus();
    });
  }, [toolbarOpen]);

  useEffect(() => {
    if (!config || draft.workingProfile) return;
    const initial = config.profiles.find((profile) => profile.id === config.generalProfileId) ?? config.profiles[0];
    if (!initial) return;
    setSelectedProfileId(initial.id);
    dispatchDraft({ type: 'load', profile: initial });
  }, [config, draft.workingProfile]);

  useEffect(() => {
    setEditingHeaderName(false);
  }, [workingProfile?.id]);

  useEffect(() => {
    if (!editingHeaderName || !headerNameRef.current) return;
    headerNameRef.current.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(headerNameRef.current);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editingHeaderName]);

  useEffect(() => {
    window.electronAPI.setDashboardDirty(draft.dirty);
    return () => window.electronAPI.setDashboardDirty(false);
  }, [draft.dirty]);

  useEffect(() => {
    if (!folderView) return;
    if (!folderParentAssignment) {
      setFolderView(null);
      return;
    }
    if (folderView.selectedChildId && !selectedChild) {
      setFolderView((current) => current ? { ...current, selectedChildId: null } : null);
    }
  }, [folderParentAssignment, folderView, selectedChild]);

  const validateDraft = (): string | null => {
    if (!workingProfile) return 'No profile is selected.';
    if (workingProfile.slots.length < 2 || workingProfile.slots.length > 12) return 'A ring must contain between two and twelve bubbles.';
    for (const slot of workingProfile.slots) {
      if (!slot.assignment) continue;
      if (!slot.assignment.label.trim()) return 'Every assigned bubble needs a label.';
      const assignmentError = validateAssignment(slot.assignment);
      if (assignmentError) {
        dispatchDraft({ type: 'select-slot', slotId: slot.id });
        return `${slot.assignment.label}: ${assignmentError}`;
      }
    }
    return null;
  };

  const handleSave = async (): Promise<RingProfile | null> => {
    if (!workingProfile || saving) return null;
    if (!draft.dirty) return workingProfile;
    const validationError = validateDraft();
    if (validationError) {
      setError(validationError);
      return null;
    }
    setSaving(true);
    setError(null);
    const result = await saveProfile(workingProfile);
    setSaving(false);
    if (result.status !== 'ok') {
      setError(result.message ?? 'The profile could not be saved.');
      return null;
    }
    const savedProfile = result.value ?? workingProfile;
    dispatchDraft({ type: 'saved', profile: savedProfile });
    showToast('Profile saved.', 'success');
    if (folderView && savedProfile.slots.some((slot) => slot.id === folderView.parentSlotId && slot.assignment?.type === 'menu')) {
      dispatchDraft({ type: 'select-slot', slotId: folderView.parentSlotId });
    }
    setSelectedDefinitionId(null);
    return savedProfile;
  };

  const requestTransition = (action: TransitionAction) => {
    const currentDraft = draftRef.current;
    if (currentDraft.dirty) {
      setError(null);
      setPendingAction(() => action);
      return;
    }
    action(currentDraft.workingProfile);
  };

  useEffect(() => {
    return window.electronAPI.onDashboardCloseRequested(() => {
      if (draft.dirty) {
        setError(null);
        setPendingAction(() => () => window.electronAPI.approveDashboardClose());
      }
      else window.electronAPI.approveDashboardClose();
    });
  }, [draft.dirty]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editingText = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT';
      if (event.ctrlKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
      } else if (event.ctrlKey && !editingText && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatchDraft({ type: event.shiftKey ? 'redo' : 'undo' });
      } else if (event.ctrlKey && !editingText && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        dispatchDraft({ type: 'redo' });
      } else if (event.key === 'Escape' && !editingText) {
        if (showNewProfile) setShowNewProfile(false);
        else if (folderView) {
          setFolderView(null);
          setSelectedDefinitionId(null);
        }
        else if (toolbarOpen) requestTransition(() => dispatchDraft({ type: 'close-editor' }));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const loadProfile = (profile: RingProfile) => {
    setPage('profile');
    setSelectedProfileId(profile.id);
    setSelectedDefinitionId(null);
    setFolderView(null);
    setError(null);
    dispatchDraft({ type: 'load', profile });
  };

  const openProfile = (profile: RingProfile) => {
    requestTransition(() => loadProfile(profile));
  };

  const openSettings = () => {
    requestTransition(() => {
      setPage('settings');
      setSelectedDefinitionId(null);
      setFolderView(null);
      dispatchDraft({ type: 'close-editor' });
    });
  };

  const selectSlot = (slotId: string) => {
    lastEditedSlotIdRef.current = slotId;
    setFolderView(null);
    dispatchDraft({ type: 'select-slot', slotId });
  };

  const openFolder = (slotId: string) => {
    const slot = workingProfile?.slots.find((item) => item.id === slotId);
    if (slot?.assignment?.type !== 'menu') return;
    lastEditedSlotIdRef.current = slotId;
    dispatchDraft({ type: 'select-slot', slotId });
    setFolderView({ parentSlotId: slotId, selectedChildId: null });
    setSelectedDefinitionId(null);
    setError(null);
  };

  const closeFolder = () => {
    const parentSlotId = folderView?.parentSlotId;
    setFolderView(null);
    setSelectedDefinitionId(null);
    setError(null);
    if (parentSlotId) {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-ring-slot-id="${CSS.escape(parentSlotId)}"]`)?.focus();
      });
    }
  };

  const assignDefinition = (slotId: string, definitionId: string) => {
    const definition = ACTION_DEFINITIONS.get(definitionId);
    if (!definition || definition.availability === 'requires-device' || definition.availability === 'requires-plugin') {
      setError(definition?.unavailableReason ?? 'This action is unavailable.');
      return;
    }
    const assignment = createAssignmentFromDefinition(definitionId);
    if (!assignment) return;
    lastEditedSlotIdRef.current = slotId;
    dispatchDraft({ type: 'replace-assignment', slotId, assignment });
    setSelectedDefinitionId(null);
    setError(null);
  };

  const reorderSlots = (sourceSlotId: string, targetSlotId: string) => {
    if (!workingProfile) return;
    const sourceIndex = workingProfile.slots.findIndex((slot) => slot.id === sourceSlotId);
    const targetIndex = workingProfile.slots.findIndex((slot) => slot.id === targetSlotId);
    if (sourceIndex === -1 || targetIndex === -1) return;
    const slots = [...workingProfile.slots];
    const [source] = slots.splice(sourceIndex, 1);
    slots.splice(targetIndex, 0, source);
    dispatchDraft({ type: 'replace-slots', slots: reindexSlots(slots), selectedSlotId: sourceSlotId });
  };

  const assignChildDefinition = (index: number, definitionId: string, replaceChildId?: string) => {
    if (!folderView || !folderParentAssignment) return;
    const definition = ACTION_DEFINITIONS.get(definitionId);
    if (!definition || definition.bubbleType === 'menu') {
      setError('Nested submenus are not available in this version.');
      return;
    }
    const assignment = createAssignmentFromDefinition(definitionId);
    if (!assignment) {
      setError(definition?.unavailableReason ?? 'This action is unavailable.');
      return;
    }
    const child = assignmentToBubble(assignment, index);
    try {
      const nextParent = replaceChildId
        ? replaceFolderChild(folderParentAssignment, replaceChildId, child)
        : insertFolderChild(folderParentAssignment, index, child);
      const selectedChildId = replaceChildId ?? child.id;
      dispatchDraft({ type: 'replace-assignment', slotId: folderView.parentSlotId, assignment: nextParent });
      setFolderView({ parentSlotId: folderView.parentSlotId, selectedChildId });
      setSelectedDefinitionId(null);
      setError(null);
    } catch (childError) {
      setError(childError instanceof Error ? childError.message : 'The child action could not be assigned.');
    }
  };

  const reorderChild = (childId: string, targetIndex: number) => {
    if (!folderView || !folderParentAssignment) return;
    try {
      const nextParent = moveFolderChild(folderParentAssignment, childId, targetIndex);
      dispatchDraft({ type: 'replace-assignment', slotId: folderView.parentSlotId, assignment: nextParent });
      setFolderView({ parentSlotId: folderView.parentSlotId, selectedChildId: childId });
      setError(null);
    } catch (childError) {
      setError(childError instanceof Error ? childError.message : 'The child action could not be moved.');
    }
  };

  const selectChild = (childId: string) => {
    if (!folderView) return;
    setFolderView({ ...folderView, selectedChildId: childId });
    setSelectedDefinitionId(null);
    setError(null);
  };

  const addSlot = () => {
    if (!workingProfile || workingProfile.slots.length >= 12) return;
    const newSlot: RingSlot = { id: uuidv4(), position: workingProfile.slots.length, assignment: null };
    dispatchDraft({ type: 'replace-slots', slots: [...workingProfile.slots, newSlot], selectedSlotId: newSlot.id });
  };

  const removeSlot = (slotId: string) => {
    if (!workingProfile || workingProfile.slots.length <= 2) return;
    dispatchDraft({
      type: 'replace-slots',
      slots: reindexSlots(workingProfile.slots.filter((slot) => slot.id !== slotId)),
      selectedSlotId: draft.selectedSlotId === slotId ? null : draft.selectedSlotId,
    });
  };

  const updateSelectedAssignment = (assignment: NonNullable<RingSlot['assignment']>) => {
    if (!draft.selectedSlotId) return;
    if (folderView?.selectedChildId && selectedChild && folderParentAssignment) {
      const child = assignmentToBubble({ ...assignment, id: selectedChild.id }, selectedChild.angleIndex);
      try {
        const parent = replaceFolderChild(folderParentAssignment, selectedChild.id, child);
        dispatchDraft({ type: 'replace-assignment', slotId: folderView.parentSlotId, assignment: parent });
        setError(null);
      } catch (childError) {
        setError(childError instanceof Error ? childError.message : 'The child action could not be updated.');
      }
      return;
    }
    dispatchDraft({ type: 'replace-assignment', slotId: draft.selectedSlotId, assignment });
    setError(null);
  };

  const removeToolbarAssignment = () => {
    if (folderView?.selectedChildId && folderParentAssignment) {
      const parent = removeFolderChild(folderParentAssignment, folderView.selectedChildId);
      dispatchDraft({ type: 'replace-assignment', slotId: folderView.parentSlotId, assignment: parent });
      setFolderView({ parentSlotId: folderView.parentSlotId, selectedChildId: null });
      return;
    }
    if (draft.selectedSlotId) {
      dispatchDraft({ type: 'replace-assignment', slotId: draft.selectedSlotId, assignment: null });
    }
  };

  const handleCreateProfile = async (profile: RingProfile): Promise<MutationResult<RingProfile>> => {
    const result = await addProfile(profile);
    if (result.status === 'ok') {
      const created = result.value ?? profile;
      setShowNewProfile(false);
      setPage('profile');
      setSelectedProfileId(created.id);
      dispatchDraft({ type: 'load', profile: created });
      showToast('Profile created.', 'success');
    }
    return result;
  };

  const renameProfileById = (profileId: string, requestedName: string) => {
    const profile = profiles.find((item) => item.id === profileId);
    const name = requestedName.trim();
    if (!profile || profile.protected || !name || name === profile.name) return;

    const persistRename = (sourceProfile: RingProfile) => {
      const next = { ...sourceProfile, name };
      setError(null);
      void saveProfile(next).then((result) => {
        if (result.status !== 'ok') {
          setError(result.message ?? 'Could not rename this profile.');
          return;
        }
        if (sourceProfile.id === workingProfile?.id) {
          dispatchDraft({ type: 'saved', profile: result.value ?? next });
        }
      });
    };

    if (profile.id === workingProfile?.id) {
      requestTransition((sourceProfile) => {
        if (sourceProfile?.id === profile.id) persistRename(sourceProfile);
      });
    } else {
      persistRename(profile);
    }
  };

  const finishHeaderRename = (save: boolean) => {
    if (!workingProfile) return;
    const name = headerNameRef.current?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    setEditingHeaderName(false);
    if (save && name && name !== workingProfile.name) {
      renameProfileById(workingProfile.id, name);
    }
  };

  const withProfileForMutation = (
    profileId: string,
    mutation: (profile: RingProfile) => void,
  ) => {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) return;
    if (profile.id === workingProfile?.id) {
      requestTransition((sourceProfile) => {
        if (sourceProfile?.id === profile.id) mutation(sourceProfile);
      });
      return;
    }
    mutation(profile);
  };

  const duplicateProfileById = (profileId: string) => {
    withProfileForMutation(profileId, (sourceProfile) => {
      const duplicate = cloneProfile(sourceProfile, profiles);
      void addProfile(duplicate).then((result) => {
        if (result.status === 'ok') {
          loadProfile(result.value ?? duplicate);
          showToast('Profile duplicated.', 'success');
        } else {
          setError(result.message ?? 'Could not duplicate this profile.');
        }
      });
    });
  };

  const toggleProfileById = (profileId: string) => {
    withProfileForMutation(profileId, (sourceProfile) => {
      if (sourceProfile.protected) return;
      const next = { ...sourceProfile, enabled: !sourceProfile.enabled };
      void saveProfile(next).then((result) => {
        if (result.status === 'ok') {
          if (sourceProfile.id === workingProfile?.id) {
            dispatchDraft({ type: 'saved', profile: result.value ?? next });
          }
          showToast(next.enabled ? 'Profile enabled.' : 'Profile disabled.', 'success');
        } else {
          setError(result.message ?? 'Could not update this profile.');
        }
      });
    });
  };

  const deleteProfileById = (profileId: string) => {
    withProfileForMutation(profileId, (sourceProfile) => {
      if (sourceProfile.protected) return;
      if (!window.confirm(`Delete "${sourceProfile.name}"? This cannot be undone.`)) return;
      void removeProfile(sourceProfile.id).then((result) => {
        if (result.status !== 'ok') {
          setError(result.message ?? 'Could not delete this profile.');
          return;
        }
        const refreshed = useDashboardStore.getState().config;
        const general = refreshed?.profiles.find((profile) => profile.id === refreshed.generalProfileId);
        if (general) {
          setSelectedProfileId(general.id);
          dispatchDraft({ type: 'load', profile: general });
        }
        showToast('Profile removed.', 'success');
      });
    });
  };

  const reorderProfiles = (sourceProfileId: string, targetProfileId: string) => {
    if (sourceProfileId === targetProfileId) return;
    requestTransition(() => {
      const currentProfiles = [...(useDashboardStore.getState().config?.profiles ?? [])]
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const sourceIndex = currentProfiles.findIndex((profile) => profile.id === sourceProfileId);
      const targetIndex = currentProfiles.findIndex((profile) => profile.id === targetProfileId);
      if (sourceIndex < 0 || targetIndex < 0) return;

      const reordered = [...currentProfiles];
      const [source] = reordered.splice(sourceIndex, 1);
      reordered.splice(targetIndex, 0, source);
      const changed = reordered
        .map((profile, sortOrder) => ({ ...profile, sortOrder }))
        .filter((profile) => currentProfiles.find((item) => item.id === profile.id)?.sortOrder !== profile.sortOrder);

      void (async () => {
        for (const profile of changed) {
          const result = await saveProfile(profile);
          if (result.status !== 'ok') {
            setError(result.message ?? 'Could not reorder profiles.');
            return;
          }
          if (profile.id === workingProfile?.id) {
            dispatchDraft({ type: 'saved', profile: result.value ?? profile });
          }
        }
        showToast('Profiles reordered.', 'success');
      })();
    });
  };

  const moveProfile = (profileId: string, direction: 'up' | 'down') => {
    const ordered = [...profiles].sort((a, b) => a.sortOrder - b.sortOrder);
    const index = ordered.findIndex((profile) => profile.id === profileId);
    const target = ordered[index + (direction === 'up' ? -1 : 1)];
    if (target) reorderProfiles(profileId, target.id);
  };

  if (isLoading || !config || !workingProfile) {
    return <div className={styles.loading}><span /><strong>Preparing Dashboard V2</strong><small>Loading profiles and action definitions...</small></div>;
  }

  return (
    <div className={styles.app}>
      <Sidebar
        activePage={page}
        profiles={profiles}
        activeProfileId={selectedProfileId}
        hasUnsavedChanges={draft.dirty}
        onSelectProfile={(id) => {
          const profile = profiles.find((item) => item.id === id);
          if (profile) openProfile(profile);
        }}
        onRenameProfile={renameProfileById}
        onDuplicateProfile={duplicateProfileById}
        onToggleProfile={toggleProfileById}
        onRemoveProfile={deleteProfileById}
        onMoveProfile={moveProfile}
        onReorderProfiles={reorderProfiles}
        onAddProfile={() => requestTransition(() => setShowNewProfile(true))}
        onOpenSettings={openSettings}
      />

      <main className={styles.main}>
        {page === 'settings' ? (
          <GeneralSettings />
        ) : (
          <>
            <header className={styles.profileHeader}>
              <div className={styles.profileTitle}>
                <span>{workingProfile.kind === 'application' ? workingProfile.application?.processName ?? 'Application' : workingProfile.kind === 'general' ? 'Automatic fallback' : 'Global profile'}</span>
                <div className={styles.profileNameRow}>
                  <h1
                    key={`${workingProfile.id}:${editingHeaderName ? 'editing' : 'label'}:${workingProfile.name}`}
                    ref={editingHeaderName ? headerNameRef : undefined}
                    className={editingHeaderName ? styles.profileNameEditing : undefined}
                    contentEditable={editingHeaderName}
                    suppressContentEditableWarning
                    spellCheck={false}
                    onDoubleClick={() => {
                      if (!workingProfile.protected) setEditingHeaderName(true);
                    }}
                    onKeyDown={(event) => {
                      if (!editingHeaderName) return;
                      event.stopPropagation();
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        finishHeaderRename(true);
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        finishHeaderRename(false);
                      }
                    }}
                    onBlur={() => {
                      if (editingHeaderName) finishHeaderRename(false);
                    }}
                  >
                    {workingProfile.name}
                  </h1>
                  {!workingProfile.protected && !editingHeaderName && (
                    <button
                      type="button"
                      className={styles.renameProfileButton}
                      onClick={() => setEditingHeaderName(true)}
                      aria-label={`Rename ${workingProfile.name}`}
                      title="Rename profile"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                </div>
              </div>
              <div className={styles.headerStatus}>
                {workingProfile.kind === 'global' && (
                  <button
                    type="button"
                    className={config.selectedGlobalProfileId === workingProfile.id ? styles.globalActive : ''}
                    onClick={() => requestTransition((sourceProfile) => {
                      if (!sourceProfile || sourceProfile.kind !== 'global') return;
                      const nextId = config.selectedGlobalProfileId === sourceProfile.id ? null : sourceProfile.id;
                      void setSelectedGlobalProfile(nextId).then((result) => {
                        if (result.status !== 'ok') setError(result.message ?? 'Could not change the active global profile.');
                      });
                    })}
                    title="Use this profile when no application profile matches"
                  ><Globe2 size={14} /> {config.selectedGlobalProfileId === workingProfile.id ? 'Active global' : 'Use globally'}</button>
                )}
                {draft.dirty && <span className={styles.unsaved}>Draft not saved</span>}
              </div>
              <div className={styles.headerActions}>
                <button type="button" onClick={() => dispatchDraft({ type: 'undo' })} disabled={draft.past.length === 0} title="Undo (Ctrl+Z)"><Undo2 size={15} /></button>
                <button type="button" onClick={() => dispatchDraft({ type: 'redo' })} disabled={draft.future.length === 0} title="Redo (Ctrl+Y)"><Redo2 size={15} /></button>
                <button type="button" onClick={() => duplicateProfileById(workingProfile.id)} title="Duplicate profile"><CopyPlus size={15} /></button>
                {!workingProfile.protected && <button type="button" onClick={() => toggleProfileById(workingProfile.id)} title={workingProfile.enabled ? 'Disable profile' : 'Enable profile'}>{workingProfile.enabled ? <Power size={15} /> : <PowerOff size={15} />}</button>}
                {!workingProfile.protected && <button type="button" className={styles.deleteAction} onClick={() => deleteProfileById(workingProfile.id)} title="Delete profile"><Trash2 size={15} /></button>}
                {draft.dirty && <button type="button" className={styles.headerSave} onClick={() => void handleSave()} disabled={saving}><Save size={14} /> {saving ? 'Saving' : 'Save'}</button>}
              </div>
            </header>

            <div className={styles.workspace}>
              <div className={`${styles.ringPane}${toolbarOpen ? ` ${styles.ringPaneCompact}` : ''}`}>
                <EditableRing
                  profile={workingProfile}
                  selectedSlotId={draft.selectedSlotId}
                  selectedDefinitionId={selectedDefinitionId}
                  compact={toolbarOpen}
                  folderParentSlotId={folderView?.parentSlotId ?? null}
                  selectedChildId={folderView?.selectedChildId ?? null}
                  onSelectSlot={selectSlot}
                  onAssignDefinition={assignDefinition}
                  onReorderSlots={reorderSlots}
                  onOpenFolder={openFolder}
                  onBackFolder={closeFolder}
                  onSelectChild={selectChild}
                  onAssignChildDefinition={assignChildDefinition}
                  onReorderChild={reorderChild}
                />
              </div>

              {toolbarOpen && (
                <ActionToolbar
                  assignment={toolbarAssignment}
                  profiles={profiles}
                  dirty={draft.dirty}
                  saving={saving}
                  error={error}
                  onChange={updateSelectedAssignment}
                  onSave={() => void handleSave()}
                  onCancel={() => {
                    dispatchDraft({ type: 'cancel' });
                    setFolderView(null);
                    setSelectedDefinitionId(null);
                    setError(null);
                  }}
                  onClose={() => {
                    if (folderView?.selectedChildId) {
                      setFolderView({ parentSlotId: folderView.parentSlotId, selectedChildId: null });
                      return;
                    }
                    requestTransition(() => dispatchDraft({ type: 'close-editor' }));
                  }}
                  onOpenGroup={() => draft.selectedSlotId && openFolder(draft.selectedSlotId)}
                  onRemove={removeToolbarAssignment}
                />
              )}

              <ActionLibrary
                mode={libraryMode}
                profile={workingProfile}
                selectedDefinitionId={selectedDefinitionId}
                selectedSlotId={draft.selectedSlotId}
                onModeChange={setLibraryMode}
                onSelectDefinition={(definitionId) => {
                  setSelectedDefinitionId(definitionId);
                  setLibraryMode('actions');
                  setError(null);
                }}
                onSelectSlot={selectSlot}
                onReorderSlots={reorderSlots}
                onAddSlot={addSlot}
                onRemoveSlot={removeSlot}
                folderChildren={folderView && folderParentAssignment ? folderParentAssignment.children ?? [] : null}
                selectedChildId={folderView?.selectedChildId ?? null}
                onSelectChild={selectChild}
                onReorderChild={reorderChild}
                onRemoveChild={(childId) => {
                  if (!folderView || !folderParentAssignment) return;
                  const parent = removeFolderChild(folderParentAssignment, childId);
                  dispatchDraft({ type: 'replace-assignment', slotId: folderView.parentSlotId, assignment: parent });
                  if (folderView.selectedChildId === childId) {
                    setFolderView({ parentSlotId: folderView.parentSlotId, selectedChildId: null });
                  }
                }}
              />
            </div>
          </>
        )}
      </main>

      {showNewProfile && (
        <NewProfileModal
          profiles={profiles}
          generalProfile={profiles.find((profile) => profile.id === config.generalProfileId) ?? workingProfile}
          onCancel={() => setShowNewProfile(false)}
          onCreate={handleCreateProfile}
        />
      )}

      {pendingAction && (
        <UnsavedChangesDialog
          profileName={workingProfile?.name || 'this profile'}
          saving={saving}
          error={error}
          onKeepEditing={() => {
            setError(null);
            setPendingAction(null);
          }}
          onDiscard={() => {
            const action = pendingAction;
            const baseProfile = draft.baseProfile;
            setPendingAction(null);
            dispatchDraft({ type: 'cancel' });
            action(baseProfile);
          }}
          onSave={() => {
            const action = pendingAction;
            void handleSave().then((savedProfile) => {
              if (!savedProfile) return;
              setPendingAction(null);
              action(savedProfile);
            });
          }}
        />
      )}
      <ToastRegion toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
