// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #567 — a hand-set ERG target gets the stall rescue a workout has, driven
 * against the #44 simulator through the octet bridge #43 uses.
 *
 * Every assertion is about what crossed the control point: `trainer.wire` is
 * the octets in order, and `targetPowerOnTheTrainer` is the simulator's own
 * state after it applied them. ⚠️ Neither says a real trainer eased — that is
 * validation 0002 Part S's manual-ERG row.
 */

import { revolutionsPerMinute, seconds, watts, type CadenceReading } from '@onyourleft/domain';
import { SensorError } from '@onyourleft/sensors';
import { ftmsTrainer } from '@onyourleft/sensors/simulator';
import { connectSimulatedTrainer } from '@onyourleft/sensors/protocol/testing';
import { describe, expect, it } from 'vitest';

import { createManualErg, type ManualErg } from './manual-erg';

const SET_TARGET_POWER = 0x05;
const STOP_OR_PAUSE = 0x08;
const RESET = 0x01;

/** A floor above zero, so an ease to it is a number with a source. */
const FLOOR_WATTS = 25;

/** The trainer Part S was measured on: it keeps targets through a Stop. */
const MEASURED_TRAINER = () =>
  ftmsTrainer({ id: 'kickr', retainsTargetsThroughStop: true, minTargetPower: watts(FLOOR_WATTS) });

const targetWrite = (target: number): number[] => [SET_TARGET_POWER, target & 0xff, target >> 8];

async function rig(spec = MEASURED_TRAINER()) {
  const trainer = await connectSimulatedTrainer({ spec });
  await trainer.control.requestControl();
  const faults: unknown[] = [];
  let changes = 0;
  const erg = createManualErg({
    control: trainer.control,
    powerFloor: trainer.powerRange.minimum,
    onFault: (error) => faults.push(error),
    onChange: () => {
      changes += 1;
    },
  });
  const targetWrites = () =>
    trainer.wire
      .filter((entry) => entry.direction === 'write' && entry.bytes[0] === SET_TARGET_POWER)
      .map((entry) => [...entry.bytes]);
  return { trainer, erg, faults, changes: () => changes, targetWrites };
}

/** Feed one reading a second and tick, letting every write settle between. */
async function pedal(
  erg: ManualErg,
  from: number,
  cadences: readonly (number | undefined)[],
): Promise<void> {
  for (const [index, rpm] of cadences.entries()) {
    const at = seconds(from + index);
    if (rpm !== undefined) {
      const reading: CadenceReading = { at, cadence: revolutionsPerMinute(rpm) };
      erg.observeCadence(reading);
    }
    erg.tick(at);
    await erg.settled();
  }
}

/** Part S's own trace, rounded: 68 rpm down to 37 over eight seconds. */
const PART_S_COLLAPSE = [68, 66, 62, 57, 52, 47, 43, 40, 37];

describe('a hand-set target, left alone', () => {
  it('is written once, acknowledged, and not written again while the rider is fine', async () => {
    const { trainer, erg, targetWrites } = await rig();
    const outcome = await erg.set(watts(150));
    expect(outcome.kind).toBe('written');
    await pedal(
      erg,
      0,
      Array.from({ length: 20 }, () => 85),
    );
    expect(targetWrites()).toStrictEqual([targetWrite(150)]);
    expect(trainer.targetPowerOnTheTrainer()).toBe(150);
    expect(erg.rescue()).toBeUndefined();
  });

  it('holds for a rider grinding at 60 rpm on purpose', async () => {
    const { trainer, erg } = await rig();
    await erg.set(watts(150));
    await pedal(
      erg,
      0,
      Array.from({ length: 12 }, (_, index) => 62 - index * 0.2),
    );
    expect(trainer.targetPowerOnTheTrainer()).toBe(150);
  });
});

describe('a stall under a hand-set target is rescued — #567', () => {
  it('eases a collapsing rider to two thirds of their target, with a 0x05 and no Stop', async () => {
    // Validation 0002 Part S, 2026-09-25: with a manual 150 W target the app
    // sent nothing while cadence fell from 68 to 37 rpm.
    const { trainer, erg, targetWrites } = await rig();
    await erg.set(watts(150));
    await pedal(erg, 0, PART_S_COLLAPSE);

    expect(targetWrites()).toStrictEqual([targetWrite(150), targetWrite(100)]);
    expect(trainer.targetPowerOnTheTrainer()).toBe(100);
    expect(trainer.wire.some((entry) => entry.bytes[0] === STOP_OR_PAUSE)).toBe(false);
    expect(trainer.wire.some((entry) => entry.bytes[0] === RESET)).toBe(false);
    expect(erg.rescue()).toMatchObject({ target: 150, holding: 'relief' });
  });

  it('eases a STOPPED rider to the machine’s own floor', async () => {
    const { trainer, erg, targetWrites } = await rig();
    await erg.set(watts(150));
    await pedal(erg, 0, [80, 78, 60, 40, 20, 8, 5, 4]);

    expect(targetWrites().at(-1)).toStrictEqual(targetWrite(FLOOR_WATTS));
    expect(trainer.targetPowerOnTheTrainer()).toBe(FLOOR_WATTS);
    expect(trainer.wire.some((entry) => entry.bytes[0] === STOP_OR_PAUSE)).toBe(false);
    expect(erg.rescue()).toMatchObject({ target: 150, holding: 'floor' });
  });

  it('raises a relief under the floor to the floor, rather than having it refused', async () => {
    // Two thirds of 30 W is 20 W, under this machine's 25 W minimum.
    const { trainer, erg, faults } = await rig();
    await erg.set(watts(30));
    await pedal(erg, 0, PART_S_COLLAPSE);
    expect(trainer.targetPowerOnTheTrainer()).toBe(FLOOR_WATTS);
    expect(faults).toStrictEqual([]);
  });

  it('tells the screen when the rescue deepens to the floor without the number changing', async () => {
    // 30 W's relief is already raised to the 25 W floor, so the stall writes
    // nothing new — and the panel must still learn that the rider has stopped.
    const { erg, changes, targetWrites } = await rig();
    await erg.set(watts(30));
    await pedal(erg, 0, [80, 78, 60, 40]);
    expect(erg.rescue()).toMatchObject({ holding: 'relief' });
    const before = changes();
    await pedal(erg, 4, [20, 8]);
    expect(erg.rescue()).toMatchObject({ holding: 'floor' });
    expect(changes()).toBeGreaterThan(before);
    expect(targetWrites()).toStrictEqual([targetWrite(30), targetWrite(FLOOR_WATTS)]);
  });

  it('puts the rider’s target back after a whole window of steady cadence, stepped from the floor', async () => {
    const { trainer, erg, targetWrites } = await rig();
    await erg.set(watts(150));
    await pedal(erg, 0, [80, 78, 60, 40, 20, 8, 5, 4]);
    expect(trainer.targetPowerOnTheTrainer()).toBe(FLOOR_WATTS);

    // Pedalling again, below 50 rpm: relief, not the full target.
    await pedal(erg, 8, [30, 40, 45]);
    expect(trainer.targetPowerOnTheTrainer()).toBe(100);

    // Back to 85 rpm and holding. Not on the first good second…
    await pedal(erg, 11, [85, 85, 85]);
    expect(trainer.targetPowerOnTheTrainer()).toBe(100);
    // …but once a whole eight-second window has held.
    await pedal(
      erg,
      14,
      Array.from({ length: 20 }, () => 85),
    );
    expect(trainer.targetPowerOnTheTrainer()).toBe(150);
    expect(erg.rescue()).toBeUndefined();
    expect(targetWrites().at(-1)).toStrictEqual(targetWrite(150));
    // The whole story on the wire: the rider's, relief as the spiral began,
    // the floor once they stopped, relief as they came back, then theirs again
    // — one write per change and none in between.
    expect(targetWrites()).toStrictEqual([
      targetWrite(150),
      targetWrite(100),
      targetWrite(FLOOR_WATTS),
      targetWrite(100),
      targetWrite(150),
    ]);
  });

  it('does not put the target back while the cadence sensor is silent', async () => {
    const { trainer, erg } = await rig();
    await erg.set(watts(150));
    await pedal(erg, 0, [80, 78, 60, 40, 20, 8, 5, 4]);
    await pedal(
      erg,
      8,
      Array.from({ length: 40 }, () => undefined),
    );
    expect(trainer.targetPowerOnTheTrainer()).not.toBe(150);
    expect(erg.rescue()).toBeDefined();
  });

  it('forgets the rescue when the rider sets a target again', async () => {
    const { trainer, erg } = await rig();
    await erg.set(watts(150));
    await pedal(erg, 0, PART_S_COLLAPSE);
    expect(erg.rescue()).toBeDefined();
    await erg.set(watts(120));
    expect(erg.rescue()).toBeUndefined();
    // Pedalling well again, for less than a whole window: a latch the new
    // target did not reset would still be holding relief here.
    await pedal(erg, 9, [85, 85, 85]);
    expect(erg.rescue()).toBeUndefined();
    expect(trainer.targetPowerOnTheTrainer()).toBe(120);
  });
});

describe('a rescue write the machine refuses', () => {
  it('is reported and tried again on the next tick, and the rider’s target is not re-sent behind them', async () => {
    const asked: number[] = [];
    let refuse = false;
    const faults: unknown[] = [];
    const erg = createManualErg({
      control: {
        setTargetPower: (target) => {
          asked.push(target);
          return refuse
            ? Promise.reject(new SensorError('control-rejected', 'the machine refused op code 0x5'))
            : Promise.resolve(target);
        },
      },
      powerFloor: watts(FLOOR_WATTS),
      onFault: (error) => faults.push(error),
      onChange: () => undefined,
    });
    await erg.set(watts(150));
    refuse = true;
    // The collapse is judged from the fifth second; the ease is refused there
    // and on every tick after while `refuse` holds.
    await pedal(erg, 0, PART_S_COLLAPSE.slice(0, 7));
    const refusedEases = asked.filter((target) => target === 100).length;
    expect(refusedEases).toBeGreaterThan(1);
    expect(faults).toHaveLength(refusedEases);

    refuse = false;
    await pedal(erg, 7, [40, 37, 37]);
    // Written once it is accepted, and then not again.
    expect(asked.slice(-1)).toStrictEqual([100]);
    expect(asked.filter((target) => target === 100)).toHaveLength(refusedEases + 1);
  });

  it('does not retry a refused target the RIDER set — the refusal is theirs to read', async () => {
    const asked: number[] = [];
    const erg = createManualErg({
      control: {
        setTargetPower: (target) => {
          asked.push(target);
          return Promise.reject(new SensorError('control-rejected', 'out of range'));
        },
      },
      powerFloor: watts(FLOOR_WATTS),
      onFault: () => undefined,
      onChange: () => undefined,
    });
    const outcome = await erg.set(watts(9000));
    expect(outcome.kind).toBe('failed');
    await pedal(
      erg,
      0,
      Array.from({ length: 10 }, () => 85),
    );
    expect(asked).toStrictEqual([9000]);
  });
});

describe('closing', () => {
  it('writes nothing after close, whatever the rider does', async () => {
    const { erg, targetWrites } = await rig();
    await erg.set(watts(150));
    erg.close();
    await pedal(erg, 0, PART_S_COLLAPSE);
    expect(targetWrites()).toStrictEqual([targetWrite(150)]);
    expect(erg.rescue()).toBeUndefined();
  });
});
