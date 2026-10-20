// SPDX-License-Identifier: Apache-2.0

/**
 * The on-disk shapes of a recording checkpoint, and the conversions between
 * them and the types in `recording.ts`.
 *
 * Everything read back is untrusted, for the reason `persisted.ts` and
 * `stream-persisted.ts` give: it was written by an earlier build, hand-edited
 * in a devtools pane, or partially corrupted by whatever ended the tab. Every
 * field is re-validated on the way out. That matters more here than anywhere
 * else in the package, because these rows exist precisely because something
 * went wrong.
 */

import {
  seconds,
  unixSeconds,
  type Metres,
  type RecordedPause,
  type Seconds,
  type UnixSeconds,
} from '@onyourleft/domain';

import { StoreDecodeError } from './errors';
import { activityId, athleteId, recordingSessionId } from './ids';
import {
  decoded,
  decodedNumber,
  decodedString,
  racesOf,
  toPersistedRoomRace,
  type PersistedRoomRace,
} from './persisted';
import {
  RECORDING_STORED_STATES,
  type RecordedCourseLap,
  type RecordedWorkoutBlock,
  type RecordingHeaderDamage,
  type RecordingSessionRecord,
  type RecordingStoredState,
} from './recording';
import type { RoomRaceFact } from './records';
import type { ChannelEncoding } from './stream-codec';
import { recordedWorkoutBlocksOf } from './workout-block-persisted';

/** The small indexed row: one per recording. @see RecordingSessionRecord */
export interface PersistedRecordingSession {
  /** The primary key. */
  id: string;
  /** The scoping column. */
  athleteId: string;
  startedAt: number;
  sampleIntervalSeconds: number;
  state: string;
  updatedAt: number;
  pauses: PersistedRecordingPause[];
  /**
   * The activity this recording became. Absent until it becomes one.
   *
   * ⚠️ Optional, so no schema version moved — and **never substituted on the
   * way out**: absent means "this recording is not known to be an activity",
   * which is precisely the distinction {@link RecordingSessionRecord.savedAs}
   * exists to make. A default here would re-hide the duplicate it prevents.
   */
  savedAs?: string;
  /**
   * The laps of a course completed so far — #1312. Absent with none, and on
   * every header written before the field existed. Optional and unindexed, so
   * no schema version moved.
   */
  courseLaps?: PersistedCourseLap[];
  /**
   * The lap in progress at the last flush — #1322. Absent with none open, and
   * on every header written before the field existed. Optional and unindexed,
   * so no schema version moved. @see RecordingSessionRecord.openCourseLap
   */
  openCourseLap?: PersistedCourseLap;
  /**
   * The races ridden so far — #785, #1360's review (B2). Absent with none, and
   * on every header written before the field existed. Optional and
   * unindexed, so no schema version moved. Re-read race by race on the way
   * out, and never a throw: @see racesOf
   */
  roomRaces?: PersistedRoomRace[];
  /**
   * The workout blocks so far — #1319. Absent with none, and on every header
   * written before the field existed. Optional and unindexed, so no schema
   * version moved. Plain JSON in the record's own shape, re-read whole on the
   * way in and out: @see recordedWorkoutBlocksOf
   */
  workoutBlocks?: unknown[];
}

/** One lap of a course. @see RecordedCourseLap */
export interface PersistedCourseLap {
  fromAt: number;
  fromMovingSeconds: number;
  toAt: number;
  toMovingSeconds: number;
  distanceMetres: number;
  ascentMetres?: number;
  partial?: true;
}

/** One pause interval. `to` absent while the pause is open. */
export interface PersistedRecordingPause {
  from: number;
  to?: number;
  reason: string;
}

/**
 * One channel's packed bytes within one chunk.
 *
 * **Not compressed** — see the note at the top of `recording.ts`. The
 * `compression` field the stream blobs carry is deliberately absent rather than
 * set to a "none" value: a field whose only value is "none" invites a second
 * value, and the moment a chunk could be compressed the read path would have to
 * branch on data it read from the row it is validating.
 */
export interface PersistedRecordingChannel {
  channel: string;
  encoding: string;
  sampleCount: number;
  values: Uint8Array;
  /** `ceil(sampleCount / 8)` bytes. Absent when the window has no gaps. */
  present?: Uint8Array;
}

/** One flush. @see RecordingChunkRecord */
export interface PersistedRecordingChunk {
  sessionId: string;
  seq: number;
  athleteId: string;
  fromIndex: number;
  sampleCount: number;
  channels: PersistedRecordingChannel[];
}

const STORED_STATES = new Set<string>(RECORDING_STORED_STATES);
const PAUSE_REASONS = new Set<string>(['manual', 'automatic']);

/** @throws {StoreDecodeError} if `value` is not one of the three stored states. */
export function parseRecordingState(value: unknown): RecordingStoredState {
  if (typeof value === 'string' && STORED_STATES.has(value)) {
    return value as RecordingStoredState;
  }
  throw new StoreDecodeError(
    `recordingSession.state must be one of ${RECORDING_STORED_STATES.join(', ')}, found ` +
      `${typeof value === 'string' ? JSON.stringify(value) : typeof value}`,
  );
}

export function toPersistedRecordingSession(
  record: RecordingSessionRecord,
): PersistedRecordingSession {
  return {
    id: record.id,
    athleteId: record.athleteId,
    startedAt: record.startedAt,
    sampleIntervalSeconds: record.sampleInterval,
    state: record.state,
    updatedAt: record.updatedAt,
    pauses: record.pauses.map((pause) => ({
      from: pause.from,
      ...(pause.to === undefined ? {} : { to: pause.to }),
      reason: pause.reason,
    })),
    ...(record.savedAs === undefined ? {} : { savedAs: record.savedAs }),
    ...(record.courseLaps === undefined || record.courseLaps.length === 0
      ? {}
      : { courseLaps: record.courseLaps.map(toPersistedCourseLap) }),
    // #1322: a part lap by definition, so it is written as one whatever the
    // caller said.
    ...(record.openCourseLap === undefined
      ? {}
      : { openCourseLap: toPersistedCourseLap({ ...record.openCourseLap, partial: true }) }),
    // #785: only the races that read back are written, so one that does not
    // is left out and never refuses the header (#1316's lesson). @see racesOf
    ...roomRacesRow(record.roomRaces),
    // #1319: only a list that reads back is written, so one that does not is
    // left out and never refuses the header. @see recordedWorkoutBlocksOf
    ...workoutBlocksRow(record.workoutBlocks, record.startedAt, record.updatedAt),
  };
}

function workoutBlocksRow(
  value: unknown,
  startedAt: number,
  updatedAt: number,
): { workoutBlocks?: unknown[] } {
  const blocks = recordedWorkoutBlocksOf(value, startedAt, updatedAt);
  return blocks === undefined ? {} : { workoutBlocks: [...blocks] };
}

function toPersistedCourseLap(lap: RecordedCourseLap): PersistedCourseLap {
  return {
    fromAt: lap.from.at,
    fromMovingSeconds: lap.from.movingTime,
    toAt: lap.to.at,
    toMovingSeconds: lap.to.movingTime,
    distanceMetres: lap.distance,
    ...(lap.ascent === undefined ? {} : { ascentMetres: lap.ascent }),
    ...(lap.partial === true ? { partial: true as const } : {}),
  };
}

function roomRacesRow(value: unknown): { roomRaces?: PersistedRoomRace[] } {
  const races = racesOf(value);
  return races === undefined ? {} : { roomRaces: races.map(toPersistedRoomRace) };
}

/** @throws {StoreDecodeError} */
export function fromPersistedRecordingSession(
  row: PersistedRecordingSession,
): RecordingSessionRecord {
  const startedAt = decoded(
    'recordingSession.startedAt',
    decodedNumber('recordingSession.startedAt', row.startedAt),
    unixSeconds,
  );
  const updatedAt = decoded(
    'recordingSession.updatedAt',
    decodedNumber('recordingSession.updatedAt', row.updatedAt),
    unixSeconds,
  );
  const courseLaps =
    row.courseLaps === undefined
      ? undefined
      : fromPersistedCourseLaps(row.courseLaps, startedAt, updatedAt);
  // #1419: a stored lap list that did not read takes the lap in progress with
  // it. That lap is numbered after the completed ones, and kept alone it would
  // be saved as the first lap when it was lap N + 1.
  const lapsDropped =
    row.courseLaps !== undefined &&
    (!Array.isArray(row.courseLaps) || row.courseLaps.length > 0) &&
    courseLaps?.length === 0;
  const openCourseLap = lapsDropped
    ? undefined
    : fromPersistedOpenCourseLap(
        row.openCourseLap,
        courseLaps?.at(-1)?.to.at ?? startedAt,
        updatedAt,
      );
  // #1325: read, never refused — @see RecordingSessionRecord.damaged
  const pauses = readOrUndefined(() => fromPersistedPauses(row.pauses));
  const state = readOrUndefined(() => parseRecordingState(row.state));
  const damaged: RecordingHeaderDamage[] = [
    ...(pauses === undefined ? (['pauses'] as const) : []),
    ...(state === undefined ? (['state'] as const) : []),
  ];
  return {
    id: recordingSessionId(decodedString('recordingSession.id', row.id)),
    athleteId: athleteId(decodedString('recordingSession.athleteId', row.athleteId)),
    startedAt,
    sampleInterval: decoded(
      'recordingSession.sampleInterval',
      decodedNumber('recordingSession.sampleInterval', row.sampleIntervalSeconds),
      seconds,
    ),
    state: state ?? 'stopped',
    updatedAt,
    pauses: pauses ?? [],
    savedAs:
      row.savedAs === undefined
        ? undefined
        : activityId(decodedString('recordingSession.savedAs', row.savedAs)),
    ...(courseLaps === undefined || courseLaps.length === 0 ? {} : { courseLaps }),
    ...(openCourseLap === undefined ? {} : { openCourseLap }),
    // #785: never a throw — a race that does not read is dropped, and the
    // recording is listed and recovered all the same. @see racesOf
    ...roomRacesOut(row.roomRaces),
    // #1319: never a throw — @see recordedWorkoutBlocksOf
    ...workoutBlocksOut(row.workoutBlocks, startedAt, updatedAt),
    ...(damaged.length === 0 ? {} : { damaged }),
  };
}

/**
 * One field's read, or `undefined` when it throws. Any throw: the read is pure
 * over the row, so whatever it throws — a `StoreDecodeError`, or the
 * `TypeError` of a pause that is `null` — is that field's damage.
 */
function readOrUndefined<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function workoutBlocksOut(
  value: unknown,
  startedAt: number,
  updatedAt: number,
): { workoutBlocks?: readonly RecordedWorkoutBlock[] } {
  const blocks = recordedWorkoutBlocksOf(value, startedAt, updatedAt);
  return blocks === undefined ? {} : { workoutBlocks: blocks };
}

function roomRacesOut(value: unknown): { roomRaces?: readonly RoomRaceFact[] } {
  const races = racesOf(value);
  return races === undefined ? {} : { roomRaces: races };
}

/**
 * Why a lap of a course cannot be kept, or `undefined` when it can — the one
 * rule the write path leaves a lap list out by and the read path drops it by.
 *
 * Every number finite and none below nought; the lap ending no earlier than
 * it began, on the clock and on the moving time.
 */
export function courseLapFault(lap: RecordedCourseLap): string | undefined {
  const numbers: readonly (readonly [string, unknown])[] = [
    ['from.at', lap.from.at],
    ['from.movingTime', lap.from.movingTime],
    ['to.at', lap.to.at],
    ['to.movingTime', lap.to.movingTime],
    ['distance', lap.distance],
    ...(lap.ascent === undefined ? [] : [['ascent', lap.ascent] as const]),
  ];
  for (const [name, value] of numbers) {
    // (`Number.isFinite` is false of anything that is not a number at all.)
    if (!Number.isFinite(value) || (value as number) < 0) {
      return `${name} must be a number that is not below nought`;
    }
  }
  if (lap.to.at < lap.from.at || lap.to.movingTime < lap.from.movingTime) {
    return 'a lap must not end before it began';
  }
  return undefined;
}

/**
 * The header's laps of a course — or NONE, when the list or any lap in it
 * does not read.
 *
 * ⚠️ **Lenient, as the pauses and the state are since #1325 and the other
 * fields are not** (@see RecordingSessionRecord.damaged). A lap is
 * something worked out ABOUT a recording's samples, and this row is read on
 * the recovery path: `listRecordingSessions` decodes every header of the
 * athlete, so a throw here over one damaged figure in one lap hid every
 * recoverable ride and left that ride's samples on disk with no way to save
 * them (#1316's third review). A ride saved with no lap table has lost a
 * table; a ride that cannot be recovered has lost the ride.
 *
 * ⚠️ **All of the list or none of it.** Laps are numbered by where they stand
 * in it, so a list with its second lap taken out would call the third lap
 * the second.
 *
 * A lap is also dropped — and the list with it — when it lies outside the
 * recording, or the list is longer than the recording has seconds for:
 * before `startedAt`, after the header's own `updatedAt` (a mark
 * is taken on the recorder's clock, and the header is stamped with that
 * clock as it is written, so no real mark is later), or before the lap in
 * front of it ended.
 */
function fromPersistedCourseLaps(
  rows: unknown,
  startedAt: number,
  updatedAt: number,
): readonly RecordedCourseLap[] {
  // No more laps than the recording has seconds: a second does not hold two
  // laps of a course, and a list past that is a damaged or a planted row —
  // one that would otherwise be read here and written as that many rows.
  if (!Array.isArray(rows) || rows.length > Math.max(0, updatedAt - startedAt) + 1) {
    return [];
  }
  const laps: RecordedCourseLap[] = [];
  let cursor = startedAt;
  for (const row of rows as (PersistedCourseLap | null)[]) {
    if (row === null || typeof row !== 'object') {
      return [];
    }
    const lap = courseLapOf(row);
    if (courseLapFault(lap) !== undefined || lap.from.at < cursor || lap.to.at > updatedAt) {
      return [];
    }
    laps.push(lap);
    cursor = lap.to.at;
  }
  return laps;
}

function courseLapOf(row: PersistedCourseLap): RecordedCourseLap {
  return {
    from: { at: row.fromAt as UnixSeconds, movingTime: row.fromMovingSeconds as Seconds },
    to: { at: row.toAt as UnixSeconds, movingTime: row.toMovingSeconds as Seconds },
    distance: row.distanceMetres as Metres,
    ...(row.ascentMetres === undefined ? {} : { ascent: row.ascentMetres as Metres }),
    // Only `true` is a part lap; anything else stored there is a whole one.
    ...(row.partial === true ? { partial: true as const } : {}),
  };
}

/**
 * The header's lap in progress — #1322 — or none, when it does not read.
 *
 * Lenient, for {@link fromPersistedCourseLaps}' reason, and dropped ALONE: it
 * is numbered after every completed lap, so losing it renumbers nothing. The
 * reverse does not hold, so a completed-lap list that does not read takes this
 * lap with it (#1419). Also
 * dropped when it began before the last completed lap ended (`after`, or the
 * recording's start with none) or ends after the header was written. Always a
 * part lap on the way out: the rider had not reached the line.
 */
function fromPersistedOpenCourseLap(
  row: unknown,
  after: number,
  updatedAt: number,
): RecordedCourseLap | undefined {
  if (row === undefined || row === null || typeof row !== 'object') {
    return undefined;
  }
  const lap: RecordedCourseLap = { ...courseLapOf(row as PersistedCourseLap), partial: true };
  return courseLapFault(lap) !== undefined || lap.from.at < after || lap.to.at > updatedAt
    ? undefined
    : lap;
}

/** @throws {StoreDecodeError} */
function fromPersistedPauses(rows: unknown): readonly RecordedPause[] {
  if (!Array.isArray(rows)) {
    throw new StoreDecodeError(
      `recordingSession.pauses: expected an array, found ${typeof rows as string}`,
    );
  }
  return (rows as PersistedRecordingPause[]).map((pause, index) => {
    const reason = pause.reason;
    if (typeof reason !== 'string' || !PAUSE_REASONS.has(reason)) {
      throw new StoreDecodeError(
        `recordingSession.pauses[${String(index)}].reason must be manual or automatic, found ` +
          `${typeof reason === 'string' ? JSON.stringify(reason) : typeof reason}`,
      );
    }
    const from = decoded(
      `recordingSession.pauses[${String(index)}].from`,
      decodedNumber(`recordingSession.pauses[${String(index)}].from`, pause.from),
      unixSeconds,
    );
    if (pause.to === undefined) {
      return { from, reason: reason as RecordedPause['reason'] };
    }
    return {
      from,
      to: decoded(
        `recordingSession.pauses[${String(index)}].to`,
        decodedNumber(`recordingSession.pauses[${String(index)}].to`, pause.to),
        unixSeconds,
      ),
      reason: reason as RecordedPause['reason'],
    };
  });
}

/**
 * A stored chunk's channel list, checked.
 *
 * @throws {StoreDecodeError} if the row is not a shape this build can read.
 */
export function decodedChunkChannels(row: PersistedRecordingChunk): PersistedRecordingChannel[] {
  if (!Array.isArray(row.channels)) {
    throw new StoreDecodeError(
      `recordingChunk.channels: expected an array, found ${typeof row.channels as string}`,
    );
  }
  return row.channels;
}

/**
 * A chunk's packed bytes, for the footprint measurement. Reads no samples.
 *
 * @throws {StoreDecodeError}
 */
export function persistedChunkBytes(row: PersistedRecordingChunk): number {
  let total = 0;
  for (const channel of decodedChunkChannels(row)) {
    total += (channel.values?.byteLength ?? 0) + (channel.present?.byteLength ?? 0);
  }
  return total;
}

/** The encoding a stored chunk channel declares. Checked against the build by `decodeChannel`. */
export function chunkChannelEncoding(row: PersistedRecordingChannel): ChannelEncoding {
  return decodedString('recordingChunk.channels[].encoding', row.encoding) as ChannelEncoding;
}
