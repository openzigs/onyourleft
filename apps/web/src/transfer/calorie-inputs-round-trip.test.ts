// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rider's sex and year of birth (#2432) through the product's account
 * export, the Files screen's erase, and back.
 *
 * ⚠️ **There is no account-manifest importer in this client.** The Files
 * screen imports ride files, and the manifest's athlete fields — `mass`,
 * the thresholds, `units`, `kitColour` — are read back by nobody; the same
 * gap `workout-goals-rollback.test.ts` works around. So "import" here is what
 * that test does: the rides through the product's importer, and the athlete
 * fields out of the exported manifest through the store's public write. What
 * this proves is that the export carries both fields in a form the write
 * takes back unchanged, read on a fresh connection.
 */

import { unixSeconds } from '@onyourleft/domain';
import { athleteId } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  rideFor,
  seedAthletes,
  streamSetFor,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { webCryptoDigest } from './browser';
import { eraseDevice } from './erase-device';
import { MANIFEST_FILE_NAME, exportEverything } from './export-everything';
import { importActivityFiles } from './import-batch';
import type { DownloadableFile } from './store-port';
import { sequentialActivityIds } from './testing';

let harness: StoreHarness;

beforeEach(() => {
  harness = createStoreHarness();
});

afterEach(async () => {
  await harness.destroy();
});

describe('the calorie inputs survive export → erase → import (#2432)', () => {
  it('gives back the same sex and year of birth', async () => {
    await seedAthletes(harness);
    const ride = rideFor(ATHLETE_A, { startedAt: unixSeconds(1_700_000_000) });
    await harness.write(async (store) => {
      await store.putActivity(ride);
      await store.putStreamSet(streamSetFor(ride, { sampleCount: 60 }));
      await store.setAthleteCalorieInputs(ATHLETE_A, { calorieSex: 'female', birthYear: 1985 });
    });

    const files: DownloadableFile[] = [];
    await harness.read(async (store) =>
      exportEverything({
        store,
        athleteId: ATHLETE_A,
        format: 'fit',
        onFile: (file) => {
          files.push(file);
        },
      }),
    );
    const manifestFile = files.find((file) => file.fileName === MANIFEST_FILE_NAME);
    const manifest = JSON.parse(new TextDecoder().decode(manifestFile?.bytes)) as {
      athlete: {
        id: string;
        displayName: string;
        createdAt: number;
        calorieSex?: 'female' | 'male';
        birthYear?: number;
      };
    };

    // The Files screen's erase, which puts back a bare athlete row.
    await harness.write(async (store) =>
      eraseDevice(store, ATHLETE_A, {
        athlete: {
          id: ATHLETE_A,
          displayName: manifest.athlete.displayName,
          createdAt: unixSeconds(manifest.athlete.createdAt),
        },
      }),
    );
    const erased = await harness.read(async (store) => store.getAthlete(ATHLETE_A));
    expect(erased?.calorieSex).toBeUndefined();
    expect(erased?.birthYear).toBeUndefined();

    // Import: the ride through the product's importer, the athlete's two
    // fields out of the manifest through the store's public write.
    await harness.write(async (store) => {
      const imported = await importActivityFiles({
        sources: files
          .filter((file) => file.fileName.endsWith('.fit'))
          .map((file) => ({
            fileName: file.fileName,
            bytes: async () => Promise.resolve(file.bytes),
          })),
        store,
        athleteId: athleteId(manifest.athlete.id),
        newActivityId: sequentialActivityIds(),
        now: () => unixSeconds(1_800_000_000),
        digest: webCryptoDigest,
        timeZone: 'Europe/London',
      });
      expect(imported.imported).toBe(1);
      await store.setAthleteCalorieInputs(athleteId(manifest.athlete.id), {
        calorieSex: manifest.athlete.calorieSex,
        birthYear: manifest.athlete.birthYear,
      });
    });

    const back = await harness.read(async (store) => store.getAthlete(ATHLETE_A));
    expect(back?.calorieSex).toBe('female');
    expect(back?.birthYear).toBe(1985);
  });
});
