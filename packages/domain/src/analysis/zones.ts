// SPDX-License-Identifier: Apache-2.0

/**
 * Training zones, and how long a ride spent in each.
 *
 * #78 calls zones *"the simplest analysis feature and the one most likely to be
 * quietly wrong at the boundaries"*, which is the whole reason this file states
 * two rules in words before it computes anything.
 *
 * ## Rule 1 — the boundary is inclusive below, exclusive above
 *
 * A zone covers `[lower, upper)`. A sample exactly on a boundary lands in the
 * **upper** of the two zones it touches, and the top zone has no upper bound at
 * all.
 *
 * Either convention works; what does not work is leaving it implicit. With no
 * stated rule, a sample on a boundary either lands in both zones — and the
 * totals sum to more than the ride — or in neither, and they sum to less. #78:
 * *"an untested boundary rule is how time-in-zone totals fail to sum to ride
 * duration."* {@link zoneOf} is total over every finite value ≥ 0 precisely so
 * that neither can happen.
 *
 * ## Rule 2 — a gap is not zone one
 *
 * A sample the sensor never reported is excluded from every zone. It is the
 * same invariant `recording/channels.ts` states and `analysis/power-duration.ts`
 * applies: **a gap is `undefined`, never a sentinel and never zero.** Assigning
 * it to the bottom zone would turn a dead sensor into an hour of recovery
 * riding, which reads as data and is not.
 *
 * ## ⚠️ What time in zone sums to, and what it does not
 *
 * #78 asks that *"time in zone across all zones sums to the ride's moving
 * time"*. It does — **on a ride where the channel reported for every moving
 * second**, which is what its fixture builds and what {@link timeInZones}
 * guarantees by construction.
 *
 * On real data the two can differ, in **both** directions, and pretending
 * otherwise is how a number goes quietly wrong:
 *
 * - A sensor dropout means fewer covered seconds than moving seconds.
 * - An ERG trainer holds a power target while the rider is off the bike, so a
 *   *paused* second can carry a reading — `channels.ts` records that a recorder
 *   fed only power auto-pauses for exactly this reason.
 *
 * So {@link timeInZones} reports {@link TimeInZones.covered} beside the
 * per-zone totals, and a caller comparing it with the ride's moving time can
 * say "this ride is 94% covered" rather than showing a total that is short by
 * an unexplained six per cent. The sum of the per-zone entries **always**
 * equals `covered`; that is the invariant this file actually enforces, and the
 * one a test can assert without knowing anything about the ride.
 *
 * ## Naming
 *
 * The zone names below are ordinary descriptors of physiological intensity —
 * "endurance", "tempo", "threshold" — in general use across the training
 * literature. #76 flags that the common names for *its* metrics are reported to
 * be registered trademarks; those are metric names, none of which appears here,
 * and the register check for them remains #76's. The fractions are published
 * numbers, and a number is not copyrightable (CLAUDE.md §6).
 */

import {
  beatsPerMinute,
  seconds,
  watts,
  type BeatsPerMinute,
  type Seconds,
  type Watts,
} from '../quantities';

/** Which channel a zone set reads. */
export type ZoneBasis = 'power' | 'heartRate';

export interface Zone {
  /** 1-based, so zone 1 is the first zone rather than the second. */
  readonly index: number;
  /** A descriptor, not a number, so a chart can label rather than colour. */
  readonly name: string;
  /** Inclusive. Zone 1's lower bound is always 0. */
  readonly lower: number;
  /** Exclusive. `undefined` in the top zone, which is open above. */
  readonly upper: number | undefined;
}

/**
 * Lower bounds as fractions of threshold power, inclusive.
 *
 * Seven zones, the division the cycling training literature settles on. The
 * first is 0 because a zone set that does not start at zero cannot classify a
 * coasting rider, and a coasting rider is not a gap.
 */
export const POWER_ZONE_LOWER_FRACTIONS: readonly number[] = [
  0, 0.56, 0.76, 0.91, 1.06, 1.21, 1.51,
];

export const POWER_ZONE_NAMES: readonly string[] = [
  'Recovery',
  'Endurance',
  'Tempo',
  'Threshold',
  'VO₂',
  'Anaerobic',
  'Sprint',
];

/**
 * Lower bounds as fractions of threshold heart rate, inclusive.
 *
 * Five zones rather than seven, and that is not an oversight: heart rate does
 * not resolve the short, hard efforts the top power zones distinguish. It lags
 * an effort by tens of seconds and saturates, so a sprint and a VO₂ interval
 * look alike in it. Reporting seven heart-rate zones would be claiming a
 * resolution the signal does not have.
 */
export const HEART_RATE_ZONE_LOWER_FRACTIONS: readonly number[] = [0, 0.81, 0.9, 0.94, 1.0];

export const HEART_RATE_ZONE_NAMES: readonly string[] = [
  'Recovery',
  'Endurance',
  'Tempo',
  'Threshold',
  'Maximal',
];

function zonesFrom(
  threshold: number,
  fractions: readonly number[],
  names: readonly string[],
): readonly Zone[] {
  return fractions.map((fraction, index) => ({
    index: index + 1,
    // The names table is the same length as the fractions table, asserted by a
    // test, so this cannot be undefined in practice — but a `?? ` here would
    // hide a mismatch rather than surface it, so the test is the guard.
    name: names[index] ?? `Zone ${String(index + 1)}`,
    lower: fraction * threshold,
    upper: index + 1 < fractions.length ? (fractions[index + 1] ?? 0) * threshold : undefined,
  }));
}

/** Zone boundaries from one threshold. @see zoneOf */
export function powerZones(threshold: Watts): readonly Zone[] {
  return zonesFrom(threshold, POWER_ZONE_LOWER_FRACTIONS, POWER_ZONE_NAMES);
}

/** @see powerZones */
export function heartRateZones(threshold: BeatsPerMinute): readonly Zone[] {
  return zonesFrom(threshold, HEART_RATE_ZONE_LOWER_FRACTIONS, HEART_RATE_ZONE_NAMES);
}

/**
 * The zone a reading falls in — inclusive below, exclusive above.
 *
 * Total over every finite value ≥ 0, which is what makes the per-zone totals
 * sum to the covered time exactly rather than approximately.
 */
export function zoneOf(zones: readonly Zone[], value: number): Zone | undefined {
  if (!Number.isFinite(value) || value < 0) {
    return undefined;
  }
  for (const zone of zones) {
    if (value >= zone.lower && (zone.upper === undefined || value < zone.upper)) {
      return zone;
    }
  }
  return undefined;
}

export interface TimeInZones {
  /** Seconds in each zone, indexed as the zone list was ordered. */
  readonly perZone: readonly Seconds[];
  /**
   * The total the per-zone entries sum to: how long the channel actually
   * reported.
   *
   * Compare it with the ride's moving time to say how much of the ride the
   * chart is describing. See the file comment on why the two are not the same
   * number.
   */
  readonly covered: Seconds;
}

/**
 * How long a ride spent in each zone.
 *
 * `samples` is a 1 Hz-or-other fixed-interval series with `undefined` at every
 * instant the sensor said nothing; `sampleInterval` is what one sample is worth
 * in seconds, taken from the stream rather than assumed, so a stream stored at
 * anything other than 1 Hz does not silently report the wrong durations.
 */
export function timeInZones(
  zones: readonly Zone[],
  samples: readonly (number | undefined)[],
  sampleInterval: Seconds,
): TimeInZones {
  const perZone = new Array<number>(zones.length).fill(0);
  let covered = 0;

  for (const sample of samples) {
    if (sample === undefined) {
      continue;
    }
    const zone = zoneOf(zones, sample);
    if (zone === undefined) {
      // A reading no zone claims — negative, or not finite. Excluded rather
      // than forced into zone one, on the same reasoning as a gap: it is not a
      // measurement of an intensity.
      continue;
    }
    const slot = zone.index - 1;
    // `?? 0` is unreachable — `perZone` was filled to `zones.length` and
    // `zone.index` is 1-based within it — but the index signature does not know
    // that, and a non-null assertion would hide a real bug if the invariant
    // ever broke. The test that walks every zone is what proves it holds.
    perZone[slot] = (perZone[slot] ?? 0) + sampleInterval;
    covered += sampleInterval;
  }

  return {
    perZone: perZone.map((total) => seconds(total)),
    covered: seconds(covered),
  };
}

/** The threshold defaults a new athlete starts from. @see AthleteRecord */
export const DEFAULT_THRESHOLD_POWER: Watts = watts(200);
export const DEFAULT_THRESHOLD_HEART_RATE: BeatsPerMinute = beatsPerMinute(160);
