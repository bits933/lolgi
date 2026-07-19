import { app } from 'electron';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { BuildInfo, RuntimeBuildIdentity } from '../shared/buildInfo';
import { isBuildInfo } from '../shared/buildInfo';

let cachedBuildInfo: Readonly<BuildInfo> | null = null;
let cachedRuntimeIdentity: Readonly<RuntimeBuildIdentity> | null = null;

function fallbackBuildInfo(): BuildInfo {
  return {
    version: app.getVersion(),
    gitCommit: 'unknown',
    dirty: true,
    builtAtUtc: 'unknown',
    sourceFingerprint: 'unknown',
  };
}

function readGeneratedBuildInfo(): BuildInfo {
  try {
    const path = join(app.getAppPath(), 'dist', 'build-info.json');
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (isBuildInfo(parsed)) return parsed;
    console.warn(`[build] Ignoring invalid build identity at ${path}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[build] Generated build identity unavailable: ${message}`);
  }
  return fallbackBuildInfo();
}

export function getBuildInfo(): Readonly<BuildInfo> {
  if (!cachedBuildInfo) cachedBuildInfo = Object.freeze({ ...readGeneratedBuildInfo() });
  return cachedBuildInfo;
}

export function getRuntimeBuildIdentity(): Readonly<RuntimeBuildIdentity> {
  if (!cachedRuntimeIdentity) {
    cachedRuntimeIdentity = Object.freeze({
      ...getBuildInfo(),
      mode: app.isPackaged ? 'packaged' : 'development',
      isPackaged: app.isPackaged,
      execPath: process.execPath,
    });
  }
  return cachedRuntimeIdentity;
}

export function formatRuntimeBuildIdentity(identity = getRuntimeBuildIdentity()): string {
  return [
    `v${identity.version}`,
    `commit=${identity.gitCommit}${identity.dirty ? '+dirty' : ''}`,
    `source=${identity.sourceFingerprint}`,
    `built=${identity.builtAtUtc}`,
    `mode=${identity.mode}`,
    `exec=${identity.execPath}`,
  ].join(' | ');
}
