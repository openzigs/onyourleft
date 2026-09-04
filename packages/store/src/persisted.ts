// SPDX-License-Identifier: Apache-2.0

/**
 * The on-disk shapes, and the two functions that convert between them and the
 * in-memory records in `records.ts`.
 *
 * Two shapes rather than one, for three reasons that are all load-bearing:
 *
 * 1. **A compound index needs flat properties.** IndexedDB indexes a key path,
 *    and Dexie's `[athleteId+originalFileSha256]` cannot reach into a nested
 *    `originalFile` object as one component of a compound key. So the reference
 *    is flattened on the way in and rebuilt on the way out.
 * 2. **Everything stored must survive the structured clone algorithm.** Plain
 *    numbers, strings and booleans do. A branded `Metres` also does, because the
 *    brand is a type-level fiction that erases — but stating the persisted shape
 *    in plain types is what makes that fact checked rather than assumed.
 * 3. **What comes back out of IndexedDB is not trusted.** It was written by some
 *    earlier build of this package, or hand-edited in a devtools pane, or
 *    partially corrupted. `fromPersisted*` re-enters every quantity through its
 *    `@onyourleft/domain` constructor, so "read from disk" and "validated" are
 *    the same step. A negative `movingTime` on disk becomes a
 *    `StoreDecodeError`, not a chart with a negative axis.
 */

import {
  metres,
  seconds,
  unixSeconds,
  watts,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  UnitError,
} from '@onyourleft/domain';

import { StoreDecodeError } from './errors';
import { activityId, athleteId, lapId, privacyZoneId } from './ids';
import type {
  ActivityRecord,
  AthleteRecord,
  LapRecord,
  PrivacyZoneRecord,
  OriginalFileReference,
} from './records';
import { parseVisibility } from './visibility';

// --- On-disk shapes ---------------------------------------------------------

/** @see AthleteRecord */
export interface PersistedAthlete {
  id: string;
  displayName: string;
  createdAt: number;
}

/** @see ActivityRecord */
export interface PersistedActivity {
  id: string;
  athleteId: string;
  name: string;
  startedAt: number;
  startedAtTimeZone: string;
  elapsedTime: number;
  movingTime: number;
  distance: number;
  visibility: string;
  hasPosition: boolean;
  averagePower?: number;
  /** Flattened from `ActivityRecord.originalFile` — see the note above. */
  originalFileKey?: string;
  /** Flattened, and indexed: #37 deduplicates on it. */
  originalFileSha256?: string;
  createdAt: number;
}

/** @see LapRecord */
export interface PersistedLap {
  id: string;
  activityId: string;
  athleteId: string;
  ordinal: number;
  startedAt: number;
  elapsedTime: number;
  movingTime: number;
  distance: number;
  averagePower?: number;
}

/** @see PrivacyZoneRecord */
export interface PersistedPrivacyZone {
  id: string;
  athleteId: string;
  latitude: number;
  longitude: number;
  radius: number;
  label: string;
  createdAt: number;
}

// --- Decode helpers ---------------------------------------------------------

/**
 * Runs a `@onyourleft/domain` constructor and rewrites its `UnitError` as a
 * `StoreDecodeError` naming the field.
 *
 * The rewrite is the point: `UnitError: duration in seconds must not be
 * negative` says nothing about which of an activity's four durations it was,
 * and this is the message an operator sees when their own device has data on it
 * that will not load.
 */
export function decoded<T>(field: string, value: number, construct: (value: number) => T): T {
  try {
    return construct(value);
  } catch (cause) {
    if (cause instanceof UnitError) {
      throw new StoreDecodeError(`${field}: ${cause.message}`);
    }
    throw cause;
  }
}

export function decodedNumber(field: string, value: unknown): number {
  if (typeof value !== 'number') {
    throw new StoreDecodeError(`${field}: expected a number, found ${typeof value}`);
  }
  return value;
}

export function decodedString(field: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw new StoreDecodeError(`${field}: expected a string, found ${typeof value}`);
  }
  return value;
}

function decodedBoolean(field: string, value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new StoreDecodeError(`${field}: expected a boolean, found ${typeof value}`);
  }
  return value;
}

function decodedOptionalPower(field: string, value: unknown): number | undefined {
  return value === undefined ? undefined : decodedNumber(field, value);
}

function originalFileOf(row: PersistedActivity): OriginalFileReference | undefined {
  const { originalFileKey, originalFileSha256 } = row;
  if (originalFileKey === undefined && originalFileSha256 === undefined) {
    return undefined;
  }
  if (originalFileKey === undefined || originalFileSha256 === undefined) {
    // Half a reference is worse than none: a key with no hash cannot be
    // deduplicated and a hash with no key cannot be fetched, and either one
    // silently degrades #37 rather than failing it.
    throw new StoreDecodeError(
      'originalFile: a stored original file needs both a key and a sha256, found only one',
    );
  }
  return {
    key: decodedString('originalFile.key', originalFileKey),
    sha256: decodedString('originalFile.sha256', originalFileSha256),
  };
}

// --- Athlete ----------------------------------------------------------------

export function toPersistedAthlete(record: AthleteRecord): PersistedAthlete {
  return {
    id: record.id,
    displayName: record.displayName,
    createdAt: record.createdAt,
  };
}

/** @throws {StoreDecodeError} */
export function fromPersistedAthlete(row: PersistedAthlete): AthleteRecord {
  return {
    id: athleteId(decodedString('athlete.id', row.id)),
    displayName: decodedString('athlete.displayName', row.displayName),
    createdAt: decoded(
      'athlete.createdAt',
      decodedNumber('athlete.createdAt', row.createdAt),
      unixSeconds,
    ),
  };
}

// --- Activity ---------------------------------------------------------------

export function toPersistedActivity(record: ActivityRecord): PersistedActivity {
  const row: PersistedActivity = {
    id: record.id,
    athleteId: record.athleteId,
    name: record.name,
    startedAt: record.startedAt,
    startedAtTimeZone: record.startedAtTimeZone,
    elapsedTime: record.elapsedTime,
    movingTime: record.movingTime,
    distance: record.distance,
    visibility: record.visibility,
    hasPosition: record.hasPosition,
    createdAt: record.createdAt,
  };
  // Written conditionally rather than as `averagePower: record.averagePower`:
  // an explicit `undefined` property is a stored key with no value, and Dexie
  // will index it. Absent means absent.
  if (record.averagePower !== undefined) {
    row.averagePower = record.averagePower;
  }
  if (record.originalFile !== undefined) {
    row.originalFileKey = record.originalFile.key;
    row.originalFileSha256 = record.originalFile.sha256;
  }
  return row;
}

/** @throws {StoreDecodeError} */
export function fromPersistedActivity(row: PersistedActivity): ActivityRecord {
  const averagePower = decodedOptionalPower('activity.averagePower', row.averagePower);
  const originalFile = originalFileOf(row);
  const record: ActivityRecord = {
    id: activityId(decodedString('activity.id', row.id)),
    athleteId: athleteId(decodedString('activity.athleteId', row.athleteId)),
    name: decodedString('activity.name', row.name),
    startedAt: decoded(
      'activity.startedAt',
      decodedNumber('activity.startedAt', row.startedAt),
      unixSeconds,
    ),
    startedAtTimeZone: decodedString('activity.startedAtTimeZone', row.startedAtTimeZone),
    elapsedTime: decoded(
      'activity.elapsedTime',
      decodedNumber('activity.elapsedTime', row.elapsedTime),
      seconds,
    ),
    movingTime: decoded(
      'activity.movingTime',
      decodedNumber('activity.movingTime', row.movingTime),
      seconds,
    ),
    distance: decoded(
      'activity.distance',
      decodedNumber('activity.distance', row.distance),
      metres,
    ),
    // Not defaulted on read. The default belongs at creation (ADR 0004
    // decision A); coercing an unrecognised stored value to `private` here
    // would hide corruption in the one field whose corruption matters most.
    visibility: parseVisibility(row.visibility),
    hasPosition: decodedBoolean('activity.hasPosition', row.hasPosition),
    createdAt: decoded(
      'activity.createdAt',
      decodedNumber('activity.createdAt', row.createdAt),
      unixSeconds,
    ),
    ...(averagePower === undefined
      ? {}
      : { averagePower: decoded('activity.averagePower', averagePower, watts) }),
    ...(originalFile === undefined ? {} : { originalFile }),
  };
  return record;
}

// --- Lap --------------------------------------------------------------------

export function toPersistedLap(record: LapRecord): PersistedLap {
  const row: PersistedLap = {
    id: record.id,
    activityId: record.activityId,
    athleteId: record.athleteId,
    ordinal: record.ordinal,
    startedAt: record.startedAt,
    elapsedTime: record.elapsedTime,
    movingTime: record.movingTime,
    distance: record.distance,
  };
  if (record.averagePower !== undefined) {
    row.averagePower = record.averagePower;
  }
  return row;
}

/** @throws {StoreDecodeError} */
export function fromPersistedLap(row: PersistedLap): LapRecord {
  const averagePower = decodedOptionalPower('lap.averagePower', row.averagePower);
  return {
    id: lapId(decodedString('lap.id', row.id)),
    activityId: activityId(decodedString('lap.activityId', row.activityId)),
    athleteId: athleteId(decodedString('lap.athleteId', row.athleteId)),
    ordinal: decodedNumber('lap.ordinal', row.ordinal),
    startedAt: decoded('lap.startedAt', decodedNumber('lap.startedAt', row.startedAt), unixSeconds),
    elapsedTime: decoded(
      'lap.elapsedTime',
      decodedNumber('lap.elapsedTime', row.elapsedTime),
      seconds,
    ),
    movingTime: decoded('lap.movingTime', decodedNumber('lap.movingTime', row.movingTime), seconds),
    distance: decoded('lap.distance', decodedNumber('lap.distance', row.distance), metres),
    ...(averagePower === undefined
      ? {}
      : { averagePower: decoded('lap.averagePower', averagePower, watts) }),
  };
}

// --- Privacy zone -----------------------------------------------------------

export function toPersistedPrivacyZone(record: PrivacyZoneRecord): PersistedPrivacyZone {
  return {
    id: record.id,
    athleteId: record.athleteId,
    latitude: record.centre.latitude,
    longitude: record.centre.longitude,
    radius: record.radius,
    label: record.label,
    createdAt: record.createdAt,
  };
}

/**
 * @throws {StoreDecodeError}
 *
 * Note what the error messages here do **not** say. ADR 0004 decision D puts
 * location values out of scope for error text, and a privacy-zone centre is the
 * most sensitive coordinate this program holds — it is a home address the
 * athlete asked to be hidden. `decoded` reports the field name and the domain
 * constructor's own message ("latitude must be between -90 and 90"), never the
 * value.
 */
export function fromPersistedPrivacyZone(row: PersistedPrivacyZone): PrivacyZoneRecord {
  const latitude = decoded(
    'privacyZone.centre.latitude',
    decodedNumber('privacyZone.centre.latitude', row.latitude),
    degreesLatitude,
  );
  const longitude = decoded(
    'privacyZone.centre.longitude',
    decodedNumber('privacyZone.centre.longitude', row.longitude),
    degreesLongitude,
  );
  return {
    id: privacyZoneId(decodedString('privacyZone.id', row.id)),
    athleteId: athleteId(decodedString('privacyZone.athleteId', row.athleteId)),
    centre: geographicPosition(latitude, longitude),
    radius: decoded('privacyZone.radius', decodedNumber('privacyZone.radius', row.radius), metres),
    label: decodedString('privacyZone.label', row.label),
    createdAt: decoded(
      'privacyZone.createdAt',
      decodedNumber('privacyZone.createdAt', row.createdAt),
      unixSeconds,
    ),
  };
}
