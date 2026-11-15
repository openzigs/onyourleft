// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A road ridden twice, and the passes `landform.ts` makes over it** — #2205,
 * from the review of #2201.
 *
 * Three things the landform's own suites left unpinned:
 *
 * - `fannedPairs` read a turning point's rows as a fan. `retracedGround`
 *   copies a cap row's left side from its anchor whole, and sinks a row to
 *   one point, so two such rows share every column of a side, the outermost
 *   included, which was the whole of the fan test. Scenery came out the same,
 *   but every item was then asked of those pairs' triangles too.
 * - The order of `closeFans` and `retracedGround`, which no drawn ground can
 *   tell apart while no fan reaches a taken row.
 * - `clearReach`'s contract on a taken pass, which no corridor the module
 *   builds can tell apart (`landform.ts` §`clearReach` says why).
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { NO_LAND_CLASS } from './land-class';
import {
  ROAD_CLEARANCE_METRES,
  TERRAIN_COLUMN_OFFSETS,
  clearReach,
  fannedPairs,
  terrainCorridor,
} from './landform';
import { outAndBackRoute, sampledCornerRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import {
  corridorOrigin,
  ribbonNormals,
  roadCorridor,
  type CorridorPoint,
  type RoadCorridor,
} from './terrain';
import type { RouteProfile } from '@onyourleft/domain';

function frameAt(profile: RouteProfile, odometer: number) {
  const corridor: RoadCorridor = roadCorridor(profile, corridorOrigin(profile), odometer);
  return terrainCorridor(
    profile,
    corridorOrigin(profile),
    corridor,
    scatterSeed(profile),
    NO_LAND_CLASS,
  );
}

const flaggedIn = (flags: Uint8Array): number[] =>
  [...flags].flatMap((flag, row) => (flag === 1 ? [row] : []));

describe('fannedPairs flags a fan, and nothing at a turning point — #2205', () => {
  it.each([0, 1, 2])(
    'flags no pair on an out-and-back turning back %d m over, where no bend is sharp enough to fan',
    (lane) => {
      const route = outAndBackRoute({ offset: lane });
      const turn = route.totalDistance / 2;
      for (const offset of [-200, -60, -12, -4, 4, 12, 30]) {
        // Before #2205: nine rows a frame, the turning point's cap and the
        // sunk rows beside it.
        expect(
          flaggedIn(fannedPairs(frameAt(route, turn + offset))),
          `${String(offset)} m`,
        ).toEqual([]);
      }
    },
  );

  it('still flags a fan: the apex of a 145° bend sampled every 10 m (#2149)', () => {
    // The control: a test that only ever saw no fans would pass with every
    // pair dropped.
    const route = sampledCornerRoute(145, 'right', 6, 0);
    for (const odometer of [1_400, 1_450, 1_490]) {
      expect(flaggedIn(fannedPairs(frameAt(route, odometer))).length).toBeGreaterThan(0);
    }
  });
});

describe('the passes’ order — #2205', () => {
  // `terrainCorridor` runs on import of nothing it can be asked about, and
  // both orders draw the same ground while no fan reaches a taken row, so
  // this reads the order where it is written, as `retired-hosted-key-main`
  // reads `main.tsx`.
  const source = readFileSync(new URL('./landform.ts', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export function terrainCorridor('));
  const call = (name: string): number => body.search(new RegExp(`^\\s+${name}\\(`, 'm'));

  it('closes the fans before the ground of a taken row is written, so the taken row’s is last', () => {
    expect(call('closeFans')).toBeGreaterThan(0);
    expect(call('retracedGround')).toBeGreaterThan(call('closeFans'));
  });

  it('hands `clearReach` the rows another pass takes', () => {
    const from = body.indexOf('const reach = clearReach(');
    const call = body.slice(from, body.indexOf(');', body.indexOf('lent.folds', from)) + 2);
    // Its last argument, after the reach it tightens.
    expect(call.replace(/\s+/g, ' ')).toMatch(/\), retraced, \);$/);
    expect(body).toMatch(/const retraced = lent\.roles;/);
  });
});

describe('clearReach stops no side short of a taken pass — #2205, #1996', () => {
  /**
   * 80 m north, then back south 6 m over: a second pass close enough that the
   * first's ground at 8 m (column 2) lies 2 m from its road, inside
   * {@link ROAD_CLEARANCE_METRES}.
   */
  function twoPasses(): CorridorPoint[] {
    const points: CorridorPoint[] = [];
    for (let row = 0; row < 40; row += 1) {
      points.push({ x: 0, y: 0, z: row * 2, distance: row * 2, along: row * 2 });
    }
    for (let row = 0; row < 40; row += 1) {
      const along = 80 + 6 + row * 2;
      points.push({ x: -6, y: 0, z: 78 - row * 2, distance: along, along });
    }
    return points;
  }

  const unbounded = (rows: number): Float64Array =>
    new Float64Array(rows * 2).fill(Number.POSITIVE_INFINITY);

  it('keeps the first pass’s full reach where the second is taken', () => {
    const centre = twoPasses();
    const roles = new Uint8Array(centre.length);
    // The second pass is taken: `landform.ts`' `SUNK` is 1.
    roles.fill(1, 40);
    const reach = clearReach(centre, ribbonNormals(centre), unbounded(centre.length), roles);
    for (let row = 5; row < 35; row += 1) {
      expect(reach[row * 2], `row ${String(row)}, the side facing the second pass`).toBe(
        Number.POSITIVE_INFINITY,
      );
      expect(reach[row * 2 + 1], `row ${String(row)}, the other side`).toBe(
        Number.POSITIVE_INFINITY,
      );
    }
  });

  it('the control: the same second pass, kept, does stop the side that faces it', () => {
    // So the geometry above is one where a drawn road would cut: the test
    // above is about the taken role, not about a road too far away to count.
    const centre = twoPasses();
    const reach = clearReach(
      centre,
      ribbonNormals(centre),
      unbounded(centre.length),
      new Uint8Array(centre.length),
    );
    const facing = reach[20 * 2] as number;
    expect(facing).toBeLessThan(TERRAIN_COLUMN_OFFSETS[2] as number);
    expect(facing).toBeGreaterThanOrEqual(TERRAIN_COLUMN_OFFSETS[1] as number);
    expect(6 - (TERRAIN_COLUMN_OFFSETS[2] as number)).toBeLessThan(ROAD_CLEARANCE_METRES);
  });
});
