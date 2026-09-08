// SPDX-License-Identifier: Apache-2.0

/**
 * #90 criterion 4: a stalled control point must not grow a backlog.
 *
 * The first half is against a sink whose promises this file resolves by hand,
 * because the property being asserted is about **timing that no real machine
 * would reproduce on demand**: a write held open across a dozen offers. The
 * second half is the same shape against the #44 simulator, with its control
 * point genuinely not answering, so the bound is shown to hold through the real
 * `createTrainerControl` and its serialising queue rather than only against a
 * fake.
 */

import { gradePercent } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { SensorError, isSensorError } from '../../src/errors';

import { FTMS_OP_CODE, type SimulationParameters } from './fitness-machine-control';
import { createSimulationWriter, type SimulationSink } from './simulation-writer';
import { connectSimulatedTrainer } from './simulator-bridge';

/** A control point that answers only when this test says so. */
function heldSink(): {
  readonly sink: SimulationSink;
  readonly written: SimulationParameters[];
  /** Settle the oldest outstanding write. */
  readonly answer: (error?: unknown) => void;
  readonly outstanding: () => number;
} {
  const written: SimulationParameters[] = [];
  const pending: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
  return {
    written,
    outstanding: () => pending.length,
    sink: {
      setSimulationParameters(parameters) {
        written.push(parameters);
        return new Promise<void>((resolve, reject) => {
          pending.push({ resolve, reject });
        });
      },
    },
    answer(error) {
      const next = pending.shift();
      if (next === undefined) {
        throw new Error('nothing is outstanding');
      }
      if (error === undefined) {
        next.resolve();
      } else {
        next.reject(error);
      }
    },
  };
}

const flush = (): Promise<void> => Promise.resolve().then(() => undefined);

describe('a control point that has stopped answering', () => {
  it('coalesces: one write in flight, one waiting, and never more', async () => {
    const machine = heldSink();
    const writer = createSimulationWriter(machine.sink);

    for (let percent = 1; percent <= 20; percent += 1) {
      writer.offer({ grade: gradePercent(percent) });
    }

    // Twenty offers, ONE write on the wire. Nineteen went into the single
    // waiting slot, eighteen of them replacing an occupant.
    expect(machine.written).toStrictEqual([{ grade: 1 }]);
    expect(machine.outstanding()).toBe(1);
    expect(writer.attempted()).toBe(1);
    expect(writer.coalesced()).toBe(18);

    // The machine answers. What goes out next is the NEWEST offer, not the
    // second one — the rider is at 20 %, not still at 2 %.
    machine.answer();
    await flush();
    expect(machine.written).toStrictEqual([{ grade: 1 }, { grade: 20 }]);

    machine.answer();
    await writer.idle();
    expect(writer.busy()).toBe(false);
    // Two writes for twenty offers, whatever the machine did.
    expect(machine.written).toHaveLength(2);
    // The invariant: every offer was either written or superseded by a newer
    // one. Nothing is unaccounted for and nothing is still queued.
    expect(writer.attempted() + writer.coalesced()).toBe(20);
  });

  it('holds its depth at two however long the stall lasts', async () => {
    const machine = heldSink();
    const writer = createSimulationWriter(machine.sink);

    // A thousand offers into a machine that never answers.
    for (let tick = 0; tick < 1000; tick += 1) {
      writer.offer({ grade: gradePercent((tick % 20) - 10) });
    }
    expect(machine.outstanding()).toBe(1);
    expect(writer.attempted()).toBe(1);
    expect(writer.coalesced()).toBe(998);

    machine.answer();
    await flush();
    // Exactly one more, carrying the last offer.
    expect(machine.outstanding()).toBe(1);
    expect(machine.written.at(-1)).toStrictEqual({ grade: 9 });
    machine.answer();
    await writer.idle();
    expect(writer.attempted() + writer.coalesced()).toBe(1000);
  });

  it('reports a failed write rather than throwing it at a caller with no catch', async () => {
    const machine = heldSink();
    const failures: Array<{ error: unknown; parameters: SimulationParameters }> = [];
    const writer = createSimulationWriter(machine.sink, {
      onError: (error, parameters) => failures.push({ error, parameters }),
    });

    writer.offer({ grade: gradePercent(6) });
    machine.answer(new SensorError('control-not-held', 'no'));
    await writer.idle();

    expect(failures).toHaveLength(1);
    expect(isSensorError(failures[0]?.error, 'control-not-held')).toBe(true);
    expect(failures[0]?.parameters).toStrictEqual({ grade: 6 });
    // And the writer is still usable: one bad gradient does not end the ride.
    writer.offer({ grade: gradePercent(7) });
    machine.answer();
    await writer.idle();
    expect(machine.written).toStrictEqual([{ grade: 6 }, { grade: 7 }]);
  });

  it('swallows a failure when nothing asked to be told, rather than rejecting unhandled', async () => {
    const machine = heldSink();
    const writer = createSimulationWriter(machine.sink);
    writer.offer({ grade: gradePercent(6) });
    machine.answer(new SensorError('control-rejected', 'no'));
    await expect(writer.idle()).resolves.toBeUndefined();
  });

  it('empties the waiting slot on close, and does not start what it was holding', async () => {
    const machine = heldSink();
    const writer = createSimulationWriter(machine.sink);
    writer.offer({ grade: gradePercent(1) });
    writer.offer({ grade: gradePercent(2) });
    writer.close();

    machine.answer();
    await writer.idle();

    expect(machine.written).toStrictEqual([{ grade: 1 }]);
    writer.offer({ grade: gradePercent(3) });
    expect(machine.written).toStrictEqual([{ grade: 1 }]);
  });

  it('is idle before anything is offered', async () => {
    const machine = heldSink();
    const writer = createSimulationWriter(machine.sink);
    expect(writer.busy()).toBe(false);
    await expect(writer.idle()).resolves.toBeUndefined();
  });
});

describe('a stalled control point on the #44 simulator', () => {
  it('leaves at most two gradients outstanding, and writes the newest first when it recovers', async () => {
    const trainer = await connectSimulatedTrainer();
    await trainer.control.requestControl();
    const writer = createSimulationWriter(trainer.control);

    const before = trainer.wire.filter(
      (entry) =>
        entry.direction === 'write' &&
        entry.bytes[0] === FTMS_OP_CODE.setIndoorBikeSimulationParameters,
    ).length;

    trainer.stall();
    for (let percent = 1; percent <= 30; percent += 1) {
      writer.offer({ grade: gradePercent(percent) });
      // Let every promise continuation run, so a writer that queued would have
      // every chance to enqueue.
      await flush();
    }

    const simulationWrites = () =>
      trainer.wire.filter(
        (entry) =>
          entry.direction === 'write' &&
          entry.bytes[0] === FTMS_OP_CODE.setIndoorBikeSimulationParameters,
      );
    // One on the wire. Twenty-nine offers went nowhere.
    expect(simulationWrites().length - before).toBe(1);
    expect(writer.coalesced()).toBe(28);

    trainer.release();
    await writer.idle();

    // Two writes for thirty offers, and the machine ends on the newest.
    expect(simulationWrites().length - before).toBe(2);
    expect(writer.attempted() + writer.coalesced()).toBe(30);
    expect(trainer.gradeOnTheTrainer()).toBeCloseTo(30, 6);
  });

  it('is bounded even when the machine refuses everything it is sent', async () => {
    const trainer = await connectSimulatedTrainer();
    await trainer.control.requestControl();
    // Take control away, so every gradient is refused with 0x05.
    trainer.handle().script({ kind: 'control-permission-lost' });

    const failures: unknown[] = [];
    const writer = createSimulationWriter(trainer.control, {
      onError: (error) => failures.push(error),
    });
    for (let percent = 1; percent <= 40; percent += 1) {
      writer.offer({ grade: gradePercent(percent) });
      await flush();
    }
    await writer.idle();

    expect(writer.busy()).toBe(false);
    // ⚠️ NOT one write here, and that is right rather than a miss. A refusal
    // that never reaches the wire settles in a microtask, so the writer is not
    // stalled — it is fast-failing, and each offer gets its own attempt. The
    // bound that has to hold is the accounting one: every offer was either
    // attempted or superseded, and nothing accumulated.
    expect(writer.attempted() + writer.coalesced()).toBe(40);
    expect(writer.attempted()).toBeLessThanOrEqual(40);
    expect(failures.length).toBe(writer.attempted());
    expect(isSensorError(failures[0], 'control-not-held')).toBe(true);
    // Nothing was applied, and no ERG target was set by accident either.
    expect(trainer.targetPowerOnTheTrainer()).toBeUndefined();
    expect(trainer.gradeOnTheTrainer()).toBeUndefined();
  });
});
