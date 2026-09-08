// SPDX-License-Identifier: Apache-2.0

/**
 * #14's control loop: coalescing, acknowledgement, and the Reset trap.
 */

import { watts, type Watts } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { createErgWriter, type ErgSink } from './erg-writer';

/** A machine that answers when told to, so a test controls the timing. */
function scriptedSink(): {
  sink: ErgSink;
  /** Every target the machine was asked for, in order. */
  asked: Watts[];
  /** Answer the oldest outstanding write. `quantised` defaults to the target. */
  answer(quantised?: number): void;
  /** Refuse the oldest outstanding write. */
  refuse(error: unknown): void;
  outstanding(): number;
} {
  const asked: Watts[] = [];
  const pending: Array<{
    target: Watts;
    resolve: (value: Watts) => void;
    reject: (reason: unknown) => void;
  }> = [];

  return {
    sink: {
      setTargetPower(target: Watts): Promise<Watts> {
        asked.push(target);
        return new Promise<Watts>((resolve, reject) => {
          pending.push({ target, resolve, reject });
        });
      },
    },
    asked,
    answer(quantised?: number) {
      const next = pending.shift();
      if (next === undefined) throw new Error('nothing outstanding to answer');
      next.resolve(quantised === undefined ? next.target : watts(quantised));
    },
    refuse(error: unknown) {
      const next = pending.shift();
      if (next === undefined) throw new Error('nothing outstanding to refuse');
      next.reject(error);
    },
    outstanding: () => pending.length,
  };
}

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
};

describe('an interval boundary is acknowledged, not merely sent', () => {
  it('resolves written only once the machine has confirmed', async () => {
    // #14: "each interval's target is sent AND acknowledged before the interval
    // is treated as begun". A player awaits this.
    const machine = scriptedSink();
    const writer = createErgWriter(machine.sink);

    const landed = writer.offer(watts(250));
    let resolved = false;
    void landed.then(() => {
      resolved = true;
    });

    await settle();
    expect(resolved).toBe(false);
    expect(machine.outstanding()).toBe(1);

    machine.answer();
    expect(await landed).toEqual({ kind: 'written', target: 250, quantised: 250 });
  });

  it('carries the QUANTISED value back, which is not always what was asked', async () => {
    // `setTargetPower` returns the value after quantisation to the device's
    // minimum increment. A screen showing the asked-for number while the
    // trainer holds a different one is the small lie this prevents.
    const machine = scriptedSink();
    const writer = createErgWriter(machine.sink);
    const landed = writer.offer(watts(253));
    machine.answer(250);
    expect(await landed).toEqual({ kind: 'written', target: 253, quantised: 250 });
    expect(writer.lastWritten()).toBe(250);
  });

  it('reports a refusal in the outcome and never rejects', async () => {
    // A caller offering at 1 Hz has nowhere to catch a rejection four seconds
    // later, and an unhandled one would take the ride screen down.
    const machine = scriptedSink();
    const writer = createErgWriter(machine.sink);
    const landed = writer.offer(watts(250));
    machine.refuse(new Error('control-not-held'));
    const outcome = await landed;
    expect(outcome.kind).toBe('failed');
    expect(writer.lastWritten()).toBeUndefined();
  });
});

describe('the queue is bounded at two, however fast the caller offers', () => {
  it('keeps only the newest while the machine is busy', async () => {
    const machine = scriptedSink();
    const writer = createErgWriter(machine.sink);

    const first = writer.offer(watts(200));
    const second = writer.offer(watts(210));
    const third = writer.offer(watts(220));
    const fourth = writer.offer(watts(230));

    // One on the wire, one waiting. The two in between never happen.
    expect(machine.asked).toEqual([200]);
    expect(writer.coalesced()).toBe(2);

    expect(await second).toEqual({ kind: 'superseded', target: 210 });
    expect(await third).toEqual({ kind: 'superseded', target: 220 });

    machine.answer();
    await settle();
    expect(await first).toEqual({ kind: 'written', target: 200, quantised: 200 });
    // The newest is what reached the wire next — not the oldest in the backlog.
    expect(machine.asked).toEqual([200, 230]);
    machine.answer();
    expect(await fourth).toEqual({ kind: 'written', target: 230, quantised: 230 });
  });

  it('stays at depth two under a hundred offers against a stalled machine', () => {
    // The failure this bounds: a trainer stalls for thirty seconds, thirty
    // targets queue, and the client then spends thirty seconds writing targets
    // the workout has already passed.
    const machine = scriptedSink();
    const writer = createErgWriter(machine.sink);
    for (let offer = 0; offer < 100; offer += 1) {
      void writer.offer(watts(100 + offer));
    }
    expect(machine.asked).toHaveLength(1);
    expect(writer.attempted()).toBe(1);
    expect(writer.coalesced()).toBe(98);
  });

  it('settles a superseded offer rather than leaving its caller hanging', async () => {
    // The half a fire-and-forget writer does not have to think about: a player
    // awaiting an interval boundary that got replaced must not wait forever.
    const machine = scriptedSink();
    const writer = createErgWriter(machine.sink);
    void writer.offer(watts(200));
    const dropped = writer.offer(watts(210));
    void writer.offer(watts(220));
    await expect(dropped).resolves.toEqual({ kind: 'superseded', target: 210 });
  });
});

describe('closing', () => {
  it('refuses later offers and settles them', async () => {
    const machine = scriptedSink();
    const writer = createErgWriter(machine.sink);
    writer.close();
    await expect(writer.offer(watts(250))).resolves.toEqual({ kind: 'closed', target: 250 });
    expect(machine.asked).toEqual([]);
  });

  it('settles a waiting offer rather than dropping it silently', async () => {
    const machine = scriptedSink();
    const writer = createErgWriter(machine.sink);
    void writer.offer(watts(200));
    const waiting = writer.offer(watts(210));
    writer.close();
    await expect(waiting).resolves.toEqual({ kind: 'closed', target: 210 });
  });

  it('does NOT stop the trainer, which is a different instruction', async () => {
    // Closing ends this client's stream of targets; the machine keeps holding
    // the last one until somebody calls stop() on the control. A rider left
    // pedalling against a target because a screen unmounted is the failure that
    // follows from conflating the two — so `ErgSink` cannot reach `stop` either.
    const machine = scriptedSink();
    const writer = createErgWriter(machine.sink);
    const landed = writer.offer(watts(250));
    machine.answer();
    await landed;
    writer.close();
    expect(writer.lastWritten()).toBe(250);
  });
});

describe('the Reset trap is closed by the type', () => {
  it('cannot reach reset, stop or any other control method', () => {
    // FTMS §4.16.2.1: a client-initiated Reset revokes the client's OWN control
    // permission, and #14 names this as the trap for exactly this component —
    // "a workout player that resets between intervals and keeps sending targets
    // will be silently ignored".
    //
    // ⚠️ The guarantee is that `ErgSink` is `Pick<TrainerControl,
    // 'setTargetPower'>`, so these are compile errors rather than a comment
    // asking nicely. Widen the type and TS2578 fires on the unused directives,
    // which is CLAUDE.md §5's stated mutation for a compile-time guard.
    const machine = scriptedSink();
    const sink: ErgSink = machine.sink;

    // @ts-expect-error `reset` is not reachable from an ErgSink, by design.
    expect(sink.reset).toBeUndefined();
    // @ts-expect-error nor is `stop`.
    expect(sink.stop).toBeUndefined();
    // @ts-expect-error nor is `requestControl`.
    expect(sink.requestControl).toBeUndefined();
  });
});
