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
  beatsPerMinute,
  kilograms,
  degreesBearing,
  gradePercent,
  metres,
  seconds,
  unixSeconds,
  watts,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  UnitError,
} from '@onyourleft/domain';

import type { GeographicPosition } from '@onyourleft/domain';

import { StoreDecodeError } from './errors';
import { activityId, athleteId, lapId, privacyZoneId, segmentId } from './ids';
import type {
  ActivityRecord,
  AthleteRecord,
  LapRecord,
  PrivacyZoneRecord,
  OriginalFileReference,
  SegmentEndpointRecord,
  SegmentRecord,
} from './records';
import { parseVisibility } from './visibility';

// --- On-disk shapes ---------------------------------------------------------

/** @see AthleteRecord */
export interface PersistedAthlete {
  id: string;
  displayName: string;
  createdAt: number;
  thresholdPower?: number;
  thresholdHeartRate?: number;
  mass?: number;
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
  /** @see ActivityRecord.effortWeightedPower — the load summary #77 reads. */
  effortWeightedPower?: number;
  effortWeightedHeartRate?: number;
  loadCoveredTime?: number;
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

/**
 * @see SegmentRecord
 *
 * The geometry is stored as **two parallel number arrays** rather than an array
 * of `{latitude, longitude}` objects. A thousand-point segment is a thousand
 * small objects under the structured clone algorithm and two typed-shaped
 * arrays otherwise; the arrays clone faster, store smaller, and — the reason
 * that actually decided it — make a partial write visible, because a geometry
 * whose two arrays differ in length is detectably corrupt where a truncated
 * array of pairs is merely short.
 *
 * ⚠️ **`latitudes` and `longitudes`, in that order, and never one interleaved
 * array.** An interleaved `[lat, lon, lat, lon, …]` is one off-by-one away from
 * transposing every coordinate in the segment, which is the exact bug
 * `geographicPosition`'s branded parameters exist to prevent one layer up.
 */
export interface PersistedSegment {
  id: string;
  createdBy: string;
  name: string;
  sport: string;
  latitudes: number[];
  longitudes: number[];
  startLatitude: number;
  startLongitude: number;
  startBearing: number;
  startRadius: number;
  endLatitude: number;
  endLongitude: number;
  endBearing: number;
  endRadius: number;
  bearingToleranceDegrees: number;
  distance: number;
  elevationGain?: number;
  averageGrade?: number;
  maximumGrade?: number;
  elevationSource: string;
  elevationResolutionMetres?: number;
  visibility: string;
  createdAt: number;
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
  const row: PersistedAthlete = {
    id: record.id,
    displayName: record.displayName,
    createdAt: record.createdAt,
  };
  // Written conditionally, for the reason `toPersistedActivity` gives for
  // `averagePower`: an explicit `undefined` property is a stored key with no
  // value, and absent must mean absent.
  if (record.thresholdPower !== undefined) {
    row.thresholdPower = record.thresholdPower;
  }
  if (record.thresholdHeartRate !== undefined) {
    row.thresholdHeartRate = record.thresholdHeartRate;
  }
  if (record.mass !== undefined) {
    row.mass = record.mass;
  }
  return row;
}

/** @throws {StoreDecodeError} */
export function fromPersistedAthlete(row: PersistedAthlete): AthleteRecord {
  const record: {
    -readonly [K in keyof AthleteRecord]: AthleteRecord[K];
  } = {
    id: athleteId(decodedString('athlete.id', row.id)),
    displayName: decodedString('athlete.displayName', row.displayName),
    createdAt: decoded(
      'athlete.createdAt',
      decodedNumber('athlete.createdAt', row.createdAt),
      unixSeconds,
    ),
  };
  // Absent stays absent rather than becoming a default here: this function's
  // job is to say faithfully what is on disk, and a row written before #78
  // genuinely has no setting. Exactly one place substitutes the default, so
  // "a single athlete threshold setting" stays true — see
  // `apps/web/src/analysis/`.
  //
  // Present is still validated, on the same terms as every other field: a
  // negative threshold on disk is a `StoreDecodeError` rather than a zone
  // table with a negative boundary.
  if (row.thresholdPower !== undefined) {
    record.thresholdPower = decoded(
      'athlete.thresholdPower',
      decodedNumber('athlete.thresholdPower', row.thresholdPower),
      watts,
    );
  }
  if (row.thresholdHeartRate !== undefined) {
    record.thresholdHeartRate = decoded(
      'athlete.thresholdHeartRate',
      decodedNumber('athlete.thresholdHeartRate', row.thresholdHeartRate),
      beatsPerMinute,
    );
  }
  // #66. Absent stays absent for the reason above, and a ranking must not read
  // this field at all — an effort carries its own frozen copy, made when the
  // effort was. This is only ever the source of that copy.
  if (row.mass !== undefined) {
    record.mass = decoded('athlete.mass', decodedNumber('athlete.mass', row.mass), kilograms);
  }
  return record;
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
  // The load summary (#77), each written conditionally for the same reason.
  // ⚠️ At most one basis is ever set — `records.ts` states why — and this
  // function does not enforce it: a record that carried both would be written
  // as it stands. The invariant belongs where the value is produced, and
  // `loadSummaryOf` in `apps/web/src/analysis/summary.ts` is the one producer.
  if (record.effortWeightedPower !== undefined) {
    row.effortWeightedPower = record.effortWeightedPower;
  }
  if (record.effortWeightedHeartRate !== undefined) {
    row.effortWeightedHeartRate = record.effortWeightedHeartRate;
  }
  if (record.loadCoveredTime !== undefined) {
    row.loadCoveredTime = record.loadCoveredTime;
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
    // Absent stays absent, on `fromPersistedAthlete`'s reasoning: a row written
    // before #77 genuinely has no load summary, and a reader that invented one
    // would be lying about the disk. `apps/web` offers to compute the missing
    // ones rather than pretending they are there.
    ...(row.effortWeightedPower === undefined
      ? {}
      : {
          effortWeightedPower: decoded(
            'activity.effortWeightedPower',
            decodedNumber('activity.effortWeightedPower', row.effortWeightedPower),
            watts,
          ),
        }),
    ...(row.effortWeightedHeartRate === undefined
      ? {}
      : {
          effortWeightedHeartRate: decoded(
            'activity.effortWeightedHeartRate',
            decodedNumber('activity.effortWeightedHeartRate', row.effortWeightedHeartRate),
            beatsPerMinute,
          ),
        }),
    ...(row.loadCoveredTime === undefined
      ? {}
      : {
          loadCoveredTime: decoded(
            'activity.loadCoveredTime',
            decodedNumber('activity.loadCoveredTime', row.loadCoveredTime),
            seconds,
          ),
        }),
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
 * constructor's own message ("latitude in degrees must be between -90 and 90"),
 * never the value.
 *
 * ⚠️ **That sentence was aspirational until #104 and this comment claimed it as
 * fact.** `decoded` propagates the cause's message verbatim, and until #104 the
 * domain guard ended it with `, received 151.2093` — so a transposed or
 * corrupted zone centre was echoed into a `StoreDecodeError`, which is a
 * console line, a crash report and a bug tracker. The redaction now happens in
 * `@onyourleft/domain`, where every caller inherits it. What holds it there is
 * `records.test.ts`, which asserts that no digit run in this message is
 * anything but a bound of the constraint — the assertion the previous version
 * of that test could not make, because it checked only for a value that was
 * never in the string.
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

// --- Segments (#64) ---------------------------------------------------------

/** Every value {@link ElevationSource} admits, so a typo on disk is rejected. */
const ELEVATION_SOURCES: readonly string[] = ['device', 'dem', 'none'];

/** Every value {@link SegmentSport} admits. @see ELEVATION_SOURCES */
const SEGMENT_SPORTS: readonly string[] = ['ride', 'run'];

function decodedMember<T extends string>(
  field: string,
  value: unknown,
  allowed: readonly string[],
): T {
  const text = decodedString(field, value);
  if (!allowed.includes(text)) {
    throw new StoreDecodeError(`${field}: expected one of ${allowed.join(', ')}, found ${text}`);
  }
  return text as T;
}

export function toPersistedSegment(record: SegmentRecord): PersistedSegment {
  return {
    id: record.id,
    createdBy: record.createdBy,
    name: record.name,
    sport: record.sport,
    latitudes: record.geometry.map((point) => point.latitude),
    longitudes: record.geometry.map((point) => point.longitude),
    startLatitude: record.start.position.latitude,
    startLongitude: record.start.position.longitude,
    startBearing: record.start.bearing,
    startRadius: record.start.radius,
    endLatitude: record.end.position.latitude,
    endLongitude: record.end.position.longitude,
    endBearing: record.end.bearing,
    endRadius: record.end.radius,
    bearingToleranceDegrees: record.bearingToleranceDegrees,
    distance: record.distance,
    ...(record.elevationGain === undefined ? {} : { elevationGain: record.elevationGain }),
    ...(record.averageGrade === undefined ? {} : { averageGrade: record.averageGrade }),
    ...(record.maximumGrade === undefined ? {} : { maximumGrade: record.maximumGrade }),
    elevationSource: record.elevationSource,
    ...(record.elevationResolutionMetres === undefined
      ? {}
      : { elevationResolutionMetres: record.elevationResolutionMetres }),
    visibility: record.visibility,
    createdAt: record.createdAt,
  };
}

/**
 * @throws {StoreDecodeError} naming the field, for anything on disk this
 * package cannot turn back into a segment — including the two geometry arrays
 * disagreeing in length, which is what a partial write looks like.
 *
 * ⚠️ **No message here names a coordinate value**, per ADR 0004 decision D.
 * `decoded` rewrites a `UnitError` and `@onyourleft/domain` already redacts the
 * value for a latitude or a longitude; the length mismatch below names two
 * lengths, which are counts rather than positions.
 */
export function fromPersistedSegment(row: PersistedSegment): SegmentRecord {
  const latitudes = decodedNumberArray('segment.latitudes', row.latitudes);
  const longitudes = decodedNumberArray('segment.longitudes', row.longitudes);
  if (latitudes.length !== longitudes.length) {
    throw new StoreDecodeError(
      `segment.geometry: ${String(latitudes.length)} latitudes for ` +
        `${String(longitudes.length)} longitudes`,
    );
  }

  const geometry = latitudes.map((latitude, index) =>
    positionAt('segment.geometry', latitude, longitudes[index] ?? Number.NaN),
  );

  return {
    id: segmentId(decodedString('segment.id', row.id)),
    createdBy: athleteId(decodedString('segment.createdBy', row.createdBy)),
    name: decodedString('segment.name', row.name),
    sport: decodedMember('segment.sport', row.sport, SEGMENT_SPORTS),
    geometry,
    start: endpointOf(
      'segment.start',
      row.startLatitude,
      row.startLongitude,
      row.startBearing,
      row.startRadius,
    ),
    end: endpointOf(
      'segment.end',
      row.endLatitude,
      row.endLongitude,
      row.endBearing,
      row.endRadius,
    ),
    bearingToleranceDegrees: decodedNumber(
      'segment.bearingToleranceDegrees',
      row.bearingToleranceDegrees,
    ),
    distance: decoded('segment.distance', decodedNumber('segment.distance', row.distance), metres),
    ...(row.elevationGain === undefined
      ? {}
      : {
          elevationGain: decoded(
            'segment.elevationGain',
            decodedNumber('segment.elevationGain', row.elevationGain),
            metres,
          ),
        }),
    ...(row.averageGrade === undefined
      ? {}
      : {
          averageGrade: decoded(
            'segment.averageGrade',
            decodedNumber('segment.averageGrade', row.averageGrade),
            gradePercent,
          ),
        }),
    ...(row.maximumGrade === undefined
      ? {}
      : {
          maximumGrade: decoded(
            'segment.maximumGrade',
            decodedNumber('segment.maximumGrade', row.maximumGrade),
            gradePercent,
          ),
        }),
    elevationSource: decodedMember(
      'segment.elevationSource',
      row.elevationSource,
      ELEVATION_SOURCES,
    ),
    ...(row.elevationResolutionMetres === undefined
      ? {}
      : {
          elevationResolutionMetres: decodedNumber(
            'segment.elevationResolutionMetres',
            row.elevationResolutionMetres,
          ),
        }),
    visibility: parseVisibility(row.visibility),
    createdAt: decoded(
      'segment.createdAt',
      decodedNumber('segment.createdAt', row.createdAt),
      unixSeconds,
    ),
  };
}

function decodedNumberArray(field: string, value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new StoreDecodeError(`${field}: expected an array, found ${typeof value}`);
  }
  return (value as unknown[]).map((entry, index) =>
    decodedNumber(`${field}[${String(index)}]`, entry),
  );
}

function positionAt(field: string, latitude: number, longitude: number): GeographicPosition {
  return geographicPosition(
    decoded(`${field}.latitude`, latitude, degreesLatitude),
    decoded(`${field}.longitude`, longitude, degreesLongitude),
  );
}

function endpointOf(
  field: string,
  latitude: unknown,
  longitude: unknown,
  bearing: unknown,
  radius: unknown,
): SegmentEndpointRecord {
  return {
    position: positionAt(
      field,
      decodedNumber(`${field}.latitude`, latitude),
      decodedNumber(`${field}.longitude`, longitude),
    ),
    bearing: decoded(
      `${field}.bearing`,
      decodedNumber(`${field}.bearing`, bearing),
      degreesBearing,
    ),
    radius: decoded(`${field}.radius`, decodedNumber(`${field}.radius`, radius), metres),
  };
}
