// SPDX-License-Identifier: Apache-2.0

/**
 * The global GATT queue: one operation at a time across every device, and
 * nothing left unsettled.
 *
 * The serialisation test is Revision 2 of #1's addition — *"one global GATT
 * operation queue across all connected devices, not one per device … add an
 * acceptance criterion that concurrent operations across two devices serialise,
 * asserted by a test"* — and it is written so that a per-device queue fails it:
 * the two operations name two different devices, so a queue keyed by device
 * would run them at once.
 */

import { describe, expect, it } from 'vitest';

import { deviceId } from '../../src/device';
import { isSensorError, SensorError } from '../../src/errors';

import { createGattQueue } from './queue';

const DEVICE_A = deviceId('device-a');
const DEVICE_B = deviceId('device-b');

/** A promise the test settles by hand, plus a record of whether it has started. */
function gate(): {
  readonly started: () => boolean;
  readonly operation: () => Promise<string>;
  settle(value: string): void;
  fail(error: unknown): void;
} {
  let hasStarted = false;
  let resolve!: (value: string) => void;
  let reject!: (error: unknown) => void;
  const pending = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    started: () => hasStarted,
    operation: () => {
      hasStarted = true;
      return pending;
    },
    settle: resolve,
    fail: reject,
  };
}

/** Let every already-scheduled microtask run. */
const flush = (): Promise<void> => new Promise((resolve) => void setTimeout(resolve, 0));

describe('createGattQueue', () => {
  it('runs one operation at a time across two different devices', async () => {
    const queue = createGattQueue();
    const first = gate();
    const second = gate();

    const a = queue.run(DEVICE_A, first.operation);
    const b = queue.run(DEVICE_B, second.operation);
    await flush();

    // The whole point of a *global* queue: a per-device one would have started
    // both, because the owners differ.
    expect(first.started()).toBe(true);
    expect(second.started(), 'a second device must wait for the first').toBe(false);

    first.settle('a');
    await expect(a).resolves.toBe('a');
    await flush();
    expect(second.started()).toBe(true);

    second.settle('b');
    await expect(b).resolves.toBe('b');
  });

  it('lets the next operation run after one rejects', async () => {
    const queue = createGattQueue();
    const first = gate();
    const second = gate();

    const a = queue.run(DEVICE_A, first.operation);
    const b = queue.run(DEVICE_A, second.operation);
    await flush();

    first.fail(new Error('the trainer refused'));
    await expect(a).rejects.toThrow('the trainer refused');
    await flush();

    // A rejected tail that was not caught would skip every operation behind it,
    // and the queue would be dead for the life of the page after one refusal.
    expect(second.started()).toBe(true);
    second.settle('b');
    await expect(b).resolves.toBe('b');
  });

  it('turns an operation that throws synchronously into a rejection', async () => {
    const queue = createGattQueue();
    await expect(
      queue.run(DEVICE_A, () => {
        throw new Error('thrown, not returned');
      }),
    ).rejects.toThrow('thrown, not returned');
    // And the chain still moves.
    await expect(queue.run(DEVICE_A, () => Promise.resolve('after'))).resolves.toBe('after');
  });

  it('rejects an operation abandoned while it was still queued, and never runs it', async () => {
    const queue = createGattQueue();
    const first = gate();
    const second = gate();

    const a = queue.run(DEVICE_A, first.operation);
    const b = queue.run(DEVICE_B, second.operation);
    await flush();

    queue.abandon(DEVICE_B, new SensorError('not-connected', 'the link dropped'));
    await expect(b).rejects.toSatisfy((error: unknown) => isSensorError(error, 'not-connected'));

    first.settle('a');
    await expect(a).resolves.toBe('a');
    await flush();
    expect(second.started(), 'an abandoned operation must not run on a dead link').toBe(false);
  });

  it('settles an in-flight operation that never resolves, and releases the slot', async () => {
    const queue = createGattQueue();
    const stuck = gate();
    const after = gate();

    const hung = queue.run(DEVICE_A, stuck.operation);
    const next = queue.run(DEVICE_B, after.operation);
    await flush();
    expect(stuck.started()).toBe(true);
    expect(after.started()).toBe(false);

    // `stuck` is never settled. This is the trainer that stops answering
    // mid-operation: without `abandon`, `hung` is a promise nobody ever settles
    // and `next` is behind it for the life of the page.
    queue.abandon(DEVICE_A, new SensorError('not-connected', 'the link dropped'));
    await expect(hung).rejects.toSatisfy((error: unknown) => isSensorError(error, 'not-connected'));
    await flush();

    expect(after.started(), 'the slot must be released, not held by a dead operation').toBe(true);
    after.settle('b');
    await expect(next).resolves.toBe('b');
  });

  it('leaves an operation belonging to another device alone', async () => {
    const queue = createGattQueue();
    const first = gate();

    const a = queue.run(DEVICE_A, first.operation);
    await flush();

    queue.abandon(DEVICE_B, new SensorError('not-connected', 'a different device dropped'));
    first.settle('a');
    await expect(a).resolves.toBe('a');
  });

  it('settles each operation exactly once, whichever outcome arrives first', async () => {
    const queue = createGattQueue();
    const first = gate();
    const settled = queue.run(DEVICE_A, first.operation);
    await flush();

    queue.abandon(DEVICE_A, new SensorError('not-connected', 'dropped'));
    // The underlying operation resolves afterwards, as a real GATT promise does
    // when the browser gets round to rejecting it. The caller must still see the
    // abandonment, and must not see a second outcome.
    first.settle('too late');
    await expect(settled).rejects.toSatisfy((error: unknown) =>
      isSensorError(error, 'not-connected'),
    );
    expect(queue.outstanding).toBe(0);
  });

  it('counts what is outstanding, and returns to zero', async () => {
    const queue = createGattQueue();
    expect(queue.outstanding).toBe(0);

    const first = gate();
    const a = queue.run(DEVICE_A, first.operation);
    const b = queue.run(DEVICE_A, () => Promise.resolve('b'));
    expect(queue.outstanding).toBe(2);

    first.settle('a');
    await Promise.all([a, b]);
    expect(queue.outstanding).toBe(0);
  });

  it('is a no-op for a device with nothing outstanding', () => {
    const queue = createGattQueue();
    expect(() => {
      queue.abandon(DEVICE_A, new SensorError('not-connected', 'nothing to abandon'));
    }).not.toThrow();
  });
});
