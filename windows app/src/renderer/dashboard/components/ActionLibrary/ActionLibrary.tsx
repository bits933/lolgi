import React, { useMemo, useState } from 'react';
import * as LucideIcons from 'lucide-react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  LockKeyhole,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { ACTION_CATALOG } from '../../../../shared/actionCatalog';
import { MAX_FOLDER_CHILDREN } from '../../../../shared/constants';
import { getSupportedAppId, SUPPORTED_APP_LABELS } from '../../../../shared/defaultProfiles';
import type { ActionCategory, ActionDefinition, BubbleConfig, RingProfile, RingSlot } from '../../../../shared/types';
import styles from './ActionLibrary.module.css';

type AnyIcon = React.ComponentType<{ size?: number; strokeWidth?: number }>;
export type LibraryMode = 'actions' | 'bubbles';

const SECTIONS: Array<{ category: ActionCategory; label: string }> = [
  { category: 'system', label: 'System actions' },
  { category: 'adjustments', label: 'Adjustment actions' },
  { category: 'basic', label: 'Basic actions' },
  { category: 'structural', label: 'Submenu' },
  { category: 'app', label: 'App actions' },
];

function resolveIcon(name: string): AnyIcon {
  return (LucideIcons as unknown as Record<string, AnyIcon>)[name] ?? LucideIcons.Circle;
}

interface ActionLibraryProps {
  mode: LibraryMode;
  profile: RingProfile;
  selectedDefinitionId: string | null;
  selectedSlotId: string | null;
  onModeChange: (mode: LibraryMode) => void;
  onSelectDefinition: (definitionId: string) => void;
  onSelectSlot: (slotId: string) => void;
  onReorderSlots: (sourceSlotId: string, targetSlotId: string) => void;
  onAddSlot: () => void;
  onRemoveSlot: (slotId: string) => void;
  folderChildren: BubbleConfig[] | null;
  selectedChildId: string | null;
  onSelectChild: (childId: string) => void;
  onReorderChild: (childId: string, targetIndex: number) => void;
  onRemoveChild: (childId: string) => void;
}

function ActionCard({
  definition,
  selected,
  onSelect,
}: {
  definition: ActionDefinition;
  selected: boolean;
  onSelect: () => void;
}): React.ReactElement {
  const Icon = resolveIcon(definition.iconName);
  const unavailable = definition.availability === 'requires-device' || definition.availability === 'requires-plugin';
  const requiresSetup = definition.availability === 'requires-setup';

  return (
    <button
      type="button"
      className={`${styles.actionCard}${selected ? ` ${styles.actionCardSelected}` : ''}${unavailable ? ` ${styles.actionCardDisabled}` : ''}`}
      onClick={onSelect}
      draggable={!unavailable}
      disabled={unavailable}
      title={unavailable
        ? definition.unavailableReason
        : requiresSetup
          ? `${definition.label}: one-time shortcut setup required`
          : `Add ${definition.label}`}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('application/x-action-definition', definition.id);
      }}
    >
      <span className={styles.actionGrip}><GripVertical size={13} /></span>
      <span className={styles.actionIcon}><Icon size={18} strokeWidth={1.9} /></span>
      <span className={styles.actionCopy}>
        <strong>{definition.label}</strong>
        <small>{definition.description}</small>
        {(definition.appId || requiresSetup) && (
          <span className={styles.actionBadges}>
            {definition.appId && <span>{SUPPORTED_APP_LABELS[definition.appId]}</span>}
            {requiresSetup && <span className={styles.setupBadge}>Needs 1-min setup</span>}
          </span>
        )}
      </span>
      <span className={styles.actionState}>
        {unavailable ? <LockKeyhole size={13} /> : selected ? <Check size={14} /> : <Plus size={14} />}
      </span>
    </button>
  );
}

function BubbleRow({
  slot,
  index,
  total,
  selected,
  onSelect,
  onReorder,
  onRemove,
}: {
  slot: RingSlot;
  index: number;
  total: number;
  selected: boolean;
  onSelect: () => void;
  onReorder: (targetId: string) => void;
  onRemove: () => void;
}): React.ReactElement {
  const Icon = slot.assignment ? resolveIcon(slot.assignment.iconName) : Plus;

  return (
    <div
      className={`${styles.bubbleRow}${selected ? ` ${styles.bubbleRowSelected}` : ''}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-ring-slot', slot.id);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const source = event.dataTransfer.getData('application/x-ring-slot');
        if (source && source !== slot.id) onReorder(source);
      }}
    >
      <button type="button" className={styles.bubbleMain} onClick={onSelect}>
        <span className={styles.bubbleIndex}>{index + 1}</span>
        <span className={`${styles.bubbleIcon}${slot.assignment ? '' : ` ${styles.bubbleIconEmpty}`}`}>
          <Icon size={17} />
        </span>
        <span className={styles.bubbleCopy}>
          <strong>{slot.assignment?.label ?? 'Empty bubble'}</strong>
          <small>{slot.assignment?.definitionId ?? 'Drop an action here'}</small>
        </span>
      </button>
      <div className={styles.bubbleActions}>
        <button
          type="button"
          onClick={() => index > 0 && onReorder('__previous__')}
          disabled={index === 0}
          aria-label={`Move bubble ${index + 1} up`}
        ><ChevronUp size={13} /></button>
        <button
          type="button"
          onClick={() => index < total - 1 && onReorder('__next__')}
          disabled={index === total - 1}
          aria-label={`Move bubble ${index + 1} down`}
        ><ChevronDown size={13} /></button>
        <button
          type="button"
          onClick={onRemove}
          disabled={total <= 2}
          aria-label={`Remove bubble ${index + 1}`}
        ><Trash2 size={13} /></button>
      </div>
    </div>
  );
}

function FolderChildRow({
  child,
  index,
  total,
  selected,
  onSelect,
  onMove,
  onRemove,
}: {
  child: BubbleConfig;
  index: number;
  total: number;
  selected: boolean;
  onSelect: () => void;
  onMove: (childId: string, targetIndex: number) => void;
  onRemove: () => void;
}): React.ReactElement {
  const Icon = resolveIcon(child.iconName);
  return (
    <div
      className={`${styles.bubbleRow}${selected ? ` ${styles.bubbleRowSelected}` : ''}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-folder-child', child.id);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const source = event.dataTransfer.getData('application/x-folder-child');
        if (source && source !== child.id) onMove(source, index);
      }}
    >
      <button type="button" className={styles.bubbleMain} onClick={onSelect}>
        <span className={styles.bubbleIndex}>{index + 1}</span>
        <span className={styles.bubbleIcon}>
          {child.iconDataUrl ? <img src={child.iconDataUrl} alt="" draggable={false} /> : <Icon size={17} />}
        </span>
        <span className={styles.bubbleCopy}>
          <strong>{child.label}</strong>
          <small>Sub-ring action</small>
        </span>
      </button>
      <div className={styles.bubbleActions}>
        <button type="button" onClick={() => onMove(child.id, index - 1)} disabled={index === 0} aria-label={`Move ${child.label} up`}><ChevronUp size={13} /></button>
        <button type="button" onClick={() => onMove(child.id, index + 1)} disabled={index === total - 1} aria-label={`Move ${child.label} down`}><ChevronDown size={13} /></button>
        <button type="button" onClick={onRemove} aria-label={`Remove ${child.label}`}><Trash2 size={13} /></button>
      </div>
    </div>
  );
}

export function ActionLibrary({
  mode,
  profile,
  selectedDefinitionId,
  selectedSlotId,
  onModeChange,
  onSelectDefinition,
  onSelectSlot,
  onReorderSlots,
  onAddSlot,
  onRemoveSlot,
  folderChildren,
  selectedChildId,
  onSelectChild,
  onReorderChild,
  onRemoveChild,
}: ActionLibraryProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const [openSections, setOpenSections] = useState<Set<ActionCategory>>(() => new Set(['system', 'app']));
  const sortedSlots = [...profile.slots].sort((a, b) => a.position - b.position);
  const supportedAppId = getSupportedAppId(profile.application?.processName);

  const filteredActions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return ACTION_CATALOG.filter((definition) => definition.category !== 'custom')
      .filter((definition) => definition.category !== 'app' || definition.appId === supportedAppId)
      .filter((definition) => folderChildren === null || definition.bubbleType !== 'menu')
      .filter((definition) => {
        if (!normalizedQuery) return true;
        return [definition.label, definition.description, ...definition.searchTerms]
          .some((term) => term.toLowerCase().includes(normalizedQuery));
      });
  }, [folderChildren, query, supportedAppId]);

  const visibleSections = SECTIONS.map((section) => ({
    ...section,
    actions: filteredActions.filter((definition) => definition.category === section.category),
  })).filter((section) => section.actions.length > 0);

  const toggleSection = (sectionCategory: ActionCategory) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(sectionCategory)) next.delete(sectionCategory);
      else next.add(sectionCategory);
      return next;
    });
  };

  const moveAdjacent = (slotId: string, direction: 'previous' | 'next') => {
    const index = sortedSlots.findIndex((slot) => slot.id === slotId);
    const target = sortedSlots[index + (direction === 'previous' ? -1 : 1)];
    if (target) onReorderSlots(slotId, target.id);
  };

  return (
    <aside className={styles.library} aria-label="Action and bubble library">
      <div className={styles.libraryHeader}>
        <div className={styles.modeSwitch} role="tablist" aria-label="Library mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'actions'}
            className={mode === 'actions' ? styles.modeActive : ''}
            onClick={() => onModeChange('actions')}
          >Actions</button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'bubbles'}
            className={mode === 'bubbles' ? styles.modeActive : ''}
            onClick={() => onModeChange('bubbles')}
          >Bubbles <span>{folderChildren?.length ?? profile.slots.length}</span></button>
        </div>
        <p>{mode === 'actions'
          ? folderChildren === null ? 'Drag a preset onto the ring or select it, then choose a bubble.' : 'Drag a leaf action into the open sub-ring.'
          : folderChildren === null ? 'Select, reorder, add, or remove ring positions.' : 'Select, reorder, or remove sub-ring actions.'}</p>
      </div>

      {mode === 'actions' ? (
        <>
          <div className={styles.searchBox}>
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search actions"
              aria-label="Search actions"
            />
          </div>
          <div className={styles.actionList}>
            {visibleSections.map((section) => {
              const expanded = query.trim().length > 0 || openSections.has(section.category);
              return (
                <section key={section.category} className={styles.actionSection}>
                  <button
                    type="button"
                    className={styles.sectionHeader}
                    onClick={() => toggleSection(section.category)}
                    aria-expanded={expanded}
                  >
                    <span>{section.label}</span>
                    <span className={styles.sectionMeta}>
                      <span className={styles.sectionCount}>{section.actions.length}</span>
                      <ChevronDown className={`${styles.sectionChevron}${expanded ? '' : ` ${styles.sectionCollapsed}`}`} size={15} />
                    </span>
                  </button>
                  {expanded && (
                    <div className={styles.sectionActions}>
                      {section.actions.map((definition) => (
                        <ActionCard
                          key={definition.id}
                          definition={definition}
                          selected={selectedDefinitionId === definition.id}
                          onSelect={() => onSelectDefinition(definition.id)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
            {visibleSections.length === 0 && <div className={styles.emptyResult}>No actions match this search.</div>}
          </div>
          <button type="button" className={styles.customButton} onClick={() => onSelectDefinition('custom-action')}>
            <Plus size={17} />
            <span><strong>Add custom action</strong><small>Shortcut, macro, file, app, or URL</small></span>
          </button>
        </>
      ) : (
        <>
          <div className={styles.bubbleList}>
            {folderChildren === null ? sortedSlots.map((slot, index) => (
              <BubbleRow
                key={slot.id}
                slot={slot}
                index={index}
                total={sortedSlots.length}
                selected={selectedSlotId === slot.id}
                onSelect={() => onSelectSlot(slot.id)}
                onReorder={(targetId) => {
                  if (targetId === '__previous__') moveAdjacent(slot.id, 'previous');
                  else if (targetId === '__next__') moveAdjacent(slot.id, 'next');
                  else onReorderSlots(targetId, slot.id);
                }}
                onRemove={() => onRemoveSlot(slot.id)}
              />
            )) : folderChildren.map((child, index) => (
              <FolderChildRow
                key={child.id}
                child={child}
                index={index}
                total={folderChildren.length}
                selected={selectedChildId === child.id}
                onSelect={() => onSelectChild(child.id)}
                onMove={onReorderChild}
                onRemove={() => onRemoveChild(child.id)}
              />
            ))}
            {folderChildren !== null && folderChildren.length === 0 && (
              <div className={styles.emptyResult}>Drag an action onto the sub-ring to add its first child.</div>
            )}
          </div>
          {folderChildren === null ? <button type="button" className={styles.addBubbleButton} onClick={onAddSlot} disabled={profile.slots.length >= 12}>
            <Plus size={16} />
            Add bubble
            <span>{profile.slots.length}/12</span>
          </button> : <div className={styles.folderCapacity}>
            <span>Submenu capacity</span>
            <strong>{folderChildren.length}/{MAX_FOLDER_CHILDREN}</strong>
          </div>}
        </>
      )}
    </aside>
  );
}
