import { contextBridge, ipcRenderer } from 'electron';
import {
  CONFIG_GET,
  CONFIG_SET_HOTKEY,
  CONFIG_SET_LABEL_SIZE,
  CONFIG_SET_RING_SIZE,
  CONFIG_SET_THEME,
  CONFIG_SET_LAUNCH_AT_STARTUP,
  CONFIG_SET_RING_ENABLED,
  CONFIG_SET_TRIGGER_MODE,
  CONFIG_SET_BUBBLES,
  CONFIG_UPDATE_BUBBLE,
  CONFIG_ADD_BUBBLE,
  CONFIG_REMOVE_BUBBLE,
  CONFIG_REORDER_BUBBLES,
  DIALOG_PICK_FILE,
  DIALOG_PICK_FOLDER,
  PROFILE_V2_SAVE,
  PROFILE_V2_ADD,
  PROFILE_V2_REMOVE,
  PROFILE_V2_SET_GLOBAL,
  DASHBOARD_SET_DIRTY,
  DASHBOARD_CLOSE_REQUESTED,
  DASHBOARD_CLOSE_APPROVE,
  PROFILE_GET_ALL,
  PROFILE_ADD,
  PROFILE_UPDATE,
  PROFILE_REMOVE,
  PROFILE_SET_BUBBLES,
  PROFILE_UPDATE_BUBBLE,
  PROFILE_ADD_BUBBLE,
  PROFILE_REMOVE_BUBBLE,
  APP_DETECT_FOREGROUND,
  APP_LIST_RUNNING,
  APP_LIST_INSTALLED,
  APP_LIST_ALL,
  APP_EXTRACT_ICON,
  APP_FETCH_URL_ICON,
  BUILD_IDENTITY_GET,
  DIAGNOSTICS_GET_RECENT,
  DIAGNOSTICS_COPY_LAST,
} from '../shared/ipcChannels';
import type { AppConfig, AppProfile, BubbleConfig, ForegroundAppInfo, LabelSize, LaunchableAppInfo, MutationResult, RingProfile, RingSize, ThemeConfig } from '../shared/types';
import type { RuntimeBuildIdentity } from '../shared/buildInfo';
import type { DiagnosticCopyResult, DiagnosticEvent } from '../shared/diagnostics';
import type { InstalledAppInfo } from '../main/utils/foregroundApp';

// ---------------------------------------------------------------------------
// Dashboard Electron API
// Exposed to the dashboard renderer via window.electronAPI
// ---------------------------------------------------------------------------

contextBridge.exposeInMainWorld('electronAPI', {
  // --- Config reads ---

  /** Get the full application config */
  getConfig: (): Promise<AppConfig> =>
    ipcRenderer.invoke(CONFIG_GET),

  /** Get immutable source metadata plus runtime executable/mode identity. */
  getBuildIdentity: (): Promise<RuntimeBuildIdentity> =>
    ipcRenderer.invoke(BUILD_IDENTITY_GET) as Promise<RuntimeBuildIdentity>,

  /** Get the bounded, redacted ring/action diagnostic event buffer. */
  getRecentDiagnostics: (): Promise<DiagnosticEvent[]> =>
    ipcRenderer.invoke(DIAGNOSTICS_GET_RECENT) as Promise<DiagnosticEvent[]>,

  /** Copy the most recent correlated diagnostic through the main process. */
  copyLastDiagnostic: (): Promise<DiagnosticCopyResult> =>
    ipcRenderer.invoke(DIAGNOSTICS_COPY_LAST) as Promise<DiagnosticCopyResult>,

  // --- Config writes ---

  /** Set a new global hotkey */
  setHotkey: (hotkey: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(CONFIG_SET_HOTKEY, hotkey),

  /** Set the global ring-size preset */
  setRingSize: (ringSize: RingSize): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(CONFIG_SET_RING_SIZE, ringSize),

  /** Set the global Action Ring text-pill size preset. */
  setLabelSize: (labelSize: LabelSize): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(CONFIG_SET_LABEL_SIZE, labelSize),

  /** Set the dashboard theme (mode + accent) */
  setTheme: (theme: ThemeConfig): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(CONFIG_SET_THEME, theme),

  setLaunchAtStartup: (value: boolean): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(CONFIG_SET_LAUNCH_AT_STARTUP, value),

  setRingEnabled: (value: boolean): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(CONFIG_SET_RING_ENABLED, value),

  setTriggerMode: (value: 'A' | 'B'): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(CONFIG_SET_TRIGGER_MODE, value),

  /** Replace all bubbles */
  setBubbles: (bubbles: BubbleConfig[]): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(CONFIG_SET_BUBBLES, bubbles),

  /** Update a single bubble */
  updateBubble: (
    id: string,
    patch: Partial<BubbleConfig>
  ): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(CONFIG_UPDATE_BUBBLE, { id, patch }),

  /** Add a new bubble */
  addBubble: (bubble: BubbleConfig): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(CONFIG_ADD_BUBBLE, bubble),

  /** Remove a bubble by id */
  removeBubble: (id: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(CONFIG_REMOVE_BUBBLE, id),

  /** Reorder bubbles by providing new ordered id list */
  reorderBubbles: (orderedIds: string[]): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(CONFIG_REORDER_BUBBLES, orderedIds),

  // --- Dialogs ---

  /** Open a file picker dialog; returns the selected path or null */
  pickFile: (): Promise<string | null> =>
    ipcRenderer.invoke(DIALOG_PICK_FILE),

  pickFolder: (): Promise<string | null> =>
    ipcRenderer.invoke(DIALOG_PICK_FOLDER),

  saveProfile: (profile: RingProfile): Promise<MutationResult<RingProfile>> =>
    ipcRenderer.invoke(PROFILE_V2_SAVE, profile),

  addProfile: (profile: RingProfile): Promise<MutationResult<RingProfile>> =>
    ipcRenderer.invoke(PROFILE_V2_ADD, profile),

  removeProfile: (id: string): Promise<MutationResult> =>
    ipcRenderer.invoke(PROFILE_V2_REMOVE, id),

  setSelectedGlobalProfile: (id: string | null): Promise<MutationResult> =>
    ipcRenderer.invoke(PROFILE_V2_SET_GLOBAL, id),

  setDashboardDirty: (value: boolean): void =>
    ipcRenderer.send(DASHBOARD_SET_DIRTY, value),

  approveDashboardClose: (): void =>
    ipcRenderer.send(DASHBOARD_CLOSE_APPROVE),

  onDashboardCloseRequested: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on(DASHBOARD_CLOSE_REQUESTED, listener);
    return () => ipcRenderer.removeListener(DASHBOARD_CLOSE_REQUESTED, listener);
  },

  // --- Per-App Profiles ---

  /** Get all app profiles */
  getAppProfiles: (): Promise<AppProfile[]> =>
    ipcRenderer.invoke(PROFILE_GET_ALL),

  /** Add a new app profile */
  addAppProfile: (profile: AppProfile): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(PROFILE_ADD, profile),

  /** Update an app profile */
  updateAppProfile: (id: string, patch: Partial<AppProfile>): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(PROFILE_UPDATE, { id, patch }),

  /** Remove an app profile */
  removeAppProfile: (id: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(PROFILE_REMOVE, id),

  /** Replace all bubbles in a profile */
  setProfileBubbles: (profileId: string, bubbles: BubbleConfig[]): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(PROFILE_SET_BUBBLES, { profileId, bubbles }),

  /** Update a single bubble in a profile */
  updateProfileBubble: (profileId: string, bubbleId: string, patch: Partial<BubbleConfig>): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(PROFILE_UPDATE_BUBBLE, { profileId, bubbleId, patch }),

  /** Add a bubble to a profile */
  addProfileBubble: (profileId: string, bubble: BubbleConfig): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(PROFILE_ADD_BUBBLE, { profileId, bubble }),

  /** Remove a bubble from a profile */
  removeProfileBubble: (profileId: string, bubbleId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(PROFILE_REMOVE_BUBBLE, { profileId, bubbleId }),

  // --- App Detection ---

  /** Detect the current foreground application */
  detectForegroundApp: (): Promise<ForegroundAppInfo | null> =>
    ipcRenderer.invoke(APP_DETECT_FOREGROUND) as Promise<ForegroundAppInfo | null>,

  /** List all running windowed applications */
  listRunningApps: (): Promise<ForegroundAppInfo[]> =>
    ipcRenderer.invoke(APP_LIST_RUNNING) as Promise<ForegroundAppInfo[]>,

  /** List installed applications from Start Menu shortcuts */
  listInstalledApps: (): Promise<InstalledAppInfo[]> =>
    ipcRenderer.invoke(APP_LIST_INSTALLED) as Promise<InstalledAppInfo[]>,

  /** List every launchable app (desktop + Microsoft Store) for the action picker */
  listAllApps: (): Promise<LaunchableAppInfo[]> =>
    ipcRenderer.invoke(APP_LIST_ALL) as Promise<LaunchableAppInfo[]>,

  /** Extract an application's icon (by exe/lnk path) as a PNG data URL, or null */
  extractAppIcon: (path: string): Promise<string | null> =>
    ipcRenderer.invoke(APP_EXTRACT_ICON, path) as Promise<string | null>,

  /** Fetch a website favicon as a validated PNG data URL, or null */
  fetchUrlIcon: (url: string): Promise<string | null> =>
    ipcRenderer.invoke(APP_FETCH_URL_ICON, url) as Promise<string | null>,
});
