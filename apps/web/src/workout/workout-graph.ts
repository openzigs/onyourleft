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
 * ## Three lanes, one above another, each with its numbers
 *
 * 1. **The plan**: every block as a bar, as wide as it is long and as tall as
 *    its target — `block-chart.ts`'s drawing, on a scale whose top is THIS
 *    workout's hardest target, so the bars use the lane. The part ridden is
 *    an OUTLINE and the part to come is FILLED, so the two are told apart by
 *    shape and not by colour (SC 1.4.1), and a line with a cap marks now.
 *    ⚠️ No threshold rule is drawn here: on this scale it would leave the
 *    lane on any workout that stays under threshold, and a line with no
 *    label was the one mark the key did not explain.
 * 2. **Heart rate**, only while a heart-rate hold has been running inside the
 *    window: the chosen range as a band between two dashed edges, and heart
 *    rate as a line in it.
 * 3. **The last {@link TRACE_WINDOW_SECONDS} seconds**: the target as shaded
 *    steps and the rider's power as a line over them. A stepped, shaded area
 *    and a thin line are different shapes, again not only different colours.
 *
 * {@link workoutGraphLabels} is the numbers each lane carries beside its
 * drawing — the clock, the target and the power in watts, heart rate and the
 * range in beats per minute — because a picture with no number on it cannot
 * be read against anything.
 *
 * ## The HUD's strip is fewer things, larger
 *
 * {@link workoutStripPaths}: ONE lane, chosen by what is running — heart rate
 * against its range in a heart-rate hold, power against the confirmed target
 * otherwise — a thin bar of how far through the workout the rider is, and one
 * line of text ({@link workoutStripText}). Three lanes in 80 px left a
 * heart-rate band seven pixels tall.
 *
 * ## ⚠️ The target drawn is the one the trainer ACKNOWLEDGED
 *
 * `holdingWatts`, never a target only asked for — `WorkoutPanel.tsx`'s rule
 * for the tone, for the same reason. So a target raised to the trainer's
 * minimum (#1297, #1301) or refused is drawn as what the machine holds:
 *
 * - in the third lane always, because that lane is drawn from nothing else;
 * - in the plan, for the block being ridden: when what the trainer confirmed
 *   is not what the plan asks for now ({@link heldInstead}), the rest of that
 *   block is a DASHED OUTLINE at the height the plan asks and a shaded step
 *   at the height the trainer holds, so the difference is the gap between
 *   two shapes; the sentence and the lane's numbers say both. Every block
 *   still to come stays drawn as the plan asks.
 *
 * ⚠️ **A block already finished is drawn as the plan asked for it**, as an
 * outline. What the trainer held through it is in the third lane for as long
 * as the window reaches back, and nowhere after that: the snapshot keeps
 * {@link TRACE_MAX_SAMPLES} samples and no more.
 *
 * ## Room for a re-plan — #1244
 *
 * {@link WorkoutGraphInput.replaced} is what the plan was before a re-plan
 * changed it, drawn as a dotted outline behind the plan that stands. Nothing
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
  FREE_RIDE_DRAWN_SHARE,
  type BlockChartPaths,
  type BlockChartSegment,
} from '../workouts/block-chart';
import { formatDuration } from '../format';
import { durationText } from '../workouts/library';

/** How far back the third lane reaches: five minutes. */
export const TRACE_WINDOW_SECONDS = 300;

/** The most samples a snapshot carries: one a second across the window. */
export const TRACE_MAX_SAMPLES = TRACE_WINDOW_SECONDS;

/** Lane heights, in drawing units: each lane is its own drawing. */
export const PLAN_LANE_HEIGHT = CHART_HEIGHT;
export const HEART_RATE_LANE_HEIGHT = 60;
export const TRACE_LANE_HEIGHT = 100;

/**
 * How much of the plan lane's height the workout's hardest target takes. The
 * rest is room above it for the now mark's cap.
 */
export const PLAN_FILL_SHARE = 0.85;

/**
 * How far in from the top and the bottom of the third lane its scale's two
 * ends are drawn, in drawing units. ⚠️ So that a target of 0 W — an eased
 * workout — is a step with a height and an edge above the lane's own bottom
 * line, not a line drawn on top of it.
 */
export const TRACE_LANE_INSET = 10;

/**
 * How long after a block starts the graph waits before it calls a confirmed
 * target that is not the plan's a different target ({@link heldInstead}).
 * The write for a new block takes about a second to be acknowledged, and for
 * that second the trainer truthfully still holds the block before: that is a
 * write on its way, not a clamp, a refusal or an ease, and it must not wear
 * their mark. `ride/controller.test.ts` §"#1307" crosses a block change with
 * the real controller and reads every tick.
 */
export const HELD_GRACE_SECONDS = 3;

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

/** The room left beyond the highest and lowest value, as a share of the span. */
const TRACE_BREATHING_SHARE = 0.05;

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
  /**
   * The part still to ride, as the plan asks: filled, band by band. While
   * {@link heldInstead} reports, the rest of the block being ridden is NOT in
   * here — it is {@link asked} and {@link held}.
   */
  readonly toCome: BlockChartPaths;
  /**
   * The rest of the block being ridden at the height the PLAN asks, as an
   * outline, while the trainer holds something else. Empty otherwise.
   */
  readonly asked: string;
  /**
   * What the trainer holds through the rest of that block: a closed step and
   * its top edge. Both empty when it holds 0 W — there is no height to draw —
   * and when the trainer holds what the plan asks.
   */
  readonly heldArea: string;
  readonly heldEdge: string;
  /** The part ridden, as one outline. */
  readonly done: string;
  /** What a re-plan replaced, as one outline. Empty when nothing was. */
  readonly replaced: string;
  /** Now: a line the height of the lane, and the cap on top of it. */
  readonly now: string;
  readonly nowCap: string;
  /** Where now is, 0 to 1 across the lane — for a test to read rather than parse a path. */
  readonly nowFraction: number;
}

/** The heart-rate lane. */
export interface HeartRateLanePaths {
  /** The chosen range, as a closed band, and its two edges as open lines. */
  readonly range: string;
  readonly rangeEdges: string;
  readonly line: string;
  /** The range the newest sample in a hold carries, in beats per minute. */
  readonly low: number;
  readonly high: number;
  /** Where those two edges are drawn, 0 at the top of the lane to 1 at the bottom. */
  readonly highAt: number;
  readonly lowAt: number;
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
 *
 * ⚠️ And not in the first {@link HELD_GRACE_SECONDS} seconds of a block, when
 * the trainer still holds the block before because the new write has not been
 * acknowledged yet.
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
  if (input.elapsedSeconds - segment.startsAt < HELD_GRACE_SECONDS) {
    // The write for this block may still be on its way. @see HELD_GRACE_SECONDS
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
  const heldShare =
    held === undefined || input.thresholdWatts === undefined
      ? undefined
      : Math.max(0, held.heldWatts / input.thresholdWatts);
  const segments = input.timeline.segments;
  const replaced = input.replaced ?? [];
  // The scale's top is this workout's own hardest target — and what the
  // trainer holds or a re-plan replaced, where either is higher — so the bars
  // use the lane. With no target anywhere (a workout of free rides) it is the
  // block chart's own.
  const hardest = [...segments, ...replaced].reduce(
    (most, segment) =>
      Math.max(
        most,
        Number.isFinite(segment.from) ? (segment.from ?? 0) : 0,
        Number.isFinite(segment.to) ? (segment.to ?? 0) : 0,
      ),
    heldShare ?? 0,
  );
  const topShare =
    hardest > 0 ? Math.max(hardest, FREE_RIDE_DRAWN_SHARE) / PLAN_FILL_SHARE : CHART_TOP_SHARE;
  const scale = { endSeconds: total, topShare };
  const { before, after } = splitAt(segments, elapsed);
  // While the trainer holds something else, the rest of the block being
  // ridden is taken out of the filled part and drawn as two shapes instead.
  const riding = heldShare === undefined ? undefined : after[0];
  const toCome = riding === undefined ? after : after.slice(1);
  const fraction = total > 0 && Number.isFinite(elapsed / total) ? elapsed / total : 0;
  const x = fraction * CHART_WIDTH;
  let heldArea = '';
  let heldEdge = '';
  if (riding !== undefined && heldShare !== undefined && heldShare > 0 && total > 0) {
    const x0 = coordinate((riding.startsAt / total) * CHART_WIDTH);
    const x1 = coordinate((riding.endsAt / total) * CHART_WIDTH);
    const top = coordinate(PLAN_LANE_HEIGHT - (heldShare / topShare) * PLAN_LANE_HEIGHT);
    const ground = coordinate(PLAN_LANE_HEIGHT);
    heldEdge = `M${x0} ${top}H${x1}`;
    heldArea = `M${x0} ${ground}L${x0} ${top}H${x1}L${x1} ${ground}Z`;
  }
  return {
    toCome: blockChartPaths(toCome, scale),
    asked: riding === undefined ? '' : outlineOf(blockChartPaths([riding], scale)),
    heldArea,
    heldEdge,
    done: outlineOf(blockChartPaths(before, scale)),
    replaced: outlineOf(blockChartPaths(replaced, scale)),
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
 * floor and a ceiling, and each of the two as an open line of its own. A step
 * holds its value until the next sample, which is what a setpoint does.
 *
 * ⚠️ A vertex is written only where the value CHANGES, so a steady target is
 * one line and not three hundred collinear pieces: a dashed stroke over the
 * pieces rendered as a solid one.
 *
 * ⚠️ Where a run ENDS: at the next sample, the one with no value, when a gap
 * closes it — the trainer held the step until then — and at its own last
 * sample when it is the newest, because nothing is known after that.
 */
function steps(
  samples: readonly WorkoutTraceSample[],
  ceiling: (sample: WorkoutTraceSample) => number | undefined,
  floor: (sample: WorkoutTraceSample) => number,
  x: (at: number) => number,
): { readonly area: string; readonly edge: string; readonly floorEdge: string } {
  let area = '';
  let edge = '';
  let floorEdge = '';
  let run: WorkoutTraceSample[] = [];
  /** A stepped line through the run as vertices, left to right. */
  const vertices = (
    value: (sample: WorkoutTraceSample) => number,
    until: number,
  ): readonly (readonly [string, string])[] => {
    const out: (readonly [string, string])[] = [];
    let level: string | undefined;
    for (const sample of run) {
      const here = coordinate(value(sample));
      if (level === undefined) {
        out.push([coordinate(x(sample.at)), here]);
      } else if (here !== level) {
        out.push([coordinate(x(sample.at)), level], [coordinate(x(sample.at)), here]);
      }
      level = here;
    }
    if (level !== undefined) out.push([coordinate(x(until)), level]);
    return out;
  };
  const line = (points: readonly (readonly [string, string])[]): string =>
    points.map(([px, py], index) => `${index === 0 ? 'M' : 'L'}${px} ${py}`).join('');
  const close = (until: number): void => {
    if (run.length === 0) return;
    const top = vertices((sample) => ceiling(sample) ?? 0, until);
    const bottom = vertices(floor, until);
    edge += line(top);
    floorEdge += line(bottom);
    area += `${line(top)}${[...bottom]
      .reverse()
      .map(([px, py]) => `L${px} ${py}`)
      .join('')}Z`;
    run = [];
  };
  samples.forEach((sample, index) => {
    if (finite(ceiling(sample))) {
      run.push(sample);
    } else {
      close(sample.at);
    }
    if (index === samples.length - 1) {
      close(sample.at);
    }
  });
  return { area, edge, floorEdge };
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
 * The two ends are written on the lane, in watts, so the fitted scale can be
 * read; they are drawn {@link TRACE_LANE_INSET} in from its edges.
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
  // What must be added either side to reach the least span, and a little
  // more so nothing sits on a scale end. A window that already spans more —
  // intervals — gets only the little more, and uses the lane.
  const span = Math.max(
    highest - lowest,
    highest * TRACE_MINIMUM_SPAN_SHARE,
    TRACE_MINIMUM_SPAN_WATTS,
  );
  const room = (span - (highest - lowest)) / 2 + span * TRACE_BREATHING_SHARE;
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
    TRACE_LANE_INSET -
    ((Math.max(bottomWatts, watts) - bottomWatts) / (topWatts - bottomWatts)) *
      (TRACE_LANE_HEIGHT - 2 * TRACE_LANE_INSET);
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
  const newest = ranged.at(-1)?.range ?? { low: 0, high: 0 };
  return {
    range: band.area,
    rangeEdges: band.edge + band.floorEdge,
    line: brokenLine(samples, (sample) => sample.heartRate, x, y),
    low: newest.low,
    high: newest.high,
    highAt: y(newest.high) / HEART_RATE_LANE_HEIGHT,
    lowAt: y(newest.low) / HEART_RATE_LANE_HEIGHT,
  };
}

/** Everything the Ride screen's graph draws, as path data: one drawing a lane. */
export function workoutGraphPaths(input: WorkoutGraphInput): WorkoutGraphPaths {
  const samples = windowed(input);
  return {
    plan: planLane(input),
    heartRate: heartRateLane(samples, input.elapsedSeconds),
    trace: traceLane(samples, input.elapsedSeconds),
  };
}

/** The HUD strip's bar of how far through the workout the rider is. */
export const STRIP_PROGRESS_HEIGHT = 10;

/** How far the strip's now mark stands out above and below its bar, in drawing units. */
const STRIP_NOW_OVERHANG = 4;

/** The HUD's strip — one lane and a bar. @see the module note */
export interface WorkoutStripPaths {
  /**
   * `heart-rate` while a heart-rate hold is running NOW (the newest sample
   * carries a range): the range's outline and heart rate. `power` otherwise:
   * the confirmed target's stepped edge and the rider's power.
   */
  readonly lane:
    | { readonly kind: 'power'; readonly target: string; readonly power: string }
    | { readonly kind: 'heart-rate'; readonly range: string; readonly heartRate: string };
  /** The lane's height, in its own drawing units. */
  readonly laneHeight: number;
  readonly progress: {
    /** The part ridden, as a closed bar from the start to now. Empty at the start. */
    readonly done: string;
    readonly now: string;
    readonly nowFraction: number;
  };
}

/** What the HUD's strip draws. */
export function workoutStripPaths(input: WorkoutGraphInput): WorkoutStripPaths {
  const samples = windowed(input);
  const total = input.timeline.totalSeconds;
  const elapsed = Math.min(Math.max(0, input.elapsedSeconds), Math.max(0, total));
  const fraction = total > 0 && Number.isFinite(elapsed / total) ? elapsed / total : 0;
  const x = coordinate(fraction * CHART_WIDTH);
  const heartRate =
    samples.at(-1)?.range === undefined ? undefined : heartRateLane(samples, input.elapsedSeconds);
  const trace = heartRate === undefined ? traceLane(samples, input.elapsedSeconds) : undefined;
  return {
    lane:
      heartRate !== undefined
        ? { kind: 'heart-rate', range: heartRate.rangeEdges, heartRate: heartRate.line }
        : { kind: 'power', target: trace?.targetEdge ?? '', power: trace?.power ?? '' },
    laneHeight: heartRate !== undefined ? HEART_RATE_LANE_HEIGHT : TRACE_LANE_HEIGHT,
    progress: {
      done: fraction > 0 ? `M0 0H${x}V${coordinate(STRIP_PROGRESS_HEIGHT)}H0Z` : '',
      now: `M${x} ${coordinate(-STRIP_NOW_OVERHANG)}V${coordinate(
        STRIP_PROGRESS_HEIGHT + STRIP_NOW_OVERHANG,
      )}`,
      nowFraction: fraction,
    },
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
export const GRAPH_KEY_REPLACED = 'The dotted outline is the plan before it was changed.';

/**
 * The key's sentence for the two shapes drawn at the now line while the
 * trainer holds something the plan did not ask — the key names every mark
 * that is drawn. At 0 W there is no step to shade, and the sentence says so
 * rather than pointing at a shape that is not there.
 */
export function graphKeyHeld(held: {
  readonly heldWatts: number;
  readonly plannedWatts: number;
}): string {
  const asked = `At the line, the dashed outline is what the plan asks for now, ${String(
    held.plannedWatts,
  )} W.`;
  return held.heldWatts > 0
    ? `${asked} The shaded step is what the trainer confirmed instead, ${String(held.heldWatts)} W.`
    : `${asked} The trainer confirmed ${String(held.heldWatts)} W instead, so nothing is shaded.`;
}

/** Everything the key says for a workout, in order. */
export function workoutGraphKey(input: WorkoutGraphInput): string {
  const held = heldInstead(input);
  const hold = windowed(input).some((sample) => sample.range !== undefined);
  return [
    GRAPH_KEY_PLAN,
    ...(held === undefined ? [] : [graphKeyHeld(held)]),
    ...((input.replaced ?? []).length > 0 ? [GRAPH_KEY_REPLACED] : []),
    ...(hold ? [GRAPH_KEY_HEART_RATE] : []),
    GRAPH_KEY_TRACE,
  ].join(' ');
}

/** The newest sample the graph may read: inside the window and no later than now. */
function newest(input: WorkoutGraphInput): WorkoutTraceSample | undefined {
  return windowed(input).at(-1);
}

/** How long is left of the block being ridden, as a clock, or `undefined` outside one. */
function leftInBlock(input: WorkoutGraphInput): string | undefined {
  const segment = segmentNow(input.timeline.segments, input.elapsedSeconds);
  return segment === undefined
    ? undefined
    : formatDuration(Math.ceil(segment.endsAt - input.elapsedSeconds));
}

/** A lane's caption: what the lane is, and the numbers that matter in it now. */
export interface LaneLabel {
  readonly title: string;
  readonly reading: string;
}

export const GRAPH_TITLE_PLAN = 'Whole workout';
export const GRAPH_TITLE_HEART_RATE = 'Heart rate';
export const GRAPH_TITLE_TRACE = 'Last 5 minutes';

/**
 * The numbers written on the Ride screen's graph, lane by lane — #1307's
 * second pass: a graph with no number on it could not be read against
 * anything.
 *
 * ⚠️ The target is the one the newest SAMPLE carries — confirmed, and with
 * control (`ride/controller.ts` §`sampleForGraph`) — so a trainer the app has
 * lost says "No target" here, as its lane breaks, rather than the last write.
 */
export function workoutGraphLabels(input: WorkoutGraphInput): {
  readonly plan: LaneLabel;
  readonly heartRate: LaneLabel | undefined;
  readonly trace: LaneLabel;
} {
  const last = newest(input);
  const held = heldInstead(input);
  const hold = windowed(input).some((sample) => sample.range !== undefined);
  const target = finite(last?.target)
    ? `Target ${String(last.target)} W` +
      (held === undefined ? '' : ` (plan asks ${String(held.plannedWatts)} W)`)
    : 'No target';
  const power = finite(last?.power)
    ? `You ${String(Math.round(last.power))} W`
    : 'No power reading';
  return {
    plan: {
      title: GRAPH_TITLE_PLAN,
      reading: `${formatDuration(input.elapsedSeconds)} of ${formatDuration(
        input.timeline.totalSeconds,
      )}`,
    },
    heartRate: !hold
      ? undefined
      : {
          title: GRAPH_TITLE_HEART_RATE,
          reading: finite(last?.heartRate)
            ? `${String(Math.round(last.heartRate))} bpm`
            : 'No reading',
        },
    trace: { title: GRAPH_TITLE_TRACE, reading: `${target} · ${power}` },
  };
}

/**
 * The HUD strip's one line: the numbers that matter for the lane it drew. In
 * a heart-rate hold, heart rate and the range; otherwise the confirmed target
 * and how long is left of the block.
 */
export function workoutStripText(input: WorkoutGraphInput): string {
  const last = newest(input);
  if (last?.range !== undefined) {
    const range = `range ${String(last.range.low)}–${String(last.range.high)}`;
    return finite(last.heartRate)
      ? `${String(Math.round(last.heartRate))} bpm, ${range}`
      : `No heart rate, ${range}`;
  }
  const target = finite(last?.target) ? `Target ${String(last.target)} W` : 'No target';
  const left = leftInBlock(input);
  return left === undefined ? target : `${target} · ${left} left in block`;
}

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
  const left = leftInBlock(input);
  if (left !== undefined) {
    parts.push(`${left} left in this block.`);
  }
  const held = heldInstead(input);
  if (finite(input.holdingWatts)) {
    parts.push(
      held === undefined
        ? `Target the trainer last confirmed: ${String(input.holdingWatts)} W.`
        : `Target the trainer last confirmed: ${String(held.heldWatts)} W, where the plan asks ` +
            `for ${String(held.plannedWatts)} W.`,
    );
  }
  const last = newest(input);
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
    parts.push(GRAPH_KEY_REPLACED);
  }
  return parts.join(' ');
}
