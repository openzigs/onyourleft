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
  distanceBetween,
  gradePercent,
  metres,
  metresPerSecond,
  positionAt,
  watts,
  seconds,
  type RollingEdge,
} from '@onyourleft/domain';
import { gridGraph, roughGround } from '@onyourleft/domain/rolling-testing';

import type { GameState } from '../simulation';
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
