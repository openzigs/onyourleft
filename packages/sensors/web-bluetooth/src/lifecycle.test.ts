// SPDX-License-Identifier: Apache-2.0

/**
 * Connect, subscribe, deliver, disconnect — and the choices the adapter makes
 * while doing it.
 *
 * The issue calls the GATT connection lifecycle *"the subtle correctness
 * issue"*, and names three parts of it: a device that reports as present while
 * its GATT server is disconnected, `gatt.connect()` behaving differently across
 * Chrome versions on an already-connecting device, and a disconnect during an
 * operation. The first two are here; the third has a file of its own.
 */

import { describe, expect, it } from 'vitest';

import type { ConnectionState } from '../../src/connection';
import { isSensorError } from '../../src/errors';
import type { SensorMeasurement } from '../../src/measurement';

import { createWebBluetoothTransport } from './transport';
import { createFakeBluetooth, domError } from './testing/fake-bluetooth';
import {
  multiFrame,
  singleFrame,
  STUB_MULTI_CHARACTERISTIC,
  STUB_MULTI_SERVICE,
  STUB_SINGLE_CHARACTERISTIC,
  STUB_SINGLE_SERVICE,
  stubEmptyDevice,
  stubHeartRateProfile,
  stubMultiProfile,
  stubSingleProfile,
  stubStrapDevice,
  stubTrainerDevice,
} from './testing/profiles';

const flush = (): Promise<void> => new Promise((resolve) => void setTimeout(resolve, 0));

function fixture(devices = [stubTrainerDevice(), stubStrapDevice()]) {
  const fake = createFakeBluetooth({ devices });
  const transport = createWebBluetoothTransport({
    profiles: [stubMultiProfile, stubSingleProfile, stubHeartRateProfile],
    bluetooth: fake.bluetooth,
    hasUserActivation: () => true,
  });
  return { ...fake, transport };
}

describe('connect', () => {
  it('passes through connecting, and connecting again is a no-op', async () => {
    const { transport } = fixture();
    const device = await transport.discover({ capabilities: ['power', 'cadence'] });
    const states: ConnectionState[] = [];
    transport.observeConnectionState(device.identity.id, (state) => states.push(state));

    await transport.connect(device.identity.id);
    expect(transport.connectionState(device.identity.id)).toBe('connected');
    expect(states).toEqual(['connecting', 'connected']);

    await transport.connect(device.identity.id);
    expect(states).toEqual(['connecting', 'connected']);
  });

  it('makes two concurrent connects one connection attempt', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });

    await Promise.all([
      transport.connect(device.identity.id),
      transport.connect(device.identity.id),
    ]);

    // `gatt.connect()` on an already-connecting device has behaved differently
    // across Chrome versions. One attempt is what makes that irrelevant.
    expect(bench.operations.filter((entry) => entry.endsWith(':connect'))).toHaveLength(1);
    expect(transport.connectionState(device.identity.id)).toBe('connected');
  });

  it('drops a link the platform holds and this adapter does not, then reconnects', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });

    // A `BluetoothDevice` can report as present with a live GATT server that
    // this adapter never resolved handles from — after a hot reload, or a
    // permission restored by another component. Every handle from that link is
    // unreachable, so it is dropped rather than reused.
    void bench.device('stub-trainer').native.gatt?.connect();
    await flush();
    expect(bench.device('stub-trainer').connected).toBe(true);
    const before = bench.operations.length;

    await transport.connect(device.identity.id);
    await flush();
    expect(transport.connectionState(device.identity.id)).toBe('connected');
    expect(bench.device('stub-trainer').connected).toBe(true);
    // The order is the assertion: dropped, then established. Reusing the link
    // would mean resolving handles from a connection this adapter never made,
    // and `gatt.connect()` on an already-connected device has behaved
    // differently across Chrome versions.
    expect(bench.operations.slice(before, before + 2)).toEqual([
      'stub-trainer:disconnect',
      'stub-trainer:connect',
    ]);
  });

  it('gives the link back when a connect fails after it came up', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);
    await transport.subscribe(device.identity.id, 'power', () => undefined);
    bench.device('stub-trainer').drop();
    await flush();

    // The reconnect gets its link up and then fails re-arming the subscription.
    // A refused `startNotifications` is not a disconnect, so nothing drops the
    // radio link unless the adapter does.
    bench.hold('startNotifications');
    const reconnecting = transport.connect(device.identity.id);
    await flush();
    expect(bench.device('stub-trainer').connected).toBe(true);
    bench.held[0]?.fail(domError('NotSupportedError', 'notify is not supported'));

    await expect(reconnecting).rejects.toSatisfy((error: unknown) =>
      isSensorError(error, 'capability-unsupported'),
    );
    await flush();
    // ⚠️ A link held here costs one of three OS-wide connection slots for the
    // life of the page, for a device the adapter has no handles for — so the
    // athlete's third sensor refuses to pair and nothing says why.
    expect(bench.device('stub-trainer').connected).toBe(false);
    expect(transport.connectionState(device.identity.id)).toBe('disconnected');

    // And the slot really is back: the same device connects cleanly next time,
    // and the failed attempt's own disconnect event does not tear that down.
    bench.release('startNotifications');
    await expect(transport.connect(device.identity.id)).resolves.toBeUndefined();
    await flush();
    expect(transport.connectionState(device.identity.id)).toBe('connected');
  });

  it('rejects rather than throwing for an id it did not issue', async () => {
    const { transport } = fixture();
    await transport.connect('never-issued' as never).then(
      () => expect.unreachable('this transport issued no such id'),
      (error: unknown) => expect(isSensorError(error, 'device-not-found')).toBe(true),
    );
  });

  it('throws device-not-found synchronously only from the synchronous methods', () => {
    const { transport } = fixture();
    expect(() => transport.connectionState('never-issued' as never)).toThrow();
    expect(() =>
      transport.observeConnectionState('never-issued' as never, () => undefined),
    ).toThrow();
  });

  it('reports connection-budget-exceeded once the platform budget is spent', async () => {
    const fake = createFakeBluetooth({
      devices: [
        { ...stubStrapDevice('one'), name: 'ONE' },
        { ...stubStrapDevice('two'), name: 'TWO' },
        { ...stubStrapDevice('three'), name: 'THREE' },
        { ...stubStrapDevice('four'), name: 'FOUR' },
      ],
    });
    const transport = createWebBluetoothTransport({
      profiles: [stubHeartRateProfile],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
    });
    for (const namePrefix of ['ONE', 'TWO', 'THREE']) {
      const device = await transport.discover({ capabilities: ['heart-rate'], namePrefix });
      await transport.connect(device.identity.id);
    }
    const fourth = await transport.discover({ capabilities: ['heart-rate'], namePrefix: 'FOUR' });
    await transport.connect(fourth.identity.id).then(
      () => expect.unreachable('the connection budget is three'),
      (error: unknown) => expect(isSensorError(error, 'connection-budget-exceeded')).toBe(true),
    );
  });

  it('refuses a declared capability no service on the link actually supplies', async () => {
    // The chooser matched on an advertised service; only a link reveals what a
    // device really offers, and `SensorTransport` has no way to amend a
    // `SensorDevice` after it has been handed out. So the declared set is what
    // was asked for, and `subscribe` is where it becomes truthful.
    const { transport } = fixture([stubStrapDevice()]);
    const device = await transport.discover({ capabilities: ['heart-rate', 'power'] });
    await transport.connect(device.identity.id);

    await transport
      .subscribe(device.identity.id, 'power', () => undefined)
      .then(
        () => expect.unreachable('this strap serves no power'),
        (error: unknown) => expect(isSensorError(error, 'capability-unsupported')).toBe(true),
      );
    await expect(
      transport.subscribe(device.identity.id, 'heart-rate', () => undefined),
    ).resolves.toBeTypeOf('function');
  });

  it('connects to a device that serves nothing it declared, and delivers nothing', async () => {
    const { transport } = fixture([stubEmptyDevice()]);
    const device = await transport.discover({ capabilities: [] });
    // A failed `getPrimaryService` is not a failed connect: a request for power
    // and heart rate reaches a trainer with no strap service, and the honest
    // outcome is a link that delivers power.
    await expect(transport.connect(device.identity.id)).resolves.toBeUndefined();
    expect(transport.connectionState(device.identity.id)).toBe('connected');
  });
});

describe('subscribe', () => {
  it('refuses to enable notifications before the connection exists', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });

    await transport
      .subscribe(device.identity.id, 'power', () => undefined)
      .then(
        () => expect.unreachable('a disconnected device must not accept a subscription'),
        (error: unknown) => expect(isSensorError(error, 'not-connected')).toBe(true),
      );
    expect(bench.operations.some((entry) => entry.includes('startNotifications'))).toBe(false);
  });

  it('refuses a capability the device did not declare', async () => {
    const { transport } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);

    await transport
      .subscribe(device.identity.id, 'heart-rate', () => undefined)
      .then(
        () => expect.unreachable('heart rate was never asked for'),
        (error: unknown) => expect(isSensorError(error, 'capability-unsupported')).toBe(true),
      );
  });

  it('delivers a decoded measurement attributed to the device', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power', 'cadence', 'speed'] });
    await transport.connect(device.identity.id);

    const seen: SensorMeasurement[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => seen.push(m));
    await transport.subscribe(device.identity.id, 'cadence', (m) => seen.push(m));
    await transport.subscribe(device.identity.id, 'speed', (m) => seen.push(m));

    bench
      .device('stub-trainer')
      .notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(214, 88, 95));

    expect(seen.map((m) => m.capability)).toEqual(['power', 'cadence', 'speed']);
    expect(seen.every((m) => m.device.id === device.identity.id)).toBe(true);
    expect(seen.every((m) => m.device.transport === transport.traits.id)).toBe(true);
    // One instant for the whole frame: the adapter stamps it once, before the
    // decoder runs, so a profile cannot misdate one field relative to another.
    expect(new Set(seen.map((m) => m.at)).size).toBe(1);
  });

  it('takes each capability from one service only, even when two carry it', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);

    const powers: number[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => powers.push(m.power));

    const trainer = bench.device('stub-trainer');
    trainer.notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(200, 90, 90));
    trainer.notify(STUB_SINGLE_SERVICE, STUB_SINGLE_CHARACTERISTIC, singleFrame(999));

    // The trainer serves both stub services. Only the first registered profile
    // is the source, so the second characteristic is not even notifying — this
    // is the same rule that stops a real trainer reporting power from FTMS and
    // from Cycling Power in the same second.
    expect(powers).toEqual([200]);
    expect(trainer.notifying(STUB_SINGLE_SERVICE, STUB_SINGLE_CHARACTERISTIC)).toBe(false);
  });

  it('drops power from a service that is notifying but is not the source', async () => {
    // ⚠️ The case a single-service device cannot produce. Registering the
    // single-quantity profile first makes it the source for power; subscribing
    // to cadence as well puts the *other* characteristic into notify, and its
    // frame carries a power field too. A modern trainer is exactly this — FTMS
    // and Cycling Power on one device, both notifying — and an adapter without
    // the source check delivers two power readings a second, which reads
    // downstream as a rider holding double their real wattage.
    const fake = createFakeBluetooth({ devices: [stubTrainerDevice()] });
    const transport = createWebBluetoothTransport({
      profiles: [stubSingleProfile, stubMultiProfile],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
    });
    const device = await transport.discover({ capabilities: ['power', 'cadence'] });
    await transport.connect(device.identity.id);

    const powers: number[] = [];
    const cadences: number[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => powers.push(m.power));
    await transport.subscribe(device.identity.id, 'cadence', (m) => cadences.push(m.cadence));

    const trainer = fake.bench.device('stub-trainer');
    expect(trainer.notifying(STUB_SINGLE_SERVICE, STUB_SINGLE_CHARACTERISTIC)).toBe(true);
    expect(trainer.notifying(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC)).toBe(true);

    trainer.notify(STUB_SINGLE_SERVICE, STUB_SINGLE_CHARACTERISTIC, singleFrame(233));
    trainer.notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(999, 90, 90));

    expect(powers, 'power comes from its source and from nowhere else').toEqual([233]);
    expect(cadences).toEqual([90]);
  });

  it('enables notifications once for a characteristic two capabilities share', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power', 'cadence'] });
    await transport.connect(device.identity.id);
    await transport.subscribe(device.identity.id, 'power', () => undefined);
    await transport.subscribe(device.identity.id, 'cadence', () => undefined);

    expect(bench.operations.filter((entry) => entry.includes('startNotifications'))).toHaveLength(
      1,
    );
  });

  it('delivers nothing after unsubscribe, and stops notifying at the last one', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power', 'cadence'] });
    await transport.connect(device.identity.id);

    const powers: number[] = [];
    const cadences: number[] = [];
    const stopPower = await transport.subscribe(device.identity.id, 'power', (m) =>
      powers.push(m.power),
    );
    const stopCadence = await transport.subscribe(device.identity.id, 'cadence', (m) =>
      cadences.push(m.cadence),
    );
    const trainer = bench.device('stub-trainer');

    trainer.notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(200, 90, 90));
    expect(powers).toHaveLength(1);
    expect(cadences).toHaveLength(1);

    stopPower();
    await flush();
    // Cadence still wants this characteristic, so it must still be notifying.
    expect(trainer.notifying(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC)).toBe(true);
    trainer.notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(210, 91, 90));
    expect(powers).toHaveLength(1);
    expect(cadences).toHaveLength(2);

    stopCadence();
    await flush();
    expect(trainer.notifying(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC)).toBe(false);
  });

  it('is idempotent, so a second unsubscribe does not close someone else’s stream', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);

    const first: number[] = [];
    const second: number[] = [];
    const stop = await transport.subscribe(device.identity.id, 'power', (m) => first.push(m.power));
    await transport.subscribe(device.identity.id, 'power', (m) => second.push(m.power));

    stop();
    stop();
    await flush();

    bench
      .device('stub-trainer')
      .notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(200, 90, 90));
    expect(first).toHaveLength(0);
    expect(second, 'the second subscriber still holds this characteristic').toHaveLength(1);
  });

  it('drops a notification whose payload the decoder cannot read', async () => {
    const fake = createFakeBluetooth({ devices: [stubTrainerDevice()] });
    const failures: unknown[] = [];
    const transport = createWebBluetoothTransport({
      profiles: [stubMultiProfile],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
      onProtocolError: (error) => failures.push(error),
    });
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);
    const powers: number[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => powers.push(m.power));

    // Sensor data is untrusted input from a device that may not be what it
    // claims. A one-byte frame makes `getUint16` throw; the stream must survive
    // it, because the alternative is an exception in the browser's event
    // dispatch that nothing this program wrote can catch.
    const trainer = fake.bench.device('stub-trainer');
    trainer.notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, new Uint8Array([1]));
    expect(powers).toHaveLength(0);
    expect(failures).toHaveLength(1);

    trainer.notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(180, 85, 80));
    expect(powers).toEqual([180]);
  });
});

describe('disconnect', () => {
  it('resolves for a device that is already disconnected', async () => {
    const { transport } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await expect(transport.disconnect(device.identity.id)).resolves.toBeUndefined();
  });

  it('stops delivery and leaves the device addressable', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);
    const powers: number[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => powers.push(m.power));

    await transport.disconnect(device.identity.id);
    await flush();
    expect(transport.connectionState(device.identity.id)).toBe('disconnected');

    bench
      .device('stub-trainer')
      .notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(200, 90, 90));
    expect(powers).toHaveLength(0);
  });

  it('rejects rather than throwing for an id it did not issue', async () => {
    const { transport } = fixture();
    await transport.disconnect('never-issued' as never).then(
      () => expect.unreachable('this transport issued no such id'),
      (error: unknown) => expect(isSensorError(error, 'device-not-found')).toBe(true),
    );
  });
});

describe('availabilitychanged', () => {
  it('moves every device to unavailable when the radio goes, and back on return', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);
    const states: ConnectionState[] = [];
    transport.observeConnectionState(device.identity.id, (state) => states.push(state));

    bench.setAvailability(false);
    bench.emitAvailabilityChanged();
    await flush();
    expect(transport.connectionState(device.identity.id)).toBe('unavailable');

    bench.setAvailability(true);
    bench.emitAvailabilityChanged();
    await flush();
    // Back to `disconnected`, never straight to `connected`: Bluetooth coming
    // back on does not restore a link, and on Web Bluetooth does not restore
    // permission to attempt one without a gesture.
    expect(transport.connectionState(device.identity.id)).toBe('disconnected');
    expect(states).toEqual(['unavailable', 'disconnected']);
  });

  it('announces the loss once, however many times the event arrives', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);
    const states: ConnectionState[] = [];
    transport.observeConnectionState(device.identity.id, (state) => states.push(state));

    bench.setAvailability(false);
    bench.emitAvailabilityChanged();
    bench.emitAvailabilityChanged();
    await flush();
    // And an `availabilitychanged` that says nothing changed changes nothing.
    bench.emitAvailabilityChanged();
    await flush();

    expect(states).toEqual(['unavailable']);
  });

  it('does nothing to a device that was already disconnected when the radio went', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });

    bench.setAvailability(false);
    bench.emitAvailabilityChanged();
    await flush();
    expect(transport.connectionState(device.identity.id)).toBe('unavailable');

    bench.setAvailability(true);
    bench.emitAvailabilityChanged();
    bench.emitAvailabilityChanged();
    await flush();
    expect(transport.connectionState(device.identity.id)).toBe('disconnected');
  });

  it('refuses to connect while the transport is unavailable', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    bench.setAvailability(false);
    bench.emitAvailabilityChanged();
    await flush();

    await transport.connect(device.identity.id).then(
      () => expect.unreachable('there is no radio'),
      (error: unknown) => expect(isSensorError(error, 'adapter-unavailable')).toBe(true),
    );
  });
});
