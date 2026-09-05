// SPDX-License-Identifier: Apache-2.0

/**
 * Nominal identifiers for the entities this store models.
 *
 * The same reasoning as `Quantity` in `@onyourleft/domain`: an `AthleteId`, an
 * `ActivityId` and a `LapId` are all `string` to TypeScript, so passing one
 * where another is wanted is not an error the compiler can see. Here that
 * matters more than it does for a unit, because **every athlete-scoped read in
 * this package takes an athlete id and an entity id side by side** — and
 * transposing them is precisely the cross-athlete exposure shape CLAUDE.md
 * section 6 names.
 *
 * The brand is a phantom property keyed on a `unique symbol` declared here and
 * never exported, so nothing outside this file can produce one except through
 * the constructors below. It erases at runtime: an `ActivityId` is a plain
 * string in IndexedDB, with no wrapper and no encoding.
 *
 * Ids are opaque strings rather than integers on purpose. There is no server to
 * allocate a sequence (owner decision D6), records are created on the device,
 * and a monotonic integer would collide the moment two devices sync in Phase 3.
 */

import { StoreValidationError } from './errors';

declare const entity: unique symbol;

/** A `string` that carries the entity it identifies in the type system. */
export type EntityId<Entity extends string> = string & { readonly [entity]: Entity };

/**
 * Identifies the local athlete — the owner of the data, not an account.
 *
 * Phase 1 has no accounts (owner decision D6, and #33 is Phase 3), so this is a
 * local identity. #61 keys it to the device keypair; until then any opaque
 * non-empty string is accepted, and nothing in this package interprets it.
 */
export type AthleteId = EntityId<'athlete'>;

/** Identifies one recorded or imported activity. */
export type ActivityId = EntityId<'activity'>;

/** Identifies one lap within an activity. */
export type LapId = EntityId<'lap'>;

/** Identifies one local-only privacy zone (ADR 0004 decision B). */
export type PrivacyZoneId = EntityId<'privacy zone'>;

/**
 * Identifies one recording in progress (#46).
 *
 * Distinct from `ActivityId` on purpose. A recording becomes an activity only
 * when it is finalised, and several recordings can exist on a device at once —
 * a crashed one waiting to be recovered, and the one being ridden now. Sharing
 * the brand would make "the activity this recording will become" and "the
 * recording itself" the same type, and the two have different lifetimes.
 */
export type RecordingSessionId = EntityId<'recording session'>;

function assertUsableId(value: string, what: string): void {
  if (value.length === 0) {
    throw new StoreValidationError(`${what} must not be empty`);
  }
  // A key that is only whitespace reads as present in every log and every
  // debugger and is a different key from every other whitespace key. It is
  // never intended, and an id that cannot be typed out cannot be supported.
  if (value.trim().length === 0) {
    throw new StoreValidationError(`${what} must not be blank`);
  }
}

/** @throws {StoreValidationError} if empty or blank. */
export function athleteId(value: string): AthleteId {
  assertUsableId(value, 'athlete id');
  return value as AthleteId;
}

/** @throws {StoreValidationError} if empty or blank. */
export function activityId(value: string): ActivityId {
  assertUsableId(value, 'activity id');
  return value as ActivityId;
}

/** @throws {StoreValidationError} if empty or blank. */
export function lapId(value: string): LapId {
  assertUsableId(value, 'lap id');
  return value as LapId;
}

/** @throws {StoreValidationError} if empty or blank. */
export function privacyZoneId(value: string): PrivacyZoneId {
  assertUsableId(value, 'privacy zone id');
  return value as PrivacyZoneId;
}

/** @throws {StoreValidationError} if empty or blank. */
export function recordingSessionId(value: string): RecordingSessionId {
  assertUsableId(value, 'recording session id');
  return value as RecordingSessionId;
}
