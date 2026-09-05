// SPDX-License-Identifier: Apache-2.0

/**
 * Recording checkpoints: the durable half of #46.
 *
 * ## Why a stream set is not enough
 *
 * `putStreamSet` stores a **finished** ride: it encodes and compresses every
 * channel of the whole set and replaces what was there. That is exactly right
 * once, at the end, and exactly wrong every five seconds during a four-hour
 * ride — each flush would re-encode and re-compress everything already written,
 * so the cost of the last flush is the cost of the ride.
 *
 * So a recording in progress is stored as a **session header plus append-only
 * chunks**, and it is a different shape for a different job:
 *
 * | | `streamSets` + `streamBlobs` (#27) | `recordingSessions` + `recordingChunks` (#46) |
 * |---|---|---|
 * | Written | once, when the ride is saved | every few seconds, while it is being ridden |
 * | Shape | whole set, replaced | contiguous windows, appended |
 * | Compressed | yes | **no** — see below |
 * | Lifetime | the athlete's history | until the ride is finalised or discarded |
 *
 * ## Append-only is what makes a crash survivable
 *
 * A chunk covers `[fromIndex, fromIndex + sampleCount)` and is never revisited.
 * An IndexedDB transaction either commits or does not, so a crash mid-write
 * leaves the chunk absent, never half-written — and the chunks before it are
 * still a correct prefix of the ride. That is the difference between losing the
 * last few seconds and losing the ride, and it is why the recovery path reads a
 * **contiguous prefix** and stops at the first hole rather than concatenating
 * whatever rows survived.
 *
 * ## Chunks are deliberately not compressed
 *
 * `stream-compression.ts` earns its place on a finished set: 239 KB becomes
 * about 53 KB. On a five-sample chunk it does not. Deflate on ten bytes emits
 * more than ten bytes, `CompressionStream` is asynchronous so it would put a
 * suspension point in the one path that must complete before the tab dies, and
 * a chunk lives for minutes. The bytes are still **packed** by
 * `stream-codec.ts`, which is where the 4x over eight `Float64` channels comes
 * from; only the deflate pass is skipped. `finaliseRecording` in `apps/web` is
 * where the compressed set is written, once.
 *
 * ## A gap is still `undefined`
 *
 * Chunks carry the same presence bitmap the stream blobs do, for the same
 * reason: a heart-rate strap that dropped must come back absent and not as
 * thirty seconds at 0 bpm. Crash recovery that filled its gaps would corrupt
 * every metric in #11 while looking like a complete ride, which is the worst
 * possible outcome for a recovery path.
 */

import type { RecordedPause, Seconds, UnixSeconds } from '@onyourleft/domain';

import type { AthleteId, RecordingSessionId } from './ids';
import type { StreamChannels } from './streams';

/**
 * Where a stored recording was when it was last checkpointed.
 *
 * Narrower than the engine's `RecordingState`: `idle` never reaches disk
 * because there is nothing to write, and a session is written the moment it
 * starts. A `stopped` session is one whose samples are complete and which is
 * waiting to be turned into an activity.
 */
export type RecordingStoredState = 'recording' | 'paused' | 'stopped';

/**
 * The three states, as values.
 *
 * Here rather than in `recording-persisted.ts` so that the type and the set the
 * decoder checks against cannot drift: a fourth state added above without a
 * value here is a compile error, and one added here without the type is too.
 */
export const RECORDING_STORED_STATES: readonly RecordingStoredState[] = [
  'recording',
  'paused',
  'stopped',
];

/** The small indexed row: one per recording. */
export interface RecordingSessionRecord {
  readonly id: RecordingSessionId;
  /** The scoping column. Every read of this record filters on it. */
  readonly athleteId: AthleteId;
  /** The instant of sample 0 of the whole recording. */
  readonly startedAt: UnixSeconds;
  /** The grid spacing every chunk shares. */
  readonly sampleInterval: Seconds;
  readonly state: RecordingStoredState;
  /** When this header was last written — what `listRecordingSessions` orders by. */
  readonly updatedAt: UnixSeconds;
  /**
   * Every pause so far.
   *
   * On the header rather than on a chunk, because a pause is a property of the
   * ride and not of a window of it, and because rewriting a list of tens of
   * intervals on each flush is cheaper than reconstructing it from chunk
   * boundaries — which could not distinguish a pause from a dropout anyway.
   */
  readonly pauses: readonly RecordedPause[];
}

/** What `putRecordingSession` accepts. Identical; named for symmetry with `NewActivity`. */
export type NewRecordingSession = RecordingSessionRecord;

/** One flush: a contiguous window of the merged series. */
export interface RecordingChunkRecord {
  readonly sessionId: RecordingSessionId;
  /** Denormalised, like `PersistedStreamBlob.athleteId`: it is the scoping column. */
  readonly athleteId: AthleteId;
  /**
   * This chunk's position in the append order, from zero.
   *
   * Part of the primary key with `sessionId`, so re-writing a chunk replaces it
   * rather than adding a second copy — which is what makes a retry after a
   * failed flush safe.
   */
  readonly seq: number;
  /** Index of this window's first slot within the whole recording. */
  readonly fromIndex: number;
  readonly sampleCount: number;
  readonly channels: StreamChannels;
}

/** What `appendRecordingChunk` accepts. */
export type NewRecordingChunk = RecordingChunkRecord;

/**
 * What a stored recording costs, **without decoding a sample**.
 *
 * #46 asks for storage growth over a four-hour ride to be measured and its
 * headroom recorded. Measuring it means the number has to be readable, and
 * reading it must not mean inflating the ride — the same reason
 * `getStreamSetSummary` exists beside `getStreamSet`.
 */
export interface RecordingFootprint {
  readonly sessionId: RecordingSessionId;
  readonly athleteId: AthleteId;
  /** How many chunk rows this recording occupies. */
  readonly chunks: number;
  /** How many sample slots the contiguous prefix covers. */
  readonly sampleCount: number;
  /** Packed sample bytes plus presence bitmaps, summed over every chunk. */
  readonly encodedBytes: number;
}

/**
 * The recovered recording: a contiguous series assembled from the chunk prefix.
 *
 * Deliberately the same shape `@onyourleft/domain`'s `RecordingSnapshot` has,
 * so recovery hands its result straight to `restoreRecordingSession` with no
 * transformation between them. A transformation there would be a fifth place
 * for the "write succeeds, read cannot see it" defect to hide.
 */
export interface RecoveredRecording {
  readonly id: RecordingSessionId;
  readonly athleteId: AthleteId;
  readonly startedAt: UnixSeconds;
  readonly sampleInterval: Seconds;
  readonly sampleCount: number;
  readonly channels: StreamChannels;
  readonly pauses: readonly RecordedPause[];
  readonly state: RecordingStoredState;
  /**
   * How many chunk rows made up the recovered prefix.
   *
   * This is the sequence number a recorder continuing this recording appends
   * at. Reported rather than inferred from `sampleCount`, because a chunk's
   * size is the flush cadence at the time it was written and two runs of the
   * same recording need not agree about it.
   */
  readonly chunks: number;
  /**
   * How many chunk rows were on disk but **not** used, because they sat beyond
   * a hole in the append order.
   *
   * Never silently discarded: a non-zero count here means a flush went missing
   * mid-ride, which is a finding about the device rather than a detail. The
   * recovered prefix is still consistent, which is the guarantee that matters.
   */
  readonly chunksAfterGap: number;
}
