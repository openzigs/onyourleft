// SPDX-License-Identifier: Apache-2.0

/**
 * The decoded shape, written back out as a FIT activity file.
 *
 * `decode/activity.ts` is `bytes → FitActivity`; this is the other direction,
 * and it is deliberately the *same shape*, which #30 chose with #31 in mind:
 * *"decode is `bytes → FitActivity` and encode will be `FitActivity → bytes`,
 * with `packages/fit` still depending on nothing but `@onyourleft/domain`."*
 *
 * ## What "a gap encodes as absent, never as zero" means here
 *
 * Two different things, at two levels, and #31 asks for both:
 *
 * - **A channel no record carries is not declared at all.** The indoor case:
 *   `indoor-trainer-no-position.fit` has no `position_lat` / `position_long`
 *   field in its record definition, rather than a channel of invalid markers
 *   and certainly not a channel of zeros. The surveys below decide this, and a
 *   channel that is absent from every record never reaches the definition
 *   message.
 * - **A record missing a channel other records carry writes the invalid
 *   marker.** The dropout case: `sensor-dropout-30s.fit` has thirty seconds of
 *   `0xFF` heart rate between two runs of real ones. Zero would be a plausible
 *   number and this is the difference between "the strap was not reporting" and
 *   "the rider produced no watts".
 *
 * And a third, which is the one the acceptance criterion is actually written
 * about: **a pause is an absence of records**, not a run of zero-valued ones.
 * That falls out of writing exactly the records handed in — `paused-laps.fit`
 * has a 300 s hole with no `record` messages in it, and re-encoding it produces
 * the same hole.
 *
 * ## Provenance — ADR 0006 R1, R2, R4
 *
 * Every message number, field number and scale used here comes from
 * `decode/profile.ts`, whose provenance is recorded per message in
 * `packages/fit/README.md` §3. Nothing new was read to write this file and no
 * number was added to the profile. **No Garmin FIT SDK, `Profile.xlsx`,
 * `fit-sdk-tools` artefact, `FitCSVTool`, `Fitgen` or `ActivityRepairTool` was
 * consulted, downloaded, installed or read in the course of this work.**
 */

import type { GeographicPosition } from '@onyourleft/domain';
import {
  degreesLatitudeToSemicircles,
  degreesLongitudeToSemicircles,
  FIT_SYSTEM_TIME_MAX,
  metresToFitAltitude,
  unixSecondsToFitTimestamp,
  UnitError,
} from '@onyourleft/domain';

import type {
  FitActivitySummary,
  FitDateTime,
  FitDeveloperApplication,
  FitDeveloperField,
  FitDeveloperFieldDescription,
  FitDeviceInfo,
  FitEvent,
  FitFileId,
  FitHeartRateEvent,
  FitLap,
  FitRecord,
  FitSession,
} from '../decode/activity';
import { FIELD, GLOBAL_MESSAGE, SCALE } from '../decode/profile';
import type {
  EncodeDeveloperFieldDefinition,
  EncodeFieldDefinition,
  EncodeValue,
} from './container';
import { BASE_TYPE, bytesValue, FitContainerWriter, numericValue, textValue } from './container';
import { FitEncodeError } from './errors';
import {
  ENUM_CANDIDATES,
  FieldSurvey,
  representable,
  SINT32_CANDIDATES,
  SINT8_CANDIDATES,
  UINT16_CANDIDATES,
  UINT32_CANDIDATES,
  UINT8_CANDIDATES,
} from './fields';
import { fitStringSize } from './utf8';

/**
 * An activity on its way out.
 *
 * Every collection is optional and defaults to empty, because the caller that
 * matters most — an export of a ride recorded on a trainer — has records, one
 * lap, one session and a summary, and no `hr` messages or developer fields at
 * all. `FitActivity` from the decoder satisfies this type structurally, which
 * is what makes `encode(decode(bytes))` something a test can write directly.
 */
export interface FitEncodeInput {
  readonly fileId?: FitFileId | undefined;
  readonly deviceInfos?: readonly FitDeviceInfo[] | undefined;
  readonly events?: readonly FitEvent[] | undefined;
  readonly records?: readonly FitRecord[] | undefined;
  readonly laps?: readonly FitLap[] | undefined;
  readonly sessions?: readonly FitSession[] | undefined;
  readonly summary?: FitActivitySummary | undefined;
  readonly heartRateEvents?: readonly FitHeartRateEvent[] | undefined;
  readonly developerApplications?: readonly FitDeveloperApplication[] | undefined;
  readonly developerFieldDescriptions?: readonly FitDeveloperFieldDescription[] | undefined;
}

/** What an encode produced, and everything in the input it could not carry. */
export interface FitEncodeResult {
  readonly bytes: Uint8Array;
  /**
   * Fields that could not be written, each naming its message and field number.
   *
   * Never merged into the bytes: a caller that ignores this array gets a valid
   * file, and a caller that reads it can tell a rider which channel did not
   * survive the export. Empty for a clean encode.
   */
  readonly faults: readonly FitEncodeError[];
}

// --- Field specifications ---------------------------------------------------

interface NumericSpec<T> {
  readonly kind: 'numeric';
  readonly number: number;
  readonly what: string;
  readonly candidates: readonly number[];
  readonly raw: (item: T, faults: FitEncodeError[]) => number | undefined;
}

interface TextSpec<T> {
  readonly kind: 'text';
  readonly number: number;
  readonly raw: (item: T) => string | undefined;
}

interface BytesSpec<T> {
  readonly kind: 'bytes';
  readonly number: number;
  readonly raw: (item: T) => Uint8Array | undefined;
}

type FieldSpec<T> = NumericSpec<T> | TextSpec<T> | BytesSpec<T>;

function numeric<T>(
  number: number,
  what: string,
  candidates: readonly number[],
  raw: (item: T, faults: FitEncodeError[]) => number | undefined,
): NumericSpec<T> {
  return { kind: 'numeric', number, what, candidates, raw };
}

// --- Conversions that can fail ----------------------------------------------

/**
 * Turn a `@onyourleft/domain` rejection into a fault rather than an exception.
 *
 * The mirror of `decode/activity.ts`'s `quantity`, and for the same reason: the
 * activity being written may have come from a file, and a hostile file must not
 * be able to throw out of either half of the codec.
 */
function convert<T>(
  value: T | undefined,
  make: (raw: T) => number,
  globalMessageNumber: number,
  fieldNumber: number,
  what: string,
  faults: FitEncodeError[],
): number | undefined {
  if (value === undefined) return undefined;
  try {
    return make(value);
  } catch (cause) {
    if (!(cause instanceof UnitError)) throw cause;
    faults.push(
      new FitEncodeError(
        'value-not-representable',
        `${what} holds a value @onyourleft/domain cannot encode into its FIT field; the field ` +
          'is written as a gap',
        { globalMessageNumber, fieldNumber },
      ),
    );
    return undefined;
  }
}

/**
 * A `date_time`, as the raw `uint32` the field holds.
 *
 * The union the decoder produces is round-tripped rather than flattened, which
 * #30's revision block requires of #31 by name. A `systemTime` reading is
 * already in the field's own units and goes back untouched; an `instant` goes
 * through `unixSecondsToFitTimestamp`.
 *
 * The third branch is the one that is easy to miss. FIT reserves `date_time`
 * values at or below `FIT_SYSTEM_TIME_MAX` for "seconds since the device
 * powered on", and that range covers real instants from 1989-12-31 to
 * 1998-07-03T21:24:15Z. Writing such an instant produces a file whose timestamps a
 * conforming reader — this decoder included — reads back as system time. There
 * is no other representation, so the bytes are written and a fault says so.
 */
function dateTime(
  value: FitDateTime | undefined,
  globalMessageNumber: number,
  fieldNumber: number,
  what: string,
  faults: FitEncodeError[],
): number | undefined {
  if (value === undefined) return undefined;
  if (value.kind === 'systemTime') return value.sinceDeviceStart;
  let raw: number;
  try {
    raw = unixSecondsToFitTimestamp(value.instant);
  } catch (cause) {
    if (!(cause instanceof UnitError)) throw cause;
    faults.push(
      new FitEncodeError(
        'instant-not-representable',
        `${what} is an instant with no FIT date_time — before the 1989 epoch, or past what a ` +
          'uint32 holds; the timestamp is written as a gap',
        { globalMessageNumber, fieldNumber },
      ),
    );
    return undefined;
  }
  if (raw <= FIT_SYSTEM_TIME_MAX) {
    faults.push(
      new FitEncodeError(
        'instant-reads-back-as-system-time',
        `${what} falls in the date_time range FIT reserves for seconds since a device powered ` +
          'on, so a conforming reader will not read it back as an instant; it is written anyway ' +
          'because the format offers no other representation',
        { globalMessageNumber, fieldNumber },
      ),
    );
  }
  return raw;
}

function scaled(value: number | undefined, scale: number): number | undefined {
  return value === undefined ? undefined : Math.round(value * scale);
}

function latitudeOf(position: GeographicPosition | undefined): number | undefined {
  return position === undefined ? undefined : degreesLatitudeToSemicircles(position.latitude);
}

function longitudeOf(position: GeographicPosition | undefined): number | undefined {
  return position === undefined ? undefined : degreesLongitudeToSemicircles(position.longitude);
}

// --- The profile subset, in the writing direction ---------------------------

const FILE_ID_SPECS: readonly FieldSpec<FitFileId>[] = [
  numeric(FIELD.fileId.type, 'file_id.type', ENUM_CANDIDATES, (item) => item.type),
  numeric(
    FIELD.fileId.manufacturer,
    'file_id.manufacturer',
    UINT16_CANDIDATES,
    (item) => item.manufacturer,
  ),
  numeric(FIELD.fileId.product, 'file_id.product', UINT16_CANDIDATES, (item) => item.product),
  numeric(
    FIELD.fileId.serialNumber,
    'file_id.serial_number',
    UINT32_CANDIDATES,
    (item) => item.serialNumber,
  ),
  numeric(FIELD.fileId.timeCreated, 'file_id.time_created', UINT32_CANDIDATES, (item, faults) =>
    dateTime(
      item.timeCreated,
      GLOBAL_MESSAGE.fileId,
      FIELD.fileId.timeCreated,
      'file_id.time_created',
      faults,
    ),
  ),
];

const DEVICE_INFO_SPECS: readonly FieldSpec<FitDeviceInfo>[] = [
  numeric(FIELD.timestamp, 'device_info.timestamp', UINT32_CANDIDATES, (item, faults) =>
    dateTime(
      item.timestamp,
      GLOBAL_MESSAGE.deviceInfo,
      FIELD.timestamp,
      'device_info.timestamp',
      faults,
    ),
  ),
  numeric(
    FIELD.deviceInfo.deviceIndex,
    'device_info.device_index',
    UINT8_CANDIDATES,
    (item) => item.deviceIndex,
  ),
  numeric(
    FIELD.deviceInfo.manufacturer,
    'device_info.manufacturer',
    UINT16_CANDIDATES,
    (item) => item.manufacturer,
  ),
  numeric(
    FIELD.deviceInfo.serialNumber,
    'device_info.serial_number',
    UINT32_CANDIDATES,
    (item) => item.serialNumber,
  ),
  numeric(
    FIELD.deviceInfo.product,
    'device_info.product',
    UINT16_CANDIDATES,
    (item) => item.product,
  ),
  numeric(
    FIELD.deviceInfo.softwareVersion,
    'device_info.software_version',
    UINT16_CANDIDATES,
    (item) => item.softwareVersion,
  ),
];

const EVENT_SPECS: readonly FieldSpec<FitEvent>[] = [
  numeric(FIELD.timestamp, 'event.timestamp', UINT32_CANDIDATES, (item, faults) =>
    dateTime(item.timestamp, GLOBAL_MESSAGE.event, FIELD.timestamp, 'event.timestamp', faults),
  ),
  numeric(FIELD.event.event, 'event.event', ENUM_CANDIDATES, (item) => item.event),
  numeric(FIELD.event.eventType, 'event.event_type', ENUM_CANDIDATES, (item) => item.eventType),
  numeric(FIELD.event.data, 'event.data', UINT32_CANDIDATES, (item) => item.data),
];

const RECORD_SPECS: readonly FieldSpec<FitRecord>[] = [
  numeric(FIELD.timestamp, 'record.timestamp', UINT32_CANDIDATES, (item, faults) =>
    dateTime(item.timestamp, GLOBAL_MESSAGE.record, FIELD.timestamp, 'record.timestamp', faults),
  ),
  numeric(FIELD.record.positionLatitude, 'record.position_lat', SINT32_CANDIDATES, (item) =>
    latitudeOf(item.position),
  ),
  numeric(FIELD.record.positionLongitude, 'record.position_long', SINT32_CANDIDATES, (item) =>
    longitudeOf(item.position),
  ),
  numeric(FIELD.record.altitude, 'record.altitude', UINT16_CANDIDATES, (item, faults) =>
    convert(
      item.altitude,
      metresToFitAltitude,
      GLOBAL_MESSAGE.record,
      FIELD.record.altitude,
      'record.altitude',
      faults,
    ),
  ),
  numeric(FIELD.record.heartRate, 'record.heart_rate', UINT8_CANDIDATES, (item) => item.heartRate),
  numeric(FIELD.record.cadence, 'record.cadence', UINT8_CANDIDATES, (item) => item.cadence),
  numeric(FIELD.record.distance, 'record.distance', UINT32_CANDIDATES, (item) =>
    scaled(item.distance, SCALE.distance),
  ),
  numeric(FIELD.record.speed, 'record.speed', UINT16_CANDIDATES, (item) =>
    scaled(item.speed, SCALE.speed),
  ),
  numeric(FIELD.record.power, 'record.power', UINT16_CANDIDATES, (item) => item.power),
  numeric(
    FIELD.record.temperature,
    'record.temperature',
    SINT8_CANDIDATES,
    (item) => item.temperature,
  ),
];

const LAP_SPECS: readonly FieldSpec<FitLap>[] = [
  numeric(FIELD.timestamp, 'lap.timestamp', UINT32_CANDIDATES, (item, faults) =>
    dateTime(item.timestamp, GLOBAL_MESSAGE.lap, FIELD.timestamp, 'lap.timestamp', faults),
  ),
  numeric(FIELD.messageIndex, 'lap.message_index', UINT16_CANDIDATES, (item) => item.messageIndex),
  numeric(FIELD.lap.startTime, 'lap.start_time', UINT32_CANDIDATES, (item, faults) =>
    dateTime(item.startTime, GLOBAL_MESSAGE.lap, FIELD.lap.startTime, 'lap.start_time', faults),
  ),
  numeric(FIELD.lap.totalElapsedTime, 'lap.total_elapsed_time', UINT32_CANDIDATES, (item) =>
    scaled(item.totalElapsedTime, SCALE.time),
  ),
  numeric(FIELD.lap.totalTimerTime, 'lap.total_timer_time', UINT32_CANDIDATES, (item) =>
    scaled(item.totalTimerTime, SCALE.time),
  ),
  numeric(FIELD.lap.totalDistance, 'lap.total_distance', UINT32_CANDIDATES, (item) =>
    scaled(item.totalDistance, SCALE.distance),
  ),
];

const SESSION_SPECS: readonly FieldSpec<FitSession>[] = [
  numeric(FIELD.timestamp, 'session.timestamp', UINT32_CANDIDATES, (item, faults) =>
    dateTime(item.timestamp, GLOBAL_MESSAGE.session, FIELD.timestamp, 'session.timestamp', faults),
  ),
  numeric(
    FIELD.messageIndex,
    'session.message_index',
    UINT16_CANDIDATES,
    (item) => item.messageIndex,
  ),
  numeric(FIELD.session.startTime, 'session.start_time', UINT32_CANDIDATES, (item, faults) =>
    dateTime(
      item.startTime,
      GLOBAL_MESSAGE.session,
      FIELD.session.startTime,
      'session.start_time',
      faults,
    ),
  ),
  numeric(FIELD.session.sport, 'session.sport', ENUM_CANDIDATES, (item) => item.sport),
  numeric(FIELD.session.totalElapsedTime, 'session.total_elapsed_time', UINT32_CANDIDATES, (item) =>
    scaled(item.totalElapsedTime, SCALE.time),
  ),
  numeric(FIELD.session.totalTimerTime, 'session.total_timer_time', UINT32_CANDIDATES, (item) =>
    scaled(item.totalTimerTime, SCALE.time),
  ),
  numeric(FIELD.session.totalDistance, 'session.total_distance', UINT32_CANDIDATES, (item) =>
    scaled(item.totalDistance, SCALE.distance),
  ),
  numeric(FIELD.session.numLaps, 'session.num_laps', UINT16_CANDIDATES, (item) => item.numLaps),
];

const ACTIVITY_SPECS: readonly FieldSpec<FitActivitySummary>[] = [
  numeric(FIELD.timestamp, 'activity.timestamp', UINT32_CANDIDATES, (item, faults) =>
    dateTime(
      item.timestamp,
      GLOBAL_MESSAGE.activity,
      FIELD.timestamp,
      'activity.timestamp',
      faults,
    ),
  ),
  numeric(FIELD.activity.totalTimerTime, 'activity.total_timer_time', UINT32_CANDIDATES, (item) =>
    scaled(item.totalTimerTime, SCALE.time),
  ),
  numeric(
    FIELD.activity.numSessions,
    'activity.num_sessions',
    UINT16_CANDIDATES,
    (item) => item.numSessions,
  ),
  numeric(FIELD.activity.type, 'activity.type', ENUM_CANDIDATES, (item) => item.type),
  numeric(FIELD.activity.event, 'activity.event', ENUM_CANDIDATES, (item) => item.event),
  numeric(
    FIELD.activity.eventType,
    'activity.event_type',
    ENUM_CANDIDATES,
    (item) => item.eventType,
  ),
  numeric(
    FIELD.activity.localTimestamp,
    'activity.local_timestamp',
    UINT32_CANDIDATES,
    (item, faults) =>
      dateTime(
        item.localTimestamp,
        GLOBAL_MESSAGE.activity,
        FIELD.activity.localTimestamp,
        'activity.local_timestamp',
        faults,
      ),
  ),
];

const HR_SPECS: readonly FieldSpec<FitHeartRateEvent>[] = [
  numeric(FIELD.timestamp, 'hr.timestamp', UINT32_CANDIDATES, (item, faults) =>
    dateTime(item.timestamp, GLOBAL_MESSAGE.hr, FIELD.timestamp, 'hr.timestamp', faults),
  ),
  numeric(
    FIELD.hr.eventTimestamp,
    'hr.event_timestamp',
    UINT16_CANDIDATES,
    (item) => item.eventTimestamp,
  ),
];

const DEVELOPER_DATA_ID_SPECS: readonly FieldSpec<FitDeveloperApplication>[] = [
  { kind: 'bytes', number: FIELD.developerDataId.applicationId, raw: (item) => item.applicationId },
  numeric(
    FIELD.developerDataId.manufacturerId,
    'developer_data_id.manufacturer_id',
    UINT16_CANDIDATES,
    (item) => item.manufacturerId,
  ),
  numeric(
    FIELD.developerDataId.developerDataIndex,
    'developer_data_id.developer_data_index',
    UINT8_CANDIDATES,
    (item) => item.developerDataIndex,
  ),
  numeric(
    FIELD.developerDataId.applicationVersion,
    'developer_data_id.application_version',
    UINT32_CANDIDATES,
    (item) => item.applicationVersion,
  ),
];

const FIELD_DESCRIPTION_SPECS: readonly FieldSpec<FitDeveloperFieldDescription>[] = [
  numeric(
    FIELD.fieldDescription.developerDataIndex,
    'field_description.developer_data_index',
    UINT8_CANDIDATES,
    (item) => item.developerDataIndex,
  ),
  numeric(
    FIELD.fieldDescription.fieldDefinitionNumber,
    'field_description.field_definition_number',
    UINT8_CANDIDATES,
    (item) => item.fieldDefinitionNumber,
  ),
  numeric(
    FIELD.fieldDescription.fitBaseTypeId,
    'field_description.fit_base_type_id',
    UINT8_CANDIDATES,
    (item) => item.fitBaseTypeId,
  ),
  { kind: 'text', number: FIELD.fieldDescription.fieldName, raw: (item) => item.name },
  { kind: 'text', number: FIELD.fieldDescription.units, raw: (item) => item.units },
];

// --- Writing a run of messages ----------------------------------------------

/** What one field survey concluded: whether to declare it, and how. */
interface ChosenField<T> {
  readonly spec: FieldSpec<T>;
  readonly definition: EncodeFieldDefinition;
}

/**
 * Decide which fields a run of messages declares, and at what width.
 *
 * One pass over the messages holding a {@link FieldSurvey} per field — six
 * numbers each, whatever the ride's length. The faults raised on this pass are
 * normally discarded, because the same conversions run again when the values
 * are written and a caller reading two copies of every fault would reasonably
 * conclude the field was dropped twice.
 *
 * ⚠️ **Except when the channel turns out to be absent**, and that exception is
 * the whole reason the faults are collected per spec rather than into one bin.
 * If every value in a channel was rejected — a single-record activity whose one
 * altitude is out of range, which is what an import of a corrupt file then
 * re-exported looks like — the survey sees no present value, the field is never
 * declared, `valueFor` never runs, and pass 2 has nothing to report. Discarding
 * the survey's faults there loses the channel **silently**, which is the one
 * outcome an encoder that reports faults exists to prevent. So they are
 * forwarded in exactly that case.
 */
function chooseFields<T>(
  items: readonly T[],
  specs: readonly FieldSpec<T>[],
  faults: FitEncodeError[],
): readonly ChosenField<T>[] {
  const chosen: ChosenField<T>[] = [];

  for (const spec of specs) {
    if (spec.kind === 'numeric') {
      const surveyed: FitEncodeError[] = [];
      const survey = new FieldSurvey();
      for (const item of items) survey.observe(spec.raw(item, surveyed));
      if (!survey.present) {
        faults.push(...surveyed);
        continue;
      }
      const baseType = survey.chooseBaseType(spec.candidates);
      chosen.push({
        spec,
        definition: { number: spec.number, size: sizeOf(baseType), baseType },
      });
      continue;
    }

    if (spec.kind === 'text') {
      let size = 0;
      for (const item of items) {
        const text = spec.raw(item);
        if (text !== undefined) size = Math.max(size, fitStringSize(text));
      }
      if (size === 0) continue;
      chosen.push({ spec, definition: { number: spec.number, size, baseType: BASE_TYPE.string } });
      continue;
    }

    let size = 0;
    for (const item of items) {
      const bytes = spec.raw(item);
      if (bytes !== undefined) size = Math.max(size, bytes.length);
    }
    if (size === 0) continue;
    chosen.push({ spec, definition: { number: spec.number, size, baseType: BASE_TYPE.byte } });
  }

  return chosen;
}

function sizeOf(baseType: number): number {
  return baseType === BASE_TYPE.sint32 || baseType === BASE_TYPE.uint32
    ? 4
    : baseType === BASE_TYPE.sint16 || baseType === BASE_TYPE.uint16
      ? 2
      : 1;
}

/** The value for one chosen field, dropping anything its base type cannot hold. */
function valueFor<T>(
  chosen: ChosenField<T>,
  item: T,
  globalMessageNumber: number,
  faults: FitEncodeError[],
): EncodeValue {
  const { spec, definition } = chosen;
  if (spec.kind === 'text') return textValue(spec.raw(item) ?? '');
  if (spec.kind === 'bytes') {
    const bytes = spec.raw(item);
    return bytes === undefined ? numericValue(undefined) : bytesValue(bytes);
  }

  const raw = spec.raw(item, faults);
  if (raw === undefined) return numericValue(undefined);
  if (!representable(definition.baseType, raw)) {
    faults.push(
      new FitEncodeError(
        'value-not-representable',
        `${spec.what} holds a value the widest base type this profile subset offers for it ` +
          'cannot carry, or one indistinguishable from that type’s invalid marker; the field is ' +
          'written as a gap on this message only',
        { globalMessageNumber, fieldNumber: spec.number },
      ),
    );
    return numericValue(undefined);
  }
  return numericValue(raw);
}

/** Write a whole run of messages of one kind. */
function writeMessages<T>(
  writer: FitContainerWriter,
  globalMessageNumber: number,
  items: readonly T[],
  specs: readonly FieldSpec<T>[],
  faults: FitEncodeError[],
  developerFieldsOf?: (item: T) => readonly FitDeveloperField[],
): void {
  if (items.length === 0) return;
  const chosen = chooseFields(items, specs, faults);
  const developerFields = developerFieldsOf
    ? developerFieldDefinitions(items, developerFieldsOf)
    : [];
  const shape = {
    globalMessageNumber,
    fields: chosen.map((field) => field.definition),
    developerFields,
  };

  for (const item of items) {
    const values = chosen.map((field) => valueFor(field, item, globalMessageNumber, faults));
    if (developerFields.length > 0 && developerFieldsOf) {
      const carried = developerFieldsOf(item);
      for (const definition of developerFields) {
        const found = carried.find(
          (candidate) =>
            candidate.developerDataIndex === definition.developerDataIndex &&
            candidate.fieldDefinitionNumber === definition.number,
        );
        values.push(found ? bytesValue(found.bytes) : numericValue(undefined));
      }
    }
    writer.message(shape, values);
  }
}

/**
 * The developer fields a run of messages declares.
 *
 * A developer field is carried **verbatim** — its bytes, its size and the index
 * of the application that described it, exactly as the decoder found them. The
 * decoder's contract is that an undescribed developer field *"keeps its bytes
 * and its indices: carried, never fatal"*, and an encoder that re-derived them
 * from a `field_description` it may never have seen would be the place that
 * promise stops being true.
 */
function developerFieldDefinitions<T>(
  items: readonly T[],
  developerFieldsOf: (item: T) => readonly FitDeveloperField[],
): readonly EncodeDeveloperFieldDefinition[] {
  const byKey = new Map<string, EncodeDeveloperFieldDefinition>();
  for (const item of items) {
    for (const field of developerFieldsOf(item)) {
      const key = `${String(field.developerDataIndex)}/${String(field.fieldDefinitionNumber)}`;
      const existing = byKey.get(key);
      if (existing === undefined || field.bytes.length > existing.size) {
        byKey.set(key, {
          number: field.fieldDefinitionNumber,
          size: Math.max(field.bytes.length, existing?.size ?? 0),
          developerDataIndex: field.developerDataIndex,
        });
      }
    }
  }
  return [...byKey.values()];
}

/**
 * Roughly how many bytes the finished file will need.
 *
 * Only a starting capacity for the sink — being wrong costs one copy, not a
 * wrong answer. Sized from the record count because a ride is records and
 * almost nothing else: about forty bytes of declared channels per record, plus
 * a few hundred for everything that is not a record.
 */
function capacityHint(input: FitEncodeInput): number {
  const records = input.records?.length ?? 0;
  const heartRateEvents = input.heartRateEvents?.length ?? 0;
  return 512 + records * 40 + heartRateEvents * 8;
}

/**
 * Encode an activity as a FIT file.
 *
 * The message order is the one a head unit writes and the one every fixture in
 * the #29 corpus uses: identification first, then the developer-field
 * declarations that later records refer to, then the device, the events, the
 * records, and the summaries that describe them. Nothing in the format requires
 * it — the decoder collects by message type and does not care — but a file that
 * arrives in an unusual order is a file whose first reader to complain will be
 * somebody else's.
 *
 * @throws {FitEncodeError} `too-many-message-types` if the activity needs more
 * than sixteen concurrently-bound message shapes. Nothing this profile subset
 * can produce does; the guard is in `encode/container.ts` and it is real
 * because a future message added to the profile could reach it.
 */
export function encodeActivity(input: FitEncodeInput): FitEncodeResult {
  const faults: FitEncodeError[] = [];
  const writer = new FitContainerWriter(capacityHint(input));

  writeMessages(
    writer,
    GLOBAL_MESSAGE.fileId,
    input.fileId ? [input.fileId] : [],
    FILE_ID_SPECS,
    faults,
  );
  writeMessages(
    writer,
    GLOBAL_MESSAGE.developerDataId,
    input.developerApplications ?? [],
    DEVELOPER_DATA_ID_SPECS,
    faults,
  );
  writeMessages(
    writer,
    GLOBAL_MESSAGE.fieldDescription,
    input.developerFieldDescriptions ?? [],
    FIELD_DESCRIPTION_SPECS,
    faults,
  );
  writeMessages(
    writer,
    GLOBAL_MESSAGE.deviceInfo,
    input.deviceInfos ?? [],
    DEVICE_INFO_SPECS,
    faults,
  );
  writeMessages(writer, GLOBAL_MESSAGE.event, input.events ?? [], EVENT_SPECS, faults);
  writeMessages(
    writer,
    GLOBAL_MESSAGE.record,
    input.records ?? [],
    RECORD_SPECS,
    faults,
    (record) => record.developerFields,
  );
  writeMessages(writer, GLOBAL_MESSAGE.hr, input.heartRateEvents ?? [], HR_SPECS, faults);
  writeMessages(writer, GLOBAL_MESSAGE.lap, input.laps ?? [], LAP_SPECS, faults);
  writeMessages(writer, GLOBAL_MESSAGE.session, input.sessions ?? [], SESSION_SPECS, faults);
  writeMessages(
    writer,
    GLOBAL_MESSAGE.activity,
    input.summary ? [input.summary] : [],
    ACTIVITY_SPECS,
    faults,
  );

  if (writer.boundLocalTypeCount === 0) {
    faults.push(
      new FitEncodeError(
        'nothing-to-encode',
        'the activity carries no messages at all, so the file holds a header and a checksum and ' +
          'nothing else; a reader cannot tell it from a failed recording',
      ),
    );
  }

  return { bytes: writer.finish(), faults };
}
