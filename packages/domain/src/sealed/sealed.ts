// SPDX-License-Identifier: Apache-2.0

/**
 * The sealed request between the app and its instance (#1191, ADR 0047 D-8,
 * D-9): the envelope, the AAD, the device's `oyl-sealed-request-v1`
 * statement, the padding, the plaintext's framing, and the two halves of
 * sealing and opening — written once here, so the device and the instance run
 * the same lines over {@link HpkePrimitives}, as `hpke/hpke.ts` does.
 *
 * ## The wire
 *
 * - A request is `POST /v1/sealed` with `{ "v": 1, "keyId", "enc", "ct" }`;
 *   `enc` and `ct` are unpadded base64url. HPKE `info` is `"oyl-sealed-v1"`.
 * - A reply is `{ "v": 1, "nonce", "ct" }`, `nonce` being D-2's
 *   `response_nonce`.
 * - A stream is `text/event-stream` whose every frame is ONE `data:` line and
 *   nothing else: the first `{ "v": 1, "nonce", "ct" }`, each later one
 *   `{ "ct" }`. An event's id and kind are inside its ciphertext, never an
 *   `event:` or `id:` field. Events take consecutive sequence numbers under
 *   the one reply key, so a dropped, duplicated or reordered event does not
 *   open; and every stream ends with a sealed `end` event, so one cut short is
 *   told apart from one that finished.
 *
 * ## The AAD
 *
 * The RFC 8785 bytes of `{ purpose: "oyl-sealed-aad-v1", direction,
 * instanceOrigin, keyId, tokenSha256 }` — `tokenSha256` the SHA-256 (hex) of
 * the session token, or JSON `null` for a request with no session — and for a
 * reply, the same with `direction: "response"`, `enc` and `response_nonce`
 * (both hex). A ciphertext moved to another session, instance or key does not
 * open. `canonical.ts` refuses `null` by design, so {@link aadBytes} writes
 * the one object it is needed in itself, with every string member through
 * `canonicalJson` and the keys in RFC 8785's order.
 *
 * ## The plaintext
 *
 * Padded ({@link pad}), and inside the padding a FRAME: a 4-byte big-endian
 * header length, the header as UTF-8 JSON, and the body's bytes. A request's
 * header is `{ method, path, issuedAt, signer?, signature?, lastEventId? }`;
 * a reply's `{ status, contentType }`; a stream event's `{ id, kind }`. A body
 * is bytes, so a JSON body inside the ciphertext is not escaped a second time
 * and an original activity file costs what it weighs.
 *
 * ## What is NOT here
 *
 * The order of the instance's checks, the replay record, the route table and
 * the clock offset: those are `apps/instance/src/sealed/` and
 * `apps/web/src/instance/instance-transport.ts`.
 */

import { canonicalBytes, canonicalJson } from '../identity/canonical';
import { isHexOfLength, toHex } from '../identity/hex';
import type { Sha256, SigningKey } from '../identity/seam';
import { utf8Encode } from '../identity/utf8';
import {
  openReply,
  sealReply,
  setupBaseRecipient,
  setupBaseSender,
  X25519_KEY_BYTES,
  HPKE_RESPONSE_NONCE_BYTES,
  type HpkeRecipientContext,
  type HpkeReplyOpener,
  type HpkeReplySealer,
  type HpkeSenderContext,
} from '../hpke/hpke';
import type { HpkePrimitives, X25519KeyPair } from '../hpke/primitives';

/** The envelope's version: `v`. */
export const SEALED_VERSION = 1;
/** The one sealed endpoint. */
export const SEALED_PATH = '/v1/sealed';
/** HPKE `info` (D-9). */
export const SEALED_INFO = 'oyl-sealed-v1';
/** The device statement's purpose (D-8): distinct from every `DevicePurpose`. */
export const SEALED_REQUEST_PURPOSE = 'oyl-sealed-request-v1';
/** The AAD's purpose member. */
export const SEALED_AAD_PURPOSE = 'oyl-sealed-aad-v1';
/** A request signed further than this from the instance's clock is `stale_request` (D-9). */
export const SEALED_FRESHNESS_SECONDS = 120;
/** How long the instance remembers an `enc` it has seen (D-9). */
export const SEALED_REPLAY_SECONDS = 600;
/** Above this difference the app tells the rider their clock is off (D-9). */
export const SEALED_CLOCK_NOTICE_SECONDS = 300;
/** The `kind` of the event every stream ends with. */
export const SEALED_END_KIND = 'end';

/** The smallest padded plaintext, and the bucket every message starts from. */
export const PAD_MINIMUM_BYTES = 256;
/** Padding goes by powers of two up to here, then by multiples of it. */
export const PAD_POWER_CEILING_BYTES = 64 * 1024;
/** A request carrying a pasted key is padded to at least this, so its length names no provider. */
export const PASTED_KEY_PAD_BYTES = 1024;
/** A stream event is padded to a multiple of this. */
export const EVENT_PAD_STEP_BYTES = 256;
/** The largest frame header, in bytes: a method, a path, a signature and an id. */
export const MAXIMUM_FRAME_HEADER_BYTES = 4096;
/** AES-128-GCM's tag. */
export const SEALED_TAG_BYTES = 16;

const LENGTH_PREFIX_BYTES = 4;

/** Why a sealed message did not decode. Never carries a byte of what it refused. */
export type SealedRefusal = 'envelope' | 'padding' | 'frame' | 'stream';

export class SealedError extends Error {
  readonly reason: SealedRefusal;
  constructor(reason: SealedRefusal, message: string) {
    super(message);
    this.name = 'SealedError';
    this.reason = reason;
  }
}

// --- base64url, unpadded (RFC 4648 §5) ---------------------------------------

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BASE64URL_INDEX = new Map([...BASE64URL].map((character, index) => [character, index]));

/** Unpadded base64url. */
export function toBase64url(bytes: Uint8Array): string {
  let out = '';
  for (let at = 0; at < bytes.length; at += 3) {
    const a = bytes[at] ?? 0;
    const b = bytes[at + 1] ?? 0;
    const c = bytes[at + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    const left = bytes.length - at;
    out += BASE64URL[(triple >> 18) & 63];
    out += BASE64URL[(triple >> 12) & 63];
    if (left > 1) out += BASE64URL[(triple >> 6) & 63];
    if (left > 2) out += BASE64URL[triple & 63];
  }
  return out;
}

/** Unpadded base64url to bytes, or `undefined` for anything that is not exactly that. */
export function fromBase64url(text: string): Uint8Array | undefined {
  if (text.length % 4 === 1) return undefined;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let at = 0;
  for (let index = 0; index < text.length; index += 4) {
    const chunk = text.slice(index, index + 4);
    let triple = 0;
    for (let position = 0; position < 4; position += 1) {
      const character = chunk[position];
      const value = character === undefined ? 0 : BASE64URL_INDEX.get(character);
      if (value === undefined) return undefined;
      triple = (triple << 6) | value;
    }
    const bytes = chunk.length - 1;
    if (bytes >= 1) out[at++] = (triple >> 16) & 0xff;
    if (bytes >= 2) out[at++] = (triple >> 8) & 0xff;
    if (bytes >= 3) out[at++] = triple & 0xff;
    // The bits past the last byte must be zero: one spelling per byte string.
    const spare = chunk.length === 2 ? triple & 0xffff : chunk.length === 3 ? triple & 0xff : 0;
    if (spare !== 0) return undefined;
  }
  return out;
}

// --- UTF-8 decoding ------------------------------------------------------------

/** Strict UTF-8 to a string: `undefined` for any invalid or overlong sequence. */
export function utf8Decode(bytes: Uint8Array): string | undefined {
  let out = '';
  for (let at = 0; at < bytes.length;) {
    const first = bytes[at] as number;
    let code: number;
    let length: number;
    if (first < 0x80) {
      code = first;
      length = 1;
    } else if (first >= 0xc2 && first < 0xe0) {
      code = first & 0x1f;
      length = 2;
    } else if (first >= 0xe0 && first < 0xf0) {
      code = first & 0x0f;
      length = 3;
    } else if (first >= 0xf0 && first < 0xf5) {
      code = first & 0x07;
      length = 4;
    } else {
      return undefined;
    }
    if (at + length > bytes.length) return undefined;
    for (let next = 1; next < length; next += 1) {
      const byte = bytes[at + next] as number;
      if ((byte & 0xc0) !== 0x80) return undefined;
      code = (code << 6) | (byte & 0x3f);
    }
    if (
      (length === 3 && (code < 0x800 || (code >= 0xd800 && code <= 0xdfff))) ||
      (length === 4 && (code < 0x10000 || code > 0x10ffff))
    ) {
      return undefined;
    }
    out += String.fromCodePoint(code);
    at += length;
  }
  return out;
}

// --- Padding -----------------------------------------------------------------

/**
 * The padded length of a message whose content (with its 4-byte length
 * prefix) is `framed` bytes: the next power of two from `minimum` up to
 * 64 KiB, then the next multiple of 64 KiB.
 */
export function paddedLength(framed: number, minimum = PAD_MINIMUM_BYTES): number {
  let size = Math.max(minimum, PAD_MINIMUM_BYTES);
  while (size < framed && size < PAD_POWER_CEILING_BYTES) size *= 2;
  if (size >= framed) return size;
  return Math.ceil(framed / PAD_POWER_CEILING_BYTES) * PAD_POWER_CEILING_BYTES;
}

/** A stream event's padded length: a multiple of 256 bytes. */
export function paddedEventLength(framed: number): number {
  return Math.max(1, Math.ceil(framed / EVENT_PAD_STEP_BYTES)) * EVENT_PAD_STEP_BYTES;
}

function withLength(content: Uint8Array, total: number): Uint8Array {
  const out = new Uint8Array(total);
  const length = content.length;
  out[0] = (length >>> 24) & 0xff;
  out[1] = (length >>> 16) & 0xff;
  out[2] = (length >>> 8) & 0xff;
  out[3] = length & 0xff;
  out.set(content, LENGTH_PREFIX_BYTES);
  return out;
}

/** `content` padded to its bucket: a length prefix, the content, and zeros. */
export function pad(content: Uint8Array, minimum = PAD_MINIMUM_BYTES): Uint8Array {
  return withLength(content, paddedLength(content.length + LENGTH_PREFIX_BYTES, minimum));
}

/** `content` padded as a stream event. */
export function padEvent(content: Uint8Array): Uint8Array {
  return withLength(content, paddedEventLength(content.length + LENGTH_PREFIX_BYTES));
}

/**
 * The content inside a padded message, checking the padding: the stated
 * length fits, every padding byte is zero, and the total is the bucket the
 * content belongs in — at the ordinary minimum or a pasted key's.
 *
 * @throws {SealedError} `padding` otherwise.
 */
export function unpad(padded: Uint8Array, kind: 'message' | 'event' = 'message'): Uint8Array {
  const refuse = (): never => {
    throw new SealedError('padding', 'the padding is not the length its content requires');
  };
  if (padded.length < LENGTH_PREFIX_BYTES) refuse();
  const length =
    (((padded[0] as number) << 24) >>> 0) +
    ((padded[1] as number) << 16) +
    ((padded[2] as number) << 8) +
    (padded[3] as number);
  const framed = length + LENGTH_PREFIX_BYTES;
  if (framed > padded.length) refuse();
  const expected =
    kind === 'event'
      ? [paddedEventLength(framed)]
      : [paddedLength(framed), paddedLength(framed, PASTED_KEY_PAD_BYTES)];
  if (!expected.includes(padded.length)) refuse();
  for (let at = framed; at < padded.length; at += 1) if (padded[at] !== 0) refuse();
  return padded.slice(LENGTH_PREFIX_BYTES, framed);
}

// --- Framing -----------------------------------------------------------------

/** A header and a body as one byte string: the header's length, its JSON, the body. */
export function encodeFrame(
  header: Readonly<Record<string, unknown>>,
  body: Uint8Array,
): Uint8Array {
  const json = utf8Encode(JSON.stringify(header));
  if (json.length > MAXIMUM_FRAME_HEADER_BYTES) {
    throw new SealedError('frame', 'a sealed header is larger than the limit');
  }
  const out = new Uint8Array(LENGTH_PREFIX_BYTES + json.length + body.length);
  out.set(withLength(json, LENGTH_PREFIX_BYTES + json.length));
  out.set(body, LENGTH_PREFIX_BYTES + json.length);
  return out;
}

/**
 * A frame's header and body.
 *
 * @throws {SealedError} `frame` for a frame that is not one, or whose header
 * is not a JSON object.
 */
export function decodeFrame(frame: Uint8Array): {
  readonly header: Readonly<Record<string, unknown>>;
  readonly body: Uint8Array;
} {
  const refuse = (): never => {
    throw new SealedError('frame', 'the sealed plaintext is not a header and a body');
  };
  if (frame.length < LENGTH_PREFIX_BYTES) refuse();
  const length =
    (((frame[0] as number) << 24) >>> 0) +
    ((frame[1] as number) << 16) +
    ((frame[2] as number) << 8) +
    (frame[3] as number);
  if (length > MAXIMUM_FRAME_HEADER_BYTES || LENGTH_PREFIX_BYTES + length > frame.length) refuse();
  const text = utf8Decode(frame.subarray(LENGTH_PREFIX_BYTES, LENGTH_PREFIX_BYTES + length));
  if (text === undefined) return refuse();
  let header: unknown;
  try {
    header = JSON.parse(text);
  } catch {
    return refuse();
  }
  if (typeof header !== 'object' || header === null || Array.isArray(header)) return refuse();
  return {
    header: header as Record<string, unknown>,
    body: frame.slice(LENGTH_PREFIX_BYTES + length),
  };
}

// --- The AAD and the statement -------------------------------------------------

/** What binds a request to one instance, one encryption key and one session. */
export interface SealedBinding {
  readonly instanceOrigin: string;
  readonly keyId: string;
  /** The session token's SHA-256, lowercase hex; `null` for a request with no session. */
  readonly tokenSha256: string | null;
}

/** RFC 8785 for an object of strings and `null`s — the one place `null` is a value here. */
function aadBytes(members: Readonly<Record<string, string | null>>): Uint8Array {
  const keys = Object.keys(members).sort();
  const body = keys
    .map((key) => {
      const value = members[key];
      return `${canonicalJson(key)}:${value === null || value === undefined ? 'null' : canonicalJson(value)}`;
    })
    .join(',');
  return utf8Encode(`{${body}}`);
}

/** A request's AAD (D-9). */
export function sealedRequestAad(binding: SealedBinding): Uint8Array {
  return aadBytes({
    purpose: SEALED_AAD_PURPOSE,
    direction: 'request',
    instanceOrigin: binding.instanceOrigin,
    keyId: binding.keyId,
    tokenSha256: binding.tokenSha256,
  });
}

/** Each reply message's AAD (D-9): the request's binding, its `enc` and the reply's nonce. */
export function sealedResponseAad(
  binding: SealedBinding,
  enc: Uint8Array,
  responseNonce: Uint8Array,
): Uint8Array {
  return aadBytes({
    purpose: SEALED_AAD_PURPOSE,
    direction: 'response',
    instanceOrigin: binding.instanceOrigin,
    keyId: binding.keyId,
    tokenSha256: binding.tokenSha256,
    enc: toHex(enc),
    response_nonce: toHex(responseNonce),
  });
}

/** What a device signs for one sealed request (D-8). */
export interface SealedRequestStatement {
  readonly instanceOrigin: string;
  readonly keyId: string;
  /** The request's `enc`, lowercase hex: the signature is bound to this one HPKE context. */
  readonly enc: string;
  readonly method: string;
  readonly path: string;
  /** Unix seconds. */
  readonly issuedAt: number;
  /** SHA-256 of the inner body's bytes (of no bytes, for none), lowercase hex. */
  readonly bodySha256: string;
}

/** The bytes a device signs: the statement's RFC 8785 form, with its own purpose. */
export function sealedRequestStatementBytes(statement: SealedRequestStatement): Uint8Array {
  return canonicalBytes({
    purpose: SEALED_REQUEST_PURPOSE,
    instanceOrigin: statement.instanceOrigin,
    keyId: statement.keyId,
    enc: statement.enc,
    method: statement.method,
    path: statement.path,
    issuedAt: statement.issuedAt,
    bodySha256: statement.bodySha256,
  });
}

// --- The envelope --------------------------------------------------------------

/** The request on the wire. */
export interface SealedEnvelope {
  readonly v: typeof SEALED_VERSION;
  readonly keyId: string;
  readonly enc: string;
  readonly ct: string;
}

/** A parsed envelope: its fields as bytes. */
export interface ParsedEnvelope {
  readonly keyId: string;
  readonly enc: Uint8Array;
  readonly ct: Uint8Array;
}

/** The envelope in `json`, or `undefined` for anything that is not exactly one. */
export function parseSealedEnvelope(
  json: Readonly<Record<string, unknown>>,
): ParsedEnvelope | undefined {
  const { v, keyId, enc, ct } = json;
  if (Object.keys(json).length !== 4 || v !== SEALED_VERSION) return undefined;
  if (typeof keyId !== 'string' || !/^[0-9a-f]{16}$/.test(keyId)) return undefined;
  if (typeof enc !== 'string' || typeof ct !== 'string') return undefined;
  const encBytes = fromBase64url(enc);
  const ctBytes = fromBase64url(ct);
  if (encBytes?.length !== X25519_KEY_BYTES || ctBytes === undefined) return undefined;
  if (ctBytes.length < SEALED_TAG_BYTES + PAD_MINIMUM_BYTES) return undefined;
  return { keyId, enc: encBytes, ct: ctBytes };
}

/**
 * The largest envelope `POST /v1/sealed` reads when the plaintext routes read
 * `innerLimit` bytes (D-9): the inner limit plus the framing, rounded up to
 * its padding bucket, plus the tag, times 4/3 for base64url, plus the
 * envelope's own members. Checked before any cryptography.
 */
export function sealedEnvelopeLimit(innerLimit: number): number {
  const framed =
    LENGTH_PREFIX_BYTES + LENGTH_PREFIX_BYTES + MAXIMUM_FRAME_HEADER_BYTES + innerLimit;
  const ciphertext = paddedLength(framed) + SEALED_TAG_BYTES;
  const encoded = Math.ceil((ciphertext * 4) / 3);
  // `{"v":1,"keyId":"<16>","enc":"<43>","ct":""}` and room for whitespace.
  return encoded + 256;
}

// --- The device's half ---------------------------------------------------------

/** The instance's encryption key a request is sealed to: from its signed statement (#1189). */
export interface SealedInstanceKey {
  readonly keyId: string;
  readonly publicKey: Uint8Array;
}

/** What {@link sealRequest} needs. */
export interface SealRequestInput<PrivateKey> {
  readonly primitives: HpkePrimitives<PrivateKey>;
  readonly sha256: Sha256;
  readonly instanceOrigin: string;
  readonly instanceKey: SealedInstanceKey;
  /** The session token, or `null` for a sessionless request. Only its SHA-256 is used. */
  readonly sessionToken: string | null;
  readonly method: string;
  /** The inner path, query included. */
  readonly path: string;
  readonly body: Uint8Array | null;
  /** Unix seconds: the device's clock plus its offset to this instance. */
  readonly issuedAt: number;
  /**
   * The key that signs the request's statement: the session's device key, or
   * for a sessionless request the key its inner statement adds. Absent only for
   * `recover/email`, whose `issuedAt` travels unsigned (D-8).
   */
  readonly signer?: SigningKey;
  /** Resume a stream after this event id. */
  readonly lastEventId?: string;
  /** At least this padded size: {@link PASTED_KEY_PAD_BYTES} for a pasted key. */
  readonly minimumPadding?: number;
}

/** A reply, opened. */
export interface OpenedSealedReply {
  readonly status: number;
  readonly contentType: string;
  readonly body: Uint8Array;
}

/** One stream event, opened. */
export interface SealedEvent {
  readonly id: string;
  readonly kind: string;
  readonly data: Uint8Array;
}

/** Opens a stream's events in order. One that fails leaves it unable to open another. */
export interface SealedStreamOpener {
  /** Open the JSON of one frame's `data:` line. @throws {SealedError} `stream`. */
  open(frameData: string): Promise<SealedEvent>;
}

/** A sealed request, and the context its reply opens under. Held in memory only, for one request. */
export interface SealedRequest {
  readonly envelope: SealedEnvelope;
  /** @throws {SealedError}, or an `HpkeError`, for a reply that is not this request's. */
  openReply(reply: unknown): Promise<OpenedSealedReply>;
  streamOpener(): SealedStreamOpener;
}

async function sha256Hex(sha256: Sha256, bytes: Uint8Array): Promise<string> {
  return toHex(await sha256(bytes));
}

/** The SHA-256 of a session token as the instance stores it: hex over its UTF-8. */
export async function sessionTokenSha256(sha256: Sha256, token: string): Promise<string> {
  return sha256Hex(sha256, utf8Encode(token));
}

/** Seal one request to the instance (D-8, D-9). */
export async function sealRequest<PrivateKey>(
  input: SealRequestInput<PrivateKey>,
): Promise<SealedRequest> {
  const binding: SealedBinding = {
    instanceOrigin: input.instanceOrigin,
    keyId: input.instanceKey.keyId,
    tokenSha256:
      input.sessionToken === null
        ? null
        : await sessionTokenSha256(input.sha256, input.sessionToken),
  };
  const context = await setupBaseSender(
    input.primitives,
    input.instanceKey.publicKey,
    utf8Encode(SEALED_INFO),
  );
  const body = input.body ?? new Uint8Array(0);
  const header: Record<string, unknown> = {
    method: input.method,
    path: input.path,
    issuedAt: input.issuedAt,
    ...(input.lastEventId === undefined ? {} : { lastEventId: input.lastEventId }),
  };
  if (input.signer !== undefined) {
    const statement: SealedRequestStatement = {
      instanceOrigin: input.instanceOrigin,
      keyId: input.instanceKey.keyId,
      enc: toHex(context.enc),
      method: input.method,
      path: input.path,
      issuedAt: input.issuedAt,
      bodySha256: await sha256Hex(input.sha256, body),
    };
    header.signer = toHex(input.signer.publicKey);
    header.signature = toHex(await input.signer.sign(sealedRequestStatementBytes(statement)));
  }
  const plaintext = pad(encodeFrame(header, body), input.minimumPadding);
  const ct = await context.seal(sealedRequestAad(binding), plaintext);
  return {
    envelope: {
      v: SEALED_VERSION,
      keyId: input.instanceKey.keyId,
      enc: toBase64url(context.enc),
      ct: toBase64url(ct),
    },
    openReply: (reply) => openSealedReply(input.primitives, context, binding, reply),
    streamOpener: () => sealedStreamOpener(input.primitives, context, binding),
  };
}

function replyFields(reply: unknown): { nonce?: Uint8Array; ct: Uint8Array } | undefined {
  if (typeof reply !== 'object' || reply === null) return undefined;
  const { v, nonce, ct } = reply as Record<string, unknown>;
  if (typeof ct !== 'string') return undefined;
  const ctBytes = fromBase64url(ct);
  if (ctBytes === undefined) return undefined;
  if (nonce === undefined && v === undefined) return { ct: ctBytes };
  if (v !== SEALED_VERSION || typeof nonce !== 'string') return undefined;
  const nonceBytes = fromBase64url(nonce);
  if (nonceBytes?.length !== HPKE_RESPONSE_NONCE_BYTES) return undefined;
  return { nonce: nonceBytes, ct: ctBytes };
}

async function openSealedReply<PrivateKey>(
  primitives: HpkePrimitives<PrivateKey>,
  context: HpkeSenderContext,
  binding: SealedBinding,
  reply: unknown,
): Promise<OpenedSealedReply> {
  const fields = replyFields(reply);
  if (fields?.nonce === undefined) {
    throw new SealedError('envelope', 'the reply is not a sealed reply');
  }
  const opener = await openReply(primitives, context, fields.nonce);
  const opened = await opener.open(
    sealedResponseAad(binding, context.enc, fields.nonce),
    fields.ct,
  );
  const { header, body } = decodeFrame(unpad(opened));
  const { status, contentType } = header;
  if (typeof status !== 'number' || !Number.isInteger(status) || typeof contentType !== 'string') {
    throw new SealedError('frame', 'the reply header is not a status and a content type');
  }
  return { status, contentType, body };
}

function sealedStreamOpener<PrivateKey>(
  primitives: HpkePrimitives<PrivateKey>,
  context: HpkeSenderContext,
  binding: SealedBinding,
): SealedStreamOpener {
  let opener: { open: HpkeReplyOpener['open']; aad: Uint8Array } | undefined;
  let broken = false;
  const refuse = (): never => {
    broken = true;
    throw new SealedError('stream', 'a stream event did not open in order');
  };
  return {
    async open(frameData) {
      if (broken) return refuse();
      let parsed: unknown;
      try {
        parsed = JSON.parse(frameData);
      } catch {
        return refuse();
      }
      const fields = replyFields(parsed);
      if (fields === undefined) return refuse();
      if (opener === undefined) {
        if (fields.nonce === undefined) return refuse();
        const made = await openReply(primitives, context, fields.nonce);
        opener = {
          open: (aad, ct) => made.open(aad, ct),
          aad: sealedResponseAad(binding, context.enc, fields.nonce),
        };
      } else if (fields.nonce !== undefined) {
        return refuse();
      }
      let opened: Uint8Array;
      try {
        opened = await opener.open(opener.aad, fields.ct);
      } catch {
        return refuse();
      }
      try {
        const { header, body } = decodeFrame(unpad(opened, 'event'));
        if (typeof header.id !== 'string' || typeof header.kind !== 'string') return refuse();
        return { id: header.id, kind: header.kind, data: body };
      } catch {
        return refuse();
      }
    },
  };
}

// --- The instance's half --------------------------------------------------------

/** A request the instance opened: its context, and the padded plaintext's frame. */
export interface OpenedSealedRequest {
  readonly context: HpkeRecipientContext;
  /** The plaintext, still padded: the caller unpads, so a padding fault is answered sealed. */
  readonly padded: Uint8Array;
}

/**
 * Decap and open one envelope (D-9's step 3).
 *
 * @throws an `HpkeError` when it does not open — a ciphertext sealed under
 * another binding, another key or another session included.
 */
export async function openSealedRequest<PrivateKey>(
  primitives: HpkePrimitives<PrivateKey>,
  recipient: X25519KeyPair<PrivateKey>,
  envelope: ParsedEnvelope,
  binding: SealedBinding,
): Promise<OpenedSealedRequest> {
  const context = await setupBaseRecipient(
    primitives,
    recipient,
    envelope.enc,
    utf8Encode(SEALED_INFO),
  );
  const padded = await context.open(sealedRequestAad(binding), envelope.ct);
  return { context, padded };
}

/** The instance's side of one reply: a whole response, or a stream's events. */
export interface SealedReplyWriter {
  /** One whole response, as its `{ v, nonce, ct }`. Only once, and not with {@link event}. */
  reply(status: number, contentType: string, body: Uint8Array): Promise<Record<string, unknown>>;
  /** One stream event as the JSON of its `data:` line: the first carries the nonce. */
  event(id: string, kind: string, data: Uint8Array): Promise<string>;
}

/** The reply to a request the instance opened (D-2): a fresh nonce, then message after message. */
export async function sealedReplyWriter<PrivateKey>(
  primitives: HpkePrimitives<PrivateKey>,
  request: HpkeRecipientContext,
  binding: SealedBinding,
): Promise<SealedReplyWriter> {
  const sealer: HpkeReplySealer = await sealReply(primitives, request);
  const aad = sealedResponseAad(binding, request.enc, sealer.responseNonce);
  const nonce = toBase64url(sealer.responseNonce);
  let first = true;
  return {
    async reply(status, contentType, body) {
      const ct = await sealer.seal(aad, pad(encodeFrame({ status, contentType }, body)));
      return { v: SEALED_VERSION, nonce, ct: toBase64url(ct) };
    },
    async event(id, kind, data) {
      const ct = toBase64url(await sealer.seal(aad, padEvent(encodeFrame({ id, kind }, data))));
      const frame = first ? { v: SEALED_VERSION, nonce, ct } : { ct };
      first = false;
      return JSON.stringify(frame);
    },
  };
}

/** The statement's `bodySha256`, as the instance computes it from the body it opened. */
export async function sealedBodySha256(sha256: Sha256, body: Uint8Array): Promise<string> {
  return sha256Hex(sha256, body);
}

/** Whether `value` is a 64-character lowercase hex string: a key or a digest. */
export function isLowerHex32(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) && isHexOfLength(value, 32);
}
