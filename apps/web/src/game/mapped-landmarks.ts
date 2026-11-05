// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The mapped landmarks drawn as themselves — #1794, epic #1656, under the
 * owner's rulings D7 (procedural churches, town halls and schools from #1557's
 * type field; models stay with #1639) and D2 (a steeple is plan-time geometry
 * inside the 640/200 caps) of 2026-10-27.
 *
 * ## A church
 *
 * A mapped place of worship (`building-types.ts` §`isWorship`: the `worship`
 * landmark, or a church, a chapel or a cathedral) whose footprint holds a nave
 * and a tower ({@link churchFits}) is drawn as a **nave** under a steep gable
 * ({@link CHURCH_FEATURES}: 45°, over its minimum-area rectangle, or over
 * #1660's rectangles on an L, a T or a cross) with #2021's **tower and spire**
 * (`footprint-buildings.ts` §`STEEPLE`, §`steeple`) at the end of its long axis
 * away from its front door — the owner's ruling of 2026-11-03 on #2087, which
 * is later than the issue's "the gable end nearest the route", and which put
 * the tower clear of the door. Its spire's top is set by
 * {@link spireApexOf}: at the mapped height where that is at least
 * {@link CHURCH}'s `tall` times the nave's walls (an OSM church height often
 * includes its spire), else at `ridgeFactor` times the nave's ridge, at most
 * `highest` metres. Everything else is #1791's civic block: the walls'
 * cladding and windows (no new window kind), its plain door (no wreath, and
 * no decoration: a civic plan is no house, so it has no front step), and the
 * `wall` and `roof` surfaces.
 *
 * A footprint too small or too irregular for a nave and a tower, a part, a
 * terraced one, one with a flat mapped `roof:shape` and one whose tower will
 * not stand on it keeps the plan it had before #1794 (#1791's block, with
 * #2021's steeple where that fits), and so does every one with
 * `?levers=-landmark-churches`. A church with courtyards gives them up before
 * its tower to fit the caps; a nave of 1 to 3 rectangles and its steeple are
 * then far inside them.
 *
 * Plan-time only, built once at the press: no draw call, no byte, and no
 * shader term. Formats no string, so names no vertex (ADR 0004 D).
 */

import { CIVIC_FEATURES } from './building-types';
import { ARCHETYPE_MIN_RECTANGULARITY, type ArchetypeFeatures } from './house-archetypes';

/**
 * A church's numbers — #1794, a sketch to be tuned on the owner's look pair
 * (`?town=churches` against `levers=-landmark-churches`):
 *
 * - `leastArea`, m², and `leastRectangularity`: under either, no nave and
 *   tower fit, and the footprint keeps its civic block (the issue's 80 m² and
 *   0.6);
 * - `pitchDegrees`: the nave's gable, the steepest of
 *   `footprint-buildings.ts` §`ROOF_PITCHES_DEGREES` and the foot of the
 *   issue's 45–50°;
 * - `storeys`: the nave's walls where its mapped height is its spire's and it
 *   has no mapped `building:levels`;
 * - `tall`: a mapped height at least this many times the nave's walls is the
 *   spire's top;
 * - `ridgeFactor` and `highest`: otherwise the spire's top is the ridge's
 *   height above the ground times this, at most `highest` metres;
 * - `leastSpire`: a spire is never shorter than this, metres — a nave too low
 *   for `ridgeFactor` to clear #2100's tower keeps a spire this tall.
 */
export const CHURCH = {
  leastArea: 80,
  leastRectangularity: 0.6,
  pitchDegrees: 45,
  storeys: 2,
  tall: 1.6,
  ridgeFactor: 1.8,
  highest: 40,
  leastSpire: 3,
} as const;

/** A church's features: #1791's civic block's, under a steep gable rather than its low hip. */
export const CHURCH_FEATURES: ArchetypeFeatures = {
  ...CIVIC_FEATURES,
  hip: 0,
  pitches: [CHURCH.pitchDegrees],
  chimney: 0,
  roofVariant: 'none',
};

/**
 * Whether a place of worship's footprint holds a nave — #1794: at least
 * {@link CHURCH}'s `leastArea` and `leastRectangularity`, and a shape a gable
 * is built on: a clean rectangle, or #1660's 1 to 3 rectangles (`rectilinear`).
 * Its tower's own fit is #2021's, asked by the planner.
 */
export function churchFits(footprint: {
  readonly area: number;
  readonly rectangularity: number;
  readonly rectilinear: boolean;
}): boolean {
  const { area, rectangularity, rectilinear } = footprint;
  return (
    area >= CHURCH.leastArea &&
    rectangularity >= CHURCH.leastRectangularity &&
    (rectilinear || rectangularity >= ARCHETYPE_MIN_RECTANGULARITY)
  );
}

/**
 * Whether a church's mapped height is its spire's top — #1794: at least
 * {@link CHURCH}'s `tall` times `naveWalls`, the nave's walls' height, metres.
 */
export function spireIsMapped(height: number | null, naveWalls: number): boolean {
  return height !== null && height >= CHURCH.tall * naveWalls;
}

/**
 * The height of a church's spire's top, metres, local — #1794: `mapped` (the
 * ground plus the mapped height) where {@link spireIsMapped}, else the
 * `ground` plus `ridgeFactor` times the `ridge`'s height above it, at most
 * `highest`; and never under {@link CHURCH}'s `leastSpire` above the tower's
 * `towerTop`.
 */
export function spireApexOf(heights: {
  readonly ground: number;
  readonly ridge: number;
  readonly towerTop: number;
  readonly mapped: number | undefined;
}): number {
  const { ground, ridge, towerTop, mapped } = heights;
  const ruled = mapped ?? ground + Math.min(CHURCH.ridgeFactor * (ridge - ground), CHURCH.highest);
  return Math.max(ruled, towerTop + CHURCH.leastSpire);
}
