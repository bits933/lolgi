import { contextBridge, ipcRenderer } from 'electron';
import {
  RING_OPEN,
  RING_CLOSE,
  CONFIG_UPDATED,
  SYSTEM_STATE_UPDATED,
  ACTION_EXECUTE,
  OVERLAY_CLOSE,
  OVERLAY_ANIMATION_COMPLETE,
  SYSTEM_GET_STATE,
} from '../shared/ipcChannels';
import type {
  RingOpenPayload,
  ActionExecutePayload,
  ActionResult,
  SystemState,
  BubbleConfig,
} from '../shared/types';

// ---------------------------------------------------------------------------
// Overlay Electron API
// Exposed to the renderer via window.electronAPI
// ---------------------------------------------------------------------------

let activeRingSessionId: string | null = null;
let closingRingSessionId: string | null = null;
let closingActiveRingSessionId: string | null = null;

function captureClosingRing(closeId: string | null | undefined): void {
  // Do not let a newer close relabel a still-pending animation callback. If the
  // older animation was cancelled by a reopen, the newer close's main-process
  // safety timer remains responsible for hiding the window.
  if (closingRingSessionId !== null) return;
  closingActiveRingSessionId = activeRingSessionId;
  closingRingSessionId = closeId ?? activeRingSessionId;
}

contextBridge.exposeInMainWorld('electronAPI', {
  // --- Events from main → renderer ---

  /** Subscribe to ring:open event */
  onRingOpen: (callback: (payload: RingOpenPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: RingOpenPayload) => {
      activeRingSessionId = payload.ringSessionId;
      callback(payload);
    };
    ipcRenderer.on(RING_OPEN, handler);
    return () => ipcRenderer.removeListener(RING_OPEN, handler);
  },

  /** Subscribe to ring:close event */
  onRingClose: (callback: () => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      closeId?: string
    ) => {
      captureClosingRing(closeId);
      callback();
    };
    ipcRenderer.on(RING_CLOSE, handler);
    return () => ipcRenderer.removeListener(RING_CLOSE, handler);
  },

  /** Subscribe to config:updated event */
  onConfigUpdated: (callback: (bubbles: BubbleConfig[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, bubbles: BubbleConfig[]) =>
      callback(bubbles);
    ipcRenderer.on(CONFIG_UPDATED, handler);
    return () => ipcRenderer.removeListener(CONFIG_UPDATED, handler);
  },

  /** Subscribe to refreshed volume, brightness, mute, and media state. */
  onSystemStateUpdated: (callback: (state: SystemState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: SystemState) => callback(state);
    ipcRenderer.on(SYSTEM_STATE_UPDATED, handler);
    return () => ipcRenderer.removeListener(SYSTEM_STATE_UPDATED, handler);
  },

  // --- Calls from renderer → main ---

  /** Execute a bubble action */
  executeAction: (payload: ActionExecutePayload): Promise<ActionResult> =>
    ipcRenderer.invoke(ACTION_EXECUTE, {
      ...payload,
      ringSessionId: activeRingSessionId ?? undefined,
    }),

  /** Tell main the overlay should close */
  closeOverlay: (): void => {
    const closeSessionId = activeRingSessionId;
    captureClosingRing(closeSessionId);
    ipcRenderer.send(OVERLAY_CLOSE, closeSessionId);
  },

  /** Tell main exit animation is complete; safe to hide window */
  notifyAnimationComplete: (): void => {
    const completedSessionId = closingRingSessionId;
    ipcRenderer.send(OVERLAY_ANIMATION_COMPLETE, completedSessionId);
    if (activeRingSessionId === closingActiveRingSessionId) {
      activeRingSessionId = null;
    }
    closingRingSessionId = null;
    closingActiveRingSessionId = null;
  },

  /** Request current system state */
  getSystemState: (): Promise<SystemState> =>
    ipcRenderer.invoke(SYSTEM_GET_STATE),

});
