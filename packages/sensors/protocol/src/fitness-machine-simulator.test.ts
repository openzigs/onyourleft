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
 * something has to turn one into the other, and that something is
 * `simulator-bridge.ts`, which moved out of this file in #90 when a second
 * suite needed it. It is written from the specification tables with literal
 * offsets and deliberately does not call this package's own codec; its header
 * says why.
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

import { gradePercent, resistanceLevel, seconds, watts } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { deviceId } from '../../src/index';
import type { FtmsControlResponse } from '../../src/simulator/index';

import { decodeIndoorBikeData } from './fitness-machine';
import { encodeControlRequest } from './fitness-machine-control';
import { connectedTrainer, frameToOctets, requestFromOctets } from './simulator-bridge';

const TRAINER = deviceId('kickr');

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
