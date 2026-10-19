// SPDX-License-Identifier: Apache-2.0

/**
 * The narrow FIT profile subset these fixtures use, with its provenance.
 *
 * ## ADR 0006, and what this file is allowed to contain
 *
 * ADR 0006 chose option (c): implement from the publicly served FIT protocol
 * documentation and depend on nothing carrying Garmin's terms. R3 draws the
 * line this file sits on — *"Message and field numbers, base type codes, scales
 * and offsets are facts about a wire format … They are recorded as this
 * project's own data structures in this project's own shape. What is never
 * copied, from any source, is expression."* So these are numbers, in this
 * project's naming and layout, and there is no table anywhere below.
 *
 * R2 requires the provenance of each number to be recorded. It is, per message,
 * in `fixtures/README.md`, which is the file a reviewer reads. The summary: the
 * container layout and the base type codes come from the public FIT protocol
 * documentation at `developer.garmin.com/fit/protocol/` and from the
 * independent format reference at `fitfileeditor.com/skill`, both read
 * 2026-09-03; the message and field numbers are corroborated across those and
 * the independent write-up at `pinns.co.uk/osm/fit-for-dummies.html`. **No
 * Garmin FIT SDK, `Profile.xlsx`, `FitCSVTool`, `Fitgen` or any other Garmin
 * FIT artefact was consulted, downloaded, installed or read** (R1, R4).
 *
 * ## Why this is `tools/` and not `src/`
 *
 * #30 builds the decoder's profile subset and owns its own provenance record.
 * This one exists only to write fixtures, and a fixture generator that shared a
 * profile table with the decoder would be checking the decoder against its own
 * assumptions — which is the failure `fixtures/README.md` calls out and the
 * reason no decoder is written in this issue. The two are meant to be
 * independent and to be reconciled by #30 failing when they disagree.
 */

/** FIT global message numbers used by this corpus. */
export const GLOBAL_MESSAGE = {
  fileId: 0,
  session: 18,
  lap: 19,
  record: 20,
  event: 21,
  deviceInfo: 23,
  activity: 34,
  hr: 132,
  fieldDescription: 206,
  developerDataId: 207,
} as const;

/**
 * FIT base type bytes.
 *
 * The low five bits are the type number and bit 7 marks a type whose byte order
 * follows the definition message's architecture field. `sint32` is `0x85`
 * because it is type 5 and is endian-sensitive; `uint8` is `0x02` because a
 * single byte has no order to get wrong.
 */
export const BASE_TYPE = {
  enum: 0x00,
  sint8: 0x01,
  uint8: 0x02,
  sint16: 0x83,
  uint16: 0x84,
  sint32: 0x85,
  uint32: 0x86,
  string: 0x07,
  uint8z: 0x0a,
  uint16z: 0x8b,
  uint32z: 0x8c,
  byte: 0x0d,
} as const;

/**
 * The value each base type reserves to mean "this field was not recorded".
 *
 * Distinct from zero, and that distinction is the whole point of the
 * `sensor-dropout-30s` fixture: a parser that reads an invalid heart rate as
 * `0xFF` and stores 255 produces a plausible number, and one that stores 0
 * produces a plausible number too. Both are wrong in the same way.
 */
export const INVALID_VALUE = {
  enum: 0xff,
  sint8: 0x7f,
  uint8: 0xff,
  sint16: 0x7fff,
  uint16: 0xffff,
  sint32: 0x7fffffff,
  uint32: 0xffffffff,
} as const;

/**
 * Field definition numbers, by message.
 *
 * `timestamp` is 253 in every message that carries one and `message_index` is
 * 254 — those two are reserved across the profile rather than assigned per
 * message, which is why they are not repeated in each group below.
 */
export const FIELD = {
  /** Reserved across the profile: the message's `date_time`. */
  timestamp: 253,
  /** Reserved across the profile: the message's index within its kind. */
  messageIndex: 254,

  fileId: {
    type: 0,
    manufacturer: 1,
    product: 2,
    serialNumber: 3,
    timeCreated: 4,
  },

  record: {
    positionLatitude: 0,
    positionLongitude: 1,
    altitude: 2,
    heartRate: 3,
    cadence: 4,
    distance: 5,
    speed: 6,
    power: 7,
    temperature: 13,
  },

  event: {
    event: 0,
    eventType: 1,
    data: 3,
  },

  lap: {
    startTime: 2,
    totalElapsedTime: 7,
    totalTimerTime: 8,
    totalDistance: 9,
  },

  session: {
    startTime: 2,
    sport: 5,
    totalElapsedTime: 7,
    totalTimerTime: 8,
    totalDistance: 9,
    numLaps: 26,
  },

  activity: {
    totalTimerTime: 0,
    numSessions: 1,
    type: 2,
    event: 3,
    eventType: 4,
    localTimestamp: 5,
  },

  deviceInfo: {
    deviceIndex: 0,
    manufacturer: 2,
    serialNumber: 3,
    product: 4,
    softwareVersion: 5,
  },

  developerDataId: {
    applicationId: 1,
    manufacturerId: 2,
    developerDataIndex: 3,
    applicationVersion: 4,
  },

  fieldDescription: {
    developerDataIndex: 0,
    fieldDefinitionNumber: 1,
    fitBaseTypeId: 2,
    fieldName: 3,
    units: 8,
  },

  hr: {
    eventTimestamp: 9,
  },
} as const;

/** Enumerated values this corpus writes into `enum` fields. */
export const ENUM_VALUE = {
  /** `file_id.type`: an activity file. */
  fileTypeActivity: 4,
  /** `session.sport`: cycling. */
  sportCycling: 2,
  /** `event.event`: the recording timer. */
  eventTimer: 0,
  /** `event.event_type`: the timer started. */
  eventTypeStart: 0,
  /** `event.event_type`: the timer stopped. */
  eventTypeStop: 1,
  /** `activity.type`: recorded on a device rather than entered by hand. */
  activityTypeManual: 0,
} as const;

/**
 * The scale FIT applies to a field, as the divisor stored in the file.
 *
 * `stored = round(value * scale) - offset`. Altitude is the awkward one and
 * `packages/domain` already owns it — `metresToFitAltitude` applies both the
 * scale of 5 and the offset of 500 m, which is what lets a FIT `uint16`
 * altitude reach 500 m below sea level.
 */
export const SCALE = {
  /** `record.distance` is centimetres. */
  distance: 100,
  /** `record.speed` is millimetres per second. */
  speed: 1000,
  /** `lap`/`session`/`activity` durations are milliseconds. */
  time: 1000,
  /** `hr.event_timestamp` is 1/1024 s, the same tick as the BLE counters in #41. */
  eventTimestamp: 1024,
} as const;

/**
 * The manufacturer id this corpus writes.
 *
 * `255` is the profile's `development` manufacturer — the value reserved for
 * software that is not a shipping product, which is exactly what a fixture
 * generator is. Nothing in this corpus claims to be a device from a real
 * manufacturer, deliberately: a fixture that names a head unit invites somebody
 * to compare it against a real file from one.
 */
export const DEVELOPMENT_MANUFACTURER_ID = 255;
