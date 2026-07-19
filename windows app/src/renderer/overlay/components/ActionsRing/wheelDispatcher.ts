/**
 * Bounded, ordered dispatcher for wheel-driven adjustment actions.
 *
 * A high-resolution wheel can emit dozens of events in a fraction of a second.
 * Dispatching one IPC/PowerShell keyboard action per event immediately creates a
 * storm of concurrent processes with no ordering guarantee. This helper instead:
 *
 *  - drains **sequentially** (awaits each dispatch before the next), so at most
 *    one action is ever in flight — outstanding IPC is bounded to 1;
 *  - preserves **FIFO order**, so wheel-up/wheel-down ticks reach the app in the
 *    order they happened;
 *  - **caps the backlog** so an extreme burst can never queue unbounded work,
 *    dropping the oldest still-queued ticks;
 *  - can be **disposed** when the ring closes to drop any stale pending work.
 *
 * Pure — no React/DOM — so it is unit-testable in isolation.
 */

export type WheelDirection = 'up' | 'down';

export interface WheelDispatcher {
  /** Queue one tick in the given direction and start draining if idle. */
  push(direction: WheelDirection): void;
  /** Number of ticks still waiting to be dispatched (excludes the in-flight one). */
  pendingCount(): number;
  /** Drop all pending work and stop the drain loop after the current dispatch. */
  dispose(): void;
}

export interface WheelDispatcherOptions {
  /** Maximum number of queued ticks; older ticks beyond this are dropped. */
  maxPending?: number;
}

export function createWheelDispatcher(
  dispatch: (direction: WheelDirection) => Promise<unknown> | void,
  options: WheelDispatcherOptions = {}
): WheelDispatcher {
  const maxPending = Math.max(1, options.maxPending ?? 24);
  const queue: WheelDirection[] = [];
  let draining = false;
  let disposed = false;

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (!disposed && queue.length > 0) {
        const direction = queue.shift() as WheelDirection;
        try {
          await dispatch(direction);
        } catch {
          // The dispatch callback owns error reporting; keep draining so one
          // failed tick does not strand the rest of the queue.
        }
      }
    } finally {
      draining = false;
    }
  }

  return {
    push(direction: WheelDirection): void {
      if (disposed) return;
      queue.push(direction);
      // Bound the backlog: drop the oldest still-queued ticks so a fast wheel can
      // never build an unbounded amount of outstanding work.
      while (queue.length > maxPending) queue.shift();
      void drain();
    },
    pendingCount(): number {
      return queue.length;
    },
    dispose(): void {
      disposed = true;
      queue.length = 0;
    },
  };
}
