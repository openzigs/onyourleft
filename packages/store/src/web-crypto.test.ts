// SPDX-License-Identifier: Apache-2.0

/**
 * The far side of the signing seam: the WebCrypto primitive, the keystore's
 * conditional write, and what a hand-edited key row decodes to.
 *
 * The paths here are the ones a store-level round trip cannot reach on its own
 * — a hostile public key, a lost creation race, a row somebody typed into a
 * devtools pane — and every one of them is a place where the wrong behaviour is
 * an unhandled rejection in a list view rather than a stated failure.
 */

import { toHex, unixSeconds, type SigningKey } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { StoreDecodeError, StoreValidationError } from './errors';
import { athleteId } from './ids';
import { fromPersistedDeviceKey, type DeviceKeyRecord } from './identity';
import {
  createWebCryptoKeystore,
  generateDeviceKey,
  signingKeyFor,
  webCryptoSha256,
  webCryptoVerifier,
  type DeviceKeyStorage,
} from './web-crypto';

const OWNER = athleteId('athlete-a');

describe('webCryptoVerifier', () => {
  it('verifies a signature the matching key produced', async () => {
    const record = await generateDeviceKey(OWNER, unixSeconds(1));
    const key: SigningKey = signingKeyFor(record);
    const message = new Uint8Array([1, 2, 3, 4]);

    await expect(
      webCryptoVerifier.verify({
        publicKey: key.publicKey,
        message,
        signature: await key.sign(message),
      }),
    ).resolves.toBe(true);
  });

  it('answers false — never throws — for a public key that is not a key', async () => {
    // A record is untrusted input (CLAUDE.md §6). `importKey` rejects with a
    // `DataError` for a key of the wrong length, and a thrown rejection here
    // would become an unhandled one in whatever is rendering somebody else's
    // rides. "This did not verify" is the answer for all of it.
    await expect(
      webCryptoVerifier.verify({
        publicKey: new Uint8Array(31),
        message: new Uint8Array([1]),
        signature: new Uint8Array(64),
      }),
    ).resolves.toBe(false);
  });

  it('answers false for a signature of the wrong length', async () => {
    const record = await generateDeviceKey(OWNER, unixSeconds(1));
    const key: SigningKey = signingKeyFor(record);

    await expect(
      webCryptoVerifier.verify({
        publicKey: key.publicKey,
        message: new Uint8Array([1]),
        signature: new Uint8Array(63),
      }),
    ).resolves.toBe(false);
  });
});

describe('webCryptoSha256', () => {
  it('is SHA-256, checked against the published digest of the empty input', async () => {
    // FIPS 180-4's SHA-256 of zero bytes. Pinned against a constant from
    // outside this repository rather than against our own output, so a digest
    // that changed would be caught rather than re-recorded.
    expect(toHex(await webCryptoSha256(new Uint8Array()))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('the keystore’s conditional write', () => {
  it('adopts the identity that won when its own write is refused', async () => {
    // The two-tab race, made deterministic. A real race is timing-dependent and
    // usually does not collide, so a test that merely started two creations in
    // parallel would pass without ever reaching this path — which is how the
    // recovery would ship untested.
    const winner = await generateDeviceKey(OWNER, unixSeconds(1_700_000_000));
    const storage: DeviceKeyStorage = {
      getDeviceKey: () => Promise.resolve(winner),
      putDeviceKey: () =>
        Promise.reject(new StoreValidationError('athlete athlete-a already has a device key')),
    };

    const key = await createWebCryptoKeystore(storage, OWNER).create();

    expect(toHex(key.publicKey)).toBe(winner.publicKey);
  });

  it('propagates the refusal when there is no winner to adopt', async () => {
    // A refused write with nothing in the store afterwards is not a race — it
    // is a broken store, and swallowing it would leave a caller holding a key
    // that was never persisted and signing records nothing can find.
    const storage: DeviceKeyStorage = {
      getDeviceKey: () => Promise.resolve(undefined),
      putDeviceKey: () => Promise.reject(new StoreValidationError('refused for another reason')),
    };

    await expect(createWebCryptoKeystore(storage, OWNER).create()).rejects.toThrow(
      StoreValidationError,
    );
  });

  it('propagates an error that is not a refusal, unchanged', async () => {
    const storage: DeviceKeyStorage = {
      getDeviceKey: () => Promise.resolve(undefined),
      putDeviceKey: () => Promise.reject(new Error('the disk is on fire')),
    };

    await expect(createWebCryptoKeystore(storage, OWNER).create()).rejects.toThrow(
      'the disk is on fire',
    );
  });

  it('loads nothing on a device that has no key', async () => {
    const storage: DeviceKeyStorage = {
      getDeviceKey: () => Promise.resolve(undefined),
      putDeviceKey: () => Promise.resolve(OWNER),
    };

    await expect(createWebCryptoKeystore(storage, OWNER).load()).resolves.toBeUndefined();
  });

  it('stamps a created key with the clock it was given', async () => {
    let stored: DeviceKeyRecord | undefined;
    const storage: DeviceKeyStorage = {
      getDeviceKey: () => Promise.resolve(stored),
      putDeviceKey: (record) => {
        stored = record;
        return Promise.resolve(record.athleteId);
      },
    };

    await createWebCryptoKeystore(storage, OWNER, {
      now: () => unixSeconds(1_700_000_123),
    }).create();

    expect(stored?.createdAt).toBe(1_700_000_123);
  });
});

describe('decoding a key row that is not what it claims', () => {
  it('refuses a row declaring another signature scheme', async () => {
    const record = await generateDeviceKey(OWNER, unixSeconds(1));

    expect(() =>
      fromPersistedDeviceKey({
        athleteId: OWNER,
        algorithm: 'secp256k1',
        publicKey: record.publicKey,
        privateKey: record.privateKey,
        createdAt: 1,
      }),
    ).toThrow(StoreDecodeError);
  });

  it('refuses a row whose private key is not a private CryptoKey', () => {
    // A hand-edited row, or one written by a build that stored something else.
    // The failure has to be a stated decode error rather than a `TypeError`
    // from inside `subtle.sign` at the end of a ride.
    expect(() =>
      fromPersistedDeviceKey({
        athleteId: OWNER,
        algorithm: 'Ed25519',
        publicKey: 'ab'.repeat(32),
        privateKey: { type: 'public' } as unknown as CryptoKey,
        createdAt: 1,
      }),
    ).toThrow(/private CryptoKey/);
  });

  it('refuses a row with no private key at all', () => {
    expect(() =>
      fromPersistedDeviceKey({
        athleteId: OWNER,
        algorithm: 'Ed25519',
        publicKey: 'ab'.repeat(32),
        privateKey: undefined as unknown as CryptoKey,
        createdAt: 1,
      }),
    ).toThrow(StoreDecodeError);
  });
});

describe('signingKeyFor — the stored halves have to belong together (#161)', () => {
  it('refuses to sign when the advertised public key is not the private handle’s', async () => {
    const mine = await generateDeviceKey(OWNER, unixSeconds(1));
    const stranger = await generateDeviceKey(OWNER, unixSeconds(2));
    // The shape a hand-edited `deviceKeys` row has: this device's private
    // handle, with somebody else's public half beside it.
    const tampered: DeviceKeyRecord = { ...mine, publicKey: stranger.publicKey };

    await expect(signingKeyFor(tampered).sign(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      StoreValidationError,
    );
  });

  it('is not caught by comparing the row with itself, which is why the probe exists', async () => {
    // `putActivityRecord`'s key-binding guard compares `row.record.publicKey`
    // against `deviceKey.publicKey`. On a tampered row both are the *same*
    // altered value, so that comparison agrees with itself and passes. This
    // asserts the harm it misses: a signature the private half produced does
    // not verify against the key the row advertises, so every record signed
    // this way is permanently unverifiable.
    const mine = await generateDeviceKey(OWNER, unixSeconds(1));
    const stranger = await generateDeviceKey(OWNER, unixSeconds(2));
    const tampered: DeviceKeyRecord = { ...mine, publicKey: stranger.publicKey };

    expect(tampered.publicKey).toBe(stranger.publicKey);
    const signature = await signingKeyFor(mine).sign(new Uint8Array([9]));
    await expect(
      webCryptoVerifier.verify({
        publicKey: signingKeyFor(tampered).publicKey,
        message: new Uint8Array([9]),
        signature,
      }),
    ).resolves.toBe(false);
  });

  it('stays refused on a second attempt rather than retrying into a pass', async () => {
    // The probe is memoised so it runs once per key. A memoisation that cached
    // only success — or that re-ran and could be raced — would let the second
    // call through, which is worse than never checking because the first
    // refusal would read as a transient error.
    const mine = await generateDeviceKey(OWNER, unixSeconds(1));
    const stranger = await generateDeviceKey(OWNER, unixSeconds(2));
    const key = signingKeyFor({ ...mine, publicKey: stranger.publicKey });

    await expect(key.sign(new Uint8Array([1]))).rejects.toThrow(StoreValidationError);
    await expect(key.sign(new Uint8Array([2]))).rejects.toThrow(StoreValidationError);
  });

  it('signs, and verifies against what it advertises, when the halves do match', async () => {
    // The other direction: the probe must not stand between a real key and a
    // signature. Without this, deleting the whole check would leave the three
    // assertions above passing for the wrong reason.
    const record = await generateDeviceKey(OWNER, unixSeconds(1));
    const key = signingKeyFor(record);
    const message = new Uint8Array([4, 5, 6]);
    const signature = await key.sign(message);

    expect(toHex(key.publicKey)).toBe(record.publicKey);
    await expect(
      webCryptoVerifier.verify({ publicKey: key.publicKey, message, signature }),
    ).resolves.toBe(true);
  });
});
