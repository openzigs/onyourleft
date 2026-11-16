// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The map's lakes, sea and wetland beside the road — #2658.
 *
 * Every fixture here is arithmetic beside a straight test road: no
 * OpenStreetMap data, no tile, and nothing here is a real place. Each case is
 * read back through what a ride draws — `sceneFrame` handed the ride's mask, as
 * `GameView` hands it — and not only off `waterways`' own answer, because the
 * defect this file guards against is a lake one module finds and another never
 * reads: water drawn with trees standing in it, or ground not lowered under it.
 */

import { describe, expect, it } from 'vitest';

import { gradeAt, metres, type RouteProfile } from '@onyourleft/domain';
import type { LandUseFeature } from '@onyourleft/map-features';

import { billboardsAt } from './billboards';
import { chainLinkPieces, fencedGrounds } from './chain-link';
import { mappedJunctions } from './cross-streets';
import { besideRoad, landBeside } from './footprint-fixtures-testing';
import { landClassMask, NO_LAND_CLASS, type LandClassMask } from './land-class';
import { terrainHeightAt } from './landform';
import { lakeValleyRoute, northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { streetsAt } from './streets';
import { corridorOrigin } from './terrain';
import {
  LAKE_BANK_METRES,
  LAKE_BELOW_ROAD_METRES,
  LAKE_DEPTH_METRES,
  MAPPED_LAKE_RISE_METRES,
  WETLAND_GROUND_ABOVE_WATER_METRES,
  inWater,
  waterways,
  type Lake,
} from './waterways';
import type { WorldCorridor } from './world-data/corridor';

/** A level road 3 km north, 10 m up: no valley, so no invented water at all. */
const LEVEL = northRoute(3_000, () => 10);

/** A corridor covering the whole of `profile`'s ground, holding `landUse` and nothing else. */
function corridorOf(profile: RouteProfile, landUse: readonly LandUseFeature[]): WorldCorridor {
  return {
    routeId: 'mapped-water',
    origin: corridorOrigin(profile),
    covered: () => true,
    coveredBoxes: [{ minX: -3_000, maxX: 3_000, minZ: -1_000, maxZ: 9_000 }],
    landUse,
    buildings: [],
    paths: [],
    streets: [],
  };
}

/** The mask of a corridor holding one rectangle beside `profile`, on the road's right (+1). */
function maskBeside(
  profile: RouteProfile,
  layer: LandUseFeature['layer'],
  kind: string,
  from: number,
  to: number,
  near: number,
  far: number,
): LandClassMask {
  const origin = corridorOrigin(profile);
  return landClassMask(
    corridorOf(profile, [landBeside(profile, origin, layer, kind, from, to, near, far)]),
  );
}

function lakesOf(profile: RouteProfile, land: LandClassMask): readonly Lake[] {
  return waterways(profile, scatterSeed(profile), land).lakes;
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

/** The lake beside {@link LEVEL}: water 30 to 200 m out on its right, from 800 to 1 600 m. */
const LAKE = maskBeside(LEVEL, 'water', 'lake', 800, 1_600, 30, 200);

/**
 * The ground drawn under the middle of {@link LAKE}'s stretch, 80 to 150 m out
 * on the right, in the frame at 1 200 m: its lowest and highest vertex, and
 * how many vertices there are and how many wear the wet tint. Counted at once,
 * because the mesh is lent to the next frame (`landform.ts` §`lease`).
 */
function groundInTheMiddle(land: LandClassMask) {
  const { vertices, colours, fields } = frameAt(LEVEL, 1_200, land).terrain.mesh;
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  let checked = 0;
  let tinted = 0;
  for (let at = 0; at * 2 < fields.length; at += 1) {
    const along = fields[at * 2] as number;
    const lateral = fields[at * 2 + 1] as number;
    if (along < 1_100 || along > 1_300 || lateral < 80 || lateral > 150) continue;
    checked += 1;
    low = Math.min(low, vertices[at * 3 + 1] as number);
    high = Math.max(high, vertices[at * 3 + 1] as number);
    // The ground's own mottle is grey; only the wet tint makes it not.
    const [r, g, b] = [colours[at * 3], colours[at * 3 + 1], colours[at * 3 + 2]];
    if (!(r === g && g === b)) tinted += 1;
  }
  return { low, high, checked, tinted };
}

describe('a mapped lake beside the road is drawn — #2658', () => {
  it('finds it where the map has it: its side, its stretch, its shores and its level', () => {
    const lakes = lakesOf(LEVEL, LAKE);
    expect(lakes).toHaveLength(1);
    const lake = lakes[0] as Lake;
    expect(lake.side).toBe(1);
    expect(lake.wetland).toBeUndefined();
    expect(Math.abs(lake.from - 800)).toBeLessThanOrEqual(15);
    expect(Math.abs(lake.to - 1_600)).toBeLessThanOrEqual(15);
    expect(Math.abs((lake.near ?? 0) - 30)).toBeLessThanOrEqual(5);
    expect(Math.abs((lake.far ?? 0) - 200)).toBeLessThanOrEqual(5);
    expect(lake.waterElevation).toBeCloseTo(10 - LAKE_BELOW_ROAD_METRES, 6);
    // The control: the same route with no map has no water at all.
    expect(lakesOf(LEVEL, NO_LAND_CLASS)).toEqual([]);
  });

  it('draws its surface between the map’s shores, on its side, where none was drawn', () => {
    const surface = frameAt(LEVEL, 1_200, LAKE).water.surface;
    expect(surface.indices.length).toBeGreaterThan(0);
    // The road runs north along x = 0, and its right is −x.
    for (let at = 0; at * 3 < surface.vertices.length; at += 1) {
      const x = surface.vertices[at * 3] as number;
      expect(x).toBeLessThan(-(30 - 2 - 6));
      expect(x).toBeGreaterThan(-(200 + 2 + 6));
    }
    expect(frameAt(LEVEL, 1_200, NO_LAND_CLASS).water.surface.indices.length).toBe(0);
  });

  it('lays the ground under it on the lake’s bed, as under an invented lake', () => {
    const bed = -LAKE_BELOW_ROAD_METRES - LAKE_DEPTH_METRES;
    const lake = groundInTheMiddle(LAKE);
    expect(lake.checked).toBeGreaterThan(10);
    expect(lake.low).toBeCloseTo(bed, 3);
    expect(lake.high).toBeCloseTo(bed, 3);
    // The control: with no map the same ground is the invented relief, metres
    // of it, and none of it on a bed.
    const plain = groundInTheMiddle(NO_LAND_CLASS);
    expect(plain.high - plain.low).toBeGreaterThan(1);
  });

  it('stands no tree, shrub or rock on its water or its bank', () => {
    let inLake = 0;
    let control = 0;
    const lake = lakesOf(LEVEL, LAKE)[0] as Lake;
    const nearBank = (lake.near ?? 0) - LAKE_BANK_METRES;
    const farBank = (lake.far ?? 0) + LAKE_BANK_METRES;
    // Its middle, clear of the tapered ends.
    const inside = (x: number, z: number): boolean =>
      z > lake.from + 120 && z < lake.to - 120 && -x > nearBank && -x < farBank;
    for (let odometer = 900; odometer <= 1_500; odometer += 150) {
      for (const item of frameAt(LEVEL, odometer, LAKE).scatter) {
        if (inside(item.x, item.z)) inLake += 1;
      }
      for (const item of frameAt(LEVEL, odometer, NO_LAND_CLASS).scatter) {
        if (inside(item.x, item.z)) control += 1;
      }
    }
    expect(inLake).toBe(0);
    // Non-vacuity: with no map the same ground is planted.
    expect(control).toBeGreaterThan(10);
  });

  it('stands no billboard in it', () => {
    // Water from 10 m out on both sides of a longer road, so a lake's bank
    // reaches the boards' own 9.5 m wherever the seed puts one.
    const long = northRoute(8_000, () => 10);
    const origin = corridorOrigin(long);
    const shores = landClassMask(
      corridorOf(long, [
        landBeside(long, origin, 'water', 'lake', 200, 7_800, 10, 200),
        landBeside(long, origin, 'water', 'lake', 200, 7_800, -10, -200),
      ]),
    );
    const seed = scatterSeed(long);
    const middle = (board: { readonly z: number }): boolean => board.z > 600 && board.z < 7_400;
    expect(billboardsAt(long, origin, seed, 0, long.totalDistance, shores).filter(middle)).toEqual(
      [],
    );
    // The control: with no map the same road has boards there.
    expect(
      billboardsAt(long, origin, seed, 0, long.totalDistance, NO_LAND_CLASS).filter(middle).length,
    ).toBeGreaterThan(0);
  });

  it('keeps the road and the trainer’s gradient the route’s own', () => {
    const before = JSON.stringify(LEVEL);
    const mapped = frameAt(LEVEL, 1_200, LAKE).corridor.centre;
    const plain = frameAt(LEVEL, 1_200, NO_LAND_CLASS).corridor.centre;
    expect(mapped).toEqual(plain);
    expect(JSON.stringify(LEVEL)).toBe(before);
    expect(gradeAt(LEVEL, 1_200)).toBe(0);
  });

  it('draws none for water too short, too far out or too narrow', () => {
    expect(lakesOf(LEVEL, maskBeside(LEVEL, 'water', 'lake', 800, 1_000, 30, 200))).toEqual([]);
    expect(lakesOf(LEVEL, maskBeside(LEVEL, 'water', 'lake', 800, 1_600, 130, 240))).toEqual([]);
    expect(lakesOf(LEVEL, maskBeside(LEVEL, 'water', 'lake', 800, 1_600, 30, 40))).toEqual([]);
    // Wide enough from the road's edge, but not once the verge is the road's:
    // its shore is held 16 m out, and 16 to 35 m is too narrow a lake.
    expect(lakesOf(LEVEL, maskBeside(LEVEL, 'water', 'lake', 800, 1_600, 5, 35))).toEqual([]);
  });

  it('looks past a ditch between the road and the lake beyond it', () => {
    const origin = corridorOrigin(LEVEL);
    const ditched = landClassMask(
      corridorOf(LEVEL, [
        landBeside(LEVEL, origin, 'water', 'ditch', 800, 1_600, 12, 18),
        landBeside(LEVEL, origin, 'water', 'lake', 800, 1_600, 40, 200),
      ]),
    );
    const lakes = lakesOf(LEVEL, ditched);
    expect(lakes).toHaveLength(1);
    expect(Math.abs((lakes[0]?.near ?? 0) - 40)).toBeLessThanOrEqual(5);
  });

  it('ends one lake and begins another where the road beside it climbs', () => {
    // 10 m over the 1 200 m beside the water: more than one lake's rise.
    const road = (at: number): number => (at < 800 ? 0 : at < 2_000 ? (at - 800) / 120 : 10);
    const climbing = northRoute(3_000, road);
    const lakes = lakesOf(climbing, maskBeside(climbing, 'water', 'lake', 800, 2_000, 30, 200));
    expect(lakes.length).toBe(2);
    const [first, second] = lakes as [Lake, Lake];
    expect(second.from).toBeGreaterThan(first.to);
    expect(second.waterElevation).toBeGreaterThan(first.waterElevation + 3);
    for (const lake of lakes) {
      expect(road(lake.to) - road(lake.from)).toBeLessThanOrEqual(MAPPED_LAKE_RISE_METRES);
    }
  });
});

describe('every reader of the water sees the map’s lake — #2658', () => {
  const origin = corridorOrigin(LEVEL);
  const seed = scatterSeed(LEVEL);
  /** Water from 10 m out on the right, so its bank reaches the road's own verge. */
  const shore = landBeside(LEVEL, origin, 'water', 'lake', 800, 1_600, 10, 200);
  const SHORE = landClassMask(corridorOf(LEVEL, [shore]));

  it('stands a thing on the ground drawn under the lake: terrainHeightAt', () => {
    const bed = -LAKE_BELOW_ROAD_METRES - LAKE_DEPTH_METRES;
    expect(terrainHeightAt(LEVEL, origin, seed, 1_200, 100, LAKE)).toBeCloseTo(bed, 3);
    expect(
      Math.abs(terrainHeightAt(LEVEL, origin, seed, 1_200, 100, NO_LAND_CLASS) - bed),
    ).toBeGreaterThan(0.5);
  });

  it('lays no city pavement on the lake’s bank', () => {
    const city = { classAt: () => 'city-centre' as const };
    /** The walks on the lake's side, in its middle: the road's right is −x. */
    const beside = (land: LandClassMask): number => {
      let count = 0;
      for (const street of streetsAt(LEVEL, origin, seed, 900, 1_500, undefined, land, city)) {
        for (const walk of street.walks) {
          for (let at = 0; at + 2 < walk.length; at += 3) {
            const x = walk[at] as number;
            const z = walk[at + 2] as number;
            if (x < 0 && z > 1_000 && z < 1_400) count += 1;
          }
        }
      }
      return count;
    };
    expect(beside(SHORE)).toBe(0);
    // The control: with no map the city's pavement runs on that side there.
    expect(beside(NO_LAND_CLASS)).toBeGreaterThan(0);
  });

  it('ends a mapped side street at the lake’s bank', () => {
    const [x0, z0] = besideRoad(LEVEL, origin, 1_200, 0);
    const [x1, z1] = besideRoad(LEVEL, origin, 1_200, 150);
    const corridor: WorldCorridor = {
      ...corridorOf(LEVEL, [shore]),
      streets: [
        {
          kind: 'minor_road',
          kindDetail: 'residential',
          grade: 'ground',
          line: Float32Array.of(x0, z0, x1, z1),
        },
      ],
    };
    expect(mappedJunctions(corridor, LEVEL, origin, seed, landClassMask(corridor))).toEqual([]);
    // The control: with no mask the same street is a side road.
    expect(mappedJunctions(corridor, LEVEL, origin, seed, NO_LAND_CLASS).length).toBe(1);
  });

  it('stands no chain-link on the lake’s bank', () => {
    // An estate fenced along its roadside frontage, and the lake from 10 m
    // out over it: the lake's bank reaches back over the frontage.
    const estate = landBeside(LEVEL, origin, 'landuse', 'industrial', 800, 1_600, 2, 160);
    const land = landClassMask(corridorOf(LEVEL, [estate, shore]));
    const route = (mask: LandClassMask) => ({
      profile: LEVEL,
      origin,
      seed,
      land: mask,
      roadside: 5.6,
      piece: 8,
      cityCentre: () => false,
    });
    const ways = waterways(LEVEL, seed, land);
    const wet = (mask: LandClassMask): number =>
      chainLinkPieces(fencedGrounds([estate]), route(mask)).filter((piece) =>
        inWater(ways, LEVEL, piece.along, -piece.item.x),
      ).length;
    expect(wet(land)).toBe(0);
    // The control: without the map's lake the estate's far side is fenced there.
    expect(wet(NO_LAND_CLASS)).toBeGreaterThan(0);
  });
});

describe('a mapped wetland is wet ground, not a dry field — #2658', () => {
  const WETLAND = maskBeside(LEVEL, 'landuse', 'wetland', 800, 1_600, 30, 200);

  it('is a wetland lake, with no open water drawn over it', () => {
    const lakes = lakesOf(LEVEL, WETLAND);
    expect(lakes).toHaveLength(1);
    expect(lakes[0]?.wetland).toBe(true);
    expect(frameAt(LEVEL, 1_200, WETLAND).water.surface.indices.length).toBe(0);
    // The control: open water there is drawn.
    expect(frameAt(LEVEL, 1_200, LAKE).water.surface.indices.length).toBeGreaterThan(0);
  });

  it('holds its ground level, just over its water, and wears the wet tint', () => {
    const top = -LAKE_BELOW_ROAD_METRES + WETLAND_GROUND_ABOVE_WATER_METRES;
    const wet = groundInTheMiddle(WETLAND);
    expect(wet.checked).toBeGreaterThan(10);
    expect(wet.low).toBeCloseTo(top, 3);
    expect(wet.high).toBeCloseTo(top, 3);
    expect(wet.tinted).toBe(wet.checked);
    // The control: with no map the same ground is the invented relief, and dry.
    const dry = groundInTheMiddle(NO_LAND_CLASS);
    expect(dry.high - dry.low).toBeGreaterThan(1);
    expect(dry.tinted).toBe(0);
  });

  it('reads a wetland from the water layer as from land use, and open water over it as water', () => {
    expect(
      lakesOf(LEVEL, maskBeside(LEVEL, 'water', 'wetland', 800, 1_600, 30, 200))[0]?.wetland,
    ).toBe(true);
    const origin = corridorOrigin(LEVEL);
    const both = landClassMask(
      corridorOf(LEVEL, [
        landBeside(LEVEL, origin, 'water', 'lake', 800, 1_600, 30, 200),
        landBeside(LEVEL, origin, 'landuse', 'wetland', 800, 1_600, 30, 200),
      ]),
    );
    expect(lakesOf(LEVEL, both)[0]?.wetland).toBeUndefined();
  });
});

describe('no invented lake where the map was read — #2658', () => {
  const valley = lakeValleyRoute();

  it('drops an invented lake in a stretch the map covers and has no water', () => {
    expect(lakesOf(valley, NO_LAND_CLASS).length).toBeGreaterThan(0);
    const dry = landClassMask(corridorOf(valley, []));
    expect(lakesOf(valley, dry)).toEqual([]);
  });

  it('keeps it where the map was read elsewhere — the control', () => {
    const elsewhere = landClassMask({
      ...corridorOf(valley, []),
      coveredBoxes: [{ minX: 5_000, maxX: 6_000, minZ: 5_000, maxZ: 6_000 }],
    });
    expect(elsewhere.bytes).toBeGreaterThan(0);
    expect(lakesOf(valley, elsewhere)).toEqual(lakesOf(valley, NO_LAND_CLASS));
  });
});
