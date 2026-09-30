// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A ride's summary as passages of the rider's history (#835, ADR 0040 D-2).
 * What it may never hold is `input.test.ts` §"what never leaves"'s; this is
 * what it says.
 */

import { describe, expect, it } from 'vitest';

import type { RideAnalysisInput } from './input';
import {
  RIDE_SUMMARY_FORMAT,
  RIDE_SUMMARY_VERSION,
  rideSummaryBody,
  rideSummaryPassages,
} from './ride-summary';

const INPUT: RideAnalysisInput = {
  templateVersion: 'ride-summary-1',
  ride: { movingMinutes: 62.5, distanceKilometres: 31.4 },
  rider: { massKilograms: 70, thresholdPower: 250 },
  whole: {
    power: { coverage: 0.98, mean: 182, max: 540 },
    heartRate: { coverage: 1, mean: 141, max: 172 },
    cadence: { coverage: 0.3 },
    wattsPerKilogram: { mean: 2.6, max: 7.71 },
  },
  sections: [
    {
      index: 1,
      kind: 'climb',
      minutes: 12.5,
      distanceKilometres: 4.2,
      meanGradientPercent: 5.1,
      elevationGainMetres: 214,
      metrics: { power: { coverage: 1, mean: 251, max: 402 } },
    },
    {
      index: 2,
      kind: 'lap',
      minutes: 50,
      laps: { first: 2, last: 4 },
      metrics: {},
    },
  ],
};

describe('a ride’s summary', () => {
  it('says the whole ride first, then each section in the order ridden', () => {
    expect(rideSummaryPassages(INPUT)).toStrictEqual([
      'A ride of 62.5 minutes of riding over 31.4 kilometres. Power averaged 182 watts, up to 540 watts, reported for 98% of the time. Heart rate averaged 141 beats a minute, up to 172 beats a minute, reported for 100% of the time. Cadence was reported for only 30% of the time. Power per kilogram averaged 2.6, up to 7.71. It is cut into 2 sections.',
      'Section 1 of 2, a climb: 12.5 minutes, 4.2 kilometres, at 5.1% average gradient, climbing 214 metres. Power averaged 251 watts, up to 402 watts, reported for 100% of the time.',
      'Section 2 of 2, a lap (laps 2 to 4): 50 minutes.',
    ]);
  });

  it('says nothing of a channel the ride never recorded, and names one lap as one', () => {
    const [whole, lap] = rideSummaryPassages({
      ...INPUT,
      whole: {},
      sections: [{ index: 1, kind: 'lap', minutes: 3, laps: { first: 5, last: 5 }, metrics: {} }],
    });
    expect(whole).toBe(
      'A ride of 62.5 minutes of riding over 31.4 kilometres. It is cut into 1 section.',
    );
    expect(lap).toBe('Section 1 of 1, a lap (lap 5): 3 minutes.');
  });

  it('describes a ride with no samples as the ride alone', () => {
    expect(rideSummaryPassages({ ...INPUT, whole: {}, sections: [] })).toStrictEqual([
      'A ride of 62.5 minutes of riding over 31.4 kilometres. It has no sections.',
    ]);
  });

  it('never says the pose summary, even when the input carries one (ADR 0040 D-2 item 1)', () => {
    const withPose: RideAnalysisInput = {
      ...INPUT,
      pose: { source: 'tablet', posed: 10, noRider: 0, unreadable: 0, differences: { torso: 3 } },
    };
    expect(rideSummaryPassages(withPose)).toStrictEqual(rideSummaryPassages(INPUT));
  });

  it('is the body the instance reads: its format, its version and its passages', () => {
    expect(JSON.parse(rideSummaryBody(INPUT))).toStrictEqual({
      format: RIDE_SUMMARY_FORMAT,
      version: RIDE_SUMMARY_VERSION,
      passages: rideSummaryPassages(INPUT),
    });
  });
});
