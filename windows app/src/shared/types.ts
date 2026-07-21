// ---------------------------------------------------------------------------
// Action Types
// ---------------------------------------------------------------------------

/** The kind of system action a bubble can perform */
export type ActionType =
  | 'volume-up'
  | 'volume-down'
  | 'volume-mute'
  | 'brightness-up'
  | 'brightness-down'
  | 'media-play-pause'
  | 'media-next'
  | 'media-prev'
  | 'screenshot'
  | 'keyboard-shortcut'
  | 'keyboard-sequence'
  | 'app-launch'
  | 'file-open'
  | 'folder-open'
  | 'url-open'
  | 'run-command'
  | 'clipboard-copy'
  | 'clipboard-paste'
  | 'clipboard-cut'
  | 'clipboard-undo'
  | 'clipboard-redo'
  | 'screenshot-region'
  | 'screenshot-window'
  | 'screenshot-full'
  | 'lock-workstation'
  | 'sleep-displays'
  | 'show-desktop'
  | 'window-snap-left'
  | 'window-snap-right'
  | 'window-maximize'
  | 'window-minimize'
  | 'app-switcher'
  | 'virtual-desktop-next'
  | 'virtual-desktop-prev'
  | 'new-note'
  | 'emoji-picker'
  | 'clipboard-history'
  | 'os-search'
  | 'zoom-in'
  | 'zoom-out'
  | 'switch-profile'
  | 'return-to-auto'
  | 'do-nothing'
  | 'easy-switch'
  | 'macro';

/** Bubble visual behavior type — mirrors web app ActionItem.type */
export type BubbleType = 'default' | 'toggle' | 'fill' | 'menu';

/** Global visual size preset for the actions ring */
export type RingSize = 'small' | 'medium' | 'large';

/** Global size preset for Action Ring text pills. */
export type LabelSize = 'small' | 'medium' | 'large';

/** Dashboard action-library category. */
export type ActionCategory = 'system' | 'adjustments' | 'basic' | 'structural' | 'app' | 'custom';

/** App families with curated first-party action catalogs and profile presets. */
export type SupportedAppId =
  | 'photoshop'
  | 'blender'
  | 'resolve'
  | 'premiere'
  | 'after-effects'
  | 'figma'
  | 'autocad';

/** Field metadata used by the action-specific toolbar. */
export interface ActionEditorField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'shortcut' | 'file' | 'folder' | 'textarea' | 'toggle' | 'readonly' | 'app';
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
}

/** Immutable entry shown in the Dashboard V2 action library. */
export interface ActionDefinition {
  id: string;
  label: string;
  description: string;
  category: ActionCategory;
  iconName: string;
  actionType: ActionType;
  bubbleType: BubbleType;
  defaultPayload?: string;
  scrollUpAction?: string;
  scrollDownAction?: string;
  editorFields: ActionEditorField[];
  searchTerms: string[];
  availability?: 'available' | 'requires-setup' | 'requires-plugin' | 'requires-device';
  unavailableReason?: string;
  /** Supported app this action belongs to. Used to filter the app-action library. */
  appId?: SupportedAppId;
  /** One-time shortcut/keymap setup shown without disabling the action. */
  setupInstructions?: string;
  /**
   * Whether this action's default binding has been confirmed live in the target
   * application. 'unverified' surfaces a non-blocking "needs verification" badge
   * in the dashboard editor. Undefined is treated as verified.
   */
  verification?: 'verified' | 'unverified';
}

// ---------------------------------------------------------------------------
// Theming
// ---------------------------------------------------------------------------

/**
 * Dashboard theme mode.
 * - 'system' follows the OS light/dark preference (the default).
 * - 'custom' uses the dark palette with a user-picked accent.
 */
export type ThemeMode = 'system' | 'light' | 'dark' | 'custom';

/** Persisted theme configuration for the dashboard renderer. */
export interface ThemeConfig {
  mode: ThemeMode;
  /** Accent hex color. Only user-editable when mode === 'custom'; system/light/dark always use the fixed brand accent regardless of this stored value. */
  accentColor: string;
  /** Background hex color for the ring's action bubbles. Independent of the light/dark/accent mode. */
  bubbleColor: string;
}

/**
 * Resolved bubble-surface colors derived from the user's chosen bubble color.
 * Shared by both renderers so the dashboard preview and overlay ring stay identical.
 */
export interface BubbleSurfaceTokens {
  /** Base bubble fill (the chosen background color). */
  fill: string;
  /** Slightly contrasted fill used on hover. */
  surfaceHover: string;
  /** Bubble border color. */
  stroke: string;
  /** Bubble border color on hover. */
  borderHover: string;
  /** Fill used for the "filled" portion of adjustment bubbles. */
  adjustmentFill: string;
  /** Icon/text color that stays readable on the chosen fill (auto light/dark). */
  onSurface: string;
}

// ---------------------------------------------------------------------------
// Bubble Configuration
// ---------------------------------------------------------------------------

/** Serialisable config for one bubble slot — stored in electron-store */
export interface BubbleConfig {
  id: string;
  /** Catalog definition used to create this bubble. Preserves app-action metadata in sub-rings. */
  definitionId?: string;
  label: string;
  /** Lucide icon name, e.g. "Volume2", "Sun", "Camera" */
  iconName: string;
  /** Optional alternate icon for toggled state */
  iconNameAlt?: string;
  /**
   * Optional raster icon as a data URL (e.g. an extracted application icon,
   * `data:image/png;base64,...`). Set for 'app-launch' bubbles that point at a
   * real executable. When present it is rendered in place of the Lucide icon.
   */
  iconDataUrl?: string;
  /** 0-7, maps to the 12 o'clock position going clockwise */
  angleIndex: number;
  actionType: ActionType;
  /** Action-specific payload: shortcut string, path, URL, etc. */
  payload?: string;
  type?: BubbleType;
  /** Keyboard shortcut to fire on scroll-up (e.g. "Ctrl+Up", "volume-up") */
  scrollUpAction?: string;
  /** Keyboard shortcut to fire on scroll-down (e.g. "Ctrl+Down", "volume-down") */
  scrollDownAction?: string;
  /** Child bubbles shown in sub-ring when this bubble is clicked. Only valid when type === 'menu'. */
  children?: BubbleConfig[];
  /** Action-specific settings such as adjustment step, sensitivity, or click behavior. */
  parameters?: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------
// Per-Application Profiles
// ---------------------------------------------------------------------------

/** Identifies a foreground application for profile matching */
export interface AppIdentifier {
  /** Process name without extension, e.g. "Photoshop", "blender", "chrome" */
  processName: string;
  /** Human-readable display name, e.g. "Adobe Photoshop" */
  displayName: string;
  /** Optional: base64-encoded app icon */
  iconDataUrl?: string;
}

/** Info about a detected foreground application (used by app detection and dashboard) */
export interface ForegroundAppInfo {
  processName: string;
  executablePath: string;
  windowTitle: string;
}

/**
 * Immutable identity of the exact foreground window captured when a ring opens.
 * The HWND is a base-10 string so it cannot lose precision while crossing IPC.
 */
export interface ForegroundWindowTarget extends ForegroundAppInfo {
  windowHandle: string;
  processId: number;
}

/**
 * A launchable Windows application for the "Open application" picker.
 * `launchTarget` is either a real .exe path (classic desktop app — enables
 * focus-if-running) or a `shell:AppsFolder\<AppUserModelID>` URI (Microsoft
 * Store / UWP apps and desktop apps registered only by AUMID — activated via
 * the shell, which focuses an already-running instance natively).
 */
export interface LaunchableAppInfo {
  displayName: string;
  launchTarget: string;
  kind: 'desktop' | 'store';
}

/** A per-application bubble profile */
export interface AppProfile {
  id: string;
  app: AppIdentifier;
  bubbles: BubbleConfig[];
  enabled: boolean;
  sortOrder: number;
}

// ---------------------------------------------------------------------------
// Dashboard V2 Profiles and Slots
// ---------------------------------------------------------------------------

export type ProfileKind = 'general' | 'global' | 'application';

/** Application binding used by an application-specific profile. */
export interface ApplicationBinding extends AppIdentifier {
  executablePath?: string;
  /** Reserved for a future matching phase; currently not evaluated. */
  windowTitleRegex?: string;
}

/** A configured action instance stored in a ring slot. */
export interface ActionAssignment {
  id: string;
  definitionId: string;
  label: string;
  iconName: string;
  iconNameAlt?: string;
  iconDataUrl?: string;
  actionType: ActionType;
  payload?: string;
  type: BubbleType;
  scrollUpAction?: string;
  scrollDownAction?: string;
  children?: BubbleConfig[];
  parameters?: Record<string, string | number | boolean>;
}

/** Stable ring position. Empty slots have a null assignment. */
export interface RingSlot {
  id: string;
  position: number;
  assignment: ActionAssignment | null;
}

/** Unified profile model used by Dashboard V2 and runtime resolution. */
export interface RingProfile {
  id: string;
  name: string;
  kind: ProfileKind;
  enabled: boolean;
  protected: boolean;
  sortOrder: number;
  slots: RingSlot[];
  application?: ApplicationBinding;
}

export type MutationStatus = 'ok' | 'not_found' | 'duplicate' | 'validation_error' | 'conflict';

/** Store/IPC mutation result. Missing IDs never masquerade as success. */
export interface MutationResult<T = undefined> {
  status: MutationStatus;
  message?: string;
  value?: T;
}

// ---------------------------------------------------------------------------
// App Configuration
// ---------------------------------------------------------------------------

/** Full persisted application configuration */
export interface AppConfig {
  /** Versioned Dashboard V2 schema. */
  schemaVersion: 2;
  /** Stable ID of the protected General profile. */
  generalProfileId: string;
  /** Persisted manually selected non-application fallback. */
  selectedGlobalProfileId: string | null;
  /** Unified profiles consumed by Dashboard V2. */
  profiles: RingProfile[];
  hotkey: string;
  /** Launch the app when Windows starts */
  launchAtStartup: boolean;
  /** Allow Electron to use its normal GPU rendering path after the next restart. */
  hardwareAcceleration: boolean;
  /** Whether the ring is enabled */
  ringEnabled: boolean;
  /** Trigger mode: A = click-click, B = hold-release */
  triggerMode: 'A' | 'B';
  /** Global visual size for the actions ring */
  ringSize: RingSize;
  /** Global visual size for Action Ring text pills. */
  labelSize: LabelSize;
  /** Dashboard theme (light/dark/custom + accent) */
  theme: ThemeConfig;
}

/** Saved graphics preference and the GPU state reported by the current process. */
export interface GraphicsAccelerationStatus {
  preferenceEnabled: boolean;
  startupPreferenceEnabled: boolean;
  restartRequired: boolean;
  statusReady: boolean;
  hardwareAccelerationEnabled: boolean | null;
  gpuCompositing: string | null;
  rasterization: string | null;
}

// ---------------------------------------------------------------------------
// IPC Payloads
// ---------------------------------------------------------------------------

/** Payload sent with ring:open */
export interface RingOpenPayload {
  /** Opaque ID binding every input action to the ring-open target snapshot. */
  ringSessionId: string;
  /** Overlay window is 400×400; ring is always centered — no position needed */
  triggerMode: 'A' | 'B';
  ringSize: RingSize;
  labelSize: LabelSize;
  accentColor: string;
  accentFillColor: string;
  accentForegroundColor: string;
  /** Resolved bubble background/surface colors from the user's theme. */
  bubbleSurface: BubbleSurfaceTokens;
  bubbles: BubbleConfig[];
  systemState: SystemState;
  /** The app profile that was matched, or null/undefined for defaults */
  matchedApp?: AppIdentifier | null;
}

/** Live system state snapshot sent with ring:open */
export interface SystemState {
  volumeLevel: number;   // 0..1
  isMuted: boolean;
  brightnessLevel: number; // 0..1
  isPlaying: boolean;
}

/** Payload sent when a bubble is activated in the overlay */
export interface ActionExecutePayload {
  bubbleId: string;
  /** Stable catalog definition used for diagnostics and preset traceability. */
  definitionId?: string;
  actionType: ActionType;
  /** Injected by the overlay preload; renderer code cannot choose another session. */
  ringSessionId?: string;
  payload?: string;
  parameters?: Record<string, string | number | boolean>;
  /** Adjustment/toggle interactions execute without dismissing the overlay. */
  keepOpen?: boolean;
}

/** Auditable result returned by the same operation that focused and sent input. */
export interface InputDispatchReceipt {
  kind: 'chord' | 'text';
  targetWindowHandle: string;
  targetProcessId: number;
  actualWindowHandle: string;
  actualProcessId: number;
  requestedInputCount: number;
  sentInputCount: number;
}

/** Result of an action execution */
export interface ActionResult {
  status: 'success' | 'accepted' | 'unsupported' | 'validation_error' | 'permission_blocked' | 'target_unavailable' | 'execution_error';
  success: boolean;
  error?: string;
  message?: string;
  /** Short, user-visible reference for the persisted failure diagnostic. */
  diagnosticId?: string;
  /** Updated system state after the action, if applicable */
  newState?: Partial<SystemState>;
}

// ---------------------------------------------------------------------------
// Geometry — mirrors web app types/index.ts
// ---------------------------------------------------------------------------

/** Pre-computed pixel position within the 400×400 ring container */
export interface BubblePosition {
  x: number;   // pixels from container left
  y: number;   // pixels from container top
  angle: number; // radians, 0 = 3 o'clock, -π/2 = 12 o'clock
}

// ---------------------------------------------------------------------------
// Zustand overlay store shape
// ---------------------------------------------------------------------------

export interface OverlayStore {
  isOpen: boolean;
  hoveredIndex: number | null;
  bubbles: BubbleConfig[];
  systemState: SystemState;
  triggerMode: 'A' | 'B';
  ringSize: RingSize;
  labelSize: LabelSize;
  accentColor: string;
  accentFillColor: string;
  accentForegroundColor: string;
  /** Resolved bubble background/surface colors from the user's theme. */
  bubbleSurface: BubbleSurfaceTokens;
  /** Per-bubble fill level (0..1) for non-system fill bubbles */
  bubbleFillLevels: Record<string, number>;

  openRing: (payload: RingOpenPayload) => void;
  closeRing: () => void;
  setHoveredIndex: (idx: number | null) => void;
  updateSystemState: (patch: Partial<SystemState>) => void;
  setBubbleFillLevel: (bubbleId: string, level: number) => void;
}

// ---------------------------------------------------------------------------
// Zustand dashboard store shape
// ---------------------------------------------------------------------------

export interface DashboardStore {
  config: AppConfig | null;
  isLoading: boolean;
  isDirty: boolean;
  graphicsStatus: GraphicsAccelerationStatus | null;
  isGraphicsStatusLoading: boolean;
  isRelaunching: boolean;

  loadConfig: () => Promise<void>;
  setHotkey: (hotkey: string) => Promise<void>;
  setRingSize: (ringSize: RingSize) => Promise<void>;
  setLabelSize: (labelSize: LabelSize) => Promise<void>;
  setTheme: (theme: ThemeConfig) => Promise<void>;
  setLaunchAtStartup: (value: boolean) => Promise<void>;
  setHardwareAcceleration: (value: boolean) => Promise<void>;
  setRingEnabled: (value: boolean) => Promise<void>;
  setTriggerMode: (value: 'A' | 'B') => Promise<void>;
  loadGraphicsAccelerationStatus: () => Promise<void>;
  relaunchApp: () => Promise<void>;
  saveProfile: (profile: RingProfile) => Promise<MutationResult<RingProfile>>;
  addProfile: (profile: RingProfile) => Promise<MutationResult<RingProfile>>;
  removeProfile: (id: string) => Promise<MutationResult>;
  setSelectedGlobalProfile: (id: string | null) => Promise<MutationResult>;
}
