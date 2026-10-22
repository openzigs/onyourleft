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

import { decodeTile } from '@onyourleft/map-features';
import {
  EARTH,
  encodeTile,
  lakeTile,
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
import { corridorOrigin } from '../src/game/terrain';
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

/** The archive's tiles: every tile the route's corridor plans, a fixture each, in turn. */
export function corridorFixtureTiles(long = false): ArchiveTile[] {
  const plan = planCorridor(corridorFixtureRoute(long).positions, []);
  return (plan?.requestable ?? []).map((tile, index) => ({
    x: tile.x,
    y: tile.y,
    bytes: (FIXTURES[index % FIXTURES.length] as () => Uint8Array)(),
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
} {
  const plan = planCorridor(corridorFixtureRoute().positions, []);
  if (plan === undefined) throw new Error('the fixture route plans no corridor');
  let buildings = 0;
  let landUse = 0;
  let paths = 0;
  for (const tile of corridorFixtureTiles()) {
    const decoded = decodeTile(tile.bytes, { z: 15, x: tile.x, y: tile.y }, plan.frame);
    if ('reason' in decoded) throw new Error(`a fixture tile was refused: ${decoded.reason}`);
    buildings += decoded.buildings.length;
    landUse += decoded.landUse.length;
    paths += decoded.paths.length;
  }
  return { tiles: plan.requestable.length, buildings, landUse, paths };
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
