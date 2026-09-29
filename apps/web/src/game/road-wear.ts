// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How the realistic road is worn — #628.
 *
 * The photographic road (`three-renderer.ts` §`photographicRoadMaterial`) is
 * one asphalt photograph used as a grain on `terrain.ts`' gradient tint. A real
 * road is worn: the tyres polish two tracks in each lane, a council patches it,
 * dust collects beside the edge line where nothing runs, and the paint fades.
 * This file says **where** each of those is and **how much** it may change the
 * surface; the renderer's road shader draws them, in the road's own one mesh
 * and one draw call, with no texture.
 *
 * ## The road's colour is information, so wear is bounded by arithmetic
 *
 * `terrain.ts` tints the carriageway by signed gradient against
 * `MINIMUM_TINT_CONTRAST_RATIO` (3 : 1), and the realistic read-back of the
 * steepest climb against the steepest descent was **3.97 : 1** before this
 * issue (`three-renderer.ts` §`ROAD_SHEEN`). Wear lightens and darkens the
 * surface, so it spends that margin, and #628 keeps **3.5 : 1**. The worst a
 * multiplicative wear factor `1 ± w` can do is lighten the climb and darken the
 * descent, which divides the ratio by `(1 + w) / (1 − w)`:
 *
 *     3.97 · (1 − w) / (1 + w) ≥ 3.5   ⇔   w ≤ 0.47 / 7.47 = 0.0629
 *
 * so every term together is clamped to {@link MAXIMUM_WEAR_SHARE}, 0.06, in the
 * shader — a clamp rather than a sum of bounds, so a patch lying on a wheel
 * track cannot add up past it. `road-wear.test.ts` holds that arithmetic, and
 * the browser gate reads the ratio back with wear on.
 *
 * ## Where a patch is
 *
 * By **route distance**, from `seeded.ts`: a patch is where it was on every
 * ride and on every lap, and does not move with the rider. The shader cannot
 * read a route distance (the road carries no such attribute), so the patches
 * in the corridor are turned into world-space rectangles here, each frame the
 * road is drawn, and handed over as a small uniform array
 * ({@link MAXIMUM_ROAD_PATCHES}).
 *
 * Pure: names no rendering library.
 */

import { slotHash, uniformFrom } from './seeded';
import {
  COLUMN_OFFSETS,
  EDGE_LINE_WIDTH_METRES,
  ROAD_COLUMNS,
  ROAD_WIDTH_METRES,
  type CorridorPoint,
  type RoadCorridor,
} from './terrain';

/** Half the carriageway, edge line to centre line, in metres. */
const HALF_ROAD = ROAD_WIDTH_METRES / 2;

/** Where the carriageway ends and the edge line begins, from the centre line. */
export const CARRIAGEWAY_HALF_METRES = HALF_ROAD - EDGE_LINE_WIDTH_METRES;

/**
 * The most every wear term together may lighten or darken the carriageway, as
 * a share: **0.06**. @see the file header for the arithmetic.
 */
export const MAXIMUM_WEAR_SHARE = 0.06;

/**
 * The climb/descent read-back #628 keeps, as a contrast ratio: **3.5**.
 *
 * @test-facing the floor `game.browser.spec.ts` holds the worn road to and the
 * arithmetic in `road-wear.test.ts` is solved against.
 */
export const WORN_ROAD_CONTRAST_FLOOR = 3.5;

/**
 * What the realistic road read back before any wear: **3.97 : 1**, measured
 * by the browser gate at `ROAD_SHEEN` 0.25 (`three-renderer.ts`).
 *
 * @test-facing the measured starting point of the arithmetic in the header.
 */
export const UNWORN_ROAD_CONTRAST = 3.97;

/**
 * Where the tyres run, across the road, in metres from the centre line —
 * **±0.95 and ±2.55**: each lane's centre (1.75 m) ± 0.8 m, half a car's wheel
 * track of about 1.6 m. This repository's own figures.
 */
export const WHEEL_TRACK_OFFSETS_METRES: readonly number[] = [-2.55, -0.95, 0.95, 2.55];

/** Half a wheel track's width, in metres, before its soft edge: **0.25**. */
export const WHEEL_TRACK_HALF_WIDTH_METRES = 0.25;

/** Over how many metres a wheel track's edge fades out: **0.2**. */
export const WHEEL_TRACK_EDGE_METRES = 0.2;

/** How much lighter a wheel track is, as a share: **0.05**. Polished, not painted. */
export const WHEEL_TRACK_LIGHTEN = 0.05;

/**
 * How much of the normal map's relief a wheel track keeps: **0.35**, because
 * the tyres polish the aggregate flat. And how much of its roughness: **0.85**.
 */
export const WHEEL_TRACK_RELIEF = 0.35;
export const WHEEL_TRACK_ROUGHNESS = 0.85;

/** How wide the dusty band inside each edge line is, in metres: **0.45**. */
export const DUST_BAND_METRES = 0.45;

/** How much lighter the dust is, as a share: **0.05**. */
export const DUST_LIGHTEN = 0.05;

/**
 * How much of its brightness the paint may lose where it is most worn: **0.3**.
 * The lines are not the gradient cue — they are painted and outside the tint —
 * so they are not held to {@link MAXIMUM_WEAR_SHARE}; they stay far brighter
 * than any tint (`terrain.ts` §`MARKING_COLOUR`).
 */
export const PAINT_WEAR = 0.3;

/** How long a stretch of road holds at most one patch, in metres of route: **35**. */
export const PATCH_CELL_METRES = 35;

/** The share of those stretches that has a patch: **0.45**. */
export const PATCH_CHANCE = 0.45;

/** A patch's length along the road, in metres: **1.2** to **4.5**. */
export const PATCH_LENGTH_METRES: readonly [number, number] = [1.2, 4.5];

/** A patch's width across it, in metres: **0.9** to **2.8**. */
export const PATCH_WIDTH_METRES: readonly [number, number] = [0.9, 2.8];

/**
 * How much darker or lighter a patch is, as a share: **−0.05** to **+0.04** —
 * fresh asphalt is darker, an old patch paler. Inside {@link MAXIMUM_WEAR_SHARE}.
 */
export const PATCH_TONE: readonly [number, number] = [-0.05, 0.04];

/**
 * How many patches the shader is handed at most: **8**. A corridor is 460 m,
 * about thirteen cells and six patches at {@link PATCH_CHANCE}; the nearest
 * eight are kept, which is every one a rider can tell apart.
 */
export const MAXIMUM_ROAD_PATCHES = 8;

/** The seed every patch is drawn from — this file's own; a patch's CELL is what varies. */
const PATCH_SEED = 0x628_0b1d;

/** One patch, in route terms. */
export interface RoadPatch {
  /** Route distance of its middle, wrapped as `CorridorPoint.distance` is. */
  readonly distance: number;
  /** Metres from the centre line, positive on the corridor's normal side. */
  readonly across: number;
  readonly length: number;
  readonly width: number;
  readonly tone: number;
}

/** The patch in one cell of route, or none — seeded and stateless. */
export function patchInCell(cell: number): RoadPatch | undefined {
  const base = slotHash(PATCH_SEED, cell, 0);
  if (uniformFrom(base, 0) >= PATCH_CHANCE) return undefined;
  const lerp = ([low, high]: readonly [number, number], stream: number): number =>
    low + (high - low) * uniformFrom(base, stream);
  const length = lerp(PATCH_LENGTH_METRES, 1);
  const width = lerp(PATCH_WIDTH_METRES, 2);
  const reach = CARRIAGEWAY_HALF_METRES - width / 2;
  return {
    distance: (cell + 0.2 + 0.6 * uniformFrom(base, 3)) * PATCH_CELL_METRES,
    across: -reach + 2 * reach * uniformFrom(base, 4),
    length,
    width,
    tone: lerp(PATCH_TONE, 5),
  };
}

/** Floats per patch in {@link roadPatchUniforms}' array: centre x, z; along x, z; half length, half width, tone, unused. */
export const ROAD_PATCH_FLOATS = 8;

/**
 * The patches lying in this corridor, as world-space rectangles, written into
 * `into` ({@link MAXIMUM_ROAD_PATCHES} × {@link ROAD_PATCH_FLOATS} floats) —
 * nearest the rider first. Returns how many were written. Allocates nothing
 * but the patches it reads.
 *
 * A patch is placed on the DRAWN road, between the two corridor points whose
 * route distances bracket its middle, so it lies where the tarmac is; on a
 * loop, the corridor's own wrapped `distance` is what is matched, which is
 * what makes lap two's patch lap one's.
 */
export function roadPatchUniforms(corridor: RoadCorridor, into: Float32Array): number {
  const centre = corridor.centre;
  into.fill(0);
  if (centre.length < 2) return 0;
  let written = 0;
  for (let index = 0; index + 1 < centre.length && written < MAXIMUM_ROAD_PATCHES; index += 1) {
    const here = centre[index] as CorridorPoint;
    const next = centre[index + 1] as CorridorPoint;
    // A wrapped pair (the lap line, where `distance` falls back to 0) spans no road.
    if (next.distance <= here.distance) continue;
    const fromCell = Math.floor(here.distance / PATCH_CELL_METRES);
    const toCell = Math.floor(next.distance / PATCH_CELL_METRES);
    for (let cell = fromCell; cell <= toCell && written < MAXIMUM_ROAD_PATCHES; cell += 1) {
      const patch = patchInCell(cell);
      if (patch === undefined) continue;
      if (patch.distance < here.distance || patch.distance >= next.distance) continue;
      const share = (patch.distance - here.distance) / (next.distance - here.distance);
      const alongX = next.x - here.x;
      const alongZ = next.z - here.z;
      const span = Math.hypot(alongX, alongZ);
      if (span === 0) continue;
      const ux = alongX / span;
      const uz = alongZ / span;
      // The corridor's normal, as `terrain.ts` builds it: the heading turned
      // to the rider's right, `(−headingZ, headingX)`.
      const nx = -uz;
      const nz = ux;
      const at = written * ROAD_PATCH_FLOATS;
      into[at] = here.x + alongX * share + nx * patch.across;
      into[at + 1] = here.z + alongZ * share + nz * patch.across;
      into[at + 2] = ux;
      into[at + 3] = uz;
      into[at + 4] = patch.length / 2;
      into[at + 5] = patch.width / 2;
      into[at + 6] = patch.tone;
      written += 1;
    }
  }
  return written;
}

/**
 * Each road vertex's distance across the road from the centre line, in metres
 * on the corridor's normal — the one float #628 adds to the road, and only to
 * the realistic world's (the stylised material never reads it).
 *
 * ⚠️ **A property of the vertex's INDEX, not of its position**: the first
 * `centre.length × ROAD_COLUMNS` vertices are the surface, column by column
 * (`terrain.ts` §`RoadCorridor.vertices`), so a vertex's column is its index
 * modulo {@link ROAD_COLUMNS} and its offset `terrain.ts` §`COLUMN_OFFSETS`.
 * The centre-line marks after them are written 0; the shader tells paint from
 * tarmac by the vertex colour, not by this. Interpolated across the
 * carriageway's one quad, it is the true lateral offset at every fragment.
 */
export function writeRoadAcross(corridor: RoadCorridor, into: Float32Array): void {
  const surface = Math.min(corridor.centre.length * ROAD_COLUMNS, into.length);
  for (let vertex = 0; vertex < surface; vertex += 1) {
    into[vertex] = COLUMN_OFFSETS[vertex % ROAD_COLUMNS] as number;
  }
  into.fill(0, surface, Math.min(corridor.vertices.length / 3, into.length));
}
