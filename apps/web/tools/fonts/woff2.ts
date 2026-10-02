// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reading a committed WOFF2 back — #991.
 *
 * Not a font engine: just enough of the WOFF2 container
 * (https://www.w3.org/TR/WOFF2/) and of four OpenType tables to let
 * `fonts.test.ts` say, in CI and without the pinned subsetter, what the
 * committed display face actually holds — which code points, which weight,
 * whether `tnum` still makes every figure one width, and whether the
 * copyright and licence records OFL §2 relies on are still in it.
 *
 * Every table it reads is one WOFF2 stores untransformed (`cmap`, `hhea`,
 * `hmtx` unless transformed, `name`, `OS/2`, `GSUB`); a transformed one is
 * returned as `undefined` rather than misread.
 */

import { brotliDecompressSync } from 'node:zlib';

/** WOFF2 §5.1's known-table list, indexed by a directory entry's six low flag bits. */
const KNOWN_TAGS = [
  'cmap',
  'head',
  'hhea',
  'hmtx',
  'maxp',
  'name',
  'OS/2',
  'post',
  'cvt ',
  'fpgm',
  'glyf',
  'loca',
  'prep',
  'CFF ',
  'VORG',
  'EBDT',
  'EBLC',
  'gasp',
  'hdmx',
  'kern',
  'LTSH',
  'PCLT',
  'VDMX',
  'vhea',
  'vmtx',
  'BASE',
  'GDEF',
  'GPOS',
  'GSUB',
  'EBSC',
  'JSTF',
  'MATH',
  'CBDT',
  'CBLC',
  'COLR',
  'CPAL',
  'SVG ',
  'sbix',
  'acnt',
  'avar',
  'bdat',
  'bloc',
  'bsln',
  'cvar',
  'fdsc',
  'feat',
  'fmtx',
  'fvar',
  'gvar',
  'hsty',
  'just',
  'lcar',
  'mort',
  'morx',
  'opbd',
  'prop',
  'trak',
  'Zapf',
  'Silf',
  'Glat',
  'Gloc',
  'Feat',
  'Sill',
] as const;

export class Woff2Error extends Error {
  override readonly name = 'Woff2Error';
}

/** A WOFF2 file's tables, each as the bytes the font holds, or `undefined` when transformed. */
export interface Woff2Font {
  /** The original font's sfnt version: `0x00010000` for TrueType outlines. */
  readonly flavor: number;
  readonly tables: ReadonlyMap<string, Uint8Array | undefined>;
}

function base128(bytes: Uint8Array, at: { offset: number }): number {
  let value = 0;
  for (let index = 0; index < 5; index += 1) {
    const byte = bytes[at.offset];
    if (byte === undefined) {
      throw new Woff2Error('a UIntBase128 runs past the end of the table directory');
    }
    at.offset += 1;
    if (index === 0 && byte === 0x80) {
      throw new Woff2Error('a UIntBase128 has a leading zero');
    }
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      return value;
    }
  }
  throw new Woff2Error('a UIntBase128 is longer than five bytes');
}

/** Decompress a WOFF2 file and split its stream into tables. */
export function readWoff2(file: Uint8Array): Woff2Font {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (file.byteLength < 48 || view.getUint32(0) !== 0x774f4632) {
    throw new Woff2Error('not a WOFF2 file: no wOF2 signature');
  }
  if (view.getUint32(8) !== file.byteLength) {
    throw new Woff2Error('the header’s length is not the file’s');
  }
  const flavor = view.getUint32(4);
  const count = view.getUint16(12);
  const compressedSize = view.getUint32(20);
  const at = { offset: 48 };
  const entries: { tag: string; length: number; transformed: boolean }[] = [];
  for (let index = 0; index < count; index += 1) {
    const flags = file[at.offset];
    if (flags === undefined) {
      throw new Woff2Error('the table directory runs past the end of the file');
    }
    at.offset += 1;
    let tag: string;
    if ((flags & 0x3f) === 0x3f) {
      tag = String.fromCharCode(...file.subarray(at.offset, at.offset + 4));
      at.offset += 4;
    } else {
      const known = KNOWN_TAGS[flags & 0x3f];
      if (known === undefined) {
        throw new Woff2Error(`table ${String(index)} names no known tag`);
      }
      tag = known;
    }
    const version = flags >> 6;
    const origLength = base128(file, at);
    // glyf and loca are transformed at version 0 and stored as-is at 3; every
    // other table is the other way round (WOFF2 §5.1).
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    const length = transformed ? base128(file, at) : origLength;
    entries.push({ tag, length, transformed });
  }
  const stream = new Uint8Array(
    brotliDecompressSync(file.subarray(at.offset, at.offset + compressedSize)),
  );
  const tables = new Map<string, Uint8Array | undefined>();
  let offset = 0;
  for (const entry of entries) {
    if (offset + entry.length > stream.byteLength) {
      throw new Woff2Error(`the ${entry.tag} table runs past the end of the decompressed stream`);
    }
    tables.set(
      entry.tag,
      entry.transformed ? undefined : stream.subarray(offset, offset + entry.length),
    );
    offset += entry.length;
  }
  return { flavor, tables };
}

/** A table the reader needs, refused when it is absent or transformed. */
export function table(font: Woff2Font, tag: string): DataView {
  const bytes = font.tables.get(tag);
  if (bytes === undefined) {
    throw new Woff2Error(
      font.tables.has(tag) ? `the ${tag} table is transformed` : `the font has no ${tag} table`,
    );
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * The whole font as a one-table sfnt holding only `cmap`, which is what
 * `tools/glyphs/truetype.ts` §`characterMaps` reads — the one cmap reader in
 * this repository, rather than a second.
 */
export function cmapOnlySfnt(font: Woff2Font): Uint8Array {
  const cmap = font.tables.get('cmap');
  if (cmap === undefined) {
    throw new Woff2Error('the font has no readable cmap table');
  }
  const out = new Uint8Array(12 + 16 + cmap.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, 1);
  out.set([0x63, 0x6d, 0x61, 0x70], 12);
  view.setUint32(20, 28);
  view.setUint32(24, cmap.byteLength);
  out.set(cmap, 28);
  return out;
}

/** `OS/2`'s usWeightClass. */
export function weightClass(font: Woff2Font): number {
  return table(font, 'OS/2').getUint16(4);
}

/** Every Windows-platform English record of the `name` table, by name ID. */
export function nameRecords(font: Woff2Font): ReadonlyMap<number, string> {
  const view = table(font, 'name');
  const count = view.getUint16(2);
  const strings = view.getUint16(4);
  const names = new Map<number, string>();
  for (let index = 0; index < count; index += 1) {
    const at = 6 + index * 12;
    const platform = view.getUint16(at);
    const encoding = view.getUint16(at + 2);
    const language = view.getUint16(at + 4);
    if (platform !== 3 || encoding !== 1 || language !== 0x0409) {
      continue;
    }
    const id = view.getUint16(at + 6);
    const length = view.getUint16(at + 8);
    const offset = strings + view.getUint16(at + 10);
    let text = '';
    for (let byte = 0; byte < length; byte += 2) {
      text += String.fromCharCode(view.getUint16(offset + byte));
    }
    names.set(id, text);
  }
  return names;
}

function coverage(view: DataView, at: number): number[] {
  const format = view.getUint16(at);
  const glyphs: number[] = [];
  if (format === 1) {
    const count = view.getUint16(at + 2);
    for (let index = 0; index < count; index += 1) {
      glyphs.push(view.getUint16(at + 4 + index * 2));
    }
  } else if (format === 2) {
    const count = view.getUint16(at + 2);
    for (let index = 0; index < count; index += 1) {
      const range = at + 4 + index * 6;
      for (let glyph = view.getUint16(range); glyph <= view.getUint16(range + 2); glyph += 1) {
        glyphs.push(glyph);
      }
    }
  } else {
    throw new Woff2Error(`coverage format ${String(format)} is not one OpenType defines`);
  }
  return glyphs;
}

/** Every feature tag `GSUB` lists. */
export function substitutionFeatures(font: Woff2Font): ReadonlySet<string> {
  const view = table(font, 'GSUB');
  const list = view.getUint16(6);
  const count = view.getUint16(list);
  const tags = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const at = list + 2 + index * 6;
    tags.add(
      String.fromCharCode(
        view.getUint8(at),
        view.getUint8(at + 1),
        view.getUint8(at + 2),
        view.getUint8(at + 3),
      ),
    );
  }
  return tags;
}

/**
 * What one `GSUB` feature does to single glyphs: the union of its lookups'
 * single substitutions (type 1, directly or through an extension, type 7).
 * Any other lookup type in the feature is refused rather than ignored.
 */
export function singleSubstitutions(font: Woff2Font, feature: string): ReadonlyMap<number, number> {
  const view = table(font, 'GSUB');
  const featureList = view.getUint16(6);
  const lookupList = view.getUint16(8);
  const lookups = new Set<number>();
  const featureCount = view.getUint16(featureList);
  for (let index = 0; index < featureCount; index += 1) {
    const at = featureList + 2 + index * 6;
    const tag = String.fromCharCode(
      view.getUint8(at),
      view.getUint8(at + 1),
      view.getUint8(at + 2),
      view.getUint8(at + 3),
    );
    if (tag !== feature) {
      continue;
    }
    const table = featureList + view.getUint16(at + 4);
    const lookupCount = view.getUint16(table + 2);
    for (let lookup = 0; lookup < lookupCount; lookup += 1) {
      lookups.add(view.getUint16(table + 4 + lookup * 2));
    }
  }
  const map = new Map<number, number>();
  for (const lookupIndex of lookups) {
    const lookup = lookupList + view.getUint16(lookupList + 2 + lookupIndex * 2);
    const type = view.getUint16(lookup);
    const subtables = view.getUint16(lookup + 4);
    for (let index = 0; index < subtables; index += 1) {
      let subtable = lookup + view.getUint16(lookup + 6 + index * 2);
      let subtableType = type;
      if (type === 7) {
        subtableType = view.getUint16(subtable + 2);
        subtable += view.getUint32(subtable + 4);
      }
      if (subtableType !== 1) {
        throw new Woff2Error(`${feature} uses a lookup of type ${String(subtableType)}`);
      }
      const format = view.getUint16(subtable);
      const covered = coverage(view, subtable + view.getUint16(subtable + 2));
      covered.forEach((glyph, position) => {
        if (format === 1) {
          map.set(glyph, (glyph + view.getInt16(subtable + 4) + 65536) % 65536);
        } else {
          map.set(glyph, view.getUint16(subtable + 6 + position * 2));
        }
      });
    }
  }
  return map;
}

/** A glyph's advance width, from `hhea` and an untransformed `hmtx`. */
export function advanceWidth(font: Woff2Font, glyph: number): number {
  const metrics = table(font, 'hhea').getUint16(34);
  const hmtx = table(font, 'hmtx');
  return hmtx.getUint16(Math.min(glyph, metrics - 1) * 4);
}
