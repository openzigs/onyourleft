// SPDX-License-Identifier: Apache-2.0

/**
 * `@onyourleft/store/testing` — the round-trip persistence harness (#28).
 *
 * Import from here, never from a file inside this directory.
 *
 * ```ts
 * import { createStoreHarness, seedAthletes, seedRide, streamSetFor,
 *          assertStreamSetRoundTrip } from '@onyourleft/store/testing';
 * ```
 *
 * The harness lives in `src/` rather than in a test file because later issues
 * consume it — #34's scoping assertions, #61's signed records, #7's instance
 * store — and a helper that only a sibling test can reach gets re-invented once
 * per consumer, which is exactly what #28 exists to prevent. It ships as a
 * separate entry point so nothing in the product bundle can import a fake.
 *
 * `CLAUDE.md` section 5 documents how to use it.
 */

export { createStoreHarness, indexedDbStoreFactory } from './harness';
export type { StoreHarness, StoreHarnessOptions } from './harness';

export type { PersistentStore, StoreFactory } from './store';

export {
  assertRecordingRecovers,
  assertSameSamples,
  assertSameStreamSet,
  assertStreamSetRoundTrip,
  RoundTripFailure,
} from './round-trip';
export type { ExpectedRecording } from './round-trip';

export {
  ATHLETE_A,
  ATHLETE_B,
  ATHLETE_C,
  ATHLETES,
  athleteRecord,
  CHANNELS_WITHOUT_POSITION,
  chunksOf,
  DROPPED_STRAP,
  FIXTURE_EPOCH,
  FOUR_HOUR_SAMPLE_COUNT,
  lapFor,
  resetFixtureIds,
  recordingFor,
  rideFor,
  seedAthletes,
  seedRecording,
  seedRide,
  streamSetFor,
} from './fixtures';
export type { StreamFixtureOptions, StreamGap } from './fixtures';

export {
  droppedFlushStoreFactory,
  gapFillingStoreFactory,
  memoryWriteStoreFactory,
  misroutedBlobStoreFactory,
} from './fakes';
