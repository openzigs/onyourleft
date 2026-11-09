// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The last ten minutes of power and heart rate, drawn — #2078.
 *
 * Hand-drawn SVG, as `detail/TraceChart.tsx` and every other chart here is
 * (ADR 0063 D-6: no chart library, and canvas is opaque to a screen reader).
 * The newest second is the right-hand edge and the oldest held the left; a ride
 * younger than the window fills it from the right.
 *
 * - **Power** is the solid ink line, over **its zones as background bands** —
 *   the rider's own threshold's seven, in #2039's colours dimmed onto the
 *   panel (`hudZoneBand*`), so where the line sits says which zone it was in.
 *   With no threshold set there are no bands: a zone of a threshold the rider
 *   never set is a guess (#2077's rule).
 * - **Heart rate** is a DASHED line in the label's colour on its own scale, so
 *   the two are told apart by their pattern as well as their colour.
 * - **A gap is a gap**: one path per unbroken run of readings, never one path
 *   that skips across a dropout, so a sensor that dropped is a break in the
 *   line and never a drawn zero (`recent-trace.ts`).
 *
 * `aria-hidden`, and never the only carrier: power and heart rate are readings
 * on the HUD as numbers, and their zones are the zone indicator's words.
 *
 * ⚠️ **Memoised on the trace's `written` count and the threshold**, so it is
 * redrawn when a second is written and at no other render: the HUD renders
 * every frame, and the graph changes at most once a second (#2078's second
 * criterion). `data-oyl-graph-written` publishes which second it drew.
 */

import { memo, type JSX } from 'react';

import { POWER_ZONE_LOWER_FRACTIONS, type Watts } from '@onyourleft/domain';

import { RECENT_TRACE_SECONDS, type TraceSample } from './recent-trace';

/** The drawing's own units: one per second across, and a hundred up. */
const HEIGHT = 100;

/** Where heart rate's scale starts and ends, in beats per minute. */
const HEART_RATE_FLOOR = 60;
const HEART_RATE_CEILING = 200;

/** How far above threshold the power scale reaches at least: zone 7's floor and some. */
const POWER_HEADROOM = 1.6;

/** The least the power scale reaches with no threshold, in watts. */
const POWER_FLOOR_SCALE = 300;

export interface RecentGraphProps {
  /** The held seconds, oldest first. @see RecentTrace.read */
  readonly samples: readonly TraceSample[];
  /** How many seconds have been written all told: what the memo keys on. */
  readonly written: number;
  /** The rider's own threshold power, or `undefined`: no bands. */
  readonly threshold: Watts | undefined;
}

/** The top of the power scale: the threshold's headroom, or the peak, whichever is higher. */
export function powerScaleTop(
  samples: readonly TraceSample[],
  threshold: Watts | undefined,
): number {
  let peak = 0;
  for (const sample of samples) {
    if (sample.power !== undefined && sample.power > peak) peak = sample.power;
  }
  const floor = threshold === undefined ? POWER_FLOOR_SCALE : threshold * POWER_HEADROOM;
  return Math.max(floor, peak);
}

/**
 * One SVG path `d` per unbroken run of readings — `M` to start each run, `L`
 * within it. An isolated reading is a zero-length run, drawn as a dot by the
 * line's round cap. Exported so the gap rule is tested on the string itself.
 */
export function runsOf(
  values: readonly (number | undefined)[],
  offset: number,
  yOf: (value: number) => number,
): readonly string[] {
  const runs: string[] = [];
  let current = '';
  values.forEach((value, index) => {
    if (value === undefined) {
      if (current !== '') runs.push(current);
      current = '';
      return;
    }
    const x = (offset + index).toFixed(1);
    const y = yOf(value).toFixed(2);
    current = current === '' ? `M${x} ${y} L${x} ${y}` : `${current} L${x} ${y}`;
  });
  if (current !== '') runs.push(current);
  return runs;
}

function Graph(props: RecentGraphProps): JSX.Element {
  const { samples, threshold } = props;
  const top = powerScaleTop(samples, threshold);
  const powerY = (watts: number): number => HEIGHT - (Math.min(watts, top) / top) * HEIGHT;
  const heartY = (bpm: number): number =>
    HEIGHT -
    ((Math.min(Math.max(bpm, HEART_RATE_FLOOR), HEART_RATE_CEILING) - HEART_RATE_FLOOR) /
      (HEART_RATE_CEILING - HEART_RATE_FLOOR)) *
      HEIGHT;
  // Right-aligned: the newest second is the right-hand edge.
  const offset = RECENT_TRACE_SECONDS - samples.length;
  const bands =
    threshold === undefined
      ? []
      : POWER_ZONE_LOWER_FRACTIONS.map((fraction, index) => {
          const lower = fraction * threshold;
          const upperFraction = POWER_ZONE_LOWER_FRACTIONS[index + 1];
          const upper = upperFraction === undefined ? top : upperFraction * threshold;
          return { zone: index + 1, y: powerY(Math.min(upper, top)), bottom: powerY(lower) };
        }).filter((band) => band.bottom > band.y);
  return (
    <svg
      className="oyl-hud__recent"
      viewBox={`0 0 ${String(RECENT_TRACE_SECONDS)} ${String(HEIGHT)}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      data-testid="oyl-hud-recent"
      data-oyl-graph-written={String(props.written)}
    >
      {bands.map((band) => (
        <rect
          key={band.zone}
          className={`oyl-hud__recent-band oyl-hud__recent-band--${String(band.zone)}`}
          x={0}
          y={band.y}
          width={RECENT_TRACE_SECONDS}
          height={band.bottom - band.y}
          data-zone={String(band.zone)}
        />
      ))}
      {runsOf(
        samples.map((sample) => sample.heartRate),
        offset,
        heartY,
      ).map((d, index) => (
        <path key={`h${String(index)}`} className="oyl-hud__recent-heart" d={d} />
      ))}
      {runsOf(
        samples.map((sample) => sample.power),
        offset,
        powerY,
      ).map((d, index) => (
        <path key={`p${String(index)}`} className="oyl-hud__recent-power" d={d} />
      ))}
    </svg>
  );
}

/** @see the module note on why it is memoised on `written` and the threshold alone. */
export const RecentGraph = memo(
  Graph,
  (before, after) => before.written === after.written && before.threshold === after.threshold,
);
