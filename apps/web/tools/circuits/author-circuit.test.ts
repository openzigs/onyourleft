// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The authoring script's pure parts — #2293. The network half (the archive
 * and 3DEP) runs by hand outside CI (ADR 0064 D-7.1); what is held here is
 * the clipping that joins two tiles' halves of a street, the tiles it reads,
 * and that what it writes is what the app reads back, as Prettier leaves it.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tileBox } from '@onyourleft/map-features';
import { describe, expect, it } from 'vitest';

import { parseCircuitFile } from '../../src/game/circuits/circuit-file';
import { clipLine, serialise, tilesAround } from './author-circuit';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../../src/game/circuits/data');

describe('clipLine', () => {
  const box = { minX: 0, maxX: 100, minZ: 0, maxZ: 100 };

  it('keeps the part of a street inside the box, cut at its edges', () => {
    const pieces = clipLine(
      [
        { x: -50, z: 50 },
        { x: 150, z: 50 },
      ],
      box,
    );
    expect(pieces).toStrictEqual([
      [
        { x: 0, z: 50 },
        { x: 100, z: 50 },
      ],
    ]);
  });

  it('splits a street that leaves the box and comes back into two pieces', () => {
    const pieces = clipLine(
      [
        { x: 10, z: 10 },
        { x: 10, z: 200 },
        { x: 90, z: 200 },
        { x: 90, z: 10 },
      ],
      box,
    );
    expect(pieces).toHaveLength(2);
    expect(pieces[0]?.at(-1)).toStrictEqual({ x: 10, z: 100 });
    expect(pieces[1]?.[0]).toStrictEqual({ x: 90, z: 100 });
  });

  it('keeps nothing of a street wholly outside', () => {
    expect(
      clipLine(
        [
          { x: 200, z: 0 },
          { x: 300, z: 0 },
        ],
        box,
      ),
    ).toStrictEqual([]);
  });

  it('meets the next tile’s half of the same street at the shared edge', () => {
    const frame = { latitude: 10, longitude: 20 };
    const [west, east] = [
      { z: 15, x: 18_000, y: 15_000 },
      { z: 15, x: 18_001, y: 15_000 },
    ] as const;
    const a = tileBox(frame, west);
    const b = tileBox(frame, east);
    const middle = (a.minZ + a.maxZ) / 2;
    // x is WEST, so the western tile has the larger x.
    const street = [
      { x: a.maxX - 10, z: middle },
      { x: b.minX + 10, z: middle },
    ];
    const left = clipLine(street, a)[0]?.at(-1);
    const right = clipLine(street, b)[0]?.[0];
    expect(left?.x).toBeCloseTo(right?.x ?? Number.NaN, 6);
  });
});

describe('tilesAround', () => {
  it('reads every z15 tile within the radius, and only z15', () => {
    const tiles = tilesAround({ latitude: 0, longitude: 0 }, 2000);
    expect(tiles.every((tile) => tile.z === 15)).toBe(true);
    // A z15 tile at the equator is about 1.2 km: 4 km across is 4 or 5 tiles a side.
    expect(tiles.length).toBeGreaterThanOrEqual(16);
    expect(tiles.length).toBeLessThanOrEqual(25);
  });
});

describe('serialise', () => {
  it('writes every shipped file byte for byte as it is committed, so a redraw diffs only what moved', () => {
    for (const name of ['bellwether', 'ember', 'fieldfare', 'kestrel']) {
      const committed = readFileSync(join(DATA, `${name}.json`), 'utf8');
      const file = parseCircuitFile(JSON.parse(committed), name);
      expect(serialise(file)).toBe(committed);
    }
  });
});
