import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult } from '../../../../shared/types';
import {
  ACTION_PENDING_THRESHOLD_MS,
  getActionFailureMessage,
  observeActionExecution,
  type ActionExecutionCallbacks,
} from './actionExecutionObserver';

const successResult: ActionResult = {
  status: 'success',
  success: true,
};

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function callbackSpies(): ActionExecutionCallbacks & {
  onPending: ReturnType<typeof vi.fn>;
  onSuccess: ReturnType<typeof vi.fn>;
  onFailure: ReturnType<typeof vi.fn>;
  onRelease: ReturnType<typeof vi.fn>;
  onObserverError: ReturnType<typeof vi.fn>;
} {
  return {
    onPending: vi.fn(),
    onSuccess: vi.fn(),
    onFailure: vi.fn(),
    onRelease: vi.fn(),
    onObserverError: vi.fn(),
  };
}

describe('action execution observer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('treats a result just before the threshold as a prompt confirmed success', async () => {
    const pending = deferred<ActionResult>();
    const callbacks = callbackSpies();
    const controller = observeActionExecution(() => pending.promise, callbacks);

    await vi.advanceTimersByTimeAsync(ACTION_PENDING_THRESHOLD_MS - 1);
    pending.resolve(successResult);
    await controller.completion;

    expect(callbacks.onPending).not.toHaveBeenCalled();
    expect(callbacks.onRelease).toHaveBeenCalledOnce();
    expect(callbacks.onRelease).toHaveBeenCalledWith('settled');
    expect(callbacks.onSuccess).toHaveBeenCalledWith(successResult, 'prompt');
    expect(callbacks.onFailure).not.toHaveBeenCalled();
  });

  it('keeps a just-after-threshold result pending until real success arrives', async () => {
    const pending = deferred<ActionResult>();
    const callbacks = callbackSpies();
    const controller = observeActionExecution(() => pending.promise, callbacks);

    await vi.advanceTimersByTimeAsync(ACTION_PENDING_THRESHOLD_MS);

    expect(callbacks.onPending).toHaveBeenCalledOnce();
    expect(callbacks.onRelease).toHaveBeenCalledWith('timeout');
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
    expect(callbacks.onFailure).not.toHaveBeenCalled();

    pending.resolve(successResult);
    await controller.completion;

    expect(callbacks.onSuccess).toHaveBeenCalledOnce();
    expect(callbacks.onSuccess).toHaveBeenCalledWith(successResult, 'late');
    expect(callbacks.onRelease).toHaveBeenCalledOnce();
  });

  it('reports a late target failure and preserves its diagnostic ID', async () => {
    const pending = deferred<ActionResult>();
    const callbacks = callbackSpies();
    const controller = observeActionExecution(() => pending.promise, callbacks);
    const failure: ActionResult = {
      status: 'target_unavailable',
      success: false,
      message: 'Figma is no longer available.',
      diagnosticId: 'f19a0b2c',
    };

    await vi.advanceTimersByTimeAsync(ACTION_PENDING_THRESHOLD_MS);
    pending.resolve(failure);
    await controller.completion;

    expect(callbacks.onSuccess).not.toHaveBeenCalled();
    expect(callbacks.onFailure).toHaveBeenCalledOnce();
    expect(callbacks.onFailure).toHaveBeenCalledWith(
      'Figma is no longer available. Diagnostic f19a0b2c.',
      { kind: 'result', result: failure },
      'late'
    );
  });

  it('turns execution rejection into a visible failure without rejecting completion', async () => {
    const callbacks = callbackSpies();
    const controller = observeActionExecution(
      () => Promise.reject(new Error('IPC channel closed')),
      callbacks
    );

    await expect(controller.completion).resolves.toBeUndefined();

    expect(callbacks.onRelease).toHaveBeenCalledWith('settled');
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
    expect(callbacks.onFailure).toHaveBeenCalledWith(
      'The action service did not respond: IPC channel closed',
      expect.objectContaining({ kind: 'rejection' }),
      'prompt'
    );
    expect(callbacks.onObserverError).not.toHaveBeenCalled();
  });

  it('never invents success for an unknown outcome and cancellation suppresses obsolete UI', async () => {
    const pending = deferred<ActionResult>();
    const callbacks = callbackSpies();
    const controller = observeActionExecution(() => pending.promise, callbacks);

    await vi.advanceTimersByTimeAsync(ACTION_PENDING_THRESHOLD_MS * 10);

    expect(callbacks.onPending).toHaveBeenCalledOnce();
    expect(callbacks.onRelease).toHaveBeenCalledOnce();
    expect(callbacks.onSuccess).not.toHaveBeenCalled();

    controller.cancel();
    pending.resolve(successResult);
    await controller.completion;

    expect(callbacks.onSuccess).not.toHaveBeenCalled();
    expect(callbacks.onFailure).not.toHaveBeenCalled();
    expect(getActionFailureMessage({ kind: 'rejection', error: 'closed' }))
      .toBe('The action service did not respond.');
  });
});
