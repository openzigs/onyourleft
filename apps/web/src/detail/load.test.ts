// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #50's fourth and seventh acceptance criteria, at the layer where they are
 * decidable.
 *
 * - **Criterion 4**, as owner decision D6 revised it: *a summary view must not
 *   load a full 1 Hz stream*. There is no network, so the assertion is on the
 *   reads issued and the points returned rather than on bytes over a wire.
 * - **Criterion 7**: rendering a four-hour activity meets a stated
 *   interaction-latency budget, measured. The budget is stated in **work** —
 *   channels decoded, samples visited, points returned — because those are the
 *   numbers a slow machine cannot change. The wall clock is measured too, and
 *   what it is held to is recorded at that test.
 */

import {
  beatsPerMinute,
  metres,
  metresPerSecond,
  seconds,
  unixSeconds,
  watts,
} from '@onyourleft/domain';
import { activityId, athleteId, type Samples } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { loadOverview, loadSharedTrack, loadTrace } from './load';
import { CHART_POINTS } from './series';
import { stubActivity, stubDetail, stubLap } from './testing';

const ATHLETE = athleteId('athlete-a');
const RIDE = activityId('ride-1');

/** Four hours at 1 Hz — the ride #50's seventh criterion names. */
const FOUR_HOURS_OF_SAMPLES = 4 * 60 * 60;

function powerSeries(count: number, holeFrom = -1, holeLength = 0): Samples<'power'> {
  return Array.from({ length: count }, (_unused, index) =>
    index >= holeFrom && index < holeFrom + holeLength ? undefined : watts(150 + (index % 100)),
  );
}

function fourHourRide() {
  return stubDetail(ATHLETE, {
    activity: stubActivity({ elapsedTime: seconds(FOUR_HOURS_OF_SAMPLES) }),
    channels: {
      power: powerSeries(FOUR_HOURS_OF_SAMPLES),
      heartRate: Array.from({ length: FOUR_HOURS_OF_SAMPLES }, () => beatsPerMinute(142)),
    },
    laps: [stubLap(0), stubLap(1)],
  });
}

describe('loadOverview — the read a summary panel costs', () => {
  it('decodes not one sample', () => {
    // The criterion. The overview shows six numbers and a lap table, and none
    // of them is worth inflating a 29 KB blob for — which is exactly what
    // `getStreamSet` would have done and why the port does not offer it.
    const port = fourHourRide();
    return loadOverview(port, RIDE).then((overview) => {
      expect(overview).toBeDefined();
      expect(port.channelReads).toEqual([]);
    });
  });

  it('reads the stream summary exactly once, not once per channel', async () => {
    const port = fourHourRide();
    await loadOverview(port, RIDE);
    expect(port.summaryReads).toHaveLength(1);
  });

  it('carries the ride, its channels and its laps', async () => {
    const port = fourHourRide();
    const overview = await loadOverview(port, RIDE);
    expect(overview?.activity.name).toBe('Tuesday morning');
    expect(overview?.streams?.channels).toEqual(['power', 'heartRate']);
    expect(overview?.streams?.sampleCount).toBe(FOUR_HOURS_OF_SAMPLES);
    expect(overview?.laps).toHaveLength(2);
  });

  it('is undefined for a ride this athlete does not have, and reads nothing further', async () => {
    // Not "throws", and not a distinct "belongs to somebody else": the store's
    // reads are athlete-scoped, so the two are the same answer here — and a
    // message distinguishing them would confirm the id names a real ride.
    const port = fourHourRide();
    expect(await loadOverview(port, activityId('someone-elses'))).toBeUndefined();
    expect(port.summaryReads).toEqual([]);
    expect(port.channelReads).toEqual([]);
  });

  it('has no stream summary for a ride with no stored streams', async () => {
    const port = stubDetail(ATHLETE, { activity: stubActivity(), channels: {}, laps: [] });
    const overview = await loadOverview(port, RIDE);
    expect(overview?.streams).toBeUndefined();
  });
});

describe('loadTrace — one channel, at chart resolution', () => {
  it('hands back the chart width rather than the whole series', async () => {
    // 14 400 samples in, 600 points out. This is the number criterion 4 is
    // about: the DOM never sees the full series.
    const port = fourHourRide();
    const trace = await loadTrace(port, RIDE, 'power', 'metric');
    expect(trace?.points).toHaveLength(CHART_POINTS);
    expect(trace?.sampleCount).toBe(FOUR_HOURS_OF_SAMPLES);
    expect((trace?.points.length ?? 0) * 20).toBeLessThan(FOUR_HOURS_OF_SAMPLES);
  });

  it('reads exactly the one channel asked for', async () => {
    const port = fourHourRide();
    await loadTrace(port, RIDE, 'power', 'metric');
    expect(port.channelReads).toEqual(['power']);
  });

  it('says how much ride time one point covers', async () => {
    const port = fourHourRide();
    const trace = await loadTrace(port, RIDE, 'power', 'metric');
    expect(trace?.secondsPerPoint).toBe(FOUR_HOURS_OF_SAMPLES / CHART_POINTS);
  });

  it('counts missing samples on the stored series, not on the drawing', async () => {
    // A three-second dropout does not survive a 24-sample bucket — `series.ts`
    // records that as the right trade for the drawing. It must still be
    // counted, or the view would tell the rider nothing was lost.
    const port = stubDetail(ATHLETE, {
      activity: stubActivity(),
      channels: { power: powerSeries(FOUR_HOURS_OF_SAMPLES, 1000, 3) },
      laps: [],
    });
    const trace = await loadTrace(port, RIDE, 'power', 'metric');
    expect(trace?.missingSamples).toBe(3);
    expect(trace?.points.filter((point) => point === undefined)).toHaveLength(0);
  });

  it('keeps a gap long enough to matter', async () => {
    // Five minutes of a dropped strap, which is nine buckets at this
    // resolution. #50's second criterion needs this to reach the drawing.
    const port = stubDetail(ATHLETE, {
      activity: stubActivity(),
      channels: { power: powerSeries(FOUR_HOURS_OF_SAMPLES, 1000, 300) },
      laps: [],
    });
    const trace = await loadTrace(port, RIDE, 'power', 'metric');
    expect(trace?.missingSamples).toBe(300);
    expect((trace?.points ?? []).filter((point) => point === undefined).length).toBeGreaterThan(5);
  });

  it('is undefined for a channel the ride does not carry', async () => {
    // The ordinary case, not a failure: an indoor ride has no altitude.
    const port = fourHourRide();
    expect(await loadTrace(port, RIDE, 'altitude', 'metric')).toBeUndefined();
  });

  it('converts to display units, so the chart and the table read the same number', async () => {
    const port = stubDetail(ATHLETE, {
      activity: stubActivity(),
      channels: { speed: Array.from({ length: 4 }, () => metresPerSecond(10)) },
      laps: [],
    });
    const trace = await loadTrace(port, RIDE, 'speed', 'metric');
    // 10 m/s is 36 km/h. Stored metres per second reaching the chart unchanged
    // would draw a plausible-looking line against a "km/h" axis.
    expect(trace?.points).toEqual([36, 36, 36, 36]);
  });
});

describe('the four-hour budget — #50 criterion 7', () => {
  it('costs one decode per enabled series and 600 points each, however long the ride', async () => {
    // The budget stated as work rather than as time. A slow machine cannot
    // change any of these numbers, which is what makes them a gate rather than
    // a flake — the lesson #165 recorded when a wall-clock ratio failed CI on a
    // change that had not touched it.
    const port = fourHourRide();
    const overview = await loadOverview(port, RIDE);
    const traces = [];
    for (const channel of ['power', 'heartRate'] as const) {
      traces.push(await loadTrace(port, RIDE, channel, 'metric'));
    }

    expect(overview?.streams?.sampleCount).toBe(14_400);
    expect(port.channelReads).toEqual(['power', 'heartRate']);
    expect(port.summaryReads).toHaveLength(1);
    for (const trace of traces) {
      expect(trace?.points).toHaveLength(CHART_POINTS);
    }
    // The whole interaction hands 1 200 numbers to the renderer for a ride that
    // holds 28 800.
    const delivered = traces.reduce((total, trace) => total + (trace?.points.length ?? 0), 0);
    expect(delivered).toBe(2 * CHART_POINTS);
    expect(delivered * 10).toBeLessThan(2 * FOUR_HOURS_OF_SAMPLES);
  });

  it('completes well inside a stated wall-clock ceiling', async () => {
    // Measured over twenty runs on the machine this was written on: 0.47 ms
    // fastest, 0.91 ms median, 3.29 ms slowest. Held to 1 000 ms — roughly
    // three hundred times the slowest observation.
    //
    // The headroom is the point, not a lack of confidence. #165 is in this
    // repository because a budget with 33% headroom failed CI on a change that
    // had not touched it, and cost an afternoon proving so. What a ceiling this
    // loose still catches is the failure that matters: an implementation that
    // rescanned the series per bucket would take minutes here and miss by four
    // orders of magnitude. The tight numbers are the work counts above, which a
    // loaded runner cannot move.
    const port = fourHourRide();
    const started = performance.now();
    await loadOverview(port, RIDE);
    await loadTrace(port, RIDE, 'power', 'metric');
    await loadTrace(port, RIDE, 'heartRate', 'metric');
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('loadSharedTrack — the preview, and what it reads', () => {
  it('is undefined for a ride with no position at all', async () => {
    const port = fourHourRide();
    expect(await loadSharedTrack(port, RIDE)).toBeUndefined();
  });

  it('reads the two position channels and the zones, and nothing else', async () => {
    const port = stubDetail(ATHLETE, {
      activity: stubActivity({ hasPosition: true, distance: metres(1000) }),
      channels: {
        latitude: [51.5074, 51.5084] as unknown as Samples<'latitude'>,
        longitude: [-0.1278, -0.1278] as unknown as Samples<'longitude'>,
        power: powerSeries(2),
      },
      laps: [],
    });
    const track = await loadSharedTrack(port, RIDE);
    expect(track?.segments).toHaveLength(1);
    // The power channel is not read: the preview is about the track.
    expect(port.channelReads).toEqual(['latitude', 'longitude']);
  });

  it('reports no zones applied when the athlete has none', async () => {
    const port = stubDetail(ATHLETE, {
      activity: stubActivity({ hasPosition: true }),
      channels: {
        latitude: [51.5074] as unknown as Samples<'latitude'>,
        longitude: [-0.1278] as unknown as Samples<'longitude'>,
      },
      laps: [],
    });
    // "Nothing was withheld because you have no zones" and "nothing was
    // withheld because this ride never went near one" read identically in every
    // other field and mean opposite things to a rider deciding whether to
    // publish.
    expect((await loadSharedTrack(port, RIDE))?.zonesApplied).toBe(0);
  });
});

describe('the fixtures themselves', () => {
  it('builds a ride whose activity id and start are the ones the tests assume', () => {
    const activity = stubActivity();
    expect(activity.id).toBe(RIDE);
    expect(activity.startedAt).toBe(unixSeconds(1_760_000_000));
  });
});
