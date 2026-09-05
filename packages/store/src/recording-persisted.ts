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

import { seconds, unixSeconds, type RecordedPause } from '@onyourleft/domain';

import { StoreDecodeError } from './errors';
import { athleteId, recordingSessionId } from './ids';
import { decoded, decodedNumber, decodedString } from './persisted';
import {
  RECORDING_STORED_STATES,
  type RecordingSessionRecord,
  type RecordingStoredState,
} from './recording';
import type { ChannelEncoding } from './stream-codec';

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
  };
}

/** @throws {StoreDecodeError} */
export function fromPersistedRecordingSession(
  row: PersistedRecordingSession,
): RecordingSessionRecord {
  return {
    id: recordingSessionId(decodedString('recordingSession.id', row.id)),
    athleteId: athleteId(decodedString('recordingSession.athleteId', row.athleteId)),
    startedAt: decoded(
      'recordingSession.startedAt',
      decodedNumber('recordingSession.startedAt', row.startedAt),
      unixSeconds,
    ),
    sampleInterval: decoded(
      'recordingSession.sampleInterval',
      decodedNumber('recordingSession.sampleInterval', row.sampleIntervalSeconds),
      seconds,
    ),
    state: parseRecordingState(row.state),
    updatedAt: decoded(
      'recordingSession.updatedAt',
      decodedNumber('recordingSession.updatedAt', row.updatedAt),
      unixSeconds,
    ),
    pauses: fromPersistedPauses(row.pauses),
  };
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
