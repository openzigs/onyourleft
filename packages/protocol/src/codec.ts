// SPDX-License-Identifier: Apache-2.0

/**
 * The encoder and the bounded decoder.
 *
 * ## What the decoder refuses, and in what order
 *
 * Each refusal has its own {@link RefusalReason}, so a room can count them
 * apart and a test can hold each check to its own red case:
 *
 * | Order | Reason | When |
 * |---|---|---|
 * | 1 | `too-large` | over {@link MAXIMUM_MESSAGE_BYTES} of UTF-8 — **before parsing** |
 * | 2 | `too-deep` | nested past {@link MAXIMUM_NESTING_DEPTH} — **before parsing**, by a scan that never recurses |
 * | 3 | `not-json` | `JSON.parse` refuses it |
 * | 4 | `not-an-object` | valid JSON that is not an object |
 * | 5 | `unknown-type` | no `type`, or one this direction does not receive |
 * | 6 | `protocol-mismatch` | a hello from another {@link PROTOCOL_VERSION} — read before any other field, because a newer build's hello may carry fields this one does not know |
 * | 7 | `physics-mismatch` | a hello from another physics version (ADR 0028 D-2 rule 5) |
 * | 8 | `unknown-key` | a key the format does not have, at any depth (ADR 0017 D-4's choice) |
 * | 9 | `missing-key` | a required key absent |
 * | 10 | `too-long` | an array over its stated bound |
 * | 11 | `bad-value` | a value of the wrong type, out of range, not matching its pattern, or repeated where it must be distinct |
 *
 * ⚠️ **The decoder never throws.** Malformed input from a stranger is the
 * normal case for a room, and a throw is a code path the caller has to
 * remember; a {@link Decoded} cannot be ignored by accident.
 * `decode-fuzz.test.ts` holds it to that.
 *
 * ⚠️ **A refusal's detail names a path and a rule, never a value.** It is
 * built from the schema's own words and the key's name (truncated), so a log
 * line of refusals cannot become a place a stranger's payload is kept.
 */

import type { ClientMessage, ProtocolMessage, RoomMessage } from './messages';
import { PROTOCOL_VERSION } from './messages';
import {
  CLIENT_MESSAGE_TYPES,
  MAXIMUM_MESSAGE_BYTES,
  MAXIMUM_NESTING_DEPTH,
  MESSAGE_FIELDS,
  ROOM_MESSAGE_TYPES,
  type Field,
  type Shape,
} from './schema';

/** Why a message was refused. */
export type RefusalReason =
  | 'too-large'
  | 'too-deep'
  | 'not-json'
  | 'not-an-object'
  | 'unknown-type'
  | 'protocol-mismatch'
  | 'physics-mismatch'
  | 'unknown-key'
  | 'missing-key'
  | 'too-long'
  | 'bad-value';

/** Every reason, for a caller that counts them and a test that walks them. */
export const REFUSAL_REASONS: readonly RefusalReason[] = [
  'too-large',
  'too-deep',
  'not-json',
  'not-an-object',
  'unknown-type',
  'protocol-mismatch',
  'physics-mismatch',
  'unknown-key',
  'missing-key',
  'too-long',
  'bad-value',
];

export interface Refusal {
  readonly reason: RefusalReason;
  /** A path and a rule, for a log. Never a value from the message. */
  readonly detail: string;
}

export type Decoded<M> =
  { readonly ok: true; readonly message: M } | { readonly ok: false; readonly refusal: Refusal };

/** What a room expects of a client, beyond this package's own version. */
export interface DecodeExpectations {
  /** The room's `@onyourleft/physics` `PHYSICS_VERSION`. */
  readonly physicsVersion: number;
}

/** Thrown by {@link encodeMessage} for a message this format cannot carry. Only ever our own code's mistake. */
export class ProtocolEncodeError extends Error {
  override readonly name = 'ProtocolEncodeError';
  readonly refusal: Refusal;
  constructor(refusal: Refusal) {
    super(`this message cannot be encoded: ${refusal.reason} — ${refusal.detail}`);
    this.refusal = refusal;
  }
}

/** Internal: unwinds the walk to the one place a refusal becomes a result. */
class Refused extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.reason);
  }
}

function refuse(reason: RefusalReason, detail: string): never {
  throw new Refused({ reason, detail });
}

/**
 * UTF-8 length of `text`, counting no further than `stopAfter + 1`.
 *
 * By hand, because `TextEncoder` is not ECMAScript and this package's
 * `lib: ["ES2024"]` cannot name it. A lone surrogate counts three bytes, which
 * is what an encoder writes for its replacement character.
 */
export function utf8ByteLength(text: string, stopAfter = Number.POSITIVE_INFINITY): number {
  let bytes = 0;
  for (let index = 0; index < text.length && bytes <= stopAfter; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) {
      bytes += 1;
    } else if (unit < 0x800) {
      bytes += 2;
    } else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** The deepest bracket nesting outside strings. A scan, not a parse: it never recurses. */
function nestingDepth(text: string, stopAfter: number): number {
  let depth = 0;
  let deepest = 0;
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (character === '\\') {
        index += 1;
      } else if (character === '"') {
        inString = false;
      }
    } else if (character === '"') {
      inString = true;
    } else if (character === '{' || character === '[') {
      depth += 1;
      if (depth > deepest) {
        deepest = depth;
        if (deepest > stopAfter) {
          return deepest;
        }
      }
    } else if (character === '}' || character === ']') {
      depth -= 1;
    }
  }
  return deepest;
}

/** A key's name, short and quoted, for a detail line. */
function named(key: string): string {
  return JSON.stringify(key.length > 40 ? `${key.slice(0, 40)}…` : key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFields(
  record: Record<string, unknown>,
  fields: Readonly<Record<string, Field>>,
  path: string,
  ignore: readonly string[] = [],
): Record<string, unknown> {
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(fields, key) && !ignore.includes(key)) {
      refuse('unknown-key', `${path} carries ${named(key)}, which is not part of this format`);
    }
  }
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    const value = record[key];
    if (value === undefined) {
      if (field.optional !== true) {
        refuse('missing-key', `${path} is missing ${named(key)}`);
      }
      continue;
    }
    out[key] = readValue(value, field.shape, `${path}.${key}`);
  }
  return out;
}

function readValue(value: unknown, shape: Shape, path: string): unknown {
  switch (shape.kind) {
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return refuse('bad-value', `${path} must be a finite number`);
      }
      if (shape.kind === 'integer' && !Number.isInteger(value)) {
        return refuse('bad-value', `${path} must be a whole number`);
      }
      if (value < shape.minimum || value > shape.maximum) {
        return refuse(
          'bad-value',
          `${path} must be between ${String(shape.minimum)} and ${String(shape.maximum)}`,
        );
      }
      // `-0` is refused nowhere and re-encodes as `0`; normalise it here so a
      // decoded message is the one its own encoding decodes to.
      return value === 0 ? 0 : value;
    }
    case 'string': {
      if (typeof value !== 'string') {
        return refuse('bad-value', `${path} must be a string`);
      }
      if (value.length > shape.maximumLength || !shape.pattern.test(value)) {
        return refuse('bad-value', `${path} is not in the expected form`);
      }
      return value;
    }
    case 'enum': {
      if (typeof value !== 'string' || !shape.values.includes(value)) {
        return refuse('bad-value', `${path} must be one of ${shape.values.join(', ')}`);
      }
      return value;
    }
    case 'object': {
      if (!isRecord(value)) {
        return refuse('bad-value', `${path} must be an object`);
      }
      return readFields(value, shape.fields, path);
    }
    case 'array': {
      const items = readList(value, shape.maximumLength, path).map((item, index) =>
        readValue(item, shape.items, `${path}[${String(index)}]`),
      );
      if (shape.distinct === true && new Set(items).size !== items.length) {
        return refuse('bad-value', `${path} must not repeat an item`);
      }
      return items;
    }
    case 'tuple': {
      if (!Array.isArray(value) || value.length !== shape.slots.length) {
        return refuse('bad-value', `${path} must be ${String(shape.slots.length)} values`);
      }
      const out: Record<string, unknown> = {};
      shape.slots.forEach((slot, index) => {
        out[slot.name] = readValue(value[index], slot.shape, `${path}[${String(index)}]`);
      });
      return out;
    }
    case 'rows': {
      const rows = readList(value, shape.maximumLength, path).map(
        (row, index) =>
          readValue(row, shape.row, `${path}[${String(index)}]`) as Record<string, unknown>,
      );
      const first = shape.row.slots[0]?.name ?? '';
      if (new Set(rows.map((row) => row[first])).size !== rows.length) {
        return refuse('bad-value', `${path} must not repeat a ${first}`);
      }
      return rows;
    }
  }
}

function readList(value: unknown, maximumLength: number, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    return refuse('bad-value', `${path} must be a list`);
  }
  if (value.length > maximumLength) {
    return refuse('too-long', `${path} holds more than ${String(maximumLength)}`);
  }
  return value;
}

function decodeWith<M extends ProtocolMessage>(
  text: string,
  accepted: readonly M['type'][],
  expectations: DecodeExpectations | undefined,
): Decoded<M> {
  try {
    if (typeof text !== 'string') {
      refuse('not-json', 'a message must be text');
    }
    if (utf8ByteLength(text, MAXIMUM_MESSAGE_BYTES) > MAXIMUM_MESSAGE_BYTES) {
      refuse('too-large', `a message is at most ${String(MAXIMUM_MESSAGE_BYTES)} bytes`);
    }
    if (nestingDepth(text, MAXIMUM_NESTING_DEPTH) > MAXIMUM_NESTING_DEPTH) {
      refuse('too-deep', `a message nests at most ${String(MAXIMUM_NESTING_DEPTH)} deep`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      refuse('not-json', 'a message must be JSON');
    }
    if (!isRecord(parsed)) {
      refuse('not-an-object', 'a message must be a JSON object');
    }
    const type = parsed['type'];
    if (typeof type !== 'string' || !(accepted as readonly string[]).includes(type)) {
      refuse('unknown-type', 'the message type is not one this side receives');
    }
    const messageType = type as M['type'];
    if (messageType === 'hello') {
      readHandshake(parsed, expectations);
    }
    const fields = readFields(parsed, MESSAGE_FIELDS[messageType], messageType, ['type']);
    return { ok: true, message: { type: messageType, ...fields } as M };
  } catch (error) {
    if (error instanceof Refused) {
      return { ok: false, refusal: error.refusal };
    }
    throw error;
  }
}

/**
 * The version handshake, read before any other field of a hello: a newer
 * client's hello may carry fields this build has never heard of, and the
 * honest answer to it is "a different version", not "an unknown key".
 */
function readHandshake(
  hello: Record<string, unknown>,
  expectations: DecodeExpectations | undefined,
): void {
  if (hello['protocol'] !== PROTOCOL_VERSION) {
    refuse('protocol-mismatch', `this room speaks protocol ${String(PROTOCOL_VERSION)}`);
  }
  if (expectations === undefined || hello['physicsVersion'] !== expectations.physicsVersion) {
    refuse('physics-mismatch', 'this room re-simulates with a different physics version');
  }
}

/**
 * Decode what a **room** receives: a `hello` or a `report`, and nothing else.
 *
 * @param expectations the room's own physics version, which a hello must share.
 */
export function decodeClientMessage(
  text: string,
  expectations: DecodeExpectations,
): Decoded<ClientMessage> {
  return decodeWith<ClientMessage>(text, CLIENT_MESSAGE_TYPES, expectations);
}

/** Decode what a **client** receives: a `welcome`, `refuse`, `frame` or `finish`. */
export function decodeRoomMessage(text: string): Decoded<RoomMessage> {
  return decodeWith<RoomMessage>(text, ROOM_MESSAGE_TYPES, undefined);
}

function toWire(value: unknown, shape: Shape): unknown {
  switch (shape.kind) {
    case 'object':
      return fieldsToWire(value as Record<string, unknown>, shape.fields);
    case 'array':
      return (value as readonly unknown[]).map((item) => toWire(item, shape.items));
    case 'tuple':
      return shape.slots.map((slot) =>
        toWire((value as Record<string, unknown>)[slot.name], slot.shape),
      );
    case 'rows':
      return (value as readonly unknown[]).map((row) => toWire(row, shape.row));
    default:
      return value;
  }
}

function fieldsToWire(
  record: Record<string, unknown>,
  fields: Readonly<Record<string, Field>>,
): Record<string, unknown> {
  // Driven by the table rather than by a spread of the message, so a property a
  // caller hung on the object is not written into a frame the other side then
  // refuses as an unknown key.
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    const value = record[key];
    if (value !== undefined) {
      out[key] = toWire(value, field.shape);
    }
  }
  return out;
}

/**
 * Encode a message as the JSON text a WebSocket frame carries.
 *
 * ⚠️ **What it writes is decoded before it is returned**, with the decoder the
 * other side runs, and a message that would be refused throws
 * {@link ProtocolEncodeError} instead. So `decode(encode(m)) ≡ m` holds for
 * everything `encode` returns, and a `NaN`, a negative power or a rider list
 * over the bound is our own bug caught here rather than a refusal at a room.
 */
export function encodeMessage(message: ProtocolMessage): string {
  const fields = MESSAGE_FIELDS[message.type] as Readonly<Record<string, Field>>;
  const text = JSON.stringify({
    type: message.type,
    ...fieldsToWire(message as unknown as Record<string, unknown>, fields),
  });
  const decoded =
    message.type === 'hello' || message.type === 'report'
      ? decodeWith<ClientMessage>(
          text,
          CLIENT_MESSAGE_TYPES,
          message.type === 'hello' ? { physicsVersion: message.physicsVersion } : undefined,
        )
      : decodeWith<RoomMessage>(text, ROOM_MESSAGE_TYPES, undefined);
  if (!decoded.ok) {
    throw new ProtocolEncodeError(decoded.refusal);
  }
  return text;
}
