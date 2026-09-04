// SPDX-License-Identifier: Apache-2.0

/**
 * #39's third acceptance criterion, asserted through the public surface.
 *
 * > *"Connection state is explicit — disconnected, connecting, connected,
 * > reconnecting, unavailable — and a test proves a transport cannot report
 * > measurements while disconnected."*
 *
 * The proof below never reads a flag. It subscribes the way a recorder does,
 * drives the session the way a transport does, and asserts on **what the
 * subscriber received** — so it fails if the guard is removed, and it also fails
 * if the guard is kept but the measurement is delivered anyway, which is the
 * version a flag assertion would miss.
 */

import { beatsPerMinute, unixSeconds, watts } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  CORE_BLUETOOTH,
  createDeviceSession,
  deviceId,
  isSensorError,
  WEB_BLUETOOTH,
  type ConnectionState,
  type SensorDevice,
  type SensorMeasurement,
} from './index';

const trainerIdentity = { transport: WEB_BLUETOOTH, id: deviceId('trainer-1') };

const trainer: SensorDevice = {
  identity: trainerIdentity,
  name: 'KICKR CORE 1F2A',
  capabilities: new Set(['power', 'cadence', 'speed', 'trainer-control']),
};

function powerAt(secondsSinceEpoch: number, value: number): SensorMeasurement {
  return {
    capability: 'power',
    device: trainerIdentity,
    at: unixSeconds(secondsSinceEpoch),
    power: watts(value),
  };
}

describe('a session starts disconnected and cannot report', () => {
  it('delivers nothing to a subscriber while disconnected', () => {
    const session = createDeviceSession(trainer);
    const received: SensorMeasurement[] = [];
    session.onMeasurement((measurement) => received.push(measurement));

    expect(session.state).toBe('disconnected');
    expect(() => session.report(powerAt(1_800_000_000, 210))).toThrow(
      /state disconnected cannot report/,
    );
    // The assertion that matters: the subscriber saw nothing. A guard that
    // threw *after* emitting would pass a `toThrow` on its own.
    expect(received).toEqual([]);
  });

  it('reports the refusal as not-connected, not as a device fault', () => {
    const session = createDeviceSession(trainer);
    try {
      session.report(powerAt(1_800_000_000, 210));
      expect.unreachable('reporting while disconnected must throw');
    } catch (error) {
      expect(isSensorError(error, 'not-connected')).toBe(true);
    }
  });
});

describe('the full lifecycle a transport drives', () => {
  it('delivers only between connected and the next state change', () => {
    const session = createDeviceSession(trainer);
    const received: SensorMeasurement[] = [];
    const states: ConnectionState[] = [];
    session.onMeasurement((measurement) => received.push(measurement));
    session.onStateChange((state) => states.push(state));

    session.transitionTo('connecting');
    expect(() => session.report(powerAt(1_800_000_001, 205))).toThrow(/cannot report/);

    session.transitionTo('connected');
    session.report(powerAt(1_800_000_002, 210));
    expect(received).toHaveLength(1);

    // A native stack losing the link. Still not allowed to deliver: a flushed
    // buffer would arrive with stale receive instants.
    session.transitionTo('reconnecting');
    expect(() => session.report(powerAt(1_800_000_003, 215))).toThrow(/cannot report/);

    session.transitionTo('connected');
    session.report(powerAt(1_800_000_004, 220));

    session.transitionTo('disconnected');
    expect(() => session.report(powerAt(1_800_000_005, 225))).toThrow(/cannot report/);

    expect(received.map((measurement) => measurement.at)).toEqual([1_800_000_002, 1_800_000_004]);
    expect(states).toEqual([
      'connecting',
      'connected',
      'reconnecting',
      'connected',
      'disconnected',
    ]);
  });

  it('refuses a transition the lifecycle does not permit and stays put', () => {
    const session = createDeviceSession(trainer);
    const states: ConnectionState[] = [];
    session.onStateChange((state) => states.push(state));

    expect(() => session.transitionTo('connected')).toThrow(
      /cannot move from disconnected to connected/,
    );
    expect(session.state).toBe('disconnected');
    expect(states).toEqual([]);

    try {
      session.transitionTo('reconnecting');
      expect.unreachable('disconnected -> reconnecting must throw');
    } catch (error) {
      expect(isSensorError(error, 'illegal-state-transition')).toBe(true);
    }
  });

  it('treats a re-announcement of the current state as a no-op', () => {
    const session = createDeviceSession(trainer);
    const states: ConnectionState[] = [];
    session.onStateChange((state) => states.push(state));

    session.transitionTo('connecting');
    session.transitionTo('connecting');
    session.transitionTo('connected');
    session.transitionTo('connected');

    // Two announcements, two changes. A subscriber that redrew on every
    // announcement would redraw twice as often for no reason.
    expect(states).toEqual(['connecting', 'connected']);
  });
});

describe('a session belongs to one device on one transport', () => {
  function connectedSession() {
    const session = createDeviceSession(trainer);
    session.transitionTo('connecting');
    session.transitionTo('connected');
    return session;
  }

  it('refuses a measurement from another device', () => {
    const session = connectedSession();
    const received: SensorMeasurement[] = [];
    session.onMeasurement((measurement) => received.push(measurement));

    expect(() =>
      session.report({
        capability: 'power',
        device: { transport: WEB_BLUETOOTH, id: deviceId('some-other-meter') },
        at: unixSeconds(1_800_000_000),
        power: watts(180),
      }),
    ).toThrow(/from another device/);
    expect(received).toEqual([]);
  });

  it('refuses a measurement carrying this id from a different stack', () => {
    // The same opaque id, a different transport. If `report` compared ids alone
    // this would be delivered, and every single-platform test would still pass.
    const session = connectedSession();
    const received: SensorMeasurement[] = [];
    session.onMeasurement((measurement) => received.push(measurement));

    expect(() =>
      session.report({
        capability: 'power',
        device: { transport: CORE_BLUETOOTH, id: trainerIdentity.id },
        at: unixSeconds(1_800_000_000),
        power: watts(180),
      }),
    ).toThrow(/from another device/);
    expect(received).toEqual([]);
  });

  it('refuses a capability the device does not provide', () => {
    const session = connectedSession();
    const received: SensorMeasurement[] = [];
    session.onMeasurement((measurement) => received.push(measurement));

    expect(() =>
      session.report({
        capability: 'heart-rate',
        device: trainerIdentity,
        at: unixSeconds(1_800_000_000),
        heartRate: beatsPerMinute(142),
      }),
    ).toThrow(/does not provide heart-rate/);
    expect(received).toEqual([]);
  });
});

describe('subscriptions', () => {
  function connectedSession() {
    const session = createDeviceSession(trainer);
    session.transitionTo('connecting');
    session.transitionTo('connected');
    return session;
  }

  it('stops delivering once unsubscribed, and unsubscribing twice is harmless', () => {
    const session = connectedSession();
    const received: SensorMeasurement[] = [];
    const stop = session.onMeasurement((measurement) => received.push(measurement));

    session.report(powerAt(1_800_000_000, 200));
    stop();
    stop();
    session.report(powerAt(1_800_000_001, 201));

    expect(received).toHaveLength(1);
  });

  it('still reaches later subscribers when one unsubscribes itself mid-notify', () => {
    // "Stop recording when the trainer reports zero power" unsubscribes from
    // inside its own callback. Iterating the live array would skip the next
    // listener, dropping a sample nobody can reproduce.
    const session = connectedSession();
    const second: SensorMeasurement[] = [];
    const stopFirst = session.onMeasurement(() => {
      stopFirst();
    });
    session.onMeasurement((measurement) => second.push(measurement));

    session.report(powerAt(1_800_000_000, 0));

    expect(second).toHaveLength(1);
  });

  it('does not deliver to a listener another listener removed mid-notify', () => {
    // ⚠️ This is the behaviour that says `emit` no longer copies its listener
    // array — a copy captures the second listener before it is removed and calls
    // it anyway, which is a delivery after unsubscribe. `emit` runs on every
    // notification from every sensor once #40's adapter is driving it, so the
    // copy was an array allocated and discarded ten thousand times an hour.
    const session = connectedSession();
    const second: SensorMeasurement[] = [];
    let stopSecond: () => void = () => undefined;
    session.onMeasurement(() => {
      stopSecond();
    });
    stopSecond = session.onMeasurement((measurement) => second.push(measurement));

    session.report(powerAt(1_800_000_000, 200));

    expect(second).toHaveLength(0);
  });

  it('does not call a listener added from inside a notification for that notification', () => {
    const session = connectedSession();
    const late: SensorMeasurement[] = [];
    session.onMeasurement(() => {
      session.onMeasurement((measurement) => late.push(measurement));
    });

    session.report(powerAt(1_800_000_000, 200));
    expect(late).toHaveLength(0);

    session.report(powerAt(1_800_000_001, 201));
    // One subscriber was added by the first report and a second by the second,
    // so the value added first sees exactly one delivery.
    expect(late).toHaveLength(1);
  });

  it('keeps delivering to the survivors after a removal during a notification', () => {
    // The blanked slot has to be compacted, and compacted correctly: an
    // off-by-one here silently drops whichever subscriber followed the removed
    // one, for the rest of the ride.
    const session = connectedSession();
    const first: SensorMeasurement[] = [];
    const third: SensorMeasurement[] = [];
    session.onMeasurement((measurement) => first.push(measurement));
    const stopSecond = session.onMeasurement(() => {
      stopSecond();
    });
    session.onMeasurement((measurement) => third.push(measurement));

    session.report(powerAt(1_800_000_000, 200));
    session.report(powerAt(1_800_000_001, 201));
    session.report(powerAt(1_800_000_002, 202));

    expect(first).toHaveLength(3);
    expect(third).toHaveLength(3);
  });

  it('keeps notifying after a listener throws', () => {
    // A caller's listener is a caller's code. Without the `finally`, the depth
    // counter never returns to zero, every later removal is blanked and never
    // compacted, and the list is quietly broken for the life of the page.
    const session = connectedSession();
    const later: SensorMeasurement[] = [];
    const stop = session.onMeasurement(() => {
      throw new Error('a subscriber blew up');
    });

    expect(() => session.report(powerAt(1_800_000_000, 200))).toThrow('a subscriber blew up');
    stop();
    session.onMeasurement((measurement) => later.push(measurement));
    session.report(powerAt(1_800_000_001, 201));

    expect(later).toHaveLength(1);
  });
});
