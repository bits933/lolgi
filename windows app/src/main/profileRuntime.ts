import { randomUUID } from 'crypto';
import type { AppConfig, ForegroundAppInfo, ForegroundWindowTarget, RingProfile } from '../shared/types';
import { normalizeProcessName, resolveProfile } from '../shared/profileUtils';

interface ManualOverrideState {
  profileId: string;
  foregroundProcessName: string | null;
}

let manualOverride: ManualOverrideState | null = null;
let ringForegroundApp: ForegroundAppInfo | null = null;
let activeRingSession: { id: string; target: ForegroundWindowTarget | null } | null = null;

export function getRingForegroundApp(): ForegroundAppInfo | null {
  return ringForegroundApp;
}

export function beginRingSession(
  target: ForegroundWindowTarget | null
): { id: string; target: ForegroundWindowTarget | null } {
  const targetSnapshot = target ? Object.freeze({ ...target }) : null;
  const id = randomUUID();
  activeRingSession = { id, target: targetSnapshot };
  ringForegroundApp = targetSnapshot;
  return { id, target: targetSnapshot ? { ...targetSnapshot } : null };
}

export function isRingSessionCurrent(sessionId: string | null | undefined): boolean {
  return Boolean(sessionId && activeRingSession?.id === sessionId);
}

/**
 * Resolve a target only when the caller presents the currently active session.
 * A delayed action from an older ring therefore fails closed.
 */
export function getRingSessionTarget(
  sessionId: string | null | undefined
): ForegroundWindowTarget | null {
  if (!isRingSessionCurrent(sessionId) || !activeRingSession?.target) return null;
  return { ...activeRingSession.target };
}

/** End only the matching session, so a delayed close cannot invalidate a new ring. */
export function endRingSession(sessionId: string | null | undefined): void {
  if (!isRingSessionCurrent(sessionId)) return;
  activeRingSession = null;
  ringForegroundApp = null;
}

export function endActiveRingSession(): void {
  activeRingSession = null;
  ringForegroundApp = null;
}

export function setManualProfileOverride(profileId: string, foregroundApp: ForegroundAppInfo | null): void {
  manualOverride = {
    profileId,
    foregroundProcessName: foregroundApp
      ? normalizeProcessName(foregroundApp.processName)
      : null,
  };
}

export function clearManualProfileOverride(): void {
  manualOverride = null;
}

export function getManualProfileOverrideId(foregroundApp: ForegroundAppInfo | null): string | null {
  if (!manualOverride) return null;
  const processName = foregroundApp
    ? normalizeProcessName(foregroundApp.processName)
    : null;
  if (manualOverride.foregroundProcessName !== processName) {
    manualOverride = null;
    return null;
  }
  return manualOverride.profileId;
}

export function resolveRuntimeProfile(config: AppConfig, foregroundApp: ForegroundAppInfo | null): RingProfile | null {
  return resolveProfile({
    profiles: config.profiles,
    generalProfileId: config.generalProfileId,
    selectedGlobalProfileId: config.selectedGlobalProfileId,
    foregroundApp,
    manualOverrideProfileId: getManualProfileOverrideId(foregroundApp),
  });
}
