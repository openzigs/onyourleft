// SPDX-License-Identifier: Apache-2.0

/**
 * The draft model — [#786](https://github.com/openzigs/onyourleft/issues/786),
 * decided by [ADR 0038](../../../docs/adr/0038-drafting-in-the-first-multiplayer-release.md).
 *
 * A draft is a **multiplier `k` on a rider's `C_D·A`** and nothing else (D-1):
 * the caller computes `k` here and rides `withDragArea(k × area)` through the
 * same `advance` as ever. The integrator does not call this file, so with no
 * rider near, `k = 1` and every existing vector — `martin-1998.test.ts`
 * included — is unchanged.
 *
 * ## Inputs: distance along the route, and nothing else
 *
 * A rider is placed by distance along the route (ADR 0028 D-7.3), so the only
 * geometry this model takes is a **longitudinal gap** in metres. There is no
 * lateral offset and no riding position (ADR 0038 D-3.4, D-3.5): a lateral
 * argument a room passed as `0` and a client passed as a drawn offset would
 * make the two disagree about `k`.
 *
 * - A rider less than {@link LEVEL_METRES} from another, either way, is
 *   **level** with them: neither shelters the other (D-2).
 * - Beyond {@link DRAFT_REACH_METRES}, nobody shelters anybody.
 *
 * ## ⚠️ Only `+ − × ÷`
 *
 * `agreement.test.ts`'s argument that a room on x86 and a phone on ARM compute
 * the same bits rests on IEEE 754 specifying exactly the four operations and
 * `Math.sqrt`. So every curve is a piecewise-linear table interpolated with a
 * subtraction, a division and a multiplication, and this file names no `Math`
 * member at all — `draft.test.ts` reads this source and fails on one.
 *
 * ## Where the numbers come from
 *
 * Blocken, Toparlar, van Druenen & Andrianne (2018), *Aerodynamic drag in
 * cycling team time trials*, J. Wind Eng. Ind. Aerodyn. 182, 128–145, Figs.
 * 9–13, read by ADR 0038's author on 2026-09-29. Each row and each unsourced
 * choice is in `README.md` §2 "The draft model". Blocken et al. (2013), the
 * two-rider paper, was read in full for #786 on 2026-09-29 and **disagrees**
 * with this table for every position — `README.md` records by how much; the
 * table stands because ADR 0038 D-3.5 decides version 1 uses the 2018 figures.
 */

import { PhysicsError } from './physics-error';

/** Closer than this, either way, and two riders are level: neither shelters the other (ADR 0038 D-2). */
export const LEVEL_METRES = 0.05;

/**
 * No rider this far ahead or behind, or further, changes `k` (ADR 0038 D-3.3).
 * ⚠️ **Unsourced — the author's choice**: the paper measured nothing past 5 m.
 */
export const DRAFT_REACH_METRES = 30;

/** The deepest chain the table distinguishes: from six riders on, the paper found them alike. */
export const MAXIMUM_DRAFT_DEPTH = 5;

/** The gaps the published figures were taken at, then the unsourced reach. */
const GAPS: readonly number[] = [0.05, 0.15, 0.5, 1, 5, DRAFT_REACH_METRES];

/**
 * ADR 0038 D-3.1: a trailing rider's drag as a share of an isolated rider's,
 * by depth (row) and gap (column, {@link GAPS}). The last column is the
 * unsourced 1.000 at 30 m.
 */
const TRAILING: readonly (readonly number[])[] = [
  [0.641, 0.644, 0.652, 0.665, 0.709, 1],
  [0.517, 0.522, 0.536, 0.556, 0.631, 1],
  [0.459, 0.466, 0.486, 0.511, 0.611, 1],
  [0.436, 0.443, 0.466, 0.493, 0.605, 1],
  [0.425, 0.433, 0.457, 0.485, 0.602, 1],
];

/** ADR 0038 D-3.2: the leading rider's drag share, by gap to the rider behind. */
const LEADING: readonly number[] = [0.976, 0.98, 0.987, 0.992, 0.999, 1];

/** The published table, for the test that reproduces its sources point by point. */
export const DRAFT_TABLE = {
  gapsMetres: GAPS,
  trailing: TRAILING,
  leading: LEADING,
} as const;

function checkedGap(gapMetres: number, what: string): number {
  if (!Number.isFinite(gapMetres) || gapMetres < 0) {
    throw new PhysicsError(`${what} must be a finite distance of at least 0 m`);
  }
  return gapMetres;
}

/** Piecewise-linear over {@link GAPS}; 1 at and beyond the reach, and never called below the level gap. */
function interpolate(row: readonly number[], gapMetres: number): number {
  for (let index = 1; index < GAPS.length; index += 1) {
    const upper = GAPS[index] as number;
    if (gapMetres <= upper) {
      const lower = GAPS[index - 1] as number;
      const from = row[index - 1] as number;
      const to = row[index] as number;
      // At a tabulated gap, the tabulated value exactly — `from + (to − from)`
      // need not round back to `to`.
      if (gapMetres === upper) {
        return to;
      }
      return from + ((to - from) * (gapMetres - lower)) / (upper - lower);
    }
  }
  return 1;
}

/**
 * `k_behind`: the follower's multiplier, sitting `gapMetres` behind the
 * nearest rider ahead with `depth` places in the chain ahead (ADR 0038 D-3.1).
 *
 * A gap under {@link LEVEL_METRES} is **level** and shelters nothing: `1`.
 * From {@link LEVEL_METRES} on it never decreases as the gap grows, and it is
 * exactly `1` from {@link DRAFT_REACH_METRES} on.
 *
 * @param depth places in the chain ahead, at least 1; capped at
 * {@link MAXIMUM_DRAFT_DEPTH}.
 */
export function draftFactor(gapMetres: number, depth: number): number {
  checkedGap(gapMetres, 'a gap to the rider ahead');
  if (!Number.isInteger(depth) || depth < 1) {
    throw new PhysicsError('a draft depth is a whole number of places, at least 1');
  }
  if (gapMetres < LEVEL_METRES) {
    return 1;
  }
  const row = TRAILING[(depth > MAXIMUM_DRAFT_DEPTH ? MAXIMUM_DRAFT_DEPTH : depth) - 1];
  return interpolate(row as readonly number[], gapMetres);
}

/**
 * `k_ahead_of`: the leading-rider effect of a rider `gapMetres` behind
 * (ADR 0038 D-3.2). Level under {@link LEVEL_METRES}, so `1`; exactly `1` from
 * {@link DRAFT_REACH_METRES}.
 */
export function leadFactor(gapMetres: number): number {
  checkedGap(gapMetres, 'a gap to the rider behind');
  if (gapMetres < LEVEL_METRES) {
    return 1;
  }
  return interpolate(LEADING, gapMetres);
}

/**
 * ADR 0038 D-3.6, the combination rule, over a whole field: each rider's `k`
 * from every rider's distance along the route, in metres. Returned in the
 * order given.
 *
 * 1. The **chain ahead** is built place by place: the nearest rider at least
 *    {@link LEVEL_METRES} ahead and within {@link DRAFT_REACH_METRES} is the
 *    first place; the next place is the nearest rider at least
 *    {@link LEVEL_METRES} ahead **of that place's rider** and within reach of
 *    it, and so on. Riders level with a place are that place, so two riders
 *    side by side ahead are not a double draft. Depth is capped at
 *    {@link MAXIMUM_DRAFT_DEPTH}.
 * 2. `k_behind` is {@link draftFactor} at **this rider's own gap** to the first
 *    place — ⚠️ unsourced, the author's choice (ADR 0038 D-3.6 step 2).
 * 3. Times {@link leadFactor} for the nearest rider at least
 *    {@link LEVEL_METRES} behind, within reach.
 *
 * The answer depends only on the multiset of distances, never on the order
 * they are given in: the field is sorted first.
 */
export function fieldDraftFactors(distancesMetres: readonly number[]): number[] {
  for (const distance of distancesMetres) {
    if (!Number.isFinite(distance)) {
      throw new PhysicsError('every distance along the route must be finite');
    }
  }
  const sorted = [...distancesMetres].sort((a, b) => a - b);
  return distancesMetres.map((here) => factorAt(sorted, here));
}

/** The first index in ascending `sorted` whose value is at least `at`. */
function firstAtLeast(sorted: readonly number[], at: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((sorted[middle] as number) < at) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function factorAt(sorted: readonly number[], here: number): number {
  let behind = 1;
  // The nearest rider at least LEVEL_METRES behind, walking down from here.
  for (let index = firstAtLeast(sorted, here) - 1; index >= 0; index -= 1) {
    const gap = here - (sorted[index] as number);
    if (gap >= LEVEL_METRES) {
      if (gap <= DRAFT_REACH_METRES) {
        behind = leadFactor(gap);
      }
      break;
    }
  }

  let place = nextPlace(sorted, here);
  if (place === undefined) {
    return behind;
  }
  const ownGap = place - here;
  let depth = 1;
  while (depth < MAXIMUM_DRAFT_DEPTH) {
    const next = nextPlace(sorted, place);
    if (next === undefined) {
      break;
    }
    depth += 1;
    place = next;
  }
  return draftFactor(ownGap, depth) * behind;
}

/** The nearest rider at least LEVEL_METRES ahead of `from` and within reach of it, or none. */
function nextPlace(sorted: readonly number[], from: number): number | undefined {
  for (let index = firstAtLeast(sorted, from); index < sorted.length; index += 1) {
    const other = sorted[index] as number;
    const gap = other - from;
    if (gap >= LEVEL_METRES) {
      return gap <= DRAFT_REACH_METRES ? other : undefined;
    }
  }
  return undefined;
}
