// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A corridor of land-use rectangles, one per `kind` — #1630, for
 * `land-class.test.ts`. **Built from arithmetic only: no OpenStreetMap data,
 * no tile, and nothing here is a real place.** The kinds are the strings
 * spike 0031 (`docs/spikes/0031-land-use-kinds-and-urban-density-in-our-archive.md`)
 * counted in our archive's village, town and downtown corridors, and the
 * classes are `land-class.ts` §`LAND_CLASS_OF_KIND`'s as that spike left it.
 *
 * Each rectangle is {@link LAND_USE_FIXTURE_WIDTH} metres along `x` and
 * {@link LAND_USE_FIXTURE_DEPTH} across `z`, laid side by side with a gap
 * between them, inside one covered box, so no two overlap and the class read
 * at a rectangle's centre is its own kind's and nothing else's.
 *
 * ⚠️ **Test support** — a file under `testing/`, which `check-wiring.mjs`
 * §`isTestSupport` reads as such: imported by Vitest suites, and by nothing
 * that ships.
 */

import type { Box, LandUseFeature } from '@onyourleft/map-features';
import { FIXTURE_FRAME } from '@onyourleft/map-features/testing';

import type { LandClass } from '../land-class';
import type { WorldCorridor } from '../world-data/corridor';

type MappedClass = Exclude<LandClass, 'unknown'>;

/**
 * Every `landuse` kind spike 0031 counted in a village, town or downtown
 * corridor, and the class it reads as. A kind the table does not name reads
 * as `other` — `grassland`, `kindergarten`, `village_green`, `sand`,
 * `platform`, `pier`, `bare_rock`, `beach` and Protomaps' own `other`.
 */
export const TOWN_LAND_USE_CLASSES: Readonly<Record<string, MappedClass>> = Object.freeze({
  residential: 'built-up',
  commercial: 'built-up',
  industrial: 'built-up',
  school: 'built-up',
  college: 'built-up',
  university: 'built-up',
  hospital: 'built-up',
  pedestrian: 'built-up',
  railway: 'built-up',
  park: 'park',
  garden: 'park',
  golf_course: 'park',
  nature_reserve: 'park',
  recreation_ground: 'park',
  cemetery: 'park',
  dog_park: 'park',
  playground: 'park',
  pitch: 'park',
  grass: 'park',
  wood: 'wood',
  scrub: 'wood',
  wetland: 'water',
  farmland: 'farmland',
  meadow: 'farmland',
  grassland: 'other',
  kindergarten: 'other',
  village_green: 'other',
  sand: 'other',
  platform: 'other',
  pier: 'other',
  bare_rock: 'other',
  beach: 'other',
  other: 'other',
});

/**
 * The kinds spike 0031 removed from the table: counted zero times in every
 * corridor it read, and emitted by no rule of Protomaps' `Landuse.java`. Each
 * now reads as `other` — `retail` and `neighbourhood` are the two the issue
 * names; the rest went for the same two reasons.
 */
export const REMOVED_LAND_USE_KINDS: readonly string[] = Object.freeze([
  'retail',
  'neighbourhood',
  'marina',
  'protected_area',
  'townhall',
  'library',
  'post_office',
  'supermarket',
  'grocery',
  'hotel',
  'stadium',
  'farmyard',
  'orchard',
]);

/** One rectangle's length along `x`, in metres. */
export const LAND_USE_FIXTURE_WIDTH = 40;

/** One rectangle's depth across `z`, in metres. */
export const LAND_USE_FIXTURE_DEPTH = 40;

/** The gap between two rectangles, in metres: wider than a mask cell. */
const GAP = 20;

/** The rectangles' corridor, and the centre of each kind's rectangle. */
export interface LandUseFixture {
  readonly corridor: WorldCorridor;
  /** The middle of `kind`'s rectangle, in local metres. */
  centreOf(kind: string): readonly [x: number, z: number];
}

/**
 * A covered corridor holding one `landuse` rectangle per kind of `kinds`, in
 * order along `x` from 0, and nothing else.
 */
export function landUseCorridor(kinds: readonly string[]): LandUseFixture {
  const pitch = LAND_USE_FIXTURE_WIDTH + GAP;
  const centres = new Map<string, readonly [number, number]>();
  const landUse: LandUseFeature[] = kinds.map((kind, index) => {
    const minX = GAP + index * pitch;
    const maxX = minX + LAND_USE_FIXTURE_WIDTH;
    const minZ = GAP;
    const maxZ = minZ + LAND_USE_FIXTURE_DEPTH;
    centres.set(kind, [(minX + maxX) / 2, (minZ + maxZ) / 2]);
    return {
      layer: 'landuse',
      kind,
      rings: [Float32Array.of(minX, minZ, maxX, minZ, maxX, maxZ, minX, maxZ)],
    };
  });
  const box: Box = {
    minX: 0,
    maxX: GAP + kinds.length * pitch,
    minZ: 0,
    maxZ: 2 * GAP + LAND_USE_FIXTURE_DEPTH,
  };
  const corridor: WorldCorridor = {
    routeId: 'land-use-fixture',
    origin: { latitude: FIXTURE_FRAME.latitude, longitude: FIXTURE_FRAME.longitude, elevation: 0 },
    covered: (x, z) => x >= box.minX && x < box.maxX && z >= box.minZ && z < box.maxZ,
    coveredBoxes: [box],
    landUse,
    buildings: [],
    paths: [],
    streets: [],
  };
  return {
    corridor,
    centreOf: (kind) => {
      const centre = centres.get(kind);
      if (centre === undefined) throw new Error(`no rectangle for the kind ${kind}`);
      return centre;
    },
  };
}
