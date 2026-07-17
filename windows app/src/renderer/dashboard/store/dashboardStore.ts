import { create } from 'zustand';
import type { AppConfig, DashboardStore, AppProfile, BubbleConfig, MutationResult, RingProfile, RingSize, ThemeConfig } from '../../../shared/types';
import { ringProfileToAppProfile, slotsToBubbles } from '../../../shared/profileUtils';

function withUpdatedProfiles(config: AppConfig, profiles: RingProfile[]): AppConfig {
  const generalProfile = profiles.find((profile) => profile.id === config.generalProfileId);
  return {
    ...config,
    profiles,
    bubbles: generalProfile ? slotsToBubbles(generalProfile.slots) : [],
    appProfiles: profiles.flatMap((profile) => {
      const legacyProfile = ringProfileToAppProfile(profile);
      return legacyProfile ? [legacyProfile] : [];
    }),
  };
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  config: null,
  isLoading: false,
  isDirty: false,

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

  setTheme: async (theme: ThemeConfig) => {
    const currentTheme = get().config?.theme;
    if (currentTheme?.mode === theme.mode && currentTheme.accentColor === theme.accentColor) return;
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
        activeProfileId: savedProfile.id,
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
          activeProfileId: state.activeProfileId === id ? config?.generalProfileId ?? null : state.activeProfileId,
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

  setBubbles: async (bubbles: BubbleConfig[]) => {
    const result = await window.electronAPI.setBubbles(bubbles);
    if (result.success) {
      set((s) => ({
        config: s.config ? { ...s.config, bubbles } : s.config,
        isDirty: false,
      }));
    }
  },

  updateBubble: async (id: string, patch: Partial<BubbleConfig>) => {
    const result = await window.electronAPI.updateBubble(id, patch);
    if (result.success) {
      const current = get().config;
      if (!current) return;
      const bubbles = current.bubbles.map((b) =>
        b.id === id ? { ...b, ...patch } : b
      );
      set({ config: { ...current, bubbles }, isDirty: false });
    }
  },

  addBubble: async (bubble: BubbleConfig) => {
    const result = await window.electronAPI.addBubble(bubble);
    if (result.success) {
      const current = get().config;
      if (!current) return;
      set({ config: { ...current, bubbles: [...current.bubbles, bubble] } });
    }
  },

  removeBubble: async (id: string) => {
    const result = await window.electronAPI.removeBubble(id);
    if (result.success) {
      const current = get().config;
      if (!current) return;
      const bubbles = current.bubbles.filter((b) => b.id !== id);
      set({ config: { ...current, bubbles } });
    }
  },

  reorderBubbles: async (orderedIds: string[]) => {
    const result = await window.electronAPI.reorderBubbles(orderedIds);
    if (result.success) {
      const current = get().config;
      if (!current) return;
      const map = new Map(current.bubbles.map((b) => [b.id, b]));
      const bubbles = orderedIds.flatMap((id) => {
        const b = map.get(id);
        return b ? [b] : [];
      });
      set({ config: { ...current, bubbles } });
    }
  },

  // ---------------------------------------------------------------------------
  // Per-App Profile Management
  // ---------------------------------------------------------------------------

  activeProfileId: null,

  setActiveProfileId: (id: string | null) => {
    set({ activeProfileId: id });
  },

  addAppProfile: async (profile: AppProfile) => {
    const result = await window.electronAPI.addAppProfile(profile);
    if (result.success) {
      const current = get().config;
      if (!current) return;
      set({ config: { ...current, appProfiles: [...(current.appProfiles ?? []), profile] } });
    }
  },

  updateAppProfile: async (id: string, patch: Partial<AppProfile>) => {
    const result = await window.electronAPI.updateAppProfile(id, patch);
    if (result.success) {
      const current = get().config;
      if (!current) return;
      const appProfiles = (current.appProfiles ?? []).map((p) =>
        p.id === id ? { ...p, ...patch } : p
      );
      set({ config: { ...current, appProfiles } });
    }
  },

  removeAppProfile: async (id: string) => {
    const result = await window.electronAPI.removeAppProfile(id);
    if (result.success) {
      const current = get().config;
      if (!current) return;
      const appProfiles = (current.appProfiles ?? []).filter((p) => p.id !== id);
      set({ config: { ...current, appProfiles }, activeProfileId: get().activeProfileId === id ? null : get().activeProfileId });
    }
  },

  setProfileBubbles: async (profileId: string, bubbles: BubbleConfig[]) => {
    const result = await window.electronAPI.setProfileBubbles(profileId, bubbles);
    if (result.success) {
      const current = get().config;
      if (!current) return;
      const appProfiles = (current.appProfiles ?? []).map((p) =>
        p.id === profileId ? { ...p, bubbles } : p
      );
      set({ config: { ...current, appProfiles } });
    }
  },

  updateProfileBubble: async (profileId: string, bubbleId: string, patch: Partial<BubbleConfig>) => {
    const result = await window.electronAPI.updateProfileBubble(profileId, bubbleId, patch);
    if (result.success) {
      const current = get().config;
      if (!current) return;
      const appProfiles = (current.appProfiles ?? []).map((p) => {
        if (p.id !== profileId) return p;
        const bubbles = p.bubbles.map((b) => (b.id === bubbleId ? { ...b, ...patch } : b));
        return { ...p, bubbles };
      });
      set({ config: { ...current, appProfiles } });
    }
  },

  addProfileBubble: async (profileId: string, bubble: BubbleConfig) => {
    const result = await window.electronAPI.addProfileBubble(profileId, bubble);
    if (result.success) {
      const current = get().config;
      if (!current) return;
      const appProfiles = (current.appProfiles ?? []).map((p) =>
        p.id === profileId ? { ...p, bubbles: [...p.bubbles, bubble] } : p
      );
      set({ config: { ...current, appProfiles } });
    }
  },

  removeProfileBubble: async (profileId: string, bubbleId: string) => {
    const result = await window.electronAPI.removeProfileBubble(profileId, bubbleId);
    if (result.success) {
      const current = get().config;
      if (!current) return;
      const appProfiles = (current.appProfiles ?? []).map((p) =>
        p.id === profileId ? { ...p, bubbles: p.bubbles.filter((b) => b.id !== bubbleId) } : p
      );
      set({ config: { ...current, appProfiles } });
    }
  },
}));
