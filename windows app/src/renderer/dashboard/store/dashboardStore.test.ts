import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, ThemeConfig } from '../../../shared/types';
import { createGeneralProfile } from '../../../shared/profileUtils';
import { DEFAULT_THEME } from '../../../shared/constants';

const setTheme = vi.fn(async () => ({ success: true }));

function config(): AppConfig {
  const general = createGeneralProfile();
  return {
    schemaVersion: 2,
    generalProfileId: general.id,
    selectedGlobalProfileId: null,
    profiles: [general],
    hotkey: 'Ctrl+Space',
    launchAtStartup: false,
    hardwareAcceleration: true,
    ringEnabled: true,
    triggerMode: 'A',
    ringSize: 'medium',
    labelSize: 'medium',
    theme: DEFAULT_THEME,
  };
}

describe('dashboard theme persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    setTheme.mockClear();
    vi.stubGlobal('window', {
      electronAPI: {
        getConfig: vi.fn(async () => config()),
        setTheme,
      },
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('previews immediately and persists only the latest theme from a burst', async () => {
    const { THEME_PERSIST_DELAY_MS, useDashboardStore } = await import('./dashboardStore');
    await useDashboardStore.getState().loadConfig();
    const first: ThemeConfig = { ...DEFAULT_THEME, accentColor: '#112233' };
    const latest: ThemeConfig = { ...DEFAULT_THEME, accentColor: '#445566' };

    await useDashboardStore.getState().setTheme(first);
    await useDashboardStore.getState().setTheme(latest);

    expect(useDashboardStore.getState().config?.theme).toEqual(latest);
    expect(setTheme).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(THEME_PERSIST_DELAY_MS);

    expect(setTheme).toHaveBeenCalledOnce();
    expect(setTheme).toHaveBeenCalledWith(latest);
  });

  it('flushes the pending theme immediately when editing finishes', async () => {
    const { flushPendingThemePersistence, useDashboardStore } = await import('./dashboardStore');
    await useDashboardStore.getState().loadConfig();
    const theme: ThemeConfig = { ...DEFAULT_THEME, bubbleColor: '#223344' };

    await useDashboardStore.getState().setTheme(theme);
    await flushPendingThemePersistence();

    expect(setTheme).toHaveBeenCalledOnce();
    expect(setTheme).toHaveBeenCalledWith(theme);
  });
});
