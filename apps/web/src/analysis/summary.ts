// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The load summary stored on a ride, and the load derived back out of it (#77).
 *
 * ## Why a ride carries half a load rather than a whole one
 *
 * #77's seventh criterion: drawing the history of a 1 000-activity library must
 * issue a **bounded** number of store reads and must **not** load stream data
 * for any activity. #76 computes a ride's load from its decoded samples, so
 * charting a thousand rides that way is a thousand channel decodes — exactly
 * the read the criterion forbids.
 *
 * The resolution is to split the calculation where it naturally splits:
 *
 * | Part | Cost | Where it lives |
 * |---|---|---|
 * | the effort-weighted power (or heart rate), and the covered time | every sample | **stored** on the ride |
 * | the athlete's threshold | one division | **derived** at read time |
 *
 * ⚠️ **The load itself is never stored**, and that is the point rather than an
 * economy. A rider can change their threshold (#76), and a stored load would be
 * silently wrong across their whole history the moment they did — with nothing
 * to say so, because a plausible number is exactly what a stale one looks like.
 * Storing the half that does not move keeps the chart and the ride screen
 * agreeing by construction.
 *
 * ## A power channel that read nought is not a basis — #1070
 *
 * A ride whose power readings were all 0 weighs to an effort-weighted power of
 * 0 W, and power winning would score it as load 0: a rest day on the fitness
 * line, *Load 0* on Home, and a heart-rate strap worn on the same ride thrown
 * away. #1054 decided that an average power which shows as 0 W says nothing
 * was measured (`format.ts` §`shownAveragePower`); this is the same decision
 * for the load, by the same rule — a weighted power that rounds to 0 W
 * ({@link isPowerBasis}). Such a ride is summarised from heart rate when it
 * has a usable trace, and carries no summary when it does not, so the chart
 * counts it as a ride with no load rather than scoring it as zero.
 *
 * ⚠️ **Rides already stored with `effortWeightedPower: 0`** are read by the
 * same rule rather than migrated: {@link loadFromSummary} and
 * {@link loadSummaryFieldsOf} do not treat that 0 as a basis, so the ride
 * reads as uncomputed, {@link needsLoadSummary} is true for it, and the
 * Analysis backfill (`history.ts` §`backfillLoadSummaries`) works it out
 * again — from heart rate where the ride has a strap. The store merges a
 * summary into the row, so such a ride keeps its stale 0 beside the new
 * heart-rate figure; the read rule is what makes that harmless, and it is why
 * the 0 is ignored on every read rather than only on the write.
 *
 * ## This file owns one invariant
 *
 * **At most one basis is set.** `records.ts` states it and deliberately does not
 * enforce it — a store that policed it would be a second place that knows the
 * rule. {@link loadSummaryOf} is the only producer, so the rule is enforced
 * where the choice is made.
 */

import {
  coveredTime,
  effortWeightedHeartRate as weighDomainHeartRate,
  effortWeightedPower as weighDomainPower,
  LOAD_AT_THRESHOLD_FOR_ONE_HOUR,
  type BeatsPerMinute,
  type RideLoad,
  type Seconds,
  type Watts,
} from '@onyourleft/domain';
import type { ActivitySummary } from '@onyourleft/store';

import type { AthleteThresholds } from './thresholds';

/** The threshold-independent half, as stored on a ride. */
export interface LoadSummary {
  readonly effortWeightedPower?: Watts;
  readonly effortWeightedHeartRate?: BeatsPerMinute;
  readonly loadCoveredTime: Seconds;
}

/**
 * The summary for a ride, from its samples.
 *
 * **Power wins wherever it exists** — the same ordering, and the same reason,
 * as `load.ts`'s `loadFrom`: heart rate lags an effort and saturates, so the
 * power-derived number is the better measurement of the same idea. Setting only
 * the winning basis is what makes the "at most one" invariant true at its
 * source rather than checked afterwards.
 *
 * `undefined` when neither channel can support a number — a ride shorter than
 * the smoothing window, or with no usable trace at all. The ride then carries
 * no summary and the chart says how many such rides there are, rather than
 * scoring them as zero.
 *
 * ⚠️ **It takes no threshold, and that is the whole idea.** What is stored does
 * not depend on one; asking for a threshold here would mean the importer had to
 * read the athlete row to compute a number that ignores it.
 */
export function loadSummaryOf(
  channels: {
    readonly power?: readonly (Watts | undefined)[] | undefined;
    readonly heartRate?: readonly (BeatsPerMinute | undefined)[] | undefined;
  },
  sampleInterval: Seconds,
): LoadSummary | undefined {
  if (channels.power !== undefined) {
    const weighted = weighDomainPower(channels.power, sampleInterval);
    if (weighted !== undefined && isPowerBasis(weighted.power)) {
      return {
        effortWeightedPower: weighted.power,
        loadCoveredTime: coveredTime(channels.power, sampleInterval),
      };
    }
  }
  if (channels.heartRate !== undefined) {
    const weighted = weighDomainHeartRate(channels.heartRate, sampleInterval);
    if (weighted !== undefined) {
      return {
        effortWeightedHeartRate: weighted.rate,
        loadCoveredTime: coveredTime(channels.heartRate, sampleInterval),
      };
    }
  }
  return undefined;
}

/**
 * The load a stored summary implies, against the athlete's **current**
 * threshold.
 *
 * This is the read-time half. It is arithmetic on two numbers, so a thousand
 * rides cost nothing beyond the one list read that fetched them.
 *
 * `undefined` for a ride with no summary — one imported before #77, or one
 * whose trace was too short. The caller counts those and says so; scoring them
 * as zero would make a rest day and an uncomputed ride the same thing, and the
 * whole chart turns on that distinction.
 */
export function loadFromSummary(
  summary: ActivitySummary,
  thresholds: AthleteThresholds,
): RideLoad | undefined {
  const covered = summary.loadCoveredTime;
  if (covered === undefined) {
    return undefined;
  }
  if (isPowerBasis(summary.effortWeightedPower)) {
    return scaled(summary.effortWeightedPower, thresholds.thresholdPower, covered, 'power');
  }
  if (summary.effortWeightedHeartRate !== undefined) {
    return scaled(
      summary.effortWeightedHeartRate,
      thresholds.thresholdHeartRate,
      covered,
      'heartRate',
    );
  }
  return undefined;
}

function scaled(
  weighted: number,
  threshold: number,
  covered: Seconds,
  basis: RideLoad['basis'],
): RideLoad | undefined {
  if (!(threshold > 0)) {
    return undefined;
  }
  const fraction = weighted / threshold;
  return {
    load: (covered / 3600) * fraction ** 2 * LOAD_AT_THRESHOLD_FOR_ONE_HOUR,
    basis,
    coveredSeconds: covered,
  };
}

/**
 * Whether an effort-weighted power is one a load may rest on: present, and not
 * one that rounds to 0 W (#1070, the rule `format.ts` §`shownAveragePower`
 * applies to an average). @see the file header, "A power channel that read
 * nought is not a basis".
 */
export function isPowerBasis(power: Watts | undefined): power is Watts {
  return power !== undefined && Math.round(power) > 0;
}

/** Whether a ride is missing the summary the chart needs. @see loadSummaryOf */
export function needsLoadSummary(summary: ActivitySummary): boolean {
  return loadSummaryFieldsOf(summary) === undefined;
}

/** The stored fields, or `undefined` if the ride carries none. */
export function loadSummaryFieldsOf(summary: ActivitySummary): LoadSummary | undefined {
  if (summary.loadCoveredTime === undefined) {
    return undefined;
  }
  if (isPowerBasis(summary.effortWeightedPower)) {
    return {
      effortWeightedPower: summary.effortWeightedPower,
      loadCoveredTime: summary.loadCoveredTime,
    };
  }
  if (summary.effortWeightedHeartRate !== undefined) {
    return {
      effortWeightedHeartRate: summary.effortWeightedHeartRate,
      loadCoveredTime: summary.loadCoveredTime,
    };
  }
  return undefined;
}
