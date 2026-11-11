// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The side roads' clearance, remembered — #2439. Every frame rebuilt the same
 * scatter and asked {@link onSideRoad} of every item against every side road
 * in view, about 11.7 ms of a tablet's frame (#2419). `cross-streets.ts`
 * §`sideRoadClearance` works each answer out once per side road; these say
 * that it keeps exactly what working it out afresh keeps, that a frame with
 * nothing new asks nothing, that a change of side roads is answered anew, and
 * that what it holds is bounded and goes with the view.
 *
 * ⚠️ `onSideRoad` is wrapped in a spy for the whole file, so that the frames
 * `sceneFrame` builds can be counted through the path a ride takes:
 * `scene.ts` hands its clearance `onSideRoad` by name for exactly this.
 */

import { describe, expect, it, vi } from 'vitest';

import { metres } from '@onyourleft/domain';
import type { StreetFeature } from '@onyourleft/map-features';

import {
  boardsClearOfSideRoads,
  clearOfSideRoads,
  onSideRoad,
  SIDE_ROAD_CLEARANCE_MAX_ENTRIES,
  sideRoadClearance,
  type SideRoad,
  UNCACHED_SIDE_ROAD_CLEARANCE,
} from './cross-streets';
import { BILLBOARD_FOOTPRINT } from './logo-board';
import { northRoute } from './route-fixtures-testing';
import { scatterAt, scatterSeed, type ScatterItem } from './scatter';
import { sceneFrame } from './scene';
import { siteAt, siteSpacing, STRUCTURE_FOOTPRINTS, structuresAt, type Site } from './settlements';
import { atStartLine } from './simulation';
import { corridorOrigin, drawnRoadFrame } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

vi.mock('./cross-streets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cross-streets')>();
  return { ...actual, onSideRoad: vi.fn(actual.onSideRoad) };
});

/** The real test, unwrapped: the spy above calls straight through to it. */
const realOnSideRoad = vi.mocked(onSideRoad).getMockImplementation() as typeof onSideRoad;

/** Six kilometres of level, low farmland running due north. */
const FARMLAND = northRoute(6_000, () => 40);
const ORIGIN = corridorOrigin(FARMLAND);
const SEED = scatterSeed(FARMLAND);

/** A procedural village a kilometre or more from either end: its crossroads, its houses, walls and hedges. */
const VILLAGE: Site = (() => {
  const { sites } = siteSpacing(FARMLAND);
  for (let index = 0; index < sites; index += 1) {
    const site = siteAt(FARMLAND, SEED, index);
    if (
      site?.kind === 'village' &&
      site.centre > 1_000 &&
      site.centre < FARMLAND.totalDistance - 1_000
    )
      return site;
  }
  throw new Error('no village on the fixture');
})();

/** A mapped street right across the road at `along`, `half` metres each side, square to it. */
function across(along: number, half: number): StreetFeature {
  const here = drawnRoadFrame(FARMLAND, ORIGIN, along);
  if (here === undefined) throw new Error(`no road at ${String(along)}`);
  return {
    kind: 'minor_road',
    kindDetail: '',
    grade: 'ground',
    line: Float32Array.from([
      here.x - here.normalX * half,
      here.z - here.normalZ * half,
      here.x + here.normalX * half,
      here.z + here.normalZ * half,
    ]),
  };
}

/** A crossing every 60 m for 800 m either side of the village, and the village's own crossroads. */
const CORRIDOR: WorldCorridor = {
  routeId: 'side-road-clearance-fixture',
  origin: ORIGIN,
  covered: () => true,
  coveredBoxes: [],
  landUse: [],
  buildings: [],
  paths: [],
  streets: Array.from({ length: 27 }, (_, index) =>
    across(VILLAGE.centre - 800 + index * 60 + 25, 100),
  ),
};

const START = atStartLine(FARMLAND);

function frameAt(distance: number) {
  return sceneFrame({
    profile: FARMLAND,
    origin: ORIGIN,
    state: { ...START, ride: { ...START.ride, distance: metres(distance) } },
    worldCorridor: CORRIDOR,
  });
}

/** What a frame at `distance` stands before the side roads are cleared: its structures, then its scatter. */
function unclearedAt(distance: number): readonly ScatterItem[] {
  const from = distance - 150;
  const to = distance + 450;
  const budget = { maxItems: 240, riderMetres: distance };
  return [
    ...structuresAt(FARMLAND, ORIGIN, SEED, from, to, budget),
    ...scatterAt(FARMLAND, ORIGIN, SEED, from, to, budget),
  ];
}

/** A ride past the village, every 5 m, with the side roads each frame drew. */
const RIDE: readonly {
  readonly roads: readonly SideRoad[];
  readonly items: readonly ScatterItem[];
}[] = Array.from({ length: 120 }, (_, index) => {
  const distance = VILLAGE.centre - 300 + index * 5;
  return { roads: frameAt(distance).sideRoads, items: unclearedAt(distance) };
});

describe('the side roads clearance, remembered — #2439', () => {
  it('keeps the same items and boards, in the same order, as working each one out afresh', () => {
    const clearance = sideRoadClearance(realOnSideRoad);
    let removed = 0;
    let kept = 0;
    let structuresRemoved = 0;
    for (const { roads, items } of RIDE) {
      const fresh = clearOfSideRoads(items, roads, UNCACHED_SIDE_ROAD_CLEARANCE);
      expect(clearOfSideRoads(items, roads, clearance)).toEqual(fresh);
      kept += fresh.length;
      removed += items.length - fresh.length;
      structuresRemoved += items.filter(
        (item) => !fresh.includes(item) && item.kind in STRUCTURE_FOOTPRINTS,
      ).length;
      // A board wherever an item stands, square to the road or not.
      const boards = items.map((item) => ({ x: item.x, z: item.z, rotation: item.rotation }));
      expect(boardsClearOfSideRoads(boards, roads, BILLBOARD_FOOTPRINT, clearance)).toEqual(
        boardsClearOfSideRoads(boards, roads, BILLBOARD_FOOTPRINT, UNCACHED_SIDE_ROAD_CLEARANCE),
      );
    }
    // The fixture: several side roads in every frame, and items both sides of the line.
    expect(Math.min(...RIDE.map(({ roads }) => roads.length))).toBeGreaterThanOrEqual(4);
    expect(RIDE.some(({ roads }) => roads.some((road) => road.junction.source === 'village'))).toBe(
      true,
    );
    expect(removed).toBeGreaterThan(0);
    expect(structuresRemoved).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(removed);
  });

  it('asks nothing again of a frame with nothing new in it', () => {
    const test = vi.fn(realOnSideRoad);
    const clearance = sideRoadClearance(test);
    const { roads, items } = RIDE[60] as (typeof RIDE)[number];
    const first = clearOfSideRoads(items, roads, clearance);
    const asked = test.mock.calls.length;
    expect(asked).toBeGreaterThan(0);
    // The next frame: the same items rebuilt, the same side roads in a new list.
    const again = clearOfSideRoads(
      items.map((item) => ({ ...item })),
      [...roads],
      clearance,
    );
    expect(test.mock.calls.length).toBe(asked);
    expect(again).toEqual(first);
  });

  it('asks nothing again of a second frame sceneFrame builds at the same place', () => {
    const spy = vi.mocked(onSideRoad);
    // Further on than the frames `RIDE` built, so most of this one's scenery is new to it.
    const distance = VILLAGE.centre + 500;
    spy.mockClear();
    const first = frameAt(distance);
    const asked = spy.mock.calls.length;
    // The control: a frame new to the clearance is asked about.
    expect(asked).toBeGreaterThan(0);
    const again = frameAt(distance);
    expect(spy.mock.calls.length).toBe(asked);
    expect(again.scatter).toEqual(first.scatter);
    expect(again.billboards).toEqual(first.billboards);
  });

  it('works the answer out anew when the side roads in view change, and lets go of a road that left', () => {
    const test = vi.fn(realOnSideRoad);
    const clearance = sideRoadClearance(test);
    const { roads, items } = RIDE[60] as (typeof RIDE)[number];
    // The side road that takes the most off.
    const counted = roads.map(
      (road) => items.length - clearOfSideRoads(items, [road], UNCACHED_SIDE_ROAD_CLEARANCE).length,
    );
    const busiest = roads[counted.indexOf(Math.max(...counted))] as SideRoad;
    const others = roads.filter((road) => road !== busiest);
    expect(Math.max(...counted)).toBeGreaterThan(0);

    const all = clearOfSideRoads(items, roads, clearance);
    const fewer = clearOfSideRoads(items, others, clearance);
    expect(fewer).not.toEqual(all);
    expect(fewer).toEqual(clearOfSideRoads(items, others, UNCACHED_SIDE_ROAD_CLEARANCE));
    expect(fewer.length).toBeGreaterThan(all.length);

    // Back in view, the road it let go of is asked about again, and only that one.
    const before = test.mock.calls.length;
    expect(clearOfSideRoads(items, roads, clearance)).toEqual(all);
    const asked = test.mock.calls.slice(before);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every(([only]) => only.length === 1 && only[0] === busiest)).toBe(true);
  });

  it('answers each margin apart, at the same place with the same footprint', () => {
    const clearance = sideRoadClearance(realOnSideRoad);
    const road = (RIDE[60] as (typeof RIDE)[number]).roads[0] as SideRoad;
    const [ax, az, bx, bz] = road.segments as unknown as [number, number, number, number];
    const length = Math.hypot(bx - ax, bz - az);
    // Five millimetres off the edge of the first segment, square to its
    // middle: inside the road's box, so neither margin is passed over unasked.
    const off = (road.halfWidths[0] as number) + 0.005;
    const at = {
      x: (ax + bx) / 2 - ((bz - az) / length) * off,
      z: (az + bz) / 2 + ((bx - ax) / length) * off,
      rotation: 0,
    };
    const point = { x: 0, back: 0, front: 0 };
    expect(clearance.on([road], at, point, 0)).toBe(false);
    expect(clearance.on([road], at, point, 1.5)).toBe(true);
    expect(realOnSideRoad([road], at, point, 1.5)).toBe(true);
  });

  it(`holds no more than ${String(SIDE_ROAD_CLEARANCE_MAX_ENTRIES)} answers`, () => {
    const test = vi.fn(realOnSideRoad);
    const clearance = sideRoadClearance(test);
    const { roads } = RIDE[60] as (typeof RIDE)[number];
    const road = roads[0] as SideRoad;
    const [ax, az] = road.segments as unknown as [number, number];
    // More shrubs than it may hold, every 2 cm around the mouth of one side road.
    const shrubs: ScatterItem[] = Array.from(
      { length: SIDE_ROAD_CLEARANCE_MAX_ENTRIES + 100 },
      (_, index) => ({
        kind: 'shrub',
        x: ax + (index % 150) * 0.02,
        y: 0,
        z: az + Math.floor(index / 150) * 0.02,
        rotation: 0,
        scale: 1,
        variant: 0,
      }),
    );
    const first = clearOfSideRoads(shrubs, [road], clearance);
    expect(test.mock.calls.length).toBe(shrubs.length);
    expect(first).toEqual(clearOfSideRoads(shrubs, [road], UNCACHED_SIDE_ROAD_CLEARANCE));
    // The first ones were let go to hold the last, so they are asked about again.
    test.mockClear();
    expect(clearOfSideRoads(shrubs.slice(0, 100), [road], clearance)).toEqual(
      clearOfSideRoads(shrubs.slice(0, 100), [road], UNCACHED_SIDE_ROAD_CLEARANCE),
    );
    expect(test.mock.calls.length).toBe(100);
  });
  it('answers each heading apart, at the same place with the same footprint', () => {
    const clearance = sideRoadClearance(realOnSideRoad);
    const road = (RIDE[60] as (typeof RIDE)[number]).roads[0] as SideRoad;
    const [ax, az, bx, bz] = road.segments as unknown as [number, number, number, number];
    const length = Math.hypot(bx - ax, bz - az);
    // A long, narrow footprint 2 m off the first segment's edge: it reaches the road
    // when turned towards it and not when turned along it.
    const off = (road.halfWidths[0] as number) + 2;
    const x = (ax + bx) / 2 - ((bz - az) / length) * off;
    const z = (az + bz) / 2 + ((bx - ax) / length) * off;
    const footprint = { x: 0.5, back: 5, front: 5 };
    const headings = Array.from({ length: 16 }, (_, index) => (index * Math.PI) / 8);
    const fresh = headings.map((rotation) =>
      realOnSideRoad([road], { x, z, rotation }, footprint, 0.5),
    );
    // The fixture: the heading changes the answer.
    expect(fresh).toContain(true);
    expect(fresh).toContain(false);
    const cached = headings.map((rotation) =>
      clearance.on([road], { x, z, rotation }, footprint, 0.5),
    );
    expect(cached).toEqual(fresh);
  });

  it('cannot be called without a clearance, so scene.ts cannot fall back to the uncached path unseen', () => {
    // Checked by `tsc`: were the parameter optional again, the directive would be unused and fail.
    // @ts-expect-error a clearance is required
    const noClearance = () => clearOfSideRoads([], []);
    // @ts-expect-error a clearance is required
    const noBoardClearance = () => boardsClearOfSideRoads([], [], BILLBOARD_FOOTPRINT);
    expect(noClearance()).toEqual([]);
    expect(noBoardClearance()).toEqual([]);
  });
});
