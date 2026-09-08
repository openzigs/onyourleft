// SPDX-License-Identifier: Apache-2.0

/**
 * `@onyourleft/domain` — canonical units, core types, validation, signing and
 * analysis.
 *
 * This package depends on **no platform API at all**: no DOM, no Node globals,
 * no I/O, no network types. `tsconfig.json` enforces it by narrowing `lib` and
 * emptying `types`, and `eslint.config.js` enforces it again for the module
 * specifiers a `lib` narrowing cannot see. See docs/architecture.md.
 *
 * The canonical representation of each quantity, and the reasoning behind it,
 * is in `README.md` and in the doc comments on each type. Everything the rest
 * of the program uses is re-exported here, so a consumer imports from
 * `@onyourleft/domain` and never from a file inside it.
 */

// --- Nominal typing ---------------------------------------------------------

export type { Quantity } from './quantity';

// --- Errors -----------------------------------------------------------------

export { UnitError } from './unit-error';

// --- Canonical quantities ---------------------------------------------------

export type {
  AltitudeMetres,
  BeatsPerMinute,
  DegreesBearing,
  DegreesCelsius,
  DegreesLatitude,
  DegreesLongitude,
  GeographicPosition,
  GradePercent,
  Kilograms,
  KilometresPerHour,
  Metres,
  MetresPerSecond,
  ResistanceLevel,
  RevolutionsPerMinute,
  Seconds,
  UnixSeconds,
  Joules,
  Watts,
} from './quantities';

export {
  ABSOLUTE_ZERO_DEGREES_CELSIUS,
  altitudeMetres,
  beatsPerMinute,
  degreesBearing,
  degreesCelsius,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradePercent,
  kilograms,
  kilometresPerHour,
  metres,
  metresPerSecond,
  resistanceLevel,
  revolutionsPerMinute,
  seconds,
  unixSeconds,
  joules,
  watts,
} from './quantities';

// --- Speed ------------------------------------------------------------------

export {
  hundredthsKilometresPerHourToMetresPerSecond,
  kilometresPerHourToMetresPerSecond,
  metresPerSecondToKilometresPerHour,
} from './speed';

// --- Geodesy: distance on the earth's surface -------------------------------
//
// One implementation, because ADR 0004 decision C requires the device and a
// Phase 3 instance to agree about whether a point is inside a privacy zone.

export {
  bearingDifference,
  distanceBetween,
  EARTH_MEAN_RADIUS_METRES,
  initialBearing,
} from './geodesy';

// --- Position: the FIT semicircle encoding ----------------------------------

export {
  DEGREES_PER_SEMICIRCLE,
  degreesLatitudeToSemicircles,
  degreesLongitudeToSemicircles,
  latitudeSemicircles,
  longitudeSemicircles,
  SEMICIRCLE_ROUND_TRIP_TOLERANCE_DEGREES,
  SEMICIRCLES_MAX,
  SEMICIRCLES_MIN,
  SEMICIRCLES_PER_HALF_TURN,
  SEMICIRCLES_PER_QUARTER_TURN,
  semicirclesToDegreesLatitude,
  semicirclesToDegreesLongitude,
  semicirclesToPosition,
} from './position';

// The labelling functions are the single point where an unlabelled sint32 off
// the wire becomes a latitude or a longitude. #30 and #31 must call them at the
// field read, where a reviewer can see which field is which; nothing downstream
// re-labels, so a wrong label there is the one transposition no type can catch.
export type { LatitudeSemicircles, LongitudeSemicircles } from './position';

// --- Altitude: the FIT scale-and-offset encoding ----------------------------

export {
  FIT_ALTITUDE_MAX_METRES,
  FIT_ALTITUDE_MIN_METRES,
  FIT_ALTITUDE_OFFSET_METRES,
  FIT_ALTITUDE_SCALE,
  FIT_UINT16_INVALID,
  fitAltitudeToMetres,
  metresToFitAltitude,
} from './altitude';

// --- Time: the FIT epoch, and wrapping event-time counters ------------------

export {
  EVENT_TICKS_PER_SECOND_1024,
  EVENT_TICKS_PER_SECOND_2048,
  eventTickRate,
  eventTicks,
  eventTimeAmbiguityHorizonSeconds,
  eventTimeIntervalIsAmbiguous,
  eventTimeIntervalSeconds,
  FIT_EPOCH_UNIX_SECONDS,
  FIT_SYSTEM_TIME_MAX,
  FIT_TIMESTAMP_MAX,
  fitTimestampToUnixSeconds,
  isFitSystemTime,
  UINT16_MODULUS,
  UINT32_MODULUS,
  unixSecondsToFitTimestamp,
  unsignedCounterDelta,
} from './time';

// The event-time reading is a named-field object rather than three positional
// numbers, because all three are small non-negative integers and every wrong
// ordering of the old signature typechecked (#103). The two brands are what
// stop a tick rate being written into a counter reading's field.
export type { EventTickRate, EventTicks, EventTimeReading } from './time';

// --- Recording: the session state machine and the stream merge (#45) --------
//
// Generic over a channel map rather than naming the eight stream channels,
// because this package cannot import the two places those are already spelled
// out — `@onyourleft/store` and `@onyourleft/sensors` both depend on it.
// `recording/channels.ts` records the reasoning; `apps/web` is the composition
// root that instantiates it.

export type {
  ChannelOf,
  ChannelReading,
  PauseReason,
  RecordedChannels,
  RecordedPause,
  RecordedSamples,
  RecordedSeries,
  RecordedSlice,
  RecordingChannelMap,
} from './recording/channels';
export { seriesTimestamps } from './recording/channels';

export type { RecordingErrorCode } from './recording/errors';
export { RecordingError } from './recording/errors';

export type {
  AutoPausePolicy,
  RecordingOutcome,
  RecordingSession,
  RecordingSessionOptions,
  RecordingSnapshot,
  RecordingState,
} from './recording/session';
export {
  createRecordingSession,
  DEFAULT_FUTURE_TOLERANCE_SECONDS,
  DEFAULT_LATE_TOLERANCE_SECONDS,
  DEFAULT_MAX_SAMPLE_COUNT,
  restoreRecordingSession,
} from './recording/session';

// --- Identity: the device keypair and the signed activity record (#61) ------
//
// The *algorithm*, the canonical byte encoding and the verification logic are
// here; the *key material and the primitive* are injected, because this package
// cannot name `crypto` (see `identity/seam.ts`). `packages/store` carries the
// WebCrypto implementation and #7's instance will carry the Node one, and the
// two have to agree byte for byte — which is why the message handed across the
// seam is bytes and neither side gets to serialise anything.
//
// `identity/testing.ts` is deliberately NOT exported: it is a non-cryptographic
// stand-in for this package's own tests and must never reach a caller.

export { IdentityError } from './identity/errors';

export type { CanonicalArray, CanonicalObject, CanonicalValue } from './identity/canonical';
export { canonicalBytes, canonicalJson } from './identity/canonical';

export { bytesEqual, fromHex, isHexOfLength, toHex } from './identity/hex';
export { utf8Encode } from './identity/utf8';

export type {
  Keystore,
  SignatureAlgorithm,
  SignatureVerifier,
  Sha256,
  SigningKey,
} from './identity/seam';
export {
  DIGEST_BYTES,
  ensureSigningKey,
  PUBLIC_KEY_BYTES,
  SIGNATURE_ALGORITHM,
  SIGNATURE_BYTES,
} from './identity/seam';

export type {
  ActivityClaims,
  ActivityRecordPayload,
  RecordParse,
  RecordVerification,
  SignedActivityRecord,
} from './identity/record';
export {
  canonicalPayload,
  contentHashOf,
  formatContentHash,
  isVerified,
  parseContentHash,
  parseSignedActivityRecord,
  recordPayload,
  RECORD_FORMAT,
  RECORD_VERSION,
  signActivityRecord,
  signingInput,
  verifyActivityRecord,
  verifyRecordSignature,
} from './identity/record';

// --- Analysis (#75) ---------------------------------------------------------
//
// The power-duration curve and the critical-power model fitted to it. Pure
// computation over a stream the store already holds, which is why it is here
// and not in `apps/web`: #57's local-first promise is that this needs no
// server, and an instance computing the same numbers later must get the same
// answers from the same code.

export type { BestEffort, PowerDurationCurve, PowerSeries } from './analysis/power-duration';
export {
  bestMeanPower,
  CURVE_DURATIONS,
  effortAt,
  mergeCurves,
  powerDurationCurve,
} from './analysis/power-duration';

export type {
  CriticalPowerFit,
  CriticalPowerRefusal,
  CriticalPowerResult,
} from './analysis/critical-power';
export {
  CRITICAL_POWER_MAXIMUM_SECONDS,
  CRITICAL_POWER_MINIMUM_EFFORTS,
  CRITICAL_POWER_MINIMUM_SECONDS,
  fitCriticalPower,
  predictedPower,
} from './analysis/critical-power';

// --- Training zones (#78) ----------------------------------------------------
//
// Here rather than in `apps/web` for the reason above, and one more: the
// boundary rule is a *decision* — inclusive below, exclusive above — and a
// second implementation of it somewhere else is how time-in-zone stops summing
// to covered time. `analysis/zones.ts` states the rule before it computes
// anything.

export type { TimeInZones, Zone, ZoneBasis } from './analysis/zones';
export {
  DEFAULT_THRESHOLD_HEART_RATE,
  DEFAULT_THRESHOLD_POWER,
  HEART_RATE_ZONE_LOWER_FRACTIONS,
  HEART_RATE_ZONE_NAMES,
  heartRateZones,
  POWER_ZONE_LOWER_FRACTIONS,
  POWER_ZONE_NAMES,
  powerZones,
  timeInZones,
  zoneOf,
} from './analysis/zones';

// --- Per-ride load metrics (#76) ---------------------------------------------
//
// ⚠️ The familiar names for these three are registered trademarks — see the
// header of `analysis/load.ts`, which records the check #76 asked for and what
// it found. These names are our own and deliberately plain; do not "fix" them
// to the ones you recognise.

export type { EffortWeightedPower, LoadBasis, RideLoad } from './analysis/load';
export {
  coveredTime,
  DEFAULT_SMOOTHING_WINDOW_SECONDS,
  EFFORT_WEIGHTING_EXPONENT,
  effortWeightedHeartRate,
  effortWeightedPower,
  heartRateLoad,
  LOAD_AT_THRESHOLD_FOR_ONE_HOUR,
  powerRideLoad,
  rollingMeans,
  thresholdFraction,
} from './analysis/load';

// --- Fitness and fatigue over a history (#77) ---------------------------------
//
// ⚠️ `CTL`, `ATL` and `TSB` are reported registered trademarks — see CLAUDE.md §6
// and the header of `analysis/fitness.ts`. These names are our own: `base` is
// the slow average, `recent` the fast one, `freshness` the gap. Do not rename
// them to the initialisms.

export type {
  CalendarDay,
  DailyLoad,
  FitnessOptions,
  FitnessPoint,
  LoadEntry,
} from './analysis/fitness';
export {
  dailyLoads,
  DEFAULT_BASE_DAYS,
  DEFAULT_RECENT_DAYS,
  fitnessSeries,
  localDay,
  seriesSpan,
} from './analysis/fitness';

// --- Routes (#89) ------------------------------------------------------------
//
// A route for indoor riding is a one-dimensional function of distance:
// elevation, and therefore gradient, at every point along it. Here rather than
// in a client for the reason the analysis is: #90 writes the gradient to a
// trainer and #91 draws the same path, and the two must read the same numbers
// from the same code. `route/profile.ts` states the three windows it is built
// from and what each one costs.

export type { RouteErrorCode } from './route/errors';
export { RouteError } from './route/errors';

export type { RouteProfile, RouteProfileOptions, RoutePoint } from './route/profile';
export {
  ASCENT_THRESHOLD_METRES,
  DESPIKE_WINDOW_METRES,
  distanceOnRoute,
  elevationAt,
  gradeAt,
  GRADIENT_WINDOW_METRES,
  LOOP_CLOSURE_METRES,
  positionAt,
  PROFILE_RESOLUTION_METRES,
  routeProfile,
} from './route/profile';

// --- Segments (#64) ----------------------------------------------------------
//
// The model, and the geometry that decides whether a ride went along a segment.
// Two rules bind it before any of the maths does, and `segment/segment.ts`
// states both at the top: **no oriented virtual start line** (ADR 0007 D-2.1) —
// the endpoint test is proximity plus direction agreement, never a crossing —
// and **no OSM geometry or identifier on a segment** (ADR 0012 D-1), which is
// what keeps the corpus from inheriting ODbL share-alike.

export type {
  ElevationSource,
  Segment,
  SegmentDraft,
  SegmentEndpoint,
  SegmentSport,
  SegmentVisibility,
} from './segment/segment';
// The matcher (#66), the effort it produces, and the two decisions #66 says
// must not be got wrong: visibility is a THREE-state — an effort starting
// inside a privacy zone is the athlete's own personal best and never a
// leaderboard row — and the attributes a ranking buckets by freeze when the
// effort is made, so editing a profile cannot rewrite last year's board.
export type {
  AbandonedReason,
  AbandonedTraversal,
  IndexedSegment,
  MatchedEffort,
  RideTrace,
  SegmentMatch,
  StageCounts,
} from './segment/match';
export {
  GAP_SECONDS,
  indexCorpus,
  matchRide,
  medianSampleSpacing,
  SIMILARITY_METRES,
} from './segment/match';
export type {
  EffortContext,
  EffortVisibility,
  FrozenAttributes,
  PrivacyCircle,
  SegmentEffort,
} from './segment/effort';
export {
  countsOnSharedBoard,
  countsTowardPersonalBest,
  createEffort,
  effortId,
  effortVisibility,
  personalBest,
  RANKING_BASIS,
  RANKING_BASIS_LABEL,
  rankEfforts,
  rankOrder,
  touchesPrivacyZone,
} from './segment/effort';
// Where the time went, rather than how much of it there was (#67). Two efforts
// on one segment do not share a sample rate, so each keeps its own series and
// the comparison is taken at checkpoints along the road — see `comparison.ts`
// for the truncation that shape exists to avoid.
export type {
  Checkpoint,
  CheckpointReading,
  EffortComparison,
  EffortProgress,
  ProgressPoint,
} from './segment/comparison';
export { COMPARISON_CHECKPOINTS, overlayEfforts, progressOf } from './segment/comparison';
export {
  COMPARISON_STEP_METRES,
  densify,
  directedHausdorff,
  discreteFrechet,
} from './segment/frechet';
export { CELL_DEGREES, cellCover, cellOf, coversIntersect, type CellId } from './segment/cells';

export {
  createSegment,
  DEFAULT_BEARING_TOLERANCE_DEGREES,
  DEFAULT_ENDPOINT_RADIUS_METRES,
  endBearing,
  endpointReachRadius,
  endpointReached,
  MINIMUM_SEGMENT_LENGTH_METRES,
  MINIMUM_SEGMENT_POSITIONS,
  NEAR_DUPLICATE_OVERLAP,
  nearestEndpointSample,
  overlapFraction,
  OVERLAP_TOLERANCE_METRES,
  pathLength,
  sampleHeading,
  startBearing,
} from './segment/segment';
