// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The recorder: the recording engine (#45) wired to durable storage (#46).
 *
 * ## Why this file exists at all
 *
 * `@onyourleft/domain`'s session merges sensor feeds into a series and holds it
 * in memory. `@onyourleft/store` persists checkpoints. Neither knows about the
 * other, and neither should: the engine may name no platform API and the store
 * may not depend on a recording being in progress. This is the piece that
 * decides *when* to write, and "when" is the whole of #46's guarantee.
 *
 * ## The loss bound is a product promise, not an implementation detail
 *
 * **At most {@link MAX_DATA_LOSS_SECONDS} seconds of a ride can be lost to a
 * crash**, at the defaults below. That number is not measured, it is
 * constructed:
 *
 * | Contribution | Seconds | Why |
 * |---|---|---|
 * | flush interval | 5 | the longest a sealed sample can wait for the next flush |
 * | late tolerance | 2 | a slot stays open this long so a late notification can still land in it |
 * | the open slot | 1 | the second the grid is currently in has not finished |
 * | **total** | **8** | |
 *
 * With no server there is no backup, no re-upload and no support ticket: the
 * local copy is the only copy in existence (owner decision D6). So this belongs
 * in user-facing documentation, and `README.md` carries it.
 *
 * **The bound is about a crash, and a crash is not the only way to lose a
 * second.** A device clock corrected *backwards* mid-ride costs roughly the
 * seconds it rewinds: readings stamped with the corrected clock land behind
 * slots the engine has already sealed, and dropping them is what keeps the
 * series monotonic and duplicate-free. That is the trade, not an oversight —
 * but it is not silent either, and `README.md` says so too. The count is
 * `session.clockRegressions` and the samples it cost are `session.dropped.late`.
 *
 * Shortening the flush interval shortens the bound and costs an IndexedDB
 * transaction more often; five seconds is 2,880 transactions over four hours,
 * each writing about 85 packed bytes per channel. Lengthening it is a decision
 * about how much of somebody's ride to risk.
 *
 * ## Running out of quota is a state, not an exception
 *
 * A browser storage quota filling on a device holding a rider's whole history
 * is foreseeable. When a flush is refused for quota the recorder **keeps
 * recording**: the engine's series is intact in memory, everything already
 * flushed is intact on disk, and {@link Recorder.storageState} says what
 * happened so the UI can say so too. Throwing here would end the ride to report
 * that the ride might end.
 *
 * The two failure modes are treated differently on purpose. Quota is
 * **terminal** — retrying costs a flush window and fails identically — so the
 * recorder stops attempting. Any other write failure is **transient** — a
 * transaction aborted by a background tab, a momentary lock — so the flush
 * cursor stays where it was and the next tick tries the same window again.
 *
 * The terminal latch covers writes and **not** {@link Recorder.discard}: a
 * delete is the operation that frees the space the latch is reporting, and it
 * is the action the rider is being asked to take.
 */

import {
  createRecordingSession,
  restoreRecordingSession,
  seconds,
  type AutoPausePolicy,
  type RecordingOutcome,
  type RecordingSession,
  type Seconds,
  type UnixSeconds,
} from '@onyourleft/domain';
import type { SensorMeasurement } from '@onyourleft/sensors';
import type {
  AthleteId,
  NewRecordingChunk,
  NewRecordingSession,
  RecordingSessionId,
  RecordingSessionRecord,
  RecordingStoredState,
  RecoveredRecording,
  StreamChannelValue,
} from '@onyourleft/store';

import {
  DEFAULT_AUTO_PAUSE_AFTER_SECONDS,
  isMovingReading,
  readingFor,
  type RideReading,
} from './channels';

/** How often the recorder writes a checkpoint, in seconds. */
export const DEFAULT_FLUSH_INTERVAL_SECONDS = 5;

/** How long a slot stays open for a late notification, in seconds. */
export const DEFAULT_LATE_TOLERANCE_SECONDS = 2;

/**
 * The bound on how much of a ride a crash can take, for a given configuration.
 *
 * The flush interval and the late tolerance are both per-recorder options, so
 * the bound is a function of them and not a constant: a recorder built with
 * `flushIntervalSeconds: 30` risks 33 seconds, and a UI that quoted
 * {@link MAX_DATA_LOSS_SECONDS} at it would be quoting the wrong number at the
 * rider. See the table at the top of this file for where each term comes from.
 *
 * The `+ 1` is the open slot rather than the sample interval: the grid is 1 Hz
 * and `sampleInterval` is not an option a recorder built by this file varies.
 */
export function maxDataLossSeconds(
  options: Pick<RecorderOptions, 'flushIntervalSeconds' | 'lateToleranceSeconds'> = {},
): number {
  return (
    (options.flushIntervalSeconds ?? DEFAULT_FLUSH_INTERVAL_SECONDS) +
    (options.lateToleranceSeconds ?? DEFAULT_LATE_TOLERANCE_SECONDS) +
    1
  );
}

/**
 * The stated maximum data loss between checkpoints **at the defaults**, in
 * seconds. This is the number `README.md` gives as a product guarantee.
 *
 * `recorder.test.ts` asserts a crash never loses more.
 */
export const MAX_DATA_LOSS_SECONDS = maxDataLossSeconds();

/**
 * The part of `@onyourleft/store`'s `ActivityStore` a recorder needs.
 *
 * Narrowed to five methods rather than taking the class, so a test can hand it
 * the round-trip harness's store — which is how the crash cases in
 * `recorder.test.ts` read back on a connection this process never wrote
 * through.
 */
export interface RecordingCheckpointStore {
  putRecordingSession(record: NewRecordingSession): Promise<RecordingSessionId>;
  appendRecordingChunk(chunk: NewRecordingChunk): Promise<number>;
  listRecordingSessions(owner: AthleteId): Promise<RecordingSessionRecord[]>;
  recoverRecording(
    owner: AthleteId,
    id: RecordingSessionId,
  ): Promise<RecoveredRecording | undefined>;
  deleteRecordingSession(owner: AthleteId, id: RecordingSessionId): Promise<boolean>;
}

/** Whether the last checkpoint reached the disk, and why not. */
export type RecorderStorageState =
  /** Everything sealed has been written. */
  | 'ok'
  /** The device is out of space. The ride continues in memory; nothing is discarded. */
  | 'quota-exceeded'
  /** A write failed for another reason. The same window is retried on the next tick. */
  | 'failed';

/** @see createRecorder */
export interface RecorderOptions {
  readonly store: RecordingCheckpointStore;
  readonly athleteId: AthleteId;
  /**
   * This recording's identity, generated by the caller.
   *
   * Supplied rather than generated here for the reason the engine gives, and
   * for one more: two tabs must not collide, and a caller that reaches for
   * `crypto.randomUUID()` is making that guarantee visibly.
   */
  readonly sessionId: RecordingSessionId;
  /** Defaults to `seconds(1)` — the 1 Hz grid FIT expects. */
  readonly sampleInterval?: Seconds;
  /** @see DEFAULT_FLUSH_INTERVAL_SECONDS */
  readonly flushIntervalSeconds?: number;
  /** @see DEFAULT_LATE_TOLERANCE_SECONDS */
  readonly lateToleranceSeconds?: number;
  /**
   * Auto-pause. Defaults to speed-or-cadence movement after
   * {@link DEFAULT_AUTO_PAUSE_AFTER_SECONDS}; pass `null` to disable it.
   */
  readonly autoPause?: AutoPausePolicy<StreamChannelValue> | null;
}

/** A recording being written to disk as it happens. */
export interface Recorder {
  readonly sessionId: RecordingSessionId;
  /**
   * The engine. Read `state`, `elapsedTime`, `movingTime` and `series()` from
   * it — and `clockRegressions` and `dropped`, which are how a UI can tell a
   * rider that a corrected device clock cost them part of the ride. Exposed
   * through the session rather than mirrored here, so there is one count and
   * not two that can disagree.
   */
  readonly session: RecordingSession<StreamChannelValue>;
  readonly storageState: RecorderStorageState;
  /** What the last failed write threw, for a UI that wants to say more than "failed". */
  readonly storageError: Error | undefined;
  /** How many leading samples are on disk. The rest are only in memory. */
  readonly flushedThrough: number;
  /** How many chunks this recorder has written. Also the next `seq`. */
  readonly checkpoints: number;

  /** Starts recording and writes the header, so a crash one second in is recoverable. */
  start(at: UnixSeconds): Promise<void>;
  /** Merges one sensor measurement. Never throws; never writes. */
  observe(measurement: SensorMeasurement): RecordingOutcome;
  /** Merges one reading directly — for sources that are not BLE sensors (#50's GPS). */
  observeReading(reading: RideReading): RecordingOutcome;
  /** Advances the clock, runs auto-pause, and checkpoints if one is due. */
  tick(now: UnixSeconds): Promise<void>;
  pause(at: UnixSeconds): Promise<void>;
  resume(at: UnixSeconds): Promise<void>;
  /** Stops recording and checkpoints everything, including the final open slot. */
  stop(at: UnixSeconds): Promise<void>;
  /**
   * Writes every sealed sample not yet on disk.
   *
   * **Never throws.** A failure sets {@link Recorder.storageState} and leaves
   * the cursor where it was. @returns how many samples were written.
   */
  flush(): Promise<number>;
  /**
   * Removes this recording's checkpoint. What "discard the recovered ride" calls.
   *
   * **Runs even when {@link Recorder.storageState} is `quota-exceeded`.** The
   * terminal latch is right for a write and wrong for the one operation that
   * *frees* space, which is what a rider who has just been told the device is
   * full is being asked to do.
   *
   * @returns whether the recording is gone from disk — `true` also when there
   * was nothing there to remove. A `false` leaves the reason in
   * {@link Recorder.storageError}, because the caller needs to be able to say
   * "that did not work" rather than showing a list the row is still in.
   */
  discard(): Promise<boolean>;
}

/** Starts a new recording. Nothing is written until `start`. */
export function createRecorder(options: RecorderOptions): Recorder {
  const interval = options.sampleInterval ?? seconds(1);
  const session = createRecordingSession<StreamChannelValue>({
    id: options.sessionId,
    sampleInterval: interval,
    lateToleranceSeconds: options.lateToleranceSeconds ?? DEFAULT_LATE_TOLERANCE_SECONDS,
    ...autoPauseOption(options),
  });
  return recorderOver(options, session, {
    flushedThrough: 0,
    checkpoints: 0,
    headerWritten: false,
  });
}

/** What {@link recoverRecorder} found, and the recorder that continues it. */
export interface RecoveredRecorder {
  readonly recorder: Recorder;
  /** What came off disk, so a caller can show the rider what is being offered. */
  readonly recovered: RecoveredRecording;
}

/** Every recording on this device that could be continued or discarded. */
export async function listRecoverableRecordings(
  store: RecordingCheckpointStore,
  athleteId: AthleteId,
): Promise<RecordingSessionRecord[]> {
  return store.listRecordingSessions(athleteId);
}

/**
 * Rebuilds a recorder from what survived a crash, ready to continue.
 *
 * The recorder comes back **paused**, with the interruption recorded as an
 * automatic pause: the rider was not pedalling while the tab was dead, so that
 * time is not moving time. `resume(now)` continues into the slots after the
 * gap, and the gap stays a gap.
 *
 * Appending continues at `recovered.chunks`, which is the sequence number the
 * prefix ended at. Any chunk rows beyond a hole are left where they are and are
 * overwritten as the recording passes them; they cannot be read in the
 * meantime, because the store's recovery stops at the hole.
 *
 * @returns `undefined` if this athlete has no such recording.
 */
export async function recoverRecorder(
  options: Omit<RecorderOptions, 'sampleInterval'>,
): Promise<RecoveredRecorder | undefined> {
  const recovered = await options.store.recoverRecording(options.athleteId, options.sessionId);
  if (recovered === undefined) {
    return undefined;
  }
  const session = restoreRecordingSession<StreamChannelValue>(
    {
      lateToleranceSeconds: options.lateToleranceSeconds ?? DEFAULT_LATE_TOLERANCE_SECONDS,
      ...autoPauseOption(options),
    },
    {
      id: recovered.id,
      startedAt: recovered.startedAt,
      sampleInterval: recovered.sampleInterval,
      sampleCount: recovered.sampleCount,
      channels: recovered.channels,
      pauses: recovered.pauses,
    },
  );
  const recorder = recorderOver(options, session, {
    flushedThrough: recovered.sampleCount,
    checkpoints: recovered.chunks,
    headerWritten: true,
  });
  return { recorder, recovered };
}

function autoPauseOption(options: Pick<RecorderOptions, 'autoPause'>): {
  autoPause?: AutoPausePolicy<StreamChannelValue>;
} {
  if (options.autoPause === null) {
    return {};
  }
  return {
    autoPause: options.autoPause ?? {
      after: seconds(DEFAULT_AUTO_PAUSE_AFTER_SECONDS),
      isMoving: isMovingReading,
    },
  };
}

interface RecorderCursor {
  flushedThrough: number;
  checkpoints: number;
  headerWritten: boolean;
}

/**
 * One closure holding the flush policy. Everything the interface exposes is a
 * view of the three `let` bindings and the cursor below.
 */
function recorderOver(
  options: Pick<RecorderOptions, 'store' | 'athleteId' | 'sessionId' | 'flushIntervalSeconds'>,
  session: RecordingSession<StreamChannelValue>,
  cursor: RecorderCursor,
): Recorder {
  const { store, athleteId, sessionId } = options;
  const flushInterval = options.flushIntervalSeconds ?? DEFAULT_FLUSH_INTERVAL_SECONDS;

  let storageState: RecorderStorageState = 'ok';
  let storageError: Error | undefined;
  let lastFlushAt: number | undefined;

  /** The header, rewritten on every checkpoint because state and pauses move. */
  function header(startedAt: UnixSeconds, at: UnixSeconds): NewRecordingSession {
    const series = session.series();
    return {
      id: sessionId,
      athleteId,
      startedAt,
      sampleInterval: series.sampleInterval,
      state: storedState(),
      updatedAt: at,
      pauses: series.pauses,
    };
  }

  function storedState(): RecordingStoredState {
    // `idle` never reaches disk. `start` writes its header *after* the
    // transition, and `flush` returns before writing anything while the session
    // has not started, so the fallback below is what makes this a total
    // function rather than a state anything can produce.
    return session.state === 'idle' ? 'recording' : session.state;
  }

  /**
   * Runs a write, and turns a failure into a *state* rather than an exception.
   *
   * @returns whether the write landed.
   */
  async function attempt(write: () => Promise<unknown>): Promise<boolean> {
    if (storageState === 'quota-exceeded') {
      // Terminal. Retrying costs a flush window and fails identically, and the
      // ride is still whole in memory.
      return false;
    }
    try {
      await write();
      storageState = 'ok';
      storageError = undefined;
      return true;
    } catch (error: unknown) {
      storageError = error instanceof Error ? error : new Error(String(error));
      storageState = isQuotaExceeded(error) ? 'quota-exceeded' : 'failed';
      return false;
    }
  }

  /**
   * Removes this recording, and deliberately **not** through {@link attempt}.
   *
   * A delete is not a write: it is the operation that frees the space the quota
   * latch is reporting, so latching it off is latching off the remedy. It is
   * also the only path that removes a stored GPS trace, and a discard that
   * silently did nothing would leave one on the device after the rider asked
   * for it to go.
   *
   * A success does not clear `storageState`: the device may still be full, and
   * one row deleted does not prove the next chunk fits. What it clears is the
   * recording.
   *
   * @returns whether the delete ran without error.
   */
  async function attemptDelete(): Promise<boolean> {
    try {
      await store.deleteRecordingSession(athleteId, sessionId);
      return true;
    } catch (error: unknown) {
      storageError = error instanceof Error ? error : new Error(String(error));
      storageState = isQuotaExceeded(error) ? 'quota-exceeded' : 'failed';
      return false;
    }
  }

  const recorder: Recorder = {
    sessionId,
    session,
    get storageState() {
      return storageState;
    },
    get storageError() {
      return storageError;
    },
    get flushedThrough() {
      return cursor.flushedThrough;
    },
    get checkpoints() {
      return cursor.checkpoints;
    },

    async start(at: UnixSeconds): Promise<void> {
      session.start(at);
      lastFlushAt = at;
      // The header goes down before a single sample does, so a crash one second
      // into a ride leaves something `listRecordingSessions` can offer back
      // rather than orphaned chunks nothing points at.
      cursor.headerWritten = await attempt(async () => store.putRecordingSession(header(at, at)));
    },

    observe(measurement: SensorMeasurement): RecordingOutcome {
      return session.observe(readingFor(measurement));
    },

    observeReading(reading: RideReading): RecordingOutcome {
      return session.observe(reading);
    },

    async tick(now: UnixSeconds): Promise<void> {
      session.advanceTo(now);
      lastFlushAt ??= now;
      if (now - lastFlushAt >= flushInterval) {
        lastFlushAt = now;
        await recorder.flush();
      }
    },

    async pause(at: UnixSeconds): Promise<void> {
      session.pause(at);
      // Checkpointed immediately: a pause changes the header, and a crash
      // during a pause must not come back as moving time.
      await recorder.flush();
    },

    async resume(at: UnixSeconds): Promise<void> {
      session.resume(at);
      lastFlushAt = at;
      await recorder.flush();
    },

    async stop(at: UnixSeconds): Promise<void> {
      session.stop(at);
      await recorder.flush();
    },

    async flush(): Promise<number> {
      const startedAt = session.startedAt;
      if (startedAt === undefined) {
        // Nothing has been recorded, so there is nothing to checkpoint and no
        // header worth writing: a row claiming a recording that never started
        // would be offered back to the rider as a ride to recover.
        return 0;
      }
      const from = cursor.flushedThrough;
      // Once stopped there is nothing left that can change, so the final open
      // slot is written too. Before then, only the sealed prefix is.
      const to = session.state === 'stopped' ? session.sampleCount : session.sealedCount;

      if (!cursor.headerWritten) {
        cursor.headerWritten = await attempt(async () =>
          store.putRecordingSession(header(startedAt, session.timeline)),
        );
        if (!cursor.headerWritten) {
          return 0;
        }
      }

      if (to > from) {
        const slice = session.slice(from, to);
        const chunk: NewRecordingChunk = {
          sessionId,
          athleteId,
          seq: cursor.checkpoints,
          fromIndex: slice.fromIndex,
          sampleCount: slice.sampleCount,
          // `RecordedChannels<StreamChannelValue>` *is* `StreamChannels`, with
          // no cast: the engine was instantiated at the store's own channel map
          // precisely so that this is an assignment and not a conversion. A
          // conversion here would be a fifth place for a sample to be lost
          // between the two, and the linter proves there is none by rejecting
          // the assertion that used to be here as unnecessary.
          channels: slice.channels,
        };
        const written = await attempt(async () => store.appendRecordingChunk(chunk));
        if (!written) {
          // The cursor does not move. A transient failure retries this same
          // window on the next tick; a quota failure never tries again, and the
          // samples stay in memory where the rider can still finish the ride.
          return 0;
        }
        cursor.checkpoints += 1;
        cursor.flushedThrough = to;
      }

      // The header last, and only once the chunk it accounts for is down. A
      // header claiming a state its chunks do not support is the half-written
      // shape this ordering exists to avoid.
      await attempt(async () => store.putRecordingSession(header(startedAt, session.timeline)));
      return to - from;
    },

    async discard(): Promise<boolean> {
      return attemptDelete();
    },
  };

  return recorder;
}

/**
 * Whether a rejection is the browser saying the device is full.
 *
 * `DOMException` with `name === 'QuotaExceededError'` is what IndexedDB raises,
 * and Dexie wraps it in its own error while preserving the name. Matched on
 * `name` rather than with `instanceof DOMException` for that reason, and
 * because `DOMException` is not constructible in every environment this code is
 * tested in.
 */
function isQuotaExceeded(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const named = error as { name?: unknown; inner?: unknown };
  if (named.name === 'QuotaExceededError') {
    return true;
  }
  // Dexie hangs the originating error on `inner` rather than on `cause`.
  return typeof named.inner === 'object' && named.inner !== null
    ? (named.inner as { name?: unknown }).name === 'QuotaExceededError'
    : false;
}
