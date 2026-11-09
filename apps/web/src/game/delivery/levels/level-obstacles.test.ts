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

/** Every seed swept. */
const SEEDS = Array.from({ length: 300 }, (_, index) => index + 1);

/** The counts of obstacles every seed's round places on `level`, and each round checked as it is placed. */
function countsOn(level: LevelFile): Set<number> {
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
  const buildings = mappedBuildingsOf(plans);
  const counts = new Set<number>();
  for (const seed of SEEDS) {
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
      level: level.round,
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

describe('a level round’s obstacle count — #2362, the owner’s ruling of 2026-11-08', () => {
  it('places 2 or 3 on level 1 at every seed swept', { timeout: 120_000 }, () => {
    const level = read('morning-round');
    expect(levelObstacleMix(level.round, level.lengthMetres)).toMatchObject({
      fewest: 2,
      most: 3,
    });
    const counts = countsOn(level);
    for (const count of counts) expect([2, 3]).toContain(count);
    expect(counts).toEqual(new Set([2, 3]));
  });

  it('places 2 to 6 on level 2 at every seed swept', { timeout: 120_000 }, () => {
    const level = read('busy-round');
    expect(levelObstacleMix(level.round, level.lengthMetres)).toMatchObject({
      fewest: LEVEL_FEWEST_OBSTACLES,
      most: 6,
    });
    for (const count of countsOn(level)) {
      expect(count).toBeGreaterThanOrEqual(LEVEL_FEWEST_OBSTACLES);
      expect(count).toBeLessThanOrEqual(6);
    }
  });
});
