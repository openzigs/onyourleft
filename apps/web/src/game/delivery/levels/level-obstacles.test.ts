// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How many obstacles a built-in level's round places — #2362, the owner's
 * ruling of 2026-11-08 on PR #2378 (Morning Round 2 to 3), raised by #2969
 * after the owner's tablet ride of 2026-11-20 (*"not seeing cars"*, *"not many
 * obstacles"*). Each shipped level's real round is started, as `GameView`
 * starts one, over hundreds of seeds: its houses picked from its own
 * footprints, its span from the start to its last house, and its obstacles
 * placed over that span.
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
import {
  LEVEL_FEWEST_OBSTACLES,
  LEVEL_SHORTEST_STRETCH_METRES,
  levelCarCount,
  levelMovingCount,
  levelObstacleMix,
  OBSTACLE_SIGHT_METRES,
} from '../obstacles';
import { startDeliveryRide } from '../ride-round';
import { TARGET_WINDOW_HALF_METRES } from '../targets';

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
 * under a 120 s per-case limit of its own. The same 300 seeds are swept in
 * cases of {@link SEEDS_A_CASE}, each with the level's footprints planned once
 * ({@link plannedOn}) and every round checked as before.
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

/** What one round placed: how many obstacles, how many of them parked cars, over how long a span. */
interface Placed {
  readonly obstacles: number;
  readonly cars: number;
  readonly spanMetres: number;
}

/** What each of `seeds`' rounds places on the level `id`, each round checked as it is placed. */
function placedOn(id: string, seeds: readonly number[]): readonly Placed[] {
  const { level, profile, buildings } = plannedOn(id);
  const placed: Placed[] = [];
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
    // The span `startDeliveryRide` places over: the start to its last house's window.
    const last = Math.max(
      ride.targets.at(-1)?.distance ?? 0,
      ride.noDeliveryTargets.at(-1)?.distance ?? 0,
    );
    placed.push({
      obstacles: ride.obstacles.length,
      cars: ride.obstacles.filter((obstacle) => obstacle.kind === 'parked-car').length,
      spanMetres: last + TARGET_WINDOW_HALF_METRES,
    });
    // None in sight at the start, none in sight of the one before (the clear-lane
    // rule is `obstacles.test.ts`' sweep over the same placement).
    let before = -Infinity;
    for (const obstacle of ride.obstacles) {
      expect(obstacle.along).toBeGreaterThanOrEqual(OBSTACLE_SIGHT_METRES);
      expect(obstacle.along - before).toBeGreaterThanOrEqual(OBSTACLE_SIGHT_METRES);
      before = obstacle.along;
    }
  }
  return placed;
}

const span = (seeds: readonly number[]): string => `${String(seeds[0])} to ${String(seeds.at(-1))}`;

/**
 * #2969's proposal, for the owner's approval: each level's density a
 * kilometre, static and moving, the most a round of it places (that density
 * over the level's whole length), and its floor — the fewest obstacles and
 * parked cars any of the 300 seeds' rounds places, a round being as long as
 * its last house. Morning Round's 5 a kilometre is one every 200 m; Evening
 * Round's 7, one every 143 m. Written out, so a change to any of them is a
 * change to this table.
 */
const PROPOSED = {
  'morning-round': { static: 5, moving: 0, most: 11, fewest: 5, cars: 4 },
  'busy-round': { static: 5, moving: 0, most: 15, fewest: 6, cars: 5 },
  'corner-round': { static: 5, moving: 1, most: 17, fewest: 8, cars: 6 },
  'mailbox-round': { static: 5, moving: 1.5, most: 25, fewest: 19, cars: 12 },
  'rainy-round': { static: 5, moving: 1.5, most: 25, fewest: 21, cars: 12 },
  'evening-round': { static: 5, moving: 2, most: 20, fewest: 11, cars: 6 },
} as const;

const LEVEL_IDS = Object.keys(PROPOSED) as (keyof typeof PROPOSED)[];

describe('a level round’s obstacles — #2969, more of them and more often cars', () => {
  it('asks each level for its proposed density, and reads its most off it', () => {
    for (const id of LEVEL_IDS) {
      const { level } = plannedOn(id);
      const proposed = PROPOSED[id];
      expect(level.round.hazardsPerKilometre, id).toStrictEqual({
        static: proposed.static,
        moving: proposed.moving,
      });
      expect(levelObstacleMix(level.round, level.lengthMetres), id).toMatchObject({
        fewest: LEVEL_FEWEST_OBSTACLES,
        most: proposed.most,
      });
    }
  });

  for (const id of LEVEL_IDS) {
    for (const seeds of SEED_CHUNKS) {
      it(`places its density over the round, three in four standing ones cars, and at least its floor on ${id} at every seed from ${span(seeds)}`, () => {
        const { level } = plannedOn(id);
        const mix = levelObstacleMix(level.round, level.lengthMetres);
        const { fewest, cars } = PROPOSED[id];
        for (const placed of placedOn(id, seeds)) {
          // One every 1000 / perKilometre metres of the round, held to the
          // level's range and to one each shortest stretch.
          expect(placed.obstacles, id).toBe(
            Math.min(
              Math.floor(placed.spanMetres / LEVEL_SHORTEST_STRETCH_METRES),
              Math.max(
                mix.fewest,
                Math.min(mix.most, Math.ceil((placed.spanMetres / 1000) * mix.perKilometre)),
              ),
            ),
          );
          expect(placed.cars, id).toBe(
            levelCarCount(placed.obstacles - levelMovingCount(mix, placed.obstacles)),
          );
          expect(placed.obstacles, id).toBeGreaterThanOrEqual(fewest);
          expect(placed.cars, id).toBeGreaterThanOrEqual(cars);
        }
      });
    }
  }
});
