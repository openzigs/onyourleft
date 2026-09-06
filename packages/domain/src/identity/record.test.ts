// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { IdentityError } from './errors';
import { toHex } from './hex';
import {
  canonicalPayload,
  contentHashOf,
  formatContentHash,
  isVerified,
  parseContentHash,
  parseSignedActivityRecord,
  RECORD_FORMAT,
  RECORD_VERSION,
  recordPayload,
  signActivityRecord,
  signingInput,
  verifyActivityRecord,
  verifyRecordSignature,
  type ActivityClaims,
  type SignedActivityRecord,
} from './record';
import { stubSha256, stubSigningKey, stubVerifier } from './testing';
import { utf8Encode } from './utf8';

const FILE_BYTES = new Uint8Array([0x2e, 0x46, 0x49, 0x54, 0x01, 0x02, 0x03]);

const CLAIMS: ActivityClaims = {
  activityId: 'ride-1',
  name: 'Sunday loop',
  startedAt: 1_700_000_000,
  startedAtTimeZone: 'Europe/London',
  elapsedTime: 3_600,
  movingTime: 3_540,
  distance: 42_195.5,
  hasPosition: true,
  averagePower: 214,
};

/**
 * The same claims with no power at all — **absent**, not `undefined`.
 *
 * Spelled as its own literal rather than derived by omitting a member, because
 * the distinction under test is exactly "the member is not there": a claims
 * object carrying `averagePower: undefined` would satisfy `in` and defeat it.
 */
const CLAIMS_WITHOUT_POWER: ActivityClaims = {
  activityId: 'ride-1',
  name: 'Sunday loop',
  startedAt: 1_700_000_000,
  startedAtTimeZone: 'Europe/London',
  elapsedTime: 3_600,
  movingTime: 3_540,
  distance: 42_195.5,
  hasPosition: true,
};

async function sign(
  claims: ActivityClaims = CLAIMS,
  bytes: Uint8Array = FILE_BYTES,
  label = 'athlete-a',
): Promise<SignedActivityRecord> {
  return signActivityRecord(
    { claims, contentHash: await contentHashOf(bytes, stubSha256) },
    stubSigningKey(label),
  );
}

describe('the record format', () => {
  it('carries the format, the version, the scheme, the key, the hash and the claims', async () => {
    const record = await sign();

    expect(record.format).toBe(RECORD_FORMAT);
    expect(record.version).toBe(RECORD_VERSION);
    expect(record.algorithm).toBe('Ed25519');
    expect(record.publicKey).toBe(toHex(stubSigningKey().publicKey));
    expect(record.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(record.claims).toEqual(CLAIMS);
    expect(record.signature).toHaveLength(128);
  });

  it('signs the canonical serialisation of the payload and nothing else', async () => {
    const record = await sign();
    const payload = recordPayload(record);

    // The whole of the spec, in one assertion: a verifier written from
    // docs/architecture.md reproduces exactly this string, UTF-8 encodes it,
    // and checks `signature` over the result.
    expect(record.signature).toHaveLength(128);
    // `TextDecoder` is a platform global and cannot be named in this package,
    // so the comparison runs in the other direction: the signing input is
    // byte-for-byte the UTF-8 encoding of the canonical text.
    expect(toHex(signingInput(payload))).toBe(toHex(utf8Encode(canonicalPayload(payload))));
    expect(canonicalPayload(payload).startsWith('{"algorithm":"Ed25519","claims":{')).toBe(true);
  });

  it('is insensitive to the order the payload was built in', async () => {
    // Built member by member in a deliberately different order. Insertion order
    // is what `JSON.stringify` would preserve and what the canonicalisation
    // must not: two builds that construct the same record differently have to
    // sign the same bytes.
    const record = await sign();
    const payload = recordPayload(record);
    const reordered = {
      claims: payload.claims,
      version: payload.version,
      contentHash: payload.contentHash,
      algorithm: payload.algorithm,
      publicKey: payload.publicKey,
      format: payload.format,
    };

    expect(toHex(signingInput(reordered))).toBe(toHex(signingInput(payload)));
  });

  it('omits an absent optional claim from the signed bytes rather than writing null', async () => {
    const record = await sign(CLAIMS_WITHOUT_POWER);

    expect(canonicalPayload(recordPayload(record))).not.toContain('averagePower');
    expect('averagePower' in record.claims).toBe(false);
  });
});

describe('signActivityRecord — what it refuses to sign', () => {
  it('refuses a content hash that is not sha256:<64 hex>', async () => {
    // A record signed over a malformed hash is a permanently unverifiable
    // artefact in the athlete's history, so this is caught on the way in.
    await expect(
      signActivityRecord({ claims: CLAIMS, contentHash: 'sha256:nope' }, stubSigningKey()),
    ).rejects.toThrow(IdentityError);
  });

  it('refuses a key for another scheme', async () => {
    const wrong = { ...stubSigningKey(), algorithm: 'secp256k1' as 'Ed25519' };

    await expect(
      signActivityRecord(
        { claims: CLAIMS, contentHash: await contentHashOf(FILE_BYTES, stubSha256) },
        wrong,
      ),
    ).rejects.toThrow(/Ed25519/);
  });

  it('refuses a public key that is not 32 bytes', async () => {
    const wrong = { ...stubSigningKey(), publicKey: new Uint8Array(31) };

    await expect(
      signActivityRecord(
        { claims: CLAIMS, contentHash: await contentHashOf(FILE_BYTES, stubSha256) },
        wrong,
      ),
    ).rejects.toThrow(/32 bytes/);
  });

  it('refuses a signature the keystore returned at the wrong length', async () => {
    const wrong = { ...stubSigningKey(), sign: () => Promise.resolve(new Uint8Array(32)) };

    await expect(
      signActivityRecord(
        { claims: CLAIMS, contentHash: await contentHashOf(FILE_BYTES, stubSha256) },
        wrong,
      ),
    ).rejects.toThrow(/64 bytes/);
  });

  it.each([
    ['an empty activityId', { ...CLAIMS, activityId: '' }],
    ['a fractional startedAt', { ...CLAIMS, startedAt: 1.5 }],
    ['a negative distance', { ...CLAIMS, distance: -1 }],
    ['a non-finite elapsedTime', { ...CLAIMS, elapsedTime: Number.NaN }],
    ['an empty time zone', { ...CLAIMS, startedAtTimeZone: '' }],
    ['a name that is not a string', { ...CLAIMS, name: 7 as unknown as string }],
    ['a negative averagePower', { ...CLAIMS, averagePower: -1 }],
  ])('refuses %s', async (_label, claims) => {
    await expect(sign(claims)).rejects.toThrow(IdentityError);
  });

  it('refuses a claim member the format does not name, from a variable and not a literal', async () => {
    // ⚠️ The distinction is the whole test, and every assignment below is
    // deliberate. TypeScript's excess property check fires on object
    // **literals** only, so `{ ...CLAIMS, latitude: 51.5074 }` passed straight
    // to `sign` would be a compile error — and a value of a structurally wider
    // type, which is what a caller spreading a row or a bigger domain object
    // actually holds, is assignable to `ActivityClaims` with no error at all.
    //
    // Without the member check inside `assertClaims` this build signs it: the
    // canonical bytes come out carrying `"latitude":51.5074` — a coordinate
    // inside the artefact ADR 0004 exists to keep coordinates out of — and
    // `parseSignedActivityRecord` then refuses the record this same build has
    // just produced.
    const wider: ActivityClaims & { readonly latitude: number } = { ...CLAIMS, latitude: 51.5074 };
    const claims: ActivityClaims = wider;

    await expect(sign(claims)).rejects.toThrow(/latitude/);
  });

  it('signs nothing the parser would then refuse — the two directions are one predicate', async () => {
    // The property the docstring on `assertClaims` claims, asserted rather
    // than described: anything `signActivityRecord` produces parses back.
    const record = await sign();

    expect(parseSignedActivityRecord(record)).toEqual({ ok: true, record });
  });
});

describe('verifyActivityRecord — the five answers', () => {
  it('verifies a record it produced, against the file it vouches for', async () => {
    const record = await sign();

    const outcome = await verifyActivityRecord(record, {
      verifier: stubVerifier,
      fileDigest: await stubSha256(FILE_BYTES),
    });

    expect(outcome.status).toBe('verified');
    expect(isVerified(outcome)).toBe(true);
  });

  it('reports content-mismatch — not signature-mismatch — when one byte of the file changes', async () => {
    // #61's fifth criterion, and the reason the outcome is a union rather than
    // a boolean: the signature over this record is still perfectly valid. The
    // signer signed a hash of the bytes as they were. Reporting "bad signature"
    // would send a reader looking for a forger who does not exist.
    const record = await sign();
    const tamperedFile = Uint8Array.from(FILE_BYTES);
    tamperedFile[3] = (tamperedFile[3] ?? 0) ^ 0x01;

    const outcome = await verifyActivityRecord(record, {
      verifier: stubVerifier,
      fileDigest: await stubSha256(tamperedFile),
    });

    expect(outcome.status).toBe('content-mismatch');
    // And the signature on its own still checks out, which is what makes the
    // distinction real rather than a label.
    await expect(verifyRecordSignature(record, stubVerifier)).resolves.toEqual({
      status: 'verified',
      record,
    });
  });

  it('reports signature-mismatch — not content-mismatch — for a wholly forged record', async () => {
    // The ordering test, and the reason the signature is checked first.
    // `content-mismatch` is documented as an *authenticated* answer: "the
    // record is authentic; the file is not the one it vouches for". Nothing
    // below was ever signed by anybody — the key and the signature are made up
    // and the content hash is a string the forger chose — so answering
    // `content-mismatch` would assert authenticity about a forgery, and would
    // hand the caller the forger's own `expected` string to display.
    //
    // Note that the file digest deliberately does **not** match the record's
    // contentHash. That is what makes this test sensitive to the order: under
    // a content-first verifier it returns `content-mismatch` and this fails.
    const forged = {
      ...(await sign()),
      publicKey: 'ab'.repeat(32),
      signature: 'ff'.repeat(64),
      contentHash: await contentHashOf(new Uint8Array([0x99]), stubSha256),
    };

    const outcome = await verifyActivityRecord(forged, {
      verifier: stubVerifier,
      fileDigest: await stubSha256(FILE_BYTES),
    });

    expect(outcome).toEqual({ status: 'signature-mismatch' });
  });

  it('throws rather than answering when the caller hands it a digest of the wrong length', async () => {
    // Deliberately not a sixth status. Every member of `RecordVerification` is
    // a statement about the *record*; a digest of the wrong length is a bug in
    // the caller, and answering it with a status would let that bug be logged
    // as somebody's ride failing to verify.
    const record = await sign();

    await expect(
      verifyActivityRecord(record, { verifier: stubVerifier, fileDigest: new Uint8Array(16) }),
    ).rejects.toThrow(IdentityError);
  });

  it('throws for that digest even when the record is forged, not only when it verifies', async () => {
    // ⚠️ The gap (#167). The length was reached through `formatContentHash`,
    // which sits *after* `checkSignature` returns `verified` — so this same
    // caller bug came back as `signature-mismatch` for a forged record, and the
    // clause above held for only half its inputs. A caller whose digest is the
    // wrong length would then read "somebody's ride failed to verify" and fix
    // the wrong thing, which is the exact outcome that clause exists to prevent.
    const forged = {
      ...(await sign()),
      publicKey: 'ab'.repeat(32),
      signature: 'ff'.repeat(64),
    };

    await expect(
      verifyActivityRecord(forged, { verifier: stubVerifier, fileDigest: new Uint8Array(16) }),
    ).rejects.toThrow(IdentityError);
  });

  it('still answers signature-mismatch for that forged record when the digest is well formed', async () => {
    // The check is ordered in front of the signature and must not swallow the
    // answer it was placed before: with a correct digest the signature-first
    // ordering `docs/architecture.md` publishes is unchanged.
    const forged = {
      ...(await sign()),
      publicKey: 'ab'.repeat(32),
      signature: 'ff'.repeat(64),
    };

    const outcome = await verifyActivityRecord(forged, {
      verifier: stubVerifier,
      fileDigest: await stubSha256(FILE_BYTES),
    });

    expect(outcome.status).toBe('signature-mismatch');
  });

  it('reports signature-mismatch when a claim is edited after signing', async () => {
    const record = await sign();
    const tampered = { ...record, claims: { ...record.claims, distance: 1 } };

    const outcome = await verifyActivityRecord(tampered, {
      verifier: stubVerifier,
      fileDigest: await stubSha256(FILE_BYTES),
    });

    expect(outcome.status).toBe('signature-mismatch');
  });

  it('reports signature-mismatch when the content hash is swapped for another file’s', async () => {
    // Both halves have to be covered by the signature, or a record could be
    // re-pointed at a different ride and still verify.
    const record = await sign();
    const other = await contentHashOf(new Uint8Array([9, 9, 9]), stubSha256);
    const repointed = { ...record, contentHash: other };

    const outcome = await verifyActivityRecord(repointed, {
      verifier: stubVerifier,
      fileDigest: await stubSha256(new Uint8Array([9, 9, 9])),
    });

    expect(outcome.status).toBe('signature-mismatch');
  });

  it('reports signature-mismatch when another athlete’s key is substituted', async () => {
    const record = await sign();
    const impostor = { ...record, publicKey: toHex(stubSigningKey('athlete-b').publicKey) };

    const outcome = await verifyActivityRecord(impostor, {
      verifier: stubVerifier,
      fileDigest: await stubSha256(FILE_BYTES),
    });

    expect(outcome.status).toBe('signature-mismatch');
  });

  it('reports unsupported — not malformed, and not a forgery — for a newer version', async () => {
    const record = await sign();

    const outcome = await verifyRecordSignature({ ...record, version: 2 }, stubVerifier);

    expect(outcome).toEqual({
      status: 'unsupported',
      reason: expect.stringContaining('2') as unknown,
    });
  });

  it('reports malformed through the full check too, not only the signature-only one', async () => {
    // The two entry points share a parser, and the full one has to return the
    // parse outcome rather than fall through to a content-hash comparison
    // against a record it has not established the shape of.
    const outcome = await verifyActivityRecord(
      { format: 'strava.activity' },
      { verifier: stubVerifier, fileDigest: await stubSha256(FILE_BYTES) },
    );

    expect(outcome.status).toBe('malformed');
  });

  it('reports unsupported for a scheme this build does not have', async () => {
    const record = await sign();

    const outcome = await verifyRecordSignature(
      { ...record, algorithm: 'secp256k1' },
      stubVerifier,
    );

    expect(outcome.status).toBe('unsupported');
  });
});

describe('parseSignedActivityRecord — an untrusted-input boundary', () => {
  it.each([
    ['not an object', 42],
    ['null', null],
    ['an array', []],
    ['the wrong format string', { format: 'strava.activity' }],
  ])('reports malformed for %s', (_label, value) => {
    const parsed = parseSignedActivityRecord(value);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? undefined : parsed.outcome.status).toBe('malformed');
  });

  it('refuses a member it does not know, rather than trimming it', async () => {
    // Trimming would mean the bytes re-canonicalised for the check are not the
    // bytes that were signed, so the record would come back as a forgery. And
    // rejecting is what stops a member riding along inside a record this build
    // would then store and re-serve.
    const record = await sign();

    const parsed = parseSignedActivityRecord({ ...record, extra: 1 });

    expect(parsed.ok ? undefined : parsed.outcome).toEqual({
      status: 'malformed',
      reason: expect.stringContaining('extra') as unknown,
    });
  });

  it('refuses a claims member it does not know — a latitude included', async () => {
    // The runtime half of "the record contains no location data". The type
    // forbids it at compile time; this forbids it for a record arriving as JSON
    // from somebody else's device.
    const record = await sign();

    const parsed = parseSignedActivityRecord({
      ...record,
      claims: { ...record.claims, latitude: 51.5074 },
    });

    expect(parsed.ok ? undefined : parsed.outcome).toEqual({
      status: 'malformed',
      reason: expect.stringContaining('latitude') as unknown,
    });
  });

  it.each([
    ['an uppercase public key', 'publicKey', 'AB'.repeat(32)],
    ['a short public key', 'publicKey', 'ab'.repeat(31)],
    ['a short signature', 'signature', 'ab'.repeat(63)],
    ['a non-string content hash', 'contentHash', 7],
    ['a content hash with no algorithm prefix', 'contentHash', 'ab'.repeat(32)],
  ])('reports malformed for %s', async (_label, member, value) => {
    const record = await sign();

    const parsed = parseSignedActivityRecord({ ...record, [member]: value });

    expect(parsed.ok ? undefined : parsed.outcome.status).toBe('malformed');
  });

  it('reports malformed for claims that are not an object', async () => {
    const record = await sign();

    expect(parseSignedActivityRecord({ ...record, claims: 'ride' }).ok).toBe(false);
  });

  it('reports malformed for a claim of the wrong type, naming the member', async () => {
    const record = await sign();

    const parsed = parseSignedActivityRecord({
      ...record,
      claims: { ...record.claims, hasPosition: 'yes' },
    });

    expect(parsed.ok ? undefined : parsed.outcome).toEqual({
      status: 'malformed',
      reason: expect.stringContaining('hasPosition') as unknown,
    });
  });

  it('accepts a record that came back through JSON, which is how one arrives', async () => {
    const record = await sign();

    const parsed = parseSignedActivityRecord(JSON.parse(JSON.stringify(record)));

    expect(parsed.ok && parsed.record).toEqual(record);
  });

  it('accepts a record with no averagePower, and does not invent one', async () => {
    const record = await sign(CLAIMS_WITHOUT_POWER);

    const parsed = parseSignedActivityRecord(JSON.parse(JSON.stringify(record)));

    expect(parsed.ok && 'averagePower' in parsed.record.claims).toBe(false);
  });
});

describe('content hashes', () => {
  it('formats and parses a digest round trip', () => {
    const digest = new Uint8Array(32).fill(0xab);

    expect(formatContentHash(digest)).toBe(`sha256:${'ab'.repeat(32)}`);
    expect([...parseContentHash(formatContentHash(digest))]).toEqual([...digest]);
  });

  it('refuses a digest that is not 32 bytes', () => {
    expect(() => formatContentHash(new Uint8Array(16))).toThrow(/32 bytes/);
  });

  it('refuses a hash with no algorithm prefix, so the algorithm is never assumed', () => {
    expect(() => parseContentHash('ab'.repeat(32))).toThrow(/sha256:/);
  });
});
