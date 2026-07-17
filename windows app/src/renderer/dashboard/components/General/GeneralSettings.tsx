import React from 'react';
import { CircleDot, Info, Keyboard, MonitorCog, Power, RotateCcw, Sparkles } from 'lucide-react';
import { useDashboardStore } from '../../store/dashboardStore';
import { DEFAULT_ACCENT_COLOR } from '../../../../shared/constants';
import { createEmptySlots, slotsToBubbles } from '../../../../shared/profileUtils';
import type { RingSize, ThemeMode } from '../../../../shared/types';
import { HotkeyConfig } from '../HotkeyConfig/HotkeyConfig';
import { RingPreview } from '../RingPreview/RingPreview';
import styles from './GeneralSettings.module.css';

const RING_SIZE_OPTIONS: Array<{ value: RingSize; label: string; hint: string }> = [
  { value: 'small', label: 'Small', hint: 'Compact' },
  { value: 'medium', label: 'Medium', hint: 'Default' },
  { value: 'large', label: 'Large', hint: 'Spacious' },
];

const THEME_MODE_OPTIONS: Array<{ value: ThemeMode; label: string; hint: string }> = [
  { value: 'system', label: 'System', hint: 'Match OS' },
  { value: 'light', label: 'Light', hint: 'Bright UI' },
  { value: 'dark', label: 'Dark', hint: 'Dark UI' },
  { value: 'custom', label: 'Custom', hint: 'Pick accent' },
];

export function GeneralSettings(): React.ReactElement {
  const config = useDashboardStore((state) => state.config);
  const setRingSize = useDashboardStore((state) => state.setRingSize);
  const setTheme = useDashboardStore((state) => state.setTheme);
  const setLaunchAtStartup = useDashboardStore((state) => state.setLaunchAtStartup);
  const setRingEnabled = useDashboardStore((state) => state.setRingEnabled);
  const setTriggerMode = useDashboardStore((state) => state.setTriggerMode);
  const saveProfile = useDashboardStore((state) => state.saveProfile);

  if (!config) return <div className={styles.loading}>Loading settings...</div>;

  const generalProfile = config.profiles.find((profile) => profile.id === config.generalProfileId);
  const themeMode = config.theme?.mode ?? 'dark';
  const accentColor = config.theme?.accentColor ?? DEFAULT_ACCENT_COLOR;

  const handleThemeChange = (mode: ThemeMode, nextAccentColor = accentColor) => {
    if (mode === themeMode && nextAccentColor === accentColor) return;
    void setTheme({ mode, accentColor: nextAccentColor });
  };

  const handleReset = async () => {
    if (!generalProfile) return;
    if (!window.confirm('Clear the General profile and restore five empty bubbles? Other profiles and settings will not change.')) return;
    await saveProfile({ ...generalProfile, slots: createEmptySlots() });
  };

  return (
    <div className={styles.settingsPage}>
      <header className={styles.pageHeader}>
        <div>
          <span>One place for every preference</span>
          <h1>General settings</h1>
          <p>Configure the trigger, appearance, preview, startup behavior, and fallback ring.</p>
        </div>
        <span className={`${styles.statusPill}${config.ringEnabled ? ` ${styles.statusPillOn}` : ''}`}>
          <CircleDot size={13} /> {config.ringEnabled ? 'Ring enabled' : 'Ring paused'}
        </span>
      </header>

      <div className={styles.settingsGrid}>
        <main className={styles.settingsColumn}>
          <section className={styles.card}>
            <div className={styles.cardHeading}><Keyboard size={17} /><div><strong>Trigger</strong><small>Open the ring from anywhere</small></div></div>
            <HotkeyConfig embedded />
            <div className={styles.row}>
              <div><strong>Actions Ring</strong><small>Temporarily pause the global trigger without changing profiles.</small></div>
              <label className={styles.toggle}>
                <input type="checkbox" checked={config.ringEnabled} onChange={(event) => void setRingEnabled(event.target.checked)} />
                <span />
              </label>
            </div>
            <div className={styles.rowStack}>
              <div><strong>Trigger behavior</strong><small>Choose how the hotkey opens and confirms the ring.</small></div>
              <div className={styles.twoSegments}>
                <button type="button" className={config.triggerMode === 'A' ? styles.segmentActive : ''} onClick={() => config.triggerMode !== 'A' && void setTriggerMode('A')}><strong>Click, then click</strong><small>Open and select separately</small></button>
                <button type="button" className={config.triggerMode === 'B' ? styles.segmentActive : ''} onClick={() => config.triggerMode !== 'B' && void setTriggerMode('B')}><strong>Hold and release</strong><small>Release over an action</small></button>
              </div>
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeading}><Sparkles size={17} /><div><strong>Appearance</strong><small>Dashboard color and ring scale</small></div></div>
            <div className={styles.optionLabel}>Dashboard theme</div>
            <div className={styles.threeSegments} role="group" aria-label="Dashboard theme">
              {THEME_MODE_OPTIONS.map((option) => (
                <button key={option.value} type="button" className={themeMode === option.value ? styles.segmentActive : ''} onClick={() => handleThemeChange(option.value)} aria-pressed={themeMode === option.value}>
                  <strong>{option.label}</strong><small>{option.hint}</small>
                </button>
              ))}
            </div>
            {themeMode === 'custom' && (
              <div className={styles.row}>
                <div><strong>Accent color</strong><small>Used for selections, controls, and ring highlights.</small></div>
                <label className={styles.colorPicker}><input type="color" value={accentColor} onChange={(event) => handleThemeChange('custom', event.target.value)} /><span>{accentColor}</span></label>
              </div>
            )}
            <div className={styles.optionLabel}>Overlay ring size</div>
            <div className={styles.threeSegments} role="group" aria-label="Actions Ring size">
              {RING_SIZE_OPTIONS.map((option) => (
                <button key={option.value} type="button" className={config.ringSize === option.value ? styles.segmentActive : ''} onClick={() => config.ringSize !== option.value && void setRingSize(option.value)} aria-pressed={config.ringSize === option.value}>
                  <strong>{option.label}</strong><small>{option.hint}</small>
                </button>
              ))}
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeading}><Power size={17} /><div><strong>Startup</strong><small>Windows session behavior</small></div></div>
            <div className={styles.row}>
              <div><strong>Launch at startup</strong><small>Start Logi Actions Ring when you sign in to Windows.</small></div>
              <label className={styles.toggle}>
                <input type="checkbox" checked={config.launchAtStartup} onChange={(event) => void setLaunchAtStartup(event.target.checked)} />
                <span />
              </label>
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeading}><RotateCcw size={17} /><div><strong>Data and reset</strong><small>Restore only the protected fallback profile</small></div></div>
            <div className={styles.row}>
              <div><strong>Reset General ring</strong><small>Replace its layout with five empty bubbles. Named profiles stay intact.</small></div>
              <button type="button" className={styles.resetButton} onClick={handleReset}>Reset ring</button>
            </div>
          </section>

          <section className={styles.aboutCard}>
            <Info size={16} />
            <div><strong>Logi Actions Ring 1.0.0</strong><small>Dashboard V2 configuration schema {config.schemaVersion}. All profile data stays on this device.</small></div>
          </section>
        </main>

        <aside className={styles.previewColumn}>
          <div className={styles.previewHeading}><MonitorCog size={16} /><span><strong>Live preview</strong><small>{generalProfile?.name ?? 'General'} fallback profile</small></span></div>
          <div className={styles.previewFrame}>
            <RingPreview bubbles={generalProfile ? slotsToBubbles(generalProfile.slots) : []} />
          </div>
          <p>Preview updates as soon as a profile is saved. Empty positions remain available in the profile editor.</p>
        </aside>
      </div>
    </div>
  );
}
