// SPDX-License-Identifier: Apache-2.0

/**
 * A track activity built from the same synthetic ride the #29 corpus uses.
 *
 * Shared by `gpx.test.ts` and `tcx.test.ts` so the two formats are exercised on
 * identical data and a difference between them is a difference in the format
 * rather than in the fixture.
 *
 * ⚠️ **The coordinates are inside the `NULL-ISLAND` synthetic test region**
 * declared in `src/synthetic-test-regions.ts`. ADR 0004 decision G: no file
 * recorded by a real device from a real ride may be committed to this
 * repository, referenced by a test, or used as the evidence for any acceptance
 * criterion. That applies to a coordinate typed into a test file as much as to
 * a committed `.fit`, and `region-guard.test.ts` asserts it of this builder
 * rather than trusting this comment.
 */

import type { GeographicPosition } from '@onyourleft/domain';
import {
  altitudeMetres,
  beatsPerMinute,
  degreesCelsius,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  metresPerSecond,
  revolutionsPerMinute,
  seconds,
  unixSeconds,
  watts,
} from '@onyourleft/domain';

import type { TrackActivity, TrackLap, TrackPoint } from './track';

/** 2024-06-15T09:00:00Z, the instant every fixture ride starts at. */
export const RIDE_START_UNIX_SECONDS = 1_718_442_000;

/** Coordinates are held as integer 1e-7 degrees so no float drift reaches the text. */
const DEGREES_SCALE = 1e7;

/**
 * The position of sample `index`.
 *
 * ⚠️ **The latitude and the longitude are deliberately different numbers, and
 * they move at different rates.** A fixture whose two coordinates are equal
 * cannot see a transposition: the writer swaps them, the reader swaps them
 * back, and every round-trip test stays green. That is not hypothetical — the
 * first draft of this file used the same expression for both, and the mutation
 * battery for #32 found that transposing `lat` and `lon` in the GPX writer left
 * the round trip passing.
 *
 * Both stay inside `NULL-ISLAND` (±1°), which is what `testing.test.ts`
 * asserts.
 */
function positionAt(index: number): GeographicPosition {
  return geographicPosition(
    degreesLatitude((-180_000 + index * 3000) / DEGREES_SCALE),
    degreesLongitude((420_000 - index * 1700) / DEGREES_SCALE),
  );
}

/** One synthetic sample. Every channel is a closed-form function of the index. */
export function samplePoint(index: number): TrackPoint {
  return {
    timestamp: unixSeconds(RIDE_START_UNIX_SECONDS + index),
    position: positionAt(index),
    altitude: altitudeMetres(12 + ((index * 3) % 40) / 10),
    distance: metres(index * 7 + ((index * 13) % 5)),
    speed: metresPerSecond((7000 + ((index * 137) % 3000)) / 1000),
    heartRate: beatsPerMinute(118 + ((index * 7) % 41)),
    cadence: revolutionsPerMinute(76 + ((index * 3) % 19)),
    power: watts(165 + ((index * 11) % 97)),
    temperature: degreesCelsius(14 + ((index * 5) % 9)),
  };
}

/** A lap of `count` samples, starting from sample `from`. */
export function sampleLap(from: number, count: number): TrackLap {
  const points = Array.from({ length: count }, (_, index) => samplePoint(from + index));
  return {
    startTime: unixSeconds(RIDE_START_UNIX_SECONDS + from),
    totalElapsedTime: seconds(count - 1),
    totalDistance: metres((from + count - 1) * 7),
    points,
  };
}

/** A whole synthetic activity: two laps, every channel populated. */
export function sampleActivity(): TrackActivity {
  return {
    startTime: unixSeconds(RIDE_START_UNIX_SECONDS),
    name: 'Synthetic fixture ride',
    sport: 'cycling',
    creator: 'On Your Left',
    laps: [sampleLap(0, 10), sampleLap(10, 8)],
  };
}

/** An indoor activity: every channel except position. */
export function indoorActivity(): TrackActivity {
  const activity = sampleActivity();
  return {
    ...activity,
    laps: activity.laps.map((lap) => ({
      ...lap,
      points: lap.points.map((point) => ({ ...point, position: undefined })),
    })),
  };
}
