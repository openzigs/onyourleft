// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * People on a built-in level's round — #2969, the owner's tablet ride of
 * 2026-11-20 (*"not seeing cars, people"*). A level's corridor maps no footway
 * and builds no village street, so `people.ts` had nowhere to walk anybody.
 * Since #2969 a level's round walks both verges (`people.ts` §`vergeWalks`):
 * here each shipped level's own road is laid as `scene.ts` lays it, and its
 * people counted, on the lines and in the frames a ride draws.
 *
 * ⚠️ Nothing here is drawn or kept, and the test names say no place (ADR 0065
 * D-13).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { metres, seconds } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { NO_PEOPLE, PEOPLE_NEAR_MAX, PERSON_CLEARANCE_METRES, vergeWalks } from '../../people';
import { distanceToDrawnRoad } from '../../road-grid';
import { sceneFrame } from '../../scene';
import { atStartLine } from '../../simulation';
import { corridorOrigin } from '../../terrain';

import { parseLevelFile, type LevelFile } from './level-file';
import { levelRoute } from './levels';

const DATA = join(dirname(fileURLToPath(import.meta.url)), 'data');

function read(id: string): LevelFile {
  return parseLevelFile(JSON.parse(readFileSync(join(DATA, `${id}.json`), 'utf8')) as unknown, id);
}

/**
 * #2969's floor, for the owner's approval: the fewest people each level's
 * verges carry, at `people.ts` §`VERGE_PEOPLE_PER_METRE` (one every 80 m a
 * side). Written out, so a change to the density is a change to this table.
 */
const PEOPLE_FLOOR = {
  'morning-round': 53,
  'busy-round': 75,
  'corner-round': 67,
  'mailbox-round': 95,
  'rainy-round': 91,
  'evening-round': 68,
} as const;

const LEVEL_IDS = Object.keys(PEOPLE_FLOOR) as (keyof typeof PEOPLE_FLOOR)[];

/** The places along each level a frame is drawn at: every 250 m from 100 m. */
const PLACES_EVERY_METRES = 250;

describe('people on a level’s round — #2969', () => {
  for (const id of LEVEL_IDS) {
    it(`walks at least its floor of people on both verges of ${id}, none on the carriageway`, () => {
      const level = read(id);
      const profile = levelRoute(level).profile;
      const origin = corridorOrigin(profile);
      const road = (x: number, z: number, reach: number): number =>
        distanceToDrawnRoad(profile, origin, x, z, reach);
      const lines = vergeWalks(profile, origin, road);
      const people = lines.reduce((sum, line) => sum + line.people, 0);
      expect(people, id).toBeGreaterThanOrEqual(PEOPLE_FLOOR[id]);

      // And in the frames a ride draws, as `GameView` asks for them on a level's round.
      const start = atStartLine(profile);
      let drawn = 0;
      let places = 0;
      for (let along = 100; along < profile.totalDistance; along += PLACES_EVERY_METRES) {
        places += 1;
        const frame = sceneFrame({
          profile,
          origin,
          state: {
            ...start,
            ride: { ...start.ride, distance: metres(along) },
            elapsed: seconds(along / 6),
            ridden: seconds(along / 6),
          },
          people: PEOPLE_NEAR_MAX,
          vergeWalkers: true,
        });
        const seen = frame.people ?? NO_PEOPLE;
        // A verge's walkers only: a bare frame also lays this profile's own
        // villages, which a level's realistic town does not draw.
        drawn += [...seen.near, ...seen.far].filter((person) => person.on === 'sidewalk').length;
        for (const person of [...seen.near, ...seen.far]) {
          expect(road(person.x, person.z, 20), id).toBeGreaterThanOrEqual(PERSON_CLEARANCE_METRES);
        }
      }
      // Three or more a frame on the average: about seven are in reach of each.
      expect(drawn, id).toBeGreaterThanOrEqual(3 * places);
    });
  }
});
