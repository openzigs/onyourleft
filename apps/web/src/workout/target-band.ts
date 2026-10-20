// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The block being ridden, against its target — #1434: the target as a band,
 * the rider's power smoothed over {@link SMOOTHING_SECONDS} seconds and the
 * block's average so far marked against it, the time left in the block, and
 * in ERG a cue that the rider holds the cadence and the trainer the power.
 *
 * Pure numbers and words, apart from the component that draws them
 * (`TargetBand.tsx`), for `workout-graph.ts`'s reason: what it says is a
 * decision worth testing on its own. It decides no write.
 *
 * ## ⚠️ The target is the one the trainer ACKNOWLEDGED
 *
 * `workout-graph.ts` §`heldNow`, the one source for it: so an eased target
 * is the band the rider is asked to ride, and with control lost there is no
 * band at all, because nothing is known of what the machine holds.
 *
 * ## Where there is no band
 *
 * A paused workout (the clock is stopped and the trainer is eased), a free
 * ride (the trainer is at its lightest and the plan asks for nothing), a
 * heart-rate hold that is running (the target moves to keep heart rate in a
 * range, which the hold's own line shows), and a block whose target was
 * refused (`RideWorkoutSnapshot.refused`).
 *
 * ## In, under or over, in words as well as in shape — SC 1.4.1
 *
 * The band is a shaded box, the 3 s power a tall bar with a cap and the
 * block's average a ring, and {@link targetBandWords} says where the 3 s
 * power is against the band in words. Nothing depends on a colour.
 *
 * ## No metric trademark
 *
 * Watts, rpm and seconds, in those words (`docs/agents/scope-and-ip.md`).
 */

import { COLLAPSE_RPM, STALLING_CADENCE, STOPPED_CADENCE } from '@onyourleft/domain';

import { heldNow, leftInBlock, type WorkoutGraphInput } from './workout-graph';

/** How far back the rider's power is averaged for the marker: three seconds. */
export const SMOOTHING_SECONDS = 3;

/** The band's half-width, as a share of the target: ±5 %. */
export const BAND_SHARE = 0.05;

/** The least half-width, in watts, so a low target still has a band to ride in. */
export const BAND_MINIMUM_WATTS = 5;

/** How far the drawn scale reaches either side of the target: half of it, at least 50 W. */
const SCALE_SHARE = 0.5;
const SCALE_MINIMUM_WATTS = 50;

/**
 * Under this cadence, with a target held and no relief yet, the rider is
 * warned to spin up — #1434's early cue.
 *
 * ⚠️ Where the stall relief's trend rule starts to apply
 * (`@onyourleft/domain` §`assessErgCadence`: a 15 rpm loss that ends under
 * 50 + 15 rpm), so the warning comes before the relief can, and a rider
 * spinning above it is never told anything. Derived rather than written, so
 * a re-calibrated relief (#137) moves the cue with it.
 */
export const CADENCE_CUE_RPM = (STALLING_CADENCE as number) + COLLAPSE_RPM;

/** Where the 3 s power is against the band. */
export type BandStanding = 'in' | 'under' | 'over';

/** What `RideWorkoutSnapshot` carries that the band reads beyond the graph's input. */
export interface TargetBandInput extends WorkoutGraphInput {
  readonly blockAverageWatts?: number | undefined;
  readonly live?:
    | {
        readonly power: number | undefined;
        readonly heartRate: number | undefined;
        readonly cadence?: number | undefined;
      }
    | undefined;
  readonly refused?: boolean | undefined;
}

/** The band, its marks, and where each is drawn as a percentage of the scale. */
export interface TargetBand {
  /** The acknowledged target, in watts. */
  readonly target: number;
  readonly low: number;
  readonly high: number;
  /** The rider's power over the last {@link SMOOTHING_SECONDS} s, or `undefined` with no live reading. */
  readonly smoothed: number | undefined;
  /** The rider's mean power in this block so far, or `undefined` before there is one. */
  readonly average: number | undefined;
  /** Where {@link smoothed} is against the band; `undefined` with no reading. */
  readonly standing: BandStanding | undefined;
  /** How long is left of this block, as a clock. */
  readonly left: string | undefined;
  /** The rider's cadence, when it is low enough to warn about. */
  readonly lowCadence: number | undefined;
  /** Each mark's place, 0–100 along the scale. */
  readonly at: {
    readonly low: number;
    readonly high: number;
    readonly smoothed: number | undefined;
    readonly average: number | undefined;
  };
}

const finite = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value);

/**
 * The rider's power over the last {@link SMOOTHING_SECONDS} seconds of the
 * workout's clock, from the trace, in whole watts. `undefined` when the
 * reading is not live NOW, whatever the trace holds: three seconds of a meter
 * that has since dropped are not what the rider is doing.
 */
export function smoothedPower(input: TargetBandInput): number | undefined {
  if (input.live !== undefined && !finite(input.live.power)) {
    return undefined;
  }
  const readings = (input.trace ?? [])
    .filter(
      (sample) =>
        sample.at <= input.elapsedSeconds && sample.at > input.elapsedSeconds - SMOOTHING_SECONDS,
    )
    .map((sample) => sample.power)
    .filter(finite);
  if (readings.length === 0) {
    return undefined;
  }
  return Math.round(readings.reduce((sum, value) => sum + value, 0) / readings.length);
}

function standingOf(
  value: number | undefined,
  low: number,
  high: number,
): BandStanding | undefined {
  if (value === undefined) return undefined;
  if (value < low) return 'under';
  if (value > high) return 'over';
  return 'in';
}

/** The band for the block being ridden, or `undefined` where there is none (see the module note). */
export function targetBand(input: TargetBandInput): TargetBand | undefined {
  const target = heldNow(input);
  if (input.status !== 'running' || target === undefined || input.refused === true) {
    return undefined;
  }
  if (input.hold !== undefined && input.hold.reason !== 'ineligible') {
    return undefined;
  }
  const segment = input.timeline.segments.find(
    (each) => each.startsAt <= input.elapsedSeconds && input.elapsedSeconds < each.endsAt,
  );
  if (segment === undefined || segment.from === undefined) {
    return undefined;
  }
  const half = Math.max(BAND_MINIMUM_WATTS, Math.round(target * BAND_SHARE));
  const low = Math.max(0, target - half);
  const high = target + half;
  const reach = Math.max(SCALE_MINIMUM_WATTS, target * SCALE_SHARE);
  const bottom = Math.max(0, target - reach);
  const top = target + reach;
  const place = (watts: number): number =>
    Math.min(100, Math.max(0, ((watts - bottom) / (top - bottom)) * 100));
  const smoothed = smoothedPower(input);
  const average = finite(input.blockAverageWatts) ? input.blockAverageWatts : undefined;
  const cadence = input.live?.cadence;
  const lowCadence =
    finite(cadence) &&
    cadence < CADENCE_CUE_RPM &&
    cadence > (STOPPED_CADENCE as number) &&
    input.rescue === undefined
      ? Math.round(cadence)
      : undefined;
  return {
    target,
    low,
    high,
    smoothed,
    average,
    standing: standingOf(smoothed, low, high),
    left: leftInBlock(input),
    lowCadence,
    at: {
      low: place(low),
      high: place(high),
      smoothed: smoothed === undefined ? undefined : place(smoothed),
      average: average === undefined ? undefined : place(average),
    },
  };
}

/** The early cadence warning's label. */
export const LOW_CADENCE_LABEL = 'Low cadence';

/** The ERG cue, shown whenever the band is: who holds what. */
export const ERG_CUE = 'ERG: the trainer holds the power. You choose the cadence.';

/** The band's words, line by line, and the name of its picture (SC 1.1.1). */
export interface TargetBandWords {
  /** "Target 200 W, ride 190–210 W". */
  readonly band: string;
  /** "In the band" / "12 W under the band" / "No power reading". */
  readonly standing: string;
  /** "3 s power 195 W · Block average 198 W", or the part there is. */
  readonly readings: string;
  /** "2:15 left in this block", or `undefined`. */
  readonly left: string | undefined;
  /** The early cadence warning, or `undefined`. */
  readonly cadence: string | undefined;
  /** Every number the picture is drawn from, in one sentence. */
  readonly name: string;
}

export function targetBandWords(band: TargetBand): TargetBandWords {
  const range = `${String(band.low)}–${String(band.high)} W`;
  const standing =
    band.smoothed === undefined || band.standing === undefined
      ? 'No power reading'
      : band.standing === 'in'
        ? 'In the band'
        : band.standing === 'under'
          ? `${String(band.low - band.smoothed)} W under the band`
          : `${String(band.smoothed - band.high)} W over the band`;
  const readings = [
    band.smoothed === undefined ? undefined : `3 s power ${String(band.smoothed)} W`,
    band.average === undefined ? undefined : `Block average ${String(band.average)} W`,
  ].filter((part): part is string => part !== undefined);
  const left = band.left === undefined ? undefined : `${band.left} left in this block`;
  const cadence =
    band.lowCadence === undefined
      ? undefined
      : `${String(band.lowCadence)} rpm under load. Spin faster now: in ERG a slower cadence makes ` +
        'the pedals heavier, and the target will be eased if it keeps falling.';
  const name = [
    `Target band ${range}, around the ${String(band.target)} W the trainer confirmed.`,
    `${standing}.`,
    ...readings.map((part) => `${part}.`),
    ...(left === undefined ? [] : [`${left}.`]),
  ].join(' ');
  return {
    band: `Target ${String(band.target)} W, ride ${range}`,
    standing,
    readings: readings.join(' · '),
    left,
    cadence,
    name,
  };
}
