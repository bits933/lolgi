import { AI_BRAND_ICONS, AI_PROVIDERS } from './brandIcons';
import { MAX_FOLDER_CHILDREN } from './constants';
import { APP_ACTION_CATALOG } from './defaultProfiles';
import { bubbleToAssignment } from './profileUtils';
import { validateShortcut } from './shortcutParser';
import type { ActionAssignment, ActionDefinition, ActionEditorField, ActionType } from './types';

const LABEL_ICON_FIELDS: ActionEditorField[] = [];

function definition(
  id: string,
  label: string,
  description: string,
  category: ActionDefinition['category'],
  iconName: string,
  actionType: ActionType,
  options: Partial<ActionDefinition> = {}
): ActionDefinition {
  return {
    id,
    label,
    description,
    category,
    iconName,
    actionType,
    bubbleType: 'default',
    editorFields: LABEL_ICON_FIELDS,
    searchTerms: [label.toLowerCase(), category, actionType],
    ...options,
  };
}

const shortcutField: ActionEditorField = {
  key: 'payload',
  label: 'Shortcut',
  type: 'shortcut',
  placeholder: 'Ctrl+Shift+S',
  required: true,
};

const targetField = (label: string, type: 'file' | 'folder' | 'text'): ActionEditorField => ({
  key: 'payload',
  label,
  type,
  required: true,
});

const screenshotModeField: ActionEditorField = {
  key: 'captureMode',
  label: 'Capture mode',
  type: 'select',
  options: [
    { value: 'screenshot-region', label: 'Region' },
    { value: 'screenshot-window', label: 'Active window' },
    { value: 'screenshot-full', label: 'Full screen' },
  ],
};

export const ACTION_CATALOG: ActionDefinition[] = [
  definition('copy', 'Copy', 'Copy the current selection.', 'system', 'Copy', 'clipboard-copy'),
  definition('paste', 'Paste', 'Paste clipboard content.', 'system', 'ClipboardPaste', 'clipboard-paste'),
  definition('cut', 'Cut', 'Cut the current selection.', 'system', 'Scissors', 'clipboard-cut'),
  definition('undo', 'Undo', 'Undo the last operation.', 'system', 'Undo2', 'clipboard-undo'),
  definition('redo', 'Redo', 'Redo the last operation.', 'system', 'Redo2', 'clipboard-redo'),

  definition('screenshot-region', 'Screenshot region', 'Capture a selected region.', 'system', 'ScanLine', 'screenshot-region', { editorFields: [screenshotModeField] }),
  definition('screenshot-window', 'Screenshot window', 'Capture the active window.', 'system', 'PanelsTopLeft', 'screenshot-window', { editorFields: [screenshotModeField] }),
  definition('screenshot-full', 'Screenshot full screen', 'Capture all displays.', 'system', 'MonitorUp', 'screenshot-full', { editorFields: [screenshotModeField] }),

  definition('volume-up', 'Volume up', 'Increase system output volume.', 'system', 'Volume2', 'volume-up'),
  definition('volume-down', 'Volume down', 'Decrease system output volume.', 'system', 'Volume1', 'volume-down'),
  definition('volume-mute', 'Mute volume', 'Toggle system output mute.', 'system', 'VolumeX', 'volume-mute', { bubbleType: 'toggle' }),
  definition('media-play-pause', 'Play / pause', 'Toggle current media playback.', 'system', 'CirclePlay', 'media-play-pause', { bubbleType: 'toggle' }),
  definition('media-next', 'Next track', 'Skip to the next media track.', 'system', 'SkipForward', 'media-next'),
  definition('media-prev', 'Previous track', 'Return to the previous media track.', 'system', 'SkipBack', 'media-prev'),
  definition('brightness-up', 'Brightness up', 'Increase built-in display brightness.', 'system', 'SunMedium', 'brightness-up'),
  definition('brightness-down', 'Brightness down', 'Decrease built-in display brightness.', 'system', 'SunDim', 'brightness-down'),

  definition('lock-workstation', 'Lock workstation', 'Lock the current Windows session.', 'system', 'LockKeyhole', 'lock-workstation'),
  definition('sleep-displays', 'Sleep displays', 'Turn connected displays off.', 'system', 'MonitorOff', 'sleep-displays'),
  definition('show-desktop', 'Show desktop', 'Toggle the Windows desktop.', 'system', 'GalleryHorizontalEnd', 'show-desktop'),
  definition('window-snap-left', 'Snap window left', 'Snap the active window to the left.', 'system', 'PanelLeft', 'window-snap-left'),
  definition('window-snap-right', 'Snap window right', 'Snap the active window to the right.', 'system', 'PanelRight', 'window-snap-right'),
  definition('window-maximize', 'Maximize window', 'Maximize the active window.', 'system', 'Maximize2', 'window-maximize'),
  definition('window-minimize', 'Minimize window', 'Minimize the active window.', 'system', 'Minimize2', 'window-minimize'),
  definition('app-switcher', 'App switcher', 'Open the Windows app switcher.', 'system', 'PanelsTopLeft', 'app-switcher'),
  definition('virtual-desktop-next', 'Next desktop', 'Move to the next virtual desktop.', 'system', 'ArrowRightToLine', 'virtual-desktop-next'),
  definition('virtual-desktop-prev', 'Previous desktop', 'Move to the previous virtual desktop.', 'system', 'ArrowLeftToLine', 'virtual-desktop-prev'),

  definition('new-note', 'New note', 'Open a new Notepad document.', 'system', 'NotebookPen', 'new-note'),
  definition('emoji-picker', 'Emoji picker', 'Open the Windows emoji picker.', 'system', 'SmilePlus', 'emoji-picker'),
  definition('clipboard-history', 'Clipboard history', 'Open Windows clipboard history.', 'system', 'ClipboardList', 'clipboard-history'),
  definition('os-search', 'System search', 'Open Windows Search.', 'system', 'Search', 'os-search'),
  definition('zoom-in', 'Zoom in', 'Zoom in using the conventional shortcut.', 'system', 'ZoomIn', 'zoom-in'),
  definition('zoom-out', 'Zoom out', 'Zoom out using the conventional shortcut.', 'system', 'ZoomOut', 'zoom-out'),

  definition('adjust-volume', 'Volume control', 'Adjust volume with the wheel or horizontal drag.', 'adjustments', 'AudioLines', 'volume-up', {
    bubbleType: 'fill',
    scrollUpAction: 'volume-up',
    scrollDownAction: 'volume-down',
    editorFields: [
      { key: 'step', label: 'Step', type: 'number', min: 1, max: 20, step: 1 },
      { key: 'clickAction', label: 'Click action', type: 'select', options: [{ value: 'volume-mute', label: 'Mute / unmute' }, { value: 'do-nothing', label: 'Do nothing' }] },
    ],
  }),
  definition('adjust-brightness', 'Brightness control', 'Adjust display brightness with the wheel or drag.', 'adjustments', 'Sun', 'brightness-up', {
    bubbleType: 'fill',
    scrollUpAction: 'brightness-up',
    scrollDownAction: 'brightness-down',
    editorFields: [{ key: 'step', label: 'Step', type: 'number', min: 1, max: 20, step: 1 }],
  }),
  definition('adjust-zoom', 'Zoom control', 'Map relative input to zoom in and out.', 'adjustments', 'SearchCode', 'zoom-in', {
    bubbleType: 'fill',
    scrollUpAction: 'zoom-in',
    scrollDownAction: 'zoom-out',
  }),
  definition('adjust-scroll', 'Scroll control', 'Map relative input to scrolling.', 'adjustments', 'MousePointer2', 'keyboard-shortcut', {
    bubbleType: 'fill',
    scrollUpAction: 'Up',
    scrollDownAction: 'Down',
  }),
  definition('adjust-shortcut-pair', 'Shortcut pair', 'Map wheel directions to any two shortcuts.', 'adjustments', 'ChevronsUpDown', 'keyboard-shortcut', {
    bubbleType: 'fill',
    editorFields: [
      { key: 'scrollUpAction', label: 'Wheel up shortcut', type: 'shortcut', required: true },
      { key: 'scrollDownAction', label: 'Wheel down shortcut', type: 'shortcut', required: true },
    ],
  }),
  definition('adjust-plugin', 'Plugin parameter', 'Adjust a live plugin parameter.', 'adjustments', 'PlugZap', 'do-nothing', {
    availability: 'requires-plugin',
    unavailableReason: 'Plugin parameter control will be enabled when the local plugin API is installed.',
  }),

  definition('keystroke', 'Keystroke', 'Send one keyboard shortcut.', 'basic', 'Keyboard', 'keyboard-shortcut', { editorFields: [shortcutField] }),
  definition('keystroke-sequence', 'Keyboard macros', 'Record ordered shortcuts with optional delays.', 'basic', 'ListOrdered', 'keyboard-sequence', {
    editorFields: [{ key: 'payload', label: 'Macro steps', type: 'textarea', placeholder: 'Ctrl+K\n250ms\nCtrl+S', required: true }],
    searchTerms: ['macro', 'macros', 'sequence'],
  }),
  definition('open-app', 'Open application', 'Launch an app or focus it when already running.', 'basic', 'AppWindow', 'app-launch', {
    editorFields: [
      { key: 'payload', label: 'Application', type: 'app', required: true },
      { key: 'arguments', label: 'Arguments', type: 'text', placeholder: '--new-window' },
      { key: 'focusIfRunning', label: 'Focus if already running', type: 'toggle' },
    ],
  }),
  definition('open-file', 'Open file', 'Open a file with its default application.', 'basic', 'FileUp', 'file-open', { editorFields: [targetField('File', 'file')] }),
  definition('open-folder', 'Open folder', 'Open a local or network folder.', 'basic', 'FolderOpen', 'folder-open', { editorFields: [targetField('Folder', 'folder')] }),
  definition('open-url', 'Open URL', 'Open a safe web URL in the default browser.', 'basic', 'ExternalLink', 'url-open', { editorFields: [targetField('URL', 'text')] }),
  definition('ai-launcher', 'AI launcher', 'Open your AI assistant in the browser.', 'basic', 'Sparkles', 'url-open', {
    editorFields: [
      { key: 'aiProvider', label: 'Assistant', type: 'select', required: true, options: AI_PROVIDERS.map((provider) => ({ value: provider.id, label: provider.label })) },
      { key: 'payload', label: 'Link', type: 'text', required: true },
    ],
    searchTerms: ['ai', 'assistant', 'chatgpt', 'gemini', 'claude'],
  }),
  definition('run-command', 'Run command', 'Run a command with explicit options.', 'basic', 'TerminalSquare', 'run-command', {
    editorFields: [
      { key: 'payload', label: 'Command', type: 'textarea', placeholder: 'command or script', required: true },
      { key: 'arguments', label: 'Arguments', type: 'text', placeholder: '--argument value' },
      { key: 'workingDirectory', label: 'Working directory', type: 'folder' },
      { key: 'hidden', label: 'Hide command window', type: 'toggle' },
      { key: 'runAsAdmin', label: 'Run as administrator', type: 'toggle' },
    ],
  }),
  definition('switch-profile', 'Switch profile', 'Temporarily switch to a named ring profile.', 'basic', 'RefreshCw', 'switch-profile', {
    editorFields: [{ key: 'payload', label: 'Profile', type: 'select', required: true }],
  }),
  definition('return-auto', 'Return to Auto', 'Return profile selection to automatic matching.', 'basic', 'ScanSearch', 'return-to-auto'),
  definition('do-nothing', 'Do nothing', 'Keep a deliberate inert placeholder.', 'basic', 'CircleOff', 'do-nothing'),

  definition('morph-group', 'Submenu', 'Create a sub-ring with up to five actions.', 'structural', 'Orbit', 'do-nothing', {
    bubbleType: 'menu',
    editorFields: [{ key: 'children', label: 'Submenu actions', type: 'readonly' }],
  }),
  definition('easy-switch-1', 'Easy-Switch x1', 'Switch a compatible device to channel one.', 'structural', 'RadioTower', 'easy-switch', {
    defaultPayload: '1',
    availability: 'requires-device',
    unavailableReason: 'Easy-Switch requires a verified compatible-device adapter and is not available in this build.',
  }),
  definition('easy-switch-2', 'Easy-Switch x2', 'Switch a compatible device to channel two.', 'structural', 'RadioTower', 'easy-switch', {
    defaultPayload: '2',
    availability: 'requires-device',
    unavailableReason: 'Easy-Switch requires a verified compatible-device adapter and is not available in this build.',
  }),
  definition('easy-switch-3', 'Easy-Switch x3', 'Switch a compatible device to channel three.', 'structural', 'RadioTower', 'easy-switch', {
    defaultPayload: '3',
    availability: 'requires-device',
    unavailableReason: 'Easy-Switch requires a verified compatible-device adapter and is not available in this build.',
  }),

  ...APP_ACTION_CATALOG,

  definition('custom-action', 'Custom action', 'Build a macro with shortcuts, apps, URLs, files, and delays.', 'custom', 'WandSparkles', 'macro', {
    editorFields: [{ key: 'payload', label: 'Macro steps', type: 'textarea', placeholder: 'Ctrl+C; delay:100; url:https://example.com', required: true }],
  }),
];

export const ACTION_DEFINITIONS = new Map(ACTION_CATALOG.map((item) => [item.id, item]));

export function createAssignmentFromDefinition(definitionId: string): ActionAssignment | null {
  const item = ACTION_DEFINITIONS.get(definitionId);
  if (!item || item.availability === 'requires-device' || item.availability === 'requires-plugin') return null;
  const parameters: Record<string, string | number | boolean> = {};
  if (item.availability === 'requires-setup') {
    parameters.requiresSetup = true;
    if (item.setupInstructions) parameters.setupInstructions = item.setupInstructions;
  }
  if (item.category === 'app' && item.bubbleType === 'fill') {
    parameters.appAdjustment = true;
  }
  for (const field of item.editorFields) {
    if (field.key === 'step') parameters[field.key] = 5;
    if (field.key === 'clickAction') parameters[field.key] = 'volume-mute';
    if (field.key === 'focusIfRunning' || field.key === 'hidden') parameters[field.key] = true;
    if (field.key === 'runAsAdmin') parameters[field.key] = false;
    if (field.key === 'captureMode') parameters[field.key] = item.id;
  }
  const defaultAiProvider = item.id === 'ai-launcher' ? AI_PROVIDERS[0] : null;
  if (defaultAiProvider) parameters.aiProvider = defaultAiProvider.id;
  return {
    id: crypto.randomUUID(),
    definitionId: item.id,
    label: defaultAiProvider?.label ?? item.label,
    iconName: item.iconName,
    actionType: item.actionType,
    iconDataUrl: defaultAiProvider ? AI_BRAND_ICONS.chatgpt : undefined,
    payload: defaultAiProvider?.url ?? item.defaultPayload,
    type: item.bubbleType,
    scrollUpAction: item.scrollUpAction,
    scrollDownAction: item.scrollDownAction,
    children: item.bubbleType === 'menu' ? [] : undefined,
    parameters,
  };
}

export function validateAssignment(assignment: ActionAssignment): string | null {
  const definitionItem = ACTION_DEFINITIONS.get(assignment.definitionId);
  if (!definitionItem) return 'The selected action is no longer available.';
  if (
    definitionItem.availability === 'requires-device'
    || definitionItem.availability === 'requires-plugin'
  ) {
    return definitionItem.unavailableReason ?? 'This action is unavailable.';
  }
  if (assignment.children && assignment.children.length > MAX_FOLDER_CHILDREN) {
    return 'A submenu can contain at most five actions.';
  }
  if (assignment.type === 'menu') {
    const childIds = new Set<string>();
    for (const child of assignment.children ?? []) {
      if (childIds.has(child.id)) return 'A submenu cannot contain duplicate child actions.';
      childIds.add(child.id);
      if (child.type === 'menu') return 'Nested submenus are not available in this version.';
      if (!child.label.trim()) return 'Every child action needs a label.';
      const childError = validateAssignment(bubbleToAssignment(child));
      if (childError) return `${child.label || 'Child action'}: ${childError}`;
    }
  }

  for (const field of definitionItem.editorFields) {
    if (!field.required) continue;
    const value = field.key === 'payload'
      ? assignment.payload
      : field.key === 'scrollUpAction'
        ? assignment.scrollUpAction
        : field.key === 'scrollDownAction'
          ? assignment.scrollDownAction
          : assignment.parameters?.[field.key];
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
      return 'Complete the required action setting before saving.';
    }
    // Every 'shortcut' field carries a single key chord (click shortcut, wheel-up
    // and wheel-down bindings). Reject unknown tokens, modifier-only entries, and
    // duplicate/multiple main keys before they can be saved — otherwise the chord
    // "succeeds" at runtime while sending only a bare modifier. Macro and
    // keyboard-sequence payloads use a 'textarea' field and are handled below.
    if (field.type === 'shortcut' && typeof value === 'string' && value.trim()) {
      const shortcutError = validateShortcut(value);
      if (shortcutError) return `${field.label}: ${shortcutError}`;
    }
  }

  if (assignment.actionType === 'keyboard-sequence' && assignment.payload) {
    for (const step of assignment.payload.split(/[;\n]/).map((value) => value.trim()).filter(Boolean)) {
      if (/^(?:delay:)?\d+ms$/i.test(step)) continue;
      const stepError = validateShortcut(step);
      if (stepError) return `Step "${step}": ${stepError}`;
    }
  }

  if (assignment.actionType === 'url-open' && assignment.payload) {
    try {
      const parsed = new URL(assignment.payload.includes('://') ? assignment.payload : `https://${assignment.payload}`);
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return 'Only http, https, and mailto URLs are allowed.';
    } catch {
      return 'Enter a valid URL.';
    }
  }
  return null;
}
