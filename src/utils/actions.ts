import { Clock, Clipboard, Camera, Mic, Settings, RotateCw, Plus, X } from 'lucide-react';
import type { ActionItem } from '../types/index';

// Injected by App.tsx to avoid a circular import through the store
let _onExecute: ((label: string) => void) | null = null;

export function setExecuteCallback(cb: (label: string) => void): void {
  _onExecute = cb;
}

function makeExecute(label: string): () => void {
  return () => _onExecute?.(label);
}

export const ACTIONS: ActionItem[] = [
  { id: 'copy',       label: 'Copy',       icon: Clock,     angleIndex: 0, execute: makeExecute('Copy') },
  { id: 'paste',      label: 'Paste',      icon: Clipboard, angleIndex: 1, execute: makeExecute('Paste') },
  { id: 'screenshot', label: 'Screenshot', icon: Camera,    angleIndex: 2, execute: makeExecute('Screenshot') },
  { id: 'mute',       label: 'Mute',       icon: Mic,       angleIndex: 3, execute: makeExecute('Mute') },
  { id: 'settings',   label: 'Settings',   icon: Settings,  angleIndex: 4, execute: makeExecute('Settings') },
  { id: 'refresh',    label: 'Refresh',    icon: RotateCw,  angleIndex: 5, execute: makeExecute('Refresh') },
  { id: 'new-tab',    label: 'New Tab',    icon: Plus,      angleIndex: 6, execute: makeExecute('New Tab') },
  { id: 'close',      label: 'Close',      icon: X,         angleIndex: 7, execute: makeExecute('Close') },
];
