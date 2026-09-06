// SPDX-License-Identifier: Apache-2.0

/**
 * #61's second acceptance criterion: *"The private key never leaves the device
 * and never appears in any exported file, log line or error report. A test
 * greps a full export and the captured logs for the private key material and
 * fails if it is present."*
 *
 * That is discharged twice over, and the two halves prove different things.
 *
 * ## 1. The production key has no bytes to leak
 *
 * `generateDeviceKey` passes `extractable: false`, so `crypto.subtle.exportKey`
 * on the stored private key **rejects**. There is no sequence of calls — in
 * this package, above it, or in a devtools console — that turns the stored
 * value back into key material. That is stronger than any grep: a grep says
 * "this output does not contain it today", and this says "it cannot be
 * obtained".
 *
 * ## 2. The grep, run against a key whose bytes exist
 *
 * The first half is also why the grep the criterion literally asks for needs
 * setting up: you cannot search an export for a value you cannot compute. So
 * the grep runs against an **extractable** key created by the test — through
 * the same store rows, the same serialisation and the same error paths — and
 * fails if its private bytes appear anywhere. `extractableDeviceKey` is in
 * `@onyourleft/store/testing` and the production keystore cannot produce one.
 *
 * Both are needed. Without the first, "non-extractable" is a comment. Without
 * the second, nothing checks that a future author has not added `privateKey` to
 * a serialised shape — which is a change that would be invisible to the first.
 */

import { ensureSigningKey, unixSeconds } from '@onyourleft/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreValidationError } from './errors';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  extractableDeviceKey,
  resetFixtureIds,
  seedAthletes,
  seedRide,
  signedRecordFor,
  type StoreHarness,
} from './testing';
import { createWebCryptoKeystore, generateDeviceKey } from './web-crypto';

let harness: StoreHarness;

beforeEach(() => {
  resetFixtureIds();
  harness = createStoreHarness();
});

afterEach(async () => {
  await harness.destroy();
  vi.restoreAllMocks();
});

/**
 * Everything this athlete's data is, through the public read paths, as text.
 *
 * There is no `#35` export yet, so "a full export" is defined as what the
 * public API can be asked for: the athlete, the ride, its laps and streams, the
 * signed record and the device key row. That is a superset of what any export
 * could contain, because an export cannot serialise what it cannot read.
 */
async function fullExport(owner = ATHLETE_A, activity?: string): Promise<string> {
  const everything = await harness.read(async (store) => ({
    athlete: await store.getAthlete(owner),
    deviceKey: await store.getDeviceKey(owner),
    activities: await store.listActivitySummaries(owner),
    laps: activity === undefined ? [] : await store.listLaps(owner, activity as never),
    streams:
      activity === undefined ? undefined : await store.getStreamSet(owner, activity as never),
    record:
      activity === undefined ? undefined : await store.getActivityRecord(owner, activity as never),
    privacyZones: await store.listPrivacyZones(owner),
  }));
  return JSON.stringify(everything);
}

describe('the private key cannot be exported at all', () => {
  it('is created non-extractable, and exportKey rejects on it', async () => {
    // Mutation that proves this: change `extractable` from `false` to `true` in
    // `generateDeviceKey`. Both assertions below go red.
    await seedAthletes(harness);
    await harness.write(async (store) =>
      ensureSigningKey(createWebCryptoKeystore(store, ATHLETE_A)),
    );

    const stored = await harness.read(async (store) => store.getDeviceKey(ATHLETE_A));

    expect(stored?.privateKey.extractable).toBe(false);
    await expect(
      crypto.subtle.exportKey('pkcs8', stored?.privateKey as CryptoKey),
    ).rejects.toThrow();
  });

  it('is still non-extractable after a round trip through IndexedDB', async () => {
    // The property has to survive the structured clone algorithm, or it holds
    // only for the handle in memory and not for the one on disk — which is the
    // handle every launch after the first one uses.
    await seedAthletes(harness);
    const record = await generateDeviceKey(ATHLETE_A, unixSeconds(1_700_000_100));
    await harness.write(async (store) => store.putDeviceKey(record));

    const reread = await harness.read(async (store) => store.getDeviceKey(ATHLETE_A));

    expect(reread?.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('jwk', reread?.privateKey as CryptoKey)).rejects.toThrow();
  });

  it('can still sign, which is the whole point of keeping the handle', async () => {
    await seedAthletes(harness);
    const key = await harness.write(async (store) =>
      ensureSigningKey(createWebCryptoKeystore(store, ATHLETE_A)),
    );

    await expect(key.sign(new Uint8Array([1, 2, 3]))).resolves.toHaveLength(64);
  });
});

describe('the grep — no export, log line or error report carries the private key', () => {
  it('finds it nowhere, for a key whose bytes exist to be found', async () => {
    // Mutation that proves this: add `privateKeyHex` to `PersistedDeviceKey`
    // and set it in `toPersistedDeviceKey`. The export assertion goes red. Add
    // it to the record's claims instead and the same assertion goes red on the
    // record.
    const logs: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((arg) => String(arg)).join(' '));
      });
    }

    await seedAthletes(harness);
    const { record: deviceKey, key, privateKeyHex } = await extractableDeviceKey(ATHLETE_A);
    await harness.write(async (store) => store.putDeviceKey(deviceKey));
    const ride = await seedRide(harness, ATHLETE_A);
    const signed = await signedRecordFor(ride, key);
    await harness.write(async (store) => store.putActivityRecord(signed));

    // Every error path this athlete's identity can reach, with its message and
    // its stack collected. An error report is a stack as much as a message.
    const errors: string[] = [];
    let refusals = 0;
    for (const attempt of [
      async () =>
        harness.write(async (store) =>
          store.putDeviceKey(await generateDeviceKey(ATHLETE_A, unixSeconds(1))),
        ),
      async () =>
        harness.write(async (store) =>
          store.putActivityRecord({ ...signed, athleteId: ATHLETE_B }),
        ),
      async () =>
        harness.write(async (store) =>
          store.putActivityRecord({ ...signed, activityId: 'ghost' as never }),
        ),
    ]) {
      await attempt().catch((error: unknown) => {
        refusals += 1;
        errors.push(String(error));
        errors.push(error instanceof Error ? (error.stack ?? '') : '');
      });
    }

    const exported = await fullExport(ATHLETE_A, ride.id);
    const haystack = [exported, ...logs, ...errors].join('\n');

    // The needle really is findable: assert the grep would work before
    // asserting that it finds nothing, so a typo in the hex cannot make this
    // test pass vacuously.
    expect(privateKeyHex.length).toBeGreaterThan(64);
    expect(`prefix ${privateKeyHex} suffix`).toContain(privateKeyHex);

    expect(haystack).not.toContain(privateKeyHex);
    // Also the raw seed on its own: a pkcs8 encoding wraps the 32-byte seed in
    // an ASN.1 header, so a leak of the seed alone would not match the whole
    // string above.
    expect(haystack).not.toContain(privateKeyHex.slice(-64));
    // All three attempts really were refused. Without this the grep could be
    // searching three empty strings and passing for that reason.
    expect(refusals).toBe(3);
  });

  it('serialises the stored key row with no private material in it', async () => {
    // A `CryptoKey` has no enumerable own properties, so `JSON.stringify` of a
    // device key row yields `{}` for `privateKey`. That is the property an
    // export walking every field of every row depends on, and it is asserted
    // rather than assumed.
    await seedAthletes(harness);
    const { record, privateKeyHex } = await extractableDeviceKey(ATHLETE_A);
    await harness.write(async (store) => store.putDeviceKey(record));

    const stored = await harness.read(async (store) => store.getDeviceKey(ATHLETE_A));
    const text = JSON.stringify(stored);

    expect(text).toContain(record.publicKey);
    expect(text).not.toContain(privateKeyHex);
    expect(JSON.parse(text)).toMatchObject({ privateKey: {} });
  });

  it('says an identity is write-once without printing either key', async () => {
    await seedAthletes(harness);
    const { record } = await extractableDeviceKey(ATHLETE_A);
    await harness.write(async (store) => store.putDeviceKey(record));
    const second = await generateDeviceKey(ATHLETE_A, unixSeconds(2));

    const error = await harness
      .write(async (store) => store.putDeviceKey(second))
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(StoreValidationError);
    expect(String(error)).not.toContain(record.publicKey);
    expect(String(error)).not.toContain(second.publicKey);
  });
});

describe('a published record carries no location', () => {
  it('has no coordinate-shaped member, even for a ride that has a track', async () => {
    // #61's sixth criterion, through the store: the ride has position data and
    // the record still cannot carry any, because it references the file by
    // content hash. The compile-time half is in
    // `packages/domain/src/identity/record-safety.test.ts`.
    await seedAthletes(harness);
    const ride = await seedRide(harness, ATHLETE_A, { hasPosition: true });
    const key = await harness.write(async (store) =>
      ensureSigningKey(createWebCryptoKeystore(store, ATHLETE_A)),
    );
    await harness.write(async (store) => store.putActivityRecord(await signedRecordFor(ride, key)));

    const read = await harness.read(async (store) => store.getActivityRecord(ATHLETE_A, ride.id));
    const text = JSON.stringify(read?.record).toLowerCase();

    for (const forbidden of ['latitude', 'longitude', '"lat"', '"lon"', 'semicircle']) {
      expect(text).not.toContain(forbidden);
    }
    expect(read?.record.claims.hasPosition).toBe(true);
  });
});
