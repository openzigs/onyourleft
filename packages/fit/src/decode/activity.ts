// SPDX-License-Identifier: Apache-2.0

/**
 * The decoded shape, and the mapping from container messages onto it.
 *
 * ## Why this is `packages/fit`'s own shape and not `packages/store`'s
 *
 * #30 had to settle a type that #31 and #32 inherit, and the three candidates
 * were: fit defines its own shape; hoist `packages/store`'s record types into
 * `packages/domain`; or expose a types-only subpath from `packages/store`.
 * This is the first, and the reason is that the mapping the other two exist to
 * remove does not go away.
 *
 * A decoder is handed bytes. It cannot produce an `ActivityId`, an
 * `AthleteId`, a display name, an ADR 0004 visibility or an IANA time zone —
 * every one of those is supplied by whoever imports the file (#37), not by the
 * file. So `ActivityRecord` is not the decoder's output under any of the three
 * options; hoisting it into `packages/domain` would move the type without
 * removing the step that converts into it. What the hoist *would* add is a
 * change to a merged package for no gain here, and — under option 3 — a
 * dependency from the codec onto the persistence package, which reads
 * backwards.
 *
 * What is shared instead is the thing that actually matters: **the units**.
 * Every measured value below is a `@onyourleft/domain` quantity, the same
 * branded types `packages/store`'s records and stream channels carry, so
 * mapping fit → store is a field rename and never a unit conversion. There is
 * no second unit system, which is the duplication that would have been
 * expensive.
 *
 * The shape is also symmetric, which is what #31 needs: decode is
 * `bytes → FitActivity` and encode will be `FitActivity → bytes`, with
 * `packages/fit` still depending on nothing but `@onyourleft/domain`.
 *
 * ## A gap is `undefined`
 *
 * Every field here is optional and a missing one is `undefined` — never zero,
 * never a sentinel. That is `packages/store`'s rule for stream gaps (ADR 0011)
 * and it is the same rule for the same reason: #30's fifth criterion is that
 * the indoor fixture decodes *"with an absent position channel rather than a
 * channel of zeros. Zeros here place the ride off the coast of Africa."*
 *
 * ## Faults never carry a value
 *
 * ADR 0004 decision D fixes the rule for an error message that touches a
 * coordinate: **the field and the constraint, never the value**. This file
 * applies that to every field rather than to positions alone, because the
 * message that reports a rejected latitude and the message that reports a
 * rejected cadence are written by the same code, and an exemption is where the
 * next coordinate leaks into a public CI log.
 */

import type {
  AltitudeMetres,
  BeatsPerMinute,
  DegreesCelsius,
  EventTicks,
  GeographicPosition,
  Metres,
  MetresPerSecond,
  RevolutionsPerMinute,
  Seconds,
  UnixSeconds,
  Watts,
} from '@onyourleft/domain';
import {
  beatsPerMinute,
  degreesCelsius,
  eventTicks,
  fitAltitudeToMetres,
  fitTimestampToUnixSeconds,
  isFitSystemTime,
  latitudeSemicircles,
  longitudeSemicircles,
  metres,
  metresPerSecond,
  revolutionsPerMinute,
  seconds,
  semicirclesToPosition,
  UnitError,
  watts,
} from '@onyourleft/domain';

import type { FitFieldValue } from './base-types';
import { isInvalidByteArray, readFieldValue } from './base-types';
import type { FitContainer, FitFileHeader, FitMessage } from './container';
import { streamFitContainer } from './container';
import { FitDecodeError } from './errors';
import { FIELD, GLOBAL_MESSAGE, SCALE } from './profile';

/**
 * A FIT `date_time`, which is two different things sharing one field.
 *
 * Values at or below `FIT_SYSTEM_TIME_MAX` are seconds since the device
 * powered on, not an instant — `packages/domain`'s `time.ts` says #30 is
 * *"expected to test it and treat the record's time as relative rather than
 * writing a 1989 date into a ride"*, and `timestamp-epoch-boundary.fit` is the
 * fixture that proves it. A union rather than two optional fields, so a
 * consumer cannot read one and forget the other exists.
 */
export type FitDateTime =
  | { readonly kind: 'instant'; readonly instant: UnixSeconds }
  | { readonly kind: 'systemTime'; readonly sinceDeviceStart: Seconds };

/** A developer field, resolved against its `field_description` where one exists. */
export interface FitDeveloperField {
  readonly developerDataIndex: number;
  readonly fieldDefinitionNumber: number;
  /** From the `field_description` message, when the file carried one. */
  readonly name: string | undefined;
  readonly units: string | undefined;
  /** The value, when the description declared a base type this decoder reads. */
  readonly numeric: number | undefined;
  readonly text: string | undefined;
  /** The field's bytes, always — an undescribed field is carried, never dropped. */
  readonly bytes: Uint8Array;
}

/** A `field_description` message: an application describing a field of its own. */
export interface FitDeveloperFieldDescription {
  readonly developerDataIndex: number;
  readonly fieldDefinitionNumber: number;
  readonly fitBaseTypeId: number | undefined;
  readonly name: string | undefined;
  readonly units: string | undefined;
}

/** A `developer_data_id` message: the application a developer field belongs to. */
export interface FitDeveloperApplication {
  readonly developerDataIndex: number | undefined;
  readonly applicationId: Uint8Array | undefined;
  readonly manufacturerId: number | undefined;
  readonly applicationVersion: number | undefined;
}

/** The `file_id` message, which says what the file is. */
export interface FitFileId {
  readonly type: number | undefined;
  readonly manufacturer: number | undefined;
  readonly product: number | undefined;
  readonly serialNumber: number | undefined;
  readonly timeCreated: FitDateTime | undefined;
}

/** A `device_info` message. */
export interface FitDeviceInfo {
  readonly timestamp: FitDateTime | undefined;
  readonly deviceIndex: number | undefined;
  readonly manufacturer: number | undefined;
  readonly serialNumber: number | undefined;
  readonly product: number | undefined;
  readonly softwareVersion: number | undefined;
}

/** An `event` message — a timer start or stop is what brackets a lap. */
export interface FitEvent {
  readonly timestamp: FitDateTime | undefined;
  readonly event: number | undefined;
  readonly eventType: number | undefined;
  readonly data: number | undefined;
}

/** One `record` message: a sample of the ride. */
export interface FitRecord {
  readonly timestamp: FitDateTime | undefined;
  /** Absent when the file declares no position, which is the indoor case. */
  readonly position: GeographicPosition | undefined;
  readonly altitude: AltitudeMetres | undefined;
  readonly distance: Metres | undefined;
  readonly speed: MetresPerSecond | undefined;
  readonly heartRate: BeatsPerMinute | undefined;
  readonly cadence: RevolutionsPerMinute | undefined;
  readonly power: Watts | undefined;
  readonly temperature: DegreesCelsius | undefined;
  readonly developerFields: readonly FitDeveloperField[];
}

/** A `lap` message. */
export interface FitLap {
  readonly timestamp: FitDateTime | undefined;
  readonly messageIndex: number | undefined;
  readonly startTime: FitDateTime | undefined;
  /** Wall-clock duration, pauses included. */
  readonly totalElapsedTime: Seconds | undefined;
  /** Duration excluding pauses. Different from `totalElapsedTime`, and both are read. */
  readonly totalTimerTime: Seconds | undefined;
  readonly totalDistance: Metres | undefined;
}

/** A `session` message. */
export interface FitSession {
  readonly timestamp: FitDateTime | undefined;
  readonly messageIndex: number | undefined;
  readonly startTime: FitDateTime | undefined;
  readonly sport: number | undefined;
  readonly totalElapsedTime: Seconds | undefined;
  readonly totalTimerTime: Seconds | undefined;
  readonly totalDistance: Metres | undefined;
  readonly numLaps: number | undefined;
}

/** The `activity` message, which wraps the sessions. */
export interface FitActivitySummary {
  readonly timestamp: FitDateTime | undefined;
  readonly totalTimerTime: Seconds | undefined;
  readonly numSessions: number | undefined;
  readonly type: number | undefined;
  readonly event: number | undefined;
  readonly eventType: number | undefined;
  readonly localTimestamp: FitDateTime | undefined;
}

/**
 * An `hr` message.
 *
 * `event_timestamp` is deliberately **not** scaled by 1024 here. It is a
 * free-running counter, `event-timestamp-1024-wrap.fit` walks it across its
 * rollover twice, and dividing a wrapped counter by its tick rate destroys the
 * modulus that `@onyourleft/domain`'s `unsignedCounterDelta` needs. The raw
 * reading is what #41 consumes.
 */
export interface FitHeartRateEvent {
  readonly timestamp: FitDateTime | undefined;
  readonly eventTimestamp: EventTicks | undefined;
}

/** Everything a FIT activity file said, in this project's units. */
export interface FitActivity {
  readonly header: FitFileHeader;
  readonly fileId: FitFileId | undefined;
  readonly deviceInfos: readonly FitDeviceInfo[];
  readonly events: readonly FitEvent[];
  readonly records: readonly FitRecord[];
  readonly laps: readonly FitLap[];
  readonly sessions: readonly FitSession[];
  readonly summary: FitActivitySummary | undefined;
  readonly heartRateEvents: readonly FitHeartRateEvent[];
  readonly developerApplications: readonly FitDeveloperApplication[];
  readonly developerFieldDescriptions: readonly FitDeveloperFieldDescription[];
  /**
   * Global message numbers this decoder's profile subset does not name, with
   * their occurrence counts.
   *
   * ADR 0006: *"A narrow profile means files containing messages outside it
   * decode with those messages skipped, not with an error."* Counted rather
   * than silently dropped, so "the profile is too narrow for this file" is
   * something a reviewer can see.
   */
  readonly skippedGlobalMessages: ReadonlyMap<number, number>;
}

/** What a decode produced, and everything that was wrong with the file. */
export interface FitDecodeResult {
  readonly activity: FitActivity;
  /**
   * Recoverable faults, each naming a byte offset. Empty for a clean file.
   *
   * Never merged into the activity: a caller that ignores this array gets the
   * data, and a caller that reads it can tell a rider the ride is short.
   */
  readonly faults: readonly FitDecodeError[];
}

// --- Field access -----------------------------------------------------------

function field(message: FitMessage, number: number): FitFieldValue | undefined {
  return message.fields.find((candidate) => candidate.number === number);
}

function numeric(message: FitMessage, number: number): number | undefined {
  return field(message, number)?.numeric;
}

function text(message: FitMessage, number: number): string | undefined {
  return field(message, number)?.text;
}

/**
 * A `byte`-typed field, absent when every one of its bytes is the invalid
 * marker — which is what the base type's own rule says a gap looks like.
 */
function bytesOf(message: FitMessage, number: number): Uint8Array | undefined {
  const found = field(message, number)?.bytes;
  if (found === undefined || isInvalidByteArray(found)) return undefined;
  return found;
}

/**
 * Apply a `@onyourleft/domain` constructor to a raw field, turning its
 * rejection into a fault rather than an exception.
 *
 * This is the boundary the domain package describes: *"Validation happens at
 * construction, once, at the boundary where an untrusted number becomes a typed
 * quantity — a decoded GATT payload, a field read out of a FIT file."* A
 * hostile file must not be able to throw out of the decoder, so every one of
 * those constructions goes through here.
 */
function quantity<T>(
  message: FitMessage,
  fieldNumber: number,
  what: string,
  make: (raw: number) => T,
  faults: FitDecodeError[],
): T | undefined {
  const found = field(message, fieldNumber);
  if (found?.numeric === undefined) return undefined;
  try {
    return make(found.numeric);
  } catch (cause) {
    if (!(cause instanceof UnitError)) throw cause;
    faults.push(
      new FitDecodeError(
        'invalid-field-value',
        found.byteOffset,
        `${what} (field ${String(fieldNumber)} of global message ` +
          `${String(message.globalMessageNumber)}) holds a value @onyourleft/domain rejects; ` +
          'the field is dropped',
      ),
    );
    return undefined;
  }
}

function dateTime(
  message: FitMessage,
  fieldNumber: number,
  what: string,
  faults: FitDecodeError[],
): FitDateTime | undefined {
  const compressed =
    fieldNumber === FIELD.timestamp && field(message, FIELD.timestamp) === undefined
      ? message.compressedTimestamp
      : undefined;
  const raw = compressed ?? numeric(message, fieldNumber);
  if (raw === undefined) return undefined;
  try {
    return isFitSystemTime(raw)
      ? { kind: 'systemTime', sinceDeviceStart: seconds(raw) }
      : { kind: 'instant', instant: fitTimestampToUnixSeconds(raw) };
  } catch (cause) {
    if (!(cause instanceof UnitError)) throw cause;
    faults.push(
      new FitDecodeError(
        'invalid-field-value',
        field(message, fieldNumber)?.byteOffset ?? message.byteOffset,
        `${what} (field ${String(fieldNumber)} of global message ` +
          `${String(message.globalMessageNumber)}) is not a FIT date_time; the field is dropped`,
      ),
    );
    return undefined;
  }
}

// --- Messages ---------------------------------------------------------------

function readPosition(
  message: FitMessage,
  faults: FitDecodeError[],
): GeographicPosition | undefined {
  const latitude = numeric(message, FIELD.record.positionLatitude);
  const longitude = numeric(message, FIELD.record.positionLongitude);
  if (latitude === undefined && longitude === undefined) return undefined;
  if (latitude === undefined || longitude === undefined) {
    faults.push(
      new FitDecodeError(
        'invalid-field-value',
        message.byteOffset,
        'a record carries one half of a position: a latitude with no longitude beside it, or the ' +
          'reverse. A position needs both, so it is dropped rather than paired with a zero',
      ),
    );
    return undefined;
  }
  try {
    // The two labelling functions are distinct branded types, so these
    // arguments cannot be transposed without a compile error. This is the one
    // place in the decoder where an unlabelled sint32 becomes a coordinate, as
    // `packages/domain`'s index.ts requires: "#30 and #31 must call them at the
    // field read, where a reviewer can see which field is which".
    return semicirclesToPosition(latitudeSemicircles(latitude), longitudeSemicircles(longitude));
  } catch (cause) {
    if (!(cause instanceof UnitError)) throw cause;
    faults.push(
      new FitDecodeError(
        'invalid-field-value',
        field(message, FIELD.record.positionLatitude)?.byteOffset ?? message.byteOffset,
        'a record position is outside the range a latitude and longitude pair can take; the ' +
          'position is dropped',
      ),
    );
    return undefined;
  }
}

function readRecord(
  message: FitMessage,
  descriptions: ReadonlyMap<string, FitDeveloperFieldDescription>,
  faults: FitDecodeError[],
): FitRecord {
  return {
    timestamp: dateTime(message, FIELD.timestamp, 'record.timestamp', faults),
    position: readPosition(message, faults),
    altitude: quantity(
      message,
      FIELD.record.altitude,
      'record.altitude',
      fitAltitudeToMetres,
      faults,
    ),
    distance: quantity(
      message,
      FIELD.record.distance,
      'record.distance',
      (raw) => metres(raw / SCALE.distance),
      faults,
    ),
    speed: quantity(
      message,
      FIELD.record.speed,
      'record.speed',
      (raw) => metresPerSecond(raw / SCALE.speed),
      faults,
    ),
    heartRate: quantity(
      message,
      FIELD.record.heartRate,
      'record.heart_rate',
      beatsPerMinute,
      faults,
    ),
    cadence: quantity(
      message,
      FIELD.record.cadence,
      'record.cadence',
      revolutionsPerMinute,
      faults,
    ),
    power: quantity(message, FIELD.record.power, 'record.power', watts, faults),
    temperature: quantity(
      message,
      FIELD.record.temperature,
      'record.temperature',
      degreesCelsius,
      faults,
    ),
    developerFields: readDeveloperFields(message, descriptions),
  };
}

function descriptionKey(developerDataIndex: number, fieldDefinitionNumber: number): string {
  return `${String(developerDataIndex)}/${String(fieldDefinitionNumber)}`;
}

/**
 * Resolve a message's developer fields against the descriptions the whole file
 * carried.
 *
 * The descriptions are gathered in a first pass over every message, so a
 * `field_description` that arrives *after* the record it describes still
 * resolves — the alignment requirement #30's revision block calls out by name.
 * A field with no description at all keeps its bytes and its indices: carried,
 * never fatal, which is the fourth acceptance criterion.
 */
function readDeveloperFields(
  message: FitMessage,
  descriptions: ReadonlyMap<string, FitDeveloperFieldDescription>,
): readonly FitDeveloperField[] {
  return message.developerFields.map((found) => {
    const description = descriptions.get(
      descriptionKey(found.developerDataIndex, found.fieldDefinitionNumber),
    );
    const base = {
      developerDataIndex: found.developerDataIndex,
      fieldDefinitionNumber: found.fieldDefinitionNumber,
      name: description?.name,
      units: description?.units,
      bytes: found.bytes,
    };
    if (description?.fitBaseTypeId === undefined) {
      return { ...base, numeric: undefined, text: undefined };
    }
    const view = new DataView(found.bytes.buffer, found.bytes.byteOffset, found.bytes.byteLength);
    const value = readFieldValue(
      found.bytes,
      view,
      {
        number: found.fieldDefinitionNumber,
        size: found.bytes.length,
        baseType: description.fitBaseTypeId,
      },
      0,
      found.littleEndian,
    );
    return { ...base, numeric: value.numeric, text: value.text };
  });
}

// --- Assembly ---------------------------------------------------------------

/**
 * The `field_description` messages a file carries, gathered on their own.
 *
 * The first of the two passes assembly needs, split out so that it can be run
 * over a *stream* of messages rather than over an array of them — #127. It is
 * the pass that cannot be folded into the second: a `field_description` may
 * arrive after the record it describes, which is the alignment requirement
 * #30's revision block names, so the map has to be complete before the first
 * record is mapped.
 *
 * What it retains is bounded by the file's descriptions rather than by its
 * records, which is what makes streaming worth doing: a four-hour ride is
 * hundreds of thousands of records and a handful of descriptions.
 */
function createDescriptionCollector(): {
  accept: (message: FitMessage) => void;
  readonly descriptions: ReadonlyMap<string, FitDeveloperFieldDescription>;
  readonly descriptionList: readonly FitDeveloperFieldDescription[];
} {
  const descriptions = new Map<string, FitDeveloperFieldDescription>();
  const descriptionList: FitDeveloperFieldDescription[] = [];
  return {
    descriptions,
    descriptionList,
    accept(message: FitMessage): void {
      if (message.globalMessageNumber !== GLOBAL_MESSAGE.fieldDescription) return;
      const developerDataIndex = numeric(message, FIELD.fieldDescription.developerDataIndex);
      const fieldDefinitionNumber = numeric(message, FIELD.fieldDescription.fieldDefinitionNumber);
      if (developerDataIndex === undefined || fieldDefinitionNumber === undefined) return;
      const description: FitDeveloperFieldDescription = {
        developerDataIndex,
        fieldDefinitionNumber,
        fitBaseTypeId: numeric(message, FIELD.fieldDescription.fitBaseTypeId),
        name: text(message, FIELD.fieldDescription.fieldName),
        units: text(message, FIELD.fieldDescription.units),
      };
      descriptions.set(descriptionKey(developerDataIndex, fieldDefinitionNumber), description);
      descriptionList.push(description);
    },
  };
}

/**
 * The second pass, as something that takes one message at a time.
 *
 * This is the body of what used to be `decodeActivity`'s second loop, turned
 * inside out so that the caller decides where the messages come from: an array
 * for {@link decodeActivity}, a container walk for
 * {@link decodeFitActivityFromBytes}. Nothing about *what* it does changed, and
 * two tests say so rather than one: `decode-corpus.test.ts` compares the two
 * spellings over every committed fixture, and the fuzz harness's *"pins the
 * public entry point"* case compares them on mutated files, throw for throw.
 *
 * `faults` is passed in already seeded with the container's own, because their
 * order relative to the assembly's is part of the result.
 */
function createActivityAssembler(
  descriptions: ReadonlyMap<string, FitDeveloperFieldDescription>,
  descriptionList: readonly FitDeveloperFieldDescription[],
  faults: FitDecodeError[],
): {
  accept: (message: FitMessage) => void;
  finish: (header: FitFileHeader) => FitDecodeResult;
} {
  let fileId: FitFileId | undefined;
  let summary: FitActivitySummary | undefined;
  const deviceInfos: FitDeviceInfo[] = [];
  const events: FitEvent[] = [];
  const records: FitRecord[] = [];
  const laps: FitLap[] = [];
  const sessions: FitSession[] = [];
  const heartRateEvents: FitHeartRateEvent[] = [];
  const developerApplications: FitDeveloperApplication[] = [];
  const skippedGlobalMessages = new Map<number, number>();

  function accept(message: FitMessage): void {
    switch (message.globalMessageNumber) {
      case GLOBAL_MESSAGE.fileId:
        // First one wins, and a second is a fault rather than a replacement.
        // `file_id` is the file's identity — the manufacturer, serial number
        // and creation time an importer attributes and deduplicates on — and
        // the protocol puts it first. Overwriting would let a message near the
        // end of the file choose that identity, which is a decision a crafted
        // file should not get to make silently. See `duplicate-file-id`.
        if (fileId !== undefined) {
          faults.push(
            new FitDecodeError(
              'duplicate-file-id',
              message.byteOffset,
              'a second file_id message arrived after the file identity was already read; ' +
                'the first one is kept and this one is dropped',
            ),
          );
          break;
        }
        fileId = {
          type: numeric(message, FIELD.fileId.type),
          manufacturer: numeric(message, FIELD.fileId.manufacturer),
          product: numeric(message, FIELD.fileId.product),
          serialNumber: numeric(message, FIELD.fileId.serialNumber),
          timeCreated: dateTime(message, FIELD.fileId.timeCreated, 'file_id.time_created', faults),
        };
        break;

      case GLOBAL_MESSAGE.deviceInfo:
        deviceInfos.push({
          timestamp: dateTime(message, FIELD.timestamp, 'device_info.timestamp', faults),
          deviceIndex: numeric(message, FIELD.deviceInfo.deviceIndex),
          manufacturer: numeric(message, FIELD.deviceInfo.manufacturer),
          serialNumber: numeric(message, FIELD.deviceInfo.serialNumber),
          product: numeric(message, FIELD.deviceInfo.product),
          softwareVersion: numeric(message, FIELD.deviceInfo.softwareVersion),
        });
        break;

      case GLOBAL_MESSAGE.event:
        events.push({
          timestamp: dateTime(message, FIELD.timestamp, 'event.timestamp', faults),
          event: numeric(message, FIELD.event.event),
          eventType: numeric(message, FIELD.event.eventType),
          data: numeric(message, FIELD.event.data),
        });
        break;

      case GLOBAL_MESSAGE.record:
        records.push(readRecord(message, descriptions, faults));
        break;

      case GLOBAL_MESSAGE.lap:
        laps.push({
          timestamp: dateTime(message, FIELD.timestamp, 'lap.timestamp', faults),
          messageIndex: numeric(message, FIELD.messageIndex),
          startTime: dateTime(message, FIELD.lap.startTime, 'lap.start_time', faults),
          totalElapsedTime: quantity(
            message,
            FIELD.lap.totalElapsedTime,
            'lap.total_elapsed_time',
            (raw) => seconds(raw / SCALE.time),
            faults,
          ),
          totalTimerTime: quantity(
            message,
            FIELD.lap.totalTimerTime,
            'lap.total_timer_time',
            (raw) => seconds(raw / SCALE.time),
            faults,
          ),
          totalDistance: quantity(
            message,
            FIELD.lap.totalDistance,
            'lap.total_distance',
            (raw) => metres(raw / SCALE.distance),
            faults,
          ),
        });
        break;

      case GLOBAL_MESSAGE.session:
        sessions.push({
          timestamp: dateTime(message, FIELD.timestamp, 'session.timestamp', faults),
          messageIndex: numeric(message, FIELD.messageIndex),
          startTime: dateTime(message, FIELD.session.startTime, 'session.start_time', faults),
          sport: numeric(message, FIELD.session.sport),
          totalElapsedTime: quantity(
            message,
            FIELD.session.totalElapsedTime,
            'session.total_elapsed_time',
            (raw) => seconds(raw / SCALE.time),
            faults,
          ),
          totalTimerTime: quantity(
            message,
            FIELD.session.totalTimerTime,
            'session.total_timer_time',
            (raw) => seconds(raw / SCALE.time),
            faults,
          ),
          totalDistance: quantity(
            message,
            FIELD.session.totalDistance,
            'session.total_distance',
            (raw) => metres(raw / SCALE.distance),
            faults,
          ),
          numLaps: numeric(message, FIELD.session.numLaps),
        });
        break;

      case GLOBAL_MESSAGE.activity:
        summary = {
          timestamp: dateTime(message, FIELD.timestamp, 'activity.timestamp', faults),
          totalTimerTime: quantity(
            message,
            FIELD.activity.totalTimerTime,
            'activity.total_timer_time',
            (raw) => seconds(raw / SCALE.time),
            faults,
          ),
          numSessions: numeric(message, FIELD.activity.numSessions),
          type: numeric(message, FIELD.activity.type),
          event: numeric(message, FIELD.activity.event),
          eventType: numeric(message, FIELD.activity.eventType),
          localTimestamp: dateTime(
            message,
            FIELD.activity.localTimestamp,
            'activity.local_timestamp',
            faults,
          ),
        };
        break;

      case GLOBAL_MESSAGE.hr:
        heartRateEvents.push({
          timestamp: dateTime(message, FIELD.timestamp, 'hr.timestamp', faults),
          eventTimestamp: quantity(
            message,
            FIELD.hr.eventTimestamp,
            'hr.event_timestamp',
            eventTicks,
            faults,
          ),
        });
        break;

      case GLOBAL_MESSAGE.developerDataId:
        developerApplications.push({
          developerDataIndex: numeric(message, FIELD.developerDataId.developerDataIndex),
          applicationId: bytesOf(message, FIELD.developerDataId.applicationId),
          manufacturerId: numeric(message, FIELD.developerDataId.manufacturerId),
          applicationVersion: numeric(message, FIELD.developerDataId.applicationVersion),
        });
        break;

      case GLOBAL_MESSAGE.fieldDescription:
        // Already gathered in the pass above, so that a description arriving
        // after the record it describes still resolves.
        break;

      default:
        skippedGlobalMessages.set(
          message.globalMessageNumber,
          (skippedGlobalMessages.get(message.globalMessageNumber) ?? 0) + 1,
        );
        break;
    }
  }

  function finish(header: FitFileHeader): FitDecodeResult {
    return {
      activity: {
        header,
        fileId,
        deviceInfos,
        events,
        records,
        laps,
        sessions,
        summary,
        heartRateEvents,
        developerApplications,
        developerFieldDescriptions: descriptionList,
        skippedGlobalMessages,
      },
      faults,
    };
  }

  return { accept, finish };
}

/**
 * Turn a read container into the decoded activity. Never throws on content.
 *
 * Takes every message at once, so its peak retention is the caller's array plus
 * the activity. `container.test.ts` and the fuzz harness use it because they
 * want the messages themselves; **an importer handed an untrusted file should
 * call {@link decodeFitActivityFromBytes} instead**, which is the same decode
 * without the array — see #127 and the note on `streamFitContainer`.
 */
export function decodeActivity(container: FitContainer): FitDecodeResult {
  const collector = createDescriptionCollector();
  for (const message of container.messages) collector.accept(message);
  const assembler = createActivityAssembler(collector.descriptions, collector.descriptionList, [
    ...container.faults,
  ]);
  for (const message of container.messages) assembler.accept(message);
  return assembler.finish(container.header);
}

/**
 * What a caller may assume about how much memory decoding a file costs — #127.
 *
 * **A constant, and deliberately not a number read from the file.** That is the
 * #27 lesson restated: the guard that failed there was bounded by the row's own
 * declared sample count, so a hostile row raised its own ceiling. Nothing below
 * or above consults the header's `dataSize`, a field count or any other value
 * the file supplies.
 *
 * The number is a **ceiling, measured rather than chosen**, and it is not a
 * budget to spend: on the 4.55 MiB fixture the streaming decode peaks at 10.5
 * bytes of heap per byte of file and the array-building spelling at 97.2, so 32
 * sits with a 3x margin on each side. `tools/memory/retention.test.ts` asserts
 * both — that the decoder is under it *and* that the shape #127 was filed about
 * is over it. A bound only one implementation can fail is a bound; a bound
 * every implementation passes is a comment.
 *
 * What it is **not** is a promise about a file crafted to be pathological. The
 * shape #127 measured is linear per-record overhead on an ordinary ride, and
 * this is the answer to that; a file that is nothing but two-byte
 * `field_description` records still costs more per byte than a ride does,
 * because the descriptions are the one thing pass 1 keeps.
 * `assertOutputBoundedByInput` in `tools/fuzz/invariants.ts` is what bounds
 * *that* — it is checked on every one of the fuzz's tens of thousands of cases,
 * where a heap measurement cannot go.
 *
 * #51 is the first production caller. It may size an import against this: a
 * 20 MiB file, the top of what a multi-hour ride reaches, costs under 640 MiB
 * at the ceiling and about 210 MiB in practice.
 */
export const MAXIMUM_RETAINED_BYTES_PER_INPUT_BYTE = 32;

/**
 * Decode a FIT activity without ever holding the whole message stream — #127.
 *
 * Two walks of the same bytes, neither of which retains a message:
 *
 * 1. gather the `field_description` messages, which is the pass that has to
 *    finish before any record is mapped;
 * 2. assemble, one message at a time.
 *
 * The container walk is deterministic in its input, so the second walk produces
 * the same messages and the same faults as the first — which is why the faults
 * the assembler is seeded with can come from the first pass and the ordering
 * still matches {@link decodeActivity} exactly.
 *
 * **The cost is a second walk of the record stream; the saving is the array.**
 * Measured on the 4.55 MiB fixture, Node 24:
 *
 *     peak heap   442.5 MiB -> 48.1 MiB     97.2 bytes per input byte -> 10.5
 *     wall clock    0.33 s  ->  0.41 s
 *
 * A second full walk costs 25% rather than 100% because the walk was never the
 * expensive half: allocating and keeping 177 800 message objects was, and the
 * second walk reuses the memory the first one finished with.
 *
 * `tools/memory/retention.test.ts` is the measurement, and it asserts both
 * halves: that this path holds {@link MAXIMUM_RETAINED_BYTES_PER_INPUT_BYTE}
 * and that the array-building path does not, so the bound cannot be quietly
 * raised until anything passes it.
 *
 * @throws {FitDecodeError} exactly as `streamFitContainer` does.
 */
export function decodeFitActivityFromBytes(bytes: Uint8Array): FitDecodeResult {
  const collector = createDescriptionCollector();
  const described = streamFitContainer(bytes, collector.accept);
  const assembler = createActivityAssembler(collector.descriptions, collector.descriptionList, [
    ...described.faults,
  ]);
  streamFitContainer(bytes, assembler.accept);
  return assembler.finish(described.header);
}
