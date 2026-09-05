// SPDX-License-Identifier: Apache-2.0

/**
 * The FTMS client driven against the **#44 simulator**, with no hardware.
 *
 * #43's eighth acceptance criterion: *"All protocol tests run against the #44
 * simulator in CI with no hardware."* `ubuntu-latest` has no Bluetooth adapter,
 * so this is the run that has to hold.
 *
 * ## The bridge, and why it does not call this package's own encoder
 *
 * The simulator models the device **as field-presence records and typed
 * requests**, not as octets — `src/simulator/README` and `../README.md` both
 * bar GATT payload from that directory, because the encoder for a
 * characteristic is the mirror of the decoder and belongs beside it. So
 * something has to turn one into the other, and that something is here.
 *
 * ⚠️ **It is written from the specification tables with literal offsets**, and
 * deliberately does not call {@link encodeControlRequest} or
 * {@link decodeIndoorBikeData} to do its half. Two implementations that share
 * an arithmetic mistake cancel it out invisibly, which is exactly the failure
 * `testing.ts` exists to avoid; a bridge that round-tripped through the client's
 * own codec would assert that the codec agrees with itself.
 *
 * ## What this proves that the scripted machine in
 * `fitness-machine-control.test.ts` cannot
 *
 * The scripted machine answers what a test tells it to. The simulator has its
 * own state, its own control-permission rules and its own 1 Hz notification
 * loop — so the assertions here read the setpoint back **through the path a
 * rider's data takes**: `transport.subscribe('power')`, the same stream the
 * ride recorder consumes. A client that reported an applied target while the
 * trainer held something else fails here and cannot fail against a fake.
 */

import {
  gradePercent,
  metresPerSecond,
  resistanceLevel,
  seconds,
  watts,
  type Watts,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { deviceId, type MeasurementFor } from '../../src/index';
import {
  createSimulator,
  ftmsTrainer,
  FITNESS_MACHINE_STATUS_OP_CODE,
  FTMS_CONTROL_OP_CODE,
  FTMS_RESULT_CODE,
  type FitnessMachineStatus,
  type FtmsControlRequest,
  type FtmsControlResponse,
  type IndoorBikeDataFrame,
  type SimulatorBench,
} from '../../src/simulator/index';
import type { Unsubscribe } from '../../src/subscription';

import {
  decodeIndoorBikeData,
  decodeSupportedPowerRange,
  decodeSupportedResistanceLevelRange,
} from './fitness-machine';
import {
  createTrainerControl,
  encodeControlRequest,
  type FitnessMachineChannel,
  type TrainerControl,
} from './fitness-machine-control';

const TRAINER = deviceId('kickr');

// --- The bridge: the simulator's typed surface, as octets --------------------

const viewOf = (bytes: readonly number[]): DataView => {
  const array = Uint8Array.from(bytes);
  return new DataView(array.buffer, array.byteOffset, array.byteLength);
};

const int16 = (raw: number): [number, number] => {
  const unsigned = raw < 0 ? raw + 0x1_0000 : raw;
  return [unsigned & 0xff, (unsigned >>> 8) & 0xff];
};

const readInt16 = (bytes: Uint8Array, at: number): number => {
  const low = bytes[at] ?? 0;
  const high = bytes[at + 1] ?? 0;
  const unsigned = low | (high << 8);
  return unsigned > 0x7fff ? unsigned - 0x1_0000 : unsigned;
};

/** Octets in, one of the simulator's typed requests out. FTMS Tables 4.15 and 4.20. */
function requestFromOctets(bytes: Uint8Array): FtmsControlRequest {
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
const responseToOctets = (response: FtmsControlResponse): DataView =>
  viewOf([0x80, FTMS_CONTROL_OP_CODE[response.requestOpCode], FTMS_RESULT_CODE[response.result]]);

/** FTMS Table 4.26. */
function statusToOctets(status: FitnessMachineStatus): DataView {
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
function frameToOctets(frame: IndoorBikeDataFrame): DataView {
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

interface Bench {
  readonly bench: SimulatorBench;
  readonly control: TrainerControl;
  readonly powers: MeasurementFor<'power'>[];
  /** A property rather than a method, so it survives being destructured. */
  readonly targetPowerOnTheTrainer: () => Watts | undefined;
}

/**
 * A connected trainer, its control point bridged to octets, and a client built
 * from the ranges **the trainer itself reported**.
 *
 * `reacquireControl` defaults to `false` here so that the gap after a lost
 * permission is observable at all; the re-acquiring path has its own test that
 * turns it on.
 */

async function connectedTrainer(
  options: Parameters<typeof ftmsTrainer>[0] = {},
  reacquireControl = false,
): Promise<Bench> {
  const { transport, bench } = createSimulator({
    devices: [ftmsTrainer({ id: 'kickr', ...options })],
  });
  await transport.connect(TRAINER);
  const powers: MeasurementFor<'power'>[] = [];
  await transport.subscribe(TRAINER, 'power', (measurement) => powers.push(measurement));

  const handle = bench.device(TRAINER);
  const controlPoint = handle.controlPoint;
  if (controlPoint === undefined) {
    throw new Error('the trainer serves no control point');
  }
  const ranges = handle.supportedRanges;
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

  const channel: FitnessMachineChannel = {
    enableControlPointIndications: () => {
      controlPoint.enableIndications();
      return Promise.resolve();
    },
    onControlPointIndication(listener): Unsubscribe {
      return controlPoint.onResponse((response) => listener(responseToOctets(response)));
    },
    onStatus(listener): Unsubscribe {
      return controlPoint.onStatus((status) => listener(statusToOctets(status)));
    },
    writeControlPoint(value): Promise<void> {
      const outcome = controlPoint.write(requestFromOctets(value));
      if (outcome.kind === 'att-error') {
        return Promise.reject(new Error(outcome.error));
      }
      // The simulator delivers the indication on its next tick, which is also
      // the tick that notifies Indoor Bike Data. Advancing here rather than in
      // the test is what makes the indication arrive *during* the write — the
      // ordering a real stack is free to choose, and the one that catches a
      // client subscribing after its write.
      bench.advance(seconds(1));
      return Promise.resolve();
    },
  };

  return {
    bench,
    control: createTrainerControl(channel, { powerRange, resistanceRange, reacquireControl }),
    powers,
    targetPowerOnTheTrainer: () => bench.device(TRAINER).inspect().ftms?.targetPower,
  };
}

// --- ERG, end to end ---------------------------------------------------------

describe('ERG mode against the simulated trainer', () => {
  it('holds the target, and the POWER STREAM a recorder consumes shows it', async () => {
    const { bench, control, powers, targetPowerOnTheTrainer } = await connectedTrainer();

    await control.requestControl();
    await control.setTargetPower(watts(250));
    bench.advance(seconds(3));

    // Read back through the path a rider's data takes, not off the object the
    // test just wrote to. The rider's own effort is 200 W; every frame after
    // the setpoint carries the target instead.
    expect(powers.map((measurement) => measurement.power).slice(-3)).toStrictEqual([250, 250, 250]);
    expect(targetPowerOnTheTrainer()).toBe(250);
    expect(control.targetPower()).toStrictEqual({ kind: 'confirmed', target: 250 });
  });

  it('refuses a setpoint before Request Control, and the trainer holds nothing', async () => {
    const { bench, control, powers, targetPowerOnTheTrainer } = await connectedTrainer();

    await expect(control.setTargetPower(watts(250))).rejects.toThrow(/control/);
    bench.advance(seconds(2));

    expect(targetPowerOnTheTrainer()).toBeUndefined();
    // The rider's own 200 W throughout: nothing was applied.
    expect(new Set(powers.map((measurement) => measurement.power))).toStrictEqual(new Set([200]));
  });

  it('bounds the target by the range THIS trainer reported, not by a constant', async () => {
    const { control } = await connectedTrainer({ maxTargetPower: watts(400) });
    await control.requestControl();

    await expect(control.setTargetPower(watts(500))).rejects.toThrow(/400/);
    expect(await control.setTargetPower(watts(400))).toBe(400);
  });

  it('quantises to the increment this trainer reported, and the trainer accepts it', async () => {
    const { control, targetPowerOnTheTrainer } = await connectedTrainer({
      powerIncrement: watts(25),
    });
    await control.requestControl();

    expect(await control.setTargetPower(watts(260))).toBe(250);
    expect(targetPowerOnTheTrainer()).toBe(250);
  });

  it('sets a target of zero and the trainer holds it', async () => {
    const { bench, control, powers, targetPowerOnTheTrainer } = await connectedTrainer();
    await control.requestControl();

    await control.setTargetPower(watts(0));
    bench.advance(seconds(2));

    expect(targetPowerOnTheTrainer()).toBe(0);
    expect(powers.map((measurement) => measurement.power).slice(-2)).toStrictEqual([0, 0]);
  });
});

// --- Simulation and resistance ----------------------------------------------

describe('simulation mode against the simulated trainer', () => {
  it('sets a negative gradient with the sign intact all the way to the machine', async () => {
    const { bench, control } = await connectedTrainer();
    await control.requestControl();

    await control.setSimulationParameters({ grade: gradePercent(-6.2) });

    expect(bench.device(TRAINER).inspect().ftms?.simulation?.grade).toBeCloseTo(-6.2, 10);
  });

  it('sets a positive gradient, so the sign is not simply always negative', async () => {
    const { bench, control } = await connectedTrainer();
    await control.requestControl();

    await control.setSimulationParameters({ grade: gradePercent(6.2) });

    expect(bench.device(TRAINER).inspect().ftms?.simulation?.grade).toBeCloseTo(6.2, 10);
  });

  it('surfaces 0x02 Op Code Not Supported as an error, on a trainer that cannot simulate', async () => {
    const { control } = await connectedTrainer({ supportsSimulation: false });
    await control.requestControl();

    await expect(control.setSimulationParameters({ grade: gradePercent(4) })).rejects.toThrow(
      /op-code-not-supported/,
    );
  });

  it('sets a resistance level within the range this trainer reported', async () => {
    const { bench, control } = await connectedTrainer({
      maxResistanceLevel: resistanceLevel(20),
      resistanceIncrement: resistanceLevel(0.5),
    });
    await control.requestControl();

    await control.setTargetResistance(resistanceLevel(7.4));

    expect(bench.device(TRAINER).inspect().ftms?.targetResistance).toBeCloseTo(7.5, 10);
  });
});

// --- Losing control to the trainer itself ------------------------------------

describe('control permission lost, scripted on the simulator', () => {
  it('is seen, and the next setpoint re-requests control before it is applied', async () => {
    // Re-acquisition on, which is the default a real caller gets.
    const { bench, control, targetPowerOnTheTrainer } = await connectedTrainer({}, true);
    await control.requestControl();
    await control.setTargetPower(watts(250));

    bench.device(TRAINER).script({ kind: 'control-permission-lost' });
    bench.advance(seconds(1));

    expect(control.hasControl()).toBe(false);
    expect(control.targetPower()).toStrictEqual({ kind: 'none' });

    await control.setTargetPower(watts(300));

    expect(control.hasControl()).toBe(true);
    expect(targetPowerOnTheTrainer()).toBe(300);
  });

  it('never reports a setpoint written during the gap as applied', async () => {
    const { bench, control, targetPowerOnTheTrainer } = await connectedTrainer();
    await control.requestControl();
    await control.setTargetPower(watts(250));
    bench.device(TRAINER).script({ kind: 'control-permission-lost' });
    bench.advance(seconds(1));

    // Re-acquisition is off, so this is the gap: the trainer will refuse, and
    // the client must refuse first rather than write and claim success.
    await expect(control.setTargetPower(watts(300))).rejects.toThrow(/control/);

    expect(control.targetPower()).toStrictEqual({ kind: 'none' });
    expect(targetPowerOnTheTrainer()).toBe(250);
  });

  it('is answered 0x05 by the trainer itself, which is what the refusal protects against', async () => {
    // The other half of the pair above: proof that the trainer really would
    // ignore a setpoint written in the gap, taken by writing one straight at
    // the control point behind the client's back.
    const { bench, control } = await connectedTrainer();
    await control.requestControl();
    await control.setTargetPower(watts(250));
    const handle = bench.device(TRAINER);
    const responses: FtmsControlResponse[] = [];
    handle.controlPoint?.onResponse((response) => responses.push(response));

    handle.script({ kind: 'control-permission-lost' });
    bench.advance(seconds(1));
    handle.controlPoint?.write({ opCode: 'set-target-power', target: watts(300) });
    bench.advance(seconds(1));

    expect(responses.at(-1)).toStrictEqual({
      requestOpCode: 'set-target-power',
      result: 'control-not-permitted',
    });
    expect(handle.inspect().ftms?.targetPower).toBe(250);
  });
});

// --- The read half, against the simulator's own frames -----------------------

describe('Indoor Bike Data decoded from the frames the simulator notifies', () => {
  it('reads back the speed, cadence and power the trainer says it is sending', async () => {
    const { bench } = await connectedTrainer();
    bench.rider.set({ power: watts(214) });
    bench.advance(seconds(1));
    const frame = bench.device(TRAINER).inspect().frames.ftms;

    const reading = decodeIndoorBikeData(frameToOctets(frame ?? {}));

    expect(reading.instantaneousPower).toBe(214);
    expect(reading.instantaneousCadence).toBe(90);
    expect(reading.instantaneousSpeed).toBeCloseTo(9, 6);
    expect(reading.trailingOctets).toBe(0);
  });

  it('reads no cadence from a frame the trainer scripted the cadence out of', async () => {
    const { bench } = await connectedTrainer();
    bench.device(TRAINER).script({
      kind: 'indoor-bike-data-fields',
      fields: new Set(['instantaneous-speed', 'total-distance', 'instantaneous-power']),
    });
    bench.advance(seconds(2));
    const frame = bench.device(TRAINER).inspect().frames.ftms;

    const reading = decodeIndoorBikeData(frameToOctets(frame ?? {}));

    expect(reading.instantaneousCadence).toBeUndefined();
    expect(reading.instantaneousSpeed).toBeCloseTo(9, 6);
    expect(reading.totalDistance).toBeGreaterThan(0);
    expect(reading.trailingOctets).toBe(0);
  });

  it('agrees with the client encoder on every octet of a Set Target Power', () => {
    // The one place the two implementations are deliberately compared: the
    // bridge decodes with literal offsets, the client encodes from the field
    // table, and a disagreement between them is a real disagreement rather
    // than a shared mistake.
    const bytes = encodeControlRequest({ opCode: 'set-target-power', target: watts(250) });

    expect(requestFromOctets(bytes)).toStrictEqual({ opCode: 'set-target-power', target: 250 });
  });
});
