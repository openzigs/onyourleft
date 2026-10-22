// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The synthetic archive the browser gate reads a route's corridor from — #1539.
 *
 * Emitted into `browser/dist` at build time by `vite.browser.config.ts`, as
 * `pmtiles-fixture.ts`' archive is, and for the same reasons: nothing binary
 * is committed, and nothing a reviewer cannot read. It covers the harness
 * route's corridor with #1544's hand-written fixtures — a block of footprints,
 * a wood with a clearing, a lake and a sidewalk — and, since #1546, a wood
 * either side of the road ({@link roadsideWoodTile}), in turn, and contains **no
 * OpenStreetMap data**. Its metadata declares the Protomaps basemap v4 schema
 * so the reader's schema check passes, and says in words that it is synthetic.
 *
 * `corridor-harness.ts` serves it as the configured archive, and
 * `corridor.browser.spec.ts` asserts what reached the page against
 * {@link expectedCorridorCounts}, which decodes the same fixtures in Node.
 */

import { decodeTile, tileBounds, type TileId } from '@onyourleft/map-features';
import {
  EARTH,
  encodeTile,
  lakeTile,
  line,
  outerRing,
  polygon,
  rectangle,
  residentialBlockTile,
  sidewalkTile,
  woodWithHoleTile,
} from '@onyourleft/map-features/testing';
import { metres, type RouteProfile } from '@onyourleft/domain';

import type { LandClass, LandClassMask } from '../src/game/land-class';
import { northRoute } from '../src/game/route-fixtures-testing';
import { STRUCTURE_KINDS, type SceneryKind } from '../src/game/scatter';
import { sceneFrame } from '../src/game/scene';
import { atStartLine } from '../src/game/simulation';
import type { SideRoad } from '../src/game/cross-streets';
import { corridorOrigin, drawnRoadFrame } from '../src/game/terrain';
import { planCorridor, type WorldCorridor } from '../src/game/world-data/corridor';
import { buildArchive, type ArchiveTile } from '../src/world-data/archive-testing';

/** Served at the harness origin's root. */
export const CORRIDOR_ARCHIVE_FILE = 'corridor-fixture.pmtiles';

/** The 600-tile corridor's archive, for the performance budget's floor. */
export const LONG_CORRIDOR_ARCHIVE_FILE = 'corridor-fixture-long.pmtiles';

/**
 * Two level kilometres due north: a corridor of a handful of z15 tiles. `long`:
 * 250 km, whose corridor is past the cap, so a read is exactly
 * `CORRIDOR_MAX_TILES` tiles — #1539's performance budget.
 */
export function corridorFixtureRoute(long = false): RouteProfile {
  return northRoute(long ? 250_000 : 2_000, () => 10);
}

/**
 * A wood across the road — #1546's browser case. In the fixture route's fifth
 * tile the road runs about 320 px in from the tile's west edge, so a wood
 * from the edge to 1 300 px wide, the tile's whole height, stands either side
 * of it where a procedural village would. A rectangle: no OpenStreetMap data.
 */
export function roadsideWoodTile(): Uint8Array {
  return encodeTile([
    EARTH,
    {
      name: 'landuse',
      features: [
        {
          type: 3,
          tags: { kind: 'wood' },
          geometry: polygon([outerRing(rectangle(0, 0, 1300, 4096))]),
        },
      ],
    },
  ]);
}

const FIXTURES = [
  residentialBlockTile,
  woodWithHoleTile,
  lakeTile,
  sidewalkTile,
  roadsideWoodTile,
] as const;

/**
 * The plan's tile that holds #1565's junctions: its second, which the fixture
 * route runs the whole height of, about 317 px in from its west edge.
 */
export const JUNCTIONS_TILE_INDEX = 1;

/**
 * #1565's junctions, in degrees from the road's forward direction (north) to
 * each arm, on the rider's right (east, `+1`) and left (`-1`): a T leaving
 * east at 60 degrees at row 3000, and a crossroads square across at row 1000.
 */
export const FIXTURE_JUNCTIONS = [
  { row: 3000, arms: [{ side: 1, angleDegrees: 60 }] },
  {
    row: 1000,
    arms: [
      { side: -1, angleDegrees: 90 },
      { side: 1, angleDegrees: 90 },
    ],
  },
] as const;

/**
 * A T and a crossroads on the fixture route - #1565's browser case: a minor
 * road leaving the route east at 60 degrees from north, and one straight
 * across it, each 500 px (about 93 m) an arm, placed from the route's own
 * column in this tile. Straight lines of arithmetic: no OpenStreetMap data.
 */
export function junctionsTile(tile: TileId): Uint8Array {
  const bounds = tileBounds(tile);
  const longitude = (corridorFixtureRoute().positions[0] as { longitude: number }).longitude;
  const column = Math.round(((longitude - bounds.west) / (bounds.east - bounds.west)) * 4096);
  const arm = 500;
  const tee = FIXTURE_JUNCTIONS[0];
  const radians = (tee.arms[0].angleDegrees * Math.PI) / 180;
  return encodeTile([
    EARTH,
    {
      name: 'roads',
      features: [
        {
          type: 2,
          tags: { kind: 'minor_road', kind_detail: 'residential' },
          geometry: line([
            [
              [column, tee.row],
              // East is +x in tile pixels, and north is -y.
              [
                column + Math.round(arm * Math.sin(radians)),
                tee.row - Math.round(arm * Math.cos(radians)),
              ],
            ],
          ]),
        },
        {
          type: 2,
          tags: { kind: 'minor_road', kind_detail: 'residential' },
          geometry: line([
            [
              [column - arm, FIXTURE_JUNCTIONS[1].row],
              [column + arm, FIXTURE_JUNCTIONS[1].row],
            ],
          ]),
        },
      ],
    },
  ]);
}

/** The archive's tiles: every tile the route's corridor plans, a fixture each, in turn. */
export function corridorFixtureTiles(long = false): ArchiveTile[] {
  const plan = planCorridor(corridorFixtureRoute(long).positions, []);
  return (plan?.requestable ?? []).map((tile, index) => ({
    x: tile.x,
    y: tile.y,
    bytes:
      !long && index === JUNCTIONS_TILE_INDEX
        ? junctionsTile(tile)
        : (FIXTURES[index % FIXTURES.length] as () => Uint8Array)(),
  }));
}

/** The archive's bytes, tiles gzipped as Protomaps' are. */
export function buildCorridorFixtureArchive(long = false): Promise<Uint8Array> {
  return buildArchive({ tiles: corridorFixtureTiles(long) });
}

/** What a complete read of the fixture must hand the page. */
export function expectedCorridorCounts(): {
  readonly tiles: number;
  readonly buildings: number;
  readonly landUse: number;
  readonly paths: number;
  readonly streets: number;
} {
  const plan = planCorridor(corridorFixtureRoute().positions, []);
  if (plan === undefined) throw new Error('the fixture route plans no corridor');
  let buildings = 0;
  let landUse = 0;
  let paths = 0;
  let streets = 0;
  for (const tile of corridorFixtureTiles()) {
    const decoded = decodeTile(tile.bytes, { z: 15, x: tile.x, y: tile.y }, plan.frame);
    if ('reason' in decoded) throw new Error(`a fixture tile was refused: ${decoded.reason}`);
    buildings += decoded.buildings.length;
    landUse += decoded.landUse.length;
    paths += decoded.paths.length;
    streets += decoded.streets.length;
  }
  return { tiles: plan.requestable.length, buildings, landUse, paths, streets };
}

/** One item a frame stands in the world, and the class of the ground under it — #1546. */
export interface ClassedItem {
  readonly kind: SceneryKind;
  readonly structure: boolean;
  readonly landClass: LandClass;
}

/**
 * Every structure and scatter item the scene stands along the whole fixture
 * route, a frame every 100 m, each with the class of the ground at its
 * position — #1546's browser case. Classed against `classes` (the corridor's
 * own mask); `land` is what the scene was handed, which the `-landclass`
 * control leaves out, so the scene takes `land-class.ts` §`NO_LAND_CLASS`.
 */
export function classedItems(
  corridor: WorldCorridor,
  land: LandClassMask | undefined,
  classes: LandClassMask,
): readonly ClassedItem[] {
  const profile = corridorFixtureRoute();
  const origin = corridorOrigin(profile);
  const start = atStartLine(profile);
  const seen = new Set<string>();
  const out: ClassedItem[] = [];
  const structures = new Set<SceneryKind>(STRUCTURE_KINDS);
  for (let distance = 0; distance <= profile.totalDistance; distance += 100) {
    const frame = sceneFrame({
      profile,
      origin,
      state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
      worldCorridor: corridor,
      ...(land === undefined ? {} : { landClass: land }),
    });
    for (const item of frame.scatter) {
      const key = `${item.kind} ${item.x.toFixed(2)} ${item.z.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kind: item.kind,
        structure: structures.has(item.kind),
        landClass: classes.classAt(item.x, item.z),
      });
    }
  }
  return out;
}

/** One cross street the scene drew along the fixture route, read back off its mesh - #1565. */
export interface DrawnJunction {
  /** Where along the route, as `cross-streets.ts` recorded it. */
  readonly along: number;
  /** Each arm as recorded: its side and angle. */
  readonly arms: readonly { readonly side: 1 | -1; readonly angleDegrees: number }[];
  /** Each side's heading READ OFF THE MESH: from the junction to its farthest tarmac. */
  readonly meshAngles: readonly { readonly side: 1 | -1; readonly angleDegrees: number }[];
  readonly triangles: number;
}

/**
 * Every MAPPED side road the scene draws along the whole fixture route, a
 * frame every 100 m, each once - through `sceneFrame`, as a ride's frames are
 * built - with each arm's heading read back from the vertices of its mesh.
 */
export function drawnJunctions(
  corridor: WorldCorridor,
  land: LandClassMask | undefined,
): readonly DrawnJunction[] {
  const profile = corridorFixtureRoute();
  const origin = corridorOrigin(profile);
  const start = atStartLine(profile);
  const seen = new Set<SideRoad>();
  const out: DrawnJunction[] = [];
  for (let distance = 0; distance <= profile.totalDistance; distance += 100) {
    const frame = sceneFrame({
      profile,
      origin,
      state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
      worldCorridor: corridor,
      ...(land === undefined ? {} : { landClass: land }),
    });
    for (const road of frame.sideRoads) {
      if (seen.has(road) || road.junction.source !== 'mapped') continue;
      seen.add(road);
      out.push(readBack(road, profile, origin));
    }
  }
  return out.sort((a, b) => a.along - b.along);
}

function readBack(
  road: SideRoad,
  profile: RouteProfile,
  origin: ReturnType<typeof corridorOrigin>,
): DrawnJunction {
  const here = drawnRoadFrame(profile, origin, road.junction.along);
  const forwardX = here?.normalZ ?? 0;
  const forwardZ = -(here?.normalX ?? 0);
  const { positions, colours } = road.mesh;
  const meshAngles: { side: 1 | -1; angleDegrees: number }[] = [];
  for (const side of [-1, 1] as const) {
    const mine: [number, number][] = [];
    for (let at = 0; at < positions.length / 3; at += 1) {
      // Paint is near white: the arm's heading is its tarmac's.
      if ((colours[at * 3] as number) > 0.5) continue;
      const x = (positions[at * 3] as number) - (here?.x ?? 0);
      const z = (positions[at * 3 + 2] as number) - (here?.z ?? 0);
      if ((x * (here?.normalX ?? 0) + z * (here?.normalZ ?? 0)) * side > 0) mine.push([x, z]);
    }
    if (mine.length === 0) continue;
    const far = Math.max(...mine.map(([x, z]) => Math.hypot(x, z)));
    const end = mine.filter(([x, z]) => Math.hypot(x, z) > far - 6);
    const cx = end.reduce((sum, [x]) => sum + x, 0) / end.length;
    const cz = end.reduce((sum, [, z]) => sum + z, 0) / end.length;
    const cosine = (cx * forwardX + cz * forwardZ) / Math.hypot(cx, cz);
    meshAngles.push({ side, angleDegrees: (Math.acos(cosine) * 180) / Math.PI });
  }
  return {
    along: road.junction.along,
    arms: road.junction.arms.map((arm) => ({ side: arm.side, angleDegrees: arm.angleDegrees })),
    meshAngles,
    triangles: road.mesh.indices.length / 3,
  };
}
