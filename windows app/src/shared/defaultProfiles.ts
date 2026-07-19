import { v4 as uuidv4 } from 'uuid';
import type {
  ActionDefinition,
  ActionEditorField,
  ActionType,
  BubbleConfig,
  BubbleType,
  RingProfile,
  SupportedAppId,
} from './types';

export interface AppProfilePreset {
  id: SupportedAppId;
  displayName: string;
  processName: string;
  description: string;
  iconName: string;
  researchedAt: string;
}

interface AppActionSpec {
  id: string;
  appId: SupportedAppId;
  label: string;
  description: string;
  iconName: string;
  actionType: ActionType;
  bubbleType: BubbleType;
  payload?: string;
  scrollUpAction?: string;
  scrollDownAction?: string;
  children?: string[];
  setupInstructions?: string;
  searchTerms?: string[];
  verification?: 'verified' | 'unverified';
}

const APP_LABELS: Record<SupportedAppId, string> = {
  photoshop: 'Photoshop',
  blender: 'Blender',
  resolve: 'DaVinci Resolve',
  premiere: 'Premiere Pro',
  'after-effects': 'After Effects',
  figma: 'Figma',
};

export const SUPPORTED_APP_LABELS = APP_LABELS;

/** The current Figma Design Actions menu binding (customizable in Figma). */
export const FIGMA_ACTIONS_SHORTCUT = 'Ctrl+K';
/** Settling time for the Actions menu before entering a query. */
export const FIGMA_ACTIONS_PALETTE_DELAY_MS = 250;

/** Queries used by the Figma Actions-menu macro presets. */
export const FIGMA_MACRO_QUERIES = {
  tidy: 'Tidy up',
  'copy-svg': 'Copy as SVG',
  rasterize: 'Rasterize selection',
  'same-fill': 'Select all with same fill',
  'version-history': 'Show version history',
} as const;

const SETUP: Record<Exclude<SupportedAppId, 'figma'>, string> = {
  photoshop: 'Open Edit > Keyboard Shortcuts (Ctrl+Alt+Shift+K), or record a Photoshop Action and assign Shift+F2-F12. Then confirm the shortcut shown for this bubble.',
  blender: 'Open Edit > Preferences > Keymap and bind this command to the suggested Ctrl+Alt+Shift shortcut. Blender keymaps can be exported after setup.',
  resolve: 'Open Keyboard Customization (Ctrl+Alt+K), bind the named command to the suggested shortcut, then export the preset for reuse.',
  premiere: 'Open Keyboard Shortcuts (Ctrl+Alt+K), search for the named command, and assign the suggested Ctrl+Alt+Shift shortcut.',
  'after-effects': "Open Edit > Keyboard Shortcuts (Ctrl+Alt+'), search for the named command, and assign the suggested shortcut.",
};

function action(
  appId: SupportedAppId,
  slug: string,
  label: string,
  iconName: string,
  payload: string,
  description: string,
  options: Partial<AppActionSpec> = {}
): AppActionSpec {
  return {
    id: `${appId}-${slug}`,
    appId,
    label,
    description,
    iconName,
    actionType: 'keyboard-shortcut',
    bubbleType: 'default',
    payload,
    ...options,
  };
}

function fill(
  appId: SupportedAppId,
  slug: string,
  label: string,
  iconName: string,
  payload: string,
  scrollUpAction: string,
  scrollDownAction: string,
  description: string,
  options: Partial<AppActionSpec> = {}
): AppActionSpec {
  return action(appId, slug, label, iconName, payload, description, {
    bubbleType: 'fill',
    scrollUpAction,
    scrollDownAction,
    ...options,
  });
}

function menu(
  appId: SupportedAppId,
  slug: string,
  label: string,
  iconName: string,
  children: string[],
  description: string
): AppActionSpec {
  return {
    id: `${appId}-${slug}`,
    appId,
    label,
    description,
    iconName,
    actionType: 'do-nothing',
    bubbleType: 'menu',
    children,
  };
}

function macro(
  appId: SupportedAppId,
  slug: string,
  label: string,
  iconName: string,
  payload: string,
  description: string
): AppActionSpec {
  return action(appId, slug, label, iconName, payload, description, {
    actionType: 'macro',
    searchTerms: ['command palette', 'quick actions'],
    // Multi-step command-palette macros depend on live app timing and the exact
    // menu wording, so they are not certified until verified in-app (Phase C).
    verification: 'unverified',
  });
}

function figmaMacro(
  slug: keyof typeof FIGMA_MACRO_QUERIES,
  label: string,
  iconName: string,
  description: string
): AppActionSpec {
  const query = FIGMA_MACRO_QUERIES[slug];
  return macro(
    'figma',
    slug,
    label,
    iconName,
    `${FIGMA_ACTIONS_SHORTCUT}; delay:${FIGMA_ACTIONS_PALETTE_DELAY_MS}; text:${query}; Enter`,
    description
  );
}

const photoshop: AppActionSpec[] = [
  fill('photoshop', 'history', 'History scrub', 'History', 'Ctrl+Z', 'Ctrl+Shift+Z', 'Ctrl+Z', 'Click Undo; scroll forward and backward through document history.'),
  fill('photoshop', 'brush-size', 'Brush size', 'Brush', 'B', ']', '[', 'Select the Brush tool and resize it one step per wheel tick.'),
  fill('photoshop', 'zoom', 'Zoom', 'ZoomIn', 'Ctrl+0', 'Ctrl+=', 'Ctrl+-', 'Fit the document on click and zoom with the wheel.'),
  fill('photoshop', 'layer-nav', 'Layer navigation', 'Layers', 'Ctrl+Alt+Shift+N', 'Alt+]', 'Alt+[', 'Create a layer on click and walk the layer stack with the wheel.'),
  action('photoshop', 'deselect', 'Deselect', 'PointerOff', 'Ctrl+D', 'Clear the current selection.'),
  action('photoshop', 'select-all', 'Select all', 'Scan', 'Ctrl+A', 'Select the full canvas.'),
  action('photoshop', 'select-inverse', 'Select inverse', 'FlipHorizontal2', 'Ctrl+Shift+I', 'Invert the current selection.'),
  action('photoshop', 'select-mask', 'Select and Mask', 'Sparkles', 'Ctrl+Alt+R', 'Open the Select and Mask workspace.'),
  action('photoshop', 'select-subject', 'Select subject', 'UserRoundSearch', 'Ctrl+Alt+Shift+U', 'Select the main subject using a reserved shortcut.', { setupInstructions: SETUP.photoshop }),
  menu('photoshop', 'select-menu', 'Select', 'ScanSearch', ['photoshop-deselect', 'photoshop-select-all', 'photoshop-select-inverse', 'photoshop-select-mask', 'photoshop-select-subject'], 'Selection commands and subject isolation.'),
  action('photoshop', 'hue-saturation', 'Hue / Saturation', 'Palette', 'Ctrl+U', 'Open Hue/Saturation.'),
  action('photoshop', 'brightness-contrast', 'Brightness / Contrast', 'SunMedium', 'Ctrl+Alt+Shift+B', 'Open Brightness/Contrast using a reserved shortcut.', { setupInstructions: SETUP.photoshop }),
  action('photoshop', 'curves', 'Curves', 'ChartSpline', 'Ctrl+M', 'Open Curves.'),
  action('photoshop', 'levels', 'Levels', 'SlidersHorizontal', 'Ctrl+L', 'Open Levels.'),
  action('photoshop', 'camera-raw', 'Camera Raw', 'Aperture', 'Ctrl+Shift+A', 'Open Camera Raw Filter.'),
  menu('photoshop', 'adjustments-menu', 'Adjustments', 'SlidersHorizontal', ['photoshop-hue-saturation', 'photoshop-brightness-contrast', 'photoshop-curves', 'photoshop-levels', 'photoshop-camera-raw'], 'Core image adjustments.'),
  action('photoshop', 'duplicate-layer', 'Duplicate layer', 'CopyPlus', 'Ctrl+J', 'Duplicate the selected layer.'),
  action('photoshop', 'group-layers', 'Group layers', 'FolderPlus', 'Ctrl+G', 'Group selected layers.'),
  action('photoshop', 'clipping-mask', 'Clipping mask', 'BetweenHorizontalEnd', 'Ctrl+Alt+G', 'Create or release a clipping mask.'),
  action('photoshop', 'layer-mask', 'Add layer mask', 'SquareDashedMousePointer', 'Shift+F2', 'Add a layer mask using a recorded Action.', { setupInstructions: SETUP.photoshop }),
  action('photoshop', 'smart-object', 'Convert to Smart Object', 'Box', 'Shift+F3', 'Convert the selection to a Smart Object using a recorded Action.', { setupInstructions: SETUP.photoshop }),
  menu('photoshop', 'layers-menu', 'Layers', 'Layers3', ['photoshop-duplicate-layer', 'photoshop-group-layers', 'photoshop-clipping-mask', 'photoshop-layer-mask', 'photoshop-smart-object'], 'Layer organization and nondestructive workflows.'),
  action('photoshop', 'transform', 'Free Transform', 'Scaling', 'Ctrl+T', 'Transform the current selection.'),
  action('photoshop', 'transform-again', 'Transform Again', 'Repeat2', 'Ctrl+Shift+T', 'Repeat the previous transform.'),
  action('photoshop', 'save', 'Save', 'Save', 'Ctrl+S', 'Save the document.'),
  action('photoshop', 'save-copy', 'Save a Copy', 'Files', 'Ctrl+Alt+S', 'Save a copy of the document.'),
  action('photoshop', 'export-as', 'Export As', 'FileOutput', 'Ctrl+Alt+Shift+W', 'Open Export As.'),
  menu('photoshop', 'transform-export-menu', 'Transform / Export', 'FileOutput', ['photoshop-transform', 'photoshop-transform-again', 'photoshop-save', 'photoshop-save-copy', 'photoshop-export-as'], 'Transform and finish the document.'),
  fill('photoshop', 'brush-hardness', 'Brush hardness', 'CircleGauge', 'B', 'Shift+]', 'Shift+[', 'Adjust compatible brush hardness.'),
  fill('photoshop', 'layer-order', 'Layer order', 'ListOrdered', 'Ctrl+Alt+Shift+N', 'Ctrl+]', 'Ctrl+[', 'Move the active layer through the stack.'),
  fill('photoshop', 'blend-mode', 'Blend mode', 'Blend', 'V', 'Shift+=', 'Shift+-', 'Cycle layer blend modes with the Move tool active.'),
  fill('photoshop', 'brush-presets', 'Brush presets', 'Paintbrush', 'B', '.', ',', 'Walk through brush presets.'),
  fill('photoshop', 'font-size', 'Font size', 'Type', 'T', 'Ctrl+Shift+.', 'Ctrl+Shift+,', 'Adjust selected text size.'),
  fill('photoshop', 'leading', 'Leading', 'BetweenVerticalStart', 'T', 'Alt+Up', 'Alt+Down', 'Adjust selected text leading.'),
  fill('photoshop', 'kerning', 'Kerning', 'Space', 'T', 'Alt+Right', 'Alt+Left', 'Adjust kerning or tracking.'),
  fill('photoshop', 'baseline', 'Baseline shift', 'MoveVertical', 'T', 'Shift+Alt+Up', 'Shift+Alt+Down', 'Shift the selected text baseline.'),
  fill('photoshop', 'documents', 'Open documents', 'PanelsTopLeft', 'Ctrl+Tab', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Cycle open documents.'),
  fill('photoshop', 'nudge-x', 'Nudge horizontal', 'MoveHorizontal', 'V', 'Right', 'Left', 'Nudge the selected layer horizontally.'),
  fill('photoshop', 'nudge-y', 'Nudge vertical', 'MoveVertical', 'V', 'Up', 'Down', 'Nudge the selected layer vertically.'),
];

const blender: AppActionSpec[] = [
  action('blender', 'search', 'Operator Search', 'Search', 'F3', 'Search and run any Blender operator.'),
  action('blender', 'play', 'Play / Pause', 'CirclePlay', 'Space', 'Toggle animation playback.'),
  fill('blender', 'history', 'Undo / Redo', 'History', 'Ctrl+Z', 'Ctrl+Shift+Z', 'Ctrl+Z', 'Scrub Blender history.'),
  action('blender', 'mode-pie', 'Mode pie', 'Orbit', 'Ctrl+Tab', 'Open the mode pie in the 3D Viewport.'),
  action('blender', 'object-edit', 'Object / Edit', 'Box', 'Tab', 'Toggle Object and Edit mode.'),
  action('blender', 'add-object', 'Add object', 'BadgePlus', 'Shift+A', 'Open the Add menu.'),
  action('blender', 'duplicate', 'Duplicate', 'CopyPlus', 'Shift+D', 'Duplicate the selection.'),
  action('blender', 'join', 'Join objects', 'Combine', 'Ctrl+J', 'Join selected objects.'),
  action('blender', 'apply', 'Apply transforms', 'CheckCheck', 'Ctrl+A', 'Open the Apply menu.'),
  menu('blender', 'mode-menu', 'Modes / Object', 'Boxes', ['blender-mode-pie', 'blender-object-edit', 'blender-add-object', 'blender-duplicate', 'blender-apply'], 'Mode and object operations.'),
  action('blender', 'shading-pie', 'Shading pie', 'CircleDot', 'Z', 'Open the shading pie.'),
  action('blender', 'wireframe', 'Wireframe', 'BoxSelect', 'Shift+Z', 'Toggle wireframe shading.'),
  action('blender', 'xray', 'X-Ray', 'Scan', 'Alt+Z', 'Toggle X-Ray.'),
  action('blender', 'overlays', 'Overlays', 'Eye', 'Shift+Alt+Z', 'Toggle viewport overlays.'),
  action('blender', 'snapping', 'Snapping', 'Magnet', 'Shift+Tab', 'Toggle snapping.'),
  menu('blender', 'shading-menu', 'Shading', 'SunMoon', ['blender-shading-pie', 'blender-wireframe', 'blender-xray', 'blender-overlays', 'blender-snapping'], 'Viewport shading and overlays.'),
  action('blender', 'view-pie', 'View pie', 'View', '`', 'Open the view pie without a numpad.'),
  action('blender', 'frame-all', 'Frame all', 'Focus', 'Home', 'Frame the full scene.'),
  action('blender', 'local-view', 'Local view', 'ScanLine', '/', 'Isolate the selected object.'),
  action('blender', 'walk', 'Walk navigation', 'Footprints', 'Shift+`', 'Start first-person viewport navigation.'),
  action('blender', 'quad-view', 'Quad view', 'PanelsTopLeft', 'Ctrl+Alt+Q', 'Toggle quad view.'),
  menu('blender', 'view-menu', 'View', 'View', ['blender-view-pie', 'blender-frame-all', 'blender-local-view', 'blender-walk', 'blender-quad-view'], 'Numpad-free navigation.'),
  action('blender', 'save-incremental', 'Save Incremental', 'Save', 'Ctrl+Alt+S', 'Save an incremented copy.'),
  action('blender', 'render-image', 'Render image', 'Image', 'F12', 'Render the current frame.'),
  action('blender', 'render-animation', 'Render animation', 'Film', 'Ctrl+F12', 'Render the animation range.'),
  action('blender', 'render-result', 'Render result', 'GalleryHorizontal', 'F11', 'Show the last render.'),
  menu('blender', 'render-menu', 'Render', 'Clapperboard', ['blender-render-image', 'blender-render-animation', 'blender-render-result'], 'Render and inspect output.'),
  fill('blender', 'frame-step', 'Frame step', 'StepForward', 'Space', 'Right', 'Left', 'Step the timeline one frame per tick.'),
  fill('blender', 'keyframe-jump', 'Keyframes', 'KeyRound', 'I', 'Up', 'Down', 'Jump between keyframes.'),
  fill('blender', 'workspace-cycle', 'Workspaces', 'PanelsTopLeft', 'F3', 'Ctrl+PageDown', 'Ctrl+PageUp', 'Cycle workspace tabs.'),
  fill('blender', 'sculpt-size', 'Sculpt brush size', 'Brush', 'F', ']', '[', 'Resize the active sculpt or paint brush.'),
  fill('blender', 'multires-level', 'Multires level', 'Layers3', 'F3', 'Alt+2', 'Alt+1', 'Adjust the active subdivision level in Sculpt mode.'),
  fill('blender', 'select-more-less', 'Select More / Less', 'Scan', 'F3', 'Ctrl+]', 'Ctrl+[', 'Grow or shrink mesh selection using reserved shortcuts.', { setupInstructions: SETUP.blender }),
  fill('blender', 'view-zoom', 'View zoom', 'ZoomIn', 'Home', 'Ctrl+Alt+Shift+F7', 'Ctrl+Alt+Shift+F8', 'Zoom the 3D view using reserved shortcuts.', { setupInstructions: SETUP.blender }),
  fill('blender', 'timeline-zoom', 'Timeline zoom', 'SearchCode', 'Home', 'Ctrl+Alt+Shift+F9', 'Ctrl+Alt+Shift+F10', 'Zoom a hovered 2D editor using reserved shortcuts.', { setupInstructions: SETUP.blender }),
];

const resolve: AppActionSpec[] = [
  action('resolve', 'split', 'Split at playhead', 'Scissors', 'Ctrl+B', 'Split the active clip at the playhead.'),
  action('resolve', 'ripple-delete', 'Ripple delete', 'Trash2', 'Shift+Delete', 'Delete the selection and close the gap.'),
  action('resolve', 'marker', 'Add marker', 'MapPinPlus', 'M', 'Add a marker.'),
  fill('resolve', 'frame-step', 'Frame step', 'StepForward', 'Space', 'Right', 'Left', 'Play or stop on click and step frames with the wheel.'),
  fill('resolve', 'edit-point', 'Edit point / Clip', 'BetweenHorizontalStart', 'Space', 'Down', 'Up', 'Walk edit points on Edit or clips on Color.'),
  action('resolve', 'transition', 'Add transition', 'BetweenHorizontalEnd', 'Ctrl+T', 'Add the default transition.'),
  action('resolve', 'match-frame', 'Match frame', 'ScanSearch', 'F', 'Match the selected frame.'),
  action('resolve', 'select-clip', 'Select clip', 'MousePointerClick', 'Shift+V', 'Select the clip under the playhead.'),
  action('resolve', 'enable-clip', 'Enable / Disable clip', 'Eye', 'D', 'Toggle the selected clip.'),
  action('resolve', 'retime', 'Retime controls', 'Gauge', 'Ctrl+R', 'Show retime controls on Edit.'),
  menu('resolve', 'edit-menu', 'Edit', 'Film', ['resolve-transition', 'resolve-match-frame', 'resolve-select-clip', 'resolve-enable-clip', 'resolve-retime'], 'Edit-page actions.'),
  action('resolve', 'serial-node', 'Serial node', 'GitBranchPlus', 'Alt+S', 'Add a serial node on Color.'),
  action('resolve', 'bypass-grades', 'Bypass grades', 'EyeOff', 'Shift+D', 'Bypass all color grades.'),
  action('resolve', 'disable-node', 'Disable node', 'CircleOff', 'Ctrl+D', 'Disable the current color node.'),
  action('resolve', 'grab-still', 'Grab still', 'Camera', 'Ctrl+Alt+G', 'Grab a still from the current frame.'),
  action('resolve', 'highlight', 'Highlight', 'Highlighter', 'Shift+H', 'Toggle highlight mode.'),
  menu('resolve', 'color-menu', 'Color', 'Palette', ['resolve-serial-node', 'resolve-bypass-grades', 'resolve-disable-node', 'resolve-grab-still', 'resolve-highlight'], 'Color-page actions.'),
  action('resolve', 'page-edit', 'Edit page', 'Film', 'Shift+4', 'Open the Edit page.'),
  action('resolve', 'page-color', 'Color page', 'Palette', 'Shift+6', 'Open the Color page.'),
  action('resolve', 'page-fairlight', 'Fairlight page', 'AudioLines', 'Shift+7', 'Open the Fairlight page.'),
  action('resolve', 'page-deliver', 'Deliver page', 'PackageCheck', 'Shift+8', 'Open the Deliver page.'),
  action('resolve', 'save', 'Save project', 'Save', 'Ctrl+S', 'Save the current project.'),
  menu('resolve', 'pages-menu', 'Pages / Deliver', 'PanelsTopLeft', ['resolve-page-edit', 'resolve-page-color', 'resolve-page-fairlight', 'resolve-page-deliver', 'resolve-save'], 'Page navigation and project save.'),
  fill('resolve', 'second-step', 'Second step', 'FastForward', 'Space', 'Shift+Right', 'Shift+Left', 'Step the playhead one second.'),
  fill('resolve', 'marker-jump', 'Marker jump', 'MapPinned', 'M', 'Shift+Down', 'Shift+Up', 'Walk timeline markers.'),
  fill('resolve', 'timeline-zoom', 'Timeline zoom', 'ZoomIn', 'Ctrl+0', 'Ctrl+=', 'Ctrl+-', 'Zoom the timeline.'),
  fill('resolve', 'clip-volume', 'Clip volume', 'Volume2', 'Space', 'Ctrl+Alt+=', 'Ctrl+Alt+-', 'Adjust selected clip volume by 1 dB.'),
  fill('resolve', 'clip-volume-coarse', 'Clip volume 3 dB', 'Volume1', 'Space', 'Alt+Shift+=', 'Alt+Shift+-', 'Adjust selected clip volume by 3 dB.'),
  fill('resolve', 'clip-nudge', 'Clip nudge', 'MoveHorizontal', 'Space', '.', ',', 'Move the selected clip one frame.'),
  fill('resolve', 'slip', 'Slip clip', 'BetweenHorizontalStart', 'Space', 'Alt+.', 'Alt+,', 'Slip the selected clip one frame.'),
  fill('resolve', 'slide', 'Slide clip', 'BetweenHorizontalEnd', 'Space', 'Alt+Shift+.', 'Alt+Shift+,', 'Slide the selected clip one frame; verify this chord in-app.'),
  fill('resolve', 'shuttle', 'JKL shuttle', 'Gauge', 'Space', 'L', 'J', 'Increase forward or reverse shuttle speed.'),
  fill('resolve', 'node-walk', 'Color nodes', 'GitBranch', 'Alt+S', 'Ctrl+Alt+Shift+]', 'Ctrl+Alt+Shift+[', 'Walk color nodes using reserved shortcuts.', { setupInstructions: SETUP.resolve }),
  fill('resolve', 'track-height', 'Video track height', 'Rows3', 'Shift+4', 'Ctrl+Alt+Shift+=', 'Ctrl+Alt+Shift+-', 'Adjust video track height using reserved shortcuts.', { setupInstructions: SETUP.resolve }),
];

const premiere: AppActionSpec[] = [
  fill('premiere', 'jog', 'Jog', 'StepForward', 'Space', 'Right', 'Left', 'Play or stop on click and jog one frame per tick.'),
  action('premiere', 'razor', 'Razor at playhead', 'Scissors', 'Ctrl+K', 'Add an edit at the playhead.'),
  action('premiere', 'ripple-delete', 'Ripple delete', 'Trash2', 'Shift+Delete', 'Delete and close the timeline gap.'),
  action('premiere', 'trim-head', 'Ripple trim head', 'PanelLeftClose', 'Q', 'Ripple trim the clip head to the playhead.'),
  action('premiere', 'trim-tail', 'Ripple trim tail', 'PanelRightClose', 'W', 'Ripple trim the clip tail to the playhead.'),
  action('premiere', 'extend-edit', 'Extend selected edit', 'MoveHorizontal', 'E', 'Extend the selected edit to the playhead.'),
  action('premiere', 'extend-prev', 'Extend previous', 'ArrowLeftToLine', 'Shift+Q', 'Extend the previous edit.'),
  action('premiere', 'extend-next', 'Extend next', 'ArrowRightToLine', 'Shift+W', 'Extend the next edit.'),
  menu('premiere', 'trim-menu', 'Trim', 'BetweenHorizontalStart', ['premiere-trim-head', 'premiere-trim-tail', 'premiere-extend-edit', 'premiere-extend-prev', 'premiere-extend-next'], 'Timeline trimming commands.'),
  fill('premiere', 'zoom', 'Timeline zoom', 'ZoomIn', '\\', '=', '-', 'Fit the timeline on click and zoom with the wheel.'),
  action('premiere', 'marker-add', 'Add marker', 'MapPinPlus', 'M', 'Add a marker.'),
  action('premiere', 'marker-next', 'Next marker', 'SkipForward', 'Shift+M', 'Jump to the next marker.'),
  action('premiere', 'marker-prev', 'Previous marker', 'SkipBack', 'Ctrl+Shift+M', 'Jump to the previous marker.'),
  action('premiere', 'marker-clear', 'Clear marker', 'MapPinX', 'Ctrl+Alt+M', 'Clear the current marker.'),
  menu('premiere', 'markers-menu', 'Markers', 'MapPinned', ['premiere-marker-add', 'premiere-marker-next', 'premiere-marker-prev', 'premiere-marker-clear'], 'Timeline marker commands.'),
  fill('premiere', 'clip-volume', 'Clip volume', 'Volume2', 'G', ']', '[', 'Open Audio Gain on click and adjust selected clip volume by 1 dB.'),
  action('premiere', 'audio-gain', 'Audio Gain', 'AudioLines', 'G', 'Open Audio Gain.'),
  action('premiere', 'enable-clip', 'Enable / Disable', 'Eye', 'Shift+E', 'Toggle the selected clip.'),
  action('premiere', 'audio-crossfade', 'Audio crossfade', 'Blend', 'Ctrl+Shift+D', 'Apply the default audio transition.'),
  menu('premiere', 'audio-menu', 'Audio', 'AudioLines', ['premiere-clip-volume', 'premiere-audio-gain', 'premiere-enable-clip', 'premiere-audio-crossfade'], 'Audio gain and transitions.'),
  action('premiere', 'default-transition', 'Default transition', 'BetweenHorizontalEnd', 'Ctrl+D', 'Apply the default video transition.'),
  action('premiere', 'save', 'Save', 'Save', 'Ctrl+S', 'Save the project.'),
  action('premiere', 'render-in-out', 'Render In to Out', 'Gauge', 'Enter', 'Render the marked timeline range.'),
  action('premiere', 'export', 'Export media', 'FileOutput', 'Ctrl+M', 'Open Export Media.'),
  menu('premiere', 'finish-menu', 'Finish', 'PackageCheck', ['premiere-default-transition', 'premiere-save', 'premiere-render-in-out', 'premiere-export'], 'Finish and export the edit.'),
  fill('premiere', 'coarse-jog', 'Jog 5 frames', 'FastForward', 'Space', 'Shift+Right', 'Shift+Left', 'Jog five frames per tick.'),
  fill('premiere', 'edit-point', 'Edit points', 'BetweenHorizontalStart', 'Ctrl+K', 'Down', 'Up', 'Walk timeline edit points.'),
  fill('premiere', 'clip-volume-big', 'Clip volume coarse', 'Volume1', 'G', 'Shift+]', 'Shift+[', 'Adjust clip volume by the configured large step.'),
  fill('premiere', 'video-track-height', 'Video track height', 'Rows3', '\\', 'Ctrl+=', 'Ctrl+-', 'Adjust all video track heights.'),
  fill('premiere', 'audio-track-height', 'Audio track height', 'Rows4', '\\', 'Alt+=', 'Alt+-', 'Adjust all audio track heights.'),
  fill('premiere', 'marker-hop', 'Marker jump', 'MapPinned', 'M', 'Shift+M', 'Ctrl+Shift+M', 'Walk markers.'),
  fill('premiere', 'clip-nudge', 'Clip nudge', 'MoveHorizontal', 'Space', 'Alt+Right', 'Alt+Left', 'Move the selected clip one frame.'),
  fill('premiere', 'clip-nudge-five', 'Clip nudge 5', 'MoveHorizontal', 'Space', 'Alt+Shift+Right', 'Alt+Shift+Left', 'Move the selected clip five frames.'),
  fill('premiere', 'clip-track', 'Move across tracks', 'MoveVertical', 'Space', 'Alt+Up', 'Alt+Down', 'Move the selected clip between tracks.'),
  fill('premiere', 'shuttle', 'Shuttle', 'Gauge', 'K', 'L', 'J', 'Stop on click and change shuttle speed with the wheel.'),
  fill('premiere', 'page-scroll', 'Timeline page', 'PanelTop', '\\', 'PageDown', 'PageUp', 'Scroll the timeline by one view page.'),
  fill('premiere', 'caption-hop', 'Caption segment', 'Captions', 'Space', 'Ctrl+Alt+Down', 'Ctrl+Alt+Up', 'Walk caption segments; verify in-app.'),
  fill('premiere', 'graphics-order', 'Graphics order', 'Layers3', 'V', 'Ctrl+]', 'Ctrl+[', 'Move a selected graphics layer through the stack.'),
];

const afterEffects: AppActionSpec[] = [
  action('after-effects', 'easy-ease', 'Easy Ease', 'Spline', 'F9', 'Apply Easy Ease.'),
  action('after-effects', 'ease-in', 'Easy Ease In', 'TrendingUp', 'Shift+F9', 'Apply Easy Ease In.'),
  action('after-effects', 'ease-out', 'Easy Ease Out', 'TrendingDown', 'Ctrl+Shift+F9', 'Apply Easy Ease Out.'),
  action('after-effects', 'hold', 'Hold keyframe', 'Pause', 'Ctrl+Alt+H', 'Convert selected keyframes to Hold.'),
  action('after-effects', 'graph-editor', 'Graph Editor', 'ChartSpline', 'Shift+F3', 'Toggle the Graph Editor.'),
  menu('after-effects', 'ease-menu', 'Ease', 'Spline', ['after-effects-easy-ease', 'after-effects-ease-in', 'after-effects-ease-out', 'after-effects-hold', 'after-effects-graph-editor'], 'Keyframe interpolation controls.'),
  fill('after-effects', 'reveal-keyframes', 'Reveal keyframes', 'KeyRound', 'U', 'J', 'K', 'Reveal animated properties and walk keyframes.'),
  action('after-effects', 'key-position', 'Position keyframe', 'Move', 'Alt+Shift+P', 'Add or remove a Position keyframe.'),
  action('after-effects', 'key-scale', 'Scale keyframe', 'Scaling', 'Alt+Shift+S', 'Add or remove a Scale keyframe.'),
  action('after-effects', 'key-rotation', 'Rotation keyframe', 'RotateCw', 'Alt+Shift+R', 'Add or remove a Rotation keyframe.'),
  action('after-effects', 'key-opacity', 'Opacity keyframe', 'Blend', 'Alt+Shift+T', 'Add or remove an Opacity keyframe.'),
  action('after-effects', 'key-anchor', 'Anchor keyframe', 'Anchor', 'Alt+Shift+A', 'Add or remove an Anchor Point keyframe.'),
  menu('after-effects', 'keyframe-menu', 'Add keyframe', 'DiamondPlus', ['after-effects-key-position', 'after-effects-key-scale', 'after-effects-key-rotation', 'after-effects-key-opacity', 'after-effects-key-anchor'], 'Property keyframe commands.'),
  fill('after-effects', 'jog', 'Jog frames', 'StepForward', 'Space', 'PageUp', 'PageDown', 'Play or pause on click and jog the timeline.'),
  action('after-effects', 'new-null', 'New null', 'CircleDot', 'Ctrl+Alt+Shift+Y', 'Create a Null Object.'),
  action('after-effects', 'new-adjustment', 'New adjustment', 'SlidersHorizontal', 'Ctrl+Alt+Y', 'Create an Adjustment Layer.'),
  action('after-effects', 'new-solid', 'New solid', 'Square', 'Ctrl+Y', 'Create a Solid.'),
  action('after-effects', 'new-text', 'New text', 'Type', 'Ctrl+Alt+Shift+T', 'Create a Text layer.'),
  action('after-effects', 'new-camera', 'New camera', 'Camera', 'Ctrl+Alt+Shift+C', 'Create a Camera.'),
  menu('after-effects', 'new-layer-menu', 'New layer', 'Layers3', ['after-effects-new-null', 'after-effects-new-adjustment', 'after-effects-new-solid', 'after-effects-new-text', 'after-effects-new-camera'], 'Layer creation commands.'),
  action('after-effects', 'split-layer', 'Split layer', 'Scissors', 'Ctrl+Shift+D', 'Split selected layers at current time.'),
  action('after-effects', 'trim-in', 'Trim in', 'PanelLeftClose', 'Alt+[', 'Trim layer in-point to current time.'),
  action('after-effects', 'trim-out', 'Trim out', 'PanelRightClose', 'Alt+]', 'Trim layer out-point to current time.'),
  action('after-effects', 'duplicate', 'Duplicate layer', 'CopyPlus', 'Ctrl+D', 'Duplicate selected layers.'),
  action('after-effects', 'precompose', 'Pre-compose', 'Boxes', 'Ctrl+Shift+C', 'Pre-compose selected layers.'),
  menu('after-effects', 'split-menu', 'Split / Trim', 'Scissors', ['after-effects-split-layer', 'after-effects-trim-in', 'after-effects-trim-out', 'after-effects-duplicate', 'after-effects-precompose'], 'Split, trim, and pre-compose layers.'),
  action('after-effects', 'apply-last-effect', 'Apply last effect', 'WandSparkles', 'Ctrl+Alt+Shift+E', 'Apply the most recently used effect.'),
  action('after-effects', 'effect-controls', 'Effect Controls', 'SlidersHorizontal', 'F3', 'Open Effect Controls.'),
  action('after-effects', 'remove-effects', 'Remove all effects', 'Eraser', 'Ctrl+Shift+E', 'Remove all effects from selected layers.'),
  menu('after-effects', 'effects-menu', 'Effects', 'WandSparkles', ['after-effects-apply-last-effect', 'after-effects-effect-controls', 'after-effects-remove-effects'], 'Effect application and cleanup.'),
  action('after-effects', 'increment-save', 'Increment and Save', 'Save', 'Ctrl+Alt+Shift+S', 'Increment the project filename and save.'),
  action('after-effects', 'render-queue', 'Render Queue', 'ListPlus', 'Ctrl+M', 'Add the composition to Render Queue.'),
  action('after-effects', 'ame-queue', 'Adobe Media Encoder', 'PackagePlus', 'Ctrl+Alt+M', 'Add the composition to Adobe Media Encoder.'),
  action('after-effects', 'trim-work-area', 'Trim comp to work area', 'Crop', 'Ctrl+Shift+X', 'Trim the composition to the work area.'),
  menu('after-effects', 'save-render-menu', 'Save / Render', 'PackageCheck', ['after-effects-increment-save', 'after-effects-render-queue', 'after-effects-ame-queue', 'after-effects-trim-work-area'], 'Version and render the composition.'),
  fill('after-effects', 'jog-ten', 'Jog 10 frames', 'FastForward', 'Space', 'Shift+PageUp', 'Shift+PageDown', 'Jog ten frames per tick.'),
  fill('after-effects', 'comp-zoom', 'Comp zoom', 'ZoomIn', '/', '.', ',', 'Zoom the active viewer.'),
  fill('after-effects', 'timeline-zoom', 'Timeline zoom', 'SearchCode', '\\', '=', '-', 'Zoom the timeline; verify main-keyboard punctuation in-app.'),
  fill('after-effects', 'layer-order', 'Layer order', 'Layers3', 'Ctrl+Shift+]', 'Ctrl+]', 'Ctrl+[', 'Move selected layers through the stack.'),
  fill('after-effects', 'layer-walk', 'Layer selection', 'ListOrdered', 'U', 'Ctrl+Up', 'Ctrl+Down', 'Walk timeline layers.'),
  fill('after-effects', 'nudge-x', 'Nudge horizontal', 'MoveHorizontal', 'P', 'Left', 'Right', 'Nudge selected layers horizontally.'),
  fill('after-effects', 'nudge-y', 'Nudge vertical', 'MoveVertical', 'P', 'Up', 'Down', 'Nudge selected layers vertically.'),
  fill('after-effects', 'layer-time', 'Layer in time', 'Clock3', 'U', 'Alt+PageUp', 'Alt+PageDown', 'Move selected layers in time.'),
  fill('after-effects', 'history', 'Undo / Redo', 'History', 'Ctrl+Z', 'Ctrl+Z', 'Ctrl+Shift+Z', 'Scrub project history.'),
  fill('after-effects', 'rotation-nudge', 'Rotation nudge', 'RotateCw', 'R', 'Ctrl+Alt+Shift+,', 'Ctrl+Alt+Shift+.', 'Adjust Rotation by one degree using reserved shortcuts.', { setupInstructions: SETUP['after-effects'] }),
  fill('after-effects', 'scale-nudge', 'Scale nudge', 'Scaling', 'S', 'Ctrl+Alt+Shift+F5', 'Ctrl+Alt+Shift+F6', 'Adjust Scale by one percent using reserved shortcuts.', { setupInstructions: SETUP['after-effects'] }),
  fill('after-effects', 'opacity-nudge', 'Opacity nudge', 'Blend', 'T', 'Ctrl+Alt+Shift+F7', 'Ctrl+Alt+Shift+F8', 'Adjust Opacity by one percent using reserved shortcuts.', { setupInstructions: SETUP['after-effects'] }),
];

const figma: AppActionSpec[] = [
  action('figma', 'auto-layout', 'Auto layout', 'Rows3', 'Shift+A', 'Wrap the selection in Auto Layout.'),
  action('figma', 'component', 'Create component', 'Component', 'Ctrl+Alt+K', 'Create a main component.'),
  action('figma', 'group', 'Group', 'Group', 'Ctrl+G', 'Group the selection.'),
  action('figma', 'ungroup', 'Ungroup', 'Ungroup', 'Ctrl+Shift+G', 'Ungroup the selection.'),
  action('figma', 'frame-selection', 'Frame selection', 'Frame', 'Ctrl+Alt+G', 'Wrap the selection in a frame.'),
  menu('figma', 'group-menu', 'Group / Frame', 'Group', ['figma-group', 'figma-ungroup', 'figma-frame-selection'], 'Grouping and framing.'),
  fill('figma', 'zoom', 'Zoom', 'ZoomIn', 'Shift+1', 'Ctrl+=', 'Ctrl+-', 'Fit the canvas on click and zoom with the wheel.'),
  fill('figma', 'layer-order', 'Layer order', 'Layers3', 'Ctrl+Shift+]', 'Ctrl+]', 'Ctrl+[', 'Move the selection through the layer stack.'),
  action('figma', 'align-left', 'Align left', 'AlignStartHorizontal', 'Alt+A', 'Align the selection left.'),
  action('figma', 'align-right', 'Align right', 'AlignEndHorizontal', 'Alt+D', 'Align the selection right.'),
  action('figma', 'align-h-center', 'Align horizontal centers', 'AlignCenterHorizontal', 'Alt+H', 'Align horizontal centers.'),
  action('figma', 'align-v-center', 'Align vertical centers', 'AlignCenterVertical', 'Alt+V', 'Align vertical centers.'),
  figmaMacro('tidy', 'Tidy up', 'LayoutGrid', 'Run Tidy up through the Figma Actions menu; verify the result in-app.'),
  menu('figma', 'align-menu', 'Align', 'AlignCenter', ['figma-align-left', 'figma-align-right', 'figma-align-h-center', 'figma-align-v-center', 'figma-tidy'], 'Alignment and tidy-up commands.'),
  action('figma', 'paste-properties', 'Paste properties', 'ClipboardPaste', 'Ctrl+Alt+V', 'Paste copied fills, strokes, and effects.'),
  action('figma', 'copy-properties', 'Copy properties', 'ClipboardCopy', 'Ctrl+Alt+C', 'Copy fills, strokes, and effects.'),
  action(
    'figma',
    'copy-png',
    'Copy as PNG',
    'ImageDown',
    'Ctrl+Shift+C',
    'Copy the selection as PNG; verify the clipboard result in the installed Figma build.',
    { verification: 'unverified' }
  ),
  figmaMacro('copy-svg', 'Copy as SVG', 'CodeXml', 'Copy the selection as SVG through the Figma Actions menu.'),
  menu('figma', 'properties-menu', 'Properties', 'Clipboard', ['figma-paste-properties', 'figma-copy-properties', 'figma-copy-png', 'figma-copy-svg'], 'Copy and paste design properties.'),
  action(
    'figma',
    'quick-actions',
    'Quick Actions',
    'Search',
    FIGMA_ACTIONS_SHORTCUT,
    'Open the Figma Actions menu. Editing this shortcut also updates untouched Figma preset macros when the ring opens.',
    {
      setupInstructions:
        'In Figma, open Keyboard shortcuts and confirm the Actions menu binding for your keyboard layout. If it differs, edit this Quick Actions shortcut; untouched Figma preset macros will follow it. Recheck after Figma UI or keyboard-layout changes.',
    }
  ),
  fill('figma', 'font-size', 'Font size', 'Type', 'T', 'Ctrl+Shift+.', 'Ctrl+Shift+,', 'Adjust selected text size.'),
  fill('figma', 'font-weight', 'Font weight', 'Bold', 'T', 'Ctrl+Alt+.', 'Ctrl+Alt+,', 'Cycle available font weights.'),
  fill('figma', 'letter-spacing', 'Letter spacing', 'Space', 'T', 'Alt+.', 'Alt+,', 'Adjust selected text letter spacing.'),
  fill('figma', 'line-height', 'Line height', 'BetweenVerticalStart', 'T', 'Alt+Shift+.', 'Alt+Shift+,', 'Adjust selected text line height.'),
  fill('figma', 'nudge-x', 'Nudge horizontal', 'MoveHorizontal', 'V', 'Right', 'Left', 'Nudge the selection horizontally.'),
  fill('figma', 'nudge-y', 'Nudge vertical', 'MoveVertical', 'V', 'Down', 'Up', 'Nudge the selection vertically.'),
  fill('figma', 'nudge-x-big', 'Nudge horizontal 10px', 'MoveHorizontal', 'V', 'Shift+Right', 'Shift+Left', 'Nudge horizontally by the configured big-nudge amount.'),
  fill('figma', 'nudge-y-big', 'Nudge vertical 10px', 'MoveVertical', 'V', 'Shift+Down', 'Shift+Up', 'Nudge vertically by the configured big-nudge amount.'),
  fill('figma', 'resize-width', 'Resize width', 'MoveHorizontal', 'V', 'Ctrl+Right', 'Ctrl+Left', 'Resize the selected object width.', { verification: 'unverified' }),
  fill('figma', 'resize-height', 'Resize height', 'MoveVertical', 'V', 'Ctrl+Down', 'Ctrl+Up', 'Resize the selected object height.', { verification: 'unverified' }),
  fill('figma', 'walk-siblings', 'Walk siblings', 'ListTree', 'Enter', 'Tab', 'Shift+Tab', 'Walk sibling layers.'),
  fill('figma', 'walk-frames', 'Walk frames', 'PanelsTopLeft', 'Shift+1', 'N', 'Shift+N', 'Walk and zoom to top-level frames.', { verification: 'unverified' }),
  fill('figma', 'walk-pages', 'Walk pages', 'Files', 'Shift+1', 'PageDown', 'PageUp', 'Walk pages.', { verification: 'unverified' }),
  fill('figma', 'history', 'Undo / Redo', 'History', 'Ctrl+Z', 'Ctrl+Shift+Z', 'Ctrl+Z', 'Scrub file history.'),
  figmaMacro('rasterize', 'Rasterize selection', 'Grid2X2', 'Rasterize the selection through the Figma Actions menu.'),
  figmaMacro('same-fill', 'Select same fill', 'PaintBucket', 'Select all layers with the same fill.'),
  figmaMacro('version-history', 'Version history', 'History', 'Open version history through the Figma Actions menu.'),
];

const ALL_SPECS: AppActionSpec[] = [
  ...photoshop,
  ...blender,
  ...resolve,
  ...premiere,
  ...afterEffects,
  ...figma,
];

const SPEC_BY_ID = new Map(ALL_SPECS.map((spec) => [spec.id, spec]));

const shortcutField: ActionEditorField = {
  key: 'payload',
  label: 'Click shortcut',
  type: 'shortcut',
  required: true,
};

function editorFieldsFor(spec: AppActionSpec): ActionEditorField[] {
  if (spec.bubbleType === 'menu') {
    return [{ key: 'children', label: 'Submenu actions', type: 'readonly' }];
  }
  const payloadField: ActionEditorField = spec.actionType === 'macro'
    ? { key: 'payload', label: 'Macro steps', type: 'textarea', required: true }
    : spec.actionType === 'keyboard-sequence'
      ? { key: 'payload', label: 'Sequence', type: 'textarea', required: true }
      : shortcutField;
  return spec.bubbleType === 'fill'
    ? [
        payloadField,
        { key: 'scrollUpAction', label: 'Wheel up shortcut', type: 'shortcut', required: true },
        { key: 'scrollDownAction', label: 'Wheel down shortcut', type: 'shortcut', required: true },
      ]
    : [payloadField];
}

export const APP_ACTION_CATALOG: ActionDefinition[] = ALL_SPECS.map((spec) => ({
  id: spec.id,
  label: spec.label,
  description: spec.description,
  category: 'app',
  appId: spec.appId,
  iconName: spec.iconName,
  actionType: spec.actionType,
  bubbleType: spec.bubbleType,
  defaultPayload: spec.payload,
  scrollUpAction: spec.scrollUpAction,
  scrollDownAction: spec.scrollDownAction,
  editorFields: editorFieldsFor(spec),
  searchTerms: [
    APP_LABELS[spec.appId].toLowerCase(),
    spec.label.toLowerCase(),
    spec.id.replaceAll('-', ' '),
    ...(spec.searchTerms ?? []),
  ],
  availability: spec.setupInstructions ? 'requires-setup' : 'available',
  setupInstructions: spec.setupInstructions,
  unavailableReason: spec.setupInstructions,
  verification: spec.verification ?? 'verified',
}));

export const APP_PROFILE_PRESETS: AppProfilePreset[] = [
  {
    id: 'photoshop',
    displayName: 'Adobe Photoshop',
    processName: 'Photoshop',
    description: 'History, brushes, adjustments, selections, layers, and export.',
    iconName: 'Image',
    researchedAt: '2026-07',
  },
  {
    id: 'blender',
    displayName: 'Blender',
    processName: 'blender',
    description: 'Numpad-free view controls, modes, shading, history, and render.',
    iconName: 'Box',
    researchedAt: '2026-07',
  },
  {
    id: 'resolve',
    displayName: 'DaVinci Resolve',
    processName: 'Resolve',
    description: 'Cross-page editing with dedicated Edit, Color, and Deliver groups.',
    iconName: 'Clapperboard',
    researchedAt: '2026-07',
  },
  {
    id: 'premiere',
    displayName: 'Adobe Premiere Pro',
    processName: 'Adobe Premiere Pro',
    description: 'Jog, trim, markers, audio, transitions, rendering, and export.',
    iconName: 'Film',
    researchedAt: '2026-07',
  },
  {
    id: 'after-effects',
    displayName: 'Adobe After Effects',
    processName: 'AfterFX',
    description: 'Keyframes, easing, timeline jog, layers, effects, and render.',
    iconName: 'Sparkles',
    researchedAt: '2026-07',
  },
  {
    id: 'figma',
    displayName: 'Figma',
    processName: 'Figma',
    description: 'Auto layout, components, layers, alignment, properties, and Quick Actions.',
    iconName: 'Component',
    researchedAt: '2026-07',
  },
];

const PRESET_ACTION_IDS: Record<SupportedAppId, string[]> = {
  photoshop: [
    'photoshop-history',
    'photoshop-brush-size',
    'photoshop-zoom',
    'photoshop-layer-nav',
    'photoshop-select-menu',
    'photoshop-adjustments-menu',
    'photoshop-layers-menu',
    'photoshop-transform-export-menu',
  ],
  blender: [
    'blender-search',
    'blender-play',
    'blender-history',
    'blender-mode-menu',
    'blender-shading-menu',
    'blender-view-menu',
    'blender-save-incremental',
    'blender-render-menu',
  ],
  resolve: [
    'resolve-split',
    'resolve-ripple-delete',
    'resolve-marker',
    'resolve-frame-step',
    'resolve-edit-point',
    'resolve-edit-menu',
    'resolve-color-menu',
    'resolve-pages-menu',
  ],
  premiere: [
    'premiere-jog',
    'premiere-razor',
    'premiere-ripple-delete',
    'premiere-trim-menu',
    'premiere-zoom',
    'premiere-markers-menu',
    'premiere-audio-menu',
    'premiere-finish-menu',
  ],
  'after-effects': [
    'after-effects-ease-menu',
    'after-effects-reveal-keyframes',
    'after-effects-keyframe-menu',
    'after-effects-jog',
    'after-effects-new-layer-menu',
    'after-effects-split-menu',
    'after-effects-effects-menu',
    'after-effects-save-render-menu',
  ],
  figma: [
    'figma-auto-layout',
    'figma-component',
    'figma-group-menu',
    'figma-zoom',
    'figma-layer-order',
    'figma-align-menu',
    'figma-properties-menu',
    'figma-quick-actions',
  ],
};

function setupParameters(spec: AppActionSpec): Record<string, string | number | boolean> {
  return spec.setupInstructions
    ? { requiresSetup: true, setupInstructions: spec.setupInstructions, appAdjustment: spec.bubbleType === 'fill' }
    : { appAdjustment: spec.bubbleType === 'fill' };
}

function createBubble(spec: AppActionSpec, angleIndex: number): BubbleConfig {
  return {
    id: uuidv4(),
    definitionId: spec.id,
    label: spec.label,
    iconName: spec.iconName,
    angleIndex,
    actionType: spec.actionType,
    payload: spec.payload,
    type: spec.bubbleType,
    scrollUpAction: spec.scrollUpAction,
    scrollDownAction: spec.scrollDownAction,
    children: spec.children?.map((childId, childIndex) => {
      const child = SPEC_BY_ID.get(childId);
      if (!child) throw new Error(`Unknown app-action preset child: ${childId}`);
      return createBubble(child, childIndex);
    }),
    parameters: setupParameters(spec),
  };
}

function createSlot(definitionId: string, position: number): RingProfile['slots'][number] {
  const spec = SPEC_BY_ID.get(definitionId);
  if (!spec) throw new Error(`Unknown app-action preset: ${definitionId}`);
  const bubble = createBubble(spec, position);
  return {
    id: uuidv4(),
    position,
    assignment: {
      id: bubble.id,
      definitionId: spec.id,
      label: bubble.label,
      iconName: bubble.iconName,
      actionType: bubble.actionType,
      payload: bubble.payload,
      type: bubble.type ?? 'default',
      scrollUpAction: bubble.scrollUpAction,
      scrollDownAction: bubble.scrollDownAction,
      children: bubble.children,
      parameters: bubble.parameters,
    },
  };
}

/** Creates a fresh, editable profile with new stable IDs on every gallery click. */
export function createAppProfileFromPreset(
  presetId: SupportedAppId,
  sortOrder: number
): RingProfile {
  const preset = APP_PROFILE_PRESETS.find((item) => item.id === presetId);
  if (!preset) throw new Error(`Unknown app profile preset: ${presetId}`);
  return {
    id: uuidv4(),
    name: `${preset.displayName} Ring`,
    kind: 'application',
    enabled: true,
    protected: false,
    sortOrder,
    slots: PRESET_ACTION_IDS[presetId].map(createSlot),
    application: {
      processName: preset.processName,
      displayName: preset.displayName,
    },
  };
}

function findBubbleByDefinitionId(
  bubbles: BubbleConfig[],
  definitionId: string
): BubbleConfig | null {
  for (const bubble of bubbles) {
    if (bubble.definitionId === definitionId) return bubble;
    const nested = bubble.children
      ? findBubbleByDefinitionId(bubble.children, definitionId)
      : null;
    if (nested) return nested;
  }
  return null;
}

/**
 * Resolve one user-editable Figma Actions-menu binding across the untouched
 * preset macros for this ring invocation. The persisted macro payload remains
 * independently editable: an exact canonical payload follows Quick Actions,
 * while any customized macro is preserved byte-for-byte.
 */
export function materializeFigmaActionsBinding(
  bubbles: BubbleConfig[]
): BubbleConfig[] {
  const configuredShortcut = findBubbleByDefinitionId(
    bubbles,
    'figma-quick-actions'
  )?.payload?.trim();
  if (!configuredShortcut || configuredShortcut === FIGMA_ACTIONS_SHORTCUT) {
    return bubbles;
  }

  const canonicalPayloadByDefinitionId = new Map(
    Object.entries(FIGMA_MACRO_QUERIES).map(([slug, query]) => [
      `figma-${slug}`,
      `${FIGMA_ACTIONS_SHORTCUT}; delay:${FIGMA_ACTIONS_PALETTE_DELAY_MS}; text:${query}; Enter`,
    ])
  );

  const materialize = (bubble: BubbleConfig): BubbleConfig => {
    const children = bubble.children?.map(materialize);
    const canonicalPayload = bubble.definitionId
      ? canonicalPayloadByDefinitionId.get(bubble.definitionId)
      : undefined;
    const payload = canonicalPayload && bubble.payload === canonicalPayload
      ? `${configuredShortcut}; delay:${FIGMA_ACTIONS_PALETTE_DELAY_MS}; text:${bubble.payload.slice(
          bubble.payload.indexOf('; text:') + 7
        )}`
      : bubble.payload;
    const childrenChanged = Boolean(
      children?.some((child, index) => child !== bubble.children?.[index])
    );
    if (payload === bubble.payload && !childrenChanged) return bubble;
    return {
      ...bubble,
      ...(payload === bubble.payload ? {} : { payload }),
      ...(childrenChanged ? { children } : {}),
    };
  };

  return bubbles.map(materialize);
}

export function getSupportedAppId(processName: string | undefined): SupportedAppId | null {
  if (!processName) return null;
  const normalized = processName.trim().replace(/\.exe$/i, '').toLowerCase();
  return APP_PROFILE_PRESETS.find(
    (preset) => preset.processName.toLowerCase() === normalized
  )?.id ?? null;
}

/** Backward-compatible lookup used by older profile-creation experiments. */
export const PROFILE_TEMPLATES = Object.fromEntries(
  APP_PROFILE_PRESETS.map((preset) => [preset.processName, preset])
) as Record<string, AppProfilePreset>;
