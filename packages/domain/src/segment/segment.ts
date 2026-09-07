// SPDX-License-Identifier: Apache-2.0

/**
 * The segment model (#64) — a named stretch of road, and the geometry that
 * decides whether a ride went along it.
 *
 * Here rather than in `apps/web` for the reason every other analysis module is
 * here: the judgement "did this effort start at this segment's start" is made on
 * the device today and, from Phase 4 (#7), on an instance ranking the same
 * effort. Two implementations of it are two places for a board and a rider's own
 * screen to disagree about whether an effort happened.
 *
 * ## Two constraints bind this file before any of the geometry does
 *
 * ### 1. No oriented virtual start line — ADR 0007 D-2.1
 *
 * US 9,116,922 (Strava, filed 2011-03-31, granted 2015-08-25) turns in all four
 * independent claims on **generating an oriented "virtual start line" from a
 * user-selected start point**: computing a path through the point, taking its
 * orientation, and setting a line in relation to that orientation. #64's sixth
 * acceptance criterion is that this model stores no such thing.
 *
 * **It does not, and the alternative is one sentence:** an endpoint is a
 * position, a direction of travel and a tolerance radius, and the test is
 * **proximity plus direction agreement** — is the sample within the radius, and
 * is its own direction of travel within the angular tolerance of the endpoint's.
 * See {@link endpointReached}. There is no line, nothing is oriented in relation
 * to a line, and no crossing is computed.
 *
 * ⚠️ **Two more rules from the same ADR reach this file's neighbours**, and are
 * repeated here because this is where somebody would try to add them:
 *
 * - **D-2.2 — no extrapolation between samples.** If two consecutive samples
 *   straddle an endpoint, that is a fact about the samples. Synthesising an
 *   intermediate point in order to declare a crossing is the thing to avoid, and
 *   it is exactly what a reader who wants "more accurate" endpoint timing will
 *   reach for. {@link endpointReached} takes one sample at a time and has
 *   nowhere to put an interpolation.
 * - **D-2.4 — no automatic redundancy discard.** {@link overlapFraction} exists
 *   to *surface* an overlap, never to delete the earlier segment. #64's third
 *   criterion forces a near-duplicate to `private`; it does not remove anything.
 *
 * ### 2. No OSM geometry — ADR 0012 D-1
 *
 * A segment's geometry is a **copy of a span of the creating athlete's own
 * recorded activity**. No coordinate here is snapped to, interpolated onto or
 * copied from an OpenStreetMap way, and **no OSM identifier is stored on a
 * segment** — no way id, no node id, no edge id. That is what keeps the segment
 * corpus from being a Derivative Database under ODbL 1.0 §4.4, which is the
 * question ADR 0001 deferred and ADR 0012 answers.
 *
 * ⚠️ **Adding an OSM way id to {@link Segment} is the single change that
 * reverses that**, and it would arrive looking like a matcher optimisation.
 * ADR 0012 D-3 says where such data goes instead: its own store, licensed ODbL,
 * beside a segment record that keeps its own-trace geometry.
 */

import { bearingDifference, distanceBetween, initialBearing } from '../geodesy';
import { metres } from '../quantities';
import { UnitError } from '../unit-error';

import type {
  DegreesBearing,
  GeographicPosition,
  GradePercent,
  Metres,
  UnixSeconds,
} from '../quantities';

// --- What a segment is for ---------------------------------------------------

/**
 * The sport a segment is scoped to.
 *
 * #64: "Segments are sport-scoped; a rider must not appear on a runner's board."
 * A union rather than a free string, so a typo produces a board nobody is on
 * rather than a second board with the same name.
 *
 * Only two values today, and `'ride'` is the only one Phase 1 records. `'run'`
 * is here because the *scoping* is the decision and it is worth nothing if it
 * cannot express a second sport — not because this project records runs.
 */
export type SegmentSport = 'ride' | 'run';

/**
 * Where a segment's elevation numbers came from.
 *
 * #64: "Two segments compared with different DEMs are not comparable." This is
 * the field that lets a reader see that before they compare, and it is stored
 * rather than assumed because the answer changes: a barometric altimeter on the
 * bike and a Copernicus DEM lookup disagree by metres, systematically, and the
 * disagreement lands entirely in the elevation gain.
 *
 * - `'device'` — the recording device's own altitude channel, barometric or
 *   GNSS. What Phase 1 has, because there is no DEM lookup yet (#72).
 * - `'dem'` — a digital elevation model sampled at the segment's coordinates.
 *   ADR 0010 D-5 names Copernicus, whose attribution obligation travels with it.
 * - `'none'` — the source activity carried no altitude at all, so the gain is
 *   unknown. **Not zero.** A flat segment and an unmeasured one are different
 *   claims, and {@link Segment.elevationGain} is `undefined` here rather than 0.
 */
export type ElevationSource = 'device' | 'dem' | 'none';

/**
 * Who may see a segment.
 *
 * **The same three values ADR 0004 decision A gives an activity**, in the same
 * order, and deliberately not the two #64's field table abbreviates them to.
 * Two visibility vocabularies in one program is how a `followers` segment ends
 * up rendered by a check written for a two-state enum, and `followers` is inert
 * until #79 either way — so the cost of carrying it now is nothing and the cost
 * of adding it later is a migration over every segment an athlete owns. That is
 * the same argument ADR 0004 makes for the field existing at all in a phase
 * with no sharing.
 *
 * `packages/store` types `SegmentRecord.visibility` as its own `Visibility` and
 * a compile-time check there asserts the two unions have not drifted.
 *
 * ADR 0004's default is `private`, and #64's fourth criterion makes one case
 * unconditional: a segment whose endpoints fall inside a privacy zone cannot be
 * created `public`, because a public segment start is a published address. That
 * check needs the athlete's zones and therefore lives with the caller; this
 * type is what it decides between.
 */
export type SegmentVisibility = 'private' | 'followers' | 'public';

// --- The endpoint, which is where the patent constraint lands ---------------

/**
 * One end of a segment: **a position, a direction, and a radius.**
 *
 * Read the file header before changing this shape. There is deliberately no
 * line, no plane, no half-space and no orientation-relative-to-anything here;
 * those are the constructs ADR 0007 D-2.1 forbids, and the absence is the whole
 * design.
 */
export interface SegmentEndpoint {
  /** Where the segment starts or ends, from the creating athlete's own trace. */
  readonly position: GeographicPosition;
  /**
   * The direction of travel **through** this endpoint, in degrees clockwise
   * from true north.
   *
   * Computed from two consecutive positions in the source trace, so it is a
   * measurement rather than a user choice. It is what makes the same stretch of
   * road two different segments in the two directions, which is what a rider
   * expects — a climb and its descent are not the same effort.
   */
  readonly bearing: DegreesBearing;
  /**
   * How close a sample must be to count as having reached this endpoint.
   *
   * Per endpoint rather than global, because the right value is a property of
   * the road: a segment ending at a roundabout needs more slack than one on a
   * straight. {@link DEFAULT_ENDPOINT_RADIUS_METRES} is what creation proposes.
   */
  readonly radius: Metres;
}

/**
 * The default endpoint tolerance radius: **15 metres**.
 *
 * Chosen against consumer GNSS horizontal accuracy rather than against a
 * competitor's number, and the reasoning is the same one
 * {@link MINIMUM_SEGMENT_LENGTH_METRES} rests on. A consumer receiver's
 * horizontal error is commonly quoted at 3–5 m under open sky and degrades
 * badly under tree cover and beside buildings; 15 m is roughly three times the
 * open-sky figure, which admits an ordinary bad fix without admitting the next
 * street over.
 *
 * ⚠️ **It is a tolerance, not an accuracy claim.** Too small and a rider with a
 * poor fix gets no effort recorded and has no way to know why; too large and
 * two parallel roads share an endpoint. There is no published figure to copy
 * here and this is our tunable, exactly as #64 says of the minimum length.
 */
export const DEFAULT_ENDPOINT_RADIUS_METRES = 15;

/**
 * The default direction-agreement tolerance: **60 degrees**.
 *
 * Deliberately loose. Its job is to reject **travelling the other way** — which
 * is 180° off and nowhere near this threshold — not to check that a rider held
 * a line. A tight angular tolerance fails an honest effort that clipped the
 * endpoint on a curve, and the failure is invisible: the rider simply has no
 * effort and no explanation.
 *
 * 60° admits anything within a third of a turn of the recorded direction and
 * rejects the whole rear half-plane with 30° to spare. The bearing itself is
 * derived from two GNSS samples metres apart, which is a noisy estimator at low
 * speed, and that noise is the real reason this is not 20°.
 */
export const DEFAULT_BEARING_TOLERANCE_DEGREES = 60;

// --- The minimum length, which #64 asks to be justified ---------------------

/**
 * The shortest segment this model will create: **400 metres**.
 *
 * #64's fifth criterion asks for a stated minimum *and* for the value to be
 * justified in the PR, and notes that **there is no published parity figure to
 * copy** — so this is derived rather than borrowed.
 *
 * **The derivation.** The failure being prevented is that endpoint error
 * dominates the measured time. An endpoint is located to within
 * {@link DEFAULT_ENDPOINT_RADIUS_METRES} (15 m), so a segment's *measured*
 * length carries up to about 30 m of combined endpoint uncertainty. Requiring
 * that to be no more than about 7.5% of the segment gives 400 m. At 30 km/h
 * that is a 48-second effort with roughly ±3.6 s of endpoint noise in it — the
 * point at which a leaderboard starts ranking receivers rather than riders.
 *
 * **The recording interval is the other half, and it is the worse one.** #64
 * says it directly: "at a 5–10 s recording interval, endpoint error is a large
 * fraction of a 30-second effort". A device recording every 10 s at 30 km/h
 * places samples 83 m apart, so a 400 m segment is only about five samples long
 * and its endpoints can each be a full sample away from the true crossing.
 * ⚠️ **And that error cannot be removed by interpolating**, because ADR 0007
 * D-2.2 forbids synthesising a point to declare a crossing. So the interval is a
 * floor on achievable accuracy, not a thing to engineer around — which is an
 * argument for a *longer* minimum, not a shorter one.
 *
 * **Why not longer.** 400 m keeps a town-centre sprint and a short steep climb
 * expressible, and those are real segments people want. Above roughly a
 * kilometre the model would only describe rides, which the activity library
 * already does.
 *
 * ⚠️ **This is a tunable and it will be revisited with data.** It is stated
 * here, in one place, with its reasoning attached, so that revisiting it is a
 * decision somebody makes rather than a constant somebody edits.
 */
export const MINIMUM_SEGMENT_LENGTH_METRES = 400;

/**
 * The fewest positions a segment's geometry may carry: **three**.
 *
 * Two points describe a straight line between them and nothing about the road,
 * so a two-point "geometry" would make {@link overlapFraction} compare chords
 * rather than paths. Three is the smallest number that can bend.
 */
export const MINIMUM_SEGMENT_POSITIONS = 3;

// --- The record --------------------------------------------------------------

/**
 * A segment: a named stretch of road with a direction, against which efforts
 * are timed.
 *
 * Every field #64's table calls non-optional is here and required, except the
 * two elevation numbers — which are optional because `'none'` is a real
 * {@link ElevationSource} and an unmeasured gain must not read as a flat road.
 *
 * ⚠️ **`id` and `createdBy` are plain strings here and are branded in
 * `packages/store`.** This package cannot name `SegmentId` or `AthleteId`
 * without depending on the store, and the dependency points the other way. The
 * store's `SegmentRecord` re-declares them with its own brands and is the type
 * anything persisting a segment should use.
 */
export interface Segment {
  readonly id: string;
  /** The athlete who created it. Ownership, and #64's moderation hook. */
  readonly createdBy: string;
  readonly name: string;
  readonly sport: SegmentSport;

  /**
   * The path, as an ordered list of positions **in the direction of travel**.
   *
   * A copy of a span of the creator's own activity, never a reference into it
   * (#64's second criterion) and never OSM geometry (ADR 0012 D-1). Ordered, so
   * reversing it is a different segment rather than the same one read backwards.
   */
  readonly geometry: readonly GeographicPosition[];

  readonly start: SegmentEndpoint;
  readonly end: SegmentEndpoint;

  /**
   * How far apart two bearings may be and still count as the same direction.
   *
   * Stored on the segment rather than applied as a global constant, so that
   * changing the default later does not silently re-decide every effort ever
   * recorded against every existing segment.
   */
  readonly bearingToleranceDegrees: number;

  /** Path length along {@link geometry}, not the straight line end to end. */
  readonly distance: Metres;

  /** Sum of the positive altitude changes. `undefined` when unmeasured. */
  readonly elevationGain?: Metres;
  /** Mean grade over the whole segment. `undefined` when unmeasured. */
  readonly averageGrade?: GradePercent;
  /** Steepest grade between two consecutive positions. `undefined` likewise. */
  readonly maximumGrade?: GradePercent;

  readonly elevationSource: ElevationSource;
  /**
   * The horizontal resolution of the elevation source, in metres.
   *
   * `undefined` for `'device'` — a barometric altimeter has no horizontal
   * resolution — and, for a DEM, the grid spacing: Copernicus GLO-30 is
   * nominally 30 m. Two segments whose sources differ *or* whose resolutions
   * differ are not comparable, which is why both are stored.
   */
  readonly elevationResolutionMetres?: number;

  readonly visibility: SegmentVisibility;

  /**
   * When the segment was created.
   *
   * #64: "Efforts before a segment existed must be excludable from
   * rolling-window rankings. Backfilling them silently changes what a '90-day'
   * board means." This field is what makes that exclusion expressible; #68's
   * boards decide whether to apply it.
   */
  readonly createdAt: UnixSeconds;
}

// --- Geometry ----------------------------------------------------------------

/**
 * Path length along an ordered list of positions.
 *
 * Sums the great-circle distance between consecutive pairs — the length of the
 * road as recorded, not the straight line from the first point to the last. The
 * difference is the whole point on anything that bends.
 *
 * @returns 0 for fewer than two positions, which is the honest answer: a single
 * point has no length.
 */
export function pathLength(positions: readonly GeographicPosition[]): Metres {
  let total = 0;
  for (let index = 1; index < positions.length; index += 1) {
    const previous = positions[index - 1];
    const current = positions[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    total += distanceBetween(previous, current);
  }
  return metres(total);
}

/**
 * The direction of travel at the **start** of a path.
 *
 * Taken from the first pair of *distinct* positions rather than from
 * `positions[0]` and `positions[1]`, because a stationary rider at a traffic
 * light produces a run of identical samples and the naive pair is degenerate.
 * Scanning forward is what makes a segment starting from a standstill have a
 * direction at all.
 *
 * @returns `undefined` when every position is identical, which is a path with
 * no direction rather than one pointing north.
 */
export function startBearing(positions: readonly GeographicPosition[]): DegreesBearing | undefined {
  const first = positions[0];
  if (first === undefined) {
    return undefined;
  }
  for (let index = 1; index < positions.length; index += 1) {
    const next = positions[index];
    if (next === undefined) {
      continue;
    }
    const bearing = initialBearing(first, next);
    if (bearing !== undefined) {
      return bearing;
    }
  }
  return undefined;
}

/**
 * The direction of travel at the **end** of a path.
 *
 * Scans backwards from the last position for the same reason
 * {@link startBearing} scans forwards, and the direction is still *into* the
 * final point — `initialBearing(earlier, last)`, never the reverse. Getting
 * that backwards would store an end bearing pointing the way the rider came
 * from, and every effort would then fail direction agreement at the finish
 * while passing it at the start.
 */
export function endBearing(positions: readonly GeographicPosition[]): DegreesBearing | undefined {
  const last = positions[positions.length - 1];
  if (last === undefined) {
    return undefined;
  }
  for (let index = positions.length - 2; index >= 0; index -= 1) {
    const earlier = positions[index];
    if (earlier === undefined) {
      continue;
    }
    const bearing = initialBearing(earlier, last);
    if (bearing !== undefined) {
      return bearing;
    }
  }
  return undefined;
}

/**
 * Whether a sample has reached an endpoint: **proximity and direction
 * agreement.**
 *
 * This is #64's sixth criterion in its operative form, and the sentence the PR
 * owes: *a sample reaches an endpoint when it lies within the endpoint's
 * tolerance radius **and** its own direction of travel is within the angular
 * tolerance of the endpoint's recorded direction.* Two scalar comparisons.
 *
 * ⚠️ **There is no line here and there must not be one.** Not a virtual start
 * line, not an oriented one, not a perpendicular through the endpoint, not a
 * half-space test, not a sign change of a dot product. ADR 0007 D-2.1 forbids
 * the construct that US 9,116,922's four independent claims are built on, and
 * "we compute a perpendicular and test which side of it the rider is" is that
 * construct however it is spelled.
 *
 * ⚠️ **And no extrapolation** (ADR 0007 D-2.2). This takes **one** sample. It
 * is not given the previous one and cannot interpolate between them to find a
 * more precise crossing instant. That costs accuracy at long recording
 * intervals — see {@link MINIMUM_SEGMENT_LENGTH_METRES} — and the cost is
 * accepted rather than engineered around.
 *
 * @param heading the sample's own direction of travel. `undefined` where it
 * cannot be established — a stationary rider, or the very first sample of a
 * ride — and the endpoint is then **not** reached: an unknown direction is not
 * an agreeing one, and the alternative would let a rider standing at a segment
 * start collect an effort in either direction.
 */
export function endpointReached(
  endpoint: SegmentEndpoint,
  position: GeographicPosition,
  heading: DegreesBearing | undefined,
  bearingToleranceDegrees: number,
): boolean {
  if (heading === undefined) {
    return false;
  }
  if (distanceBetween(endpoint.position, position) > endpoint.radius) {
    return false;
  }
  return bearingDifference(endpoint.bearing, heading) <= bearingToleranceDegrees;
}

// --- Overlap, for #64's duplicate detection ---------------------------------

/**
 * What fraction of `candidate` runs close to `existing`, in `[0, 1]`.
 *
 * #64's third criterion: duplicate detection runs at creation and surfaces
 * overlapping existing segments. This is the measure it surfaces them by.
 *
 * **How it is measured.** Each position of `candidate` counts as covered when
 * it lies within `toleranceMetres` of *any* position of `existing`; the result
 * is the covered fraction. That is a deliberately simple and deliberately
 * *symmetric-in-spirit* test — it does not care about direction, because a
 * climb and its descent share a road and a rider creating the reverse of an
 * existing segment should be told so.
 *
 * ⚠️ **It is quadratic in the position counts**, and that is a real bound
 * rather than an oversight: creation compares one candidate against the
 * athlete's own existing segments, which is a small number, and the geometry is
 * downsampled before it is stored. It is not suitable for scanning a corpus and
 * #66 will not use it for that.
 *
 * ⚠️ **This function never deletes anything and nothing built on it may**
 * (ADR 0007 D-2.4). A high overlap forces the new segment `private`; the
 * existing one is untouched. Deduplication by deletion silently orphans the
 * earlier segment's efforts, and ADR 0002 makes the athlete's own record the
 * source of truth.
 *
 * @returns 0 when either path is empty — no overlap rather than a division by
 * zero, and the caller reads it as "not a duplicate", which is correct.
 */
export function overlapFraction(
  candidate: readonly GeographicPosition[],
  existing: readonly GeographicPosition[],
  toleranceMetres: number,
): number {
  if (candidate.length === 0 || existing.length === 0) {
    return 0;
  }
  let covered = 0;
  for (const point of candidate) {
    for (const other of existing) {
      if (distanceBetween(point, other) <= toleranceMetres) {
        covered += 1;
        break;
      }
    }
  }
  return covered / candidate.length;
}

/**
 * How much of a candidate must run along an existing segment before it counts
 * as a near-duplicate: **80%**.
 *
 * Not 100%: a rider who creates "the climb, plus the last 200 m of the approach"
 * has made a near-duplicate in every sense that matters to a leaderboard, and
 * an exact-match threshold would let fourteen versions of one climb through —
 * which is the failure #64's third criterion names.
 *
 * Not 50% either: two segments that share half their length are frequently two
 * genuinely different efforts on a shared road, and forcing those private would
 * make the feature useless in a town.
 */
export const NEAR_DUPLICATE_OVERLAP = 0.8;

/**
 * How close two positions must be to count as the same place, for overlap:
 * **25 metres**.
 *
 * Wider than {@link DEFAULT_ENDPOINT_RADIUS_METRES}, deliberately. An endpoint
 * radius decides whether an effort counts and wants to be tight; this decides
 * whether to *warn somebody*, and a warning that misses is worse than one that
 * is slightly eager. 25 m is narrow enough to tell apart a road and the
 * cycleway beside it in most places, which is the case that would otherwise
 * produce a false duplicate.
 */
export const OVERLAP_TOLERANCE_METRES = 25;

// --- Construction ------------------------------------------------------------

/** Everything {@link createSegment} needs that it cannot derive from geometry. */
export interface SegmentDraft {
  readonly id: string;
  readonly createdBy: string;
  readonly name: string;
  readonly sport: SegmentSport;
  readonly geometry: readonly GeographicPosition[];
  /** Altitudes matching `geometry` index for index, where the source has them. */
  readonly altitudes?: readonly number[];
  readonly elevationSource: ElevationSource;
  readonly elevationResolutionMetres?: number;
  readonly visibility: SegmentVisibility;
  readonly createdAt: UnixSeconds;
  /** Overrides {@link DEFAULT_ENDPOINT_RADIUS_METRES} when the road needs it. */
  readonly endpointRadiusMetres?: number;
  /** Overrides {@link DEFAULT_BEARING_TOLERANCE_DEGREES}. */
  readonly bearingToleranceDegrees?: number;
}

/**
 * Build a {@link Segment} from a draft, deriving everything derivable.
 *
 * The distance, both bearings, the elevation gain and the two grades are
 * **computed here from the geometry**, never taken from the caller. A caller
 * that could supply its own distance is a caller that can supply one that
 * disagrees with the path, and a leaderboard sorted by a distance nobody
 * measured is worse than no leaderboard.
 *
 * @throws {UnitError} naming the constraint, for a geometry too short to be a
 * segment, one with fewer than {@link MINIMUM_SEGMENT_POSITIONS} positions, one
 * whose positions are all identical, or an altitude array that does not match
 * the geometry.
 *
 * ⚠️ **None of those messages names a coordinate value**, per ADR 0004
 * decision D: a message about a coordinate names the field and the constraint
 * and never the value, because the value continues past the `throw` into a log
 * line the throw site does not control. The *lengths* and the *minimum* are
 * named, because for those the number is the diagnostic.
 */
export function createSegment(draft: SegmentDraft): Segment {
  const { geometry, altitudes } = draft;

  if (geometry.length < MINIMUM_SEGMENT_POSITIONS) {
    throw new UnitError(
      `a segment needs at least ${String(MINIMUM_SEGMENT_POSITIONS)} positions, and this has ` +
        `${String(geometry.length)}`,
    );
  }
  if (altitudes !== undefined && altitudes.length !== geometry.length) {
    throw new UnitError(
      `altitudes must match the geometry position for position: ${String(altitudes.length)} ` +
        `altitudes for ${String(geometry.length)} positions`,
    );
  }

  const distance = pathLength(geometry);
  if (distance < MINIMUM_SEGMENT_LENGTH_METRES) {
    throw new UnitError(
      `a segment must be at least ${String(MINIMUM_SEGMENT_LENGTH_METRES)} m long, and this one ` +
        `is ${distance.toFixed(1)} m`,
    );
  }

  const start = startBearing(geometry);
  const end = endBearing(geometry);
  if (start === undefined || end === undefined) {
    // Reachable only from a geometry whose positions are all identical — which
    // `pathLength` would already have rejected as zero-length — or from one
    // holding a non-finite coordinate that slipped past `distanceBetween`'s
    // guards. Kept as a real branch rather than a non-null assertion, because
    // the assertion would turn a corrupt row into a bearing of `undefined`
    // stored on a segment and read as north.
    throw new UnitError('a segment needs two distinct positions to have a direction of travel');
  }

  const firstPosition = geometry[0];
  const lastPosition = geometry[geometry.length - 1];
  if (firstPosition === undefined || lastPosition === undefined) {
    throw new UnitError('a segment needs a first and a last position');
  }

  const radius = metres(draft.endpointRadiusMetres ?? DEFAULT_ENDPOINT_RADIUS_METRES);
  const elevation = elevationOf(geometry, altitudes, distance);

  return {
    id: draft.id,
    createdBy: draft.createdBy,
    name: draft.name,
    sport: draft.sport,
    geometry: [...geometry],
    start: { position: firstPosition, bearing: start, radius },
    end: { position: lastPosition, bearing: end, radius },
    bearingToleranceDegrees: draft.bearingToleranceDegrees ?? DEFAULT_BEARING_TOLERANCE_DEGREES,
    distance,
    ...elevation,
    elevationSource: draft.elevationSource,
    ...(draft.elevationResolutionMetres === undefined
      ? {}
      : { elevationResolutionMetres: draft.elevationResolutionMetres }),
    visibility: draft.visibility,
    createdAt: draft.createdAt,
  };
}

/** The three elevation-derived fields, or none of them. */
function elevationOf(
  geometry: readonly GeographicPosition[],
  altitudes: readonly number[] | undefined,
  distance: Metres,
): Pick<Segment, 'elevationGain' | 'averageGrade' | 'maximumGrade'> {
  if (altitudes === undefined) {
    return {};
  }

  let gain = 0;
  let steepest = Number.NEGATIVE_INFINITY;

  for (let index = 1; index < altitudes.length; index += 1) {
    const previous = altitudes[index - 1];
    const current = altitudes[index];
    const from = geometry[index - 1];
    const to = geometry[index];
    if (
      previous === undefined ||
      current === undefined ||
      from === undefined ||
      to === undefined ||
      !Number.isFinite(previous) ||
      !Number.isFinite(current)
    ) {
      // A gap in the altitude channel contributes nothing, which is the rule
      // `analysis/power-duration.ts` chose and every analysis module since has
      // restated: a missing sample is not a zero. Scoring it as no rise would
      // flatten a climb that lost its barometer for a minute.
      continue;
    }

    const rise = current - previous;
    if (rise > 0) {
      gain += rise;
    }

    const run = distanceBetween(from, to);
    if (run > 0) {
      // Rise over run as a percentage. Guarded on `run > 0` because two
      // identical samples give a zero run, and `rise / 0` is `Infinity` — which
      // would be stored as the maximum grade of a segment that merely paused.
      steepest = Math.max(steepest, (rise / run) * 100);
    }
  }

  const averagePercent = distance > 0 ? (gain / distance) * 100 : 0;
  return {
    elevationGain: metres(gain),
    averageGrade: averagePercent as GradePercent,
    ...(Number.isFinite(steepest) ? { maximumGrade: steepest as GradePercent } : {}),
  };
}

/**
 * The bearing of a ride sample, from the sample before it.
 *
 * The heading {@link endpointReached} wants, derived the only way a GNSS stream
 * offers it: from the previous position. `undefined` at the first sample and
 * wherever the rider did not move, which {@link endpointReached} treats as *not*
 * reaching an endpoint.
 */
export function sampleHeading(
  previous: GeographicPosition | undefined,
  current: GeographicPosition,
): DegreesBearing | undefined {
  if (previous === undefined) {
    return undefined;
  }
  return initialBearing(previous, current);
}
