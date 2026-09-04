// SPDX-License-Identifier: Apache-2.0

/**
 * The simulator as a `SensorTransport`: the conformance suite run against every
 * device kind it emulates, and the behaviour that is specific to a fake stack.
 *
 * The first half is #44's first acceptance criterion made checkable — the
 * simulator satisfies #39's interface **unchanged**, which is proven by the
 * same suite that will run against #40's adapter with a trainer on the desk.
 * The second half pins what only a simulator can pin: exact values, the
 * modern-trainer fan-out, the connection budget, the `unavailable` state.
 */

import { revolutionsPerMinute, seconds, unixSeconds, watts } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { deviceId, isSensorError, SIMULATED, type MeasurementFor } from '../index';
import { describeTransportConformance, type ConformanceSubject } from './conformance';
import {
  cpsPowerMeter,
  createSimulator,
  cscsSensor,
  ftmsTrainer,
  hrsStrap,
  modernTrainer,
  type SimulatedDeviceSpec,
} from './index';

function subjectFor(spec: SimulatedDeviceSpec): ConformanceSubject {
  return {
    create() {
      const { transport, bench } = createSimulator({ devices: [spec] });
      return Promise.resolve({
        transport,
        request: { capabilities: [] },
        settle(duration) {
          bench.advance(duration);
          return Promise.resolve();
        },
      });
    },
  };
}

// Every device kind the issue names, plus the one that matters most: one
// device presenting FTMS, CPS and CSCS at once.
describeTransportConformance('the simulated heart-rate strap', subjectFor(hrsStrap()));
describeTransportConformance('the simulated cycling power meter', subjectFor(cpsPowerMeter()));
describeTransportConformance('the simulated speed and cadence sensor', subjectFor(cscsSensor()));
describeTransportConformance('the simulated FTMS trainer', subjectFor(ftmsTrainer()));
describeTransportConformance('the simulated modern trainer', subjectFor(modernTrainer()));

describe('the simulator is a transport of its own', () => {
  it('issues ids on the SIMULATED transport so they can never match a real device', async () => {
    const { transport } = createSimulator({ devices: [hrsStrap()] });
    const device = await transport.discover({ capabilities: ['heart-rate'] });

    expect(transport.traits.id).toBe(SIMULATED);
    expect(device.identity.transport).toBe(SIMULATED);
  });

  it('declares web-shaped traits by default, because Phase 1 ships in a browser', () => {
    const { transport } = createSimulator({ devices: [] });

    expect(transport.traits.canReconnectWithoutUserGesture).toBe(false);
    expect(transport.traits.canRestoreConnectionsInBackground).toBe(false);
    expect(transport.traits.maxConcurrentConnections).toBe(3);
  });

  it('lets a test choose the traits of a native stack instead', () => {
    const { transport } = createSimulator({
      devices: [],
      traits: { canReconnectWithoutUserGesture: true, maxConcurrentConnections: 7 },
    });

    expect(transport.traits.canReconnectWithoutUserGesture).toBe(true);
    expect(transport.traits.maxConcurrentConnections).toBe(7);
    expect(transport.traits.id).toBe(SIMULATED);
  });

  it('reports a cancelled chooser as no-device-selected, not as a fault', async () => {
    const { transport } = createSimulator({ devices: [hrsStrap()], chooser: 'cancel' });

    await transport.discover({ capabilities: ['heart-rate'] }).then(
      () => expect.unreachable('a cancelled chooser returns nothing'),
      (error: unknown) => expect(isSensorError(error, 'no-device-selected')).toBe(true),
    );
  });

  it('narrows the chooser by capability and by name prefix', async () => {
    const { transport } = createSimulator({
      devices: [hrsStrap({ name: 'HRM-Dual' }), ftmsTrainer({ name: 'KICKR CORE' })],
    });

    expect((await transport.discover({ capabilities: ['power'] })).name).toBe('KICKR CORE');
    expect((await transport.discover({ capabilities: [], namePrefix: 'HRM' })).name).toBe(
      'HRM-Dual',
    );
    await transport.discover({ capabilities: [], namePrefix: 'Tacx' }).then(
      () => expect.unreachable('nothing in the catalogue is a Tacx'),
      (error: unknown) => expect(isSensorError(error, 'no-device-selected')).toBe(true),
    );
  });

  it('refuses an id it did not issue, and rejects rather than throws', async () => {
    const { transport } = createSimulator({ devices: [hrsStrap()] });

    // `.then` on the returned promise: a synchronous throw would escape this
    // expression before the rejection handler existed.
    await transport.connect(deviceId('a-real-trainer')).then(
      () => expect.unreachable('an unknown id must be refused'),
      (error: unknown) => expect(isSensorError(error, 'device-not-found')).toBe(true),
    );
    expect(() => transport.connectionState(deviceId('a-real-trainer'))).toThrow(/did not issue/);
  });

  it('refuses a connection past the budget', async () => {
    const { transport } = createSimulator({
      devices: [
        hrsStrap({ id: 'a' }),
        hrsStrap({ id: 'b' }),
        hrsStrap({ id: 'c' }),
        hrsStrap({ id: 'd' }),
      ],
      traits: { maxConcurrentConnections: 3 },
    });
    for (const id of ['a', 'b', 'c']) {
      await transport.connect(deviceId(id));
    }

    await transport.connect(deviceId('d')).then(
      () => expect.unreachable('the fourth connection exceeds the budget'),
      (error: unknown) => expect(isSensorError(error, 'connection-budget-exceeded')).toBe(true),
    );
  });

  it('refuses a catalogue with two devices on one id, which would alias them', () => {
    expect(() =>
      createSimulator({ devices: [hrsStrap({ id: 'x' }), cpsPowerMeter({ id: 'x' })] }),
    ).toThrow(expect.objectContaining({ code: 'invalid-device-id' }));
    expect(() => createSimulator({ devices: [] }).bench.device(deviceId('x'))).toThrow(
      expect.objectContaining({ code: 'device-not-found' }),
    );
  });

  it('knows every device in its catalogue without a gesture', async () => {
    const { transport } = createSimulator({ devices: [hrsStrap({ id: 'a' }), cpsPowerMeter()] });

    expect((await transport.knownDevices()).map((device) => device.identity.id)).toEqual([
      'a',
      cpsPowerMeter().id,
    ]);
  });

  it('moves every device to unavailable when the adapter goes, and back to disconnected', async () => {
    const { transport, bench } = createSimulator({ devices: [hrsStrap({ id: 'strap' })] });
    await transport.connect(deviceId('strap'));
    const beats: MeasurementFor<'heart-rate'>[] = [];
    await transport.subscribe(deviceId('strap'), 'heart-rate', (m) => beats.push(m));
    const states: string[] = [];
    transport.observeConnectionState(deviceId('strap'), (state) => states.push(state));

    bench.setAvailability({ kind: 'adapter-unavailable' });
    expect(await transport.availability()).toEqual({ kind: 'adapter-unavailable' });
    expect(transport.connectionState(deviceId('strap'))).toBe('unavailable');
    bench.advance(seconds(3));
    expect(beats).toEqual([]);
    await transport.discover({ capabilities: [] }).then(
      () => expect.unreachable('an adapter that is off cannot discover'),
      (error: unknown) => expect(isSensorError(error, 'adapter-unavailable')).toBe(true),
    );
    await transport.connect(deviceId('strap')).then(
      () => expect.unreachable('an adapter that is off cannot connect'),
      (error: unknown) => expect(isSensorError(error, 'adapter-unavailable')).toBe(true),
    );
    // Disconnecting what the adapter already dropped is a no-op, not an
    // illegal transition: `unavailable` may only return to `disconnected`
    // when the adapter does.
    await transport.disconnect(deviceId('strap'));
    expect(transport.connectionState(deviceId('strap'))).toBe('unavailable');

    bench.setAvailability({ kind: 'available' });
    expect(transport.connectionState(deviceId('strap'))).toBe('disconnected');
    expect(states).toEqual(['unavailable', 'disconnected']);
  });

  it('maps the other two availability kinds to their error codes', async () => {
    const unsupported = createSimulator({
      devices: [hrsStrap()],
      availability: { kind: 'unsupported' },
    });
    await unsupported.transport.discover({ capabilities: [] }).then(
      () => expect.unreachable('Safari-shaped: no stack at all'),
      (error: unknown) => expect(isSensorError(error, 'transport-unsupported')).toBe(true),
    );

    const denied = createSimulator({
      devices: [hrsStrap()],
      availability: { kind: 'not-permitted' },
    });
    await denied.transport.discover({ capabilities: [] }).then(
      () => expect.unreachable('permission withheld'),
      (error: unknown) => expect(isSensorError(error, 'not-permitted')).toBe(true),
    );
  });
});

describe('what each device kind reports', () => {
  it('the strap reports the rider heart rate once a second, stamped with the virtual clock', async () => {
    const { transport, bench } = createSimulator({
      devices: [hrsStrap({ id: 'strap' })],
      startAt: unixSeconds(1_800_000_000),
    });
    await transport.connect(deviceId('strap'));
    const beats: MeasurementFor<'heart-rate'>[] = [];
    await transport.subscribe(deviceId('strap'), 'heart-rate', (m) => beats.push(m));

    bench.advance(seconds(3));

    expect(beats.map((m) => m.heartRate)).toEqual([145, 145, 145]);
    expect(beats.map((m) => m.at)).toEqual([1_800_000_001, 1_800_000_002, 1_800_000_003]);
  });

  it('the power meter reports rider power and a cadence derived from its crank counter', async () => {
    const { transport, bench } = createSimulator({ devices: [cpsPowerMeter({ id: 'pm' })] });
    await transport.connect(deviceId('pm'));
    const powers: MeasurementFor<'power'>[] = [];
    const cadences: MeasurementFor<'cadence'>[] = [];
    await transport.subscribe(deviceId('pm'), 'power', (m) => powers.push(m));
    await transport.subscribe(deviceId('pm'), 'cadence', (m) => cadences.push(m));

    bench.advance(seconds(10));

    expect(powers).toHaveLength(10);
    expect(powers.every((m) => m.power === 200)).toBe(true);
    // Two readings make the first interval, so nine cadences from ten frames.
    expect(cadences).toHaveLength(9);
    for (const { cadence } of cadences) {
      expect(cadence).toBeCloseTo(90, 0);
    }
  });

  it('a stopped crank holds inside the coast horizon and then reports zero', async () => {
    // #41: no change in revolutions must produce a cadence of zero rather than
    // a retained stale value — but not on the first such frame, or slow
    // pedalling alternates between the real cadence and nought. So: hold for
    // the horizon, then report the stop.
    const { transport, bench } = createSimulator({ devices: [cpsPowerMeter({ id: 'pm' })] });
    await transport.connect(deviceId('pm'));
    const cadences: MeasurementFor<'cadence'>[] = [];
    await transport.subscribe(deviceId('pm'), 'cadence', (m) => cadences.push(m));

    bench.advance(seconds(2));
    bench.rider.set({ cadence: revolutionsPerMinute(0) });
    bench.advance(seconds(4));

    expect(cadences).toHaveLength(1);

    bench.advance(seconds(1));

    expect(cadences).toHaveLength(2);
    expect(cadences[1]?.cadence).toBe(0);
  });

  it('a crank stopped for longer than the counter period yields no cadence on the first turn', async () => {
    // The readings during the stop repeat the last event time. A client that
    // moved its "previous" forward on each of them would see a one-second gap
    // when the crank restarts and compute a cadence from an event-time delta
    // that has silently lapped — about 8 rpm here, plausible and wrong. Keeping
    // the previous reading makes the gap 71 s, which the horizon rejects.
    const { transport, bench } = createSimulator({
      devices: [cpsPowerMeter({ id: 'pm' })],
      startAt: unixSeconds(1_800_000_000),
    });
    await transport.connect(deviceId('pm'));
    const cadences: MeasurementFor<'cadence'>[] = [];
    await transport.subscribe(deviceId('pm'), 'cadence', (m) => cadences.push(m));

    bench.advance(seconds(2));
    bench.rider.set({ cadence: revolutionsPerMinute(0) });
    bench.advance(seconds(70));
    bench.rider.set({ cadence: revolutionsPerMinute(90) });
    bench.advance(seconds(3));

    // The stop itself now reads as a stop rather than as a held value, so the
    // discriminating assertion is on the frames that carry a *rate*: there is
    // none at 1_800_000_073, the first turn of the crank after the stop.
    expect(cadences.filter((m) => m.cadence !== 0).map((m) => m.at)).toEqual([
      1_800_000_002, 1_800_000_074, 1_800_000_075,
    ]);
    expect(cadences.filter((m) => m.cadence === 0).length).toBeGreaterThan(0);
  });

  it('starts the client accumulator afresh on every new link', async () => {
    // A new connection is a new subscription; nothing carries the previous
    // reading across. Without the reset the first frame after a reconnect
    // would pair with a reading from the old link.
    const { transport, bench } = createSimulator({
      devices: [cscsSensor({ id: 'csc' })],
      startAt: unixSeconds(1_800_000_000),
    });
    await transport.connect(deviceId('csc'));
    const cadences: MeasurementFor<'cadence'>[] = [];
    await transport.subscribe(deviceId('csc'), 'cadence', (m) => cadences.push(m));
    bench.advance(seconds(2));

    await transport.disconnect(deviceId('csc'));
    bench.advance(seconds(1));
    await transport.connect(deviceId('csc'));
    // The subscription from the first link is still registered on the session
    // and resumes with it; subscribing again would deliver each sample twice.
    bench.advance(seconds(2));

    expect(cadences.map((m) => m.at)).toEqual([1_800_000_002, 1_800_000_005]);
  });

  it('the speed and cadence sensor declares cadence only, because speed needs a wheel size it does not have', async () => {
    const { transport, bench } = createSimulator({ devices: [cscsSensor({ id: 'csc' })] });
    const device = await transport.discover({ capabilities: [] });
    expect([...device.capabilities]).toEqual(['cadence']);

    await transport.connect(deviceId('csc'));
    const cadences: MeasurementFor<'cadence'>[] = [];
    await transport.subscribe(deviceId('csc'), 'cadence', (m) => cadences.push(m));
    bench.advance(seconds(4));

    expect(cadences).toHaveLength(3);
    expect(cadences[0]?.cadence).toBeCloseTo(90, 0);
    // The wheel counter is still modelled, because the profile carries it and
    // #42 will read it once the athlete's wheel circumference exists.
    expect(bench.device(deviceId('csc')).inspect().frames.cscs?.wheel?.revolutions).toBe(
      Math.floor((9 * 4) / 2.105),
    );
  });

  it('the trainer fans one Indoor Bike Data notification into power, cadence and speed with one instant', async () => {
    const { transport, bench } = createSimulator({
      devices: [ftmsTrainer({ id: 'trainer' })],
      startAt: unixSeconds(1_800_000_000),
    });
    await transport.connect(deviceId('trainer'));
    const all: { capability: string; at: number; value: number }[] = [];
    await transport.subscribe(deviceId('trainer'), 'power', (m) =>
      all.push({ capability: 'power', at: m.at, value: m.power }),
    );
    await transport.subscribe(deviceId('trainer'), 'cadence', (m) =>
      all.push({ capability: 'cadence', at: m.at, value: m.cadence }),
    );
    await transport.subscribe(deviceId('trainer'), 'speed', (m) =>
      all.push({ capability: 'speed', at: m.at, value: m.speed }),
    );

    bench.advance(seconds(1));

    expect(all).toEqual([
      { capability: 'power', at: 1_800_000_001, value: 200 },
      { capability: 'cadence', at: 1_800_000_001, value: 90 },
      { capability: 'speed', at: 1_800_000_001, value: 9 },
    ]);
  });

  it('follows the rider when the bench changes the profile mid-ride', async () => {
    const { transport, bench } = createSimulator({ devices: [ftmsTrainer({ id: 'trainer' })] });
    await transport.connect(deviceId('trainer'));
    const powers: number[] = [];
    await transport.subscribe(deviceId('trainer'), 'power', (m) => powers.push(m.power));

    bench.advance(seconds(1));
    bench.rider.set({ power: watts(310) });
    bench.advance(seconds(1));

    expect(powers).toEqual([200, 310]);
    expect(bench.rider.profile.power).toBe(310);
  });
});

describe('one device, several services — the modern trainer', () => {
  it('is one SensorDevice with every capability, not three devices', async () => {
    const { transport } = createSimulator({ devices: [modernTrainer({ id: 'kickr' })] });
    const device = await transport.discover({ capabilities: ['power', 'cadence', 'speed'] });

    expect(device.identity.id).toBe('kickr');
    expect([...device.capabilities].sort()).toEqual(
      ['cadence', 'power', 'speed', 'trainer-control'].sort(),
    );
    expect(await transport.knownDevices()).toHaveLength(1);
  });

  it('delivers power exactly once per notification cycle though FTMS and CPS both carry it', async () => {
    const { transport, bench } = createSimulator({ devices: [modernTrainer({ id: 'kickr' })] });
    await transport.connect(deviceId('kickr'));
    const powers: MeasurementFor<'power'>[] = [];
    const cadences: MeasurementFor<'cadence'>[] = [];
    await transport.subscribe(deviceId('kickr'), 'power', (m) => powers.push(m));
    await transport.subscribe(deviceId('kickr'), 'cadence', (m) => cadences.push(m));

    bench.advance(seconds(5));

    expect(powers).toHaveLength(5);
    // Cadence comes from FTMS from the first frame; a CSC-derived cadence
    // would have needed two, so five (not four) is also the source assertion.
    expect(cadences).toHaveLength(5);

    // All three services produced a frame each tick, so #41–#43 can compare.
    const frames = bench.device(deviceId('kickr')).inspect().frames;
    expect(frames.ftms?.instantaneousPower).toBe(200);
    expect(frames.cps?.instantaneousPower).toBe(200);
    expect(frames.cscs?.crank).toBeDefined();
  });
});
