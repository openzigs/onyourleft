// SPDX-License-Identifier: Apache-2.0

/**
 * The #44 simulator's typed device surface, as the octets a client writes and
 * reads — and a connected trainer built from it.
 *
 * ## Why this is a module rather than a block at the top of one test
 *
 * It was the latter until #90. `fitness-machine-simulator.test.ts` carried it,
 * and #90 needs the same bridge for a second set of assertions — the ordering
 * of the bytes on the wire, a machine that stops answering, and a device that
 * serves a proprietary control point beside the standard one. Copying it would
 * have produced two encoders of one wire format, which is the failure
 * `testing.ts` exists to avoid, one directory over.
 *
 * ## ⚠️ It is written from the specification tables with literal offsets
 *
 * Deliberately, and it must stay that way: it does **not** call
 * {@link encodeControlRequest} or `decodeIndoorBikeData` to do its half. Two
 * implementations that share an arithmetic mistake cancel it out invisibly, so
 * a bridge that round-tripped through the client's own codec would only assert
 * that the codec agrees with itself.
 *
 * ## What it proves that a scripted machine cannot
 *
 * A scripted fake answers what a test tells it to. The simulator has its own
 * state, its own control-permission rules and its own 1 Hz notification loop,
 * so an assertion made through here reads the trainer back **along the path a
 * rider's data takes** — `transport.subscribe('power')`, the stream the ride
 * recorder consumes. A client that reported an applied setpoint while the
 * machine held something else fails here and cannot fail against a fake.
 *
 * **Not exported from `index.ts`.** A test fixture — but it IS reachable, as
 * `@onyourleft/sensors/protocol/testing`, the way `web-bluetooth/testing`
 * already is. #14's control loop is composed in `apps/web` (the player may not
 * name a characteristic, the writer may not name a workout), so the one place
 * the loop can be driven against a trainer with its own state is a test over
 * there. A second bridge written in `apps/web` would be exactly the second
 * encoder of one wire format this module exists to prevent.
 */

import {
  gradePercent,
  metresPerSecond,
  resistanceLevel,
  seconds,
  watts,
  type BeatsPerMinute,
  type Watts,
} from '@onyourleft/domain';

import { deviceId, type DeviceId, type MeasurementFor } from '../../src/index';
import {
  createSimulator,
  ftmsTrainer,
  steeringController,
  type AppInformation,
  type ControllerNotification,
  type SimulatedController,
  FITNESS_MACHINE_STATUS_OP_CODE,
  FTMS_CONTROL_OP_CODE,
  FTMS_RESULT_CODE,
  type FitnessMachineStatus,
  type FtmsControlRequest,
  type FtmsControlResponse,
  type FtmsOptions,
  type HeartRateFrame,
  type IndoorBikeDataFrame,
  type SimulatedDevice,
  type SimulatedDeviceSpec,
  type SimulatorBench,
} from '../../src/simulator/index';
import type { Unsubscribe } from '../../src/subscription';

import {
  decodeSupportedPowerRange,
  decodeSupportedResistanceLevelRange,
  type SupportedPowerRange,
} from './fitness-machine';
import {
  createTrainerControl,
  type FitnessMachineChannel,
  type ScheduleTimeout,
  type TrainerControl,
} from './fitness-machine-control';
import { heartRateProfile } from './heart-rate';
import {
  OPEN_BIKE_CONTROL_APP_INFORMATION,
  OPEN_BIKE_CONTROL_BUTTON_STATE,
  OPEN_BIKE_CONTROL_HAPTIC,
  OPEN_BIKE_CONTROL_SERVICE,
} from './open-bike-control';
import type { MeasurementSink } from './profile';
import type { GattUuid } from './uuid';

export const viewOf = (bytes: readonly number[]): DataView => {
  const array = Uint8Array.from(bytes);
  return new DataView(array.buffer, array.byteOffset, array.byteLength);
};

export const int16 = (raw: number): [number, number] => {
  const unsigned = raw < 0 ? raw + 0x1_0000 : raw;
  return [unsigned & 0xff, (unsigned >>> 8) & 0xff];
};

export const readInt16 = (bytes: Uint8Array, at: number): number => {
  const low = bytes[at] ?? 0;
  const high = bytes[at + 1] ?? 0;
  const unsigned = low | (high << 8);
  return unsigned > 0x7fff ? unsigned - 0x1_0000 : unsigned;
};

/** Octets in, one of the simulator's typed requests out. FTMS Tables 4.15 and 4.20. */
export function requestFromOctets(bytes: Uint8Array): FtmsControlRequest {
  switch (bytes[0]) {
    case 0x00:
      return { opCode: 'request-control' };
    case 0x01:
      return { opCode: 'reset' };
    case 0x04:
      return { opCode: 'set-target-resistance', level: resistanceLevel((bytes[1] ?? 0) / 10) };
    case 0x05:
      return { opCode: 'set-target-power', target: watts(readInt16(bytes, 1)) };
    case 0x08:
      return { opCode: 'stop-or-pause', stop: bytes[1] === 0x01 };
    case 0x11:
      return {
        opCode: 'set-simulation-parameters',
        parameters: {
          windSpeed: metresPerSecond(readInt16(bytes, 1) / 1000),
          grade: gradePercent(readInt16(bytes, 3) / 100),
          rollingResistanceCoefficient: (bytes[5] ?? 0) / 10_000,
          windResistanceCoefficient: (bytes[6] ?? 0) / 100,
        },
      };
    default:
      throw new Error(`the bridge does not encode op code ${String(bytes[0])}`);
  }
}

/** FTMS Table 4.23: `0x80`, the request op code, the result code. */
export const responseToOctets = (response: FtmsControlResponse): DataView =>
  viewOf([0x80, FTMS_CONTROL_OP_CODE[response.requestOpCode], FTMS_RESULT_CODE[response.result]]);

/** FTMS Table 4.26. */
export function statusToOctets(status: FitnessMachineStatus): DataView {
  const op = FITNESS_MACHINE_STATUS_OP_CODE[status.kind];
  switch (status.kind) {
    case 'target-power-changed':
      return viewOf([op, ...int16(status.target)]);
    case 'target-resistance-changed':
      return viewOf([op, Math.round(status.level * 10)]);
    default:
      return viewOf([op]);
  }
}

/**
 * GSS v9 §3.124, written out with literal offsets.
 *
 * ⚠️ Bit 0 is **More Data**: speed present means the bit is **clear**.
 */
export function frameToOctets(frame: IndoorBikeDataFrame): DataView {
  const octets: number[] = [];
  let flags = 0;
  if (frame.instantaneousSpeed === undefined) {
    flags |= 1 << 0;
  } else {
    octets.push(...int16(Math.round(frame.instantaneousSpeed * 3.6 * 100)));
  }
  if (frame.instantaneousCadence !== undefined) {
    flags |= 1 << 2;
    octets.push(...int16(Math.round(frame.instantaneousCadence * 2)));
  }
  if (frame.totalDistance !== undefined) {
    flags |= 1 << 4;
    const metres = Math.round(frame.totalDistance);
    octets.push(metres & 0xff, (metres >>> 8) & 0xff, (metres >>> 16) & 0xff);
  }
  if (frame.instantaneousPower !== undefined) {
    flags |= 1 << 6;
    octets.push(...int16(Math.round(frame.instantaneousPower)));
  }
  return viewOf([...int16(flags), ...octets]);
}

/**
 * GSS v9 §3.113, Heart Rate Measurement (`0x2A37`), written out with literal
 * offsets (#1238) — so `decodeHeartRateMeasurement` is checked against the
 * specification rather than against itself.
 *
 * Bit 0 is the value's width: clear for a `uint8`, set for a `uint16`, which a
 * value over 255 needs. Bits 1 and 2 are Sensor Contact Status: bit 2 says the
 * strap can tell, bit 1 that it is on the chest.
 */
export function heartRateFrameToOctets(frame: HeartRateFrame): DataView {
  let flags = 0;
  const value = frame.heartRate;
  const octets: number[] = [];
  if (value > 0xff) {
    flags |= 1 << 0;
    octets.push(value & 0xff, (value >>> 8) & 0xff);
  } else {
    octets.push(value);
  }
  if (frame.sensorContact !== 'unsupported') {
    flags |= 1 << 2;
    if (frame.sensorContact === 'detected') {
      flags |= 1 << 1;
    }
  }
  return viewOf([flags, ...octets]);
}

/**
 * Every heart rate a strap notifies, read through the **real** Heart Rate
 * profile (#1238): each notification encoded by
 * {@link heartRateFrameToOctets} and decoded by `heartRateProfile`, the code a
 * rider's strap is read with. A reading the decoder drops — a strap off the
 * chest — never reaches `listener`, and a dropout delivers nothing at all.
 */
export function heartRatesThroughTheDecoder(
  bench: SimulatorBench,
  id: DeviceId,
  listener: (heartRate: BeatsPerMinute) => void,
): Unsubscribe {
  return bench.device(id).onNotify((frames) => {
    if (frames.hrs === undefined) {
      return;
    }
    heartRateProfile.decode(
      heartRateFrameToOctets(frames.hrs),
      { ...IGNORED_SINK, 'heart-rate': listener },
      bench.now,
    );
  });
}

const ignore = (): void => undefined;

const IGNORED_SINK: MeasurementSink = {
  power: ignore,
  cadence: ignore,
  speed: ignore,
  'heart-rate': ignore,
};

/**
 * One thing that crossed the control point, in the order it crossed.
 *
 * Writes and indications in **one** log rather than two, because the assertions
 * #90 asks for are about their interleaving: *no `0x11` reaches the wire before
 * a successful `0x80 0x00 0x01`* cannot be checked against two separate lists
 * without reconstructing the order they were recorded in.
 */
export interface WireEntry {
  readonly direction: 'write' | 'indication';
  readonly bytes: readonly number[];
}

export interface SimulatedTrainerBench {
  readonly bench: SimulatorBench;
  readonly control: TrainerControl;
  /**
   * The Supported Power Range as the client decoded it from the machine's own
   * octets — what a caller that needs the trainer's floor reads (#441), rather
   * than a number a test types in.
   */
  readonly powerRange: SupportedPowerRange;
  readonly deviceId: DeviceId;
  readonly handle: () => SimulatedDevice;
  readonly powers: MeasurementFor<'power'>[];
  /** Every octet in both directions, in order. */
  readonly wire: readonly WireEntry[];
  /** A property rather than a method, so it survives being destructured. */
  readonly targetPowerOnTheTrainer: () => Watts | undefined;
  /** The gradient the machine is currently simulating, if any. */
  readonly gradeOnTheTrainer: () => number | undefined;
  /**
   * Stop answering control point writes: the promise a write returns never
   * settles until {@link release}.
   *
   * A trainer that has gone quiet — the case a rate limiter has to survive
   * without a backlog forming. Held writes are not lost; they land, in order,
   * when released.
   */
  readonly stall: () => void;
  readonly release: () => void;
}

export interface SimulatedTrainerOptions {
  /** Defaults to `ftmsTrainer({ id: 'kickr' })`. */
  readonly spec?: SimulatedDeviceSpec | undefined;
  /**
   * Defaults to `false`, unlike the client's own default, so that the gap after
   * a lost permission is observable at all. The re-acquiring path has its own
   * tests that turn it on.
   */
  readonly reacquireControl?: boolean | undefined;
  readonly scheduleTimeout?: ScheduleTimeout | undefined;
}

/**
 * A connected trainer, its control point bridged to octets, and a client built
 * from the ranges **the trainer itself reported**.
 */
export async function connectSimulatedTrainer(
  options: SimulatedTrainerOptions = {},
): Promise<SimulatedTrainerBench> {
  const spec = options.spec ?? ftmsTrainer({ id: 'kickr' });
  const id = deviceId(spec.id);
  const { transport, bench } = createSimulator({ devices: [spec] });
  await transport.connect(id);
  const powers: MeasurementFor<'power'>[] = [];
  await transport.subscribe(id, 'power', (measurement) => powers.push(measurement));

  const handle = () => bench.device(id);
  const controlPoint = handle().controlPoint;
  if (controlPoint === undefined) {
    throw new Error('the trainer serves no control point');
  }
  const ranges = handle().supportedRanges;
  if (ranges === undefined) {
    throw new Error('the trainer reports no supported ranges');
  }

  // Read the two range characteristics the way a client does: as octets, through
  // this package's own decoders. A range constructed in the test would be the
  // hard-coded assumption #43's criterion forbids.
  const powerRange = decodeSupportedPowerRange(
    viewOf([
      ...int16(ranges.minTargetPower),
      ...int16(ranges.maxTargetPower),
      ...int16(ranges.powerIncrement),
    ]),
  );
  const resistanceRange = decodeSupportedResistanceLevelRange(
    viewOf([
      ...int16(Math.round(ranges.minResistanceLevel * 10)),
      ...int16(Math.round(ranges.maxResistanceLevel * 10)),
      ...int16(Math.round(ranges.resistanceIncrement * 10)),
    ]),
  );

  const wire: WireEntry[] = [];
  let stalled = false;
  let held: Array<() => void> = [];

  const channel: FitnessMachineChannel = {
    enableControlPointIndications: () => {
      controlPoint.enableIndications();
      return Promise.resolve();
    },
    onControlPointIndication(listener): Unsubscribe {
      return controlPoint.onResponse((response) => {
        const value = responseToOctets(response);
        wire.push({
          direction: 'indication',
          bytes: [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)],
        });
        listener(value);
      });
    },
    onStatus(listener): Unsubscribe {
      return controlPoint.onStatus((status) => listener(statusToOctets(status)));
    },
    writeControlPoint(value): Promise<void> {
      // Recorded BEFORE the machine sees it, so a write the machine refuses is
      // still in the log. "No 0x11 before Request Control succeeded" is a claim
      // about what reached the wire, not about what the trainer accepted.
      wire.push({ direction: 'write', bytes: [...value] });
      const deliver = (): void => {
        const outcome = controlPoint.write(requestFromOctets(value));
        if (outcome.kind === 'att-error') {
          throw new Error(outcome.error);
        }
        // The simulator delivers the indication on its next tick, which is also
        // the tick that notifies Indoor Bike Data. Advancing here rather than in
        // the test is what makes the indication arrive *during* the write — the
        // ordering a real stack is free to choose, and the one that catches a
        // client subscribing after its write.
        bench.advance(seconds(1));
      };
      if (!stalled) {
        try {
          deliver();
        } catch (error) {
          return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
        return Promise.resolve();
      }
      return new Promise<void>((resolve, reject) => {
        held.push(() => {
          try {
            deliver();
            resolve();
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      });
    },
  };

  return {
    bench,
    deviceId: id,
    handle,
    powerRange,
    control: createTrainerControl(channel, {
      powerRange,
      resistanceRange,
      reacquireControl: options.reacquireControl ?? false,
      ...(options.scheduleTimeout === undefined
        ? {}
        : { scheduleTimeout: options.scheduleTimeout }),
    }),
    powers,
    wire,
    targetPowerOnTheTrainer: () => handle().inspect().ftms?.targetPower,
    gradeOnTheTrainer: () => handle().inspect().ftms?.simulation?.grade,
    stall: () => {
      stalled = true;
    },
    release: () => {
      stalled = false;
      const pending = held;
      held = [];
      for (const run of pending) {
        run();
      }
    },
  };
}

// --- The OpenBikeControl controller (#1823) ---------------------------------
//
// The simulator's controller notifies typed changes; these write them as the
// octets a real controller sends, with literal values from the specification
// (OpenBikeControl v1, `BLE.md` and `PROTOCOL.md` at `760a7b15`), and never
// through `open-bike-control.ts`' own arithmetic. The UUIDs are taken from
// there: they are names, not arithmetic.

/** A pair's state octet: released, pressed. */
const OBC_RELEASED = 0x00;
const OBC_PRESSED = 0x01;

/**
 * One notification as a controller sends it: `0x01`, then id and state pairs.
 * An angle is `0x80` plus half-degree steps, clamped to `0x02`..`0xFE` (±63°)
 * as the specification tells a device to clamp it; no angle is `0x00`.
 */
export function controllerNotificationToOctets(notification: ControllerNotification): DataView {
  if (notification.kind === 'malformed') {
    switch (notification.shape) {
      case 'empty':
        return viewOf([]);
      case 'no-buttons':
        return viewOf([0x01]);
      case 'unknown-message-type':
        // The haptic message type, where a button state belongs.
        return viewOf([0x03, 0x18, 0x01]);
      case 'odd-length':
        return viewOf([0x01, 0x18, 0x01, 0x19]);
      case 'oversized':
        // 40 pairs: past any cap a client could reasonably set from the
        // specification's recommended nine.
        return viewOf([0x01, ...Array.from({ length: 40 }, () => [0x20, 0x01]).flat()]);
    }
  }
  const octets = [0x01];
  for (const change of notification.changes) {
    switch (change.kind) {
      case 'press':
        octets.push(change.button, OBC_PRESSED);
        break;
      case 'release':
        octets.push(change.button, OBC_RELEASED);
        break;
      case 'angle':
        octets.push(0x1b, Math.min(0xfe, Math.max(0x02, 0x80 + Math.round(change.degrees * 2))));
        break;
      case 'angle-unavailable':
        octets.push(0x1b, 0x00);
        break;
    }
  }
  return viewOf(octets);
}

/**
 * The device's reading of an app-information write: `0x04`, format `0x01`, a
 * length-prefixed id, a length-prefixed version, a count and the ids. Read
 * with literal offsets; `undefined` for a write the device cannot read, which
 * the specification lets it ignore.
 */
export function appInformationFromOctets(bytes: Uint8Array): AppInformation | undefined {
  if (bytes[0] !== 0x04 || bytes[1] !== 0x01) return undefined;
  const text = (from: number, length: number): string | undefined =>
    from + length > bytes.length
      ? undefined
      : String.fromCharCode(...bytes.subarray(from, from + length));
  const idLength = bytes[2];
  if (idLength === undefined) return undefined;
  const appId = text(3, idLength);
  const versionAt = 3 + idLength;
  const versionLength = bytes[versionAt];
  if (appId === undefined || versionLength === undefined) return undefined;
  const appVersion = text(versionAt + 1, versionLength);
  const countAt = versionAt + 1 + versionLength;
  const count = bytes[countAt];
  if (appVersion === undefined || count === undefined) return undefined;
  if (countAt + 1 + count !== bytes.length) return undefined;
  return { appId, appVersion, buttons: [...bytes.subarray(countAt + 1)] };
}

/** What a characteristic of the simulated controller allows. */
export type ControllerCharacteristicProperty = 'notify' | 'write' | 'write-without-response';

/** One write the controller received, in the order received. */
export interface ControllerWrite {
  readonly characteristic: GattUuid;
  readonly bytes: readonly number[];
}

/**
 * The simulated controller as a central sees it over GATT: what it
 * advertises, its characteristics, a link, notifications and writes. Flat and
 * object-free, so a Web Bluetooth double (#1824) and a Capacitor plugin double
 * (#1825) can each be built over it.
 */
export interface SimulatedControllerGatt {
  readonly name: string;
  readonly advertisedServices: readonly GattUuid[];
  readonly characteristics: ReadonlyMap<GattUuid, readonly ControllerCharacteristicProperty[]>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  /** Called once each time the link goes down, whoever dropped it. */
  onDisconnect(listener: () => void): Unsubscribe;
  /**
   * Subscribe to a notifying characteristic. A subscription lasts one link,
   * as a real one does: after a disconnect a client subscribes again.
   *
   * @throws {Error} when not connected, or for a characteristic that does not notify.
   */
  startNotifications(characteristic: GattUuid, listener: (value: DataView) => void): Unsubscribe;
  /**
   * Write to a writable characteristic. Recorded before the device reads it,
   * so a write the device cannot make sense of is still in {@link writes}.
   *
   * @throws {Error} when not connected, or for a characteristic that is not writable.
   */
  write(characteristic: GattUuid, value: Uint8Array): void;
  /** Every write received, in order, on every characteristic. */
  writes(): readonly ControllerWrite[];
}

export interface SimulatedControllerBench {
  readonly bench: SimulatorBench;
  readonly deviceId: DeviceId;
  readonly controller: SimulatedController;
  readonly gatt: SimulatedControllerGatt;
}

export interface SimulatedControllerOptions {
  /** Defaults to `steeringController()` with no script. */
  readonly spec?: SimulatedDeviceSpec | undefined;
  /** Other devices on the same simulator: a trainer, a strap. */
  readonly others?: readonly SimulatedDeviceSpec[] | undefined;
}

const CONTROLLER_CHARACTERISTICS: ReadonlyMap<
  GattUuid,
  readonly ControllerCharacteristicProperty[]
> = new Map<GattUuid, readonly ControllerCharacteristicProperty[]>([
  [OPEN_BIKE_CONTROL_BUTTON_STATE, ['notify']],
  [OPEN_BIKE_CONTROL_HAPTIC, ['write', 'write-without-response']],
  [OPEN_BIKE_CONTROL_APP_INFORMATION, ['write', 'write-without-response']],
]);

/**
 * A simulated OpenBikeControl controller on a fresh simulator, not yet
 * connected. Advance `bench` to play its script.
 */
export function openSimulatedController(
  options: SimulatedControllerOptions = {},
): SimulatedControllerBench {
  const spec = options.spec ?? steeringController();
  const id = deviceId(spec.id);
  const { transport, bench } = createSimulator({ devices: [spec, ...(options.others ?? [])] });
  const controller = bench.device(id).controller;
  if (controller === undefined) {
    throw new Error('that device serves no OpenBikeControl controller');
  }
  const written: ControllerWrite[] = [];
  let subscriptions: Unsubscribe[] = [];
  const connected = (): boolean => transport.connectionState(id) === 'connected';
  const requireConnected = (what: string): void => {
    if (!connected()) throw new Error(`${what} needs a connection`);
  };
  const properties = (characteristic: GattUuid): readonly ControllerCharacteristicProperty[] =>
    CONTROLLER_CHARACTERISTICS.get(characteristic) ?? [];

  // A subscription dies with its link.
  let linked = false;
  const disconnectListeners: Array<() => void> = [];
  transport.observeConnectionState(id, (state) => {
    if (state === 'connected') {
      linked = true;
      return;
    }
    if (linked) {
      linked = false;
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions = [];
      for (const listener of [...disconnectListeners]) listener();
    }
  });

  const gatt: SimulatedControllerGatt = {
    name: spec.name,
    advertisedServices: [OPEN_BIKE_CONTROL_SERVICE],
    characteristics: CONTROLLER_CHARACTERISTICS,
    connect: () => transport.connect(id),
    disconnect: () => transport.disconnect(id),
    isConnected: connected,
    onDisconnect(listener) {
      disconnectListeners.push(listener);
      return () => {
        const at = disconnectListeners.indexOf(listener);
        if (at !== -1) disconnectListeners.splice(at, 1);
      };
    },
    startNotifications(characteristic, listener) {
      requireConnected('subscribing');
      if (!properties(characteristic).includes('notify')) {
        throw new Error(`the controller does not notify on ${characteristic}`);
      }
      const unsubscribe = controller.onNotification((notification) => {
        listener(controllerNotificationToOctets(notification));
      });
      subscriptions.push(unsubscribe);
      return unsubscribe;
    },
    write(characteristic, value) {
      requireConnected('writing');
      if (!properties(characteristic).includes('write')) {
        throw new Error(`the controller has no writable ${characteristic}`);
      }
      written.push({ characteristic, bytes: [...value] });
      if (characteristic === OPEN_BIKE_CONTROL_APP_INFORMATION) {
        const information = appInformationFromOctets(value);
        if (information !== undefined) controller.receiveAppInformation(information);
      }
    },
    writes: () => [...written],
  };

  return { bench, deviceId: id, controller, gatt };
}

/** The #43 shape, kept so its own tests read as they did. */
export function connectedTrainer(
  options: FtmsOptions & { readonly id?: string } = {},
  reacquireControl = false,
): Promise<SimulatedTrainerBench> {
  return connectSimulatedTrainer({
    spec: ftmsTrainer({ id: 'kickr', ...options }),
    reacquireControl,
  });
}
