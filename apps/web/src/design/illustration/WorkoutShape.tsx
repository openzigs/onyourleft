// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from 'react';

import type { WorkoutSegment } from '@onyourleft/domain';

import { traceSegments } from '../../detail/series';
import { paint } from './paint';
import { coordinate, IllustrationSvg, type IllustrationProps } from './svg';

/**
 * How many bars a workout is drawn as at most — #938. A workout with no more
 * segments than this is drawn segment for segment, a ramp as a slope; a longer
 * one (an expanded 100 × 30 s block is 200) is cut into this many equal slices
 * of time, each as high as the mean target across it. The bound
 * `ProfileShape` §`PROFILE_SHAPE_COLUMNS` sets, for the same reason.
 */
export const WORKOUT_SHAPE_BARS = 120;

/**
 * The most points the drawing can hold, whatever it is handed: four corners a
 * bar when it is drawn segment for segment, which is more than the stepped
 * outline of the sliced drawing ever needs (two a slice and two a run). A test
 * feeds it 100 000 segments and counts.
 */
export const WORKOUT_SHAPE_MAX_POINTS = 4 * WORKOUT_SHAPE_BARS;

/** The drawing's size, in its own units. */
const WIDTH = 1000;
const HEIGHT = 100;
/** How much of the height the hardest target fills. */
const TOP_SHARE = 0.9;
/**
 * A free-ride block has no target (`FreeRideBlock`: the player lets the
 * trainer go), so it has no height of its own. It is drawn as a low bar at
 * this share of the hardest target — riding, but nothing asked — rather than
 * as nothing, which would read as a pause.
 */
const FREE_RIDE_SHARE = 0.2;

/** What a workout is drawn from: its expanded segments (`expandWorkout`). */
export interface WorkoutShapeInput {
  readonly segments: readonly Pick<WorkoutSegment, 'startsAt' | 'endsAt' | 'from' | 'to'>[];
}

/**
 * The bars' outlines, in drawing units.
 *
 * ⚠️ **No number survives into the drawing but geometry.** Heights are each
 * target's share of the hardest one, so the picture says "this part is harder
 * than that" and never a percentage or a watt — `workouts/library.ts`
 * §`WorkoutRow`'s rule, and why the rider's threshold is not an input at all.
 */
function workoutOutlines({ segments }: WorkoutShapeInput): readonly string[] {
  const end = segments.reduce((latest, segment) => Math.max(latest, segment.endsAt), 0);
  if (end <= 0) {
    return [];
  }
  const hardest = segments.reduce(
    (most, segment) => Math.max(most, segment.from ?? 0, segment.to ?? 0),
    0,
  );
  const scale = hardest > 0 ? hardest : 1;
  const free = FREE_RIDE_SHARE * scale;
  const x = (seconds: number): string => coordinate((seconds / end) * WIDTH);
  const y = (target: number): string => coordinate(HEIGHT - (target / scale) * HEIGHT * TOP_SHARE);
  const ground = coordinate(HEIGHT);

  if (segments.length <= WORKOUT_SHAPE_BARS) {
    return segments
      .filter((segment) => segment.endsAt > segment.startsAt)
      .map((segment) => {
        const from = segment.from ?? free;
        const to = segment.to ?? free;
        return `M${x(segment.startsAt)} ${ground} L${x(segment.startsAt)} ${y(from)} L${x(
          segment.endsAt,
        )} ${y(to)} L${x(segment.endsAt)} ${ground} Z`;
      });
  }

  // Sliced: each slice's time-weighted mean target, `undefined` where no
  // segment covers it, so a hole in the timeline is not drawn as riding.
  const width = end / WORKOUT_SHAPE_BARS;
  const totals = new Array<number>(WORKOUT_SHAPE_BARS).fill(0);
  const covered = new Array<number>(WORKOUT_SHAPE_BARS).fill(0);
  for (const segment of segments) {
    const first = Math.max(0, Math.floor(segment.startsAt / width));
    const last = Math.min(WORKOUT_SHAPE_BARS - 1, Math.floor(segment.endsAt / width));
    const target = ((segment.from ?? free) + (segment.to ?? free)) / 2;
    for (let slice = first; slice <= last; slice += 1) {
      const overlap =
        Math.min(segment.endsAt, (slice + 1) * width) - Math.max(segment.startsAt, slice * width);
      if (overlap > 0) {
        totals[slice] = (totals[slice] ?? 0) + overlap * target;
        covered[slice] = (covered[slice] ?? 0) + overlap;
      }
    }
  }
  const slices = totals.map((total, slice) => {
    const time = covered[slice] ?? 0;
    return time > 0 ? total / time : undefined;
  });
  return traceSegments(slices).map(({ from, values }) => {
    const points = [`${x(from * width)} ${ground}`];
    values.forEach((value, index) => {
      points.push(
        `${x((from + index) * width)} ${y(value)}`,
        `${x((from + index + 1) * width)} ${y(value)}`,
      );
    });
    points.push(`${x((from + values.length) * width)} ${ground}`);
    return `M${points.join(' L')} Z`;
  });
}

/**
 * A workout's blocks as bars of relative height — #938.
 *
 * Harder is taller, longer is wider, a ramp is a slope, and a free ride is a
 * low bar. It renders no number and no word: the workout's shape in words
 * (`WorkoutRow.shape`) and its duration are beside it on the card. An empty
 * workout draws nothing.
 */
export function WorkoutShape({
  className,
  workout,
}: IllustrationProps & { readonly workout: WorkoutShapeInput }): JSX.Element {
  return (
    <IllustrationSvg
      aspect="none"
      className={className}
      viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
    >
      {workoutOutlines(workout).map((outline, index) => (
        // A bar's position in the list is its identity: the list is rebuilt whole.
        <path key={index} className={paint('mark')} d={outline} />
      ))}
    </IllustrationSvg>
  );
}
