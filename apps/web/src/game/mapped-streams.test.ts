// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The map's rivers, streams and canals where they cross the road — #2659.
 *
 * Every fixture here is arithmetic beside a straight test road: no
 * OpenStreetMap data, no tile, and nothing here is a real place. A crossing is
 * read back through what a ride draws — `sceneFrame` handed the mask
 * `GameView` builds from the corridor — as well as off `waterways`' answer.
 */

import { describe, expect, it } from 'vitest';

import { metres, type RouteProfile } from '@onyourleft/domain';
import type { WaterLineFeature } from '@onyourleft/map-features';

import { besideRoad } from './footprint-fixtures-testing';
import { landClassMask, NO_LAND_CLASS, type LandClassMask } from './land-class';
import { terrainHeightAt } from './landform';
import { northRoute, valleyRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin } from './terrain';
import {
  BRIDGE_CLEARANCE_METRES,
  MAPPED_CROSSING_SPACING_METRES,
  STREAM_DEPTH_METRES,
  waterways,
  type Crossing,
} from './waterways';
import { worldCorridorOf, type WorldCorridor } from './world-data/corridor';

/** A level road 3 km north, 10 m up: no valley, so no invented stream at all. */
const LEVEL = northRoute(3_000, () => 10);

/** A straight line across `profile`'s road at `along`, `reach` metres out either side. */
function across(profile: RouteProfile, along: number, reach = 150): WaterLineFeature {
  const origin = corridorOrigin(profile);
  const [x0, z0] = besideRoad(profile, origin, along, -reach);
  const [x1, z1] = besideRoad(profile, origin, along, reach);
  return { kind: 'stream', line: Float32Array.of(x0, z0, x1, z1) };
}

/** A line through `(along, lateral)` pairs beside `profile`'s road. */
function through(
  profile: RouteProfile,
  pairs: readonly (readonly [number, number])[],
): WaterLineFeature {
  const origin = corridorOrigin(profile);
  return {
    kind: 'river',
    line: Float32Array.from(
      pairs.flatMap(([along, lateral]) => [...besideRoad(profile, origin, along, lateral)]),
    ),
  };
}

/** A corridor covering the whole of `profile`'s ground, holding `waterLines` and nothing else. */
function corridorOf(profile: RouteProfile, waterLines: readonly WaterLineFeature[]): WorldCorridor {
  return {
    routeId: 'mapped-streams',
    origin: corridorOrigin(profile),
    covered: () => true,
    coveredBoxes: [{ minX: -3_000, maxX: 3_000, minZ: -1_000, maxZ: 4_000 }],
    landUse: [],
    buildings: [],
    paths: [],
    streets: [],
    waterLines,
  };
}

function maskOf(profile: RouteProfile, waterLines: readonly WaterLineFeature[]): LandClassMask {
  return landClassMask(corridorOf(profile, waterLines));
}

function crossingsOf(profile: RouteProfile, land: LandClassMask): readonly Crossing[] {
  return waterways(profile, scatterSeed(profile), land).crossings;
}

function frameAt(profile: RouteProfile, odometer: number, land: LandClassMask) {
  const start = atStartLine(profile);
  return sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: { ...start, ride: { ...start.ride, distance: metres(odometer) } },
    landClass: land,
  });
}

/** A stream across {@link LEVEL} at 1 200 m. */
const STREAM = maskOf(LEVEL, [across(LEVEL, 1_200)]);

describe('a mapped stream crossing the road is bridged — #2659', () => {
  it('finds it where the map has it, its water a bridge’s clearance under the road', () => {
    const crossings = crossingsOf(LEVEL, STREAM);
    expect(crossings).toHaveLength(1);
    expect(Math.abs((crossings[0] as Crossing).distance - 1_200)).toBeLessThan(1);
    expect((crossings[0] as Crossing).waterElevation).toBeCloseTo(10 - BRIDGE_CLEARANCE_METRES, 6);
    // The control: the same road with no map has no stream at all.
    expect(crossingsOf(LEVEL, NO_LAND_CLASS)).toEqual([]);
  });

  it('draws its bridge and its water where none was drawn', () => {
    const mapped = frameAt(LEVEL, 1_150, STREAM).water;
    expect(mapped.bridges.length).toBeGreaterThan(0);
    expect(mapped.surface.indices.length).toBeGreaterThan(0);
    const plain = frameAt(LEVEL, 1_150, NO_LAND_CLASS).water;
    expect(plain.bridges).toEqual([]);
    expect(plain.surface.indices.length).toBe(0);
  });

  it('cuts its channel in the ground, as under an invented stream', () => {
    const origin = corridorOrigin(LEVEL);
    const seed = scatterSeed(LEVEL);
    const bed = 10 - BRIDGE_CLEARANCE_METRES - STREAM_DEPTH_METRES - origin.elevation;
    expect(terrainHeightAt(LEVEL, origin, seed, 1_200, 12, STREAM)).toBeLessThanOrEqual(bed + 1e-3);
    expect(terrainHeightAt(LEVEL, origin, seed, 1_200, -12, STREAM)).toBeLessThanOrEqual(
      bed + 1e-3,
    );
    // The control: with no map the ground there is not in a channel.
    expect(terrainHeightAt(LEVEL, origin, seed, 1_200, 12, NO_LAND_CLASS)).toBeGreaterThan(bed + 1);
  });

  it('keeps the road, and so the trainer’s gradient, the route’s own', () => {
    const before = JSON.stringify(LEVEL);
    expect(frameAt(LEVEL, 1_200, STREAM).corridor.centre).toEqual(
      frameAt(LEVEL, 1_200, NO_LAND_CLASS).corridor.centre,
    );
    expect(JSON.stringify(LEVEL)).toBe(before);
  });

  it('crosses each stream once, and two streams twice', () => {
    // A meander that crosses back and forth within one bridge's reach.
    const meander = through(LEVEL, [
      [1_180, -100],
      [1_190, 40],
      [1_200, -40],
      [1_210, 100],
    ]);
    const once = crossingsOf(LEVEL, maskOf(LEVEL, [meander]));
    expect(once).toHaveLength(1);
    expect(Math.abs((once[0] as Crossing).distance - 1_185)).toBeLessThan(10);
    const two = crossingsOf(LEVEL, maskOf(LEVEL, [across(LEVEL, 800), across(LEVEL, 2_000)]));
    expect(two.map((crossing) => Math.round(crossing.distance / 10) * 10)).toEqual([800, 2_000]);
    expect(MAPPED_CROSSING_SPACING_METRES).toBeLessThan(1_200);
  });

  it('finds no crossing where a stream runs beside the road, or stops short of it', () => {
    const beside = through(LEVEL, [
      [600, 40],
      [2_400, 40],
    ]);
    // Ending 2 m from the centreline, in the same grid cell as the road: its
    // line produced would cross the road, and the stream itself does not.
    const short = through(LEVEL, [
      [1_200, -150],
      [1_200, -2],
    ]);
    expect(crossingsOf(LEVEL, maskOf(LEVEL, [beside, short]))).toEqual([]);
  });

  it('stays bounded on a hostile line: a segment kilometres long costs its budget, not the press', () => {
    const hostile: WaterLineFeature = {
      kind: 'canal',
      line: Float32Array.of(-1e6, -1e6, 1e6, 1e6, Number.NaN, 0, 5, 5),
    };
    const found = crossingsOf(LEVEL, maskOf(LEVEL, [hostile]));
    expect(found.length).toBeLessThanOrEqual(1);
  });
});

describe('no invented stream where the map was read — #2659', () => {
  const valley = valleyRoute();

  it('drops an invented crossing on a stretch the map covers, and bridges the map’s own', () => {
    expect(crossingsOf(valley, NO_LAND_CLASS)).toHaveLength(1);
    expect(crossingsOf(valley, maskOf(valley, []))).toEqual([]);
    const mapped = crossingsOf(valley, maskOf(valley, [across(valley, 1_600)]));
    expect(mapped).toHaveLength(1);
    expect(Math.abs((mapped[0] as Crossing).distance - 1_600)).toBeLessThan(1);
  });

  it('keeps it where the map was read elsewhere — the control', () => {
    const elsewhere = landClassMask({
      ...corridorOf(valley, []),
      coveredBoxes: [{ minX: 5_000, maxX: 6_000, minZ: 5_000, maxZ: 6_000 }],
    });
    expect(elsewhere.bytes).toBeGreaterThan(0);
    expect(crossingsOf(valley, elsewhere)).toEqual(crossingsOf(valley, NO_LAND_CLASS));
  });
});

describe('the map places water only on road it was read beside — #2659', () => {
  it('drops a mapped crossing on an uncovered stretch, keeps one on a covered stretch', () => {
    const lines = [across(LEVEL, 800), across(LEVEL, 2_200)];
    const firstKm = landClassMask({
      ...corridorOf(LEVEL, lines),
      coveredBoxes: [{ minX: -3_000, maxX: 3_000, minZ: -1_000, maxZ: 1_300 }],
    });
    const found = crossingsOf(LEVEL, firstKm);
    expect(found.map((crossing) => Math.round(crossing.distance / 10) * 10)).toEqual([800]);
  });

  it('does not double an invented crossing on uncovered road with a mapped one', () => {
    const valley = valleyRoute();
    const invented = crossingsOf(valley, NO_LAND_CLASS);
    expect(invented).toHaveLength(1);
    const at = (invented[0] as Crossing).distance;
    const mask = landClassMask({
      ...corridorOf(valley, [across(valley, at - 40)]),
      coveredBoxes: [{ minX: 5_000, maxX: 6_000, minZ: 5_000, maxZ: 6_000 }],
    });
    expect(crossingsOf(valley, mask)).toEqual(invented);
  });
});

describe('mapped and invented crossings keep their distance — #2659', () => {
  it('drops an invented crossing just outside the map that is within a bridge’s reach of a mapped one', () => {
    const valley = valleyRoute();
    const at = (crossingsOf(valley, NO_LAND_CLASS)[0] as Crossing).distance;
    const origin = corridorOrigin(valley);
    const [x, z] = besideRoad(valley, origin, at - 40, 0);
    const mask = landClassMask({
      ...corridorOf(valley, [across(valley, at - 40)]),
      coveredBoxes: [{ minX: x - 10, maxX: x + 10, minZ: z - 10, maxZ: z + 10 }],
    });
    const found = crossingsOf(valley, mask);
    expect(found).toHaveLength(1);
    expect(Math.abs((found[0] as Crossing).distance - (at - 40))).toBeLessThan(2);
  });
});

describe('the corridor hands its water lines to the ride’s mask — #2659', () => {
  it('worldCorridorOf keeps them, and landClassMask carries them to waterways', () => {
    const line = across(LEVEL, 1_200);
    const corridor = worldCorridorOf('mapped-streams', corridorOrigin(LEVEL), [], {
      landUse: [],
      buildings: [],
      paths: [],
      streets: [],
      places: [],
      waterLines: [line],
    });
    expect(corridor.waterLines).toEqual([line]);
    const mask = landClassMask(corridor);
    expect(mask.waterLines).toEqual([line]);
    // No tile is covered, so the map places no water on the road.
    expect(mask.bytes).toBe(0);
    expect(crossingsOf(LEVEL, mask)).toEqual([]);
    expect(NO_LAND_CLASS.waterLines).toEqual([]);
  });
});
