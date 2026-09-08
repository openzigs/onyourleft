// SPDX-License-Identifier: Apache-2.0

/**
 * #67's second criterion: an overlay that stays correct when the two efforts
 * have **different sample rates**, and does not silently truncate the shorter
 * series.
 */

import { describe, expect, it } from 'vitest';

import { degreesLatitude, degreesLongitude, geographicPosition, unixSeconds } from '../quantities';

import { COMPARISON_CHECKPOINTS, overlayEfforts, progressOf } from './comparison';

import type { GeographicPosition, UnixSeconds } from '../quantities';

const METRES_PER_DEGREE_LATITUDE = 111_194.9;
const ORIGIN = geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12));

function northOf(metresNorth: number): GeographicPosition {
  return geographicPosition(
    degreesLatitude(ORIGIN.latitude + metresNorth / METRES_PER_DEGREE_LATITUDE),
    degreesLongitude(ORIGIN.longitude),
  );
}

/**
 * A ride straight north covering `lengthMetres` at `speed` m/s, sampled every
 * `intervalSeconds`.
 *
 * The two knobs are independent on purpose: #67's fixture needs two efforts
 * that differ in **rate** while covering the same road, and a helper that tied
 * the two together could not produce one.
 */
function ride(
  lengthMetres: number,
  metresPerSecond: number,
  intervalSeconds: number,
  startedAt = 1_760_000_000,
): { positions: GeographicPosition[]; times: UnixSeconds[] } {
  const positions: GeographicPosition[] = [];
  const times: UnixSeconds[] = [];
  const duration = lengthMetres / metresPerSecond;
  for (let at = 0; at <= duration + 1e-9; at += intervalSeconds) {
    positions.push(northOf(at * metresPerSecond));
    times.push(unixSeconds(startedAt + at));
  }
  return { positions, times };
}

describe('one effort’s progress, at its own rate', () => {
  it('measures distance along the ride’s own path, cumulatively from the start', () => {
    const { positions, times } = ride(500, 10, 1);
    const progress = progressOf('e1', positions, times, 0, positions.length - 1);

    expect(progress.points).toHaveLength(positions.length);
    expect(progress.total).toBeCloseTo(500, 0);
    expect(progress.duration).toBeCloseTo(50, 3);
    expect(progress.points[0]?.distance).toBe(0);
    expect(progress.points[0]?.elapsed).toBe(0);
  });

  it('starts the clock at the effort’s first sample, not the ride’s', () => {
    // The span is a slice of a longer ride, so an elapsed time measured from
    // the ride's start would be wrong by however long the rider took to get
    // there — and would look plausible.
    const { positions, times } = ride(1000, 10, 1);
    const progress = progressOf('e1', positions, times, 20, 40);

    expect(progress.points[0]?.elapsed).toBe(0);
    expect(progress.duration).toBeCloseTo(20, 3);
    expect(progress.total).toBeCloseTo(200, 0);
  });

  it('reports its own sample interval, which is what says the two are not comparable', () => {
    expect(progressOf('e1', ...spread(ride(500, 10, 1))).sampleIntervalSeconds).toBeCloseTo(1, 3);
    expect(progressOf('e2', ...spread(ride(500, 10, 5))).sampleIntervalSeconds).toBeCloseTo(5, 3);
  });

  it('is empty for a span that is empty or inverted, rather than a flat line at zero', () => {
    const { positions, times } = ride(500, 10, 1);
    expect(progressOf('e1', positions, times, 5, 5).points).toEqual([]);
    expect(progressOf('e1', positions, times, 9, 4).points).toEqual([]);
    expect(progressOf('e1', [], [], 0, 0).points).toEqual([]);
  });
});

/** `progressOf`'s three positional arguments, from a `ride`. */
function spread(made: {
  positions: GeographicPosition[];
  times: UnixSeconds[];
}): [GeographicPosition[], UnixSeconds[], number, number] {
  return [made.positions, made.times, 0, made.positions.length - 1];
}

describe('the overlay across different sample rates — #67’s second criterion', () => {
  // A 1 Hz ride and a smart-recorded one over the same 500 m. The slower rider
  // also takes longer, so the two differ in count, spacing AND duration — all
  // three at once, which is what makes index-walking fail.
  const fast = progressOf('fast', ...spread(ride(500, 10, 1)));
  const slow = progressOf('slow', ...spread(ride(500, 8, 7)));

  it('the fixture really does carry two different rates', () => {
    // Asserted, because a fixture that quietly produced two 1 Hz series would
    // make every test below pass against an implementation that truncates.
    expect(fast.sampleIntervalSeconds).toBeCloseTo(1, 3);
    expect(slow.sampleIntervalSeconds).toBeGreaterThan(5);
    expect(fast.points.length).not.toBe(slow.points.length);
  });

  it('keeps BOTH series whole — neither is cut to the other’s length', () => {
    // The truncation the criterion is about. A chart is handed each series
    // entire and draws each to its own extent.
    const overlay = overlayEfforts(fast, slow);
    expect(overlay.first.points).toHaveLength(fast.points.length);
    expect(overlay.second.points).toHaveLength(slow.points.length);
  });

  it('takes the overall margin from the two DURATIONS, not from the last checkpoint', () => {
    // Reading it off the last checkpoint reports the shorter ride's margin as
    // the final one, which is the same truncation wearing a different hat.
    const overlay = overlayEfforts(fast, slow);
    expect(overlay.durationDelta).toBeCloseTo(slow.duration - fast.duration, 3);
    expect(overlay.durationDelta).toBeGreaterThan(0);
  });

  it('produces a checkpoint per step, with both efforts read at each', () => {
    const overlay = overlayEfforts(fast, slow);
    expect(overlay.checkpoints).toHaveLength(COMPARISON_CHECKPOINTS);
    for (const checkpoint of overlay.checkpoints) {
      expect(checkpoint.first).toBeDefined();
      expect(checkpoint.second).toBeDefined();
      expect(checkpoint.delta).toBeDefined();
    }
  });

  it('shows the slower rider falling further behind, which is the point of the chart', () => {
    const overlay = overlayEfforts(fast, slow);
    const first = overlay.checkpoints[1]?.delta ?? 0;
    const last = overlay.checkpoints[COMPARISON_CHECKPOINTS - 1]?.delta ?? 0;
    expect(last).toBeGreaterThan(first);
  });

  it('reports how far each reading was from the checkpoint, and the coarse ride is worse ON AVERAGE', () => {
    // The honesty field. A reader comparing two times is entitled to know that
    // one of them is pinned to a sample tens of metres from where the other is.
    //
    // ⚠️ **On average, and not at every checkpoint** — which is not a weaker
    // claim, it is the true one. The checkpoints are fractions of the SHORTER
    // effort's total, and here that is the coarse ride's, so its own samples
    // land exactly on some of them: at the midpoint of this fixture the coarse
    // ride's offset is ~0 and the 1 Hz ride's is 4 m. A per-checkpoint
    // assertion looks obviously right and fails on that coincidence.
    const overlay = overlayEfforts(fast, slow);
    const mean = (pick: (checkpoint: (typeof overlay.checkpoints)[number]) => number): number =>
      overlay.checkpoints.reduce((sum, checkpoint) => sum + pick(checkpoint), 0) /
      overlay.checkpoints.length;

    expect(mean((checkpoint) => checkpoint.first?.offset ?? 0)).toBeLessThan(
      mean((checkpoint) => checkpoint.second?.offset ?? 0),
    );
  });

  it('the coarse effort CAN sit exactly on a checkpoint, which is why the above is a mean', () => {
    // Pinned so the coincidence above is recorded as a property rather than
    // rediscovered as a puzzling test failure.
    const overlay = overlayEfforts(fast, slow);
    expect(overlay.checkpoints[10]?.second?.offset).toBeCloseTo(0, 6);
    expect(overlay.checkpoints[10]?.first?.offset).toBeGreaterThan(1);
  });

  it('is symmetric in which effort is passed first', () => {
    const forward = overlayEfforts(fast, slow);
    const backward = overlayEfforts(slow, fast);
    expect(backward.durationDelta).toBeCloseTo(-forward.durationDelta, 3);
    expect(backward.checkpoints[10]?.delta).toBeCloseTo(-(forward.checkpoints[10]?.delta ?? 0), 3);
  });
});

describe('the checkpoints span the shorter effort, and say so rather than truncating', () => {
  it('stops at the shorter effort’s distance', () => {
    // Beyond it one rider has no recorded position, so there is nothing to
    // compare against. Both series are still returned whole.
    const long = progressOf('long', ...spread(ride(800, 10, 1)));
    const short = progressOf('short', ...spread(ride(300, 10, 1)));

    const overlay = overlayEfforts(long, short);
    const last = overlay.checkpoints[COMPARISON_CHECKPOINTS - 1];

    expect(last?.distance).toBeCloseTo(short.total, 0);
    expect(overlay.first.total).toBeCloseTo(800, 0);
  });

  it('has no checkpoints at all when one effort covered no ground', () => {
    // Zero checkpoints is a result the screen renders as "no comparison". A
    // single checkpoint at distance zero would read as a dead heat.
    const real = progressOf('real', ...spread(ride(500, 10, 1)));
    const nothing = progressOf('nothing', [], [], 0, 0);

    expect(overlayEfforts(real, nothing).checkpoints).toEqual([]);
  });

  it('never asks for fewer than two checkpoints, so a fraction is always defined', () => {
    // With one checkpoint the fraction would be 0/0.
    const a = progressOf('a', ...spread(ride(500, 10, 1)));
    const b = progressOf('b', ...spread(ride(500, 9, 1)));
    const overlay = overlayEfforts(a, b, 1);

    expect(overlay.checkpoints).toHaveLength(2);
    expect(overlay.checkpoints[0]?.fraction).toBe(0);
    expect(overlay.checkpoints[1]?.fraction).toBe(1);
  });
});
