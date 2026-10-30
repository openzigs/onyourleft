// SPDX-License-Identifier: Apache-2.0

/**
 * **A device pinning an instance's identity key from an instance card, and
 * deciding which of the instance's encryption keys it may seal to** — #1190,
 * ADR 0047 D-5, D-6, D-14 Q1 and Q8.
 *
 * `instance-key-statement.ts` is what the instance signs and how a card is
 * written. This file is the DEVICE's half: reading a card back, and judging a
 * `GET /v1/instance/keys` answer against the pin and against what the device
 * has seen before. It names no `crypto`: SHA-256 and Ed25519 verification are
 * handed in (`seam.ts`), and the clock is a parameter.
 *
 * ## The card
 *
 * `oyl-instance:<origin>#<52 characters of unpadded RFC 4648 base32>`. A card
 * with a fingerprint one character short, one character over, a character
 * outside the alphabet, set padding bits, or anything else after it is
 * refused (§`parseInstanceCard`). **The fingerprint is compared whole**
 * (§`fingerprintsEqual`): a prefix is never a match (D-6).
 *
 * ## The judgement (§`judgeInstanceKeys`)
 *
 * 1. The served identity key's fingerprint must equal the PIN. When it does
 *    not, a valid endorsement signed by the pinned key makes the answer
 *    `new-card` with the endorsed fingerprint — **never a re-pin** (D-14 Q8);
 *    anything else is `mismatch`.
 * 2. A statement counts only if it parses, names this origin, its key id is
 *    its key's, and its signature verifies under the identity key.
 * 3. **It is trusted until its `notAfter` or 48 hours after this device first
 *    verified it, whichever is earlier** (D-5). `serial`, `notBefore` and an
 *    `issuedAt` in the device's future are never compared with the device's
 *    clock.
 * 3a. **Per key, never an older re-signing** (#1216, ADR 0047's amendment of
 *    2026-10-09): the device remembers the newest `issuedAt` it has verified
 *    for each key, and a statement for that key signed earlier is not trusted.
 *    Without it every re-signing was its own statement with its own 48 hours,
 *    so an edge holding re-signings this device never saw could hand them out
 *    one after another, newest first, and restart the clock each time. Now a
 *    run of held re-signings is worth no more than the newest of them. Two
 *    `issuedAt`s are compared with each other, never with the device's clock.
 * 4. **No going back**: the device seals only to the trusted statement with
 *    the highest serial, and never below the highest serial (and its key id)
 *    it has ever verified. A re-signed statement for the same key and serial
 *    is the same key, and is accepted.
 */

import { bytesEqual, fromHex, isHexOfLength } from './hex';
import {
  base32Unpadded,
  INSTANCE_CARD_PREFIX,
  INSTANCE_FINGERPRINT_BASE32_LENGTH,
  INSTANCE_IDENTITY_ROTATION_PURPOSE,
  instanceIdentityFingerprint,
  instanceIdentityRotationBytes,
  instanceKeyId,
  instanceKeyStatementBytes,
  parseInstanceKeyStatement,
  type InstanceIdentityRotation,
  type InstanceKeyStatement,
} from './instance-key-statement';
import type { Sha256, SignatureVerifier } from './seam';

/** A fingerprint is the whole SHA-256: 32 bytes. */
const FINGERPRINT_BYTES = 32;

/** How long a device trusts a statement after it first verified it, whatever its `notAfter` (D-5). */
export const STATEMENT_TRUST_CAP_SECONDS = 48 * 60 * 60;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Unpadded RFC 4648 base32 back to `bytes` bytes, or `undefined` for any text
 * that is not exactly that: the wrong length, a character outside the
 * upper-case alphabet, or padding bits that are not zero (so one fingerprint
 * has one spelling).
 */
export function base32UnpaddedDecode(text: string, bytes: number): Uint8Array | undefined {
  if (text.length !== Math.ceil((bytes * 8) / 5)) return undefined;
  const out = new Uint8Array(bytes);
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const character of text) {
    const value = BASE32_ALPHABET.indexOf(character);
    if (value < 0) return undefined;
    buffer = ((buffer << 5) | value) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      if (index < bytes) out[index] = (buffer >> bits) & 0xff;
      index += 1;
    }
  }
  // What is left over is padding, and it must be zero.
  if ((buffer & ((1 << bits) - 1)) !== 0) return undefined;
  return index === bytes ? out : undefined;
}

/** Two fingerprints are equal only whole: 32 bytes each, every byte compared. */
export function fingerprintsEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === FINGERPRINT_BYTES && b.length === FINGERPRINT_BYTES && bytesEqual(a, b);
}

/** An instance card, read. */
export interface InstanceCardRead {
  /** The origin exactly as the card writes it. */
  readonly origin: string;
  /** The whole 32-byte fingerprint. */
  readonly fingerprint: Uint8Array;
  /** The fingerprint as the card writes it: 52 base32 characters. */
  readonly fingerprintText: string;
}

/** Why a card was refused. */
export type InstanceCardProblem =
  /** Not `oyl-instance:<origin>#<fingerprint>` at all. */
  | 'not-a-card'
  /** A card for another instance than the one asked about. */
  | 'other-origin'
  /** The fingerprint is not 52 characters of base32 that decode to 32 bytes. */
  | 'fingerprint';

export type InstanceCardParse =
  | { readonly ok: true; readonly card: InstanceCardRead }
  | { readonly ok: false; readonly problem: InstanceCardProblem };

/**
 * Read a card scanned or pasted INSIDE the app (D-6). Whitespace around it —
 * a pasted line's newline — is not part of it; anything else that is not the
 * card is refused. With `expectedOrigin`, a card for any other origin is
 * `other-origin`.
 */
export function parseInstanceCard(text: string, expectedOrigin?: string): InstanceCardParse {
  const card = text.trim();
  if (!card.startsWith(INSTANCE_CARD_PREFIX)) return { ok: false, problem: 'not-a-card' };
  const rest = card.slice(INSTANCE_CARD_PREFIX.length);
  const hash = rest.indexOf('#');
  if (hash <= 0 || rest.indexOf('#', hash + 1) >= 0) return { ok: false, problem: 'not-a-card' };
  const origin = rest.slice(0, hash);
  if (!/^https?:\/\/[^\s/?#]+$/.test(origin)) return { ok: false, problem: 'not-a-card' };
  const fingerprintText = rest.slice(hash + 1);
  if (fingerprintText.length !== INSTANCE_FINGERPRINT_BASE32_LENGTH) {
    return { ok: false, problem: 'fingerprint' };
  }
  const fingerprint = base32UnpaddedDecode(fingerprintText, FINGERPRINT_BYTES);
  if (fingerprint === undefined) return { ok: false, problem: 'fingerprint' };
  if (expectedOrigin !== undefined && origin !== expectedOrigin) {
    return { ok: false, problem: 'other-origin' };
  }
  return { ok: true, card: { origin, fingerprint, fingerprintText } };
}

/** What a device remembers of an instance's keys, per instance, beside its pin (D-5). */
export interface InstanceKeyTrust {
  /** The highest key serial it has ever verified, or `null` before the first. */
  readonly highestSerial: number | null;
  /** That key's id. */
  readonly highestKeyId: string | null;
  /**
   * When this device first verified each statement it still might trust, by
   * statement ({@link statementId}): the start of its 48 hours. Kept until the
   * statement's `notAfter` has passed, so a statement shown again later does
   * not start its 48 hours again.
   */
  readonly firstVerified: Readonly<
    Record<string, { readonly at: number; readonly notAfter: number }>
  >;
  /**
   * The newest `issuedAt` this device has verified for each key, by key id,
   * with that statement's `notAfter` (#1216). A statement for the key signed
   * before it is never trusted. Kept until that `notAfter` has passed: the
   * instance gives a later re-signing a later `notAfter`, so by then every
   * older one is out of date too.
   */
  readonly newestIssued: Readonly<
    Record<string, { readonly issuedAt: number; readonly notAfter: number }>
  >;
}

/** A device that has verified nothing yet. */
export const NO_KEY_TRUST: InstanceKeyTrust = {
  highestSerial: null,
  highestKeyId: null,
  firstVerified: {},
  newestIssued: {},
};

/** One statement's name in {@link InstanceKeyTrust.firstVerified}: its key and when it was signed. */
export function statementId(statement: InstanceKeyStatement): string {
  return `${statement.keyId}@${String(statement.issuedAt)}`;
}

/** What a `GET /v1/instance/keys` answer means for a pinned device. */
export type InstanceKeysVerdict =
  /** Seal to `statement`'s key. `trust` is what to remember now. */
  | {
      readonly kind: 'trusted';
      readonly statement: InstanceKeyStatement;
      readonly trust: InstanceKeyTrust;
    }
  /** The keys are not signed by the pinned identity key, and nothing the pinned key signed says why. */
  | { readonly kind: 'mismatch' }
  /** The pinned key endorsed a new identity key: ask for a new card carrying `fingerprint` (D-14 Q8). */
  | { readonly kind: 'new-card'; readonly fingerprint: string }
  /** The newest key served is older than one this device has used (D-5). */
  | { readonly kind: 'older'; readonly highestSerial: number; readonly trust: InstanceKeyTrust }
  /** Nothing served is in date for this device. */
  | { readonly kind: 'expired'; readonly trust: InstanceKeyTrust };

export interface JudgeInstanceKeysInput {
  /** The parsed JSON body of `GET /v1/instance/keys`, untrusted. */
  readonly served: unknown;
  /** The instance's origin, exactly as the account holds it. */
  readonly origin: string;
  /** The pinned fingerprint, 32 bytes. */
  readonly pin: Uint8Array;
  readonly trust: InstanceKeyTrust;
  /** The device's clock, Unix seconds. */
  readonly now: number;
  readonly sha256: Sha256;
  readonly verifier: SignatureVerifier;
}

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isKeyHex = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) && isHexOfLength(value, 32);

async function verifies(
  verifier: SignatureVerifier,
  publicKey: string,
  message: Uint8Array,
  signature: unknown,
): Promise<boolean> {
  if (typeof signature !== 'string' || !/^[0-9a-f]{128}$/.test(signature)) return false;
  return verifier.verify({
    publicKey: fromHex(publicKey, 'a public key', 32),
    message,
    signature: fromHex(signature, 'a signature', 64),
  });
}

const ROTATION_MEMBERS = [
  'purpose',
  'instanceOrigin',
  'previousIdentityKey',
  'identityKey',
  'fingerprint',
  'issuedAt',
] as const;

function parseRotation(value: unknown): InstanceIdentityRotation | undefined {
  if (!isObject(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== ROTATION_MEMBERS.length) return undefined;
  if (!ROTATION_MEMBERS.every((member) => keys.includes(member))) return undefined;
  const { purpose, instanceOrigin, previousIdentityKey, identityKey, fingerprint, issuedAt } =
    value;
  if (purpose !== INSTANCE_IDENTITY_ROTATION_PURPOSE) return undefined;
  if (typeof instanceOrigin !== 'string' || !isKeyHex(previousIdentityKey)) return undefined;
  if (!isKeyHex(identityKey) || typeof fingerprint !== 'string') return undefined;
  if (typeof issuedAt !== 'number' || !Number.isSafeInteger(issuedAt) || issuedAt < 0) {
    return undefined;
  }
  return {
    purpose,
    instanceOrigin,
    previousIdentityKey,
    identityKey,
    fingerprint,
    issuedAt,
  };
}

/**
 * The fingerprint the pinned key endorsed for `identityKey`, or `undefined`
 * when no endorsement in `endorsements` is one the pinned key made for it.
 */
async function endorsedFingerprint(
  input: JudgeInstanceKeysInput,
  identityKey: string,
  endorsements: unknown,
): Promise<string | undefined> {
  if (!Array.isArray(endorsements)) return undefined;
  const expected = base32Unpadded(
    await instanceIdentityFingerprint(input.sha256, input.origin, identityKey),
  );
  for (const each of endorsements) {
    if (!isObject(each)) continue;
    const rotation = parseRotation(each.statement);
    if (rotation === undefined) continue;
    if (rotation.instanceOrigin !== input.origin || rotation.identityKey !== identityKey) continue;
    if (rotation.fingerprint !== expected) continue;
    const previous = await instanceIdentityFingerprint(
      input.sha256,
      input.origin,
      rotation.previousIdentityKey,
    );
    if (!fingerprintsEqual(previous, input.pin)) continue;
    if (
      await verifies(
        input.verifier,
        rotation.previousIdentityKey,
        instanceIdentityRotationBytes(rotation),
        each.signature,
      )
    ) {
      return rotation.fingerprint;
    }
  }
  return undefined;
}

/** Judge a `GET /v1/instance/keys` answer for a device holding `pin` (D-5, D-6). */
export async function judgeInstanceKeys(
  input: JudgeInstanceKeysInput,
): Promise<InstanceKeysVerdict> {
  const { served, now } = input;
  if (!isObject(served) || !isKeyHex(served.identityKey)) return { kind: 'mismatch' };
  const identityKey = served.identityKey;
  const fingerprint = await instanceIdentityFingerprint(input.sha256, input.origin, identityKey);
  if (!fingerprintsEqual(fingerprint, input.pin)) {
    const endorsed = await endorsedFingerprint(input, identityKey, served.endorsements);
    return endorsed === undefined
      ? { kind: 'mismatch' }
      : { kind: 'new-card', fingerprint: endorsed };
  }

  const verified: InstanceKeyStatement[] = [];
  for (const each of Array.isArray(served.statements) ? served.statements : []) {
    if (!isObject(each)) continue;
    const statement = parseInstanceKeyStatement(each.statement);
    if (statement === undefined || statement.instanceOrigin !== input.origin) continue;
    if (
      (await instanceKeyId(input.sha256, fromHex(statement.encryptionKey, 'a key', 32))) !==
      statement.keyId
    ) {
      continue;
    }
    if (
      await verifies(
        input.verifier,
        identityKey,
        instanceKeyStatementBytes(statement),
        each.signature,
      )
    ) {
      verified.push(statement);
    }
  }

  // When this device first saw each statement, kept until its notAfter passes.
  const firstVerified: Record<string, { at: number; notAfter: number }> = {};
  for (const [id, seen] of Object.entries(input.trust.firstVerified)) {
    if (seen.notAfter > now) firstVerified[id] = { at: seen.at, notAfter: seen.notAfter };
  }
  for (const statement of verified) {
    const id = statementId(statement);
    if (firstVerified[id] === undefined && statement.notAfter > now) {
      firstVerified[id] = { at: now, notAfter: statement.notAfter };
    }
  }
  // The newest re-signing this device has verified of each key (#1216).
  const newestIssued: Record<string, { issuedAt: number; notAfter: number }> = {};
  for (const [keyId, newest] of Object.entries(input.trust.newestIssued)) {
    if (newest.notAfter > now) {
      newestIssued[keyId] = { issuedAt: newest.issuedAt, notAfter: newest.notAfter };
    }
  }
  for (const statement of verified) {
    const held = newestIssued[statement.keyId];
    if (statement.notAfter > now && (held === undefined || statement.issuedAt > held.issuedAt)) {
      newestIssued[statement.keyId] = {
        issuedAt: statement.issuedAt,
        notAfter: statement.notAfter,
      };
    }
  }
  const trusted = (statement: InstanceKeyStatement): boolean => {
    const seen = firstVerified[statementId(statement)];
    const newest = newestIssued[statement.keyId];
    return (
      seen !== undefined &&
      now < statement.notAfter &&
      now < seen.at + STATEMENT_TRUST_CAP_SECONDS &&
      (newest === undefined || statement.issuedAt >= newest.issuedAt)
    );
  };

  const { highestSerial, highestKeyId } = input.trust;
  /** Not below what this device has seen: a higher serial, or the same key again. */
  const notBack = (statement: InstanceKeyStatement): boolean =>
    highestSerial === null ||
    statement.serial > highestSerial ||
    (statement.serial === highestSerial && statement.keyId === highestKeyId);

  const remembered = { highestSerial, highestKeyId, firstVerified, newestIssued };
  const candidates = verified.filter((statement) => notBack(statement) && trusted(statement));
  if (candidates.length === 0) {
    const anyTrusted = verified.some(trusted);
    const anyCurrent = verified.some(notBack);
    if (highestSerial !== null && anyTrusted && !anyCurrent) {
      return { kind: 'older', highestSerial, trust: remembered };
    }
    return { kind: 'expired', trust: remembered };
  }
  const best = candidates.reduce((a, b) =>
    b.serial > a.serial || (b.serial === a.serial && b.notAfter > a.notAfter) ? b : a,
  );
  return {
    kind: 'trusted',
    statement: best,
    trust: { highestSerial: best.serial, highestKeyId: best.keyId, firstVerified, newestIssued },
  };
}
