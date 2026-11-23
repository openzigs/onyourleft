// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2902: an open-world ride's mapped-building belt, filled from its tiles'
 * plans. A synthetic crossroads — a street ridden north into a junction whose
 * default is straight on, and an arm east that the route does not take — is
 * lined with more footprints than the belt may draw. The footprints are held
 * and planned through the tile worker's own handler (`tile-planner.ts`
 * §`tilePlanWorkerCore`), the buildings round the rider planned there against
 * the view, indexed as the planner indexes them, and read back the way a ride
 * reads them: `sceneFrame` builds the frame from the input `GameView` hands it
 * and `refillMappedBuildings` refills the real belt. Every footprint is written
 * here in metres from an arbitrary origin: no OpenStreetMap data.
 */

import { metres, RollingRoute, type RollingEdge } from '@onyourleft/domain';
import { graphOf, placeAt, streetThrough } from '@onyourleft/domain/rolling-testing';
import {
  columnAtLongitude,
  NO_BUILDING_FIELDS,
  NO_ROAD_FIELDS,
  rowAtLatitude,
  type BuildingFeature,
  type DecodedStreetFeature,
  type TileId,
} from '@onyourleft/map-features';
import { afterEach, describe, expect, it } from 'vitest';

import type { FootprintPlan } from '../footprint-buildings';
import { mappedBuildingsOf, type MappedBuildings } from '../mapped-buildings';
import { PHOTOGRAPHIC_STRUCTURE_SURFACES } from '../realistic-assets';
import {
  MAPPED_BUILDING_DRAW_CALLS,
  MAPPED_BUILDING_MAX,
  MAPPED_BUILDING_TRIANGLES,
  REALISTIC_STRUCTURE_ITEMS,
} from '../realistic-budget';
import { sceneFrame } from '../scene';
import { sceneryAnchor } from '../scenery-anchor';
import { atStartLine } from '../simulation';
import { corridorOrigin, localGroundPosition } from '../terrain';
import { MappedBuildingBelt, refillMappedBuildings } from '../three-renderer';
import { OpenWorldRoad } from './road';
import { openWorldStreetCorridor } from './street-corridor';
import { REDUCED_BUILDINGS_MOST, type BuildingsRequest } from './tile-buildings';
import type { TileBlockFeatures } from './tile-plan';
import { tilePlanWorkerCore } from './tile-planner';

function aTexture(): never {
  return { image: { width: 512, height: 512 }, dispose: () => undefined } as never;
}

const TEXTURES = new Map(
  PHOTOGRAPHIC_STRUCTURE_SURFACES.map((surface) => [
    surface,
    { colour: aTexture(), normal: aTexture() },
  ]),
);

const belts: MappedBuildingBelt[] = [];
afterEach(() => {
  for (const belt of belts.splice(0)) belt.dispose();
});

/** The ride's frame: the synthetic origin, as a session's start is. */
const FRAME = { latitude: 40, longitude: -105, elevation: 0 };
const APPROACH_METRES = 1_500;
/** How far from its street a house's middle stands: the main street's, and the east arm's. */
const MAIN_SET_BACK = 18;
const ARM_SET_BACK = 12;
const flat = (): number => 0;

function edge(id: string, from: string, to: string, stops: [number, number][]): RollingEdge {
  return { id, from, to, points: streetThrough(stops, flat), roadClass: 1 };
}

/** A crossroads at the origin, ridden north into from 1.5 km south. */
function crossroads(): RollingRoute {
  const start = edge('s', 'start', 'j', [
    [0, -APPROACH_METRES],
    [0, 0],
  ]);
  return new RollingRoute(
    graphOf([
      start,
      edge('n', 'j', 'north', [
        [0, 0],
        [0, 800],
      ]),
      edge('e', 'j', 'east', [
        [0, 0],
        [800, 0],
      ]),
      edge('w', 'j', 'west', [
        [0, 0],
        [-800, 0],
      ]),
    ]),
    start,
  );
}

/** A point `east`, `north` of the synthetic origin in the ride's frame. */
function local(east: number, north: number): { readonly x: number; readonly z: number } {
  return localGroundPosition(FRAME, placeAt(east, north));
}

/** A 10 m × 8 m house with its middle at `east`, `north`. */
function house(east: number, north: number): BuildingFeature {
  const corners = [
    local(east - 5, north - 4),
    local(east + 5, north - 4),
    local(east + 5, north + 4),
    local(east - 5, north + 4),
  ];
  return {
    ...NO_BUILDING_FIELDS,
    kind: 'building',
    rings: [Float32Array.from(corners.flatMap((corner) => [corner.x, corner.z]))],
    heightMetres: null,
    minHeightMetres: null,
  };
}

function street(stops: [number, number][]): DecodedStreetFeature {
  return {
    ...NO_ROAD_FIELDS,
    kind: 'minor_road',
    kindDetail: 'residential',
    grade: 'ground',
    line: Float32Array.from(stops.flatMap(([e, n]) => [local(e, n).x, local(e, n).z])),
  };
}

const tileOf = (east: number, north: number): TileId => {
  const at = placeAt(east, north);
  return {
    z: 15,
    x: Math.floor(columnAtLongitude(at.longitude)),
    y: Math.floor(rowAtLatitude(at.latitude)),
  };
};

/** The dense fixture: houses both sides of the main street, and along the east arm. */
function denseBlock(): { block: TileBlockFeatures; mainCount: number; armCount: number } {
  const buildings: BuildingFeature[] = [];
  const centres: [number, number][] = [];
  for (let north = -400; north <= 400; north += 12) {
    for (const side of [-MAIN_SET_BACK, MAIN_SET_BACK]) centres.push([side, north]);
  }
  const mainCount = centres.length;
  for (let east = 40; east <= 200; east += 12) {
    for (const side of [-ARM_SET_BACK, ARM_SET_BACK]) centres.push([east, side]);
  }
  for (const [east, north] of centres) buildings.push(house(east, north));
  const tiles = new Map<string, TileId>();
  for (const [east, north] of [...centres, [0, -APPROACH_METRES] as [number, number]]) {
    const tile = tileOf(east, north);
    tiles.set(`${String(tile.x)}/${String(tile.y)}`, tile);
  }
  const streets = [
    street([
      [0, -APPROACH_METRES],
      [0, 800],
    ]),
    street([
      [-800, 0],
      [800, 0],
    ]),
  ];
  return {
    block: {
      buildings,
      landUse: [],
      tiles: [...tiles.values()].map((tile, index) => ({
        tile,
        streets: index === 0 ? streets : [],
      })),
    },
    mainCount,
    armCount: centres.length - mainCount,
  };
}

/** The plans round the rider, as the worker plans them and the planner indexes them. */
function plannedRound(road: OpenWorldRoad, rider: number): MappedBuildings {
  const { block } = denseBlock();
  const core = tilePlanWorkerCore();
  core.handle({ kind: 'frame', frame: FRAME });
  core.handle({ kind: 'hold', block: 'b', features: block });
  for (const [id, { tile }] of block.tiles.entries()) {
    expect(core.handle({ kind: 'plan', id, block: 'b', tile, detail: 'full' })?.reply.kind).toBe(
      'plan',
    );
  }
  const profile = road.view.profile;
  const here = local(0, rider - APPROACH_METRES);
  const answer = core.handle({
    kind: 'buildings',
    id: 99,
    request: { profile, x: here.x, z: here.z },
    detail: 'full',
  });
  if (answer?.reply.kind !== 'buildings') throw new Error('no buildings planned');
  return mappedBuildingsOf(structuredClone(answer.reply.plans));
}

/** What the belt draws for a rider at ride distance `rider`, with the road's branches or not. */
function drawnAt(
  road: OpenWorldRoad,
  buildings: MappedBuildings,
  rider: number,
  withBranches = true,
) {
  const profile = road.view.profile;
  const start = atStartLine(profile);
  const input = {
    profile,
    origin: corridorOrigin(profile),
    state: { ...start, ride: { ...start.ride, distance: metres(rider) } },
    mappedBuildings: buildings,
    mappedBranches: withBranches ? road.branchesAhead(rider) : undefined,
    structureItems: REALISTIC_STRUCTURE_ITEMS,
  };
  const frame = sceneFrame(input);
  const view = frame.mappedBuildings;
  if (view === undefined) throw new Error('no mapped buildings in the frame');
  const belt = new MappedBuildingBelt(buildings, TEXTURES);
  belts.push(belt);
  belt.setShown(true);
  belt.switchOn(true);
  belt.setCarried(true);
  refillMappedBuildings(
    belt,
    view,
    frame.scatter,
    frame.billboards.length,
    REALISTIC_STRUCTURE_ITEMS,
  );
  return { belt, drawn: belt.drawnPlans() };
}

/** Whether a plan stands on the east arm: its middle east of the junction, off the main street. */
function onEastArm(buildings: MappedBuildings, index: number): boolean {
  const plan = buildings.plans[index];
  if (plan === undefined) return false;
  const at = local(30, 0);
  // x is metres WEST: the arm is where x is below the junction's by 30 m or more.
  return plan.centroid.x <= at.x;
}

describe('an open-world ride fills its belt from its tiles — #2902', () => {
  it('control: the frame is the ride’s, and more footprints are planned than the belt may draw', () => {
    const road = new OpenWorldRoad(crossroads(), { frame: FRAME });
    expect(corridorOrigin(road.view.profile)).toBe(FRAME);
    const { mainCount, armCount } = denseBlock();
    const buildings = plannedRound(road, APPROACH_METRES - 60);
    expect(mainCount + armCount).toBeGreaterThan(MAPPED_BUILDING_MAX * 3);
    expect(buildings.plans.length).toBeGreaterThan(MAPPED_BUILDING_MAX);
    expect(buildings.plans.some((_, index) => onEastArm(buildings, index))).toBe(true);
  });

  it('never draws more than the cap or the triangles, in no more than six draw calls', () => {
    const road = new OpenWorldRoad(crossroads(), { frame: FRAME });
    let most = 0;
    for (let rider = APPROACH_METRES - 400; rider <= APPROACH_METRES + 300; rider += 50) {
      const buildings = plannedRound(road, rider);
      const { belt } = drawnAt(road, buildings, rider);
      const stats = belt.stats;
      most = Math.max(most, stats.buildings);
      expect(stats.buildings).toBeLessThanOrEqual(MAPPED_BUILDING_MAX);
      expect(stats.triangles).toBeLessThanOrEqual(MAPPED_BUILDING_TRIANGLES);
      expect(stats.drawCalls).toBeLessThanOrEqual(MAPPED_BUILDING_DRAW_CALLS);
      expect(belt.mesh.geometry.groups.length).toBeLessThanOrEqual(MAPPED_BUILDING_DRAW_CALLS);
    }
    // Control: the cap is what binds, not a town too small to reach it.
    expect(most).toBe(MAPPED_BUILDING_MAX);
  });

  it('holds the east arm’s buildings 60 m before the junction, though the route goes straight on', () => {
    const road = new OpenWorldRoad(crossroads(), { frame: FRAME });
    const rider = APPROACH_METRES - 60;
    expect(road.route.nextJunctionAfter(rider)?.taken).toBe('n');
    const buildings = plannedRound(road, rider);
    const { drawn } = drawnAt(road, buildings, rider);
    const onArm = drawn.filter((index) => onEastArm(buildings, index));
    expect(onArm.length).toBeGreaterThan(0);
    // Control: ranked by the road ahead alone, the main street's fill the belt.
    const alone = drawnAt(road, buildings, rider, false).drawn;
    expect(alone.filter((index) => onEastArm(buildings, index))).toStrictEqual([]);
  });

  it('ranks by no branch while the next junction is past the ranked reach', () => {
    const road = new OpenWorldRoad(crossroads(), { frame: FRAME });
    expect(road.branchesAhead(APPROACH_METRES - 400)).toBeUndefined();
    const near = road.branchesAhead(APPROACH_METRES - 60);
    expect(near).toBeDefined();
    // The east and west arms; never the way north the route takes.
    const zs = Array.from(near ?? []).filter((_, at) => at % 2 === 1 && !Number.isNaN(_));
    expect(zs.length).toBeGreaterThan(0);
    expect(Math.max(...zs)).toBeLessThan(local(0, 5).z);
    // The same array while the view and the junction stay.
    expect(road.branchesAhead(APPROACH_METRES - 50)).toBe(near);
  });

  it('plans at most the nearest few on the page’s fallback', () => {
    const road = new OpenWorldRoad(crossroads(), { frame: FRAME });
    const { block } = denseBlock();
    const core = tilePlanWorkerCore();
    core.handle({ kind: 'frame', frame: FRAME });
    core.handle({ kind: 'hold', block: 'b', features: block });
    const owned = block.tiles.map(({ tile }, id) => {
      core.handle({ kind: 'plan', id, block: 'b', tile, detail: 'reduced' });
      return tile;
    });
    expect(owned.length).toBeGreaterThan(0);
    const here = local(0, -60);
    const full = core.handle({
      kind: 'buildings',
      id: 1,
      request: { profile: road.view.profile, x: here.x, z: here.z },
      detail: 'full',
    });
    const reduced = core.handle({
      kind: 'buildings',
      id: 2,
      request: { profile: road.view.profile, x: here.x, z: here.z },
      detail: 'reduced',
    });
    if (full?.reply.kind !== 'buildings' || reduced?.reply.kind !== 'buildings') {
      throw new Error('no buildings');
    }
    expect(full.reply.plans.length).toBeGreaterThan(REDUCED_BUILDINGS_MOST);
    expect(reduced.reply.plans.length).toBeLessThanOrEqual(REDUCED_BUILDINGS_MOST);
    expect(reduced.reply.plans.length).toBeGreaterThan(0);
  });
});

describe('a worker plans the buildings on the ground the scene draws — #3094', () => {
  /** The plans round a rider 60 m short of the junction, against `request`'s view, by a fresh handler. */
  const plansFor = (request: Omit<BuildingsRequest, 'x' | 'z'>): readonly FootprintPlan[] => {
    const { block } = denseBlock();
    const core = tilePlanWorkerCore();
    core.handle({ kind: 'frame', frame: FRAME });
    core.handle({ kind: 'hold', block: 'b', features: block });
    for (const [id, { tile }] of block.tiles.entries()) {
      core.handle({ kind: 'plan', id, block: 'b', tile, detail: 'full' });
    }
    const here = local(0, -60);
    const answer = core.handle({
      kind: 'buildings',
      id: 7,
      request: { ...request, x: here.x, z: here.z },
      detail: 'full',
    });
    if (answer?.reply.kind !== 'buildings') throw new Error('no buildings planned');
    return answer.reply.plans;
  };
  /** Each plan's foot, by where it stands. */
  const feet = (plans: readonly FootprintPlan[]): Map<string, number> =>
    new Map(
      plans.map((plan) => [
        `${plan.centroid.x.toFixed(2)},${plan.centroid.z.toFixed(2)}`,
        plan.base,
      ]),
    );

  it('keys its copy of the view as the road keyed the view, and stands every plan where the page would', () => {
    // The road as a session makes it: in the ride's frame, levelled beside the held streets.
    const { block } = denseBlock();
    const streets = openWorldStreetCorridor(FRAME, [block]);
    const road = new OpenWorldRoad(crossroads(), { frame: FRAME, streets: () => streets });
    const view = road.view.profile;
    const anchor = sceneryAnchor(view);
    if (anchor === undefined) throw new Error('the road keyed no view');
    const scenery = { seed: anchor.seed, origin: anchor.origin };
    // On the page: the road's own view. In a worker: a copy nobody keyed.
    const page = feet(plansFor({ profile: view, scenery }));
    const copy = structuredClone(view);
    expect(sceneryAnchor(copy)).toBeUndefined();
    const worker = feet(plansFor({ profile: copy, scenery }));
    expect(page.size).toBeGreaterThan(50);
    expect([...worker.keys()].sort()).toStrictEqual([...page.keys()].sort());
    for (const [at, base] of page) expect(worker.get(at), at).toBeCloseTo(base, 6);
    // The control: a copy handed over without what the road keyed it on
    // stands its plans on another ground.
    const unkeyed = feet(plansFor({ profile: structuredClone(view) }));
    const apart = [...page].map(([at, base]) => Math.abs((unkeyed.get(at) ?? base) - base));
    expect(Math.max(...apart)).toBeGreaterThan(0.05);
  });
});
