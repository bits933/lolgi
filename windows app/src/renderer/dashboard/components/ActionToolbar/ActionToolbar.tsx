import React, { useEffect, useRef, useState } from 'react';
import * as LucideIcons from 'lucide-react';
import {
  AlertCircle,
  AlertTriangle,
  AppWindow,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  FolderOpen,
  GripVertical,
  ImagePlus,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { ACTION_CATALOG, ACTION_DEFINITIONS, createAssignmentFromDefinition } from '../../../../shared/actionCatalog';
import { AI_BRAND_ICONS, AI_PROVIDERS, type AiProviderId } from '../../../../shared/brandIcons';
import { MAX_FOLDER_CHILDREN } from '../../../../shared/constants';
import { assignmentToBubble, bubbleToAssignment } from '../../../../shared/profileUtils';
import { shortcutFromKeyEvent } from '../../../../shared/shortcutParser';
import type { ActionAssignment, ActionDefinition, ActionEditorField, BubbleConfig, LaunchableAppInfo, RingProfile } from '../../../../shared/types';
import { IconPicker } from '../BubbleEditor/IconPicker';
import { MacroStepEditor } from '../MacroStepEditor/MacroStepEditor';
import styles from './ActionToolbar.module.css';

type AnyIcon = React.ComponentType<{ size?: number; strokeWidth?: number }>;

function resolveIcon(name: string): AnyIcon {
  return (LucideIcons as unknown as Record<string, AnyIcon>)[name] ?? LucideIcons.Circle;
}

/** Session cache — enumerating Start Menu apps costs a PowerShell round trip. */
let cachedAppList: LaunchableAppInfo[] | null = null;
const AI_BRAND_ICON_VALUES = new Set<string>(Object.values(AI_BRAND_ICONS));

/** Human-readable summary of an app-launch payload for the picker button. */
function describeAppTarget(payload: string | undefined): string {
  if (!payload?.trim()) return 'Choose an application';
  const match = cachedAppList?.find((app) => app.launchTarget === payload);
  if (match) return match.displayName;
  if (/^shell:appsfolder\\/i.test(payload)) {
    // AUMID like Microsoft.WindowsCalculator_8wekyb3d8bbwe!App → package stem
    return payload.replace(/^shell:appsfolder\\/i, '').split('!')[0].split('_')[0];
  }
  return payload.split(/[\\/]/).pop() ?? payload;
}

function readField(assignment: ActionAssignment, key: string): string | number | boolean {
  if (key === 'payload') return assignment.payload ?? '';
  if (key === 'scrollUpAction') return assignment.scrollUpAction ?? '';
  if (key === 'scrollDownAction') return assignment.scrollDownAction ?? '';
  return assignment.parameters?.[key] ?? '';
}

function writeField(
  assignment: ActionAssignment,
  key: string,
  value: string | number | boolean
): ActionAssignment {
  if (key === 'payload') return { ...assignment, payload: String(value) };
  if (key === 'scrollUpAction') return { ...assignment, scrollUpAction: String(value) };
  if (key === 'scrollDownAction') return { ...assignment, scrollDownAction: String(value) };
  return { ...assignment, parameters: { ...assignment.parameters, [key]: value } };
}

interface FieldControlProps {
  field: ActionEditorField;
  assignment: ActionAssignment;
  profiles: RingProfile[];
  onChange: (assignment: ActionAssignment) => void;
}

function FieldControl({ field, assignment, profiles, onChange }: FieldControlProps): React.ReactElement {
  const current = readField(assignment, field.key);
  const [confirmingAdmin, setConfirmingAdmin] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [appQuery, setAppQuery] = useState('');
  const [apps, setApps] = useState<LaunchableAppInfo[] | null>(cachedAppList);
  const [loadingApps, setLoadingApps] = useState(false);
  const [extractingIcon, setExtractingIcon] = useState(false);
  const [lastFetchedUrl, setLastFetchedUrl] = useState('');
  // Latest assignment, so the async icon write can't clobber edits made
  // while extraction was in flight (same stale-guard as NewProfileModal).
  const assignmentRef = useRef(assignment);
  assignmentRef.current = assignment;
  const isProfileSelect = assignment.definitionId === 'switch-profile' && field.key === 'payload';
  const options = isProfileSelect
    ? profiles.filter((profile) => profile.enabled).map((profile) => ({ value: profile.id, label: profile.name }))
    : field.options ?? [];

  const setValue = (value: string | number | boolean) => onChange(writeField(assignment, field.key, value));

  if (field.type === 'readonly') return <></>;

  if (field.type === 'app') {
    const togglePicker = () => {
      const opening = !pickerOpen;
      setPickerOpen(opening);
      if (opening && !apps) {
        setLoadingApps(true);
        window.electronAPI.listAllApps()
          .then((list) => { cachedAppList = list; setApps(list); })
          .catch(() => setApps([]))
          .finally(() => setLoadingApps(false));
      }
    };

    const selectApp = async (displayName: string, launchTarget: string) => {
      setPickerOpen(false);
      setAppQuery('');
      // Apply target + name immediately; the native icon follows when ready.
      onChange({ ...assignment, payload: launchTarget, label: displayName });
      setExtractingIcon(true);
      const iconDataUrl = await window.electronAPI.extractAppIcon(launchTarget).catch(() => null);
      setExtractingIcon(false);
      const latest = assignmentRef.current;
      if (latest.payload === launchTarget && iconDataUrl) {
        onChange({ ...latest, iconDataUrl });
      }
    };

    const browseForExe = async () => {
      const path = await window.electronAPI.pickFile();
      if (!path) return;
      const fileName = path.split(/[\\/]/).pop() ?? path;
      await selectApp(fileName.replace(/\.(exe|lnk|bat|cmd)$/i, ''), path);
    };

    const normalizedQuery = appQuery.trim().toLowerCase();
    const filteredApps = (apps ?? []).filter((app) => app.displayName.toLowerCase().includes(normalizedQuery));

    return (
      <div className={styles.field}>
        <span>{field.label}{field.required ? ' *' : ''}</span>
        <button type="button" className={styles.appSelectButton} onClick={togglePicker} aria-expanded={pickerOpen}>
          <span className={styles.appSelectIcon}>
            {assignment.iconDataUrl
              ? <img src={assignment.iconDataUrl} alt="" draggable={false} />
              : <AppWindow size={14} />}
          </span>
          <span className={styles.appSelectName}>{describeAppTarget(assignment.payload)}</span>
          {extractingIcon ? <LoaderCircle size={13} className={styles.appSpinner} /> : <ChevronDown size={13} />}
        </button>
        {pickerOpen && (
          <div className={styles.appPickerPanel}>
            <div className={styles.appSearchRow}>
              <Search size={13} />
              <input
                autoFocus
                value={appQuery}
                placeholder="Search applications"
                onChange={(event) => setAppQuery(event.target.value)}
              />
            </div>
            <div className={styles.appPickerList}>
              {loadingApps && <div className={styles.appPickerStatus}><LoaderCircle size={14} className={styles.appSpinner} /> Loading applications...</div>}
              {!loadingApps && filteredApps.map((app) => (
                <button key={app.launchTarget} type="button" onClick={() => void selectApp(app.displayName, app.launchTarget)}>
                  <span>{app.displayName}</span>
                  {app.kind === 'store' && <small>Store</small>}
                </button>
              ))}
              {!loadingApps && apps && filteredApps.length === 0 && (
                <div className={styles.appPickerStatus}>No matching applications</div>
              )}
            </div>
            <button type="button" className={styles.appBrowseLink} onClick={() => void browseForExe()}>
              <FolderOpen size={13} /> Browse for executable
            </button>
          </div>
        )}
      </div>
    );
  }

  if (field.type === 'select') {
    if (field.key === 'aiProvider' && assignment.definitionId === 'ai-launcher') {
      return (
        <label className={styles.field}>
          <span>{field.label}{field.required ? ' *' : ''}</span>
          <select
            value={String(current || 'chatgpt')}
            onChange={(event) => {
              const provider = AI_PROVIDERS.find((item) => item.id === event.target.value);
              if (!provider) return;
              if (provider.id === 'custom') {
                onChange({
                  ...assignment,
                  iconDataUrl: assignment.iconDataUrl && AI_BRAND_ICON_VALUES.has(assignment.iconDataUrl) ? undefined : assignment.iconDataUrl,
                  parameters: { ...assignment.parameters, aiProvider: 'custom' },
                });
                requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-ai-link="true"]')?.focus());
                return;
              }
              onChange({
                ...assignment,
                label: provider.label,
                payload: provider.url,
                iconName: 'Sparkles',
                iconDataUrl: AI_BRAND_ICONS[provider.id as Exclude<AiProviderId, 'custom'>],
                parameters: { ...assignment.parameters, aiProvider: provider.id },
              });
            }}
          >
            {AI_PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
          </select>
        </label>
      );
    }
    return (
      <label className={styles.field}>
        <span>{field.label}{field.required ? ' *' : ''}</span>
        <select
          value={field.key === 'captureMode' ? assignment.definitionId : String(current)}
          onChange={(event) => {
            if (field.key === 'captureMode') {
              const nextDefinition = ACTION_DEFINITIONS.get(event.target.value);
              if (nextDefinition) {
                onChange({
                  ...assignment,
                  definitionId: nextDefinition.id,
                  actionType: nextDefinition.actionType,
                  iconName: nextDefinition.iconName,
                  parameters: { ...assignment.parameters, captureMode: nextDefinition.id },
                });
              }
              return;
            }
            setValue(event.target.value);
          }}
        >
          <option value="">Select...</option>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    );
  }

  if (field.type === 'textarea') {
    if (assignment.actionType === 'macro' || assignment.actionType === 'keyboard-sequence') {
      return (
        <div className={styles.field}>
          <span>{field.label}{field.required ? ' *' : ''}</span>
          <MacroStepEditor actionType={assignment.actionType} value={String(current)} onChange={setValue} />
        </div>
      );
    }
    return (
      <div className={styles.field}>
        <span>{field.label}{field.required ? ' *' : ''}</span>
        <textarea
          rows={4}
          value={String(current)}
          placeholder={field.placeholder}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
    );
  }

  if (field.type === 'toggle') {
    return (
      <>
        <label className={styles.toggleRow}>
          <span>{field.label}</span>
          <input
            type="checkbox"
            checked={Boolean(current)}
            onChange={(event) => {
              if (field.key === 'runAsAdmin' && event.target.checked) {
                setConfirmingAdmin(true);
                return;
              }
              setValue(event.target.checked);
            }}
          />
        </label>
        {confirmingAdmin && (
          <div className={styles.confirmOverlay} role="presentation">
            <div
              className={styles.confirmDialog}
              role="alertdialog"
              aria-modal="true"
              aria-label="Confirm administrator prompt"
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                setConfirmingAdmin(false);
              }}
            >
              <AlertTriangle size={16} />
              <p>This action will show a Windows administrator prompt every time it runs. Enable it?</p>
              <div className={styles.confirmActions}>
                <button type="button" autoFocus onClick={() => setConfirmingAdmin(false)}>Cancel</button>
                <button type="button" onClick={() => { setValue(true); setConfirmingAdmin(false); }}>Enable</button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  const isPicker = field.type === 'file' || field.type === 'folder';
  const isUrlField = field.key === 'payload' && assignment.actionType === 'url-open';
  const handleUrlIconFetch = async () => {
    const url = String(readField(assignmentRef.current, field.key)).trim();
    if (!isUrlField || !url || url === lastFetchedUrl) return;
    const provider = AI_PROVIDERS.find((item) => item.id === assignmentRef.current.parameters?.aiProvider);
    if (provider && provider.id !== 'custom' && provider.url === url) return;
    const before = assignmentRef.current;
    setExtractingIcon(true);
    const iconDataUrl = await window.electronAPI.fetchUrlIcon(url).catch(() => null);
    setExtractingIcon(false);
    const latest = assignmentRef.current;
    if (
      iconDataUrl
      && latest.payload === url
      && latest.iconName === before.iconName
      && latest.iconDataUrl === before.iconDataUrl
    ) {
      setLastFetchedUrl(url);
      onChange({ ...latest, iconDataUrl });
    }
  };
  return (
    <label className={styles.field}>
      <span>{field.label}{field.required ? ' *' : ''}</span>
      <div className={styles.inputRow}>
        <input
          type={field.type === 'number' ? 'number' : 'text'}
          value={String(current)}
          min={field.min}
          max={field.max}
          step={field.step}
          placeholder={field.type === 'shortcut' ? 'Press a shortcut' : field.placeholder}
          readOnly={isPicker}
          data-ai-link={assignment.definitionId === 'ai-launcher' && field.key === 'payload' ? 'true' : undefined}
          onBlur={() => void handleUrlIconFetch()}
          onChange={(event) => {
            const value = field.type === 'number' ? Number(event.target.value) : event.target.value;
            let next = writeField(assignment, field.key, value);
            if (assignment.definitionId === 'ai-launcher' && field.key === 'payload') {
              const provider = AI_PROVIDERS.find((item) => item.id === assignment.parameters?.aiProvider);
              if (provider && provider.id !== 'custom' && provider.url !== String(value)) {
                next = { ...next, parameters: { ...next.parameters, aiProvider: 'custom' } };
              }
            }
            onChange(next);
          }}
          onKeyDown={(event) => {
            if (field.type !== 'shortcut') return;
            const shortcut = shortcutFromKeyEvent(event);
            if (!shortcut) return;
            event.preventDefault();
            setValue(shortcut);
          }}
        />
        {isUrlField && extractingIcon && <LoaderCircle size={14} className={styles.appSpinner} aria-label="Fetching website icon" />}
        {isPicker && (
          <button
            type="button"
            className={styles.browseButton}
            onClick={async () => {
              const value = field.type === 'folder'
                ? await window.electronAPI.pickFolder()
                : await window.electronAPI.pickFile();
              if (value) setValue(value);
            }}
          ><FolderOpen size={14} /> Browse</button>
        )}
      </div>
    </label>
  );
}

function SetupNotice({
  definition,
  assignment,
}: {
  definition: ActionDefinition | null | undefined;
  assignment: ActionAssignment;
}): React.ReactElement | null {
  if (definition?.availability !== 'requires-setup') return null;
  const instructions = definition.setupInstructions
    ?? String(assignment.parameters?.setupInstructions ?? '');
  return (
    <div className={styles.setupNotice}>
      <AlertTriangle size={15} />
      <div>
        <strong>Needs 1-minute setup</strong>
        <p>{instructions || 'Bind the shortcut shown below in the application before using this action.'}</p>
      </div>
    </div>
  );
}

function VerificationNotice({
  definition,
}: {
  definition: ActionDefinition | null | undefined;
}): React.ReactElement | null {
  if (definition?.verification !== 'unverified') return null;
  return (
    <div className={styles.verificationNotice} role="note">
      <AlertTriangle size={15} />
      <div>
        <strong>Needs verification</strong>
        <p>This default binding hasn&rsquo;t been confirmed live in the app yet, so it may need adjusting for your version, layout, or keymap.</p>
      </div>
    </div>
  );
}

function GroupChildren({
  assignment,
  profiles,
  onChange,
}: {
  assignment: ActionAssignment;
  profiles: RingProfile[];
  onChange: (assignment: ActionAssignment) => void;
}): React.ReactElement {
  const [newDefinitionId, setNewDefinitionId] = useState('copy');
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const children = assignment.children ?? [];
  const groupAppId = ACTION_DEFINITIONS.get(assignment.definitionId)?.appId;
  const available = ACTION_CATALOG.filter(
    (definition) =>
      definition.category !== 'structural'
      && definition.availability !== 'requires-device'
      && definition.availability !== 'requires-plugin'
      && (definition.category !== 'app' || definition.appId === groupAppId)
  );

  const updateChildren = (next: BubbleConfig[]) => onChange({ ...assignment, children: next });
  const moveChild = (index: number, nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= children.length) return;
    const next = [...children];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    updateChildren(next.map((child, angleIndex) => ({ ...child, angleIndex })));
  };

  return (
    <div className={styles.groupEditor}>
      <div className={styles.groupHeader}>
        <span>Submenu actions</span>
        <small>{children.length}/{MAX_FOLDER_CHILDREN}</small>
      </div>
      <div className={styles.childList}>
        {children.map((child, index) => {
          const Icon = resolveIcon(child.iconName);
          return (
            <div key={child.id} className={styles.childRow}>
              <GripVertical size={12} />
              <button type="button" className={styles.childMain} onClick={() => setSelectedChildId(child.id)}>
                <span className={styles.childIcon}><Icon size={14} /></span>
                <span>{child.label}</span>
              </button>
              <button type="button" onClick={() => moveChild(index, index - 1)} disabled={index === 0} aria-label="Move child up"><ArrowUp size={12} /></button>
              <button type="button" onClick={() => moveChild(index, index + 1)} disabled={index === children.length - 1} aria-label="Move child down"><ArrowDown size={12} /></button>
              <button type="button" onClick={() => updateChildren(children.filter((item) => item.id !== child.id))} aria-label="Remove child"><Trash2 size={12} /></button>
            </div>
          );
        })}
        {children.length === 0 && <div className={styles.childEmpty}>Add up to five actions to this submenu.</div>}
      </div>
      <div className={styles.addChildRow}>
        <div className={styles.selectWrap}>
          <select value={newDefinitionId} onChange={(event) => setNewDefinitionId(event.target.value)}>
            {available.map((definition) => <option key={definition.id} value={definition.id}>{definition.label}</option>)}
          </select>
          <ChevronDown size={13} />
        </div>
        <button
          type="button"
          disabled={children.length >= MAX_FOLDER_CHILDREN}
          onClick={() => {
            const created = createAssignmentFromDefinition(newDefinitionId);
            if (created) updateChildren([...children, assignmentToBubble(created, children.length)]);
          }}
        ><Plus size={13} /> Add</button>
      </div>
      {selectedChildId && (() => {
        const index = children.findIndex((child) => child.id === selectedChildId);
        const child = children[index];
        if (!child) return null;
        const childAssignment = bubbleToAssignment(child);
        const childDefinition = ACTION_DEFINITIONS.get(childAssignment.definitionId);
        const updateChild = (nextAssignment: ActionAssignment) => {
          const nextChildren = [...children];
          nextChildren[index] = assignmentToBubble(nextAssignment, index);
          updateChildren(nextChildren);
        };
        return (
          <div className={styles.childEditor}>
            <div className={styles.groupHeader}><span>Edit child action</span><button type="button" onClick={() => setSelectedChildId(null)}><X size={12} /></button></div>
            <label className={styles.field}>
              <span>Label</span>
              <input value={childAssignment.label} onChange={(event) => updateChild({ ...childAssignment, label: event.target.value })} />
            </label>
            <SetupNotice definition={childDefinition} assignment={childAssignment} />
            <VerificationNotice definition={childDefinition} />
            {childDefinition?.editorFields.map((field) => (
              <FieldControl key={field.key} field={field} assignment={childAssignment} profiles={profiles} onChange={updateChild} />
            ))}
          </div>
        );
      })()}
    </div>
  );
}

interface ActionToolbarProps {
  assignment: ActionAssignment | null;
  profiles: RingProfile[];
  dirty: boolean;
  saving: boolean;
  error: string | null;
  onChange: (assignment: ActionAssignment) => void;
  onSave: () => void;
  onCancel: () => void;
  onClose: () => void;
  onOpenGroup?: () => void;
  onRemove: () => void;
}

export function ActionToolbar({
  assignment,
  profiles,
  dirty,
  saving,
  error,
  onChange,
  onSave,
  onCancel,
  onClose,
  onOpenGroup,
  onRemove,
}: ActionToolbarProps): React.ReactElement {
  const [showIcons, setShowIcons] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);
  const definition = assignment ? ACTION_DEFINITIONS.get(assignment.definitionId) ?? null : null;
  const Icon = assignment ? resolveIcon(assignment.iconName) : Trash2;

  useEffect(() => {
    labelRef.current?.focus();
  }, [assignment?.id]);

  return (
    <aside className={styles.toolbar} aria-label="Edit action toolbar">
      <header className={styles.header}>
        <div className={styles.headerIcon}>
          {assignment?.iconDataUrl
            ? <img src={assignment.iconDataUrl} alt="" draggable={false} width={20} height={20} />
            : <Icon size={19} />}
        </div>
        <div>
          <span>Edit action</span>
          <strong>{assignment?.label ?? 'Bubble cleared'}</strong>
        </div>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close edit action toolbar"><X size={16} /></button>
      </header>

      <div className={styles.body}>
        {!assignment ? (
          <div className={styles.removedState}>
            <Trash2 size={28} />
            <strong>This bubble will be removed</strong>
            <p>Save to commit the change, or cancel to restore it.</p>
          </div>
        ) : (
          <>
            <SetupNotice definition={definition} assignment={assignment} />
            <VerificationNotice definition={definition} />

            <label className={styles.field}>
              <span>Label</span>
              <input
                ref={labelRef}
                value={assignment.label}
                maxLength={40}
                onChange={(event) => onChange({ ...assignment, label: event.target.value })}
              />
            </label>

            <div className={styles.iconField}>
              <span>Icon</span>
              <button type="button" onClick={() => setShowIcons((value) => !value)}>
                <span className={styles.currentIcon}>
                  {assignment.iconDataUrl
                    ? <img src={assignment.iconDataUrl} alt="" draggable={false} width={17} height={17} />
                    : <Icon size={17} />}
                </span>
                <span>
                  {assignment.iconDataUrl
                    ? (assignment.iconName.includes(':') ? 'Custom icon (online)' : 'Application icon')
                    : assignment.iconName}
                </span>
                <ImagePlus size={14} />
              </button>
            </div>
            {showIcons && (
              <div className={styles.iconPanel}>
                <IconPicker
                  selectedIcon={assignment.iconName}
                  onSelect={(iconName, iconDataUrl) => {
                    onChange({ ...assignment, iconName, iconDataUrl });
                    setShowIcons(false);
                  }}
                />
              </div>
            )}

            {definition?.editorFields.map((field) => (
              <FieldControl
                key={field.key}
                field={field}
                assignment={assignment}
                profiles={profiles}
                onChange={onChange}
              />
            ))}

            {assignment.type === 'menu' && onOpenGroup && (
              <button type="button" className={styles.openGroupButton} onClick={onOpenGroup}>
                <FolderOpen size={15} />
                <span><strong>Open sub-ring</strong><small>Place and edit actions in the visual second layer</small></span>
                <ChevronDown size={14} className={styles.openGroupChevron} />
              </button>
            )}

            {assignment.type === 'menu' && <GroupChildren assignment={assignment} profiles={profiles} onChange={onChange} />}

            {assignment.definitionId === 'custom-action' && (
              <div className={styles.customHint}>
                <strong>Macro syntax</strong>
                <p>Click the dashed box above and press a key to add it as a real key press (shown as a chip — remove and re-press to change it, it can&rsquo;t be typed into). Use <strong>+ Type</strong> for characters to type on a command line like AutoCAD, <strong>+ Text</strong> for pasted/Unicode text, <strong>+ Delay</strong> for a pause, or <strong>+ Custom</strong> for a raw <code>url:</code>, <code>app:</code>, <code>file:</code>, <code>folder:</code>, or <code>command:</code> step.</p>
              </div>
            )}
          </>
        )}

        {error && <div className={styles.error}><AlertCircle size={14} /><span>{error}</span></div>}
      </div>

      <footer className={styles.footer}>
        {assignment && <button type="button" className={styles.removeButton} onClick={onRemove}><Trash2 size={14} /> Remove</button>}
        <button type="button" className={styles.cancelButton} onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className={styles.saveButton} onClick={onSave} disabled={!dirty || saving}>{saving ? 'Saving...' : 'Save'}</button>
      </footer>
    </aside>
  );
}
