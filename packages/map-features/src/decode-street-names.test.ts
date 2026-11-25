// SPDX-License-Identifier: Apache-2.0

/**
 * #3052, ADR 0096: a street's `name`, read only when the caller asks for it,
 * bounded and cleaned, and kept on a street alone. The default decode reads
 * no name: `decode.test.ts`' sentinel, *no name, address, pmap:* field or id
 * survives*, is unchanged and still holds it.
 */

import { describe, expect, it } from 'vitest';

import { decodeTile, streetNameOf } from './decode';
import { EARTH, FIXTURE_FRAME, FIXTURE_TILE } from './fixtures/tiles';
import { STREET_NAME_MAX_CHARS } from './schema';
import { encodeTile, line, type TagValue } from './testing/mvt-encoder';
import type { DecodedTile } from './types';

/**
 * A tile of {@link roadsTile}'s rows with the first row's name as `text`'s
 * UTF-8 bytes: the test encoder writes a string as ASCII, so the tile is
 * encoded with a placeholder of the same byte length and the bytes written
 * over it.
 */
function namedTile(text: string, rest: readonly Readonly<Record<string, TagValue>>[]): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  const placeholder = '~'.repeat(bytes.length);
  const tile = roadsTile([{ name: placeholder }, ...rest]);
  const at = tile.findIndex((_, index) =>
    Array.from(bytes, (__, offset) => tile[index + offset] === 0x7e).every(Boolean),
  );
  if (at < 0) throw new Error('no placeholder in the tile');
  tile.set(bytes, at);
  return tile;
}

/** One street a row, each with `tags` beside its kind; row `i` runs along tile row `300 + 300·i`. */
function roadsTile(rows: readonly Readonly<Record<string, TagValue>>[]): Uint8Array {
  return encodeTile([
    EARTH,
    {
      name: 'roads',
      features: rows.map((tags, index) => ({
        type: 2,
        tags: { kind: 'minor_road', ...tags },
        geometry: line([
          [
            [100, 300 + 300 * index],
            [4000, 300 + 300 * index],
          ],
        ]),
      })),
    },
  ]);
}

function decodedWithNames(bytes: Uint8Array, streetNames = true): DecodedTile {
  const result = decodeTile(bytes, FIXTURE_TILE, FIXTURE_FRAME, undefined, { streetNames });
  if ('reason' in result) throw new Error(`refused: ${result.reason}`);
  return result;
}

/** Each street's name, in row order, `null` for none. */
function namesOf(tile: DecodedTile): (string | null)[] {
  return tile.streets.map((street) => street.name ?? null);
}

describe('decodeTile reads a street’s name only when asked — #3052, ADR 0096', () => {
  it('names a named street, leaves an unnamed one without the key, and gives a footway and a railway none', () => {
    const bytes = encodeTile([
      EARTH,
      {
        name: 'roads',
        features: [
          {
            type: 2,
            tags: { kind: 'minor_road', name: 'Third Avenue' },
            geometry: line([
              [
                [100, 300],
                [4000, 300],
              ],
            ]),
          },
          {
            type: 2,
            tags: { kind: 'minor_road' },
            geometry: line([
              [
                [100, 600],
                [4000, 600],
              ],
            ]),
          },
          {
            type: 2,
            tags: { kind: 'path', kind_detail: 'footway', name: 'Mill Path' },
            geometry: line([
              [
                [100, 900],
                [4000, 900],
              ],
            ]),
          },
          {
            type: 2,
            tags: { kind: 'rail', kind_detail: 'rail', name: 'Valley Line' },
            geometry: line([
              [
                [100, 1200],
                [4000, 1200],
              ],
            ]),
          },
        ],
      },
    ]);
    const tile = decodedWithNames(bytes);
    expect(namesOf(tile)).toStrictEqual(['Third Avenue', null]);
    expect('name' in (tile.streets[1] as object)).toBe(false);
    const text = JSON.stringify({ paths: tile.paths, rails: tile.rails });
    expect(text).not.toContain('Mill Path');
    expect(text).not.toContain('Valley Line');
  });

  it('reads no name by default: a route ride’s corridor is decoded as before', () => {
    const bytes = roadsTile([{ name: 'Third Avenue' }]);
    // Not vacuous: the tile carries it, and asked, the decoder reads it.
    expect(namesOf(decodedWithNames(bytes))).toStrictEqual(['Third Avenue']);
    const plain = decodeTile(bytes, FIXTURE_TILE, FIXTURE_FRAME);
    if ('reason' in plain) throw new Error(`refused: ${plain.reason}`);
    expect(JSON.stringify(plain)).not.toContain('Third Avenue');
    expect(namesOf(decodedWithNames(bytes, false))).toStrictEqual([null]);
  });

  it('reads `name` and never `name:en` or `ref`', () => {
    const tile = decodedWithNames(roadsTile([{ 'name:en': 'Third Avenue (en)', ref: 'US 1' }]));
    expect(namesOf(tile)).toStrictEqual([null]);
    expect(JSON.stringify(tile)).not.toContain('US 1');
  });
});

describe('a hostile tile’s name is cleaned, bounded or dropped, and never refuses the tile', () => {
  const cases: readonly {
    readonly label: string;
    readonly name: TagValue;
    readonly expected: string | null;
  }[] = [
    { label: 'as mapped, accents and all', name: 'Rue de l’Église', expected: 'Rue de l’Église' },
    {
      label: 'control characters and a bidirectional override dropped',
      name: 'Main\u0000 Street‮\u0007',
      expected: 'Main Street',
    },
    {
      label: 'zero-width and isolate characters dropped',
      name: '⁦Oak​ Lane⁩',
      expected: 'Oak Lane',
    },
    {
      label: 'runs of space made one, and trimmed',
      name: '  Elm \t\n  Road  ',
      expected: 'Elm Road',
    },
    { label: 'nothing but space is no name', name: '   ​ ', expected: null },
    { label: 'an empty string is no name', name: '', expected: null },
    { label: 'a number is no name', name: 7, expected: null },
    { label: 'a boolean is no name', name: true, expected: null },
    {
      label: 'past the character bound, cut at the last whole word',
      name: 'Avenue of the Very Long Name That Goes On And On Beyond Any Street',
      expected: 'Avenue of the Very Long Name That Goes On And',
    },
    { label: 'past the byte bound, no name at all', name: 'A'.repeat(300), expected: null },
    {
      label: 'past the byte bound in two-byte letters, though under it in characters, no name',
      name: 'é'.repeat(129),
      expected: null,
    },
  ];

  for (const nameCase of cases) {
    it(`${nameCase.label}`, () => {
      const tile = decodedWithNames(
        typeof nameCase.name === 'string' && nameCase.name.length > 0
          ? namedTile(nameCase.name, [{ name: 'Control Way' }])
          : roadsTile([{ name: nameCase.name }, { name: 'Control Way' }]),
      );
      // The street is kept either way, and the next one is untouched.
      expect(tile.streets).toHaveLength(2);
      expect(namesOf(tile)).toStrictEqual([nameCase.expected, 'Control Way']);
      const kept = tile.streets[0]?.name;
      if (kept !== undefined) {
        expect(Array.from(kept).length).toBeLessThanOrEqual(STREET_NAME_MAX_CHARS);
      }
    });
  }

  // #2891, ADR 0098: a name kept on the device and read back is held to the
  // same rules, so a block from the ridden-block cache names a street exactly
  // as the tile did — and an edited blob can name it nothing the tile could not.
  for (const nameCase of cases) {
    it(`read back from the device, as from a tile: ${nameCase.label}`, () => {
      expect(streetNameOf(nameCase.name) ?? null).toBe(nameCase.expected);
    });
  }

  it('read back from the device, a lone surrogate is no name, and a well-formed pair is kept', () => {
    expect(streetNameOf('Rue \uD800 Haute')).toBeUndefined();
    expect(streetNameOf('Rue \uDC00 Basse')).toBeUndefined();
    expect(streetNameOf('Rue 😀 Pleine')).toBe('Rue 😀 Pleine');
    expect(streetNameOf(undefined)).toBeUndefined();
    expect(streetNameOf(null)).toBeUndefined();
  });

  it('malformed UTF-8 is no name, and the tile’s other street keeps its own', () => {
    const bytes = roadsTile([{ name: 'QQZZ' }, { name: 'Control Way' }]);
    // Each malformed sequence, written over the name's bytes in turn.
    const at = bytes.findIndex(
      (_, index) =>
        bytes[index] === 0x51 &&
        bytes[index + 1] === 0x51 &&
        bytes[index + 2] === 0x5a &&
        bytes[index + 3] === 0x5a,
    );
    expect(at).toBeGreaterThan(0);
    for (const [patch, label] of [
      [[0xc0, 0xaf, 0x41, 0x41], 'overlong lead byte'],
      // E0 80 AF passes the lead-byte check and decodes to U+002F: only `point < least` stops it.
      [[0xe0, 0x80, 0xaf, 0x41], 'overlong three-byte'],
      [[0x41, 0x80, 0x41, 0x41], 'lone continuation'],
      [[0x41, 0x41, 0x41, 0xe2], 'cut sequence'],
      [[0xed, 0xa0, 0x80, 0x41], 'surrogate'],
      // F4 90 80 80 is 0x110000, past U+10FFFF: String.fromCodePoint would throw a RangeError.
      [[0xf4, 0x90, 0x80, 0x80], 'past U+10FFFF'],
    ] as const) {
      const hostile = Uint8Array.from(bytes);
      hostile.set(patch, at);
      const tile = decodedWithNames(hostile);
      expect(namesOf(tile), label).toStrictEqual([null, 'Control Way']);
    }
  });
});
