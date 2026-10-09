// SPDX-License-Identifier: Apache-2.0

/**
 * The sealed request's pure parts (#1191): base64url, UTF-8 decoding, the
 * padding and its check, the framing, the AAD and the statement. The halves
 * that need a real HPKE port — sealing and opening — are run through each
 * port in `apps/instance/src/sealed/sealed.test.ts`, as `hpke.ts`'s are.
 */

import { describe, expect, it } from 'vitest';

import { AUTH_PURPOSE, deviceStatementBytes } from '../identity/device-statement';
import { utf8Encode } from '../identity/utf8';
import {
  decodeFrame,
  encodeFrame,
  fromBase64url,
  pad,
  padEvent,
  paddedEventLength,
  paddedLength,
  parseSealedEnvelope,
  PASTED_KEY_PAD_BYTES,
  sealedEnvelopeLimit,
  SealedError,
  sealedRequestAad,
  sealedRequestStatementBytes,
  sealedResponseAad,
  toBase64url,
  unpad,
  utf8Decode,
} from './sealed';

const text = (bytes: Uint8Array): string => utf8Decode(bytes) ?? '<invalid>';

describe('base64url', () => {
  it('round-trips every length, and agrees with RFC 4648 §10 once the alphabet is swapped', () => {
    for (let length = 0; length < 40; length += 1) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 251) & 0xff);
      expect(fromBase64url(toBase64url(bytes))).toEqual(bytes);
    }
    expect(toBase64url(utf8Encode('foobar'))).toBe('Zm9vYmFy');
    expect(toBase64url(utf8Encode('fo'))).toBe('Zm8');
    expect(toBase64url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
  });

  it('refuses padding, a stray character, an impossible length and a second spelling', () => {
    expect(fromBase64url('Zm8=')).toBeUndefined();
    expect(fromBase64url('Zm+8')).toBeUndefined();
    expect(fromBase64url('Z')).toBeUndefined();
    // 'Zm8' is "fo"; 'Zm9' is the same two bytes with a spare bit set, and is refused.
    expect(fromBase64url('Zm8')).toEqual(utf8Encode('fo'));
    expect(fromBase64url('Zm9')).toBeUndefined();
  });
});

describe('utf8Decode', () => {
  it('decodes what utf8Encode writes, and refuses an overlong or a surrogate', () => {
    const sample = 'A ride — 12 km, 🚴 ✓';
    expect(utf8Decode(utf8Encode(sample))).toBe(sample);
    expect(utf8Decode(new Uint8Array([0xc0, 0x80]))).toBeUndefined();
    expect(utf8Decode(new Uint8Array([0xed, 0xa0, 0x80]))).toBeUndefined();
    expect(utf8Decode(new Uint8Array([0xe2, 0x82]))).toBeUndefined();
  });
});

describe('the padding (D-9)', () => {
  it('pads to the next power of two from 256 B to 64 KiB, then to a multiple of 64 KiB', () => {
    expect(paddedLength(1)).toBe(256);
    expect(paddedLength(256)).toBe(256);
    expect(paddedLength(257)).toBe(512);
    expect(paddedLength(40_000)).toBe(65_536);
    expect(paddedLength(65_537)).toBe(131_072);
    expect(paddedLength(200_000)).toBe(262_144);
    expect(paddedLength(10, PASTED_KEY_PAD_BYTES)).toBe(1024);
    expect(paddedEventLength(1)).toBe(256);
    expect(paddedEventLength(257)).toBe(512);
    expect(paddedEventLength(700)).toBe(768);
  });

  it('makes a 10-byte and a 200-byte message the same length', () => {
    expect(pad(new Uint8Array(10)).length).toBe(pad(new Uint8Array(200)).length);
    expect(pad(new Uint8Array(10), PASTED_KEY_PAD_BYTES).length).toBe(1024);
  });

  it('gives back exactly the content, at either minimum', () => {
    const content = utf8Encode('the inner request');
    expect(unpad(pad(content))).toEqual(content);
    expect(unpad(pad(content, PASTED_KEY_PAD_BYTES))).toEqual(content);
    expect(unpad(padEvent(content), 'event')).toEqual(content);
  });

  it('refuses a length that does not fit, a byte of padding that is not zero, and a wrong bucket', () => {
    const padded = pad(utf8Encode('hello'));
    const tooLong = padded.slice();
    tooLong[3] = 0xff;
    expect(() => unpad(tooLong)).toThrow(SealedError);
    const dirty = padded.slice();
    dirty[200] = 1;
    expect(() => unpad(dirty)).toThrow(SealedError);
    // Content that belongs in 256 bytes, sent in 512: not a bucket it belongs in.
    const oversized = new Uint8Array(512);
    oversized.set(padded);
    expect(() => unpad(oversized)).toThrow(SealedError);
    // An event padded to a message's 512 is not a multiple-of-256 event bucket either.
    expect(() => unpad(oversized, 'event')).toThrow(SealedError);
  });
});

describe('the framing', () => {
  it('carries a header and the body as bytes, unescaped', () => {
    const body = utf8Encode('{"quoted":"text"}');
    const frame = encodeFrame({ method: 'POST', path: '/v1/x' }, body);
    const decoded = decodeFrame(frame);
    expect(decoded.header).toEqual({ method: 'POST', path: '/v1/x' });
    expect(text(decoded.body)).toBe('{"quoted":"text"}');
  });

  it('refuses a header that is not a JSON object, and one longer than the frame', () => {
    expect(() => decodeFrame(new Uint8Array([0, 0, 0, 9, 1, 2]))).toThrow(SealedError);
    const array = encodeFrame({}, new Uint8Array(0));
    const notObject = new Uint8Array([0, 0, 0, 2, 0x5b, 0x5d]);
    expect(decodeFrame(array).header).toEqual({});
    expect(() => decodeFrame(notObject)).toThrow(SealedError);
  });
});

describe('the AAD (D-9)', () => {
  const binding = { instanceOrigin: 'https://ride.example', keyId: '0123456789abcdef' };

  it('is RFC 8785 with `tokenSha256` as JSON null for a request with no session', () => {
    expect(text(sealedRequestAad({ ...binding, tokenSha256: null }))).toBe(
      '{"direction":"request","instanceOrigin":"https://ride.example","keyId":"0123456789abcdef","purpose":"oyl-sealed-aad-v1","tokenSha256":null}',
    );
  });

  it('differs by session, by direction, and by the reply nonce', () => {
    const a = sealedRequestAad({ ...binding, tokenSha256: 'a'.repeat(64) });
    const b = sealedRequestAad({ ...binding, tokenSha256: 'b'.repeat(64) });
    expect(a).not.toEqual(b);
    const reply = text(
      sealedResponseAad({ ...binding, tokenSha256: null }, new Uint8Array(32), new Uint8Array(16)),
    );
    expect(reply).toContain('"direction":"response"');
    expect(reply).toContain(`"response_nonce":"${'0'.repeat(32)}"`);
    expect(reply).toContain(`"enc":"${'0'.repeat(64)}"`);
  });
});

describe('the statement (D-8)', () => {
  it('names its own purpose, and its bytes are never an oyl-auth-v1 statement’s', () => {
    const sealed = text(
      sealedRequestStatementBytes({
        instanceOrigin: 'https://ride.example',
        keyId: '0123456789abcdef',
        enc: 'e'.repeat(64),
        method: 'POST',
        path: '/v1/x',
        issuedAt: 1_790_000_000,
        bodySha256: 'f'.repeat(64),
      }),
    );
    expect(sealed).toContain('"purpose":"oyl-sealed-request-v1"');
    const auth = text(
      deviceStatementBytes({
        purpose: AUTH_PURPOSE,
        instanceOrigin: 'https://ride.example',
        nonce: 'e'.repeat(64),
        publicKey: 'f'.repeat(64),
        issuedAt: 1_790_000_000,
      }),
    );
    expect(auth).not.toContain('oyl-sealed-request-v1');
  });
});

describe('the envelope', () => {
  const enc = toBase64url(new Uint8Array(32).fill(9));
  const ct = toBase64url(new Uint8Array(272));

  it('parses exactly `{ v, keyId, enc, ct }`', () => {
    expect(parseSealedEnvelope({ v: 1, keyId: '0123456789abcdef', enc, ct })?.keyId).toBe(
      '0123456789abcdef',
    );
    expect(parseSealedEnvelope({ v: 2, keyId: '0123456789abcdef', enc, ct })).toBeUndefined();
    expect(parseSealedEnvelope({ v: 1, keyId: 'ABCDEF0123456789', enc, ct })).toBeUndefined();
    expect(
      parseSealedEnvelope({ v: 1, keyId: '0123456789abcdef', enc, ct, extra: 1 }),
    ).toBeUndefined();
    expect(
      parseSealedEnvelope({ v: 1, keyId: '0123456789abcdef', enc: 'AAAA', ct }),
    ).toBeUndefined();
  });

  it('allows for a 1 MiB inner body, a tag and base64url', () => {
    const limit = sealedEnvelopeLimit(1024 * 1024);
    expect(limit).toBeGreaterThan(Math.ceil(((1024 * 1024 + 4096) * 4) / 3));
    expect(limit).toBeLessThan(2 * 1024 * 1024);
  });
});
