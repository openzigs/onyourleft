// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * An open-world ride's scenery survives a change of view — #3055.
 *
 * A view is a new profile after every choice, U-turn, reopen and extension
 * (`road.ts`), and it is a different length each time. Seeded from the view
 * and placed on a grid stretched to its length, every house, tree and wall
 * was regenerated on that frame: the owner's "just flipping screens". Read
 * here through the real `sceneFrame`, on a synthetic street grid, ridden by
 * the real {@link OpenWorldRoad}: every item short of the change is still
 * there, the same kind, in the same place, at the same height.
 *
 * ⚠️ **With no budget.** A frame's budget keeps the items nearest the rider
 * out of everything in view (`scatter.ts` §`thin`), so a change past the
 * junction moves which near items a full budget keeps. That is the budget's
 * rule and not the seed's, so these frames carry room for everything.
 */

import { describe, expect, it } from 'vitest';

import { RollingRoute, metres, type RollingEdge } from '@onyourleft/domain';
import { gridGraph, roughGround, type SyntheticGround } from '@onyourleft/domain/rolling-testing';

import { FIELD_SPAN_METRES, TERRAIN_COLUMN_OFFSETS } from '../landform';
import { sceneFrame } from '../scene';
import { scatterSeed, type ScatterItem } from '../scatter';
import { cyclistsInReach, townAt } from '../scenery-cyclists';
import { atStartLine } from '../simulation';
import { corridorOrigin, type CorridorOrigin } from '../terrain';
import { NO_URBAN_CLASS } from '../urban-class';
import { OPEN_WORLD_REACH_FLOOR_METRES, OpenWorldRoad, type OpenWorldRoadView } from './road';

const COLUMNS = [0, 180, 410, 600, 870, 1_050, 1_330, 1_520, 1_790, 2_000, 2_260, 2_450];
const ROWS = [0, 230, 400, 650, 820, 1_090, 1_280, 1_510, 1_700, 1_960, 2_150];
const METRES_PER_DEGREE_LATITUDE = 111_320;

/** Room for every item in view. @see this file's header */
const NO_BUDGET = 100_000;

/**
 * How far short of a change an item must stand to be held to it: **80 m**. A
 * change at ride distance `d` refits no height or grade before `d − 70 m`
 * (`RollingRoute`'s header, item 4), and the ground beside the road is tilted
 * by the grade; a bend's curvature is read over a window either side.
 */
const MARGIN_METRES = 80;

/**
 * Where a U-turn's frames are drawn: 60 m behind the rider, so the frame
 * reaches {@link MARGIN_METRES} and more behind the turn. A frame reaches
 * only 60 m behind the rider it is drawn for (`terrain.ts`).
 */
const BEHIND_THE_TURN_METRES = 60;

/**
 * Ground that climbs to the east the whole way, at 4 %, and rolls from north
 * to south: a rider turned round on an east-west street is turned on a crest.
 *
 * ⚠️ **Not {@link roughGround}, for the U-turn alone, and why is a defect of
 * its own.** A U-turn mirrors the road's heights about the rider, so a turn on
 * a slope going down is a valley in the view's profile, and `waterways.ts`
 * finds a stream there: the ground within its banks is shaped for it, and
 * whatever stood in it is taken away. That is the turn's own change of road,
 * whatever the seed, so this ride turns where no valley can be made: #3064.
 */
const CLIMBING: SyntheticGround = (east, north) => 1_600 + east * 0.04 + 15 * Math.cos(north / 230);

function grid(ground: SyntheticGround = roughGround): OpenWorldRoad {
  const { graph, edges } = gridGraph(COLUMNS, ROWS, ground, 3);
  return new OpenWorldRoad(
    new RollingRoute(graph, edges.find((edge) => edge.id === 'h0,3') as RollingEdge),
  );
}

/** An item where it stands in the world: metres from one fixed origin, and its height. */
interface Placed {
  readonly kind: ScatterItem['kind'];
  readonly east: number;
  readonly north: number;
  readonly up: number;
  /** Ride distance of the drawn road nearest it. */
  readonly along: number;
}

/**
 * Every scenery item of the frame drawn for a rider at ride distance `rider`
 * on `view`, in one frame of reference for every view: each view's local
 * metres are measured from its own first point, which the trim behind moves.
 */
function sceneryAt(view: OpenWorldRoadView, rider: number, fixed: CorridorOrigin): Placed[] {
  const origin = corridorOrigin(view.profile);
  const along = rider - view.origin;
  const frame = sceneFrame({
    profile: view.profile,
    origin,
    state: { ...atStartLine(view.profile), ride: { speed: 0 as never, distance: metres(along) } },
    riderDistance: along,
    scatterItems: NO_BUDGET,
    structureItems: NO_BUDGET,
  });
  const scale = Math.cos((fixed.latitude * Math.PI) / 180);
  const own = Math.cos((origin.latitude * Math.PI) / 180);
  return frame.scatter.map((item) => {
    let nearest = Number.POSITIVE_INFINITY;
    let at = 0;
    for (const point of frame.corridor.centre) {
      const gap = Math.hypot(point.x - item.x, point.z - item.z);
      if (gap < nearest) {
        nearest = gap;
        at = point.distance + view.origin;
      }
    }
    // Back to degrees on the view's own projection, then to the fixed one.
    const longitude = origin.longitude - item.x / (METRES_PER_DEGREE_LATITUDE * own);
    const latitude = origin.latitude + item.z / METRES_PER_DEGREE_LATITUDE;
    return {
      kind: item.kind,
      east: (longitude - fixed.longitude) * METRES_PER_DEGREE_LATITUDE * scale,
      north: (latitude - fixed.latitude) * METRES_PER_DEGREE_LATITUDE,
      up: item.y + origin.elevation - fixed.elevation,
      along: at,
    };
  });
}

/** `items` short of ride distance `change`. */
function shortOf(items: readonly Placed[], change: number): Placed[] {
  return items.filter((item) => item.along < change);
}

/** The same item: its kind, where it stands and how high, to a millimetre. */
function same(a: Placed, b: Placed): boolean {
  return (
    a.kind === b.kind &&
    Math.abs(a.east - b.east) < 1e-3 &&
    Math.abs(a.north - b.north) < 1e-3 &&
    Math.abs(a.up - b.up) < 1e-3
  );
}

/**
 * That every item of `before` short of `change` is in `after`, unchanged; and,
 * `exactly`, that nothing else is there short of it. A U-turn's road back is
 * the road the rider came along, so the items placed beside its return stand
 * beside the same stretch: those are new, and only the first half holds there.
 */
function expectKept(
  before: readonly Placed[],
  after: readonly Placed[],
  change: number,
  { least, exactly }: { readonly least: number; readonly exactly: boolean },
): void {
  const was = shortOf(before, change);
  expect(was.length, 'items short of the change before it').toBeGreaterThanOrEqual(least);
  const lost = was.filter((item) => !after.some((other) => same(item, other)));
  expect(lost, 'items short of the change that were moved or taken away').toEqual([]);
  if (exactly) {
    const now = shortOf(after, change);
    const added = now.filter((item) => !was.some((other) => same(item, other)));
    expect(added, 'items short of the change that were not there before').toEqual([]);
  }
}

describe('an open-world ride keeps its scenery across a change of view — #3055', () => {
  it('keeps every item short of a junction when another way is taken there', () => {
    const road = grid();
    const fixed = corridorOrigin(road.view.profile);
    const rider = 400;
    const junction = road.route.junctionsAfter(rider + 150)[0];
    if (junction === undefined) throw new Error('no junction ahead');
    const before = sceneryAt(road.view, rider, fixed);
    const other = junction.ways.find((way) => way.edge.id !== junction.taken)?.edge.id as string;
    expect(road.route.choose(junction.distance, other, rider)).toBe('swapped');
    const after = road.follow(rider);
    if (after === undefined) throw new Error('no new view');
    expectKept(before, sceneryAt(after, rider, fixed), junction.distance - MARGIN_METRES, {
      least: 50,
      exactly: true,
    });
  });

  it('keeps every item behind the rider when they turn round', () => {
    const road = grid(CLIMBING);
    const fixed = corridorOrigin(road.view.profile);
    const rider = 640;
    const drawn = rider - BEHIND_THE_TURN_METRES;
    const before = sceneryAt(road.view, drawn, fixed);
    road.route.uTurn(rider);
    const after = road.follow(rider);
    if (after?.turned !== true) throw new Error('no U-turn');
    expectKept(before, sceneryAt(after, drawn, fixed), rider - MARGIN_METRES, {
      least: 10,
      exactly: false,
    });
  });

  it('keeps every item in view when the route extends itself, twice', () => {
    const road = grid();
    const fixed = corridorOrigin(road.view.profile);
    for (let extension = 0; extension < 2; extension += 1) {
      const rider =
        road.view.origin + road.view.profile.totalDistance - OPEN_WORLD_REACH_FLOOR_METRES + 1;
      const before = sceneryAt(road.view, rider, fixed);
      const after = road.follow(rider);
      if (after === undefined || after.turned) throw new Error('no extension');
      expectKept(before, sceneryAt(after, rider, fixed), Number.POSITIVE_INFINITY, {
        least: 100,
        exactly: true,
      });
    }
    // The second moved the view's first point, so its local metres moved too.
    expect(road.view.origin).toBeGreaterThan(0);
  });

  it('keeps the other cyclists on the road where they were at every extension of a long ride', () => {
    const road = grid();
    const cyclists = (view: OpenWorldRoadView, rider: number) => {
      const seed = scatterSeed(view.profile);
      const town = townAt(view.profile, seed, NO_URBAN_CLASS);
      return cyclistsInReach(view.profile, seed, town, rider - view.origin).map((each) => ({
        kind: each.encounter.kind,
        along: each.along + view.origin,
        lane: each.encounter.lane,
      }));
    };
    let seen = 0;
    let extensions = 0;
    for (let rider = 0; rider <= 9_000; rider += 25) {
      const view = road.view;
      const after = road.follow(rider);
      if (after === undefined) continue;
      extensions += 1;
      for (let drawn = rider - 300; drawn <= rider + 600; drawn += 25) {
        const before = cyclists(view, drawn);
        const now = cyclists(after, drawn);
        expect(
          now.map((each) => each.kind),
          `at ${drawn} m`,
        ).toEqual(before.map((each) => each.kind));
        for (const [index, each] of now.entries()) {
          const was = before[index] as (typeof before)[number];
          expect(Math.abs(each.along - was.along), `cyclist ${index} at ${drawn} m`).toBeLessThan(
            1e-6,
          );
          expect(each.lane).toBe(was.lane);
        }
        seen += before.length;
      }
    }
    expect(extensions).toBeGreaterThan(5);
    expect(seen, 'cyclists in reach across the extensions').toBeGreaterThan(0);
  });

  it("draws the ground in fields counted in ride distance, the walls' fields, on every view", () => {
    const road = grid();
    const columns = TERRAIN_COLUMN_OFFSETS.length;
    /**
     * The ground drawn at `rider`, its odometer read back at every vertex
     * against the same view's unanchored: the view's own distance, which the
     * anchor moves on by the view's origin and nothing else.
     */
    const expectRideDistance = (rider: number): { readonly retraced: number } => {
      const view = road.view;
      const along = rider - view.origin;
      const ground = (profile: typeof view.profile) => {
        const frame = sceneFrame({
          profile,
          origin: corridorOrigin(profile),
          state: { ...atStartLine(profile), ride: { speed: 0 as never, distance: metres(along) } },
          riderDistance: along,
        });
        const mesh = frame.terrain.mesh;
        // ⚠️ Copied at once: a mesh's arrays are lent until the next build.
        const count = mesh.rows * 2 * columns;
        return {
          mesh,
          odometers: Array.from({ length: count }, (_, at) => mesh.fields[at * 2] as number),
          retraced: frame.corridor.retraced.filter((flag) => flag !== 0).length,
        };
      };
      const anchored = ground(view.profile);
      const own = ground({ ...view.profile });
      expect(anchored.mesh.fieldSpan).toBe(FIELD_SPAN_METRES);
      // Never wrapped: more fields than the ride has reached.
      expect(anchored.mesh.fieldCount * FIELD_SPAN_METRES).toBeGreaterThan(rider * 1_000);
      expect(anchored.odometers.length).toBe(own.odometers.length);
      for (const [at, odometer] of anchored.odometers.entries()) {
        const expected = (own.odometers[at] as number) + view.origin;
        expect(Math.abs(odometer - expected), `vertex ${at}`).toBeLessThan(0.01);
      }
      return anchored;
    };
    for (let extension = 0; extension < 2; extension += 1) {
      const rider =
        road.view.origin + road.view.profile.totalDistance - OPEN_WORLD_REACH_FLOOR_METRES + 1;
      road.follow(rider);
      expectRideDistance(rider);
    }
    expect(road.view.origin).toBeGreaterThan(0);
    // And a U-turn's: the road back is drawn over the road out, whose rows
    // `landform.ts` builds apart (#1996), and they read ride distance too.
    const rider = road.view.origin + 1_200;
    road.route.uTurn(rider);
    road.follow(rider);
    expect(expectRideDistance(rider + 30).retraced).toBeGreaterThan(0);
  });
});
