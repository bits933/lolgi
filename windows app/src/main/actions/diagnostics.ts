import { clipboard } from 'electron';
import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { ActionResult, ActionType } from '../../shared/types';
import type { RuntimeBuildIdentity } from '../../shared/buildInfo';
import type {
  ActionDiagnosticContext,
  ActionDiagnosticEvent,
  DiagnosticCopyResult,
  DiagnosticEvent,
  DiagnosticInputSummary,
  DiagnosticTarget,
  DiagnosticWindowState,
  RingDiagnosticEvent,
  RingDiagnosticInput,
  RingWindowDiagnosticState,
} from '../../shared/diagnostics';

export type {
  ActionDiagnosticContext,
  ActionDiagnosticEvent,
  DiagnosticCopyResult,
  DiagnosticEvent,
  RingDiagnosticEvent,
  RingDiagnosticInput,
} from '../../shared/diagnostics';

const MAX_EVENTS = 100;
const MAX_TEXT_LENGTH = 500;
const SNAPSHOT_SCHEMA_VERSION = 1;
const ACTION_STATUSES = new Set<ActionResult['status']>([
  'success',
  'accepted',
  'unsupported',
  'validation_error',
  'permission_blocked',
  'target_unavailable',
  'execution_error',
]);

const events: DiagnosticEvent[] = [];
let defaultBuildIdentity: RuntimeBuildIdentity | undefined;
let snapshotPath: string | null = null;
let persistScheduled = false;
let persistenceQueue: Promise<void> = Promise.resolve();

function safeText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function safeIsoTimestamp(value: unknown): string | undefined {
  const text = safeText(value, 64);
  if (!text) return undefined;
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp).toISOString() === text ? text : undefined;
}

function sanitizeTarget(value: unknown): DiagnosticTarget | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<DiagnosticTarget>;
  const target: DiagnosticTarget = {};
  const hwnd = safeText(candidate.hwnd, 64);
  const pid = finiteNumber(candidate.pid);
  const processName = safeText(candidate.processName, 160);
  const executablePath = safeText(candidate.executablePath, 520);
  if (hwnd) target.hwnd = hwnd;
  if (pid !== undefined && pid >= 0) target.pid = Math.trunc(pid);
  if (processName) target.processName = processName;
  if (executablePath) target.executablePath = executablePath;
  return Object.keys(target).length > 0 ? target : undefined;
}

function sanitizeInput(value: unknown): DiagnosticInputSummary | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<DiagnosticInputSummary>;
  const input: DiagnosticInputSummary = {};
  if (candidate.transport && ['send-input', 'powershell', 'shell', 'other'].includes(candidate.transport)) {
    input.transport = candidate.transport;
  }
  const requested = finiteNumber(candidate.requestedEventCount);
  const sent = finiteNumber(candidate.sentEventCount);
  const failureCode = safeText(candidate.failureCode, 100);
  if (requested !== undefined && requested >= 0) input.requestedEventCount = Math.trunc(requested);
  if (sent !== undefined && sent >= 0) input.sentEventCount = Math.trunc(sent);
  if (failureCode) input.failureCode = failureCode;
  return Object.keys(input).length > 0 ? input : undefined;
}

function sanitizeWindowStateEntry(value: unknown): DiagnosticWindowState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<DiagnosticWindowState>;
  if (
    typeof candidate.exists !== 'boolean'
    || typeof candidate.visible !== 'boolean'
    || typeof candidate.focused !== 'boolean'
    || typeof candidate.focusable !== 'boolean'
  ) {
    return undefined;
  }
  return {
    exists: candidate.exists,
    visible: candidate.visible,
    focused: candidate.focused,
    focusable: candidate.focusable,
  };
}

function sanitizeRingWindowState(value: unknown): RingWindowDiagnosticState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<RingWindowDiagnosticState>;
  const overlay = sanitizeWindowStateEntry(candidate.overlay);
  const dashboard = sanitizeWindowStateEntry(candidate.dashboard);
  return overlay && dashboard ? { overlay, dashboard } : undefined;
}

function sanitizeBuild(value: unknown): RuntimeBuildIdentity | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<RuntimeBuildIdentity>;
  const version = safeText(candidate.version, 64);
  const gitCommit = safeText(candidate.gitCommit, 64);
  const builtAtUtc = safeText(candidate.builtAtUtc, 64);
  const sourceFingerprint = safeText(candidate.sourceFingerprint, 64);
  const execPath = safeText(candidate.execPath, 520);
  if (
    !version
    || !gitCommit
    || typeof candidate.dirty !== 'boolean'
    || !builtAtUtc
    || !sourceFingerprint
    || !/^[a-f0-9]{64}$/i.test(sourceFingerprint)
    || !execPath
    || (candidate.mode !== 'development' && candidate.mode !== 'packaged')
    || typeof candidate.isPackaged !== 'boolean'
  ) return undefined;
  return {
    version,
    gitCommit,
    dirty: candidate.dirty,
    builtAtUtc,
    sourceFingerprint: sourceFingerprint.toLowerCase(),
    mode: candidate.mode,
    isPackaged: candidate.isPackaged,
    execPath,
  };
}

function sanitizeActionResult(value: unknown): ActionResult | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ActionResult>;
  if (!candidate.status || !ACTION_STATUSES.has(candidate.status) || typeof candidate.success !== 'boolean') return null;
  const result: ActionResult = {
    status: candidate.status,
    success: candidate.success,
  };
  const message = safeText(candidate.message);
  const error = safeText(candidate.error);
  const diagnosticId = safeText(candidate.diagnosticId, 128);
  if (message) result.message = message;
  if (error) result.error = error;
  if (diagnosticId) result.diagnosticId = diagnosticId;
  if (candidate.newState && typeof candidate.newState === 'object') {
    result.newState = { ...candidate.newState };
  }
  return result;
}

function cloneEvent<T extends DiagnosticEvent>(event: T): T {
  return JSON.parse(JSON.stringify(event)) as T;
}

function trimEvents(): void {
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
}

function createBase(
  kind: DiagnosticEvent['kind'],
  phase: string,
  correlationId?: string,
  build?: RuntimeBuildIdentity,
): Pick<DiagnosticEvent, 'eventId' | 'timestamp' | 'kind' | 'phase' | 'correlationId' | 'build'> {
  return {
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    kind,
    phase: safeText(phase, 80) ?? 'unknown',
    ...(safeText(correlationId, 128) ? { correlationId: safeText(correlationId, 128) } : {}),
    ...(sanitizeBuild(build ?? defaultBuildIdentity) ? { build: sanitizeBuild(build ?? defaultBuildIdentity) } : {}),
  };
}

function parsePersistedEvent(value: unknown): DiagnosticEvent | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<DiagnosticEvent>;
  const eventId = safeText(candidate.eventId, 128);
  const timestamp = safeText(candidate.timestamp, 64);
  const phase = safeText(candidate.phase, 80);
  if (!eventId || !timestamp || !phase || (candidate.kind !== 'ring' && candidate.kind !== 'action')) return null;

  const common = {
    eventId,
    timestamp,
    correlationId: safeText(candidate.correlationId, 128),
    phase,
    build: sanitizeBuild(candidate.build),
    target: sanitizeTarget(candidate.target),
    actual: sanitizeTarget(candidate.actual),
  };

  if (candidate.kind === 'action') {
    const action = candidate as Partial<ActionDiagnosticEvent>;
    const result = sanitizeActionResult(action.result);
    const durationMs = finiteNumber(action.durationMs);
    if (!safeText(action.actionType, 100) || !result || durationMs === undefined) return null;
    return {
      ...common,
      kind: 'action',
      actionType: action.actionType as ActionType,
      definitionId: safeText(action.definitionId, 160),
      bubbleId: safeText(action.bubbleId, 160),
      result,
      durationMs: Math.max(0, durationMs),
      input: sanitizeInput(action.input),
    };
  }

  const ring = candidate as Partial<RingDiagnosticEvent>;
  return {
    ...common,
    kind: 'ring',
    foreground: sanitizeTarget(ring.foreground),
    lastExternalForeground: sanitizeTarget(ring.lastExternalForeground),
    profileId: safeText(ring.profileId, 160),
    profileName: safeText(ring.profileName, 160),
    fallbackReason: safeText(ring.fallbackReason, 240),
    cacheAgeMs: finiteNumber(ring.cacheAgeMs),
    cacheGeneration: finiteNumber(ring.cacheGeneration),
    queryStartedAt: safeIsoTimestamp(ring.queryStartedAt),
    queryCompletedAt: safeIsoTimestamp(ring.queryCompletedAt),
    queryLatencyMs: finiteNumber(ring.queryLatencyMs),
    windowState: sanitizeRingWindowState(ring.windowState),
  };
}

function serializeSnapshot(): string {
  return `${JSON.stringify({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    events,
  }, null, 2)}\n`;
}

function schedulePersist(): void {
  if (!snapshotPath || persistScheduled) return;
  persistScheduled = true;
  queueMicrotask(() => {
    persistScheduled = false;
    if (!snapshotPath) return;
    const path = snapshotPath;
    const snapshot = serializeSnapshot();
    persistenceQueue = persistenceQueue
      .then(async () => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, snapshot, { encoding: 'utf8', mode: 0o600 });
      })
      .catch((error) => {
        console.warn('[diagnostics] Could not persist the bounded diagnostic snapshot:', error);
      });
  });
}

function addEvent(event: DiagnosticEvent): void {
  events.unshift(event);
  trimEvents();
  schedulePersist();
}

/**
 * Configure bounded persistence after Electron is ready. Existing events are
 * loaded once, sanitized, and merged behind any events recorded this process.
 */
export async function initializeDiagnostics(
  userDataPath: string,
  buildIdentity?: RuntimeBuildIdentity,
): Promise<void> {
  defaultBuildIdentity = sanitizeBuild(buildIdentity);
  snapshotPath = join(userDataPath, 'diagnostics', 'recent.json');
  try {
    const parsed = JSON.parse(await readFile(snapshotPath, 'utf8')) as { events?: unknown[] };
    if (Array.isArray(parsed.events)) {
      const knownIds = new Set(events.map((event) => event.eventId));
      for (const rawEvent of parsed.events) {
        const event = parsePersistedEvent(rawEvent);
        if (event && !knownIds.has(event.eventId)) {
          events.push(event);
          knownIds.add(event.eventId);
        }
      }
      trimEvents();
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code !== 'ENOENT') console.warn('[diagnostics] Could not read the previous diagnostic snapshot:', error);
  }
  schedulePersist();
}

export function createDiagnosticCorrelationId(): string {
  return randomUUID();
}

export function recordRingDiagnostic(input: RingDiagnosticInput): RingDiagnosticEvent {
  const event: RingDiagnosticEvent = {
    ...createBase('ring', input.phase, input.correlationId, input.build),
    kind: 'ring',
    foreground: sanitizeTarget(input.foreground),
    lastExternalForeground: sanitizeTarget(input.lastExternalForeground),
    profileId: safeText(input.profileId, 160),
    profileName: safeText(input.profileName, 160),
    fallbackReason: safeText(input.fallbackReason, 240),
    cacheAgeMs: finiteNumber(input.cacheAgeMs),
    cacheGeneration: finiteNumber(input.cacheGeneration),
    queryStartedAt: safeIsoTimestamp(input.queryStartedAt),
    queryCompletedAt: safeIsoTimestamp(input.queryCompletedAt),
    queryLatencyMs: finiteNumber(input.queryLatencyMs),
    windowState: sanitizeRingWindowState(input.windowState),
    target: sanitizeTarget(input.target),
    actual: sanitizeTarget(input.actual),
  };
  addEvent(event);
  return cloneEvent(event);
}

/**
 * Backward compatible with the original three-argument call. Callers can add
 * the optional fourth context argument incrementally.
 */
export function recordActionResult(
  actionType: ActionType,
  result: ActionResult,
  durationMs: number,
  context: ActionDiagnosticContext = {},
): ActionDiagnosticEvent {
  const sanitizedResult = sanitizeActionResult(result) ?? {
    status: 'execution_error',
    success: false,
    message: 'Invalid action result.',
  };
  const event: ActionDiagnosticEvent = {
    ...createBase('action', context.phase ?? 'completed', context.correlationId, context.build),
    kind: 'action',
    actionType,
    definitionId: safeText(context.definitionId, 160),
    bubbleId: safeText(context.bubbleId, 160),
    result: sanitizedResult,
    durationMs: Math.max(0, finiteNumber(durationMs) ?? 0),
    target: sanitizeTarget(context.target),
    actual: sanitizeTarget(context.actual),
    input: sanitizeInput(context.input),
  };
  addEvent(event);
  if (!sanitizedResult.success) {
    console.warn(
      `[actions] ${actionType}: ${sanitizedResult.status} - ${sanitizedResult.message ?? sanitizedResult.error ?? 'Unknown error'}`,
    );
  }
  return cloneEvent(event);
}

/** Original IPC-compatible action-only view. */
export function getRecentActionResults(): ActionDiagnosticEvent[] {
  return events
    .filter((event): event is ActionDiagnosticEvent => event.kind === 'action')
    .map(cloneEvent);
}

export function getRecentDiagnosticEvents(): DiagnosticEvent[] {
  return events.map(cloneEvent);
}

export function getLastCorrelatedDiagnosticText(): string | null {
  const latestCorrelated = events.find((event) => event.correlationId);
  const selected = latestCorrelated?.correlationId
    ? events.filter((event) => event.correlationId === latestCorrelated.correlationId)
    : events.slice(0, 1);
  if (selected.length === 0) return null;
  return JSON.stringify({
    correlationId: latestCorrelated?.correlationId ?? null,
    eventCount: selected.length,
    build: selected[0]?.build ?? defaultBuildIdentity ?? null,
    events: [...selected].reverse(),
  }, null, 2);
}

/** Handler-ready function for the dashboard's Copy last diagnostic button. */
export function copyLastCorrelatedDiagnostic(): DiagnosticCopyResult {
  const text = getLastCorrelatedDiagnosticText();
  if (!text) {
    return {
      copied: false,
      eventCount: 0,
      message: 'No diagnostics have been recorded yet.',
    };
  }
  try {
    clipboard.writeText(text);
    const parsed = JSON.parse(text) as { correlationId?: string | null; eventCount?: number };
    return {
      copied: true,
      eventCount: parsed.eventCount ?? 1,
      ...(parsed.correlationId ? { correlationId: parsed.correlationId } : {}),
      message: 'Last diagnostic copied.',
    };
  } catch (error) {
    return {
      copied: false,
      eventCount: 0,
      message: error instanceof Error ? error.message : 'Could not copy diagnostics.',
    };
  }
}

export async function flushDiagnostics(): Promise<void> {
  if (persistScheduled) {
    await new Promise<void>((resolve) => queueMicrotask(resolve));
  }
  await persistenceQueue;
}
