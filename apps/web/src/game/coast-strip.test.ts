// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The strip between a coast road and its sea or beach — #2754: where the map
 * has the shore or the beach at the road, the realistic world drew grass for
 * metres to tens of metres before it.
 *
 * Every fixture is arithmetic beside a straight test road: no OpenStreetMap
 * data, no tile, and nothing here is a real place. The public places each
 * cause was measured at are in the PR, never the owner's route. Each case is
 * read back through what a ride draws — `sceneFrame` handed the ride's mask
 * and corridor, as `GameView` hands them: its water surface, its ground mesh
 * and what the ground is made of, its scenery, and `footprintPlans` as
 * `GameView` calls it.
 */

import { describe, expect, it } from 'vitest';

import { metres, type RouteProfile } from '@onyourleft/domain';
import type { LandUseFeature } from '@onyourleft/map-features';

import {
  besideRoad,
  buildingBeside,
  landBeside,
  rectangleBeside,
  ringBeside,
} from './footprint-fixtures-testing';
import { footprintPlans } from './footprint-buildings';
import { BARE_SURFACES, landClassMask, type LandClassMask } from './land-class';
import { TERRAIN_COLUMN_OFFSETS } from './landform';
import { northRoute } from './route-fixtures-testing';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin } from './terrain';
import { MAPPED_LAKE_NEAR_METRES } from './waterways';
import type { WorldCorridor } from './world-data/corridor';

/** A level road 3 km north, 10 m up: no valley, so no invented water at all. */
const LEVEL = northRoute(3_000, () => 10);
const ORIGIN = corridorOrigin(LEVEL);

/** A corridor over {@link LEVEL}'s ground, one covered box, holding what it is given. */
function corridorOf(
  landUse: readonly LandUseFeature[],
  extra: Partial<WorldCorridor> = {},
): WorldCorridor {
  return {
    routeId: 'coast-strip',
    origin: ORIGIN,
    covered: () => true,
    coveredBoxes: [{ minX: -3_000, maxX: 3_000, minZ: -1_000, maxZ: 9_000 }],
    landUse,
    buildings: [],
    paths: [],
    streets: [],
    ...extra,
  };
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

/**
 * The height of the highest triangle of `vertices` and `indices` over
 * `(x, z)`, or `NaN` where none is: what is drawn on top there. Written out
 * here rather than asked of `landform.ts`, so the oracle is not the code.
 */
function drawnTop(
  vertices: ArrayLike<number>,
  indices: ArrayLike<number>,
  x: number,
  z: number,
): number {
  let top = Number.NaN;
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const a = (indices[at] as number) * 3;
    const b = (indices[at + 1] as number) * 3;
    const c = (indices[at + 2] as number) * 3;
    const [ax, az, bx, bz, cx, cz] = [
      vertices[a] as number,
      vertices[a + 2] as number,
      vertices[b] as number,
      vertices[b + 2] as number,
      vertices[c] as number,
      vertices[c + 2] as number,
    ];
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-9) continue;
    const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
    const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
    const w = 1 - u - v;
    if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
    const y =
      u * (vertices[a + 1] as number) +
      v * (vertices[b + 1] as number) +
      w * (vertices[c + 1] as number);
    top = Number.isNaN(top) ? y : Math.max(top, y);
  }
  return top;
}

/**
 * Where a rider at `along` first sees water on the road's right, in metres
 * from the centreline: the first point, in quarter metres from the road's
 * edge, where the drawn water stands over the drawn ground. `Infinity` if
 * none does within 150 m.
 */
function waterSeenFrom(land: LandClassMask, along: number): number {
  const frame = frameAt(LEVEL, along, land);
  const water = frame.water.surface;
  const ground = frame.terrain.mesh;
  for (let lateral = 3.5; lateral <= 150; lateral += 0.25) {
    const [x, z] = besideRoad(LEVEL, ORIGIN, along, lateral);
    const surface = drawnTop(water.vertices, water.indices, x, z);
    if (surface > drawnTop(ground.vertices, ground.indices, x, z)) return lateral;
  }
  return Number.POSITIVE_INFINITY;
}

/** The sea on the road's right, from `from` to `to`, its shore `near` out and on to 240 m. */
function seaBeside(from: number, to: number, near: number): LandUseFeature {
  return landBeside(LEVEL, ORIGIN, 'water', 'ocean', from, to, near, 240);
}

describe('#2754 the drawn sea starts where the map’s shore is', () => {
  it('follows a shore that wanders away from the road, sample by sample', () => {
    // A coast running away from the road: the shore 15 m out at 800 m and
    // 135 m out at 2 000 m, 1 m in every 10. Until #2754 its shore wandered
    // past the 20 m a run allowed every 200 m, each run was shorter than a
    // lake's 300 m, and no sea was drawn beside it at all.
    const shore = (along: number): number => 15 + (along - 800) / 10;
    const land = landClassMask(
      corridorOf([
        {
          layer: 'water',
          kind: 'ocean',
          rings: [
            ringBeside(LEVEL, ORIGIN, [
              [800, shore(800)],
              [2_000, shore(2_000)],
              [2_000, 240],
              [800, 240],
            ]),
          ],
        },
      ]),
    );
    // Out to 95 m at 1 600 m: past the road's edge and 100 m, water is not looked for.
    for (const along of [950, 1_150, 1_400, 1_600]) {
      // Within a metre and a half of the map's shore, either way: the mask's
      // cells are 5 m, and the shore is taken halfway between the last dry
      // step out and the first wet one, not at the wet one.
      expect(
        Math.abs(waterSeenFrom(land, along) - shore(along)),
        `at ${String(along)}`,
      ).toBeLessThan(1.5);
    }
  });

  it('brings the sea to the road where the map has it there, and leaves the road edge whole', () => {
    // The map's shore 6 m from the centreline: 2.5 m past the road's edge.
    // Until #2754 a mapped lake's shore was held 16 m out, so the water was
    // first seen 14 m out and the 10 m between was drawn as grass.
    const land = landClassMask(corridorOf([seaBeside(800, 1_600, 6)]));
    for (const along of [1_000, 1_200, 1_400]) {
      expect(waterSeenFrom(land, along), `at ${String(along)}`).toBeLessThanOrEqual(6.5);
      // And its bank climbs to the road by the road's edge rather than
      // cutting into it: the ground at the edge stands where the road does.
      const ground = frameAt(LEVEL, along, land).terrain.mesh;
      const [x, z] = besideRoad(LEVEL, ORIGIN, along, 3.6);
      expect(drawnTop(ground.vertices, ground.indices, x, z)).toBeGreaterThan(-0.1);
    }
  });

  it('holds the near shore at the ground’s third column, the verge’s band its bank', () => {
    expect(MAPPED_LAKE_NEAR_METRES).toBe(TERRAIN_COLUMN_OFFSETS[2]);
  });

  it('reaches the map’s shore within a few metres of each end of its water', () => {
    // An invented lake narrows over 80 m at each end, and until #2754 a mapped
    // lake did too: 30 m in, the sea was drawn some 70 m back from its shore.
    const land = landClassMask(corridorOf([seaBeside(800, 1_600, 15)]));
    for (const along of [835, 1_565]) {
      expect(waterSeenFrom(land, along), `at ${String(along)}`).toBeLessThan(20);
    }
  });

  it('takes out one stray sample of the shore, and keeps a cove two wide', () => {
    // The shore 15 m out, but for a dry notch 8 m along at 1 000 m, one
    // sample's worth, where the water starts 80 m out; and a cove 60 m along
    // at 1 300 m where it starts 50 m out.
    const land = landClassMask(
      corridorOf([
        seaBeside(800, 996, 15),
        seaBeside(996, 1_004, 80),
        seaBeside(1_004, 1_270, 15),
        seaBeside(1_270, 1_330, 50),
        seaBeside(1_330, 1_600, 15),
      ]),
    );
    expect(waterSeenFrom(land, 1_000)).toBeLessThan(20);
    expect(Math.abs(waterSeenFrom(land, 1_300) - 50)).toBeLessThan(5);
  });
});

describe('#2754 a beach inside a park or a town is a beach', () => {
  /** A park or a town from the road's edge out to 200 m, and a beach inside it from 20 to 90 m. */
  function beachInside(kind: string, extra: readonly LandUseFeature[] = []): LandUseFeature[] {
    return [
      landBeside(LEVEL, ORIGIN, 'landuse', kind, 600, 1_800, 4, 200),
      landBeside(LEVEL, ORIGIN, 'landuse', 'beach', 800, 1_600, 20, 90),
      ...extra,
    ];
  }

  it('classes the beach as sand whichever is painted first, and a pier across it as paved', () => {
    for (const kind of ['park', 'residential', 'grass', 'nature_reserve']) {
      for (const order of [0, 1]) {
        const features = beachInside(kind, [
          landBeside(LEVEL, ORIGIN, 'landuse', 'pier', 1_300, 1_310, 20, 90),
        ]);
        const land = landClassMask(corridorOf(order === 0 ? features : features.reverse()));
        const [x, z] = besideRoad(LEVEL, ORIGIN, 1_100, 50);
        expect(land.classAt(x, z), `${kind}, order ${String(order)}`).toBe('bare');
        expect(land.bareSurfaceAt(x, z)).toBe('sand');
        const [px, pz] = besideRoad(LEVEL, ORIGIN, 1_305, 50);
        expect(land.bareSurfaceAt(px, pz)).toBe('paved');
        // The park or town round it keeps its own class.
        const [ox, oz] = besideRoad(LEVEL, ORIGIN, 1_100, 150);
        expect(land.classAt(ox, oz)).not.toBe('bare');
      }
    }
  });

  it('draws the ground on a beach inside a park as sand, with no park tree on it', () => {
    const land = landClassMask(corridorOf(beachInside('park')));
    const frame = frameAt(LEVEL, 1_200, land);
    const { fields, surfaces } = frame.terrain.mesh;
    const sand = BARE_SURFACES.indexOf('sand') + 1;
    let onBeach = 0;
    for (let at = 0; at * 2 < fields.length; at += 1) {
      const along = fields[at * 2] as number;
      const lateral = fields[at * 2 + 1] as number;
      if (along < 1_000 || along > 1_400 || lateral < 30 || lateral > 80) continue;
      onBeach += 1;
      expect(surfaces[at], `at ${String(along)}, ${String(lateral)}`).toBe(sand);
    }
    expect(onBeach).toBeGreaterThan(20);
    // The road runs north up `z` from the origin, its right toward `-x`.
    const [rightX, aheadZ] = besideRoad(LEVEL, ORIGIN, 1_200, 50);
    expect(rightX).toBeCloseTo(-50, 3);
    expect(Math.abs(aheadZ - 1_200)).toBeLessThan(2);
    // A mask cell in from the beach's edges.
    const planted = frame.scatter.filter(
      (item) => item.z > 800 && item.z < 1_600 && -item.x > 25 && -item.x < 85,
    );
    expect(planted).toEqual([]);
    // The control: the park between the road and the beach is planted, so the
    // filter above reads something.
    const inPark = frame.scatter.filter(
      (item) => item.z > 800 && item.z < 1_600 && -item.x > 5 && -item.x < 18,
    );
    expect(inPark.length).toBeGreaterThan(0);
  });

  it('still drops a mapped building on a beach inside a park, and keeps one in a town', () => {
    // ADR 0054 D-5.2: never in a park, whatever else is true. A beach inside
    // one reads as sand since #2754, and is still inside the park.
    const house = buildingBeside(LEVEL, ORIGIN, [rectangleBeside(1_200, 50, 10, 8)], 6);
    const plansIn = (kind: string) => {
      const corridor = corridorOf(beachInside(kind), { buildings: [house] });
      return footprintPlans(corridor, landClassMask(corridor), LEVEL, ORIGIN);
    };
    const park = plansIn('park');
    expect(park.plans).toEqual([]);
    expect(park.verdicts['on-excluded-land']).toBe(1);
    expect(plansIn('residential').plans).toHaveLength(1);
  });
});
