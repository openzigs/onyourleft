// SPDX-License-Identifier: Apache-2.0

/**
 * One athlete's footprint in **every table** of the schema, written through
 * the public path — moved here from `activity-store.erasure.test.ts` (#1545)
 * so that the erasure test and `migrations.test.ts`'s rollback seed the same
 * world. A table added to the schema needs a row here, or both go red: the
 * erasure test's "every table holds rows" and the rollback's "every table came
 * through" each refuse a table nothing filled.
 */

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  unixSeconds,
} from '@onyourleft/domain';

import type { AthleteId } from '../ids';
import { privacyZoneId } from '../ids';
import type { MatchCheckpointRecord, PrivacyZoneRecord } from '../records';
import {
  cameraFrameFor,
  chunksOf,
  effortFor,
  extractableDeviceKey,
  FIXTURE_EPOCH,
  framingReferenceFor,
  lapFor,
  recordingFor,
  rideFor,
  rideWriteUpFor,
  riderTextFor,
  routeFor,
  segmentFor,
  sideCameraReportFor,
  signedRecordFor,
  streamSetFor,
  syncBaseFor,
  trustedDeviceKeyFor,
  workoutFor,
  workoutGoalsFor,
  worldCorridorFor,
} from './fixtures';
import type { StoreHarness } from './harness';

const SAMPLE_COUNT = 60;
const CHUNK_SAMPLES = 30;

/** Everything one athlete owns, written through the public path. */
export async function seedEveryTable(harness: StoreHarness, owner: AthleteId): Promise<void> {
  const route = routeFor(owner);
  const workout = workoutFor(owner);
  const segment = segmentFor(owner);
  const ride = rideFor(owner, { routeId: route.id, hasPosition: true });
  const streams = streamSetFor(ride, { sampleCount: SAMPLE_COUNT });
  const recording = recordingFor(owner);
  const chunks = chunksOf(recording, streams, CHUNK_SAMPLES);
  const zone: PrivacyZoneRecord = {
    id: privacyZoneId(`zone-${owner}`),
    athleteId: owner,
    centre: geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12)),
    radius: metres(500),
    label: 'home',
    createdAt: unixSeconds(FIXTURE_EPOCH),
  };
  const checkpoint: MatchCheckpointRecord = {
    athleteId: owner,
    lastStartedAt: ride.startedAt,
    lastActivityId: ride.id,
    swept: 1,
    updatedAt: unixSeconds(FIXTURE_EPOCH),
  };
  const { record: deviceKey, key } = await extractableDeviceKey(owner);
  const signed = await signedRecordFor(ride, key);

  await harness.write(async (store) => {
    await store.putRoute(route);
    await store.putWorkout(workout);
    await store.putSegment(segment);
    await store.putActivity(ride);
    await store.putStreamSet(streams);
    await store.putLap(lapFor(ride, 1));
    await store.putPrivacyZone(zone);
    await store.putActivityEfforts(owner, ride.id, [effortFor(owner, segment.id, ride.id)]);
    await store.putRecordingSession(recording);
    for (const chunk of chunks) {
      await store.appendRecordingChunk(chunk);
    }
    await store.putDeviceKey(deviceKey);
    await store.putActivityRecord(signed);
    await store.putMatchCheckpoint(checkpoint);
    // #384. A kept picture is the most sensitive row this store holds, and the
    // whole of ADR 0029 D-11's remedy is that an erase removes it — so the
    // fixture has to put one there, or "empty afterwards" is true of a table
    // nothing ever filled.
    await store.putCameraFrame(cameraFrameFor(owner));
    // #528. Numbers read off a picture of the rider, and ADR 0029 D-4's
    // "everything derived from one" — seeded so "empty afterwards" is checked
    // against a table something filled.
    await store.putFramingReference(framingReferenceFor(owner));
    // #388. Sentences read off pictures of the rider, on this rider's ride —
    // seeded so "empty afterwards" is checked against a table something filled.
    await store.putSideCameraReport(sideCameraReportFor(owner, ride.id));
    // #800. A model's words about this rider's ride — seeded so "empty
    // afterwards" is checked against a table something filled.
    await store.putRideWriteUp(rideWriteUpFor(owner, ride.id));
    // #776 (#893's review). What this device last agreed with its instance
    // about this rider's ride — seeded for the same reason.
    await store.putSyncBase(syncBaseFor(owner, ride.id));
    await store.putSyncBase(syncBaseFor(owner, ride.id, 'write-up'));
    // #836. The rider's own goals, a note on their ride and a document —
    // free text, seeded for the same reason.
    await store.putRiderText(riderTextFor(owner, 'goal'));
    await store.putRiderText(riderTextFor(owner, 'note', ride.id));
    await store.putRiderText(riderTextFor(owner, 'document'));
    // #898. Another device's key, admitted here for this rider.
    await store.putTrustedDeviceKey(trustedDeviceKeyFor(owner));
    // #1236. The rider's typed workout goals.
    await store.putWorkoutGoals(workoutGoalsFor(owner));
    // #1431. A deleted ride, held in Recently deleted, with its lap and note.
    const deleted = rideFor(owner, { name: 'Deleted' });
    await store.putActivity(deleted);
    await store.putLap(lapFor(deleted, 1));
    await store.putRiderText(riderTextFor(owner, 'note', deleted.id));
    await store.moveActivityToRecentlyDeleted(owner, deleted.id, unixSeconds(FIXTURE_EPOCH));
    // #1545. The map features around this rider's route — location data,
    // seeded so "empty afterwards" is checked against a table something filled.
    await store.putWorldCorridor(await worldCorridorFor(owner, route.id));
  });
}
