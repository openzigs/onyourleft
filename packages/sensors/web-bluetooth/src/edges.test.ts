// SPDX-License-Identifier: Apache-2.0

/**
 * The paths a happy ride never takes: a device that serves nothing, a
 * characteristic that refuses notifications, a notification with no payload, a
 * platform error nobody has seen before, and the defaults that only run in a
 * browser.
 *
 * Each is here because it is a branch, and a branch with no test is a branch
 * that has never been executed. Several of them are how a sensor behaves on the
 * day it is failing, which is the day the code matters.
 */

import { beatsPerMinute, revolutionsPerMinute } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { isSensorError } from '../../src/errors';

import { connectionError, discoveryError, missingProfileError } from './errors';
import type { GattProfile } from './profile';
import { createWebBluetoothTransport } from './transport';
import { createFakeBluetooth, domError } from './testing/fake-bluetooth';
import {
  heartRateFrame,
  STUB_HEART_RATE_CHARACTERISTIC,
  STUB_HEART_RATE_SERVICE,
  singleFrame,
  STUB_MULTI_CHARACTERISTIC,
  STUB_MULTI_SERVICE,
  STUB_SINGLE_CHARACTERISTIC,
  STUB_SINGLE_SERVICE,
  stubGattlessDevice,
  stubHeartRateProfile,
  stubMultiProfile,
  stubNamelessDevice,
  stubSingleProfile,
  stubStrapDevice,
  stubTrainerDevice,
} from './testing/profiles';

const flush = (): Promise<void> => new Promise((resolve) => void setTimeout(resolve, 0));

function fixture(devices = [stubTrainerDevice()]) {
  const fake = createFakeBluetooth({ devices });
  const transport = createWebBluetoothTransport({
    profiles: [stubMultiProfile, stubHeartRateProfile],
    bluetooth: fake.bluetooth,
    hasUserActivation: () => true,
  });
  return { ...fake, transport };
}

describe('a device that cannot be linked', () => {
  it('reports not-connected for a device with no GATT server', async () => {
    const { transport } = fixture([stubGattlessDevice()]);
    const device = await transport.discover({ capabilities: ['heart-rate'] });
    await transport.connect(device.identity.id).then(
      () => expect.unreachable('a beacon has no GATT server to connect to'),
      (error: unknown) => expect(isSensorError(error, 'not-connected')).toBe(true),
    );
  });

  it('names a device the platform did not name as nothing at all', async () => {
    const { transport } = fixture([stubNamelessDevice()]);
    const device = await transport.discover({ capabilities: ['heart-rate'] });
    // Absent rather than "Unknown device": several stacks return no name until a
    // connection exists, and a synthesised one would be rendered as though the
    // device had said it.
    expect(device.name).toBeUndefined();
    expect('name' in device).toBe(false);
  });
});

describe('a characteristic that refuses', () => {
  it('reports capability-unsupported when startNotifications fails', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);

    bench.hold('startNotifications');
    const subscribing = transport.subscribe(device.identity.id, 'power', () => undefined);
    await flush();
    // Not `not-connected`: the link is fine and the device simply will not
    // notify on this characteristic. Retrying will not help, and a UI that
    // offered a retry would have misread the failure.
    bench.held[0]?.fail(domError('NotSupportedError', 'notify is not supported'));
    await expect(subscribing).rejects.toSatisfy((error: unknown) =>
      isSensorError(error, 'capability-unsupported'),
    );
  });

  it('swallows a stopNotifications that fails on the way out', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);
    const stop = await transport.subscribe(device.identity.id, 'power', () => undefined);

    bench.hold('stopNotifications');
    // `Unsubscribe` is synchronous by contract, so there is no promise to hand
    // the failure to. A caller tearing down a ride screen has nothing useful to
    // do with "the trainer refused to stop notifying" either.
    expect(stop).not.toThrow();
    await flush();
    bench.held[0]?.fail(domError('NetworkError', 'the link went while stopping'));
    await flush();
    expect(transport.connectionState(device.identity.id)).toBe('connected');
  });
});

describe('a notification the adapter cannot use', () => {
  it('drops one that arrives with no payload', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);
    const powers: number[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => powers.push(m.power));

    // `value` is optional in the browser's own declarations. Handing a decoder
    // `undefined` would be a `TypeError` inside an event dispatch.
    bench.device('stub-trainer').notifyWithoutValue(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC);
    expect(powers).toHaveLength(0);
  });

  it('drops a field for a capability the device did not declare, and says nothing about it', async () => {
    const fake = createFakeBluetooth({ devices: [stubTrainerDevice()] });
    const failures: unknown[] = [];
    const transport = createWebBluetoothTransport({
      profiles: [stubMultiProfile],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
      onProtocolError: (error) => failures.push(error),
    });
    // Cadence only. The profile decodes power first and speed last on every
    // frame, and neither was subscribed to.
    //
    // ⚠️ **Since #131 the device *declares* all three.** Asking for cadence
    // grants the service that supplies it, and a granted service is resolved
    // whole — so power and speed are declared, sourced and simply unsubscribed.
    // The assertion below is unchanged and still the right one: a field nobody
    // is listening for costs one dropped value and **no** protocol error.
    const device = await transport.discover({ capabilities: ['cadence'] });
    await transport.connect(device.identity.id);
    const seen: string[] = [];
    await transport.subscribe(device.identity.id, 'cadence', (m) => seen.push(m.capability));

    fake.bench
      .device('stub-trainer')
      .notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, new Uint8Array([200, 0, 90, 95]));

    expect(seen).toEqual(['cadence']);
    // ⚠️ And no protocol error. `createDeviceSession` refuses an undeclared
    // capability too, so an adapter that simply reported everything would look
    // right from the outside — while raising `capability-unsupported` out of
    // every notification of every ride, because a trainer's frame always carries
    // fields nobody asked for. The diagnostic channel that exists for a hostile
    // payload would then be full of ordinary traffic, which is how a real
    // decoder fault gets missed.
    expect(failures).toEqual([]);
  });

  it('drops a notification that arrives before the link is announced', async () => {
    // ⚠️ The window inside a reconnect. Restoring two subscriptions is two
    // `startNotifications` calls, and the first characteristic is live while the
    // second is still being armed — so a notification can arrive while this
    // adapter is still in `connecting`. `connection.ts` allows only `connected`
    // to deliver, and reporting here would raise `not-connected` out of the
    // session on a link that is about to be perfectly good.
    const fake = createFakeBluetooth({ devices: [stubTrainerDevice()] });
    const failures: unknown[] = [];
    const transport = createWebBluetoothTransport({
      // Single first, so power and cadence come from different characteristics
      // and restoring them is two calls rather than one.
      profiles: [stubSingleProfile, stubMultiProfile],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
      onProtocolError: (error) => failures.push(error),
    });
    const device = await transport.discover({ capabilities: ['power', 'cadence'] });
    await transport.connect(device.identity.id);
    const powers: number[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => powers.push(m.power));
    await transport.subscribe(device.identity.id, 'cadence', () => undefined);

    const trainer = fake.bench.device('stub-trainer');
    trainer.drop();
    await flush();

    fake.bench.hold('startNotifications');
    const reconnecting = transport.connect(device.identity.id);
    await flush();
    // The first restore is settled; the second is still held, so the adapter is
    // still `connecting` with one characteristic already live.
    fake.bench.held[0]?.settle();
    await flush();
    expect(transport.connectionState(device.identity.id)).toBe('connecting');
    expect(trainer.notifying(STUB_SINGLE_SERVICE, STUB_SINGLE_CHARACTERISTIC)).toBe(true);

    trainer.notify(STUB_SINGLE_SERVICE, STUB_SINGLE_CHARACTERISTIC, singleFrame(233));
    expect(powers, 'nothing is delivered until the link is announced').toEqual([]);
    expect(failures).toEqual([]);

    fake.bench.release('startNotifications');
    await reconnecting;
    trainer.notify(STUB_SINGLE_SERVICE, STUB_SINGLE_CHARACTERISTIC, singleFrame(234));
    expect(powers).toEqual([234]);
  });
});

describe('choosing a source when the preferred service is absent', () => {
  it('falls through to a later profile whose service the device does offer', async () => {
    // The trainer serves both stub services; a plain power meter serves only the
    // second. The registry is in preference order, and a service that is not
    // there must not take the capability with it — otherwise a rider whose meter
    // speaks only the fallback profile pairs successfully and sees no power.
    const fake = createFakeBluetooth({
      devices: [
        {
          id: 'stub-meter',
          name: 'STUB METER 1A2B',
          services: [{ uuid: STUB_SINGLE_SERVICE, characteristics: [STUB_SINGLE_CHARACTERISTIC] }],
        },
      ],
    });
    const transport = createWebBluetoothTransport({
      profiles: [stubMultiProfile, stubSingleProfile],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
    });
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);
    const powers: number[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => powers.push(m.power));

    fake.bench
      .device('stub-meter')
      .notify(STUB_SINGLE_SERVICE, STUB_SINGLE_CHARACTERISTIC, singleFrame(233));
    expect(powers).toEqual([233]);
  });

  it('drops a heart rate from a decoder the device did not declare it for', async () => {
    // A profile may report more than the caller asked for — a trainer's frame
    // carries fields nobody subscribed to on every notification. Every sink
    // method has to drop what was not declared, and this is the fourth of them:
    // reporting it would raise `capability-unsupported` out of
    // `createDeviceSession` inside an event dispatch.
    const overreaching: GattProfile = {
      service: STUB_HEART_RATE_SERVICE,
      characteristic: STUB_HEART_RATE_CHARACTERISTIC,
      capabilities: ['cadence', 'heart-rate'],
      decode(value, sink) {
        sink['heart-rate'](beatsPerMinute(value.getUint8(0)));
        sink.cadence(revolutionsPerMinute(value.getUint8(0)));
      },
    };
    const fake = createFakeBluetooth({ devices: [stubStrapDevice()] });
    const transport = createWebBluetoothTransport({
      profiles: [overreaching],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
    });
    const device = await transport.discover({ capabilities: ['cadence'] });
    await transport.connect(device.identity.id);
    const seen: string[] = [];
    await transport.subscribe(device.identity.id, 'cadence', (m) => seen.push(m.capability));

    fake.bench
      .device('stub-strap')
      .notify(STUB_HEART_RATE_SERVICE, STUB_HEART_RATE_CHARACTERISTIC, heartRateFrame(90));
    expect(seen).toEqual(['cadence']);
  });
});

describe('the heart-rate path end to end', () => {
  it('delivers a beat rate from a strap', async () => {
    const { transport, bench } = fixture([stubStrapDevice()]);
    const device = await transport.discover({ capabilities: ['heart-rate'] });
    await transport.connect(device.identity.id);
    const beats: number[] = [];
    await transport.subscribe(device.identity.id, 'heart-rate', (m) => beats.push(m.heartRate));

    bench
      .device('stub-strap')
      .notify(STUB_HEART_RATE_SERVICE, STUB_HEART_RATE_CHARACTERISTIC, heartRateFrame(152));
    expect(beats).toEqual([152]);
  });
});

describe('the platform defaults, which only a browser exercises', () => {
  it('assumes a user activation when the browser does not report one', async () => {
    // No `hasUserActivation`, so `navigator.userActivation` is read — and under
    // Node there is none. Refusing every pairing on a browser that does not
    // report activation would be worse than trusting the caller: `requestDevice`
    // still refuses, and `discoveryError` still maps the refusal.
    const fake = createFakeBluetooth({ devices: [stubStrapDevice()] });
    const transport = createWebBluetoothTransport({
      profiles: [stubHeartRateProfile],
      bluetooth: fake.bluetooth,
    });
    await expect(transport.discover({ capabilities: ['heart-rate'] })).resolves.toBeDefined();
  });
});

describe('mapping a platform failure this program has not seen', () => {
  it('reports an unrecognised discovery failure as a refusal, not a success', () => {
    expect(isSensorError(discoveryError(domError('QuotaExceededError')), 'not-permitted')).toBe(
      true,
    );
  });

  it('reads the name off anything, and gives up on anything without one', () => {
    // `instanceof DOMException` is false across realms — an iframe, a worker, a
    // test double — so the mapping reads `.name` instead. These are the two ends
    // of that: a thrown string has no name to read, and an object whose `name`
    // is not a string is not a match either.
    expect(isSensorError(discoveryError('a thrown string'), 'not-permitted')).toBe(true);
    expect(isSensorError(discoveryError({ name: 404 }), 'not-permitted')).toBe(true);
    expect(isSensorError(discoveryError(null), 'not-permitted')).toBe(true);
  });

  it('keeps every mapped failure’s cause reachable', () => {
    const platform = domError('NetworkError', 'device 4C:0B:AE:12:34:56 went away');
    for (const error of [
      discoveryError(platform),
      connectionError(platform, 'some-device'),
      missingProfileError(platform, 'some-device'),
    ]) {
      expect(error.cause).toBe(platform);
      expect(error.message).not.toContain('4C:0B:AE');
    }
  });
});
