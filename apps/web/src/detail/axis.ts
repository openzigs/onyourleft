// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The x axis the ride page's stacked charts share, and the laps marked on it
 * — #2081.
 *
 * Pure. Every chart in the stack is drawn against ONE axis (#2068), and since
 * #2081 the rider picks which: the time into the ride, or the distance
 * ridden. An axis is a map from a moment of the ride (seconds, the stream's
 * own clock) to a place across the drawing (a fraction, 0 at the left edge and
 * 1 at the right), and back. The charts, the cursor and the lap bands all go
 * through the same map, so a lap band, a cursor line and the trace under them
 * cannot disagree about where a moment is drawn.
 *
 * ## Distance, from the speed channel
 *
 * No stream stores distance ridden. It is the speed channel summed over time,
 * at {@link DISTANCE_STEPS} steps across the ride — the drawing's own
 * resolution, so the profile handed to the view is a few hundred numbers and
 * never the 14 400 samples of a four-hour ride (`detail/load.ts`'s budget).
 *
 * ⚠️ **A gap in the speed channel adds no distance.** Nothing was measured,
 * and inventing a speed across it would be a distance nobody rode; so on the
 * distance axis a dropout is drawn as no ground covered, the way a stop is.
 * The time axis is the one to read a dropout's length on.
 */

import type { UnixSeconds } from '@onyourleft/domain';
import type { LapRecord } from '@onyourleft/store';

import { formatDuration } from '../format';

/** The time axis' title. Ride time, as the table's "From" column counts it. */
export const TIME_AXIS_TITLE = 'Time into the ride';

/** How many steps a distance profile is summed at: one per drawn point (`series.ts` §`CHART_POINTS`). */
export const DISTANCE_STEPS = 600;

/** Which quantity the charts are drawn against. */
export type AxisKind = 'time' | 'distance';

/** One x axis, shared by every chart in the stack. */
export interface RideAxis {
  readonly kind: AxisKind;
  /** The axis' title, under its labels. */
  readonly title: string;
  /** The start, the middle and the end, with their unit. */
  readonly ticks: readonly string[];
  /** Where `seconds` into the ride is drawn: 0 at the left edge, 1 at the right. */
  readonly fractionAt: (seconds: number) => number;
  /** The moment drawn at `fraction` across: the inverse of {@link fractionAt}. */
  readonly secondsAt: (fraction: number) => number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

/** The time axis over `span` seconds — #2068's, and the default. */
export function timeAxis(span: number): RideAxis {
  return {
    kind: 'time',
    title: TIME_AXIS_TITLE,
    ticks: [formatDuration(0), formatDuration(span / 2), formatDuration(span)],
    fractionAt: (seconds) => (span <= 0 ? 0 : clamp(seconds, 0, span) / span),
    secondsAt: (fraction) => clamp(fraction, 0, 1) * Math.max(0, span),
  };
}

/**
 * How far the rider had gone at each step of the ride, in metres.
 *
 * `metres[k]` is the distance at `k × secondsPerStep` seconds, so it has one
 * more entry than there are steps, starting at 0 and never falling.
 */
export interface DistanceProfile {
  readonly metres: readonly number[];
  readonly secondsPerStep: number;
}

/**
 * Sum a speed channel (metres a second, gaps `undefined`) into a
 * {@link DistanceProfile} of at most `steps` steps.
 *
 * Each sample covers `sampleInterval` seconds; a step boundary inside a sample
 * takes the share of it that falls before the boundary, so the profile's last
 * entry is the whole channel's distance however the steps fall.
 */
export function distanceProfile(
  speeds: readonly (number | undefined)[],
  sampleInterval: number,
  steps: number = DISTANCE_STEPS,
): DistanceProfile {
  const total = speeds.length * sampleInterval;
  const count = Math.max(1, Math.min(steps, speeds.length));
  const secondsPerStep = total <= 0 ? 0 : total / count;
  const metres: number[] = [0];
  let travelled = 0;
  let sample = 0;
  for (let step = 1; step <= count; step += 1) {
    const until = step * secondsPerStep;
    // Every whole sample that ends at or before this boundary.
    while (sample < speeds.length && (sample + 1) * sampleInterval <= until + 1e-9) {
      travelled += (speeds[sample] ?? 0) * sampleInterval;
      sample += 1;
    }
    // And the share of the next one that is already behind the boundary.
    const partial = sample < speeds.length ? until - sample * sampleInterval : 0;
    metres.push(travelled + (partial > 0 ? (speeds[sample] ?? 0) * partial : 0));
  }
  return { metres, secondsPerStep };
}

/** The distance a profile reached by `seconds`, interpolated between its steps. */
export function distanceAt(profile: DistanceProfile, seconds: number): number {
  const { metres, secondsPerStep } = profile;
  const last = metres.length - 1;
  if (secondsPerStep <= 0 || last <= 0) {
    return metres[last] ?? 0;
  }
  const position = clamp(seconds / secondsPerStep, 0, last);
  const below = Math.floor(position);
  const above = Math.min(last, below + 1);
  const from = metres[below] ?? 0;
  const to = metres[above] ?? from;
  return from + (to - from) * (position - below);
}

/**
 * The distance axis over a profile, or `undefined` when the profile covers no
 * ground — a ride whose speed read nought throughout has no distance to draw
 * against, and the page offers only time.
 *
 * `format` is the rider's distance with its unit (`units/format.ts`): this
 * module decides no unit.
 */
export function distanceAxis(
  profile: DistanceProfile,
  title: string,
  format: (metres: number) => string,
): RideAxis | undefined {
  const { metres, secondsPerStep } = profile;
  const total = metres[metres.length - 1] ?? 0;
  if (total <= 0 || secondsPerStep <= 0) {
    return undefined;
  }
  const span = (metres.length - 1) * secondsPerStep;
  return {
    kind: 'distance',
    title,
    ticks: [format(0), format(total / 2), format(total)],
    fractionAt: (seconds) => distanceAt(profile, seconds) / total,
    secondsAt: (fraction) => {
      const wanted = clamp(fraction, 0, 1) * total;
      // The first step that reaches the distance wanted; the profile never
      // falls, so a binary search finds it.
      let low = 0;
      let high = metres.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if ((metres[middle] ?? 0) < wanted) {
          low = middle + 1;
        } else {
          high = middle;
        }
      }
      if (low === 0) {
        return 0;
      }
      const from = metres[low - 1] ?? 0;
      const to = metres[low] ?? from;
      const share = to === from ? 0 : (wanted - from) / (to - from);
      return clamp((low - 1 + share) * secondsPerStep, 0, span);
    },
  };
}

/** One lap, as a stretch of the ride's own clock. */
export interface LapBand {
  /** The lap's number as the lap table counts it: from one. */
  readonly number: number;
  /** Seconds into the ride the lap started, and ended. */
  readonly from: number;
  readonly to: number;
}

/**
 * The ride's laps as stretches of its stream clock, clipped to the ride.
 *
 * A lap's `startedAt` is on the same clock as the stream set's, so the
 * difference is seconds into the ride (`recording/laps.ts` turns a lap into
 * sample indexes the same way). A lap wholly outside the recorded streams —
 * an imported lap list longer than its samples — is left out rather than
 * drawn as a sliver at an edge.
 */
export function lapBands(
  laps: readonly LapRecord[],
  streamsStartedAt: UnixSeconds,
  rideSeconds: number,
): readonly LapBand[] {
  const bands: LapBand[] = [];
  for (const lap of laps) {
    const start = Number(lap.startedAt) - Number(streamsStartedAt);
    const from = clamp(start, 0, rideSeconds);
    const to = clamp(start + Number(lap.elapsedTime), 0, rideSeconds);
    if (to > from) {
      bands.push({ number: lap.ordinal + 1, from, to });
    }
  }
  return bands;
}

/** The lap being ridden at `seconds`, or `undefined` between or outside laps. */
export function lapAt(bands: readonly LapBand[], seconds: number): LapBand | undefined {
  // The last lap that has started: a lap's end and the next one's start are
  // the same moment, and that moment belongs to the lap that starts there.
  let found: LapBand | undefined;
  for (const band of bands) {
    if (seconds >= band.from && seconds <= band.to) {
      found = band;
    }
  }
  return found;
}
