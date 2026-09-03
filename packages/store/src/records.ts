// SPDX-License-Identifier: Apache-2.0

/**
 * The records this store holds, in their **in-memory** form: quantities carry
 * their unit from `@onyourleft/domain`, ids carry their entity from `ids.ts`.
 *
 * `persisted.ts` holds the corresponding on-disk shapes and the two functions
 * that convert between them. They are separate types on purpose — see the note
 * at the top of that file.
 *
 * What is **not** here, and why:
 *
 * - **No stream data.** Not a sample array, not a `Blob`, not a channel. #27
 *   owns stream storage and ADR 0005 section F is explicit that raw per-sample
 *   rows are never stored (~57,600 rows for a two-hour ride, ~25x the size of
 *   the object shape). A list row in #62 must never load one, and the cheapest
 *   way to guarantee that is for this package's records not to contain any.
 * - **No `startLatitude`/`startLongitude` pair.** ADR 0004 "Constraints this
 *   places on other work", item 1, forbids a stored position-derived summary
 *   field that a list query selects: it is a home address in a field that every
 *   list render touches. `hasPosition` carries the one bit #62 actually needs.
 * - **No devices and no gear.** #26's description lists them; this issue's
 *   scope is athletes, activities and laps. They are additive object stores in
 *   a later schema version and nothing here forecloses them.
 */

import type { Metres, Seconds, UnixSeconds, Watts, GeographicPosition } from '@onyourleft/domain';

import type { ActivityId, AthleteId, LapId, PrivacyZoneId } from './ids';
import type { Visibility } from './visibility';

/**
 * The owner of the data on this device.
 *
 * Not an account: Phase 1 has no accounts and no server (owner decision D6).
 * The `ATHLETE` entity survives from #4's model because it is the thing
 * activities belong to and the thing a cross-athlete query must filter on —
 * which is exactly as true with one local athlete as with a million, and is
 * what makes the two-athlete fixtures in the tests meaningful rather than
 * theatrical.
 */
export interface AthleteRecord {
  readonly id: AthleteId;
  readonly displayName: string;
  readonly createdAt: UnixSeconds;
}

/** One recorded or imported ride. */
export interface ActivityRecord {
  readonly id: ActivityId;
  /** The owning athlete. Every read of this record filters on it. */
  readonly athleteId: AthleteId;
  readonly name: string;

  /**
   * The absolute instant the ride started, as seconds since the Unix epoch.
   *
   * Stored **beside** `startedAtTimeZone`, never instead of it. #26: "A ride's
   * local start time matters to the rider and its absolute instant matters to
   * ordering, and conflating them breaks both." This field is the ordering
   * half.
   */
  readonly startedAt: UnixSeconds;

  /**
   * The IANA time zone the ride started in — `'Europe/London'`, `'UTC'`.
   *
   * An identifier rather than a signed offset, for two reasons. It survives
   * DST, which a stored offset does not: the same zone is +00:00 in January and
   * +01:00 in July, and a ride re-rendered from an offset shows the wrong local
   * time half the year. And it needs no unit — `@onyourleft/domain` has no
   * signed-duration quantity, and a UTC offset cannot be `Seconds`, which is
   * non-negative by construction. Rather than invent a bare number for a
   * quantity, this field is not a quantity at all. Browsers report it from
   * `Intl.DateTimeFormat().resolvedOptions().timeZone`.
   */
  readonly startedAtTimeZone: string;

  /**
   * Wall-clock duration from start to finish, pauses included.
   *
   * Distinct from `movingTime` and both are stored. #26: deriving one from the
   * other later is impossible because the pause information is gone.
   */
  readonly elapsedTime: Seconds;

  /** Duration excluding pauses. See `elapsedTime`. */
  readonly movingTime: Seconds;

  readonly distance: Metres;

  /** ADR 0004 decision A. Always present; `private` when unspecified. */
  readonly visibility: Visibility;

  /**
   * Whether the activity has **any** position samples at all.
   *
   * `false` is a first-class, ordinary value, not a degraded one: it is the
   * indoor trainer case, which is half this product and the common case in the
   * Phase 1 local milestone. Nothing in this package requires a position, and
   * `false` here must never mean "incomplete".
   *
   * One bit, not a coordinate. #62 needs to know whether to render a map
   * thumbnail without loading a stream; it does not need to know where.
   */
  readonly hasPosition: boolean;

  readonly averagePower?: Watts;

  /**
   * The immutable original file, if one exists — its local storage key and the
   * SHA-256 of its bytes, lowercase hex.
   *
   * The file itself is #27's; this is the reference to it. The hash is what
   * #37 deduplicates on, which is why `schema.ts` indexes it. Absent for a ride
   * recorded live that has not been encoded to FIT yet (#45, #29).
   */
  readonly originalFile?: OriginalFileReference;

  readonly createdAt: UnixSeconds;
}

/** @see {@link ActivityRecord.originalFile} */
export interface OriginalFileReference {
  readonly key: string;
  /** SHA-256 of the file's bytes, lowercase hex, 64 characters. */
  readonly sha256: string;
}

/** One lap within an activity. */
export interface LapRecord {
  readonly id: LapId;
  readonly activityId: ActivityId;
  /**
   * Denormalised from the owning activity, deliberately.
   *
   * It is the scoping column: without it, `listLaps` would have to read the
   * activity to learn whose laps these are, and a caller that skipped that step
   * would return another athlete's laps from an activity id alone. Denormalising
   * it makes the athlete-scoped index possible and makes the scoped query the
   * easy one to write. `putLap` copies it from the parent rather than trusting
   * the caller, so the two cannot disagree.
   */
  readonly athleteId: AthleteId;
  /** Zero-based position within the activity. A count, not a quantity. */
  readonly ordinal: number;
  readonly startedAt: UnixSeconds;
  readonly elapsedTime: Seconds;
  readonly movingTime: Seconds;
  readonly distance: Metres;
  readonly averagePower?: Watts;
}

/**
 * A local-only privacy zone — ADR 0004 decision B, and the "local-only
 * privacy-zone table" item 1 of that ADR's constraints requires of #26.
 *
 * **This record never leaves the device.** It is not exported, not synced, and
 * not federated: a zone definition is a home address stated precisely, so
 * publishing the zones is strictly worse than publishing the tracks they hide.
 * Phase 3 (#7) strips before upload; nothing in Phase 1 uploads anything.
 */
export interface PrivacyZoneRecord {
  readonly id: PrivacyZoneId;
  readonly athleteId: AthleteId;
  readonly centre: GeographicPosition;
  readonly radius: Metres;
  /** The athlete's own label — "home", "work". Never rendered off-device. */
  readonly label: string;
  readonly createdAt: UnixSeconds;
}

/** ADR 0004 decision B: 500 m, proposed to the athlete rather than applied. */
export const DEFAULT_PRIVACY_ZONE_RADIUS_METRES = 500;

/**
 * What `putActivity` accepts: an `ActivityRecord` with `visibility` optional,
 * because ADR 0004's default is applied here rather than demanded of callers.
 *
 * Everything else is required. A default for a duration or a distance would be
 * a guess written into the athlete's data.
 */
export type NewActivity = Omit<ActivityRecord, 'visibility'> & {
  readonly visibility?: Visibility;
};

/**
 * What `putLap` accepts. `athleteId` is **absent**, not optional: it is copied
 * from the owning activity inside the same transaction, so a caller cannot file
 * a lap under an athlete who does not own the activity.
 */
export type NewLap = Omit<LapRecord, 'athleteId'>;

/**
 * The projection `listActivitySummaries` returns — #26's revision block and
 * #62 both require a "summaries-only read that never loads stream data for a
 * list row".
 *
 * Today that is guaranteed twice over: this type omits `originalFile`, and no
 * record in this package holds stream bytes in the first place. The type exists
 * anyway, because #27 adds blob references to the activity record and the list
 * path must already have a shape that cannot carry them.
 */
export type ActivitySummary = Omit<ActivityRecord, 'originalFile'>;
