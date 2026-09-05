// SPDX-License-Identifier: Apache-2.0

/**
 * UTF-8 encoding, written out rather than delegated to `TextEncoder`.
 *
 * The same reason `decode/utf8.ts` writes the decoder out: `TextEncoder` is not
 * an ECMAScript global. It comes from the DOM or from Node, and
 * `tsconfig.platform-free.json` compiles `src/` with `lib: ["ES2024"]` and
 * `types: []` so that naming either is a compile error rather than a review
 * finding.
 *
 * ## Lone surrogates become U+FFFD rather than throwing
 *
 * A JavaScript string is a sequence of UTF-16 code units and may hold an
 * unpaired surrogate, which has no UTF-8 encoding at all. `decode/utf8.ts`
 * rejects surrogate code points on the way in for exactly this reason, so
 * emitting one here would let a value cross the codec that cannot come back.
 * The replacement character is what the Unicode standard prescribes and what
 * every conforming encoder does, and it means an activity name a rider typed
 * on a broken keyboard cannot fail their export.
 */

/** The UTF-8 encoding of U+FFFD REPLACEMENT CHARACTER. */
const REPLACEMENT_BYTES = [0xef, 0xbf, 0xbd] as const;

const SURROGATE_FIRST = 0xd800;
const SURROGATE_LAST = 0xdfff;

/** Encode `text` as UTF-8. Never throws. */
export function encodeUtf8(text: string): Uint8Array {
  const bytes: number[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);

    if (unit < 0x80) {
      bytes.push(unit);
      continue;
    }
    if (unit < 0x800) {
      bytes.push(0xc0 | (unit >> 6), 0x80 | (unit & 0x3f));
      continue;
    }
    if (unit < SURROGATE_FIRST || unit > SURROGATE_LAST) {
      bytes.push(0xe0 | (unit >> 12), 0x80 | ((unit >> 6) & 0x3f), 0x80 | (unit & 0x3f));
      continue;
    }

    // A surrogate. It is only a character when it is a high surrogate followed
    // by a low one; anything else is unpaired and has no encoding.
    const low = index + 1 < text.length ? text.charCodeAt(index + 1) : Number.NaN;
    const paired = unit < 0xdc00 && low >= 0xdc00 && low <= SURROGATE_LAST;
    if (!paired) {
      bytes.push(...REPLACEMENT_BYTES);
      continue;
    }
    const codePoint = 0x10000 + ((unit - SURROGATE_FIRST) << 10) + (low - 0xdc00);
    bytes.push(
      0xf0 | (codePoint >> 18),
      0x80 | ((codePoint >> 12) & 0x3f),
      0x80 | ((codePoint >> 6) & 0x3f),
      0x80 | (codePoint & 0x3f),
    );
    index += 1;
  }

  return Uint8Array.from(bytes);
}

/**
 * Encode a string into a fixed-width FIT `string` field.
 *
 * FIT strings are NUL-terminated and NUL-padded, so the encoded bytes are
 * truncated to `size - 1` and the field always ends in at least one zero.
 * Truncation happens on a **character** boundary, not a byte one: cutting a
 * multi-byte sequence in half would produce a field that decodes to U+FFFD,
 * which is a worse answer than a shorter name.
 */
export function encodeFitString(text: string, size: number): Uint8Array {
  const field = new Uint8Array(size);
  if (size === 0) return field;

  const encoded = encodeUtf8(text);
  let length = Math.min(encoded.length, size - 1);
  // Walk back off any continuation byte the truncation landed on.
  while (length > 0 && ((encoded[length] ?? 0) & 0xc0) === 0x80) {
    length -= 1;
  }
  field.set(encoded.subarray(0, length));
  return field;
}

/**
 * How many bytes a string needs as a FIT `string` field, terminator included.
 *
 * The definition message declares each field's size, so the writer has to know
 * this before it writes the definition — which is the whole reason a FIT
 * definition and its data cannot be built independently.
 */
export function fitStringSize(text: string): number {
  return encodeUtf8(text).length + 1;
}
