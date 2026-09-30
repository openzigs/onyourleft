// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the realistic ground is, where — #627.
 *
 * The realistic ground was one grass photograph everywhere: on the verge, on a
 * 30 % bank, on a ridge above the tree line. It is blended now, by what the
 * ground is doing — and ONLY from what the route's own landform says
 * (`landform.ts`: its heights, its normals and each vertex's offset from the
 * road), never from anything about the real place (ADR 0032 D-1):
 *
 * - a worn **verge** of earth and gravel along the road's edge, by the
 *   distance from the edge ({@link VERGE_BLEND_METRES});
 * - bare **rock** where the landform is steep, by its slope
 *   ({@link ROCK_SLOPE_DEGREES});
 * - **scree** above the tree line, by its height ({@link SCREE_BAND_METRES}
 *   about `world.ts` §`treeLineMetres`).
 *
 * Each blend is soft over a stated range, and each is in the ground's one
 * existing draw call, from attributes the ground already carries (`fields`
 * gives the offset from the road, `normal` the slope, `position` the height):
 * no new draw call, no new mesh and no new vertex attribute.
 *
 * Pure: names no rendering library. `three-renderer.ts`
 * §`photographicGroundMaterial` is the shader that reads these.
 */

import { ROAD_WIDTH_METRES, type CorridorOrigin } from './terrain';
import { treeLineMetres } from './world';

/**
 * The verge, measured from the road's edge outward, in metres: full earth and
 * gravel to **0.45**, grass again by **0.9** — #627's "a band of stated width
 * inside the first landform column". `landform.ts` §`VERGE_METRES` (0.6) is
 * that column: the band reaches a little past it, onto the ground beyond,
 * where a worn verge does.
 */
export const VERGE_BLEND_METRES: readonly [number, number] = [0.45, 0.9];

/** The road's half-width, from which the verge is measured. */
export const ROAD_EDGE_METRES = ROAD_WIDTH_METRES / 2;

/**
 * The slope at which bare rock begins to show, and at which it is all rock, in
 * degrees: **28** and **40**. This repository's own figures, either side of the
 * angle of repose of loose earth and scree (about 30–35°), past which soil
 * does not stay on a bank.
 */
export const ROCK_SLOPE_DEGREES: readonly [number, number] = [28, 40];

/**
 * How far below and above the tree line scree fades in, in metres: from
 * **40** below to **40** above. Soft, because a tree line is a band on a hill
 * and not a contour.
 */
export const SCREE_BAND_METRES = 40;

/**
 * The tree line as a height in the corridor's frame — local metres, relative
 * to the route's first elevation, as every vertex's `y` is (`terrain.ts`
 * §`CorridorPoint.y`). `scatter.ts` places no tree above the same line, read
 * the same way (`world.ts` §`treeLineMetres`).
 */
export function treeLineHeight(origin: CorridorOrigin): number {
  return treeLineMetres(Math.abs(origin.latitude)) - origin.elevation;
}

/** A smooth step, as GLSL's `smoothstep`. */
function smooth(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * How much of each surface a point of ground is: the arithmetic the shader
 * does, stated once in TypeScript so a test can hold its ranges. The shader is
 * generated from the same constants.
 *
 * @test-facing the arithmetic `ground-blend.test.ts` holds; the product runs
 * the same arithmetic in GLSL, built from these constants.
 *
 * @param lateral metres from the road's centreline (either side)
 * @param up the ground normal's vertical component
 * @param height the point's height in the corridor's frame
 * @param treeLine {@link treeLineHeight}
 */
export function groundBlend(
  lateral: number,
  up: number,
  height: number,
  treeLine: number,
): { readonly verge: number; readonly rock: number; readonly scree: number } {
  const fromEdge = Math.abs(lateral) - ROAD_EDGE_METRES;
  const slopeDegrees = (Math.acos(Math.min(1, Math.max(-1, up))) * 180) / Math.PI;
  return {
    verge: 1 - smooth(VERGE_BLEND_METRES[0], VERGE_BLEND_METRES[1], fromEdge),
    rock: smooth(ROCK_SLOPE_DEGREES[0], ROCK_SLOPE_DEGREES[1], slopeDegrees),
    scree: smooth(treeLine - SCREE_BAND_METRES, treeLine + SCREE_BAND_METRES, height),
  };
}
