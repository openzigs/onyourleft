// SPDX-License-Identifier: Apache-2.0

/**
 * A segment effort: one timed traversal, and the two decisions #66 says must
 * not be got wrong.
 *
 * {@link matchRide} finds traversals. This turns one into the thing a
 * leaderboard and a personal-best query read, which needs two facts the matcher
 * has no way to know: whether the effort may be shown to anyone else, and what
 * the athlete looked like at the time.
 *
 * ## 1. Visibility is a THREE-state, and a boolean here is the bug
 *
 * #66 says it in those terms and it is worth repeating in the code, because the
 * two-state version is the one that gets written by accident:
 *
 * > *an effort whose start is inside a privacy zone is a real effort the
 * > athlete should see, and a leaderboard row that would publish their home
 * > address.*
 *
 * Collapsing that to `visible: boolean` forces a choice between losing the
 * rider's own history and publishing where they live. {@link EffortVisibility}
 * refuses the choice. See {@link effortVisibility} for how the middle state is
 * decided and {@link countsTowardPersonalBest} / {@link countsOnSharedBoard}
 * for what each state means at the two read paths.
 *
 * ## 2. Attributes freeze at effort time
 *
 * > *Any attribute a ranking is later bucketed by — the athlete's recorded
 * > weight, age band, equipment class — is stamped onto the effort when it is
 * > created and never retro-migrated.*
 *
 * A rider who loses six kilograms this year did not thereby ride last year's
 * climb in a different weight class, and a board that says they did is lying
 * about the past. One athlete legitimately appears in different buckets across
 * years, and {@link FrozenAttributes} is what makes that expressible.
 *
 * ⚠️ **The failure this prevents is silent.** Reading the athlete's *current*
 * weight at ranking time produces a board that looks right, ranks plausibly,
 * and quietly rewrites history every time somebody edits their profile. No test
 * of a single ranking catches it; `effort.test.ts` changes the profile after
 * the fact, which is the only shape that does.
 */

import { distanceBetween } from '../geodesy';

import type { GeographicPosition, Kilograms, Metres, Seconds, UnixSeconds } from '../quantities';
import type { MatchedEffort } from './match';

/**
 * Whether an effort may be shown, and to whom.
 *
 * ⚠️ **Never widen this to a boolean, and never collapse two of the three.**
 * Each state exists because the other two cannot express it:
 *
 * - `public` — matched, nothing hidden. Counts everywhere.
 * - `private-match` — matched, but an endpoint falls inside one of the
 *   athlete's privacy zones. **Counts for their own personal best; never
 *   appears on a shared board.** This is the state a boolean cannot hold.
 * - `excluded` — matched but implausible or flagged (#69). Counts nowhere,
 *   including for the athlete themselves, because an impossible time is not a
 *   personal best.
 */
export type EffortVisibility = 'public' | 'private-match' | 'excluded';

/**
 * What the athlete looked like when the effort happened, copied at creation.
 *
 * Every field is optional because every one of them is something an athlete may
 * simply not have recorded, and a leaderboard that requires a weight before it
 * will time you is a worse product than one with an unbucketed row.
 *
 * ⚠️ **This is a copy and must stay one.** Nothing may replace a stored value
 * here with a lookup against the athlete's current profile — see this file's
 * header. Adding a field is adding another thing that freezes, so add it here
 * rather than reading it live at ranking time.
 */
export interface FrozenAttributes {
  /** The athlete's recorded mass, if they had recorded one. */
  readonly riderMass?: Kilograms;
}

/** A timed traversal, as stored and as ranked. */
export interface SegmentEffort {
  readonly id: string;
  readonly segmentId: string;
  /** The activity it was found in. What makes re-matching idempotent. */
  readonly activityId: string;
  /** The owning athlete. Every read of an effort filters on it. */
  readonly athleteId: string;
  readonly startedAt: UnixSeconds;
  readonly elapsed: Seconds;
  /** How far the ride strayed from the segment. */
  readonly deviation: Metres;
  readonly visibility: EffortVisibility;
  readonly attributes: FrozenAttributes;
}

/** Everything {@link createEffort} needs that the match itself does not carry. */
export interface EffortContext {
  readonly activityId: string;
  readonly athleteId: string;
  /** Where the ride's samples were, so the endpoints can be tested for privacy. */
  readonly positions: readonly GeographicPosition[];
  /**
   * The athlete's privacy zones — centre and radius.
   *
   * ⚠️ Passed in rather than read: `packages/domain` cannot reach a store, and
   * that is the constraint that makes this function testable at all.
   */
  readonly privacyZones: readonly PrivacyCircle[];
  /** The athlete's attributes **as of now**, which is when the effort is made. */
  readonly attributes: FrozenAttributes;
  /** Set when #69's integrity work has already ruled the effort out. */
  readonly excluded?: boolean;
}

/** A privacy zone, reduced to the two numbers this file needs. */
export interface PrivacyCircle {
  readonly centre: GeographicPosition;
  readonly radius: Metres;
}

/**
 * A stable identifier for one traversal.
 *
 * ⚠️ **Derived, not random, and that is what makes re-matching idempotent.**
 * #66's sixth criterion is that running the matcher three times over an
 * already-matched activity leaves the effort count unchanged; with a random id
 * every run writes new rows and every restart inflates every board. The three
 * parts are exactly what identifies a traversal: which segment, found in which
 * activity, starting at which recorded instant. A rider who rode the segment
 * twice has two different `startedAt` values and therefore two ids.
 *
 * ⚠️ **`startedAt` and not `startIndex`.** An index is a position in whatever
 * the sample array happened to be; a re-import that dropped one sample would
 * shift every index and mint a duplicate of every effort. The instant is a
 * property of the ride.
 */
export function effortId(segmentId: string, activityId: string, startedAt: UnixSeconds): string {
  return `${segmentId}::${activityId}::${String(startedAt)}`;
}

/**
 * Whether either endpoint of a traversal falls inside one of the athlete's
 * privacy zones.
 *
 * Tested on the **ride's own samples** at the effort's two ends, which are the
 * coordinates a shared board would expose. ADR 0004's zones hide where an
 * activity starts and finishes; an effort that begins at the rider's front door
 * publishes the same fact through a different screen.
 *
 * ⚠️ Only the endpoints, deliberately. A segment that merely *passes* a zone
 * exposes nothing about the rider — the road is public and the effort says only
 * that they rode along it.
 */
export function touchesPrivacyZone(
  positions: readonly GeographicPosition[],
  startIndex: number,
  endIndex: number,
  zones: readonly PrivacyCircle[],
): boolean {
  const ends = [positions[startIndex], positions[endIndex]];
  for (const position of ends) {
    if (position === undefined) {
      continue;
    }
    for (const zone of zones) {
      if (distanceBetween(zone.centre, position) <= zone.radius) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Which of the three states an effort is in.
 *
 * Order matters: `excluded` wins over `private-match`, because an implausible
 * effort is not a personal best whether or not it started at home.
 */
export function effortVisibility(matched: MatchedEffort, context: EffortContext): EffortVisibility {
  if (context.excluded === true) {
    return 'excluded';
  }
  if (
    touchesPrivacyZone(
      context.positions,
      matched.startIndex,
      matched.endIndex,
      context.privacyZones,
    )
  ) {
    return 'private-match';
  }
  return 'public';
}

/** Turn one match into the effort a store persists. */
export function createEffort(matched: MatchedEffort, context: EffortContext): SegmentEffort {
  return {
    id: effortId(matched.segmentId, context.activityId, matched.startedAt),
    segmentId: matched.segmentId,
    activityId: context.activityId,
    athleteId: context.athleteId,
    startedAt: matched.startedAt,
    elapsed: matched.elapsed,
    deviation: matched.deviation,
    visibility: effortVisibility(matched, context),
    // Spread rather than referenced: the caller's object must not be able to
    // change what the effort recorded, which is the whole point of freezing.
    attributes: { ...context.attributes },
  };
}

/**
 * Whether an effort counts toward the athlete's **own** personal best.
 *
 * `private-match` counts. That is the entire reason the three-state exists, and
 * a reader who "simplifies" this to `visibility === 'public'` has silently
 * deleted the rider's history on every segment near their home.
 */
export function countsTowardPersonalBest(effort: SegmentEffort): boolean {
  return effort.visibility !== 'excluded';
}

/**
 * Whether an effort may appear on a board anyone else can see.
 *
 * `private-match` does **not**. Publishing it is publishing an address.
 */
export function countsOnSharedBoard(effort: SegmentEffort): boolean {
  return effort.visibility === 'public';
}

// --- Ranking (#67) -----------------------------------------------------------

/**
 * **Efforts are ranked by ELAPSED time**, and this constant is where that is
 * decided rather than assumed.
 *
 * #67's fourth criterion asks for a single stated basis and says plainly that
 * this is *"an open question, not a copyable fact"* — the incumbent documents
 * elapsed time for run and hike segments and does not state it for rides. So
 * this is ours to pick, and the argument is not a preference:
 *
 * **Moving time is not comparable across devices.** It is elapsed time minus
 * whatever the auto-pause model judged to be stopped, and that model depends on
 * which channels the ride carried. `apps/web/src/recording/channels.ts` records
 * the consequence: a recorder fed **only power** auto-pauses, because an ERG
 * trainer holds a target while the rider is off the bike. So the same effort,
 * ridden identically, produces a different moving time on a rider with a speed
 * sensor than on a rider without one — and a board ranked that way is ranking
 * sensor configurations rather than riders.
 *
 * **Elapsed time is a difference of two recorded timestamps** and needs no
 * further judgement. It is what {@link SegmentEffort.elapsed} already holds.
 *
 * ⚠️ **The UI must name it**, which is #67's criterion in full: *"Pick one,
 * name it in the UI, and never mix bases in one list."* {@link RANKING_BASIS_LABEL}
 * is the words, kept here beside the reasoning so the screen and the rule
 * cannot drift.
 */
export const RANKING_BASIS = 'elapsed' as const;

/** What the screen says, so the rider knows what they are being ranked by. */
export const RANKING_BASIS_LABEL = 'Ranked by elapsed time';

/**
 * Every effort on one segment, **fastest first**, with ties broken
 * deterministically.
 *
 * ## The tie-break, which #67 requires to be documented
 *
 * *"No published tie-break rule exists to copy."* Ours is, in order:
 *
 * 1. **Elapsed time**, ascending — the ranking basis above.
 * 2. **Earliest start**, ascending. It credits whoever did it first, and it is
 *    a property of the effort rather than of the sort.
 * 3. **The effort id**, lexicographically. Not expected to be reached — two
 *    efforts sharing an elapsed time *and* a start instant means one ride
 *    imported twice under two ids — but without it the order of those two
 *    depends on the input order, which is exactly the instability the criterion
 *    is about.
 *
 * ⚠️ **A comparator that stops at (1) is not stable enough**, even though
 * `Array.prototype.sort` has been required to be stable since ES2019. Stability
 * preserves *input* order, and the input here is whatever order the store
 * returned — which is an index scan whose order is not part of its contract.
 * "Two efforts with identical times must order the same way on every render" is
 * a property of the comparator or it is not a property at all.
 *
 * ⚠️ **Excluded efforts are dropped, `private-match` efforts are kept.** This
 * is the athlete's own history: #67's first criterion says a `private-match`
 * effort *"appears here — it is the athlete's own data"*. A shared board is a
 * different read (`countsOnSharedBoard`).
 */
export function rankEfforts(efforts: readonly SegmentEffort[]): SegmentEffort[] {
  return efforts
    .filter((effort) => countsTowardPersonalBest(effort))
    .slice()
    .sort(rankOrder);
}

/**
 * The comparator {@link rankEfforts} uses. Exported so a test can pin it directly.
 *
 * Named for the order it produces rather than `compareEfforts`, because
 * `comparison.ts` has an {@link overlayEfforts} that also "compares two
 * efforts" and means something else entirely — one is a sort key, the other is
 * where the time went.
 */
export function rankOrder(first: SegmentEffort, second: SegmentEffort): number {
  if (first.elapsed !== second.elapsed) {
    return first.elapsed - second.elapsed;
  }
  if (first.startedAt !== second.startedAt) {
    return first.startedAt - second.startedAt;
  }
  return first.id < second.id ? -1 : first.id > second.id ? 1 : 0;
}

/**
 * The athlete's best effort on a segment, or `undefined` when they have none.
 *
 * ⚠️ **A `private-match` effort can be the personal best**, and #67's sixth
 * criterion is the neighbouring case: a personal best *"must not be a hostage
 * to a visibility toggle"*. Nothing here reads an activity's visibility, and
 * that is deliberate — an effort's own three-state visibility is about privacy
 * *zones*, and making a ride private is not a statement about whether the rider
 * rode it.
 */
export function personalBest(efforts: readonly SegmentEffort[]): SegmentEffort | undefined {
  return rankEfforts(efforts)[0];
}
