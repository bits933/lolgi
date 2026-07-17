import { v4 as uuidv4 } from 'uuid';
import type { BubbleConfig } from './types';

/**
 * Default 8 bubbles matching the web app's ACTIONS array.
 * Icons are Lucide icon names (strings) — the renderer imports them dynamically.
 * Positions map clockwise from 12 o'clock: index 0 = top, index 7 = top-left.
 */
export const DEFAULT_BUBBLES: BubbleConfig[] = [
  {
    id: uuidv4(),
    label: 'Volume Up',
    iconName: 'Volume2',
    angleIndex: 0,
    actionType: 'volume-up',
    type: 'fill',
    scrollUpAction: 'volume-up',
    scrollDownAction: 'volume-down',
  },
  {
    id: uuidv4(),
    label: 'Volume Down',
    iconName: 'VolumeX',
    angleIndex: 1,
    actionType: 'volume-down',
    type: 'default',
  },
  {
    id: uuidv4(),
    label: 'Screenshot',
    iconName: 'Camera',
    angleIndex: 2,
    actionType: 'screenshot',
    type: 'default',
  },
  {
    id: uuidv4(),
    label: 'Mute',
    iconName: 'Mic',
    iconNameAlt: 'MicOff',
    angleIndex: 3,
    actionType: 'volume-mute',
    type: 'toggle',
  },
  {
    id: uuidv4(),
    label: 'Prev Track',
    iconName: 'SkipBack',
    angleIndex: 4,
    actionType: 'media-prev',
    type: 'default',
  },
  {
    id: uuidv4(),
    label: 'Brightness',
    iconName: 'Sun',
    angleIndex: 5,
    actionType: 'brightness-up',
    type: 'fill',
    scrollUpAction: 'brightness-up',
    scrollDownAction: 'brightness-down',
  },
  {
    id: uuidv4(),
    label: 'Play/Pause',
    iconName: 'Play',
    iconNameAlt: 'Pause',
    angleIndex: 6,
    actionType: 'media-play-pause',
    type: 'toggle',
  },
  {
    id: uuidv4(),
    label: 'Next Track',
    iconName: 'SkipForward',
    angleIndex: 7,
    actionType: 'media-next',
    type: 'default',
  },
];
