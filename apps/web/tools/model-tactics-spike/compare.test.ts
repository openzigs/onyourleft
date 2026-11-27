// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616: the comparison's numbers, read off a field small enough to count
 * by hand, so the write-up's table is known to say what its columns say.
 */

import { describe, expect, it } from 'vitest';

import type { BotTactic } from '@onyourleft/domain';

import { fieldNumbers } from './compare';
import type { FieldRun, FieldTick } from './race';

/**
 * 700 ticks, 35 s: bot `b` sits in 11 m up the road throughout; bot `a`
 * sits in at 10 m, attacks on ticks 100 to 199, and rides 7 m further on
 * ticks 150 to 299, where it leads; the rider is at 9.5 m, just behind
 * `a`. `a` drafts at 30 s, and reads 0.4 of its W′ once.
 */
function field(): FieldRun {
  const ticks: FieldTick[] = Array.from({ length: 700 }, (_, at) => {
    const tactic: BotTactic = at >= 100 && at < 200 ? 'attack' : 'sit-in';
    return {
      second: (at + 1) * 0.05,
      at: new Map([
        ['a', 10 + (at >= 150 && at < 300 ? 7 : 0)],
        ['b', 11],
        ['rider', 9.5],
      ]),
      tactic: new Map<string, BotTactic>([
        ['a', tactic],
        ['b', 'sit-in'],
      ]),
      wbal: new Map([
        ['a', at === 400 ? 0.4 : 0.9],
        ['b', 1],
      ]),
      exhausted: new Map([
        ['a', false],
        ['b', false],
      ]),
      k: new Map([
        ['a', 0.5],
        ['b', 1],
        ['rider', 1],
      ]),
      power: new Map([
        ['a', 300],
        ['b', 250],
      ]),
      inside: 0,
    };
  });
  // Each bot's CP: `a` 280 W, `b` 260 W.
  const last = {
    bots: [
      { id: 'a', plan: { capacity: { cpWatts: 280 } } },
      { id: 'b', plan: { capacity: { cpWatts: 260 } } },
    ],
  } as unknown as FieldRun['last'];
  return { ticks, log: [], outcomes: {} as FieldRun['outcomes'], last };
}

describe('the comparison’s numbers (#2616)', () => {
  it('counts shares, changes, moves away, the lead, the pack, the spread, W′ and the rider’s place', () => {
    const numbers = fieldNumbers(field(), 'rider');
    expect(numbers.tacticShare.attack).toBe(0.071);
    expect(numbers.tacticShare['sit-in']).toBe(0.929);
    expect(numbers.tacticShare.flyer).toBe(0);
    // Two changes of move by `a` in 35 s, over two bots.
    expect(numbers.changesPerBotMinute).toBe(1.714);
    // `a` got 6 m clear of `b` while its attack ran.
    expect(numbers.awayMoves).toBe(1);
    // `b` led, `a` took it at tick 150, `b` took it back at tick 300.
    expect(numbers.leadChanges).toBe(2);
    expect(numbers.draftingAt30s).toBe(1);
    expect(numbers.spreadAtEndM).toBe(1);
    expect(numbers.lowestWbal).toBe(0.4);
    expect(numbers.riderPlaceAtEnd).toBe(3);
    // #2708: `a` first moved on tick 100, alone, and nobody chased.
    expect(numbers.firstMoveS).toBe(5.05);
    expect(numbers.mostMovingAtOnce).toBe(1);
    expect(numbers.chaseStartGapsM).toEqual([]);
    // #2720: one mover, nobody blown, and nobody on the rider's wheel.
    expect(numbers.movers).toBe(1);
    expect(numbers.blownBots).toBe(0);
    expect(numbers.blownOverCpTicks).toBe(0);
    expect(numbers.fadePlacesLost).toEqual([]);
    expect(numbers.onRiderWheelTicks).toBe(0);
    expect(numbers.riderTargets).toBe(0);
  });

  it('reads who blew, whether a blown bot rode over CP, the places each lost, and the rider marked (#2720)', () => {
    const run = field();
    const ticks = run.ticks.map((tick, at) => {
      // `a` is blown, at 0.1 of its W′, from tick 300 to 349 and again from
      // tick 680; on ticks 300 to 309 it still rides 300 W, over its 280 W CP. From tick 300
      // the rider rides 12 m up the road, past `b`, so `a` lost one place
      // 30 s after it blew; its second blow is read at the end, 20 ticks
      // on, when it has lost none. `b` follows on ticks 500 to 519 with the
      // rider directly ahead.
      const blown = (at >= 300 && at < 350) || at >= 680;
      return {
        ...tick,
        at: new Map(
          [...tick.at].map(([id, place]) => [id, id === 'rider' && at >= 400 ? 12 : place]),
        ),
        exhausted: new Map([
          ['a', blown],
          ['b', false],
        ]),
        wbal: new Map([
          ['a', blown ? 0.1 : 0.9],
          ['b', 1],
        ]),
        power: new Map([
          ['a', blown && at < 310 ? 300 : 200],
          ['b', 250],
        ]),
        tactic: new Map<string, BotTactic>([
          ['a', tick.tactic.get('a') as BotTactic],
          ['b', at >= 500 && at < 520 ? 'follow' : 'sit-in'],
        ]),
      };
    });
    const log: FieldRun['log'] = [
      {
        requestedAtMs: 4_000,
        arrivedAtMs: 6_000,
        outcome: 'decision',
        moves: [
          { bot: 0, move: 'follow', target: 'rider' },
          { bot: 1, move: 'chase', target: 'rider' },
        ],
      },
      // A target on a move that takes none, and a decision never applied, are not counted.
      {
        requestedAtMs: 8_000,
        arrivedAtMs: 10_000,
        outcome: 'decision',
        moves: [{ bot: 0, move: 'attack', target: 'rider' }],
      },
      {
        requestedAtMs: 12_000,
        arrivedAtMs: 18_000,
        outcome: 'late',
        moves: [{ bot: 0, move: 'follow', target: 'rider' }],
      },
    ];
    const numbers = fieldNumbers({ ...run, ticks, log }, 'rider');
    expect(numbers.blownBots).toBe(1);
    // The tick that blew it is not counted: it went into that one fresh.
    expect(numbers.blownOverCpTicks).toBe(9);
    expect(numbers.fadePlacesLost).toEqual([1, 0]);
    expect(numbers.onRiderWheelTicks).toBe(20);
    expect(numbers.riderTargets).toBe(2);
  });

  it('reads when the first move went, how many went at once, and the gap each chase began at (#2708)', () => {
    const run = field();
    const ticks = run.ticks.map((tick, at) => {
      // `b` rides a flyer on ticks 150 to 159, and from tick 400 it is 35 m
      // up the road; `a` chases on ticks 400 to 449 and again on 600 to 609.
      const chasing = (at >= 400 && at < 450) || (at >= 600 && at < 610);
      return {
        ...tick,
        at: new Map([...tick.at].map(([id, place]) => [id, id === 'b' && at >= 400 ? 45 : place])),
        tactic: new Map<string, BotTactic>([
          ['a', chasing ? 'chase' : (tick.tactic.get('a') as BotTactic)],
          ['b', at >= 150 && at < 160 ? 'flyer' : 'sit-in'],
        ]),
      };
    });
    const numbers = fieldNumbers({ ...run, ticks }, 'rider');
    expect(numbers.firstMoveS).toBe(5.05);
    expect(numbers.mostMovingAtOnce).toBe(2);
    expect(numbers.chaseStartGapsM).toEqual([35, 35]);
    // Nobody moved: no first move, and none at once.
    const still = run.ticks.map((tick) => ({
      ...tick,
      tactic: new Map<string, BotTactic>([
        ['a', 'sit-in'],
        ['b', 'sit-in'],
      ]),
    }));
    expect(fieldNumbers({ ...run, ticks: still }, 'rider').firstMoveS).toBeNull();
    expect(fieldNumbers({ ...run, ticks: still }, 'rider').mostMovingAtOnce).toBe(0);
  });

  it('leaves out a chase begun in the lead, which has no gap to cross (#2715)', () => {
    const run = field();
    const ticks = run.ticks.map((tick, at) => {
      // `b` leads 35 m up the road from tick 400. `a` chases it on ticks 400
      // to 449; `b`, with nobody ahead, "chases" on ticks 500 to 509.
      return {
        ...tick,
        at: new Map([...tick.at].map(([id, place]) => [id, id === 'b' && at >= 400 ? 45 : place])),
        tactic: new Map<string, BotTactic>([
          ['a', at >= 400 && at < 450 ? 'chase' : 'sit-in'],
          ['b', at >= 500 && at < 510 ? 'chase' : 'sit-in'],
        ]),
      };
    });
    expect(fieldNumbers({ ...run, ticks }, 'rider').chaseStartGapsM).toEqual([35]);
  });

  it('does not count a move that never got 5 m clear', () => {
    const run = field();
    const near = run.ticks.map((tick) => ({
      ...tick,
      at: new Map([...tick.at].map(([id, at]) => [id, id === 'a' ? Math.min(at, 15.9) : at])),
    }));
    expect(fieldNumbers({ ...run, ticks: near }, 'rider').awayMoves).toBe(0);
  });
});
