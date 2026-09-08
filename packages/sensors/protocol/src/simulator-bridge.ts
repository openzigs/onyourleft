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
 * **Not exported from `index.ts`.** A test fixture, like `testing.ts`.
 */

import {
  gradePercent,
  metresPerSecond,
  resistanceLevel,
  seconds,
  watts,
  type Watts,
} from '@onyourleft/domain';

import { deviceId, type DeviceId, type MeasurementFor } from '../../src/index';
import {
  createSimulator,
  ftmsTrainer,
  FITNESS_MACHINE_STATUS_OP_CODE,
  FTMS_CONTROL_OP_CODE,
  FTMS_RESULT_CODE,
  type FitnessMachineStatus,
  type FtmsControlRequest,
  type FtmsControlResponse,
  type FtmsOptions,
  type IndoorBikeDataFrame,
  type SimulatedDevice,
  type SimulatedDeviceSpec,
  type SimulatorBench,
} from '../../src/simulator/index';
import type { Unsubscribe } from '../../src/subscription';

import { decodeSupportedPowerRange, decodeSupportedResistanceLevelRange } from './fitness-machine';
import {
  createTrainerControl,
  type FitnessMachineChannel,
  type ScheduleTimeout,
  type TrainerControl,
} from './fitness-machine-control';

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
