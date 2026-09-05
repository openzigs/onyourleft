// SPDX-License-Identifier: Apache-2.0

/**
 * The narrow, enumerated FIT profile subset this decoder reads.
 *
 * ## ADR 0006 R2 and R3 — what this file is allowed to be
 *
 * R2 requires a *"narrow, enumerated profile subset covering only the messages
 * and fields this product reads and writes"*, with the provenance of every
 * number recorded per message in `packages/fit/README.md`. R3 draws the line
 * this file sits on: message numbers, field numbers, base type codes, scales
 * and offsets are **facts about a wire format**, recorded as this project's own
 * data structures in this project's own shape. No table is copied from anyone.
 *
 * **No Garmin FIT SDK, `Profile.xlsx`, `fit-sdk-tools` artefact, `FitCSVTool`,
 * `Fitgen` or `ActivityRepairTool` was consulted, downloaded, installed or read
 * in the course of this work, and `@garmin/fitsdk` appears in no dependency
 * block of this repository or its lockfile** (R1, R4).
 *
 * ⚠️ That sentence **used to name `fit-file-parser` as well**. Since #31 it is
 * a devDependency of this package — MIT, pinned at 5.0.2, imported from one
 * test file and never from `src/` — adopted under #31's revision block, which
 * struck "validate with the SDK's own checker" under R1. Not a number in this
 * file came from it: it exists to read this package's output and *disagree*.
 * `packages/fit/README.md` §1 records the reconciliation.
 *
 * ## Why this is not `tools/fixture-corpus/fit-profile.ts`
 *
 * Because the two are meant to be able to disagree. `fixtures/README.md` §5
 * says so directly: *"a fixture generator that shared a profile table with the
 * decoder would be checking the decoder against its own assumptions"*. The
 * corpus tests are only a cross-check while these numbers are arrived at
 * independently, so this file duplicates them on purpose and
 * [`tools/fixture-corpus/decode-corpus.test.ts`](../../tools/fixture-corpus/decode-corpus.test.ts)
 * — under `describe('the decoder profile and the generator profile were
 * derived independently')` — pins the ones both files carry.
 *
 * ## Only the subset is supported
 *
 * ADR 0006: *"A narrow profile means files containing messages outside it
 * decode with those messages skipped, not with an error."* A message this file
 * does not name is counted in
 * {@link FitActivity.skippedGlobalMessages} and dropped.
 */

/** The global message numbers this decoder reads. */
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
 * Field definition numbers, by message.
 *
 * `timestamp` is 253 and `message_index` is 254 in every message that carries
 * them — reserved across the profile rather than assigned per message, which is
 * why they are named once here rather than repeated in each group.
 */
export const FIELD = {
  timestamp: 253,
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

/**
 * The scale a stored field is divided by to reach its natural unit.
 *
 * `natural = stored / scale`. Altitude is the awkward one and it is not here,
 * because `@onyourleft/domain` already owns it: `fitAltitudeToMetres` applies
 * both the scale of 5 and the offset of 500 m, which is what lets a `uint16`
 * altitude reach 500 m below sea level.
 */
export const SCALE = {
  /** `record.distance` and the `total_distance` fields are centimetres. */
  distance: 100,
  /** `record.speed` is millimetres per second. */
  speed: 1000,
  /** `lap`, `session` and `activity` durations are milliseconds. */
  time: 1000,
} as const;

/** `session.sport`: cycling. The only sport this product records. */
export const SPORT_CYCLING = 2;

/** `file_id.type`: an activity file, as opposed to a course, a workout or a setting. */
export const FILE_TYPE_ACTIVITY = 4;

/** `event.event`: the recording timer, whose start and stop bracket a lap. */
export const EVENT_TIMER = 0;

/** `event.event_type`: the timer started. */
export const EVENT_TYPE_START = 0;

/** `event.event_type`: the timer stopped. */
export const EVENT_TYPE_STOP = 1;
