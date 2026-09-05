// SPDX-License-Identifier: Apache-2.0

/**
 * What a device reports it can do, and where that answer comes from (#131).
 *
 * Until this issue the answer came from the **discovery request**: `register`
 * fixed a device's capability set to whatever the caller asked for, and
 * `subscribe` refused anything outside it. A device could therefore only ever
 * report what it had been looked for with, and the wide chooser — "anything this
 * program can use", with no capability named — produced a device that connected,
 * reported `connected`, and refused every subscription for ever.
 *
 * The answer now comes from the device's own GATT services, bounded by the
 * services this origin was granted (#132). Those two are one change: a
 * resolution that may reach any service needs a grant that covers it, and a
 * grant narrowed to the request needs a resolution that is not *also* narrowed
 * to it, or the wide-browse path has nothing to resolve.
 *
 * `applyResolved` in `transport.ts` states the rule this file tests.
 */

import { describe, expect, it } from 'vitest';

import { beatsPerMinute, unixSeconds, watts, type UnixSeconds } from '@onyourleft/domain';

import type { SensorMeasurement } from '../../src/measurement';
import type { GattProfile } from './profile';
import { isSensorError } from '../../src/errors';
import {
  createIndoorBikeDataProfile,
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_FEATURE,
  FITNESS_MACHINE_SERVICE,
  HEART_RATE_MEASUREMENT,
  HEART_RATE_SERVICE,
  heartRateProfile,
  INDOOR_BIKE_DATA,
} from '../../protocol/src/index';

import { createFakeBluetooth, type FakeDeviceSpec } from './testing/fake-bluetooth';
import {
  heartRateFrame,
  multiFrame,
  STUB_HEART_RATE_CHARACTERISTIC,
  STUB_HEART_RATE_SERVICE,
  STUB_MULTI_CHARACTERISTIC,
  STUB_MULTI_SERVICE,
  STUB_SINGLE_CHARACTERISTIC,
  STUB_SINGLE_SERVICE,
  stubHeartRateProfile,
  stubMultiProfile,
  stubSingleProfile,
  stubStrapDevice,
  stubTrainerDevice,
} from './testing/profiles';
import { createWebBluetoothTransport } from './transport';

/** Let every queued microtask run, which is how a dropped link settles. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function fixture(devices: readonly FakeDeviceSpec[] = [stubTrainerDevice(), stubStrapDevice()]) {
  const fake = createFakeBluetooth({ devices: [...devices] });
  const transport = createWebBluetoothTransport({
    // Multi before single, so a device serving both takes power from multi.
    profiles: [stubMultiProfile, stubSingleProfile, stubHeartRateProfile],
    bluetooth: fake.bluetooth,
    hasUserActivation: () => true,
  });
  return { ...fake, transport };
}

describe('a device discovered with no capability named', () => {
  it('reports nothing before a link exists, because nothing has been observed', async () => {
    const { transport } = fixture();

    const device = await transport.discover({ capabilities: [] });

    // Not a claim that it does nothing — a statement that Web Bluetooth cannot
    // reveal a device's services before a link exists, so there is nothing
    // truthful to say yet.
    expect([...device.capabilities]).toEqual([]);
  });

  it('reports what its services actually supply once connected', async () => {
    const { transport } = fixture();
    const device = await transport.discover({ capabilities: [] });

    await transport.connect(device.identity.id);

    // The trainer serves the multi service (power, cadence, speed) and the
    // single service (power). Power comes from multi, because it is registered
    // first — the rule that stops a trainer reporting power twice a second.
    expect(new Set(device.capabilities)).toEqual(new Set(['power', 'cadence', 'speed']));
  });

  it('accepts a subscription for a capability nobody asked for, and delivers it', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: [] });
    await transport.connect(device.identity.id);
    const seen: SensorMeasurement[] = [];

    // This is the defect in its visible form: before #131 this call rejected
    // with `capability-unsupported` on a device that connects perfectly well,
    // for every capability, for ever.
    await transport.subscribe(device.identity.id, 'cadence', (m) => seen.push(m));
    bench
      .device('stub-trainer')
      .notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(210, 88, 95));

    // Read back through the same path a ride screen uses, not from the object
    // the test constructed: a capability set that is right and a stream that
    // never arrives is the failure this pair of assertions separates.
    expect(seen.map((m) => m.capability)).toEqual(['cadence']);
  });

  it('reports nothing for a device that serves none of the registered profiles', async () => {
    const { transport } = fixture([{ id: 'stub-empty', name: 'STUB EMPTY 9999', services: [] }]);
    const device = await transport.discover({ capabilities: [] });

    await transport.connect(device.identity.id);

    // A connect, not a failure — `resolveLink` skips a service the device does
    // not offer rather than refusing the link. The honest report is an empty
    // set, and `subscribe` refuses on the grounds that nothing supplies it.
    expect(transport.connectionState(device.identity.id)).toBe('connected');
    expect([...device.capabilities]).toEqual([]);
    await transport
      .subscribe(device.identity.id, 'power', () => undefined)
      .then(
        () => expect.unreachable('this device serves nothing'),
        (error: unknown) => expect(isSensorError(error, 'capability-unsupported')).toBe(true),
      );
  });
});

describe('a device discovered for one capability', () => {
  it('reports the others its supplying service carries as well', async () => {
    const { transport } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    expect(new Set(device.capabilities)).toEqual(new Set(['power']));

    await transport.connect(device.identity.id);

    // Cadence and speed were never requested and are never refused: one frame
    // from the multi service carries all three, which is exactly the shape of a
    // real trainer's FTMS Indoor Bike Data notification.
    expect(new Set(device.capabilities)).toEqual(new Set(['power', 'cadence', 'speed']));
    await expect(
      transport.subscribe(device.identity.id, 'speed', () => undefined),
    ).resolves.toBeTypeOf('function');
  });

  it('cannot reach a service the grant does not cover, and does not claim it', async () => {
    // One device serving both the strap's service and the trainer's, which is
    // what a bike computer or a multi-sport watch looks like.
    const combined: FakeDeviceSpec = {
      id: 'stub-trainer',
      name: 'STUB COMBO 7A11',
      services: [
        { uuid: STUB_MULTI_SERVICE, characteristics: [STUB_MULTI_CHARACTERISTIC] },
        { uuid: STUB_HEART_RATE_SERVICE, characteristics: [STUB_HEART_RATE_CHARACTERISTIC] },
      ],
    };
    const { transport, bench } = fixture([combined]);
    const device = await transport.discover({ capabilities: ['heart-rate'] });

    await transport.connect(device.identity.id);

    // The device serves power. The origin was granted the Heart Rate service
    // and nothing else, so it may not read the other one — and #131's
    // resolution is bounded by that grant rather than stepping around it.
    expect([...device.capabilities]).toEqual(['heart-rate']);
    expect(bench.device('stub-trainer').allowedServices).toEqual([
      STUB_HEART_RATE_SERVICE.toLowerCase(),
    ]);
    await transport
      .subscribe(device.identity.id, 'power', () => undefined)
      .then(
        () => expect.unreachable('this origin was never granted the service that supplies power'),
        (error: unknown) => expect(isSensorError(error, 'capability-unsupported')).toBe(true),
      );
  });

  it('widens what it can resolve when the athlete chooses the same device again', async () => {
    const combined: FakeDeviceSpec = {
      id: 'stub-trainer',
      name: 'STUB COMBO 7A11',
      services: [
        { uuid: STUB_MULTI_SERVICE, characteristics: [STUB_MULTI_CHARACTERISTIC] },
        { uuid: STUB_HEART_RATE_SERVICE, characteristics: [STUB_HEART_RATE_CHARACTERISTIC] },
      ],
    };
    const { transport } = fixture([combined]);
    const first = await transport.discover({ capabilities: ['heart-rate'] });
    await transport.connect(first.identity.id);
    expect([...first.capabilities]).toEqual(['heart-rate']);

    // A second gesture, a second grant. The browser accumulates allowed services
    // per device, so the adapter does too — and the same `SensorDevice` comes
    // back, because replacing it would replace the session and lose every
    // subscription the caller holds.
    const second = await transport.discover({ capabilities: ['power'] });
    expect(second).toBe(first);

    await transport.disconnect(second.identity.id);
    await transport.connect(second.identity.id);

    expect(new Set(second.capabilities)).toEqual(
      new Set(['heart-rate', 'power', 'cadence', 'speed']),
    );
  });
});

describe('a reconnect that supplies a different service set', () => {
  it('narrows the set, and re-widens it when the service comes back', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    const id = device.identity.id;
    await transport.connect(id);
    const seen: SensorMeasurement[] = [];
    const release = await transport.subscribe(id, 'cadence', (m) => seen.push(m));
    expect(new Set(device.capabilities)).toEqual(new Set(['power', 'cadence', 'speed']));

    // The trainer comes back in a different mode: the multi service is gone and
    // only the single, power-only service is served. Multi-mode trainers do
    // this, and the rule is that the set narrows — continuing to claim cadence
    // would put a reading on screen that will never update again.
    bench.device('stub-trainer').setServiceVisible(STUB_MULTI_SERVICE, false);
    bench.device('stub-trainer').drop();
    await settle();
    await transport.connect(id);

    expect([...device.capabilities]).toEqual(['power']);
    // The caller's handle stayed valid across the narrowing rather than
    // becoming a hazard, and nothing is delivered for a capability that is no
    // longer supplied.
    expect(seen).toEqual([]);
    await transport
      .subscribe(id, 'cadence', () => undefined)
      .then(
        () => expect.unreachable('nothing on this link supplies cadence'),
        (error: unknown) => expect(isSensorError(error, 'capability-unsupported')).toBe(true),
      );

    // And back. The demand survived the narrowing, so the subscription the
    // caller still holds re-arms itself without the caller doing anything —
    // which is the whole reason `record.demand` outlives a link.
    bench.device('stub-trainer').setServiceVisible(STUB_MULTI_SERVICE, true);
    bench.device('stub-trainer').drop();
    await settle();
    await transport.connect(id);

    expect(new Set(device.capabilities)).toEqual(new Set(['power', 'cadence', 'speed']));
    bench
      .device('stub-trainer')
      .notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(180, 91, 88));
    expect(seen.map((m) => m.capability)).toEqual(['cadence']);
    release();
  });

  it('leaves the last observation standing while the device is disconnected', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);

    bench.device('stub-trainer').drop();
    await settle();

    // A dropout is not new information about what the device can do, and a
    // pairing list that blanked itself on every one would be unreadable.
    expect(transport.connectionState(device.identity.id)).toBe('disconnected');
    expect(new Set(device.capabilities)).toEqual(new Set(['power', 'cadence', 'speed']));
  });

  it('keeps the observation from the last good link when a connect fails mid-resolution', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    const id = device.identity.id;
    await transport.connect(id);
    bench.device('stub-trainer').drop();
    await settle();

    // The link dies while `resolveLink` is still walking it. Nothing it found
    // belongs to a live link, so nothing it found may be reported.
    bench.hold('getCharacteristic');
    const connecting = transport.connect(id).catch(() => undefined);
    await settle();
    bench.device('stub-trainer').drop();
    await settle();
    bench.release('getCharacteristic');
    await connecting;
    // ⚠️ **Settled again, deliberately.** `queue.abandon` rejects the *outer*
    // `queue.run` promise while the operation it was running carries on to its
    // own conclusion, so `connect` rejecting is not the end of the work — and a
    // test that asserted here would be green whatever the abandoned body went on
    // to write. That is CLAUDE.md §5's *wrong time* in its exact form, and
    // without these lines the mutation that applies the resolved set before the
    // link-dropped check turns nothing red.
    await settle();
    await settle();

    expect(transport.connectionState(id)).toBe('disconnected');
    expect(new Set(device.capabilities)).toEqual(new Set(['power', 'cadence', 'speed']));
  });
});

describe('trainer-control, which is a safety claim and not a request', () => {
  const trainerWithControl = (): FakeDeviceSpec => ({
    id: 'ftms-trainer',
    name: 'KICKR 1F2A',
    services: [
      {
        uuid: FITNESS_MACHINE_SERVICE,
        characteristics: [INDOOR_BIKE_DATA, FITNESS_MACHINE_CONTROL_POINT, FITNESS_MACHINE_FEATURE],
      },
    ],
  });

  const trainerWithoutControl = (): FakeDeviceSpec => ({
    id: 'ftms-trainer',
    name: 'READ ONLY 4C4C',
    services: [
      {
        uuid: FITNESS_MACHINE_SERVICE,
        characteristics: [INDOOR_BIKE_DATA, FITNESS_MACHINE_FEATURE],
      },
    ],
  });

  const ftmsFixture = (device: FakeDeviceSpec) => {
    const fake = createFakeBluetooth({ devices: [device] });
    return {
      ...fake,
      transport: createWebBluetoothTransport({
        profiles: [createIndoorBikeDataProfile(), heartRateProfile],
        bluetooth: fake.bluetooth,
        hasUserActivation: () => true,
      }),
    };
  };

  it('is claimed when the control point answered', async () => {
    const { transport } = ftmsFixture(trainerWithControl());
    const device = await transport.discover({ capabilities: ['power'] });

    await transport.connect(device.identity.id);

    expect(device.capabilities.has('trainer-control')).toBe(true);
  });

  it('is not claimed by a machine that serves no control point, however it was asked for', async () => {
    const { transport } = ftmsFixture(trainerWithoutControl());
    // Asked for explicitly, which used to be enough on its own: `register` put
    // whatever the caller named into the set, so a device that cannot be
    // controlled reported that it could. CLAUDE.md §6 treats trainer control as
    // a safety problem, and a pairing screen offering ERG on a machine that
    // will refuse it is the failure that makes it one.
    const device = await transport.discover({ capabilities: ['power', 'trainer-control'] });
    expect(device.capabilities.has('trainer-control')).toBe(true);

    await transport.connect(device.identity.id);

    expect(device.capabilities.has('trainer-control')).toBe(false);
  });

  it('is not claimed by a heart rate strap, and its control point is never granted', async () => {
    const strap: FakeDeviceSpec = {
      id: 'strap',
      name: 'STRAP 1B7E',
      services: [
        { uuid: HEART_RATE_SERVICE, characteristics: [HEART_RATE_MEASUREMENT] },
        // A dishonest device: it serves a Fitness Machine Control Point too.
        // Nothing stops one, and the athlete chose it for heart rate.
        { uuid: FITNESS_MACHINE_SERVICE, characteristics: [FITNESS_MACHINE_CONTROL_POINT] },
      ],
    };
    const { transport, bench } = ftmsFixture(strap);
    const device = await transport.discover({ capabilities: ['heart-rate', 'trainer-control'] });

    await transport.connect(device.identity.id);

    // #132's severity, stated as an assertion: the origin holds no grant to a
    // characteristic that applies physical resistance to a person pedalling, on
    // a device the athlete chose for heart rate.
    expect(bench.device('strap').allowedServices).toEqual([HEART_RATE_SERVICE]);
    expect([...device.capabilities]).toEqual(['heart-rate']);
    // And it did not go looking. A `getPrimaryService` outside the grant cannot
    // succeed, so attempting one buys nothing and costs a console entry per
    // connect on every strap and power meter in the world.
    expect(
      bench.operations.filter((operation) => operation.includes(FITNESS_MACHINE_SERVICE)),
    ).toEqual([]);
  });

  it('refuses to open the control point on a device whose grant does not cover it', async () => {
    const strap: FakeDeviceSpec = {
      id: 'strap',
      name: 'STRAP 1B7E',
      services: [
        { uuid: HEART_RATE_SERVICE, characteristics: [HEART_RATE_MEASUREMENT] },
        { uuid: FITNESS_MACHINE_SERVICE, characteristics: [FITNESS_MACHINE_CONTROL_POINT] },
      ],
    };
    const { transport } = ftmsFixture(strap);
    const device = await transport.discover({ capabilities: ['heart-rate'] });
    await transport.connect(device.identity.id);

    // The other half of the grant, and the half that is a *safety* property
    // rather than a reporting one: `openFitnessMachine` resolves the control
    // point directly rather than through `resolveLink`, so it is the path that
    // would still reach the characteristic if only the capability set had been
    // narrowed. The browser refuses it, which is what makes the narrow grant
    // the control and not merely the disclosure.
    await transport.openFitnessMachine(device.identity.id).then(
      () => expect.unreachable('this origin was never granted the Fitness Machine Service'),
      (error: unknown) => expect(isSensorError(error, 'capability-unsupported')).toBe(true),
    );
  });
});

describe('the device object the caller is holding', () => {
  it('is the same object, and its session survives every re-resolution', async () => {
    const { transport, bench } = fixture([stubStrapDevice()]);
    const device = await transport.discover({ capabilities: [] });
    const id = device.identity.id;
    const states: string[] = [];
    // Registered *before* the first connect, so it is attached to the session
    // that existed while the capability set was still empty. A resolution that
    // replaced the `SensorDevice` would replace the session with it and this
    // listener would go quiet.
    transport.observeConnectionState(id, (state) => states.push(state));

    await transport.connect(id);
    const beats: SensorMeasurement[] = [];
    await transport.subscribe(id, 'heart-rate', (m) => beats.push(m));
    bench
      .device('stub-strap')
      .notify(STUB_HEART_RATE_SERVICE, STUB_HEART_RATE_CHARACTERISTIC, heartRateFrame(142));

    expect(states).toEqual(['connecting', 'connected']);
    // `session.report` refuses a measurement whose capability the device does
    // not declare. Heart rate was never in the request, so a set applied after
    // notifications were armed — or applied to a copy — would drop this.
    expect(beats).toHaveLength(1);
  });
});

describe('the notification clock, which the resolved set must not disturb', () => {
  it('still stamps the transport clock on a capability that was never requested', async () => {
    const fake = createFakeBluetooth({ devices: [stubTrainerDevice()] });
    let clock = 1_800_000_000;
    const transport = createWebBluetoothTransport({
      profiles: [stubMultiProfile],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
      now: (): UnixSeconds => unixSeconds(clock),
    });
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);
    const seen: SensorMeasurement[] = [];
    await transport.subscribe(device.identity.id, 'speed', (m) => seen.push(m));

    clock = 1_800_000_042;
    fake.bench
      .device('stub-trainer')
      .notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(200, 90, 80));

    expect(seen.map((m) => m.at)).toEqual([unixSeconds(1_800_000_042)]);
  });
});

describe('two granted services that both carry the same quantity', () => {
  it('reports it once, from the first, and drops the second silently', async () => {
    // A second stub, registered after the heart rate one and supplying heart
    // rate *and* power. Before #131 this profile would not have been resolved
    // at all on a request for heart rate alone, so the case did not arise;
    // service-driven resolution is what makes it reachable, because both
    // services are granted and both are walked.
    const strapAndPower: GattProfile = {
      service: STUB_MULTI_SERVICE,
      characteristic: STUB_MULTI_CHARACTERISTIC,
      capabilities: ['heart-rate', 'power'],
      decode(value, sink) {
        sink['heart-rate'](beatsPerMinute(value.getUint8(2)));
        sink.power(watts(value.getUint16(0, true)));
      },
    };
    const combined: FakeDeviceSpec = {
      id: 'stub-trainer',
      name: 'STUB COMBO 7A11',
      services: [
        { uuid: STUB_HEART_RATE_SERVICE, characteristics: [STUB_HEART_RATE_CHARACTERISTIC] },
        { uuid: STUB_MULTI_SERVICE, characteristics: [STUB_MULTI_CHARACTERISTIC] },
      ],
    };
    const fake = createFakeBluetooth({ devices: [combined] });
    const failures: unknown[] = [];
    const transport = createWebBluetoothTransport({
      profiles: [stubHeartRateProfile, strapAndPower],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
      onProtocolError: (error) => failures.push(error),
    });
    const device = await transport.discover({ capabilities: [] });
    await transport.connect(device.identity.id);
    const seen: SensorMeasurement[] = [];
    // Both, so that the second profile's characteristic is actually notifying:
    // it is the source for power, and its frame carries a heart rate too.
    await transport.subscribe(device.identity.id, 'heart-rate', (m) => seen.push(m));
    await transport.subscribe(device.identity.id, 'power', (m) => seen.push(m));

    fake.bench
      .device('stub-trainer')
      .notify(STUB_HEART_RATE_SERVICE, STUB_HEART_RATE_CHARACTERISTIC, heartRateFrame(142));
    fake.bench
      .device('stub-trainer')
      .notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(240, 155, 90));

    // One beat, from the profile registered first — the rule that stops a
    // modern trainer reporting the same quantity twice a second from two
    // services. The second frame's 155 is discarded on the way out of the
    // decoder, not filtered by the subscriber, and its 240 W is not.
    expect(seen).toEqual([
      expect.objectContaining({ capability: 'heart-rate', heartRate: 142 }),
      expect.objectContaining({ capability: 'power', power: 240 }),
    ]);
    // And silently. `createDeviceSession` would refuse the duplicate too, but
    // as an error — filling the diagnostic channel that exists for a hostile
    // payload with ordinary traffic from every ride.
    expect(failures).toEqual([]);
  });
});

describe('the single service, which supplies power alone', () => {
  it('is chosen when it is the only granted service that carries the capability', async () => {
    const single: FakeDeviceSpec = {
      id: 'stub-trainer',
      name: 'STUB SINGLE 3C3C',
      services: [{ uuid: STUB_SINGLE_SERVICE, characteristics: [STUB_SINGLE_CHARACTERISTIC] }],
    };
    const { transport } = fixture([single]);
    const device = await transport.discover({ capabilities: [] });

    await transport.connect(device.identity.id);

    expect([...device.capabilities]).toEqual(['power']);
  });
});
