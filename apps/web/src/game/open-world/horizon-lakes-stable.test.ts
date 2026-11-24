// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The horizon and the invented lakes hold across a view change** — #3065.
 *
 * #3055 keys an open-world ride's scenery seed and placement grids on ride
 * distance. Two things still read the whole view, and a view is a new
 * profile, of a new length, after each change:
 *
 * - the horizon's height (`landform.ts` §`horizonRelief`) stood on the
 *   middle of the view's lowest and highest elevation, which moves as road
 *   is added ahead and dropped behind;
 * - an invented lake (`waterways.ts` §`findWaterways`) needed a stretch below
 *   a level set from the view's lowest and highest samples, and was hashed on
 *   its start in the view's own distance.
 *
 * The grid `@onyourleft/domain/rolling-testing` builds on `roughGround` finds
 * no lake, so these ride a grid on ground of their own: level floors, 500 m
 * long, between humps, climbing to the east, so that every extension raises
 * the view's highest sample and every trim its lowest. Read through the real
 * `OpenWorldRoad`'s views, as the scene reads them.
 */

import { describe, expect, it } from 'vitest';

import { RollingRoute, type RollingEdge } from '@onyourleft/domain';
import { gridGraph, type SyntheticGround } from '@onyourleft/domain/rolling-testing';

import { NO_LAND_CLASS } from '../land-class';
import { horizonRelief } from '../landform';
import { scatterSeed } from '../scatter';
import { elevationBand } from '../scenery-anchor';
import { corridorOrigin } from '../terrain';
import { LAKE_ENCLOSURE_METRES, waterways } from '../waterways';
import { OpenWorldRoad, type OpenWorldRoadView } from './road';

/** A street every 300 m east, three rows 500 m apart: the middle row is the major road. */
const COLUMNS = Array.from({ length: 41 }, (_, column) => column * 300);
const ROWS = [0, 500, 1_000];

/** One floor and one hump, metres: the floor's length, then the hump's. */
const FLOOR_METRES = 500;
const HUMP_METRES = 700;

/**
 * Level floors between humps 40 m tall, the whole of it climbing 1 m every
 * 120 m east: each extension of the road ahead holds a higher sample than any
 * behind it, and each trim behind drops the lowest. A level read off a whole
 * view moves at every change; and a ride that keeps climbing leaves the
 * range it started in, so a level fixed when it started finds no lake.
 */
const basins: SyntheticGround = (east) => {
  const into =
    (((east % (FLOOR_METRES + HUMP_METRES)) + FLOOR_METRES + HUMP_METRES) %
      (FLOOR_METRES + HUMP_METRES)) -
    FLOOR_METRES;
  const hump = into <= 0 ? 0 : Math.sin((Math.PI * into) / HUMP_METRES) ** 2;
  return 100 + east / 120 + 40 * hump;
};

function road(): OpenWorldRoad {
  const { graph, edges } = gridGraph(COLUMNS, ROWS, basins, 1);
  return new OpenWorldRoad(
    new RollingRoute(graph, edges.find((edge) => edge.id === 'h0,1') as RollingEdge),
  );
}

/** A lake, in ride distance. */
interface RideLake {
  readonly from: number;
  readonly to: number;
  readonly side: number;
  readonly waterElevation: number;
}

/** `view`'s invented lakes, in ride distance, as the scene reads them. */
function lakesOf(view: OpenWorldRoadView): RideLake[] {
  return waterways(view.profile, scatterSeed(view.profile), NO_LAND_CLASS).lakes.map((lake) => ({
    from: lake.from + view.origin,
    to: lake.to + view.origin,
    side: lake.side,
    waterElevation: lake.waterElevation,
  }));
}

/** `view`'s horizon tops, in metres above sea level rather than the view's own frame. */
function topsOf(view: OpenWorldRoadView): number[] {
  const origin = corridorOrigin(view.profile);
  return [...horizonRelief(view.profile, origin, scatterSeed(view.profile)).tops].map(
    (top) => top + origin.elevation,
  );
}

/**
 * How far in from either end of both views a lake is judged, metres: a lake
 * is found only with `waterways.ts` §`LAKE_ENCLOSURE_METRES` of road either
 * side of it, and a view's end cuts that short.
 */
const CLEAR_OF_THE_ENDS_METRES = LAKE_ENCLOSURE_METRES + 10;

/** Every view change of a ride east that moved the view's highest or lowest sample. */
function changesThatMoveTheRange(): { before: OpenWorldRoadView; after: OpenWorldRoadView }[] {
  const ride = road();
  const changes: { before: OpenWorldRoadView; after: OpenWorldRoadView }[] = [];
  let before = ride.view;
  for (let rider = 0; rider <= 9_000; rider += 10) {
    const after = ride.follow(rider);
    if (after === undefined) continue;
    const was = elevationBand(before.profile);
    const is = elevationBand(after.profile);
    if (!after.turned && (was.lowest !== is.lowest || was.highest !== is.highest)) {
      changes.push({ before, after });
    }
    before = after;
  }
  return changes;
}

describe('the horizon and the invented lakes hold across a view change — #3065', () => {
  const changes = changesThatMoveTheRange();

  it('rides extensions that move the view’s range', () => {
    // Non-vacuity for both cases below.
    expect(changes.length).toBeGreaterThan(2);
  });

  it('keeps the horizon’s tops where they were', () => {
    for (const { before, after } of changes) {
      const was = topsOf(before);
      const is = topsOf(after);
      for (const [segment, top] of is.entries()) {
        expect(top, `segment ${String(segment)} at ${String(after.origin)} m`).toBeCloseTo(
          was[segment] as number,
          3,
        );
      }
    }
  });

  it('keeps every lake short of the change, and finds some', () => {
    let compared = 0;
    for (const { before, after } of changes) {
      const inside = (lake: RideLake): boolean =>
        lake.from - CLEAR_OF_THE_ENDS_METRES >= after.origin &&
        lake.to + CLEAR_OF_THE_ENDS_METRES <=
          before.origin + (before.profile.totalDistance as number);
      const was = lakesOf(before).filter(inside);
      const is = lakesOf(after).filter(inside);
      expect(is, `at ${String(after.origin)} m`).toEqual(was);
      compared += was.length;
    }
    expect(compared).toBeGreaterThan(0);
  });
});
