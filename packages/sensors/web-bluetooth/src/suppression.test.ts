// SPDX-License-Identifier: Apache-2.0

/**
 * What happens when `gatt.disconnect()` throws.
 *
 * The adapter drops the radio link in three places, and each one raises
 * `suppressedDisconnects` first so the `gattserverdisconnected` that follows is
 * understood as its own teardown rather than as the device going away. Two of
 * those three sites called `disconnect()` unguarded.
 *
 * The failure that produces is not the obvious one. A throw does not merely fail
 * the operation in hand: it leaves the counter raised with **no event coming to
 * lower it**, so the next *genuine* disconnect — a device physically dropping —
 * is absorbed as though the adapter had asked for it. The damage therefore
 * surfaces one lifecycle event after the bug that caused it, which is why no
 * test exercising the failing call on its own could see it.
 *
 * Every test here asserts the state of the link AFTER the failure, never the
 * rejection alone.
 */

import { describe, expect, it } from 'vitest';

import type { ConnectionState } from '../../src/connection';
import { isSensorError } from '../../src/errors';

import { createWebBluetoothTransport } from './transport';
import { createFakeBluetooth } from './testing/fake-bluetooth';
import {
  stubHeartRateProfile,
  stubMultiProfile,
  stubSingleProfile,
  stubStrapDevice,
  stubTrainerDevice,
} from './testing/profiles';

const flush = (): Promise<void> => new Promise((resolve) => void setTimeout(resolve, 0));

function fixture(devices: readonly Parameters<typeof createFakeBluetooth>[0]['devices'][number][]) {
  const fake = createFakeBluetooth({ devices });
  const transport = createWebBluetoothTransport({
    profiles: [stubMultiProfile, stubSingleProfile, stubHeartRateProfile],
    bluetooth: fake.bluetooth,
    hasUserActivation: () => true,
  });
  return { ...fake, transport };
}

describe('a disconnect that throws', () => {
  it('still reports a genuine drop after a teardown whose disconnect threw', async () => {
    // The latch, and the only test here that can see it.
    //
    // Reaching a throwing `disconnect()` is not enough: the counter it leaves
    // raised does no damage until the NEXT `gattserverdisconnected` arrives, and
    // the adapter has to be in `connected` when it does — otherwise there is no
    // transition to swallow and the bug is invisible. So this drives the adapter
    // all the way back up to a live link before dropping it for real.
    const { transport, bench } = fixture([
      { ...stubStrapDevice(), disconnectThrows: true },
      stubTrainerDevice(),
    ]);
    const device = await transport.discover({ capabilities: ['heart-rate'] });
    await transport.connect(device.identity.id);
    await transport.subscribe(device.identity.id, 'heart-rate', () => undefined);

    // A failed re-arm after a drop: the catch arm drops the radio link, and that
    // `disconnect()` throws.
    bench.device('stub-strap').drop();
    await flush();
    bench.hold('startNotifications');
    const reconnecting = transport.connect(device.identity.id);
    await flush();
    bench.held[0]?.fail(new Error('notify is not supported'));
    await expect(reconnecting).rejects.toSatisfy((error: unknown) => isSensorError(error));
    await flush();
    bench.release('startNotifications');

    // Back up to a live link. The throw above left the platform still reporting
    // `connected`, so this also crosses the second unguarded site on the way.
    await transport.connect(device.identity.id);
    await flush();
    expect(transport.connectionState(device.identity.id)).toBe('connected');

    const states: ConnectionState[] = [];
    transport.observeConnectionState(device.identity.id, (state) => states.push(state));

    // The strap comes off. Nothing about this is the adapter's own teardown.
    bench.device('stub-strap').drop();
    await flush();

    // A counter left raised by a call that threw absorbs exactly this event, and
    // the athlete's heart-rate strap reads `connected` for the rest of the ride.
    expect(transport.connectionState(device.identity.id)).toBe('disconnected');
    expect(states).toContain('disconnected');
  });

  it('gives the slot back when a connect fails after the link came up', async () => {
    // Site two: the catch arm. The throw used to escape the catch block itself,
    // so `transitionTo('disconnected')` on the line below it never ran.
    const { transport, bench } = fixture([
      { ...stubStrapDevice(), disconnectThrows: true },
      stubTrainerDevice(),
    ]);
    const device = await transport.discover({ capabilities: ['heart-rate'] });
    await transport.connect(device.identity.id);
    await transport.subscribe(device.identity.id, 'heart-rate', () => undefined);
    bench.device('stub-strap').drop();
    await flush();

    bench.hold('startNotifications');
    const reconnecting = transport.connect(device.identity.id);
    await flush();
    bench.held[0]?.fail(new Error('notify is not supported'));

    // A SensorError, not the raw throw from `disconnect()`.
    await expect(reconnecting).rejects.toSatisfy((error: unknown) => isSensorError(error));
    await flush();
    expect(transport.connectionState(device.identity.id)).toBe('disconnected');
  });
});
