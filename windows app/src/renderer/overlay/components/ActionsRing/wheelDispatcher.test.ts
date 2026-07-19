import { describe, expect, it } from 'vitest';
import { createWheelDispatcher, type WheelDirection } from './wheelDispatcher';

const flush = () => Promise.resolve();

describe('wheel dispatcher', () => {
  it('never runs two dispatches at once and preserves order', async () => {
    const started: WheelDirection[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers: Array<() => void> = [];
    const dispatcher = createWheelDispatcher((direction) => {
      started.push(direction);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<void>((resolve) => resolvers.push(() => { inFlight -= 1; resolve(); }));
    });

    dispatcher.push('up');
    dispatcher.push('down');
    dispatcher.push('up');

    for (let i = 0; i < 3; i += 1) {
      while (resolvers.length === 0) await flush();
      resolvers.shift()!();
      await flush();
      await flush();
    }

    expect(maxInFlight).toBe(1);
    expect(started).toEqual(['up', 'down', 'up']);
  });

  it('bounds the backlog under a burst and clears on dispose', () => {
    const resolvers: Array<() => void> = [];
    let dispatched = 0;
    const dispatcher = createWheelDispatcher(
      () => {
        dispatched += 1;
        return new Promise<void>((resolve) => resolvers.push(resolve));
      },
      { maxPending: 5 }
    );

    for (let i = 0; i < 100; i += 1) dispatcher.push('up');

    // One dispatch is in flight; the queued remainder is capped.
    expect(dispatched).toBe(1);
    expect(dispatcher.pendingCount()).toBeLessThanOrEqual(5);

    dispatcher.dispose();
    expect(dispatcher.pendingCount()).toBe(0);
  });

  it('ignores pushes after dispose', () => {
    const dispatcher = createWheelDispatcher(() => Promise.resolve());
    dispatcher.dispose();
    dispatcher.push('up');
    expect(dispatcher.pendingCount()).toBe(0);
  });
});
