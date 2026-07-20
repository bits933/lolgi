// ---------------------------------------------------------------------------
// IPC Channel Name Constants
// All channel strings live here so preload, main, and renderer stay in sync.
// ---------------------------------------------------------------------------

// --- Main → Overlay ---

/** Open the ring; payload: RingOpenPayload */
export const RING_OPEN = 'ring:open' as const;

/** Close the ring (e.g. Escape pressed in main) */
export const RING_CLOSE = 'ring:close' as const;

/** Config was updated while ring is open; payload: BubbleConfig[] */
export const CONFIG_UPDATED = 'config:updated' as const;

/** Fresh system state became available after the ring opened. */
export const SYSTEM_STATE_UPDATED = 'system:state-update' as const;

// --- Overlay → Main ---

/** Execute a bubble action; payload: ActionExecutePayload */
export const ACTION_EXECUTE = 'action:execute' as const;

/** Read the bounded local action-result diagnostics buffer. */
export const ACTION_GET_DIAGNOSTICS = 'action:get-diagnostics' as const;

/** Overlay requests close (user clicked center or pressed Escape) */
export const OVERLAY_CLOSE = 'overlay:close' as const;

/** Desktop click catcher requests close for a click outside the overlay window */

/** Exit animation finished; main can now call win.hide() */
export const OVERLAY_ANIMATION_COMPLETE = 'overlay:animation-complete' as const;

/** Request current system state (volume, brightness, mute, playing) */
export const SYSTEM_GET_STATE = 'system:get-state' as const;

/** Request current bubble configs */
export const CONFIG_GET_BUBBLES = 'config:get-bubbles' as const;

/** Read immutable source metadata plus runtime executable/mode identity. */
export const BUILD_IDENTITY_GET = 'build:get-identity' as const;

/** Read the bounded, redacted ring/action diagnostic event buffer. */
export const DIAGNOSTICS_GET_RECENT = 'diagnostics:get-recent' as const;

/** Copy the most recent correlated diagnostic through Electron's clipboard. */
export const DIAGNOSTICS_COPY_LAST = 'diagnostics:copy-last' as const;

// --- Dashboard → Main ---

/** Get full AppConfig; returns AppConfig */
export const CONFIG_GET = 'config:get' as const;

/** Update hotkey; payload: string */
export const CONFIG_SET_HOTKEY = 'config:set-hotkey' as const;

/** Update the global ring-size preset; payload: RingSize */
export const CONFIG_SET_RING_SIZE = 'config:set-ring-size' as const;

/** Update the global Action Ring text-pill size; payload: LabelSize */
export const CONFIG_SET_LABEL_SIZE = 'config:set-label-size' as const;

/** Update the dashboard theme (mode + accent); payload: ThemeConfig */
export const CONFIG_SET_THEME = 'config:set-theme' as const;

/** Update launch-at-startup preference; payload: boolean */
export const CONFIG_SET_LAUNCH_AT_STARTUP = 'config:set-launch-at-startup' as const;

/** Enable or disable the global ring trigger. */
export const CONFIG_SET_RING_ENABLED = 'config:set-ring-enabled' as const;

/** Change click-click versus hold-release trigger behavior. */
export const CONFIG_SET_TRIGGER_MODE = 'config:set-trigger-mode' as const;

/** Replace all bubbles; payload: BubbleConfig[] */
export const CONFIG_SET_BUBBLES = 'config:set-bubbles' as const;

/** Update single bubble; payload: { id: string; patch: Partial<BubbleConfig> } */
export const CONFIG_UPDATE_BUBBLE = 'config:update-bubble' as const;

/** Add a bubble; payload: BubbleConfig */
export const CONFIG_ADD_BUBBLE = 'config:add-bubble' as const;

/** Remove a bubble; payload: string (id) */
export const CONFIG_REMOVE_BUBBLE = 'config:remove-bubble' as const;

/** Reorder bubbles; payload: string[] (ordered ids) */
export const CONFIG_REORDER_BUBBLES = 'config:reorder-bubbles' as const;

/** Open file picker dialog; returns string | null (file path) */
export const DIALOG_PICK_FILE = 'dialog:pick-file' as const;

/** Open folder picker dialog; returns string | null */
export const DIALOG_PICK_FOLDER = 'dialog:pick-folder' as const;

// --- Dashboard V2 profile persistence ---

export const PROFILE_V2_SAVE = 'profile-v2:save' as const;
export const PROFILE_V2_ADD = 'profile-v2:add' as const;
export const PROFILE_V2_REMOVE = 'profile-v2:remove' as const;
export const PROFILE_V2_SET_GLOBAL = 'profile-v2:set-global' as const;

// --- Dashboard dirty-close handshake ---

export const DASHBOARD_SET_DIRTY = 'dashboard:set-dirty' as const;
export const DASHBOARD_CLOSE_REQUESTED = 'dashboard:close-requested' as const;
export const DASHBOARD_CLOSE_APPROVE = 'dashboard:close-approve' as const;

// --- Profile CRUD (Dashboard → Main) ---

/** Get all app profiles; returns AppProfile[] */
export const PROFILE_GET_ALL = 'profile:get-all' as const;

/** Add an app profile; payload: AppProfile */
export const PROFILE_ADD = 'profile:add' as const;

/** Update an app profile; payload: { id: string; patch: Partial<AppProfile> } */
export const PROFILE_UPDATE = 'profile:update' as const;

/** Remove an app profile; payload: string (id) */
export const PROFILE_REMOVE = 'profile:remove' as const;

/** Replace all bubbles in a profile; payload: { profileId: string; bubbles: BubbleConfig[] } */
export const PROFILE_SET_BUBBLES = 'profile:set-bubbles' as const;

/** Update single bubble in a profile; payload: { profileId, bubbleId, patch } */
export const PROFILE_UPDATE_BUBBLE = 'profile:update-bubble' as const;

/** Add a bubble to a profile; payload: { profileId: string; bubble: BubbleConfig } */
export const PROFILE_ADD_BUBBLE = 'profile:add-bubble' as const;

/** Remove a bubble from a profile; payload: { profileId: string; bubbleId: string } */
export const PROFILE_REMOVE_BUBBLE = 'profile:remove-bubble' as const;

// --- App Detection (Dashboard → Main) ---

/** Detect the current foreground application; returns ForegroundAppInfo | null */
export const APP_DETECT_FOREGROUND = 'app:detect-foreground' as const;

/** List all running windowed applications; returns ForegroundAppInfo[] */
export const APP_LIST_RUNNING = 'app:list-running' as const;

/** List installed applications from Start Menu shortcuts; returns InstalledAppInfo[] */
export const APP_LIST_INSTALLED = 'app:list-installed' as const;

/** Dashboard → Main: list every launchable app (desktop + Microsoft Store) for the action picker */
export const APP_LIST_ALL = 'app:list-all' as const;

/** Extract an application's icon as a PNG data URL; payload: string (path), returns string | null */
export const APP_EXTRACT_ICON = 'app:extract-icon' as const;

/** Fetch a website favicon as a validated PNG data URL; payload: string URL */
export const APP_FETCH_URL_ICON = 'app:fetch-url-icon' as const;
