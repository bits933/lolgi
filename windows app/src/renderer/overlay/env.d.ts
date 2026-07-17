import type {
  RingOpenPayload,
  ActionExecutePayload,
  ActionResult,
  SystemState,
  BubbleConfig,
} from '../../shared/types';

// CSS Modules
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}

// The Overlay window's contextBridge API
export interface OverlayElectronAPI {
  onRingOpen: (callback: (payload: RingOpenPayload) => void) => () => void;
  onRingClose: (callback: () => void) => () => void;
  onConfigUpdated: (callback: (bubbles: BubbleConfig[]) => void) => () => void;
  onSystemStateUpdated: (callback: (state: SystemState) => void) => () => void;
  executeAction: (payload: ActionExecutePayload) => Promise<ActionResult>;
  closeOverlay: () => void;
  notifyAnimationComplete: () => void;
  getSystemState: () => Promise<SystemState>;
  getBubbles: () => Promise<BubbleConfig[]>;
}

declare global {
  interface Window {
    // Use unknown so overlay code can cast to OverlayElectronAPI safely
    // and dashboard code can cast to DashboardElectronAPI without conflict
    electronAPI: OverlayElectronAPI;
  }
}

export {};
