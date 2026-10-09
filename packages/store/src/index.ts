// SPDX-License-Identifier: Apache-2.0

/**
 * `@onyourleft/store` — the local activity store.
 *
 * Athletes, activities, laps and local-only privacy zones, in IndexedDB via
 * Dexie (ADR 0005 section F). Everything is on the device: Phase 1 has no
 * server, no account and no network (owner decision D6), so there is no
 * `athlete_id` pointing at an accounts table, no SQL, and no query planner.
 *
 * Consumers import from `@onyourleft/store` and never from a file inside it.
 *
 * See `README.md` for the schema, the indexes and the query each one serves.
 */

// --- Opening the store ------------------------------------------------------

export { ActivityStore, deleteActivityStore, openActivityStore } from './activity-store';
export type {
  ActivityOrder,
  AthleteDeletionCounts,
  ListActivitiesOptions,
  SortDirection,
} from './activity-store';

// --- Records ----------------------------------------------------------------

export type {
  ActivityRecord,
  ActivitySummary,
  RideFacts,
  AthleteRecord,
  CameraFrameOutlineRecord,
  CameraFrameRecord,
  CameraFrameSource,
  FramingCheckRecord,
  FramingLandmarkRecord,
  FramingReferenceRecord,
  SideCameraReportRecord,
  SideSessionKind,
  SideSessionSourceRecord,
  SideSessionSummaryRecord,
  RideWriteUpRecord,
  RiderTextKind,
  RiderTextRecord,
  SyncBaseKind,
  SyncBaseRecord,
  TrustedDeviceKeyRecord,
  RideWriteUpSourceRecord,
  LapRecord,
  NewActivity,
  NewLap,
  OriginalFileReference,
  PrivacyZoneRecord,
  SegmentEndpointRecord,
  FrozenEffortAttributes,
  MatchCheckpointRecord,
  RouteElevationRecord,
  RouteRecord,
  SegmentEffortRecord,
  SegmentRecord,
  WorkoutRecord,
} from './records';
export {
  CAMERA_FRAME_SOURCES,
  DEFAULT_PRIVACY_ZONE_RADIUS_METRES,
  RIDE_WRITE_UP_SOURCES,
  RIDER_TEXT_KINDS,
  RIDERLESS_SYNC_BASE_KINDS,
  SYNC_BASE_KINDS,
  SIDE_SESSION_KINDS,
  SIDE_SESSION_SOURCES,
} from './records';

// --- Identifiers ------------------------------------------------------------

export type {
  ActivityId,
  AthleteId,
  CameraFrameId,
  EntityId,
  LapId,
  PrivacyZoneId,
  RecordingSessionId,
  RouteId,
  SegmentEffortId,
  SegmentId,
  WorkoutId,
} from './ids';
export {
  activityId,
  athleteId,
  cameraFrameId,
  lapId,
  privacyZoneId,
  recordingSessionId,
  routeId,
  segmentEffortId,
  segmentId,
  workoutId,
} from './ids';

// --- The rider's kit colour (#623) ------------------------------------------

export type { KitColour } from './kit-colour';
export { DEFAULT_KIT_COLOUR, isKitColour, KIT_COLOURS, parseKitColour } from './kit-colour';
export {
  MAXIMUM_MASKED_WORD_LENGTH,
  MAXIMUM_MASKED_WORDS,
  parseMaskedWords,
  tidyMaskedWord,
} from '@onyourleft/analysis';

// --- The rider's goals, ride notes and documents (#836) ---------------------

export {
  GOALS_KEY,
  MAXIMUM_DOCUMENT_CHARACTERS,
  MAXIMUM_DOCUMENT_NAME_CHARACTERS,
  MAXIMUM_GOALS_CHARACTERS,
  MAXIMUM_RIDE_NOTE_CHARACTERS,
  MAXIMUM_RIDER_DOCUMENTS,
  maximumRiderTextCharacters,
  riderTextProblem,
  tidyRiderText,
  withoutBidiControls,
} from './rider-text';

// --- Visibility (ADR 0004 decision A) ---------------------------------------

export type { UnitSystem } from './unit-system';
export { DEFAULT_UNIT_SYSTEM, isUnitSystem, parseUnitSystem, UNIT_SYSTEMS } from './unit-system';
export type { Visibility } from './visibility';
export { DEFAULT_VISIBILITY, parseVisibility, VISIBILITIES } from './visibility';

// --- Errors -----------------------------------------------------------------

export {
  StoreDecodeError,
  StoreError,
  StoreReferentialError,
  StoreValidationError,
  StoreVersionError,
} from './errors';

// --- Schema and migrations --------------------------------------------------

export {
  DEXIE_IDB_VERSION_MULTIPLIER,
  INDEX,
  SCHEMA_VERSION,
  SCHEMA_VERSIONS,
  STORES_V1,
  STORES_V2,
  STORES_V3,
  STORES_V4,
  TABLE,
} from './schema';
export type { AnyRecordMigration, RecordMigration } from './migrations';
export { migrateDown, migrateUp, SCHEMA_MIGRATIONS, upgradeWith } from './migrations';

// --- Streams (#27) ----------------------------------------------------------

export type {
  NewStreamSet,
  Samples,
  StreamChannel,
  StreamChannels,
  StreamChannelValue,
  StreamSet,
  StreamSetSummary,
} from './streams';
export {
  CHANNEL_RESOLUTION,
  hasPositionChannels,
  POSITION_CHANNELS,
  STREAM_CHANNELS,
} from './streams';

// --- Recording checkpoints (#46) --------------------------------------------

export type {
  NewRecordingChunk,
  NewRecordingSession,
  RecordingChunkRecord,
  RecordingFootprint,
  RecordingSessionRecord,
  RecordingStoredState,
  RecoveredRecording,
} from './recording';
export { RECORDING_STORED_STATES } from './recording';

export type { ChannelEncoding, EncodedChannel } from './stream-codec';
export { channelBytesPerSample, decodeChannel, encodeChannel } from './stream-codec';

export type { StreamCompression } from './stream-compression';
export { STREAM_COMPRESSION, StreamSizeError } from './stream-compression';

// --- On-disk shapes ---------------------------------------------------------
//
// Exported because a migration's `up` and `down` are written against them, and
// because #35's export and #51's import serialise them directly.

export type {
  PersistedActivity,
  PersistedAthlete,
  PersistedLap,
  PersistedPrivacyZone,
  PersistedRoute,
  PersistedSegment,
} from './persisted';
export type {
  PersistedRecordingChannel,
  PersistedRecordingChunk,
  PersistedRecordingPause,
  PersistedRecordingSession,
} from './recording-persisted';
export {
  fromPersistedRecordingSession,
  parseRecordingState,
  toPersistedRecordingSession,
} from './recording-persisted';
export type { PersistedStreamBlob, PersistedStreamSet } from './stream-persisted';
export { fromPersistedStreamSet, parseStreamChannel } from './stream-persisted';
export {
  fromPersistedActivity,
  fromPersistedAthlete,
  fromPersistedLap,
  fromPersistedPrivacyZone,
  toPersistedActivity,
  toPersistedAthlete,
  toPersistedLap,
  toPersistedPrivacyZone,
  fromPersistedRoute,
  toPersistedRoute,
  fromPersistedSegment,
  toPersistedSegment,
  // The side camera's report sentences have a length the store refuses past;
  // the client's wording is held under it by a test (#564).
  MAXIMUM_SIDE_REPORT_SENTENCE,
  // A model's write-up has a length the store refuses past, and #798's
  // runtime screen holds a write-up to the same number (#800).
  MAXIMUM_WRITE_UP_CHARACTERS,
} from './persisted';

// --- Identity: the device keypair and signed activity records (#61) ---------
//
// The record format, the canonical bytes and the verification logic are in
// `@onyourleft/domain`, which cannot name `crypto`. What is here is the
// persistence and the WebCrypto primitive — see `web-crypto.ts` for the seam,
// and `docs/architecture.md` for the record format a stranger's verifier reads.

export type { DeviceKeyRecord, StoredActivityRecord } from './identity';
export type { PersistedActivityRecord, PersistedDeviceKey } from './identity';
export {
  fromPersistedActivityRecord,
  fromPersistedDeviceKey,
  toPersistedActivityRecord,
  toPersistedDeviceKey,
} from './identity';

export type { DeviceKeyStorage, WebCryptoKeystoreOptions } from './web-crypto';
export {
  createWebCryptoKeystore,
  ensureDeviceSigningKey,
  generateDeviceKey,
  signingKeyFor,
  webCryptoHpkePrimitives,
  webCryptoSha256,
  webCryptoVerifier,
} from './web-crypto';
