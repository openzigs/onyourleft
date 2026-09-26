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

import {
  CADENCE_SILENT_REASON,
  RECOVERING_REASON,
  revolutionsPerMinute,
  seconds,
  watts,
  type CadenceReading,
  type Watts,
} from '@onyourleft/domain';
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

  it('holds a stopped rider at the FLOOR through sixty seconds of silence, then steps up only on heard cadence — PR #582', async () => {
    // The review's probe: silence after a stall used to step the machine UP
    // from the 25 W floor to 100 W and hold it there, on no evidence at all,
    // with the panel saying "Cadence is recovering".
    const { trainer, erg, targetWrites } = await rig();
    await erg.set(watts(150));
    await pedal(erg, 0, [80, 78, 60, 40, 20, 8, 5, 4]);
    expect(trainer.targetPowerOnTheTrainer()).toBe(FLOOR_WATTS);
    const atTheFloor = targetWrites().length;
    await pedal(
      erg,
      8,
      Array.from({ length: 60 }, () => undefined),
    );
    expect(trainer.targetPowerOnTheTrainer()).toBe(FLOOR_WATTS);
    expect(targetWrites()).toHaveLength(atTheFloor);
    expect(erg.rescue()).toStrictEqual({
      target: 150,
      holding: 'floor',
      reason: CADENCE_SILENT_REASON,
    });
    expect(erg.rescue()?.reason).not.toBe(RECOVERING_REASON);

    // Pedalling again from 68, heard: relief first, then the rider's own 150 W
    // once a whole window has held steady — not before.
    const recovery = Array.from({ length: 12 }, () => 85);
    await pedal(erg, 68, recovery.slice(0, 2));
    expect(trainer.targetPowerOnTheTrainer()).toBe(100);
    expect(erg.rescue()?.reason).toBe(RECOVERING_REASON);
    await pedal(erg, 70, recovery.slice(2, 8));
    expect(trainer.targetPowerOnTheTrainer()).toBe(100);
    await pedal(erg, 76, recovery.slice(8));
    expect(trainer.targetPowerOnTheTrainer()).toBe(150);
    expect(targetWrites().slice(atTheFloor)).toStrictEqual([targetWrite(100), targetWrite(150)]);
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

describe('a rider target the machine refuses, during a rescue — PR #582', () => {
  it('leaves the rescue in place, so the OLD target does not come straight back at full', async () => {
    const asked: number[] = [];
    const erg = createManualErg({
      control: {
        setTargetPower: (target) => {
          asked.push(target);
          return target === 9000
            ? Promise.reject(new SensorError('control-rejected', 'out of range'))
            : Promise.resolve(target);
        },
      },
      powerFloor: watts(FLOOR_WATTS),
      onFault: () => undefined,
      onChange: () => undefined,
    });
    await erg.set(watts(150));
    await pedal(erg, 0, PART_S_COLLAPSE);
    expect(erg.rescue()?.target).toBe(150);
    const outcome = await erg.set(watts(9000));
    expect(outcome.kind).toBe('failed');
    // Pedalling well again for less than a whole window: the latch the refused
    // target would have wiped is still holding relief.
    await pedal(erg, 9, [85, 85, 85, 85]);
    expect(asked.slice(asked.indexOf(9000) + 1)).not.toContain(150);
    expect(erg.rescue()).toMatchObject({ target: 150, holding: 'relief' });
    // And the whole window comes round in the end.
    await pedal(
      erg,
      13,
      Array.from({ length: 10 }, () => 85),
    );
    expect(asked.at(-1)).toBe(150);
    expect(erg.rescue()).toBeUndefined();
  });

  it('keeps judging the old rescue while the refused target was in flight, so a rider who recovered meanwhile is not held back', async () => {
    const asked: number[] = [];
    let refuse: ((error: unknown) => void) | undefined;
    const erg = createManualErg({
      control: {
        setTargetPower: (target) => {
          asked.push(target);
          return target === 9000
            ? new Promise<Watts>((_, reject) => {
                refuse = reject;
              })
            : Promise.resolve(target);
        },
      },
      powerFloor: watts(FLOOR_WATTS),
      onFault: () => undefined,
      onChange: () => undefined,
    });
    await erg.set(watts(150));
    await pedal(erg, 0, PART_S_COLLAPSE);
    expect(erg.rescue()?.target).toBe(150);
    const outcome = erg.set(watts(9000));
    // The machine sits on the answer while the rider pedals steadily for longer
    // than a whole window. No `settled()` here: the write is still in flight.
    for (let at = 9; at <= 24; at += 1) {
      erg.observeCadence({ at: seconds(at), cadence: revolutionsPerMinute(85) });
      erg.tick(seconds(at));
    }
    refuse?.(new SensorError('control-rejected', 'out of range'));
    expect((await outcome).kind).toBe('failed');
    await pedal(erg, 25, [85]);
    // The old rescue saw the whole steady window, so the rider's accepted
    // target is back — not held at relief for another eight seconds.
    expect(asked.at(-1)).toBe(150);
    expect(erg.rescue()).toBeUndefined();
  });
});

/** Let every settled write's bookkeeping run, without waiting for a held one. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) {
    await Promise.resolve();
  }
}

/** One reading and a tick per second, WITHOUT waiting for a held write. */
async function pedalHeld(erg: ManualErg, from: number, cadences: readonly number[]): Promise<void> {
  for (const [index, rpm] of cadences.entries()) {
    const at = seconds(from + index);
    erg.observeCadence({ at, cadence: revolutionsPerMinute(rpm) });
    erg.tick(at);
    await flush();
  }
}

describe('a refused rider target is never written again unless the rider asks — PR #582 second review', () => {
  it('drops a refused target even when an ease went out after it, and never derives a write from it', async () => {
    // The review's probe: 150 W steady, then 9000 W with the write held; the
    // rider stalls in the same seconds, so an ease to the floor goes out after
    // it; then the 9000 is refused. The wire used to read
    // [150, 9000, 25, 6000, 9000 ×21] with 22 faults, and the panel said
    // "Your 9000 W comes back by itself".
    const asked: number[] = [];
    const faults: unknown[] = [];
    let refuse: ((error: unknown) => void) | undefined;
    const erg = createManualErg({
      control: {
        setTargetPower: (target) => {
          asked.push(target);
          return target === 9000
            ? new Promise<Watts>((_, reject) => {
                refuse = reject;
              })
            : Promise.resolve(target);
        },
      },
      powerFloor: watts(FLOOR_WATTS),
      onFault: (error) => faults.push(error),
      onChange: () => undefined,
    });
    await erg.set(watts(150));
    await pedal(
      erg,
      0,
      Array.from({ length: 10 }, () => 85),
    );
    const outcome = erg.set(watts(9000));
    await pedalHeld(erg, 10, [80, 60, 30, 8, 5]);
    // The stall is judged under the fresh latch and an ease to the floor is
    // offered, queued behind the held 9000.
    expect(erg.rescue()).toMatchObject({ holding: 'floor' });

    refuse?.(new SensorError('control-rejected', 'out of range'));
    expect((await outcome).kind).toBe('failed');
    await erg.settled();
    // The ease went out after the refused target: it reached the wire next.
    expect(asked.slice(asked.indexOf(9000) + 1, asked.indexOf(9000) + 2)).toStrictEqual([
      FLOOR_WATTS,
    ]);
    // The panel speaks of the target the machine accepted, not the refused one.
    expect(erg.rescue()).toMatchObject({ target: 150, holding: 'floor' });

    // The rider recovers and holds steady for far longer than a window.
    await pedal(erg, 15, [30, 40, 45]);
    await pedal(
      erg,
      18,
      Array.from({ length: 30 }, () => 85),
    );
    const afterRefusal = asked.slice(asked.indexOf(9000) + 1);
    expect(afterRefusal).not.toContain(9000);
    expect(afterRefusal).not.toContain(6000);
    expect(afterRefusal.at(-1)).toBe(150);
    expect(faults).toStrictEqual([]);
    expect(erg.rescue()).toBeUndefined();
  });

  it('keeps the rescue when two quick rider targets during it are both refused', async () => {
    // The review's second probe: the first refusal used to clear the kept
    // rescue because a later ask existed — the rider's own — so the second
    // found nothing to put back and 150 W came straight back at full:
    // [150, 100, 9000, 9001, 150].
    const asked: number[] = [];
    const erg = createManualErg({
      control: {
        setTargetPower: (target) => {
          asked.push(target);
          return target >= 9000
            ? Promise.reject(new SensorError('control-rejected', 'out of range'))
            : Promise.resolve(target);
        },
      },
      powerFloor: watts(FLOOR_WATTS),
      onFault: () => undefined,
      onChange: () => undefined,
    });
    await erg.set(watts(150));
    await pedal(erg, 0, PART_S_COLLAPSE);
    expect(erg.rescue()).toMatchObject({ target: 150, holding: 'relief' });

    const first = erg.set(watts(9000));
    const second = erg.set(watts(9001));
    await Promise.all([first, second]);
    await erg.settled();

    // Pedalling well again for less than a whole window: still relief.
    await pedal(erg, 9, [85, 85, 85]);
    expect(asked).not.toStrictEqual([150, 100, 9000, 9001, 150]);
    expect(asked.slice(asked.indexOf(9001) + 1)).not.toContain(150);
    expect(erg.rescue()).toMatchObject({ target: 150, holding: 'relief' });
  });

  it('never lets an ease supersede a rider target still waiting behind another write', async () => {
    // A rider target queued behind a write in flight must reach the wire: an
    // ease offered in the meantime would replace it in the writer's one
    // waiting slot, carrying a share of a number nobody has accepted.
    const asked: number[] = [];
    let release: (() => void) | undefined;
    const erg = createManualErg({
      control: {
        setTargetPower: (target) => {
          asked.push(target);
          return target === 150 && release === undefined && asked.length > 1
            ? new Promise<Watts>((resolve) => {
                release = () => resolve(target);
              })
            : Promise.resolve(target);
        },
      },
      powerFloor: watts(FLOOR_WATTS),
      onFault: () => undefined,
      onChange: () => undefined,
    });
    await erg.set(watts(150));
    await pedal(erg, 0, PART_S_COLLAPSE.slice(0, 7));
    // Relief is on; the rider resets 150 (held in flight) then 120 (waiting).
    void erg.set(watts(150));
    const waiting = erg.set(watts(120));
    await pedalHeld(erg, 7, [40, 37]);
    release?.();
    expect((await waiting).kind).toBe('written');
    await erg.settled();
    expect(asked).toContain(120);
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
