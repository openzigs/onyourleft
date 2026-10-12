// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, type JSX } from 'react';

import { RenderBoundary } from '../design/ChartSlot';
import { BAND_TOKENS, type ColourToken } from '../design/tokens';
import { CHART_WIDTH } from '../workouts/block-chart';

import {
  GRAPH_KEY_HEART_RATE,
  GRAPH_KEY_PLAN,
  GRAPH_KEY_TRACE,
  workoutGraphPaths,
  workoutGraphText,
  type WorkoutGraphInput,
} from './workout-graph';

/**
 * The class each part of the graph is painted by, and the token it paints
 * with — #1307. `theme.css` §"THE RUNNING WORKOUT'S GRAPH" is the same table
 * as rules, and `WorkoutGraph.test.tsx` holds the two together in both
 * directions, so no part of the graph names a colour of its own. The bands
 * and the threshold rule are `BlockChart.tsx`'s classes, used as they are.
 *
 * Every token is one `tokens.ts` §CONTRAST_REQUIREMENTS pairs with `surface`,
 * which is the well the graph paints for itself — on the Ride screen and on
 * the HUD alike, where `.oyl-hud` restates the page tokens (#672).
 */
export const WORKOUT_GRAPH_PAINTS: readonly {
  readonly className: string;
  readonly token: ColourToken;
  readonly property: 'fill' | 'stroke';
}[] = [
  { className: 'oyl-workout-graph__done', token: 'inkMuted', property: 'stroke' },
  { className: 'oyl-workout-graph__replaced', token: 'inkMuted', property: 'stroke' },
  { className: 'oyl-workout-graph__now', token: 'ink', property: 'stroke' },
  { className: 'oyl-workout-graph__now-cap', token: 'ink', property: 'fill' },
  { className: 'oyl-workout-graph__range', token: 'surfaceRaised', property: 'fill' },
  { className: 'oyl-workout-graph__range-edge', token: 'inkMuted', property: 'stroke' },
  { className: 'oyl-workout-graph__heart-rate', token: 'ink', property: 'stroke' },
  { className: 'oyl-workout-graph__target', token: 'surfaceRaised', property: 'fill' },
  { className: 'oyl-workout-graph__target-edge', token: 'ink', property: 'stroke' },
  { className: 'oyl-workout-graph__power', token: 'accent', property: 'stroke' },
];

/** `bandVo2` → `oyl-block-chart__band-vo2`: `BlockChart.tsx`'s rule. */
function bandClass(token: string): string {
  return `oyl-block-chart__${token.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

export interface WorkoutGraphProps {
  readonly workout: WorkoutGraphInput;
  /**
   * `hud`: the game's compact strip — no key under it, and sized by the HUD's
   * own route-plan rules (`oyl-hud__plan-svg`), whose place it takes, so the
   * panel it sits in is the height it was (#1169).
   */
  readonly variant?: 'panel' | 'hud' | undefined;
}

/**
 * A running workout drawn — #1307. `workout-graph.ts` is the geometry and the
 * sentence, and says why each part is drawn the way it is.
 *
 * ⚠️ **An image with a name, not decoration**: `role="img"` and the sentence
 * that says what it shows. The sentences the panel and the HUD already carry
 * stay where they are; this repeats their numbers and replaces none.
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

function Drawn({ workout, variant = 'panel' }: WorkoutGraphProps): JSX.Element {
  const paths = useMemo(() => workoutGraphPaths(workout), [workout]);
  const text = useMemo(() => workoutGraphText(workout), [workout]);
  const { plan, heartRate, trace } = paths;
  const optional = (className: string, d: string): JSX.Element | null =>
    d === '' ? null : <path className={className} d={d} />;
  return (
    <div className="oyl-workout-graph" data-oyl-workout-graph={variant}>
      <svg
        role="img"
        aria-label={text}
        className={
          variant === 'hud'
            ? 'oyl-workout-graph__svg oyl-hud__plan-svg'
            : 'oyl-workout-graph__svg oyl-workout-graph__svg--panel'
        }
        focusable="false"
        preserveAspectRatio="none"
        viewBox={`0 0 ${String(CHART_WIDTH)} ${String(paths.height)}`}
      >
        <g aria-hidden="true">
          {optional('oyl-workout-graph__replaced', plan.replaced)}
          {plan.toCome.bands.map((d, band) =>
            d === '' ? null : (
              <path key={band} className={bandClass(BAND_TOKENS[band] ?? 'bandRecovery')} d={d} />
            ),
          )}
          {optional('oyl-block-chart__free-ride', plan.toCome.freeRide)}
          {optional('oyl-workout-graph__done', plan.done)}
          {optional('oyl-block-chart__rule', plan.rule)}
          <path
            className="oyl-workout-graph__now"
            d={plan.now}
            data-fraction={plan.nowFraction.toFixed(4)}
          />
          <path className="oyl-workout-graph__now-cap" d={plan.nowCap} />
        </g>
        {heartRate === undefined ? null : (
          <g aria-hidden="true" transform={`translate(0 ${String(paths.heartRateTop)})`}>
            {optional('oyl-workout-graph__range', heartRate.range)}
            {optional('oyl-workout-graph__range-edge', heartRate.range)}
            {optional('oyl-workout-graph__heart-rate', heartRate.line)}
          </g>
        )}
        <g aria-hidden="true" transform={`translate(0 ${String(paths.traceTop)})`}>
          {optional('oyl-workout-graph__target', trace.targetArea)}
          {optional('oyl-workout-graph__target-edge', trace.targetEdge)}
          {optional('oyl-workout-graph__power', trace.power)}
        </g>
      </svg>
      {variant === 'hud' ? null : (
        <p className="oyl-muted oyl-workout-graph__key">
          {GRAPH_KEY_PLAN} {heartRate === undefined ? '' : `${GRAPH_KEY_HEART_RATE} `}
          {GRAPH_KEY_TRACE}
        </p>
      )}
    </div>
  );
}
