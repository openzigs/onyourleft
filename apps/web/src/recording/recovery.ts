// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rides this device is still holding, and what a rider may do with each —
 * [#212](https://github.com/openzigs/onyourleft/issues/212).
 *
 * ## What was wrong
 *
 * `README.md` promised that *"the next time the client opens it offers the
 * interrupted ride back to be continued or discarded"*. It did not.
 * `listRecoverableRecordings` and `recoverRecorder` were written and tested and
 * **called by nothing anywhere in `apps/web`**, so a ride interrupted by a
 * closed tab was on the device, intact, and unreachable. #46 calls itself the
 * most important issue in the milestone on the grounds that *"the local copy is
 * the only copy in existence"*; this is the half of it a rider ever sees.
 *
 * ## Two kinds of leftover, and they are not offered the same thing
 *
 * The store's `state` column already tells them apart, so this reads it rather
 * than inventing a flag:
 *
 * - **`interrupted`** (`recording` or `paused`) — the tab died mid-ride. The
 *   rider may **continue** it, save what there is, or throw it away.
 * - **`unsaved`** (`stopped`, no `savedAs`) — the ride was *finished* and the
 *   save did not get it into the athlete's activities. Offering "continue"
 *   here would be wrong: the rider already ended it. They are offered **save**
 *   and **discard**.
 * - **`already-saved`** (`stopped`, with `savedAs`) — the ride saved, and only
 *   the checkpoint delete afterwards failed. ⚠️ **This kind exists because
 *   review found that without it the row is indistinguishable from the one
 *   above**, so the screen offered "save" and a second press wrote a duplicate
 *   ride under a fresh activity id with nothing deduplicating it. It is
 *   offered **discard alone**, and the wording says the ride is already
 *   safe.
 *
 * ⚠️ **That second case only exists because the save path keeps its
 * checkpoint.** Before #213 nothing wrote a `stopped` row that outlived its
 * ride, because nothing saved rides at all.
 *
 * ## What this deliberately does not read
 *
 * The samples. `RecordingSessionRecord` is the small indexed row — id, start,
 * interval, state, last write — and reading how many seconds actually survived
 * means `recoverRecording`, which decodes every chunk. This offer is rendered
 * on an idle ride screen, so it costs one indexed read and no decode; the
 * chunks are read when the rider **acts**, not when they look.
 *
 * The consequence is stated rather than hidden: the span below is start to last
 * checkpoint, which is how long the ride *ran*, and a recording with a hole in
 * it recovers less than that. The wording says "up to".
 */

import type { UnixSeconds } from '@onyourleft/domain';
import type { RecordingSessionId, RecordingSessionRecord } from '@onyourleft/store';

import { formatDuration } from '../format';

/** Why this recording is still here. See this module's header. */
export type RecoverableKind = 'interrupted' | 'unsaved' | 'already-saved';

/** One leftover recording, as a rider is offered it. */
export interface RecoverableRide {
  readonly id: RecordingSessionId;
  readonly kind: RecoverableKind;
  readonly startedAt: UnixSeconds;
  /** When the last checkpoint landed. */
  readonly lastWrittenAt: UnixSeconds;
  /** Start to last checkpoint, in seconds. See the header on why this is an upper bound. */
  readonly spannedSeconds: number;
  /** `"1:12:00"`, the same formatter every other duration on this screen uses. */
  readonly spanned: string;
  /**
   * Whether continuing makes sense.
   *
   * ⚠️ False for an `unsaved` ride, and that is the whole reason the two kinds
   * are distinguished: a rider who already pressed Stop is not offered a
   * control that would restart a ride they ended.
   */
  readonly canContinue: boolean;
  /**
   * Whether this recording is already in the athlete's activities.
   *
   * ⚠️ **`true` means saving it again would duplicate it**, so the screen
   * offers discard alone and `controller.saveRecovered` refuses. Derived from
   * the stored link rather than from the state column, because the state
   * column cannot tell a failed save from a failed tidy-up.
   */
  readonly alreadySaved: boolean;
}

/**
 * How many leftovers are offered at once: **20**.
 *
 * A rider should never have one, let alone twenty. The bound is here because
 * the read is unbounded and a device that has accumulated orphans through some
 * failure nobody has seen yet should produce a usable screen rather than a list
 * of two hundred — the same argument `WORKOUT_LIST_LIMIT` makes for a library
 * that grows.
 */
export const RECOVERABLE_LIMIT = 20;

export interface RecoverableOptions {
  /**
   * The session this controller is recording **right now**, which must not be
   * offered back.
   *
   * ⚠️ Not a nicety. A recording in progress has a checkpoint on disk from its
   * first flush onwards, so without this the ride screen would offer a rider
   * the ride they are in the middle of — and "discard" on it would delete the
   * ride they are currently riding.
   */
  readonly excluding?: RecordingSessionId | undefined;
}

export function recoverableRides(
  rows: readonly RecordingSessionRecord[],
  options: RecoverableOptions = {},
): readonly RecoverableRide[] {
  return rows
    .filter((row) => row.id !== options.excluding)
    .map(rideOf)
    .sort((left, right) => right.lastWrittenAt - left.lastWrittenAt)
    .slice(0, RECOVERABLE_LIMIT);
}

function rideOf(row: RecordingSessionRecord): RecoverableRide {
  const alreadySaved = row.savedAs !== undefined;
  const kind: RecoverableKind =
    row.state === 'stopped' ? (alreadySaved ? 'already-saved' : 'unsaved') : 'interrupted';
  // ⚠️ Clamped at zero rather than trusted. `updatedAt` is a stored clock and
  // a device whose time stepped backwards mid-ride can write one that precedes
  // the start — the same clock regression `packages/domain`'s engine counts
  // rather than passes over. A negative span would format as a duration nobody
  // can read.
  const spannedSeconds = Math.max(0, row.updatedAt - row.startedAt);
  return {
    id: row.id,
    kind,
    startedAt: row.startedAt,
    lastWrittenAt: row.updatedAt,
    spannedSeconds,
    spanned: formatDuration(spannedSeconds),
    canContinue: kind === 'interrupted',
    alreadySaved,
  };
}
