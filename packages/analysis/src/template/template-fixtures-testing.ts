// SPDX-License-Identifier: Apache-2.0

/**
 * The template tests' fixtures: the largest, an ordinary and the smallest
 * input, over which `agent-v1.test.ts` records its digest. Test support, never
 * shipped (the `-testing.ts` suffix). The chain's notes, passages and
 * `everyPrompt` went with the chain's templates (#1797).
 */

import { MAXIMUM_SECTIONS, type RideAnalysisInput, type SectionSummary } from '../input';

// --- Fixtures -----------------------------------------------------------------

/** One section at its widest: every optional field present, every figure at its longest plausible spelling. */
export function widestSection(index: number): SectionSummary {
  return {
    index,
    kind: 'descent',
    minutes: 1234.5,
    distanceKilometres: 123.45,
    meanGradientPercent: -12.3,
    elevationGainMetres: 1234,
    laps: { first: 10 + index, last: 20 + index },
    metrics: {
      power: { coverage: 0.99, mean: 1234, max: 1999 },
      heartRate: { coverage: 0.99, mean: 188, max: 199 },
      cadence: { coverage: 0.99, mean: 101, max: 199 },
      wattsPerKilogram: { mean: 17.53, max: 28.39 },
    },
  };
}

/**
 * The largest input the template is asked to take: eight widest sections, a
 * rider with both figures set and a pose summary with every kind.
 */
export const LARGEST: RideAnalysisInput = {
  templateVersion: '1',
  ride: { movingMinutes: 2880.0, distanceKilometres: 1234.56 },
  rider: { massKilograms: 123.4, thresholdPower: 456 },
  whole: widestSection(0).metrics,
  sections: Array.from({ length: MAXIMUM_SECTIONS }, (_, position) => widestSection(position + 1)),
  pose: {
    source: 'computer',
    posed: 54_000,
    noRider: 54_000,
    unreadable: 54_000,
    differences: { torso: -12.34, knee: 8.76, elbow: -10.11, head: 0.12, saddle: -0.09 },
  },
};

/** The smallest: nothing recorded, nothing set, no pose. */
export const SMALLEST: RideAnalysisInput = {
  templateVersion: '1',
  ride: { movingMinutes: 0, distanceKilometres: 0 },
  rider: { massKilograms: null, thresholdPower: null },
  whole: {},
  sections: [],
};

/** One short section and a partial pose. */
export const ORDINARY: RideAnalysisInput = {
  templateVersion: '1',
  ride: { movingMinutes: 42.5, distanceKilometres: 18.2 },
  rider: { massKilograms: 70.4, thresholdPower: null },
  whole: { power: { coverage: 1, mean: 180, max: 420 } },
  sections: [
    {
      index: 1,
      kind: 'time',
      minutes: 42.5,
      metrics: { power: { coverage: 1, mean: 180, max: 420 }, cadence: { coverage: 0.3 } },
    },
  ],
  pose: { source: 'tablet', posed: 300, noRider: 0, unreadable: 0, differences: { torso: 2.1 } },
};
