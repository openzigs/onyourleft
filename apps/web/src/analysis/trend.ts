// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the fitness chart says in words (#77 criterion 6).
 *
 * The criterion asks for a non-visual equivalent *"conveying the same
 * information — current values, trend direction, and recent change"*. That is
 * deliberately **not** "the same data in a table": a decade of riding is 3 650
 * rows, and a table nobody can read is not an equivalent of a picture anybody
 * can. What a reader takes from the chart in a second is three numbers, which
 * way each is going, and by how much lately — so that is what this computes,
 * and the table beside it is sampled rather than complete.
 *
 * Pure, so the wording is testable without a DOM and a mutation to it goes red.
 */

import type { FitnessPoint } from '@onyourleft/domain';

/** How far back "recent change" looks. A week — the same span a rider plans in. */
export const TREND_WINDOW_DAYS = 7;

/** Which way a number is going. Words, because this is the non-visual half. */
export type TrendDirection = 'rising' | 'falling' | 'steady';

/** One of the three numbers, as a reader receives it. */
export interface TrendReading {
  readonly label: string;
  readonly value: number;
  readonly direction: TrendDirection;
  /** Change over {@link TREND_WINDOW_DAYS}. Signed: negative is a fall. */
  readonly change: number;
}

/**
 * Below this, a change is called `steady` rather than given a direction.
 *
 * Without it every reading is "rising" or "falling", because an exponential
 * average almost never lands on exactly its previous value — and a chart that
 * reports a drift of 0.03 as a trend is a chart that cries wolf.
 */
export const STEADY_WITHIN = 0.5;

/**
 * The three readings, most recent first in the sense that they describe *now*.
 *
 * An empty series has no readings rather than three zeros: a rider with no
 * rides has no fitness to report, and "0, steady" is a claim about training
 * that did not happen.
 */
export function trendReadings(points: readonly FitnessPoint[]): readonly TrendReading[] {
  const latest = points.at(-1);
  if (latest === undefined) {
    return [];
  }
  // Clamped rather than wrapped: a history shorter than the window compares
  // against its own first day, which is the most that can honestly be said.
  const earlier = points[Math.max(0, points.length - 1 - TREND_WINDOW_DAYS)] ?? latest;
  return [
    reading('Fitness', latest.base, earlier.base),
    reading('Fatigue', latest.recent, earlier.recent),
    reading('Freshness', latest.freshness, earlier.freshness),
  ];
}

function reading(label: string, value: number, before: number): TrendReading {
  const change = value - before;
  return {
    label,
    value,
    change,
    direction: Math.abs(change) < STEADY_WITHIN ? 'steady' : change > 0 ? 'rising' : 'falling',
  };
}

/**
 * A reading as a sentence.
 *
 * ⚠️ **"Fatigue rising" is not bad news and the wording must not imply it is.**
 * Fatigue rises because the athlete trained, which is the point of training; it
 * is the *ratio* to fitness that a coach reads, and this screen does not offer
 * one. So the sentences state what moved and by how much, and say nothing about
 * whether that is good — a chart that told riders they were overtrained on the
 * strength of three numbers would be making a claim it cannot support.
 */
export function trendSentence(reading: TrendReading): string {
  const rounded = Math.round(reading.value);
  if (reading.direction === 'steady') {
    return `${reading.label} ${String(rounded)}, steady over the last week.`;
  }
  const size = Math.abs(Math.round(reading.change));
  const word = reading.direction === 'rising' ? 'up' : 'down';
  return `${reading.label} ${String(rounded)}, ${reading.direction} — ${word} ${String(size)} over the last week.`;
}

/**
 * At most this many rows in the table beside the chart.
 *
 * The same discipline as `detail/series.ts`'s `CHART_POINTS`, and for a
 * stronger reason: this table is read by a screen reader, and a decade of
 * riding at one row per day is 3 650 rows to arrow through.
 */
export const TREND_TABLE_ROWS = 26;

/**
 * Every `n`th point, ending on the last.
 *
 * **Ending on the last** rather than starting on the first: the most recent
 * value is the one a reader wants, and a naive stride drops it whenever the
 * series length is not a multiple of the stride.
 */
export function sampledPoints(
  points: readonly FitnessPoint[],
  rows: number = TREND_TABLE_ROWS,
): readonly FitnessPoint[] {
  if (points.length <= rows || rows < 1) {
    return points;
  }
  const stride = Math.ceil(points.length / rows);
  const sampled: FitnessPoint[] = [];
  for (let index = points.length - 1; index >= 0; index -= stride) {
    const point = points[index];
    if (point !== undefined) {
      sampled.push(point);
    }
  }
  return sampled.reverse();
}
