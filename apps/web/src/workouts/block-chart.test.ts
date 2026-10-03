// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  expandWorkout,
  MAXIMUM_REPEATS,
  MAXIMUM_SEGMENTS,
  POWER_ZONE_LOWER_FRACTIONS,
  seconds,
  thresholdShare,
  type Seconds,
  type WorkoutBlock,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  BAND_COUNT,
  bandOf,
  BLOCK_CHART_MAX_BARS,
  blockChartPaths,
  CHART_HEIGHT,
  CHART_TOP_SHARE,
  CHART_WIDTH,
  FREE_RIDE_DRAWN_SHARE,
  type BlockChartSegment,
} from './block-chart';

const steady = (length: number, share: number): WorkoutBlock => ({
  kind: 'steady',
  seconds: seconds(length),
  target: thresholdShare(share),
});

const segmentsOf = (...blocks: WorkoutBlock[]): readonly BlockChartSegment[] =>
  expandWorkout({ name: 'test', blocks }).segments;

/** Every subpath's points, as `[x, y]` pairs. */
function subpaths(d: string): number[][][] {
  return d
    .split('M')
    .filter((part) => part !== '')
    .map((part) =>
      part
        .replace(/Z$/, '')
        .split('L')
        .map((point) => point.trim().split(' ').map(Number)),
    );
}

/** Where a share of threshold is drawn, on the fixed scale. */
const yOf = (share: number, top = CHART_TOP_SHARE): number =>
  Math.round((CHART_HEIGHT - (share / top) * CHART_HEIGHT) * 100) / 100;

describe('the band a share falls in', () => {
  it('is the domain power zone, inclusive below and exclusive above', () => {
    POWER_ZONE_LOWER_FRACTIONS.forEach((lower, index) => {
      expect(bandOf(lower)).toBe(index);
      if (index > 0) expect(bandOf(lower - 0.0001)).toBe(index - 1);
    });
    expect(bandOf(3)).toBe(BAND_COUNT - 1);
  });
});

describe('a block chart — #1043', () => {
  it('draws a steady block as one rectangle, as high as its share of threshold', () => {
    const paths = blockChartPaths(segmentsOf(steady(600, 0.88)));
    const tempo = bandOf(0.88);
    expect(tempo).toBe(2);
    paths.bands.forEach((d, band) => {
      expect(d === '', `band ${String(band)}`).toBe(band !== tempo);
    });
    expect(subpaths(paths.bands[tempo] ?? '')).toEqual([
      [
        [0, CHART_HEIGHT],
        [0, yOf(0.88)],
        [CHART_WIDTH, yOf(0.88)],
        [CHART_WIDTH, CHART_HEIGHT],
      ],
    ]);
  });

  it('puts the threshold rule at 100 % on the same fixed scale', () => {
    const paths = blockChartPaths(segmentsOf(steady(600, 0.5)));
    expect(paths.rule).toBe(`M0 ${String(yOf(1))}L${String(CHART_WIDTH)} ${String(yOf(1))}`);
    expect(yOf(1)).toBe(20);
  });

  it('keeps time as width: a block twice as long is twice as wide', () => {
    const paths = blockChartPaths(segmentsOf(steady(600, 0.5), steady(1200, 0.95)));
    const [easy] = subpaths(paths.bands[bandOf(0.5)] ?? '');
    const [hard] = subpaths(paths.bands[bandOf(0.95)] ?? '');
    expect(easy?.[2]?.[0]).toBeCloseTo(CHART_WIDTH / 3, 1);
    expect(hard?.[0]?.[0]).toBeCloseTo(CHART_WIDTH / 3, 1);
    expect(hard?.[2]?.[0]).toBe(CHART_WIDTH);
  });

  it('raises the top only for a workout harder than the fixed scale', () => {
    const paths = blockChartPaths(segmentsOf(steady(60, 1.5), steady(60, 0.5)));
    const [sprint] = subpaths(paths.bands[bandOf(1.5)] ?? '');
    expect(sprint?.[1]?.[1]).toBe(0);
    expect(paths.rule).toContain(` ${String(yOf(1, 1.5))}L`);
  });

  it('draws a ramp as a slope, cut where it crosses a band', () => {
    const ramp: WorkoutBlock = {
      kind: 'ramp',
      seconds: seconds(700),
      from: thresholdShare(0.5),
      to: thresholdShare(1.2),
    };
    const paths = blockChartPaths(segmentsOf(ramp));
    // 0.5 → 1.2 crosses 0.56, 0.76, 0.91 and 1.06: five pieces, five bands.
    expect(paths.bands.map((d) => subpaths(d).length)).toEqual([1, 1, 1, 1, 1, 0, 0]);
    const [first] = subpaths(paths.bands[0] ?? '');
    // The first piece rises from 50 % to 56 %, and ends where the share is 0.56.
    expect(first?.[1]?.[1]).toBe(yOf(0.5));
    expect(first?.[2]?.[1]).toBe(yOf(0.56));
    expect(first?.[2]?.[0]).toBeCloseTo(((0.56 - 0.5) / 0.7) * CHART_WIDTH, 1);
    const [last] = subpaths(paths.bands[4] ?? '');
    expect(last?.[2]).toEqual([CHART_WIDTH, yOf(1.2)]);
  });

  it('draws a ramp down as a slope down', () => {
    const ramp: WorkoutBlock = {
      kind: 'ramp',
      seconds: seconds(300),
      from: thresholdShare(0.7),
      to: thresholdShare(0.6),
    };
    const [piece] = subpaths(blockChartPaths(segmentsOf(ramp)).bands[1] ?? '');
    expect(piece?.[1]?.[1]).toBe(yOf(0.7));
    expect(piece?.[2]?.[1]).toBe(yOf(0.6));
  });

  it('draws a free ride hatched and unfilled, at its nominal height', () => {
    const paths = blockChartPaths(
      segmentsOf({ kind: 'free-ride', seconds: seconds(600) }, steady(600, 0.6)),
    );
    expect(paths.bands[bandOf(0.6)]).not.toBe('');
    expect(paths.bands.filter((d) => d !== '')).toHaveLength(1);
    const [outline, ...hatching] = subpaths(paths.freeRide);
    expect(outline?.[1]).toEqual([0, yOf(FREE_RIDE_DRAWN_SHARE)]);
    expect(outline?.[2]).toEqual([CHART_WIDTH / 2, yOf(FREE_RIDE_DRAWN_SHARE)]);
    expect(hatching.length).toBeGreaterThan(10);
    for (const line of hatching) {
      for (const [x] of line) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(CHART_WIDTH / 2);
      }
    }
  });

  it('draws nothing for an empty timeline, and drops a segment that is not finite', () => {
    expect(blockChartPaths([]).rule).toBe('');
    const paths = blockChartPaths([
      // A hand-edited row, not something `seconds` would build.
      { startsAt: seconds(0), endsAt: Number.NaN as Seconds, from: undefined, to: undefined },
      ...segmentsOf(steady(60, 0.6)),
    ]);
    expect(paths.freeRide).toBe('');
    expect(paths.bands.join('')).not.toContain('NaN');
  });

  it('is bounded by bars, not by seconds or segments, at MAXIMUM_SEGMENTS', () => {
    const blocks: WorkoutBlock[] = [];
    const per = 2 * MAXIMUM_REPEATS;
    for (let made = 0; made < MAXIMUM_SEGMENTS; made += per) {
      blocks.push({
        kind: 'intervals',
        repeats: MAXIMUM_REPEATS,
        hardSeconds: seconds(30),
        hardTarget: thresholdShare(1.3),
        easySeconds: seconds(30),
        easyTarget: thresholdShare(0.5),
      });
    }
    const segments = segmentsOf(...blocks);
    expect(segments).toHaveLength(MAXIMUM_SEGMENTS);
    const paths = blockChartPaths(segments);
    const drawn = paths.bands.reduce((total, d) => total + subpaths(d).length, 0);
    // One subpath a column at most, the columns being equal slices of time.
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThanOrEqual(BLOCK_CHART_MAX_BARS);
    const characters = paths.bands.join('').length + paths.freeRide.length;
    expect(characters).toBeLessThan(BLOCK_CHART_MAX_BARS * 60);
  });

  it('columns a long timeline by the time-weighted mean, and calls a mostly free column free', () => {
    const many: BlockChartSegment[] = [];
    for (let index = 0; index < 2 * BLOCK_CHART_MAX_BARS; index += 1) {
      const startsAt = seconds(index * 10);
      const endsAt = seconds(index * 10 + 10);
      // The first half alternates 0.5 and 1.0 (mean 0.75, tempo is 0.76: endurance);
      // the second half is free riding.
      const share = index < BLOCK_CHART_MAX_BARS ? (index % 2 === 0 ? 0.5 : 1) : undefined;
      many.push({
        startsAt,
        endsAt,
        from: share === undefined ? undefined : thresholdShare(share),
        to: share === undefined ? undefined : thresholdShare(share),
      });
    }
    const paths = blockChartPaths(many);
    expect(paths.bands.map((d) => subpaths(d).length)).toEqual([
      0,
      BLOCK_CHART_MAX_BARS / 2,
      0,
      0,
      0,
      0,
      0,
    ]);
    expect(paths.freeRide).not.toBe('');
    const [column] = subpaths(paths.bands[1] ?? '');
    expect(column?.[1]?.[1]).toBe(yOf(0.75));
  });
});
