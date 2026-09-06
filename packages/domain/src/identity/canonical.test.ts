// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { canonicalBytes, canonicalJson } from './canonical';
import { IdentityError } from './errors';

/**
 * The canonicalisation is the whole of "what exactly is signed", so these cases
 * are the record format's contract with any verifier written from the spec.
 * Several of them are RFC 8785's own examples, named where they are.
 */
describe('canonicalJson — RFC 8785, restricted', () => {
  it('sorts members by UTF-16 code unit rather than by insertion order', () => {
    // The property that makes a signature reproducible: two builds that
    // construct the same record in a different order sign the same bytes.
    const a = canonicalJson({ b: 1, a: 2, c: 3 });
    const b = canonicalJson({ c: 3, b: 1, a: 2 });

    expect(a).toBe('{"a":2,"b":1,"c":3}');
    expect(b).toBe(a);
  });

  it('sorts by code unit and not by locale', () => {
    // `localeCompare` orders these the other way round in most locales, which
    // is exactly why the implementation must not use it: a canonical form that
    // depends on the reader's locale is not canonical.
    expect(canonicalJson({ ä: 1, z: 2 })).toBe('{"z":2,"ä":1}');
  });

  it('sorts nested members too, at every depth', () => {
    expect(canonicalJson({ outer: { b: 1, a: 2 }, a: 3 })).toBe('{"a":3,"outer":{"a":2,"b":1}}');
  });

  it('emits no whitespace at all', () => {
    expect(canonicalJson({ a: [1, 2], b: { c: true } })).toBe('{"a":[1,2],"b":{"c":true}}');
  });

  it('formats numbers with the ECMAScript shortest-round-trip algorithm', () => {
    expect(canonicalJson({ n: 42195.5 })).toBe('{"n":42195.5}');
    expect(canonicalJson({ n: 1e21 })).toBe('{"n":1e+21}');
    expect(canonicalJson({ n: 0.1 })).toBe('{"n":0.1}');
    expect(canonicalJson({ n: 1_700_000_000 })).toBe('{"n":1700000000}');
  });

  it('serialises negative zero as 0, per RFC 8785', () => {
    expect(canonicalJson({ n: -0 })).toBe('{"n":0}');
  });

  it('escapes only what RFC 8785 escapes, and leaves non-ASCII literal', () => {
    expect(canonicalJson({ s: 'a"b\\c' })).toBe('{"s":"a\\"b\\\\c"}');
    expect(canonicalJson({ s: '\b\t\n\f\r' })).toBe('{"s":"\\b\\t\\n\\f\\r"}');
    // U+0001 has no short form, so it is \u0001 in lowercase hex.
    expect(canonicalJson({ s: '\u0001' })).toBe('{"s":"\\u0001"}');
    // Not escaped: a canonical document is UTF-8 and carries these literally.
    expect(canonicalJson({ s: 'Grüße — 日本' })).toBe('{"s":"Grüße — 日本"}');
  });

  it('escapes a member name the same way it escapes a value', () => {
    expect(canonicalJson({ 'a"b': 1 })).toBe('{"a\\"b":1}');
  });

  it('omits a member whose value is absent, rather than emitting null', () => {
    // "Absent" is the only spelling of "no value" in this format. An optional
    // claim that is not present simply is not in the signed bytes.
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('refuses null, because two spellings of "no value" is one too many', () => {
    expect(() => canonicalJson({ a: null } as never)).toThrow(IdentityError);
  });

  it('refuses a non-finite number rather than emitting something unreadable', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(IdentityError);
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow(IdentityError);
  });

  it('refuses an absent element inside an array', () => {
    // `JSON.stringify` would emit `null` here. That would mean the same bytes
    // for an array with a hole and an array with an explicit null.
    expect(() => canonicalJson({ a: [1, undefined, 3] as never })).toThrow(IdentityError);
  });

  it('names the member it rejected, and not the document', () => {
    expect(() => canonicalJson({ outer: { inner: Number.NaN } })).toThrow(/value\.outer\.inner/);
  });
});

describe('canonicalBytes', () => {
  it('is the canonical text, UTF-8 encoded', () => {
    const bytes = canonicalBytes({ s: 'é' });

    // {"s":"é"} — the é is two bytes, 0xc3 0xa9.
    expect([...bytes]).toEqual([0x7b, 0x22, 0x73, 0x22, 0x3a, 0x22, 0xc3, 0xa9, 0x22, 0x7d]);
  });

  it('refuses an unpaired surrogate, so that two strings cannot share bytes', () => {
    expect(() => canonicalBytes({ s: '\ud800' })).toThrow(IdentityError);
  });
});
