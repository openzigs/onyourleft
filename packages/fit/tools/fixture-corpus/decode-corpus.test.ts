// SPDX-License-Identifier: Apache-2.0

/**
 * The decoder read against the **committed** #29 corpus, field by field.
 *
 * #30's first acceptance criterion: *"Every fixture from #29 decodes to the
 * expected activity, asserted field by field."*
 *
 * Two things make this a real check rather than a tautology, and both are
 * `fixtures/README.md` §6's own requirements:
 *
 * 1. **The bytes come off disk**, not from the generator's return value. What
 *    is asserted is the artefact that is committed and that CI checks out.
 * 2. **The expectations come from the generator's ride model, not from the
 *    decoder.** `rideSamples` is a closed-form function of the sample index,
 *    written before any decoder existed, and it and the decoder's profile were
 *    arrived at independently — *"#30's decoder must be able to disagree with
 *    this generator"*. The last block below asserts they do not, which is the
 *    disagreement made visible rather than shared.
 *
 * This file lives under `tools/` because it reads files off disk and
 * `packages/fit/src` is compiled with no platform surface at all. The decoder
 * it exercises has no such dependency; the harness around it does.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  degreesLatitude,
  degreesLatitudeToSemicircles,
  degreesLongitude,
  degreesLongitudeToSemicircles,
  fitAltitudeToMetres,
  FIT_EPOCH_UNIX_SECONDS,
  FIT_SYSTEM_TIME_MAX,
  semicirclesToPosition,
  UINT16_MODULUS,
  unsignedCounterDelta,
  unixSeconds,
} from '@onyourleft/domain';
import type { GeographicPosition } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import type { FitDateTime, FitRecord } from '../../src/decode';
import {
  decodeFitActivity,
  EVENT_TIMER,
  EVENT_TYPE_START,
  EVENT_TYPE_STOP,
  FIELD,
  FILE_TYPE_ACTIVITY,
  fitCrc16,
  GLOBAL_MESSAGE,
  SPORT_CYCLING,
} from '../../src/decode';
import { CORPUS_DIRECTORY } from './corpus-files';
import { fitCrc16 as generatorCrc16 } from './fit-crc';
import { ANTIMERIDIAN_TRACK, NULL_ISLAND_TRACK, POINT_NEMO_TRACK } from './fit-fixtures';
import {
  ENUM_VALUE as GENERATOR_ENUM_VALUE,
  FIELD as GENERATOR_FIELD,
  GLOBAL_MESSAGE as GENERATOR_GLOBAL_MESSAGE,
} from './fit-profile';
import type { RideSample, TrackSpecification } from './ride';
import { RIDE_START_UNIX_SECONDS, rideSamples } from './ride';

function fixture(name: string): Uint8Array {
  return Uint8Array.from(readFileSync(join(CORPUS_DIRECTORY, name)));
}

/** The instant a sample's `date_time` denotes, as the decoder reports it. */
function instantAt(offsetSeconds: number): FitDateTime {
  return { kind: 'instant', instant: unixSeconds(RIDE_START_UNIX_SECONDS + offsetSeconds) };
}

/**
 * The position a sample decodes to.
 *
 * Built by putting the generator's degrees through the same semicircle
 * encoding a FIT file uses, so the comparison is exact rather than
 * approximate: what is being asserted is that the decoder recovered the value
 * the file holds, not that it landed near it.
 */
function positionOf(track: TrackSpecification, index: number): GeographicPosition {
  const latitudeE7 = track.startLatitudeE7 + track.latitudeStepE7 * index;
  let longitudeE7 = track.startLongitudeE7 + track.longitudeStepE7 * index;
  while (longitudeE7 > 1_800_000_000) longitudeE7 -= 3_600_000_000;
  while (longitudeE7 < -1_800_000_000) longitudeE7 += 3_600_000_000;
  return semicirclesToPosition(
    degreesLatitudeToSemicircles(degreesLatitude(latitudeE7 / 1e7)),
    degreesLongitudeToSemicircles(degreesLongitude(longitudeE7 / 1e7)),
  );
}

/** Assert one record against the sample the generator wrote it from. */
function expectRecordMatches(
  record: FitRecord | undefined,
  sample: RideSample,
  track: TrackSpecification | undefined,
  channelIndex: number,
): void {
  expect(record).toBeDefined();
  if (!record) return;
  expect(record.timestamp).toEqual({
    kind: 'instant',
    instant: sample.fitTimestamp + FIT_EPOCH_UNIX_SECONDS,
  });
  expect(record.position).toEqual(track ? positionOf(track, channelIndex) : undefined);
  expect(record.altitude).toBe(fitAltitudeToMetres(sample.fitAltitude));
  expect(record.distance).toBe(sample.distanceCentimetres / 100);
  expect(record.speed).toBe(sample.speedMillimetresPerSecond / 1000);
  expect(record.heartRate).toBe(sample.heartRate);
  expect(record.cadence).toBe(sample.cadence);
  expect(record.power).toBe(sample.power);
  expect(record.temperature).toBe(sample.temperature);
}

describe('nominal-outdoor-ride.fit', () => {
  const { activity, faults } = decodeFitActivity(fixture('nominal-outdoor-ride.fit'));
  const samples = rideSamples({ sampleCount: 120, track: NULL_ISLAND_TRACK });

  it('decodes cleanly', () => {
    expect(faults).toEqual([]);
    expect([...activity.skippedGlobalMessages.keys()]).toEqual([]);
  });

  it('reads the file_id a head unit writes first', () => {
    expect(activity.fileId).toEqual({
      type: 4,
      manufacturer: 255,
      product: 1,
      serialNumber: 0x00c0ffee,
      timeCreated: instantAt(0),
    });
  });

  it('reads the device_info', () => {
    expect(activity.deviceInfos).toHaveLength(1);
    expect(activity.deviceInfos.at(0)).toEqual({
      timestamp: instantAt(0),
      deviceIndex: 0,
      manufacturer: 255,
      serialNumber: 0x00c0ffee,
      product: 1,
      softwareVersion: 100,
    });
  });

  it('reads every record, field by field', () => {
    expect(activity.records).toHaveLength(120);
    samples.forEach((sample, index) => {
      expectRecordMatches(activity.records.at(index), sample, NULL_ISLAND_TRACK, index);
    });
  });

  it('reads the timer events that bracket the ride', () => {
    expect(activity.events.map((event) => [event.event, event.eventType])).toEqual([
      [0, 0],
      [0, 1],
    ]);
    expect(activity.events.at(0)?.timestamp).toEqual(instantAt(0));
    expect(activity.events.at(-1)?.timestamp).toEqual(instantAt(119));
  });

  it('reads the lap, the session and the activity summary', () => {
    expect(activity.laps).toHaveLength(1);
    expect(activity.laps.at(0)).toEqual({
      timestamp: instantAt(119),
      messageIndex: 0,
      startTime: instantAt(0),
      totalElapsedTime: 119,
      totalTimerTime: 119,
      totalDistance: (samples.at(-1)?.distanceCentimetres ?? 0) / 100,
    });
    expect(activity.sessions).toHaveLength(1);
    expect(activity.sessions.at(0)).toMatchObject({
      sport: SPORT_CYCLING,
      numLaps: 1,
      totalElapsedTime: 119,
      totalTimerTime: 119,
      startTime: instantAt(0),
    });
    expect(activity.summary).toMatchObject({
      numSessions: 1,
      totalTimerTime: 119,
      timestamp: instantAt(119),
    });
  });

  it('carries no developer fields', () => {
    expect(activity.developerApplications).toEqual([]);
    expect(activity.developerFieldDescriptions).toEqual([]);
    expect(activity.records.every((record) => record.developerFields.length === 0)).toBe(true);
  });
});

describe('indoor-trainer-no-position.fit', () => {
  const { activity, faults } = decodeFitActivity(fixture('indoor-trainer-no-position.fit'));
  const samples = rideSamples({ sampleCount: 120, track: undefined });

  it('decodes cleanly', () => {
    expect(faults).toEqual([]);
  });

  /**
   * #30's fifth criterion. `null` island is a real place in the fixtures — the
   * corpus rides there on purpose — so "position absent" and "position at 0, 0"
   * are genuinely different answers here and the wrong one is not obviously
   * wrong.
   */
  it('has an absent position channel, not a channel of zeros', () => {
    expect(activity.records).toHaveLength(120);
    for (const record of activity.records) {
      expect(record.position).toBeUndefined();
    }
    expect(activity.records.some((record) => record.position !== undefined)).toBe(false);
  });

  it('reads every other channel, field by field', () => {
    samples.forEach((sample, index) => {
      expectRecordMatches(activity.records.at(index), sample, undefined, index);
    });
  });
});

describe('paused-laps.fit', () => {
  const { activity, faults } = decodeFitActivity(fixture('paused-laps.fit'));

  it('decodes cleanly and finds both laps', () => {
    expect(faults).toEqual([]);
    expect(activity.records).toHaveLength(120);
    expect(activity.laps).toHaveLength(2);
  });

  /**
   * The five-minute error. Elapsed time counts the pause and timer time does
   * not, and a decoder that reports one as the other is wrong by exactly the
   * pause with nothing else in the file contradicting it.
   */
  it('keeps elapsed time and timer time apart across the pause', () => {
    expect(activity.laps.at(0)).toMatchObject({ totalElapsedTime: 59, totalTimerTime: 59 });
    expect(activity.laps.at(1)).toMatchObject({ totalElapsedTime: 359, totalTimerTime: 59 });
    expect(activity.sessions.at(0)).toMatchObject({
      numLaps: 2,
      totalElapsedTime: 418,
      totalTimerTime: 118,
    });
    expect(activity.summary?.totalTimerTime).toBe(118);
  });

  it('leaves a 300 second hole in the record timestamps', () => {
    const first = activity.records.at(59)?.timestamp;
    const second = activity.records.at(60)?.timestamp;
    expect(first?.kind).toBe('instant');
    expect(second?.kind).toBe('instant');
    const gap =
      second?.kind === 'instant' && first?.kind === 'instant' ? second.instant - first.instant : 0;
    expect(gap).toBe(300);
  });

  it('brackets each segment with its own timer start and stop', () => {
    expect(activity.events.map((event) => event.eventType)).toEqual([0, 1, 0, 1]);
  });
});

describe('sensor-dropout-30s.fit', () => {
  const { activity, faults } = decodeFitActivity(fixture('sensor-dropout-30s.fit'));
  const samples = rideSamples({ sampleCount: 90, track: NULL_ISLAND_TRACK });

  it('decodes cleanly', () => {
    expect(faults).toEqual([]);
    expect(activity.records).toHaveLength(90);
  });

  /**
   * "The strap was not reporting" and "the rider produced zero watts" are
   * different facts and both average plausibly. `undefined` is the only answer
   * that keeps them apart.
   */
  it('reports the dropout as absent samples, not as zeros and not as 255', () => {
    for (let index = 30; index < 60; index += 1) {
      const record = activity.records.at(index);
      expect(record?.heartRate).toBeUndefined();
      expect(record?.cadence).toBeUndefined();
      expect(record?.power).toBeUndefined();
    }
  });

  it('leaves position, timestamp, altitude, distance and speed uninterrupted through it', () => {
    for (let index = 30; index < 60; index += 1) {
      const sample = samples.at(index);
      const record = activity.records.at(index);
      expect(record?.position).toEqual(positionOf(NULL_ISLAND_TRACK, index));
      expect(record?.timestamp).toEqual(instantAt(index));
      expect(record?.distance).toBe((sample?.distanceCentimetres ?? -1) / 100);
      expect(record?.speed).toBe((sample?.speedMillimetresPerSecond ?? -1) / 1000);
    }
  });

  it('reads the samples either side of the hole in full', () => {
    for (const index of [0, 29, 60, 89]) {
      const sample = samples.at(index);
      expect(sample).toBeDefined();
      if (sample) expectRecordMatches(activity.records.at(index), sample, NULL_ISLAND_TRACK, index);
    }
  });
});

describe('antimeridian-crossing.fit', () => {
  const { activity, faults } = decodeFitActivity(fixture('antimeridian-crossing.fit'));

  it('decodes every position, field by field', () => {
    expect(faults).toEqual([]);
    expect(activity.records).toHaveLength(40);
    activity.records.forEach((record, index) => {
      expect(record.position).toEqual(positionOf(ANTIMERIDIAN_TRACK, index));
    });
  });

  /**
   * In semicircles the longitude steps from near 2^31 - 1 to near -2^31
   * between two consecutive records. A decoder reading the field as `uint32`
   * produces a track spanning the whole map, and every individual coordinate
   * still looks legal.
   */
  it('crosses from east to west without the sign getting lost', () => {
    const longitudes = activity.records.map((record) => record.position?.longitude);
    const crossings = longitudes.filter(
      (longitude, index) => index > 0 && (longitudes[index - 1] ?? 0) > 0 && (longitude ?? 0) < 0,
    );
    expect(crossings).toHaveLength(1);
    expect(longitudes.at(20)).toBeGreaterThan(179.9);
    expect(longitudes.at(21)).toBeLessThan(-179.9);
    // No sample lands on the invalid marker, which would read as an absent
    // position rather than as a point on the line.
    expect(longitudes.every((longitude) => longitude !== undefined)).toBe(true);
  });
});

describe('point-nemo-southern-western.fit', () => {
  const { activity, faults } = decodeFitActivity(fixture('point-nemo-southern-western.fit'));

  it('keeps both coordinates negative for the whole ride', () => {
    expect(faults).toEqual([]);
    expect(activity.records).toHaveLength(60);
    activity.records.forEach((record, index) => {
      expect(record.position).toEqual(positionOf(POINT_NEMO_TRACK, index));
      expect(record.position?.latitude).toBeLessThan(0);
      expect(record.position?.longitude).toBeLessThan(0);
    });
  });
});

describe('truncated-mid-record.fit', () => {
  const bytes = fixture('truncated-mid-record.fit');
  const { activity, faults } = decodeFitActivity(bytes);
  const samples = rideSamples({ sampleCount: 40, track: NULL_ISLAND_TRACK });

  /** #30: it must not discard the whole ride. */
  it('keeps every record that was completely written', () => {
    expect(activity.records).toHaveLength(30);
    samples.slice(0, 30).forEach((sample, index) => {
      expectRecordMatches(activity.records.at(index), sample, NULL_ISLAND_TRACK, index);
    });
  });

  /** #30: it must not silently return an empty activity. */
  it('is not silently empty', () => {
    expect(activity.records.length).toBeGreaterThan(0);
    expect(faults.length).toBeGreaterThan(0);
  });

  /** #30: a structured error naming the byte offset. */
  it('reports a structured error naming the byte offset of the cut', () => {
    expect(faults.map((fault) => fault.code)).toEqual(['truncated-file', 'truncated-record']);

    const declared = faults.at(0);
    expect(declared?.name).toBe('FitDecodeError');
    expect(declared?.byteOffset).toBe(bytes.length);

    const record = faults.at(-1);
    expect(record?.name).toBe('FitDecodeError');
    expect(record?.code).toBe('truncated-record');
    // The incomplete record begins inside the file and its 9 written bytes run
    // out before the 30 the definition declares.
    expect(record?.byteOffset).toBeLessThan(bytes.length);
    expect(record?.byteOffset).toBe(bytes.length - 9);
    expect(record?.message).toContain(String(record?.byteOffset ?? -1));
  });

  it('reads the messages that preceded the records', () => {
    expect(activity.fileId?.type).toBe(4);
    expect(activity.deviceInfos).toHaveLength(1);
    expect(activity.events.at(0)?.eventType).toBe(0);
    // The lap, session and activity messages were never written.
    expect(activity.laps).toEqual([]);
    expect(activity.sessions).toEqual([]);
    expect(activity.summary).toBeUndefined();
  });
});

describe('developer-fields.fit', () => {
  const { activity, faults } = decodeFitActivity(fixture('developer-fields.fit'));

  /** #30's fourth criterion: an unknown developer field must not throw. */
  it('decodes without throwing and without a fault', () => {
    expect(faults).toEqual([]);
    expect(activity.records).toHaveLength(30);
  });

  it('carries the field from an application it has never heard of, on every record', () => {
    activity.records.forEach((record, index) => {
      expect(record.developerFields).toHaveLength(1);
      expect(record.developerFields.at(0)).toMatchObject({
        developerDataIndex: 0,
        fieldDefinitionNumber: 0,
        name: 'Doubtfulness Index',
        units: 'dbt',
        numeric: 1000 + (index % 97),
      });
    });
  });

  it('reads the application that declared it', () => {
    expect(activity.developerApplications).toHaveLength(1);
    expect(activity.developerApplications.at(0)).toMatchObject({
      developerDataIndex: 0,
      manufacturerId: 255,
      applicationVersion: 1,
    });
    expect([...(activity.developerApplications.at(0)?.applicationId ?? [])]).toEqual(
      [...'OYL-FIXTURE-0001'].map((character) => character.charCodeAt(0)),
    );
  });

  it('still reads every native field beside it', () => {
    const samples = rideSamples({ sampleCount: 30, track: NULL_ISLAND_TRACK });
    samples.forEach((sample, index) => {
      expectRecordMatches(activity.records.at(index), sample, NULL_ISLAND_TRACK, index);
    });
  });
});

describe('heart-rate-16-bit.fit', () => {
  const { activity, faults } = decodeFitActivity(fixture('heart-rate-16-bit.fit'));
  const samples = rideSamples({ sampleCount: 30, track: NULL_ISLAND_TRACK });

  /**
   * A definition message carries each field's size and base type rather than
   * inheriting them from the profile. A decoder that hard-codes one byte for
   * heart rate does not merely misread this field — it desynchronises and
   * misreads every field after it, which is why the cadence and power
   * assertions below are the ones that matter.
   */
  it('reads a 16-bit heart rate and stays in step with the fields after it', () => {
    expect(faults).toEqual([]);
    expect(activity.records).toHaveLength(30);
    activity.records.forEach((record, index) => {
      const sample = samples.at(index);
      expect(record.heartRate).toBe(260 + (index % 51));
      expect(record.cadence).toBe(sample?.cadence);
      expect(record.power).toBe(sample?.power);
      expect(record.position).toEqual(positionOf(NULL_ISLAND_TRACK, index));
      expect(record.distance).toBe((sample?.distanceCentimetres ?? -1) / 100);
    });
  });

  it('has no altitude, speed or temperature, because the file declares none', () => {
    for (const record of activity.records) {
      expect(record.altitude).toBeUndefined();
      expect(record.speed).toBeUndefined();
      expect(record.temperature).toBeUndefined();
    }
  });
});

describe('timestamp-epoch-boundary.fit', () => {
  const { activity, faults } = decodeFitActivity(fixture('timestamp-epoch-boundary.fit'));

  it('decodes cleanly', () => {
    expect(faults).toEqual([]);
    expect(activity.records).toHaveLength(5);
  });

  /**
   * `packages/domain`'s `time.ts`: #30 is *"expected to test it and treat the
   * record's time as relative rather than writing a 1989 date into a ride"*.
   */
  it('separates the reserved system-time range from an instant', () => {
    expect(activity.records.map((record) => record.timestamp)).toEqual([
      { kind: 'systemTime', sinceDeviceStart: 0 },
      { kind: 'systemTime', sinceDeviceStart: 1 },
      { kind: 'systemTime', sinceDeviceStart: FIT_SYSTEM_TIME_MAX },
      { kind: 'instant', instant: FIT_SYSTEM_TIME_MAX + 1 + FIT_EPOCH_UNIX_SECONDS },
      // 0xFFFFFFFF is the invalid marker, not a date sixty years hence.
      undefined,
    ]);
  });

  it('reads the heart rate beside each of them, including on the record with no time', () => {
    expect(activity.records.map((record) => record.heartRate)).toEqual([120, 121, 122, 123, 124]);
  });

  it('reads a file_id time_created of zero as the device clock, not as 1989', () => {
    expect(activity.fileId?.timeCreated).toEqual({ kind: 'systemTime', sinceDeviceStart: 0 });
  });
});

describe('event-timestamp-1024-wrap.fit', () => {
  const { activity, faults } = decodeFitActivity(fixture('event-timestamp-1024-wrap.fit'));

  it('decodes every hr message', () => {
    expect(faults).toEqual([]);
    expect(activity.heartRateEvents).toHaveLength(300);
  });

  it('reports the raw counter reading, so the wrap is still visible', () => {
    const readings = activity.heartRateEvents.map((event) => event.eventTimestamp);
    expect(readings.slice(0, 5)).toEqual([64_512, 65_024, 0, 512, 1_024]);
    readings.forEach((reading, index) => {
      expect(reading).toBe((64_512 + index * 512) % UINT16_MODULUS);
    });
  });

  it('gives a constant forward step once unsignedCounterDelta is applied', () => {
    const readings = activity.heartRateEvents.map((event) => event.eventTimestamp ?? -1);
    for (let index = 1; index < readings.length; index += 1) {
      expect(
        unsignedCounterDelta(readings[index - 1] ?? -1, readings[index] ?? -1, UINT16_MODULUS),
      ).toBe(512);
    }
  });
});

describe('zero-length.fit', () => {
  /** What a failed write leaves on disk, and what an empty upload form posts. */
  it('is rejected as too short for a header, not indexed out of bounds', () => {
    const bytes = fixture('zero-length.fit');
    expect(bytes).toHaveLength(0);
    expect(() => decodeFitActivity(bytes)).toThrowError(
      expect.objectContaining({ name: 'FitDecodeError', code: 'file-too-short', byteOffset: 0 }),
    );
  });
});

describe('header-only.fit', () => {
  /**
   * The boundary between "corrupt" and "an activity with no records", which
   * are different errors to a user.
   */
  it('decodes as a valid file with nothing in it', () => {
    const { activity, faults } = decodeFitActivity(fixture('header-only.fit'));
    expect(faults).toEqual([]);
    expect(activity.header.dataSize).toBe(0);
    expect(activity.records).toEqual([]);
    expect(activity.fileId).toBeUndefined();
    expect(activity.summary).toBeUndefined();
  });
});

describe('CRC validation', () => {
  /**
   * #30's sixth criterion. `fixtures/README.md` §6 names a file with a *wrong*
   * CRC as a deliberate gap in the corpus, so the corruption is applied here to
   * the committed bytes of a file that is otherwise valid — which also proves
   * the same bytes decode cleanly when they are not damaged.
   */
  it('rejects a corrupted file, wherever the corruption is', () => {
    const clean = fixture('nominal-outdoor-ride.fit');
    expect(decodeFitActivity(clean).faults).toEqual([]);

    for (const offset of [20, 100, 1000, clean.length - 3]) {
      const damaged = Uint8Array.from(clean);
      damaged[offset] = (damaged[offset] ?? 0) ^ 0x01;
      expect(() => decodeFitActivity(damaged)).toThrowError(
        expect.objectContaining({ name: 'FitDecodeError', code: 'bad-file-crc' }),
      );
    }
  });

  it('rejects a file whose trailing CRC alone was rewritten', () => {
    const damaged = Uint8Array.from(fixture('nominal-outdoor-ride.fit'));
    damaged[damaged.length - 1] = (damaged.at(-1) ?? 0) ^ 0xff;
    expect(() => decodeFitActivity(damaged)).toThrowError(
      expect.objectContaining({ code: 'bad-file-crc' }),
    );
  });

  it('agrees with the generator over every committed FIT fixture', () => {
    // Two implementations of CRC-16/ARC, written from the same published
    // polynomial and never sharing a line. If they disagree, one of them is
    // not the algorithm.
    for (const name of [
      'nominal-outdoor-ride.fit',
      'indoor-trainer-no-position.fit',
      'paused-laps.fit',
      'developer-fields.fit',
      'header-only.fit',
    ]) {
      const bytes = fixture(name);
      expect(fitCrc16(bytes)).toBe(generatorCrc16(bytes));
    }
  });
});

describe('the decoder profile and the generator profile were derived independently', () => {
  /**
   * `fixtures/README.md` §5: *"#30 must re-verify each of these against the
   * public documentation before the decoder relies on it … The two are meant to
   * be independent, so that a disagreement is visible rather than shared."*
   * This is where a disagreement becomes visible.
   */
  it('agrees on every global message number', () => {
    expect(GLOBAL_MESSAGE).toEqual(GENERATOR_GLOBAL_MESSAGE);
  });

  it('agrees on every field definition number both tables carry', () => {
    expect(FIELD.timestamp).toBe(GENERATOR_FIELD.timestamp);
    expect(FIELD.messageIndex).toBe(GENERATOR_FIELD.messageIndex);
    expect(FIELD.fileId).toEqual(GENERATOR_FIELD.fileId);
    expect(FIELD.record).toEqual(GENERATOR_FIELD.record);
    expect(FIELD.event).toEqual(GENERATOR_FIELD.event);
    expect(FIELD.lap).toEqual(GENERATOR_FIELD.lap);
    expect(FIELD.session).toEqual(GENERATOR_FIELD.session);
    expect(FIELD.activity).toEqual(GENERATOR_FIELD.activity);
    expect(FIELD.deviceInfo).toEqual(GENERATOR_FIELD.deviceInfo);
    expect(FIELD.developerDataId).toEqual(GENERATOR_FIELD.developerDataId);
    expect(FIELD.fieldDescription).toEqual(GENERATOR_FIELD.fieldDescription);
    expect(FIELD.hr).toEqual(GENERATOR_FIELD.hr);
  });

  /**
   * #129 finding 6. `FILE_TYPE_ACTIVITY`, `EVENT_TIMER`, `EVENT_TYPE_START` and
   * `EVENT_TYPE_STOP` were exported with **zero readers and zero assertions**,
   * so a wrong value would have propagated into whatever first consumed them
   * rather than surfacing. `SPORT_CYCLING` was already pinned by
   * `nominal-outdoor-ride.fit`'s session assertion; these four were not pinned
   * by anything.
   *
   * The generator's `ENUM_VALUE` table is the independent derivation, exactly
   * as `GLOBAL_MESSAGE` and `FIELD` above.
   */
  it('agrees on every enumerated value both tables carry', () => {
    expect(FILE_TYPE_ACTIVITY).toBe(GENERATOR_ENUM_VALUE.fileTypeActivity);
    expect(SPORT_CYCLING).toBe(GENERATOR_ENUM_VALUE.sportCycling);
    expect(EVENT_TIMER).toBe(GENERATOR_ENUM_VALUE.eventTimer);
    expect(EVENT_TYPE_START).toBe(GENERATOR_ENUM_VALUE.eventTypeStart);
    expect(EVENT_TYPE_STOP).toBe(GENERATOR_ENUM_VALUE.eventTypeStop);
  });
});

/**
 * The same four constants, read back out of committed bytes — #129 finding 6,
 * from the *reading* side.
 *
 * The agreement test above pins two tables against each other. This one pins
 * them against a file: the generator wrote `ENUM_VALUE.fileTypeActivity` into
 * `nominal-outdoor-ride.fit` in 2026, the bytes are committed and CI checks
 * them out, and the decoder reads that byte back. Changing
 * `FILE_TYPE_ACTIVITY` now fails against an artefact rather than against
 * another table that a single edit could move with it.
 *
 * This is the shape #129 says this repository's mutation discipline
 * under-covers: *"values threaded through a data structure for a later
 * consumer"*. The exported constant **is** the later consumer's ground truth,
 * so it needs an assertion that a consumer would make.
 */
describe('the exported profile enumerations name what the committed corpus holds', () => {
  const { activity } = decodeFitActivity(fixture('nominal-outdoor-ride.fit'));

  it('reads file_id.type as FILE_TYPE_ACTIVITY', () => {
    expect(activity.fileId?.type).toBe(FILE_TYPE_ACTIVITY);
  });

  it('reads session.sport as SPORT_CYCLING', () => {
    expect(activity.sessions.at(0)?.sport).toBe(SPORT_CYCLING);
  });

  it('reads the bracketing events as EVENT_TIMER started and stopped', () => {
    expect(activity.events.map((event) => [event.event, event.eventType])).toEqual([
      [EVENT_TIMER, EVENT_TYPE_START],
      [EVENT_TIMER, EVENT_TYPE_STOP],
    ]);
  });

  it('reads all four of paused-laps.fit’s timer events through the same constants', () => {
    // Two start/stop pairs, so `EVENT_TYPE_START` and `EVENT_TYPE_STOP` are
    // each read twice from a second file rather than once from one.
    const paused = decodeFitActivity(fixture('paused-laps.fit')).activity;
    expect(paused.events.map((event) => [event.event, event.eventType])).toEqual([
      [EVENT_TIMER, EVENT_TYPE_START],
      [EVENT_TIMER, EVENT_TYPE_STOP],
      [EVENT_TIMER, EVENT_TYPE_START],
      [EVENT_TIMER, EVENT_TYPE_STOP],
    ]);
  });
});
