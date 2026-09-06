// SPDX-License-Identifier: Apache-2.0

/**
 * The signed, content-addressed activity record — #61, decided in ADR 0014.
 *
 * ## The format, in one paragraph
 *
 * A record is a JSON object with seven members. Six of them are the **payload**
 * and the seventh, `signature`, is an Ed25519 signature over the RFC 8785
 * canonical serialisation of the other six, UTF-8 encoded. The payload names
 * the format and its version, the signature scheme, the signer's 32-byte public
 * key as lowercase hex, the SHA-256 of the activity file the record vouches
 * for, and a small set of **claims** about the ride. That is the whole of it,
 * and it is written out in `docs/architecture.md` so that a verifier can be
 * written from the prose without reading this file.
 *
 * ```json
 * {
 *   "algorithm": "Ed25519",
 *   "claims": { "activityId": "...", "distance": 42195.5, ... },
 *   "contentHash": "sha256:e3b0c442...",
 *   "format": "onyourleft.activity-record",
 *   "publicKey": "d75a980182b1...",
 *   "signature": "92a009a9f0d4...",
 *   "version": 1
 * }
 * ```
 *
 * ## Why the file is referenced rather than embedded
 *
 * #61's sixth acceptance criterion: the record itself carries **no location
 * data**, so that publishing a record can never be the thing that leaks a home
 * address (#21, ADR 0004). The ride's shape lives in the FIT file; the record
 * says "the file with these bytes is mine, and here is what it is a summary
 * of". Someone who holds the record and not the file learns the distance and
 * the duration — which is what a public activity list shows anyway — and
 * nothing about where.
 *
 * That is enforced three ways, because a comment is not enforcement:
 *
 * 1. {@link ActivityClaims} has no coordinate member, so a literal carrying one
 *    fails to compile (excess property checking).
 * 2. {@link parseSignedActivityRecord} rejects **any** member it does not name,
 *    at both levels, so a record arriving over the wire with a `latitude`
 *    cannot be parsed into one this build will verify.
 * 3. `record-safety.test.ts` serialises a record built from the widest fixture
 *    the fixtures offer and fails if the text contains a coordinate-shaped
 *    member name.
 *
 * ## Verification answers five different questions
 *
 * The issue asks for this specifically: "a tampered record and an unverifiable
 * one (unknown key, wrong algorithm version) are different answers and the type
 * should say so". {@link RecordVerification} is that type. In particular a
 * record whose **activity file** has changed by one byte comes back as
 * `content-mismatch` and **not** as `signature-mismatch` — the signature is
 * still perfectly valid, because the signer signed a hash of the old bytes, and
 * saying "bad signature" there would send a reader looking for a forger who
 * does not exist.
 */

import { canonicalJson, type CanonicalObject } from './canonical';
import { IdentityError } from './errors';
import { fromHex, isHexOfLength, toHex } from './hex';
import {
  DIGEST_BYTES,
  PUBLIC_KEY_BYTES,
  SIGNATURE_ALGORITHM,
  SIGNATURE_BYTES,
  type SignatureVerifier,
  type Sha256,
  type SigningKey,
} from './seam';
import { utf8Encode } from './utf8';

/** The `format` member. Constant; it is what makes a stray JSON object not a record. */
export const RECORD_FORMAT = 'onyourleft.activity-record';

/**
 * The `version` member.
 *
 * **1, and provisional until #56.** ADR 0014 records the reasoning: a format
 * that changes now is an edit, and a format that changes after ten thousand
 * rides exist is a migration, so the version member is here from the first
 * record rather than added when it is first needed. A verifier that does not
 * know a version must refuse it — {@link verifyActivityRecord} returns
 * `unsupported-version` — rather than guess at the member set, because guessing
 * is how a member outside the signature gets treated as though it were inside.
 */
export const RECORD_VERSION = 1;

/** The digest algorithm prefix on `contentHash`. */
const CONTENT_HASH_PREFIX = 'sha256:';

/**
 * What the record claims about the ride.
 *
 * A deliberately small set: the fields #62's list row renders and #35's export
 * carries, and nothing else. Every member is required except the two marked
 * optional, and an optional member is **absent** rather than null — see
 * `canonical.ts`.
 *
 * **No coordinate member exists here and none may be added.** A position
 * summary is what ADR 0004's "Constraints this places on other work" item 1
 * forbids, and this type is the compile-time half of that. `hasPosition` is one
 * bit and is the same bit `ActivityRecord.hasPosition` already carries.
 */
export interface ActivityClaims {
  /** The device-local activity id. Opaque off the device; it identifies the ride to its owner. */
  readonly activityId: string;
  /** The athlete's own name for the ride. */
  readonly name: string;
  /** Start instant, integer seconds since the Unix epoch. */
  readonly startedAt: number;
  /** IANA zone the ride started in — `'Europe/London'`. Never an offset; see `records.ts`. */
  readonly startedAtTimeZone: string;
  /** Wall-clock seconds from start to finish, pauses included. */
  readonly elapsedTime: number;
  /** Seconds excluding pauses. */
  readonly movingTime: number;
  /** Metres. */
  readonly distance: number;
  /** Whether the ride has any position samples at all. One bit, never a coordinate. */
  readonly hasPosition: boolean;
  /** Watts, if the ride has power. */
  readonly averagePower?: number;
}

/** The six members the signature is taken over. */
export interface ActivityRecordPayload {
  readonly format: typeof RECORD_FORMAT;
  readonly version: typeof RECORD_VERSION;
  readonly algorithm: typeof SIGNATURE_ALGORITHM;
  /** The signer's 32-byte Ed25519 public key, lowercase hex — 64 characters. */
  readonly publicKey: string;
  /** `sha256:` followed by the lowercase hex SHA-256 of the activity file's bytes. */
  readonly contentHash: string;
  readonly claims: ActivityClaims;
}

/** A payload and its signature: 64 bytes of Ed25519 as lowercase hex. */
export interface SignedActivityRecord extends ActivityRecordPayload {
  readonly signature: string;
}

/** `sha256:<64 lowercase hex>` for a digest. @throws {IdentityError} */
export function formatContentHash(digest: Uint8Array): string {
  if (digest.length !== DIGEST_BYTES) {
    throw new IdentityError(
      `a SHA-256 digest is ${String(DIGEST_BYTES)} bytes, and this one is ${String(digest.length)}`,
    );
  }
  return `${CONTENT_HASH_PREFIX}${toHex(digest)}`;
}

/** The digest inside a `sha256:...` content hash. @throws {IdentityError} */
export function parseContentHash(value: string): Uint8Array {
  if (!value.startsWith(CONTENT_HASH_PREFIX)) {
    throw new IdentityError(`a content hash must begin with "${CONTENT_HASH_PREFIX}"`);
  }
  return fromHex(value.slice(CONTENT_HASH_PREFIX.length), 'a content hash', DIGEST_BYTES);
}

/** `sha256:...` for the bytes of an activity file. */
export async function contentHashOf(bytes: Uint8Array, sha256: Sha256): Promise<string> {
  return formatContentHash(await sha256(bytes));
}

/**
 * The exact bytes a signature is taken over: the payload, canonicalised.
 *
 * Exported because it is half the record spec, and because an independent
 * verifier written against `docs/architecture.md` should be checkable against
 * it. Nothing in the payload is re-ordered or re-formatted here — `canonical.ts`
 * does all of it, from the member names alone.
 */
export function signingInput(payload: ActivityRecordPayload): Uint8Array {
  return utf8Encode(canonicalPayload(payload));
}

/**
 * The canonical **text** of a payload — {@link signingInput} before the UTF-8
 * encoding.
 *
 * Exported for the same reason: it is the half of the spec a reader can compare
 * against by eye, and a verifier in another language will produce this string
 * from a stock RFC 8785 implementation before it hashes anything.
 *
 * The cast is the one place the record's declared shape meets the
 * canonicaliser's structural one. `ActivityRecordPayload` has named members and
 * no index signature — deliberately, because that is what makes a `latitude` a
 * compile error — and `CanonicalObject` is an index signature, so no
 * declaration can be both. The cast is safe by inspection: every member of the
 * payload is a string, a number, a boolean or an object of those.
 */
export function canonicalPayload(payload: ActivityRecordPayload): string {
  return canonicalJson(payload as unknown as CanonicalObject);
}

/**
 * The six signed members of a record, without its signature.
 *
 * Written out member by member rather than as `const { signature, ...rest }`,
 * so that a member added to the record without being added here is a compile
 * error rather than something the signature silently starts covering.
 */
export function recordPayload(record: SignedActivityRecord): ActivityRecordPayload {
  return {
    format: record.format,
    version: record.version,
    algorithm: record.algorithm,
    publicKey: record.publicKey,
    contentHash: record.contentHash,
    claims: record.claims,
  };
}

/**
 * Signs a ride.
 *
 * @param contentHash - `sha256:...` for the activity file this record vouches
 * for. Produced by {@link contentHashOf}; passed in rather than computed here
 * because hashing needs a primitive this package cannot name.
 * @throws {IdentityError} if the claims or the content hash are not the shape
 * the format admits, or if the key is not an Ed25519 key.
 */
export async function signActivityRecord(
  input: { readonly claims: ActivityClaims; readonly contentHash: string },
  key: SigningKey,
): Promise<SignedActivityRecord> {
  // The comparison is made on the widened alias, not on `key.algorithm`; see
  // the same shape in `seam.ts` for why.
  const offered: string = key.algorithm;
  if (offered !== SIGNATURE_ALGORITHM) {
    throw new IdentityError(
      `this build signs with ${SIGNATURE_ALGORITHM}, and the key offered is ${offered}`,
    );
  }
  if (key.publicKey.length !== PUBLIC_KEY_BYTES) {
    throw new IdentityError(
      `an ${SIGNATURE_ALGORITHM} public key is ${String(PUBLIC_KEY_BYTES)} bytes, and this one is ${String(key.publicKey.length)}`,
    );
  }
  // Throws if it is not a well-formed content hash. Validating on the way in
  // matters more than on the way out: a record signed over a malformed hash is
  // a permanently unverifiable artefact in the athlete's history.
  parseContentHash(input.contentHash);
  assertClaims(input.claims);

  const payload: ActivityRecordPayload = {
    format: RECORD_FORMAT,
    version: RECORD_VERSION,
    algorithm: SIGNATURE_ALGORITHM,
    publicKey: toHex(key.publicKey),
    contentHash: input.contentHash,
    claims: input.claims,
  };
  const signature = await key.sign(signingInput(payload));
  if (signature.length !== SIGNATURE_BYTES) {
    throw new IdentityError(
      `an ${SIGNATURE_ALGORITHM} signature is ${String(SIGNATURE_BYTES)} bytes, and the keystore returned ${String(signature.length)}`,
    );
  }
  return { ...payload, signature: toHex(signature) };
}

/**
 * What a verification concluded.
 *
 * Five answers, not two, because they mean different things to whoever is
 * reading:
 *
 * | Status | What happened | What to do |
 * |---|---|---|
 * | `verified` | the signature and the file both check out | trust it as far as you trust the key |
 * | `content-mismatch` | the record is authentic; the **file** is not the one it vouches for | the file was altered or swapped — the record is still evidence |
 * | `signature-mismatch` | the payload was altered after signing, or that key did not sign it | the record is forged or corrupt |
 * | `unsupported` | a version or scheme this build does not know | **not** a forgery; a newer or older writer |
 * | `malformed` | not a record of this format at all | reject as input |
 *
 * The middle three are the distinction the issue asks the type to carry: a
 * tampered record (`signature-mismatch`) and an unverifiable one
 * (`unsupported`) are different answers.
 */
export type RecordVerification =
  | { readonly status: 'verified'; readonly record: SignedActivityRecord }
  | { readonly status: 'content-mismatch'; readonly expected: string; readonly actual: string }
  | { readonly status: 'signature-mismatch' }
  | { readonly status: 'unsupported'; readonly reason: string }
  | { readonly status: 'malformed'; readonly reason: string };

/** Narrowing helper, so a caller cannot mistake a truthy object for a pass. */
export function isVerified(
  outcome: RecordVerification,
): outcome is { readonly status: 'verified'; readonly record: SignedActivityRecord } {
  return outcome.status === 'verified';
}

/**
 * Checks the signature only — for when the activity file is not at hand.
 *
 * Deliberately a **separate function** from {@link verifyActivityRecord} rather
 * than an optional parameter on it. An optional `fileDigest` that silently
 * skips the content check when omitted is the shape that lets a caller believe
 * a record was fully verified when half of it never ran; making the weaker
 * check a differently named function means choosing it is visible at the call
 * site and in review.
 */
export async function verifyRecordSignature(
  value: unknown,
  verifier: SignatureVerifier,
): Promise<RecordVerification> {
  const parsed = parseSignedActivityRecord(value);
  if (!parsed.ok) {
    return parsed.outcome;
  }
  return checkSignature(parsed.record, verifier);
}

/**
 * The full check: the file's bytes, then the signature.
 *
 * @param fileDigest - the SHA-256 of the activity file **as it is now**, from
 * {@link Sha256}. Compared against the record's `contentHash`.
 */
export async function verifyActivityRecord(
  value: unknown,
  options: { readonly verifier: SignatureVerifier; readonly fileDigest: Uint8Array },
): Promise<RecordVerification> {
  const parsed = parseSignedActivityRecord(value);
  if (!parsed.ok) {
    return parsed.outcome;
  }
  const record = parsed.record;

  // The content check runs **first**, and its failure is reported as itself.
  // The signature over a record whose file has changed is still valid — the
  // signer hashed the file as it was — so a verifier that checked the signature
  // first would report a pass, and one that folded the two together would
  // report a forgery. Neither is what happened.
  const actual = formatContentHash(options.fileDigest);
  if (actual !== record.contentHash) {
    return { status: 'content-mismatch', expected: record.contentHash, actual };
  }
  return checkSignature(record, options.verifier);
}

/**
 * The signature half.
 *
 * No check that the verifier's algorithm matches the record's: the record's is
 * already `Ed25519` — `parseSignedActivityRecord` returned `unsupported` for
 * anything else before this ran — and `SignatureVerifier.algorithm` admits no
 * other value. A branch here would be unreachable in typed code and would read
 * as though it were guarding something.
 */
async function checkSignature(
  record: SignedActivityRecord,
  verifier: SignatureVerifier,
): Promise<RecordVerification> {
  const ok = await verifier.verify({
    publicKey: fromHex(record.publicKey, 'a public key', PUBLIC_KEY_BYTES),
    message: signingInput(recordPayload(record)),
    signature: fromHex(record.signature, 'a signature', SIGNATURE_BYTES),
  });
  return ok ? { status: 'verified', record } : { status: 'signature-mismatch' };
}

/** @see parseSignedActivityRecord */
export type RecordParse =
  | { readonly ok: true; readonly record: SignedActivityRecord }
  | { readonly ok: false; readonly outcome: RecordVerification };

/**
 * Turns untrusted JSON into a record, or says why it is not one.
 *
 * Records arrive from other people's devices and from files on disk, so this is
 * an untrusted-input boundary in the sense of CLAUDE.md section 6. It is
 * **strict about members it does not know**: an object carrying an extra member
 * is rejected rather than trimmed. Two reasons, and the second is the one that
 * matters —
 *
 * 1. Trimming would mean the bytes re-canonicalised for the signature check are
 *    not the bytes that were signed, so a record with an extra member would
 *    fail as `signature-mismatch` and read as a forgery.
 * 2. Rejecting is what stops a `latitude` member riding along inside a record
 *    this build then stores and re-serves. A record carries no location, and
 *    "carries no location" has to be true of records this build **accepts**,
 *    not only of records it writes.
 */
export function parseSignedActivityRecord(value: unknown): RecordParse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return malformed('a record must be a JSON object');
  }
  const object = value as Record<string, unknown>;

  const unknownMember = firstUnknownMember(object, RECORD_MEMBERS);
  if (unknownMember !== undefined) {
    return malformed(`a record must not carry the member "${unknownMember}"`);
  }
  if (object['format'] !== RECORD_FORMAT) {
    return malformed(`a record's format must be "${RECORD_FORMAT}"`);
  }
  if (object['version'] !== RECORD_VERSION) {
    return unsupported(
      `this build reads record version ${String(RECORD_VERSION)}, and the record declares ${describe(object['version'])}`,
    );
  }
  if (object['algorithm'] !== SIGNATURE_ALGORITHM) {
    return unsupported(
      `this build verifies ${SIGNATURE_ALGORITHM}, and the record declares ${describe(object['algorithm'])}`,
    );
  }
  const publicKey = object['publicKey'];
  if (typeof publicKey !== 'string' || !isHexOfLength(publicKey, PUBLIC_KEY_BYTES)) {
    return malformed(
      `a record's publicKey must be ${String(PUBLIC_KEY_BYTES * 2)} lowercase hexadecimal characters`,
    );
  }
  const signature = object['signature'];
  if (typeof signature !== 'string' || !isHexOfLength(signature, SIGNATURE_BYTES)) {
    return malformed(
      `a record's signature must be ${String(SIGNATURE_BYTES * 2)} lowercase hexadecimal characters`,
    );
  }
  const contentHash = object['contentHash'];
  if (typeof contentHash !== 'string') {
    return malformed(`a record's contentHash must be a string`);
  }
  try {
    parseContentHash(contentHash);
  } catch {
    return malformed(
      `a record's contentHash must be "${CONTENT_HASH_PREFIX}" and 64 hex characters`,
    );
  }

  const claims = parseClaims(object['claims']);
  if (!claims.ok) {
    return claims;
  }

  return {
    ok: true,
    record: {
      format: RECORD_FORMAT,
      version: RECORD_VERSION,
      algorithm: SIGNATURE_ALGORITHM,
      publicKey,
      contentHash,
      claims: claims.claims,
      signature,
    },
  };
}

const RECORD_MEMBERS: readonly string[] = [
  'format',
  'version',
  'algorithm',
  'publicKey',
  'contentHash',
  'claims',
  'signature',
];

const CLAIM_MEMBERS: readonly string[] = [
  'activityId',
  'name',
  'startedAt',
  'startedAtTimeZone',
  'elapsedTime',
  'movingTime',
  'distance',
  'hasPosition',
  'averagePower',
];

function parseClaims(
  value: unknown,
):
  | { readonly ok: true; readonly claims: ActivityClaims }
  | { readonly ok: false; readonly outcome: RecordVerification } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return malformed("a record's claims must be a JSON object");
  }
  const object = value as Record<string, unknown>;
  const unknownMember = firstUnknownMember(object, CLAIM_MEMBERS);
  if (unknownMember !== undefined) {
    return malformed(`a record's claims must not carry the member "${unknownMember}"`);
  }
  const claims = {
    activityId: object['activityId'],
    name: object['name'],
    startedAt: object['startedAt'],
    startedAtTimeZone: object['startedAtTimeZone'],
    elapsedTime: object['elapsedTime'],
    movingTime: object['movingTime'],
    distance: object['distance'],
    hasPosition: object['hasPosition'],
    ...('averagePower' in object ? { averagePower: object['averagePower'] } : {}),
  } as ActivityClaims;
  try {
    assertClaims(claims);
  } catch (error) {
    return malformed(
      error instanceof IdentityError ? error.message : "a record's claims are not valid",
    );
  }
  return { ok: true, claims };
}

/**
 * Validates the claims, on the way in and on the way out.
 *
 * The same function for both directions deliberately: a record this build
 * signs and a record this build accepts must satisfy the same predicate, or the
 * format has two definitions and the stricter one is whichever code path a
 * reader happened to look at.
 *
 * @throws {IdentityError}
 */
function assertClaims(claims: ActivityClaims): void {
  assertNonEmptyString(claims.activityId, 'activityId');
  assertString(claims.name, 'name');
  assertNonEmptyString(claims.startedAtTimeZone, 'startedAtTimeZone');
  assertInteger(claims.startedAt, 'startedAt');
  assertNonNegative(claims.elapsedTime, 'elapsedTime');
  assertNonNegative(claims.movingTime, 'movingTime');
  assertNonNegative(claims.distance, 'distance');
  if (typeof claims.hasPosition !== 'boolean') {
    throw new IdentityError("a record's claims.hasPosition must be a boolean");
  }
  if (claims.averagePower !== undefined) {
    assertNonNegative(claims.averagePower, 'averagePower');
  }
}

function assertString(value: unknown, member: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new IdentityError(`a record's claims.${member} must be a string`);
  }
}

function assertNonEmptyString(value: unknown, member: string): asserts value is string {
  assertString(value, member);
  if (value.length === 0) {
    throw new IdentityError(`a record's claims.${member} must not be empty`);
  }
}

function assertInteger(value: unknown, member: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new IdentityError(`a record's claims.${member} must be a whole number`);
  }
}

function assertNonNegative(value: unknown, member: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new IdentityError(`a record's claims.${member} must be a finite number and not negative`);
  }
}

function firstUnknownMember(
  object: Record<string, unknown>,
  known: readonly string[],
): string | undefined {
  return Object.keys(object).find((member) => !known.includes(member));
}

function describe(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value);
}

function malformed(reason: string): { readonly ok: false; readonly outcome: RecordVerification } {
  return { ok: false, outcome: { status: 'malformed', reason } };
}

function unsupported(reason: string): { readonly ok: false; readonly outcome: RecordVerification } {
  return { ok: false, outcome: { status: 'unsupported', reason } };
}
