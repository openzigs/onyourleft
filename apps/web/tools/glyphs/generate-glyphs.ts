// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The map's label glyphs, made from the committed font (#578).
 *
 * `pnpm --filter @onyourleft/web run glyphs:generate` writes one range file per
 * entry of {@link GLYPH_RANGE_STARTS} into `public/glyphs/Roboto-Regular/`,
 * and the font's own licence beside them. `--check` writes nothing and fails
 * unless every committed file is what it would have written, byte for byte.
 *
 * ## Why the input is committed, where the realistic world's is fetched
 *
 * `tools/realistic/` locks its inputs and downloads them, because they are
 * hundreds of megabytes of scans and CI has no Blender to run anyway. This
 * input is one 349 KB font, and the tool is this directory — plain arithmetic
 * that runs on the Node the repository already pins. Committing the input is
 * what lets `generate-glyphs.test.ts` regenerate every range **inside the
 * ordinary test suite, in CI**, which is a stronger claim than a check somebody
 * remembers to run by hand: a range file that is not what this script makes
 * from that font is a red build. `ASSETS.toml` records the font as upstream
 * bytes and each range as derived from it (`ASSET007`), and
 * `provenance.test.ts` holds the rows to {@link FONT_RELEASE}.
 *
 * The font's digest is checked before anything is drawn, so a substituted
 * input cannot quietly produce a set of committed glyphs.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  FONT_LICENCE_FILE,
  FONT_RELEASE,
  FONT_STACK,
  GLYPH_RANGE_STARTS,
  rangeName,
} from './font-source';
import { encodeGlyphRange, type EncodedGlyph } from './glyph-pbf';
import { signedDistanceGlyph } from './sdf';
import { parseTrueType } from './truetype';

/** The committed input: `Roboto-Regular.ttf` from the release, unmodified. */
export const FONT_FILE = new URL(`./${FONT_RELEASE.member}`, import.meta.url);

/** Where the ranges are served from: `public/glyphs/<stack>/`, so `/glyphs/<stack>/0-255.pbf`. */
export const GLYPH_DIRECTORY = new URL(`../../public/glyphs/${FONT_STACK}/`, import.meta.url);

/** The committed input's bytes, refused unless they are the release's. */
export function readFont(file: URL = FONT_FILE): Uint8Array {
  const bytes = new Uint8Array(readFileSync(fileURLToPath(file)));
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== FONT_RELEASE.memberSha256) {
    throw new Error(
      `${FONT_RELEASE.member} digests to ${digest}, not the ${FONT_RELEASE.version} release's ` +
        `${FONT_RELEASE.memberSha256}; font-source.ts records which file this has to be`,
    );
  }
  return bytes;
}

/** Every range file, by file name, made from the font's bytes. */
export function glyphRangeFiles(fontBytes: Uint8Array): ReadonlyMap<string, Uint8Array> {
  const font = parseTrueType(fontBytes);
  const files = new Map<string, Uint8Array>();
  for (const start of GLYPH_RANGE_STARTS) {
    const glyphs: EncodedGlyph[] = [];
    for (const codePoint of font.codePoints) {
      if (codePoint < start || codePoint > start + 255) {
        continue;
      }
      glyphs.push(
        signedDistanceGlyph(
          codePoint,
          font.outline(font.glyphIndexOf(codePoint)),
          font.unitsPerEm,
          font.ascender,
        ),
      );
    }
    files.set(
      `${rangeName(start)}.pbf`,
      encodeGlyphRange({ name: FONT_STACK, range: rangeName(start), glyphs }),
    );
  }
  return files;
}

function main(check: boolean): void {
  const files = glyphRangeFiles(readFont());
  const directory = fileURLToPath(GLYPH_DIRECTORY);
  const stale: string[] = [];
  let total = 0;
  for (const [name, bytes] of files) {
    total += bytes.length;
    const path = fileURLToPath(new URL(name, GLYPH_DIRECTORY));
    if (check) {
      let committed: Uint8Array | undefined;
      try {
        committed = new Uint8Array(readFileSync(path));
      } catch {
        committed = undefined;
      }
      if (committed === undefined || Buffer.compare(committed, bytes) !== 0) {
        stale.push(name);
      }
    } else {
      mkdirSync(directory, { recursive: true });
      writeFileSync(path, bytes);
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    console.log(`${name}: ${String(bytes.length)} bytes, sha256 ${digest}`);
  }
  console.log(`${String(files.size)} ranges, ${String(total)} bytes`);
  if (check && stale.length > 0) {
    console.error(`not what the generator makes: ${stale.join(', ')}`);
    process.exitCode = 1;
  }
  if (!check) {
    console.log(
      `the licence stays at ${FONT_LICENCE_FILE}, fetched verbatim from ${FONT_RELEASE.licenceUrl}`,
    );
  }
}

// Run only when this file is the program, never when a test imports it.
if (process.argv[1]?.endsWith('generate-glyphs.ts') === true) {
  main(process.argv.includes('--check'));
}
