// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The display face, held in CI without the subsetter — #991, ADR 0043.
 *
 * `fonts:subset --check` is what re-makes the WOFF2 files byte for byte, and
 * it needs the pinned fontTools, which CI does not have. So this suite holds
 * everything that can be held without it: the committed inputs are upstream's
 * bytes; the licence declares no Reserved Font Name; the shipped licence text
 * is upstream's; each committed subset holds exactly the Latin range, at its
 * weight, with `tnum` still making every figure one width, and with the
 * copyright and licence records OFL §2 relies on; `ASSETS.toml` describes all
 * of it; and `theme.css` loads exactly these files, for exactly that range.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseAssetManifest } from '../../src/credits/manifest';
import { characterMaps } from '../glyphs/truetype';
import {
  FONT_WEIGHTS,
  inLatinRanges,
  LICENCE_BODY_STARTS,
  LICENCE_MEMBER,
  subsetArguments,
  unicodeRange,
  UPSTREAM,
  upstreamUrl,
} from './font-recipe';
import { licenceBody, readInput } from './subset-fonts';
import {
  advanceWidth,
  cmapOnlySfnt,
  nameRecords,
  readWoff2,
  singleSubstitutions,
  substitutionFeatures,
  weightClass,
  type Woff2Font,
} from './woff2';

const REPOSITORY = fileURLToPath(new URL('../../../../', import.meta.url));
const OUTPUTS = 'apps/web/src/design/fonts';
const INPUTS = 'apps/web/tools/fonts/barlow';

function bytesOf(path: string): Uint8Array {
  return new Uint8Array(readFileSync(join(REPOSITORY, path)));
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function fontOf(output: string): Woff2Font {
  return readWoff2(bytesOf(`${OUTPUTS}/${output}`));
}

/** Every code point a font's cmap maps. */
function codePointsOf(font: Woff2Font): readonly number[] {
  const maps = characterMaps(cmapOnlySfnt(font));
  return [...(maps.format12 ?? maps.format4 ?? new Map<number, number>()).keys()];
}

function glyphOf(font: Woff2Font, codePoint: number): number {
  const maps = characterMaps(cmapOnlySfnt(font));
  const glyph = (maps.format12 ?? maps.format4)?.get(codePoint);
  if (glyph === undefined) throw new Error(`U+${codePoint.toString(16)} is not mapped`);
  return glyph;
}

const DIGITS = [...'0123456789'].map((digit) => digit.codePointAt(0) ?? 0);

/** The advance widths of the ten figures, with `tnum` applied or not. */
function figureWidths(font: Woff2Font, tabular: boolean): ReadonlySet<number> {
  const tnum = tabular ? singleSubstitutions(font, 'tnum') : new Map<number, number>();
  return new Set(
    DIGITS.map((digit) => {
      const glyph = glyphOf(font, digit);
      return advanceWidth(font, tnum.get(glyph) ?? glyph);
    }),
  );
}

const manifest = parseAssetManifest(readFileSync(join(REPOSITORY, 'ASSETS.toml'), 'utf8'));

describe('the committed inputs are upstream’s bytes', () => {
  it.each(FONT_WEIGHTS)('$member', ({ member, memberSha256 }) => {
    expect(() => readInput(member, memberSha256)).not.toThrow();
  });

  it('refuses a substituted input', () => {
    expect(() => readInput('Barlow-Bold.ttf', '0'.repeat(64))).toThrow(/digests to/);
  });

  it('keeps the upstream licence file, unaltered', () => {
    expect(sha256(bytesOf(`${INPUTS}/${LICENCE_MEMBER.member}`))).toBe(LICENCE_MEMBER.sha256);
  });
});

describe('the licence — ADR 0043 D-2, D-3', () => {
  const upstream = readFileSync(join(REPOSITORY, INPUTS, LICENCE_MEMBER.member), 'utf8');
  const header = upstream.slice(0, upstream.indexOf(LICENCE_BODY_STARTS));

  it('is the SIL Open Font License 1.1, under the copyright the recipe records', () => {
    expect(header.startsWith(UPSTREAM.copyright)).toBe(true);
    expect(header).toContain('SIL Open Font License, Version 1.1');
  });

  it('declares no Reserved Font Name, so the subset may keep the family name', () => {
    // The licence's own body defines the term; the header above it is where
    // a face would declare one ("with Reserved Font Name …").
    expect(header).not.toMatch(/reserved\s+font\s+name/i);
    expect(header.length).toBeGreaterThan(0);
  });

  it('finds a declared Reserved Font Name, so the case above can fail', () => {
    const declared = `Copyright 2017 Somebody, with Reserved Font Name "Barlow".\n\n${upstream}`;
    const declaredHeader = declared.slice(0, declared.indexOf(LICENCE_BODY_STARTS));
    expect(declaredHeader).toMatch(/reserved\s+font\s+name/i);
  });

  it('ships the licence’s text, from its first line, as public/licences/OFL-1.1.txt', () => {
    const shipped = readFileSync(join(REPOSITORY, 'apps/web/public/licences/OFL-1.1.txt'), 'utf8');
    expect(shipped).toBe(licenceBody(upstream));
    expect(shipped.startsWith(LICENCE_BODY_STARTS)).toBe(true);
    expect(shipped).toContain('5) The Font Software, modified or unmodified, in part or in whole,');
  });
});

describe.each(FONT_WEIGHTS)('the committed subset $output', ({ weight, output }) => {
  const font = fontOf(output);

  it('is a TrueType-outline WOFF2 at its weight, in the family theme.css names', () => {
    expect(font.flavor).toBe(0x00010000);
    expect(weightClass(font)).toBe(weight);
    const names = nameRecords(font);
    expect(names.get(16) ?? names.get(1)).toBe(UPSTREAM.family);
  });

  it('carries the copyright notice and the licence records OFL §2 relies on', () => {
    const names = nameRecords(font);
    expect(names.get(0)).toBe(UPSTREAM.copyright);
    expect(names.get(13)).toContain('SIL Open Font License, Version 1.1');
    expect(names.get(14)).toMatch(/OFL/);
    expect(names.get(5)).toContain(`Version ${UPSTREAM.version}`);
  });

  it('maps the Latin range and nothing outside it', () => {
    const codePoints = codePointsOf(font);
    expect(codePoints.filter((codePoint) => !inLatinRanges(codePoint))).toEqual([]);
    // Every printable ASCII character, the figures and the punctuation a
    // heading uses: a subset that lost one draws it in the system face.
    for (let codePoint = 0x20; codePoint <= 0x7e; codePoint += 1) {
      expect(codePoints, `U+${codePoint.toString(16)} is missing`).toContain(codePoint);
    }
    for (const character of '’‘“”–—…×°€−') {
      expect(codePoints).toContain(character.codePointAt(0));
    }
  });

  it('keeps tabular figures: with tnum, the ten figures are one width', () => {
    expect(substitutionFeatures(font).has('tnum')).toBe(true);
    expect([...figureWidths(font, true)]).toHaveLength(1);
  });

  it('needs tnum for it — the default figures are proportional, so the case above can fail', () => {
    expect(figureWidths(font, false).size).toBeGreaterThan(1);
  });

  it('is the size the recipe was chosen at, give or take', () => {
    // ADR 0043 D-6 records 13.6 KB a weight. A subset several times that has
    // lost its range or its flags; this is a tripwire, not a budget.
    expect(bytesOf(`${OUTPUTS}/${output}`).byteLength).toBeLessThan(20_000);
  });
});

describe('ASSETS.toml describes every file — ASSET004, ASSET007', () => {
  const byPath = new Map(manifest.entries.map((entry) => [entry.path, entry]));

  it.each(FONT_WEIGHTS)(
    'records $member as upstream bytes under OFL-1.1, credited to nobody',
    (weight) => {
      const entry = byPath.get(`${INPUTS}/${weight.member}`);
      expect(entry?.licence).toBe('OFL-1.1');
      expect(entry?.sha256).toBe(weight.memberSha256);
      expect(entry?.source).toContain(upstreamUrl(weight.member));
      // An input ships in nothing, so the credits screen does not list it.
      expect(entry?.creator).toBeUndefined();
    },
  );

  it.each(FONT_WEIGHTS)('records $output as derived, credited, under OFL-1.1', (weight) => {
    const path = `${OUTPUTS}/${weight.output}`;
    const entry = byPath.get(path);
    expect(entry?.licence).toBe('OFL-1.1');
    expect(entry?.sha256).toBe(sha256(bytesOf(path)));
    expect(entry?.creator).toContain('Copyright 2017 The Barlow Project Authors');
    expect(entry?.url).toBe(UPSTREAM.project);
    expect(entry?.input).toBe(upstreamUrl(weight.member));
    expect(entry?.inputsha256).toBe(weight.memberSha256);
    expect(entry?.script).toBe('apps/web/tools/fonts/subset-fonts.ts');
    expect(entry?.tool).toBe('fontTools 4.66.1 with Brotli 1.2.0');
  });
});

describe('theme.css loads exactly these files, for exactly this range', () => {
  const css = readFileSync(join(REPOSITORY, 'apps/web/src/design/theme.css'), 'utf8').replaceAll(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  // Whitespace folded, because Prettier wraps a long `unicode-range`.
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) =>
    (match[1] ?? '').replaceAll(/\s+/g, ' '),
  );

  it('declares one face per weight, and no other', () => {
    expect(faces).toHaveLength(FONT_WEIGHTS.length);
  });

  it.each(FONT_WEIGHTS)('loads $output from beside it, as WOFF2, for the Latin range', (weight) => {
    const face = faces.find((body) => body.includes(`font-weight: ${String(weight.weight)};`));
    expect(face, `no @font-face for weight ${String(weight.weight)}`).toBeDefined();
    expect(face).toContain(`font-family: '${UPSTREAM.family}';`);
    expect(face).toContain(`src: url('./fonts/${weight.output}') format('woff2');`);
    expect(face).toContain(`unicode-range: ${unicodeRange()};`);
    expect(face).toContain('font-display: swap;');
  });

  it('subsets to the same range CSS declares', () => {
    const args = subsetArguments('in.ttf', 'out.woff2');
    expect(args).toContain(`--unicodes=${unicodeRange().replaceAll(' ', '')}`);
    expect(args).toContain('--flavor=woff2');
  });
});

describe('the third-party notices reproduce the face’s licence — ADR 0043 D-2', () => {
  const inputs = JSON.parse(
    readFileSync(join(REPOSITORY, 'apps/web/third-party-notices.json'), 'utf8'),
  ) as {
    committedFonts?: {
      name: string;
      version: string;
      licence: string;
      files: string[];
      licenceFile: string;
    }[];
  };

  it('lists every subset the step writes, with the upstream licence file beside its input', () => {
    const fonts = inputs.committedFonts ?? [];
    expect(fonts.map((font) => [font.name, font.version, font.licence])).toEqual([
      [UPSTREAM.family, UPSTREAM.version, 'OFL-1.1'],
    ]);
    expect(fonts[0]?.files).toEqual(FONT_WEIGHTS.map((weight) => `${OUTPUTS}/${weight.output}`));
    expect(fonts[0]?.licenceFile).toBe(`${INPUTS}/${LICENCE_MEMBER.member}`);
  });

  it('and the committed document carries it', () => {
    const document = readFileSync(
      join(REPOSITORY, 'apps/web/public/licences/third-party.txt'),
      'utf8',
    );
    expect(document).toContain(`Name: ${UPSTREAM.family}\nVersion: ${UPSTREAM.version}`);
    expect(document).toContain(UPSTREAM.copyright);
  });
});
