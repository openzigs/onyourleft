// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2080 — a loop's lap splits: the lap in progress, the last and the best,
 * from the recording's own laps and nothing else. `ride/controller.test.ts`
 * §"#2080" reads the same rows from a saved ride.
 */

import { metres, seconds, unixSeconds, watts } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import type { LapFigures } from '../../recording/laps';

import { lapSplits } from './lap-splits';

/** A whole lap of a 4 km course, in `moving` seconds, at `power`. */
function lap(moving: number, power?: number, extra: Partial<LapFigures> = {}): LapFigures {
  return {
    startedAt: unixSeconds(1_800_000_000),
    elapsedTime: seconds(moving),
    movingTime: seconds(moving),
    distance: metres(4_000),
    ...(power === undefined ? {} : { averagePower: watts(power) }),
    ...extra,
  };
}

describe('lapSplits — #2080', () => {
  it('reads dashes with nothing recording, never a nought', () => {
    expect(lapSplits([], undefined)).toEqual({
      now: { label: 'Now', lap: '—', time: '—', power: '—' },
      last: { label: 'Last', lap: '—', time: '—', power: '—' },
      best: { label: 'Best', lap: '—', time: '—', power: '—' },
    });
  });

  it('numbers the lap in progress after the laps finished, with the recorder’s time on it', () => {
    expect(lapSplits([], 0).now).toEqual({ label: 'Now', lap: '1', time: '0:00', power: '—' });
    expect(lapSplits([lap(300, 210), lap(290, 220)], 75.9).now).toEqual({
      label: 'Now',
      lap: '3',
      time: '1:15',
      power: '—',
    });
  });

  it('says the last lap and the best, each with its number, time and average power', () => {
    const splits = lapSplits([lap(312, 205), lap(298, 231), lap(305, 224)], 10);
    expect(splits.last).toEqual({ label: 'Last', lap: '3', time: '5:05', power: '224 W' });
    expect(splits.best).toEqual({ label: 'Best', lap: '2', time: '4:58', power: '231 W' });
  });

  it('takes the earlier of two laps level in the seconds shown', () => {
    // 298.2 and 298.9 are both shown as 4:58.
    expect(lapSplits([lap(298.9, 200), lap(298.2, 240)], 0).best.lap).toBe('1');
  });

  it('counts no part lap as the last or the best', () => {
    const splits = lapSplits(
      [lap(300, 210), lap(120, 300, { distance: metres(900), partial: true })],
      undefined,
    );
    expect(splits.last.lap).toBe('1');
    expect(splits.best.lap).toBe('1');
  });

  it('counts no lap of another course as this course’s best', () => {
    const splits = lapSplits([lap(200, 250, { distance: metres(3_000) }), lap(300, 210)], 0);
    expect(splits.best).toEqual({ label: 'Best', lap: '2', time: '5:00', power: '210 W' });
  });

  it('gives a lap ridden while the recording was paused no time and no best', () => {
    const splits = lapSplits([lap(300, 210), lap(0)], 0);
    expect(splits.last).toEqual({ label: 'Last', lap: '2', time: '—', power: '—' });
    expect(splits.best.lap).toBe('1');
  });
});
