// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How many obstacles a built-in level's round places — #2362, the owner's
 * ruling of 2026-11-08 on PR #2378: Morning Round always 2 to 3. Each shipped
 * level's real round is started, as `GameView` starts one, over hundreds of
 * seeds: its houses picked from its own footprints, its span from the start
 * to its last house, and its obstacles placed over that span.
 *
 * ⚠️ Nothing here is drawn or kept: the rounds are in memory only, and the
 * test names say no place (ADR 0065 D-13).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { FOOTPRINT_MAX_VERTICES, footprintPlans } from '../../footprint-buildings';
import { landClassMask } from '../../land-class';
import { mappedBuildingsOf } from '../../mapped-buildings';
import { lineOffsetAt, racingLine } from '../../racing-line';
import { corridorOrigin } from '../../terrain';
import { urbanClassMap } from '../../urban-class';
import { LEVEL_FEWEST_OBSTACLES, levelObstacleMix, OBSTACLE_SIGHT_METRES } from '../obstacles';
import { startDeliveryRide } from '../ride-round';

import { parseLevelFile, type LevelFile } from './level-file';
import { levelCorridor, levelRoute } from './levels';

const DATA = join(dirname(fileURLToPath(import.meta.url)), 'data');

function read(id: string): LevelFile {
  return parseLevelFile(JSON.parse(readFileSync(join(DATA, `${id}.json`), 'utf8')) as unknown, id);
}

/** Every seed swept: 1 to 300. */
const SEEDS = Array.from({ length: 300 }, (_, index) => index + 1);

/**
 * #2528, #1688's ruling: cheaper, never a longer timeout. A seed's round is
 * picked from the level's footprints afresh (`targets.ts` §`pickRoundTargets`),
 * about 4.5 ms a seed on level 1 and 11 ms on level 2 on this Mac, so the 300
 * seeds of one level were one case of 1 408 ms and 3 520 ms without coverage,
 * 2 931 ms and 6 846 ms with `--coverage` (Node 26, load average near 2), each
 * under a 120 s per-case limit of its own. The same 300 seeds are now swept in cases of
 * {@link SEEDS_A_CASE}, each with the level's footprints planned once
 * ({@link plannedOn}) and every round checked as before; that both counts
 * occur on level 1 is its own case, at the first seed of each. Now each case
 * takes at most 307 ms on level 1 and 659 ms on level 2 without coverage,
 * 601 ms and 1 348 ms with `--coverage`, the first of each paying for the plan.
 */
const SEEDS_A_CASE = 50;

/** The seeds swept, cut into cases of {@link SEEDS_A_CASE}. */
const SEED_CHUNKS = Array.from({ length: SEEDS.length / SEEDS_A_CASE }, (_, chunk) =>
  SEEDS.slice(chunk * SEEDS_A_CASE, (chunk + 1) * SEEDS_A_CASE),
);

interface Planned {
  readonly level: LevelFile;
  readonly profile: ReturnType<typeof levelRoute>['profile'];
  readonly buildings: ReturnType<typeof mappedBuildingsOf>;
}

const planned = new Map<string, Planned>();

/** The level `id`, read and its footprints planned as `GameView` plans them, once for this file. */
function plannedOn(id: string): Planned {
  const known = planned.get(id);
  if (known !== undefined) return known;
  const level = read(id);
  const profile = levelRoute(level).profile;
  const corridor = levelCorridor(level);
  const mask = landClassMask(corridor);
  const { plans } = footprintPlans(
    corridor,
    mask,
    profile,
    corridorOrigin(profile),
    FOOTPRINT_MAX_VERTICES,
    urbanClassMap(corridor, mask, profile),
  );
  const made = { level, profile, buildings: mappedBuildingsOf(plans) };
  planned.set(id, made);
  return made;
}

/** The counts of obstacles each of `seeds`' rounds places on the level `id`, each round checked as it is placed. */
function countsOn(id: string, seeds: readonly number[]): Set<number> {
  const { level, profile, buildings } = plannedOn(id);
  const counts = new Set<number>();
  for (const seed of seeds) {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
      <T extends ArrayBufferView>(array: T): T => {
        (array as unknown as Uint32Array)[0] = seed;
        return array;
      },
    );
    const ride = startDeliveryRide({
      buildings,
      profile,
      origin: corridorOrigin(profile),
      riderDistance: 0,
      lineOffset: lineOffsetAt(racingLine(profile), 0),
      storage: undefined,
      level: { ...level.round, lengthMetres: level.lengthMetres, id: level.id },
    });
    vi.restoreAllMocks();
    expect(ride, `seed ${String(seed)}`).toBeDefined();
    if (ride === undefined) continue;
    counts.add(ride.obstacles.length);
    // None in sight at the start, none in sight of the one before (the clear-lane
    // rule is `obstacles.test.ts`' sweep over the same placement).
    let before = -Infinity;
    for (const obstacle of ride.obstacles) {
      expect(obstacle.along).toBeGreaterThanOrEqual(OBSTACLE_SIGHT_METRES);
      expect(obstacle.along - before).toBeGreaterThanOrEqual(OBSTACLE_SIGHT_METRES);
      before = obstacle.along;
    }
  }
  return counts;
}

const span = (seeds: readonly number[]): string => `${String(seeds[0])} to ${String(seeds.at(-1))}`;

describe('a level round’s obstacle count — #2362, the owner’s ruling of 2026-11-08', () => {
  it('asks for 2 to 3 on level 1, and 2 to 6 on level 2', () => {
    const one = read('morning-round');
    expect(levelObstacleMix(one.round, one.lengthMetres)).toMatchObject({ fewest: 2, most: 3 });
    const two = read('busy-round');
    expect(levelObstacleMix(two.round, two.lengthMetres)).toMatchObject({
      fewest: LEVEL_FEWEST_OBSTACLES,
      most: 6,
    });
  });

  for (const seeds of SEED_CHUNKS) {
    it(`places 2 or 3 on level 1 at every seed from ${span(seeds)}`, () => {
      for (const count of countsOn('morning-round', seeds)) expect([2, 3]).toContain(count);
    });
  }

  // #3047: seeds 1 to 16 and 17 until each footprint two tiles carried was planned once.
  it('places both: 2 on level 1 at seeds 1 to 39, and 3 at seed 40', () => {
    expect(countsOn('morning-round', SEEDS.slice(0, 39))).toEqual(new Set([2]));
    expect(countsOn('morning-round', [40])).toEqual(new Set([3]));
  });

  for (const seeds of SEED_CHUNKS) {
    it(`places 2 to 6 on level 2 at every seed from ${span(seeds)}`, () => {
      for (const count of countsOn('busy-round', seeds)) {
        expect(count).toBeGreaterThanOrEqual(LEVEL_FEWEST_OBSTACLES);
        expect(count).toBeLessThanOrEqual(6);
      }
    });
  }
});
