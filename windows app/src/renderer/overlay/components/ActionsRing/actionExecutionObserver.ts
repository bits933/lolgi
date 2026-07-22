import type { ActionResult } from '../../../../shared/types';

/**
 * The point at which the renderer stops treating an action as a normal,
 * synchronous interaction. Reaching this threshold is a pending state, never
 * evidence that the action succeeded.
 */
export const ACTION_PENDING_THRESHOLD_MS = 5000;

export const ACTION_PENDING_MESSAGE =
  'This action is taking longer than expected. The ring will stay open until Lolgi receives a confirmed result.';

export type ActionSettlementTiming = 'prompt' | 'late';
export type ActionReleaseReason = 'settled' | 'timeout';

export type ActionTerminalOutcome =
  | { kind: 'result'; result: ActionResult }
  | { kind: 'rejection'; error: unknown };

export interface ActionExecutionCallbacks {
  /** Called once when the action crosses the pending threshold. */
  onPending: () => void;
  /** Called only after an explicit successful ActionResult is received. */
  onSuccess: (result: ActionResult, timing: ActionSettlementTiming) => void;
  /** Called for explicit failures and transport/runtime rejections. */
  onFailure: (
    message: string,
    outcome: ActionTerminalOutcome,
    timing: ActionSettlementTiming
  ) => void;
  /**
   * Releases the renderer's selection lock. A timeout releases it immediately
   * so an IPC call that never settles cannot permanently freeze the ring.
   */
  onRelease: (reason: ActionReleaseReason) => void;
  /** Optional last-resort reporting for an exception thrown by a callback. */
  onObserverError?: (error: unknown) => void;
}

export interface ActionExecutionController {
  /**
   * Resolves after the underlying action reaches a terminal outcome. It never
   * rejects, which lets callers observe it without creating an unhandled
   * rejection. A truly never-settling IPC call may keep this promise pending,
   * but cannot keep the ring's selection lock.
   */
  completion: Promise<void>;
  /**
   * Stops UI callbacks for an obsolete attempt. The underlying IPC invocation
   * cannot be cancelled, so its terminal result remains safely consumed.
   */
  cancel: () => void;
}

function rejectionMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return `The action service did not respond: ${error.message}`;
  }
  return 'The action service did not respond.';
}

/**
 * Formats the main-process failure without dropping its short diagnostic
 * reference when an older/custom main process returns the ID separately.
 */
export function getActionFailureMessage(outcome: ActionTerminalOutcome): string {
  if (outcome.kind === 'rejection') return rejectionMessage(outcome.error);

  const { result } = outcome;
  const base =
    result.message ??
    result.error ??
    'This action could not be completed.';
  if (!result.diagnosticId || base.includes(result.diagnosticId)) return base;
  return `${base} Diagnostic ${result.diagnosticId}.`;
}

/**
 * Observes an action through its real terminal result.
 *
 * The timeout only changes the UI into a pending state and releases its
 * interaction lock. It deliberately does not manufacture a success result.
 * If the action settles later, that late success or failure is still reported.
 */
export function observeActionExecution(
  execute: () => Promise<ActionResult>,
  callbacks: ActionExecutionCallbacks,
  timeoutMs = ACTION_PENDING_THRESHOLD_MS
): ActionExecutionController {
  let cancelled = false;
  let timedOut = false;
  let released = false;

  const reportObserverError = (error: unknown): void => {
    if (!callbacks.onObserverError) return;
    try {
      callbacks.onObserverError(error);
    } catch {
      // Error reporting itself must never create a second uncaught exception.
    }
  };

  const invoke = (callback: () => void): void => {
    try {
      callback();
    } catch (error) {
      reportObserverError(error);
    }
  };

  const release = (reason: ActionReleaseReason): void => {
    if (released) return;
    released = true;
    invoke(() => callbacks.onRelease(reason));
  };

  // Starting from a resolved promise also captures a synchronous exception
  // thrown while obtaining the IPC promise.
  const terminalOutcome: Promise<ActionTerminalOutcome> = Promise.resolve()
    .then(execute)
    .then(
      (result): ActionTerminalOutcome => ({ kind: 'result', result }),
      (error): ActionTerminalOutcome => ({ kind: 'rejection', error })
    );

  const timeoutId = setTimeout(() => {
    if (cancelled) return;
    timedOut = true;
    invoke(callbacks.onPending);
    release('timeout');
  }, Math.max(0, timeoutMs));

  const completion = terminalOutcome.then((outcome) => {
    clearTimeout(timeoutId);
    if (cancelled) return;

    const timing: ActionSettlementTiming = timedOut ? 'late' : 'prompt';
    if (!timedOut) release('settled');

    if (outcome.kind === 'result' && outcome.result.success) {
      invoke(() => callbacks.onSuccess(outcome.result, timing));
      return;
    }

    invoke(() => callbacks.onFailure(getActionFailureMessage(outcome), outcome, timing));
  });

  // `terminalOutcome` already normalizes execution rejection. This final guard
  // makes the public completion promise non-rejecting even if a future edit
  // introduces an unexpected observer exception.
  const safeCompletion = completion.then(
    () => undefined,
    (error) => {
      reportObserverError(error);
    }
  );

  return {
    completion: safeCompletion,
    cancel(): void {
      cancelled = true;
      clearTimeout(timeoutId);
    },
  };
}
