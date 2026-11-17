// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1638: the urban runs the owner's realistic page publishes for its town —
 * #1633's counters, read off the map the town's plans were handed — and the
 * class a hold reads off them. Through `realistic/town.ts` §`plannedTown`,
 * the line the page runs, so a lever the page reads is the lever tested.
 */

import { describe, expect, it } from 'vitest';

import { cityCentreFixture } from '../src/game/testing/urban-fixtures';
import { NO_URBAN_CLASS } from '../src/game/urban-class';

import { plannedTown } from './realistic/town';
import { classAlong, urbanRunsOf } from './urban-runs';

const city = cityCentreFixture();
const total = city.profile.totalDistance;

describe('the realistic page’s town=city, by its urban runs — #1638', () => {
  it('reads a city centre at both of the page’s holds, and spans the whole road', () => {
    const { urban } = plannedTown(city, ['people']);
    const runs = urbanRunsOf(urban, total);
    expect(runs.reduce((sum, run) => sum + run.metres, 0)).toBeCloseTo(total, 6);
    for (const at of [1_430, 1_500]) expect(classAlong(runs, at), String(at)).toBe('city-centre');
    // Not every run a city's: the fixture's rural ends read otherwise.
    expect(classAlong(runs, 50)).not.toBe('city-centre');
    expect(classAlong(runs, total + 1)).toBeUndefined();
  });

  it('reads no class at all with levers=-urban-class: AE5’s before row', () => {
    const { urban } = plannedTown(city, ['people', 'urban-class']);
    expect(urban).toBe(NO_URBAN_CLASS);
    const runs = urbanRunsOf(urban, total);
    expect(runs).toStrictEqual([{ urban: 'unknown', metres: total }]);
    expect(classAlong(runs, 1_500)).toBe('unknown');
  });
});
