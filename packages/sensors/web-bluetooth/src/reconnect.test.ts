// SPDX-License-Identifier: Apache-2.0

/**
 * #40's third acceptance criterion, in full:
 *
 * > A test proves reconnection after an unexpected disconnect restores
 * > notifications, and that duplicate notification handlers are not accumulated
 * > on reconnect — a leak that manifests as doubled power readings after the
 * > third disconnect.
 *
 * Two properties, and the second is invisible from above the transport: a leaked
 * handler shows up as a power number that is right on the first ride, doubled on
 * the fourth, and blamed on the trainer. It is countable from underneath, which
 * is what `FakeDeviceHandle.listeners` is for — and the fake returns **the same
 * characteristic object** on every reconnect, because a fake that returned a
 * fresh one would pass whether or not the adapter removes its handlers.
 *
 * ⚠️ This transport never enters `reconnecting`.
 * `traits.canReconnectWithoutUserGesture` is false, and "reconnect" here means
 * the caller calling `connect` again — which needs no gesture, because only
 * `requestDevice()` does. What the adapter owes is that the `Unsubscribe`
 * handles the caller still holds start delivering again by themselves.
 */

import { describe, expect, it } from 'vitest';

import type { ConnectionState } from '../../src/connection';

import { createWebBluetoothTransport } from './transport';
import { createFakeBluetooth } from './testing/fake-bluetooth';
import {
  multiFrame,
  STUB_MULTI_CHARACTERISTIC,
  STUB_MULTI_SERVICE,
  stubMultiProfile,
  stubTrainerDevice,
} from './testing/profiles';

const flush = (): Promise<void> => new Promise((resolve) => void setTimeout(resolve, 0));

function fixture() {
  const fake = createFakeBluetooth({ devices: [stubTrainerDevice()] });
  const transport = createWebBluetoothTransport({
    profiles: [stubMultiProfile],
    bluetooth: fake.bluetooth,
    hasUserActivation: () => true,
  });
  return { ...fake, transport };
}

describe('reconnecting after an unexpected disconnect', () => {
  it('restores delivery through the subscription the caller still holds', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);

    const powers: number[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => powers.push(m.power));
    const trainer = bench.device('stub-trainer');

    trainer.notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(200, 90, 90));
    trainer.drop();
    await flush();
    expect(transport.connectionState(device.identity.id)).toBe('disconnected');

    await transport.connect(device.identity.id);
    trainer.notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(220, 92, 92));

    // The caller never re-subscribed. Its `Unsubscribe` handle stayed valid
    // across the drop, so it has no way to know it should have — and a ride
    // screen that silently stops updating after a dropout is the failure.
    expect(powers).toEqual([200, 220]);
  });

  it('accumulates no notification handler across three drops', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);

    const powers: number[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => powers.push(m.power));
    const trainer = bench.device('stub-trainer');

    for (let cycle = 0; cycle < 3; cycle += 1) {
      expect(trainer.listeners(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC)).toBe(1);
      trainer.drop();
      await flush();
      expect(
        trainer.listeners(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC),
        'a dropped link must take its handler with it',
      ).toBe(0);
      await transport.connect(device.identity.id);
    }

    expect(trainer.listeners(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC)).toBe(1);
    trainer.notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(250, 95, 95));
    // The whole point, in one number. Three leaked handlers would make this
    // four, which is what a rider sees as a trainer that has started reporting
    // four times the power it should.
    expect(powers).toEqual([250]);
  });

  it('accumulates no gattserverdisconnected handler across re-pairings', async () => {
    const { transport, bench } = fixture();
    for (let pairing = 0; pairing < 3; pairing += 1) {
      const device = await transport.discover({ capabilities: ['power'] });
      await transport.connect(device.identity.id);
      await transport.disconnect(device.identity.id);
      await flush();
    }
    expect(bench.device('stub-trainer').disconnectListeners).toBe(1);
  });

  it('re-enables notifications on the new link rather than assuming they survived', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);
    await transport.subscribe(device.identity.id, 'power', () => undefined);
    const trainer = bench.device('stub-trainer');

    trainer.drop();
    await flush();
    expect(trainer.notifying(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC)).toBe(false);

    await transport.connect(device.identity.id);
    expect(trainer.notifying(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC)).toBe(true);
    expect(
      bench.operations.filter((entry) => entry.includes('startNotifications')),
      'once for the first link and once for the second, not once for both',
    ).toHaveLength(2);
  });

  it('does not restore a subscription the caller released while disconnected', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);
    const powers: number[] = [];
    const stop = await transport.subscribe(device.identity.id, 'power', (m) =>
      powers.push(m.power),
    );
    const trainer = bench.device('stub-trainer');

    trainer.drop();
    await flush();
    stop();
    await transport.connect(device.identity.id);

    expect(trainer.notifying(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC)).toBe(false);
    trainer.notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(200, 90, 90));
    expect(powers).toHaveLength(0);
  });

  it('restores every subscription, not just the first', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power', 'cadence', 'speed'] });
    await transport.connect(device.identity.id);

    const seen: string[] = [];
    await transport.subscribe(device.identity.id, 'power', () => seen.push('power'));
    await transport.subscribe(device.identity.id, 'cadence', () => seen.push('cadence'));
    await transport.subscribe(device.identity.id, 'speed', () => seen.push('speed'));

    const trainer = bench.device('stub-trainer');
    trainer.drop();
    await flush();
    await transport.connect(device.identity.id);
    trainer.notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(200, 90, 90));

    expect(seen).toEqual(['power', 'cadence', 'speed']);
  });

  it('lets a subscription taken before the drop be released after it', async () => {
    // ⚠️ A reconnect replaces every characteristic object on the device, so the
    // `LiveCharacteristic` a subscription was taken against is not the one that
    // is notifying afterwards. An `Unsubscribe` that decremented the old one
    // would leave the new one holding a count that never reaches zero — the
    // trainer keeps notifying for a ride screen that has been closed, which is
    // radio traffic and battery for nobody.
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);

    const first: number[] = [];
    const second: number[] = [];
    const stopFirst = await transport.subscribe(device.identity.id, 'power', (m) =>
      first.push(m.power),
    );
    const stopSecond = await transport.subscribe(device.identity.id, 'power', (m) =>
      second.push(m.power),
    );

    const trainer = bench.device('stub-trainer');
    trainer.drop();
    await flush();
    await transport.connect(device.identity.id);
    expect(trainer.notifying(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC)).toBe(true);

    stopFirst();
    await flush();
    expect(
      trainer.notifying(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC),
      'the second subscriber still wants this characteristic',
    ).toBe(true);

    stopSecond();
    await flush();
    expect(trainer.notifying(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC)).toBe(false);

    trainer.notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(200, 90, 90));
    expect(first).toHaveLength(0);
    expect(second).toHaveLength(0);
  });

  it('reports the lifecycle a UI renders, with no reconnecting state', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    const states: ConnectionState[] = [];
    transport.observeConnectionState(device.identity.id, (state) => states.push(state));

    await transport.connect(device.identity.id);
    bench.device('stub-trainer').drop();
    await flush();
    await transport.connect(device.identity.id);

    // `reconnecting` means "the transport is restoring this without asking the
    // athlete for anything". Web Bluetooth cannot promise that across a page
    // load, so `traits.canReconnectWithoutUserGesture` is false and the state is
    // never entered — a UI that showed it would be promising a recovery that
    // does not arrive.
    expect(states).toEqual(['connecting', 'connected', 'disconnected', 'connecting', 'connected']);
    expect(transport.traits.canReconnectWithoutUserGesture).toBe(false);
    expect(transport.traits.canRestoreConnectionsInBackground).toBe(false);
  });
});
