// SPDX-License-Identifier: Apache-2.0

/**
 * Scripted misbehaviour, each one provably reachable.
 *
 * #44: *"disconnect mid-notification, return a non-success control result,
 * ignore a setpoint, emit an unusual flag combination, drop notifications for
 * 30 seconds, and wrap its counters on demand."* The control-result and
 * ignored-setpoint cases are in `control-point.test.ts`; the rest are here.
 *
 * Every test drives a scenario and asserts its **observable consequence through
 * `SensorTransport`** — what a subscriber received, what a state observer saw.
 * A scenario that changes only the simulator's internal state is decoration; a
 * scenario nobody has watched fire is worse, because it is documented as
 * reproducing a fault it does not reproduce.
 */

import {
  EVENT_TICKS_PER_SECOND_1024,
  seconds,
  UINT16_MODULUS,
  unixSeconds,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { deviceId, type ConnectionState, type MeasurementFor } from '../index';
import { createSimulator, cscsSensor, ftmsTrainer, hrsStrap, modernTrainer } from './index';

const ID = deviceId('device');

describe('mid-operation disconnect', () => {
  it('on a web-shaped transport the link is simply gone, and nothing more is delivered', async () => {
    const { transport, bench } = createSimulator({ devices: [hrsStrap({ id: 'device' })] });
    await transport.connect(ID);
    const states: ConnectionState[] = [];
    transport.observeConnectionState(ID, (state) => states.push(state));
    const beats: MeasurementFor<'heart-rate'>[] = [];
    await transport.subscribe(ID, 'heart-rate', (m) => beats.push(m));

    bench.advance(seconds(2));
    bench.device(ID).script({ kind: 'disconnect' });
    bench.advance(seconds(5));

    expect(states).toEqual(['disconnected']);
    expect(transport.connectionState(ID)).toBe('disconnected');
    expect(beats).toHaveLength(2);
    // There is no link left to drop.
    expect(() => bench.device(ID).script({ kind: 'disconnect' })).toThrow(
      expect.objectContaining({ code: 'not-connected' }),
    );
  });

  it('a caller may connect explicitly while the transport is still reconnecting', async () => {
    const { transport, bench } = createSimulator({
      devices: [hrsStrap({ id: 'device' })],
      traits: { canReconnectWithoutUserGesture: true },
    });
    await transport.connect(ID);
    const states: ConnectionState[] = [];
    transport.observeConnectionState(ID, (state) => states.push(state));

    bench.device(ID).script({ kind: 'disconnect', recoverAfter: seconds(30) });
    await transport.connect(ID);
    bench.advance(seconds(31));

    // Straight back to connected — not through `connecting`, which is for a
    // link this program did not already have — and the scheduled recovery
    // does not fire a second transition later.
    expect(states).toEqual(['reconnecting', 'connected']);
  });

  it('on a native-shaped transport the link goes to reconnecting, delivers nothing, and comes back on its own', async () => {
    const { transport, bench } = createSimulator({
      devices: [hrsStrap({ id: 'device' })],
      traits: { canReconnectWithoutUserGesture: true },
      startAt: unixSeconds(1_800_000_000),
    });
    await transport.connect(ID);
    const states: ConnectionState[] = [];
    transport.observeConnectionState(ID, (state) => states.push(state));
    const beats: MeasurementFor<'heart-rate'>[] = [];
    await transport.subscribe(ID, 'heart-rate', (m) => beats.push(m));

    bench.advance(seconds(2));
    bench.device(ID).script({ kind: 'disconnect', recoverAfter: seconds(3) });
    expect(transport.connectionState(ID)).toBe('reconnecting');
    bench.advance(seconds(5));

    expect(states).toEqual(['reconnecting', 'connected']);
    // Two before the drop, nothing during the three seconds of reconnecting,
    // then the stream resumes without the caller touching `connect`.
    expect(beats.map((m) => m.at)).toEqual([
      1_800_000_001, 1_800_000_002, 1_800_000_005, 1_800_000_006, 1_800_000_007,
    ]);
  });

  it('a scheduled recovery is cancelled when the adapter goes away', async () => {
    const { transport, bench } = createSimulator({
      devices: [hrsStrap({ id: 'device' })],
      traits: { canReconnectWithoutUserGesture: true },
    });
    await transport.connect(ID);
    const states: ConnectionState[] = [];
    transport.observeConnectionState(ID, (state) => states.push(state));

    bench.device(ID).script({ kind: 'disconnect', recoverAfter: seconds(2) });
    bench.setAvailability({ kind: 'adapter-unavailable' });
    // The recovery would have fired here; `unavailable` may only return to
    // `disconnected`, and only when the adapter does.
    bench.advance(seconds(5));
    expect(transport.connectionState(ID)).toBe('unavailable');

    bench.setAvailability({ kind: 'available' });
    bench.advance(seconds(5));
    expect(states).toEqual(['reconnecting', 'unavailable', 'disconnected']);
  });

  it('refuses a silent recovery on a transport whose traits say it cannot', async () => {
    const { transport, bench } = createSimulator({ devices: [hrsStrap({ id: 'device' })] });
    await transport.connect(ID);

    expect(() => bench.device(ID).script({ kind: 'disconnect', recoverAfter: seconds(3) })).toThrow(
      /cannot reconnect without a user gesture/,
    );
  });
});

describe('a 30-second notification dropout', () => {
  it('delivers nothing for 30 s while the connection state never leaves connected', async () => {
    const { transport, bench } = createSimulator({
      devices: [ftmsTrainer({ id: 'device' })],
      startAt: unixSeconds(1_800_000_000),
    });
    await transport.connect(ID);
    const states: ConnectionState[] = [];
    transport.observeConnectionState(ID, (state) => states.push(state));
    const powers: MeasurementFor<'power'>[] = [];
    await transport.subscribe(ID, 'power', (m) => powers.push(m));

    bench.advance(seconds(2));
    bench.device(ID).script({ kind: 'notification-dropout', duration: seconds(30) });
    bench.advance(seconds(32));

    expect(states).toEqual([]);
    expect(transport.connectionState(ID)).toBe('connected');
    expect(powers.map((m) => m.at)).toEqual([
      1_800_000_001, 1_800_000_002, 1_800_000_033, 1_800_000_034,
    ]);
    expect(() =>
      bench.device(ID).script({ kind: 'notification-dropout', duration: seconds(0.5) }),
    ).toThrow(/whole number of seconds/);
  });

  it('a dropout longer than the event-time horizon makes the first cadence afterwards untrustworthy, so none is emitted', async () => {
    // 64 s at 1/1024 s is where the uint16 counter laps. After a 70 s silence
    // the delta reads as 6 s, and a client that trusted it would report
    // roughly a thousand rpm. `@onyourleft/domain` documents exactly this and
    // tells the consumer to drop the sample; this proves the simulator's own
    // client half obeys.
    const { transport, bench } = createSimulator({
      devices: [cscsSensor({ id: 'device' })],
      startAt: unixSeconds(1_800_000_000),
    });
    await transport.connect(ID);
    const cadences: MeasurementFor<'cadence'>[] = [];
    await transport.subscribe(ID, 'cadence', (m) => cadences.push(m));

    bench.advance(seconds(3));
    bench.device(ID).script({ kind: 'notification-dropout', duration: seconds(70) });
    bench.advance(seconds(73));

    const afterDropout = cadences.filter((m) => m.at > 1_800_000_003);
    // Frames resume at +74; the first (+74) is dropped as ambiguous, +75 and
    // +76 are emitted.
    expect(afterDropout.map((m) => m.at)).toEqual([1_800_000_075, 1_800_000_076]);
    for (const { cadence } of cadences) {
      expect(cadence).toBeCloseTo(90, 0);
    }
  });
});

describe('counter wrap on demand', () => {
  it('the crank event time and revolution count both lap, and the cadence stream does not notice', async () => {
    // Scripted before connecting: a sensor's counters hold whatever value they
    // reached since power-on, so "just below the wrap" is a legitimate starting
    // point. Teleporting a counter under a connected client is not something a
    // real sensor does, and the simulator does not pretend otherwise.
    const { transport, bench } = createSimulator({ devices: [cscsSensor({ id: 'device' })] });
    const before = bench.device(ID).inspect().frames.cscs?.crank;
    bench.device(ID).script({ kind: 'counter-wrap' });
    const armed = bench.device(ID).inspect().frames.cscs?.crank;

    await transport.connect(ID);
    const cadences: MeasurementFor<'cadence'>[] = [];
    await transport.subscribe(ID, 'cadence', (m) => cadences.push(m));
    bench.advance(seconds(5));
    const after = bench.device(ID).inspect().frames.cscs?.crank;

    // Armed: both counters sit just below their modulus. After: both have
    // gone round. That is the wrap, observed at the device.
    expect(before).toEqual({ revolutions: 0, lastEventTimeTicks: 0 });
    expect(armed?.revolutions).toBe(UINT16_MODULUS - 2);
    expect(armed?.lastEventTimeTicks).toBeGreaterThan(
      UINT16_MODULUS - 2 * EVENT_TICKS_PER_SECOND_1024,
    );
    expect(after?.revolutions).toBeLessThan(armed?.revolutions ?? 0);
    expect(after?.lastEventTimeTicks).toBeLessThan(armed?.lastEventTimeTicks ?? 0);

    // And through the interface: five frames, four intervals, every cadence
    // still 90 — including the one that straddles the wrap.
    expect(cadences).toHaveLength(4);
    for (const { cadence } of cadences) {
      expect(cadence).toBeCloseTo(90, 0);
    }
  });

  it('arms every counter-bearing service on a modern trainer, and is refused on a device with none', () => {
    const { bench } = createSimulator({ devices: [modernTrainer({ id: 'device' })] });

    bench.device(ID).script({ kind: 'counter-wrap' });
    const frames = bench.device(ID).inspect().frames;
    expect(frames.cps?.crank?.revolutions).toBe(UINT16_MODULUS - 2);
    expect(frames.cscs?.crank?.revolutions).toBe(UINT16_MODULUS - 2);
    expect(frames.cscs?.wheel?.revolutions).toBe(0);

    const strap = createSimulator({ devices: [hrsStrap({ id: 'device' })] });
    expect(() => strap.bench.device(ID).script({ kind: 'counter-wrap' })).toThrow(
      expect.objectContaining({ code: 'capability-unsupported' }),
    );
  });
});

describe('an unusual-but-valid Indoor Bike Data field set', () => {
  it('speed present (flag bit 0 clear), total distance present, no cadence: the cadence stream goes quiet, the rest continue', async () => {
    const { transport, bench } = createSimulator({
      devices: [ftmsTrainer({ id: 'device' })],
      startAt: unixSeconds(1_800_000_000),
    });
    await transport.connect(ID);
    const speeds: MeasurementFor<'speed'>[] = [];
    const cadences: MeasurementFor<'cadence'>[] = [];
    const powers: MeasurementFor<'power'>[] = [];
    await transport.subscribe(ID, 'speed', (m) => speeds.push(m));
    await transport.subscribe(ID, 'cadence', (m) => cadences.push(m));
    await transport.subscribe(ID, 'power', (m) => powers.push(m));

    bench.advance(seconds(1));
    bench.device(ID).script({
      kind: 'indoor-bike-data-fields',
      fields: new Set(['instantaneous-speed', 'total-distance', 'instantaneous-power']),
    });
    bench.advance(seconds(2));

    expect(cadences.map((m) => m.at)).toEqual([1_800_000_001]);
    expect(speeds.map((m) => m.at)).toEqual([1_800_000_001, 1_800_000_002, 1_800_000_003]);
    expect(powers.map((m) => m.at)).toEqual([1_800_000_001, 1_800_000_002, 1_800_000_003]);

    const frame = bench.device(ID).inspect().frames.ftms;
    expect(frame?.instantaneousCadence).toBeUndefined();
    // 9 m/s for three seconds, accumulated on the device from the start.
    expect(frame?.totalDistance).toBe(27);
  });

  it('can also be the trainer’s field set from the start, as a builder option', async () => {
    const { transport, bench } = createSimulator({
      devices: [ftmsTrainer({ id: 'device', fields: new Set(['instantaneous-power']) })],
    });
    await transport.connect(ID);
    const speeds: MeasurementFor<'speed'>[] = [];
    const powers: MeasurementFor<'power'>[] = [];
    await transport.subscribe(ID, 'speed', (m) => speeds.push(m));
    await transport.subscribe(ID, 'power', (m) => powers.push(m));

    bench.advance(seconds(2));

    expect(speeds).toEqual([]);
    expect(powers).toHaveLength(2);
  });

  it('is refused on a device with no FTMS service', async () => {
    const { transport, bench } = createSimulator({ devices: [hrsStrap({ id: 'device' })] });
    await transport.connect(ID);

    expect(() =>
      bench.device(ID).script({
        kind: 'indoor-bike-data-fields',
        fields: new Set(['instantaneous-power']),
      }),
    ).toThrow(expect.objectContaining({ code: 'capability-unsupported' }));
  });
});

describe('the virtual clock', () => {
  it('advances in whole seconds only, because every profile here notifies at 1 Hz', () => {
    const { bench } = createSimulator({ devices: [], startAt: unixSeconds(1_800_000_000) });

    expect(() => bench.advance(seconds(1.5))).toThrow(/whole number of seconds/);
    bench.advance(seconds(2));
    expect(bench.now).toBe(1_800_000_002);
  });
});
