// SPDX-License-Identifier: Apache-2.0

/**
 * HPKE (RFC 9180), suite DHKEM(X25519, HKDF-SHA256) / HKDF-SHA256 /
 * AES-128-GCM, `mode_base` — and the reply derivation of ADR 0047 D-2 (#1188).
 *
 * ## What is here, and what is not
 *
 * The key schedule, Encap and Decap, `Seal`, `Open`, `Export`, the sequence
 * counter and its overflow error, and the reply keys, written once against
 * {@link HpkePrimitives} so the device and the instance run the same lines.
 * Not here: the envelope, the AAD, padding and dispatch (#1191), key storage
 * (#1189), any route. `psk`, `auth` and ChaCha20 are rejected by ADR 0047 D-1
 * and have no code path at all.
 *
 * ## What gates it
 *
 * RFC 9180 Appendix A.1's `mode_base` vectors and RFC 9458 Appendix A's
 * response, run through **each** port implementation — `hpke-testing.ts`
 * §`assertRfc9180A1Base` and §`assertRfc9458Reply`, called from
 * `packages/store/src/hpke-web-crypto.test.ts` and
 * `apps/instance/src/auth/hpke.test.ts`. This package cannot name `crypto`,
 * so its own tests (`hpke.test.ts`) cover only what a stand-in port can: the
 * all-zero check, the lengths, the limit.
 *
 * ## The ephemeral key is not injectable here
 *
 * {@link setupBaseSender} always generates its ephemeral key pair. The A.1
 * vectors need a fixed one, so the injectable form is `hpke-testing.ts`
 * §`setupBaseSenderWithEphemeral`, which is not on `src/index.ts`
 * (`hpke-surface.test.ts` holds that with a `@ts-expect-error`) and which
 * `eslint.config.js` refuses to any module that is not a test or test support.
 * A sender that reused an ephemeral key would make every request to one
 * instance key share a shared secret.
 */

import { utf8Encode } from '../identity/utf8';
import { HpkeError } from './errors';
import type { HpkePrimitives, X25519KeyPair } from './primitives';

/** DHKEM(X25519, HKDF-SHA256) (RFC 9180 §7.1). */
export const HPKE_KEM_ID = 0x0020;
/** HKDF-SHA256 (RFC 9180 §7.2). */
export const HPKE_KDF_ID = 0x0001;
/** AES-128-GCM (RFC 9180 §7.3). */
export const HPKE_AEAD_ID = 0x0001;
/** `mode_base` (RFC 9180 §5). The only mode (ADR 0047 D-1). */
export const HPKE_MODE_BASE = 0x00;

/** `Nsecret`, `Nenc` and `Npk` for X25519: all 32 (RFC 9180 §7.1). */
export const X25519_KEY_BYTES = 32;
/** `Nk` for AES-128-GCM. */
const KEY_BYTES = 16;
/** `Nn` for AES-128-GCM. */
const NONCE_BYTES = 12;
/** `Nh` for HKDF-SHA256. */
const HASH_BYTES = 32;

/**
 * The largest sequence number a context will use: `2^(8·Nn) − 1` (RFC 9180
 * §5.2). A context at it raises {@link HpkeError} `message-limit` and never
 * wraps — a wrapped counter would reuse a nonce under the same key.
 */
export const HPKE_MESSAGE_LIMIT = (1n << BigInt(8 * NONCE_BYTES)) - 1n;

/** ADR 0047 D-2's exporter label for a reply's secret. */
export const HPKE_RESPONSE_LABEL = 'oyl response v1';
/** ADR 0047 D-2: `max(Nn, Nk)` random bytes the instance chooses per reply. */
export const HPKE_RESPONSE_NONCE_BYTES = 16;

const HPKE_VERSION_LABEL = utf8Encode('HPKE-v1');
const KEM_SUITE_ID = concat(utf8Encode('KEM'), i2osp(HPKE_KEM_ID, 2));
const HPKE_SUITE_ID = concat(
  utf8Encode('HPKE'),
  i2osp(HPKE_KEM_ID, 2),
  i2osp(HPKE_KDF_ID, 2),
  i2osp(HPKE_AEAD_ID, 2),
);
const EMPTY = new Uint8Array(0);

// --- The public surface ------------------------------------------------------

/** A request's sending side: seal to the recipient, export a secret. */
export interface HpkeSenderContext {
  /** The encapsulated key, which travels in clear with the ciphertext. */
  readonly enc: Uint8Array;
  /** Seals the next message, at the next sequence number. */
  seal(aad: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array>;
  /** RFC 9180 §5.3 `Context.Export`. */
  export(exporterContext: Uint8Array, length: number): Promise<Uint8Array>;
}

/** A request's receiving side: open in order, export a secret. */
export interface HpkeRecipientContext {
  readonly enc: Uint8Array;
  /** Opens the next message. A message out of order is `open-failed`. */
  open(aad: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array>;
  export(exporterContext: Uint8Array, length: number): Promise<Uint8Array>;
}

/** The instance's side of one reply (ADR 0047 D-2). */
export interface HpkeReplySealer {
  /** Sent in clear at the head of the reply. Fresh for every reply. */
  readonly responseNonce: Uint8Array;
  /** Seals the reply's next message: `seq` counts from 0 per reply. */
  seal(aad: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array>;
}

/** The device's side of one reply. */
export interface HpkeReplyOpener {
  open(aad: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array>;
}

/**
 * RFC 9180 §5.1.1 `SetupBaseS`: a fresh ephemeral key, Encap to
 * `recipientPublicKey`, and the key schedule over `info`.
 *
 * @throws {HpkeError} `invalid-public-key` or `low-order-point`.
 */
export async function setupBaseSender<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  recipientPublicKey: Uint8Array,
  info: Uint8Array,
): Promise<HpkeSenderContext> {
  return setupSender(port, recipientPublicKey, info, {});
}

/**
 * RFC 9180 §5.1.1 `SetupBaseR`: Decap `enc` with the recipient's key pair and
 * the key schedule over `info`.
 *
 * @throws {HpkeError} `invalid-public-key` or `low-order-point`.
 */
export async function setupBaseRecipient<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  recipient: X25519KeyPair<PrivateKey>,
  enc: Uint8Array,
  info: Uint8Array,
): Promise<HpkeRecipientContext> {
  return setupRecipient(port, recipient, enc, info, {});
}

/**
 * The instance answers a request it opened (ADR 0047 D-2): a fresh
 * `response_nonce`, and keys from `Export("oyl response v1", 16)` and
 * `enc || response_nonce`. Answering one request twice gives two different
 * keys, because the nonce is drawn here every time.
 */
export async function sealReply<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  request: HpkeRecipientContext,
): Promise<HpkeReplySealer> {
  const responseNonce = port.randomBytes(HPKE_RESPONSE_NONCE_BYTES);
  return replySealer(port, request, responseNonce, HPKE_RESPONSE_LABEL);
}

/**
 * The device opens the reply to a request it sealed, from the
 * `response_nonce` at the reply's head.
 *
 * @throws {HpkeError} `invalid-length` if the nonce is not 16 bytes.
 */
export async function openReply<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  request: HpkeSenderContext,
  responseNonce: Uint8Array,
): Promise<HpkeReplyOpener> {
  return replyOpener(port, request, responseNonce, HPKE_RESPONSE_LABEL);
}

// --- What the testing module composes ----------------------------------------
// Exported from this file for `hpke-testing.ts` only. `src/index.ts` names none
// of it, and `eslint.config.js` refuses `hpke-testing` outside a test.

/** What a test may fix that production never does. */
export interface SetupOptions<PrivateKey> {
  /** RFC 9180 Appendix A's fixed ephemeral key. */
  readonly ephemeral?: X25519KeyPair<PrivateKey>;
  /** A lowered §5.2 limit, so the overflow can be shown. */
  readonly messageLimit?: bigint;
}

/** @internal */
export async function setupSender<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  recipientPublicKey: Uint8Array,
  info: Uint8Array,
  options: SetupOptions<PrivateKey>,
): Promise<HpkeSenderContext> {
  const { sharedSecret, enc } = await encap(port, recipientPublicKey, options.ephemeral);
  const schedule = await keySchedule(port, sharedSecret, info);
  const aead = new AeadContext(port, schedule.key, schedule.baseNonce, options.messageLimit);
  return {
    enc: enc.slice(),
    seal: (aad, plaintext) => aead.seal(aad, plaintext),
    export: (exporterContext, length) =>
      exportSecret(port, schedule.exporterSecret, exporterContext, length),
  };
}

/** @internal */
export async function setupRecipient<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  recipient: X25519KeyPair<PrivateKey>,
  enc: Uint8Array,
  info: Uint8Array,
  options: Pick<SetupOptions<PrivateKey>, 'messageLimit'>,
): Promise<HpkeRecipientContext> {
  const sharedSecret = await decap(port, enc, recipient);
  const schedule = await keySchedule(port, sharedSecret, info);
  const aead = new AeadContext(port, schedule.key, schedule.baseNonce, options.messageLimit);
  return {
    enc: enc.slice(),
    open: (aad, ciphertext) => aead.open(aad, ciphertext),
    export: (exporterContext, length) =>
      exportSecret(port, schedule.exporterSecret, exporterContext, length),
  };
}

/** @internal The instance's side of a reply, with the nonce and label given. */
export async function replySealer<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  request: HpkeRecipientContext,
  responseNonce: Uint8Array,
  label: string,
): Promise<HpkeReplySealer> {
  const keys = await replyKeys(port, request, responseNonce, label);
  const aead = new AeadContext(port, keys.key, keys.baseNonce, undefined);
  return {
    responseNonce: responseNonce.slice(),
    seal: (aad, plaintext) => aead.seal(aad, plaintext),
  };
}

/** @internal The device's side of a reply, with the label given. */
export async function replyOpener<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  request: HpkeSenderContext,
  responseNonce: Uint8Array,
  label: string,
): Promise<HpkeReplyOpener> {
  const keys = await replyKeys(port, request, responseNonce, label);
  const aead = new AeadContext(port, keys.key, keys.baseNonce, undefined);
  return { open: (aad, ciphertext) => aead.open(aad, ciphertext) };
}

/** The KEM's output: RFC 9180 §4.1 `Encap`. @internal */
export async function encap<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  recipientPublicKey: Uint8Array,
  ephemeral: X25519KeyPair<PrivateKey> | undefined,
): Promise<{ readonly sharedSecret: Uint8Array; readonly enc: Uint8Array }> {
  assertPublicKey(recipientPublicKey, 'the recipient public key');
  const pair = ephemeral ?? (await port.generateX25519KeyPair());
  const dh = await diffieHellman(port, pair.privateKey, recipientPublicKey);
  const enc = pair.publicKey;
  const sharedSecret = await extractAndExpand(port, dh, concat(enc, recipientPublicKey));
  return { sharedSecret, enc };
}

/** RFC 9180 §4.1 `Decap`. @internal */
export async function decap<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  enc: Uint8Array,
  recipient: X25519KeyPair<PrivateKey>,
): Promise<Uint8Array> {
  assertPublicKey(enc, 'the encapsulated key');
  assertPublicKey(recipient.publicKey, 'the recipient public key');
  const dh = await diffieHellman(port, recipient.privateKey, enc);
  return extractAndExpand(port, dh, concat(enc, recipient.publicKey));
}

/** RFC 9180 §5.1 `KeySchedule`, `mode_base`, no PSK. @internal */
export async function keySchedule<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  sharedSecret: Uint8Array,
  info: Uint8Array,
): Promise<{
  readonly key: Uint8Array;
  readonly baseNonce: Uint8Array;
  readonly exporterSecret: Uint8Array;
}> {
  const pskIdHash = await labeledExtract(port, HPKE_SUITE_ID, EMPTY, 'psk_id_hash', EMPTY);
  const infoHash = await labeledExtract(port, HPKE_SUITE_ID, EMPTY, 'info_hash', info);
  const context = concat(i2osp(HPKE_MODE_BASE, 1), pskIdHash, infoHash);
  const secret = await labeledExtract(port, HPKE_SUITE_ID, sharedSecret, 'secret', EMPTY);
  return {
    key: await labeledExpand(port, HPKE_SUITE_ID, secret, 'key', context, KEY_BYTES),
    baseNonce: await labeledExpand(port, HPKE_SUITE_ID, secret, 'base_nonce', context, NONCE_BYTES),
    exporterSecret: await labeledExpand(port, HPKE_SUITE_ID, secret, 'exp', context, HASH_BYTES),
  };
}

/**
 * ADR 0047 D-2, as RFC 9458 §4.4: `secret = Export(label, Nk)`,
 * `prk = Extract(enc || response_nonce, secret)`, and the reply's key and
 * base nonce expanded from it under `"key"` and `"nonce"`. Plain HKDF, not
 * the labelled kind: RFC 9458 §4.4 says so, and its Appendix A vector is
 * what proves this function follows it. @internal
 */
export async function replyKeys<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  request: {
    readonly enc: Uint8Array;
    export(context: Uint8Array, length: number): Promise<Uint8Array>;
  },
  responseNonce: Uint8Array,
  label: string,
): Promise<{ readonly key: Uint8Array; readonly baseNonce: Uint8Array }> {
  if (responseNonce.length !== HPKE_RESPONSE_NONCE_BYTES) {
    throw new HpkeError(
      'invalid-length',
      `a response nonce is ${String(HPKE_RESPONSE_NONCE_BYTES)} bytes`,
    );
  }
  const secret = await request.export(utf8Encode(label), KEY_BYTES);
  const prk = await extract(port, concat(request.enc, responseNonce), secret);
  return {
    key: await expand(port, prk, utf8Encode('key'), KEY_BYTES),
    baseNonce: await expand(port, prk, utf8Encode('nonce'), NONCE_BYTES),
  };
}

// --- The sequence counter ----------------------------------------------------

/**
 * One AEAD key, one base nonce, one counter (RFC 9180 §5.2).
 *
 * `seal` takes its sequence number **before** it awaits, so two seals started
 * together can never compute one nonce. `open` is serialised, and moves the
 * counter only on success, as §5.2's `ContextR.Open` does.
 */
class AeadContext<PrivateKey> {
  readonly #port: HpkePrimitives<PrivateKey>;
  readonly #key: Uint8Array;
  readonly #baseNonce: Uint8Array;
  readonly #limit: bigint;
  #sequence = 0n;
  #opening: Promise<unknown> = Promise.resolve();

  constructor(
    port: HpkePrimitives<PrivateKey>,
    key: Uint8Array,
    baseNonce: Uint8Array,
    limit: bigint | undefined,
  ) {
    this.#port = port;
    this.#key = key;
    this.#baseNonce = baseNonce;
    this.#limit = limit ?? HPKE_MESSAGE_LIMIT;
  }

  seal(aad: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
    let nonce: Uint8Array;
    try {
      nonce = this.#take();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return this.#port.aes128GcmSeal(this.#key, nonce, aad, plaintext);
  }

  open(aad: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
    const result = this.#opening.then(async () => {
      this.#assertBelowLimit();
      const nonce = computeNonce(this.#baseNonce, this.#sequence);
      let plaintext: Uint8Array;
      try {
        plaintext = await this.#port.aes128GcmOpen(this.#key, nonce, aad, ciphertext);
      } catch {
        throw new HpkeError(
          'open-failed',
          'the message did not open: its ciphertext, its associated data or its order is not the one it was sealed with',
        );
      }
      this.#sequence += 1n;
      return plaintext;
    });
    this.#opening = result.catch(() => undefined);
    return result;
  }

  /** The nonce for the current sequence number, and the counter moved on. */
  #take(): Uint8Array {
    this.#assertBelowLimit();
    const nonce = computeNonce(this.#baseNonce, this.#sequence);
    this.#sequence += 1n;
    return nonce;
  }

  #assertBelowLimit(): void {
    if (this.#sequence >= this.#limit) {
      throw new HpkeError(
        'message-limit',
        'this context has sealed or opened as many messages as its sequence number allows; it does not wrap',
      );
    }
  }
}

/** RFC 9180 §5.2 `ComputeNonce`: `base_nonce XOR I2OSP(seq, Nn)`. */
function computeNonce(baseNonce: Uint8Array, sequence: bigint): Uint8Array {
  const counter = i2osp(sequence, NONCE_BYTES);
  const nonce = new Uint8Array(NONCE_BYTES);
  for (let index = 0; index < NONCE_BYTES; index += 1) {
    nonce[index] = (baseNonce[index] ?? 0) ^ (counter[index] ?? 0);
  }
  return nonce;
}

// --- The KEM -----------------------------------------------------------------

async function diffieHellman<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  privateKey: PrivateKey,
  publicKey: Uint8Array,
): Promise<Uint8Array> {
  let shared: Uint8Array;
  try {
    shared = await port.x25519(privateKey, publicKey);
  } catch {
    // The port's contract is to throw on an all-zero output, so a low-order
    // point usually arrives here; a key the platform will not import does too.
    throw new HpkeError(
      'invalid-public-key',
      'the public key was refused by X25519: it is not a usable Curve25519 key',
    );
  }
  if (shared.length !== X25519_KEY_BYTES || isAllZero(shared)) {
    throw new HpkeError(
      'low-order-point',
      'the Diffie–Hellman output is all zeros: the public key is a small-order point (RFC 9180 §7.1.4)',
    );
  }
  return shared;
}

/** RFC 9180 §4.1 `ExtractAndExpand`. */
async function extractAndExpand<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  dh: Uint8Array,
  kemContext: Uint8Array,
): Promise<Uint8Array> {
  const eaePrk = await labeledExtract(port, KEM_SUITE_ID, EMPTY, 'eae_prk', dh);
  return labeledExpand(port, KEM_SUITE_ID, eaePrk, 'shared_secret', kemContext, X25519_KEY_BYTES);
}

function assertPublicKey(key: Uint8Array, what: string): void {
  if (key.length !== X25519_KEY_BYTES) {
    throw new HpkeError('invalid-public-key', `${what} must be ${String(X25519_KEY_BYTES)} bytes`);
  }
}

function isAllZero(bytes: Uint8Array): boolean {
  let accumulated = 0;
  for (const byte of bytes) accumulated |= byte;
  return accumulated === 0;
}

// --- HKDF on HMAC (RFC 5869) -------------------------------------------------

/** RFC 9180 §5.3 `Context.Export`. */
async function exportSecret<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  exporterSecret: Uint8Array,
  exporterContext: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  return labeledExpand(port, HPKE_SUITE_ID, exporterSecret, 'sec', exporterContext, length);
}

/** RFC 9180 §4 `LabeledExtract`. */
async function labeledExtract<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  suiteId: Uint8Array,
  salt: Uint8Array,
  label: string,
  ikm: Uint8Array,
): Promise<Uint8Array> {
  return extract(port, salt, concat(HPKE_VERSION_LABEL, suiteId, utf8Encode(label), ikm));
}

/** RFC 9180 §4 `LabeledExpand`. */
async function labeledExpand<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  suiteId: Uint8Array,
  prk: Uint8Array,
  label: string,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  assertExpandLength(length);
  const labeledInfo = concat(
    i2osp(length, 2),
    HPKE_VERSION_LABEL,
    suiteId,
    utf8Encode(label),
    info,
  );
  return expand(port, prk, labeledInfo, length);
}

/**
 * RFC 5869 §2.2. An absent salt is `HashLen` zeros, which HMAC pads to the
 * same block as an empty key — written out because WebCrypto refuses a
 * zero-length HMAC key.
 */
async function extract<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  salt: Uint8Array,
  ikm: Uint8Array,
): Promise<Uint8Array> {
  return port.hmacSha256(salt.length === 0 ? new Uint8Array(HASH_BYTES) : salt, ikm);
}

/** RFC 5869 §2.3. */
async function expand<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  prk: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  assertExpandLength(length);
  const output = new Uint8Array(length);
  let previous: Uint8Array = EMPTY;
  for (let block = 1, filled = 0; filled < length; block += 1) {
    previous = await port.hmacSha256(prk, concat(previous, info, Uint8Array.of(block)));
    const take = Math.min(previous.length, length - filled);
    output.set(previous.subarray(0, take), filled);
    filled += take;
  }
  return output;
}

function assertExpandLength(length: number): void {
  if (!Number.isInteger(length) || length < 1 || length > 255 * HASH_BYTES) {
    throw new HpkeError(
      'invalid-length',
      `an HKDF-SHA256 output is between 1 and ${String(255 * HASH_BYTES)} bytes`,
    );
  }
}

// --- Bytes -------------------------------------------------------------------

/** RFC 8017 §4.1 `I2OSP`: `value` big-endian in exactly `width` bytes. */
function i2osp(value: number | bigint, width: number): Uint8Array {
  const bytes = new Uint8Array(width);
  let remaining = BigInt(value);
  for (let index = width - 1; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
