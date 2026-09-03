// SPDX-License-Identifier: Apache-2.0

/**
 * The interface's first consumer.
 *
 * An interface with no implementation has no known defects; it has undiscovered
 * ones. So this file implements `SensorTransport` end to end — discovery,
 * connection, subscription, notification, teardown — against an in-memory
 * device catalogue, and drives it the way `apps/web` will.
 *
 * It is a **test double, not a simulator**. #44 owns the simulator, which models
 * a rider and produces plausible telemetry; this models nothing and produces
 * whatever the test hands it. There is no GATT here, no UUID and no payload,
 * because if there were, this file would be #40.
 *
 * Two things it is deliberately arranged to prove, both of which are properties
 * of the *interface* rather than of this implementation:
 *
 * 1. A transport can be written against these types without naming a platform
 *    API — this file compiles inside a package whose `lib` is ES2024 and whose
 *    `types` is empty.
 * 2. The "no measurements while disconnected" rule holds for a transport that
 *    composes `createDeviceSession`, rather than only for the session in
 *    isolation.
 */

import { beatsPerMinute, revolutionsPerMinute, unixSeconds, watts } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  createDeviceSession,
  deviceId,
  isMeasurementOf,
  isSensorError,
  SensorError,
  transportId,
  type ConnectionState,
  type DeviceId,
  type DeviceSession,
  type DiscoveryRequest,
  type Listener,
  type MeasurementCapability,
  type MeasurementFor,
  type SensorDevice,
  type SensorMeasurement,
  type SensorTransport,
  type TransportAvailability,
  type TransportTraits,
  type Unsubscribe,
} from './index';

const MEMORY = transportId('memory');

/**
 * Everything a test wants to vary about a platform, in one place — so the same
 * transport can stand in for Web Bluetooth (gesture required, no silent
 * reconnect, no background) and for a native stack (none of those).
 */
interface MemoryTransportOptions {
  readonly catalogue: readonly SensorDevice[];
  readonly availability?: TransportAvailability;
  readonly traits?: Partial<TransportTraits>;
  /** Whether the caller is currently inside a user gesture. */
  readonly userGesture?: boolean;
}

interface MemoryTransport extends SensorTransport {
  /** Stand in for a GATT notification arriving. */
  notify(measurement: SensorMeasurement): void;
}

function createMemoryTransport(options: MemoryTransportOptions): MemoryTransport {
  const traits: TransportTraits = {
    id: MEMORY,
    requiresUserGestureToDiscover: false,
    canReconnectWithoutUserGesture: true,
    canRestoreConnectionsInBackground: true,
    maxConcurrentConnections: 3,
    ...options.traits,
  };
  const availability: TransportAvailability = options.availability ?? { kind: 'available' };

  // The handle map. #40's Web Bluetooth adapter keeps the same shape, with a
  // BluetoothDevice, a GATT server and a characteristic alongside the session
  // — which is the flattening this interface pushes into the adapter.
  const sessions = new Map<DeviceId, DeviceSession>();

  const sessionFor = (id: DeviceId): DeviceSession => {
    const session = sessions.get(id);
    if (session === undefined) {
      throw new SensorError('device-not-found', 'this transport did not issue that device id', {
        deviceId: id,
      });
    }
    return session;
  };

  /**
   * Run something that may throw, and hand back a promise either way.
   *
   * Found while writing this file: `connect()` returns a `Promise<void>` and is
   * documented to reject, but the obvious implementation — look the device up,
   * throw if it is unknown — throws *synchronously*, before any promise exists.
   * A caller written as `transport.connect(id).catch(show)` then misses the
   * error completely, and the failure looks like an unhandled exception in an
   * event handler rather than an unknown device. `transport.ts` now states the
   * contract; this is how a transport keeps it.
   */
  const attempt = <T>(operation: () => T): Promise<T> => {
    try {
      return Promise.resolve(operation());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const connectedCount = () =>
    [...sessions.values()].filter((session) => session.state === 'connected').length;

  return {
    traits,

    availability() {
      return Promise.resolve(availability);
    },

    discover(request: DiscoveryRequest) {
      return attempt(() => {
        if (availability.kind !== 'available') {
          throw new SensorError(
            availability.kind === 'unsupported' ? 'transport-unsupported' : availability.kind,
            `this transport is ${availability.kind}`,
          );
        }
        if (traits.requiresUserGestureToDiscover && options.userGesture !== true) {
          throw new SensorError(
            'user-gesture-required',
            'discovery must run inside a user gesture',
          );
        }
        const match = options.catalogue.find(
          (candidate) =>
            request.capabilities.every((capability) => candidate.capabilities.has(capability)) &&
            (request.namePrefix === undefined ||
              (candidate.name ?? '').startsWith(request.namePrefix)),
        );
        if (match === undefined) {
          throw new SensorError('no-device-selected', 'the chooser closed without a device');
        }
        if (!sessions.has(match.identity.id)) {
          sessions.set(match.identity.id, createDeviceSession(match));
        }
        return match;
      });
    },

    knownDevices() {
      // Only devices already chosen: the honest answer for a stack that cannot
      // enumerate what it has not been given.
      return attempt(() => [...sessions.values()].map((session) => session.device));
    },

    connect(id: DeviceId) {
      return attempt(() => {
        const session = sessionFor(id);
        if (session.state === 'connected') {
          return;
        }
        if (connectedCount() >= traits.maxConcurrentConnections) {
          throw new SensorError(
            'connection-budget-exceeded',
            `this transport holds at most ${String(traits.maxConcurrentConnections)} connections`,
            { deviceId: id },
          );
        }
        session.transitionTo('connecting');
        session.transitionTo('connected');
      });
    },

    disconnect(id: DeviceId) {
      return attempt(() => {
        sessionFor(id).transitionTo('disconnected');
      });
    },

    connectionState(id: DeviceId): ConnectionState {
      return sessionFor(id).state;
    },

    observeConnectionState(id: DeviceId, listener: Listener<ConnectionState>): Unsubscribe {
      return sessionFor(id).onStateChange(listener);
    },

    subscribe<Capability extends MeasurementCapability>(
      id: DeviceId,
      capability: Capability,
      listener: Listener<MeasurementFor<Capability>>,
    ): Promise<Unsubscribe> {
      return attempt(() => {
        const session = sessionFor(id);
        if (session.state !== 'connected') {
          throw new SensorError('not-connected', 'enabling notifications needs a connection', {
            deviceId: id,
          });
        }
        if (!session.device.capabilities.has(capability)) {
          throw new SensorError(
            'capability-unsupported',
            `this device does not provide ${capability}`,
            { deviceId: id },
          );
        }
        // `isMeasurementOf` rather than a cast. Without it this narrowing is not
        // expressible, because the discriminant is being compared to a generic.
        return session.onMeasurement((measurement) => {
          if (isMeasurementOf(measurement, capability)) {
            listener(measurement);
          }
        });
      });
    },

    notify(measurement: SensorMeasurement) {
      sessionFor(measurement.device.id).report(measurement);
    },
  };
}

const trainer: SensorDevice = {
  identity: { transport: MEMORY, id: deviceId('trainer') },
  name: 'KICKR CORE 1F2A',
  capabilities: new Set(['power', 'cadence', 'speed', 'trainer-control']),
};

const strap: SensorDevice = {
  identity: { transport: MEMORY, id: deviceId('strap') },
  name: 'HRM-Dual 0C3F',
  capabilities: new Set(['heart-rate']),
};

const power = (value: number, at: number): SensorMeasurement => ({
  capability: 'power',
  device: trainer.identity,
  at: unixSeconds(at),
  power: watts(value),
});

const cadence = (at: number): SensorMeasurement => ({
  capability: 'cadence',
  device: trainer.identity,
  at: unixSeconds(at),
  cadence: revolutionsPerMinute(90),
});

describe('a whole pairing flow, driven the way apps/web will drive it', () => {
  it('discovers, connects, streams and tears down', async () => {
    const transport = createMemoryTransport({ catalogue: [trainer, strap] });

    expect(await transport.availability()).toEqual({ kind: 'available' });

    const device = await transport.discover({ capabilities: ['power'] });
    expect(device.name).toBe('KICKR CORE 1F2A');
    expect(transport.connectionState(device.identity.id)).toBe('disconnected');

    const states: ConnectionState[] = [];
    transport.observeConnectionState(device.identity.id, (state) => states.push(state));

    await transport.connect(device.identity.id);
    expect(transport.connectionState(device.identity.id)).toBe('connected');
    expect(states).toEqual(['connecting', 'connected']);

    const received: MeasurementFor<'power'>[] = [];
    const stop = await transport.subscribe(device.identity.id, 'power', (measurement) =>
      received.push(measurement),
    );

    transport.notify(power(212, 1_800_000_000));
    transport.notify(power(198, 1_800_000_001));

    expect(received.map((measurement) => measurement.power)).toEqual([212, 198]);

    stop();
    transport.notify(power(180, 1_800_000_002));
    expect(received).toHaveLength(2);

    await transport.disconnect(device.identity.id);
    expect(transport.connectionState(device.identity.id)).toBe('disconnected');
  });

  it('delivers only the subscribed capability from a device that reports several', async () => {
    // The FTMS fan-out, in miniature: one device reporting power and cadence,
    // a consumer that asked for power. `isMeasurementOf` is what keeps the
    // cadence sample out of the power listener.
    const transport = createMemoryTransport({ catalogue: [trainer] });
    const device = await transport.discover({ capabilities: ['power', 'cadence'] });
    await transport.connect(device.identity.id);

    const powers: MeasurementFor<'power'>[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => powers.push(m));

    transport.notify(power(212, 1_800_000_000));
    transport.notify(cadence(1_800_000_000));

    expect(powers).toHaveLength(1);
    expect(powers[0]?.capability).toBe('power');
  });
});

describe('the transport cannot report measurements while disconnected', () => {
  it('refuses to enable notifications before the connection exists', async () => {
    const transport = createMemoryTransport({ catalogue: [trainer] });
    const device = await transport.discover({ capabilities: ['power'] });

    await expect(transport.subscribe(device.identity.id, 'power', () => undefined)).rejects.toThrow(
      /needs a connection/,
    );
  });

  it('drops nothing to a live subscriber after the link goes away', async () => {
    const transport = createMemoryTransport({ catalogue: [trainer] });
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);

    const received: MeasurementFor<'power'>[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => received.push(m));

    transport.notify(power(212, 1_800_000_000));
    await transport.disconnect(device.identity.id);

    // The subscription is still live — nothing unsubscribed it — and a stray
    // notification after the drop is exactly what a real stack produces.
    expect(() => transport.notify(power(198, 1_800_000_001))).toThrow(/cannot report/);
    expect(received).toHaveLength(1);
  });
});

describe('the platform differences the interface is required to expose', () => {
  it('refuses discovery outside a user gesture when the transport needs one', async () => {
    const webLike = createMemoryTransport({
      catalogue: [trainer],
      traits: {
        requiresUserGestureToDiscover: true,
        canReconnectWithoutUserGesture: false,
        canRestoreConnectionsInBackground: false,
      },
    });

    await expect(webLike.discover({ capabilities: ['power'] })).rejects.toThrow(/user gesture/);
    expect(webLike.traits.canReconnectWithoutUserGesture).toBe(false);
    expect(await webLike.knownDevices()).toEqual([]);
  });

  it('allows the same discovery on a native-shaped transport', async () => {
    const nativeLike = createMemoryTransport({ catalogue: [trainer] });
    const device = await nativeLike.discover({ capabilities: ['power'] });

    expect(device.identity.id).toBe(trainer.identity.id);
    expect(nativeLike.traits.canRestoreConnectionsInBackground).toBe(true);
    expect((await nativeLike.knownDevices()).map((known) => known.name)).toEqual([
      'KICKR CORE 1F2A',
    ]);
  });

  it('tells "nothing was found" apart from "not permitted" and from "no stack"', async () => {
    const nothingMatches = createMemoryTransport({ catalogue: [strap] });
    await nothingMatches.discover({ capabilities: ['power'] }).then(
      () => expect.unreachable('no device provides power here'),
      (error: unknown) => expect(isSensorError(error, 'no-device-selected')).toBe(true),
    );

    const denied = createMemoryTransport({
      catalogue: [trainer],
      availability: { kind: 'not-permitted' },
    });
    await denied.discover({ capabilities: ['power'] }).then(
      () => expect.unreachable('a denied transport must not discover'),
      (error: unknown) => expect(isSensorError(error, 'not-permitted')).toBe(true),
    );

    const safariLike = createMemoryTransport({
      catalogue: [trainer],
      availability: { kind: 'unsupported' },
    });
    await safariLike.discover({ capabilities: ['power'] }).then(
      () => expect.unreachable('an unsupported transport must not discover'),
      (error: unknown) => expect(isSensorError(error, 'transport-unsupported')).toBe(true),
    );
  });

  it('refuses a connection past the transport budget', async () => {
    const catalogue = [
      trainer,
      strap,
      { ...trainer, identity: { transport: MEMORY, id: deviceId('cadence') }, name: 'Cadence' },
      { ...strap, identity: { transport: MEMORY, id: deviceId('spare') }, name: 'Spare' },
    ];
    const transport = createMemoryTransport({ catalogue, traits: { maxConcurrentConnections: 3 } });

    for (const name of ['KICKR CORE 1F2A', 'HRM-Dual 0C3F', 'Cadence']) {
      const device = await transport.discover({ capabilities: [], namePrefix: name });
      await transport.connect(device.identity.id);
    }

    const fourth = await transport.discover({ capabilities: [], namePrefix: 'Spare' });
    await expect(transport.connect(fourth.identity.id)).rejects.toThrow(/at most 3 connections/);
  });

  it('refuses an id it did not issue, even a well-formed one', async () => {
    const transport = createMemoryTransport({ catalogue: [trainer] });
    await expect(transport.connect(deviceId('from-another-phone'))).rejects.toThrow(
      /did not issue that device id/,
    );
  });

  it('refuses a capability the device does not provide', async () => {
    const transport = createMemoryTransport({ catalogue: [strap] });
    const device = await transport.discover({ capabilities: ['heart-rate'] });
    await transport.connect(device.identity.id);

    await expect(transport.subscribe(device.identity.id, 'power', () => undefined)).rejects.toThrow(
      /does not provide power/,
    );

    // And the capability it does provide still works, so the refusal above is
    // not simply a broken subscribe.
    const beats: MeasurementFor<'heart-rate'>[] = [];
    await transport.subscribe(device.identity.id, 'heart-rate', (m) => beats.push(m));
    transport.notify({
      capability: 'heart-rate',
      device: strap.identity,
      at: unixSeconds(1_800_000_000),
      heartRate: beatsPerMinute(142),
    });
    expect(beats.map((m) => m.heartRate)).toEqual([142]);
  });
});
