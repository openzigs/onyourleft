// SPDX-License-Identifier: Apache-2.0

/**
 * The encoder's fault paths: what it does with a value it cannot carry.
 *
 * The happy paths are exercised against the committed corpus in
 * `tools/fixture-corpus/encode-corpus.test.ts`, which is where a test that
 * reads files off disk belongs. These are the cases the corpus does not
 * contain, because a fixture corpus of *valid* files by construction does not.
 *
 * ⚠️ Every coordinate below is inside a declared synthetic test region
 * (`src/synthetic-test-regions.ts`) — `ANTIMERIDIAN-EAST` for the semicircle
 * case and `NULL-ISLAND` for the rest. ADR 0004 decision G binds a coordinate
 * typed into a test as much as one committed as a file.
 */

import type { AltitudeMetres, GeographicPosition, UnixSeconds } from '@onyourleft/domain';
import {
  altitudeMetres,
  DEGREES_PER_SEMICIRCLE,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  SEMICIRCLES_MAX,
  unixSeconds,
  watts,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import type { FitRecord } from '../decode/activity';
import { decodeActivity } from '../decode/activity';
import { readFitContainer } from '../decode/container';
import { FIELD, GLOBAL_MESSAGE } from '../decode/profile';
import type { FitEncodeInput } from './activity';
import { encodeActivity } from './activity';

const EMPTY_RECORD: FitRecord = {
  timestamp: undefined,
  position: undefined,
  altitude: undefined,
  distance: undefined,
  speed: undefined,
  heartRate: undefined,
  cadence: undefined,
  power: undefined,
  temperature: undefined,
  developerFields: [],
};

function record(overrides: Partial<FitRecord>): FitRecord {
  return { ...EMPTY_RECORD, ...overrides };
}

function roundTrip(input: FitEncodeInput) {
  const { bytes, faults } = encodeActivity(input);
  return { faults, decoded: decodeActivity(readFitContainer(bytes)), bytes };
}

describe('a position exactly on the largest semicircle a sint32 can hold', () => {
  /**
   * `SEMICIRCLES_MAX` is `2**31 - 1`, which is also the `sint32` invalid
   * marker. A longitude that rounds to it is one semicircle short of +180°:
   * real, legal, in the `ANTIMERIDIAN-EAST` region, and unrepresentable in the
   * only base type FIT gives the field.
   *
   * The behaviour that matters is **which** thing gets dropped. Dropping the
   * channel would lose a whole ride's track because of one point; dropping the
   * value loses one point and says so.
   */
  const onTheMarker: GeographicPosition = geographicPosition(
    degreesLatitude(0.5),
    degreesLongitude(SEMICIRCLES_MAX * DEGREES_PER_SEMICIRCLE),
  );
  // Both coordinates are exact multiples of one semicircle, so the comparison
  // below is an equality rather than an approximation: what is asserted is that
  // the value came back, not that it landed near where it started.
  const ordinary: GeographicPosition = geographicPosition(
    degreesLatitude(10_000_000 * DEGREES_PER_SEMICIRCLE),
    degreesLongitude((SEMICIRCLES_MAX - 100_000) * DEGREES_PER_SEMICIRCLE),
  );

  const { faults, decoded } = roundTrip({
    records: [
      record({ timestamp: instant(0), position: ordinary }),
      record({ timestamp: instant(1), position: onTheMarker }),
      record({ timestamp: instant(2), position: ordinary }),
    ],
  });

  it('drops that one value with a fault, naming its message and field', () => {
    expect(faults.map((fault) => fault.code)).toEqual(['value-not-representable']);
    expect(faults[0]?.globalMessageNumber).toBe(GLOBAL_MESSAGE.record);
    expect(faults[0]?.fieldNumber).toBe(FIELD.record.positionLongitude);
  });

  it('keeps the channel, and every other point in it', () => {
    expect(decoded.activity.records).toHaveLength(3);
    expect(decoded.activity.records[0]?.position).toEqual(ordinary);
    expect(decoded.activity.records[2]?.position).toEqual(ordinary);
    expect(decoded.activity.records[1]?.position).toBeUndefined();
  });

  it('never names the coordinate in the fault message', () => {
    // ADR 0004 decision D. A fault about a longitude is the message most likely
    // to be pasted into a public issue.
    expect(faults[0]?.message).not.toContain('179');
    expect(faults[0]?.message).not.toContain(String(SEMICIRCLES_MAX));
  });
});

describe('an instant with no FIT representation', () => {
  it('is dropped with a fault rather than wrapping into the far future', () => {
    // 1980-01-01, nine years before the FIT epoch. Written into a uint32 it
    // reappears as a date around 2126 — plausible enough to store and
    // impossible to detect afterwards.
    const { faults, decoded } = roundTrip({
      records: [record({ timestamp: { kind: 'instant', instant: unixSeconds(315_532_800) } })],
    });
    expect(faults.map((fault) => fault.code)).toEqual(['instant-not-representable']);
    expect(decoded.activity.records[0]?.timestamp).toBeUndefined();
  });
});

describe('an instant inside the range FIT reserves for system time', () => {
  it('is written, and reported, because the format offers no alternative', () => {
    // 1995-01-01. Its FIT date_time is 157 852 800, under FIT_SYSTEM_TIME_MAX
    // (268 435 455, which is 1998-07-03T21:24:15Z), so every conforming reader
    // — this decoder included — reads it back as seconds since a device
    // powered on rather than as an instant.
    const { faults, decoded } = roundTrip({
      records: [record({ timestamp: { kind: 'instant', instant: unixSeconds(788_918_400) } })],
    });
    expect(faults.map((fault) => fault.code)).toEqual(['instant-reads-back-as-system-time']);
    // The bytes are written all the same: a dropped timestamp would be worse.
    expect(decoded.activity.records[0]?.timestamp?.kind).toBe('systemTime');
  });

  it('says nothing about an ordinary modern instant', () => {
    const { faults } = roundTrip({ records: [record({ timestamp: instant(0) })] });
    expect(faults).toEqual([]);
  });
});

describe('a quantity @onyourleft/domain cannot encode', () => {
  it('is dropped with a fault rather than clamped into range', () => {
    // 20 km is outside the FIT altitude field's range. Clamping would write a
    // plausible 12 606.8 m into a file that then round-trips cleanly for ever.
    const tooHigh = 20_000 as unknown as AltitudeMetres;
    const { faults, decoded } = roundTrip({
      records: [
        record({ timestamp: instant(0), altitude: altitudeMetres(120) }),
        record({ timestamp: instant(1), altitude: tooHigh }),
      ],
    });
    expect(faults.map((fault) => fault.code)).toEqual(['value-not-representable']);
    expect(faults[0]?.fieldNumber).toBe(FIELD.record.altitude);
    expect(decoded.activity.records[0]?.altitude).toBe(120);
    expect(decoded.activity.records[1]?.altitude).toBeUndefined();
  });

  it('reports the fault once, not once per pass over the messages', () => {
    // The base type survey walks every message before anything is written, and
    // it runs the same conversions. A caller reading two copies of every fault
    // would reasonably conclude the field was dropped twice.
    const tooHigh = 20_000 as unknown as AltitudeMetres;
    const { faults } = roundTrip({ records: [record({ altitude: tooHigh })] });
    expect(faults).toHaveLength(1);
  });
});

describe('an activity with nothing in it', () => {
  it('produces a header and a checksum, and says so', () => {
    const { faults, bytes } = roundTrip({});
    expect(faults.map((fault) => fault.code)).toEqual(['nothing-to-encode']);
    expect(bytes).toHaveLength(16);
  });

  it('says nothing when there is a single message to write', () => {
    const { faults } = roundTrip({ records: [record({ power: watts(210) })] });
    expect(faults).toEqual([]);
  });
});

function instant(offsetSeconds: number): { kind: 'instant'; instant: UnixSeconds } {
  // 2024-06-15T09:00:00Z, the instant the #29 corpus starts at.
  return { kind: 'instant', instant: unixSeconds(1_718_442_000 + offsetSeconds) };
}
