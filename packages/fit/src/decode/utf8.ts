// SPDX-License-Identifier: Apache-2.0

/**
 * UTF-8 decoding, written out rather than delegated to `TextDecoder`.
 *
 * ## Why this is here at all
 *
 * `packages/fit/tsconfig.platform-free.json` narrows `lib` to `ES2024` and
 * empties `types`, so `src/` has no platform surface — and `TextDecoder` is
 * not an ECMAScript global. It comes from the DOM or from Node, and naming
 * either would put a platform API inside a package docs/architecture.md places
 * above every platform. #30's last acceptance criterion is that the decoder
 * *"has no filesystem, network or browser dependency"*; a `TextDecoder` is the
 * browser dependency that would slip in unremarked, because it is present in
 * every runtime a contributor happens to test in.
 *
 * ## It never throws, and that is a security property
 *
 * FIT strings come out of activity files, and `SECURITY.md` puts activity file
 * parsing in scope: *"Malformed input must produce an error — never memory
 * corruption, a crash loop, resource exhaustion or code execution."* A device
 * name is not worth failing an import for, so a malformed sequence becomes
 * U+FFFD rather than an exception.
 *
 * The three rejections below are the ones that matter beyond well-formedness,
 * and all three are rejected the way the Unicode standard requires:
 *
 * - **Overlong encodings** — `C0 80` for U+0000, `E0 80 AF` for `/`. A decoder
 *   that accepts them lets a caller smuggle a character past a filter that
 *   inspected the bytes.
 * - **Surrogate code points** — U+D800..U+DFFF have no UTF-8 encoding, and
 *   admitting them produces a string that cannot round-trip.
 * - **Code points above U+10FFFF** — outside Unicode entirely.
 */

/** What a malformed sequence decodes to: U+FFFD REPLACEMENT CHARACTER. */
export const REPLACEMENT_CHARACTER = '�';

const MAX_CODE_POINT = 0x10ffff;
const SURROGATE_FIRST = 0xd800;
const SURROGATE_LAST = 0xdfff;

/** How many continuation bytes follow a lead byte, or -1 if it is not a lead. */
function continuationCount(lead: number): number {
  if (lead <= 0x7f) return 0;
  if (lead >= 0xc2 && lead <= 0xdf) return 1;
  if (lead >= 0xe0 && lead <= 0xef) return 2;
  if (lead >= 0xf0 && lead <= 0xf4) return 3;
  // 0x80..0xBF is a stray continuation byte; 0xC0, 0xC1, 0xF5..0xFF can only
  // ever begin an overlong or out-of-range sequence.
  return -1;
}

function initialBits(lead: number, continuations: number): number {
  if (continuations === 0) return lead;
  if (continuations === 1) return lead & 0x1f;
  if (continuations === 2) return lead & 0x0f;
  return lead & 0x07;
}

function isOverlongOrInvalid(codePoint: number, continuations: number): boolean {
  if (codePoint > MAX_CODE_POINT) return true;
  if (codePoint >= SURROGATE_FIRST && codePoint <= SURROGATE_LAST) return true;
  if (continuations === 1) return codePoint < 0x80;
  if (continuations === 2) return codePoint < 0x800;
  if (continuations === 3) return codePoint < 0x10000;
  return false;
}

/**
 * Decode `bytes[start, end)` as UTF-8, replacing malformed sequences.
 *
 * A range rather than a subarray, for the reason `crc.ts` gives.
 */
export function decodeUtf8(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let text = '';
  let index = start;

  while (index < end) {
    const lead = bytes[index] ?? 0;
    const continuations = continuationCount(lead);

    if (continuations < 0) {
      text += REPLACEMENT_CHARACTER;
      index += 1;
      continue;
    }

    if (index + continuations >= end) {
      // The sequence is cut off by the end of the field. One replacement for
      // the whole truncated remainder, and stop.
      text += REPLACEMENT_CHARACTER;
      return text;
    }

    let codePoint = initialBits(lead, continuations);
    let malformed = false;
    for (let offset = 1; offset <= continuations; offset += 1) {
      const next = bytes[index + offset] ?? 0;
      if ((next & 0xc0) !== 0x80) {
        // Resume at the offending byte rather than consuming it: it may itself
        // be a valid lead, and swallowing it would lose a whole character.
        text += REPLACEMENT_CHARACTER;
        index += offset;
        malformed = true;
        break;
      }
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    if (malformed) continue;

    if (isOverlongOrInvalid(codePoint, continuations)) {
      text += REPLACEMENT_CHARACTER;
      index += continuations + 1;
      continue;
    }

    text += String.fromCodePoint(codePoint);
    index += continuations + 1;
  }

  return text;
}

/**
 * Decode a fixed-width FIT `string` field.
 *
 * FIT writes a string into a field of a size the definition message declares,
 * NUL-terminated and NUL-padded to that width. Everything from the first NUL
 * onwards is padding, so a field carrying `"bike\0\0\0\0"` is `"bike"` and not
 * a four-character string followed by four U+0000.
 */
export function decodeFitString(bytes: Uint8Array, start: number, size: number): string {
  let terminator = start + size;
  for (let index = start; index < start + size; index += 1) {
    if (bytes[index] === 0) {
      terminator = index;
      break;
    }
  }
  return decodeUtf8(bytes, start, terminator);
}
