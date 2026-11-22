// SPDX-License-Identifier: AGPL-3.0-or-later

/** #2882: the hour's ride and the lead search the write-up's streaming numbers come from. */

import { describe, expect, it } from 'vitest';

import { streamRide } from './block-grid';
import { hourRide, leadNeeded } from './streaming';

const START = { latitude: 41.8885, longitude: -87.7945 };

describe('streaming numbers (#2882)', () => {
  it('rides an hour, one position a second', () => {
    expect(hourRide(START, 1, 40)).toHaveLength(3_601);
    expect(hourRide(START, 1, 30)).toHaveLength(3_601);
  });

  it('reads more on a staircase that never comes back than on a ride that wanders', () => {
    const count = (pattern: 'random' | 'staircase') =>
      streamRide({
        path: hourRide(START, 1, 30, pattern),
        stepSeconds: 1,
        size: 1,
        need: 400,
        lead: 200,
        readyAfterMs: 0,
      }).tiles;
    expect(count('staircase')).toBeGreaterThan(count('random'));
  });

  it('finds the shortest lead with nothing late, and it grows with the time to ready', () => {
    const path = hourRide(START, 1, 40).slice(0, 600);
    const quick = leadNeeded({ path, size: 1, need: 400, readyAfterMs: 1_000 }) as number;
    const slow = leadNeeded({ path, size: 1, need: 400, readyAfterMs: 8_000 }) as number;
    expect(slow).toBeGreaterThan(quick);
    // The lead found is the shortest: 10 m less is late.
    const base = { path, stepSeconds: 1, size: 1, need: 400, readyAfterMs: 8_000 };
    expect(streamRide({ ...base, lead: slow }).late).toBe(0);
    expect(streamRide({ ...base, lead: slow - 10 }).late).toBeGreaterThan(0);
  });

  it('says so when no lead up to the most it may try is enough', () => {
    const path = hourRide(START, 1, 40).slice(0, 600);
    expect(
      leadNeeded({ path, size: 1, need: 400, readyAfterMs: 60_000, most: 20 }),
    ).toBeUndefined();
  });
});
