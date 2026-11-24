// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3132: no two building faces in an open-world frame fight for one depth.
 *
 * The owner's tablet ride of 2026-11-24 saw a city building's side wall
 * flicker in stripes and patches between its facade and a lighter colour —
 * two faces on one plane, both drawn (z-fighting). Each fixture below is held
 * and planned through the tile worker's own handler (`tile-planner.ts`
 * §`tilePlanWorkerCore`), the frame built by `sceneFrame` from the input
 * `GameView` hands it, and the plans the real belt draws read back with
 * `refillMappedBuildings`; `coplanar-faces-testing.ts` then looks for two
 * same-facing faces of different buildings on one plane, within 1 cm, that
 * overlap. Every footprint is written here in metres from an arbitrary
 * origin: no OpenStreetMap data, and nothing here is a real place.
 *
 * What the issue asked to be read from the frame, and what each was:
 *
 * - **two footprints sharing a wall**: flat roofs of one height drew their
 *   parapets on the shared plane, the one's inside face where the other's
 *   outside face is. An open-world ride has no urban class, so
 *   `footprint-buildings.ts` §`partyWallsOf` found no party wall there;
 * - **one footprint drawn twice**: a building whole in one tile and clipped
 *   at the next tile's buffer, each copy owned by the tile its centroid is
 *   in — every wall twice;
 * - **a building mapped in parts**: its outline and its parts, wall on wall;
 * - **a mapped building and an inferred one on one plot**: an open-world
 *   ride has no land class, so a procedural village was sited on a mapped
 *   town and its houses stood on the mapped buildings' plots.
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

import { isBuiltKind } from '../buildings';
import { coplanarFaces } from '../coplanar-faces-testing';
import { mappedBuildingsOf, onMappedGround, type MappedBuildings } from '../mapped-buildings';
import { PHOTOGRAPHIC_STRUCTURE_SURFACES } from '../realistic-assets';
import { REALISTIC_STRUCTURE_ITEMS } from '../realistic-budget';
import { sceneFrame } from '../scene';
import { atStartLine } from '../simulation';
import { corridorOrigin, localGroundPosition } from '../terrain';
import { MappedBuildingBelt, refillMappedBuildings } from '../three-renderer';
import { OpenWorldRoad } from './road';
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
/** How far south of the origin the street starts, and north of it it ends. */
const HALF_STREET_METRES = 1_500;
const flat = (): number => 0;

/** One straight street, ridden north from 1.5 km south of the origin to 1.5 km north of it. */
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

/** A footprint from `west` to `east` and `south` to `north`, metres from the origin. */
function block(
  west: number,
  south: number,
  east: number,
  north: number,
  heightMetres: number | null,
  kind: BuildingFeature['kind'] = 'building',
): BuildingFeature {
  const corners = [local(west, south), local(east, south), local(east, north), local(west, north)];
  return {
    ...NO_BUILDING_FIELDS,
    kind,
    rings: [Float32Array.from(corners.flatMap((corner) => [corner.x, corner.z]))],
    heightMetres,
    minHeightMetres: null,
  };
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

/** The tiles along the street, its block holding `buildings`. */
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

/**
 * A rider `rider` metres along the street among `buildings`: the plans the
 * worker planned round them, the frame, and the plans the belt draws.
 */
function ridden(buildings: readonly BuildingFeature[], rider: number) {
  const features = heldBlock(buildings);
  const road = new OpenWorldRoad(straightStreet(), { frame: FRAME });
  const core = tilePlanWorkerCore();
  core.handle({ kind: 'frame', frame: FRAME });
  core.handle({ kind: 'hold', block: 'b', features });
  for (const [id, { tile }] of features.tiles.entries()) {
    core.handle({ kind: 'plan', id, block: 'b', tile, detail: 'full' });
  }
  const profile = road.view.profile;
  const here = local(0, rider - HALF_STREET_METRES);
  const answer = core.handle({
    kind: 'buildings',
    id: 1,
    request: { profile, x: here.x, z: here.z },
    detail: 'full',
  });
  if (answer?.reply.kind !== 'buildings') throw new Error('no buildings planned');
  const mapped: MappedBuildings = mappedBuildingsOf(structuredClone(answer.reply.plans));
  const start = atStartLine(profile);
  const input = {
    profile,
    origin: corridorOrigin(profile),
    state: { ...start, ride: { ...start.ride, distance: metres(rider) } },
    structureItems: REALISTIC_STRUCTURE_ITEMS,
  };
  const frame = sceneFrame({ ...input, mappedBuildings: mapped });
  const view = frame.mappedBuildings;
  if (view === undefined) throw new Error('no mapped buildings in the frame');
  const belt = new MappedBuildingBelt(mapped, TEXTURES);
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
  return { mapped, frame, drawn: belt.drawnPlans(), unmapped: () => sceneFrame(input) };
}

/** Where the rider stands in the one-building fixtures: 40 m short of the origin. */
const NEAR_THE_ORIGIN = HALF_STREET_METRES - 40;

describe('no two building faces in an open-world frame are on one plane — #3132', () => {
  it('two footprints sharing a wall, of one height and of two, each draw it once', () => {
    for (const [south, north] of [
      [14, 14],
      [14, 8],
      [null, null],
    ] as const) {
      const { mapped, drawn } = ridden(
        [block(10, 0, 22, 15, south), block(10, 15, 22, 30, north)],
        NEAR_THE_ORIGIN,
      );
      // Control: both are drawn.
      expect(drawn.length, `${String(south)}/${String(north)}`).toBe(2);
      expect(coplanarFaces(mapped.plans, drawn), `${String(south)}/${String(north)}`).toStrictEqual(
        [],
      );
    }
  });

  it('two footprints a gap apart keep every wall: only a flush wall is shared', () => {
    const { mapped, drawn } = ridden(
      [block(10, 0, 22, 15, 14), block(10, 15.3, 22, 30, 14)],
      NEAR_THE_ORIGIN,
    );
    expect(drawn.length).toBe(2);
    // Each draws the wall facing the gap: as many wall triangles as a lone building's.
    const lone = ridden([block(10, 0, 22, 15, 14)], NEAR_THE_ORIGIN).mapped.plans[0];
    const walls = mapped.plans.map((plan) => plan.triangles.wall.length);
    expect(walls[0]).toBe(lone?.triangles.wall.length);
  });

  it('draws a building two tiles carry once: whole in one, clipped at the other’s buffer', () => {
    // Clipped 25 m in: its centroid more than a metre off the whole one's, and
    // its area under 80 % of it, so the tiles' own check keeps both.
    const whole = block(10, 0, 30, 40, 14);
    const clipped = block(10, 0, 30, 25, 14);
    const { mapped, drawn } = ridden([whole, clipped], NEAR_THE_ORIGIN);
    expect(mapped.plans.length).toBe(1);
    expect(drawn.length).toBe(1);
    // The whole one is the one kept.
    expect(Math.abs(Math.abs(signedAreaOf(mapped.plans[0]?.footprint)) - 800)).toBeLessThan(5);
    expect(coplanarFaces(mapped.plans, drawn)).toStrictEqual([]);
  });

  it('draws a building mapped in parts by its parts, not by its outline too', () => {
    const outline = block(10, 0, 30, 20, 14);
    const parts = [
      block(10, 0, 30, 10, 14, 'building_part'),
      block(10, 10, 30, 20, 8, 'building_part'),
    ];
    const { mapped, drawn } = ridden([outline, ...parts], NEAR_THE_ORIGIN);
    expect(drawn.length).toBe(2);
    expect(coplanarFaces(mapped.plans, drawn)).toStrictEqual([]);
    // Control: a building with no part is drawn by its outline.
    expect(ridden([outline], NEAR_THE_ORIGIN).drawn.length).toBe(1);
  });

  it('stands no procedural building on a mapped building’s plot', () => {
    // A street lined both sides with mapped buildings, wall to wall, the whole way.
    const town: BuildingFeature[] = [];
    for (let north = -HALF_STREET_METRES + 100; north < HALF_STREET_METRES - 100; north += 12) {
      town.push(block(8, north, 22, north + 11, 14), block(-22, north, -8, north + 11, 14));
    }
    let sited = 0;
    for (let rider = 200; rider <= 1_400; rider += 200) {
      const { mapped, frame, drawn, unmapped } = ridden(town, rider);
      // Control: with no mapped building handed over, the frame's village stands here.
      sited += unmapped().scatter.filter(
        (item) => isBuiltKind(item.kind) && onMappedGround(mapped, item.x, item.z, 0),
      ).length;
      const onPlots = frame.scatter.filter(
        (item) => isBuiltKind(item.kind) && onMappedGround(mapped, item.x, item.z, 0),
      );
      expect(onPlots, `rider ${String(rider)}`).toStrictEqual([]);
      expect(coplanarFaces(mapped.plans, drawn), `rider ${String(rider)}`).toStrictEqual([]);
    }
    expect(sited).toBeGreaterThan(0);
  });
});

function signedAreaOf(ring: Float32Array | undefined): number {
  if (ring === undefined) return 0;
  let twice = 0;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    twice +=
      (ring[j * 2] as number) * (ring[i * 2 + 1] as number) -
      (ring[i * 2] as number) * (ring[j * 2 + 1] as number);
  }
  return twice / 2;
}
