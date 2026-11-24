// SPDX-License-Identifier: Apache-2.0

/**
 * A road's heights across a bridge or a tunnel — #2013, ADR 0087 D-4.3.
 *
 * A terrain model knows the ground and nothing built on it. Sampled along a
 * road it puts a bridge's deck on the valley floor and a tunnel on the ridge
 * above it, so a rider would be sent down a valley side and up the other where
 * the road is level. Where the map marks a stretch of road as a bridge or a
 * tunnel, the road's height across it is **linear between the heights at its
 * two ends**, which are on the ground: the deck, or the bore, and not the
 * terrain under or over it.
 *
 * This is the arithmetic and nothing else. Which stretches are spans is the
 * caller's knowledge: the open-world street graph's own flags (#2899), or a
 * routing engine's legs. A drawn freehand line follows no mapped road, so it
 * has none.
 */

import { altitudeMetres, type AltitudeMetres, type Metres } from '../quantities';

/** A stretch of road on a bridge or in a tunnel, as distances along the road. */
export interface RoadSpan {
  /** Where the span starts: the last point on the ground before it. */
  readonly from: Metres;
  /** Where it ends: the first point on the ground after it. */
  readonly to: Metres;
}

/** Spans in order, clipped to the road and with any that overlap or touch joined. */
function joined(spans: readonly RoadSpan[], length: number): { from: number; to: number }[] {
  const clipped = spans
    .map((span): { from: number; to: number } => ({
      from: span.from,
      to: Math.min(length, span.to),
    }))
    .filter((span) => span.to > span.from)
    .sort((a, b) => a.from - b.from);
  const out: { from: number; to: number }[] = [];
  for (const span of clipped) {
    const last = out.at(-1);
    if (last !== undefined && span.from <= last.to) {
      last.to = Math.max(last.to, span.to);
    } else {
      out.push({ ...span });
    }
  }
  return out;
}

/**
 * `heights`, with every sample strictly inside a span replaced by the straight
 * line between the ground's heights either side of it.
 *
 * `heights[i]` is the ground at `i × interval` along the road, `undefined`
 * where the terrain has none.
 *
 * ⚠️ **The line runs between the last sample at or before the span and the
 * first at or after it**, never between heights read at the span's own ends.
 * An end rarely falls on a sample, and the ground "at" it, read between the
 * samples either side, would be half the valley's: one of those two samples
 * is inside the span. So a span is widened to the samples that enclose it, by
 * less than one interval at each end.
 *
 * ⚠️ **A span with an end the terrain has no height for is left unknown, not
 * guessed.** Its inside samples become `undefined`: the terrain there is the
 * valley floor, which is the one height the road is known not to have.
 *
 * A span that runs past the road's end is clipped to it, so a road that ends
 * on a bridge takes its last sample as the deck's.
 * Spans that overlap or touch are one span.
 */
export function heightsAcrossSpans(
  heights: readonly (AltitudeMetres | undefined)[],
  interval: Metres,
  spans: readonly RoadSpan[],
): (AltitudeMetres | undefined)[] {
  const out = [...heights];
  if (heights.length < 2 || !(interval > 0)) return out;
  const last = heights.length - 1;
  for (const span of joined(spans, last * interval)) {
    const before = Math.min(last, Math.floor(span.from / interval));
    const after = Math.min(last, Math.ceil(span.to / interval));
    const start = heights[before];
    const end = heights[after];
    for (let index = before + 1; index < after; index += 1) {
      out[index] =
        start === undefined || end === undefined
          ? undefined
          : altitudeMetres(start + ((end - start) * (index - before)) / (after - before));
    }
  }
  return out;
}
