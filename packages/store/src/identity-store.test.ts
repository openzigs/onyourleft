// SPDX-License-Identifier: Apache-2.0

/**
 * #61's persistence: the device key, and the signed records filed against
 * rides.
 *
 * Everything here goes through `@onyourleft/store/testing` rather than a naive
 * write-then-read, for the reason CLAUDE.md section 5 gives. The signed-record
 * assertion ends in a **verification** rather than a comparison — see
 * `assertSignedRecordRoundTrip`, and `roundedClaimStoreFactory`, which is the
 * fake that shows why.
 */

import {
  ensureSigningKey,
  metres,
  toHex,
  unixSeconds,
  verifyActivityRecord,
  type Metres,
} from '@onyourleft/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StoreDecodeError, StoreReferentialError, StoreValidationError } from './errors';
import { activityId, athleteId } from './ids';
import {
  assertSignedRecordRoundTrip,
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  FIXTURE_FILE_BYTES,
  memoryWriteStoreFactory,
  resetFixtureIds,
  roundedClaimStoreFactory,
  RoundTripFailure,
  seedAthletes,
  seedRide,
  signedRecordFor,
  type StoreHarness,
} from './testing';
import {
  createWebCryptoKeystore,
  generateDeviceKey,
  signingKeyFor,
  webCryptoSha256,
  webCryptoVerifier,
} from './web-crypto';

let harness: StoreHarness;

beforeEach(() => {
  resetFixtureIds();
  harness = createStoreHarness();
});

afterEach(async () => {
  await harness.destroy();
});

/** The signing key an athlete on this harness would use. */
async function keyFor(owner = ATHLETE_A) {
  return harness.write(async (store) =>
    ensureSigningKey(
      createWebCryptoKeystore(store, owner, { now: () => unixSeconds(1_700_000_100) }),
    ),
  );
}

describe('the device key', () => {
  it('survives a fresh connection and can still sign', async () => {
    // The whole of "generated on first run, persisted locally". A `CryptoKey`
    // is stored as a handle, so this is also the assertion that the handle
    // survives the structured clone algorithm — if it did not, the key would
    // read back as an inert object and the failure would surface as a
    // `TypeError` inside `subtle.sign` at the first ride finish.
    await seedAthletes(harness);
    const created = await keyFor();

    const reread = await harness.read(async (store) => store.getDeviceKey(ATHLETE_A));
    const signature = await harness.read(async (store) => {
      const key = await ensureSigningKey(createWebCryptoKeystore(store, ATHLETE_A));
      return key.sign(new Uint8Array([1, 2, 3]));
    });

    expect(reread?.publicKey).toBe(toHex(created.publicKey));
    expect(reread?.createdAt).toBe(1_700_000_100);
    expect(signature).toHaveLength(64);
  });

  it('reuses the identity on a second launch rather than making a new one', async () => {
    // The failure this prevents is #61's first acceptance criterion: an
    // athlete's whole history splitting across two identities after a browser
    // restart. Each `harness.read` is a fresh connection, which is the closest
    // thing this suite has to a restart.
    await seedAthletes(harness);
    const first = await keyFor();

    const second = await harness.read(async (store) =>
      ensureSigningKey(createWebCryptoKeystore(store, ATHLETE_A)),
    );
    const third = await harness.read(async (store) =>
      ensureSigningKey(createWebCryptoKeystore(store, ATHLETE_A)),
    );

    expect(toHex(second.publicKey)).toBe(toHex(first.publicKey));
    expect(toHex(third.publicKey)).toBe(toHex(first.publicKey));
  });

  it('gives two athletes on one device two identities', async () => {
    await seedAthletes(harness);

    const a = await keyFor(ATHLETE_A);
    const b = await keyFor(ATHLETE_B);

    expect(toHex(b.publicKey)).not.toBe(toHex(a.publicKey));
  });

  it('never answers one athlete’s key lookup with another’s', async () => {
    await seedAthletes(harness);
    await keyFor(ATHLETE_A);

    const other = await harness.read(async (store) => store.getDeviceKey(ATHLETE_B));

    expect(other).toBeUndefined();
  });

  it('refuses to replace an identity with a different one', async () => {
    // Write-once. Replacing an identity silently is the history-splitting
    // failure again, arriving from the write path instead of the read path.
    await seedAthletes(harness);
    await keyFor();
    const impostor = await generateDeviceKey(ATHLETE_A, unixSeconds(1_700_000_200));

    await expect(harness.write(async (store) => store.putDeviceKey(impostor))).rejects.toThrow(
      StoreValidationError,
    );
  });

  it('accepts the same key twice, so a retry after a crash is not an error', async () => {
    await seedAthletes(harness);
    const record = await generateDeviceKey(ATHLETE_A, unixSeconds(1_700_000_100));

    await harness.write(async (store) => store.putDeviceKey(record));
    await expect(harness.write(async (store) => store.putDeviceKey(record))).resolves.toBe(
      ATHLETE_A,
    );
  });

  it('gives both racing creators the same identity', async () => {
    // Two tabs opening for the first time at the same moment. Both `load()`
    // return undefined and both `create()`; the second write is refused and the
    // loser adopts the winner, because the alternative outcomes are "one tab
    // cannot sign" and "the athlete now has two identities".
    await seedAthletes(harness);

    const [a, b] = await harness.write(async (store) =>
      Promise.all([
        ensureSigningKey(createWebCryptoKeystore(store, ATHLETE_A)),
        ensureSigningKey(createWebCryptoKeystore(store, ATHLETE_A)),
      ]),
    );

    expect(toHex(b.publicKey)).toBe(toHex(a.publicKey));
    const stored = await harness.read(async (store) => store.getDeviceKey(ATHLETE_A));
    expect(stored?.publicKey).toBe(toHex(a.publicKey));
  });

  it('refuses a key for an athlete who does not exist', async () => {
    const orphan = await generateDeviceKey(athleteId('nobody'), unixSeconds(1));

    await expect(harness.write(async (store) => store.putDeviceKey(orphan))).rejects.toThrow(
      StoreReferentialError,
    );
  });
});

describe('a signed record', () => {
  it('round-trips and verifies on a fresh connection, from its own public key', async () => {
    // #61's third acceptance criterion, in one call: the in-memory objects and
    // the writing handle are both discarded, and the check uses nothing but the
    // record — no `SigningKey`, no key from the store.
    await seedAthletes(harness);
    const ride = await seedRide(harness, ATHLETE_A);
    const key = await keyFor();

    const read = await assertSignedRecordRoundTrip(
      harness,
      await signedRecordFor(ride, key),
      webCryptoVerifier,
    );

    expect(read.record.publicKey).toBe(toHex(key.publicKey));
    expect(read.record.claims.activityId).toBe(ride.id);
  });

  it('still verifies against the activity file it vouches for', async () => {
    await seedAthletes(harness);
    const ride = await seedRide(harness, ATHLETE_A);
    const key = await keyFor();
    await harness.write(async (store) => store.putActivityRecord(await signedRecordFor(ride, key)));

    const read = await harness.read(async (store) => store.getActivityRecord(ATHLETE_A, ride.id));
    const outcome = await verifyActivityRecord(read?.record, {
      verifier: webCryptoVerifier,
      fileDigest: await webCryptoSha256(FIXTURE_FILE_BYTES),
    });

    expect(outcome.status).toBe('verified');
  });

  it('reports content-mismatch when one byte of the file changes', async () => {
    // #61's fifth criterion, end to end through the store: the record read back
    // is authentic, and the *file* is not the one it vouches for. Which check
    // failed is the assertion — a boolean would be the wrong answer here.
    await seedAthletes(harness);
    const ride = await seedRide(harness, ATHLETE_A);
    const key = await keyFor();
    await harness.write(async (store) => store.putActivityRecord(await signedRecordFor(ride, key)));
    const tampered = Uint8Array.from(FIXTURE_FILE_BYTES);
    tampered[2] = (tampered[2] ?? 0) ^ 0x01;

    const read = await harness.read(async (store) => store.getActivityRecord(ATHLETE_A, ride.id));
    const outcome = await verifyActivityRecord(read?.record, {
      verifier: webCryptoVerifier,
      fileDigest: await webCryptoSha256(tampered),
    });

    expect(outcome.status).toBe('content-mismatch');
  });

  it('never answers one athlete’s record lookup with another’s', async () => {
    await seedAthletes(harness);
    const ride = await seedRide(harness, ATHLETE_A);
    const key = await keyFor();
    await harness.write(async (store) => store.putActivityRecord(await signedRecordFor(ride, key)));

    const other = await harness.read(async (store) => store.getActivityRecord(ATHLETE_B, ride.id));

    expect(other).toBeUndefined();
  });

  it('refuses a record filed against another athlete’s ride', async () => {
    await seedAthletes(harness);
    const ride = await seedRide(harness, ATHLETE_A);
    const key = await keyFor(ATHLETE_B);
    const row = await signedRecordFor(ride, key);

    await expect(
      harness.write(async (store) => store.putActivityRecord({ ...row, athleteId: ATHLETE_B })),
    ).rejects.toThrow(StoreReferentialError);
  });

  it('refuses a second athlete’s attempt to overwrite an existing record', async () => {
    // The scoping guard is the activity lookup: athlete B does not own ride-1,
    // so the write is refused before it can replace athlete A's row. There is
    // no separate ownership check on the record row and there does not need to
    // be — `putActivity` already makes an activity id belong to one athlete.
    await seedAthletes(harness);
    const ride = await seedRide(harness, ATHLETE_A);
    const key = await keyFor();
    const mine = await signedRecordFor(ride, key);
    await harness.write(async (store) => store.putActivityRecord(mine));
    const keyB = await keyFor(ATHLETE_B);

    await expect(
      harness.write(async (store) =>
        store.putActivityRecord({ ...(await signedRecordFor(ride, keyB)), athleteId: ATHLETE_B }),
      ),
    ).rejects.toThrow(StoreReferentialError);
    const survived = await harness.read(async (store) =>
      store.getActivityRecord(ATHLETE_A, ride.id),
    );
    expect(survived?.record.signature).toBe(mine.record.signature);
  });

  it('refuses a record whose claims name a different ride', async () => {
    // A correctly signed record for ride A, filed as the record for ride B,
    // would verify perfectly — so this store would have performed the forgery
    // itself. Refused before the transaction opens.
    await seedAthletes(harness);
    const first = await seedRide(harness, ATHLETE_A);
    const second = await seedRide(harness, ATHLETE_A);
    const key = await keyFor();
    const row = await signedRecordFor(first, key);

    await expect(
      harness.write(async (store) => store.putActivityRecord({ ...row, activityId: second.id })),
    ).rejects.toThrow(StoreValidationError);
  });

  it('refuses a record for an activity that does not exist', async () => {
    await seedAthletes(harness);
    const ride = await seedRide(harness, ATHLETE_A);
    const key = await keyFor();
    const row = await signedRecordFor({ ...ride, id: activityId('ghost') }, key);

    await expect(harness.write(async (store) => store.putActivityRecord(row))).rejects.toThrow(
      StoreReferentialError,
    );
  });

  it('refuses to decode a row somebody hand-edited into an unreadable record', async () => {
    // What comes back out of IndexedDB is untrusted — `persisted.ts`'s rule,
    // and a signed record has the stronger reason: it may have arrived from
    // somebody else's device.
    await seedAthletes(harness);
    const ride = await seedRide(harness, ATHLETE_A);
    const key = await keyFor();
    const row = await signedRecordFor(ride, key);
    await harness.write(async (store) =>
      store.putActivityRecord({
        ...row,
        record: { ...row.record, publicKey: 'not-a-key' },
      }),
    );

    await expect(
      harness.read(async (store) => store.getActivityRecord(ATHLETE_A, ride.id)),
    ).rejects.toThrow(StoreDecodeError);
  });
});

describe('the round-trip assertion can fail', () => {
  it('goes red against a store that tidies one claim on its way in', async () => {
    // The proof that `assertSignedRecordRoundTrip` is an assertion and not a
    // ceremony. The fake writes through the real store, in a real transaction
    // that really commits, and the record comes back complete and parseable.
    // Only the signature check notices.
    const broken = createStoreHarness({ factory: roundedClaimStoreFactory() });
    try {
      await seedAthletes(broken);
      const ride = await seedRide(broken, ATHLETE_A, { distance: metresWithFraction() });
      const key = await broken.write(async (store) =>
        ensureSigningKey(createWebCryptoKeystore(store, ATHLETE_A)),
      );

      await expect(
        assertSignedRecordRoundTrip(broken, await signedRecordFor(ride, key), webCryptoVerifier),
      ).rejects.toThrow(RoundTripFailure);
    } finally {
      await broken.destroy();
    }
  });

  it('goes red against a store whose writes go to memory', async () => {
    // The other end of the range the fake set covers: nothing is there at all,
    // rather than something that is there and wrong. `memoryWriteStoreFactory`
    // diverts every write path in the package, this one included, so a fresh
    // connection sees neither the identity nor the record.
    const broken = createStoreHarness({ factory: memoryWriteStoreFactory() });
    try {
      await seedAthletes(broken);
      const ride = await seedRide(broken, ATHLETE_A);
      // The key is made outside the store, because on this harness the athlete
      // row went to memory too and the keystore's write would be refused for
      // the wrong reason — a referential error, not the absence under test.
      const key = signingKeyFor(await generateDeviceKey(ATHLETE_A, unixSeconds(1)));
      await broken.write(async (store) =>
        store.putDeviceKey(await generateDeviceKey(ATHLETE_A, unixSeconds(1))),
      );

      await expect(
        assertSignedRecordRoundTrip(broken, await signedRecordFor(ride, key), webCryptoVerifier),
      ).rejects.toThrow(RoundTripFailure);
      await expect(
        broken.read(async (store) => store.getDeviceKey(ATHLETE_A)),
      ).resolves.toBeUndefined();
    } finally {
      await broken.destroy();
    }
  });

  it('goes green against the real store with the same fixture', async () => {
    // The other half, and the one that makes the test above evidence rather
    // than a fixture that fails for its own reasons: the identical assertion
    // body, against `ActivityStore`.
    await seedAthletes(harness);
    const ride = await seedRide(harness, ATHLETE_A, { distance: metresWithFraction() });
    const key = await keyFor();

    await expect(
      assertSignedRecordRoundTrip(harness, await signedRecordFor(ride, key), webCryptoVerifier),
    ).resolves.toMatchObject({ activityId: ride.id });
  });
});

describe('cascades', () => {
  it('deletes the signed record with the activity it vouches for', async () => {
    await seedAthletes(harness);
    const ride = await seedRide(harness, ATHLETE_A);
    const key = await keyFor();
    await harness.write(async (store) => store.putActivityRecord(await signedRecordFor(ride, key)));

    await harness.write(async (store) => store.deleteActivity(ATHLETE_A, ride.id));
    const left = await harness.read(async (store) => store.getActivityRecord(ATHLETE_A, ride.id));

    expect(left).toBeUndefined();
  });

  it('deletes the device key and every record with the athlete', async () => {
    // Erasure that left the key behind would leave the private half of the
    // athlete's identity on the device after they asked for everything about
    // them to be removed — and it is the one value here that can still act on
    // their behalf.
    await seedAthletes(harness);
    const ride = await seedRide(harness, ATHLETE_A);
    const key = await keyFor();
    await harness.write(async (store) => store.putActivityRecord(await signedRecordFor(ride, key)));

    await harness.write(async (store) => store.deleteAthlete(ATHLETE_A));
    const leftKey = await harness.read(async (store) => store.getDeviceKey(ATHLETE_A));
    const leftRecord = await harness.read(async (store) =>
      store.getActivityRecord(ATHLETE_A, ride.id),
    );

    expect(leftKey).toBeUndefined();
    expect(leftRecord).toBeUndefined();
  });

  it('leaves another athlete’s key and records alone', async () => {
    await seedAthletes(harness);
    const rideB = await seedRide(harness, ATHLETE_B);
    const keyB = await keyFor(ATHLETE_B);
    await harness.write(async (store) =>
      store.putActivityRecord(await signedRecordFor(rideB, keyB)),
    );
    await keyFor(ATHLETE_A);

    await harness.write(async (store) => store.deleteAthlete(ATHLETE_A));
    const survivingKey = await harness.read(async (store) => store.getDeviceKey(ATHLETE_B));
    const survivingRecord = await harness.read(async (store) =>
      store.getActivityRecord(ATHLETE_B, rideB.id),
    );

    expect(survivingKey?.publicKey).toBe(toHex(keyB.publicKey));
    expect(survivingRecord?.record.claims.activityId).toBe(rideB.id);
  });
});

/**
 * A distance with a fractional part.
 *
 * The `roundedClaimStoreFactory` fake rounds `distance` to a whole metre, so a
 * fixture whose distance is already whole would make that fake a no-op and the
 * red test above would be green for the wrong reason. Stated here rather than
 * inline so the dependency between the fixture and the fake is written down.
 */
function metresWithFraction(): Metres {
  return metres(120_000.5);
}
