import React, { useEffect, useRef, useState } from 'react';
import {
  AppWindow,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleDot,
  CopyPlus,
  EllipsisVertical,
  Globe2,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Settings2,
  Trash2,
} from 'lucide-react';
import type { RingProfile } from '../../../../shared/types';
import styles from './Sidebar.module.css';

export type SidebarPage = 'profile' | 'settings';

const SIDEBAR_COLLAPSED_KEY = 'dashboard.sidebar.collapsed';

interface SidebarProps {
  activePage: SidebarPage;
  profiles: RingProfile[];
  activeProfileId: string | null;
  hasUnsavedChanges?: boolean;
  onSelectProfile: (id: string) => void;
  onRenameProfile: (id: string, name: string) => void;
  onDuplicateProfile: (id: string) => void;
  onToggleProfile: (id: string) => void;
  onRemoveProfile: (id: string) => void;
  onMoveProfile: (id: string, direction: 'up' | 'down') => void;
  onReorderProfiles: (sourceId: string, targetId: string) => void;
  onAddProfile: () => void;
  onOpenSettings: () => void;
}
function ProfileIcon({ profile }: { profile: RingProfile }): React.ReactElement {
  if (profile.application?.iconDataUrl) {
    return <img className={styles.profileIconImage} src={profile.application.iconDataUrl} alt="" />;
  }
  if (profile.kind === 'application') return <AppWindow size={17} />;
  if (profile.kind === 'global') return <Globe2 size={17} />;
  return <CircleDot size={17} />;
}

export function Sidebar({
  activePage,
  profiles,
  activeProfileId,
  hasUnsavedChanges = false,
  onSelectProfile,
  onRenameProfile,
  onDuplicateProfile,
  onToggleProfile,
  onRemoveProfile,
  onMoveProfile,
  onReorderProfiles,
  onAddProfile,
  onOpenSettings,
}: SidebarProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [openMenuProfileId, setOpenMenuProfileId] = useState<string | null>(null);
  const [dropTargetProfileId, setDropTargetProfileId] = useState<string | null>(null);
  const nameEditorRef = useRef<HTMLSpanElement | null>(null);
  const sortedProfiles = [...profiles].sort((a, b) => a.sortOrder - b.sortOrder);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch {
      // The dashboard still works when renderer storage is unavailable.
    }
  }, [collapsed]);

  useEffect(() => {
    if (!editingProfileId || !nameEditorRef.current) return;
    nameEditorRef.current.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(nameEditorRef.current);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editingProfileId]);

  useEffect(() => {
    if (!openMenuProfileId) return;
    const closeMenu = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const root = target.closest<HTMLElement>('[data-profile-menu-root]');
      if (root?.dataset.profileMenuRoot !== openMenuProfileId) {
        setOpenMenuProfileId(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenuProfileId(null);
    };
    document.addEventListener('pointerdown', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openMenuProfileId]);

  const finishRenaming = (profile: RingProfile, save: boolean) => {
    const nextName = nameEditorRef.current?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    setEditingProfileId(null);
    if (save && nextName && nextName !== profile.name) {
      onRenameProfile(profile.id, nextName);
    }
  };

  return (
    <aside className={`${styles.sidebar}${collapsed ? ` ${styles.sidebarCollapsed}` : ''}`} aria-label="Dashboard navigation">
      <div className={styles.logoArea}>
        <div className={styles.brandLockup} aria-hidden={collapsed}>
          <div className={styles.logoIcon}><CircleDot size={18} /></div>
          <div className={styles.logoText}>
            <span className={styles.logoBrand}>Logi</span>
            <span className={styles.logoProduct}>Action Ring</span>
          </div>
        </div>
        <button
          type="button"
          className={styles.collapseBtn}
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
        </button>
      </div>

      <div className={styles.sectionHeader}>Profiles</div>
      <nav className={styles.nav} aria-label="Profiles">
        <div className={styles.profileList}>
          {sortedProfiles.map((profile) => {
            const active = activePage === 'profile' && activeProfileId === profile.id;
            const profileIndex = sortedProfiles.findIndex((item) => item.id === profile.id);
            const menuOpen = openMenuProfileId === profile.id;
            return (
              <div
                key={profile.id}
                className={`${styles.profileRow}${dropTargetProfileId === profile.id ? ` ${styles.profileRowDropTarget}` : ''}`}
                data-profile-menu-root={profile.id}
                draggable={editingProfileId !== profile.id}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('application/x-dashboard-profile', profile.id);
                }}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes('application/x-dashboard-profile')) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDropTargetProfileId(profile.id);
                  }
                }}
                onDragLeave={(event) => {
                  const nextTarget = event.relatedTarget;
                  if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                    setDropTargetProfileId(null);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceId = event.dataTransfer.getData('application/x-dashboard-profile');
                  setDropTargetProfileId(null);
                  if (sourceId && sourceId !== profile.id) onReorderProfiles(sourceId, profile.id);
                }}
                onDragEnd={() => setDropTargetProfileId(null)}
              >
                <div className={styles.profileRowMain}>
                  <button
                    type="button"
                    className={`${styles.profileItem}${active ? ` ${styles.profileItemActive}` : ''}${profile.enabled ? '' : ` ${styles.profileItemDisabled}`}`}
                    onClick={() => {
                      if (editingProfileId !== profile.id) onSelectProfile(profile.id);
                    }}
                    aria-current={active ? 'page' : undefined}
                    aria-label={`Open ${profile.name} profile`}
                    title={collapsed ? profile.name : undefined}
                  >
                    <span className={styles.profileIcon}><ProfileIcon profile={profile} /></span>
                    <span className={styles.profileCopy}>
                      <span
                        key={`${profile.id}:${editingProfileId === profile.id ? 'editing' : 'label'}:${profile.name}`}
                        ref={editingProfileId === profile.id ? nameEditorRef : undefined}
                        className={`${styles.profileName}${editingProfileId === profile.id ? ` ${styles.profileNameEditing}` : ''}`}
                        contentEditable={editingProfileId === profile.id}
                        suppressContentEditableWarning
                        spellCheck={false}
                        data-profile-name-editor={editingProfileId === profile.id ? profile.id : undefined}
                        onDoubleClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (!profile.protected) setEditingProfileId(profile.id);
                        }}
                        onKeyDown={(event) => {
                          if (editingProfileId !== profile.id) return;
                          event.stopPropagation();
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            finishRenaming(profile, true);
                          } else if (event.key === 'Escape') {
                            event.preventDefault();
                            finishRenaming(profile, false);
                          }
                        }}
                        onBlur={() => {
                          if (editingProfileId === profile.id) finishRenaming(profile, false);
                        }}
                      >
                        {profile.name}
                      </span>
                      <span className={styles.profileMeta}>
                        {profile.kind === 'application'
                          ? profile.application?.processName ?? 'Application'
                          : profile.kind === 'general' ? 'Automatic fallback' : 'Global profile'}
                      </span>
                    </span>
                    {!profile.enabled && <span className={styles.profileDisabled}>Off</span>}
                    {active && hasUnsavedChanges && <span className={styles.dirtyDot} title="Unsaved changes" aria-label="Unsaved changes" />}
                  </button>
                  {!collapsed && (
                    <button
                      type="button"
                      className={`${styles.profileMenuButton}${menuOpen ? ` ${styles.profileMenuButtonOpen}` : ''}`}
                      onClick={() => setOpenMenuProfileId((current) => current === profile.id ? null : profile.id)}
                      aria-label={`Profile actions for ${profile.name}`}
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      title="Profile actions"
                    >
                      <EllipsisVertical size={16} />
                    </button>
                  )}
                </div>
                {menuOpen && (
                  <div className={styles.profileMenu} role="menu" aria-label={`${profile.name} profile actions`}>
                    {!profile.protected && (
                      <button type="button" role="menuitem" onClick={() => {
                        setOpenMenuProfileId(null);
                        setEditingProfileId(profile.id);
                      }}><Pencil size={15} /> Rename</button>
                    )}
                    <button type="button" role="menuitem" onClick={() => {
                      setOpenMenuProfileId(null);
                      onDuplicateProfile(profile.id);
                    }}><CopyPlus size={15} /> Duplicate</button>
                    {!profile.protected && (
                      <button type="button" role="menuitem" onClick={() => {
                        setOpenMenuProfileId(null);
                        onToggleProfile(profile.id);
                      }}>{profile.enabled ? <PowerOff size={15} /> : <Power size={15} />} {profile.enabled ? 'Disable' : 'Enable'}</button>
                    )}
                    <div className={styles.profileMenuDivider} role="separator" />
                    <button type="button" role="menuitem" disabled={profileIndex === 0} onClick={() => {
                      setOpenMenuProfileId(null);
                      onMoveProfile(profile.id, 'up');
                    }}><ChevronUp size={15} /> Move Up</button>
                    <button type="button" role="menuitem" disabled={profileIndex === sortedProfiles.length - 1} onClick={() => {
                      setOpenMenuProfileId(null);
                      onMoveProfile(profile.id, 'down');
                    }}><ChevronDown size={15} /> Move Down</button>
                    {!profile.protected && (
                      <>
                        <div className={styles.profileMenuDivider} role="separator" />
                        <button type="button" role="menuitem" className={styles.profileMenuDanger} onClick={() => {
                          setOpenMenuProfileId(null);
                          onRemoveProfile(profile.id);
                        }}><Trash2 size={15} /> Remove…</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <button type="button" className={styles.addProfileBtn} onClick={onAddProfile} aria-label="New profile" title={collapsed ? 'New profile' : undefined}>
          <Plus size={16} />
          <span className={styles.navLabel}>New profile</span>
        </button>
      </nav>

      <div className={styles.footer}>
        <button
          type="button"
          className={`${styles.settingsBtn}${activePage === 'settings' ? ` ${styles.settingsBtnActive}` : ''}`}
          onClick={onOpenSettings}
          aria-label="General settings"
          title={collapsed ? 'General settings' : undefined}
        >
          <Settings2 size={18} />
          <span className={styles.navLabel}>General settings</span>
          {hasUnsavedChanges && <span className={styles.settingsDirtyDot} title="Unsaved changes" aria-label="Unsaved changes" />}
        </button>
        <div className={styles.version}>Dashboard V2</div>
      </div>
    </aside>
  );
}
