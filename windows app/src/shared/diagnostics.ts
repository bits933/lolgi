import type { ActionResult, ActionType } from './types';
import type { RuntimeBuildIdentity } from './buildInfo';

/**
 * A process/window endpoint involved in contextual resolution or input
 * dispatch. Window/document titles are deliberately not represented here.
 */
export interface DiagnosticTarget {
  hwnd?: string;
  pid?: number;
  processName?: string;
  executablePath?: string;
}

export interface DiagnosticInputSummary {
  transport?: 'send-input' | 'powershell' | 'shell' | 'other';
  requestedEventCount?: number;
  sentEventCount?: number;
  failureCode?: string;
}

export interface DiagnosticWindowState {
  exists: boolean;
  visible: boolean;
  focused: boolean;
  focusable: boolean;
}

export interface RingWindowDiagnosticState {
  overlay: DiagnosticWindowState;
  dashboard: DiagnosticWindowState;
}

interface DiagnosticEventBase {
  eventId: string;
  timestamp: string;
  correlationId?: string;
  phase: string;
  build?: RuntimeBuildIdentity;
  target?: DiagnosticTarget;
  actual?: DiagnosticTarget;
}

export interface RingDiagnosticEvent extends DiagnosticEventBase {
  kind: 'ring';
  foreground?: DiagnosticTarget;
  lastExternalForeground?: DiagnosticTarget;
  profileId?: string;
  profileName?: string;
  fallbackReason?: string;
  cacheAgeMs?: number;
  cacheGeneration?: number;
  queryStartedAt?: string;
  queryCompletedAt?: string;
  queryLatencyMs?: number;
  windowState?: RingWindowDiagnosticState;
}

export interface ActionDiagnosticEvent extends DiagnosticEventBase {
  kind: 'action';
  actionType: ActionType;
  definitionId?: string;
  bubbleId?: string;
  result: ActionResult;
  durationMs: number;
  input?: DiagnosticInputSummary;
}

export type DiagnosticEvent = RingDiagnosticEvent | ActionDiagnosticEvent;

export interface RingDiagnosticInput {
  correlationId?: string;
  phase: string;
  foreground?: DiagnosticTarget;
  lastExternalForeground?: DiagnosticTarget;
  profileId?: string;
  profileName?: string;
  fallbackReason?: string;
  cacheAgeMs?: number;
  cacheGeneration?: number;
  queryStartedAt?: string;
  queryCompletedAt?: string;
  queryLatencyMs?: number;
  target?: DiagnosticTarget;
  actual?: DiagnosticTarget;
  windowState?: RingWindowDiagnosticState;
  build?: RuntimeBuildIdentity;
}

export interface ActionDiagnosticContext {
  correlationId?: string;
  phase?: string;
  definitionId?: string;
  bubbleId?: string;
  target?: DiagnosticTarget;
  actual?: DiagnosticTarget;
  input?: DiagnosticInputSummary;
  build?: RuntimeBuildIdentity;
}

export interface DiagnosticCopyResult {
  copied: boolean;
  eventCount: number;
  correlationId?: string;
  message: string;
}
