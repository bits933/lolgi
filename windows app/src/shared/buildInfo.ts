/**
 * Immutable source/build metadata generated once at the beginning of a build.
 * Runtime-only fields are added by the Electron main process.
 */
export interface BuildInfo {
  version: string;
  gitCommit: string;
  dirty: boolean;
  builtAtUtc: string;
  sourceFingerprint: string;
}

export type RuntimeMode = 'development' | 'packaged';

export interface RuntimeBuildIdentity extends BuildInfo {
  mode: RuntimeMode;
  isPackaged: boolean;
  execPath: string;
}

export function isBuildInfo(value: unknown): value is BuildInfo {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BuildInfo>;
  return (
    typeof candidate.version === 'string'
    && candidate.version.trim().length > 0
    && typeof candidate.gitCommit === 'string'
    && candidate.gitCommit.trim().length > 0
    && typeof candidate.dirty === 'boolean'
    && typeof candidate.builtAtUtc === 'string'
    && !Number.isNaN(Date.parse(candidate.builtAtUtc))
    && typeof candidate.sourceFingerprint === 'string'
    && /^[a-f0-9]{64}$/i.test(candidate.sourceFingerprint)
  );
}
