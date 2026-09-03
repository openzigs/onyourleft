// SPDX-License-Identifier: Apache-2.0

/**
 * The corpus: every fixture, what it is for, and the bytes of it.
 *
 * This is the list a new case is added to. Ten lines here and a row in
 * `fixtures/README.md` is the whole cost of a new fixture, which is the point
 * of a generator — #30 will want a file for some specific malformed record and
 * should not have to go looking for one.
 *
 * Adding an entry to this list is also the only way a file gets into
 * `fixtures/`. The corpus directory is **closed**: `corpus.test.ts` asserts the
 * directory contains exactly these names and no others, so a real ride file
 * dropped in beside them fails the suite whatever its coordinates are.
 */

import type { PositionFieldOffsets } from './fit-file-builder';
import {
  antimeridianRide,
  ANTIMERIDIAN_TRACK,
  developerFieldsRide,
  eventTimestampWrapFile,
  headerOnlyFile,
  heartRate16BitRide,
  indoorTrainerRide,
  nominalOutdoorRide,
  NULL_ISLAND_TRACK,
  pausedLapsRide,
  pointNemoRide,
  POINT_NEMO_TRACK,
  sensorDropoutRide,
  timestampEpochBoundaryRide,
  truncatedMidRecordRide,
  zeroLengthFile,
} from './fit-fixtures';
import { nominalGpx, nominalTcx, xxeGpx, xxeTcx } from './xml-fixtures';

/**
 * The size the whole corpus must stay under: 256 KiB.
 *
 * Set from the measurement rather than guessed at — the corpus is well under it
 * today and the current total is recorded in `fixtures/README.md` and in
 * `MANIFEST.json`. The budget exists because a fixture corpus is the classic
 * place a repository silently accumulates megabytes: nobody adds ten megabytes,
 * everybody adds two hundred kilobytes. `corpus.test.ts` fails when the total
 * crosses it, which turns "should we commit a 4 MB ride?" into a decision
 * somebody has to make on purpose rather than one that happens.
 */
export const CORPUS_BYTE_BUDGET = 256 * 1024;

/** One fixture in the corpus. */
export interface CorpusEntry {
  readonly name: string;
  readonly format: 'fit' | 'gpx' | 'tcx';
  /** What this file is for. Also the README row — a fixture nobody documented gets deleted. */
  readonly purpose: string;
  readonly bytes: Uint8Array;
  /**
   * Where each position landed in the finished bytes. FIT only; the text
   * formats are scanned for coordinates directly, which needs no offsets.
   */
  readonly positionOffsets: readonly PositionFieldOffsets[];
  /** How many positions this fixture contains. Zero is a valid, meaningful answer. */
  readonly positionCount: number;
}

const utf8 = new TextEncoder();

function fit(
  name: string,
  purpose: string,
  built: { bytes: Uint8Array; positionOffsets: readonly PositionFieldOffsets[] },
): CorpusEntry {
  return {
    name,
    format: 'fit',
    purpose,
    bytes: built.bytes,
    positionOffsets: built.positionOffsets,
    positionCount: built.positionOffsets.length,
  };
}

function xml(
  name: string,
  format: 'gpx' | 'tcx',
  purpose: string,
  built: { text: string; positions: readonly unknown[] },
): CorpusEntry {
  return {
    name,
    format,
    purpose,
    bytes: utf8.encode(built.text),
    positionOffsets: [],
    positionCount: built.positions.length,
  };
}

/** Build every fixture. Pure, deterministic, and the only source of the corpus. */
export function buildCorpus(): readonly CorpusEntry[] {
  return [
    fit(
      'nominal-outdoor-ride.fit',
      'Baseline. 120 records at 1 Hz carrying every channel this product reads: position, ' +
        'altitude, distance, speed, heart rate, cadence, power and temperature, wrapped in the ' +
        'file_id / device_info / event / record / lap / session / activity message order a head ' +
        'unit writes. Every other FIT fixture is this one with something changed.',
      nominalOutdoorRide(),
    ),
    fit(
      'indoor-trainer-no-position.fit',
      'An indoor trainer ride with no position channel at all — not a zeroed one, not one full ' +
        'of invalid markers: the record definition simply does not declare the two fields. Half ' +
        'this product is indoor riding, and a decoder that assumes position exists fails here ' +
        'rather than on a rare file.',
      indoorTrainerRide(),
    ),
    fit(
      'paused-laps.fit',
      'Two laps separated by a 300 s pause with no records in it, each bracketed by timer start ' +
        'and stop events. Elapsed time and moving time differ by the pause, and a decoder that ' +
        'reports one as the other is wrong by five minutes in a way nothing else in the file ' +
        'contradicts.',
      pausedLapsRide(),
    ),
    fit(
      'sensor-dropout-30s.fit',
      'Thirty consecutive seconds with heart rate, cadence and power set to their base types’ ' +
        'invalid markers, with position and timestamps uninterrupted either side. "The strap was ' +
        'not reporting" and "the rider produced zero watts" are different facts and both average ' +
        'plausibly; this is the file that separates them.',
      sensorDropoutRide(),
    ),
    fit(
      'antimeridian-crossing.fit',
      'A track walking east across +180 degrees. In semicircles the longitude steps from ' +
        '2^31 - 1 to -2^31 between two consecutive records — the largest positive sint32 to the ' +
        'most negative. A decoder that reads the field as uint32, or that interpolates across ' +
        'the crossing, produces a track that spans the entire map.',
      antimeridianRide(),
    ),
    fit(
      'point-nemo-southern-western.fit',
      'A ride with negative latitude AND negative longitude throughout, neither crossing zero. ' +
        'A sign error survives every test written with two positive coordinates and puts a ' +
        'European ride in the Southern Ocean; packages/domain learned this in #25 and its ' +
        'position tests all use a negative pair for the same reason.',
      pointNemoRide(),
    ),
    fit(
      'truncated-mid-record.fit',
      'A ride cut off nine bytes into a record message — past the header, past the timestamp, ' +
        'halfway through the latitude field. The file header still claims the full data size and ' +
        'there is no trailing CRC. This is the realistic corruption case: a head unit whose ' +
        'battery died. It must yield a structured error with a byte offset, never a crash and ' +
        'never a silent short read.',
      truncatedMidRecordRide(),
    ),
    fit(
      'developer-fields.fit',
      'A developer_data_id and a field_description declaring a field from an application this ' +
        'program has never heard of, carried on every record message. FIT is extensible by ' +
        'design and an unknown developer field must be carried or skipped, never fatal.',
      developerFieldsRide(),
    ),
    fit(
      'heart-rate-16-bit.fit',
      'record.heart_rate declared as a uint16 with values from 260 to 310. Legal: a definition ' +
        'message carries each field’s size and base type rather than inheriting them from the ' +
        'profile. A decoder that hard-codes one byte for heart rate does not merely misread this ' +
        'field, it desynchronises and misreads every field after it.',
      heartRate16BitRide(),
    ),
    fit(
      'timestamp-epoch-boundary.fit',
      'date_time values at 0 (the FIT epoch, 1989-12-31, and legitimate), 1, the top of the ' +
        'reserved system-time range, the first value above it, and 0xFFFFFFFF (invalid). A value ' +
        'below the epoch cannot be written into a uint32 at all, which is why the rejection ' +
        'belongs on the encode side — see the note in fit-fixtures.ts and the test that pins it.',
      timestampEpochBoundaryRide(),
    ),
    fit(
      'event-timestamp-1024-wrap.fit',
      'An hr.event_timestamp counter at 1/1024 s, declared as the uint16 the counter actually is ' +
        'and walked twice across its rollover at 65 536 ticks. Subtracting consecutive readings ' +
        'gives -65 488 once a minute and a negative cadence; packages/domain’s ' +
        'unsignedCounterDelta gives the right answer. #41 depends on this being handled.',
      eventTimestampWrapFile(),
    ),
    fit(
      'zero-length.fit',
      'Nothing at all: zero bytes. What a failed write leaves on disk, and what an empty upload ' +
        'form posts. Must be rejected as too short for a header, not indexed out of bounds.',
      zeroLengthFile(),
    ),
    fit(
      'header-only.fit',
      'A valid 14-byte header declaring zero data bytes, its header CRC and the file CRC, and ' +
        'nothing else. Structurally valid and semantically empty — the boundary between "corrupt" ' +
        'and "an activity with no records", which are different errors to a user.',
      headerOnlyFile(),
    ),
    xml(
      'nominal-ride.gpx',
      'gpx',
      'Baseline GPX 1.1: 30 track points with elevation, time and the TrackPointExtension heart ' +
        'rate and cadence a cycling file carries. The same track as the nominal FIT fixture, so a ' +
        'GPX import can be compared against the first 30 records of the binary one, point for point.',
      nominalGpx(NULL_ISLAND_TRACK, 30),
    ),
    xml(
      'point-nemo.gpx',
      'gpx',
      'GPX with both coordinates negative throughout. In XML a coordinate is text, so the sign ' +
        'bug here is a formatting and parsing one rather than a two’s-complement one — a writer ' +
        'that drops the minus and a reader that parses it with parseInt both produce a valid ' +
        'file in the wrong hemisphere.',
      nominalGpx(POINT_NEMO_TRACK, 20),
    ),
    xml(
      'xxe-external-entity.gpx',
      'gpx',
      'A well-formed GPX whose DOCTYPE declares an external general entity pointing at ' +
        'file:///etc/passwd, referenced from the track name. SECURITY.md puts XXE in GPX and TCX ' +
        'specifically in scope; #32 must reject or refuse to expand it, and this is what that ' +
        'test asserts against.',
      xxeGpx(NULL_ISLAND_TRACK, 10),
    ),
    xml(
      'nominal-ride.tcx',
      'tcx',
      'Baseline TCX v2: one activity, one lap, 30 trackpoints with Position, AltitudeMeters, ' +
        'DistanceMeters, HeartRateBpm, Cadence and the ActivityExtension Watts. TCX nests its ' +
        'coordinates in elements rather than attributes, which is a different parsing path from ' +
        'GPX and fails differently.',
      nominalTcx(NULL_ISLAND_TRACK, 30),
    ),
    xml(
      'indoor-no-position.tcx',
      'tcx',
      'A TCX whose trackpoints carry no Position element at all. The indoor case again, in the ' +
        'format where "no position" is an absent child rather than an undeclared field — a ' +
        'reader that dereferences Position unconditionally throws on the first point.',
      nominalTcx(undefined, 30),
    ),
    xml(
      'xxe-external-entity.tcx',
      'tcx',
      'The TCX counterpart of the hostile GPX: an external general entity referenced from the ' +
        'activity Id. Both formats are carried because a parser is usually configured per format ' +
        'and hardening one is not hardening the other.',
      xxeTcx(ANTIMERIDIAN_TRACK, 10),
    ),
  ];
}
