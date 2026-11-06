// SPDX-License-Identifier: Apache-2.0

/**
 * **Leaderboard integrity: the one automatic rule** (#69) — an effort whose
 * implied speed is physically impossible for its sport is excluded.
 *
 * Here rather than in either app for `segment.ts`'s reason: the device and the
 * instance must reach the same verdict on the same effort. The device applies
 * it as it matches (`apps/web/src/segments/backfill.ts`), so an impossible time
 * is never the rider's own personal best; the instance applies it again when
 * the effort is shared, because a device is not to be trusted with a board
 * (`apps/instance/src/segments/segments.ts`). `docs/leaderboard-integrity.md`
 * states the same rule and thresholds in words, and a test holds the two
 * together.
 *
 * ## The rule, and the two thresholds
 *
 * **Implied speed** is the segment's own length — measured from its path, never
 * claimed — over the effort's elapsed time. Above the sport's ceiling the
 * effort is excluded:
 *
 * | Sport | Ceiling | Why there |
 * |---|---|---|
 * | ride | **27.8 m/s (100 km/h)** averaged over the whole segment | Professional descents peak near 100 km/h but do not average it over even 400 m, the shortest segment there is (`MINIMUM_SEGMENT_LENGTH_METRES`). A car on a main road, a train, and a GPS jump all exceed it |
 * | run | **10.5 m/s (37.8 km/h)** | Faster than the men's 100 m world record's average (10.44 m/s), sustained over at least 400 m. No human runs that; a bicycle, a car or a jump does |
 *
 * ## The ceiling this rule has, stated rather than implied
 *
 * ⚠️ **It catches only what is IMPOSSIBLE, never what is merely unlikely.** A
 * file edited to halve a 40 km/h effort reads 80 km/h, which is a fast descent
 * rather than an impossibility, and passes. A car in town at 50 km/h passes. A
 * ride recorded as a run at 30 km/h passes as a fast run would not — it is
 * caught, because the run's ceiling is lower. The labelled fixture set in
 * `integrity.test.ts` measures how much that leaves: **8 of the 13 impossible
 * efforts in it are caught (61.5%), and 0 of its 12 genuine ones**. The
 * incumbent, with a decade of engineering, reports removing about a third of
 * impossible cycling efforts automatically; this rule claims no more than its
 * fixtures show, and the community flag (`apps/instance/src/segments/`) is
 * what is left for the rest.
 */

import type { Metres, Seconds } from '../quantities';
import type { SegmentSport } from './segment';

/** Each sport's ceiling on implied speed, in metres per second. */
export const IMPLAUSIBLE_SPEED_METRES_PER_SECOND: Readonly<Record<SegmentSport, number>> = {
  ride: 27.8,
  run: 10.5,
};

/**
 * What the rule catches of the labelled fixture set in `integrity.test.ts`,
 * which recomputes these four numbers and fails when they move: the measured
 * detection rate and false-positive count #69's third criterion asks for.
 * `docs/leaderboard-integrity.md` quotes them, and a test holds it to them.
 */
export const MEASURED_DETECTION = {
  /** Impossible efforts in the set, and how many the rule excludes. */
  impossible: 13,
  caught: 8,
  /** Genuine efforts in the set, and how many the rule wrongly excludes. */
  genuine: 12,
  falselyExcluded: 0,
} as const;

/** Why an effort was excluded automatically: the rule, and the two numbers it compared. */
export interface ImplausibleEffort {
  readonly rule: 'implied-speed';
  /** The segment's length over the effort's elapsed time. */
  readonly impliedSpeedMetresPerSecond: number;
  /** The sport's ceiling it was over. */
  readonly ceilingMetresPerSecond: number;
}

/** The segment's length over the effort's time, in metres per second. */
export function impliedSpeed(distance: Metres, elapsed: Seconds): number {
  return elapsed > 0 ? distance / elapsed : Number.POSITIVE_INFINITY;
}

/**
 * Why an effort is physically impossible for its sport, or `undefined` when it
 * is not. A non-positive or non-finite time is impossible by definition.
 */
export function implausibleEffort(
  sport: SegmentSport,
  distance: Metres,
  elapsed: Seconds,
): ImplausibleEffort | undefined {
  const ceiling = IMPLAUSIBLE_SPEED_METRES_PER_SECOND[sport];
  const speed = Number.isFinite(elapsed)
    ? impliedSpeed(distance, elapsed)
    : Number.POSITIVE_INFINITY;
  return speed > ceiling
    ? { rule: 'implied-speed', impliedSpeedMetresPerSecond: speed, ceilingMetresPerSecond: ceiling }
    : undefined;
}

/**
 * A rider's reasons for flagging another rider's effort (#69): a closed list,
 * so a moderator reads a word rather than somebody's free text about somebody.
 */
export const EFFORT_FLAG_REASONS = [
  'vehicle',
  'gps-error',
  'wrong-sport',
  'impossible-time',
  'other',
] as const;
export type EffortFlagReason = (typeof EFFORT_FLAG_REASONS)[number];

/** A rider's reasons for flagging a segment as hazardous (#69). */
export const HAZARD_REASONS = ['traffic', 'junction', 'unsuitable-path', 'other'] as const;
export type HazardReason = (typeof HAZARD_REASONS)[number];
