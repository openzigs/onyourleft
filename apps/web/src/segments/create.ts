// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Creating a segment from a span of one of the athlete's **own** rides (#64).
 *
 * Three of #64's eight acceptance criteria are decided here, and each one is a
 * refusal or a downgrade rather than a warning nobody reads:
 *
 * | Criterion | What this file does |
 * |---|---|
 * | 1 — only from an activity the creating athlete owns | the read is athlete-scoped by signature (`store-port.ts`), and a miss is {@link segmentRefusals}`().notYours` |
 * | 3 — duplicate detection surfaces overlapping segments; a near-duplicate is permitted but forced `private` | {@link segmentDecision} reports every overlap it found and downgrades the visibility |
 * | 4 — a segment whose endpoints fall inside a privacy zone cannot be created `public` | the same function, same mechanism |
 *
 * The other five are `@onyourleft/domain`'s (the model, the endpoint test, the
 * minimum length) and `@onyourleft/store`'s (the migration, the round trip).
 *
 * ## The decision is a pure function, and that is deliberate
 *
 * {@link segmentDecision} takes data and returns data. It reads nothing, writes
 * nothing and cannot be mocked wrong. That shape was arrived at the hard way:
 * #76's threshold form had its refusal inline in an event handler, a mutation
 * that deleted the guard left the suite green because a later `watts()` threw
 * anyway, and the fix was to extract exactly this. A guard that only exists
 * inside an `async` handler is a guard whose absence is invisible.
 *
 * ⚠️ **The visibility downgrade is applied to the record that is written**, not
 * displayed beside a `public` one. A UI that showed "this will be private" and
 * wrote `public` is the shape ADR 0004 decision C calls out — *"client-side
 * hiding is not a control"* — one layer up.
 */

import {
  createSegment,
  distanceBetween,
  geographicPosition,
  MINIMUM_SEGMENT_LENGTH_METRES,
  MINIMUM_SEGMENT_POSITIONS,
  NEAR_DUPLICATE_OVERLAP,
  overlapFraction,
  OVERLAP_TOLERANCE_METRES,
  pathLength,
  UnitError,
  type GeographicPosition,
  type SegmentVisibility,
  type UnixSeconds,
} from '@onyourleft/domain';
import { athleteId, segmentId } from '@onyourleft/store';
import type {
  ActivityId,
  AthleteId,
  PrivacyZoneRecord,
  SegmentRecord,
  UnitSystem,
} from '@onyourleft/store';

import { formatSmallDistance, measurementText } from '../units/format';

import type { SegmentPort } from './store-port';

/**
 * How many of the athlete's existing segments a creation compares against.
 *
 * A bound rather than "all of them", for `analysis/load.ts`'s reason: an
 * athlete who has ridden for a decade has a corpus, `overlapFraction` is
 * quadratic in the position counts, and creation happens while somebody is
 * waiting. Newest first (the store's own order) is the right 200: a rider's
 * recent segments are the ones a new one is most likely to duplicate.
 *
 * ⚠️ **This is a real limit and it can miss.** A rider re-creating a climb they
 * last touched three hundred segments ago is told nothing, and gets a public
 * near-duplicate. That is a stated cost of a bounded read rather than an
 * oversight; #66's matcher is what will eventually make an unbounded scan
 * unnecessary.
 */
export const DUPLICATE_SCAN_LIMIT = 200;

/** How many samples a creation will read from a ride. @see readSpan */
export const MAXIMUM_SPAN_SAMPLES = 20_000;

/**
 * Why a segment could not be created. One sentence each, addressed to a rider.
 *
 * ⚠️ **A function of the rider's units rather than a constant, since #238.**
 * Only one of these sentences names a distance — `tooShort` quotes the minimum
 * segment length — but that one is a distance the client renders, so it
 * follows the preference like every other. The rest are returned unchanged and
 * are here so that a caller has one place to get a refusal from rather than
 * two.
 */
export function segmentRefusals(units: UnitSystem): Readonly<Record<SegmentRefusalReason, string>> {
  return {
    ...SEGMENT_REFUSAL_TEXT,
    tooShort:
      `A segment has to be at least ` +
      `${measurementText(formatSmallDistance(MINIMUM_SEGMENT_LENGTH_METRES, units))} long. ` +
      'Below that, the error in locating each end is a large part of the time, and the board ' +
      'would be ranking receivers rather than riders.',
  };
}

/** The sentences that do not depend on the rider's units. @see segmentRefusals */
const SEGMENT_REFUSAL_TEXT = {
  notYours:
    'That ride is not one of yours, so there is nothing here to cut a segment from. ' +
    'Segments are made from your own rides.',
  noTrack:
    'That ride has no position data, so there is no road to name. An indoor ride is ' +
    'recorded without one, which is normal and is not a fault.',
  spanEmpty: 'Choose a stretch of the ride to make a segment from.',
  tooFewPositions:
    `A segment needs at least ${String(MINIMUM_SEGMENT_POSITIONS)} recorded positions. ` +
    'The stretch you chose has fewer, which usually means the receiver lost its fix there.',
  /** Replaced by {@link segmentRefusals}, which is the only reader of this one. */
  tooShort: '',
  noDirection:
    'That stretch does not go anywhere — every position in it is the same place. A segment ' +
    'needs a direction of travel.',
  unnamed: 'Give the segment a name.',
} as const;

/** What was noticed about a segment that is still going to be created. */
export const SEGMENT_NOTE = {
  /** Criterion 3. */
  nearDuplicate:
    'This runs along a segment you already have, so it has been saved as private. Both are ' +
    'kept — the earlier one is not touched.',
  /** Criterion 4. */
  insidePrivacyZone:
    'One end of this segment is inside a privacy zone, so it has been saved as private. ' +
    'A public segment start is a published address.',
} as const;

export type SegmentRefusalReason = keyof typeof SEGMENT_REFUSAL_TEXT;

/** An existing segment this one runs along, and how much of it does. */
export interface SegmentOverlap {
  readonly id: string;
  readonly name: string;
  /** In `[0, 1]`. @see overlapFraction */
  readonly fraction: number;
}

/** What {@link segmentDecision} decided. */
export type SegmentDecision =
  | { readonly kind: 'refused'; readonly reason: SegmentRefusalReason; readonly message: string }
  | {
      readonly kind: 'create';
      readonly record: SegmentRecord;
      /**
       * Every existing segment the candidate runs along, **including ones below
       * the near-duplicate threshold**.
       *
       * Criterion 3 asks that duplicate detection *surface* overlapping
       * segments, which is a wider ask than "block a duplicate": a rider
       * looking at a 40% overlap is being told something useful about the road,
       * and only the ones at or above {@link NEAR_DUPLICATE_OVERLAP} change the
       * visibility.
       */
      readonly overlaps: readonly SegmentOverlap[];
      /** What was downgraded and why. Empty when nothing was. */
      readonly notes: readonly string[];
    };

/** Everything {@link segmentDecision} needs. All data; it reads nothing. */
export interface SegmentDecisionInput {
  readonly id: string;
  readonly owner: AthleteId;
  readonly name: string;
  /** The span the rider chose, already cut out of the ride's stream. */
  readonly geometry: readonly GeographicPosition[];
  /** Altitudes matching `geometry` index for index, where the ride had them. */
  readonly altitudes?: readonly number[];
  readonly requestedVisibility: SegmentVisibility;
  readonly privacyZones: readonly PrivacyZoneRecord[];
  readonly existing: readonly SegmentRecord[];
  readonly createdAt: UnixSeconds;
  /**
   * Which units a refusal quotes a length in (#238).
   *
   * An ordinary field rather than a React context, because this module is
   * pure. Optional, defaulting to metric, so a caller with no preference to
   * hand on gets what a rider who has never chosen sees.
   */
  readonly units?: UnitSystem | undefined;
}

/**
 * Decides whether a segment may be created, and what it looks like if so.
 *
 * Pure. Every refusal names the constraint in a sentence a rider can act on,
 * and **no message names a coordinate value** — ADR 0004 decision D, which
 * binds every layer that formats a coordinate into a string, and a refusal
 * shown on screen is exactly such a layer.
 */
export function segmentDecision(input: SegmentDecisionInput): SegmentDecision {
  const refused = (reason: SegmentRefusalReason): SegmentDecision => ({
    kind: 'refused',
    reason,
    message: segmentRefusals(input.units ?? 'metric')[reason],
  });
  if (input.name.trim().length === 0) {
    return refused('unnamed');
  }
  if (input.geometry.length === 0) {
    return refused('spanEmpty');
  }
  if (input.geometry.length < MINIMUM_SEGMENT_POSITIONS) {
    return refused('tooFewPositions');
  }
  // Checked here as well as inside `createSegment`, so the rider gets this
  // sentence rather than the domain's constraint message. The domain's check is
  // not removed: it is what protects every other caller, #7's instance
  // included.
  if (pathLength(input.geometry) < MINIMUM_SEGMENT_LENGTH_METRES) {
    return refused('tooShort');
  }

  const notes: string[] = [];
  let visibility = input.requestedVisibility;

  // Criterion 4. Checked on both endpoints, because both are published: a
  // segment's finish is as much a place as its start, and a rider whose ride
  // ends at their front door is the case this exists for.
  if (visibility !== 'private' && endpointsInsideAZone(input.geometry, input.privacyZones)) {
    visibility = 'private';
    notes.push(SEGMENT_NOTE.insidePrivacyZone);
  }

  // Criterion 3. Every overlap is reported; only a near-duplicate downgrades.
  const overlaps = overlapsWith(input.geometry, input.existing);
  const duplicate = overlaps.some((overlap) => overlap.fraction >= NEAR_DUPLICATE_OVERLAP);
  if (duplicate && visibility !== 'private') {
    visibility = 'private';
    notes.push(SEGMENT_NOTE.nearDuplicate);
  } else if (duplicate) {
    // Already private for another reason, or requested private. The rider is
    // still told, because "you already have this climb" is worth knowing
    // whether or not it changed anything.
    notes.push(SEGMENT_NOTE.nearDuplicate);
  }

  let built;
  try {
    built = createSegment({
      id: input.id,
      createdBy: input.owner,
      name: input.name.trim(),
      sport: 'ride',
      geometry: input.geometry,
      ...(input.altitudes === undefined ? {} : { altitudes: input.altitudes }),
      elevationSource: input.altitudes === undefined ? 'none' : 'device',
      visibility,
      createdAt: input.createdAt,
    });
  } catch (error) {
    // The only refusal `createSegment` can still raise past the guards above is
    // a geometry with no direction of travel — every position identical, which
    // has a non-zero path length only when the positions differ. Anything else
    // is a bug here rather than a rider's mistake, so it is rethrown.
    if (error instanceof UnitError) {
      return refused('noDirection');
    }
    throw error;
  }

  return {
    kind: 'create',
    record: { ...built, id: segmentId(built.id), createdBy: athleteId(built.createdBy) },
    overlaps,
    notes,
  };
}

/** Whether either end of the path is inside any of the athlete's zones. */
function endpointsInsideAZone(
  geometry: readonly GeographicPosition[],
  zones: readonly PrivacyZoneRecord[],
): boolean {
  const ends = [geometry[0], geometry[geometry.length - 1]];
  for (const end of ends) {
    if (end === undefined) {
      continue;
    }
    for (const zone of zones) {
      // The true radius, not the jittered one `detail/privacy.ts` uses. That
      // jitter exists to stop an observer averaging an emitted radius out of
      // many rides; here nothing is emitted and the question is only "is this
      // the rider's home", so the honest radius is the right one — and a
      // jittered one would sometimes let a start inside a zone through.
      if (distanceBetween(zone.centre, end) <= zone.radius) {
        return true;
      }
    }
  }
  return false;
}

/** Every existing segment the candidate runs along, most overlapping first. */
function overlapsWith(
  geometry: readonly GeographicPosition[],
  existing: readonly SegmentRecord[],
): SegmentOverlap[] {
  const found: SegmentOverlap[] = [];
  for (const segment of existing) {
    const fraction = overlapFraction(geometry, segment.geometry, OVERLAP_TOLERANCE_METRES);
    if (fraction > 0) {
      found.push({ id: segment.id, name: segment.name, fraction });
    }
  }
  return found.sort((a, b) => b.fraction - a.fraction);
}

/** What {@link readSpan} found in a ride. */
export interface RideSpan {
  readonly geometry: readonly GeographicPosition[];
  /** Present only when the ride had an altitude channel over the whole span. */
  readonly altitudes?: readonly number[];
}

/**
 * Reads one contiguous span of a ride's track, athlete-scoped.
 *
 * ⚠️ **Positions with a gap in either coordinate are dropped, not
 * interpolated.** The gap rule this program has restated at every layer since
 * `analysis/power-duration.ts`: a missing sample contributes nothing and is
 * never invented. Interpolating here would put a coordinate the receiver never
 * reported into a stored segment's geometry — which is a fabricated position in
 * a record that outlives the ride it came from.
 *
 * ⚠️ **Altitudes are carried only when every kept position has one.** A partial
 * altitude channel would give `createSegment` an array that does not match the
 * geometry index for index, and the honest answer to "some of this climb was
 * measured" is `elevationSource: 'none'` rather than a gain computed from the
 * half that was.
 *
 * @returns `undefined` when the ride is not this athlete's or has no track at
 * all — the two are deliberately not distinguished here, and `create.ts`'s
 * caller separates them by asking whether the activity itself was readable.
 */
export async function readSpan(
  port: SegmentPort,
  activity: ActivityId,
  from: number,
  to: number,
): Promise<RideSpan | undefined> {
  const [latitudes, longitudes] = await Promise.all([
    port.store.getStreamChannel(port.athleteId, activity, 'latitude'),
    port.store.getStreamChannel(port.athleteId, activity, 'longitude'),
  ]);
  if (latitudes === undefined || longitudes === undefined) {
    return undefined;
  }

  const start = Math.max(0, Math.floor(from));
  // Bounded, for `transfer/read-activity-file.ts`'s reason: the span comes from
  // a caller and a four-hour ride at 1 Hz is 14 400 samples, so an unbounded
  // one is a request the memory cost of which nobody has stated.
  const end = Math.min(latitudes.length, Math.floor(to), start + MAXIMUM_SPAN_SAMPLES);

  const altitudes = await port.store.getStreamChannel(port.athleteId, activity, 'altitude');

  const geometry: GeographicPosition[] = [];
  const kept: number[] = [];
  let everyKeptHasAltitude = altitudes !== undefined;

  for (let index = start; index < end; index += 1) {
    const latitude = latitudes[index];
    const longitude = longitudes[index];
    if (latitude === undefined || longitude === undefined) {
      continue;
    }
    geometry.push(geographicPosition(latitude, longitude));
    const altitude = altitudes?.[index];
    if (altitude === undefined) {
      everyKeptHasAltitude = false;
    } else {
      kept.push(altitude);
    }
  }

  return everyKeptHasAltitude && kept.length === geometry.length
    ? { geometry, altitudes: kept }
    : { geometry };
}

/** What {@link createSegmentFromRide} did. */
export type SegmentCreation =
  | { readonly kind: 'refused'; readonly reason: SegmentRefusalReason; readonly message: string }
  | {
      readonly kind: 'created';
      readonly record: SegmentRecord;
      readonly overlaps: readonly SegmentOverlap[];
      readonly notes: readonly string[];
    };

/**
 * Cuts a span out of one of the athlete's own rides, decides, and writes.
 *
 * The order is load-bearing. The activity is read **first**, athlete-scoped, so
 * criterion 1 is answered before any stream is touched: a request naming
 * somebody else's ride costs one indexed miss rather than three channel
 * decodes.
 */
export async function createSegmentFromRide(
  port: SegmentPort,
  request: {
    readonly id: string;
    readonly activityId: ActivityId;
    readonly name: string;
    readonly from: number;
    readonly to: number;
    readonly requestedVisibility: SegmentVisibility;
    readonly createdAt: UnixSeconds;
    /** Which units a refusal quotes a length in. @see SegmentDecisionInput.units */
    readonly units?: UnitSystem | undefined;
  },
): Promise<SegmentCreation> {
  const refusals = segmentRefusals(request.units ?? 'metric');
  const activity = await port.store.getActivity(port.athleteId, request.activityId);
  if (activity === undefined) {
    return { kind: 'refused', reason: 'notYours', message: refusals.notYours };
  }
  if (!activity.hasPosition) {
    // Answered from the summary rather than by decoding two channels and
    // finding them empty. `hasPosition` is the one bit #26 stores for exactly
    // this kind of question.
    return { kind: 'refused', reason: 'noTrack', message: refusals.noTrack };
  }

  const span = await readSpan(port, request.activityId, request.from, request.to);
  if (span === undefined) {
    return { kind: 'refused', reason: 'noTrack', message: refusals.noTrack };
  }

  const [privacyZones, existing] = await Promise.all([
    port.store.listPrivacyZones(port.athleteId),
    port.store.listSegments(port.athleteId, DUPLICATE_SCAN_LIMIT),
  ]);

  const decision = segmentDecision({
    id: request.id,
    owner: port.athleteId,
    name: request.name,
    geometry: span.geometry,
    ...(span.altitudes === undefined ? {} : { altitudes: span.altitudes }),
    requestedVisibility: request.requestedVisibility,
    privacyZones,
    existing,
    createdAt: request.createdAt,
    ...(request.units === undefined ? {} : { units: request.units }),
  });

  if (decision.kind === 'refused') {
    return decision;
  }

  await port.store.putSegment(decision.record);
  return {
    kind: 'created',
    record: decision.record,
    overlaps: decision.overlaps,
    notes: decision.notes,
  };
}
