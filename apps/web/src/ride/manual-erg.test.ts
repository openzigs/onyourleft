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

import {
  answersHeld,
  createManualErg,
  RESTORE_FIRST_GAP_SECONDS,
  RESTORE_RETRIES,
  type ManualErg,
} from './manual-erg';

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
      pending: undefined,
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

  it('defers a target set DURING a rescue — the rescue is the only writer — and writes it on hand-back', async () => {
    // PR #582's third review: every earlier round's race came from a rider
    // write and a rescue write sharing one writer. During a rescue the rider's
    // new number is recorded, not written.
    const { trainer, erg, targetWrites } = await rig();
    await erg.set(watts(150));
    await pedal(erg, 0, PART_S_COLLAPSE);
    const eased = targetWrites().length;
    const outcome = await erg.set(watts(120));
    expect(outcome.kind).toBe('deferred');
    // #740: pressed while the rescue held, so the press is answered.
    expect(answersHeld(outcome)).toBe(true);
    expect(targetWrites()).toHaveLength(eased);
    expect(erg.rescue()).toMatchObject({ target: 150, holding: 'relief', pending: 120 });
    // Pedalling well again for less than a whole window: still the rescue's.
    await pedal(erg, 9, [85, 85, 85]);
    expect(targetWrites().slice(eased)).not.toContainEqual(targetWrite(120));
    expect(erg.rescue()).toMatchObject({ pending: 120 });
    // The window comes round: the pending target goes on, not the old 150.
    await pedal(
      erg,
      12,
      Array.from({ length: 10 }, () => 85),
    );
    expect(trainer.targetPowerOnTheTrainer()).toBe(120);
    expect(targetWrites().slice(eased)).not.toContainEqual(targetWrite(150));
    expect(targetWrites().at(-1)).toStrictEqual(targetWrite(120));
    expect(erg.rescue()).toBeUndefined();
    expect(trainer.wire.some((entry) => entry.bytes[0] === STOP_OR_PAUSE)).toBe(false);
    expect(trainer.wire.some((entry) => entry.bytes[0] === RESET)).toBe(false);
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

/** Let every settled write's bookkeeping run, without waiting for a held one. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
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

/**
 * A sink whose writes are HELD until a test answers them, in order, with
 * `stop` and `reset` spies beside `setTargetPower` — an object with more on it
 * than `ErgSink` names, so a cast in the module that reached for either would
 * be seen. `policy` answers a write at once (`ok`, `refuse`) or holds it.
 */
function heldSink(policy: (target: number) => 'ok' | 'refuse' | 'hold') {
  const asked: number[] = [];
  const held: { target: number; accept: () => void; refuse: () => void }[] = [];
  const forbidden: string[] = [];
  const control = {
    setTargetPower: (target: Watts): Promise<Watts> => {
      asked.push(target);
      const answer = policy(target);
      if (answer === 'ok') {
        return Promise.resolve(target);
      }
      if (answer === 'refuse') {
        return Promise.reject(new SensorError('control-rejected', 'out of range'));
      }
      return new Promise<Watts>((resolve, reject) => {
        held.push({
          target,
          accept: () => {
            resolve(target);
          },
          refuse: () => {
            reject(new SensorError('control-rejected', 'out of range'));
          },
        });
      });
    },
    stop: () => forbidden.push('stop'),
    reset: () => forbidden.push('reset'),
    letGo: () => forbidden.push('letGo'),
  };
  return { asked, held, forbidden, control };
}

function heldRig(policy: (target: number) => 'ok' | 'refuse' | 'hold') {
  const sink = heldSink(policy);
  const faults: unknown[] = [];
  let changes = 0;
  const erg = createManualErg({
    control: sink.control,
    powerFloor: watts(FLOOR_WATTS),
    onFault: (error) => faults.push(error),
    onChange: () => {
      changes += 1;
    },
  });
  return { ...sink, erg, faults, changes: () => changes };
}

describe('probe A — a rider target IN FLIGHT when a stall begins, then refused — PR #582 third review', () => {
  it('eases from the last ACCEPTED target, never from the one in flight (in range)', async () => {
    // The review's probe, as the new ownership rule meets it: 150 W accepted,
    // the rider sets 240 W and the machine sits on it, and the stall is judged
    // meanwhile. The wire used to read [150, 100, 240, 160, 100]: a share of a
    // refused 240 pushed a spiralling rider UP from 100 W to 160 W.
    const rig = heldRig((target) => (target === 240 ? 'hold' : 'ok'));
    await rig.erg.set(watts(150));
    await pedal(
      rig.erg,
      0,
      Array.from({ length: 10 }, () => 85),
    );
    const outcome = rig.erg.set(watts(240));
    await pedalHeld(rig.erg, 10, PART_S_COLLAPSE);
    // The rescue names only what the machine accepted (invariant 4).
    expect(rig.erg.rescue()).toMatchObject({ target: 150, holding: 'relief' });
    rig.held[0]?.refuse();
    expect((await outcome).kind).toBe('failed');
    await rig.erg.settled();
    await flush();
    const afterRefusal = rig.asked.slice(rig.asked.indexOf(240) + 1);
    expect(afterRefusal[0]).toBe(100);
    expect(afterRefusal).not.toContain(160);
    expect(afterRefusal).not.toContain(240);
    // The rider's refusal is theirs to read on `set()`; no ease was refused.
    expect(rig.faults).toStrictEqual([]);
    expect(rig.forbidden).toStrictEqual([]);
  });

  it('eases from the last ACCEPTED target, never from the one in flight (out of range)', async () => {
    // [150, 100, 9000, 6000] and one spurious fault, reported as a refused
    // ease, used to be the wire: 6000 is two thirds of the refused 9000.
    const rig = heldRig((target) => (target === 9000 ? 'hold' : target > 2000 ? 'refuse' : 'ok'));
    await rig.erg.set(watts(150));
    await pedal(
      rig.erg,
      0,
      Array.from({ length: 10 }, () => 85),
    );
    const outcome = rig.erg.set(watts(9000));
    await pedalHeld(rig.erg, 10, PART_S_COLLAPSE);
    rig.held[0]?.refuse();
    expect((await outcome).kind).toBe('failed');
    await rig.erg.settled();
    await flush();
    const afterRefusal = rig.asked.slice(rig.asked.indexOf(9000) + 1);
    expect(afterRefusal).not.toContain(6000);
    expect(afterRefusal).not.toContain(9000);
    expect(rig.faults).toStrictEqual([]);
  });

  it('re-derives the ease once the in-flight target IS accepted', async () => {
    // The other branch: the rider's 240 lands, so it becomes the base.
    const rig = heldRig((target) => (target === 240 ? 'hold' : 'ok'));
    await rig.erg.set(watts(150));
    await pedal(
      rig.erg,
      0,
      Array.from({ length: 10 }, () => 85),
    );
    void rig.erg.set(watts(240));
    await pedalHeld(rig.erg, 10, PART_S_COLLAPSE.slice(0, 7));
    rig.held[0]?.accept();
    await rig.erg.settled();
    await pedal(rig.erg, 17, [40, 37]);
    expect(rig.erg.rescue()).toMatchObject({ target: 240, holding: 'relief' });
    expect(rig.asked.at(-1)).toBe(160);
  });

  it('with a rescue already on, a new target is deferred — the literal probe', async () => {
    // Relief is on the machine and the rider sets 240: nothing is written.
    const rig = heldRig(() => 'ok');
    await rig.erg.set(watts(150));
    await pedal(rig.erg, 0, PART_S_COLLAPSE);
    expect(rig.asked).toStrictEqual([150, 100]);
    expect((await rig.erg.set(watts(240))).kind).toBe('deferred');
    await pedal(rig.erg, 9, [35]);
    expect(rig.asked).toStrictEqual([150, 100]);
    expect(rig.erg.rescue()).toMatchObject({ target: 150, pending: 240 });
  });

  it('a deferred target the machine refuses on hand-back is reported, reverted and never re-sent', async () => {
    const rig = heldRig((target) => (target === 9000 ? 'refuse' : 'ok'));
    await rig.erg.set(watts(150));
    await pedal(rig.erg, 0, PART_S_COLLAPSE);
    expect((await rig.erg.set(watts(9000))).kind).toBe('deferred');
    await pedal(
      rig.erg,
      9,
      Array.from({ length: 30 }, () => 85),
    );
    // Written once, on hand-back, and refused: the caller's promise resolved
    // long ago, so the refusal is reported through onFault.
    expect(rig.asked.filter((target) => target === 9000)).toHaveLength(1);
    expect(rig.faults).toHaveLength(1);
    // Reverted to the last accepted target, which is what goes back on.
    expect(rig.asked.at(-1)).toBe(150);
    expect(rig.asked.slice(rig.asked.indexOf(9000) + 1)).not.toContain(6000);
    expect(rig.erg.rescue()).toBeUndefined();
  });
});

/**
 * Probe B's rider: pressing *Set 150 W* every second, half a second after each
 * tick, from the start — so a press is on the wire when the stall is judged —
 * and stopped from `STOP_AT`. Every write is acknowledged `latency` seconds
 * after it reached the wire. Time is simulated in tenths of a second.
 *
 * `floorSteadyFrom` is when the machine started holding the floor for good;
 * `fullAfterFloor` counts tenths it held the rider's 150 W after the floor had
 * first landed.
 */
const STOP_AT = 3;
async function mashingSet(
  latency: number,
  presses: boolean,
): Promise<{ floorSteadyFrom: number | undefined; fullAfterFloor: number }> {
  let clock = 0;
  const onTheWire: { target: number; startedAt: number; resolve: () => void }[] = [];
  const erg = createManualErg({
    control: {
      setTargetPower: (target: Watts) =>
        new Promise<Watts>((resolve) => {
          onTheWire.push({
            target,
            startedAt: clock,
            resolve: () => {
              resolve(target);
            },
          });
        }),
    },
    powerFloor: watts(FLOOR_WATTS),
    onFault: () => undefined,
    onChange: () => undefined,
  });
  let onMachine = 0;
  const held: number[] = [];
  for (let tenth = 0; tenth <= 300; tenth += 1) {
    clock = tenth / 10;
    const head = onTheWire[0];
    if (head !== undefined && clock - head.startedAt >= latency - 1e-9) {
      onTheWire.shift();
      onMachine = head.target;
      head.resolve();
      await flush();
    }
    if (tenth % 10 === 0) {
      erg.observeCadence({
        at: seconds(clock),
        cadence: revolutionsPerMinute(clock < STOP_AT ? 85 : 5),
      });
      erg.tick(seconds(clock));
      await flush();
    }
    if (tenth === 0 || (presses && tenth % 10 === 5)) {
      void erg.set(watts(150));
      await flush();
    }
    held.push(onMachine);
  }
  erg.close();
  let steady: number | undefined;
  for (
    let tenth = held.length - 1;
    tenth >= STOP_AT * 10 && held[tenth] === FLOOR_WATTS;
    tenth -= 1
  ) {
    steady = tenth / 10;
  }
  const firstFloor = held.indexOf(FLOOR_WATTS);
  return {
    floorSteadyFrom: steady,
    fullAfterFloor:
      firstFloor < 0 ? 0 : held.slice(firstFloor).filter((watts) => watts === 150).length,
  };
}

describe('probe B — a stalled rider reaches the floor within a bound, whatever they press — PR #582 third review', () => {
  // The review's table: with acks slower than the press interval the floor
  // was NEVER written in 26 s of a stopped rider at 1.2 s and 1.5 s, and on
  // 49eb795 this harness has the machine back at 150 W for 13 to 25 s of a
  // stopped rider after the floor first landed.
  it.each([0.2, 0.6, 0.9, 1.2, 1.5])(
    'ack latency %s s, Set pressed every second: on the floor for good within one tick and two acks of the stall',
    async (latency) => {
      const baseline = await mashingSet(0, false);
      expect(baseline.floorSteadyFrom).toBeDefined();
      const mashed = await mashingSet(latency, true);
      // The bound: when the stall is judged with no presses and instant acks,
      // plus the one write already on the wire, plus the floor's own
      // acknowledgement, plus one tick.
      expect(mashed.floorSteadyFrom ?? Infinity).toBeLessThanOrEqual(
        (baseline.floorSteadyFrom ?? 0) + 2 * latency + 1,
      );
      // And once the floor is on, the rider's presses never put 150 W back.
      expect(mashed.fullAfterFloor).toBe(0);
    },
  );
});

describe('probe C — a rider target WAITING behind another when the stall begins — PR #582 third review', () => {
  it('is superseded by the ease and kept as the pending target, not written at full', async () => {
    // [150, 200, 210, 25] used to be the wire: the stopped rider got 210 W for
    // one ack before the floor.
    const rig = heldRig((target) => (target === 150 ? 'ok' : 'hold'));
    await rig.erg.set(watts(150));
    await pedal(
      rig.erg,
      0,
      Array.from({ length: 5 }, () => 85),
    );
    void rig.erg.set(watts(200));
    const waiting = rig.erg.set(watts(210));
    await pedalHeld(rig.erg, 5, [5, 5, 5, 5]);
    const deferred = await waiting;
    expect(deferred.kind).toBe('deferred');
    // #740 (#655's review, N4): the rescue BEGAN with 210 pending, so its own
    // notice already says "Your new target of 210 W will be set once …", and
    // the press is not answered a second time with the same clause.
    expect(answersHeld(deferred)).toBe(false);
    // The rescue names only the accepted 150 while 200 is in flight.
    expect(rig.erg.rescue()).toMatchObject({ target: 150, holding: 'floor', pending: 210 });
    rig.held.shift()?.accept();
    await flush();
    rig.held.shift()?.accept();
    await rig.erg.settled();
    expect(rig.asked).toStrictEqual([150, 200, FLOOR_WATTS]);
    expect(rig.erg.rescue()).toMatchObject({ target: 200, holding: 'floor', pending: 210 });
  });
});

describe('probe D — a late answer after close() — PR #582 third review', () => {
  it('writes nothing, reports nothing and changes nothing', async () => {
    const rig = heldRig((target) => (target === 300 ? 'hold' : 'ok'));
    await rig.erg.set(watts(150));
    await pedal(
      rig.erg,
      0,
      Array.from({ length: 5 }, () => 85),
    );
    const outcome = rig.erg.set(watts(300));
    rig.erg.close();
    const changesAtClose = rig.changes();
    rig.held[0]?.refuse();
    expect((await outcome).kind).toBe('failed');
    await flush();
    await pedal(rig.erg, 5, PART_S_COLLAPSE);
    expect((await rig.erg.set(watts(120))).kind).toBe('closed');
    expect(rig.asked).toStrictEqual([150, 300]);
    expect(rig.erg.rescue()).toBeUndefined();
    expect(rig.faults).toStrictEqual([]);
    expect(rig.changes()).toBe(changesAtClose);
  });
});

/** A small seeded generator, so a failing interleaving can be replayed. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Values a rider sets. None of them is an ease of any other, nor the floor. */
const RIDER_VALUES = [150, 200, 240, 9000, 9001] as const;
/** Refused by the machine every time, so never accepted. */
const ALWAYS_REFUSED = new Set([9000, 9001]);
const easeOf = (target: number): number => Math.max(Math.round((target * 2) / 3), FLOOR_WATTS);

describe('the ownership rule, over interleavings — PR #582 third review', () => {
  /**
   * Hundreds of seeded rides: ticks through steady, collapsing, stopped and
   * silent cadence, usually a second apart and sometimes not; rider targets
   * set at any moment, in and out of a rescue; writes held, accepted or
   * refused in any order; sometimes a close. After every step the invariants
   * are checked against what reached the sink.
   *
   * PR #582's fourth review: the safety invariants alone passed a module that
   * never wrote the rider's target at all, and "derivable from any value ever
   * acknowledged" passed an ease taken from a STALE base. So there are
   * liveness invariants (L1, L2), the ease is held to the base as it was at
   * the tick that decided it (3), and the floor to a bound (7).
   */
  it.each(Array.from({ length: 250 }, (_, index) => index + 1))(
    'holds every invariant on seeded ride %i',
    async (seed) => {
      const random = seeded(seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
      const sets = new Map<number, number>();
      const writes = new Map<number, number>();
      const acked = new Set<number>();
      let lastAckedRider: number | undefined;
      /** The accepted rider target as it stood at the most recent tick. */
      let baseAtLastTick: number | undefined;
      /** Every value that reached the sink, in order. */
      const log: number[] = [];
      let closed = false;
      let callbacksAfterClose = 0;
      const violations: string[] = [];
      const pending: { target: number; answer: (accept: boolean) => void }[] = [];
      const forbidden: string[] = [];
      const current: { erg?: ManualErg } = {};
      const control = {
        setTargetPower: (target: Watts): Promise<Watts> => {
          if (closed) {
            violations.push(`wrote ${String(target)} after close`);
          }
          writes.set(target, (writes.get(target) ?? 0) + 1);
          log.push(target);
          const isRider = (RIDER_VALUES as readonly number[]).includes(target);
          // (6) The rescue is the only writer while it lasts.
          if (isRider && current.erg?.rescue() !== undefined) {
            violations.push(`rider target ${String(target)} reached the wire during a rescue`);
          }
          // (3) An ease is derived from the rider target accepted at the tick
          // that DECIDED it, and is never above it. An ease reaches the sink
          // either inside that tick or when the write ahead of it settles —
          // before any later tick, because a later tick would re-decide it —
          // so the base at the latest tick is the deciding tick's base.
          // (6') Nothing but a rider target is written to a trainer holding no
          // accepted rider target — not even the floor (rule 6).
          if (!isRider) {
            if (baseAtLastTick === undefined) {
              violations.push(`ease ${String(target)} with no accepted rider target`);
            } else if (
              target !== FLOOR_WATTS &&
              (target !== easeOf(baseAtLastTick) || target > baseAtLastTick)
            ) {
              violations.push(
                `ease ${String(target)} not derived from ${String(baseAtLastTick)}, the base when it was decided`,
              );
            }
          }
          return new Promise<Watts>((resolve, reject) => {
            pending.push({
              target,
              answer: (accept) => {
                if (accept) {
                  acked.add(target);
                  if ((RIDER_VALUES as readonly number[]).includes(target)) {
                    lastAckedRider = target;
                  }
                  resolve(target);
                } else {
                  reject(new SensorError('control-rejected', 'refused'));
                }
              },
            });
          });
        },
        stop: () => forbidden.push('stop'),
        reset: () => forbidden.push('reset'),
      };
      const erg = createManualErg({
        control,
        powerFloor: watts(FLOOR_WATTS),
        onFault: () => {
          if (closed) {
            callbacksAfterClose += 1;
          }
        },
        onChange: () => {
          if (closed) {
            callbacksAfterClose += 1;
          }
        },
      });
      current.erg = erg;

      let at = 0;
      let phase: 'steady' | 'collapse' | 'stopped' | 'silent' = 'steady';
      let collapseRpm = 70;
      const closeAt = random() < 0.3 ? Math.floor(random() * 60) : undefined;
      for (let step = 0; step < 70; step += 1) {
        if (step === closeAt) {
          erg.close();
          closed = true;
        }
        const roll = random();
        const idle = pending.length === 0;
        const logBefore = log.length;
        if (roll < 0.45) {
          if (random() < 0.15) {
            phase = pick(['steady', 'collapse', 'stopped', 'silent'] as const);
            collapseRpm = 70;
          }
          const rpm =
            phase === 'steady'
              ? 85
              : phase === 'stopped'
                ? 5
                : phase === 'collapse'
                  ? (collapseRpm = Math.max(20, collapseRpm - 5))
                  : undefined;
          if (rpm !== undefined) {
            erg.observeCadence({ at: seconds(at), cadence: revolutionsPerMinute(rpm) });
          }
          const rescueBefore = erg.rescue();
          baseAtLastTick = lastAckedRider;
          erg.tick(seconds(at));
          await flush();
          // (L2) Liveness: at hand-back, a pending target is written — at once
          // when nothing is on the wire.
          if (
            rescueBefore?.pending !== undefined &&
            erg.rescue() === undefined &&
            !closed &&
            idle &&
            !log.slice(logBefore).includes(rescueBefore.pending)
          ) {
            violations.push(`pending ${String(rescueBefore.pending)} dropped at hand-back`);
          }
          // Usually a second; sometimes a stutter or a gap.
          at += random() < 0.1 ? pick([0.3, 0.7, 2.5, 6] as const) : 1;
        } else if (roll < 0.65) {
          const value = pick(RIDER_VALUES);
          sets.set(value, (sets.get(value) ?? 0) + 1);
          const outsideRescue = erg.rescue() === undefined && !closed;
          void erg.set(watts(value));
          await flush();
          // (L1) Liveness: outside a rescue, with nothing on the wire, the
          // rider's Set reaches the sink before anything else happens.
          if (outsideRescue && idle && log.at(-1) !== value) {
            violations.push(`Set ${String(value)} outside a rescue was not written`);
          }
        } else if (pending.length > 0) {
          const head = pending.shift();
          head?.answer(!ALWAYS_REFUSED.has(head.target) && random() > 0.1);
        }
        await flush();

        // (4) rescue() names only the last target the machine ACCEPTED.
        const rescue = erg.rescue();
        // (7) A bounded time to the floor: whenever the rescue holds the floor
        // and nothing is on the wire, the floor is the last thing asked for —
        // it went out in the deciding tick or the moment the write ahead of it
        // settled, however the rider pressed and however slowly acks came.
        if (rescue?.holding === 'floor' && pending.length === 0 && log.at(-1) !== FLOOR_WATTS) {
          violations.push(`the floor held with ${String(log.at(-1))} last asked and the wire idle`);
        }
        if (rescue !== undefined && rescue.target !== lastAckedRider) {
          violations.push(
            `rescue() named ${String(rescue.target)} with ${String(lastAckedRider)} accepted`,
          );
        }
        if (closed && rescue !== undefined) {
          violations.push('rescue() after close');
        }
      }
      // (2) A target never accepted is written no more often than it was set.
      for (const value of RIDER_VALUES) {
        if (!acked.has(value) && (writes.get(value) ?? 0) > (sets.get(value) ?? 0)) {
          violations.push(
            `${String(value)} written ${String(writes.get(value))}× for ${String(sets.get(value))} sets`,
          );
        }
      }
      // (1) Never a Stop or a Reset. (5) Nothing after close.
      expect(forbidden).toStrictEqual([]);
      expect(callbacksAfterClose).toBe(0);
      expect(violations).toStrictEqual([]);
    },
  );
});

describe('a trainer holding no accepted rider target is not rescued — PR #582 fourth review', () => {
  it('writes nothing after a refused FIRST target, however the rider stalls and recovers', async () => {
    // The review's probe: the wire used to read [9000, 25] — a floor 0x05 put
    // a trainer nothing had put into ERG into ERG at 25 W, and left it there.
    const rig = heldRig((target) => (target === 9000 ? 'refuse' : 'ok'));
    expect((await rig.erg.set(watts(9000))).kind).toBe('failed');
    await pedal(rig.erg, 0, [5, 5, 5, 5, 5, 5]);
    expect(rig.erg.rescue()).toBeUndefined();
    await pedal(
      rig.erg,
      6,
      Array.from({ length: 30 }, () => 85),
    );
    expect(rig.asked).toStrictEqual([9000]);
    expect(rig.erg.rescue()).toBeUndefined();
    expect(rig.faults).toStrictEqual([]);
  });

  it('rescues a first target on the tick after the machine accepts it — the control', async () => {
    // A first target still on the wire when the stall is judged: nothing is
    // held yet, so nothing is eased; once it is accepted, the next tick does.
    const rig = heldRig((target) => (target === 150 ? 'hold' : 'ok'));
    void rig.erg.set(watts(150));
    await pedalHeld(rig.erg, 0, [5, 5, 5, 5, 5, 5]);
    expect(rig.asked).toStrictEqual([150]);
    rig.held[0]?.accept();
    await flush();
    await pedalHeld(rig.erg, 6, [5]);
    expect(rig.asked).toStrictEqual([150, FLOOR_WATTS]);
    expect(rig.erg.rescue()).toMatchObject({ target: 150, holding: 'floor' });
  });
});

describe('a restore the machine refuses backs off, then stops — PR #582 fourth review', () => {
  /** 150 W accepted once, then refused on every later attempt. */
  function refusingRestore() {
    let offered = 0;
    const times: number[] = [];
    let clock = 0;
    const rig = heldRig((target) => {
      if (target === 150) {
        offered += 1;
        if (offered > 1) {
          times.push(clock);
          return 'refuse';
        }
      }
      return 'ok';
    });
    return { rig, times, setClock: (at: number) => (clock = at) };
  }

  async function pedalClocked(
    erg: ManualErg,
    setClock: (at: number) => void,
    from: number,
    cadences: readonly number[],
  ): Promise<void> {
    for (const [index, rpm] of cadences.entries()) {
      setClock(from + index);
      erg.observeCadence({ at: seconds(from + index), cadence: revolutionsPerMinute(rpm) });
      erg.tick(seconds(from + index));
      await erg.settled();
      await flush();
    }
  }

  it('is retried a bounded number of times, further apart each time, and reported once', async () => {
    // The review's probe: 31 writes of 150 and 32 faults in 40 s.
    const { rig, times, setClock } = refusingRestore();
    await rig.erg.set(watts(150));
    await pedalClocked(rig.erg, setClock, 0, [80, 78, 60, 40, 20, 8, 5, 4]);
    await pedalClocked(
      rig.erg,
      setClock,
      8,
      Array.from({ length: 60 }, () => 85),
    );
    expect(times).toHaveLength(1 + RESTORE_RETRIES);
    const gaps = times.slice(1).map((at, index) => at - (times[index] ?? 0));
    expect(gaps).toStrictEqual(
      Array.from({ length: RESTORE_RETRIES }, (_, index) => RESTORE_FIRST_GAP_SECONDS * 2 ** index),
    );
    expect(rig.faults).toHaveLength(1);
    expect(rig.erg.rescue()).toBeUndefined();
  });

  it('is tried again once the rider sets a target', async () => {
    const { rig, setClock } = refusingRestore();
    await rig.erg.set(watts(150));
    await pedalClocked(rig.erg, setClock, 0, [80, 78, 60, 40, 20, 8, 5, 4]);
    await pedalClocked(
      rig.erg,
      setClock,
      8,
      Array.from({ length: 60 }, () => 85),
    );
    const given = rig.asked.length;
    // Refused on the caller's promise, as any rider target is.
    expect((await rig.erg.set(watts(150))).kind).toBe('failed');
    expect(rig.asked.slice(given)).toStrictEqual([150]);
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
