import type { AppConfig, AppProfile, BubbleConfig, ForegroundAppInfo, LaunchableAppInfo, MutationResult, RingProfile, RingSize, ThemeConfig } from '../../shared/types';

// CSS Modules
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}

/** Installed app info from Start Menu shortcuts */
export interface InstalledAppInfo {
  displayName: string;
  processName: string;
  executablePath: string;
}

// The Dashboard window's contextBridge API
export interface DashboardElectronAPI {
  // --- Config reads ---
  getConfig: () => Promise<AppConfig>;

  // --- Config writes ---
  setHotkey: (hotkey: string) => Promise<{ success: boolean }>;
  setRingSize: (ringSize: RingSize) => Promise<{ success: boolean }>;
  setTheme: (theme: ThemeConfig) => Promise<{ success: boolean }>;
  setLaunchAtStartup: (value: boolean) => Promise<{ success: boolean }>;
  setRingEnabled: (value: boolean) => Promise<{ success: boolean }>;
  setTriggerMode: (value: 'A' | 'B') => Promise<{ success: boolean }>;
  saveProfile: (profile: RingProfile) => Promise<MutationResult<RingProfile>>;
  addProfile: (profile: RingProfile) => Promise<MutationResult<RingProfile>>;
  removeProfile: (id: string) => Promise<MutationResult>;
  setSelectedGlobalProfile: (id: string | null) => Promise<MutationResult>;
  setDashboardDirty: (value: boolean) => void;
  approveDashboardClose: () => void;
  onDashboardCloseRequested: (callback: () => void) => () => void;
  setBubbles: (bubbles: BubbleConfig[]) => Promise<{ success: boolean }>;
  updateBubble: (id: string, patch: Partial<BubbleConfig>) => Promise<{ success: boolean }>;
  addBubble: (bubble: BubbleConfig) => Promise<{ success: boolean }>;
  removeBubble: (id: string) => Promise<{ success: boolean }>;
  reorderBubbles: (orderedIds: string[]) => Promise<{ success: boolean }>;
  pickFile: () => Promise<string | null>;
  pickFolder: () => Promise<string | null>;

  // --- Per-App Profiles ---
  getAppProfiles: () => Promise<AppProfile[]>;
  addAppProfile: (profile: AppProfile) => Promise<{ success: boolean }>;
  updateAppProfile: (id: string, patch: Partial<AppProfile>) => Promise<{ success: boolean }>;
  removeAppProfile: (id: string) => Promise<{ success: boolean }>;
  setProfileBubbles: (profileId: string, bubbles: BubbleConfig[]) => Promise<{ success: boolean }>;
  updateProfileBubble: (profileId: string, bubbleId: string, patch: Partial<BubbleConfig>) => Promise<{ success: boolean }>;
  addProfileBubble: (profileId: string, bubble: BubbleConfig) => Promise<{ success: boolean }>;
  removeProfileBubble: (profileId: string, bubbleId: string) => Promise<{ success: boolean }>;

  // --- App Detection ---
  detectForegroundApp: () => Promise<ForegroundAppInfo | null>;
  listRunningApps: () => Promise<ForegroundAppInfo[]>;
  listInstalledApps: () => Promise<InstalledAppInfo[]>;
  listAllApps: () => Promise<LaunchableAppInfo[]>;
  extractAppIcon: (path: string) => Promise<string | null>;
  fetchUrlIcon: (url: string) => Promise<string | null>;
}

declare global {
  interface Window {
    electronAPI: DashboardElectronAPI;
  }
}

export {};
