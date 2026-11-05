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

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  elevationAt,
  geographicPosition,
  metres,
  routeProfile,
  type RouteProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { NO_LAND_CLASS } from './land-class';
import {
  BEND_FOLD_SHARE,
  HORIZON_RISE_METRES,
  HORIZON_SEGMENTS,
  RELIEF_CLEAR_METRES,
  RELIEF_MAX_METRES,
  REACH_TAPER_PER_METRE,
  TERRAIN_BANDS,
  TERRAIN_COLUMN_OFFSETS,
  VERGE_DROP_METRES,
  ROAD_CLEARANCE_METRES,
  horizonRelief,
  standingOnGround,
  terrainCorridor,
  terrainHeightAt,
  type TerrainMesh,
} from './landform';
import {
  circuitRoute,
  hairpinRoute,
  PLANNER_BENDS,
  hillRoute,
  northRoute,
  plannerCornerRoute,
  plannerRoute,
  rollingRoute,
  steadyClimb,
} from './route-fixtures-testing';
import { cameraRig, horizontalSpread, projectToFrame } from './camera';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { ROAD_COLUMNS, corridorOrigin, roadCorridor, type RoadCorridor } from './terrain';
import { waterways } from './waterways';

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
 * How far a thing may stand off the drawn ground on a SMOOTH profile: **20 cm**
 * — the tolerance the scenery is held to on the rolling route and the circuit,
 * which is what a real route's despiked grid looks like. Measured between 10
 * and 15 cm: the cross-slope follows the gradient's magnitude, which turns
 * over at every crest and trough (`landform.ts` §`TILT_ROUNDING_GRADE` rounds
 * the corner; before it this read 15.2 cm), and a row that spans the turn cuts
 * it. ⚠️ Since #459 a stream's channel lies across both fixtures' troughs, and
 * the ground climbing out of it past the bank's top is where the worst is now:
 * 16.3 cm, measured.
 */
const SMOOTH_STANDING_TOLERANCE_METRES = 0.2;

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
  return {
    corridor,
    ground: terrainCorridor(
      profile,
      corridorOrigin(profile),
      corridor,
      scatterSeed(profile),
      NO_LAND_CLASS,
    ),
  };
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
 * The height of the HIGHEST triangle of the ground over a point in plan —
 * the one drawn on top where two overlap — or `undefined` where none is.
 */
function topHeightAt(ground: TerrainMesh, x: number, z: number): number | undefined {
  let top: number | undefined;
  for (const each of heightsOver(ground, x, z, -1e-6)) {
    if (top === undefined || each.height > top) top = each.height;
  }
  return top;
}

/**
 * Every triangle of a mesh over a point in plan: its height there and the
 * row pair it spans (its lowest vertex's row). `inside` is as {@link heightOver}'s.
 */
function heightsOver(
  mesh: { readonly vertices: Float32Array; readonly indices: Uint32Array },
  x: number,
  z: number,
  inside: number,
): { readonly height: number; readonly row: number }[] {
  const { vertices, indices } = mesh;
  const found: { readonly height: number; readonly row: number }[] = [];
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const ia = indices[at] as number;
    const ib = indices[at + 1] as number;
    const ic = indices[at + 2] as number;
    const ax = vertices[ia * 3] as number;
    const az = vertices[ia * 3 + 2] as number;
    const bx = vertices[ib * 3] as number;
    const bz = vertices[ib * 3 + 2] as number;
    const cx = vertices[ic * 3] as number;
    const cz = vertices[ic * 3 + 2] as number;
    if (
      x < Math.min(ax, bx, cx) - 1 ||
      x > Math.max(ax, bx, cx) + 1 ||
      z < Math.min(az, bz, cz) - 1 ||
      z > Math.max(az, bz, cz) + 1
    ) {
      continue;
    }
    const area = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
    if (Math.abs(area) < 1e-9) continue;
    const u = ((bx - x) * (cz - z) - (cx - x) * (bz - z)) / area;
    const v = ((cx - x) * (az - z) - (ax - x) * (cz - z)) / area;
    const w = 1 - u - v;
    if (u < inside || v < inside || w < inside) continue;
    found.push({
      height:
        u * (vertices[ia * 3 + 1] as number) +
        v * (vertices[ib * 3 + 1] as number) +
        w * (vertices[ic * 3 + 1] as number),
      row: Math.floor(Math.min(ia, ib, ic) / (COLUMNS * 2)),
    });
  }
  return found;
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
    // No array per triangle, and a bounding box before any division: since
    // #543 the road has five times the triangles and this is called for every
    // vertex of five times the ground, so the old shape of this loop took the
    // test past its timeout under the coverage run.
    const a = (indices[at] as number) * 3;
    const b = (indices[at + 1] as number) * 3;
    const c = (indices[at + 2] as number) * 3;
    const ax = vertices[a] as number;
    const az = vertices[a + 2] as number;
    const bx = vertices[b] as number;
    const bz = vertices[b + 2] as number;
    const cx = vertices[c] as number;
    const cz = vertices[c + 2] as number;
    if (
      x < Math.min(ax, bx, cx) - 1 ||
      x > Math.max(ax, bx, cx) + 1 ||
      z < Math.min(az, bz, cz) - 1 ||
      z > Math.max(az, bz, cz) + 1
    ) {
      continue;
    }
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
      // Side 0 — the normal's, the right since #583 — against the road's
      // column 0, side 1 against its column 5.
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
    // ⚠️ A timeout of its own since #543, which gave the corridor about 2.8
    // times the rows: every ground vertex is judged against every road
    // triangle, so the work grows with the square of that. A first cut with
    // five times the rows passed 5 s under the coverage run (5.7 s, measured);
    // the precedent is `line-on-the-road.test.ts`.
  }, 30_000);

  it('folds the inside of a bend in, on the correct side', () => {
    // `hairpinRoute` turns RIGHT, so its right side is the inside — side 0,
    // the normal's, since #583. Until then the world was a mirror of its map,
    // this hairpin was drawn turning left, and side 1 was the inside.
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
    expect(reachOf(0)).toBeLessThanOrEqual(radius * BEND_FOLD_SHARE * 1.5);
    expect(reachOf(1)).toBeCloseTo(TERRAIN_COLUMN_OFFSETS[outermost] as number, 3);
  });
});

describe('a fold tapers back rather than standing up as a wall — #2096', () => {
  // A planner's GPX, simplified, with a 90° bend of 60 m among its four
  // (`route-fixtures-testing.ts` §`plannerRoute`), both ways round so each side
  // is the inside of a bend. It is level, so every metre of height off the road
  // here is the invented relief: the wall #2096 found was that relief, stood
  // on end between a folded row and the full row two metres on.
  const planners: readonly (readonly [string, RouteProfile])[] = [
    ["a planner's route", plannerRoute()],
    ["a planner's route, mirrored", plannerRoute({ mirrored: true })],
  ];

  /** How far a row's outermost column stands from its own centreline point. */
  const reachOf = (
    corridor: RoadCorridor,
    ground: TerrainMesh,
    row: number,
    side: number,
  ): number => {
    const [x, , z] = groundVertex(ground, row, side, COLUMNS - 1);
    const centre = corridor.centre[row];
    return Math.hypot(x - (centre?.x ?? 0), z - (centre?.z ?? 0));
  };

  /** The plan distance from a point to the nearest stretch of the corridor's road. */
  const fromRoad = (corridor: RoadCorridor, x: number, z: number): number => {
    const centre = corridor.centre;
    let nearest = Number.POSITIVE_INFINITY;
    for (let segment = 0; segment + 1 < centre.length; segment += 1) {
      const from = centre[segment] as (typeof centre)[number];
      const to = centre[segment + 1] as (typeof centre)[number];
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const span = dx * dx + dz * dz;
      const t =
        span > 0 ? Math.min(1, Math.max(0, ((x - from.x) * dx + (z - from.z) * dz) / span)) : 0;
      nearest = Math.min(nearest, Math.hypot(x - (from.x + dx * t), z - (from.z + dz * t)));
    }
    return nearest;
  };

  it.each(planners)(
    'changes a side’s reach by at most the taper times the road between two rows, %s',
    (_name, profile) => {
      let folded = 0;
      for (let at = 0; at < profile.totalDistance; at += 23) {
        const { corridor, ground } = frameAt(profile, at);
        for (let row = 0; row + 1 < ground.rows; row += 1) {
          const from = corridor.centre[row];
          const to = corridor.centre[row + 1];
          const apart = Math.hypot((to?.x ?? 0) - (from?.x ?? 0), (to?.z ?? 0) - (from?.z ?? 0));
          for (let side = 0; side < 2; side += 1) {
            const here = reachOf(corridor, ground, row, side);
            if (here < 100) folded += 1;
            // A centimetre for Float32 vertices a kilometre from the origin.
            expect(
              Math.abs(reachOf(corridor, ground, row + 1, side) - here),
              `row ${String(row)}, side ${String(side)}, at ${String(at)}`,
            ).toBeLessThanOrEqual(REACH_TAPER_PER_METRE * apart + 1e-2);
          }
        }
      }
      // Non-vacuity: the sweep really does ride through folds, where the reach
      // drops from 420 m to a fraction of a bend's radius.
      expect(folded).toBeGreaterThan(100);
    },
  );

  it.each([
    ['hairpinRoute(25) at 133', hairpinRoute(25), 133],
    ['hairpinRoute(40) at 400', hairpinRoute(40), 400],
  ] as const)(
    'never stands over the far leg of a hairpin once tapered, %s',
    (_name, profile, at) => {
      // ⚠️ The taper once ran AFTER `clearReach`, and lowered a row's reach to a
      // lateral `clearReach` had never probed: with columns 32 m and 60 m both
      // clear and the far leg between them, the outer columns collapsed onto
      // that leg's tarmac, 8.6 m above it on this frame.
      const { corridor, ground } = frameAt(profile, at);
      const surface = {
        vertices: corridor.vertices,
        indices: corridor.indices.slice(0, (corridor.centre.length - 1) * 3 * 6),
      };
      let near = 0;
      for (let vertex = 0; vertex < ground.vertices.length / 3; vertex += 1) {
        if (vertex % COLUMNS < 2) continue;
        const x = ground.vertices[vertex * 3] as number;
        const z = ground.vertices[vertex * 3 + 2] as number;
        const row = Math.floor(vertex / (COLUMNS * 2));
        if (nearOtherRoad(corridor, row, x, z, 2 * ROAD_CLEARANCE_METRES)) near += 1;
        const road = heightOver(surface, x, z, 1e-3);
        if (road === undefined) continue;
        expect(
          ground.vertices[vertex * 3 + 1] as number,
          `vertex ${String(vertex)}`,
        ).toBeLessThanOrEqual(road + 1e-3);
      }
      // Non-vacuity: the frame really does bring ground up to the far leg.
      expect(near).toBeGreaterThan(0);
    },
  );

  it('never stands over ANY part of the road, sampled every 7 m on hairpins and a planner route', () => {
    // The sweep of `never stands over ANY part` samples every 131 m, which
    // missed the taper lowering a reach past a probe (#2097's review).
    let worst = 0;
    for (const profile of [hairpinRoute(20), hairpinRoute(25), hairpinRoute(40), plannerRoute()]) {
      for (let at = 0; at < profile.totalDistance; at += 7) {
        const { corridor, ground } = frameAt(profile, at);
        const surface = {
          vertices: corridor.vertices,
          indices: corridor.indices.slice(0, (corridor.centre.length - 1) * 3 * 6),
        };
        for (let vertex = 0; vertex < ground.vertices.length / 3; vertex += 1) {
          if (vertex % COLUMNS < 2) continue;
          const road = heightOver(
            surface,
            ground.vertices[vertex * 3] as number,
            ground.vertices[vertex * 3 + 2] as number,
            1e-3,
          );
          if (road === undefined) continue;
          worst = Math.max(worst, (ground.vertices[vertex * 3 + 1] as number) - road);
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(1e-3);
  }, 120_000);

  it.each(planners)(
    'stands no triangle within 60 m of the road on end, %s',
    (_name, profile) => {
      let judged = 0;
      for (let at = 0; at < profile.totalDistance; at += 23) {
        const { corridor, ground } = frameAt(profile, at);
        const v = ground.vertices;
        for (let index = 0; index + 2 < ground.indices.length; index += 3) {
          const [a, b, c] = [
            ground.indices[index],
            ground.indices[index + 1],
            ground.indices[index + 2],
          ].map((each) => (each as number) * 3) as [number, number, number];
          const e1 = [0, 1, 2].map((k) => (v[b + k] as number) - (v[a + k] as number));
          const e2 = [0, 1, 2].map((k) => (v[c + k] as number) - (v[a + k] as number));
          const nx = (e1[1] as number) * (e2[2] as number) - (e1[2] as number) * (e2[1] as number);
          const ny = (e1[2] as number) * (e2[0] as number) - (e1[0] as number) * (e2[2] as number);
          const nz = (e1[0] as number) * (e2[1] as number) - (e1[1] as number) * (e2[0] as number);
          const length = Math.hypot(nx, ny, nz);
          // A folded row's outer columns are one point, so the triangles
          // between two of them have no area and no face to stand up.
          if (length < 1e-3) continue;
          const x = ((v[a] as number) + (v[b] as number) + (v[c] as number)) / 3;
          const z = ((v[a + 2] as number) + (v[b + 2] as number) + (v[c + 2] as number)) / 3;
          if (fromRoad(corridor, x, z) > 60) continue;
          // Measured before #2096 at 0.066 here; 0.77 since. The steepest the
          // relief makes on its own, 0.18 of a metre a metre, is 0.98.
          expect(Math.abs(ny) / length, `at ${String(at)}`).toBeGreaterThanOrEqual(0.15);
          judged += 1;
        }
      }
      expect(judged).toBeGreaterThan(50_000);
    },
    30_000,
  );
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
      expect(terrainHeightAt(profile, origin, seed, 440, lateral, NO_LAND_CLASS)).toBeGreaterThan(
        rider + 2,
      );
      // 100 m into the descent, and 40 m further down it.
      const descending = elevationAt(profile, 900) - origin.elevation;
      expect(terrainHeightAt(profile, origin, seed, 940, lateral, NO_LAND_CLASS)).toBeLessThan(
        descending - 2,
      );
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
      expect(terrainHeightAt(profile, origin, seed, 500, lateral, NO_LAND_CLASS)).toBeCloseTo(
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
        // `lateral` along its normal — to the RIGHT — is `lateral` metres EAST:
        // x = −lateral, and z is the distance along it. (#583 renamed both:
        // until then this said LEFT and WEST, of a world that was a mirror of
        // its map. The arithmetic did not change.)
        const height = meshHeightAt(ground, -lateral, along);
        if (height === undefined) continue;
        // @see STANDING_TOLERANCE_METRES — measured at up to 15.5 cm here.
        expect(
          Math.abs(terrainHeightAt(profile, origin, seed, along, lateral, NO_LAND_CLASS) - height),
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

describe('no scenery stands over ground that is not drawn — #2099', () => {
  // A planner's 90° corner, both ways round so each side is the inside of a
  // bend: before and after it the inside's ground is tapered in (#2096), and
  // the scenery, placed from the route, stood out past it over the sky.
  const planners: readonly (readonly [string, RouteProfile])[] = [
    ["a planner's route", plannerRoute()],
    ["a planner's route, mirrored", plannerRoute({ mirrored: true })],
  ];

  it.each(planners)('stands every item of a frame over a triangle of it, %s', (_name, profile) => {
    // ⚠️ Read off the frame's own triangles, ground and road, as a driver is
    // handed them. Measured before #2099 on this sweep: 26 items over no
    // triangle at all (14 mirrored), 12 to 42 m from the road.
    const origin = corridorOrigin(profile);
    const start = atStartLine(profile);
    let items = 0;
    const bare: string[] = [];
    for (let at = 0; at < profile.totalDistance; at += 37) {
      const frame = sceneFrame({
        profile,
        origin,
        state: { ...start, ride: { ...start.ride, distance: metres(at) } },
      });
      const road = { vertices: frame.corridor.vertices, indices: frame.corridor.indices };
      for (const each of frame.scatter) {
        items += 1;
        if (
          meshHeightAt(frame.terrain.mesh, each.x, each.z) === undefined &&
          heightOver(road, each.x, each.z, -1e-6) === undefined
        ) {
          bare.push(`${each.kind} at ${String(at)}`);
        }
      }
    }
    expect(bare).toEqual([]);
    expect(items).toBeGreaterThan(5_000);
  });

  it.each(planners)(
    'keeps exactly the points over a triangle, near a bend and far from one, %s',
    (_name, profile) => {
      // `standingOnGround` asks only the rows a point lies between; this asks
      // every triangle of the frame. They must agree both ways — dropping a
      // tree over drawn ground is a bare verge for no reason.
      const laterals = [
        -410, -350, -150, -80, -60, -45, -35, -27, -20, -14, -10, -6, 6, 10, 14, 20, 27, 35, 45, 60,
        80, 150, 350, 410,
      ];
      let kept = 0;
      let dropped = 0;
      for (const bend of PLANNER_BENDS) {
        for (const before of [300, 100, 0, -30]) {
          const { corridor, ground } = frameAt(profile, bend.middleMetres - before);
          const points: { readonly x: number; readonly y: number; readonly z: number }[] = [];
          const centre = corridor.centre;
          for (let row = 0; row + 1 < centre.length; row += 3) {
            const from = centre[row] as (typeof centre)[number];
            const to = centre[row + 1] as (typeof centre)[number];
            const dx = to.x - from.x;
            const dz = to.z - from.z;
            const apart = Math.hypot(dx, dz);
            if (!(apart > 0)) continue;
            for (const lateral of laterals) {
              // Half-way between the rows, out along the normal `(−z, x)`.
              // `y` is the point's index: what comes back is a copy wherever
              // the ground under it is not at that height, which is
              // everywhere (#2101).
              points.push({
                x: (from.x + to.x) / 2 + (-dz / apart) * lateral,
                y: points.length,
                z: (from.z + to.z) / 2 + (dx / apart) * lateral,
              });
            }
          }
          const standing = standingOnGround(points, ground);
          const at = new Map(
            standing.map((each) => [`${String(each.x)},${String(each.z)}`, each.y]),
          );
          for (const point of points) {
            const top = topHeightAt(ground, point.x, point.z);
            const y = at.get(`${String(point.x)},${String(point.z)}`);
            expect(y !== undefined, `(${String(point.x)}, ${String(point.z)})`).toBe(
              top !== undefined,
            );
            // #2101: and at the height of the highest triangle under it.
            if (top !== undefined) expect(y).toBeCloseTo(top, 6);
            if (top !== undefined) kept += 1;
            else dropped += 1;
          }
        }
      }
      // Non-vacuity: both answers are given, many times.
      expect(kept).toBeGreaterThan(1_000);
      expect(dropped).toBeGreaterThan(100);
    },
    60_000,
  );
});

describe('one leg’s ground does not rise through another’s at a very sharp bend — #2101', () => {
  // A planner's corner of 143°, the owner's, sampled every 25 m and level, so
  // every metre of height off the road is the invented relief; both hands, so
  // each side is the inside. `bend` is the corner's route distance.
  const bend = 1_500;
  const corners: readonly (readonly [string, RouteProfile])[] = [
    ['a 143° corner to the right', plannerCornerRoute(143)],
    ['a 143° corner to the left', plannerCornerRoute(143, 'left')],
  ];
  /**
   * And a climbing hairpin, whose legs' roads are up to 14 m apart in height
   * where they pass: with the corners, its middle's route distance.
   */
  const sharp: readonly (readonly [string, RouteProfile, number])[] = [
    ...corners.map(([name, profile]) => [name, profile, bend] as const),
    ['a 25 m hairpin climbing at 4 %', hairpinRoute(25), 400 + (25 * Math.PI) / 2],
  ];
  /** The owner's tablet, 16 : 10: how far to each side the camera sees, per metre ahead. */
  const spread = horizontalSpread(16 / 10);

  /** The frame at an odometer reading, as the renderer is handed it. */
  const sceneAt = (profile: RouteProfile, at: number): ReturnType<typeof sceneFrame> => {
    const start = atStartLine(profile);
    return sceneFrame({
      profile,
      origin: corridorOrigin(profile),
      state: { ...start, ride: { ...start.ride, distance: metres(at) } },
    });
  };

  /** Points on the ground in front of the camera, every 4 m, out to 150 m, inside its view. */
  const inView = (
    camera: ReturnType<typeof sceneFrame>['camera'],
  ): { readonly x: number; readonly z: number; readonly ahead: number }[] => {
    const points: { readonly x: number; readonly z: number; readonly ahead: number }[] = [];
    for (let ahead = 4; ahead <= 150; ahead += 4) {
      for (let across = -150; across <= 150; across += 4) {
        if (Math.abs(across) > ahead * spread) continue;
        points.push({
          // Across along `(−z, x)` of the heading: the rider's right.
          x: camera.x + camera.headingX * ahead - camera.headingZ * across,
          z: camera.z + camera.headingZ * ahead + camera.headingX * across,
          ahead,
        });
      }
    }
    return points;
  };

  /** How far a point is from the stretch of road between `row` and the next. */
  const fromStretch = (corridor: RoadCorridor, row: number, x: number, z: number): number => {
    const from = corridor.centre[row] as RoadCorridor['centre'][number];
    const to = corridor.centre[Math.min(row + 1, corridor.centre.length - 1)] as typeof from;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const span = dx * dx + dz * dz;
    const t =
      span > 0 ? Math.min(1, Math.max(0, ((x - from.x) * dx + (z - from.z) * dz) / span)) : 0;
    return Math.hypot(x - (from.x + dx * t), z - (from.z + dz * t));
  };

  it.each(sharp)(
    'draws the leg whose road is nearer on top, within the chase camera’s view, %s',
    (_name, profile, middle) => {
      // ⚠️ Through the built mesh: wherever triangles of two legs — rows more
      // than 40 m apart along the road — lie over the same point, the one
      // drawn on top must be the leg nearer it. Measured before #2101 on this
      // sweep: the other leg up to 13 m above it, which is the sheet the
      // owner saw rise through the road's own leaving a 143° bend.
      let judged = 0;
      let worst = 0;
      let where = '';
      for (let at = middle - 150; at <= middle + 60; at += 10) {
        const frame = sceneAt(profile, at);
        const { corridor } = frame;
        const ground = frame.terrain.mesh;
        for (const point of inView(frame.camera)) {
          const hits = heightsOver(ground, point.x, point.z, 1e-3);
          if (hits.length < 2) continue;
          const alongs = hits.map((hit) => (corridor.centre[hit.row] as { along: number }).along);
          if (Math.max(...alongs) - Math.min(...alongs) < 40) continue;
          const near = hits.map((hit) => fromStretch(corridor, hit.row, point.x, point.z));
          const owner = near.indexOf(Math.min(...near));
          const ownAlong = alongs[owner] as number;
          const others = hits.filter(
            (_, index) => Math.abs((alongs[index] as number) - ownAlong) >= 40,
          );
          const above =
            Math.max(...others.map((hit) => hit.height)) -
            (hits[owner] as { height: number }).height;
          judged += 1;
          if (above > worst) {
            worst = above;
            where = `at ${String(at)}, ${String(point.ahead)} m ahead`;
          }
        }
      }
      // Within a few centimetres on these sweeps since #2101 (0.07 m, measured
      // on the right-hand corner): the two legs are held to the road's height
      // at the line between them, and each sinks past it under the other.
      expect(worst, where).toBeLessThanOrEqual(0.3);
      // Non-vacuity: the view really does hold both legs' ground, many times.
      expect(judged).toBeGreaterThan(500);
    },
    120_000,
  );

  it.each(corners)(
    'stands no scenery more than 0.3 m off the drawn ground, swept along the bend, %s',
    (_name, profile) => {
      // ⚠️ Read off the frame's own triangles — the highest one under an
      // item, the one drawn on top. Measured before #2101 on this sweep: 295
      // items more than 0.3 m off it, up to 15 m, where `terrainHeightAt` put
      // them on the leg they were placed from while another leg's ground, or
      // a folded row's, was the one drawn there.
      let items = 0;
      let overlapped = 0;
      for (let at = bend - 200; at <= bend + 200; at += 13) {
        const frame = sceneAt(profile, at);
        const ground = frame.terrain.mesh;
        for (const each of frame.scatter) {
          const hits = heightsOver(ground, each.x, each.z, -1e-6);
          // #2099: nothing stands over no ground at all.
          expect(hits.length, `${each.kind} at ${String(at)}`).toBeGreaterThan(0);
          const top = Math.max(...hits.map((hit) => hit.height));
          expect(Math.abs(each.y - top), `${each.kind} at ${String(at)}`).toBeLessThanOrEqual(0.3);
          items += 1;
          const alongs = hits.map(
            (hit) => (frame.corridor.centre[hit.row] as { along: number }).along,
          );
          if (Math.max(...alongs) - Math.min(...alongs) >= 40) overlapped += 1;
        }
      }
      // Non-vacuity: a sweep's worth of scenery, and some of it where two
      // legs' ground lies under it — the case the owner's boulder was.
      expect(items).toBeGreaterThan(5_000);
      expect(overlapped).toBeGreaterThan(20);
    },
    120_000,
  );

  it.each(corners)(
    'sinks a leg’s ground only under another leg’s ground that is there, %s',
    (_name, profile) => {
      // ⚠️ `landform.ts` §`seamReach`'s rules 2 and 3, read back off the mesh
      // where a rider can see it. On this level, dry fixture the invented
      // relief stands no lower than `RELIEF_SLOPE` a metre past the clear
      // band, out from a vertex's own row; a vertex lower than that, the
      // verge and the metre `SHALLOW_SINK_METRES` allows has been sunk, and
      // another leg's ground — rows more than 40 m away along the road — or
      // the road itself must be drawn over it. Out of the camera's view a
      // ray can run on past the other leg's road and the corridor's end,
      // sunk under nothing: measured, 220 m out behind the camera.
      expect(waterways(profile, scatterSeed(profile)).crossings).toHaveLength(0);
      let sunk = 0;
      for (let at = bend - 150; at <= bend + 60; at += 10) {
        const frame = sceneAt(profile, at);
        const { corridor, camera } = frame;
        const ground = frame.terrain.mesh;
        const road = { vertices: corridor.vertices, indices: corridor.indices };
        for (let row = 0; row < ground.rows; row += 1) {
          const centre = corridor.centre[row] as RoadCorridor['centre'][number];
          for (let side = 0; side < 2; side += 1) {
            for (let column = 2; column < COLUMNS; column += 1) {
              const [x, y, z] = groundVertex(ground, row, side, column);
              const ahead = (x - camera.x) * camera.headingX + (z - camera.z) * camera.headingZ;
              const across = (x - camera.x) * -camera.headingZ + (z - camera.z) * camera.headingX;
              if (!(ahead > 0 && ahead <= 400 && Math.abs(across) <= ahead * spread)) continue;
              const lateral = Math.hypot(x - centre.x, z - centre.z);
              const lowest =
                centre.y -
                VERGE_DROP_METRES -
                Math.min(RELIEF_MAX_METRES, 0.18 * Math.max(0, lateral - RELIEF_CLEAR_METRES)) -
                1.01;
              if (!(y < lowest)) continue;
              sunk += 1;
              const covers = heightsOver(ground, x, z, -1e-6).filter(
                (hit) =>
                  Math.abs((corridor.centre[hit.row] as { along: number }).along - centre.along) >=
                    40 && hit.height > y,
              );
              const tarmac = heightOver(road, x, z, -1e-6);
              expect(
                covers.length > 0 || (tarmac !== undefined && tarmac > y),
                `row ${String(row)}, column ${String(column)}, at ${String(at)}`,
              ).toBe(true);
            }
          }
        }
      }
      // Non-vacuity: the sweep really does sink ground under the other leg's.
      expect(sunk).toBeGreaterThan(100);
    },
    120_000,
  );

  it.each(corners)(
    'opens no hole and no pit in the view where the legs used to overlap, %s',
    (_name, profile) => {
      // ⚠️ The two ways of stopping the overlap that #2101 tried and threw
      // away: cutting each leg back to the line between them left sky where
      // the other leg's ground did not reach — past the corridor's first rows,
      // 40 m ahead of the camera at the apex — and sinking a leg where nothing
      // covered it left a pit. On this level fixture the invented relief can
      // reach no lower than `RELIEF_SLOPE` a metre past the clear band, so
      // within 100 m nothing drawn may lie further under the road than that,
      // the verge and the metre `SHALLOW_SINK_METRES` allows.
      expect(waterways(profile, scatterSeed(profile)).crossings).toHaveLength(0);
      const deepest = 0.18 * (100 - RELIEF_CLEAR_METRES) + VERGE_DROP_METRES + 1;
      let looked = 0;
      for (let at = bend - 150; at <= bend + 60; at += 10) {
        const frame = sceneAt(profile, at);
        const road = { vertices: frame.corridor.vertices, indices: frame.corridor.indices };
        const level = (frame.corridor.centre[0] as { y: number }).y;
        for (const point of inView(frame.camera)) {
          if (point.ahead > 100) continue;
          if (heightOver(road, point.x, point.z, -1e-6) !== undefined) continue;
          const top = topHeightAt(frame.terrain.mesh, point.x, point.z);
          expect(top, `hole at ${String(at)}, ${String(point.ahead)} m ahead`).not.toBeUndefined();
          expect(top as number, `pit at ${String(at)}`).toBeGreaterThan(level - deepest);
          looked += 1;
        }
      }
      expect(looked).toBeGreaterThan(10_000);
    },
    120_000,
  );

  it('stands no triangle the rider sees on end where a seam starts, on a 100° bend then a 145° one', () => {
    // ⚠️ `landform.ts` §`SEAM_DEEPEN_PER_METRE`. A seam is found row by row,
    // and rule 3 holds on one row and fails on the next, so a side sunk tens
    // of metres stood beside one sunk a metre at most: measured on this road
    // before the sinking was let deepen only along the road, 19 triangles
    // within 60 m of it drawn on top and steeper than #2096's |ny| 0.15. One
    // is #2096's own, at |ny| 0.052 122 m past the 145° bend, there before
    // #2101 as well: so at most one.
    const profile = routeProfile(bendThenSharpBend(), { loop: false });
    let steep = 0;
    let judged = 0;
    for (let at = 200; at < 900; at += 11) {
      const { corridor, ground } = frameAt(profile, at);
      const v = ground.vertices;
      for (let index = 0; index + 2 < ground.indices.length; index += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => (ground.indices[index + k] as number) * 3) as [
          number,
          number,
          number,
        ];
        const e1 = [0, 1, 2].map((k) => (v[b + k] as number) - (v[a + k] as number));
        const e2 = [0, 1, 2].map((k) => (v[c + k] as number) - (v[a + k] as number));
        const nx = (e1[1] as number) * (e2[2] as number) - (e1[2] as number) * (e2[1] as number);
        const ny = (e1[2] as number) * (e2[0] as number) - (e1[0] as number) * (e2[2] as number);
        const nz = (e1[0] as number) * (e2[1] as number) - (e1[1] as number) * (e2[0] as number);
        const length = Math.hypot(nx, ny, nz);
        if (length < 1e-3) continue;
        const x = ((v[a] as number) + (v[b] as number) + (v[c] as number)) / 3;
        const z = ((v[a + 2] as number) + (v[b + 2] as number) + (v[c + 2] as number)) / 3;
        if (!corridor.centre.some((point) => Math.hypot(x - point.x, z - point.z) <= 60)) continue;
        judged += 1;
        if (Math.abs(ny) / length >= 0.15) continue;
        // Under another leg's ground it is not on the screen.
        const y = ((v[a + 1] as number) + (v[b + 1] as number) + (v[c + 1] as number)) / 3;
        if ((topHeightAt(ground, x, z) ?? y) > y + 0.05) continue;
        steep += 1;
      }
    }
    expect(steep).toBeLessThanOrEqual(1);
    expect(judged).toBeGreaterThan(100_000);
  }, 120_000);
});

describe('no bank stands on the inside of a very sharp bend — #2101, the owner’s ruling of 2026-11-03', () => {
  // ⚠️ The owner's frames of #2101's first fix: the boulder and the fir
  // grounded, and a raised green bank on the inside of a 143° bend with a
  // hard straight edge, hiding part of the far leg's road, and a smaller hump
  // on the right leaving it. Its two causes, measured on these fixtures:
  // where a row stopped having a seam its relief came back in full beside a
  // row held to the road's height (`landform.ts` §`tapered`, now run over the
  // seams too), and on a climb or descent the two legs met halfway from the
  // clear band's edge, which near the bend is centimetres from the seam, so
  // the step stood on end (§`meetingRises`).
  //
  // A planner's corner sampled every 25 m, from 140° to 150°, both hands,
  // level, and climbing and descending at 3 %; at 6 % to 147° (at 150° and
  // 6 % three triangles at the corridor's first row, where `clearReach` cuts
  // a reach that the taper never sees, stand up 94 m ahead: stated, not held).
  const bend = 1_500;
  const corners: readonly (readonly [string, RouteProfile, number])[] = [
    140, 143, 147, 150,
  ].flatMap((degrees) =>
    (['right', 'left'] as const).flatMap((hand) =>
      (degrees < 150 ? [0, 0.03, -0.03, 0.06, -0.06] : [0, 0.03, -0.03]).map(
        (grade) =>
          [
            `${String(degrees)}° to the ${hand} at ${String(grade * 100)} %`,
            plannerCornerRoute(degrees, hand, grade),
            grade,
          ] as const,
      ),
    ),
  );
  /** The owner's tablet, 16 : 10. */
  const aspect = 16 / 10;
  /**
   * How steep the ground may stand in view where the road is level or at 3 %:
   * |ny| **0.5**, 60°. The bank on the level 143° corner was not on end — its
   * straight edge stood at |ny| 0.47 to 0.59, where a row held to the road's
   * height met one with its relief back in full — so on a gentle road
   * the bound is the one that sees it; the relief by itself is never steeper
   * than |ny| 0.98. #2096's 0.15 holds at 6 %, where two legs 10 m apart in
   * height meet across a narrow wedge.
   */
  const GENTLE_STEEPEST = 0.5;

  /** The frame at an odometer reading, as the renderer is handed it. */
  const sceneAt = (profile: RouteProfile, at: number): ReturnType<typeof sceneFrame> => {
    const start = atStartLine(profile);
    return sceneFrame({
      profile,
      origin: corridorOrigin(profile),
      state: { ...start, ride: { ...start.ride, distance: metres(at) } },
    });
  };

  /** Whether a point is in the frame the chase camera draws, and how far ahead of the eye. */
  const framed = (
    rig: ReturnType<typeof cameraRig>,
    point: { readonly x: number; readonly y: number; readonly z: number },
  ): number | undefined => {
    const at = projectToFrame(rig, aspect, point);
    if (at === undefined) return undefined;
    return at.left >= 0 && at.left <= 1 && at.top >= 0 && at.top <= 1 ? at.depth : undefined;
  };

  it.each(corners)(
    'stands no ground the rider sees on end, %s',
    (_name, profile, grade) => {
      const steepest = Math.abs(grade) <= 0.03 ? GENTLE_STEEPEST : 0.15;
      // Every triangle of the ground in the chase camera's frame within
      // 150 m, drawn on top — no other ground over it — must lie no steeper
      // than {@link GENTLE_STEEPEST}, |ny| 0.5, on a level road or at 3 %, and
      // #2096's |ny| 0.15 at 6 %. Measured before this fix: up to 22 such a
      // frame sweep (143° descending at 6 %), at |ny| 0.036 (147°).
      //
      // ⚠️ This is what holds `landform.ts` §`SEAM_DEEPEN_PER_METRE` at 1.5:
      // 1.75 and 2 stand triangles up at 147° and 150° at 3 % where a deep
      // side meets a shallow one, and 0.75 stands them up at 140° at 6 %
      // (|ny| 0.141), measured. 1 and 1.25 pass here and everywhere else, so
      // nothing here tells them from 1.5. It is kept because, of the values
      // that pass, it sinks a side furthest under the other leg's ground; that
      // margin is not measured, and the owner's frames were taken at 1.5.
      let judged = 0;
      const steep: string[] = [];
      for (let at = bend - 120; at <= bend + 60; at += 10) {
        const frame = sceneAt(profile, at);
        const rig = cameraRig(frame.camera);
        const ground = frame.terrain.mesh;
        const v = ground.vertices;
        for (let index = 0; index + 2 < ground.indices.length; index += 3) {
          const [a, b, c] = [0, 1, 2].map((k) => (ground.indices[index + k] as number) * 3) as [
            number,
            number,
            number,
          ];
          const e1 = [0, 1, 2].map((k) => (v[b + k] as number) - (v[a + k] as number));
          const e2 = [0, 1, 2].map((k) => (v[c + k] as number) - (v[a + k] as number));
          const nx = (e1[1] as number) * (e2[2] as number) - (e1[2] as number) * (e2[1] as number);
          const ny = (e1[2] as number) * (e2[0] as number) - (e1[0] as number) * (e2[2] as number);
          const nz = (e1[0] as number) * (e2[1] as number) - (e1[1] as number) * (e2[0] as number);
          const length = Math.hypot(nx, ny, nz);
          if (length < 1e-3) continue;
          const middle = {
            x: ((v[a] as number) + (v[b] as number) + (v[c] as number)) / 3,
            y: ((v[a + 1] as number) + (v[b + 1] as number) + (v[c + 1] as number)) / 3,
            z: ((v[a + 2] as number) + (v[b + 2] as number) + (v[c + 2] as number)) / 3,
          };
          const depth = framed(rig, middle);
          if (depth === undefined || depth > 150) continue;
          judged += 1;
          if (Math.abs(ny) / length >= steepest) continue;
          // Under another leg's ground it is not on the screen.
          if ((topHeightAt(ground, middle.x, middle.z) ?? middle.y) > middle.y + 0.05) continue;
          steep.push(
            `|ny| ${(Math.abs(ny) / length).toFixed(3)} at ${String(at)}, ${depth.toFixed(0)} m`,
          );
        }
      }
      expect(steep).toEqual([]);
      // Non-vacuity: the frames really do hold the ground of both legs.
      expect(judged).toBeGreaterThan(10_000);
    },
    120_000,
  );

  it.each(corners)(
    'hides none of the far leg’s road behind the other leg’s ground, %s',
    (_name, profile) => {
      // A ray from the chase camera's eye to every point of the far leg's
      // road in its frame — the centreline, 10 cm up — must pass over the
      // ground drawn under it, every metre, except the far leg's own ground
      // within 40 m of road of that point: on a climb a road above the eye
      // is hidden by its own verge, which is true, and not this bank. Only
      // its own leg's, past the bend (#2117's review): exempting any row
      // within 40 m also exempted the approach's last rows before the apex,
      // where the bank stood. Measured, with a bank 1.5 m high planted on the
      // approach's last 23 m: red on 8 corners, and on only 4 before.
      // Measured before this fix: hidden by up to 1.8 m on a 147° bend
      // descending at 6 %, and by 0.37 m on a 143° bend descending at 3 %.
      let rays = 0;
      const hidden: string[] = [];
      for (let at = bend - 120; at <= bend + 60; at += 10) {
        const frame = sceneAt(profile, at);
        const rig = cameraRig(frame.camera);
        const ground = frame.terrain.mesh;
        const centre = frame.corridor.centre;
        for (const point of centre) {
          if (!(point.distance > bend + 15)) continue;
          const target = { x: point.x, y: point.y + 0.1, z: point.z };
          if (framed(rig, target) === undefined) continue;
          rays += 1;
          const dx = target.x - rig.eye.x;
          const dy = target.y - rig.eye.y;
          const dz = target.z - rig.eye.z;
          const span = Math.hypot(dx, dz);
          for (let step = 3; step < span - 6; step += 1) {
            const share = step / span;
            const x = rig.eye.x + dx * share;
            const z = rig.eye.z + dz * share;
            const others = heightsOver(ground, x, z, -1e-6).filter((hit) => {
              const row = centre[hit.row] as { along: number; distance: number };
              return row.distance <= bend || Math.abs(row.along - point.along) >= 40;
            });
            if (others.length === 0) continue;
            const over = Math.max(...others.map((hit) => hit.height)) - (rig.eye.y + dy * share);
            if (over > 0.05) {
              hidden.push(
                `${over.toFixed(2)} m at ${String(at)}, road ${point.distance.toFixed(0)}`,
              );
              break;
            }
          }
        }
      }
      expect(hidden).toEqual([]);
      // Non-vacuity: the far leg really is in the frame, many times.
      expect(rays).toBeGreaterThan(500);
    },
    120_000,
  );

  /**
   * How steep the ground may step from one row to the next at one column,
   * in metres of height over the road beside it a metre between the two:
   * **1** — #2117's review. @see creases
   */
  const CREASE_STEEPEST = 1;

  /**
   * Every pair of neighbouring rows' vertices at one column out to
   * `lastColumn`, both in the frame within 200 m and drawn on top, that
   * differ in height over the road beside them by more than
   * {@link CREASE_STEEPEST} a metre between them, on the frames from `first`
   * to `last` — and how many pairs in the frame were judged.
   */
  const creases = (
    profile: RouteProfile,
    first: number,
    last: number,
    lastColumn: number,
  ): { readonly steep: string[]; readonly judged: number } => {
    const steep: string[] = [];
    let judged = 0;
    for (let at = first; at <= last; at += 10) {
      const frame = sceneAt(profile, at);
      const rig = cameraRig(frame.camera);
      const ground = frame.terrain.mesh;
      const v = ground.vertices;
      const centre = frame.corridor.centre;
      const perRow = COLUMNS * 2;
      const vertex = (row: number, side: number, column: number): number =>
        (row * perRow + side * COLUMNS + column) * 3;
      const lift = (row: number, side: number, column: number): number =>
        (v[vertex(row, side, column) + 1] as number) - (centre[row] as { y: number }).y;
      const point = (
        row: number,
        side: number,
        column: number,
      ): { readonly x: number; readonly y: number; readonly z: number } => {
        const at3 = vertex(row, side, column);
        return { x: v[at3] as number, y: v[at3 + 1] as number, z: v[at3 + 2] as number };
      };
      const inFrame = (row: number, side: number, column: number): boolean => {
        const depth = framed(rig, point(row, side, column));
        return depth !== undefined && depth <= 200;
      };
      // Under another leg's ground it is not on the screen. Asked last, of a
      // step already too steep: it walks every triangle.
      const onTop = (row: number, side: number, column: number): boolean => {
        const { x, y, z } = point(row, side, column);
        return (topHeightAt(ground, x, z) ?? y) <= y + 0.05;
      };
      for (let row = 0; row + 1 < ground.rows; row += 1) {
        for (let side = 0; side < 2; side += 1) {
          // The road's edge and the verge's foot are the road's own height.
          for (let column = 2; column <= lastColumn; column += 1) {
            if (!inFrame(row, side, column) || !inFrame(row + 1, side, column)) continue;
            judged += 1;
            const step = Math.abs(lift(row + 1, side, column) - lift(row, side, column));
            const here = vertex(row, side, column);
            const next = vertex(row + 1, side, column);
            const apart = Math.hypot(
              (v[next] as number) - (v[here] as number),
              (v[next + 2] as number) - (v[here + 2] as number),
            );
            if (step <= CREASE_STEEPEST * Math.max(apart, 1)) continue;
            if (!onTop(row, side, column) || !onTop(row + 1, side, column)) continue;
            steep.push(
              `${step.toFixed(2)} m over ${apart.toFixed(1)} m at ${String(at)}, row ${String(row)}, column ${String(column)}`,
            );
          }
        }
      }
    }
    return { steep, judged };
  };

  it.each(corners.filter(([, , grade]) => grade !== 0))(
    'steps the ground no more than a metre a metre from one row to the next where a seam ends, %s',
    (_name, profile) => {
      // #2117's review: the height a side moves to meet the other leg's road
      // fell to nought on the first row past the last one with a seam, while
      // the line it moves to was let out along the road, so every column
      // past the line stepped by up to half the two roads' difference
      // between two rows: a crease across the leaving leg's ground, 62 to
      // 165 m ahead, where the owner saw a smaller hump leaving the bend.
      // Measured before this fix: 4.81 m over 2 m (147° to the right at 6 %),
      // 4.66 m (143°), 2.77 m at 3 %. After it, no more than 1.76 m over
      // 2.1 m, as steep as the relief stands at a far column on a row that
      // never had a seam.
      const { steep, judged } = creases(profile, bend - 120, bend + 60, COLUMNS - 1);
      expect(steep).toEqual([]);
      // Non-vacuity: the frames really do hold both legs' ground, near and far.
      expect(judged).toBeGreaterThan(10_000);
    },
    120_000,
  );

  it.each(corners.filter(([, , grade]) => grade !== 0))(
    'steps the ground no more than a metre a metre from one row to the next where a seam starts, %s',
    (_name, profile) => {
      // And the same where the approaching leg's seam starts, which the
      // meeting height is let out back along the road from: measured without
      // that, 2.30 m over 2 m 116 m ahead, 330 m before a 143° bend at 6 %.
      // Out to the 90 m column only: this far back the relief past it steps
      // by 3.1 m over 2 m of road with or without the seam, measured.
      const { steep, judged } = creases(profile, bend - 340, bend - 160, 8);
      expect(steep).toEqual([]);
      expect(judged).toBeGreaterThan(5_000);
    },
    120_000,
  );

  /**
   * The ground's triangles that face `eye` — three culls the rest, so a ray
   * passes through them — bucketed by {@link FACING_CELL_METRES} in plan.
   */
  const facingGround = (
    ground: TerrainMesh,
    eye: { readonly x: number; readonly y: number; readonly z: number },
  ): Map<number, number[]> => {
    const cells = new Map<number, number[]>();
    const v = ground.vertices;
    for (let at = 0; at + 2 < ground.indices.length; at += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => (ground.indices[at + k] as number) * 3) as [
        number,
        number,
        number,
      ];
      const e1 = [0, 1, 2].map((k) => (v[b + k] as number) - (v[a + k] as number));
      const e2 = [0, 1, 2].map((k) => (v[c + k] as number) - (v[a + k] as number));
      const nx = (e1[1] as number) * (e2[2] as number) - (e1[2] as number) * (e2[1] as number);
      const ny = (e1[2] as number) * (e2[0] as number) - (e1[0] as number) * (e2[2] as number);
      const nz = (e1[0] as number) * (e2[1] as number) - (e1[1] as number) * (e2[0] as number);
      const toward =
        (eye.x - (v[a] as number)) * nx +
        (eye.y - (v[a + 1] as number)) * ny +
        (eye.z - (v[a + 2] as number)) * nz;
      if (!(toward > 0)) continue;
      const xs = [v[a] as number, v[b] as number, v[c] as number];
      const zs = [v[a + 2] as number, v[b + 2] as number, v[c + 2] as number];
      for (
        let cx = Math.floor(Math.min(...xs) / FACING_CELL_METRES);
        cx <= Math.floor(Math.max(...xs) / FACING_CELL_METRES);
        cx += 1
      ) {
        for (
          let cz = Math.floor(Math.min(...zs) / FACING_CELL_METRES);
          cz <= Math.floor(Math.max(...zs) / FACING_CELL_METRES);
          cz += 1
        ) {
          const key = cx * 100_003 + cz;
          const list = cells.get(key) ?? [];
          if (list.length === 0) cells.set(key, list);
          list.push(at);
        }
      }
    }
    return cells;
  };
  /** The side of {@link facingGround}'s buckets, in metres. */
  const FACING_CELL_METRES = 8;
  /** The highest of `cells`' triangles over a point in plan, or `-Infinity`. */
  const facingTop = (
    ground: TerrainMesh,
    cells: Map<number, number[]>,
    x: number,
    z: number,
  ): number => {
    const key = Math.floor(x / FACING_CELL_METRES) * 100_003 + Math.floor(z / FACING_CELL_METRES);
    const v = ground.vertices;
    let top = Number.NEGATIVE_INFINITY;
    for (const at of cells.get(key) ?? []) {
      const a = (ground.indices[at] as number) * 3;
      const b = (ground.indices[at + 1] as number) * 3;
      const c = (ground.indices[at + 2] as number) * 3;
      const [ax, az, bx, bz, cx, cz] = [a, a + 2, b, b + 2, c, c + 2].map(
        (index) => v[index] as number,
      ) as [number, number, number, number, number, number];
      const area = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
      if (Math.abs(area) < 1e-9) continue;
      const u = ((bx - x) * (cz - z) - (cx - x) * (bz - z)) / area;
      const w = ((cx - x) * (az - z) - (ax - x) * (cz - z)) / area;
      if (u < -1e-6 || w < -1e-6 || 1 - u - w < -1e-6) continue;
      top = Math.max(
        top,
        u * (v[a + 1] as number) + w * (v[b + 1] as number) + (1 - u - w) * (v[c + 1] as number),
      );
    }
    return top;
  };
  /**
   * Whether the far leg's road at `centre[index]` faces the eye: the eye more
   * than `margin` above the road's plane there (half a metre unless given),
   * its slope taken from the two neighbouring rows.
   */
  const facesEye = (
    rig: ReturnType<typeof cameraRig>,
    centre: RoadCorridor['centre'],
    index: number,
    margin = 0.5,
  ): boolean => {
    const point = centre[index] as RoadCorridor['centre'][number];
    const before = centre[index - 1] as typeof point;
    const after = centre[index + 1] as typeof point;
    const run = Math.hypot(after.x - before.x, after.z - before.z);
    const along =
      ((rig.eye.x - point.x) * (after.x - before.x) +
        (rig.eye.z - point.z) * (after.z - before.z)) /
      run;
    return rig.eye.y - point.y > ((after.y - before.y) / run) * along + margin;
  };
  /**
   * How far the first of `cells`' triangles to stand more than `slack` over
   * the ray from `eye` to `target` stands over it, sampled every metre from
   * 3 m out to `short` metres short of the target; `undefined` if none does.
   */
  const standsOver = (
    ground: TerrainMesh,
    cells: Map<number, number[]>,
    eye: { x: number; y: number; z: number },
    target: { x: number; y: number; z: number },
    short: number,
    slack: number,
  ): number | undefined => {
    const dx = target.x - eye.x;
    const dy = target.y - eye.y;
    const dz = target.z - eye.z;
    const span = Math.hypot(dx, dz);
    for (let step = 3; step < span - short; step += 1) {
      const share = step / span;
      const over =
        facingTop(ground, cells, eye.x + dx * share, eye.z + dz * share) - (eye.y + dy * share);
      if (over > slack) return over;
    }
    return undefined;
  };

  it.each(corners.filter(([, , grade]) => grade === 0 || grade === -0.03))(
    'shows the far leg’s road from the approach over no bank beyond the bend, %s',
    (_name, profile, grade) => {
      // The owner's ruling of 2026-11-04, on frames of this fix at a 143°
      // bend: coming up to it, a steep raised bank with stretched grass on
      // the right, beyond the bend, hid the far leg's road that main showed.
      // It was the far leg's own ground between its clear band and the line,
      // whose relief the hold let rise and fall back to the line: a ridge
      // whose face towards the rider is drawn, where main's same ground rose
      // all the way out and turned that face away (`landform.ts`
      // §`SEAM_CREST_FADE_METRES`). And on a descent the approach's own
      // ground past its line, held at the meeting height and flat, stood
      // over the lower far leg where main's relief fell away.
      //
      // So, from the chase camera's eye on the approach, a ray to every point
      // of the far leg's road in its frame — the centreline, 10 cm up, where
      // the road faces the eye — passes over every triangle of the ground
      // that faces the eye, as three draws it, sampled every metre. Nothing
      // exempt: a road that faces the eye is hidden by no verge of its own.
      // Climbs are not asked here: there the far leg is above the eye, so the
      // top of its road faces away from it. Both road materials are
      // `DoubleSide` (`three-renderer.ts`, the road's `MeshBasicMaterial` and
      // `photographicRoadMaterial`), so three does draw that road from below
      // wherever no ground facing the eye covers it, and what shows there is
      // its underside. The next test asks what an eye below the far leg can
      // see of it.
      //
      // Measured before this fix: hidden by up to 2.09 m on the level (140°
      // to the right), and 2.03 m descending at 3 %. At 3 % a ray to a road
      // eight metres below grazes ground lowered towards it, by up to 0.46 m
      // after the fix (140° to the left), so the bound there is 0.5 m. At 6 %
      // that ground stands up to 5.4 m over the far leg near it, before this
      // fix as after: stated, not held.
      const slack = grade === 0 ? 0.05 : 0.5;
      let rays = 0;
      const hidden: string[] = [];
      for (let at = bend - 300; at <= bend - 60; at += 10) {
        const frame = sceneAt(profile, at);
        const rig = cameraRig(frame.camera);
        const ground = frame.terrain.mesh;
        const cells = facingGround(ground, rig.eye);
        const centre = frame.corridor.centre;
        for (let index = 1; index + 1 < centre.length; index += 1) {
          const point = centre[index] as RoadCorridor['centre'][number];
          if (!(point.distance > bend + 15)) continue;
          const target = { x: point.x, y: point.y + 0.1, z: point.z };
          if (framed(rig, target) === undefined) continue;
          // Whether the road there faces the eye: the eye above its plane.
          if (!facesEye(rig, centre, index)) continue;
          rays += 1;
          const over = standsOver(ground, cells, rig.eye, target, 6, slack);
          if (over !== undefined) {
            hidden.push(`${over.toFixed(2)} m at ${String(at)}, road ${point.distance.toFixed(0)}`);
          }
        }
      }
      expect(hidden).toEqual([]);
      // Non-vacuity: the far leg's road really is in the frame, facing the eye.
      expect(rays).toBeGreaterThan(300);
    },
    120_000,
  );

  /**
   * A planner's corner reached on a climb that levels off at the bend — the
   * shape of the owner's 143° bend of #2117's ruling of 2026-11-04, a 9–10 %
   * climb to a far leg that runs level — from 140° to 150°, both hands, at
   * 6 %, 8 % and 10 %.
   */
  const climbs: readonly (readonly [string, RouteProfile, number])[] = [140, 143, 147, 150].flatMap(
    (degrees) =>
      (['right', 'left'] as const).flatMap((hand) =>
        [0.06, 0.08, 0.1].map(
          (grade) =>
            [
              `${String(degrees)}° to the ${hand}, climbing at ${String(Math.round(grade * 100))} % to a level far leg`,
              plannerCornerRoute(degrees, hand, grade, 0),
              grade,
            ] as const,
        ),
      ),
  );
  /**
   * How far over the far leg's centreline the climb test aims its rays: **1 m**
   * (#2150). Aimed at 0.5 m, it goes red on this head at the far road's own
   * near verge: ground 4 to 7 m short of the target and 4 to 6 m off that
   * road's centreline, which rises from the road towards the rider and stands
   * up to 0.15 m over the ray (150° to the right at 10 %), on every 10 % case
   * and at 150° and 8 %, measured. That verge is what truly hides a road above
   * the eye, so the target clears it rather than the test exempting it.
   */
  const CLIMB_TARGET_METRES = 1;

  it.each(climbs)(
    'stands no ground over the far leg from a climb to the bend, %s',
    (_name, profile, grade) => {
      // #2117's ruling of 2026-11-04: coming up a 9–10 % climb to the 143°
      // bend, the owner saw a grass rise where main showed the far leg's
      // road. On such a climb the far leg runs at the bend's height, above
      // the eye — 1.4 m above it 20 m short of the owner's bend and 3.4 m
      // 40 m short, measured — so the top of its road faces away from the
      // eye, and no ground lets the eye see that top. Three still draws the
      // road there: both road materials are `DoubleSide` (`three-renderer.ts`,
      // the road's `MeshBasicMaterial` and `photographicRoadMaterial`), so
      // wherever no ground facing the eye covers it, the rider sees its
      // underside. That is what main showed on the climb: rising all the way
      // out from the far leg, its ground's face looked away from the rider
      // and was culled, and the road's underside showed through ground
      // standing over it (up to 19 m here, at 150° to the left). What does
      // hide a road above the eye is its own near verge, rising from it
      // towards the rider ({@link CLIMB_TARGET_METRES}). And #2117's first
      // approach fix stood a ridge beside the far leg (the owner's frames at
      // c9136f63).
      //
      // What the rider can see of a road above the eye is what stands on
      // it. So from the chase camera's eye on the approach, a ray to a point
      // {@link CLIMB_TARGET_METRES} over every point of the far leg's
      // centreline in the frame passes over every triangle of the ground that
      // faces the eye, as three draws it, sampled every metre: no ground
      // stands between the rider and the far leg. Measured on this change's
      // head: at least 0.32 m clear (150° to the left at 10 %). At c9136f63,
      // standing up to 2.02 m over it (140° to the right at 10 %); on main,
      // up to 19.25 m.
      //
      // And where the far road does face the eye — a few points of it at
      // 6 % and 8 %, none at 10 % — it is held as the test above holds it
      // (#2150): a ray to 10 cm over the road passes over the ground with
      // 5 cm to spare, the last 6 m excepted. The eye there is less than half
      // a metre above the road's plane, so the margin is nought, not that
      // test's half metre, which would leave out every point at 8 %.
      // Measured on this head: at least 1.0 m clear.
      let rays = 0;
      let facing = 0;
      const hidden: string[] = [];
      for (let at = bend - 300; at <= bend - 20; at += 10) {
        const frame = sceneAt(profile, at);
        const rig = cameraRig(frame.camera);
        const ground = frame.terrain.mesh;
        const cells = facingGround(ground, rig.eye);
        const centre = frame.corridor.centre;
        for (let index = 0; index < centre.length; index += 1) {
          const point = centre[index] as RoadCorridor['centre'][number];
          if (!(point.distance > bend + 15)) continue;
          const target = { x: point.x, y: point.y + CLIMB_TARGET_METRES, z: point.z };
          if (framed(rig, target) === undefined) continue;
          rays += 1;
          const over = standsOver(ground, cells, rig.eye, target, 2, 0);
          if (over !== undefined) {
            hidden.push(`${over.toFixed(2)} m at ${String(at)}, road ${point.distance.toFixed(0)}`);
          }
          const road = { x: point.x, y: point.y + 0.1, z: point.z };
          if (index === 0 || index + 1 === centre.length || framed(rig, road) === undefined) {
            continue;
          }
          if (!facesEye(rig, centre, index, 0)) continue;
          facing += 1;
          const onRoad = standsOver(ground, cells, rig.eye, road, 6, 0.05);
          if (onRoad !== undefined) {
            hidden.push(
              `${onRoad.toFixed(2)} m over the road at ${String(at)}, road ${point.distance.toFixed(0)}`,
            );
          }
        }
      }
      expect(hidden).toEqual([]);
      // Non-vacuity: the far leg really is in the frame, and below 10 % some
      // of its road faces the eye.
      expect(rays).toBeGreaterThan(300);
      if (grade < 0.1) expect(facing).toBeGreaterThan(0);
    },
    120_000,
  );

  it.each(corners.filter(([, , grade]) => grade !== 0))(
    'lets the meeting height go along the road, far from any seam, %s',
    (_name, profile) => {
      // #2117's re-review: `landform.ts` §`MEET_TAPER_PER_METRE` was held
      // from above only — a rate of nought, the height carried undiminished
      // along every row, left every test green. Coming up to the bend, with
      // its first rows in the corridor's far end, the rows by the rider are
      // some 270 m of road from any row with a seam: their ground must be
      // the ground a corridor that stops short of the bend builds there, to
      // the bit, at every column out to the 135 m one (past it the line,
      // let out 2 m a metre, can still hold the relief).
      let compared = 0;
      const moved: string[] = [];
      for (const at of [bend - 360, bend - 350, bend - 340]) {
        const origin = corridorOrigin(profile);
        const seed = scatterSeed(profile);
        const whole = roadCorridor(profile, origin, at);
        const short = roadCorridor(profile, origin, at, { aheadMetres: bend - at - 100 });
        const ground = terrainCorridor(profile, origin, whole, seed, NO_LAND_CLASS);
        // A copy: the next build lends the same storage.
        const heights = ground.vertices.slice();
        const without = terrainCorridor(profile, origin, short, seed, NO_LAND_CLASS);
        for (let row = 0; row < short.centre.length; row += 1) {
          const point = whole.centre[row];
          const same = short.centre[row];
          if (point === undefined || same === undefined) continue;
          if (point.distance > at + 60) continue;
          // The two corridors share their rows near the rider.
          expect([same.x, same.z, same.y]).toEqual([point.x, point.z, point.y]);
          for (let side = 0; side < 2; side += 1) {
            for (let column = 0; column <= 9; column += 1) {
              const index = (row * COLUMNS * 2 + side * COLUMNS + column) * 3 + 1;
              compared += 1;
              const step = (heights[index] as number) - (without.vertices[index] as number);
              if (step !== 0) {
                moved.push(
                  `${step.toFixed(3)} m at ${String(at)}, road ${point.distance.toFixed(0)}, side ${String(side)}, column ${String(column)}`,
                );
              }
            }
          }
        }
      }
      expect(moved.slice(0, 5)).toEqual([]);
      expect(compared).toBeGreaterThan(1_000);
    },
    120_000,
  );
});

/**
 * A level road with a 100° bend to the right of 20 m radius, 120 m on, and a
 * 145° bend to the left of 15 m: one corridor holds a bend #2101 leaves as it
 * was and one whose legs meet. Sampled every 5 m.
 */
function bendThenSharpBend(): RoutePoint[] {
  const points: RoutePoint[] = [];
  let east = 0;
  let north = 0;
  let heading = Math.PI / 2;
  const push = (): void => {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + north / 111_320),
        degreesLongitude(-0.12 + east / (111_320 * Math.cos((51.5 * Math.PI) / 180))),
      ),
      elevation: altitudeMetres(0),
    });
  };
  const straight = (length: number): void => {
    for (let along = 0; along < length; along += 5) {
      push();
      east += 5 * Math.cos(heading);
      north += 5 * Math.sin(heading);
    }
  };
  const bend = (radius: number, degrees: number, right: boolean): void => {
    const arc = (radius * degrees * Math.PI) / 180;
    const steps = Math.max(4, Math.round(arc / 5));
    const turn = ((degrees * Math.PI) / 180 / steps) * (right ? -1 : 1);
    for (let step = 0; step < steps; step += 1) {
      push();
      heading += turn / 2;
      east += (arc / steps) * Math.cos(heading);
      north += (arc / steps) * Math.sin(heading);
      heading += turn / 2;
    }
  };
  straight(400);
  bend(20, 100, true);
  straight(120);
  bend(15, 145, false);
  straight(400);
  push();
  return points;
}

describe('the ground is the same place on every lap — #458', () => {
  it('builds identical heights a whole lap apart', () => {
    const profile = circuitRoute(150);
    const lap = profile.totalDistance;
    // ⚠️ Copied out before the second build: since #469 the mesh's arrays are
    // lent and the next build writes over them, so comparing `first.vertices`
    // with `third.vertices` would compare one array with itself.
    const first = Float32Array.from(frameAt(profile, 123).ground.vertices);
    const third = frameAt(profile, 123 + 2 * lap).ground;
    expect(third.vertices).not.toBe(first);
    for (let at = 1; at < first.length; at += 3) {
      expect(third.vertices[at]).toBeCloseTo(first[at] as number, 3);
    }
  });

  it('does not depend on what was built before it — #569', () => {
    // #569 keeps storage between builds to pay for #543's rows: the clearance
    // grid and its lists, and the relief hashes of the last two nodes. What is
    // kept must be storage and never an answer, so the same ground built
    // before and after two other routes' ground — a hairpin, whose far leg
    // lies where this road's probes go, and a circuit, each on its own seed —
    // is the same ground to the bit.
    const profile = hillRoute();
    const alone = Float32Array.from(frameAt(profile, 640).ground.vertices);
    frameAt(hairpinRoute(12), 150);
    frameAt(circuitRoute(40), 60);
    const after = frameAt(profile, 640).ground.vertices;
    expect(Array.from(after)).toEqual(Array.from(alone));
  });

  it('is bounded: never more relief than the cap, however long the route', () => {
    const profile = steadyClimb();
    const origin = corridorOrigin(profile);
    const seed = scatterSeed(profile);
    for (let along = 0; along < 3_000; along += 50) {
      const road = elevationAt(profile, along) - origin.elevation;
      const height = terrainHeightAt(profile, origin, seed, along, 420, NO_LAND_CLASS);
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
