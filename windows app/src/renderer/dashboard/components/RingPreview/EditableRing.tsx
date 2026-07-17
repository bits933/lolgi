import React, { useMemo, useRef } from 'react';
import * as LucideIcons from 'lucide-react';
import { Plus } from 'lucide-react';
import { MAX_FOLDER_CHILDREN } from '../../../../shared/constants';
import { computeFolderLayout, computeGroupDotAngle, computeRingPositions } from '../../../../shared/ringGeometry';
import type { BubbleConfig, RingProfile, RingSlot } from '../../../../shared/types';
import styles from './EditableRing.module.css';

type AnyIcon = React.ComponentType<{ size?: number; strokeWidth?: number }>;

function resolveIcon(name: string): AnyIcon {
  return (LucideIcons as unknown as Record<string, AnyIcon>)[name] ?? LucideIcons.Circle;
}

interface EditableRingProps {
  profile: RingProfile;
  selectedSlotId: string | null;
  selectedDefinitionId: string | null;
  compact: boolean;
  folderParentSlotId: string | null;
  selectedChildId: string | null;
  onSelectSlot: (slotId: string) => void;
  onAssignDefinition: (slotId: string, definitionId: string) => void;
  onReorderSlots: (sourceSlotId: string, targetSlotId: string) => void;
  onOpenFolder: (slotId: string) => void;
  onBackFolder: () => void;
  onSelectChild: (childId: string) => void;
  onAssignChildDefinition: (index: number, definitionId: string, replaceChildId?: string) => void;
  onReorderChild: (childId: string, targetIndex: number) => void;
}

export function EditableRing({
  profile,
  selectedSlotId,
  selectedDefinitionId,
  compact,
  folderParentSlotId,
  selectedChildId,
  onSelectSlot,
  onAssignDefinition,
  onReorderSlots,
  onOpenFolder,
  onBackFolder,
  onSelectChild,
  onAssignChildDefinition,
  onReorderChild,
}: EditableRingProps): React.ReactElement {
  const dragOverTarget = useRef<HTMLElement | null>(null);
  const slots = useMemo(
    () => [...profile.slots].sort((a, b) => a.position - b.position),
    [profile.slots]
  );
  const positions = useMemo(() => computeRingPositions(slots.length, 210, 210, 132), [slots.length]);
  const folderSlot = folderParentSlotId
    ? slots.find((slot) => slot.id === folderParentSlotId) ?? null
    : null;
  const folderAssignment = folderSlot?.assignment?.type === 'menu' ? folderSlot.assignment : null;
  const folderChildren = useMemo(
    () => [...(folderAssignment?.children ?? [])].sort((a, b) => a.angleIndex - b.angleIndex),
    [folderAssignment?.children]
  );
  const folderLayout = useMemo(
    () => computeFolderLayout({
      width: 420,
      height: 420,
      bubbleDiameter: 72,
      childCount: folderChildren.length,
      includeInsertionTargets: true,
    }),
    [folderChildren.length]
  );

  const setDragOverTarget = (target: HTMLElement) => {
    if (dragOverTarget.current === target) return;
    dragOverTarget.current?.classList.remove(styles.slotDragOver);
    target.classList.add(styles.slotDragOver);
    dragOverTarget.current = target;
  };

  const clearDragOverTarget = (target?: HTMLElement) => {
    if (target && dragOverTarget.current !== target) return;
    dragOverTarget.current?.classList.remove(styles.slotDragOver);
    dragOverTarget.current = null;
  };

  const handleRootDrop = (event: React.DragEvent, slot: RingSlot) => {
    event.preventDefault();
    clearDragOverTarget();
    const definitionId = event.dataTransfer.getData('application/x-action-definition');
    if (definitionId) {
      onAssignDefinition(slot.id, definitionId);
      return;
    }
    const sourceSlotId = event.dataTransfer.getData('application/x-ring-slot');
    if (sourceSlotId && sourceSlotId !== slot.id) onReorderSlots(sourceSlotId, slot.id);
  };

  const handleChildDrop = (
    event: React.DragEvent,
    targetIndex: number,
    replaceChildId?: string
  ) => {
    event.preventDefault();
    clearDragOverTarget();
    const definitionId = event.dataTransfer.getData('application/x-action-definition');
    if (definitionId) {
      onAssignChildDefinition(targetIndex, definitionId, replaceChildId);
      return;
    }
    const sourceChildId = event.dataTransfer.getData('application/x-folder-child');
    if (sourceChildId) onReorderChild(sourceChildId, targetIndex);
  };

  const renderIcon = (config: BubbleConfig | NonNullable<RingSlot['assignment']>, size = 23) => {
    const Icon = resolveIcon(config.iconName);
    return config.iconDataUrl
      ? <img src={config.iconDataUrl} alt="" draggable={false} />
      : <Icon size={size} strokeWidth={2} />;
  };

  if (folderAssignment && folderSlot) {
    return (
      <section className={`${styles.stage}${compact ? ` ${styles.stageCompact}` : ''}`} aria-label={`${folderAssignment.label} sub-ring editor`}>
        <div className={`${styles.ringCanvas} ${styles.folderCanvas}`}>
          <button
            type="button"
            className={`${styles.slot} ${styles.folderParent}`}
            style={{ left: folderLayout.parent.x, top: folderLayout.parent.y }}
            onClick={onBackFolder}
            data-ring-slot-id={folderSlot.id}
            aria-label={`Back to ${profile.name} main ring`}
            title="Back to main ring"
          >
            {renderIcon(folderAssignment, 25)}
            <span className={styles.connectorDot} />
            <span className={styles.parentBackLabel}>Back</span>
          </button>

          {folderChildren.map((child, index) => {
            const position = folderLayout.children[index];
            const selected = selectedChildId === child.id;
            return (
              <button
                key={child.id}
                type="button"
                className={`${styles.slot} ${styles.folderChild}${selected ? ` ${styles.slotSelected}` : ''}`}
                style={{ left: position.x, top: position.y }}
                draggable
                data-ring-child-id={child.id}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('application/x-folder-child', child.id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = event.dataTransfer.types.includes('application/x-folder-child') ? 'move' : 'copy';
                  setDragOverTarget(event.currentTarget);
                }}
                onDragLeave={(event) => clearDragOverTarget(event.currentTarget)}
                onDragEnd={() => clearDragOverTarget()}
                onDrop={(event) => handleChildDrop(event, index, child.id)}
                onClick={() => selectedDefinitionId
                  ? onAssignChildDefinition(index, selectedDefinitionId, child.id)
                  : onSelectChild(child.id)}
                aria-label={`Edit ${child.label}`}
                title={child.label}
              >
                {renderIcon(child)}
                <span className={styles.folderChildLabel}>{child.label}</span>
              </button>
            );
          })}

          {folderLayout.insertionTargets.map((position, targetIndex) => {
            const insertionIndex = folderChildren.length === 0
              ? 0
              : targetIndex === 0 ? 0 : folderChildren.length;
            const key = `insert-${insertionIndex}`;
            return (
              <button
                key={key}
                type="button"
                className={`${styles.slot} ${styles.folderInsertion}`}
                style={{ left: position.x, top: position.y }}
                disabled={folderChildren.length >= MAX_FOLDER_CHILDREN}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOverTarget(event.currentTarget);
                }}
                onDragLeave={(event) => clearDragOverTarget(event.currentTarget)}
                onDrop={(event) => handleChildDrop(event, insertionIndex)}
                onClick={() => selectedDefinitionId && onAssignChildDefinition(insertionIndex, selectedDefinitionId)}
                aria-label={selectedDefinitionId ? `Add selected action at position ${insertionIndex + 1}` : 'Select an action, then add it here'}
                title={selectedDefinitionId ? 'Add selected action' : 'Select an action from the library'}
              >
                <Plus size={21} strokeWidth={1.8} />
                <span className={styles.folderChildLabel}>Add an action</span>
              </button>
            );
          })}
        </div>

        <div className={styles.profileCaption}>
          <small>{folderChildren.length}/{MAX_FOLDER_CHILDREN} actions - click the highlighted parent to go back</small>
        </div>
      </section>
    );
  }

  return (
    <section className={`${styles.stage}${compact ? ` ${styles.stageCompact}` : ''}`} aria-label={`${profile.name} ring editor`}>
      <div className={styles.ringCanvas}>
        <div className={styles.orbit} />
        <div className={styles.centerMark}>
          <span>{profile.slots.filter((slot) => slot.assignment).length}</span>
          <small>of {profile.slots.length}</small>
        </div>

        {slots.map((slot, index) => {
          const position = positions[index];
          const assignment = slot.assignment;
          const isGroup = assignment?.type === 'menu';
          const Icon = assignment ? resolveIcon(assignment.iconName) : Plus;
          const selected = selectedSlotId === slot.id;
          const stateClass = isGroup ? styles.slotGroup : assignment ? styles.slotAssigned : styles.slotEmpty;
          return (
            <button
              key={slot.id}
              type="button"
              data-ring-slot-id={slot.id}
              className={`${styles.slot} ${stateClass}${selected ? ` ${styles.slotSelected}` : ''}`}
              style={{ left: position.x, top: position.y }}
              draggable={Boolean(assignment)}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('application/x-ring-slot', slot.id);
              }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'copy';
                  setDragOverTarget(event.currentTarget);
                }}
                onDragLeave={(event) => clearDragOverTarget(event.currentTarget)}
                onDragEnd={() => clearDragOverTarget()}
              onDrop={(event) => handleRootDrop(event, slot)}
              onClick={() => {
                if (selectedDefinitionId) onAssignDefinition(slot.id, selectedDefinitionId);
                else if (assignment?.type === 'menu') onOpenFolder(slot.id);
                else onSelectSlot(slot.id);
              }}
              aria-label={assignment?.type === 'menu'
                ? `Open ${assignment.label} submenu`
                : assignment ? `Edit ${assignment.label}` : `Assign action to empty bubble ${index + 1}`}
              title={assignment ? assignment.label : 'Drop or select an action'}
            >
              {assignment?.iconDataUrl ? (
                <img src={assignment.iconDataUrl} alt="" draggable={false} />
              ) : (
                <Icon size={assignment ? 23 : 20} strokeWidth={assignment ? 2 : 1.7} />
              )}
              {assignment?.type === 'menu' && (
                <span
                  className={styles.groupDot}
                  style={{ '--group-dot-angle': `${computeGroupDotAngle(position)}rad` } as React.CSSProperties}
                  aria-hidden="true"
                />
              )}
              <span className={styles.slotNumber}>{index + 1}</span>
              <span className={styles.slotLabel}>{assignment?.label ?? 'Add action'}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.profileCaption}>
        <small>{selectedDefinitionId ? 'Choose a bubble for the selected action' : 'Drag an action onto any bubble'}</small>
      </div>
    </section>
  );
}
