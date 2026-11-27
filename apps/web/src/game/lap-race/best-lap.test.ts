// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which lap of a lap race may be a loop's best lap — #2319 (`best-lap.ts`).
 */

import { metres, seconds } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { BEST_LAP_LEAST_SHARE, raceLapToKeep } from './best-lap';

const LOOP = 2_000;

function lap(distance: number, moving: number, partial?: true) {
  return {
    distance: metres(distance),
    movingTime: seconds(moving),
    ...(partial === undefined ? {} : { partial }),
  };
}

describe('raceLapToKeep — #2319', () => {
  it('offers the lap just finished, the last one stated, by its moving time', () => {
    expect(raceLapToKeep([lap(2_004, 260), lap(1_998, 251.5)], LOOP)).toBe(251.5);
  });

  it('offers nothing with no lap stated', () => {
    expect(raceLapToKeep([], LOOP)).toBeUndefined();
  });

  it('offers no part lap, however fast', () => {
    expect(raceLapToKeep([lap(2_000, 260), lap(2_000, 120, true)], LOOP)).toBeUndefined();
  });

  it('offers no lap shorter than the loop by more than a tenth, and one just inside it', () => {
    const least = BEST_LAP_LEAST_SHARE * LOOP;
    expect(raceLapToKeep([lap(least - 1, 200)], LOOP)).toBeUndefined();
    expect(raceLapToKeep([lap(least, 200)], LOOP)).toBe(200);
  });

  it('offers no lap of no time, and none on a loop of no length', () => {
    expect(raceLapToKeep([lap(2_000, 0)], LOOP)).toBeUndefined();
    expect(raceLapToKeep([lap(2_000, 200)], 0)).toBeUndefined();
  });
});
