import type { AppConfig, ForegroundAppInfo, RingProfile } from '../shared/types';
import { resolveProfile } from '../shared/profileUtils';

interface ManualOverrideState {
  profileId: string;
  foregroundProcessName: string | null;
}

let manualOverride: ManualOverrideState | null = null;
let ringForegroundApp: ForegroundAppInfo | null = null;

export function setRingForegroundApp(foregroundApp: ForegroundAppInfo | null): void {
  ringForegroundApp = foregroundApp;
}

export function getRingForegroundApp(): ForegroundAppInfo | null {
  return ringForegroundApp;
}

export function setManualProfileOverride(profileId: string, foregroundApp: ForegroundAppInfo | null): void {
  manualOverride = {
    profileId,
    foregroundProcessName: foregroundApp?.processName.toLowerCase() ?? null,
  };
}

export function clearManualProfileOverride(): void {
  manualOverride = null;
}

export function getManualProfileOverrideId(foregroundApp: ForegroundAppInfo | null): string | null {
  if (!manualOverride) return null;
  const processName = foregroundApp?.processName.toLowerCase() ?? null;
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
