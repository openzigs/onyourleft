// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Store version 18's rollback, through the PRODUCT's account export — #1236.
 *
 * Version 18 adds the `workoutGoals` store and rewrites no record, so it has no
 * `down` pair (`packages/store/src/migrations.ts` §"The registry"). What a
 * rollback means on IndexedDB is ADR 0005 F's runtime path: export →
 * downgrade → re-import. That path is only real if the export a rider can
 * actually make carries what the newer version added, so this runs it with
 * `exportEverything` — the Files screen's own export — rather than with a JSON
 * the test writes for itself, which would pass whatever the export left out.
 */

import {
  ATHLETE_A,
  createStoreHarness,
  openOlderSchema,
  resetFixtureIds,
  rideFor,
  seedAthletes,
  streamSetFor,
  workoutGoalsFor,
} from '@onyourleft/store/testing';
import {
  athleteId,
  deleteActivityStore,
  openActivityStore,
  SCHEMA_VERSION,
  TABLE,
  type WorkoutGoalsRecord,
} from '@onyourleft/store';
import { unixSeconds } from '@onyourleft/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { webCryptoDigest } from './browser';
import { MANIFEST_FILE_NAME, exportEverything } from './export-everything';
import { importActivityFiles } from './import-batch';
import type { DownloadableFile } from './store-port';
import { sequentialActivityIds } from './testing';

let harness: ReturnType<typeof createStoreHarness>;

beforeEach(() => {
  resetFixtureIds();
  harness = createStoreHarness();
});

afterEach(async () => {
  await harness.destroy();
});

describe('version 18 rolls back through the account export — export → downgrade → re-import', () => {
  it('brings the rides and the workout goals back on a database the version-17 build made', async () => {
    expect(SCHEMA_VERSION).toBe(18);
    await seedAthletes(harness);
    const rides = [0, 1].map((index) =>
      rideFor(ATHLETE_A, { startedAt: unixSeconds(1_700_000_000 + index * 86_400) }),
    );
    const goals = workoutGoalsFor(ATHLETE_A);
    await harness.write(async (store) => {
      for (const ride of rides) {
        await store.putActivity(ride);
        await store.putStreamSet(streamSetFor(ride, { sampleCount: 60 }));
      }
      await store.putWorkoutGoals(goals);
    });

    // Export, as the Files screen does.
    const files: DownloadableFile[] = [];
    const report = await harness.read(async (store) =>
      exportEverything({
        store,
        athleteId: ATHLETE_A,
        format: 'fit',
        onFile: (file) => {
          files.push(file);
        },
      }),
    );
    expect(report.exported).toBe(rides.length);
    const manifestFile = files.find((file) => file.fileName === MANIFEST_FILE_NAME);
    expect(manifestFile).toBeDefined();
    const manifest = JSON.parse(new TextDecoder().decode(manifestFile?.bytes)) as {
      athlete: { id: string; displayName: string; createdAt: number };
      workoutGoals: { goals: unknown; savedAt: number } | null;
    };
    const rideFiles = files.filter((file) => file.fileName.endsWith('.fit'));
    expect(rideFiles).toHaveLength(rides.length);

    // Downgrade: the version-17 build's database, which has nowhere to put goals.
    await harness.discard();
    await deleteActivityStore(harness.databaseName);
    const older = await openOlderSchema(harness.databaseName, 17);
    expect(older.version).toBe(17);
    expect(older.tables).not.toContain(TABLE.workoutGoals);
    await older.put(TABLE.athletes, {
      id: manifest.athlete.id,
      displayName: manifest.athlete.displayName,
      createdAt: manifest.athlete.createdAt,
    });
    older.close();

    // Upgrade again, and re-import: the rides through the product's importer,
    // the goals out of the manifest through the store's public write.
    const back = openActivityStore(harness.databaseName);
    await expect(back.getWorkoutGoals(ATHLETE_A)).resolves.toStrictEqual({ status: 'none' });
    const imported = await importActivityFiles({
      sources: rideFiles.map((file) => ({
        fileName: file.fileName,
        bytes: async () => Promise.resolve(file.bytes),
      })),
      store: back,
      athleteId: athleteId(manifest.athlete.id),
      newActivityId: sequentialActivityIds(),
      now: () => unixSeconds(1_800_000_000),
      digest: webCryptoDigest,
      timeZone: 'Europe/London',
    });
    expect(imported.imported).toBe(rides.length);
    expect(manifest.workoutGoals).not.toBeNull();
    await back.putWorkoutGoals({
      athleteId: athleteId(manifest.athlete.id),
      ...manifest.workoutGoals,
    } as WorkoutGoalsRecord);
    back.close();

    // A fresh connection reads both back.
    const reopened = openActivityStore(harness.databaseName);
    const summaries = await reopened.listActivitySummaries(ATHLETE_A);
    const goalsBack = await reopened.getWorkoutGoals(ATHLETE_A);
    reopened.close();

    expect(summaries).toHaveLength(rides.length);
    expect(goalsBack).toStrictEqual({ status: 'kept', record: goals });
  });
});
