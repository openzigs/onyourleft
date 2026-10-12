// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A running workout as a picture — #1307: the plan, where the rider is in it,
 * the target the trainer confirmed and what the rider is doing against it.
 *
 * Pure geometry and one sentence, apart from the component that draws them
 * (`WorkoutGraph.tsx`), for `workouts/block-chart.ts`'s reason: what the graph
 * says is a decision worth testing on its own.
 *
 * ## It draws, and nothing else
 *
 * Nothing here writes to a trainer or decides a write. It reads what the Ride
 * screen's workout panel reads — `ride/controller.ts` §`RideWorkoutSnapshot`
 * — and the game is handed the same object (`game/trainer-port.ts`
 * §`runningWorkout`). It needs no instance (ADR 0036 D-3).
 *
 * ## Three lanes, one above another
 *
 * 1. **The plan**: every block as a bar, as wide as it is long and as tall as
 *    its target — `block-chart.ts`'s drawing, on its scale. The part ridden is
 *    an OUTLINE and the part to come is FILLED, so the two are told apart by
 *    shape and not by colour (SC 1.4.1), and a line with a cap marks now.
 * 2. **Heart rate**, only while a heart-rate hold has been running inside the
 *    window: the chosen range as a band between two dashed edges, and heart
 *    rate as a line in it.
 * 3. **The last {@link TRACE_WINDOW_SECONDS} seconds**: the target as shaded
 *    steps and the rider's power as a line over them. A stepped, shaded area
 *    and a thin line are different shapes, again not only different colours.
 *
 * ## ⚠️ The target drawn is the one the trainer ACKNOWLEDGED
 *
 * `holdingWatts`, never a target only asked for — `WorkoutPanel.tsx`'s rule
 * for the tone, for the same reason. So a target raised to the trainer's
 * minimum (#1297, #1301) or refused is drawn as what the machine holds:
 *
 * - in the third lane always, because that lane is drawn from nothing else;
 * - in the plan, for the block being ridden: when what the trainer confirmed
 *   is not what the plan asks for now, the block's bar is drawn at the
 *   confirmed height ({@link heldInstead}) and the sentence says both numbers.
 *
 * ⚠️ **A block already finished is drawn as the plan asked for it**, as an
 * outline. What the trainer held through it is in the third lane for as long
 * as the window reaches back, and nowhere after that: the snapshot keeps
 * {@link TRACE_MAX_SAMPLES} samples and no more.
 *
 * ## Room for a re-plan — #1244
 *
 * {@link WorkoutGraphInput.replaced} is what the plan was before a re-plan
 * changed it, drawn as a dashed outline behind the plan that stands. Nothing
 * supplies it yet: #1244 does.
 *
 * ## No metric trademark
 *
 * Watts, beats per minute and a share of threshold, in those words
 * (`docs/agents/scope-and-ip.md`).
 */

import {
  blockChartPaths,
  CHART_HEIGHT,
  CHART_TOP_SHARE,
  CHART_WIDTH,
  type BlockChartPaths,
  type BlockChartSegment,
} from '../workouts/block-chart';
import { durationText } from '../workouts/library';

/** How far back the third lane reaches: five minutes. */
export const TRACE_WINDOW_SECONDS = 300;

/** The most samples a snapshot carries: one a second across the window. */
export const TRACE_MAX_SAMPLES = TRACE_WINDOW_SECONDS;

/** Lane heights, in drawing units, and the space between two lanes. */
export const PLAN_LANE_HEIGHT = CHART_HEIGHT;
export const HEART_RATE_LANE_HEIGHT = 60;
export const TRACE_LANE_HEIGHT = 100;
export const LANE_GAP = 10;

/**
 * How far the confirmed target may be from the plan's before the block is
 * drawn at the confirmed height. A trainer confirms whole watts and the plan
 * is a share of threshold, so the two differ by a rounding at the best of
 * times.
 */
export const HELD_TOLERANCE_WATTS = 2;

/**
 * The least the third lane spans, bottom to top: a share of the highest value
 * in it, and a floor in watts for a window with almost nothing in it.
 */
const TRACE_MINIMUM_SPAN_SHARE = 0.4;
const TRACE_MINIMUM_SPAN_WATTS = 40;

/** Room around heart rate and its range in the second lane. */
const HEART_RATE_MARGIN_BPM = 5;

/** The now mark's cap: half its width and its height, in drawing units. */
const CAP_HALF_WIDTH = 9;
const CAP_HEIGHT = 16;

/** One second of a running workout, as the graph's second and third lanes read it. */
export interface WorkoutTraceSample {
  /** Seconds into the workout, excluding paused time — the player's clock. */
  readonly at: number;
  /** The target the trainer last acknowledged, in watts; `undefined` when it holds none. */
  readonly target: number | undefined;
  /** The rider's power, or `undefined` when the reading is not live. Never a zero for a dropout. */
  readonly power: number | undefined;
  /** Heart rate, or `undefined` when the reading is not live. */
  readonly heartRate: number | undefined;
  /** The range a running heart-rate hold is keeping to, or `undefined` outside one. */
  readonly range: { readonly low: number; readonly high: number } | undefined;
}

/** What the graph is drawn from: a subset of `RideWorkoutSnapshot`, and assignable from it. */
export interface WorkoutGraphInput {
  readonly elapsedSeconds: number;
  readonly timeline: {
    readonly segments: readonly BlockChartSegment[];
    readonly totalSeconds: number;
  };
  /** What the trainer last confirmed it holds. */
  readonly holdingWatts: number | undefined;
  /** The threshold the workout was started with, which turns a share into watts. */
  readonly thresholdWatts?: number | undefined;
  readonly trace?: readonly WorkoutTraceSample[] | undefined;
  /** What a re-plan replaced — #1244's to supply. @see the module note */
  readonly replaced?: readonly BlockChartSegment[] | undefined;
}

/**
 * The trace with one more sample, bounded: nothing older than the window, and
 * at most {@link TRACE_MAX_SAMPLES}.
 *
 * ⚠️ A sample no later than the last one REPLACES it and everything after it,
 * so a second tick inside one second of the workout's clock cannot make the
 * line double back.
 */
export function withTraceSample(
  trace: readonly WorkoutTraceSample[],
  sample: WorkoutTraceSample,
): readonly WorkoutTraceSample[] {
  if (!Number.isFinite(sample.at)) {
    return trace;
  }
  const kept = trace.filter(
    (earlier) => earlier.at < sample.at && earlier.at >= sample.at - TRACE_WINDOW_SECONDS,
  );
  return [...kept.slice(-(TRACE_MAX_SAMPLES - 1)), sample];
}

/** The plan lane. */
export interface PlanLanePaths {
  /** The part still to ride: filled, band by band. */
  readonly toCome: BlockChartPaths;
  /** The part ridden, as one outline. */
  readonly done: string;
  /** What a re-plan replaced, as one outline. Empty when nothing was. */
  readonly replaced: string;
  /** The dashed line at 100 % of threshold. */
  readonly rule: string;
  /** Now: a line the height of the lane, and the cap on top of it. */
  readonly now: string;
  readonly nowCap: string;
  /** Where now is, 0 to 1 across the lane — for a test to read rather than parse a path. */
  readonly nowFraction: number;
}

/** The heart-rate lane. */
export interface HeartRateLanePaths {
  /** The chosen range, as a closed band. */
  readonly range: string;
  readonly line: string;
}

/** The lane of the last few minutes. */
export interface TraceLanePaths {
  /** The confirmed target as closed steps down to the ground, and their top edge. */
  readonly targetArea: string;
  readonly targetEdge: string;
  readonly power: string;
  /** The watts the bottom and the top of the lane stand for. @see traceScale */
  readonly bottomWatts: number;
  readonly topWatts: number;
}

export interface WorkoutGraphPaths {
  readonly plan: PlanLanePaths;
  /** `undefined` when no hold ran inside the window: the lane is not drawn. */
  readonly heartRate: HeartRateLanePaths | undefined;
  readonly trace: TraceLanePaths;
  /** Where each lane starts, top to bottom, and the height of the whole drawing. */
  readonly heartRateTop: number;
  readonly traceTop: number;
  readonly height: number;
}

/** A number for a path, to two decimal places and no more. */
function coordinate(value: number): string {
  return String(Math.round(value * 100) / 100);
}

const targeted = (
  segment: BlockChartSegment,
): segment is BlockChartSegment & { readonly from: number; readonly to: number } =>
  segment.from !== undefined && segment.to !== undefined;

/** The segment a moment falls in, or `undefined` before the start and after the end. */
function segmentNow(
  segments: readonly BlockChartSegment[],
  elapsed: number,
): BlockChartSegment | undefined {
  return segments.find((segment) => segment.startsAt <= elapsed && elapsed < segment.endsAt);
}

/** What the plan asks for at a moment inside a segment, as a share of threshold. */
function shareAt(segment: { from: number; to: number } & BlockChartSegment, at: number): number {
  const length = segment.endsAt - segment.startsAt;
  const along = length > 0 ? (at - segment.startsAt) / length : 0;
  return segment.from + (segment.to - segment.from) * along;
}

/**
 * What the trainer confirmed, when that is NOT what the plan asks for now —
 * a target raised to the machine's minimum (#1297), a write it refused, an
 * eased target, a heart-rate hold's own. `undefined` while the two agree, in
 * a free ride, before any target is confirmed, and with no threshold to
 * compare in.
 *
 * ⚠️ On a ramp the plan moves every second and the confirmation trails it, so
 * a ramp is judged against its whole span rather than this instant: only a
 * target OUTSIDE what the ramp ever asks is a different target.
 */
export function heldInstead(
  input: WorkoutGraphInput,
): { readonly heldWatts: number; readonly plannedWatts: number } | undefined {
  const { holdingWatts, thresholdWatts } = input;
  if (
    holdingWatts === undefined ||
    thresholdWatts === undefined ||
    !Number.isFinite(holdingWatts) ||
    !Number.isFinite(thresholdWatts) ||
    thresholdWatts <= 0
  ) {
    return undefined;
  }
  const segment = segmentNow(input.timeline.segments, input.elapsedSeconds);
  if (segment === undefined || !targeted(segment)) {
    return undefined;
  }
  const low = Math.min(segment.from, segment.to) * thresholdWatts;
  const high = Math.max(segment.from, segment.to) * thresholdWatts;
  if (holdingWatts >= low - HELD_TOLERANCE_WATTS && holdingWatts <= high + HELD_TOLERANCE_WATTS) {
    return undefined;
  }
  return {
    heldWatts: holdingWatts,
    plannedWatts: Math.round(shareAt(segment, input.elapsedSeconds) * thresholdWatts),
  };
}

/** The segments before and after a moment, a segment that straddles it cut in two. */
function splitAt(
  segments: readonly BlockChartSegment[],
  at: number,
): { readonly before: readonly BlockChartSegment[]; readonly after: readonly BlockChartSegment[] } {
  const before: BlockChartSegment[] = [];
  const after: BlockChartSegment[] = [];
  for (const segment of segments) {
    if (segment.endsAt <= at) {
      before.push(segment);
    } else if (segment.startsAt >= at) {
      after.push(segment);
    } else {
      const middle = targeted(segment) ? shareAt(segment, at) : undefined;
      // The brands are the domain's; the cut is a number between two of them.
      before.push({ ...segment, endsAt: at, to: middle } as BlockChartSegment);
      after.push({ ...segment, startsAt: at, from: middle } as BlockChartSegment);
    }
  }
  return { before, after };
}

/** Every part of a block chart as one path, for a shape drawn as an outline. */
function outlineOf(paths: BlockChartPaths): string {
  return paths.bands.join('') + paths.freeRide;
}

function planLane(input: WorkoutGraphInput): PlanLanePaths {
  const total = input.timeline.totalSeconds;
  const elapsed = Math.min(Math.max(0, input.elapsedSeconds), Math.max(0, total));
  const held = heldInstead(input);
  const current = segmentNow(input.timeline.segments, input.elapsedSeconds);
  const segments =
    held === undefined || input.thresholdWatts === undefined
      ? input.timeline.segments
      : input.timeline.segments.map((segment) => {
          if (segment !== current) return segment;
          const share = held.heldWatts / (input.thresholdWatts ?? 1);
          return { ...segment, from: share, to: share } as BlockChartSegment;
        });
  const replaced = input.replaced ?? [];
  const topShare = [...segments, ...replaced].reduce(
    (most, segment) =>
      Math.max(
        most,
        Number.isFinite(segment.from) ? (segment.from ?? 0) : 0,
        Number.isFinite(segment.to) ? (segment.to ?? 0) : 0,
      ),
    CHART_TOP_SHARE,
  );
  const scale = { endSeconds: total, topShare };
  const { before, after } = splitAt(segments, elapsed);
  const whole = blockChartPaths(segments, scale);
  const fraction = total > 0 && Number.isFinite(elapsed / total) ? elapsed / total : 0;
  const x = fraction * CHART_WIDTH;
  return {
    toCome: blockChartPaths(after, scale),
    done: outlineOf(blockChartPaths(before, scale)),
    replaced: outlineOf(blockChartPaths(replaced, scale)),
    rule: whole.rule,
    now: `M${coordinate(x)} 0L${coordinate(x)} ${coordinate(PLAN_LANE_HEIGHT)}`,
    nowCap: `M${coordinate(x - CAP_HALF_WIDTH)} 0L${coordinate(x + CAP_HALF_WIDTH)} 0L${coordinate(
      x,
    )} ${coordinate(CAP_HEIGHT)}Z`,
    nowFraction: fraction,
  };
}

/** The samples the two lower lanes draw: finite, in order, and inside the window. */
function windowed(input: WorkoutGraphInput): readonly WorkoutTraceSample[] {
  const end = input.elapsedSeconds;
  return (input.trace ?? []).filter(
    (sample) =>
      Number.isFinite(sample.at) && sample.at <= end && sample.at >= end - TRACE_WINDOW_SECONDS,
  );
}

const finite = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value);

/**
 * A line through the samples that have a value, broken wherever one has none:
 * a dropout is a gap, never a line drawn down to zero or across it.
 */
function brokenLine(
  samples: readonly WorkoutTraceSample[],
  value: (sample: WorkoutTraceSample) => number | undefined,
  x: (at: number) => number,
  y: (value: number) => number,
): string {
  let path = '';
  let drawing = false;
  for (const sample of samples) {
    const here = value(sample);
    if (!finite(here)) {
      drawing = false;
      continue;
    }
    path += `${drawing ? 'L' : 'M'}${coordinate(x(sample.at))} ${coordinate(y(here))}`;
    drawing = true;
  }
  return path;
}

/**
 * Runs of consecutive samples that all have a value, as closed steps between a
 * floor and a ceiling, and the ceiling's own edge. A step holds its value
 * until the next sample, which is what a setpoint does.
 */
function steps(
  samples: readonly WorkoutTraceSample[],
  ceiling: (sample: WorkoutTraceSample) => number | undefined,
  floor: (sample: WorkoutTraceSample) => number,
  x: (at: number) => number,
): { readonly area: string; readonly edge: string } {
  let area = '';
  let edge = '';
  let run: WorkoutTraceSample[] = [];
  const close = (until: number): void => {
    const first = run[0];
    if (first === undefined) return;
    let top = `M${coordinate(x(first.at))} ${coordinate(ceiling(first) ?? 0)}`;
    let bottom = '';
    run.forEach((sample, index) => {
      const next = run[index + 1]?.at ?? until;
      top += `H${coordinate(x(next))}`;
      const after = run[index + 1];
      if (after !== undefined) top += `V${coordinate(ceiling(after) ?? 0)}`;
      // The floor, walked back right to left.
      bottom =
        `L${coordinate(x(next))} ${coordinate(floor(sample))}` +
        `L${coordinate(x(sample.at))} ${coordinate(floor(sample))}` +
        bottom;
    });
    edge += top;
    area += `${top}${bottom}Z`;
    run = [];
  };
  samples.forEach((sample, index) => {
    if (finite(ceiling(sample))) {
      run.push(sample);
    } else {
      close(sample.at);
    }
    if (index === samples.length - 1) {
      // The last step runs to the last sample itself: nothing is known after it.
      close(sample.at);
    }
  });
  return { area, edge };
}

/**
 * The watts the bottom and the top of the third lane stand for.
 *
 * ⚠️ **Not from zero**, deliberately. What a rider reads here is power AGAINST
 * the target, and at 225 W a rider eight watts off is three per cent of a
 * zero-based lane: a flat line on a flat step. So the lane is fitted to what
 * is in the window, with room either side — at least
 * {@link TRACE_MINIMUM_SPAN_SHARE} of the highest value, so a rider dead on a
 * steady target is not magnified into a wobble — and it reaches zero only
 * when something in the window does (an eased target, a rider who stopped).
 * No number is drawn on the lane: the watts are in the sentence.
 */
function traceScale(samples: readonly WorkoutTraceSample[]): {
  readonly bottomWatts: number;
  readonly topWatts: number;
} {
  let lowest = Infinity;
  let highest = 0;
  for (const sample of samples) {
    for (const value of [sample.target, sample.power]) {
      if (finite(value)) {
        lowest = Math.min(lowest, Math.max(0, value));
        highest = Math.max(highest, value);
      }
    }
  }
  if (lowest === Infinity) {
    return { bottomWatts: 0, topWatts: TRACE_MINIMUM_SPAN_WATTS };
  }
  const room =
    Math.max(highest - lowest, highest * TRACE_MINIMUM_SPAN_SHARE, TRACE_MINIMUM_SPAN_WATTS) / 2;
  return {
    bottomWatts: Math.max(0, Math.floor((lowest - room) / 10) * 10),
    topWatts: Math.ceil((highest + room) / 10) * 10,
  };
}

function traceLane(samples: readonly WorkoutTraceSample[], end: number): TraceLanePaths {
  const { bottomWatts, topWatts } = traceScale(samples);
  const x = (at: number): number =>
    ((at - (end - TRACE_WINDOW_SECONDS)) / TRACE_WINDOW_SECONDS) * CHART_WIDTH;
  const y = (watts: number): number =>
    TRACE_LANE_HEIGHT -
    ((Math.max(bottomWatts, watts) - bottomWatts) / (topWatts - bottomWatts)) * TRACE_LANE_HEIGHT;
  const target = steps(
    samples,
    (sample) => (finite(sample.target) ? y(sample.target) : undefined),
    () => TRACE_LANE_HEIGHT,
    x,
  );
  return {
    targetArea: target.area,
    targetEdge: target.edge,
    power: brokenLine(samples, (sample) => sample.power, x, y),
    bottomWatts,
    topWatts,
  };
}

function heartRateLane(
  samples: readonly WorkoutTraceSample[],
  end: number,
): HeartRateLanePaths | undefined {
  const ranged = samples.filter(
    (sample) => sample.range !== undefined && finite(sample.range.low) && finite(sample.range.high),
  );
  if (ranged.length === 0) {
    return undefined;
  }
  let low = Infinity;
  let high = -Infinity;
  for (const sample of samples) {
    for (const value of [sample.range?.low, sample.range?.high, sample.heartRate]) {
      if (finite(value)) {
        low = Math.min(low, value);
        high = Math.max(high, value);
      }
    }
  }
  low -= HEART_RATE_MARGIN_BPM;
  high += HEART_RATE_MARGIN_BPM;
  const x = (at: number): number =>
    ((at - (end - TRACE_WINDOW_SECONDS)) / TRACE_WINDOW_SECONDS) * CHART_WIDTH;
  const y = (bpm: number): number =>
    HEART_RATE_LANE_HEIGHT - ((bpm - low) / (high - low)) * HEART_RATE_LANE_HEIGHT;
  const rangedSet = new Set(ranged);
  const valid = (sample: WorkoutTraceSample): boolean => rangedSet.has(sample);
  const band = steps(
    samples,
    (sample) => (valid(sample) ? y(sample.range?.high ?? 0) : undefined),
    (sample) => y(sample.range?.low ?? 0),
    x,
  );
  return {
    range: band.area,
    line: brokenLine(samples, (sample) => sample.heartRate, x, y),
  };
}

/** Everything the graph draws, as path data in three lanes. */
export function workoutGraphPaths(input: WorkoutGraphInput): WorkoutGraphPaths {
  const samples = windowed(input);
  const heartRate = heartRateLane(samples, input.elapsedSeconds);
  const heartRateTop = PLAN_LANE_HEIGHT + LANE_GAP;
  const traceTop =
    heartRate === undefined ? heartRateTop : heartRateTop + HEART_RATE_LANE_HEIGHT + LANE_GAP;
  return {
    plan: planLane(input),
    heartRate,
    trace: traceLane(samples, input.elapsedSeconds),
    heartRateTop,
    traceTop,
    height: traceTop + TRACE_LANE_HEIGHT,
  };
}

/** The Ride screen's key to the lanes, under the graph. */
export const GRAPH_KEY_PLAN =
  'Top: the whole workout. The outlined part is ridden, the filled part is to come, and the ' +
  'line marks where you are.';
export const GRAPH_KEY_HEART_RATE =
  'Middle: your heart rate, with the range you chose shaded between dashed edges.';
export const GRAPH_KEY_TRACE =
  'Bottom: the last 5 minutes. The shaded steps are the target the trainer confirmed, and the ' +
  'line is your power.';

/**
 * What the graph shows, in words — its text equivalent (SC 1.1.1), and the
 * name of the image. It says the numbers the picture is drawn from and
 * describes no colour.
 */
export function workoutGraphText(input: WorkoutGraphInput): string {
  const parts = [
    `Workout graph. ${durationText(Math.max(0, input.elapsedSeconds))} of ${durationText(
      input.timeline.totalSeconds,
    )} ridden.`,
  ];
  const held = heldInstead(input);
  if (finite(input.holdingWatts)) {
    parts.push(
      held === undefined
        ? `Target the trainer last confirmed: ${String(input.holdingWatts)} W.`
        : `Target the trainer last confirmed: ${String(held.heldWatts)} W, where the plan asks ` +
            `for ${String(held.plannedWatts)} W.`,
    );
  }
  const last = windowed(input).at(-1);
  if (last !== undefined && finite(last.power)) {
    parts.push(`Your power: ${String(Math.round(last.power))} W.`);
  }
  if (last?.range !== undefined) {
    parts.push(
      finite(last.heartRate)
        ? `Heart rate: ${String(Math.round(last.heartRate))} bpm, with a chosen range of ` +
            `${String(last.range.low)}–${String(last.range.high)} bpm.`
        : `No heart rate, with a chosen range of ${String(last.range.low)}–${String(
            last.range.high,
          )} bpm.`,
    );
  }
  if ((input.replaced ?? []).length > 0) {
    parts.push('The dashed outline is the plan before it was changed.');
  }
  return parts.join(' ');
}
