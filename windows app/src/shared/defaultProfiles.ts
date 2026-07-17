import { v4 as uuidv4 } from 'uuid';
import type { AppProfile } from './types';

/**
 * Built-in profile templates offered during profile creation.
 * These are NOT auto-added to AppConfig.appProfiles — the user picks one
 * as a starting point when creating a new per-app profile.
 */

export const PHOTOSHOP_PROFILE_TEMPLATE: AppProfile = {
  id: 'template-photoshop',
  app: {
    processName: 'Photoshop',
    displayName: 'Adobe Photoshop',
  },
  enabled: true,
  sortOrder: 0,
  bubbles: [
    {
      id: uuidv4(),
      label: 'Brush Size',
      iconName: 'Paintbrush',
      angleIndex: 0,
      actionType: 'keyboard-shortcut',
      type: 'fill',
      scrollUpAction: ']',
      scrollDownAction: '[',
    },
    {
      id: uuidv4(),
      label: 'Undo',
      iconName: 'Undo2',
      angleIndex: 1,
      actionType: 'keyboard-shortcut',
      payload: 'Ctrl+Z',
      type: 'default',
    },
    {
      id: uuidv4(),
      label: 'Redo',
      iconName: 'Redo2',
      angleIndex: 2,
      actionType: 'keyboard-shortcut',
      payload: 'Ctrl+Shift+Z',
      type: 'default',
    },
    {
      id: uuidv4(),
      label: 'Zoom',
      iconName: 'ZoomIn',
      angleIndex: 3,
      actionType: 'keyboard-shortcut',
      payload: 'Ctrl+0',
      type: 'fill',
      scrollUpAction: 'Ctrl+=',
      scrollDownAction: 'Ctrl+-',
    },
    {
      id: uuidv4(),
      label: 'Layers',
      iconName: 'Layers',
      angleIndex: 4,
      actionType: 'keyboard-shortcut',
      payload: 'F7',
      type: 'toggle',
    },
    {
      id: uuidv4(),
      label: 'Brush Tool',
      iconName: 'Pen',
      angleIndex: 5,
      actionType: 'keyboard-shortcut',
      payload: 'B',
      type: 'default',
    },
    {
      id: uuidv4(),
      label: 'Move Tool',
      iconName: 'Move',
      angleIndex: 6,
      actionType: 'keyboard-shortcut',
      payload: 'V',
      type: 'default',
    },
    {
      id: uuidv4(),
      label: 'Save',
      iconName: 'Save',
      angleIndex: 7,
      actionType: 'keyboard-shortcut',
      payload: 'Ctrl+S',
      type: 'default',
    },
  ],
};

/** All available profile templates, keyed by process name */
export const PROFILE_TEMPLATES: Record<string, AppProfile> = {
  Photoshop: PHOTOSHOP_PROFILE_TEMPLATE,
};
