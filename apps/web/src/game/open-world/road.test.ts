// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The road an open-world ride follows past its first view — #2982
 * (`road.ts`), on a synthetic street grid, read back as the ride loop reads
 * it: the view it hands on, at ride distance minus that view's origin.
 */

import { describe, expect, it } from 'vitest';

import {
  JUNCTION_LOCK_METRES,
  RollingRoute,
  degreesLatitude,
  degreesLongitude,
  distanceBetween,
  geographicPosition,
  gradePercent,
  metres,
  metresPerSecond,
  positionAt,
  watts,
  seconds,
  type RollingEdge,
} from '@onyourleft/domain';
import { gridGraph, roughGround } from '@onyourleft/domain/rolling-testing';

import { drawnLine, drawnLineAt } from '../drawn-line';
import { routeSeed } from '../scatter';
import { sceneryAnchor } from '../scenery-anchor';
import type { GameState } from '../simulation';
import { corridorOrigin, localGroundPosition, type CorridorOrigin } from '../terrain';
import { LINE_EASE_METRES } from './line-ease';
import { OPEN_WORLD_REACH_FLOOR_METRES, OpenWorldRoad, alongRoad, alongView } from './road';

const COLUMNS = [0, 180, 410, 600, 870, 1_050, 1_330, 1_520, 1_790, 2_000, 2_260, 2_450];
const ROWS = [0, 230, 400, 650, 820, 1_090, 1_280, 1_510, 1_700, 1_960, 2_150];

function grid(): OpenWorldRoad {
  const { graph, edges } = gridGraph(COLUMNS, ROWS, roughGround, 3);
  return new OpenWorldRoad(
    new RollingRoute(graph, edges.find((edge) => edge.id === 'h0,3') as RollingEdge),
  );
}

describe('the open-world road past its first view — #2982', () => {
  it('hands on the same view until the road ahead falls below the floor, then a new one', () => {
    const road = grid();
    const first = road.view;
    // The first view reaches 2 km: nothing is advanced while 1 km or more is held.
    for (
      let rider = 0;
      rider < first.profile.totalDistance - OPEN_WORLD_REACH_FLOOR_METRES;
      rider += 7
    ) {
      expect(road.follow(rider), `at ${rider} m`).toBeUndefined();
    }
    expect(road.view).toBe(first);
    const rider = first.profile.totalDistance - OPEN_WORLD_REACH_FLOOR_METRES + 1;
    const next = road.follow(rider);
    expect(next).toBeDefined();
    expect(next?.profile).not.toBe(first.profile);
    expect(next?.turned).toBe(false);
    expect(road.view).toBe(next);
    // And the new view reaches 2 km past the rider again.
    expect(alongView(road.view, rider) + 2_000).toBeLessThanOrEqual(
      (road.view.profile.totalDistance as number) + 10,
    );
  });

  it('moves the origin with the ride, and every distance ridden reads the same place on every view', () => {
    const road = grid();
    const seen: { readonly at: number; readonly position: ReturnType<typeof positionAt> }[] = [];
    let views = 0;
    for (let rider = 0; rider <= 9_000; rider += 5) {
      if (road.follow(rider) !== undefined) views += 1;
      const { profile, origin } = road.view;
      // Always at least the floor ahead of the rider, never past the end.
      expect(profile.totalDistance - alongView(road.view, rider)).toBeGreaterThanOrEqual(
        OPEN_WORLD_REACH_FLOOR_METRES - 5,
      );
      if (rider % 500 === 0)
        seen.push({ at: rider, position: positionAt(profile, metres(rider - origin)) });
      // Every place recorded that this view still holds, where it was.
      for (const each of seen) {
        if (each.at < origin) continue;
        const now = positionAt(profile, metres(each.at - origin));
        expect(distanceBetween(now, each.position), `${each.at} m on at ${rider} m`).toBeLessThan(
          1e-6,
        );
      }
    }
    expect(views).toBeGreaterThan(5);
    expect(road.view.origin).toBeGreaterThan(7_000);
  });

  it('hands on a junction choice at once, as no U-turn', () => {
    const road = grid();
    const rider = 50;
    const junction = road.route.junctionsAfter(rider)[0];
    if (junction === undefined) throw new Error('no junction ahead');
    expect(junction.distance - rider).toBeGreaterThan(JUNCTION_LOCK_METRES);
    const other = junction.ways.find((way) => way.edge.id !== junction.taken)?.edge.id as string;
    expect(road.route.choose(junction.distance, other, rider)).toBe('swapped');
    const next = road.follow(rider);
    expect(next).toBeDefined();
    expect(next?.turned).toBe(false);
  });

  it('says a U-turn made on the route itself was one, once', () => {
    const road = grid();
    road.route.uTurn(120);
    expect(road.follow(120)?.turned).toBe(true);
    // The next change is not a U-turn.
    const later = road.view.profile.totalDistance - OPEN_WORLD_REACH_FLOOR_METRES + 130;
    expect(road.follow(later)?.turned).toBe(false);
  });

  it('keys every view it hands on to the ride: the first view seed, and its own origin — #3055', () => {
    const road = grid();
    const seed = routeSeed(road.view.profile);
    // #3094: and one set of held streets and one frame for every view's places.
    const first = sceneryAnchor(road.view.profile);
    const { levels, frame } = first ?? {};
    expect(levels).toBeDefined();
    expect(frame).toEqual(corridorOrigin(road.view.profile));
    expect(first).toEqual({ seed, origin: 0, levels, frame });
    let views = 0;
    for (let rider = 0; rider <= 6_000; rider += 50) {
      if (rider === 3_000) road.route.uTurn(rider);
      const next = road.follow(rider);
      if (next === undefined) continue;
      views += 1;
      const anchor = sceneryAnchor(next.profile);
      expect(anchor, `at ${rider} m`).toEqual({ seed, origin: next.origin, levels, frame });
      expect(anchor?.levels, `at ${rider} m`).toBe(levels);
      // The view's own seed is not the ride's: it is the view that changed.
      expect(routeSeed(next.profile)).not.toBe(seed);
    }
    expect(views).toBeGreaterThan(3);
    expect(road.view.origin).toBeGreaterThan(0);
  });

  it('keys each view before the session plans buildings against it — #3094', () => {
    // The session plans the buildings round the rider against `route.view()`
    // from the `ahead` hook, and hands the worker what that view is keyed on.
    const { graph, edges } = gridGraph(COLUMNS, ROWS, roughGround, 3);
    const route = new RollingRoute(graph, edges.find((edge) => edge.id === 'h0,3') as RollingEdge);
    const seen: { readonly origin: number; readonly anchor: unknown }[] = [];
    const road = new OpenWorldRoad(route, {
      ahead: (each) => seen.push({ origin: each.origin, anchor: sceneryAnchor(each.view()) }),
    });
    const seed = sceneryAnchor(road.view.profile)?.seed;
    let changes = 0;
    for (let rider = 0; rider <= 6_000; rider += 50) {
      if (rider === 3_000) road.route.uTurn(rider);
      if (road.follow(rider) !== undefined) changes += 1;
    }
    expect(changes).toBeGreaterThan(3);
    for (const { origin, anchor } of seen) {
      expect(anchor).toMatchObject({ seed, origin });
    }
  });

  it('advances nothing for a rider distance that is not a finite number', () => {
    const road = grid();
    const first = road.view;
    expect(road.follow(Number.NaN)).toBeUndefined();
    expect(road.follow(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(road.view).toBe(first);
  });
});

describe('a ride state on a view — #2982', () => {
  const state: GameState = {
    ride: {
      distance: metres(4_250),
      speed: metresPerSecond(8),
    },
    elapsed: seconds(600),
    ridden: seconds(600),
    grade: gradePercent(0),
    input: { power: watts(200), live: true },
  };

  it('is the state itself at origin 0', () => {
    expect(alongRoad(state, 0)).toBe(state);
  });

  it('reads the odometer at the view’s own distance, and nothing else moves', () => {
    const along = alongRoad(state, 3_000);
    expect(along.ride.distance).toBe(1_250);
    expect(along.ride.speed).toBe(state.ride.speed);
    expect(along.elapsed).toBe(state.elapsed);
    expect(along.input).toBe(state.input);
  });
});

describe('the path an open-world ride is drawn along — #2989', () => {
  /** The place `road`'s drawn path is at ride distance `ride`, in the local metres of `frame`. */
  function placeOn(road: OpenWorldRoad, ride: number, frame: CorridorOrigin) {
    const at = drawnLineAt(road.drawnPath(ride), alongView(road.view, ride));
    // `terrain.ts` §`localGroundPosition` inverted, out of the view's own frame.
    const own = corridorOrigin(road.view.profile);
    const perDegree = (origin: CorridorOrigin): number =>
      localGroundPosition(
        origin,
        geographicPosition(
          degreesLatitude(origin.latitude),
          degreesLongitude(origin.longitude - 1),
        ),
      ).x;
    const perDegreeNorth = localGroundPosition(
      own,
      geographicPosition(degreesLatitude(own.latitude + 1), degreesLongitude(own.longitude)),
    ).z;
    return localGroundPosition(
      frame,
      geographicPosition(
        degreesLatitude(own.latitude + at.z / perDegreeNorth),
        degreesLongitude(own.longitude - at.x / perDegree(own)),
      ),
    );
  }

  /** A road ridden to `ride` as the loop rides one: followed and drawn every 10 m. */
  function riddenTo(ride: number): OpenWorldRoad {
    const road = grid();
    for (let at = 0; at <= ride; at += 10) {
      road.follow(at);
      road.drawnPath(at);
    }
    return road;
  }

  it('is the view’s own line on a view nobody has drawn a path on', () => {
    const road = grid();
    const rider = road.view.profile.totalDistance - OPEN_WORLD_REACH_FLOOR_METRES + 1;
    // A change before any path was drawn on the view has nothing to ease from.
    expect(road.follow(rider)).toBeDefined();
    expect(road.drawnPath(rider)).toBe(drawnLine(road.view.profile));
  });

  it('eases a choice’s new line in over the ease, from the path drawn the frame before', () => {
    const ride = 1_500;
    const road = riddenTo(ride);
    const frame = corridorOrigin(road.view.profile);
    const before = placeOn(road, ride, frame);
    const junction = road.route
      .junctionsAfter(ride)
      .find((each) => each.distance - ride > JUNCTION_LOCK_METRES);
    if (junction === undefined) throw new Error('no junction ahead outside the lock');
    const way = junction.ways.find((each) => each.edge.id !== junction.taken)?.edge.id as string;
    expect(road.route.choose(junction.distance, way, ride)).toBe('swapped');
    expect(road.follow(ride)).toBeDefined();
    const own = drawnLine(road.view.profile);
    expect(road.drawnPath(ride)).not.toBe(own);
    // On the frame of the change: where it was drawn the frame before.
    const after = placeOn(road, ride, frame);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(1e-3);
    // Ridden on, the view's own line, and from then on.
    expect(road.drawnPath(ride + LINE_EASE_METRES - 1)).not.toBe(own);
    expect(road.drawnPath(ride + LINE_EASE_METRES)).toBe(own);
    expect(road.drawnPath(ride + LINE_EASE_METRES + 1)).toBe(own);
  });

  it('draws a U-turn’s line at once: the road under the rider changed', () => {
    const road = riddenTo(900);
    road.route.uTurn(900);
    expect(road.follow(900)?.turned).toBe(true);
    expect(road.drawnPath(900)).toBe(drawnLine(road.view.profile));
  });
});
