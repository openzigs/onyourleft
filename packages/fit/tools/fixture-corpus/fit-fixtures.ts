// SPDX-License-Identifier: Apache-2.0

/**
 * The FIT half of the corpus.
 *
 * ## The record channels cannot desynchronise from the record definition
 *
 * A FIT data message is field values packed back to back with no delimiters, in
 * the exact order and at the exact sizes the matching definition declared. Get
 * the two out of step by one byte and every field after it is garbage — and the
 * file still parses, because nothing in the format says otherwise. That is the
 * easiest possible bug to write in a hand-built encoder and the hardest to see
 * in a review.
 *
 * So a channel here owns *both* halves: its field definitions and the values
 * that fill them, in one object. The definition message is
 * `channels.flatMap(c => c.fields)` and the data message is
 * `channels.flatMap(c => c.values(sample))`, so a channel that is added, removed
 * or reordered moves both at once and they cannot disagree.
 */

import { EVENT_TICKS_PER_SECOND_1024, UINT16_MODULUS } from '@onyourleft/domain';

import type { DeveloperFieldDefinition, FieldDefinition, FieldValue } from './fit-file-builder';
import { FIT_HEADER_SIZE, FitFileBuilder, positionValue } from './fit-file-builder';
import {
  BASE_TYPE,
  DEVELOPMENT_MANUFACTURER_ID,
  ENUM_VALUE,
  FIELD,
  GLOBAL_MESSAGE,
  INVALID_VALUE,
  SCALE,
} from './fit-profile';
import type { RideSample } from './ride';
import { RIDE_START_UNIX_SECONDS, rideSamples } from './ride';

// Local message types. Four bits wide, so at most sixteen definitions may be
// live at once; this corpus never needs to rebind one, which keeps every file
// readable in a hex dump.
const LOCAL = {
  fileId: 0,
  deviceInfo: 1,
  event: 2,
  record: 3,
  lap: 4,
  session: 5,
  activity: 6,
  developerDataId: 7,
  fieldDescription: 8,
  heartRate: 9,
} as const;

const FIT_START_TIMESTAMP = RIDE_START_UNIX_SECONDS - 631065600;

/** One channel of the record message: its field definitions and their values. */
export interface RecordChannel {
  readonly fields: readonly FieldDefinition[];
  readonly values: (sample: RideSample) => readonly FieldValue[];
}

const timestampChannel: RecordChannel = {
  fields: [{ number: FIELD.timestamp, size: 4, baseType: BASE_TYPE.uint32 }],
  values: (sample) => [{ kind: 'u32', value: sample.fitTimestamp }],
};

/**
 * The position channel: two `sint32` fields, one indivisible value.
 *
 * Two field definitions and one `FieldValue` on purpose — see
 * `fit-file-builder.ts`. A position may only enter a fixture through
 * `positionValue`, which is what lets the ADR 0004 decision G guard find every
 * one of them in the finished bytes.
 */
const positionChannel: RecordChannel = {
  fields: [
    { number: FIELD.record.positionLatitude, size: 4, baseType: BASE_TYPE.sint32 },
    { number: FIELD.record.positionLongitude, size: 4, baseType: BASE_TYPE.sint32 },
  ],
  values: (sample) => {
    if (!sample.position) {
      throw new Error('the position channel was used on a ride with no track');
    }
    return [positionValue(sample.position)];
  },
};

const altitudeChannel: RecordChannel = {
  fields: [{ number: FIELD.record.altitude, size: 2, baseType: BASE_TYPE.uint16 }],
  values: (sample) => [{ kind: 'u16', value: sample.fitAltitude }],
};

const distanceChannel: RecordChannel = {
  fields: [{ number: FIELD.record.distance, size: 4, baseType: BASE_TYPE.uint32 }],
  values: (sample) => [{ kind: 'u32', value: sample.distanceCentimetres }],
};

const speedChannel: RecordChannel = {
  fields: [{ number: FIELD.record.speed, size: 2, baseType: BASE_TYPE.uint16 }],
  values: (sample) => [{ kind: 'u16', value: sample.speedMillimetresPerSecond }],
};

const heartRateChannel: RecordChannel = {
  fields: [{ number: FIELD.record.heartRate, size: 1, baseType: BASE_TYPE.uint8 }],
  values: (sample) => [{ kind: 'u8', value: sample.heartRate }],
};

const cadenceChannel: RecordChannel = {
  fields: [{ number: FIELD.record.cadence, size: 1, baseType: BASE_TYPE.uint8 }],
  values: (sample) => [{ kind: 'u8', value: sample.cadence }],
};

const powerChannel: RecordChannel = {
  fields: [{ number: FIELD.record.power, size: 2, baseType: BASE_TYPE.uint16 }],
  values: (sample) => [{ kind: 'u16', value: sample.power }],
};

const temperatureChannel: RecordChannel = {
  fields: [{ number: FIELD.record.temperature, size: 1, baseType: BASE_TYPE.sint8 }],
  values: (sample) => [{ kind: 'i8', value: sample.temperature }],
};

/**
 * Heart rate declared as a `uint16`.
 *
 * `record.heart_rate` is a `uint8` in every file anybody has seen, so a decoder
 * that hard-codes one byte for it works — until a file declares two, which the
 * format explicitly permits, because a definition message carries each field's
 * size and base type rather than inheriting them from the profile. A parser
 * that assumes 8-bit here does not fail on this field; it desynchronises and
 * mis-reads every field after it.
 */
const heartRate16BitChannel: RecordChannel = {
  fields: [{ number: FIELD.record.heartRate, size: 2, baseType: BASE_TYPE.uint16 }],
  values: (sample) => [{ kind: 'u16', value: 260 + (sample.index % 51) }],
};

/** The channels a nominal outdoor ride records. */
const OUTDOOR_CHANNELS: readonly RecordChannel[] = [
  timestampChannel,
  positionChannel,
  altitudeChannel,
  distanceChannel,
  speedChannel,
  heartRateChannel,
  cadenceChannel,
  powerChannel,
  temperatureChannel,
];

/** The channels an indoor trainer ride records: the same, minus position. */
const INDOOR_CHANNELS: readonly RecordChannel[] = [
  timestampChannel,
  altitudeChannel,
  distanceChannel,
  speedChannel,
  heartRateChannel,
  cadenceChannel,
  powerChannel,
  temperatureChannel,
];

/** A run of samples that share one timer segment, and become one lap. */
export interface RideSegment {
  readonly samples: readonly RideSample[];
}

export interface ActivityFileSpecification {
  readonly channels: readonly RecordChannel[];
  readonly segments: readonly RideSegment[];
  /** Fields whose value should be the base type's invalid marker, by sample index. */
  readonly dropoutSampleIndices?: ReadonlySet<number>;
  readonly developerField?: {
    readonly definition: DeveloperFieldDefinition;
    readonly fieldName: string;
    readonly units: string;
    readonly baseType: number;
    readonly value: (sample: RideSample) => FieldValue;
  };
  readonly truncateDataToBytes?: number;
}

/**
 * Assemble a complete FIT activity file.
 *
 * The message order is the one a head unit writes and a decoder expects:
 * `file_id` first because it says what the file is, then `device_info`, then a
 * timer `start` event, then the records of the segment, then a `stop` event and
 * the `lap` that closed with it, repeating per segment, then one `session` and
 * one `activity`.
 */
export function buildActivityFile(specification: ActivityFileSpecification) {
  const builder = new FitFileBuilder();
  const { channels, segments } = specification;
  const dropouts = specification.dropoutSampleIndices ?? new Set<number>();
  const developerField = specification.developerField;

  builder.definition(LOCAL.fileId, GLOBAL_MESSAGE.fileId, [
    { number: FIELD.fileId.type, size: 1, baseType: BASE_TYPE.enum },
    { number: FIELD.fileId.manufacturer, size: 2, baseType: BASE_TYPE.uint16 },
    { number: FIELD.fileId.product, size: 2, baseType: BASE_TYPE.uint16 },
    { number: FIELD.fileId.serialNumber, size: 4, baseType: BASE_TYPE.uint32z },
    { number: FIELD.fileId.timeCreated, size: 4, baseType: BASE_TYPE.uint32 },
  ]);
  builder.data(LOCAL.fileId, [
    { kind: 'u8', value: ENUM_VALUE.fileTypeActivity },
    { kind: 'u16', value: DEVELOPMENT_MANUFACTURER_ID },
    { kind: 'u16', value: 1 },
    { kind: 'u32', value: 0x00c0ffee },
    { kind: 'u32', value: FIT_START_TIMESTAMP },
  ]);

  builder.definition(LOCAL.deviceInfo, GLOBAL_MESSAGE.deviceInfo, [
    { number: FIELD.timestamp, size: 4, baseType: BASE_TYPE.uint32 },
    { number: FIELD.deviceInfo.deviceIndex, size: 1, baseType: BASE_TYPE.uint8 },
    { number: FIELD.deviceInfo.manufacturer, size: 2, baseType: BASE_TYPE.uint16 },
    { number: FIELD.deviceInfo.serialNumber, size: 4, baseType: BASE_TYPE.uint32z },
    { number: FIELD.deviceInfo.product, size: 2, baseType: BASE_TYPE.uint16 },
    { number: FIELD.deviceInfo.softwareVersion, size: 2, baseType: BASE_TYPE.uint16 },
  ]);
  builder.data(LOCAL.deviceInfo, [
    { kind: 'u32', value: FIT_START_TIMESTAMP },
    { kind: 'u8', value: 0 },
    { kind: 'u16', value: DEVELOPMENT_MANUFACTURER_ID },
    { kind: 'u32', value: 0x00c0ffee },
    { kind: 'u16', value: 1 },
    { kind: 'u16', value: 100 },
  ]);

  if (developerField) {
    builder.definition(LOCAL.developerDataId, GLOBAL_MESSAGE.developerDataId, [
      { number: FIELD.developerDataId.applicationId, size: 16, baseType: BASE_TYPE.byte },
      { number: FIELD.developerDataId.manufacturerId, size: 2, baseType: BASE_TYPE.uint16 },
      { number: FIELD.developerDataId.developerDataIndex, size: 1, baseType: BASE_TYPE.uint8 },
      { number: FIELD.developerDataId.applicationVersion, size: 4, baseType: BASE_TYPE.uint32 },
    ]);
    builder.data(LOCAL.developerDataId, [
      // Sixteen fixed bytes, not a UUID from a generator: an application id
      // that changed between runs would move the fixture's bytes.
      {
        kind: 'raw',
        value: [
          0x4f, 0x59, 0x4c, 0x2d, 0x46, 0x49, 0x58, 0x54, 0x55, 0x52, 0x45, 0x2d, 0x30, 0x30, 0x30,
          0x31,
        ],
      },
      { kind: 'u16', value: DEVELOPMENT_MANUFACTURER_ID },
      { kind: 'u8', value: developerField.definition.developerDataIndex },
      { kind: 'u32', value: 1 },
    ]);

    builder.definition(LOCAL.fieldDescription, GLOBAL_MESSAGE.fieldDescription, [
      { number: FIELD.fieldDescription.developerDataIndex, size: 1, baseType: BASE_TYPE.uint8 },
      { number: FIELD.fieldDescription.fieldDefinitionNumber, size: 1, baseType: BASE_TYPE.uint8 },
      { number: FIELD.fieldDescription.fitBaseTypeId, size: 1, baseType: BASE_TYPE.uint8 },
      { number: FIELD.fieldDescription.fieldName, size: 24, baseType: BASE_TYPE.string },
      { number: FIELD.fieldDescription.units, size: 8, baseType: BASE_TYPE.string },
    ]);
    builder.data(LOCAL.fieldDescription, [
      { kind: 'u8', value: developerField.definition.developerDataIndex },
      { kind: 'u8', value: developerField.definition.number },
      { kind: 'u8', value: developerField.baseType },
      { kind: 'string', value: developerField.fieldName, size: 24 },
      { kind: 'string', value: developerField.units, size: 8 },
    ]);
  }

  builder.definition(LOCAL.event, GLOBAL_MESSAGE.event, [
    { number: FIELD.timestamp, size: 4, baseType: BASE_TYPE.uint32 },
    { number: FIELD.event.event, size: 1, baseType: BASE_TYPE.enum },
    { number: FIELD.event.eventType, size: 1, baseType: BASE_TYPE.enum },
    { number: FIELD.event.data, size: 4, baseType: BASE_TYPE.uint32 },
  ]);

  builder.definition(
    LOCAL.record,
    GLOBAL_MESSAGE.record,
    channels.flatMap((channel) => channel.fields),
    developerField ? [developerField.definition] : [],
  );

  builder.definition(LOCAL.lap, GLOBAL_MESSAGE.lap, [
    { number: FIELD.timestamp, size: 4, baseType: BASE_TYPE.uint32 },
    { number: FIELD.messageIndex, size: 2, baseType: BASE_TYPE.uint16 },
    { number: FIELD.lap.startTime, size: 4, baseType: BASE_TYPE.uint32 },
    { number: FIELD.lap.totalElapsedTime, size: 4, baseType: BASE_TYPE.uint32 },
    { number: FIELD.lap.totalTimerTime, size: 4, baseType: BASE_TYPE.uint32 },
    { number: FIELD.lap.totalDistance, size: 4, baseType: BASE_TYPE.uint32 },
  ]);

  let lastTimestamp = FIT_START_TIMESTAMP;
  let lastDistanceCentimetres = 0;

  segments.forEach((segment, segmentIndex) => {
    const first = segment.samples.at(0);
    const last = segment.samples.at(-1);
    if (!first || !last) {
      throw new Error(`segment ${String(segmentIndex)} has no samples`);
    }

    builder.data(LOCAL.event, [
      { kind: 'u32', value: first.fitTimestamp },
      { kind: 'u8', value: ENUM_VALUE.eventTimer },
      { kind: 'u8', value: ENUM_VALUE.eventTypeStart },
      { kind: 'u32', value: 0 },
    ]);

    for (const sample of segment.samples) {
      const values = channels.flatMap((channel) =>
        dropouts.has(sample.index) ? invalidate(channel, sample) : channel.values(sample),
      );
      builder.data(LOCAL.record, [
        ...values,
        ...(developerField ? [developerField.value(sample)] : []),
      ]);
    }

    builder.data(LOCAL.event, [
      { kind: 'u32', value: last.fitTimestamp },
      { kind: 'u8', value: ENUM_VALUE.eventTimer },
      { kind: 'u8', value: ENUM_VALUE.eventTypeStop },
      { kind: 'u32', value: 0 },
    ]);

    builder.data(LOCAL.lap, [
      { kind: 'u32', value: last.fitTimestamp },
      { kind: 'u16', value: segmentIndex },
      { kind: 'u32', value: first.fitTimestamp },
      // Elapsed time runs from the previous lap's end, so it includes the pause.
      // Timer time counts only this segment. The two differ by the pause, which
      // is the distinction the paused-laps fixture exists to pin.
      { kind: 'u32', value: (last.fitTimestamp - lastTimestamp) * SCALE.time },
      { kind: 'u32', value: (last.fitTimestamp - first.fitTimestamp) * SCALE.time },
      { kind: 'u32', value: last.distanceCentimetres - lastDistanceCentimetres },
    ]);

    lastTimestamp = last.fitTimestamp;
    lastDistanceCentimetres = last.distanceCentimetres;
  });

  const firstSample = segments.at(0)?.samples.at(0);
  const lastSample = segments.at(-1)?.samples.at(-1);
  if (!firstSample || !lastSample) {
    throw new Error('an activity file needs at least one sample');
  }
  const timerSeconds = segments.reduce((total, segment) => {
    const first = segment.samples.at(0);
    const last = segment.samples.at(-1);
    return total + (first && last ? last.fitTimestamp - first.fitTimestamp : 0);
  }, 0);

  builder.definition(LOCAL.session, GLOBAL_MESSAGE.session, [
    { number: FIELD.timestamp, size: 4, baseType: BASE_TYPE.uint32 },
    { number: FIELD.messageIndex, size: 2, baseType: BASE_TYPE.uint16 },
    { number: FIELD.session.startTime, size: 4, baseType: BASE_TYPE.uint32 },
    { number: FIELD.session.sport, size: 1, baseType: BASE_TYPE.enum },
    { number: FIELD.session.totalElapsedTime, size: 4, baseType: BASE_TYPE.uint32 },
    { number: FIELD.session.totalTimerTime, size: 4, baseType: BASE_TYPE.uint32 },
    { number: FIELD.session.totalDistance, size: 4, baseType: BASE_TYPE.uint32 },
    { number: FIELD.session.numLaps, size: 2, baseType: BASE_TYPE.uint16 },
  ]);
  builder.data(LOCAL.session, [
    { kind: 'u32', value: lastSample.fitTimestamp },
    { kind: 'u16', value: 0 },
    { kind: 'u32', value: firstSample.fitTimestamp },
    { kind: 'u8', value: ENUM_VALUE.sportCycling },
    { kind: 'u32', value: (lastSample.fitTimestamp - firstSample.fitTimestamp) * SCALE.time },
    { kind: 'u32', value: timerSeconds * SCALE.time },
    { kind: 'u32', value: lastSample.distanceCentimetres },
    { kind: 'u16', value: segments.length },
  ]);

  builder.definition(LOCAL.activity, GLOBAL_MESSAGE.activity, [
    { number: FIELD.timestamp, size: 4, baseType: BASE_TYPE.uint32 },
    { number: FIELD.activity.totalTimerTime, size: 4, baseType: BASE_TYPE.uint32 },
    { number: FIELD.activity.numSessions, size: 2, baseType: BASE_TYPE.uint16 },
    { number: FIELD.activity.type, size: 1, baseType: BASE_TYPE.enum },
    { number: FIELD.activity.localTimestamp, size: 4, baseType: BASE_TYPE.uint32 },
  ]);
  builder.data(LOCAL.activity, [
    { kind: 'u32', value: lastSample.fitTimestamp },
    { kind: 'u32', value: timerSeconds * SCALE.time },
    { kind: 'u16', value: 1 },
    { kind: 'u8', value: ENUM_VALUE.activityTypeManual },
    { kind: 'u32', value: lastSample.fitTimestamp },
  ]);

  return builder.finish(
    specification.truncateDataToBytes === undefined
      ? {}
      : { truncateDataToBytes: specification.truncateDataToBytes },
  );
}

/**
 * Replace a sample's sensor channels with each base type's invalid marker.
 *
 * Position, timestamp, distance and altitude are left alone: a dropped strap
 * does not stop the GPS. The point of the fixture is that "the sensor was not
 * reporting" and "the sensor reported zero" are different facts, and a decoder
 * that maps `0xFF` to 255 bpm or to 0 bpm has lost the difference either way.
 */
function invalidate(channel: RecordChannel, sample: RideSample): readonly FieldValue[] {
  const first = channel.fields.at(0);
  const droppable: readonly number[] = [
    FIELD.record.heartRate,
    FIELD.record.cadence,
    FIELD.record.power,
  ];
  if (!first || !droppable.includes(first.number) || channel.fields.length !== 1) {
    return channel.values(sample);
  }
  switch (first.size) {
    case 1:
      return [{ kind: 'u8', value: INVALID_VALUE.uint8 }];
    case 2:
      return [{ kind: 'u16', value: INVALID_VALUE.uint16 }];
    default:
      return channel.values(sample);
  }
}

export const NULL_ISLAND_TRACK = {
  // Starts south-west of 0, 0 and walks north-east through it, so one fixture
  // carries a negative latitude, a negative longitude, both zeros and both
  // positive signs. A sign bug cannot survive this track and cannot be seen at
  // all in one that stays in a single quadrant.
  startLatitudeE7: -180_000,
  startLongitudeE7: -180_000,
  latitudeStepE7: 3_000,
  longitudeStepE7: 3_000,
};

export const ANTIMERIDIAN_TRACK = {
  // Walks east from 179.98 E, crosses +180 at sample 20 and continues at
  // 179.99 W. In semicircles that is the step from 2^31 - 1 to -2^31: the
  // largest positive sint32 to the most negative, one sample apart.
  startLatitudeE7: 4_000_000,
  startLongitudeE7: 1_799_800_000,
  latitudeStepE7: 200,
  longitudeStepE7: 10_000,
};

export const POINT_NEMO_TRACK = {
  // Both coordinates negative for the whole ride, and neither passes through
  // zero. A transposition here is caught by range, a sign error is not.
  startLatitudeE7: -485_000_000,
  startLongitudeE7: -1_235_000_000,
  latitudeStepE7: 2_000,
  longitudeStepE7: 3_000,
};

export function nominalOutdoorRide() {
  return buildActivityFile({
    channels: OUTDOOR_CHANNELS,
    segments: [{ samples: rideSamples({ sampleCount: 120, track: NULL_ISLAND_TRACK }) }],
  });
}

export function indoorTrainerRide() {
  return buildActivityFile({
    channels: INDOOR_CHANNELS,
    segments: [{ samples: rideSamples({ sampleCount: 120, track: undefined }) }],
  });
}

export function pausedLapsRide() {
  const first = rideSamples({ sampleCount: 60, track: NULL_ISLAND_TRACK });
  const second = rideSamples({
    sampleCount: 60,
    track: NULL_ISLAND_TRACK,
    // 300 s of wall clock passes with no records in it: the rider stopped at a
    // junction and the head unit auto-paused. Elapsed time counts it, moving
    // time does not, and the channels continue where they left off rather than
    // restarting.
    startOffsetSeconds: 359,
    channelOffset: 59,
    startDistanceMetres: 0,
  });
  return buildActivityFile({
    channels: OUTDOOR_CHANNELS,
    segments: [{ samples: first }, { samples: second }],
  });
}

export function sensorDropoutRide() {
  return buildActivityFile({
    channels: OUTDOOR_CHANNELS,
    segments: [{ samples: rideSamples({ sampleCount: 90, track: NULL_ISLAND_TRACK }) }],
    // Thirty consecutive seconds with no heart rate, cadence or power, and an
    // uninterrupted position and timestamp either side of the hole.
    dropoutSampleIndices: new Set(Array.from({ length: 30 }, (_, offset) => 30 + offset)),
  });
}

export function antimeridianRide() {
  return buildActivityFile({
    channels: OUTDOOR_CHANNELS,
    segments: [{ samples: rideSamples({ sampleCount: 40, track: ANTIMERIDIAN_TRACK }) }],
  });
}

export function pointNemoRide() {
  return buildActivityFile({
    channels: OUTDOOR_CHANNELS,
    segments: [{ samples: rideSamples({ sampleCount: 60, track: POINT_NEMO_TRACK }) }],
  });
}

export function truncatedMidRecordRide() {
  const specification: ActivityFileSpecification = {
    channels: OUTDOOR_CHANNELS,
    segments: [{ samples: rideSamples({ sampleCount: 40, track: NULL_ISLAND_TRACK }) }],
  };
  // Cut *inside* a record data message rather than between two, and located
  // from the builder's own record of where each message started rather than by
  // a magic number, so it stays mid-record if the ride model ever changes.
  const whole = buildActivityFile(specification);
  const recordStarts = whole.dataMessageStarts.filter(
    (start) => start.localMessageType === LOCAL.record,
  );
  const cutInside = recordStarts.at(30);
  if (!cutInside) {
    throw new Error('the truncated fixture needs at least 31 record messages to cut inside one');
  }
  // Nine data bytes in: past the record header, past the four-byte timestamp,
  // and exactly at the end of the latitude field — so the latitude is whole and
  // the longitude beside it is missing entirely. `dataMessageStarts` is measured
  // from the start of the file and `truncateDataToBytes` counts data bytes, so
  // the header has to come off. The header still claims the full data size and
  // there is no trailing CRC, which is what a head unit whose battery died
  // actually leaves behind.
  return buildActivityFile({
    ...specification,
    truncateDataToBytes: cutInside.offset - FIT_HEADER_SIZE + 9,
  });
}

export function developerFieldsRide() {
  return buildActivityFile({
    channels: OUTDOOR_CHANNELS,
    segments: [{ samples: rideSamples({ sampleCount: 30, track: NULL_ISLAND_TRACK }) }],
    developerField: {
      definition: { number: 0, size: 2, developerDataIndex: 0 },
      // A field name this program has never heard of, from an application it
      // has never heard of. It must be carried or skipped, never fatal.
      fieldName: 'Doubtfulness Index',
      units: 'dbt',
      baseType: BASE_TYPE.uint16,
      value: (sample) => ({ kind: 'u16', value: 1000 + (sample.index % 97) }),
    },
  });
}

export function heartRate16BitRide() {
  return buildActivityFile({
    channels: [
      timestampChannel,
      positionChannel,
      distanceChannel,
      heartRate16BitChannel,
      cadenceChannel,
      powerChannel,
    ],
    segments: [{ samples: rideSamples({ sampleCount: 30, track: NULL_ISLAND_TRACK }) }],
  });
}

/**
 * `date_time` at and around the 1989-12-31 epoch boundary.
 *
 * `date_time` is a `uint32`, so a value *below* the epoch cannot be written at
 * all — the boundary is a floor in the encoding, not a value in it. That is the
 * point: the rejection has to happen on the encode side, where a Unix instant
 * before 1989-12-31 would otherwise be written as a negative number into an
 * unsigned field and reappear as a date sixty years in the future.
 * `packages/domain`'s `unixSecondsToFitTimestamp` already throws for it, and
 * `timestamp-epoch-boundary.test.ts` pins that here so #31 cannot lose it.
 *
 * What this file carries is the decode side of the same boundary: 0, which is
 * the epoch itself and is legitimate; 1; the top of the reserved system-time
 * range and the first value above it, which is where a `date_time` stops
 * meaning "seconds since power-on" and starts meaning an instant; and
 * `0xFFFFFFFF`, the invalid marker, which is not a date at all.
 */
export function timestampEpochBoundaryRide() {
  const builder = new FitFileBuilder();
  builder.definition(LOCAL.fileId, GLOBAL_MESSAGE.fileId, [
    { number: FIELD.fileId.type, size: 1, baseType: BASE_TYPE.enum },
    { number: FIELD.fileId.manufacturer, size: 2, baseType: BASE_TYPE.uint16 },
    { number: FIELD.fileId.timeCreated, size: 4, baseType: BASE_TYPE.uint32 },
  ]);
  builder.data(LOCAL.fileId, [
    { kind: 'u8', value: ENUM_VALUE.fileTypeActivity },
    { kind: 'u16', value: DEVELOPMENT_MANUFACTURER_ID },
    { kind: 'u32', value: 0 },
  ]);

  builder.definition(LOCAL.record, GLOBAL_MESSAGE.record, [
    { number: FIELD.timestamp, size: 4, baseType: BASE_TYPE.uint32 },
    { number: FIELD.record.heartRate, size: 1, baseType: BASE_TYPE.uint8 },
  ]);
  const timestamps = [0, 1, 0x0fffffff, 0x10000000, 0xffffffff];
  timestamps.forEach((timestamp, index) => {
    builder.data(LOCAL.record, [
      { kind: 'u32', value: timestamp },
      { kind: 'u8', value: 120 + index },
    ]);
  });
  return builder.finish();
}

/**
 * A 1/1024 s event-time counter that wraps.
 *
 * `hr.event_timestamp` is FIT's 1/1024 s event time, the same tick rate the
 * CSCS and CPS wheel and crank event times use over BLE (#41). This fixture
 * declares it as the `uint16` the underlying counter actually is and walks it
 * across the rollover at 65 536 ticks — 64 s at 1024 Hz — so the readings go
 * 64 512, 65 024, 65 500, 12, 524. A consumer that subtracts consecutive
 * readings gets -65 488 ticks once per minute and computes a negative cadence;
 * one that applies `packages/domain`'s `unsignedCounterDelta` with a modulus of
 * 65 536 gets 48 ticks, which is the right answer.
 *
 * The `uint16` declaration is a deliberate deviation and it is legal: a
 * definition message carries each field's size and base type. It is what makes
 * the wrap visible in the bytes instead of hidden inside an accumulator.
 */
export function eventTimestampWrapFile() {
  const builder = new FitFileBuilder();
  builder.definition(LOCAL.fileId, GLOBAL_MESSAGE.fileId, [
    { number: FIELD.fileId.type, size: 1, baseType: BASE_TYPE.enum },
    { number: FIELD.fileId.manufacturer, size: 2, baseType: BASE_TYPE.uint16 },
    { number: FIELD.fileId.timeCreated, size: 4, baseType: BASE_TYPE.uint32 },
  ]);
  builder.data(LOCAL.fileId, [
    { kind: 'u8', value: ENUM_VALUE.fileTypeActivity },
    { kind: 'u16', value: DEVELOPMENT_MANUFACTURER_ID },
    { kind: 'u32', value: FIT_START_TIMESTAMP },
  ]);

  builder.definition(LOCAL.heartRate, GLOBAL_MESSAGE.hr, [
    { number: FIELD.timestamp, size: 4, baseType: BASE_TYPE.uint32 },
    { number: FIELD.hr.eventTimestamp, size: 2, baseType: BASE_TYPE.uint16 },
  ]);

  // Half a second of ticks apart, walked over the rollover twice so a consumer
  // cannot pass by handling the first wrap as a special case.
  const step = EVENT_TICKS_PER_SECOND_1024 / 2;
  for (let index = 0; index < 300; index += 1) {
    builder.data(LOCAL.heartRate, [
      { kind: 'u32', value: FIT_START_TIMESTAMP + Math.floor(index / 2) },
      { kind: 'u16', value: (64_512 + index * step) % UINT16_MODULUS },
    ]);
  }
  return builder.finish();
}

/** A file with nothing in it, which is what a failed write leaves on disk. */
export function zeroLengthFile() {
  return { bytes: new Uint8Array(0), positionOffsets: [], dataMessageStarts: [] };
}

/** A valid 14-byte header claiming zero data, plus the file CRC. Nothing else. */
export function headerOnlyFile() {
  return new FitFileBuilder().finish();
}
