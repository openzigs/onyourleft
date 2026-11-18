// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The realistic world on the coast — #2728: the sea beside a long coast road,
 * houses standing in drawn water, and people walking above the drawn ground.
 *
 * Every fixture is arithmetic beside a straight test road: no OpenStreetMap
 * data, no tile, and nothing here is a real place. The public place each was
 * found at is in the PR, never the owner's route. Each case is read back
 * through what a ride draws — `sceneFrame` handed the ride's mask and corridor,
 * as `GameView` hands them, its water surface and its ground mesh — because
 * the defect is a thing one module places and another draws differently.
 */

import { describe, expect, it } from 'vitest';

import { metres, seconds, type RouteProfile } from '@onyourleft/domain';
import type { LandUseFeature, PathFeature } from '@onyourleft/map-features';

import { buildingBeside, landBeside, rectangleBeside } from './footprint-fixtures-testing';
import { footprintPlans } from './footprint-buildings';
import { landClassMask, NO_LAND_CLASS, type LandClassMask } from './land-class';
import { NO_PEOPLE, PEOPLE_NEAR_MAX, type Person } from './people';
import { northRoute, valleyRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin, drawnRoadFrame } from './terrain';
import { waterways } from './waterways';
import type { WorldCorridor } from './world-data/corridor';

/** A corridor over `profile`'s ground, one covered box, holding what it is given. */
function corridorOf(
  profile: RouteProfile,
  landUse: readonly LandUseFeature[],
  extra: Partial<WorldCorridor> = {},
): WorldCorridor {
  return {
    routeId: 'coast',
    origin: corridorOrigin(profile),
    covered: () => true,
    coveredBoxes: [{ minX: -3_000, maxX: 3_000, minZ: -1_000, maxZ: 9_000 }],
    landUse,
    buildings: [],
    paths: [],
    streets: [],
    ...extra,
  };
}

function frameAt(
  profile: RouteProfile,
  odometer: number,
  land: LandClassMask,
  extra: Partial<Parameters<typeof sceneFrame>[0]> = {},
): ReturnType<typeof sceneFrame> {
  const start = atStartLine(profile);
  return sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: { ...start, ride: { ...start.ride, distance: metres(odometer) } },
    landClass: land,
    ...extra,
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

describe('the sea beside a long coast road is read the whole way — #2728', () => {
  /**
   * 70 tiles of a coast, a kilometre each, each with a jagged 1 024-vertex
   * land-use polygon over it (a field's, standing in for the marshes and
   * towns a coast's tiles are dense with) and then the sea on the road's right from 30 m out, as a tile
   * decodes: `landuse` first, then `water`. The polygons cost about 524 000
   * steps a tile (1 024 edges, 64 rows, 8 chunks), 37 million in all — more than the 20 million a whole
   * corridor had before #2728, which ran out about 38 km along.
   */
  const TILES = 70;
  const COAST = northRoute(TILES * 1_000 + 100, () => 3);
  const ORIGIN = corridorOrigin(COAST);
  const boxes = Array.from({ length: TILES }, (_, tile) => ({
    minX: -600,
    maxX: 600,
    minZ: tile * 1_000,
    maxZ: (tile + 1) * 1_000,
  }));
  /** A jagged ring filling `box` on the road's left, `vertices` points. */
  function dense(box: (typeof boxes)[number], vertices: number): LandUseFeature {
    const ring = new Float32Array(vertices * 2);
    for (let i = 0; i < vertices; i += 1) {
      const angle = (i / vertices) * 2 * Math.PI;
      const radius = i % 2 === 0 ? 0.5 : 0.45;
      ring[i * 2] = 300 + Math.cos(angle) * radius * 600;
      ring[i * 2 + 1] = (box.minZ + box.maxZ) / 2 + Math.sin(angle) * radius * 1_000;
    }
    return { layer: 'landuse', kind: 'farmland', rings: [ring] };
  }
  const landUse = boxes.flatMap((box, tile) => [
    dense(box, 1_024),
    landBeside(COAST, ORIGIN, 'water', 'ocean', tile * 1_000, (tile + 1) * 1_000, 30, 600),
  ]);
  const MASK = landClassMask({ ...corridorOf(COAST, landUse), coveredBoxes: boxes });

  it('holds the sea in the mask at the far end as at the near', () => {
    for (const along of [500, 35_500, TILES * 1_000 - 500]) {
      const [x, z] = [-100, along];
      expect(MASK.classAt(x, z)).toBe('water');
    }
  });

  it('finds the sea beside the road at the far end and draws its surface there', () => {
    const lakes = waterways(COAST, scatterSeed(COAST), MASK).lakes.filter(
      (lake) => lake.side === 1,
    );
    expect(lakes.length).toBeGreaterThan(0);
    expect(Math.max(...lakes.map((lake) => lake.to))).toBeGreaterThan(TILES * 1_000 - 100);
    const surface = frameAt(COAST, TILES * 1_000 - 600, MASK).water.surface;
    expect(surface.indices.length).toBeGreaterThan(0);
  });
});

describe('no mapped house stands in the drawn water — #2728', () => {
  /** A level road 3 km north, 10 m up: no valley, so no invented water at all. */
  const LEVEL = northRoute(3_000, () => 10);
  const ORIGIN = corridorOrigin(LEVEL);
  /**
   * The sea on the right from 30 m out, from 800 to 1 600 m, but for a dry
   * notch in its far bank from 1 196 to 1 204 m: there the water stops at
   * 185 m and a residential plot runs on to 200 m. The notch is one sample of
   * the road long, and a mapped lake's shore is the middle of each sample's
   * and its neighbours' since #2754 (its run's median, 20 m either way,
   * before), so the lake is drawn to its far shore either side, about 200 m,
   * over the plot.
   */
  const sea: LandUseFeature[] = [
    landBeside(LEVEL, ORIGIN, 'water', 'ocean', 800, 1_196, 30, 200),
    landBeside(LEVEL, ORIGIN, 'water', 'ocean', 1_196, 1_204, 30, 185),
    landBeside(LEVEL, ORIGIN, 'water', 'ocean', 1_204, 1_600, 30, 200),
  ];
  const plot = landBeside(LEVEL, ORIGIN, 'landuse', 'residential', 1_196, 1_204, 185, 200);
  /** A house on the plot, 190 to 196 m out from 1 197 to 1 203 m: on the map's land. */
  const house = buildingBeside(LEVEL, ORIGIN, [rectangleBeside(1_200, 193, 6, 6)], 6);

  function plansOf(landUse: readonly LandUseFeature[]) {
    const corridor = corridorOf(LEVEL, landUse, { buildings: [house] });
    const land = landClassMask(corridor);
    return { land, ...footprintPlans(corridor, land, LEVEL, ORIGIN) };
  }

  it('drops a house on the map’s land where the lake is drawn over it', () => {
    const { land, plans, verdicts } = plansOf([...sea, plot]);
    // The map says land under the house, and the scene draws water over it.
    expect(land.classAt(-193, 1_200)).toBe('built-up');
    const { vertices, indices } = frameAt(LEVEL, 1_200, land).water.surface;
    expect(Number.isNaN(drawnTop(vertices, indices, -193, 1_200))).toBe(false);
    expect(plans).toEqual([]);
    expect(verdicts['on-excluded-land']).toBe(1);
  });

  it('drops a house whose middle is dry but whose corner is under the drawn water', () => {
    // 199 to 209 m out: the lake is drawn to its far shore, 198.5 m, and 2 m past it.
    const straddling = buildingBeside(LEVEL, ORIGIN, [rectangleBeside(1_200, 204, 10, 10)], 6);
    const corridor = corridorOf(LEVEL, [...sea, plot], { buildings: [straddling] });
    const land = landClassMask(corridor);
    const { vertices, indices } = frameAt(LEVEL, 1_200, land).water.surface;
    expect(Number.isNaN(drawnTop(vertices, indices, -204, 1_200))).toBe(true);
    expect(Number.isNaN(drawnTop(vertices, indices, -199.2, 1_200))).toBe(false);
    expect(footprintPlans(corridor, land, LEVEL, ORIGIN).plans).toEqual([]);
  });

  it('plans the same house with no sea beside it — the control', () => {
    const { plans } = plansOf([plot]);
    expect(plans).toHaveLength(1);
  });
});

describe('no mapped house stands on an invented stream’s drawn surface — #2728', () => {
  // #459's valley: an invented stream crosses under the road at its floor. A mapped
  // town may stand around it (#2691 keeps an invented crossing in a mapped stretch),
  // and a house on the stream's surface strip stood in the drawn water.
  const valley = valleyRoute();
  const origin = corridorOrigin(valley);
  const crossing = waterways(valley, scatterSeed(valley), NO_LAND_CLASS).crossings[0];
  if (crossing === undefined) throw new Error('the valley has no stream');

  function verdictsAt(along: number) {
    const house = buildingBeside(valley, origin, [rectangleBeside(along, 40, 10, 6)], 6);
    const corridor = corridorOf(valley, [], { buildings: [house] });
    return footprintPlans(corridor, NO_LAND_CLASS, valley, origin).verdicts;
  }

  it('drops a house on the stream’s surface strip', () => {
    expect(verdictsAt(crossing.distance)['on-excluded-land']).toBe(1);
  });

  it('does not drop the same house beyond the strip — the control', () => {
    expect(verdictsAt(crossing.distance + 60)['on-excluded-land'] ?? 0).toBe(0);
  });
});

describe('people on the coast stand on the drawn ground, never in the sky — #2728', () => {
  const LEVEL = northRoute(3_000, () => 10);
  const ORIGIN = corridorOrigin(LEVEL);

  /** A mapped footway through `(along, lateral)` pairs. */
  function footway(pairs: readonly (readonly [number, number])[]): PathFeature {
    const points: number[] = [];
    for (const [along, lateral] of pairs) {
      const road = drawnRoadFrame(LEVEL, ORIGIN, along);
      if (road === undefined) throw new Error('the fixture road has no direction there');
      points.push(road.x + road.normalX * lateral, road.z + road.normalZ * lateral);
    }
    return { kind: 'path', kindDetail: 'footway', line: Float32Array.from(points) };
  }

  /** Everybody a frame at 1 200 m draws over 200 seconds of the ride, with the ground under each. */
  function walkers(
    paths: readonly PathFeature[],
    land: LandClassMask,
    landUse: readonly LandUseFeature[] = [],
  ): { person: Person; ground: number; water: number }[] {
    const corridor = corridorOf(LEVEL, landUse, { paths });
    const seen: { person: Person; ground: number; water: number }[] = [];
    for (let second = 0; second < 200; second += 5) {
      const start = atStartLine(LEVEL);
      const frame = sceneFrame({
        profile: LEVEL,
        origin: ORIGIN,
        state: {
          ...start,
          ride: { ...start.ride, distance: metres(1_200) },
          elapsed: seconds(second),
          ridden: seconds(second),
        },
        landClass: land,
        worldCorridor: corridor,
        people: PEOPLE_NEAR_MAX,
      });
      // Read at once: the mesh and the surface are lent to the next frame.
      const { vertices, indices } = frame.terrain.mesh;
      const water = frame.water.surface;
      for (const person of [
        ...(frame.people ?? NO_PEOPLE).near,
        ...(frame.people ?? NO_PEOPLE).far,
      ]) {
        seen.push({
          person,
          ground: drawnTop(vertices, indices, person.x, person.z),
          water: drawnTop(water.vertices, water.indices, person.x, person.z),
        });
      }
    }
    return seen;
  }

  it('stands each walker of a long straight path on the ground drawn under them', () => {
    // One straight footway 60 m out, mapped by its two ends 400 m apart, as a
    // beach path is: the ground's relief rises and falls between them.
    const seen = walkers(
      [
        footway([
          [1_000, 60],
          [1_400, 60],
        ]),
      ],
      NO_LAND_CLASS,
    );
    expect(seen.length).toBeGreaterThan(20);
    for (const { person, ground } of seen) {
      expect(Number.isNaN(ground)).toBe(false);
      expect(Math.abs(person.y - ground)).toBeLessThan(0.01);
    }
  });

  it('puts nobody on the drawn water, and walks the same pier with no sea — the control', () => {
    // A pier from the verge straight out over the sea, 30 to 200 m out.
    const pier = footway(Array.from({ length: 70 }, (_, at) => [1_200, 8 + at * 2] as const));
    const sea = landBeside(LEVEL, ORIGIN, 'water', 'ocean', 800, 1_600, 30, 200);
    const land = landClassMask(corridorOf(LEVEL, [sea]));
    // And its twin on the dry left, which keeps its walkers.
    const left = footway(Array.from({ length: 70 }, (_, at) => [1_200, -(8 + at * 2)] as const));
    const wet = walkers([pier, left], land, [sea]);
    expect(wet.filter(({ person }) => person.x > 40).length).toBeGreaterThan(0);
    for (const { water } of wet) expect(Number.isNaN(water)).toBe(true);
    const dry = walkers([pier], NO_LAND_CLASS);
    expect(dry.filter(({ person }) => -person.x > 40).length).toBeGreaterThan(0);
  });

  it('walks a boardwalk over a mapped marsh, which has no open water', () => {
    const pier = footway(Array.from({ length: 70 }, (_, at) => [1_200, 8 + at * 2] as const));
    const marsh = landBeside(LEVEL, ORIGIN, 'landuse', 'wetland', 800, 1_600, 30, 200);
    const land = landClassMask(corridorOf(LEVEL, [marsh]));
    expect(waterways(LEVEL, scatterSeed(LEVEL), land).lakes[0]?.wetland).toBe(true);
    const seen = walkers([pier], land, [marsh]);
    expect(seen.filter(({ person }) => -person.x > 40).length).toBeGreaterThan(0);
  });

  it('puts nobody on a stream’s drawn surface beside the road, which the footway crosses', () => {
    // #459's valley: an invented stream crosses under the road at its floor.
    const valley = valleyRoute();
    const origin = corridorOrigin(valley);
    const crossing = waterways(valley, scatterSeed(valley), NO_LAND_CLASS).crossings[0];
    if (crossing === undefined) throw new Error('the valley has no stream');
    const points: number[] = [];
    for (let at = crossing.distance - 60; at <= crossing.distance + 60; at += 2) {
      const road = drawnRoadFrame(valley, origin, at) as NonNullable<
        ReturnType<typeof drawnRoadFrame>
      >;
      points.push(road.x + road.normalX * 30, road.z + road.normalZ * 30);
    }
    const path: PathFeature = {
      kind: 'path',
      kindDetail: 'footway',
      line: Float32Array.from(points),
    };
    let over = 0;
    let walked = 0;
    for (let second = 0; second < 300; second += 3) {
      const start = atStartLine(valley);
      const frame = sceneFrame({
        profile: valley,
        origin,
        state: {
          ...start,
          ride: { ...start.ride, distance: metres(crossing.distance) },
          elapsed: seconds(second),
          ridden: seconds(second),
        },
        worldCorridor: corridorOf(valley, [], { paths: [path] }),
        people: PEOPLE_NEAR_MAX,
      });
      const water = frame.water.surface;
      if (second === 0) {
        // Non-vacuity: the footway does cross the stream's drawn surface.
        let wet = 0;
        for (let at = 0; at + 1 < points.length; at += 2) {
          const y = drawnTop(
            water.vertices,
            water.indices,
            points[at] as number,
            points[at + 1] as number,
          );
          if (!Number.isNaN(y)) wet += 1;
        }
        expect(wet).toBeGreaterThan(5);
      }
      for (const person of [
        ...(frame.people ?? NO_PEOPLE).near,
        ...(frame.people ?? NO_PEOPLE).far,
      ]) {
        walked += 1;
        if (!Number.isNaN(drawnTop(water.vertices, water.indices, person.x, person.z))) over += 1;
      }
    }
    expect(walked).toBeGreaterThan(0);
    expect(over).toBe(0);
  });
});
