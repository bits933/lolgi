import type { ActionResult, ActionType } from '../../shared/types';

export interface ActionDiagnosticEvent {
  timestamp: string;
  actionType: ActionType;
  result: ActionResult;
  durationMs: number;
}

const MAX_EVENTS = 100;
const events: ActionDiagnosticEvent[] = [];

export function recordActionResult(actionType: ActionType, result: ActionResult, durationMs: number): void {
  events.unshift({ timestamp: new Date().toISOString(), actionType, result, durationMs });
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  if (!result.success) {
    console.warn(`[actions] ${actionType}: ${result.status} - ${result.message ?? result.error ?? 'Unknown error'}`);
  }
}

export function getRecentActionResults(): ActionDiagnosticEvent[] {
  return [...events];
}
