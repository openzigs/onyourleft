// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2903: an open-world ride's side streets, drawn as road to the fog, and its
 * buildings kept off every one of them. A synthetic grid of streets — the
 * route ridden north up one of them into a crossroads — is covered by a
 * lattice of square footprints, many of them standing on a street. The
 * footprints are planned through the tile worker's own handler, the streets
 * handed to the scene as the session hands them (`street-corridor.ts`), and
 * everything is read back off what `sceneFrame` built: the side roads it drew
 * and the buildings it was given. Every street and footprint is written here
 * in metres from an arbitrary origin: no OpenStreetMap data.
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
import { describe, expect, it } from 'vitest';

import { onSideRoad, SIDE_ROADS_PER_FRAME, type SideRoad } from '../cross-streets';
import type { FootprintPlan } from '../footprint-buildings';
import { mappedBuildingsOf } from '../mapped-buildings';
import { NEARBY_STREETS_PER_FRAME } from '../nearby-streets';
import { REALISTIC_STRUCTURE_ITEMS } from '../realistic-budget';
import { sceneFrame } from '../scene';
import { atStartLine } from '../simulation';
import { corridorOrigin, localGroundPosition } from '../terrain';
import { PavementBelt, SideRoadBelt } from '../three-renderer';
import { OpenWorldRoad } from './road';
import { openWorldStreetCorridor } from './street-corridor';
import type { TileBlockFeatures } from './tile-plan';
import { tilePlanWorkerCore } from './tile-planner';

const FRAME = { latitude: 40, longitude: -105, elevation: 0 };
const APPROACH_METRES = 1_500;
/** Half a square footprint's side: an 8 m house. */
const HALF = 4;
const flat = (): number => 0;

function edge(id: string, from: string, to: string, stops: [number, number][]): RollingEdge {
  return { id, from, to, points: streetThrough(stops, flat), roadClass: 1 };
}

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

const local = (east: number, north: number) => localGroundPosition(FRAME, placeAt(east, north));

function square(east: number, north: number): BuildingFeature {
  const corners = [
    local(east - HALF, north - HALF),
    local(east + HALF, north - HALF),
    local(east + HALF, north + HALF),
    local(east - HALF, north + HALF),
  ];
  return {
    ...NO_BUILDING_FIELDS,
    kind: 'building',
    rings: [Float32Array.from(corners.flatMap((corner) => [corner.x, corner.z]))],
    heightMetres: null,
    minHeightMetres: null,
  };
}

function street(
  stops: [number, number][],
  kind = 'minor_road',
  kindDetail = 'residential',
): DecodedStreetFeature {
  return {
    ...NO_ROAD_FIELDS,
    kind,
    kindDetail,
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

/** Rows of streets every `rowEvery` m, columns every 200 m, and a lattice of houses every `step` m. */
function grid(rowEvery: number, step: number): TileBlockFeatures {
  const streets: DecodedStreetFeature[] = [
    street([
      [0, -APPROACH_METRES],
      [0, 800],
    ]),
  ];
  for (let north = -300; north <= 300; north += rowEvery) {
    streets.push(
      street([
        [-400, north],
        [400, north],
      ]),
    );
  }
  for (const east of [-200, 200]) {
    streets.push(
      street(
        [
          [east, -400],
          [east, 400],
        ],
        'major_road',
        'primary',
      ),
    );
  }
  const buildings: BuildingFeature[] = [];
  for (let east = -300; east <= 300; east += step) {
    for (let north = -300; north <= 300; north += step) buildings.push(square(east, north));
  }
  const tiles = new Map<string, TileId>();
  for (const [east, north] of [
    [-400, -400],
    [400, -400],
    [-400, 800],
    [400, 800],
    [0, -APPROACH_METRES],
    [0, 0],
  ] as [number, number][]) {
    const tile = tileOf(east, north);
    tiles.set(`${String(tile.x)}/${String(tile.y)}`, tile);
  }
  return {
    buildings,
    landUse: [],
    tiles: [...tiles.values()].map((tile, index) => ({
      tile,
      streets: index === 0 ? streets : [],
    })),
  };
}

/**
 * The buildings planned round the rider, as the worker plans them, from
 * `block` and any `others` held beside it (each held and its tiles planned).
 */
function planned(
  road: OpenWorldRoad,
  block: TileBlockFeatures,
  rider: number,
  others: readonly TileBlockFeatures[] = [],
): FootprintPlan[] {
  const core = tilePlanWorkerCore();
  core.handle({ kind: 'frame', frame: FRAME });
  let id = 0;
  for (const [at, each] of [block, ...others].entries()) {
    const key = `b${String(at)}`;
    core.handle({ kind: 'hold', block: key, features: each });
    for (const { tile } of each.tiles) {
      core.handle({ kind: 'plan', id, block: key, tile, detail: 'full' });
      id += 1;
    }
  }
  const here = local(0, rider - APPROACH_METRES);
  const answer = core.handle({
    kind: 'buildings',
    id: 9,
    request: { profile: road.view.profile, x: here.x, z: here.z },
    detail: 'full',
  });
  if (answer?.reply.kind !== 'buildings') throw new Error('no buildings planned');
  return structuredClone([...answer.reply.plans]);
}

/** The scene's frame for a rider at `rider`, given the streets and the buildings as a ride is. */
function frameAt(
  road: OpenWorldRoad,
  block: TileBlockFeatures | readonly TileBlockFeatures[],
  plans: FootprintPlan[],
  rider: number,
) {
  const profile = road.view.profile;
  const start = atStartLine(profile);
  return sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: { ...start, ride: { ...start.ride, distance: metres(rider) } },
    worldCorridor: openWorldStreetCorridor(FRAME, Array.isArray(block) ? block : [block]),
    mappedBuildings: mappedBuildingsOf(plans),
    structureItems: REALISTIC_STRUCTURE_ITEMS,
  });
}

const RIDER = APPROACH_METRES - 60;

/** Whether a plan's square stands on any of `roads`. */
function onAny(roads: readonly SideRoad[], plan: FootprintPlan): boolean {
  return onSideRoad(
    roads,
    { x: plan.centroid.x, z: plan.centroid.z, rotation: 0 },
    { x: HALF, back: -HALF, front: HALF },
    0,
  );
}

describe('an open-world ride draws its side streets, and keeps its buildings off them — #2903', () => {
  it('draws the grid’s streets as road off the route, a stub at the crossroads among them', () => {
    const road = new OpenWorldRoad(crossroads(), { frame: FRAME });
    const block = grid(150, 30);
    const frame = frameAt(road, block, [], RIDER);
    // Stubs and nearby pieces, both: more than the crossroads' stubs alone.
    expect(frame.sideRoads.length).toBeGreaterThan(4);
    // Control: with no streets handed over, none is drawn.
    const bare = sceneFrame({
      profile: road.view.profile,
      origin: corridorOrigin(road.view.profile),
      state: (() => {
        const start = atStartLine(road.view.profile);
        return { ...start, ride: { ...start.ride, distance: metres(RIDER) } };
      })(),
      structureItems: REALISTIC_STRUCTURE_ITEMS,
    });
    expect(bare.sideRoads).toStrictEqual([]);
  });

  it('plans no footprint that overlaps any street the frame draws', () => {
    const road = new OpenWorldRoad(crossroads(), { frame: FRAME });
    const block = grid(150, 30);
    const plans = planned(road, block, RIDER);
    expect(plans.length).toBeGreaterThan(0);
    const frame = frameAt(road, block, plans, RIDER);
    expect(plans.filter((plan) => onAny(frame.sideRoads, plan))).toStrictEqual([]);
    // Control: the lattice does stand on the streets before it is planned.
    const all = block.buildings.length;
    expect(all).toBeGreaterThan(plans.length);
  });

  it('keeps the footprints off a service road the frame draws, which stops short of the houses', () => {
    const road = new OpenWorldRoad(crossroads(), { frame: FRAME });
    const block = grid(150, 30);
    // A service road through a row of the lattice's houses, beside the
    // rider. It stops short of the route: where a mapped street meets the
    // route, its junction's stub (`cross-streets.ts`) is drawn whatever
    // stands on it, which is not the nearby streets' clearance.
    const service = street(
      [
        [30, 60],
        [300, 60],
      ],
      'minor_road',
      'service',
    );
    const withService: TileBlockFeatures = {
      ...block,
      tiles: block.tiles.map((each, at) =>
        at === 0 ? { ...each, streets: [...each.streets, service] } : each,
      ),
    };
    const plans = planned(road, withService, RIDER);
    const frame = frameAt(road, withService, plans, RIDER);
    // Control: the service road is drawn (pieces of it, between the houses).
    const bare = frameAt(road, block, plans, RIDER);
    expect(frame.sideRoads.length).toBeGreaterThan(bare.sideRoads.length);
    expect(plans.filter((plan) => onAny(frame.sideRoads, plan))).toStrictEqual([]);
  });

  it('keeps the footprints off a street held in a block that owns none of them', () => {
    const road = new OpenWorldRoad(crossroads(), { frame: FRAME });
    const block = grid(150, 30);
    // The footprints' block carries no street; the streets are another
    // block's, which owns no footprint near the rider.
    const houses: TileBlockFeatures = {
      ...block,
      tiles: block.tiles.map((each) => ({ ...each, streets: [] })),
    };
    const far = tileOf(0, 3_000);
    const streets: TileBlockFeatures = {
      buildings: [],
      landUse: [],
      tiles: [{ tile: far, streets: block.tiles[0]?.streets ?? [] }],
    };
    const plans = planned(road, houses, RIDER, [streets]);
    expect(plans.length).toBeGreaterThan(0);
    const frame = frameAt(road, [houses, streets], plans, RIDER);
    expect(frame.sideRoads.length).toBeGreaterThan(4);
    expect(plans.filter((plan) => onAny(frame.sideRoads, plan))).toStrictEqual([]);
  });

  it('reports what a dense block loses to the streets, and holds it under 40 %', () => {
    const road = new OpenWorldRoad(crossroads(), { frame: FRAME });
    // A dense block: streets every 75 m, a house every 15 m.
    const block = grid(75, 15);
    const here = local(0, RIDER - APPROACH_METRES);
    const near = block.buildings.filter((building) => {
      const ring = building.rings[0] as Float32Array;
      const x = ((ring[0] as number) + (ring[4] as number)) / 2;
      const z = ((ring[1] as number) + (ring[5] as number)) / 2;
      return Math.hypot(x - here.x, z - here.z) <= 600;
    }).length;
    const kept = planned(road, block, RIDER).length;
    const lost = (near - kept) / near;
    // Stated in the PR: the share this fixture loses, against the threshold
    // proposed there. A loss over it is said rather than shipped silently.
    // 512 since #3055's ride-keyed plots (merged in from main): an open-world
    // view's terraced block is a whole plot or none, so three fewer
    // footprints give way to a terrace than #2903 measured (515).
    expect({ lost: near - kept, of: near }).toStrictEqual({ lost: 512, of: 1_681 });
    expect(lost).toBeLessThan(0.4);
  });

  it('adds one draw call for every side street, however many streets there are', () => {
    const road = new OpenWorldRoad(crossroads(), { frame: FRAME });
    const sparse = frameAt(road, grid(300, 300), [], RIDER);
    const dense = frameAt(road, grid(25, 300), [], RIDER);
    expect(dense.sideRoads.length).toBeGreaterThan(sparse.sideRoads.length);
    expect(dense.sideRoads.length).toBeLessThanOrEqual(
      SIDE_ROADS_PER_FRAME + NEARBY_STREETS_PER_FRAME,
    );
    for (const frame of [sparse, dense]) {
      const added: { geometry: { groups: unknown[] }; material: unknown }[] = [];
      const belt = new SideRoadBelt(new PavementBelt('stylised').mesh.material as never);
      belt.addTo({ add: (object: never) => added.push(object) } as never);
      belt.update(frame.sideRoads);
      expect(added).toHaveLength(1);
      expect(Array.isArray(added[0]?.material)).toBe(false);
      expect(added[0]?.geometry.groups.length).toBeLessThanOrEqual(1);
    }
  });
});
