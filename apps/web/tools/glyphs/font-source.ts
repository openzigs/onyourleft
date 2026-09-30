// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which font the map's labels are drawn in, where it came from, and what was
 * read about its licence (#578).
 *
 * ## The owner's two decisions, and what follows from them
 *
 * 2026-09-26: **an Apache-2.0 font**, so that nothing needs a new licence
 * ruling, and **its glyphs bundled in the app**, so that a label costs no
 * request to anybody's server and works offline.
 *
 * Apache-2.0 is on `ASSET004`'s permissive list and ADR 0015's, so it may land
 * anywhere. `OFL-1.1` is on neither — and every current release of the two
 * obvious candidates is OFL: Roboto moved to it at v3.0 and Open Sans in 2021.
 * The releases *before* those moves were published under Apache-2.0 and stay
 * so; a licence cannot be withdrawn from a copy already granted. So the input
 * is a pinned **old** release, and the pin is the point:
 *
 * - **Roboto v2.138**, published 2017-08-02, the last release of the
 *   `googlefonts/roboto-2` repository (the v2 line, split out when v3 moved to
 *   OFL). Its tag is commit `0e11861ecb9e6ce4336f47b556f3d12ba72c3f46`.
 * - **The unhinted archive**, because a signed-distance glyph is resampled at
 *   every size and hinting instructions would be bytes that do nothing.
 * - **The licence was read at source** on 2026-09-26, twice: the `LICENSE`
 *   inside the archive and the one at the tag, which are the same bytes
 *   ({@link FONT_RELEASE}.`licenceSha256`), and the font's own `name` table,
 *   whose licence description reads *"Licensed under the Apache License,
 *   Version 2.0"*. That text differs from `LICENSES/Apache-2.0.txt` only by a
 *   leading blank line; it is shipped verbatim beside the glyphs rather than
 *   substituted, because it is *the font's* licence file.
 *
 * ⚠️ **A newer Roboto is not an upgrade here, it is a licence change.** Moving
 * this pin past v2.138 needs OFL-1.1 ruled on first (ADR 0015's tables and
 * `ASSET004`'s lists), which is exactly what the owner's first decision was
 * made to avoid.
 *
 * Pure data. `generate-glyphs.ts` does the I/O.
 */

/** The release the committed input was taken from. */
export const FONT_RELEASE = {
  family: 'Roboto',
  version: 'v2.138',
  published: '2017-08-02',
  /** The release page, which is also the `input` every derived `ASSETS.toml` row records. */
  page: 'https://github.com/googlefonts/roboto-2/releases/tag/v2.138',
  archive: 'https://github.com/googlefonts/roboto-2/releases/download/v2.138/roboto-unhinted.zip',
  archiveSha256: '70f64c718510a601fbcf752aafe644314dacaeb85474dc689c89787c4a72a728',
  /** The member of the archive that is committed, unmodified, as the generator's input. */
  member: 'Roboto-Regular.ttf',
  memberSha256: 'f3edb8058e523f5612bfd99d0745e661568ad85e1b6217bc62f786fabae624c6',
  licence: 'Apache-2.0',
  licenceUrl: 'https://raw.githubusercontent.com/googlefonts/roboto-2/v2.138/LICENSE',
  licenceSha256: 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4',
  /** The copyright notice the font's `name` table carries, id 0, verbatim. */
  copyright: 'Copyright 2011 Google Inc. All Rights Reserved.',
  read: '2026-09-26',
} as const;

/**
 * The font stack name the style asks for, and the directory the ranges live in.
 *
 * No space, deliberately: MapLibre substitutes it into the `glyphs` URL
 * without encoding it, and a space would reach the service worker's precache
 * as `%20` against a build-output name with a literal space — two spellings of
 * one file, and a cache miss offline.
 */
export const FONT_STACK = 'Roboto-Regular';

/**
 * The first code point of every 256-code-point range that is generated.
 *
 * #578 asks for *"at least Latin and Latin Extended"*. What a US place or road
 * name actually uses reaches a little further, so these are:
 *
 * | Range | What is in it that a name uses |
 * |---|---|
 * | 0–255 | ASCII and Latin-1: *San José*, *Coeur d'Alene* |
 * | 256–511 | Latin Extended-A and most of -B: Hawaiian macrons (*Kāneʻohe*'s ā) |
 * | 512–767 | the rest of -B and the spacing modifiers: the ʻokina, U+02BB |
 * | 768–1023 | combining diacritics, for a name stored decomposed (and Greek) |
 * | 7680–7935 | Latin Extended Additional: Vietnamese |
 * | 8192–8447 | general punctuation: ’ – — as a name may spell them |
 *
 * ⚠️ **A code point outside these is not a blank.** MapLibre 6.10 (and 6.11)
 * answers a range the server does not have by drawing that glyph itself, from whatever
 * font the device has (`glyph_manager.ts` §`_downloadAndCacheRangePromise`),
 * and warns once. So a Cyrillic name renders in the device's font rather than
 * in Roboto, and costs one 404 — which is the trade taken to keep the
 * precache small.
 */
export const GLYPH_RANGE_STARTS: readonly number[] = [0, 256, 512, 768, 7680, 8192];

/** `0-255`, the name a range file and MapLibre's `{range}` token both use. */
export function rangeName(start: number): string {
  return `${String(start)}-${String(start + 255)}`;
}

/** The file the font's own licence is shipped as, beside the ranges. */
export const FONT_LICENCE_FILE = 'Apache-2.0.txt';
