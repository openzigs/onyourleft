// SPDX-License-Identifier: Apache-2.0

/**
 * #40's second acceptance criterion, in full:
 *
 * > A test proves a mid-operation disconnect **rejects or resolves every
 * > pending operation** rather than leaving a promise permanently unsettled. A
 * > hung await here freezes the ride screen with no error and no recovery.
 *
 * Every test below holds a GATT call open and drops the link underneath it. The
 * fake never settles a held call on its own, so a promise this adapter leaves
 * unsettled stays unsettled — the assertion is `rejects`, and the failure mode
 * is the test timing out rather than a wrong value, which is the honest shape
 * for "this hangs".
 *
 * The simulator (#44) cannot express any of this: it is a `SensorTransport`
 * itself, so it stands where this adapter stands rather than underneath it, and
 * there is no GATT operation in it to hold open. That gap is reported rather
 * than worked around silently.
 */

import { seconds } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { isSensorError } from '../../src/errors';
import type { ConnectionState } from '../../src/connection';

import { createWebBluetoothTransport } from './transport';
import { createFakeBluetooth, domError } from './testing/fake-bluetooth';
import {
  multiFrame,
  STUB_MULTI_CHARACTERISTIC,
  STUB_MULTI_SERVICE,
  stubHeartRateProfile,
  stubMultiProfile,
  stubTrainerDevice,
} from './testing/profiles';

const flush = (): Promise<void> => new Promise((resolve) => void setTimeout(resolve, 0));

function fixture() {
  const fake = createFakeBluetooth({ devices: [stubTrainerDevice()] });
  const transport = createWebBluetoothTransport({
    profiles: [stubMultiProfile, stubHeartRateProfile],
    bluetooth: fake.bluetooth,
    hasUserActivation: () => true,
  });
  return { ...fake, transport };
}

describe('a disconnect in the middle of an operation', () => {
  it('settles a connect the browser rejects when the device vanishes', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });

    bench.hold('connect');
    const connecting = transport.connect(device.identity.id);
    await flush();
    expect(bench.held).toHaveLength(1);
    expect(transport.connectionState(device.identity.id)).toBe('connecting');

    // What Chrome does when the trainer is switched off mid-connect.
    bench.held[0]?.fail(domError('NetworkError', 'GATT connection failed'));
    await expect(connecting).rejects.toSatisfy((error: unknown) =>
      isSensorError(error, 'not-connected'),
    );
    expect(transport.connectionState(device.identity.id)).toBe('disconnected');
  });

  it('settles a connect the browser never answers at all', async () => {
    // ⚠️ The case that has no event behind it. `gattserverdisconnected` fires
    // only for a link that was *up*, so a device switched off while
    // `gatt.connect()` is outstanding produces no event — and Web Bluetooth
    // specifies no timeout for anything. Without a deadline this await never
    // ends, and the ride screen sits on a spinner for ever. The first version of
    // this adapter failed exactly here.
    const fake = createFakeBluetooth({ devices: [stubTrainerDevice()] });
    const transport = createWebBluetoothTransport({
      profiles: [stubMultiProfile],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
      operationTimeout: seconds(0.02),
    });
    const device = await transport.discover({ capabilities: ['power'] });

    fake.bench.hold('connect');
    const connecting = transport.connect(device.identity.id);
    await flush();
    // Nothing will ever settle this held call, and nothing else can: the device
    // is not connected, so `drop()` has no link to drop and no event to send.
    fake.bench.device('stub-trainer').drop();

    await expect(connecting).rejects.toSatisfy((error: unknown) =>
      isSensorError(error, 'not-connected'),
    );
    expect(transport.connectionState(device.identity.id)).toBe('disconnected');
  });

  it('frees the queue for another device once a hung operation times out', async () => {
    const fake = createFakeBluetooth({
      devices: [
        { ...stubTrainerDevice('gone'), name: 'GONE' },
        { ...stubTrainerDevice('here'), name: 'HERE' },
      ],
    });
    // A scheduler the test fires by hand, rather than a short real timeout: the
    // deadline is then a decision this test makes rather than a race it wins
    // most of the time, and the assertion below is about which operation the
    // deadline belongs to.
    const deadlines: (() => void)[] = [];
    const transport = createWebBluetoothTransport({
      profiles: [stubMultiProfile],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
      operationTimeout: seconds(30),
      schedule: (callback) => {
        deadlines.push(callback);
        return () => {
          const index = deadlines.indexOf(callback);
          if (index !== -1) {
            deadlines.splice(index, 1);
          }
        };
      },
    });
    const gone = await transport.discover({ capabilities: ['power'], namePrefix: 'GONE' });
    const here = await transport.discover({ capabilities: ['power'], namePrefix: 'HERE' });

    fake.bench.hold('connect');
    const stuck = transport.connect(gone.identity.id);
    await flush();

    // Nothing settles the held call. The second device's whole connect is
    // behind it, because the queue is global — so a queue that waited for the
    // underlying promise would leave this rider unable to pair anything, ever
    // again, on any device.
    expect(deadlines, 'one deadline, for the operation holding the slot').toHaveLength(1);
    deadlines[0]?.();
    await expect(stuck).rejects.toSatisfy((error: unknown) =>
      isSensorError(error, 'not-connected'),
    );
    fake.bench.release('connect');
    await expect(transport.connect(here.identity.id)).resolves.toBeUndefined();
    expect(transport.connectionState(here.identity.id)).toBe('connected');
  });

  it('settles a service lookup that the link drop caught mid-flight', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });

    bench.hold('getPrimaryService');
    const connecting = transport.connect(device.identity.id);
    await flush();
    expect(bench.held.map((entry) => entry.operation)).toEqual(['getPrimaryService']);

    bench.device('stub-trainer').drop();
    await expect(connecting).rejects.toSatisfy((error: unknown) =>
      isSensorError(error, 'not-connected'),
    );
  });

  it('settles a startNotifications that the link drop caught mid-flight', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);

    bench.hold('startNotifications');
    const subscribing = transport.subscribe(device.identity.id, 'power', () => undefined);
    await flush();
    expect(bench.held).toHaveLength(1);

    bench.device('stub-trainer').drop();
    await expect(subscribing).rejects.toSatisfy((error: unknown) =>
      isSensorError(error, 'not-connected'),
    );
    expect(transport.connectionState(device.identity.id)).toBe('disconnected');
  });

  it('settles an operation still queued behind the one the drop caught', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power', 'cadence'] });
    await transport.connect(device.identity.id);

    bench.hold('startNotifications');
    const first = transport.subscribe(device.identity.id, 'power', () => undefined);
    const second = transport.subscribe(device.identity.id, 'cadence', () => undefined);
    await flush();
    // One held, one waiting behind it: the queue is global and holds one slot.
    expect(bench.held).toHaveLength(1);

    bench.device('stub-trainer').drop();
    await expect(first).rejects.toSatisfy((error: unknown) =>
      isSensorError(error, 'not-connected'),
    );
    await expect(second).rejects.toSatisfy((error: unknown) =>
      isSensorError(error, 'not-connected'),
    );
  });

  it('drops delivery the instant the link goes, without waiting for the event', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);
    const powers: number[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => powers.push(m.power));

    const trainer = bench.device('stub-trainer');
    trainer.notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(200, 90, 90));
    expect(powers).toEqual([200]);

    // ⚠️ `gatt.disconnect()` is synchronous and `gattserverdisconnected`
    // arrives in a later task, so there is a window in which this adapter's
    // session still says `connected` and the link is already gone. The fake
    // models that window rather than closing it — a `characteristicvaluechanged`
    // dispatched just before the drop still lands — and nothing may be
    // delivered in it, because the sample would be attributed to a link that
    // does not exist.
    trainer.drop();
    trainer.notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(210, 91, 90));
    expect(powers).toEqual([200]);
  });

  it('announces the drop once, whether the adapter or the device caused it', async () => {
    const { transport } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);
    const states: ConnectionState[] = [];
    transport.observeConnectionState(device.identity.id, (state) => states.push(state));

    await transport.disconnect(device.identity.id);
    // `gatt.disconnect()` is synchronous and its event arrives in a later task,
    // so the adapter drives the session from its own call site *and* hears the
    // event. A second `disconnected` would be a state change a UI renders as a
    // second dropout.
    await flush();
    expect(states).toEqual(['disconnected']);
  });

  it('leaves nothing outstanding after a drop', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power', 'cadence'] });
    await transport.connect(device.identity.id);

    bench.hold('startNotifications');
    const pending = [
      transport.subscribe(device.identity.id, 'power', () => undefined),
      transport.subscribe(device.identity.id, 'cadence', () => undefined),
    ];
    await flush();
    bench.device('stub-trainer').drop();

    const outcomes = await Promise.allSettled(pending);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
  });
});

/**
 * A drop can land at any point in a connect, including in the gaps between the
 * adapter's own `await`s, and the number of those gaps is an implementation
 * detail of both this file and the JavaScript engine. So rather than pick one
 * interleaving and assert a path, this sweeps the drop across every microtask
 * boundary in a connect and asserts the **property**: whatever the timing, the
 * caller gets either a live link or `not-connected`, and never a link committed
 * on a device that is gone.
 *
 * `illegal-state-transition` is called out by name because it is the failure
 * this covers. Without the check after the queue, a drop that lands between the
 * queue settling and the connect resuming reaches
 * `transitionTo('connected')` from `disconnected` — which `connection.ts`
 * forbids, so the caller's `connect` rejects with a code about the state machine
 * rather than about the trainer, and `record.link` is left pointing at handles
 * the browser has already invalidated.
 */
describe('a drop at every point in a connect', () => {
  const at = async (depth: number): Promise<void> => {
    const fake = createFakeBluetooth({ devices: [stubTrainerDevice()] });
    const transport = createWebBluetoothTransport({
      profiles: [stubMultiProfile],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
      operationTimeout: seconds(0.05),
    });
    const device = await transport.discover({ capabilities: ['power'] });
    const trainer = fake.bench.device('stub-trainer');

    const connecting = transport.connect(device.identity.id);
    let remaining = depth;
    const schedule = (): void => {
      if (remaining === 0) {
        trainer.drop();
        return;
      }
      remaining -= 1;
      queueMicrotask(schedule);
    };
    schedule();

    const outcome = await connecting.then(
      () => 'connected' as const,
      (error: unknown) => {
        expect(
          isSensorError(error, 'not-connected'),
          `a drop ${String(depth)} microtasks in must read as a lost link, not as ${
            isSensorError(error) ? error.code : String(error)
          }`,
        ).toBe(true);
        return 'rejected' as const;
      },
    );
    await flush();

    if (outcome === 'connected') {
      // A connect that reported success must have reported it about a live
      // link. If the drop got in first, the state has since moved on — but it
      // must never have been `connected` over invalidated handles.
      expect(['connected', 'disconnected']).toContain(
        transport.connectionState(device.identity.id),
      );
    } else {
      expect(transport.connectionState(device.identity.id)).toBe('disconnected');
      // And nothing may be delivered through the link that was not established.
      await transport
        .subscribe(device.identity.id, 'power', () => undefined)
        .then(
          () => expect.unreachable('there is no link'),
          (error: unknown) => expect(isSensorError(error, 'not-connected')).toBe(true),
        );
    }
  };

  for (let depth = 0; depth <= 12; depth += 1) {
    it(`is either a link or a not-connected, ${String(depth)} microtasks in`, async () => {
      await at(depth);
    });
  }
});
