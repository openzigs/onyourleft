// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The map's swimming pools and fountains, drawn as pools — #2974.
 *
 * A `water` polygon of `kind` `swimming_pool` or `fountain` (Protomaps v4
 * writes OSM's `leisure=swimming_pool`, `amenity=swimming_pool` and
 * `amenity=fountain` so: protomaps/basemaps `Water.java`, read 2026-11-21) is
 * kept by the decoder with its kind already (ADR 0054 D-2.2), and until #2974
 * it reached the world only as the land mask's `water`, which keeps trees off
 * it. Now each one round the camera is drawn with a pool's look: its water
 * lighter and bluer than a lake's, and a pale stone edge round it, a coping
 * standing a hand over the water, with a skirt down to the ground.
 *
 * ⚠️ **Not a `basin`.** Protomaps' `basin` is OSM's `landuse=basin`, a
 * retention or infiltration basin: an earth pond, which is water and is drawn
 * as the mask's water, not a built pool.
 *
 * How it reaches the screen: `waterways.ts` §`waterSurface` writes each
 * {@link PoolSurface} into the water's one mesh, marked by its shore weight
 * (`POOL_WATER_SHORE`, `POOL_EDGE_SHORE`, `POOL_SIDE_SHORE`), and the water
 * shader colours it by that mark (`three-renderer.ts` §`WATER_FRAGMENT`). No
 * draw call, texture or attribute is added.
 *
 * Pure: names no rendering library, and formats no coordinate into a string.
 * Built once a corridor; each pool's ground is read the first time it comes
 * into reach and kept.
 */

import type { RouteProfile } from '@onyourleft/domain';
import { triangulate, type LandUseFeature } from '@onyourleft/map-features';

import type { LandClassMask } from './land-class';
import { terrainHeightAt } from './landform';
import { nearestOnDrawnRoad } from './road-grid';
import { ROAD_WIDTH_METRES, type CorridorOrigin } from './terrain';
import type { PoolSurface } from './waterways';
import { CORRIDOR_HALF_WIDTH_METRES, type WorldCorridor } from './world-data/corridor';

/** The `water` polygon kinds drawn as a pool. @see the header for why `basin` is not one. */
export const POOL_KINDS: ReadonlySet<string> = new Set(['swimming_pool', 'fountain']);

/** How far from the camera a pool is drawn, in metres: **200**. Past it a pool is a few pixels. */
export const POOL_REACH_METRES = 200;

/** The most pools a frame draws, nearest the camera first: **16**. */
export const POOLS_DRAWN = 16;

/**
 * The most points a pool's outline may have: **64**. A pool is a rectangle,
 * a kidney or a circle; an outline of more is drawn as no pool rather than
 * costing a frame its triangles.
 */
export const POOL_RING_MAX_POINTS = 64;

/**
 * The widest a pool may be across its box, in metres: **60** — past an
 * Olympic pool's 50 m. A larger `swimming_pool` polygon is a lido's grounds,
 * and is left to the mask's water.
 */
export const POOL_MAX_SPAN_METRES = 60;

/** The most pools one corridor holds: **2 048**, a bound on a corridor of hostile polygons. */
export const POOLS_MAX = 2_048;

/** How wide a pool's coping is, in metres: **0.4**. */
export const POOL_EDGE_METRES = 0.4;

/** How far its coping stands over its water, in metres: **0.12**. */
export const POOL_EDGE_RISE_METRES = 0.12;

/** How far its water stands over the highest ground under its outline, in metres: **0.03**. */
export const POOL_WATER_LIFT_METRES = 0.03;

/** How far its coping's skirt reaches under the lowest ground under its outline, in metres. */
const POOL_SKIRT_METRES = 0.1;

/**
 * The nearest a pool's outline may come to the drawn road's centreline, in
 * metres: the road's half-width and **1** more. A pool mapped on the road is
 * a mapping error, and a pool drawn there would stand in the rider's way.
 */
export const POOL_ROAD_CLEARANCE_METRES = ROAD_WIDTH_METRES / 2 + 1;

/** One mapped pool, before its ground is read. */
interface Pool {
  /** Its outline, `x, z` pairs, open (no repeated last point). */
  readonly ring: Float32Array;
  /** Its water's triangles, as indices into {@link ring}'s points. */
  readonly indices: Uint32Array;
  /** Its coping's outer edge. @see PoolSurface.outer */
  readonly outer: Float32Array;
  readonly x: number;
  readonly z: number;
  /** Its surface, once read; `null` where it stands off the ground or on the road. */
  surface: PoolSurface | null | undefined;
}

interface Pools {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly seed: number;
  readonly land: LandClassMask;
  readonly pools: readonly Pool[];
}

const built = new WeakMap<WorldCorridor, Pools>();

/**
 * The pools a frame draws round the camera — at most {@link POOLS_DRAWN}
 * within {@link POOL_REACH_METRES}, nearest first, each on the ground under
 * it. None where the corridor maps none.
 */
export function poolsInView(
  corridor: WorldCorridor,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask,
  cameraX: number,
  cameraZ: number,
): readonly PoolSurface[] {
  const { pools } = poolsOf(corridor, profile, origin, seed, land);
  if (pools.length === 0) return NO_POOLS;
  const reach = POOL_REACH_METRES * POOL_REACH_METRES;
  const near: { readonly pool: Pool; readonly squared: number }[] = [];
  for (const pool of pools) {
    const squared = (pool.x - cameraX) ** 2 + (pool.z - cameraZ) ** 2;
    if (squared <= reach) near.push({ pool, squared });
  }
  if (near.length === 0) return NO_POOLS;
  near.sort((a, b) => a.squared - b.squared);
  const drawn: PoolSurface[] = [];
  for (const { pool } of near) {
    if (drawn.length >= POOLS_DRAWN) break;
    pool.surface ??= surfaceOf(pool, profile, origin, seed, land);
    if (pool.surface !== null) drawn.push(pool.surface);
  }
  return drawn;
}

const NO_POOLS: readonly PoolSurface[] = Object.freeze([]);

function poolsOf(
  corridor: WorldCorridor,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask,
): Pools {
  const known = built.get(corridor);
  if (
    known !== undefined &&
    known.profile === profile &&
    known.origin === origin &&
    known.seed === seed &&
    known.land === land
  ) {
    return known;
  }
  const pools: Pool[] = [];
  for (const feature of corridor.landUse) {
    if (pools.length >= POOLS_MAX) break;
    const pool = poolOf(feature);
    if (pool !== undefined) pools.push(pool);
  }
  const made: Pools = { profile, origin, seed, land, pools };
  built.set(corridor, made);
  return made;
}

/** One polygon as a pool, or `undefined` where it is not one or cannot be drawn as one. */
function poolOf(feature: LandUseFeature): Pool | undefined {
  if (feature.layer !== 'water' || !POOL_KINDS.has(feature.kind)) return undefined;
  const outer = feature.rings[0];
  if (outer === undefined) return undefined;
  let points = outer.length / 2;
  // An outline closed by repeating its first point is the same outline open.
  if (points > 3 && outer[0] === outer[outer.length - 2] && outer[1] === outer[outer.length - 1]) {
    points -= 1;
  }
  if (points < 3 || points > POOL_RING_MAX_POINTS) return undefined;
  const ring = outer.slice(0, points * 2);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let sumX = 0;
  let sumZ = 0;
  for (let point = 0; point < points; point += 1) {
    const x = ring[point * 2] as number;
    const z = ring[point * 2 + 1] as number;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return undefined;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
    sumX += x;
    sumZ += z;
  }
  if (maxX - minX > POOL_MAX_SPAN_METRES || maxZ - minZ > POOL_MAX_SPAN_METRES) return undefined;
  const indices = triangulate({ rings: [ring] });
  if (indices.length === 0) return undefined;
  return {
    ring,
    indices,
    outer: copingOf(ring),
    x: sumX / points,
    z: sumZ / points,
    surface: undefined,
  };
}

/**
 * The outer edge of a pool's coping: each point of its outline moved out
 * {@link POOL_EDGE_METRES} square to both its sides — the mitre of the two
 * sides' own offsets, held to twice the width at a sharp corner — whichever
 * way the outline winds.
 */
function copingOf(ring: Float32Array): Float32Array {
  const points = ring.length / 2;
  let area = 0;
  for (let point = 0; point < points; point += 1) {
    const next = (point + 1) % points;
    area +=
      (ring[point * 2] as number) * (ring[next * 2 + 1] as number) -
      (ring[next * 2] as number) * (ring[point * 2 + 1] as number);
  }
  const outward = area > 0 ? 1 : -1;
  /** A side's outward unit normal, from point `from` to the next. */
  const normal = (from: number): readonly [number, number] => {
    const to = (from + 1) % points;
    const dx = (ring[to * 2] as number) - (ring[from * 2] as number);
    const dz = (ring[to * 2 + 1] as number) - (ring[from * 2 + 1] as number);
    const length = Math.hypot(dx, dz);
    return length > 0 ? [(dz / length) * outward, (-dx / length) * outward] : [0, 0];
  };
  const outer = new Float32Array(ring.length);
  for (let point = 0; point < points; point += 1) {
    const [ax, az] = normal((point + points - 1) % points);
    const [bx, bz] = normal(point);
    let mx = ax + bx;
    let mz = az + bz;
    const length = Math.hypot(mx, mz);
    if (length > 0) {
      mx /= length;
      mz /= length;
    }
    // How far along the mitre the offset is: the width over the cosine of half the turn.
    const cosine = mx * bx + mz * bz;
    const reach = POOL_EDGE_METRES / Math.max(0.5, cosine);
    outer[point * 2] = (ring[point * 2] as number) + mx * reach;
    outer[point * 2 + 1] = (ring[point * 2 + 1] as number) + mz * reach;
  }
  return outer;
}

/**
 * A pool on the ground: its water {@link POOL_WATER_LIFT_METRES} over the
 * highest ground under its outline, its coping's foot under the lowest, read
 * through `landform.ts` §`terrainHeightAt` — the ground the renderer draws.
 * `null` where any point of its outline is off the corridor's ground or
 * within {@link POOL_ROAD_CLEARANCE_METRES} of the road.
 */
function surfaceOf(
  pool: Pool,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask,
): PoolSurface | null {
  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  const points = pool.ring.length / 2;
  for (let point = 0; point < points; point += 1) {
    const x = pool.ring[point * 2] as number;
    const z = pool.ring[point * 2 + 1] as number;
    const near = nearestOnDrawnRoad(profile, origin, x, z, CORRIDOR_HALF_WIDTH_METRES);
    if (near === undefined || near.distance < POOL_ROAD_CLEARANCE_METRES) return null;
    const ground = terrainHeightAt(profile, origin, seed, near.along, near.lateral, land);
    if (!Number.isFinite(ground)) return null;
    high = Math.max(high, ground);
    low = Math.min(low, ground);
  }
  const water = high + POOL_WATER_LIFT_METRES;
  return {
    ring: pool.ring,
    indices: pool.indices,
    centreX: pool.x,
    centreZ: pool.z,
    water,
    edge: water + POOL_EDGE_RISE_METRES,
    foot: low - POOL_SKIRT_METRES,
    outer: pool.outer,
  };
}
