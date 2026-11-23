// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The scenery along the ways out of a junction that an open-world ride does
 * not take — #3051 (`road.ts` §`OpenWorldRoad.waysOut`, `scatter.ts`
 * §`ScatterWay`, `settlements.ts` §`structuresOnWay`, `scene.ts`
 * §`SceneInput.waysOut`).
 *
 * A view's scenery is placed along the view's own road. Before this, the road
 * past a junction carried scenery on the way the route took and none on any
 * other, so a choice moved every tree and house past the junction from one
 * street to the other on the frame of the press: measured on the real game
 * screen (`junction-corner.test.tsx`), none of the 100 to 135 items past the
 * junction survived a press, 105 m and more ahead of the rider and in plain
 * view. Read here on a synthetic street grid, ridden by the real
 * {@link OpenWorldRoad} and drawn by the real `sceneFrame`.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  JUNCTION_LOCK_METRES,
  RollingRoute,
  metres,
  type RollingEdge,
  type RollingJunction,
  type RouteProfile,
} from '@onyourleft/domain';
import { gridGraph, roughGround, type SyntheticGround } from '@onyourleft/domain/rolling-testing';

import { NO_LAND_CLASS, countrysideWithout } from '../land-class';
import { ROAD_CLEARANCE_METRES, standingOnGround } from '../landform';
import { distanceToDrawnRoad } from '../road-grid';
import {
  BOUNDARY_KINDS,
  STRUCTURE_FOOTPRINTS,
  footprintClearance,
  onSettlementGround,
  structuresOnWay,
  structuresWithin,
} from '../settlements';
import { sceneFrame } from '../scene';
import {
  SCATTER_VERGE_METRES,
  SCATTER_WAY_REACH_METRES,
  STRUCTURE_KINDS,
  scatterAt,
  scatterSeed,
  type ScatterItem,
  type StructureKind,
} from '../scatter';
import { sceneryAnchor } from '../scenery-anchor';
import { atStartLine } from '../simulation';
import {
  ROAD_WIDTH_METRES,
  VIEW_AHEAD_METRES,
  VIEW_BEHIND_METRES,
  corridorOrigin,
  localGroundPosition,
  type CorridorOrigin,
} from '../terrain';
import {
  OpenWorldRoad,
  WAYS_OUT_AHEAD_METRES,
  WAYS_OUT_DEPTH,
  WAYS_OUT_BEHIND_METRES,
  WAYS_OUT_LOOK_METRES,
  type OpenWorldWayOut,
} from './road';

const COLUMNS = [0, 180, 410, 600, 870, 1_050, 1_330, 1_520, 1_790, 2_000, 2_260, 2_450];
const ROWS = [0, 230, 400, 650, 820, 1_090, 1_280, 1_510, 1_700, 1_960, 2_150];

/** Low, level ground: villages stand on it, which the grid's own high ground has none of. */
const LOWLAND: SyntheticGround = () => 120;

/** The grid, ridden east along row 3 from its corner, every view drawn in one frame as the session's are. */
function grid(ground: SyntheticGround = roughGround): {
  readonly road: OpenWorldRoad;
  readonly frame: CorridorOrigin;
} {
  const { graph, edges } = gridGraph(COLUMNS, ROWS, ground, 3);
  const route = new RollingRoute(graph, edges.find((edge) => edge.id === 'h0,3') as RollingEdge);
  const frame = corridorOrigin(route.view());
  return { road: new OpenWorldRoad(route, { frame }), frame };
}

/** The first junction ahead of `rider` on `road`, and a way on from it that the route does not take. */
function nextJunction(
  road: OpenWorldRoad,
  rider: number,
): { readonly junction: RollingJunction; readonly other: string } {
  const junction = road.route.nextJunctionAfter(rider);
  if (junction === undefined) throw new Error('no junction ahead');
  const other = junction.ways.find((way) => way.edge.id !== junction.taken)?.edge.id;
  if (other === undefined) throw new Error('no other way');
  return { junction, other };
}

/** The plan position of ride distance `at` on `profile`, in the ride's frame. */
function placeOn(profile: RouteProfile, origin: number, at: number): { x: number; z: number } {
  const sample = profile.positions[Math.round((at - origin) / (profile.resolution as number))];
  if (sample === undefined) throw new Error('past the view');
  return localGroundPosition(corridorOrigin(profile), sample);
}

/** A way out by where it is: the ride distance of its junction, and the place 30 m along it from there. */
function wayKey(profile: RouteProfile, origin: number, junction: number): string {
  const { x, z } = placeOn(profile, origin, Math.ceil(junction / 10) * 10 + 30);
  return `${junction.toFixed(1)}: ${x.toFixed(1)}, ${z.toFixed(1)}`;
}

/**
 * Every way out within the view's reach of a rider at `rider`, to `depth`
 * junctions from `route`'s road, each as {@link wayKey}: read off the rolling
 * route alone, the reference `OpenWorldRoad.waysOut` is held to.
 */
function waysTo(route: RollingRoute, rider: number, depth: number): string[] {
  const found = new Set<string>();
  const look = (road: RollingRoute, after: number, at: number): void => {
    for (const junction of road.junctionsAfter(after)) {
      if (junction.distance - rider > WAYS_OUT_AHEAD_METRES) break;
      for (const way of junction.ways) {
        if (way.edge.id === junction.taken) continue;
        const taking = road.taking(junction.distance, way.edge.id);
        if (taking === undefined) throw new Error('no such way');
        found.add(wayKey(taking.view(), taking.origin, junction.distance));
        if (at < depth) look(taking, junction.distance, at + 1);
      }
    }
  };
  look(route, rider, 1);
  return [...found].sort();
}

/** The frame drawn for a rider at ride distance `rider` on `road`'s view, with its ways out. */
function frameAt(
  road: OpenWorldRoad,
  rider: number,
  budget: { readonly scatterItems?: number; readonly structureItems?: number } = {},
  ways: readonly OpenWorldWayOut[] | 'none' = road.waysOut(rider),
): ReturnType<typeof sceneFrame> {
  const view = road.view;
  const along = rider - view.origin;
  return sceneFrame({
    profile: view.profile,
    origin: corridorOrigin(view.profile),
    state: { ...atStartLine(view.profile), ride: { speed: 0 as never, distance: metres(along) } },
    riderDistance: along,
    ...(ways === 'none' ? {} : { waysOut: ways }),
    ...budget,
  });
}

/** Whether `kind` is one `settlements.ts` builds, not one that grows. */
function isStructureKind(kind: ScatterItem['kind']): boolean {
  return (STRUCTURE_KINDS as readonly string[]).includes(kind);
}

/** The same item in plan: its kind and where it stands, to a centimetre. */
function samePlace(a: ScatterItem, b: ScatterItem): boolean {
  return a.kind === b.kind && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.z - b.z) < 0.01;
}

/** How many of `items` `others` still holds, in plan. */
function kept(items: readonly ScatterItem[], others: readonly ScatterItem[]): number {
  return items.filter((item) => others.some((other) => samePlace(item, other))).length;
}

describe('the ways out of the junctions in view — #3051', () => {
  it('hands on every way the route does not take, as the view a choice would give, keyed on the ride and drawn in its frame', () => {
    const { road, frame } = grid();
    const rider = 40;
    const ways = road.waysOut(rider);
    const { junction } = nextJunction(road, rider);
    const first = junction.ways.filter((way) => way.edge.id !== junction.taken);
    // The grid's first crossroads is 140 m ahead: two ways not taken there.
    expect(first).toHaveLength(2);
    const seed = sceneryAnchor(road.view.profile)?.seed;
    for (const way of first) {
      // The view the choice gives, sample for sample.
      const { road: chosen } = grid();
      expect(chosen.route.choose(junction.distance, way.edge.id, rider)).toBe('swapped');
      const swapped = chosen.route.view();
      const out = ways.find(
        (each) =>
          each.fromMetres === junction.distance - road.view.origin &&
          wayKey(each.profile, 0, junction.distance) === wayKey(swapped, 0, junction.distance),
      );
      if (out === undefined) throw new Error('a way out of the next junction is not handed on');
      const count = Math.min(out.profile.positions.length, swapped.positions.length);
      expect(count).toBeGreaterThan(190);
      expect(out.profile.positions.slice(0, count)).toEqual(swapped.positions.slice(0, count));
    }
    for (const out of ways) {
      // The ride's seed and this view's origin, and the ride's frame.
      expect(sceneryAnchor(out.profile)).toEqual({ seed, origin: road.view.origin });
      expect(corridorOrigin(out.profile)).toBe(frame);
    }
    // And the route itself was left as it was.
    expect(road.follow(rider)).toBeUndefined();
  });

  it('hands on the ways out of the junctions along each way too, two junctions from the road and no further', () => {
    const { road } = grid();
    for (const rider of [40, 170, 300, 700]) {
      road.follow(rider);
      const handed = road
        .waysOut(rider)
        .map((way) => wayKey(way.profile, road.view.origin, way.fromMetres + road.view.origin))
        .sort();
      const expected = waysTo(road.route, rider, WAYS_OUT_DEPTH);
      expect(handed, `at ${String(rider)} m`).toEqual(expected);
      // The second junctions' ways are there, and a third's are not.
      expect(expected.length).toBeGreaterThan(waysTo(road.route, rider, 1).length);
    }
    // 10 m short of the first crossroads, a junction three from the road is within the view's reach.
    const { road: near } = grid();
    expect(waysTo(near.route, 170, 3).length).toBeGreaterThan(
      waysTo(near.route, 170, WAYS_OUT_DEPTH).length,
    );
    expect(WAYS_OUT_DEPTH).toBe(2);
  });

  it('hands on the same ways, and the same array, until they change', () => {
    const { road } = grid();
    const first = road.waysOut(40);
    // A frame's ride is not looked at again: a look walks the graph at every junction held.
    const walked = vi.spyOn(road.route, 'junctionsAfter');
    for (let rider = 40; rider < 40 + WAYS_OUT_LOOK_METRES; rider += 0.5) {
      expect(road.waysOut(rider)).toBe(first);
    }
    expect(walked).not.toHaveBeenCalled();
    road.waysOut(40 + WAYS_OUT_LOOK_METRES);
    expect(walked).toHaveBeenCalled();
    walked.mockRestore();
    expect(road.waysOut(41)).toBe(first);
    // A look further on that finds the same ways hands on the same array.
    const later = road.waysOut(40 + WAYS_OUT_LOOK_METRES + 1);
    expect(later).toBe(first);
  });

  it('swaps the way taken for the way left at a choice, and keeps every other way as it was', () => {
    const { road } = grid();
    const rider = 40;
    const { junction, other } = nextJunction(road, rider);
    expect(junction.distance - rider).toBeGreaterThan(JUNCTION_LOCK_METRES);
    const before = road.waysOut(rider);
    const was = road.view;

    expect(road.route.choose(junction.distance, other, rider)).toBe('swapped');
    const now = road.follow(rider);
    if (now === undefined) throw new Error('no new view');
    const after = road.waysOut(rider);
    expect(after).not.toBe(before);
    expect(after).toHaveLength(before.length);

    const at = junction.distance + 40;
    const places = (ways: readonly OpenWorldWayOut[], origin: number): string[] =>
      ways
        .filter((way) => way.fromMetres === junction.distance - origin)
        .map((way) => {
          const { x, z } = placeOn(way.profile, origin, at);
          return `${x.toFixed(2)},${z.toFixed(2)}`;
        })
        .sort();
    const place = (profile: RouteProfile, origin: number): string => {
      const { x, z } = placeOn(profile, origin, at);
      return `${x.toFixed(2)},${z.toFixed(2)}`;
    };
    // Every way out of the junction is drawn by the road or a way out, before and after.
    const every = [...places(before, was.origin), place(was.profile, was.origin)].sort();
    expect([...places(after, now.origin), place(now.profile, now.origin)].sort()).toEqual(every);
    // The road the route left is a way out now, and the way it took is one no longer.
    expect(places(after, now.origin)).toContain(place(was.profile, was.origin));
    expect(places(after, now.origin)).not.toContain(place(now.profile, now.origin));
    expect(places(before, was.origin)).toContain(place(now.profile, now.origin));
    // A way neither taken nor left keeps its view: nothing built on it is built again.
    const untouched = before.filter(
      (way) =>
        way.fromMetres === junction.distance - was.origin &&
        place(way.profile, was.origin) !== place(now.profile, now.origin),
    );
    expect(untouched.length).toBeGreaterThanOrEqual(1);
    for (const way of untouched) expect(after).toContain(way);
  });

  it('hands on, after a choice, the ways of the road it makes: the same views wherever they were handed on before', () => {
    const { road } = grid();
    const rider = 40;
    const { junction, other } = nextJunction(road, rider);
    const before = road.waysOut(rider);
    expect(road.route.choose(junction.distance, other, rider)).toBe('swapped');
    road.follow(rider);
    const after = road.waysOut(rider);
    const origin = road.view.origin;
    expect(after.map((way) => wayKey(way.profile, origin, way.fromMetres + origin)).sort()).toEqual(
      waysTo(road.route, rider, WAYS_OUT_DEPTH),
    );
    // Most of them were ways out before the press, and are the same views:
    // what was built along each is not built again on the frame of the press.
    const carried = after.filter((way) => before.includes(way));
    expect(carried.length).toBeGreaterThanOrEqual(4);
    expect(after.length - carried.length).toBeLessThanOrEqual(after.length / 2);
    // And each way handed on leaves a road where that road is.
    for (const way of after.filter((each) => each.fromMetres === junction.distance - origin)) {
      const at = junction.distance - 10;
      expect(placeOn(way.profile, origin, at)).toEqual(placeOn(road.view.profile, origin, at));
    }
  });

  it('keeps a junction’s ways until it is the view’s reach behind the rider, then drops them', () => {
    const { road } = grid();
    const { junction } = nextJunction(road, 40);
    const from = junction.distance;
    const before = road.waysOut(from - 5);
    const held = before.filter((way) => way.fromMetres === from);
    expect(held.length).toBeGreaterThanOrEqual(2);
    // And the ways out of the junctions along those: what stands down a side
    // street the rider is passing is beside them, not behind.
    const ahead = waysTo(road.route, from + 1, WAYS_OUT_DEPTH);
    const along = before.filter(
      (way) => way.fromMetres > from && !ahead.includes(wayKey(way.profile, 0, way.fromMetres)),
    );
    expect(along.length).toBeGreaterThanOrEqual(2);
    // Ridden through and on: still handed on, the same views, every one.
    for (const rider of [from + 1, from + WAYS_OUT_BEHIND_METRES - 1]) {
      road.follow(rider);
      const ways = road.waysOut(rider);
      for (const way of before) expect(ways, `at ${rider - from} m past`).toContain(way);
    }
    const past = from + WAYS_OUT_BEHIND_METRES + WAYS_OUT_LOOK_METRES + 1;
    road.follow(past);
    const ways = road.waysOut(past);
    for (const way of held) expect(ways).not.toContain(way);
  });

  it('drops every way behind the rider at a U-turn, and hands on none for a rider that is not a number', () => {
    const { road } = grid();
    const { junction } = nextJunction(road, 40);
    const from = junction.distance;
    const rider = from + 20;
    road.follow(from - 5);
    road.waysOut(from - 5);
    road.follow(rider);
    expect(road.waysOut(rider).some((way) => way.fromMetres === from)).toBe(true);
    road.route.uTurn(rider);
    expect(road.follow(rider)?.turned).toBe(true);
    // The junction is ahead again, on the road ridden back: its ways are that road's.
    const turned = road.waysOut(rider);
    expect(turned.every((way) => way.fromMetres + road.view.origin > rider)).toBe(true);
    expect(road.waysOut(Number.NaN)).toHaveLength(0);
    expect(road.waysOut(Number.POSITIVE_INFINITY)).toHaveLength(0);
  });

  it('without a frame, makes a way again once the trim has moved the view’s first point: both are drawn about it', () => {
    const { graph, edges } = gridGraph(COLUMNS, ROWS, roughGround, 3);
    const road = new OpenWorldRoad(
      new RollingRoute(graph, edges.find((edge) => edge.id === 'h0,3') as RollingEdge),
    );
    let trims = 0;
    let origin = road.view.origin;
    for (let rider = 0; rider <= 5_000; rider += 15) {
      road.follow(rider);
      if (road.view.origin !== origin) {
        origin = road.view.origin;
        trims += 1;
      }
      const ways = road.waysOut(rider);
      if (rider > 100) expect(ways.length, `at ${String(rider)} m`).toBeGreaterThan(0);
      for (const way of ways) {
        // Drawn about the view's own first point, as the view is.
        expect(corridorOrigin(way.profile), `at ${String(rider)} m`).toEqual(
          corridorOrigin(road.view.profile),
        );
        expect(sceneryAnchor(way.profile)?.origin).toBe(origin);
      }
    }
    expect(trims).toBeGreaterThanOrEqual(2);
  });

  it('reaches as far ahead as the view does and as far behind', () => {
    expect(WAYS_OUT_AHEAD_METRES).toBe(VIEW_AHEAD_METRES);
    expect(WAYS_OUT_BEHIND_METRES).toBe(VIEW_BEHIND_METRES);
  });
});

describe('the scenery along a way out — #3051', () => {
  /**
   * A ride 110 m short of a crossroads, as a rider pressing a turn is: the
   * first on the grid, or the one `after` more junctions on, on `ground`.
   */
  function approach(
    after = 0,
    ground: SyntheticGround = roughGround,
  ): {
    readonly road: OpenWorldRoad;
    readonly rider: number;
    readonly junction: RollingJunction;
    readonly other: string;
  } {
    const { road } = grid(ground);
    let { junction } = nextJunction(road, 0);
    for (let passed = 0; passed < after; passed += 1) {
      ({ junction } = nextJunction(road, junction.distance));
    }
    const rider = junction.distance - 110;
    road.follow(rider);
    return { road, rider, ...nextJunction(road, rider) };
  }

  /** `items` standing more than `least` metres from the rider at ride distance `rider`. */
  function beyond(
    road: OpenWorldRoad,
    rider: number,
    items: readonly ScatterItem[],
    least: number,
    most: number,
  ): ScatterItem[] {
    const at = placeOn(road.view.profile, road.view.origin, Math.round(rider / 10) * 10);
    return items.filter((item) => {
      const distance = Math.hypot(item.x - at.x, item.z - at.z);
      return distance > least && distance <= most;
    });
  }

  it('stands along every way out before a choice, and where it stood after it: the press replaces nothing', () => {
    const { road, rider, junction, other } = approach();
    const before = frameAt(road, rider);
    expect(road.route.choose(junction.distance, other, rider)).toBe('swapped');
    road.follow(rider);
    const after = frameAt(road, rider);
    // Past the junction, 110 m ahead, out to where the fog has taken most of it.
    const there = beyond(road, rider, before.scatter, 100, 300);
    const here = beyond(road, rider, after.scatter, 100, 300);
    expect(there.length).toBeGreaterThan(60);
    // Measured 2026-11-23: 0.93 kept and 0.07 new. Without the ways out, 0.31
    // and 0.66: the road straight on lost what stood along it, and the street
    // turned into gained what stands along it, on this one frame.
    expect(kept(there, after.scatter) / there.length).toBeGreaterThan(0.85);
    expect(1 - kept(here, before.scatter) / here.length).toBeLessThan(0.15);
    // Short of the junction nothing moved either.
    const near = beyond(road, rider, before.scatter, 0, 100);
    expect(kept(near, after.scatter) / near.length).toBeGreaterThan(0.9);
  });

  it('keeps the houses where they stood under a budget that binds: the road’s own are not kept first', () => {
    // The fourth crossroads of the lowland grid has a village on every way out.
    const { road, rider, junction, other } = approach(3, LOWLAND);
    const budget = { scatterItems: 60, structureItems: 40 };
    const before = frameAt(road, rider, budget);
    expect(road.route.choose(junction.distance, other, rider)).toBe('swapped');
    road.follow(rider);
    const after = frameAt(road, rider, budget);
    const structures = (items: readonly ScatterItem[]): ScatterItem[] =>
      items.filter((item) => isStructureKind(item.kind));
    // The budget binds on both frames, and is kept.
    expect(structures(before.scatter).length).toBeLessThanOrEqual(40);
    expect(structures(after.scatter).length).toBeLessThanOrEqual(40);
    expect(before.scatter.length - structures(before.scatter).length).toBeLessThanOrEqual(60);
    const all = frameAt(road, rider);
    expect(structures(all.scatter).length).toBeGreaterThan(40);
    const built = structures(before.scatter);
    expect(built.length).toBeGreaterThan(30);
    // Every one a building: the budget keeps a house before a field's wall.
    expect(built.every((item) => !BOUNDARY_KINDS.has(item.kind as StructureKind))).toBe(true);
    // MEASURED-STRUCTURES
    expect(kept(built, after.scatter) / built.length).toBeGreaterThan(0.85);
    const grown = before.scatter.filter((item) => !isStructureKind(item.kind));
    expect(kept(grown, after.scatter) / grown.length).toBeGreaterThan(0.85);
  });

  it('stands off the road the route takes', () => {
    const { road, rider } = approach();
    const view = road.view;
    const origin = corridorOrigin(view.profile);
    const seed = scatterSeed(view.profile);
    const ways = road.waysOut(rider);
    const along = rider - view.origin;
    const span = [along - VIEW_BEHIND_METRES, along + VIEW_AHEAD_METRES] as const;
    const budget = { maxItems: 100_000, riderMetres: along };
    const own = scatterAt(view.profile, origin, seed, span[0], span[1], budget);
    const withWays = scatterAt(
      view.profile,
      origin,
      seed,
      span[0],
      span[1],
      budget,
      NO_LAND_CLASS,
      undefined,
      ways,
    );
    const onWays = withWays.filter((item) => !own.some((other) => samePlace(item, other)));
    // The road's own are the same items, and the ways add as many again.
    expect(withWays.length - onWays.length).toBe(own.length);
    expect(onWays.length).toBeGreaterThan(own.length / 2);
    const clearance = ROAD_WIDTH_METRES / 2 + SCATTER_VERGE_METRES;
    for (const item of onWays) {
      // A way leaves the road at its junction: its first cells lie across the road.
      expect(
        distanceToDrawnRoad(view.profile, origin, item.x, item.z, clearance),
      ).toBeGreaterThanOrEqual(clearance);
    }
    // They are what each way's own view places from its junction as far as
    // this view reaches through it, and no further, less what the road's
    // clearance takes. (Here both views count from the same first sample.)
    const place = (item: ScatterItem): string =>
      `${item.kind} ${item.x.toFixed(2)} ${item.z.toFixed(2)}`;
    const expected = ways.flatMap((way) =>
      scatterAt(
        way.profile,
        origin,
        seed,
        way.fromMetres,
        Math.min(span[1], way.fromMetres + SCATTER_WAY_REACH_METRES),
        { maxItems: 100_000, riderMetres: way.fromMetres },
      ).filter(
        (item) => distanceToDrawnRoad(view.profile, origin, item.x, item.z, clearance) >= clearance,
      ),
    );
    expect(onWays.map(place).sort()).toEqual(expected.map(place).sort());
    // A way whose junction is nearly at the view's end has little in reach.
    expect(ways.some((way) => span[1] - way.fromMetres < 60)).toBe(true);
    // Each way, alone, places items the road's clearance takes: the control.
    const across = ways.flatMap((way) =>
      scatterAt(way.profile, origin, seed, way.fromMetres, way.fromMetres + 60, {
        maxItems: 100_000,
        riderMetres: way.fromMetres,
      }).filter(
        (item) => distanceToDrawnRoad(view.profile, origin, item.x, item.z, clearance) < clearance,
      ),
    );
    expect(across.length).toBeGreaterThan(0);
  });

  it('is built off the road the route takes too, and all of it stands on the ground the frame draws', () => {
    const { road, rider } = approach(3, LOWLAND);
    const view = road.view;
    const origin = corridorOrigin(view.profile);
    const seed = scatterSeed(view.profile);
    const ways = road.waysOut(rider);
    // In the frame: every structure along a way is off the road, by a
    // structure's own clearance, and everything stands on the frame's ground.
    const all = { scatterItems: 100_000, structureItems: 100_000 };
    const bare = frameAt(road, rider, all, []);
    const frame = frameAt(road, rider, all);
    const added = frame.scatter.filter(
      (item) => !bare.scatter.some((other) => samePlace(item, other)),
    );
    const built = added.filter((item) => isStructureKind(item.kind));
    expect(built.length).toBeGreaterThan(10);
    // As far along each way as the view reaches through its junction, and no
    // further: a way is built for 400 m, and a junction may be 400 m ahead.
    const here = placeOn(view.profile, view.origin, Math.round(rider / 10) * 10);
    const reach = VIEW_AHEAD_METRES + 100;
    for (const item of built) {
      expect(Math.hypot(item.x - here.x, item.z - here.z)).toBeLessThan(reach);
    }
    const everything = ways.flatMap((way) => structuresOnWay(way, origin, seed).items);
    expect(
      everything.filter((item) => Math.hypot(item.x - here.x, item.z - here.z) > reach).length,
    ).toBeGreaterThan(10);
    // Nothing grows on the ground a way's village takes, as none does on the road's.
    const ground = ways.flatMap((way) => structuresOnWay(way, origin, seed).footprints);
    expect(ground.length).toBeGreaterThan(10);
    const grows = (item: ScatterItem): boolean =>
      ['tree-broadleaf', 'tree-conifer', 'shrub', 'rock'].includes(item.kind);
    expect(
      frame.scatter.filter(
        (item) => grows(item) && ground.some((piece) => onSettlementGround(item, piece)),
      ),
    ).toHaveLength(0);
    // The control: the ways' own scenery, placed with no word of their villages, stands on it.
    const along = rider - view.origin;
    const wild = scatterAt(
      view.profile,
      origin,
      seed,
      along - VIEW_BEHIND_METRES,
      along + VIEW_AHEAD_METRES,
      { maxItems: 100_000, riderMetres: along },
      NO_LAND_CLASS,
      undefined,
      ways,
    );
    expect(
      wild.filter((item) => grows(item) && ground.some((piece) => onSettlementGround(item, piece)))
        .length,
    ).toBeGreaterThan(0);
    for (const item of built) {
      expect(
        footprintClearance(
          view.profile,
          origin,
          item,
          STRUCTURE_FOOTPRINTS[item.kind as StructureKind],
        ),
      ).toBeGreaterThanOrEqual(ROAD_CLEARANCE_METRES);
    }
    // Stood again on the mesh the frame drew, nothing moves and nothing is dropped.
    expect(added.length).toBeGreaterThan(100);
    expect(standingOnGround(added, frame.terrain.mesh).map(({ x, z }) => [x, z])).toEqual(
      added.map(({ x, z }) => [x, z]),
    );
    const heights = standingOnGround(
      added.filter((item) => !isStructureKind(item.kind)),
      frame.terrain.mesh,
    );
    for (const item of heights) {
      const drawn = added.find((other) => samePlace(item, other));
      expect(Math.abs((drawn?.y ?? Number.NaN) - item.y)).toBeLessThan(1e-6);
    }
    // The way's own ground is another ground: left on it, some would float or be buried.
    const way = ways[0] as OpenWorldWayOut;
    const alone = scatterAt(
      way.profile,
      origin,
      seed,
      way.fromMetres,
      way.fromMetres + VIEW_AHEAD_METRES,
      { maxItems: 100_000, riderMetres: way.fromMetres },
    );
    const moved = alone.filter((item) => {
      const here = added.find((other) => samePlace(item, other));
      return here !== undefined && Math.abs(here.y - item.y) > 0.25;
    });
    expect(moved.length).toBeGreaterThan(5);
  });

  it('keeps the budget by the road’s own rule, whichever of the candidates stand along a way', () => {
    const { road, rider } = approach();
    const view = road.view;
    const origin = corridorOrigin(view.profile);
    const seed = scatterSeed(view.profile);
    const along = rider - view.origin;
    const span = [along - VIEW_BEHIND_METRES, along + VIEW_AHEAD_METRES] as const;
    // A way whose junction is past the view: nothing of it is in the span,
    // so what is kept of the road's own is what the road alone keeps.
    const way = road.waysOut(rider)[0] as OpenWorldWayOut;
    const past = { profile: way.profile, fromMetres: span[1] + 50 };
    for (const maxItems of [0, 1, 25, 120, 100_000]) {
      const budget = { maxItems, riderMetres: along };
      expect(
        scatterAt(view.profile, origin, seed, span[0], span[1], budget, NO_LAND_CLASS, undefined, [
          past,
        ]),
        `a budget of ${String(maxItems)}`,
      ).toEqual(scatterAt(view.profile, origin, seed, span[0], span[1], budget));
    }
    // And over the ways as well it is kept: never more than the budget.
    const ways = road.waysOut(rider);
    expect(
      scatterAt(
        view.profile,
        origin,
        seed,
        span[0],
        span[1],
        { maxItems: 120, riderMetres: along },
        NO_LAND_CLASS,
        undefined,
        ways,
      ).length,
    ).toBeLessThanOrEqual(120);
  });

  it('places a way’s scenery as the view’s reach comes to it, and the same as if all at once', () => {
    /** What stands along the ways alone, for a rider at `rider`, on `road`. */
    const onWays = (road: OpenWorldRoad, rider: number): ScatterItem[] => {
      road.follow(rider);
      const view = road.view;
      const origin = corridorOrigin(view.profile);
      const seed = scatterSeed(view.profile);
      const along = rider - view.origin;
      const span = [along - VIEW_BEHIND_METRES, along + VIEW_AHEAD_METRES] as const;
      const budget = { maxItems: 100_000, riderMetres: along };
      const own = scatterAt(view.profile, origin, seed, span[0], span[1], budget);
      return scatterAt(
        view.profile,
        origin,
        seed,
        span[0],
        span[1],
        budget,
        NO_LAND_CLASS,
        undefined,
        road.waysOut(rider),
      ).filter((item) => !own.some((other) => samePlace(item, other)));
    };
    const key = (item: ScatterItem): string =>
      `${item.kind} ${item.x.toFixed(2)} ${item.z.toFixed(2)}`;
    // Ridden up to the crossroads a few metres a frame, as a ride is.
    const { road: ridden } = grid();
    let last: ScatterItem[] = [];
    for (let rider = 0; rider <= 150; rider += 3) last = onWays(ridden, rider);
    // And asked once, there, on a ride nobody has drawn.
    const { road: fresh } = grid();
    const once = onWays(fresh, 150);
    expect(once.length).toBeGreaterThan(150);
    expect(last.map(key).sort()).toEqual(once.map(key).sort());
    // No item twice: a span placed again would stand each of its items twice.
    expect(new Set(last.map(key)).size).toBe(last.length);
  });

  it('reads a way kept through a trim at the road’s own distance: the two views count from different samples', () => {
    const all = { scatterItems: 100_000, structureItems: 100_000 };
    const tight = { scatterItems: 80, structureItems: 60 };
    const key = (item: ScatterItem): string =>
      `${item.kind} ${item.x.toFixed(2)} ${item.z.toFixed(2)}`;
    // Ridden: the ways in view were handed on before the trim, and are kept
    // through it. The road is trimmed when it is next advanced, 2 km on.
    const { road: ridden } = grid(LOWLAND);
    for (let rider = 0; rider < 1_900; rider += 50) ridden.follow(rider);
    const held = ridden.view.origin;
    let trimmedAt = 0;
    let before: readonly OpenWorldWayOut[] = [];
    for (let rider = 1_900; trimmedAt === 0 && rider < 2_300; rider += 2) {
      ridden.follow(rider);
      if (ridden.view.origin !== held) trimmedAt = rider;
      else before = ridden.waysOut(rider);
    }
    expect(trimmedAt).toBeGreaterThan(0);
    const kept = ridden.waysOut(trimmedAt).filter((way) => before.includes(way));
    expect(kept.length).toBeGreaterThanOrEqual(4);
    // Each counts ride distance from where the view did, and the view from the trim.
    expect(kept.every((way) => sceneryAnchor(way.profile)?.origin === held)).toBe(true);
    expect(ridden.view.origin).toBeGreaterThan(held);
    expect(sceneryAnchor(ridden.view.profile)?.origin).toBe(ridden.view.origin);
    // A ride that came to the same stretch with its road already trimmed:
    // its ways count from where its view does.
    const { road: fresh } = grid(LOWLAND);
    fresh.follow(1_900);
    expect(fresh.view.origin).toBeGreaterThan(0);
    for (let rider = 1_900; rider <= trimmedAt; rider += 2) {
      fresh.follow(rider);
      fresh.waysOut(rider);
    }
    const origin = fresh.view.origin;
    expect(
      fresh.waysOut(trimmedAt).every((way) => sceneryAnchor(way.profile)?.origin === origin),
    ).toBe(true);
    for (const budget of [all, tight]) {
      const drawn = frameAt(ridden, trimmedAt, budget).scatter.map(key).sort();
      expect(drawn.length).toBeGreaterThan(60);
      expect(drawn).toEqual(frameAt(fresh, trimmedAt, budget).scatter.map(key).sort());
    }
  });

  it('reads no more of a way than the view reaches, by how far along it each thing stands', () => {
    const { road, rider } = approach(3, LOWLAND);
    const view = road.view;
    const origin = corridorOrigin(view.profile);
    const seed = scatterSeed(view.profile);
    const busiest = road
      .waysOut(rider)
      .map((way) => ({ way, built: structuresOnWay(way, origin, seed) }))
      .sort((first, second) => second.built.items.length - first.built.items.length)[0];
    if (busiest === undefined) throw new Error('no way out');
    const { way, built } = busiest;
    expect(built.items.length).toBeGreaterThan(40);
    expect(built.footprints.length).toBeGreaterThan(5);
    // In order along the way, from its junction.
    expect([...built.alongs].sort((first, second) => first - second)).toEqual(built.alongs);
    expect(built.alongs[0]).toBeGreaterThanOrEqual(way.fromMetres);
    expect(built.footprints.map((piece) => piece.along)).toEqual(
      built.footprints.map((piece) => piece.along).sort((first, second) => first - second),
    );
    expect(built.boundaries).toEqual(
      built.items.map((item) => BOUNDARY_KINDS.has(item.kind as StructureKind)),
    );
    // Each stands beside the way where it is said to: within a village's depth of that place.
    built.items.forEach((item, index) => {
      const at = placeOn(way.profile, 0, Math.round((built.alongs[index] as number) / 10) * 10);
      expect(Math.hypot(item.x - at.x, item.z - at.z)).toBeLessThan(120);
    });
    for (const share of [0, 0.3, 0.6, 1.1]) {
      const to = way.fromMetres + share * SCATTER_WAY_REACH_METRES;
      expect(structuresWithin(built, to)).toEqual({
        items: built.alongs.filter((along) => along < to).length,
        footprints: built.footprints.filter((piece) => piece.along < to).length,
      });
    }
    const half = structuresWithin(built, way.fromMetres + 0.5 * SCATTER_WAY_REACH_METRES);
    expect(half.items).toBeGreaterThan(0);
    expect(half.items).toBeLessThan(built.items.length);
    expect(half.footprints).toBeGreaterThan(0);
    expect(half.footprints).toBeLessThan(built.footprints.length);
  });

  it('places and builds along a way once, for frames that hand over an origin and levers of their own', () => {
    const { graph, edges } = gridGraph(COLUMNS, ROWS, LOWLAND, 3);
    // No frame: every `corridorOrigin` is a new object, as on a ride with none.
    const road = new OpenWorldRoad(
      new RollingRoute(graph, edges.find((edge) => edge.id === 'h0,3') as RollingEdge),
    );
    const rider = 760;
    road.follow(rider);
    const view = road.view;
    const seed = scatterSeed(view.profile);
    const ways = road.waysOut(rider);
    const along = rider - view.origin;
    const placed = (): readonly ScatterItem[] =>
      scatterAt(
        view.profile,
        corridorOrigin(view.profile),
        seed,
        along - VIEW_BEHIND_METRES,
        along + VIEW_AHEAD_METRES,
        { maxItems: 100_000, riderMetres: along },
        NO_LAND_CLASS,
        countrysideWithout([]),
        ways,
      );
    expect(corridorOrigin(view.profile)).not.toBe(corridorOrigin(view.profile));
    const first = placed();
    const second = placed();
    // The road's own are placed each frame; a way's are the items kept for it.
    const again = second.filter((item) => first.includes(item));
    expect(again.length).toBeGreaterThan(100);
    expect(again.length).toBeLessThan(second.length);
    for (const way of ways) {
      expect(
        structuresOnWay(way, corridorOrigin(view.profile), seed, NO_LAND_CLASS, undefined, {
          ...countrysideWithout([]),
        }),
      ).toBe(structuresOnWay(way, corridorOrigin(view.profile), seed));
    }
    // And with another lever, built again: it is the levers that are kept by.
    const way = ways[0] as OpenWorldWayOut;
    const origin = corridorOrigin(view.profile);
    const built = structuresOnWay(way, origin, seed);
    expect(
      structuresOnWay(
        way,
        origin,
        seed,
        NO_LAND_CLASS,
        undefined,
        countrysideWithout(['boundaries']),
      ),
    ).not.toBe(built);
  });

  it('places nothing along a way for a ride that hands none on: a route’s frame is as it was', () => {
    const { road, rider } = approach();
    const none = frameAt(road, rider, {}, 'none');
    const empty = frameAt(road, rider, {}, []);
    expect(empty.scatter).toEqual(none.scatter);
    expect(frameAt(road, rider).scatter).not.toEqual(none.scatter);
  });
});
