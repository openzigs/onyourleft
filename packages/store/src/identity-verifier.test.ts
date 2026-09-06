// SPDX-License-Identifier: Apache-2.0

/**
 * **A verifier written from the record spec, not against this project's code.**
 *
 * #61's fourth acceptance criterion, and the one the whole format exists to
 * satisfy: *"If only our own code can check our own signature, the format is
 * not portable and the whole point is lost."*
 *
 * So `verifyFromTheSpec` and every helper it reaches are written from
 * `docs/architecture.md`'s *The signed activity record* section and from
 * RFC 8785, and call **nothing** from `@onyourleft/domain`:
 *
 * | Step | This file | What the product does |
 * |---|---|---|
 * | canonicalise | `JSON.stringify` per member, keys sorted with a plain `sort()` | `identity/canonical.ts`, written out longhand |
 * | UTF-8 encode | `TextEncoder` | a hand-written encoder, because `packages/domain` may not name one |
 * | hex decode | `match(/../g)` + `parseInt` | `identity/hex.ts` |
 * | verify | `crypto.subtle.verify` directly | the same, behind `SignatureVerifier` |
 * | digest | `crypto.subtle.digest` directly | the same, behind `Sha256` |
 *
 * That is roughly what a third-party verifier would be in any language with a
 * stock JCS library, and it is deliberately a **different implementation** of
 * every step rather than a wrapper around ours. A test that imported
 * `signingInput` would prove only that our code agrees with itself.
 *
 * ⚠️ **The last test in the file is the deliberate exception, and it calls
 * both.** An independent verifier that returns both booleans and never
 * short-circuits — which is the right shape for a spec implementation — is
 * structurally blind to the product taking those two checks in the wrong
 * *order*, and that is a real defect this PR's review found. Closing it needs
 * one test that runs the two side by side and asserts they agree, so that test
 * imports `verifyActivityRecord`. Nothing above the fixture line does.
 *
 * The reason `JSON.stringify` is a legitimate independent canonicaliser here:
 * RFC 8785 is *specified in terms of ECMAScript* — its number rule is
 * `Number::toString` and its string rule is JSON's minimal escaping — so a
 * JavaScript verifier that sorts the members and lets `JSON.stringify` do the
 * rest is a conforming implementation, and a wrong one would disagree with ours
 * loudly rather than silently.
 */

import { ensureSigningKey, unixSeconds, verifyActivityRecord } from '@onyourleft/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ATHLETE_A,
  createStoreHarness,
  FIXTURE_FILE_BYTES,
  resetFixtureIds,
  seedAthletes,
  seedRide,
  signedRecordFor,
  type StoreHarness,
} from './testing';
import { createWebCryptoKeystore, webCryptoSha256, webCryptoVerifier } from './web-crypto';

// --- The independent verifier ----------------------------------------------

/** RFC 8785, in the shortest conforming form JavaScript admits. */
function canonicalise(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalise).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const object = value as Record<string, unknown>;
    const members = Object.keys(object)
      .filter((member) => object[member] !== undefined)
      // Default `sort` compares by UTF-16 code unit, which is what §3.2.3 asks
      // for.
      .sort()
      .map((member) => `${JSON.stringify(member)}:${canonicalise(object[member])}`);
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value);
}

function bytesFromHex(hex: string): Uint8Array<ArrayBuffer> {
  const pairs = hex.match(/../g) ?? [];
  const bytes = new Uint8Array(pairs.length);
  pairs.forEach((pair, index) => {
    bytes[index] = parseInt(pair, 16);
  });
  return bytes;
}

/** What a stranger holding the record and the file would run. */
async function verifyFromTheSpec(
  record: unknown,
  activityFile: Uint8Array,
): Promise<{ readonly signature: boolean; readonly contentHash: boolean }> {
  const document = record as Record<string, unknown> & { signature: string };
  expect(document['format']).toBe('onyourleft.activity-record');
  expect(document['version']).toBe(1);
  expect(document['algorithm']).toBe('Ed25519');

  const { signature, ...payload } = document;
  const message = new TextEncoder().encode(canonicalise(payload));
  const key = await crypto.subtle.importKey(
    'raw',
    bytesFromHex(document['publicKey'] as string),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );

  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', activityFile as BufferSource),
  );
  const asHex = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');

  return {
    signature: await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      bytesFromHex(signature),
      message,
    ),
    contentHash: document['contentHash'] === `sha256:${asHex}`,
  };
}

// --- The fixture -----------------------------------------------------------

let harness: StoreHarness;

beforeEach(() => {
  resetFixtureIds();
  harness = createStoreHarness();
});

afterEach(async () => {
  await harness.destroy();
});

/** A record produced by the app, read back the way anybody else would get it. */
async function publishedRecord(): Promise<{ readonly published: unknown }> {
  await seedAthletes(harness);
  const ride = await seedRide(harness, ATHLETE_A, { averagePower: undefined });
  const key = await harness.write(async (store) =>
    ensureSigningKey(
      createWebCryptoKeystore(store, ATHLETE_A, { now: () => unixSeconds(1_700_000_100) }),
    ),
  );
  await harness.write(async (store) => store.putActivityRecord(await signedRecordFor(ride, key)));
  const read = await harness.read(async (store) => store.getActivityRecord(ATHLETE_A, ride.id));

  // Through JSON, because that is how a record leaves a device: a file, not an
  // object graph. Anything that survived only as a live reference would be gone
  // by the time a stranger saw it.
  return { published: JSON.parse(JSON.stringify(read?.record)) as unknown };
}

describe('a verifier written from the spec', () => {
  it('verifies a record this app produced', async () => {
    const { published } = await publishedRecord();

    await expect(verifyFromTheSpec(published, FIXTURE_FILE_BYTES)).resolves.toEqual({
      signature: true,
      contentHash: true,
    });
  });

  it('rejects a record whose claims were edited after signing', async () => {
    const { published } = await publishedRecord();
    const document = published as { claims: Record<string, unknown> };
    const tampered = {
      ...(published as Record<string, unknown>),
      claims: { ...document.claims, distance: 1 },
    };

    await expect(verifyFromTheSpec(tampered, FIXTURE_FILE_BYTES)).resolves.toMatchObject({
      signature: false,
    });
  });

  it('is insensitive to the order the members arrive in', async () => {
    // The property that makes an independent verifier possible at all: a record
    // that went through a JSON library which re-ordered its members still
    // verifies, because the canonicalisation puts them back.
    const { published } = await publishedRecord();
    const document = published as Record<string, unknown>;
    const reversed = Object.fromEntries(Object.entries(document).reverse());

    await expect(verifyFromTheSpec(reversed, FIXTURE_FILE_BYTES)).resolves.toMatchObject({
      signature: true,
    });
  });

  it('notices one changed byte of the activity file, and says it was the hash', async () => {
    const { published } = await publishedRecord();
    const tampered = Uint8Array.from(FIXTURE_FILE_BYTES);
    tampered[5] = (tampered[5] ?? 0) ^ 0x01;

    // The signature is still valid — the signer signed the old bytes — and the
    // content hash is what fails. Reported separately here for the same reason
    // `RecordVerification` reports them separately.
    await expect(verifyFromTheSpec(published, tampered)).resolves.toEqual({
      signature: true,
      contentHash: false,
    });
  });

  it('agrees with the product about a record nobody signed, and does not call it authentic', async () => {
    // The independent verifier above returns **both** booleans and never
    // short-circuits, which is right for a spec implementation and is exactly
    // why it cannot, on its own, see the product taking them in the wrong
    // order. This test is the cross-check that closes that: it asserts the two
    // *agree* on the case where the order is observable.
    //
    // `content-mismatch` is documented as an authenticated answer, so it may
    // only be reached where this file reports `signature: true`. A verifier
    // that hashed first would answer `content-mismatch` below, with the
    // forger's own `contentHash` as its `expected`.
    const { published } = await publishedRecord();
    const forged = {
      ...(published as Record<string, unknown>),
      publicKey: 'ab'.repeat(32),
      signature: 'ff'.repeat(64),
      contentHash: `sha256:${'cd'.repeat(32)}`,
    };

    const independent = await verifyFromTheSpec(forged, FIXTURE_FILE_BYTES);
    const product = await verifyActivityRecord(forged, {
      verifier: webCryptoVerifier,
      fileDigest: await webCryptoSha256(FIXTURE_FILE_BYTES),
    });

    expect(independent).toEqual({ signature: false, contentHash: false });
    expect(product).toEqual({ status: 'signature-mismatch' });
  });
});
