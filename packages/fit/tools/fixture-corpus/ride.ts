// SPDX-License-Identifier: Apache-2.0

/**
 * The deterministic ride model every FIT fixture is built from.
 *
 * ## Nothing here may consult the clock or a random source
 *
 * A fixture regenerated tomorrow must be byte-identical to the one committed
 * today, because a test asserts exactly that. So: the ride starts at a named
 * constant instant, and every channel is a closed-form function of the sample
 * index. There is no `Date.now()`, no `Math.random()`, no iteration over a
 * `Map` or a `Set`, and no value derived from the environment. A fixture that
 * moved between runs would fail in #30 as a decoding bug, and it would take a
 * day to find out that it was not one.
 *
 * The channels are sawtooth functions rather than anything physiological. They
 * are not meant to look like a ride — they are meant to vary, to stay inside
 * each field's range, and to be reproducible by eye from the formula.
 */

import type { GeographicPosition } from '@onyourleft/domain';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metresToFitAltitude,
  unixSeconds,
  unixSecondsToFitTimestamp,
} from '@onyourleft/domain';

/**
 * The instant every fixture ride starts: 2024-06-15T09:00:00Z.
 *
 * A constant, written out rather than parsed, and chosen for no reason beyond
 * being a round hour comfortably inside the FIT `date_time` range. 19 889 days
 * from 1970-01-01 to 2024-06-15, times 86 400, plus nine hours.
 */
export const RIDE_START_UNIX_SECONDS = 1718442000;

/** Coordinates are held as integer 1e-7 degrees so no float drift reaches the bytes. */
export const DEGREES_SCALE = 1e7;

/** One sample of the ride, in the units each FIT field wants. */
export interface RideSample {
  readonly index: number;
  /** Seconds since the FIT epoch. */
  readonly fitTimestamp: number;
  /** Absent for the indoor fixtures, which is the case half this product is. */
  readonly position: GeographicPosition | undefined;
  /** `record.altitude`, already scaled and offset by `packages/domain`. */
  readonly fitAltitude: number;
  /** `record.distance`, in centimetres. */
  readonly distanceCentimetres: number;
  /** `record.speed`, in millimetres per second. */
  readonly speedMillimetresPerSecond: number;
  /** `record.heart_rate`, in beats per minute. */
  readonly heartRate: number;
  /** `record.cadence`, in revolutions per minute. */
  readonly cadence: number;
  /** `record.power`, in watts. */
  readonly power: number;
  /** `record.temperature`, in degrees Celsius. */
  readonly temperature: number;
}

/** How to lay out a track: where it starts, how far each sample moves it. */
export interface TrackSpecification {
  readonly startLatitudeE7: number;
  readonly startLongitudeE7: number;
  readonly latitudeStepE7: number;
  readonly longitudeStepE7: number;
}

const HALF_TURN_E7 = 180 * DEGREES_SCALE;
const FULL_TURN_E7 = 360 * DEGREES_SCALE;

/**
 * Wrap an integer 1e-7 longitude into `(-180, +180]`.
 *
 * The antimeridian fixture is the reason this exists, and the reason it is
 * integer arithmetic: a track that walks east past +180 continues at -180, and
 * a generator that let a float accumulate through that crossing would produce
 * coordinates whose last digits depend on the order the additions happened in.
 */
export function wrapLongitudeE7(longitudeE7: number): number {
  let wrapped = longitudeE7;
  while (wrapped > HALF_TURN_E7) {
    wrapped -= FULL_TURN_E7;
  }
  while (wrapped < -HALF_TURN_E7) {
    wrapped += FULL_TURN_E7;
  }
  return wrapped;
}

/** The position of sample `index` along a track. */
export function positionAt(track: TrackSpecification, index: number): GeographicPosition {
  const latitudeE7 = track.startLatitudeE7 + track.latitudeStepE7 * index;
  const longitudeE7 = wrapLongitudeE7(track.startLongitudeE7 + track.longitudeStepE7 * index);
  return geographicPosition(
    degreesLatitude(latitudeE7 / DEGREES_SCALE),
    degreesLongitude(longitudeE7 / DEGREES_SCALE),
  );
}

/** How to build a run of samples. */
export interface RideSpecification {
  readonly sampleCount: number;
  /** Absent for an indoor ride: no position channel at all, not a zeroed one. */
  readonly track: TrackSpecification | undefined;
  /** Seconds added to the start instant before the first sample. */
  readonly startOffsetSeconds?: number;
  /** The index the channel formulas start from, so a paused ride stays continuous. */
  readonly channelOffset?: number;
  /** Metres already ridden before the first sample. */
  readonly startDistanceMetres?: number;
}

/**
 * The whole ride, sample by sample.
 *
 * Every channel is `base + ((index * odd) % span)`. Odd multipliers so the
 * sequence walks the whole span rather than settling into a short cycle, and
 * modulo so nothing can leave its field's range however long the ride runs.
 */
export function rideSamples(specification: RideSpecification): readonly RideSample[] {
  const startOffset = specification.startOffsetSeconds ?? 0;
  const channelOffset = specification.channelOffset ?? 0;
  const startDistance = specification.startDistanceMetres ?? 0;
  const samples: RideSample[] = [];

  for (let index = 0; index < specification.sampleCount; index += 1) {
    const channelIndex = index + channelOffset;
    const speedMillimetresPerSecond = 7000 + ((channelIndex * 137) % 3000);
    const distanceMetres = startDistance + (channelIndex * 7 + ((channelIndex * 13) % 5));

    samples.push({
      index,
      fitTimestamp: unixSecondsToFitTimestamp(
        unixSeconds(RIDE_START_UNIX_SECONDS + startOffset + index),
      ),
      position: specification.track ? positionAt(specification.track, channelIndex) : undefined,
      fitAltitude: metresToFitAltitude(altitudeMetres(12 + ((channelIndex * 3) % 40) / 10)),
      distanceCentimetres: Math.round(distanceMetres * 100),
      speedMillimetresPerSecond,
      heartRate: 118 + ((channelIndex * 7) % 41),
      cadence: 76 + ((channelIndex * 3) % 19),
      power: 165 + ((channelIndex * 11) % 97),
      temperature: 14 + ((channelIndex * 5) % 9),
    });
  }

  return samples;
}
