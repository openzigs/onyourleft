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
  AthleteRecord,
  LapRecord,
  NewActivity,
  NewLap,
  OriginalFileReference,
  PrivacyZoneRecord,
} from './records';
export { DEFAULT_PRIVACY_ZONE_RADIUS_METRES } from './records';

// --- Identifiers ------------------------------------------------------------

export type { ActivityId, AthleteId, EntityId, LapId, PrivacyZoneId } from './ids';
export { activityId, athleteId, lapId, privacyZoneId } from './ids';

// --- Visibility (ADR 0004 decision A) ---------------------------------------

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
} from './persisted';
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
} from './persisted';
