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
 * ## Only trees the camera can see are ranked — #617's review
 *
 * A tree is ranked only if some part of it can be in the camera's view:
 * `three-renderer.ts` §`treeCanBeSeen`. Before, every tree the scatter belt
 * kept was ranked, down to 60 m BEHIND the rider — and with one full slot,
 * that slot was routinely spent on a tree the rider had just passed and could
 * not see, while the nearest tree in the picture was drawn at the middle
 * level. {@link TreeLevels.rankOnly} `'in-view'` is that old ranking, kept as
 * the browser gate's control.
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
 * other was.
 *
 * ## ⚠️ …but the ranked SET changing is not a swap, so the hand-over is also paced
 *
 * The fade above is continuous only while the same trees are ranked. When a
 * tree leaves the ranked set — it passes out of the camera's view, which since
 * the review is how EVERY tree the rider passes leaves it — every tree behind
 * it moves up a rank in one frame: the band tree jumps to the full mesh and the
 * next tree jumps into the band. The same happens when a tree enters the set,
 * when there are fewer trees than ranks (a band tree's fade falls back to 0),
 * and when the rung's budget moves. A rank-based rule cannot be continuous
 * there — removing the nearest tree shifts every boundary by one tree — so
 * the rank decides only where each tree is GOING, and {@link TreeHandOver}
 * moves what it is drawn as there at most {@link TreeLevels.handOverFrames}'s
 * share a frame, inside the same slots. What that still cannot hold, stated
 * rather than hidden, is in {@link TreeHandOver}'s own comment.
 *
 * ## The dither, and why there is no blending
 *
 * A tree is drawn as a split of `[0, 1)` between its levels: the impostor
 * keeps `[0, low)`, the middle level `[low, high)` and the full mesh
 * `[high, 1)` of a screen-space hash — {@link writeInterval}. The shares are
 * complementary at every pixel, so the item's coverage is one level's there,
 * never two and never none. No alpha blending and no sorting: each is an
 * alpha-TESTED opaque draw, like every realistic surface (`three-renderer.ts`
 * §`prepareRealisticShape`). A band tree is the split with one boundary at its
 * fade; a tree mid-way through a paced hand-over may briefly be split between
 * the full mesh and its impostor, or across all three.
 *
 * Pure, allocating nothing per frame: the belt calls it for every tree every
 * frame, and {@link TreeHandOver}'s memory is typed arrays sized once.
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
  /**
   * How many frames a tree takes to go from one level to the next when its
   * rank jumps — {@link TreeHandOver}. `1` goes at once, which is the hard
   * hand-over there was before the review — a control, never the product.
   */
  readonly handOverFrames: number;
  /**
   * Which trees are ranked: `'visible'` only those the camera can see (the
   * product), `'in-view'` every tree the scatter belt keeps, down to 60 m
   * behind the rider — the ranking before #617's review, and the browser
   * gate's control for it.
   */
  readonly rankOnly: 'visible' | 'in-view';
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

/**
 * Where a tree at `level` with `fade` splits `[0, 1)`: the impostor keeps
 * `[0, low)`, the middle level `[low, high)` and the full mesh `[high, 1)`.
 *
 * | Level | low | high |
 * |---|--:|--:|
 * | `full` | 0 | 0 |
 * | `full-middle` | 0 | fade |
 * | `middle` | 0 | 1 |
 * | `middle-impostor` | fade | 1 |
 * | `impostor` | 1 | 1 |
 *
 * So a fade of 0 is the level nearer the rider whole and 1 the further one,
 * as {@link bandFade} says.
 */
export function lowBound(level: TreeLevel, fade: number): number {
  if (level === 'middle-impostor') return fade;
  return level === 'impostor' ? 1 : 0;
}

/** @see lowBound */
export function highBound(level: TreeLevel, fade: number): number {
  if (level === 'full') return 0;
  return level === 'full-middle' ? fade : 1;
}

/**
 * Writes the part `[from, to)` of the screen hash a level of a tree keeps —
 * the `[low, high)` the shader discards outside of — into instance `index` of
 * an instance attribute three numbers wide (`InstancedMesh.instanceColor`'s).
 *
 * - An edge at 0 is written −1 and an edge at 1 is written 2, so a hash of
 *   exactly 0, or one a rounding short of 1, is never lost between two levels.
 * - The whole of `[0, 1)` is written `[0, 0)`, which the shader reads as "no
 *   dither" — so a mesh drawn with no keep at all (three's default attribute
 *   value is nought) keeps every fragment rather than none.
 *
 * Into the attribute's own array rather than a tuple, so a frame allocates
 * nothing.
 */
export function writeInterval(into: Float32Array, index: number, from: number, to: number): void {
  const at = index * 3;
  const whole = from <= 0 && to >= 1;
  into[at] = whole ? 0 : from <= 0 ? -1 : from;
  into[at + 1] = whole ? 0 : to >= 1 ? 2 : to;
  into[at + 2] = 0;
}

/**
 * How many frames a tree waits for a slot before its wait is routed through
 * its impostor — {@link TreeHandOver}'s guarantee of progress. Twice a whole
 * product hand-over, so a slot that is being released in the ordinary way is
 * always released first.
 */
export const HAND_OVER_PATIENCE_FRAMES = 20;

/**
 * Paces every tree's hand-over between levels, so that no tree changes shape
 * in one frame when the RANKED SET changes as well as when two trees swap —
 * #617's review.
 *
 * ## What it holds
 *
 * Each ranked tree is a split `(low, high)` of `[0, 1)` between its levels
 * ({@link lowBound}). The rank says where the split should be; this remembers
 * where it WAS, by the tree's position, and moves each edge at most
 * `1 / handOverFrames` a frame towards where it should be. A swap moves the
 * target continuously and is followed as before; a tree leaving the set, a
 * tree entering it, a fade falling back to 0 and a budget moving all jump the
 * target, and are now walked over `handOverFrames` frames instead of drawn in
 * one.
 *
 * ## Inside the same slots
 *
 * A level is TAKEN by a tree only if a slot is free: every tree first keeps
 * the levels it already draws, and a level it does not yet draw is granted,
 * nearest tree first, only from what is left. So a frame never submits more
 * full or middle trees than {@link treeSlots} — the triangle budget is not
 * spent on the pacing. A tree that is refused a level waits where it is; one
 * refused for {@link HAND_OVER_PATIENCE_FRAMES} frames sends the share it
 * cannot place to its impostor, which has no limit, so a cycle of trees each
 * waiting on another's slot always ends.
 *
 * A tree seen for the first time starts as its impostor — what an unranked
 * tree is drawn as — and walks in. The one exception is a frame that follows a
 * frame with no tracked tree at all (a view's first), whose trees start where
 * they belong: there is nothing on screen yet to change shape.
 *
 * ## ⚠️ What it still cannot hold, and why
 *
 * - **A tree that leaves the scatter belt's own frame** — beyond the rung's
 *   budget, or past the corridor's ends — is not drawn at all from that frame,
 *   whatever it was. That is the scatter's cut, not the levels', and the
 *   stylised world cuts the same item at the same frame.
 * - **A tree dropped from this memory** when more than twice the ranked trees
 *   are walking out at once — the table is sized once — is drawn as its
 *   impostor at once. Only a tree that has already left the ranks is dropped.
 * - **The pace is per FRAME, not per second**: a hand-over takes twice as long
 *   at 30 frames a second as at 60.
 * - **A tree that leaves the camera's view is let go at once** — its slots are
 *   free that frame — because nothing of it is on screen to pop.
 */
export class TreeHandOver {
  readonly #full: number;
  readonly #middle: number;
  readonly #step: number;
  /** This frame's table and last frame's, swapped by {@link begin}. */
  #now: HandOverTable;
  #then: HandOverTable;

  /**
   * @param slots how many trees may draw each mesh level ({@link treeSlots})
   * @param tracked the most trees remembered at once: every ranked one, and
   *   as many again walking out of the ranks
   */
  constructor(slots: Pick<TreeSlots, 'full' | 'middle'>, tracked: number, handOverFrames: number) {
    this.#full = slots.full;
    this.#middle = slots.middle;
    this.#step = 1 / Math.max(1, handOverFrames);
    this.#now = handOverTable(tracked);
    this.#then = handOverTable(tracked);
  }

  /** Forgets every tree — for a belt hidden and shown again. */
  reset(): void {
    this.#now.count = 0;
    this.#then.count = 0;
  }

  /** Starts a frame: this frame's trees are named with {@link aim} and {@link carry}. */
  begin(): void {
    const then = this.#then;
    this.#then = this.#now;
    this.#now = then;
    this.#now.count = 0;
    this.#then.matched.fill(0, 0, this.#then.count);
  }

  /**
   * Names a ranked tree this frame, nearest first, and where its split should
   * be. Returns its entry, or −1 if the table is full.
   */
  aim(x: number, z: number, low: number, high: number): number {
    return this.#enter(x, z, low, high, this.#find(this.#then, x, z));
  }

  /**
   * Names a tree that is in view and NOT ranked this frame, if it was
   * remembered mid-way to another level: it keeps walking out to its impostor.
   * Returns its entry, or −1 if it needs none.
   */
  carry(x: number, z: number): number {
    const was = this.#find(this.#then, x, z);
    if (was < 0) return -1;
    if ((this.#then.low[was] ?? 1) >= 1) return -1;
    return this.#enter(x, z, 1, 1, was);
  }

  /** The entry this frame for the tree at `(x, z)`, or −1. */
  find(x: number, z: number): number {
    return this.#find(this.#now, x, z);
  }

  /** Where entry `entry`'s split is drawn this frame, once {@link settle}d. @see lowBound */
  low(entry: number): number {
    return this.#now.low[entry] ?? 1;
  }

  /** @see low */
  high(entry: number): number {
    return this.#now.high[entry] ?? 1;
  }

  /** Moves every named tree towards where it should be, inside the slots. */
  settle(): void {
    const now = this.#now;
    const fresh = this.#then.count === 0;
    let full = 0;
    let middle = 0;
    // Every tree keeps what it already draws.
    for (let entry = 0; entry < now.count; entry += 1) {
      if (now.fresh[entry] === 1) continue;
      const low = now.low[entry] ?? 1;
      const high = now.high[entry] ?? 1;
      if (high < 1) full += 1;
      if (high > low) middle += 1;
    }
    // And takes a level it does not draw only from what is left, nearest first.
    for (let entry = 0; entry < now.count; entry += 1) {
      const wantLow = now.wantLow[entry] ?? 1;
      const wantHigh = now.wantHigh[entry] ?? 1;
      const needsFull = wantHigh < 1;
      const needsMiddle = wantHigh > wantLow;
      if (now.fresh[entry] === 1) {
        const fits =
          fresh && (!needsFull || full < this.#full) && (!needsMiddle || middle < this.#middle);
        if (fits) {
          if (needsFull) full += 1;
          if (needsMiddle) middle += 1;
        }
        now.low[entry] = fits ? wantLow : 1;
        now.high[entry] = fits ? wantHigh : 1;
        now.waited[entry] = 0;
        continue;
      }
      const low = now.low[entry] ?? 1;
      const high = now.high[entry] ?? 1;
      let hasFull = high < 1;
      let hasMiddle = high > low;
      if (needsFull && !hasFull && full < this.#full) {
        full += 1;
        hasFull = true;
      }
      if (needsMiddle && !hasMiddle && middle < this.#middle) {
        middle += 1;
        hasMiddle = true;
      }
      const refusedFull = needsFull && !hasFull;
      const refusedMiddle = needsMiddle && !hasMiddle;
      let towardLow = wantLow;
      let towardHigh = wantHigh;
      if (refusedFull || refusedMiddle) {
        const waited = (now.waited[entry] ?? 0) + 1;
        now.waited[entry] = waited;
        if (waited < HAND_OVER_PATIENCE_FRAMES) continue;
        // Out of patience: the share it cannot place goes to its impostor.
        if (refusedFull && refusedMiddle) {
          towardLow = 1;
          towardHigh = 1;
        } else if (refusedMiddle) {
          towardLow = wantHigh;
        } else if (high > low) {
          towardHigh = 1;
        } else {
          towardLow = 1;
          towardHigh = 1;
        }
      } else {
        now.waited[entry] = 0;
      }
      // Each edge moves at most a step, and edges in order stay in order.
      now.low[entry] = approach(low, towardLow, this.#step);
      now.high[entry] = approach(high, towardHigh, this.#step);
    }
  }

  #enter(x: number, z: number, low: number, high: number, was: number): number {
    const now = this.#now;
    if (now.count >= now.x.length) return -1;
    const entry = now.count;
    now.count += 1;
    now.x[entry] = x;
    now.z[entry] = z;
    now.wantLow[entry] = low;
    now.wantHigh[entry] = high;
    if (was >= 0) {
      this.#then.matched[was] = 1;
      now.low[entry] = this.#then.low[was] ?? 1;
      now.high[entry] = this.#then.high[was] ?? 1;
      now.waited[entry] = this.#then.waited[was] ?? 0;
      now.fresh[entry] = 0;
    } else {
      now.fresh[entry] = 1;
    }
    return entry;
  }

  #find(table: HandOverTable, x: number, z: number): number {
    const matching = table === this.#then;
    for (let entry = 0; entry < table.count; entry += 1) {
      if (matching && table.matched[entry] === 1) continue;
      if (table.x[entry] === x && table.z[entry] === z) return entry;
    }
    return -1;
  }
}

/** One frame's remembered trees. @see TreeHandOver */
interface HandOverTable {
  readonly x: Float64Array;
  readonly z: Float64Array;
  /** Where the split is drawn. */
  readonly low: Float64Array;
  readonly high: Float64Array;
  /** Where the rank says it should be. */
  readonly wantLow: Float64Array;
  readonly wantHigh: Float64Array;
  /** How many frames it has been refused a slot. */
  readonly waited: Int32Array;
  /** 1 for a tree with no earlier frame. */
  readonly fresh: Uint8Array;
  /** 1 once a later frame has claimed this entry. */
  readonly matched: Uint8Array;
  count: number;
}

function handOverTable(capacity: number): HandOverTable {
  return {
    x: new Float64Array(capacity),
    z: new Float64Array(capacity),
    low: new Float64Array(capacity),
    high: new Float64Array(capacity),
    wantLow: new Float64Array(capacity),
    wantHigh: new Float64Array(capacity),
    waited: new Int32Array(capacity),
    fresh: new Uint8Array(capacity),
    matched: new Uint8Array(capacity),
    count: 0,
  };
}

/** `from` moved at most `step` towards `to`. */
function approach(from: number, to: number, step: number): number {
  if (to > from) return Math.min(to, from + step);
  return Math.max(to, from - step);
}
