// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The display face's recipe — #991, ADR 0043.
 *
 * Everything that decides the bytes of the WOFF2 files under
 * `src/design/fonts/`, written down once: which upstream files, at which
 * digest, cut to which code points, keeping which layout features, by which
 * pinned tool. `subset-fonts.ts` runs it; `fonts.test.ts` holds the committed
 * inputs, the committed outputs and `ASSETS.toml` to it inside the ordinary
 * suite, without the tool.
 *
 * ## Why the subsetter is a pinned TOOL rather than arithmetic here
 *
 * The map's glyphs (`tools/glyphs/`) are this repository's own arithmetic,
 * because a signed-distance range is simple and MapLibre's format is small.
 * A web font subset is not: keeping `tnum` working means rewriting `GSUB` and
 * `GPOS` lookups for the glyphs that survive, and WOFF2 wants its own `glyf`
 * transform. fontTools is the reference implementation of both, and it is
 * pinned the way the realistic world pins Blender and KTX-Software (ADR 0026
 * D-5): a different version may write different bytes, so a different version
 * is refused rather than trusted. Measured on 2026-10-02: two runs at the pins
 * below wrote byte-identical files.
 */

/** The fontTools release the committed files were written by. */
export const PINNED_FONTTOOLS = '4.66.1';

/** The Brotli binding fontTools compresses WOFF2 with, at the version that wrote them. */
export const PINNED_BROTLI = '1.2.0';

/**
 * Where the upstream files were read: Google Fonts' own repository at a
 * pinned commit, which carries Barlow 1.408 as the static weights its
 * designer released (unchanged there since 2018-12-05, commit
 * `89f5431ff0db41bd2fe3f7ba21a723a01622428b`).
 */
export const UPSTREAM = {
  family: 'Barlow',
  version: '1.408',
  repository: 'https://github.com/google/fonts',
  commit: '9710da1eacb3be272583c3224dcb70f9da6eadbb',
  directory: 'ofl/barlow',
  designer: 'Jeremy Tribby',
  copyright: 'Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow)',
  project: 'https://github.com/jpt/barlow',
  read: '2026-10-02',
} as const;

/** The raw URL an upstream member was read from. */
export function upstreamUrl(member: string): string {
  return `https://raw.githubusercontent.com/google/fonts/${UPSTREAM.commit}/${UPSTREAM.directory}/${member}`;
}

/**
 * The licence file the upstream directory ships, committed beside the inputs.
 *
 * ⚠️ It declares **no Reserved Font Name** — read on 2026-10-02, and
 * `fonts.test.ts` fails if a phrase naming one appears — so ADR 0043 D-3's
 * renaming rule does not bind this face, and the subset keeps the family name
 * `Barlow`. A face that declares one is not admitted by `ASSET004` at all.
 */
export const LICENCE_MEMBER = {
  member: 'OFL.txt',
  sha256: '186d750eb496a4c17a76385f82be6aea2ac1cf2de074a811d63786cf374ea73f',
} as const;

/**
 * The line the licence's own text starts at, inside {@link LICENCE_MEMBER}.
 * Everything above it is Barlow's copyright notice, which travels in each
 * font's name table and on the credits screen; everything from it down is
 * the licence, shipped as `public/licences/OFL-1.1.txt`.
 */
export const LICENCE_BODY_STARTS =
  '-----------------------------------------------------------\nSIL OPEN FONT LICENSE Version 1.1 - 26 February 2007\n';

/** One weight: the committed upstream file and the WOFF2 made from it. */
export interface FontWeight {
  readonly weight: 700 | 800;
  /** The upstream file name, committed under `tools/fonts/barlow/`. */
  readonly member: string;
  readonly memberSha256: string;
  /** The subset's file name, under `src/design/fonts/`. */
  readonly output: string;
}

/**
 * The two weights, and why two (ADR 0043 D-6): 800 is the display step
 * (`theme.css` §`.oyl-display`), and 700 is the big numerals Phase 1's type
 * scale asks for (#992). Each costs about 13.6 KB; a third is a line here.
 */
export const FONT_WEIGHTS: readonly FontWeight[] = [
  {
    weight: 700,
    member: 'Barlow-Bold.ttf',
    memberSha256: '84e6a4d61e7c3e21f3c50ea6a4f7e5303a3467864c038be6ea3759bab8d547f9',
    output: 'barlow-latin-700.woff2',
  },
  {
    weight: 800,
    member: 'Barlow-ExtraBold.ttf',
    memberSha256: '5234d91030e1bb89525cbaccc4386892c3fe005a0582c705264ce3572d96a1a1',
    output: 'barlow-latin-800.woff2',
  },
];

/**
 * The code points a subset keeps — Google Fonts' own `latin` range, which is
 * what an English-language interface reaches: ASCII and Latin-1, the
 * typographic quotes, dashes and ellipsis in General Punctuation, the euro,
 * the minus sign and the trade mark. `theme.css`'s `unicode-range` is this
 * list, so a character outside it is drawn in the system face rather than as
 * a missing glyph.
 */
export const LATIN_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x00ff],
  [0x0131, 0x0131],
  [0x0152, 0x0153],
  [0x02bb, 0x02bc],
  [0x02c6, 0x02c6],
  [0x02da, 0x02da],
  [0x02dc, 0x02dc],
  [0x2000, 0x206f],
  [0x2074, 0x2074],
  [0x20ac, 0x20ac],
  [0x2122, 0x2122],
  [0x2191, 0x2191],
  [0x2193, 0x2193],
  [0x2212, 0x2212],
  [0x2215, 0x2215],
  [0xfeff, 0xfeff],
  [0xfffd, 0xfffd],
];

function hex(codePoint: number): string {
  return codePoint.toString(16).toUpperCase().padStart(4, '0');
}

/** {@link LATIN_RANGES} as CSS writes it, and as `pyftsubset --unicodes` reads it. */
export function unicodeRange(): string {
  return LATIN_RANGES.map(([first, last]) =>
    first === last ? `U+${hex(first)}` : `U+${hex(first)}-${hex(last)}`,
  ).join(', ');
}

/** Whether a code point is one the subset keeps. */
export function inLatinRanges(codePoint: number): boolean {
  return LATIN_RANGES.some(([first, last]) => codePoint >= first && codePoint <= last);
}

/**
 * The OpenType layout features the subset keeps. `tnum` is the reason for the
 * face (#991: "with tabular figures"); `kern`, `liga`, `calt`, `ccmp` and
 * `locl` are what text needs to set at all; `lnum`, `pnum` and `case` are
 * the figure and capital forms a heading may ask for.
 */
export const LAYOUT_FEATURES: readonly string[] = [
  'calt',
  'case',
  'ccmp',
  'kern',
  'liga',
  'lnum',
  'locl',
  'mark',
  'mkmk',
  'pnum',
  'tnum',
];

/**
 * The `name` records the subset keeps: the family and style (1, 2, 4, 6, and
 * the typographic family and style 16 and 17, which ExtraBold carries because
 * its legacy family is "Barlow ExtraBold") a browser or a reader matches on,
 * the version (5) and ID (3), and — the half that is a
 * licence condition rather than a convenience — the copyright notice (0) and
 * the licence description and URL (13, 14). OFL §2 lets the notice travel "in
 * the appropriate machine-readable metadata fields", and these are those
 * fields; `fonts.test.ts` reads them back out of each WOFF2.
 */
export const NAME_IDS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 13, 14, 16, 17];

/** The arguments `fontTools.subset` is run with for one weight. */
export function subsetArguments(input: string, output: string): readonly string[] {
  return [
    input,
    `--unicodes=${unicodeRange().replaceAll(' ', '')}`,
    `--layout-features=${LAYOUT_FEATURES.join(',')}`,
    `--name-IDs=${NAME_IDS.join(',')}`,
    '--flavor=woff2',
    // TrueType hinting is for Windows' GDI rasteriser at small sizes. The
    // face is drawn at the display step and above, by Chromium's own
    // rasteriser, and the hints are a third of each file (20.6 KB hinted
    // against 13.6 KB unhinted, measured on Barlow Bold).
    '--no-hinting',
    '--notdef-outline',
    `--output-file=${output}`,
  ];
}
