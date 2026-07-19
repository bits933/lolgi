import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as LucideIcons from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import {
  AppWindow,
  Crosshair,
  FolderOpen,
  Globe2,
  ListFilter,
  LoaderCircle,
  PackageSearch,
  Search,
  X,
} from 'lucide-react';
import { APP_PROFILE_PRESETS, createAppProfileFromPreset, getSupportedAppId } from '../../../../shared/defaultProfiles';
import { createEmptySlots } from '../../../../shared/profileUtils';
import type { ForegroundAppInfo, MutationResult, RingProfile, RingSlot, SupportedAppId } from '../../../../shared/types';
import { getAppIconSource } from '../../appIcons';
import type { InstalledAppInfo } from '../../env.d';
import styles from './NewProfileModal.module.css';

type ApplicationTab = 'detect' | 'running' | 'installed' | 'manual';
type StartingLayout = 'blank' | 'general';
type AnyIcon = React.ComponentType<{ size?: number; strokeWidth?: number }>;

function resolveIcon(name: string): AnyIcon {
  return (LucideIcons as unknown as Record<string, AnyIcon>)[name] ?? AppWindow;
}

interface SelectedApplication {
  processName: string;
  displayName: string;
  executablePath?: string;
  iconDataUrl?: string;
}

function cloneSlots(slots: RingSlot[]): RingSlot[] {
  return slots.map((slot, position) => ({
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
  }));
}

interface NewProfileModalProps {
  profiles: RingProfile[];
  generalProfile: RingProfile;
  onCancel: () => void;
  onCreate: (profile: RingProfile) => Promise<MutationResult<RingProfile>>;
}

export function NewProfileModal({
  profiles,
  generalProfile,
  onCancel,
  onCreate,
}: NewProfileModalProps): React.ReactElement {
  const [kind, setKind] = useState<'global' | 'application' | null>(null);
  const [name, setName] = useState('');
  const [layout, setLayout] = useState<StartingLayout>('blank');
  const [tab, setTab] = useState<ApplicationTab>('detect');
  const [query, setQuery] = useState('');
  const [manualProcess, setManualProcess] = useState('');
  const [selectedApplication, setSelectedApplication] = useState<SelectedApplication | null>(null);
  const [running, setRunning] = useState<ForegroundAppInfo[]>([]);
  const [installed, setInstalled] = useState<InstalledAppInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [extractingIcon, setExtractingIcon] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appListCache = useRef<{ running?: ForegroundAppInfo[]; installed?: InstalledAppInfo[] }>({});

  useEffect(() => {
    if (kind !== 'application' || (tab !== 'running' && tab !== 'installed')) return;
    const cachedItems = appListCache.current[tab];
    if (cachedItems) {
      if (tab === 'running') setRunning(cachedItems as ForegroundAppInfo[]);
      else setInstalled(cachedItems as InstalledAppInfo[]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const request = tab === 'running' ? window.electronAPI.listRunningApps() : window.electronAPI.listInstalledApps();
    request
      .then((items) => {
        if (cancelled) return;
        if (tab === 'running') {
          const runningItems = items as ForegroundAppInfo[];
          appListCache.current.running = runningItems;
          setRunning(runningItems);
        } else {
          const installedItems = items as InstalledAppInfo[];
          appListCache.current.installed = installedItems;
          setInstalled(installedItems);
        }
      })
      .catch((reason) => !cancelled && setError(String(reason)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [kind, tab]);

  const runningSearchEntries = useMemo(
    () => running.map((app) => ({ app, searchText: `${app.processName} ${app.windowTitle}`.toLowerCase() })),
    [running]
  );

  const installedSearchEntries = useMemo(
    () => installed.map((app) => ({ app, searchText: `${app.processName} ${app.displayName}`.toLowerCase() })),
    [installed]
  );

  const filteredRunning = useMemo(() => {
    const normalized = query.toLowerCase();
    return runningSearchEntries.filter(({ searchText }) => searchText.includes(normalized)).map(({ app }) => app);
  }, [query, runningSearchEntries]);

  const filteredInstalled = useMemo(() => {
    const normalized = query.toLowerCase();
    return installedSearchEntries.filter(({ searchText }) => searchText.includes(normalized)).map(({ app }) => app);
  }, [installedSearchEntries, query]);

  const chooseApplication = async (application: SelectedApplication) => {
    // Select immediately so the UI never sits idle while the icon (which can take
    // several seconds on network drives or slow disks) is still being extracted.
    setSelectedApplication({ ...application, iconDataUrl: undefined });
    if (!name.trim()) setName(application.displayName);
    setError(null);
    const path = application.executablePath;
    if (!path) return;
    setExtractingIcon(true);
    try {
      const iconDataUrl = await window.electronAPI.extractAppIcon(path).catch(() => null);
      setSelectedApplication((current) =>
        current && current.processName === application.processName
          ? { ...current, iconDataUrl: iconDataUrl ?? undefined }
          : current
      );
    } finally {
      setExtractingIcon(false);
    }
  };

  const handleDetect = async () => {
    setLoading(true);
    setError(null);
    try {
      const app = await window.electronAPI.detectForegroundApp();
      if (!app?.processName) {
        setError('No external foreground application was detected. Try Running apps or browse for an executable.');
        return;
      }
      await chooseApplication({
        processName: app.processName,
        displayName: app.windowTitle || app.processName,
        executablePath: app.executablePath,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  const handleBrowse = async () => {
    const path = await window.electronAPI.pickFile();
    if (!path) return;
    const fileName = path.split(/[\\/]/).pop() ?? path;
    const processName = fileName.replace(/\.(exe|lnk|bat|cmd)$/i, '');
    await chooseApplication({ processName, displayName: processName, executablePath: path });
  };

  const handleCreate = async () => {
    if (!kind || !name.trim()) {
      setError('Enter a profile name.');
      return;
    }
    if (kind === 'application' && !selectedApplication?.processName.trim()) {
      setError('Choose an application for this profile.');
      return;
    }

    const slots = layout === 'general' ? cloneSlots(generalProfile.slots) : createEmptySlots();
    const profile: RingProfile = {
      id: uuidv4(),
      name: name.trim(),
      kind,
      enabled: true,
      protected: false,
      sortOrder: Math.max(0, ...profiles.map((profileItem) => profileItem.sortOrder)) + 1,
      slots,
      application: kind === 'application' && selectedApplication
        ? {
            processName: selectedApplication.processName,
            displayName: selectedApplication.displayName,
            executablePath: selectedApplication.executablePath,
            iconDataUrl: selectedApplication.iconDataUrl,
          }
        : undefined,
    };

    setSaving(true);
    const result = await onCreate(profile);
    setSaving(false);
    if (result.status !== 'ok') setError(result.message ?? 'The profile could not be created.');
  };

  const handlePresetCreate = async (presetId: SupportedAppId) => {
    setSaving(true);
    setError(null);
    try {
      const sortOrder = Math.max(0, ...profiles.map((profileItem) => profileItem.sortOrder)) + 1;
      const result = await onCreate(createAppProfileFromPreset(presetId, sortOrder));
      if (result.status !== 'ok') {
        setError(result.message ?? 'The app profile could not be created.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="new-profile-title">
        <header className={styles.header}>
          <div>
            <span>Profile setup</span>
            <h2 id="new-profile-title">New Profile</h2>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close profile setup"><X size={18} /></button>
        </header>

        {!kind ? (
          <div className={styles.landing}>
            <section className={styles.presetSection}>
              <div className={styles.presetHeading}>
                <div>
                  <span>Suggested profiles</span>
                  <h3>Start with a researched app ring</h3>
                </div>
                <small>8 editable bubbles each</small>
              </div>
              <div className={styles.presetGrid}>
                {APP_PROFILE_PRESETS.map((preset) => {
                  const iconSource = getAppIconSource(preset.id);
                  const Icon = resolveIcon(preset.iconName);
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={saving}
                      onClick={() => void handlePresetCreate(preset.id)}
                    >
                      <span className={styles.presetIcon}>
                        {iconSource ? (
                          <img className={styles.presetIconGlyph} src={iconSource} alt="" />
                        ) : (
                          <Icon size={20} strokeWidth={1.8} />
                        )}
                      </span>
                      <span className={styles.presetCopy}>
                        <strong>{preset.displayName}</strong>
                        <small>{preset.description}</small>
                      </span>
                      <span className={styles.presetProcess}>
                        <span>{preset.processName}.exe</span>
                        <span>Researched {preset.researchedAt}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
            <div className={styles.startDivider}><span>or build your own</span></div>
            <div className={styles.kindGrid}>
              <button type="button" onClick={() => setKind('global')}>
                <span className={styles.kindIcon}><Globe2 size={25} /></span>
                <strong>Global profile</strong>
                <p>Choose it manually and use it across all applications.</p>
                <small>Independent of the foreground app</small>
              </button>
              <button type="button" onClick={() => setKind('application')}>
                <span className={styles.kindIcon}><AppWindow size={25} /></span>
                <strong>Application profile</strong>
                <p>Activate this ring automatically for one Windows application.</p>
                <small>Matched by normalized process name</small>
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.content}>
            <button type="button" className={styles.backLink} onClick={() => { setKind(null); setError(null); }}>Back to profile type</button>
            <label className={styles.field}>
              <span>Profile name</span>
              <input autoFocus value={name} maxLength={48} onChange={(event) => setName(event.target.value)} placeholder={kind === 'global' ? 'My workspace' : 'Chrome'} />
            </label>

            {kind === 'application' && (
              <div className={styles.applicationSection}>
                <div className={styles.sectionTitle}>Application binding</div>
                <div className={styles.tabs} role="tablist">
                  <button type="button" className={tab === 'detect' ? styles.tabActive : ''} onClick={() => setTab('detect')}><Crosshair size={13} /> Detect</button>
                  <button type="button" className={tab === 'running' ? styles.tabActive : ''} onClick={() => setTab('running')}><ListFilter size={13} /> Running</button>
                  <button type="button" className={tab === 'installed' ? styles.tabActive : ''} onClick={() => setTab('installed')}><PackageSearch size={13} /> Installed</button>
                  <button type="button" className={tab === 'manual' ? styles.tabActive : ''} onClick={() => setTab('manual')}>Manual</button>
                </div>

                {selectedApplication && (
                  <div className={styles.selectedApp}>
                    <span className={styles.appIcon}>
                      {extractingIcon ? (
                        <LoaderCircle size={16} className={styles.spinner} />
                      ) : (
                        (() => {
                          const iconSource = getAppIconSource(getSupportedAppId(selectedApplication.processName));
                          if (iconSource) return <img src={iconSource} alt="" />;
                          if (selectedApplication.iconDataUrl) return <img src={selectedApplication.iconDataUrl} alt="" />;
                          return <AppWindow size={18} />;
                        })()
                      )}
                    </span>
                    <span><strong>{selectedApplication.displayName}</strong><small>{selectedApplication.processName}.exe</small></span>
                    <button type="button" onClick={() => setSelectedApplication(null)}>Change</button>
                  </div>
                )}

                {!selectedApplication && tab === 'detect' && (
                  <div className={styles.detectPane}>
                    <p>The dashboard briefly hides so Windows can return focus to the application behind it.</p>
                    <button type="button" onClick={handleDetect} disabled={loading}><Crosshair size={15} /> {loading ? 'Detecting...' : 'Detect foreground app'}</button>
                  </div>
                )}

                {!selectedApplication && (tab === 'running' || tab === 'installed') && (
                  <div className={styles.appPicker}>
                    <div className={styles.search}><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${tab} apps`} /></div>
                    <div className={styles.appList}>
                      {loading && <div className={styles.loading}><LoaderCircle size={15} /> Loading applications...</div>}
                      {!loading && tab === 'running' && filteredRunning.map((app, index) => (
                        <button key={`${app.processName}-${index}`} type="button" onClick={() => void chooseApplication({ processName: app.processName, displayName: app.windowTitle || app.processName, executablePath: app.executablePath })}>
                          <strong>{app.windowTitle || app.processName}</strong><small>{app.processName}.exe</small>
                        </button>
                      ))}
                      {!loading && tab === 'installed' && filteredInstalled.map((app, index) => (
                        <button key={`${app.executablePath}-${index}`} type="button" onClick={() => void chooseApplication({ processName: app.processName, displayName: app.displayName, executablePath: app.executablePath })}>
                          <strong>{app.displayName}</strong><small>{app.processName}.exe</small>
                        </button>
                      ))}
                      {!loading && ((tab === 'running' && filteredRunning.length === 0) || (tab === 'installed' && filteredInstalled.length === 0)) && (
                        <div className={styles.emptyApps}>No applications match this search. Try a shorter name or browse for an executable.</div>
                      )}
                    </div>
                    <button type="button" className={styles.browseLink} onClick={handleBrowse}><FolderOpen size={13} /> Browse for executable</button>
                  </div>
                )}

                {!selectedApplication && tab === 'manual' && (
                  <div className={styles.manualRow}>
                    <input value={manualProcess} onChange={(event) => setManualProcess(event.target.value)} placeholder="Process name, for example chrome" />
                    <button type="button" onClick={() => {
                      const processName = manualProcess.trim().replace(/\.exe$/i, '');
                      if (processName) void chooseApplication({ processName, displayName: processName });
                    }}>Use process</button>
                  </div>
                )}
              </div>
            )}

            <div className={styles.sectionTitle}>Starting layout</div>
            <div className={styles.layoutOptions}>
              <label className={layout === 'blank' ? styles.layoutActive : ''}>
                <input type="radio" name="layout" checked={layout === 'blank'} onChange={() => setLayout('blank')} />
                <span><strong>Five empty bubbles</strong><small>Build the profile from scratch</small></span>
              </label>
              <label className={layout === 'general' ? styles.layoutActive : ''}>
                <input type="radio" name="layout" checked={layout === 'general'} onChange={() => setLayout('general')} />
                <span><strong>Duplicate General</strong><small>Start with the current fallback ring</small></span>
              </label>
            </div>
          </div>
        )}

        {error && <div className={styles.error} role="alert" aria-live="assertive">{error}</div>}
        {kind && (
          <footer className={styles.footer}>
            <button type="button" className={styles.cancelButton} onClick={onCancel}>Cancel</button>
            <button type="button" className={styles.createButton} onClick={handleCreate} disabled={saving}>{saving ? 'Creating…' : 'Create Profile'}</button>
          </footer>
        )}
      </section>
    </div>
  );
}
