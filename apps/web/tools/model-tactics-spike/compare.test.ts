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
      k: new Map([
        ['a', 0.5],
        ['b', 1],
        ['rider', 1],
      ]),
      power: new Map(),
      inside: 0,
    };
  });
  return { ticks, log: [], outcomes: {} as FieldRun['outcomes'], last: {} as FieldRun['last'] };
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
