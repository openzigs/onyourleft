// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3131: an open-world city street is dressed as a city's — a pavement from
 * the kerb to the building line, and no hedge, fence or field wall along it —
 * and a street with no building keeps the countryside's dressing.
 *
 * The owner's tablet ride of 2026-11-24 saw a street of four- to six-storey
 * buildings with a grass verge, hedges and a rail fence. The fixture is a
 * straight street lined both sides, wall to wall, with six-storey blocks
 * fronting the back of a city's pavement. Its footprints are held and planned
 * through the tile worker's own handler (`tile-planner.ts`
 * §`tilePlanWorkerCore`), handed to the road as a session hands them, and the
 * frame is built by `sceneFrame` from the input `GameView` hands it for an
 * open-world ride. Everything is written here in metres from an arbitrary
 * origin: no OpenStreetMap data, and nothing here is a real place.
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

import { mappedBuildingsOf, type MappedBuildings } from '../mapped-buildings';
import type { SceneFrame } from '../port';
import { REALISTIC_STRUCTURE_ITEMS } from '../realistic-budget';
import { nearestOnDrawnRoad } from '../road-grid';
import { sceneFrame } from '../scene';
import { sceneryAnchor } from '../scenery-anchor';
import { BOUNDARY_KINDS } from '../settlements';
import { atStartLine } from '../simulation';
import { CITY_PAVEMENT_WIDTH_METRES, KERB_LATERAL_METRES } from '../streets';
import { corridorOrigin, localGroundPosition } from '../terrain';
import { OpenWorldRoad } from './road';
import { openWorldStreetCorridor } from './street-corridor';
import type { TileBlockFeatures } from './tile-plan';
import { tilePlanWorkerCore } from './tile-planner';
import { openWorldUrbanClass } from './urban-stretch';

/** The ride's frame: the synthetic origin, as a session's start is. */
const FRAME = { latitude: 40, longitude: -105, elevation: 0 };
/** How far south of the origin the street starts, and north of it it ends. */
const HALF_STREET_METRES = 1_500;
/** Where the city stands along the street, metres north of the origin. */
const CITY_FROM = -700;
const CITY_TO = 700;
/** The building line: the back of a city's pavement, out from the road's middle. */
const BUILDING_LINE_METRES = KERB_LATERAL_METRES + CITY_PAVEMENT_WIDTH_METRES;
const flat = (): number => 0;

function straightStreet(): RollingRoute {
  const start: RollingEdge = {
    id: 's',
    from: 'south',
    to: 'north',
    points: streetThrough(
      [
        [0, -HALF_STREET_METRES],
        [0, HALF_STREET_METRES],
      ],
      flat,
    ),
    roadClass: 1,
  };
  return new RollingRoute(graphOf([start]), start);
}

function local(east: number, north: number): { readonly x: number; readonly z: number } {
  return localGroundPosition(FRAME, placeAt(east, north));
}

function block(west: number, south: number, east: number, north: number): BuildingFeature {
  const corners = [local(west, south), local(east, south), local(east, north), local(west, north)];
  return {
    ...NO_BUILDING_FIELDS,
    kind: 'building',
    rings: [Float32Array.from(corners.flatMap((corner) => [corner.x, corner.z]))],
    // Six storeys, mapped.
    heightMetres: 20,
    minHeightMetres: null,
  };
}

/** How deep a block is, and the lane behind the front row: metres. */
const BLOCK_DEPTH = 16;
const BACK_LANE = 4;

/**
 * A city centre: 12 m blocks, 16 m deep, wall to wall both sides, the front row
 * fronting the building line and a second row behind a back lane.
 */
function city(): BuildingFeature[] {
  const blocks: BuildingFeature[] = [];
  for (let north = CITY_FROM; north < CITY_TO; north += 12) {
    for (const from of [BUILDING_LINE_METRES, BUILDING_LINE_METRES + BLOCK_DEPTH + BACK_LANE]) {
      blocks.push(
        block(from, north, from + BLOCK_DEPTH, north + 12),
        block(-from - BLOCK_DEPTH, north, -from, north + 12),
      );
    }
  }
  return blocks;
}

function street(): DecodedStreetFeature {
  const ends = [local(0, -HALF_STREET_METRES), local(0, HALF_STREET_METRES)];
  return {
    ...NO_ROAD_FIELDS,
    kind: 'minor_road',
    kindDetail: 'residential',
    grade: 'ground',
    line: Float32Array.from(ends.flatMap((end) => [end.x, end.z])),
  };
}

function tileOf(east: number, north: number): TileId {
  const at = placeAt(east, north);
  return {
    z: 15,
    x: Math.floor(columnAtLongitude(at.longitude)),
    y: Math.floor(rowAtLatitude(at.latitude)),
  };
}

function heldBlock(buildings: readonly BuildingFeature[]): TileBlockFeatures {
  const tiles = new Map<string, TileId>();
  for (let north = -HALF_STREET_METRES; north <= HALF_STREET_METRES; north += 100) {
    for (const east of [-200, 0, 200]) {
      const tile = tileOf(east, north);
      tiles.set(`${String(tile.x)}/${String(tile.y)}`, tile);
    }
  }
  return {
    buildings,
    landUse: [],
    tiles: [...tiles.values()].map((tile, index) => ({
      tile,
      streets: index === 0 ? [street()] : [],
    })),
  };
}

/** The frame a rider `rider` metres along the street is drawn, among `buildings`. */
function ridden(
  buildings: readonly BuildingFeature[],
  rider: number,
): { readonly frame: SceneFrame; readonly road: OpenWorldRoad; readonly planned: MappedBuildings } {
  const features = heldBlock(buildings);
  const streets = openWorldStreetCorridor(FRAME, [features]);
  const core = tilePlanWorkerCore();
  core.handle({ kind: 'frame', frame: FRAME });
  core.handle({ kind: 'hold', block: 'b', features });
  for (const [id, { tile }] of features.tiles.entries()) {
    core.handle({ kind: 'plan', id, block: 'b', tile, detail: 'full' });
  }
  let planned: MappedBuildings = mappedBuildingsOf([]);
  const road = new OpenWorldRoad(straightStreet(), {
    frame: FRAME,
    streets: () => streets,
    buildings: () => planned,
  });
  // Ridden up to `rider`, so the view reaches past them as a ride's does.
  for (let at = 0; at <= rider; at += 25) road.follow(at);
  const profile = road.view.profile;
  const here = local(0, rider - HALF_STREET_METRES);
  const anchor = sceneryAnchor(profile);
  const answer = core.handle({
    kind: 'buildings',
    id: 1,
    // As the session asks: with what the road keyed the view on (#3094).
    request: {
      profile,
      x: here.x,
      z: here.z,
      ...(anchor === undefined ? {} : { scenery: { seed: anchor.seed, origin: anchor.origin } }),
    },
    detail: 'full',
  });
  if (answer?.reply.kind !== 'buildings') throw new Error('no buildings planned');
  planned = mappedBuildingsOf(structuredClone(answer.reply.plans));
  const start = atStartLine(profile);
  const town = road.town();
  const frame = sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: { ...start, ride: { ...start.ride, distance: metres(rider) } },
    structureItems: REALISTIC_STRUCTURE_ITEMS,
    // As `GameView` hands an open-world ride's frame its world.
    mappedBuildings: planned,
    worldCorridor: streets,
    ...(town === undefined ? {} : { mappedTown: town }),
  });
  return { frame, road, planned };
}

/** Where the rider is in the city: half way along it. */
const IN_THE_CITY = HALF_STREET_METRES;

/** Out from the road's middle, and along it, of a point of the frame. */
function besideRoad(
  road: OpenWorldRoad,
  x: number,
  z: number,
): { readonly lateral: number; readonly along: number } | undefined {
  const profile = road.view.profile;
  const near = nearestOnDrawnRoad(profile, corridorOrigin(profile), x, z, 60);
  return near === undefined ? undefined : { lateral: near.distance, along: near.along };
}

/** Whether `along` on `road`'s view is inside the city, 100 m clear of either end. */
function inCity(road: OpenWorldRoad, along: number): boolean {
  const ride = along + road.view.origin;
  return ride > HALF_STREET_METRES + CITY_FROM + 100 && ride < HALF_STREET_METRES + CITY_TO - 100;
}

/** The field boundaries between the road and the building line, in the city. */
function boundariesOnTheVerge(frame: SceneFrame, road: OpenWorldRoad) {
  return frame.scatter.filter((item) => {
    if (!BOUNDARY_KINDS.has(item.kind as never)) return false;
    const at = besideRoad(road, item.x, item.z);
    return at !== undefined && at.lateral <= BUILDING_LINE_METRES + 1 && inCity(road, at.along);
  });
}

/** How much of the ground from the kerb to the building line a pavement's top covers, both sides. */
function pavedShare(frame: SceneFrame): number {
  // Every pavement top's triangles, flattened.
  const triangles: number[][] = [];
  for (const each of frame.streets) {
    const { positions, normals, indices } = each.pavement;
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const corners = [indices[at], indices[at + 1], indices[at + 2]] as number[];
      if (!corners.every((vertex) => (normals[vertex * 3 + 1] as number) > 0.999)) continue;
      triangles.push(
        corners.flatMap((vertex) => [
          positions[vertex * 3] as number,
          positions[vertex * 3 + 2] as number,
        ]),
      );
    }
  }
  const inside = (t: number[], x: number, z: number): boolean => {
    const [ax, az, bx, bz, cx, cz] = t as [number, number, number, number, number, number];
    const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz);
    const d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz);
    const d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  let samples = 0;
  let paved = 0;
  // Along the 200 m ahead of the rider, every 5 m, at five points across the verge each side.
  for (let north = 10; north <= 200; north += 5) {
    for (const side of [1, -1]) {
      for (let step = 0; step < 5; step += 1) {
        const lateral = KERB_LATERAL_METRES + 0.3 + (step * (CITY_PAVEMENT_WIDTH_METRES - 0.6)) / 4;
        const at = local(side * lateral, IN_THE_CITY - HALF_STREET_METRES + north);
        samples += 1;
        if (triangles.some((t) => inside(t, at.x, at.z))) paved += 1;
      }
    }
  }
  return paved / samples;
}

describe('an open-world city street is dressed as a city’s — #3131', () => {
  it('classes the street a city centre where its blocks stand, and nothing where none does', () => {
    const { road, planned } = ridden(city(), IN_THE_CITY);
    const urban = openWorldUrbanClass(road.view.profile, planned);
    const onView = (ride: number): number => ride - road.view.origin;
    expect(urban.classAt(onView(IN_THE_CITY))).toBe('city-centre');
    // Far past the city's end no block is planned: today's world.
    expect(urban.classAt(onView(IN_THE_CITY + 1_200))).toBe('unknown');
  });

  it('lays a pavement from the kerb to the building line, and no hedge, fence or wall along it', () => {
    const { frame, road } = ridden(city(), IN_THE_CITY);
    expect(boundariesOnTheVerge(frame, road)).toStrictEqual([]);
    expect(pavedShare(frame)).toBeGreaterThan(0.95);
  });

  it('control: the same street with no building keeps the countryside’s dressing', () => {
    const { frame, road } = ridden([], IN_THE_CITY);
    expect(road.town()).toBeUndefined();
    expect(boundariesOnTheVerge(frame, road).length).toBeGreaterThan(0);
    expect(pavedShare(frame)).toBeLessThan(0.05);
  });
});
