// SPDX-License-Identifier: Apache-2.0

/**
 * Per-second activity streams, in their **in-memory** form.
 *
 * ADR 0011 records the decision this file implements. The three parts of it
 * that a reader of this file needs:
 *
 * 1. **A stream set belongs to one activity and is keyed by its id.** There is
 *    no reference field on `ActivityRecord`, because a second copy of that
 *    edge is a second thing to keep consistent. `getStreamSet(owner, id)` is
 *    the reference.
 * 2. **A gap is `undefined`, never a sentinel and never zero.** A heart-rate
 *    strap that dropped for thirty seconds comes back as thirty absent
 *    samples. Interpolating them into fiction corrupts every metric in #11,
 *    and encoding them as `0` is worse, because `0` bpm is a value the type
 *    admits and no consumer can distinguish it afterwards.
 * 3. **Each channel has a declared resolution, and that resolution is the
 *    contract.** A stream set is a *derived* artefact — ADR 0005 section F
 *    makes the immutable original file the source of truth — so it is stored
 *    at the precision the sensors actually deliver rather than at the
 *    precision a `double` can hold. `CHANNEL_RESOLUTION` below tabulates it,
 *    and `stream-codec.ts` is the only thing that applies it.
 *
 * Every value is a `@onyourleft/domain` quantity. There is no bare `number` for
 * a measured value anywhere in this file, which is what stops a latitude being
 * assigned to a longitude channel — the one geographic bug no range check can
 * see, because the transposed pair is valid everywhere under 90 degrees.
 */

import type {
  AltitudeMetres,
  BeatsPerMinute,
  DegreesCelsius,
  DegreesLatitude,
  DegreesLongitude,
  MetresPerSecond,
  RevolutionsPerMinute,
  Seconds,
  UnixSeconds,
  Watts,
} from '@onyourleft/domain';

import type { ActivityId, AthleteId } from './ids';

/**
 * The value type of each channel — the map that makes `StreamChannels` typed
 * per channel rather than a bag of numbers.
 *
 * These are the eight channels #27 names. Latitude and longitude are separate
 * channels rather than a position channel because they are separately absent:
 * a GPS fix produces both or neither, but a track imported from a device that
 * logged only one is real data this store must not refuse. `stream-codec.ts`
 * encodes them independently for the same reason.
 */
export interface StreamChannelValue {
  power: Watts;
  heartRate: BeatsPerMinute;
  cadence: RevolutionsPerMinute;
  speed: MetresPerSecond;
  latitude: DegreesLatitude;
  longitude: DegreesLongitude;
  altitude: AltitudeMetres;
  temperature: DegreesCelsius;
}

/** One of the eight channels. A typo is a compile error, not a missing chart. */
export type StreamChannel = keyof StreamChannelValue;

/**
 * Every channel, in the order #27 lists them.
 *
 * Ordered rather than a `Set`, so an encoded set's channel list, a chart's
 * legend and this file all agree without anyone sorting anything.
 */
export const STREAM_CHANNELS: readonly StreamChannel[] = [
  'power',
  'heartRate',
  'cadence',
  'speed',
  'latitude',
  'longitude',
  'altitude',
  'temperature',
];

/** The position channels, named once so "does this ride have a track" is one check. */
export const POSITION_CHANNELS: readonly StreamChannel[] = ['latitude', 'longitude'];

/**
 * One channel's samples: one entry per sample slot, `undefined` where the
 * sensor gave nothing.
 *
 * A dense array with holes rather than a sparse `Map<index, value>`, because
 * every consumer of a stream reads it whole and in order — that is #27's
 * central observation, and it is what makes the array the right shape and the
 * row-per-sample store the wrong one.
 */
export type Samples<C extends StreamChannel> = readonly (StreamChannelValue[C] | undefined)[];

/** The channels a stream set carries. A channel the ride has no data for is absent. */
export type StreamChannels = {
  readonly [C in StreamChannel]?: Samples<C>;
};

/**
 * The declared resolution of each channel, in the channel's own unit.
 *
 * This is the encoding's contract, stated in the domain's units rather than in
 * bytes: a value that lands on this grid round-trips **exactly**, and a value
 * that does not comes back rounded to the nearest grid point. `0` means the
 * channel is exact for every value it admits.
 *
 * The numbers are not arbitrary. Power, heart rate and cadence are integers at
 * every sensor and in every file format this program reads. Speed at 1 mm/s is
 * three orders below any wheel or trainer's own error. Altitude is FIT's own
 * `uint16` scale of 5 (0.2 m). Latitude and longitude are FIT semicircles,
 * about 8.4e-8 degrees — roughly 9 mm at the equator, which is two orders
 * better than consumer GNSS. Temperature is whole degrees, which is what every
 * BLE Environmental Sensing and FIT temperature field carries.
 */
export const CHANNEL_RESOLUTION: Readonly<Record<StreamChannel, number>> = {
  power: 1,
  heartRate: 1,
  cadence: 1,
  speed: 0.001,
  latitude: 180 / 2 ** 31,
  longitude: 180 / 2 ** 31,
  altitude: 0.2,
  temperature: 1,
};

/**
 * A whole stream set for one activity, as a consumer sees it.
 *
 * `sampleCount` is the length of every channel array, including the ones with
 * gaps: the channels share one time base, so sample `i` of `power` and sample
 * `i` of `heartRate` are the same instant. That is what makes a chart's x axis
 * a single computation and what a per-channel timestamp column would destroy.
 */
export interface StreamSet {
  readonly activityId: ActivityId;
  /** The owning athlete. Every read of this record filters on it. */
  readonly athleteId: AthleteId;
  /** The instant of sample 0. Sample `i` is at `startedAt + i * sampleInterval`. */
  readonly startedAt: UnixSeconds;
  /** The spacing between samples — `seconds(1)` for the 1 Hz case #27 names. */
  readonly sampleInterval: Seconds;
  /** How many sample slots each present channel has. */
  readonly sampleCount: number;
  readonly channels: StreamChannels;
}

/** What `putStreamSet` accepts. Identical to `StreamSet`; named for symmetry with `NewActivity`. */
export type NewStreamSet = StreamSet;

/**
 * What is known about a stored stream set **without decoding it** — the read
 * #62's activity list and #35's export manifest can afford.
 *
 * `encodedBytes` is the measurement ADR 0011 records: the number of bytes this
 * device actually holds for this ride, summed over every channel's stored
 * blob, after compression. It is written at store time rather than computed at
 * read time, because computing it means reading every blob, which is the thing
 * a summary exists to avoid.
 */
export interface StreamSetSummary {
  readonly activityId: ActivityId;
  readonly athleteId: AthleteId;
  readonly startedAt: UnixSeconds;
  readonly sampleInterval: Seconds;
  readonly sampleCount: number;
  readonly channels: readonly StreamChannel[];
  readonly encodedBytes: number;
}

/** Whether a stored set has a track at all — the indoor-trainer question, answered without decoding. */
export function hasPositionChannels(summary: StreamSetSummary): boolean {
  return POSITION_CHANNELS.every((channel) => summary.channels.includes(channel));
}
