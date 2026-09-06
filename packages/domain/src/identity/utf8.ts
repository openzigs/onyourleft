// SPDX-License-Identifier: Apache-2.0

/**
 * UTF-8 encoding, written out because `TextEncoder` is a platform API.
 *
 * `TextEncoder` is declared in `lib.dom` and in `@types/node`, and this package
 * has neither (`tsconfig.json` narrows `lib` to `ES2024` with `types: []`). It
 * is also not merely a convenience here: the signing input of a record is a
 * byte string, and "what bytes" is part of the record format. Writing the
 * encoder out means the format's definition does not depend on a platform
 * object whose edge-case behaviour differs from the one the format wants.
 *
 * **The one place it deliberately differs from `TextEncoder`:** an unpaired
 * surrogate. `TextEncoder` replaces it with U+FFFD, which maps two different
 * strings onto the same bytes — and a canonical serialisation that is not
 * injective is not canonical, because two records with different claims would
 * share a signing input. RFC 8785 §3.2.3 forbids lone surrogates for the same
 * reason. This encoder throws.
 */

import { IdentityError } from './errors';

/**
 * Encodes a JavaScript string as UTF-8.
 *
 * @throws {IdentityError} if the string contains an unpaired surrogate. The
 * message names the index and never the text — see `errors.ts`.
 */
export function utf8Encode(text: string): Uint8Array {
  // Four bytes per UTF-16 code unit is the worst case and cannot be exceeded:
  // a code point above the BMP occupies two code units and encodes to four
  // bytes, so the ratio is at worst 4:1 for a BMP character.
  const out = new Uint8Array(text.length * 4);
  let at = 0;

  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      // A high surrogate. It must be followed by a low one.
      const next = index + 1 < text.length ? text.charCodeAt(index + 1) : Number.NaN;
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new IdentityError(
          `text is not valid Unicode: an unpaired surrogate at index ${String(index)}`,
        );
      }
      code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // A low surrogate with no high surrogate before it.
      throw new IdentityError(
        `text is not valid Unicode: an unpaired surrogate at index ${String(index)}`,
      );
    }

    if (code < 0x80) {
      out[at] = code;
      at += 1;
    } else if (code < 0x800) {
      out[at] = 0xc0 | (code >> 6);
      out[at + 1] = 0x80 | (code & 0x3f);
      at += 2;
    } else if (code < 0x10000) {
      out[at] = 0xe0 | (code >> 12);
      out[at + 1] = 0x80 | ((code >> 6) & 0x3f);
      out[at + 2] = 0x80 | (code & 0x3f);
      at += 3;
    } else {
      out[at] = 0xf0 | (code >> 18);
      out[at + 1] = 0x80 | ((code >> 12) & 0x3f);
      out[at + 2] = 0x80 | ((code >> 6) & 0x3f);
      out[at + 3] = 0x80 | (code & 0x3f);
      at += 4;
    }
  }

  return out.slice(0, at);
}
