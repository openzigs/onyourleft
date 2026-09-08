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

import type {
  BeatsPerMinute,
  DegreesBearing,
  EffortVisibility,
  ElevationSource,
  GradePercent,
  Kilograms,
  Metres,
  Seconds,
  SegmentSport,
  SegmentVisibility,
  UnixSeconds,
  Watts,
  GeographicPosition,
} from '@onyourleft/domain';

import type {
  ActivityId,
  AthleteId,
  LapId,
  PrivacyZoneId,
  SegmentEffortId,
  SegmentId,
} from './ids';
import type { Visibility } from './visibility';

/**
 * A compile-time assertion that this package's {@link Visibility} and
 * `@onyourleft/domain`'s `SegmentVisibility` are **the same three values**.
 *
 * Two visibility vocabularies in one program is how a `followers` segment ends
 * up rendered by a check written for a two-state enum. The domain package
 * cannot import this one — the dependency points the other way — so the two
 * unions are declared twice and this is what stops them drifting. Widening
 * either without the other makes the line below a type error.
 *
 * ⚠️ **The assignment must be in BOTH directions.** One direction only proves
 * containment, and a `SegmentVisibility` that had dropped a value would still
 * satisfy it.
 */
type VisibilitiesAgree = [
  SegmentVisibility extends Visibility ? true : never,
  Visibility extends SegmentVisibility ? true : never,
];
const visibilitiesAgree: VisibilitiesAgree = [true, true];
void visibilitiesAgree;

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

  /**
   * The athlete's threshold power, from which every power zone is derived
   * (#78) and on which #76's load metrics will rest.
   *
   * ⚠️ **Optional, and that is what keeps this off the migration path.** An
   * absent field reads back as `undefined` from a row written before it
   * existed, and the reader substitutes `DEFAULT_THRESHOLD_POWER` — so an
   * existing database needs no data transform, no schema version and no
   * `.upgrade()` hook. That is the same reason versions 1-4 needed no record
   * migrations: every change so far has been additive.
   *
   * A **required** field here would have been different, and worth knowing
   * before someone tries it: it would need the first entry in
   * `SCHEMA_MIGRATIONS` — which is empty — *and* the Dexie `.upgrade()`
   * wiring, which does not exist. `upgradeWith` in `migrations.ts` is written
   * and is never called from `ActivityStore`. Making a field required is
   * therefore a change to the store's core with real risk to real databases,
   * and it should be its own piece of work rather than a side effect of a
   * feature that only needs a number.
   */
  readonly thresholdPower?: Watts;

  /** The athlete's threshold heart rate. Optional for the reason above. */
  readonly thresholdHeartRate?: BeatsPerMinute;

  /**
   * The athlete's recorded mass — what a weight-bucketed ranking would use.
   *
   * Optional, so it stays off the migration path for the reason above.
   *
   * ⚠️ **A ranking must not read this.** It is the *current* value, and #66's
   * eighth criterion is that an effort's bucket is fixed when the effort is
   * made: a rider who loses six kilograms this year did not thereby ride last
   * year's climb in a different weight class. The value a board reads lives on
   * `SegmentEffortRecord.attributes`, copied at creation. This field is only
   * ever the *source* of that copy.
   */
  readonly mass?: Kilograms;
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
   * The **threshold-independent** half of this ride's load (#77).
   *
   * `packages/domain`'s `analysis/load.ts` computes a ride's load from two
   * things: an effort-weighted power (or heart rate), which needs every sample
   * and is expensive, and the athlete's current threshold, which is one
   * division. These fields carry the expensive half, so a chart over a thousand
   * rides can be drawn from `listActivitySummaries` alone — #77's seventh
   * criterion forbids loading stream data to draw it, and decoding a thousand
   * power channels is exactly what that criterion is about.
   *
   * ⚠️ **The load itself is deliberately NOT stored.** It depends on the
   * threshold, and since #76 a rider can change theirs — so a stored load would
   * be silently stale across the whole history the moment they did, and nothing
   * would say so. Storing the part that does not move and deriving the part
   * that does is what keeps the chart and the ride screen agreeing.
   *
   * ⚠️ **At most one of the two is set**, and which one says what basis was
   * used: power where the ride has it, heart rate where it does not. That
   * mirrors `apps/web/src/analysis/load.ts`'s `loadFrom`, where the ordering is
   * a decision rather than a fallback chain's accident — heart rate lags an
   * effort and saturates. One field per basis rather than one number plus a
   * label is what stops a bpm being read as watts; `streams.ts` states the same
   * rule for the same reason.
   *
   * Optional, so this is additive and needs no migration — see `README.md`
   * §"An optional field is not a migration".
   */
  readonly effortWeightedPower?: Watts;

  /** @see effortWeightedPower — set only when the ride has no power. */
  readonly effortWeightedHeartRate?: BeatsPerMinute;

  /**
   * How long the basis channel actually reported, which is what a load is
   * proportional to.
   *
   * Not `movingTime`. A ride that lost a third of its trace produces a load a
   * third light, and `analysis/load.ts` records why that is reported rather
   * than corrected: inventing the missing third is the fabrication the gap rule
   * exists to prevent.
   */
  readonly loadCoveredTime?: Seconds;

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

/**
 * One segment (#64) — a named stretch of road with a direction, against which
 * efforts are timed.
 *
 * The shape is `@onyourleft/domain`'s `Segment` with this package's branded
 * ids substituted. The geometry, the endpoint model, the minimum length and the
 * two constraints that bind them are all stated there, in
 * `segment/segment.ts`; this type is where they are persisted.
 *
 * ⚠️ **There is no reference to the activity a segment was created from, and
 * that absence is #64's second acceptance criterion.** The criterion reads:
 * *"The created segment's geometry is a **copy**, not a reference into the
 * source activity: deleting the source activity leaves the segment intact …
 * The failure prevented is a leaderboard that evaporates when one rider tidies
 * their history."*
 *
 * A stored `sourceActivityId` would satisfy the letter of that and invite the
 * breach: the next contributor to write a cascade sees a foreign key and
 * cascades it, and `deleteActivity` already cascades laps, streams and signed
 * records for good reasons. A reference that must never be followed is worse
 * than no reference, so there is none, and `activity-store.test.ts` asserts
 * that deleting an activity leaves its segments untouched. Provenance is
 * carried by {@link createdBy}, which is what #64's field table asks for —
 * "Ownership, and moderation".
 *
 * ⚠️ **No OSM identifier belongs on this record** — no way id, no node id, no
 * edge id — per [ADR 0012](../../../docs/adr/0012-data-licence.md) D-1. Adding
 * one converts the whole segment corpus into an ODbL Derivative Database, and
 * it would arrive looking like a matcher optimisation. D-3 says where such data
 * goes instead: its own object store, licensed ODbL, beside a segment record
 * that keeps its own-trace geometry.
 */
export interface SegmentRecord {
  readonly id: SegmentId;
  /** The athlete who created it. Every read of this record filters on it. */
  readonly createdBy: AthleteId;
  readonly name: string;
  readonly sport: SegmentSport;

  /**
   * The path, in the direction of travel — a copy of a span of the creator's
   * own recorded activity, never a reference into it.
   */
  readonly geometry: readonly GeographicPosition[];

  readonly start: SegmentEndpointRecord;
  readonly end: SegmentEndpointRecord;

  /** Travels with the segment, so retuning the default cannot re-decide it. */
  readonly bearingToleranceDegrees: number;

  /** Length along {@link geometry}, not the straight line end to end. */
  readonly distance: Metres;

  /** Absent when the source carried no altitude. **Not zero** — see below. */
  readonly elevationGain?: Metres;
  readonly averageGrade?: GradePercent;
  readonly maximumGrade?: GradePercent;

  /**
   * Where the elevation numbers came from, and at what resolution.
   *
   * #64: "Two segments compared with different DEMs are not comparable." Both
   * are stored so a reader can see that before comparing, and
   * `elevationSource: 'none'` is why the three fields above are optional: an
   * unmeasured climb must not read as a flat road.
   */
  readonly elevationSource: ElevationSource;
  readonly elevationResolutionMetres?: number;

  /**
   * ADR 0004's default is `private`, and #64's fourth criterion makes one case
   * unconditional: a segment whose endpoints fall inside a privacy zone cannot
   * be created `public`, because a public segment start is a published address.
   * This package does not enforce that — it has no view of what a "start" means
   * to a rider — and `apps/web/src/segments/create.ts` does, before it calls
   * `putSegment`.
   */
  readonly visibility: SegmentVisibility;

  /**
   * When the segment was created.
   *
   * #64: "Efforts before a segment existed must be excludable from
   * rolling-window rankings. Backfilling them silently changes what a '90-day'
   * board means." Stored so that exclusion is expressible; #68 decides whether
   * to apply it.
   */
  readonly createdAt: UnixSeconds;
}

/** One end of a segment. @see SegmentRecord */
export interface SegmentEndpointRecord {
  readonly position: GeographicPosition;
  /** The direction of travel through this endpoint, true rather than magnetic. */
  readonly bearing: DegreesBearing;
  /** How close a sample must be to count as having reached it. */
  readonly radius: Metres;
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

// --- #66: efforts, and the sweep that finds them ----------------------------

/**
 * One timed traversal of one segment, found in one activity.
 *
 * ⚠️ **The id is derived, not minted** — `@onyourleft/domain`'s `effortId`
 * builds it from `segmentId`, `activityId` and `startedAt`, so an effort keeps
 * the same identity when the ride is matched again. Anything holding a
 * reference to one depends on that.
 *
 * ⚠️ **It is NOT what makes re-matching idempotent**, which is the plausible
 * and wrong reading. That comes from `putActivityEfforts` replacing the
 * activity's whole set; a store with random ids passes the three-runs test
 * anyway, which `testing/fakes.ts` found by staying green. `schema.ts` has the
 * long version.
 *
 * ⚠️ **No reference to a stream, and no geometry.** An effort is two indices'
 * worth of information about an activity that is already stored; copying the
 * traversed coordinates here would double the storage and give a shared board
 * a second place to leak a position from.
 */
export interface SegmentEffortRecord {
  readonly id: SegmentEffortId;
  /** The owning athlete. Every read of this record filters on it. */
  readonly athleteId: AthleteId;
  readonly segmentId: SegmentId;
  /** The activity it was found in. Cascades when that activity is deleted. */
  readonly activityId: ActivityId;

  readonly startedAt: UnixSeconds;
  /**
   * The traversal time, from two **recorded** timestamps.
   *
   * Indexed as the last component of `[athleteId+segmentId+elapsed]`, so a
   * personal best is the first row of an index lookup rather than a sort.
   */
  readonly elapsed: Seconds;
  /** How far the ride strayed from the segment. Kept so a match is auditable. */
  readonly deviation: Metres;

  /**
   * ⚠️ **Three states, never a boolean.** `private-match` is an effort the
   * athlete should see and a leaderboard row that would publish their home
   * address; a two-state field forces a choice between losing their history and
   * publishing where they live. `@onyourleft/domain`'s `countsTowardPersonalBest`
   * and `countsOnSharedBoard` are the two readers, and they disagree about
   * exactly this value.
   */
  readonly visibility: EffortVisibility;

  /**
   * What the athlete looked like **when the effort was made**.
   *
   * ⚠️ Copied at creation and never retro-migrated (#66). Nothing may replace a
   * value here with a lookup against `AthleteRecord` — that produces a board
   * which looks right and quietly rewrites history whenever somebody edits
   * their profile, and no test of a single ranking catches it.
   */
  readonly attributes: FrozenEffortAttributes;
}

/** The frozen copy. Mirrors `@onyourleft/domain`'s `FrozenAttributes`. */
export interface FrozenEffortAttributes {
  readonly riderMass?: Kilograms;
}

/**
 * How far a backfill sweep has got, so killing it mid-run does not start over.
 *
 * #66's fifth criterion: backfilling a new segment across a thousand stored
 * activities is a background job with progress, not a request, and it must be
 * resumable.
 *
 * ⚠️ **This is an optimisation, not the correctness mechanism.** What makes a
 * resumed run produce the same effort count as a clean one is the derived
 * effort id, not this row. A lost checkpoint costs time and cannot corrupt
 * anything — keep that property if you change this.
 */
export interface MatchCheckpointRecord {
  /** One sweep at a time per athlete, which is why this is the key. */
  readonly athleteId: AthleteId;
  /**
   * The `startedAt` of the last activity swept, exclusive of nothing.
   *
   * Activities are swept in `startedAt` order, so this plus `lastActivityId`
   * says exactly where to resume. Storing the *instant* rather than an offset
   * means an activity imported mid-sweep does not shift the cursor under it.
   */
  readonly lastStartedAt: UnixSeconds;
  readonly lastActivityId: ActivityId;
  /** How many activities the sweep has covered. For the progress the issue asks for. */
  readonly swept: number;
  readonly updatedAt: UnixSeconds;
}
