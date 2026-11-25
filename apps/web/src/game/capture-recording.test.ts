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
  metresPerSecond,
  revolutionsPerMinute,
  seconds,
  unixSeconds,
  watts,
} from '@onyourleft/domain';

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
