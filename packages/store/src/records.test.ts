// SPDX-License-Identifier: Apache-2.0

/**
 * The record layer on its own: identifiers, visibility, and the encode/decode
 * pair that separates the in-memory record from the on-disk row.
 *
 * `activity-store.test.ts` covers these through the database. This file covers
 * the cases a database round trip cannot reach — a row that has been corrupted,
 * hand-edited in a devtools pane, or written by a build that did not exist yet.
 * Those are not hypothetical on a local-first product: the database sits on the
 * athlete's own machine, inside their own browser profile.
 */

import {
  metres,
  seconds,
  unixSeconds,
  watts,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { StoreDecodeError, StoreValidationError } from './errors';
import { activityId, athleteId, lapId, privacyZoneId } from './ids';
import {
  fromPersistedActivity,
  fromPersistedAthlete,
  fromPersistedLap,
  fromPersistedPrivacyZone,
  toPersistedActivity,
  toPersistedAthlete,
  toPersistedLap,
  toPersistedPrivacyZone,
  type PersistedActivity,
} from './persisted';
import type { ActivityRecord, LapRecord, PrivacyZoneRecord } from './records';
import { DEFAULT_VISIBILITY, parseVisibility, VISIBILITIES } from './visibility';

const ATHLETE = athleteId('athlete-a');

const ACTIVITY: ActivityRecord = {
  id: activityId('activity-1'),
  athleteId: ATHLETE,
  name: 'Turbo',
  startedAt: unixSeconds(1_700_000_000),
  startedAtTimeZone: 'Europe/London',
  elapsedTime: seconds(4_200),
  movingTime: seconds(3_600),
  distance: metres(40_000),
  visibility: 'private',
  hasPosition: false,
  createdAt: unixSeconds(1_700_004_200),
};

const LAP: LapRecord = {
  id: lapId('lap-1'),
  activityId: ACTIVITY.id,
  athleteId: ATHLETE,
  ordinal: 0,
  startedAt: unixSeconds(1_700_000_000),
  elapsedTime: seconds(600),
  movingTime: seconds(590),
  distance: metres(5_000),
};

const ZONE: PrivacyZoneRecord = {
  id: privacyZoneId('zone-a'),
  athleteId: ATHLETE,
  centre: geographicPosition(degreesLatitude(51.5007), degreesLongitude(-0.1246)),
  radius: metres(500),
  label: 'home',
  createdAt: unixSeconds(1_700_000_000),
};

describe('identifiers', () => {
  it('accepts an ordinary opaque id', () => {
    expect(athleteId('device-keypair-fingerprint')).toBe('device-keypair-fingerprint');
  });

  it.each([
    ['athlete', athleteId],
    ['activity', activityId],
    ['lap', lapId],
    ['privacy zone', privacyZoneId],
  ])('rejects an empty %s id', (_kind, construct) => {
    expect(() => construct('')).toThrow(StoreValidationError);
  });

  it.each([
    ['athlete', athleteId],
    ['activity', activityId],
    ['lap', lapId],
    ['privacy zone', privacyZoneId],
  ])('rejects a blank %s id', (_kind, construct) => {
    // Distinct from empty: it reads as present everywhere it is displayed.
    expect(() => construct('   ')).toThrow(/must not be blank/);
  });
});

describe('visibility — ADR 0004 decision A', () => {
  it('defaults to private', () => {
    expect(DEFAULT_VISIBILITY).toBe('private');
  });

  it('has exactly three values', () => {
    expect(VISIBILITIES).toEqual(['private', 'followers', 'public']);
  });

  it.each(VISIBILITIES)('parses %s', (value) => {
    expect(parseVisibility(value)).toBe(value);
  });

  it('does not echo an unbounded stored value into its error message', () => {
    // The value came off disk, so it is whatever is on disk. An error string
    // reaches a console, a crash report and a bug tracker (ADR 0004 decision D).
    let message = '';
    try {
      parseVisibility('x'.repeat(5_000));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('truncated');
    expect(message.length).toBeLessThan(120);
  });

  it.each([['everyone'], [undefined], [null], [0], [{}]])(
    'rejects %o rather than coercing it to private',
    (value) => {
      expect(() => parseVisibility(value)).toThrow(StoreValidationError);
    },
  );
});

describe('activity encode and decode', () => {
  it('round trips a record unchanged', () => {
    expect(fromPersistedActivity(toPersistedActivity(ACTIVITY))).toEqual(ACTIVITY);
  });

  it('round trips the optional fields when present', () => {
    const full: ActivityRecord = {
      ...ACTIVITY,
      averagePower: watts(231),
      originalFile: { key: 'files/a.fit', sha256: 'f'.repeat(64) },
      visibility: 'followers',
      hasPosition: true,
    };
    expect(fromPersistedActivity(toPersistedActivity(full))).toEqual(full);
  });

  it('does not write an absent optional field as an explicit undefined', () => {
    // A key present with value `undefined` is a stored key, and Dexie indexes
    // it. "Absent" has to mean absent.
    const row = toPersistedActivity(ACTIVITY);
    expect('averagePower' in row).toBe(false);
    expect('originalFileKey' in row).toBe(false);
    expect('originalFileSha256' in row).toBe(false);
  });

  it.each([
    ['elapsedTime', -1, /elapsedTime/],
    ['movingTime', -1, /movingTime/],
    ['distance', -1, /distance/],
    ['startedAt', Number.NaN, /startedAt/],
    ['averagePower', -5, /averagePower/],
  ])('rejects a corrupted %s on read', (field, value, message) => {
    const row: PersistedActivity = { ...toPersistedActivity(ACTIVITY), [field]: value };
    expect(() => fromPersistedActivity(row)).toThrow(StoreDecodeError);
    expect(() => fromPersistedActivity(row)).toThrow(message);
  });

  it.each(['name', 'startedAtTimeZone', 'id', 'athleteId'])(
    'rejects a %s that is not a string on read',
    (field) => {
      const row: PersistedActivity = { ...toPersistedActivity(ACTIVITY), [field]: 42 };
      expect(() => fromPersistedActivity(row)).toThrow(StoreDecodeError);
    },
  );

  it.each(['distance', 'elapsedTime', 'startedAt', 'createdAt'])(
    'rejects a %s that is not a number at all on read',
    (field) => {
      const row: PersistedActivity = { ...toPersistedActivity(ACTIVITY), [field]: 'far' };
      expect(() => fromPersistedActivity(row)).toThrow(/expected a number, found string/);
    },
  );

  it('rejects a hasPosition that is not a boolean on read', () => {
    const row = {
      ...toPersistedActivity(ACTIVITY),
      hasPosition: 'yes',
    } as unknown as PersistedActivity;
    expect(() => fromPersistedActivity(row)).toThrow(/hasPosition/);
  });

  it('rejects a missing visibility rather than defaulting it', () => {
    const row = { ...toPersistedActivity(ACTIVITY) } as Partial<PersistedActivity>;
    delete row.visibility;
    expect(() => fromPersistedActivity(row as PersistedActivity)).toThrow(StoreValidationError);
  });

  it('rejects half an original-file reference in either direction', () => {
    const keyOnly = { ...toPersistedActivity(ACTIVITY), originalFileKey: 'k' };
    const hashOnly = { ...toPersistedActivity(ACTIVITY), originalFileSha256: 'h' };
    expect(() => fromPersistedActivity(keyOnly)).toThrow(/both a key and a sha256/);
    expect(() => fromPersistedActivity(hashOnly)).toThrow(/both a key and a sha256/);
  });

  it('rejects a non-string original-file key on read', () => {
    const row = {
      ...toPersistedActivity(ACTIVITY),
      originalFileKey: 7,
      originalFileSha256: 'h',
    } as unknown as PersistedActivity;
    expect(() => fromPersistedActivity(row)).toThrow(StoreDecodeError);
  });
});

describe('athlete, lap and privacy zone encode and decode', () => {
  it('an athlete round trips', () => {
    const athlete = { id: ATHLETE, displayName: 'A', createdAt: unixSeconds(1) };
    expect(fromPersistedAthlete(toPersistedAthlete(athlete))).toEqual(athlete);
  });

  it('an athlete with a corrupted createdAt is rejected', () => {
    const row = {
      ...toPersistedAthlete({ id: ATHLETE, displayName: 'A', createdAt: unixSeconds(1) }),
      createdAt: Number.NaN,
    };
    expect(() => fromPersistedAthlete(row)).toThrow(StoreDecodeError);
  });

  it('a lap round trips, with and without power', () => {
    expect(fromPersistedLap(toPersistedLap(LAP))).toEqual(LAP);
    const powered = { ...LAP, averagePower: watts(180) };
    expect(fromPersistedLap(toPersistedLap(powered))).toEqual(powered);
  });

  it('a lap with a negative moving time is rejected', () => {
    const row = { ...toPersistedLap(LAP), movingTime: -1 };
    expect(() => fromPersistedLap(row)).toThrow(/lap.movingTime/);
  });

  it('a privacy zone round trips', () => {
    expect(fromPersistedPrivacyZone(toPersistedPrivacyZone(ZONE))).toEqual(ZONE);
  });

  // ADR 0004 decision D, at the single most sensitive coordinate this program
  // holds: a privacy-zone centre is a home address the athlete asked to be
  // hidden, and a decode error string reaches a console, a crash report and a
  // bug tracker.
  //
  // ⚠️ The version of this test before #104 asserted only that the message did
  // not contain the stored LONGITUDE -- which was never in it. The offending
  // LATITUDE was, because `decoded` propagates the domain constructor's message
  // verbatim and that message ended `, received 91`. A test written for a
  // property that its assertion could not observe: it would have stayed green
  // through the whole leak. The assertion below is on the digits instead, so it
  // cannot pass over a value in a different spelling either.
  it.each([
    // Out of range in either role. Not a real place, but it is the shape a
    // corrupted row takes.
    ['an impossible latitude', 91],
    // The one that matters: a REAL coordinate, valid as the longitude it
    // probably is, in the latitude column because the two were transposed on
    // the way in. 151.2093 is Sydney. This is a home address in a bug report.
    ['a transposed longitude in the latitude column', 151.2093],
  ])('a privacy zone with %s is rejected, and the error names no coordinate', (_, latitude) => {
    const row = { ...toPersistedPrivacyZone(ZONE), latitude };
    let message = '';
    try {
      fromPersistedPrivacyZone(row);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/privacyZone.centre.latitude/);
    // Every run of digits in the message must be one of the constraint's own
    // bounds. That admits "must be between -90 and 90" and rejects the stored
    // latitude, the stored longitude, and any rounded or truncated form of
    // either -- 151.2093 clipped to 151 is still Sydney.
    const leaked = (message.match(/\d+/g) ?? []).filter((run) => run !== '90');
    expect(leaked, `privacy-zone decode error named a number that is not a bound: ${message}`) //
      .toEqual([]);
  });
});
