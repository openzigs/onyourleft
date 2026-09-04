// SPDX-License-Identifier: Apache-2.0

/**
 * The device simulator: a `SensorTransport` with no radio behind it.
 *
 * ## Two faces
 *
 * **The transport face** is `SensorTransport`, implemented without a single
 * change to `../transport.ts`. `apps/web`, the recorder and #43's clients drive
 * it exactly as they will drive #40's Web Bluetooth adapter — and if they
 * could tell the difference, either this file or #39 would be wrong.
 *
 * **The bench face** is what a test holds: a virtual clock, the rider, each
 * device's scenario script and inspection window, and — for a trainer — the
 * FTMS control point. Nothing on the bench is part of #39, and the control
 * point in particular is here because #39 has no write path and #43 owns the
 * command surface (`../transport.ts` says why). A simulator has to serve the
 * device side of that surface before the client side exists, or the client
 * arrives with nothing to be tested against.
 *
 * ## Time
 *
 * There is no timer in this file, because `lib: ["ES2024"]` has no `setTimeout`
 * and this package is forbidden one. The clock is virtual and moves only when
 * `bench.advance` is called, one second at a time — the notification period
 * every profile here uses, and the cadence at which a real FTMS host has been
 * observed writing setpoints. A test that advances thirty seconds runs in
 * microseconds and is exactly reproducible.
 *
 * ## What a real adapter would recognise
 *
 * The handle map keyed by `DeviceId`, the composed `createDeviceSession`, the
 * `attempt` wrapper that turns a synchronous throw into a rejection, one reader
 * per capability chosen at construction from the highest-priority service that
 * carries it, the client-side accumulator that is reset on every new link —
 * each is the shape #40 needs too. That is the point of a second
 * implementation: what both need is the interface's; what only one needs is
 * the adapter's.
 */

import {
  seconds,
  unixSeconds,
  type Seconds,
  type UnixSeconds,
  type Watts,
} from '@onyourleft/domain';

import { MEASUREMENT_CAPABILITIES, type MeasurementCapability } from '../capability';
import type { ConnectionState } from '../connection';
import {
  deviceId as labelDeviceId,
  SIMULATED,
  type DeviceId,
  type DeviceIdentity,
  type SensorDevice,
} from '../device';
import { SensorError, type SensorErrorCode } from '../errors';
import { isMeasurementOf, type MeasurementFor, type SensorMeasurement } from '../measurement';
import { createDeviceSession, type DeviceSession } from '../session';
import type { Listener, Unsubscribe } from '../subscription';
import type {
  DiscoveryRequest,
  SensorTransport,
  TransportAvailability,
  TransportTraits,
} from '../transport';
import {
  COAST_HORIZON,
  deriveCadence,
  type CounterShape,
  type RevolutionReading,
  type TimedReading,
} from './counters';
import { capabilitiesOf, type SimulatedDeviceSpec } from './devices';
import {
  createFtmsMachine,
  type FtmsControlPoint,
  type FtmsInspection,
  type FtmsMachine,
  type IndoorBikeDataFrame,
} from './ftms';
import {
  createCscService,
  createCyclingPowerService,
  createHeartRateService,
  CSC_CRANK,
  CYCLING_POWER_CRANK,
  type CscFrame,
  type CscService,
  type CyclingPowerFrame,
  type CyclingPowerService,
  type HeartRateFrame,
  type HeartRateService,
} from './profiles';
import { DEFAULT_RIDER, type RiderProfile } from './rider';
import type { Scenario } from './scenario';

/**
 * The client-half shapes the simulator differences its own frames against.
 *
 * `profiles.ts`' constants are the **device** half — a counter's width and the
 * rate its clock ticks at. The coast horizon is a client policy rather than a
 * property of the wire, so it is added here, at the only place in this file
 * that plays the client, and with the same value the real profiles use.
 */
const SIMULATED_CPS_CRANK_SHAPE: CounterShape = {
  ...CYCLING_POWER_CRANK,
  coastHorizon: COAST_HORIZON,
};

const SIMULATED_CSC_CRANK_SHAPE: CounterShape = { ...CSC_CRANK, coastHorizon: COAST_HORIZON };

export interface SimulatorOptions {
  readonly devices: readonly SimulatedDeviceSpec[];
  readonly rider?: Partial<RiderProfile>;
  /**
   * Web-shaped by default — no silent reconnect, no background, three
   * connections — because that is what Phase 1 ships against. Gesture
   * detection is a platform fact the simulator cannot observe, so
   * `requiresUserGestureToDiscover` defaults to false. `id` is always
   * `SIMULATED`.
   */
  readonly traits?: Partial<Omit<TransportTraits, 'id'>>;
  readonly availability?: TransportAvailability;
  /** Where the virtual clock starts. Defaults to 1 800 000 000 (2027-01-15). */
  readonly startAt?: UnixSeconds;
  /** `cancel` makes every `discover` end as the athlete pressing cancel. */
  readonly chooser?: 'first-match' | 'cancel';
}

/** What the device would notify right now, per service. */
export interface DeviceFrames {
  readonly ftms?: IndoorBikeDataFrame;
  readonly cps?: CyclingPowerFrame;
  readonly cscs?: CscFrame;
  readonly hrs?: HeartRateFrame;
}

export interface DeviceInspection {
  readonly frames: DeviceFrames;
  readonly ftms?: FtmsInspection;
}

/** One simulated device, as the bench sees it. */
export interface SimulatedDevice {
  readonly device: SensorDevice;
  /** Present when the device serves FTMS. */
  readonly controlPoint: FtmsControlPoint | undefined;
  /**
   * @throws {SensorError} `capability-unsupported` when the scenario needs a
   * service this device does not serve; `not-connected` for a link scenario on
   * a device with no link.
   * @throws {RangeError} for a duration that is not whole seconds, or a silent
   * recovery on a transport whose traits forbid one.
   */
  script(scenario: Scenario): void;
  inspect(): DeviceInspection;
}

export interface SimulatorBench {
  readonly now: UnixSeconds;
  /**
   * Move the clock forward, one second at a time, notifying as it goes.
   *
   * @throws {RangeError} unless `duration` is a whole number of seconds.
   */
  advance(duration: Seconds): void;
  /** @throws {SensorError} `device-not-found` for an id not in the catalogue. */
  device(id: DeviceId): SimulatedDevice;
  readonly rider: {
    readonly profile: RiderProfile;
    set(changes: Partial<RiderProfile>): void;
  };
  /**
   * Switch the adapter, or the permission, or the whole stack. Anything other
   * than `available` moves every device to `unavailable`; returning to
   * `available` moves them to `disconnected`, never back to `connected`.
   */
  setAvailability(availability: TransportAvailability): void;
}

export interface Simulator {
  readonly transport: SensorTransport;
  readonly bench: SimulatorBench;
}

const ONE_SECOND: Seconds = seconds(1);
const DEFAULT_START: UnixSeconds = unixSeconds(1_800_000_000);

/**
 * What one service contributes for one capability on one tick, or nothing when
 * this notification does not carry it — a field the flags left out, or a
 * counter that has not yet produced an interval.
 */
type Reader = (at: UnixSeconds) => SensorMeasurement | undefined;

/** Everything the simulator keeps per device. */
interface DeviceRecord {
  readonly device: SensorDevice;
  readonly session: DeviceSession;
  readonly ftms: FtmsMachine | undefined;
  readonly cps: CyclingPowerService | undefined;
  readonly cscs: CscService | undefined;
  readonly hrs: HeartRateService | undefined;
  /**
   * One reader per capability, from the first service in the spec that carries
   * it. Fixed at construction, as an adapter's source assignment is — so a
   * frame that lacks the field is a gap in the stream, not a switch of source.
   */
  readonly readers: ReadonlyMap<MeasurementCapability, Reader>;
  /** The client half's accumulators start over on every new link. */
  readonly resetClient: () => void;
  dropoutRemaining: number;
  recoverAt: number | undefined;
  handle: SimulatedDevice | undefined;
}

export function createSimulator(options: SimulatorOptions): Simulator {
  const traits: TransportTraits = {
    id: SIMULATED,
    requiresUserGestureToDiscover: false,
    canReconnectWithoutUserGesture: false,
    canRestoreConnectionsInBackground: false,
    maxConcurrentConnections: 3,
    ...options.traits,
  };
  let availability: TransportAvailability = options.availability ?? { kind: 'available' };
  let rider: RiderProfile = { ...DEFAULT_RIDER, ...options.rider };
  let now: number = options.startAt ?? DEFAULT_START;

  const records = new Map<DeviceId, DeviceRecord>();

  for (const spec of options.devices) {
    const id = labelDeviceId(spec.id);
    if (records.has(id)) {
      throw new SensorError('invalid-device-id', `two simulated devices share the id ${id}`, {
        deviceId: id,
      });
    }
    records.set(id, buildRecord(spec, id));
  }

  /**
   * Wire one device: its service models, and a reader per capability closing
   * over the concrete model — so nothing downstream has to ask whether a
   * service exists.
   */
  function buildRecord(spec: SimulatedDeviceSpec, id: DeviceId): DeviceRecord {
    const identity: DeviceIdentity = { transport: SIMULATED, id };
    const device: SensorDevice = { identity, name: spec.name, capabilities: capabilitiesOf(spec) };
    const session = createDeviceSession(device);
    const envelope = (at: UnixSeconds) => ({ device: identity, at });

    let ftms: FtmsMachine | undefined;
    let cps: CyclingPowerService | undefined;
    let cscs: CscService | undefined;
    let hrs: HeartRateService | undefined;
    // A trainer's power is the ERG target while one is held; every service on
    // the same device reports the same physical power.
    const power = (): Watts => ftms?.effectivePower(rider) ?? rider.power;

    const client = new Map<'cps' | 'cscs', TimedReading>();
    const crankCadence = (
      source: 'cps' | 'cscs',
      reading: RevolutionReading,
      at: UnixSeconds,
    ): SensorMeasurement | undefined => {
      const derived = deriveCadence(
        client.get(source),
        { reading, at },
        source === 'cps' ? SIMULATED_CPS_CRANK_SHAPE : SIMULATED_CSC_CRANK_SHAPE,
      );
      client.set(source, derived.next);
      return derived.cadence === undefined
        ? undefined
        : { ...envelope(at), capability: 'cadence', cadence: derived.cadence };
    };

    const readers = new Map<MeasurementCapability, Reader>();
    const register = (capability: MeasurementCapability, reader: Reader): void => {
      // First service in the spec wins — FTMS before CPS before CSC on a
      // trainer, the preference `plan.ts` encodes for the same reason.
      if (!readers.has(capability)) {
        readers.set(capability, reader);
      }
    };

    for (const service of new Set(spec.services)) {
      switch (service) {
        case 'ftms': {
          const machine = createFtmsMachine(spec.ftms ?? {}, {
            deviceId: id,
            isConnected: () => session.state === 'connected',
          });
          ftms = machine;
          register('power', (at) => {
            const value = machine.frame(rider).instantaneousPower;
            return value === undefined
              ? undefined
              : { ...envelope(at), capability: 'power', power: value };
          });
          register('cadence', (at) => {
            const value = machine.frame(rider).instantaneousCadence;
            return value === undefined
              ? undefined
              : { ...envelope(at), capability: 'cadence', cadence: value };
          });
          register('speed', (at) => {
            const value = machine.frame(rider).instantaneousSpeed;
            return value === undefined
              ? undefined
              : { ...envelope(at), capability: 'speed', speed: value };
          });
          break;
        }
        case 'cps': {
          const meter = createCyclingPowerService();
          cps = meter;
          register('power', (at) => ({
            ...envelope(at),
            capability: 'power',
            power: meter.frame(power()).instantaneousPower,
          }));
          register('cadence', (at) => crankCadence('cps', meter.frame(power()).crank, at));
          break;
        }
        case 'cscs': {
          const sensor = createCscService();
          cscs = sensor;
          register('cadence', (at) => crankCadence('cscs', sensor.frame().crank, at));
          break;
        }
        case 'hrs': {
          const strap = createHeartRateService();
          hrs = strap;
          register('heart-rate', (at) => ({
            ...envelope(at),
            capability: 'heart-rate',
            heartRate: strap.frame(rider).heartRate,
          }));
          break;
        }
      }
    }

    return {
      device,
      session,
      ftms,
      cps,
      cscs,
      hrs,
      readers,
      resetClient: () => client.clear(),
      dropoutRemaining: 0,
      recoverAt: undefined,
      handle: undefined,
    };
  }

  const recordFor = (id: DeviceId): DeviceRecord => {
    const record = records.get(id);
    if (record === undefined) {
      throw new SensorError('device-not-found', 'this transport did not issue that device id', {
        deviceId: id,
      });
    }
    return record;
  };

  /** Turn a synchronous throw into a rejection — `../transport.ts`'s contract clause. */
  const attempt = <T>(operation: () => T): Promise<T> => {
    try {
      return Promise.resolve(operation());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const availabilityErrorCode = (): SensorErrorCode | undefined => {
    switch (availability.kind) {
      case 'available':
        return undefined;
      case 'unsupported':
        return 'transport-unsupported';
      case 'not-permitted':
      case 'adapter-unavailable':
        return availability.kind;
    }
  };

  const requireAvailable = (): void => {
    const code = availabilityErrorCode();
    if (code !== undefined) {
      throw new SensorError(code, `this transport is ${availability.kind}`);
    }
  };

  const holdingASlot = (): number =>
    [...records.values()].filter(
      (record) => record.session.state === 'connected' || record.session.state === 'reconnecting',
    ).length;

  /** A link is up; any scheduled recovery is moot. */
  const linkEstablished = (record: DeviceRecord): void => {
    record.recoverAt = undefined;
  };

  /**
   * The bearer is gone, whatever the session says next. The client half's
   * accumulators go with it — a reading from the old link must never pair with
   * one from the new — and so does the trainer's per-connection state.
   */
  const linkLost = (record: DeviceRecord): void => {
    record.resetClient();
    record.dropoutRemaining = 0;
    record.recoverAt = undefined;
    record.ftms?.onLinkLost();
  };

  const frames = (record: DeviceRecord): DeviceFrames => {
    const power = record.ftms?.effectivePower(rider) ?? rider.power;
    return {
      ...(record.ftms === undefined ? {} : { ftms: record.ftms.frame(rider) }),
      ...(record.cps === undefined ? {} : { cps: record.cps.frame(power) }),
      ...(record.cscs === undefined ? {} : { cscs: record.cscs.frame() }),
      ...(record.hrs === undefined ? {} : { hrs: record.hrs.frame(rider) }),
    };
  };

  /** One notification cycle: every service notifies, each capability is delivered once. */
  const deliver = (record: DeviceRecord): void => {
    const at = unixSeconds(now);
    for (const capability of MEASUREMENT_CAPABILITIES) {
      const measurement = record.readers.get(capability)?.(at);
      if (measurement !== undefined) {
        record.session.report(measurement);
      }
    }
  };

  const tick = (): void => {
    now += 1;
    for (const record of records.values()) {
      // The device side runs whether or not anyone is listening: a strap on a
      // chest keeps beating and a crank keeps turning through a dropout.
      record.ftms?.advance(rider, ONE_SECOND);
      record.cps?.advance(rider, ONE_SECOND);
      record.cscs?.advance(rider, ONE_SECOND);

      if (record.recoverAt !== undefined && now >= record.recoverAt) {
        record.session.transitionTo('connected');
        linkEstablished(record);
      }
      if (record.session.state !== 'connected') {
        continue;
      }
      // Indications are acknowledged; a notification dropout does not lose them.
      record.ftms?.flush();
      if (record.dropoutRemaining > 0) {
        record.dropoutRemaining -= 1;
        continue;
      }
      deliver(record);
    }
  };

  const requireWholeSeconds = (duration: Seconds, what: string): number => {
    if (!Number.isInteger(duration)) {
      throw new RangeError(
        `${what} must be a whole number of seconds, received ${String(duration)}`,
      );
    }
    return duration;
  };

  const requireFtms = (record: DeviceRecord): FtmsMachine => {
    if (record.ftms === undefined) {
      throw new SensorError(
        'capability-unsupported',
        'this device does not provide trainer-control',
        { deviceId: record.device.identity.id },
      );
    }
    return record.ftms;
  };

  const handleFor = (record: DeviceRecord): SimulatedDevice => {
    record.handle ??= {
      device: record.device,
      controlPoint: record.ftms?.controlPoint,

      script(scenario) {
        switch (scenario.kind) {
          case 'disconnect': {
            if (record.session.state !== 'connected' && record.session.state !== 'reconnecting') {
              throw new SensorError('not-connected', 'there is no link to drop', {
                deviceId: record.device.identity.id,
              });
            }
            if (scenario.recoverAfter === undefined) {
              record.session.transitionTo('disconnected');
              linkLost(record);
              return;
            }
            if (!traits.canReconnectWithoutUserGesture) {
              throw new RangeError(
                'this transport cannot reconnect without a user gesture; drop recoverAfter or set the trait',
              );
            }
            const recoverAfter = requireWholeSeconds(scenario.recoverAfter, 'recoverAfter');
            record.session.transitionTo('reconnecting');
            linkLost(record);
            record.recoverAt = now + recoverAfter;
            return;
          }
          case 'notification-dropout':
            record.dropoutRemaining = requireWholeSeconds(scenario.duration, 'a dropout');
            return;
          case 'counter-wrap':
            if (record.cps === undefined && record.cscs === undefined) {
              throw new SensorError(
                'capability-unsupported',
                'no service on this device carries a revolution counter',
                { deviceId: record.device.identity.id },
              );
            }
            record.cps?.armWrap();
            record.cscs?.armWrap();
            return;
          case 'control-permission-lost':
            requireFtms(record).losePermission();
            return;
          case 'indoor-bike-data-fields':
            requireFtms(record).setFields(scenario.fields);
            return;
        }
      },

      inspect() {
        return {
          frames: frames(record),
          ...(record.ftms === undefined ? {} : { ftms: record.ftms.inspect() }),
        };
      },
    };
    return record.handle;
  };

  const transport: SensorTransport = {
    traits,

    availability() {
      return Promise.resolve(availability);
    },

    discover(request: DiscoveryRequest) {
      return attempt(() => {
        requireAvailable();
        const match =
          options.chooser === 'cancel'
            ? undefined
            : [...records.values()].find(
                ({ device }) =>
                  request.capabilities.every((capability) => device.capabilities.has(capability)) &&
                  (request.namePrefix === undefined ||
                    (device.name ?? '').startsWith(request.namePrefix)),
              );
        if (match === undefined) {
          throw new SensorError('no-device-selected', 'the chooser closed without a device');
        }
        return match.device;
      });
    },

    knownDevices() {
      return attempt(() => [...records.values()].map((record) => record.device));
    },

    connect(id: DeviceId) {
      return attempt(() => {
        const record = recordFor(id);
        requireAvailable();
        if (record.session.state === 'connected') {
          return;
        }
        if (record.session.state === 'reconnecting') {
          // The slot is already held and the caller is only hurrying the
          // restore along.
          record.session.transitionTo('connected');
          linkEstablished(record);
          return;
        }
        if (holdingASlot() >= traits.maxConcurrentConnections) {
          throw new SensorError(
            'connection-budget-exceeded',
            `this transport holds at most ${String(traits.maxConcurrentConnections)} connections`,
            { deviceId: id },
          );
        }
        record.session.transitionTo('connecting');
        record.session.transitionTo('connected');
        linkEstablished(record);
      });
    },

    disconnect(id: DeviceId) {
      return attempt(() => {
        const record = recordFor(id);
        if (record.session.state === 'unavailable') {
          return;
        }
        record.session.transitionTo('disconnected');
        linkLost(record);
      });
    },

    connectionState(id: DeviceId): ConnectionState {
      return recordFor(id).session.state;
    },

    observeConnectionState(id: DeviceId, listener: Listener<ConnectionState>): Unsubscribe {
      return recordFor(id).session.onStateChange(listener);
    },

    subscribe<Capability extends MeasurementCapability>(
      id: DeviceId,
      capability: Capability,
      listener: Listener<MeasurementFor<Capability>>,
    ): Promise<Unsubscribe> {
      return attempt(() => {
        const record = recordFor(id);
        if (record.session.state !== 'connected') {
          throw new SensorError('not-connected', 'enabling notifications needs a connection', {
            deviceId: id,
          });
        }
        if (!record.device.capabilities.has(capability)) {
          throw new SensorError(
            'capability-unsupported',
            `this device does not provide ${capability}`,
            { deviceId: id },
          );
        }
        return record.session.onMeasurement((measurement) => {
          if (isMeasurementOf(measurement, capability)) {
            listener(measurement);
          }
        });
      });
    },
  };

  const bench: SimulatorBench = {
    get now() {
      return unixSeconds(now);
    },

    advance(duration) {
      const whole = requireWholeSeconds(duration, 'advance');
      for (let step = 0; step < whole; step += 1) {
        tick();
      }
    },

    device(id) {
      return handleFor(recordFor(id));
    },

    rider: {
      get profile() {
        return rider;
      },
      set(changes) {
        rider = { ...rider, ...changes };
      },
    },

    setAvailability(next) {
      availability = next;
      for (const record of records.values()) {
        if (next.kind !== 'available') {
          if (record.session.state !== 'unavailable') {
            record.session.transitionTo('unavailable');
            linkLost(record);
          }
        } else if (record.session.state === 'unavailable') {
          record.session.transitionTo('disconnected');
        }
      }
    },
  };

  return { transport, bench };
}
