// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, type JSX } from 'react';

import { RenderBoundary } from '../design/ChartSlot';
import { BAND_TOKENS, type ColourToken } from '../design/tokens';
import { CHART_WIDTH } from '../workouts/block-chart';

import {
  HEART_RATE_LANE_HEIGHT,
  PLAN_LANE_HEIGHT,
  STRIP_PROGRESS_HEIGHT,
  TRACE_LANE_HEIGHT,
  workoutGraphKey,
  workoutGraphLabels,
  workoutGraphPaths,
  workoutGraphText,
  workoutStripPaths,
  workoutStripName,
  workoutStripText,
  type LaneLabel,
  type WorkoutGraphInput,
} from './workout-graph';

/**
 * The class each part of the Ride screen's graph is painted by, and the token
 * it paints with — #1307. `theme.css` §"THE RUNNING WORKOUT'S GRAPH" is the
 * same table as rules, and `WorkoutGraph.test.tsx` holds the two together in
 * both directions, so no part of the graph names a colour of its own. The
 * bands and a free ride are `BlockChart.tsx`'s classes, used as they are.
 *
 * Every token is one `tokens.ts` §CONTRAST_REQUIREMENTS pairs with `surface`,
 * which is the well the graph paints for itself, or with `surfaceRaised`
 * where a mark crosses a shaded step.
 */
export const WORKOUT_GRAPH_PAINTS: readonly {
  readonly className: string;
  readonly token: ColourToken;
  readonly property: 'fill' | 'stroke';
}[] = [
  { className: 'oyl-workout-graph__done', token: 'inkMuted', property: 'stroke' },
  { className: 'oyl-workout-graph__replaced', token: 'inkMuted', property: 'stroke' },
  { className: 'oyl-workout-graph__asked', token: 'inkMuted', property: 'stroke' },
  { className: 'oyl-workout-graph__held', token: 'surfaceRaised', property: 'fill' },
  { className: 'oyl-workout-graph__held-edge', token: 'ink', property: 'stroke' },
  { className: 'oyl-workout-graph__now', token: 'ink', property: 'stroke' },
  { className: 'oyl-workout-graph__now-cap', token: 'ink', property: 'fill' },
  { className: 'oyl-workout-graph__range', token: 'surfaceRaised', property: 'fill' },
  { className: 'oyl-workout-graph__range-edge', token: 'inkMuted', property: 'stroke' },
  { className: 'oyl-workout-graph__heart-rate', token: 'ink', property: 'stroke' },
  { className: 'oyl-workout-graph__target', token: 'surfaceRaised', property: 'fill' },
  { className: 'oyl-workout-graph__target-edge', token: 'ink', property: 'stroke' },
  { className: 'oyl-workout-graph__power', token: 'accent', property: 'stroke' },
];

/**
 * The HUD strip's table, for the same reason. ⚠️ **The HUD's own tokens, on
 * the HUD panel's own surface**: the strip paints no well. The first pass
 * painted the page's light `surface`, which made a near-white box the
 * brightest thing in a dark corner of the ride. Every token here is a pair
 * `tokens.ts` already holds against `hudSurface`, and no mark is drawn over
 * another's fill — nothing on the strip is a filled area a line crosses.
 *
 * Not colour alone (SC 1.4.1): what is ASKED — the target, the range — is
 * dashed, and what the rider is doing is a solid line; the bar's ridden part
 * is filled and the rest is an outline.
 */
export const WORKOUT_STRIP_PAINTS: readonly {
  readonly className: string;
  readonly token: ColourToken;
  readonly property: 'fill' | 'stroke';
}[] = [
  { className: 'oyl-workout-strip__target', token: 'hudInkMuted', property: 'stroke' },
  { className: 'oyl-workout-strip__power', token: 'hudInk', property: 'stroke' },
  { className: 'oyl-workout-strip__range', token: 'hudInkMuted', property: 'stroke' },
  { className: 'oyl-workout-strip__heart-rate', token: 'hudInk', property: 'stroke' },
  { className: 'oyl-workout-strip__track', token: 'hudBorder', property: 'stroke' },
  { className: 'oyl-workout-strip__done', token: 'hudInkMuted', property: 'fill' },
  { className: 'oyl-workout-strip__now', token: 'hudInk', property: 'stroke' },
];

/** `bandVo2` → `oyl-block-chart__band-vo2`: `BlockChart.tsx`'s rule. */
function bandClass(token: string): string {
  return `oyl-block-chart__${token.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

export interface WorkoutGraphProps {
  readonly workout: WorkoutGraphInput;
}

/**
 * A running workout drawn on the Ride screen — #1307. `workout-graph.ts` is
 * the geometry, the numbers and the sentences, and says why each part is
 * drawn the way it is.
 *
 * ⚠️ **An image with a name, not decoration**: `role="img"` and the sentence
 * that says what it shows, on the frame that holds every lane. The numbers
 * written on the lanes are inside that image and hidden with its marks —
 * the name says each of them. The sentences the panel already carries stay
 * where they are; this repeats their numbers and replaces none.
 *
 * ⚠️ **The numbers are HTML above and beside each drawing, never SVG text**:
 * each lane's drawing is stretched to its box (`preserveAspectRatio="none"`),
 * and text inside it would be stretched with it. A scale's numbers stand in
 * a gutter to the drawing's left, the same width on every lane, so no number
 * covers a mark and the two five-minute lanes share one time axis.
 *
 * ⚠️ **A graph that throws draws nothing and takes nothing with it**
 * (`RenderBoundary`): it sits on the screen that holds *End workout*.
 */
export function WorkoutGraph(props: WorkoutGraphProps): JSX.Element {
  return (
    <RenderBoundary fallback={null}>
      <Drawn {...props} />
    </RenderBoundary>
  );
}

/** The game HUD's compact strip — #1307. @see WORKOUT_STRIP_PAINTS */
export function WorkoutStrip(props: WorkoutGraphProps): JSX.Element {
  return (
    <RenderBoundary fallback={null}>
      <Strip {...props} />
    </RenderBoundary>
  );
}

const optional = (className: string, d: string): JSX.Element | null =>
  d === '' ? null : <path className={className} d={d} />;

function Caption({ label }: { readonly label: LaneLabel }): JSX.Element {
  return (
    <p className="oyl-workout-graph__caption">
      <span>{label.title}</span>
      <span className="oyl-workout-graph__reading">{label.reading}</span>
    </p>
  );
}

function laneSvg(
  lane: 'plan' | 'heart-rate' | 'trace',
  height: number,
): {
  readonly className: string;
  readonly focusable: 'false';
  readonly preserveAspectRatio: 'none';
  readonly viewBox: string;
} {
  return {
    className: `oyl-workout-graph__svg oyl-workout-graph__svg--${lane}`,
    focusable: 'false',
    preserveAspectRatio: 'none',
    viewBox: `0 0 ${String(CHART_WIDTH)} ${String(height)}`,
  };
}

function Drawn({ workout }: WorkoutGraphProps): JSX.Element {
  const paths = useMemo(() => workoutGraphPaths(workout), [workout]);
  const text = useMemo(() => workoutGraphText(workout), [workout]);
  const labels = useMemo(() => workoutGraphLabels(workout), [workout]);
  const key = useMemo(() => workoutGraphKey(workout), [workout]);
  const { plan, heartRate, trace } = paths;
  return (
    <div className="oyl-workout-graph" data-oyl-workout-graph="panel">
      <div role="img" aria-label={text} className="oyl-workout-graph__frame">
        <div aria-hidden="true" className="oyl-workout-graph__lanes">
          <div className="oyl-workout-graph__lane" data-oyl-lane="plan">
            <Caption label={labels.plan} />
            <div className="oyl-workout-graph__well">
              <svg {...laneSvg('plan', PLAN_LANE_HEIGHT)}>
                {optional('oyl-workout-graph__replaced', plan.replaced)}
                {plan.toCome.bands.map((d, band) =>
                  d === '' ? null : (
                    <path
                      key={band}
                      className={bandClass(BAND_TOKENS[band] ?? 'bandRecovery')}
                      d={d}
                    />
                  ),
                )}
                {optional('oyl-block-chart__free-ride', plan.toCome.freeRide)}
                {optional('oyl-workout-graph__held', plan.heldArea)}
                {optional('oyl-workout-graph__held-edge', plan.heldEdge)}
                {optional('oyl-workout-graph__asked', plan.asked)}
                {optional('oyl-workout-graph__done', plan.done)}
                <path
                  className="oyl-workout-graph__now"
                  d={plan.now}
                  data-fraction={plan.nowFraction.toFixed(4)}
                />
                <path className="oyl-workout-graph__now-cap" d={plan.nowCap} />
              </svg>
            </div>
          </div>
          {heartRate === undefined || labels.heartRate === undefined ? null : (
            <div className="oyl-workout-graph__lane" data-oyl-lane="heart-rate">
              <Caption label={labels.heartRate} />
              <div className="oyl-workout-graph__well">
                <svg {...laneSvg('heart-rate', HEART_RATE_LANE_HEIGHT)}>
                  {optional('oyl-workout-graph__range', heartRate.range)}
                  {optional('oyl-workout-graph__range-edge', heartRate.rangeEdges)}
                  {optional('oyl-workout-graph__heart-rate', heartRate.line)}
                </svg>
                {/* The range's two edges, in beats per minute, each beside its
                    own dashed line. A position, not a paint. */}
                <span
                  className="oyl-workout-graph__scale oyl-workout-graph__scale--edge"
                  style={{ top: `${(heartRate.highAt * 100).toFixed(2)}%` }}
                >
                  {String(heartRate.high)}
                </span>
                <span
                  className="oyl-workout-graph__scale oyl-workout-graph__scale--edge"
                  style={{ top: `${(heartRate.lowAt * 100).toFixed(2)}%` }}
                >
                  {String(heartRate.low)}
                </span>
              </div>
            </div>
          )}
          <div className="oyl-workout-graph__lane" data-oyl-lane="trace">
            <Caption label={labels.trace} />
            <div className="oyl-workout-graph__well">
              <svg {...laneSvg('trace', TRACE_LANE_HEIGHT)}>
                {optional('oyl-workout-graph__target', trace.targetArea)}
                {optional('oyl-workout-graph__target-edge', trace.targetEdge)}
                {optional('oyl-workout-graph__power', trace.power)}
              </svg>
              <span className="oyl-workout-graph__scale oyl-workout-graph__scale--top">
                {String(trace.topWatts)} W
              </span>
              <span className="oyl-workout-graph__scale oyl-workout-graph__scale--bottom">
                {String(trace.bottomWatts)} W
              </span>
            </div>
          </div>
        </div>
      </div>
      {key === '' ? null : <p className="oyl-muted oyl-workout-graph__key">{key}</p>}
    </div>
  );
}

function Strip({ workout }: WorkoutGraphProps): JSX.Element {
  const paths = useMemo(() => workoutStripPaths(workout), [workout]);
  // ⚠️ Named WITHOUT what a re-plan replaced (#1244's review). The strip is
  // the last five minutes and a progress bar and draws no outline, and
  // `workoutGraphText` ends "The dotted outline is the plan before it was
  // changed." whenever it is handed one: a name describing a picture that
  // is not there, from the first accepted move to the end of the workout.
  const name = useMemo(() => workoutStripName(workout), [workout]);
  const text = useMemo(() => workoutStripText(workout), [workout]);
  const { lane, progress } = paths;
  return (
    <div
      role="img"
      aria-label={name}
      // `oyl-hud__plan-svg` is the route plan's own sizing rule: the strip
      // takes its place and its size, so the panel is the height it was (#1169).
      className="oyl-workout-strip oyl-hud__plan-svg"
      data-oyl-workout-graph="hud"
      data-oyl-lane={lane.kind}
    >
      <svg
        aria-hidden="true"
        className="oyl-workout-strip__lane"
        focusable="false"
        preserveAspectRatio="none"
        viewBox={`0 0 ${String(CHART_WIDTH)} ${String(paths.laneHeight)}`}
      >
        {lane.kind === 'power' ? (
          <>
            {optional('oyl-workout-strip__target', lane.target)}
            {optional('oyl-workout-strip__power', lane.power)}
          </>
        ) : (
          <>
            {optional('oyl-workout-strip__range', lane.range)}
            {optional('oyl-workout-strip__heart-rate', lane.heartRate)}
          </>
        )}
      </svg>
      <svg
        aria-hidden="true"
        className="oyl-workout-strip__progress"
        focusable="false"
        preserveAspectRatio="none"
        viewBox={`0 0 ${String(CHART_WIDTH)} ${String(STRIP_PROGRESS_HEIGHT)}`}
      >
        <path
          className="oyl-workout-strip__track"
          d={`M0 0H${String(CHART_WIDTH)}V${String(STRIP_PROGRESS_HEIGHT)}H0Z`}
        />
        {optional('oyl-workout-strip__done', progress.done)}
        <path
          className="oyl-workout-strip__now"
          d={progress.now}
          data-fraction={progress.nowFraction.toFixed(4)}
        />
      </svg>
      <p aria-hidden="true" className="oyl-workout-strip__text">
        {text}
      </p>
    </div>
  );
}
