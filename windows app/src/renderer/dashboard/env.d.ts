import type { AppConfig, ForegroundAppInfo, GraphicsAccelerationStatus, LabelSize, LaunchableAppInfo, MutationResult, RingProfile, RingSize, ThemeConfig, UpdateStatus } from '../../shared/types';
import type { RuntimeBuildIdentity } from '../../shared/buildInfo';
import type { DiagnosticCopyResult, DiagnosticEvent } from '../../shared/diagnostics';

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
  getBuildIdentity: () => Promise<RuntimeBuildIdentity>;
  getRecentDiagnostics: () => Promise<DiagnosticEvent[]>;
  copyLastDiagnostic: () => Promise<DiagnosticCopyResult>;

  // --- Config writes ---
  setHotkey: (hotkey: string) => Promise<{ success: boolean }>;
  setRingSize: (ringSize: RingSize) => Promise<{ success: boolean }>;
  setLabelSize: (labelSize: LabelSize) => Promise<{ success: boolean }>;
  setTheme: (theme: ThemeConfig) => Promise<{ success: boolean }>;
  setLaunchAtStartup: (value: boolean) => Promise<{ success: boolean }>;
  setRingEnabled: (value: boolean) => Promise<{ success: boolean }>;
  setTriggerMode: (value: 'A' | 'B') => Promise<{ success: boolean }>;
  setHardwareAcceleration: (value: boolean) => Promise<GraphicsAccelerationStatus>;
  getGraphicsAccelerationStatus: () => Promise<GraphicsAccelerationStatus>;
  relaunchApp: () => Promise<void>;
  openPrivacyPolicy: () => Promise<void>;
  saveProfile: (profile: RingProfile) => Promise<MutationResult<RingProfile>>;
  addProfile: (profile: RingProfile) => Promise<MutationResult<RingProfile>>;
  removeProfile: (id: string) => Promise<MutationResult>;
  setSelectedGlobalProfile: (id: string | null) => Promise<MutationResult>;
  setDashboardDirty: (value: boolean) => void;
  approveDashboardClose: () => void;
  onDashboardCloseRequested: (callback: () => void) => () => void;
  onUpdateAvailable: (callback: (status: UpdateStatus) => void) => () => void;
  installUpdate: () => void;
  pickFile: () => Promise<string | null>;
  pickFolder: () => Promise<string | null>;

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
