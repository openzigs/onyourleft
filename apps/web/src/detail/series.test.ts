// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { STREAM_CHANNELS, type StreamChannel } from '@onyourleft/store';

import {
  CHART_POINTS,
  DEFAULT_SERIES,
  downsample,
  gapSamples,
  seriesFor,
  TABLE_ROWS,
  traceExtent,
  traceMean,
  traceSegments,
  traceSeries,
  type TraceChannel,
} from './series';

/** `n` samples of a ramp, so a bucket average is predictable by hand. */
function ramp(count: number): readonly number[] {
  return Array.from({ length: count }, (_unused, index) => index);
}

describe('the series table', () => {
  it('covers every stream channel that is not a coordinate', () => {
    // The assertion `seriesFor`'s throw exists for, made here rather than left
    // to that line: a channel added to `packages/store` with no series defined
    // fails this test, which names the gap, instead of throwing at render time
    // on whichever ride happens to carry it.
    const charted = new Set(traceSeries('metric').map((series) => series.channel));
    const expected = STREAM_CHANNELS.filter(
      (channel: StreamChannel) => channel !== 'latitude' && channel !== 'longitude',
    );
    expect([...charted].sort()).toEqual([...expected].sort());
  });

  it('names no channel twice', () => {
    const series = traceSeries('metric');
    expect(series).toHaveLength(new Set(series.map((s) => s.channel)).size);
  });

  it('opens with fewer series than it offers, which is what makes the read budget a budget', () => {
    expect(DEFAULT_SERIES.length).toBeGreaterThan(0);
    expect(DEFAULT_SERIES.length).toBeLessThan(traceSeries('metric').length);
    for (const channel of DEFAULT_SERIES) {
      expect(traceSeries('metric').map((s) => s.channel)).toContain(channel);
    }
  });

  it('reads a speed in km/h through the domain conversion, not as stored metres per second', () => {
    // 10 m/s is 36 km/h. A series that forgot to convert would show "10.0"
    // beside a "km/h" heading, which is a wrong number that looks like a right
    // one.
    const speed = seriesFor('speed', 'metric');
    expect(speed.unit).toBe('km/h');
    expect(speed.format(10)).toBe('36.0');
    expect(speed.display(10)).toBeCloseTo(36, 9);
  });

  it('reads power, heart rate and cadence unchanged and whole', () => {
    for (const channel of ['power', 'heartRate', 'cadence'] as const) {
      const series = seriesFor(channel, 'metric');
      expect(series.display(212.4)).toBe(212.4);
      expect(series.format(212.4)).toBe('212');
    }
  });
});

describe('downsample — the reduction the chart budget rests on', () => {
  it('reduces a four-hour ride to the chart width', () => {
    // 14 400 samples is four hours at 1 Hz — the ride #50's seventh criterion
    // names. This is the assertion that the DOM never sees the full series.
    expect(downsample(ramp(14_400), CHART_POINTS)).toHaveLength(CHART_POINTS);
  });

  it('leaves a series already shorter than the target alone', () => {
    // Re-bucketing a ten-minute ride would move every point for no reason.
    const short = ramp(120);
    expect(downsample(short, CHART_POINTS)).toEqual(short);
  });

  it('averages each bucket over the readings it has', () => {
    // Ten samples into five buckets: pairs (0,1), (2,3), … averaging 0.5, 2.5,
    // 4.5, 6.5, 8.5.
    expect(downsample(ramp(10), 5)).toEqual([0.5, 2.5, 4.5, 6.5, 8.5]);
  });

  it('carries a whole-bucket gap through as a gap rather than as a zero', () => {
    // The failure this exists to prevent: a bucket of absent readings averaged
    // as though absence were zero draws a heart rate falling to nothing, which
    // is a cardiac event rendered from a loose strap.
    const samples = [1, 1, undefined, undefined, 3, 3];
    expect(downsample(samples, 3)).toEqual([1, undefined, 3]);
  });

  it('averages a partly-absent bucket over the readings that exist', () => {
    expect(downsample([2, undefined, 4, undefined], 2)).toEqual([2, 4]);
  });

  it('returns nothing but gaps for a series with no readings at all', () => {
    expect(downsample([undefined, undefined, undefined, undefined], 2)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('refuses a non-positive target rather than returning an empty chart', () => {
    // An empty chart renders as a blank panel, which reads as "this ride has no
    // data" — the one wrong answer.
    expect(() => downsample(ramp(10), 0)).toThrow(RangeError);
    expect(() => downsample(ramp(10), -1)).toThrow(RangeError);
    expect(() => downsample(ramp(10), 2.5)).toThrow(RangeError);
  });

  it('visits each sample once, so a long ride costs what a short one costs per sample', () => {
    // #50's latency budget in the form that does not depend on a clock. The
    // proxy is a getter count: an implementation that re-scanned per bucket
    // would read 14 400 * 600 times and this would catch it.
    let reads = 0;
    const counted = new Proxy(ramp(14_400) as (number | undefined)[], {
      get(target, key, receiver): unknown {
        if (typeof key === 'string' && /^\d+$/.test(key)) {
          reads += 1;
        }
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    downsample(counted, CHART_POINTS);
    expect(reads).toBe(14_400);
  });
});

describe('traceSegments — where the line breaks', () => {
  it('is one segment for an unbroken trace', () => {
    expect(traceSegments([1, 2, 3])).toEqual([{ from: 0, values: [1, 2, 3] }]);
  });

  it('splits at a gap rather than joining across it', () => {
    // #50's second acceptance criterion on the data side. One segment with the
    // gap's points omitted would be drawn as a straight line through missing
    // data, which is indistinguishable from a steady effort.
    expect(traceSegments([1, 2, undefined, 5, 6])).toEqual([
      { from: 0, values: [1, 2] },
      { from: 3, values: [5, 6] },
    ]);
  });

  it('keeps an isolated reading between two gaps as its own segment', () => {
    expect(traceSegments([undefined, 7, undefined])).toEqual([{ from: 1, values: [7] }]);
  });

  it('is empty for a trace that is nothing but gaps', () => {
    expect(traceSegments([undefined, undefined])).toEqual([]);
  });

  it('ignores leading and trailing gaps rather than emitting empty segments', () => {
    expect(traceSegments([undefined, 1, 2, undefined])).toEqual([{ from: 1, values: [1, 2] }]);
  });
});

describe('the summary statistics a chart is described by', () => {
  it('counts missing samples on the stored series', () => {
    expect(gapSamples([1, undefined, 3, undefined, undefined])).toBe(3);
  });

  it('takes the extent over readings and ignores gaps', () => {
    expect(traceExtent([5, undefined, 1, 9])).toEqual({ low: 1, high: 9 });
  });

  it('has no extent and no mean for a series with no readings', () => {
    expect(traceExtent([undefined])).toBeUndefined();
    expect(traceMean([undefined])).toBeUndefined();
  });

  it('takes the mean over readings and does not count a gap as a zero', () => {
    // The whole reason this is not `sum / length`. With the gap counted the
    // answer would be 2, which is a number the rider never produced.
    expect(traceMean([2, undefined, 4])).toBe(3);
  });
});

describe('the declared sizes', () => {
  it('reads a table at a size a person can get through', () => {
    // Six hundred rows is not a non-visual equivalent of anything. The
    // relationship, not the number: the table has to be far smaller than the
    // drawing or it is not a summary.
    expect(TABLE_ROWS).toBeLessThan(CHART_POINTS / 10);
  });

  it('offers a series for every channel a chart can name', () => {
    const channels: readonly TraceChannel[] = traceSeries('metric').map((series) => series.channel);
    for (const channel of channels) {
      expect(seriesFor(channel, 'metric').label).not.toBe('');
    }
  });
});

describe('the traces follow the rider\u2019s units (#238)', () => {
  it('reads a speed in mph and an altitude in feet for an imperial rider', () => {
    const speed = seriesFor('speed', 'imperial');
    expect(speed.unit).toBe('mph');
    expect(speed.format(10)).toBe('22.4');

    const altitude = seriesFor('altitude', 'imperial');
    expect(altitude.unit).toBe('ft');
    expect(altitude.format(100)).toBe('328');
  });

  it('plots and labels the same value, so the axis cannot disagree with the table', () => {
    // ⚠️ `display` and `format` are separate fields and both take the STORED
    // value. Composing them — `format(display(x))` — would convert twice, which
    // is a 3.3x error on an altitude and reads as a plausible mountain.
    for (const units of ['metric', 'imperial'] as const) {
      const altitude = seriesFor('altitude', units);
      expect(altitude.format(100)).toBe(String(Math.round(altitude.display(100))));
    }
  });

  it('leaves power, cadence and heart rate alone in both systems', () => {
    for (const channel of ['power', 'cadence', 'heartRate'] as const) {
      const metric = seriesFor(channel, 'metric');
      const imperial = seriesFor(channel, 'imperial');
      expect(imperial.unit).toBe(metric.unit);
      expect(imperial.format(250)).toBe(metric.format(250));
    }
  });

  it('leaves temperature in Celsius, which ADR 0020 D-1 does not cover', () => {
    expect(seriesFor('temperature', 'imperial').unit).toBe(seriesFor('temperature', 'metric').unit);
  });
});
