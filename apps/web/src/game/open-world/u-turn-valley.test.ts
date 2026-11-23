// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A U-turn is not a valley** — #3064.
 *
 * An open-world U-turn (`RollingRoute.uTurn`) makes the road past the rider
 * the road they came along, ridden back, so the view's heights are mirrored
 * about the turn. Made on a descent, the turn is the lowest point of the
 * view's profile for a long way each side, and `waterways.ts`
 * §`findWaterways` read it as a valley floor: measured before #3064 on
 * `@onyourleft/domain/rolling-testing`'s grid, the view's crossings were
 * `[860]` before a U-turn at 640 m and `[640, 1340]` after it, a stream at
 * the rider's feet. These read the crossings of the real `OpenWorldRoad`'s
 * views through `waterways`, as the scene does.
 */

import { describe, expect, it } from 'vitest';

import {
  RollingRoute,
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  elevationAt,
  geographicPosition,
  routeProfile,
  type RollingEdge,
  type RoutePoint,
} from '@onyourleft/domain';
import { gridGraph, roughGround } from '@onyourleft/domain/rolling-testing';

import { NO_LAND_CLASS } from '../land-class';
import { scatterSeed } from '../scatter';
import { waterways } from '../waterways';
import { OpenWorldRoad, alongView, type OpenWorldRoadView } from './road';

/** `road.test.ts`'s grid, ridden east along row 3. */
const COLUMNS = [0, 180, 410, 600, 870, 1_050, 1_330, 1_520, 1_790, 2_000, 2_260, 2_450];
const ROWS = [0, 230, 400, 650, 820, 1_090, 1_280, 1_510];

/** How near a crossing must be to a ride distance to be at it, metres: a stream's banks. */
const AT_METRES = 50;

function grid(): OpenWorldRoad {
  const { graph, edges } = gridGraph(COLUMNS, ROWS, roughGround, 3);
  return new OpenWorldRoad(
    new RollingRoute(graph, edges.find((edge) => edge.id === 'h0,3') as RollingEdge),
  );
}

/** The ride distances of `view`'s stream crossings, as the scene reads them. */
function crossingsOf(view: OpenWorldRoadView): number[] {
  return waterways(view.profile, scatterSeed(view.profile), NO_LAND_CLASS).crossings.map(
    (crossing) => crossing.distance + view.origin,
  );
}

/** A road ridden to `ride`, then turned round there: its views before and after. */
function turnedAt(ride: number): {
  readonly before: OpenWorldRoadView;
  readonly after: OpenWorldRoadView;
} {
  const road = grid();
  for (let at = 0; at <= ride; at += 10) road.follow(at);
  const before = road.view;
  road.route.uTurn(ride);
  const after = road.follow(ride);
  if (after?.turned !== true) throw new Error('the road did not turn round');
  return { before, after };
}

const near = (crossings: readonly number[], at: number): number[] =>
  crossings.filter((distance) => Math.abs(distance - at) < AT_METRES);

describe('a U-turn is not a valley — #3064', () => {
  it('places no stream crossing at a U-turn made on a descent', () => {
    const turn = 640;
    const { before, after } = turnedAt(turn);
    // Non-vacuity: the rider was riding downhill into the turn.
    const along = alongView(before, turn);
    expect(
      elevationAt(before.profile, along) - elevationAt(before.profile, along - 30),
    ).toBeLessThan(-1);
    expect(near(crossingsOf(after), turn)).toEqual([]);
  });

  it('still finds a real valley the road crosses before the turn, and on the way back', () => {
    // A U-turn on a climb at 1 200 m, 340 m past the valley at 860 m: that
    // valley is still there, and ridden back it is crossed again, 340 m on.
    const turn = 1_200;
    const { before, after } = turnedAt(turn);
    const valley = near(crossingsOf(before), 860);
    expect(valley).toHaveLength(1);
    const crossed = valley[0] as number;
    expect(near(crossingsOf(after), crossed)).toEqual([crossed]);
    expect(near(crossingsOf(after), 2 * turn - crossed)).toHaveLength(1);
    expect(near(crossingsOf(after), turn)).toEqual([]);
  });

  it('places none at the far end of an out-and-back whose turn is at the bottom of a descent', () => {
    // An imported route: 2 km north, falling 30 m over the last kilometre,
    // and back the way it came. A point every 10 m, as a recorded ride.
    const points: RoutePoint[] = [];
    const push = (north: number): void => {
      points.push({
        position: geographicPosition(
          degreesLatitude(51.5 + north / 111_320),
          degreesLongitude(-0.12),
        ),
        elevation: altitudeMetres(north < 1_000 ? 60 : 60 - ((north - 1_000) / 1_000) * 30),
      });
    };
    for (let north = 0; north <= 2_000; north += 10) push(north);
    for (let north = 1_990; north >= 0; north -= 10) push(north);
    const profile = routeProfile(points, { loop: false });
    const turn = profile.totalDistance / 2;
    const crossings = waterways(profile, scatterSeed(profile), NO_LAND_CLASS).crossings.map(
      (crossing) => crossing.distance,
    );
    expect(near(crossings, turn)).toEqual([]);
  });
});
