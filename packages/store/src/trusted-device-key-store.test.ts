// SPDX-License-Identifier: Apache-2.0

/**
 * Trusted device keys (#898): another device's public key, admitted on THIS
 * device, which is what a sync takes a pulled record's key from — never the
 * instance's own device list (`records.ts` §`TrustedDeviceKeyRecord`).
 */

import { unixSeconds } from '@onyourleft/domain';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StoreDecodeError, StoreReferentialError, StoreValidationError } from './errors';
import { athleteId } from './ids';
import { SCHEMA_VERSIONS, TABLE } from './schema';
import {
  assertTrustedDeviceKeyRoundTrip,
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  memoryWriteStoreFactory,
  resetFixtureIds,
  RoundTripFailure,
  seedAthletes,
  trustedDeviceKeyFor,
} from './testing';
import type { StoreHarness } from './testing';

let harness: StoreHarness;

beforeEach(async () => {
  resetFixtureIds();
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  await harness.destroy();
});

describe('trusted device keys', () => {
  it('reads an admitted key back whole on a fresh connection', async () => {
    const key = trustedDeviceKeyFor(ATHLETE_A);
    await expect(assertTrustedDeviceKeyRoundTrip(harness, key)).resolves.toStrictEqual(key);
  });

  it('goes red against a store that answers the write and keeps nothing', async () => {
    const broken = createStoreHarness({ factory: memoryWriteStoreFactory() });
    try {
      await seedAthletes(broken);
      await expect(
        assertTrustedDeviceKeyRoundTrip(broken, trustedDeviceKeyFor(ATHLETE_A)),
      ).rejects.toBeInstanceOf(RoundTripFailure);
    } finally {
      await broken.destroy();
    }
  });

  it('keeps the first admission when a key is admitted again', async () => {
    const first = trustedDeviceKeyFor(ATHLETE_A);
    await harness.write((store) => store.putTrustedDeviceKey(first));
    await harness.write((store) =>
      store.putTrustedDeviceKey({ ...first, admittedAt: unixSeconds(first.admittedAt + 60) }),
    );
    await expect(
      harness.read((store) => store.listTrustedDeviceKeys(ATHLETE_A)),
    ).resolves.toStrictEqual([first]);
  });

  it('refuses a key that is not 64 lowercase hex, naming the field and not the value', async () => {
    for (const publicKey of ['', 'A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64)]) {
      const attempt = harness.write((store) =>
        store.putTrustedDeviceKey({ ...trustedDeviceKeyFor(ATHLETE_A), publicKey }),
      );
      await expect(attempt).rejects.toBeInstanceOf(StoreValidationError);
      await expect(attempt).rejects.toThrow('trustedDeviceKey.publicKey');
    }
  });

  it('refuses a key for an athlete who does not exist', async () => {
    await expect(
      harness.write((store) =>
        store.putTrustedDeviceKey(trustedDeviceKeyFor(athleteId('nobody-here'))),
      ),
    ).rejects.toBeInstanceOf(StoreReferentialError);
  });

  it('refuses a hand-edited row on the way out rather than believing it', async () => {
    await harness.write((store) => store.putTrustedDeviceKey(trustedDeviceKeyFor(ATHLETE_B)));
    await harness.discard();
    const raw = new Dexie(harness.databaseName);
    SCHEMA_VERSIONS.forEach((stores, index) => {
      raw.version(index + 1).stores(stores);
    });
    await raw
      .table(TABLE.trustedDeviceKeys)
      .put({ athleteId: ATHLETE_B, publicKey: 'not a key', admittedAt: 1 });
    raw.close();
    await expect(
      harness.read((store) => store.listTrustedDeviceKeys(ATHLETE_B)),
    ).rejects.toBeInstanceOf(StoreDecodeError);
  });

  it('goes with the athlete, and only theirs', async () => {
    await harness.write((store) => store.putTrustedDeviceKey(trustedDeviceKeyFor(ATHLETE_A)));
    await harness.write((store) => store.putTrustedDeviceKey(trustedDeviceKeyFor(ATHLETE_B)));
    const counts = await harness.write((store) => store.deleteAthlete(ATHLETE_A));
    expect(counts.trustedDeviceKeys).toBe(1);
    await expect(
      harness.read((store) => store.listTrustedDeviceKeys(ATHLETE_B)),
    ).resolves.toStrictEqual([trustedDeviceKeyFor(ATHLETE_B)]);
  });
});
