// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * More obstacles in a round, within the frame and in sight — #2576. The owner
 * on the tablet (2026-11-13): *"I am not seeing many obstacles."* #2969 raised
 * every level's density to one every 143 to 200 m. #2576 set two conditions
 * on any raise: **stay under the village frame's triangle budget (trim to fit,
 * never raise it)**, and **keep obstacles visible early enough to steer
 * round**. This file holds both for every shipped level, at its whole-length
 * density, the most a round of it places, read through `in-view.ts`
 * §`deliveryInView`, which `GameView` hands the renderer every frame.
 *
 * **The budget.** Every obstacle instance submits the whole roster
 * (`three-renderer.ts` §`DELIVERY_REALISTIC_OBSTACLE_TRIANGLES`), and
 * `realistic-budget.ts` §`DELIVERY_VILLAGE_FRAME_TRIANGLES` was measured on a
 * frame drawing {@link MEASURED_OBSTACLES} of them
 * (`realistic-delivery.browser.spec.ts`). A frame draws only the obstacles on
 * its corridor, 60 m behind the rider to 400 m ahead, and a level puts one in
 * each stretch of at least 120 m (`obstacles.ts`
 * §`LEVEL_SHORTEST_STRETCH_METRES`), so no frame draws more than
 * {@link MOST_IN_A_FRAME}: well under the frame the budget was measured on.
 *
 * **In sight.** In rain and at dusk a house's marker shows only within
 * `in-view.ts` §`LOW_LIGHT_REVEAL_METRES` of the rider (#2366). An obstacle
 * has no such reveal: every one on the frame's corridor is drawn, in every
 * level's weather, so each is drawn from at least {@link DRAWN_FROM_METRES}
 * ahead.
 *
 * ⚠️ Nothing here is drawn or kept, and the test names say no place (ADR 0065
 * D-13).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { corridorOrigin, roadCorridor, VIEW_AHEAD_METRES, VIEW_BEHIND_METRES } from '../../terrain';
import { deliveryInView, LOW_LIGHT_REVEAL_METRES } from '../in-view';
import {
  LEVEL_SHORTEST_STRETCH_METRES,
  levelObstacleMix,
  obstacleAlong,
  OBSTACLE_SIGHT_METRES,
  placeObstacles,
  startObstacles,
  type Obstacle,
} from '../obstacles';
import { startRound } from '../round';
import { NO_PARCELS } from '../throw';

import { parseLevelFile, type LevelFile } from './level-file';
import { levelRoute } from './levels';

const DATA = join(dirname(fileURLToPath(import.meta.url)), 'data');

const LEVEL_IDS = [
  'morning-round',
  'busy-round',
  'corner-round',
  'mailbox-round',
  'rainy-round',
  'evening-round',
] as const;

function read(id: string): LevelFile {
  return parseLevelFile(JSON.parse(readFileSync(join(DATA, `${id}.json`), 'utf8')) as unknown, id);
}

/**
 * The obstacles on the frame `DELIVERY_VILLAGE_FRAME_TRIANGLES` was measured
 * with: `realistic-delivery.browser.spec.ts`' twenty of each piece.
 */
const MEASURED_OBSTACLES = 20;

/**
 * The most obstacles one frame's corridor can hold on a level: one in each
 * shortest stretch its 460 m can touch, the corridor's length over
 * {@link LEVEL_SHORTEST_STRETCH_METRES}, rounded up, and one more for a
 * stretch cut at each end.
 */
const MOST_IN_A_FRAME =
  Math.ceil((VIEW_AHEAD_METRES + VIEW_BEHIND_METRES) / LEVEL_SHORTEST_STRETCH_METRES) + 1;

/** How far ahead every obstacle is already drawn: twice the distance it is set going at. */
const DRAWN_FROM_METRES = 2 * OBSTACLE_SIGHT_METRES;

/** Where along each level the rider is put: every this many metres. */
const STEP_METRES = 20;

/** The seeds each level's obstacles are placed from. */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe('more obstacles, inside the frame and in sight — #2576', () => {
  it('holds a frame’s most well under the obstacles the triangle budget was measured with', () => {
    expect(MOST_IN_A_FRAME).toBe(5);
    expect(MOST_IN_A_FRAME).toBeLessThan(MEASURED_OBSTACLES);
  });

  for (const id of LEVEL_IDS) {
    it(`draws at most ${String(MOST_IN_A_FRAME)} obstacles a frame on ${id}, every one on the corridor, in its own weather`, () => {
      const level = read(id);
      const profile = levelRoute(level).profile;
      const origin = corridorOrigin(profile);
      const mix = levelObstacleMix(level.round, level.lengthMetres);
      // The level's whole length: the most a round of it places.
      const rounds = SEEDS.map((seed) =>
        placeObstacles({ from: 0, to: level.lengthMetres }, seed, 'normal', true, mix),
      );
      for (const placed of rounds) expect(placed).toHaveLength(mix.most);
      const weather = { rain: level.round.weather === 'rain', dusk: level.round.light === 'dusk' };
      // As `ride-round.ts` hands it on: rain or dusk brings the markers' reveal.
      const revealMetres = weather.rain || weather.dusk ? LOW_LIGHT_REVEAL_METRES : undefined;
      let most = 0;
      let seenAhead = 0;
      for (let along = 0; along < profile.totalDistance; along += STEP_METRES) {
        const corridor = roadCorridor(profile, origin, along);
        const first = corridor.centre[0]?.along ?? along;
        const last = corridor.centre.at(-1)?.along ?? along;
        for (const placed of rounds) {
          const frame = deliveryInView({
            corridor,
            targets: [],
            round: startRound(1),
            throws: NO_PARCELS,
            obstacles: placed,
            obstacleState: startObstacles(placed),
            riderAlong: along,
            revealMetres,
            weather,
          });
          // Where each is drawn before it is set going: a car pulling out
          // waits behind where it stops, its own way along (`obstacleAlong`).
          const onCorridor = placed.filter((obstacle: Obstacle) => {
            const at = obstacleAlong(obstacle, 0);
            return at >= first && at <= last;
          });
          // Every obstacle on the corridor is drawn: no reveal holds one back.
          expect(frame.obstacles, `${id} at ${String(along)} m`).toHaveLength(onCorridor.length);
          most = Math.max(most, frame.obstacles.length);
          // And the corridor reaches past each one this far ahead, unless the road ends first.
          for (const obstacle of placed) {
            const ahead = obstacle.along - along;
            if (ahead > 0 && ahead <= DRAWN_FROM_METRES && last >= obstacle.along) seenAhead += 1;
            if (ahead > 0 && ahead <= DRAWN_FROM_METRES) {
              expect(last, `${id} at ${String(along)} m`).toBeGreaterThanOrEqual(obstacle.along);
            }
          }
        }
      }
      expect(most, id).toBeLessThanOrEqual(MOST_IN_A_FRAME);
      // Not vacuous: frames drew several at once, and obstacles were met ahead.
      expect(most, id).toBeGreaterThanOrEqual(3);
      expect(seenAhead, id).toBeGreaterThan(0);
    });
  }
});
