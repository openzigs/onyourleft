// SPDX-License-Identifier: Apache-2.0

/**
 * What an INSTANCE signs about its own keys, and how its identity key is
 * written for a person to pin (#1189, ADR 0047 D-4, D-5, D-6).
 *
 * An instance has two long-term keys: an Ed25519 **identity** key, which a
 * device pins and which only signs, and an X25519 **encryption** key, the HPKE
 * recipient, which it rotates. The encryption key is published only inside an
 * **instance key statement** the identity key signs:
 *
 * ```json
 * { "purpose": "oyl-instance-key-v1", "instanceOrigin": "https://ride.example",
 *   "keyId": "<16 hex>", "encryptionKey": "<64 hex>", "serial": 1790000000,
 *   "notBefore": 1790000000, "issuedAt": 1790086400, "notAfter": 1790259200 }
 * ```
 *
 * canonicalised with RFC 8785 (`canonical.ts`) and signed as UTF-8 bytes —
 * here, once, beside `device-statement.ts` and for its reason: the instance
 * signs in Node and the app verifies in a browser, and both import this.
 *
 * ## Purposes no device statement and no record carries
 *
 * Every purpose below is distinct from every `device-statement.ts` purpose, so
 * no signature a device made verifies as an instance's and no instance's as a
 * device's; and an activity record has no `purpose` member at all
 * (`device-statement.ts` §"Two members that exist to refuse something").
 * {@link parseInstanceKeyStatement} refuses any purpose but
 * {@link INSTANCE_KEY_PURPOSE}.
 *
 * ## The fingerprint and the card (D-5, D-6)
 *
 * The identity key's **fingerprint** is SHA-256 over the UTF-8 bytes of
 * `"oyl-instance-identity-v1"`, then of the instance's origin, then the
 * identity key's 32 raw bytes, concatenated with no separator — the label and
 * the origin are both ASCII text with no byte a key could be confused with,
 * and the key is a fixed 32 bytes at the end. The **instance card** is
 * `oyl-instance:<origin>#<the whole fingerprint, 52 characters of unpadded
 * RFC 4648 base32>`, never truncated.
 *
 * This package names no `crypto`: SHA-256 is handed in (`seam.ts` §`Sha256`).
 */

import { canonicalBytes } from './canonical';
import { fromHex, isHexOfLength, toHex } from './hex';
import type { Sha256 } from './seam';
import { utf8Encode } from './utf8';

/** An instance publishing one of its encryption keys. */
export const INSTANCE_KEY_PURPOSE = 'oyl-instance-key-v1';

/** An old identity key endorsing its successor: a planned identity rotation (D-5). */
export const INSTANCE_IDENTITY_ROTATION_PURPOSE = 'oyl-instance-identity-rotation-v1';

/** The additional data a wrapped private half is bound to (D-5). Never signed. */
export const INSTANCE_KEY_WRAP_PURPOSE = 'oyl-instance-key-wrap-v1';

/** The label the identity fingerprint is taken over first (D-5). */
export const INSTANCE_IDENTITY_FINGERPRINT_LABEL = 'oyl-instance-identity-v1';

/** What an instance card starts with: a label inside the string, not a URL scheme (D-6). */
export const INSTANCE_CARD_PREFIX = 'oyl-instance:';

/** A key id is the first 8 bytes of SHA-256 over the public key: 16 hex. */
export const INSTANCE_KEY_ID_BYTES = 8;

/** An X25519 or Ed25519 public key, raw. */
const RAW_PUBLIC_KEY_BYTES = 32;

/** A fingerprint as the card writes it: 256 bits in unpadded base32. */
export const INSTANCE_FINGERPRINT_BASE32_LENGTH = 52;

/** The eight members an instance signs about one of its encryption keys. */
export interface InstanceKeyStatement {
  readonly purpose: typeof INSTANCE_KEY_PURPOSE;
  /** The instance's origin, exactly as it states it. */
  readonly instanceOrigin: string;
  /** {@link instanceKeyId} of `encryptionKey`. */
  readonly keyId: string;
  /** The X25519 public key, lowercase hex. */
  readonly encryptionKey: string;
  /**
   * The key's place in the order the instance made its keys: the same in every
   * statement for that key, and greater than every earlier key's.
   */
  readonly serial: number;
  /** When the key was made, by the box's clock, Unix seconds. */
  readonly notBefore: number;
  /** When THIS statement was signed, Unix seconds. */
  readonly issuedAt: number;
  /** When this statement stops verifying, Unix seconds. */
  readonly notAfter: number;
}

/** The bytes the identity key signs for a key statement: its RFC 8785 form. */
export function instanceKeyStatementBytes(statement: InstanceKeyStatement): Uint8Array {
  return canonicalBytes({
    purpose: statement.purpose,
    instanceOrigin: statement.instanceOrigin,
    keyId: statement.keyId,
    encryptionKey: statement.encryptionKey,
    serial: statement.serial,
    notBefore: statement.notBefore,
    issuedAt: statement.issuedAt,
    notAfter: statement.notAfter,
  });
}

const STATEMENT_MEMBERS = [
  'purpose',
  'instanceOrigin',
  'keyId',
  'encryptionKey',
  'serial',
  'notBefore',
  'issuedAt',
  'notAfter',
] as const;

function isLowerHex(value: unknown, bytes: number): value is string {
  return typeof value === 'string' && /^[0-9a-f]*$/.test(value) && isHexOfLength(value, bytes);
}

function isWholeSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * A key statement as a device received it, or `undefined` when it is not one:
 * exactly the eight members, {@link INSTANCE_KEY_PURPOSE} and no other —
 * a device statement's purpose included — hex where hex is due, and whole
 * seconds. Says nothing of the signature or of whether it is in date.
 */
export function parseInstanceKeyStatement(value: unknown): InstanceKeyStatement | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record);
  if (keys.length !== STATEMENT_MEMBERS.length) return undefined;
  if (!STATEMENT_MEMBERS.every((member) => keys.includes(member))) return undefined;
  if (record.purpose !== INSTANCE_KEY_PURPOSE) return undefined;
  if (typeof record.instanceOrigin !== 'string' || record.instanceOrigin === '') return undefined;
  if (!isLowerHex(record.keyId, INSTANCE_KEY_ID_BYTES)) return undefined;
  if (!isLowerHex(record.encryptionKey, RAW_PUBLIC_KEY_BYTES)) return undefined;
  const { serial, notBefore, issuedAt, notAfter } = record;
  if (![serial, notBefore, issuedAt, notAfter].every(isWholeSeconds)) return undefined;
  return {
    purpose: INSTANCE_KEY_PURPOSE,
    instanceOrigin: record.instanceOrigin,
    keyId: record.keyId,
    encryptionKey: record.encryptionKey,
    serial: serial as number,
    notBefore: notBefore as number,
    issuedAt: issuedAt as number,
    notAfter: notAfter as number,
  };
}

/**
 * An old identity key endorsing its successor (D-5, planned rotation). A device
 * that verifies one does NOT re-pin by itself: it asks for a new card carrying
 * `fingerprint` (D-14 Q8).
 */
export interface InstanceIdentityRotation {
  readonly purpose: typeof INSTANCE_IDENTITY_ROTATION_PURPOSE;
  readonly instanceOrigin: string;
  /** The old identity key, which signs this, lowercase hex. */
  readonly previousIdentityKey: string;
  /** The new identity key, lowercase hex. */
  readonly identityKey: string;
  /** The new key's fingerprint, as the card writes it (52 base32 characters). */
  readonly fingerprint: string;
  readonly issuedAt: number;
}

/** The bytes the OLD identity key signs for an endorsement. */
export function instanceIdentityRotationBytes(rotation: InstanceIdentityRotation): Uint8Array {
  return canonicalBytes({
    purpose: rotation.purpose,
    instanceOrigin: rotation.instanceOrigin,
    previousIdentityKey: rotation.previousIdentityKey,
    identityKey: rotation.identityKey,
    fingerprint: rotation.fingerprint,
    issuedAt: rotation.issuedAt,
  });
}

/** Which of the instance's two keys a wrapped private half is. */
export type InstanceKeyRole = 'identity' | 'encryption';

/**
 * The additional data a wrapped private half is sealed with: the RFC 8785
 * bytes of `{purpose, role, keyId, instanceOrigin}` (D-5). A row moved to
 * another role, another key's row, or another instance sharing the operator
 * secret then fails to unwrap rather than importing as the wrong key.
 */
export function instanceKeyWrapAad(binding: {
  readonly role: InstanceKeyRole;
  readonly keyId: string;
  readonly instanceOrigin: string;
}): Uint8Array {
  return canonicalBytes({
    purpose: INSTANCE_KEY_WRAP_PURPOSE,
    role: binding.role,
    keyId: binding.keyId,
    instanceOrigin: binding.instanceOrigin,
  });
}

/** A public key's id: the first 8 bytes of its SHA-256, lowercase hex. */
export async function instanceKeyId(sha256: Sha256, publicKey: Uint8Array): Promise<string> {
  return toHex((await sha256(publicKey)).slice(0, INSTANCE_KEY_ID_BYTES));
}

/** The identity key's full 32-byte fingerprint (D-5). `identityKey` is lowercase hex. */
export async function instanceIdentityFingerprint(
  sha256: Sha256,
  instanceOrigin: string,
  identityKey: string,
): Promise<Uint8Array> {
  const label = utf8Encode(INSTANCE_IDENTITY_FINGERPRINT_LABEL);
  const origin = utf8Encode(instanceOrigin);
  const key = fromHex(identityKey, 'the identity key', RAW_PUBLIC_KEY_BYTES);
  const input = new Uint8Array(label.length + origin.length + key.length);
  input.set(label, 0);
  input.set(origin, label.length);
  input.set(key, label.length + origin.length);
  return sha256(input);
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, upper case, with no `=` padding. */
export function base32Unpadded(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

/** The instance card for an origin and a full fingerprint (D-6). Never truncated. */
export function instanceCard(instanceOrigin: string, fingerprint: Uint8Array): string {
  if (fingerprint.length !== 32) throw new RangeError('a fingerprint is the whole 32-byte SHA-256');
  return `${INSTANCE_CARD_PREFIX}${instanceOrigin}#${base32Unpadded(fingerprint)}`;
}
