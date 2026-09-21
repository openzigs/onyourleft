// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `landform.ts` — the ground beside the road, #458.
 *
 * What is asserted here is arithmetic over the mesh `terrainCorridor` builds —
 * the same arrays `three-renderer.ts` uploads — so a claim about "the ground"
 * is a claim about triangles a driver is handed. What a driver then does with
 * them is `game.browser.spec.ts` §"the gradient shows beside the road", which
 * reads pixels back with the flat quad this replaced as its control.
 */

import { describe, expect, it } from 'vitest';

import { elevationAt, metres, type RouteProfile } from '@onyourleft/domain';

import {
  BEND_FOLD_SHARE,
  HORIZON_RISE_METRES,
  HORIZON_SEGMENTS,
  RELIEF_CLEAR_METRES,
  RELIEF_MAX_METRES,
  TERRAIN_BANDS,
  TERRAIN_COLUMN_OFFSETS,
  VERGE_DROP_METRES,
  ROAD_CLEARANCE_METRES,
  horizonRelief,
  terrainCorridor,
  terrainHeightAt,
  type TerrainMesh,
} from './landform';
import {
  circuitRoute,
  hairpinRoute,
  hillRoute,
  northRoute,
  rollingRoute,
  steadyClimb,
} from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { ROAD_COLUMNS, corridorOrigin, roadCorridor, type RoadCorridor } from './terrain';

const COLUMNS = TERRAIN_COLUMN_OFFSETS.length;

/**
 * Whether a point is within `within` metres of a stretch of the corridor's
 * road other than the two segments either side of `row` — the road it was
 * built beside.
 */
function nearOtherRoad(
  corridor: RoadCorridor,
  row: number,
  x: number,
  z: number,
  within: number,
): boolean {
  const centre = corridor.centre;
  for (let segment = 0; segment + 1 < centre.length; segment += 1) {
    if (segment === row || segment === row - 1) continue;
    const from = centre[segment];
    const to = centre[segment + 1];
    if (from === undefined || to === undefined) continue;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const span = dx * dx + dz * dz;
    const t =
      span > 0 ? Math.min(1, Math.max(0, ((x - from.x) * dx + (z - from.z) * dz) / span)) : 0;
    if (Math.hypot(x - (from.x + dx * t), z - (from.z + dz * t)) < within) return true;
  }
  return false;
}

/**
 * How far a thing may stand off the drawn ground on a SMOOTH profile: **15 cm**
 * — the tolerance the scenery is held to on the rolling route and the circuit,
 * which is what a real route's despiked grid looks like. Measured between 10
 * and 15 cm: the cross-slope follows the gradient's magnitude, which turns
 * over at every crest and trough (`landform.ts` §`TILT_ROUNDING_GRADE` rounds
 * the corner; before it this read 15.2 cm), and a row that spans the turn cuts
 * it.
 */
const SMOOTH_STANDING_TOLERANCE_METRES = 0.15;

/**
 * How far a thing may stand off the drawn ground on #458's own hill, whose
 * corners are the worst a grid can hold: **50 cm**.
 *
 * ⚠️ Not zero because the mesh's rows are wherever the odometer put them
 * (`terrain.ts` §`roadCorridor`), not on the profile's grid, so a row that
 * spans a kink in the road's elevation cuts its corner — and #458's own
 * fixture has the worst kink a route can: +10 % to −10 % in one grid step at
 * its crest. Measured at up to 21 cm there before the cross-slope, and 32 cm
 * since, and 42 cm under the scenery — the corner the road cuts at the foot of
 * the climb, with the cross-slope turning with the gradient on top of it. The
 * road is drawn from
 * the same rows and cuts the same corner, so a rider sees the tree and the
 * tarmac beside it move together.
 */
const STANDING_TOLERANCE_METRES = 0.5;

/** The corridor and the ground built from it, at an odometer reading. */
function frameAt(
  profile: RouteProfile,
  odometer: number,
): { readonly corridor: RoadCorridor; readonly ground: TerrainMesh } {
  const corridor = roadCorridor(profile, corridorOrigin(profile), odometer);
  return { corridor, ground: terrainCorridor(profile, corridor, scatterSeed(profile)) };
}

/** One vertex of the ground, as a point. */
function groundVertex(
  ground: TerrainMesh,
  row: number,
  side: number,
  column: number,
): readonly [number, number, number] {
  const at = (row * COLUMNS * 2 + side * COLUMNS + column) * 3;
  return [
    ground.vertices[at] as number,
    ground.vertices[at + 1] as number,
    ground.vertices[at + 2] as number,
  ];
}

/** One vertex of the road's surface, as a point. */
function roadVertex(corridor: RoadCorridor, row: number, column: number): readonly number[] {
  const at = (row * ROAD_COLUMNS + column) * 3;
  return [...corridor.vertices.slice(at, at + 3)];
}

/**
 * The ground's height at a point in plan, read off the TRIANGLES — what a
 * driver draws — rather than off `terrainHeightAt`, which is the other half of
 * the comparison below.
 */
function meshHeightAt(ground: TerrainMesh, x: number, z: number): number | undefined {
  return heightOver(ground, x, z, -1e-6);
}

/**
 * The height of whichever triangle of a mesh covers a point in plan, or
 * `undefined`. `inside` is how far inside every edge the point must be, as a
 * barycentric share: negative admits the edges themselves.
 */
function heightOver(
  mesh: { readonly vertices: Float32Array; readonly indices: Uint32Array },
  x: number,
  z: number,
  inside: number,
): number | undefined {
  const { vertices, indices } = mesh;
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const [a, b, c] = [indices[at], indices[at + 1], indices[at + 2]].map(
      (index) => (index as number) * 3,
    ) as [number, number, number];
    const ax = vertices[a] as number;
    const az = vertices[a + 2] as number;
    const bx = vertices[b] as number;
    const bz = vertices[b + 2] as number;
    const cx = vertices[c] as number;
    const cz = vertices[c + 2] as number;
    const area = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
    if (Math.abs(area) < 1e-9) continue;
    const u = ((bx - x) * (cz - z) - (cx - x) * (bz - z)) / area;
    const v = ((cx - x) * (az - z) - (ax - x) * (cz - z)) / area;
    const w = 1 - u - v;
    if (u < inside || v < inside || w < inside) continue;
    return (
      u * (vertices[a + 1] as number) +
      v * (vertices[b + 1] as number) +
      w * (vertices[c + 1] as number)
    );
  }
  return undefined;
}

describe('the ground meets the road — #458, and #440’s lesson', () => {
  const cases: readonly (readonly [string, RouteProfile, number])[] = [
    ['a point-to-point route at distance 0', hillRoute(), 0],
    ['the same route at its very end', hillRoute(), 1_800],
    ['on the climb', hillRoute(), 500],
    ['a loop, across its wrap', circuitRoute(120), 2 * Math.PI * 120 - 30],
    ['a loop, on lap three', circuitRoute(120), 2 * (2 * Math.PI * 120) + 10],
    ['a hairpin', hairpinRoute(25), 430],
  ];
  it.each(cases)('coincides with the road’s own edge to the bit, %s', (_name, profile, at) => {
    const { corridor, ground } = frameAt(profile, at);

    expect(ground.rows).toBe(corridor.centre.length);
    for (let row = 0; row < ground.rows; row += 1) {
      // Left side against the road's column 0, right against its column 5.
      expect(groundVertex(ground, row, 0, 0)).toEqual(roadVertex(corridor, row, 0));
      expect(groundVertex(ground, row, 1, 0)).toEqual(roadVertex(corridor, row, ROAD_COLUMNS - 1));
    }
  });
});

describe('the ground never rises into the carriageway — #458', () => {
  it('stays at or below the road within the clear band, on every row of every route', () => {
    let checked = 0;
    for (const profile of [hillRoute(), circuitRoute(60), hairpinRoute(20), steadyClimb()]) {
      for (let at = 0; at < profile.totalDistance; at += 97) {
        const { corridor, ground } = frameAt(profile, at);
        for (let row = 0; row < ground.rows; row += 1) {
          const road = corridor.centre[row]?.y ?? 0;
          for (let side = 0; side < 2; side += 1) {
            for (let column = 0; column < COLUMNS; column += 1) {
              if ((TERRAIN_COLUMN_OFFSETS[column] as number) > RELIEF_CLEAR_METRES) continue;
              // Float32 against a double: a millimetre of rounding, never more.
              expect(groundVertex(ground, row, side, column)[1]).toBeLessThanOrEqual(road + 1e-3);
              checked += 1;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  it('never stands over ANY part of the road it is drawn beside, in plan', () => {
    // ⚠️ The stronger statement, and the one a bend can break: a vertex of one
    // row's cross-section that lands over a DIFFERENT row's carriageway must
    // still be under it. Folding on the inside of a bend is exactly that
    // failure, which is what `BEND_FOLD_SHARE` is for. Judged against the
    // road's own TRIANGLES — the carriageway a driver draws — rather than
    // against a distance from the centreline, which a tight bend's chords make
    // shorter than the road is wide.
    let over = 0;
    for (const profile of [
      circuitRoute(40),
      circuitRoute(80),
      hairpinRoute(15),
      hairpinRoute(30),
    ]) {
      for (let at = 0; at < profile.totalDistance; at += 131) {
        const { corridor, ground } = frameAt(profile, at);
        const surface = {
          vertices: corridor.vertices,
          indices: corridor.indices.slice(0, (corridor.centre.length - 1) * 3 * 6),
        };
        for (let vertex = 0; vertex < ground.vertices.length / 3; vertex += 1) {
          // ⚠️ **Not the road's edge or the foot of its verge**, which are the
          // road's own and are pinned to it by the case above. On a bend
          // tighter than about 20 m the chord of the road's inner edge bows a
          // few centimetres inward past the verge's foot, so that vertex sits
          // just inside a neighbouring row's triangle at a height the grade
          // over one row can differ by. Measured: 17 cm above it on a 15 m
          // hairpin at 4 %, a centimetre from the edge. Everything from the
          // first column out is held to the rule.
          if (vertex % COLUMNS < 2) continue;
          const x = ground.vertices[vertex * 3] as number;
          const z = ground.vertices[vertex * 3 + 2] as number;
          const row = Math.floor(vertex / (COLUMNS * 2));
          if (nearOtherRoad(corridor, row, x, z, 2 * ROAD_CLEARANCE_METRES)) over += 1;
          const road = heightOver(surface, x, z, 1e-3);
          if (road === undefined) continue;
          expect(ground.vertices[vertex * 3 + 1] as number).toBeLessThanOrEqual(road + 1e-3);
        }
      }
    }
    // Non-vacuity: the fixtures really do bring ground up to ANOTHER stretch
    // of the road — the far leg of a hairpin, the inside of a tight turn — so
    // the assertion above had something to refuse.
    expect(over).toBeGreaterThan(50);
  });

  it('folds the inside of a bend in, on the correct side', () => {
    // `hairpinRoute` turns RIGHT, so its right side (side 1) is the inside.
    const radius = 25;
    const profile = hairpinRoute(radius);
    const rider = 400 + (Math.PI * radius) / 2;
    const { corridor, ground } = frameAt(profile, rider);
    // The row nearest the rider, who is half way round the bend.
    let mid = 0;
    corridor.centre.forEach((point, row) => {
      if (Math.abs(point.along - rider) < Math.abs((corridor.centre[mid]?.along ?? 0) - rider)) {
        mid = row;
      }
    });
    const outermost = COLUMNS - 1;
    const reachOf = (side: number): number => {
      const [x, , z] = groundVertex(ground, mid, side, outermost);
      const centre = corridor.centre[mid];
      return Math.hypot(x - (centre?.x ?? 0), z - (centre?.z ?? 0));
    };
    expect(reachOf(1)).toBeLessThanOrEqual(radius * BEND_FOLD_SHARE * 1.5);
    expect(reachOf(0)).toBeCloseTo(TERRAIN_COLUMN_OFFSETS[outermost] as number, 3);
  });
});

describe('the gradient shows beside the road — #458', () => {
  it('stands the ground beside a 10 % climb above the rider, and beside a descent below', () => {
    const profile = hillRoute();
    const origin = corridorOrigin(profile);
    const seed = scatterSeed(profile);
    // Inside the first stretch of relief, where it is at most ±0.54 m: the
    // claim is about the road's own gradient, not about the invented hills.
    for (const lateral of [13, 15, -13, -15]) {
      // 100 m into the climb, and 40 m further up it.
      const rider = elevationAt(profile, 400) - origin.elevation;
      expect(terrainHeightAt(profile, origin, seed, 440, lateral)).toBeGreaterThan(rider + 2);
      // 100 m into the descent, and 40 m further down it.
      const descending = elevationAt(profile, 900) - origin.elevation;
      expect(terrainHeightAt(profile, origin, seed, 940, lateral)).toBeLessThan(descending - 2);
    }
  });

  it('is exactly the old flat ground on a level road, near it', () => {
    // The control on the other side: where the road is level the ground beside
    // it is where the flat quad was — 0.25 m under the road — until the relief
    // starts, so nothing about a flat route's near field moved.
    const profile = northRoute(1_000, () => 5);
    const origin = corridorOrigin(profile);
    const seed = scatterSeed(profile);
    for (const lateral of [4.1, 6, 8, 11.9, -4.1, -11.9]) {
      expect(terrainHeightAt(profile, origin, seed, 500, lateral)).toBeCloseTo(
        -VERGE_DROP_METRES,
        9,
      );
    }
  });

  it('matches the triangles a driver is handed, wherever something could stand', () => {
    // `terrainHeightAt` is what the scenery stands at; the mesh is what is
    // drawn. They are the same surface, to the precision of the rows sliding.
    const profile = hillRoute();
    const origin = corridorOrigin(profile);
    const seed = scatterSeed(profile);
    const { ground } = frameAt(profile, 450);
    let sampled = 0;
    for (let along = 420; along < 800; along += 7.3) {
      for (const lateral of [6.5, 9, 13.7, 17, 21.5, -8, -15, -21]) {
        // The route runs due north from the projection's origin, so a point
        // `lateral` to the LEFT of it is `lateral` metres WEST: x = −lateral,
        // and z is the distance along it.
        const height = meshHeightAt(ground, -lateral, along);
        if (height === undefined) continue;
        // @see STANDING_TOLERANCE_METRES — measured at up to 15.5 cm here.
        expect(
          Math.abs(terrainHeightAt(profile, origin, seed, along, lateral) - height),
        ).toBeLessThan(STANDING_TOLERANCE_METRES);
        sampled += 1;
      }
    }
    expect(sampled).toBeGreaterThan(300);
  });
});

describe('the scenery stands on the ground — #458', () => {
  it('puts every item’s base on the triangles drawn under it', () => {
    // ⚠️ **Read off the mesh the frame carries**, not off `terrainHeightAt`,
    // which is what `scatter.ts` places with: the claim is that a tree stands
    // on the ground a rider SEES, and the only independent statement of that
    // is the triangles. Before #458 every item stood at the road's height, so
    // on a hillside it floated or was buried by metres.
    let stood = 0;
    let worst = 0;
    const cases: readonly (readonly [RouteProfile, number])[] = [
      [rollingRoute(), SMOOTH_STANDING_TOLERANCE_METRES],
      [circuitRoute(300), SMOOTH_STANDING_TOLERANCE_METRES],
      [hillRoute(), STANDING_TOLERANCE_METRES],
    ];
    for (const [profile, tolerance] of cases) {
      const origin = corridorOrigin(profile);
      const start = atStartLine(profile);
      for (let at = 0; at < profile.totalDistance; at += 173) {
        const frame = sceneFrame({
          profile,
          origin,
          state: { ...start, ride: { ...start.ride, distance: metres(at) } },
        });
        for (const each of frame.scatter) {
          const ground = meshHeightAt(frame.terrain.mesh, each.x, each.z);
          if (ground === undefined) continue;
          expect(Math.abs(each.y - ground), `${each.kind} at ${String(at)}`).toBeLessThan(
            tolerance,
          );
          if (tolerance === SMOOTH_STANDING_TOLERANCE_METRES) {
            worst = Math.max(worst, Math.abs(each.y - ground));
          }
          stood += 1;
        }
      }
    }
    expect(stood).toBeGreaterThan(500);
    expect(worst).toBeGreaterThan(0);
  });
});

describe('the ground is the same place on every lap — #458', () => {
  it('builds identical heights a whole lap apart', () => {
    const profile = circuitRoute(150);
    const lap = profile.totalDistance;
    const first = frameAt(profile, 123).ground;
    const third = frameAt(profile, 123 + 2 * lap).ground;
    for (let at = 1; at < first.vertices.length; at += 3) {
      expect(third.vertices[at]).toBeCloseTo(first.vertices[at] as number, 3);
    }
  });

  it('is bounded: never more relief than the cap, however long the route', () => {
    const profile = steadyClimb();
    const origin = corridorOrigin(profile);
    const seed = scatterSeed(profile);
    for (let along = 0; along < 3_000; along += 50) {
      const road = elevationAt(profile, along) - origin.elevation;
      const height = terrainHeightAt(profile, origin, seed, along, 420);
      expect(Math.abs(height - (road - VERGE_DROP_METRES))).toBeLessThanOrEqual(
        RELIEF_MAX_METRES + 1e-6,
      );
    }
  });
});

describe('what a quality rung can take away — #458', () => {
  it('orders the triangles innermost band first, so a rung draws a prefix', () => {
    const { ground } = frameAt(hillRoute(), 600);
    const perRow = COLUMNS * 2;
    expect(ground.indices.length).toBe(ground.indicesPerBand * TERRAIN_BANDS);
    for (let band = 0; band < TERRAIN_BANDS; band += 1) {
      const slice = ground.indices.slice(
        band * ground.indicesPerBand,
        (band + 1) * ground.indicesPerBand,
      );
      const columns = new Set([...slice].map((index) => (index % perRow) % COLUMNS));
      expect(
        [...columns].sort((a, b) => a - b),
        `band ${String(band)}`,
      ).toEqual([band, band + 1]);
    }
  });

  it('faces every triangle up, on both sides', () => {
    // three culls back faces, so a triangle wound towards the ground is not
    // drawn at all — and the two sides are mirror images. Every triangle's own
    // winding must agree with the up-pointing normals below.
    for (const profile of [hillRoute(), circuitRoute(80), hairpinRoute(25)]) {
      const { ground } = frameAt(profile, 420);
      let faced = 0;
      for (let at = 0; at + 2 < ground.indices.length; at += 3) {
        const [a, b, c] = [ground.indices[at], ground.indices[at + 1], ground.indices[at + 2]].map(
          (index) => (index as number) * 3,
        ) as [number, number, number];
        const v = ground.vertices;
        const e1 = [0, 1, 2].map((k) => (v[b + k] as number) - (v[a + k] as number));
        const e2 = [0, 1, 2].map((k) => (v[c + k] as number) - (v[a + k] as number));
        // y component of e1 × e2.
        const up = (e1[2] as number) * (e2[0] as number) - (e1[0] as number) * (e2[2] as number);
        const area = Math.hypot(
          (e1[1] as number) * (e2[2] as number) - (e1[2] as number) * (e2[1] as number),
          up,
          (e1[0] as number) * (e2[1] as number) - (e1[1] as number) * (e2[0] as number),
        );
        if (area < 1e-6) continue;
        expect(up).toBeGreaterThan(0);
        faced += 1;
      }
      expect(faced).toBeGreaterThan(1_000);
    }
  });

  it('points every normal up, and tilts it on a hillside', () => {
    const { ground } = frameAt(hillRoute(), 500);
    let tilted = 0;
    for (let at = 0; at < ground.normals.length; at += 3) {
      const y = ground.normals[at + 1] as number;
      expect(y).toBeGreaterThan(0);
      expect(
        Math.hypot(ground.normals[at] as number, y, ground.normals[at + 2] as number),
      ).toBeCloseTo(1, 5);
      if (y < 0.999) tilted += 1;
    }
    expect(tilted).toBeGreaterThan(ground.normals.length / 3 / 2);
  });
});

describe('the distant hills — #458', () => {
  it('stands a ridge above the route’s own middle, lifted by its range', () => {
    const flat = northRoute(2_000, () => 0);
    const alpine = northRoute(2_000, (along) => along * 0.1);
    const ridge = (profile: RouteProfile) =>
      horizonRelief(profile, corridorOrigin(profile), scatterSeed(profile));
    const low = ridge(flat);
    const high = ridge(alpine);
    expect(low.tops).toHaveLength(HORIZON_SEGMENTS);
    for (const top of low.tops) {
      expect(top).toBeGreaterThanOrEqual(HORIZON_RISE_METRES[0] - 1e-3);
      expect(top).toBeLessThanOrEqual(HORIZON_RISE_METRES[1] + 1e-3);
    }
    // The alpine route rises 200 m, so its middle is 100 m up.
    expect(Math.min(...high.tops)).toBeGreaterThan(100 + HORIZON_RISE_METRES[0] - 1);
    expect(low.base).toBeLessThan(low.foot);
    // Not one height all the way round: hills rather than a wall.
    expect(Math.max(...low.tops) - Math.min(...low.tops)).toBeGreaterThan(20);
  });
});
