// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which level of detail a realistic tree is drawn at, and how two levels hand
 * over without a pop — #617.
 *
 * ## Three levels, by rank
 *
 * The realistic trees of BOTH kinds are ranked together by distance from the
 * rider, and the rank alone decides the level (0 is the nearest):
 *
 * | Rank | Drawn as |
 * |---|---|
 * | `0 … near − 1` | the full mesh |
 * | `near` | **band A**: the full mesh AND the middle one, dithered |
 * | `near + 1 … near + middle` | the middle mesh |
 * | `near + middle + 1` | **band B**: the middle mesh AND the impostor, dithered |
 * | beyond | the impostor |
 *
 * A count rather than a distance, for `realistic-budget.ts`
 * §`REALISTIC_NEAR_MESHES`' reason: a distance on a wooded road puts thirty
 * trees in the near band, and a count holds the frame's triangles whatever
 * the road. ⚠️ **Both kinds together rather than a count per kind** — see
 * `realistic-budget.ts` §`REALISTIC_TREE_LEVELS`, which does the arithmetic.
 *
 * ## The hand-over is a fade, and the fade is continuous
 *
 * A band item's fade is where its distance sits between its two neighbours':
 *
 *     fade = (d[rank] − d[rank − 1]) / (d[rank + 1] − d[rank − 1])
 *
 * which is 0 when it has closed on the tree in front (it is about to take that
 * tree's rank, and be drawn as that tree is) and 1 when the tree behind has
 * closed on it (it is about to swap back, and be drawn as that tree is). So
 * when two trees swap ranks, each is drawn on both sides of the swap as the
 * other was — **no tree changes shape in one frame**, which a hard swap at the
 * Nth-nearest cannot say.
 *
 * ## The dither, and why there is no blending
 *
 * The two levels of a band item are both submitted, and each keeps the
 * fragments whose screen-space hash falls in its half of `[0, 1)` —
 * {@link writeKeep}. The two halves are complementary at every pixel, so the
 * item's coverage is one level's or the other's there, never both and never
 * neither. No alpha blending and no sorting: each is an alpha-TESTED opaque
 * draw, like every realistic surface (`three-renderer.ts`
 * §`prepareRealisticShape`).
 *
 * Pure, allocating nothing: the belt calls it for every tree every frame.
 */

/** How many trees are drawn at each mesh level, and whether the hand-overs are dithered. */
export interface TreeLevels {
  /** Trees drawn as the full mesh alone — the nearest ones. */
  readonly near: number;
  /** Trees drawn as the middle mesh alone, beyond those. */
  readonly middle: number;
  /**
   * Whether each hand-over is a band of one tree drawn at both levels. `false`
   * is the hard swap there was before #617 — the browser gate's control.
   */
  readonly dithered: boolean;
}

/** What a tree at a rank is drawn as. @see treeLevelAt */
export type TreeLevel = 'full' | 'full-middle' | 'middle' | 'middle-impostor' | 'impostor';

/** How many trees each level may hold at once — the instanced meshes' capacities. */
export interface TreeSlots {
  /** The full level's: {@link TreeLevels.near} and band A's one. */
  readonly full: number;
  /** The middle level's: {@link TreeLevels.middle} and both bands' one each. */
  readonly middle: number;
  /** How many nearest distances the fades need: every drawn rank and one beyond. */
  readonly ranked: number;
}

export function treeSlots(levels: TreeLevels): TreeSlots {
  const band = levels.dithered ? 1 : 0;
  return {
    full: levels.near + band,
    middle: levels.middle + 2 * band,
    ranked: levels.near + levels.middle + 3 * band,
  };
}

/** What the tree at `rank` (0 the nearest) is drawn as. */
export function treeLevelAt(rank: number, levels: TreeLevels): TreeLevel {
  if (rank < levels.near) return 'full';
  if (!levels.dithered) return rank < levels.near + levels.middle ? 'middle' : 'impostor';
  if (rank === levels.near) return 'full-middle';
  if (rank <= levels.near + levels.middle) return 'middle';
  if (rank === levels.near + levels.middle + 1) return 'middle-impostor';
  return 'impostor';
}

/**
 * A band tree's fade, from the distances of the trees ranked either side of it
 * (`distances[0]` the nearest, `count` of them known). 0 draws it as the level
 * nearer the rider, 1 as the level further out.
 *
 * Where there is no tree behind it — fewer trees in view than the ranks — the
 * fade is 0: it is drawn as the nearer level, which is what it would be if no
 * band followed it. Where its neighbours stand at one distance, the same.
 */
export function bandFade(rank: number, distances: ArrayLike<number>, count: number): number {
  if (rank + 1 >= count) return 0;
  const before = rank === 0 ? 0 : (distances[rank - 1] ?? 0);
  const at = distances[rank] ?? 0;
  const after = distances[rank + 1] ?? 0;
  const span = after - before;
  if (!(span > 0)) return 0;
  return Math.min(1, Math.max(0, (at - before) / span));
}

/** Which part of the screen hash a level keeps. @see writeKeep */
export type Keep = 'all' | 'nearer' | 'further';

/**
 * Writes the half of the screen hash `[0, 1)` a level of a tree keeps — the
 * `[low, high)` the shader discards outside of — into instance `index` of an
 * instance attribute three numbers wide (`InstancedMesh.instanceColor`'s).
 *
 * - `nearer`, the level nearer the rider in a band, keeps `[fade, 2)`: all of
 *   it at a fade of 0 and none at 1.
 * - `further`, the level further out, keeps `[−1, fade)`: the complement.
 * - `all` writes `[0, 0)`, which the shader reads as "no dither" — so a mesh
 *   drawn with no keep at all (three's default attribute value is nought)
 *   keeps every fragment rather than none.
 *
 * Into the attribute's own array rather than a tuple, so a frame allocates
 * nothing.
 */
export function writeKeep(into: Float32Array, index: number, keep: Keep, fade: number): void {
  const at = index * 3;
  into[at] = keep === 'all' ? 0 : keep === 'nearer' ? fade : -1;
  into[at + 1] = keep === 'all' ? 0 : keep === 'nearer' ? 2 : fade;
  into[at + 2] = 0;
}
