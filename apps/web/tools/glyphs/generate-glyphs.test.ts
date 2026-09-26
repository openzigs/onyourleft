// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The committed label glyphs are what the generator makes from the committed
 * font, and the records say so (#578).
 *
 * The claim `tools/icons/generate-icons.test.ts` makes about the icons, made
 * here byte for byte rather than pixel for pixel: there is no compressor in
 * this pipeline to drift between Node releases, and `sdf.ts` uses only
 * arithmetic ECMAScript pins exactly. So a range file that differs by one byte
 * from what the generator writes is a red build, in CI, with no Blender and no
 * network — which is why the input is committed rather than fetched.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { parseAssetManifest } from '../../src/credits/manifest';

import {
  FONT_LICENCE_FILE,
  FONT_RELEASE,
  FONT_STACK,
  GLYPH_RANGE_STARTS,
  rangeName,
} from './font-source';
import { GLYPH_DIRECTORY, glyphRangeFiles, readFont } from './generate-glyphs';
import { decodeGlyphRanges } from './glyph-pbf';
import { parseTrueType } from './truetype';

const REPOSITORY = fileURLToPath(new URL('../../../../', import.meta.url));
const DIRECTORY = fileURLToPath(GLYPH_DIRECTORY);
const FONT = readFont();
const GENERATED = glyphRangeFiles(FONT);

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function committed(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(DIRECTORY, name)));
}

describe('the committed ranges', () => {
  it('are exactly the files the generator makes — no range missing, none left over', () => {
    const onDisk = readdirSync(DIRECTORY)
      .filter((name) => name.endsWith('.pbf'))
      .sort();
    expect(onDisk).toEqual([...GENERATED.keys()].sort());
    expect(onDisk).toEqual(GLYPH_RANGE_STARTS.map((start) => `${rangeName(start)}.pbf`).sort());
  });

  it.each([...GENERATED.keys()])('%s is what the generator makes, byte for byte', (name) => {
    const made = GENERATED.get(name) ?? new Uint8Array();
    expect(sha256(committed(name)), name).toBe(sha256(made));
  });

  it.each(GLYPH_RANGE_STARTS)(
    'range %i holds every code point the font has there, in order',
    (start) => {
      const font = parseTrueType(FONT);
      const expected = font.codePoints.filter((code) => code >= start && code <= start + 255);
      const [stack, ...others] = decodeGlyphRanges(committed(`${rangeName(start)}.pbf`));
      expect(others).toEqual([]);
      expect(stack?.name).toBe(FONT_STACK);
      expect(stack?.range).toBe(rangeName(start));
      expect(stack?.glyphs.map((glyph) => glyph.id)).toEqual(expected);
      // A range with nothing in it would be a 404 that answers 200.
      expect(expected.length).toBeGreaterThan(0);
    },
  );

  it('carries the Latin a US place name uses: Kāneʻohe, San José, St. Mary’s', () => {
    const ids = new Set<number>();
    for (const bytes of GENERATED.values()) {
      for (const glyph of decodeGlyphRanges(bytes)[0]?.glyphs ?? []) {
        ids.add(glyph.id);
      }
    }
    for (const name of ['Kāneʻohe', 'San José', 'St. Mary’s', 'Coeur d’Alene']) {
      for (const character of name) {
        expect(ids.has(character.codePointAt(0) ?? -1), `${name}: ${character}`).toBe(true);
      }
    }
  });
});

describe('the input', () => {
  it('is the release’s own Roboto-Regular.ttf, by digest', () => {
    expect(sha256(FONT)).toBe(FONT_RELEASE.memberSha256);
  });

  it('carries the copyright notice and licence the release is recorded under', () => {
    const font = parseTrueType(FONT);
    expect(font.name(0)).toBe(FONT_RELEASE.copyright);
    // Name id 13 is the licence description. An OFL Roboto would say so here.
    expect(font.name(13)).toBe('Licensed under the Apache License, Version 2.0');
    expect(font.name(5)).toBe(`Version ${FONT_RELEASE.version.slice(1)}`);
  });

  const scratch = mkdtempSync(join(tmpdir(), 'oyl-glyphs-'));
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('is refused when it is any other file, before anything is drawn', () => {
    const other = join(scratch, 'Roboto-Regular.ttf');
    const altered = FONT.slice();
    altered[altered.length - 1] = (altered[altered.length - 1] ?? 0) ^ 1;
    writeFileSync(other, altered);
    expect(() => readFont(pathToFileURL(other))).toThrow(/not the v2\.138 release/);
  });
});

describe('the font’s licence travels with the glyphs', () => {
  it('ships the release’s own LICENSE, verbatim, beside the ranges', () => {
    const text = committed(FONT_LICENCE_FILE);
    expect(sha256(text)).toBe(FONT_RELEASE.licenceSha256);
    expect(new TextDecoder().decode(text)).toContain(
      'Apache License\n                           Version 2.0',
    );
  });
});

describe('ASSETS.toml records every range as derived from the font — ASSET007', () => {
  const manifest = parseAssetManifest(readFileSync(join(REPOSITORY, 'ASSETS.toml'), 'utf8'));
  const relative = (name: string): string =>
    join('apps/web/public/glyphs', FONT_STACK, name).split('\\').join('/');

  it('names the input as upstream bytes of the release', () => {
    const font = manifest.entries.find(
      (entry) => entry.path === `apps/web/tools/glyphs/${FONT_RELEASE.member}`,
    );
    expect(font?.licence).toBe('Apache-2.0');
    expect(font?.sha256).toBe(FONT_RELEASE.memberSha256);
    // Not credited: it ships in nothing.
    expect(font?.creator).toBeUndefined();
  });

  it.each([...GENERATED.keys()])('%s: its input, script, digest and credit', (name) => {
    const entry = manifest.entries.find((each) => each.path === relative(name));
    expect(entry, `${relative(name)} has no row`).toBeDefined();
    expect(entry?.licence).toBe(FONT_RELEASE.licence);
    expect(entry?.sha256).toBe(sha256(GENERATED.get(name) ?? new Uint8Array()));
    expect(entry?.input).toBe(FONT_RELEASE.page);
    expect(entry?.inputsha256).toBe(FONT_RELEASE.memberSha256);
    expect(entry?.script).toBe('apps/web/tools/glyphs/generate-glyphs.ts');
    // The notice Apache-2.0 §4(c) asks to be retained reaches the credits screen.
    expect(entry?.creator).toContain(FONT_RELEASE.copyright);
  });
});
