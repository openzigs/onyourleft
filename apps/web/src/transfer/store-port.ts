// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The slice of `@onyourleft/store` this screen needs, and the side effects it
 * cannot perform in a test.
 *
 * Narrowed to seven methods rather than taking `ActivityStore` itself, for the
 * reason `recording/recorder.ts` narrows its own: a test then hands the same
 * code the round-trip harness's store (`@onyourleft/store/testing`), so the
 * import assertions read back on a **connection this process never wrote
 * through** rather than on the handle that did the writing. CLAUDE.md §5 calls
 * that the fourth cause of a write that reports success while the read cannot
 * see it, and it is the one a naive test cannot detect.
 */

import type { UnixSeconds } from '@onyourleft/domain';
import type {
  ActivityId,
  ActivityRecord,
  ActivitySummary,
  AthleteId,
  ListActivitiesOptions,
  NewActivity,
  NewStreamSet,
  StreamSet,
} from '@onyourleft/store';

/** What import and export do to the store, and nothing else. */
export interface TransferStore {
  findActivityByOriginalFileHash(
    owner: AthleteId,
    sha256: string,
  ): Promise<ActivityRecord | undefined>;
  putActivity(record: NewActivity): Promise<ActivityId>;
  putStreamSet(set: NewStreamSet): Promise<ActivityId>;
  deleteActivity(owner: AthleteId, id: ActivityId): Promise<boolean>;
  getActivity(owner: AthleteId, id: ActivityId): Promise<ActivityRecord | undefined>;
  getStreamSet(owner: AthleteId, activity: ActivityId): Promise<StreamSet | undefined>;
  listActivitySummaries(
    owner: AthleteId,
    options?: ListActivitiesOptions,
  ): Promise<ActivitySummary[]>;
}

/** A file this client hands to the browser to save. */
export interface DownloadableFile {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly mediaType: string;
}

/**
 * Everything the transfer screen needs from outside itself.
 *
 * Built in `main.tsx` and passed down, like `capabilities` and
 * `rideController` before it. `undefined` is a real state and the view renders
 * an honest explanation for it: this screen needs `crypto.subtle` to fingerprint
 * a file, and that is absent outside a secure context — which includes a bundle
 * opened straight off the disk as `file://`. #48's first criterion rejects a
 * control that looks like the way in and cannot work, so there is no file
 * picker on that path at all.
 */
export interface TransferPort {
  readonly store: TransferStore;
  readonly athleteId: AthleteId;
  /** A fresh activity id per imported file. `crypto.randomUUID()` in production. */
  newActivityId(): ActivityId;
  now(): UnixSeconds;
  /** The IANA zone an imported ride's local start time is read in. */
  readonly timeZone: string;
  /** SHA-256 of a file's bytes, lowercase hex. @see webCryptoDigest */
  digest(bytes: Uint8Array): Promise<string>;
  /** Hands a file to the browser to save. */
  save(file: DownloadableFile): void;
}
