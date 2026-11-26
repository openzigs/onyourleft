// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3152: a capture ride's recorder figures are the recorder's own fold over
 * the readings it kept — never a second formula — and a capture keeps them
 * as the recorder does, one slot a second, a skipped second a gap.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  beatsPerMinute,
  metres,
  metresPerSecond,
  revolutionsPerMinute,
  seconds,
  unixSeconds,
  watts,
} from '@onyourleft/domain';

import { courseLap } from '../recording/laps';
import { rideTotals } from '../recording/totals';

import { CaptureRecording, type CaptureSample } from './capture-recording';

const SAMPLES: readonly CaptureSample[] = [
  { watts: 200, cadence: 85, heartRate: 130, speed: 8, altitude: 10 },
  { watts: 250, cadence: 90, heartRate: 140, speed: 9, altitude: 12 },
  { watts: 300, cadence: undefined, heartRate: undefined, speed: 10, altitude: 15 },
];

describe('a capture ride’s recorder figures — #3152', () => {
  it('are rideTotals over the series a recorder would have kept', () => {
    const recording = new CaptureRecording();
    SAMPLES.forEach((sample, index) => {
      recording.sample(index + 1, sample);
    });
    const expected = rideTotals(
      {
        startedAt: unixSeconds(0),
        sampleInterval: seconds(1),
        sampleCount: 3,
        channels: {
          power: SAMPLES.map((each) => watts(each.watts)),
          heartRate: [beatsPerMinute(130), beatsPerMinute(140), undefined],
          cadence: [revolutionsPerMinute(85), revolutionsPerMinute(90), undefined],
          speed: SAMPLES.map((each) => metresPerSecond(each.speed)),
          altitude: SAMPLES.map((each) => altitudeMetres(each.altitude)),
        },
        pauses: [],
      },
      [],
    );
    expect(recording.seconds).toBe(3);
    expect(recording.totals()).toEqual(expected);
    expect(recording.totals().distance).toBe(27);
    expect(recording.totals().averagePower).toBe(250);
    expect(recording.totals().calories).toBeDefined();
  });

  it('has nothing, and a dash for every total, before its first second', () => {
    const recording = new CaptureRecording();
    expect(recording.seconds).toBe(0);
    expect(recording.totals().averagePower).toBeUndefined();
    expect(recording.totals().distance).toBe(0);
  });

  it('leaves a skipped second as a gap, and keeps a second once', () => {
    const recording = new CaptureRecording();
    recording.sample(1, SAMPLES[0] ?? SAMPLES[1] ?? ({} as CaptureSample));
    recording.sample(3, SAMPLES[1] ?? ({} as CaptureSample));
    recording.sample(3, SAMPLES[2] ?? ({} as CaptureSample));
    recording.sample(0, SAMPLES[2] ?? ({} as CaptureSample));
    expect(recording.seconds).toBe(3);
    // 200 W and 250 W were kept; the gap is no reading, not nought watts.
    expect(recording.totals().averagePower).toBe(225);
    expect(recording.totals().distance).toBe(17);
  });

  it('hands back the same figures until the next second', () => {
    const recording = new CaptureRecording();
    recording.sample(1, SAMPLES[0] ?? ({} as CaptureSample));
    const first = recording.totals();
    expect(recording.totals()).toBe(first);
    recording.sample(2, SAMPLES[1] ?? ({} as CaptureSample));
    expect(recording.totals()).not.toBe(first);
  });
});

describe('a capture ride’s laps — #3153, the review of PR #3160', () => {
  const series = (count: number) => ({
    startedAt: unixSeconds(0),
    sampleInterval: seconds(1),
    sampleCount: count,
    channels: {
      power: SAMPLES.slice(0, count).map((each) => watts(each.watts)),
      heartRate: [beatsPerMinute(130), beatsPerMinute(140), undefined].slice(0, count),
      cadence: [revolutionsPerMinute(85), revolutionsPerMinute(90), undefined].slice(0, count),
    },
  });

  it('counts the lap’s seconds from the last line crossed, and ends a lap there as the recorder does', () => {
    const recording = new CaptureRecording();
    recording.sample(1, SAMPLES[0] as CaptureSample);
    recording.sample(2, SAMPLES[1] as CaptureSample);
    expect(recording.lapSeconds).toBe(2);
    const stretch = { distance: metres(17), ascent: metres(2), partial: false };
    const laps = recording.courseLine({ kind: 'lap', again: true, ...stretch });
    const mark = (second: number) => ({ at: unixSeconds(second), movingTime: seconds(second) });
    expect(laps).toEqual([courseLap(series(2), mark(0), mark(2), stretch)]);
    expect(laps?.[0]?.distance).toBe(17);
    expect(recording.lapSeconds).toBe(0);
    recording.sample(3, SAMPLES[2] as CaptureSample);
    expect(recording.lapSeconds).toBe(1);
    expect(recording.seconds).toBe(3);
    // The totals fold the laps' climb, as the recorder's do.
    const kept = series(3);
    expect(recording.totals()).toEqual(
      rideTotals(
        {
          ...kept,
          channels: {
            ...kept.channels,
            speed: SAMPLES.map((each) => metresPerSecond(each.speed)),
            altitude: SAMPLES.map((each) => altitudeMetres(each.altitude)),
          },
          pauses: [],
        },
        [{ ascent: metres(2) }],
      ),
    );
  });

  it('averages the lap in progress’s power from the last line crossed, as the lap is ended — #2263', () => {
    const recording = new CaptureRecording();
    expect(recording.lapAveragePower).toBeUndefined();
    recording.sample(1, SAMPLES[0] as CaptureSample);
    recording.sample(2, SAMPLES[1] as CaptureSample);
    expect(recording.lapAveragePower).toBe(watts(225));
    const stretch = { distance: metres(17), ascent: metres(2), partial: false };
    const live = recording.lapAveragePower;
    const laps = recording.courseLine({ kind: 'lap', again: true, ...stretch });
    // At the line it is the figure the lap is ended with.
    expect(laps?.[0]?.averagePower).toBe(live);
    // The next lap has no reading yet: no figure, never nought.
    expect(recording.lapAveragePower).toBeUndefined();
    recording.sample(3, SAMPLES[2] as CaptureSample);
    expect(recording.lapAveragePower).toBe(watts(300));
    // A skipped second is a gap, not a reading of nought.
    recording.sample(5, SAMPLES[0] as CaptureSample);
    expect(recording.lapAveragePower).toBe(watts(250));
  });

  it('ends no lap on a line event that is not one', () => {
    const recording = new CaptureRecording();
    recording.sample(1, SAMPLES[0] as CaptureSample);
    expect(recording.courseLine({ kind: 'started' })).toBeUndefined();
    expect(
      recording.courseLine({ kind: 'progress', distance: metres(5), ascent: undefined }),
    ).toBeUndefined();
    expect(recording.lapSeconds).toBe(1);
  });
});
