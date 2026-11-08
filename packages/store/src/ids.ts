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

/**
 * Identifies one segment (#64).
 *
 * Distinct from `ActivityId` for a reason worth stating, because the two are
 * created together: a segment is **not** a view of the activity it was cut
 * from. Its geometry is a copy, it outlives the activity's deletion, and it
 * holds no reference back — see `SegmentRecord`. Sharing a brand would make the
 * two interchangeable in exactly the signature where that independence has to
 * hold.
 */
export type SegmentId = EntityId<'segment'>;

/**
 * Identifies one segment effort (#66).
 *
 * ⚠️ **Derived, not minted.** `@onyourleft/domain`'s `effortId` builds it from
 * the segment, the activity and the traversal's start instant, so re-running
 * the matcher over a ride computes the *same* id and rewrites the row instead
 * of adding a second. #66's sixth criterion — *"without this, every app restart
 * inflates every leaderboard"* — is that property, and it lives in the key.
 * Anything here that generates a fresh id per call breaks it silently.
 */
export type SegmentEffortId = EntityId<'segment effort'>;

/**
 * Identifies one saved route (#89).
 *
 * Distinct from `ActivityId` and from `SegmentId` for the reason those two are
 * distinct from each other: a route is a line somebody intends to ride, not one
 * they did, and not a stretch they are ranked on. It has no efforts, no
 * leaderboard and no source activity, and a shared brand would make it
 * substitutable in exactly the signatures where that difference matters.
 */
export type RouteId = EntityId<'route'>;

/**
 * A saved workout (#14).
 *
 * Distinct from `RouteId` for the reason that one is distinct from
 * `ActivityId`: a route is *where* and a workout is *how hard*, they are
 * ridden together and independently, and a shared brand would make one
 * substitutable for the other in `startWorkout(routeId)` — which compiles.
 */
export type WorkoutId = EntityId<'workout'>;

/**
 * Identifies one still picture this device kept from a ride (#384).
 *
 * ⚠️ **Its own brand, and that is [ADR 0029](../../../docs/adr/0029-camera-imagery-as-a-data-class.md)
 * D-1 in the type system**: camera imagery is *"a distinct class in this
 * program … never modelled as a stream channel beside power, cadence and heart
 * rate, never stored in a `StreamSet`, and never covered by a rule whose
 * subject is 'activity data'."* Sharing `ActivityId`'s brand would make "the
 * ride this picture came from" and "the picture" the same type, which is the
 * first step toward a rule about one applying to the other.
 */
export type CameraFrameId = EntityId<'camera frame'>;

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

/** @throws {StoreValidationError} if empty or blank. */
export function segmentId(value: string): SegmentId {
  assertUsableId(value, 'segment id');
  return value as SegmentId;
}

/** @throws {StoreValidationError} if empty or blank. */
export function segmentEffortId(value: string): SegmentEffortId {
  assertUsableId(value, 'segment effort id');
  return value as SegmentEffortId;
}

/**
 * The id namespace reserved for the app's built-in lap-race circuits — #2293,
 * ADR 0064 D-2.2. A circuit is not a route the rider saved, so it has no
 * `RouteRecord`, but the world corridor store is keyed by owner and route id,
 * and a circuit's corridor is kept there under `circuit:` and the circuit's
 * own id. **No route id may carry it**: {@link routeId} refuses one, so a
 * circuit's corridor and a route's can never share a key.
 */
export const CIRCUIT_ROUTE_PREFIX = 'circuit:';

/**
 * The id namespace reserved for the app's built-in Delivery levels — #2361,
 * [ADR 0065](../../../docs/adr/0065-built-in-delivery-levels-shipped-in-the-app-under-odbl.md)
 * D-8.2. A level is not a route the rider saved and not a circuit: it has no
 * `RouteRecord`, and, unlike a circuit, **nothing of it is kept in the world
 * corridor store** (D-2.4: its buildings are in its own file), so
 * `putWorldCorridor` refuses a key in it. **No route id and no circuit id may
 * carry it**: {@link routeId} refuses one, and {@link levelRouteId} refuses a
 * level id that is itself a route id in either reserved namespace.
 */
export const LEVEL_ROUTE_PREFIX = 'level:';

/**
 * @throws {StoreValidationError} if empty or blank, or if it starts with
 * {@link CIRCUIT_ROUTE_PREFIX} or {@link LEVEL_ROUTE_PREFIX}, which only
 * {@link circuitRouteId} and {@link levelRouteId} make.
 */
export function routeId(value: string): RouteId {
  assertUsableId(value, 'route id');
  if (isCircuitRouteId(value)) {
    throw new StoreValidationError(
      `route id must not start with "${CIRCUIT_ROUTE_PREFIX}", which is reserved for the built-in circuits`,
    );
  }
  if (isLevelRouteId(value)) {
    throw new StoreValidationError(
      `route id must not start with "${LEVEL_ROUTE_PREFIX}", which is reserved for the built-in Delivery levels`,
    );
  }
  return value as RouteId;
}

/**
 * The key a built-in circuit is known by where a route id is asked for — #2293:
 * {@link CIRCUIT_ROUTE_PREFIX} and the circuit's id.
 *
 * @throws {StoreValidationError} if the circuit's id is empty or blank.
 */
export function circuitRouteId(circuit: string): RouteId {
  assertUsableId(circuit, 'circuit id');
  return `${CIRCUIT_ROUTE_PREFIX}${circuit}` as RouteId;
}

/** Whether an id is a built-in circuit's ({@link circuitRouteId}), never a saved route's. */
export function isCircuitRouteId(value: string): boolean {
  return value.startsWith(CIRCUIT_ROUTE_PREFIX);
}

/**
 * The key a built-in Delivery level is known by where a route id is asked
 * for — #2361: {@link LEVEL_ROUTE_PREFIX} and the level's id.
 *
 * @throws {StoreValidationError} if the level's id is empty or blank, or is
 * itself a circuit's or a level's route id, so the two namespaces stay apart.
 */
export function levelRouteId(level: string): RouteId {
  assertUsableId(level, 'level id');
  if (isCircuitRouteId(level) || isLevelRouteId(level)) {
    throw new StoreValidationError(
      'level id must be the level’s own id, not a route id in a reserved namespace',
    );
  }
  return `${LEVEL_ROUTE_PREFIX}${level}` as RouteId;
}

/** Whether an id is a built-in Delivery level's ({@link levelRouteId}), never a saved route's or a circuit's. */
export function isLevelRouteId(value: string): boolean {
  return value.startsWith(LEVEL_ROUTE_PREFIX);
}

/** @throws {StoreValidationError} if empty or blank. */
export function workoutId(value: string): WorkoutId {
  assertUsableId(value, 'workout id');
  return value as WorkoutId;
}

/** @throws {StoreValidationError} if empty or blank. */
export function cameraFrameId(value: string): CameraFrameId {
  assertUsableId(value, 'camera frame id');
  return value as CameraFrameId;
}
