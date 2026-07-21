import { create } from 'zustand';
import type { AppConfig, DashboardStore, LabelSize, MutationResult, RingProfile, RingSize, ThemeConfig } from '../../../shared/types';

function withUpdatedProfiles(config: AppConfig, profiles: RingProfile[]): AppConfig {
  return { ...config, profiles };
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  config: null,
  isLoading: false,
  isDirty: false,
  graphicsStatus: null,
  isGraphicsStatusLoading: false,
  isRelaunching: false,

  loadConfig: async () => {
    set({ isLoading: true });
    try {
      const config = await window.electronAPI.getConfig();
      set({ config, isLoading: false, isDirty: false });
    } catch (err) {
      console.error('[dashboardStore] loadConfig failed:', err);
      set({ isLoading: false });
    }
  },

  setHotkey: async (hotkey: string) => {
    if (get().config?.hotkey === hotkey) return;
    const result = await window.electronAPI.setHotkey(hotkey);
    if (result.success) {
      set((s) => ({
        config: s.config ? { ...s.config, hotkey } : s.config,
        isDirty: false,
      }));
    }
  },

  setRingSize: async (ringSize: RingSize) => {
    if (get().config?.ringSize === ringSize) return;
    const result = await window.electronAPI.setRingSize(ringSize);
    if (result.success) {
      set((s) => ({
        config: s.config ? { ...s.config, ringSize } : s.config,
        isDirty: false,
      }));
    }
  },

  setLabelSize: async (labelSize: LabelSize) => {
    if (get().config?.labelSize === labelSize) return;
    const result = await window.electronAPI.setLabelSize(labelSize);
    if (result.success) {
      set((s) => ({
        config: s.config ? { ...s.config, labelSize } : s.config,
        isDirty: false,
      }));
    }
  },

  setTheme: async (theme: ThemeConfig) => {
    const currentTheme = get().config?.theme;
    if (
      currentTheme?.mode === theme.mode &&
      currentTheme.accentColor === theme.accentColor &&
      currentTheme.bubbleColor === theme.bubbleColor
    ) return;
    const result = await window.electronAPI.setTheme(theme);
    if (result.success) {
      set((s) => ({
        config: s.config ? { ...s.config, theme } : s.config,
        isDirty: false,
      }));
    }
  },

  setLaunchAtStartup: async (value: boolean) => {
    if (get().config?.launchAtStartup === value) return;
    const result = await window.electronAPI.setLaunchAtStartup(value);
    if (result.success) {
      set((s) => ({
        config: s.config ? { ...s.config, launchAtStartup: value } : s.config,
      }));
    }
  },

  setRingEnabled: async (value: boolean) => {
    if (get().config?.ringEnabled === value) return;
    const result = await window.electronAPI.setRingEnabled(value);
    if (result.success) {
      set((s) => ({
        config: s.config ? { ...s.config, ringEnabled: value } : s.config,
      }));
    }
  },

  setTriggerMode: async (value: 'A' | 'B') => {
    if (get().config?.triggerMode === value) return;
    const result = await window.electronAPI.setTriggerMode(value);
    if (result.success) {
      set((s) => ({
        config: s.config ? { ...s.config, triggerMode: value } : s.config,
      }));
    }
  },

  loadGraphicsAccelerationStatus: async () => {
    if (get().isGraphicsStatusLoading) return;
    set({ isGraphicsStatusLoading: true });
    try {
      const graphicsStatus = await window.electronAPI.getGraphicsAccelerationStatus();
      set({ graphicsStatus, isGraphicsStatusLoading: false });
    } catch (err) {
      console.error('[dashboardStore] loadGraphicsAccelerationStatus failed:', err);
      set({ isGraphicsStatusLoading: false });
    }
  },

  setHardwareAcceleration: async (value: boolean) => {
    if (get().config?.hardwareAcceleration === value) return;
    try {
      const graphicsStatus = await window.electronAPI.setHardwareAcceleration(value);
      set((state) => ({
        config: state.config ? { ...state.config, hardwareAcceleration: value } : state.config,
        graphicsStatus,
      }));
    } catch (err) {
      console.error('[dashboardStore] setHardwareAcceleration failed:', err);
    }
  },

  relaunchApp: async () => {
    if (get().isRelaunching) return;
    set({ isRelaunching: true });
    try {
      await window.electronAPI.relaunchApp();
    } catch (err) {
      console.error('[dashboardStore] relaunchApp failed:', err);
      set({ isRelaunching: false });
    }
  },

  saveProfile: async (profile: RingProfile): Promise<MutationResult<RingProfile>> => {
    const result = await window.electronAPI.saveProfile(profile);
    if (result.status === 'ok') {
      const savedProfile = result.value ?? profile;
      set((state) => ({
        config: state.config
          ? withUpdatedProfiles(
              state.config,
              state.config.profiles.map((item) => item.id === savedProfile.id ? savedProfile : item)
            )
          : state.config,
        isDirty: false,
      }));
    }
    return result;
  },

  addProfile: async (profile: RingProfile): Promise<MutationResult<RingProfile>> => {
    const result = await window.electronAPI.addProfile(profile);
    if (result.status === 'ok') {
      const savedProfile = result.value ?? profile;
      set((state) => ({
        config: state.config
          ? withUpdatedProfiles(state.config, [...state.config.profiles, savedProfile])
          : state.config,
        isDirty: false,
      }));
    }
    return result;
  },

  removeProfile: async (id: string): Promise<MutationResult> => {
    const result = await window.electronAPI.removeProfile(id);
    if (result.status === 'ok') {
      set((state) => {
        const config = state.config;
        return {
          config: config
            ? {
                ...withUpdatedProfiles(config, config.profiles.filter((item) => item.id !== id)),
                selectedGlobalProfileId: config.selectedGlobalProfileId === id ? null : config.selectedGlobalProfileId,
              }
            : config,
          isDirty: false,
        };
      });
    }
    return result;
  },

  setSelectedGlobalProfile: async (id: string | null): Promise<MutationResult> => {
    if (get().config?.selectedGlobalProfileId === id) return { status: 'ok' };
    const result = await window.electronAPI.setSelectedGlobalProfile(id);
    if (result.status === 'ok') {
      set((s) => ({
        config: s.config ? { ...s.config, selectedGlobalProfileId: id } : s.config,
      }));
    }
    return result;
  },

}));
