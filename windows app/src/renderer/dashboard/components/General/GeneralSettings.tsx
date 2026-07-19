import React, { useEffect, useState } from 'react';
import { CircleDot, Copy, Info, Keyboard, Power, RotateCcw, Sparkles } from 'lucide-react';
import { useDashboardStore } from '../../store/dashboardStore';
import { DEFAULT_ACCENT_COLOR, DEFAULT_BUBBLE_COLOR } from '../../../../shared/constants';
import { createEmptySlots } from '../../../../shared/profileUtils';
import type { RingSize, ThemeConfig, ThemeMode } from '../../../../shared/types';
import type { RuntimeBuildIdentity } from '../../../../shared/buildInfo';
import { HotkeyConfig } from '../HotkeyConfig/HotkeyConfig';
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

function formatBuildTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'unknown build time' : date.toISOString();
}

export function GeneralSettings(): React.ReactElement {
  const config = useDashboardStore((state) => state.config);
  const setRingSize = useDashboardStore((state) => state.setRingSize);
  const setTheme = useDashboardStore((state) => state.setTheme);
  const setLaunchAtStartup = useDashboardStore((state) => state.setLaunchAtStartup);
  const setRingEnabled = useDashboardStore((state) => state.setRingEnabled);
  const setTriggerMode = useDashboardStore((state) => state.setTriggerMode);
  const saveProfile = useDashboardStore((state) => state.saveProfile);
  const [buildIdentity, setBuildIdentity] = useState<RuntimeBuildIdentity | null>(null);
  const [diagnosticStatus, setDiagnosticStatus] = useState('');
  const [isCopyingDiagnostic, setIsCopyingDiagnostic] = useState(false);

  useEffect(() => {
    let active = true;
    void window.electronAPI.getBuildIdentity()
      .then((identity) => {
        if (active) setBuildIdentity(identity);
      })
      .catch(() => {
        if (active) setDiagnosticStatus('Build identity is unavailable.');
      });
    return () => {
      active = false;
    };
  }, []);

  if (!config) return <div className={styles.loading}>Loading settings...</div>;

  const generalProfile = config.profiles.find((profile) => profile.id === config.generalProfileId);
  const themeMode = config.theme?.mode ?? 'dark';
  const accentColor = config.theme?.accentColor ?? DEFAULT_ACCENT_COLOR;
  const bubbleColor = config.theme?.bubbleColor ?? DEFAULT_BUBBLE_COLOR;

  const applyTheme = (patch: Partial<ThemeConfig>) => {
    void setTheme({ mode: themeMode, accentColor, bubbleColor, ...patch });
  };

  const handleReset = async () => {
    if (!generalProfile) return;
    if (!window.confirm('Clear the General profile and restore five empty bubbles? Other profiles and settings will not change.')) return;
    await saveProfile({ ...generalProfile, slots: createEmptySlots() });
  };

  const handleCopyDiagnostic = async () => {
    setIsCopyingDiagnostic(true);
    try {
      const result = await window.electronAPI.copyLastDiagnostic();
      setDiagnosticStatus(result.message);
    } catch {
      setDiagnosticStatus('Diagnostics are unavailable in this build.');
    } finally {
      setIsCopyingDiagnostic(false);
    }
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
                <button key={option.value} type="button" className={themeMode === option.value ? styles.segmentActive : ''} onClick={() => applyTheme({ mode: option.value })} aria-pressed={themeMode === option.value}>
                  <strong>{option.label}</strong><small>{option.hint}</small>
                </button>
              ))}
            </div>
            {themeMode === 'custom' && (
              <div className={styles.row}>
                <div><strong>Accent color</strong><small>Used for selections, controls, and ring highlights.</small></div>
                <label className={styles.colorPicker}><input type="color" value={accentColor} onChange={(event) => applyTheme({ accentColor: event.target.value })} /><span>{accentColor}</span></label>
              </div>
            )}
            <div className={styles.row}>
              <div><strong>Bubble color</strong><small>Background color of the ring's action bubbles. Icons adjust automatically for contrast.</small></div>
              <label className={styles.colorPicker}>
                <input type="color" value={bubbleColor} onChange={(event) => applyTheme({ bubbleColor: event.target.value })} />
                <span>{bubbleColor}</span>
                {bubbleColor.toLowerCase() !== DEFAULT_BUBBLE_COLOR && (
                  <button type="button" className={styles.colorReset} onClick={() => applyTheme({ bubbleColor: DEFAULT_BUBBLE_COLOR })} title="Reset to default">Reset</button>
                )}
              </label>
            </div>
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
              <div><strong>Launch at startup</strong><small>Start Lolgi Action Ring when you sign in to Windows.</small></div>
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
            <div className={styles.aboutBody}>
              <div className={styles.aboutHeading}>
                <div>
                  <strong>Lolgi Action Ring {buildIdentity ? `v${buildIdentity.version}` : ''}</strong>
                  <small>Diagnostics and build identity</small>
                </div>
                <button
                  type="button"
                  className={styles.diagnosticButton}
                  onClick={() => void handleCopyDiagnostic()}
                  disabled={isCopyingDiagnostic}
                >
                  <Copy size={13} />
                  {isCopyingDiagnostic ? 'Copying...' : 'Copy last diagnostic'}
                </button>
              </div>
              {buildIdentity ? (
                <div className={styles.buildDetails}>
                  <span>
                    Version {buildIdentity.version}
                    {' · '}
                    {buildIdentity.mode}
                    {' · '}
                    {formatBuildTime(buildIdentity.builtAtUtc)}
                  </span>
                  <code title={buildIdentity.gitCommit}>
                    Commit {buildIdentity.gitCommit}
                    {buildIdentity.dirty ? ' + local changes' : ''}
                  </code>
                  <code title={buildIdentity.sourceFingerprint}>
                    Source SHA-256 {buildIdentity.sourceFingerprint}
                  </code>
                  <code title={buildIdentity.execPath}>Executable {buildIdentity.execPath}</code>
                </div>
              ) : (
                <small>Loading build identity...</small>
              )}
              <small>
                Configuration schema {config.schemaVersion}. Diagnostic snapshots stay on this device and omit window/document titles.
              </small>
              {diagnosticStatus && <span className={styles.diagnosticStatus} aria-live="polite">{diagnosticStatus}</span>}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
