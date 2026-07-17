import React, { useEffect, useRef, useState } from 'react';
import { AppWindow, ChevronLeft, ChevronRight, CircleDot, Globe2, Plus, Settings2 } from 'lucide-react';
import type { RingProfile } from '../../../../shared/types';
import styles from './Sidebar.module.css';

export type SidebarPage = 'profile' | 'settings';

const SIDEBAR_COLLAPSED_KEY = 'dashboard.sidebar.collapsed';

interface SidebarProps {
  activePage: SidebarPage;
  profiles: RingProfile[];
  activeProfileId: string | null;
  onSelectProfile: (id: string) => void;
  onRenameProfile: (id: string, name: string) => void;
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
  onSelectProfile,
  onRenameProfile,
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
            return (
              <button
                key={profile.id}
                type="button"
                className={`${styles.profileItem}${active ? ` ${styles.profileItemActive}` : ''}`}
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
              </button>
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
        </button>
        <div className={styles.version}>Dashboard V2</div>
      </div>
    </aside>
  );
}
