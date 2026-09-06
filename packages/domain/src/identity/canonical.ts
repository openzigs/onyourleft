// SPDX-License-Identifier: Apache-2.0

/**
 * The canonical serialisation a signature is taken over — **RFC 8785**, the
 * JSON Canonicalization Scheme, restricted to the value types a record uses.
 *
 * ## Why a published scheme rather than "whatever `JSON.stringify` produced"
 *
 * #61's fourth acceptance criterion is that a verifier written **from the
 * record spec**, and not against this code, verifies a record this code
 * produced. That is only possible if "the bytes that were signed" is a
 * statement somebody else can implement. `JSON.stringify` is not one: it
 * preserves insertion order, so two builds that construct the same record in a
 * different order sign different bytes, and neither is wrong.
 *
 * RFC 8785 (Informational, June 2020) pins the three things that vary:
 *
 * 1. **Member order** — sorted by the UTF-16 code units of the member names.
 *    JavaScript's default `Array.prototype.sort` on strings is exactly that
 *    comparison, which is not a coincidence: the scheme is specified in terms
 *    of ECMAScript.
 * 2. **Number formatting** — the ECMAScript `Number::toString` algorithm, the
 *    shortest representation that round-trips. `String(n)` is that algorithm.
 *    `-0` serialises as `0`.
 * 3. **String escaping** — the minimal set: `"` and `\`, the five short forms
 *    for the control characters that have them, and `\u00xx` in lowercase for
 *    every other character below U+0020. Nothing else is escaped, so a
 *    non-ASCII character is emitted literally and carried by the UTF-8
 *    encoding.
 *
 * There are off-the-shelf JCS implementations in Java, Python, Go, Rust, .NET
 * and C, so "write a verifier from the spec" is a morning's work in any of
 * them rather than a reimplementation of this file.
 *
 * ## Where this is deliberately stricter than RFC 8785
 *
 * - **`null` is rejected.** JCS serialises it. This module does not accept it,
 *   because a record format needs one spelling of "no value" and having two —
 *   absent, and present-but-null — is a distinction every future consumer has
 *   to get right and nothing checks. Absent is the spelling; an optional member
 *   is simply not emitted.
 * - **Non-finite numbers are rejected** rather than being an unrepresentable
 *   value the caller discovers later.
 * - **Unpaired surrogates are rejected**, by `utf8Encode`. RFC 8785 §3.2.3
 *   requires this.
 *
 * All three are narrowings: every document this module emits is a valid JCS
 * document, so a stock JCS verifier reproduces these bytes exactly.
 */

import { IdentityError } from './errors';
import { utf8Encode } from './utf8';

/** A value this module can canonicalise. `null` and `undefined` are not values. */
export type CanonicalValue = string | number | boolean | CanonicalArray | CanonicalObject;

/** @see CanonicalValue */
export type CanonicalArray = readonly CanonicalValue[];

/**
 * @see CanonicalValue
 *
 * `undefined` is admitted in the *type* so that an interface with optional
 * members is assignable, and is treated as **absent** by the serialiser — the
 * member is not emitted. It is never a value.
 */
export interface CanonicalObject {
  readonly [member: string]: CanonicalValue | undefined;
}

/** RFC 8785 §3.2.2.2 — the short escape forms, by code point. */
const SHORT_ESCAPES = new Map<number, string>([
  [0x08, '\\b'],
  [0x09, '\\t'],
  [0x0a, '\\n'],
  [0x0c, '\\f'],
  [0x0d, '\\r'],
  [0x22, '\\"'],
  [0x5c, '\\\\'],
]);

function canonicalString(value: string): string {
  let out = '"';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const short = SHORT_ESCAPES.get(code);
    if (short !== undefined) {
      out += short;
    } else if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else {
      out += value[index];
    }
  }
  return `${out}"`;
}

function canonicalNumber(value: number, at: string): string {
  if (!Number.isFinite(value)) {
    throw new IdentityError(`${at} must be a finite number`);
  }
  // RFC 8785: negative zero serialises as `0`. `String(-0)` already gives "0",
  // but `Object.is(-0, 0)` is false and a future reader should not have to
  // rediscover which way round it is, so it is written out.
  return value === 0 ? '0' : String(value);
}

function canonicalise(value: CanonicalValue, at: string): string {
  if (typeof value === 'string') {
    return canonicalString(value);
  }
  if (typeof value === 'number') {
    return canonicalNumber(value, at);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (Array.isArray(value)) {
    const items = (value as CanonicalArray).map((item, index) => {
      if (item === null || item === undefined) {
        throw new IdentityError(`${at}[${String(index)}] must not be null or absent`);
      }
      return canonicalise(item, `${at}[${String(index)}]`);
    });
    return `[${items.join(',')}]`;
  }
  if (value === null) {
    throw new IdentityError(
      `${at} must not be null — an absent member is how "no value" is spelled`,
    );
  }

  const object = value as CanonicalObject;
  // Default `sort` compares by UTF-16 code units, which is what RFC 8785 §3.2.3
  // asks for. `localeCompare` would be locale-dependent and therefore not
  // canonical at all; that is the mistake this comment exists to forestall.
  const members = Object.keys(object).sort();
  const parts: string[] = [];
  for (const member of members) {
    const child = object[member];
    if (child === undefined) {
      continue;
    }
    parts.push(`${canonicalString(member)}:${canonicalise(child, `${at}.${member}`)}`);
  }
  return `{${parts.join(',')}}`;
}

/**
 * The RFC 8785 canonical JSON text of `value`.
 *
 * @throws {IdentityError} on `null`, a non-finite number, or an unpaired
 * surrogate reached through {@link canonicalBytes}.
 */
export function canonicalJson(value: CanonicalValue): string {
  return canonicalise(value, 'value');
}

/**
 * The bytes a signature is taken over: {@link canonicalJson}, UTF-8 encoded.
 *
 * This is the whole of "what exactly is signed". Everything else in the record
 * format is which members go in.
 *
 * @throws {IdentityError}
 */
export function canonicalBytes(value: CanonicalValue): Uint8Array {
  return utf8Encode(canonicalJson(value));
}
