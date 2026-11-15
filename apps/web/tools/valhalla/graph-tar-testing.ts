// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A `graph.tar` of the shape `valhalla_build_extract` 3.8.3 writes, for the
 * tests of `make-release.ts` and `build-graph.sh` (#2320): ustar, `index.bin`
 * first at byte 512, then one PAX header and one member per tile, each tile
 * opening with its own GraphId. The tiles are filler, not road data, and
 * carry no coordinate; their paths name tiles off the coast of nowhere.
 *
 * ```sh
 * node tools/valhalla/graph-tar-testing.ts <out.tar>   # what build-graph.test.sh's fake docker writes
 * ```
 */

import { writeFileSync } from 'node:fs';

import { tileIdFromPath } from './make-release';

/** Three tiles across all three levels: the archive the bash suite builds a release from. */
export const SYNTHETIC_TILE_PATHS = [
  '0/002/025.gph',
  '2/000/519/120.gph',
  '2/000/519/121.gph',
] as const;

const BLOCK = 512;

function octalField(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

function header(name: string, size: number, type: string): Buffer {
  const block = Buffer.alloc(BLOCK);
  block.write(name, 0, 100, 'utf8');
  block.write(octalField(0o644, 8), 100, 'ascii');
  block.write(octalField(0, 8), 108, 'ascii');
  block.write(octalField(0, 8), 116, 'ascii');
  block.write(octalField(size, 12), 124, 'ascii');
  block.write(octalField(0, 12), 136, 'ascii');
  block.write('        ', 148, 'ascii');
  block.write(type, 156, 'ascii');
  block.write('ustar\0', 257, 'ascii');
  block.write('00', 263, 'ascii');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return block;
}

function padded(data: Buffer): Buffer {
  return Buffer.concat([data, Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK)]);
}

function paxPath(path: string): Buffer {
  const body = ` path=${path}\n`;
  let length = body.length + 1;
  while (`${length}${body}`.length !== length) length += 1;
  return Buffer.from(`${length}${body}`);
}

/** A tile's bytes: its GraphId, little-endian, then `size - 8` bytes of filler. */
export function syntheticTile(path: string, size = 300): Buffer {
  const bytes = Buffer.alloc(size, path.length);
  bytes.writeBigUInt64LE(BigInt(tileIdFromPath(path)), 0);
  return bytes;
}

/** One index entry, as `index.bin` holds it. */
export interface IndexEntry {
  offset: number;
  id: number;
  size: number;
}

/** Ways to make the archive wrong, for the cases that must be refused. */
export interface SyntheticOptions {
  /** Rewrite the index before it is written. */
  readonly index?: (entries: IndexEntry[]) => IndexEntry[];
  /** Put a tile first instead of `index.bin`. */
  readonly tileFirst?: boolean;
  /** Bytes to use for a tile instead of `syntheticTile(path)`. */
  readonly bodies?: Readonly<Record<string, Buffer>>;
}

/** The archive's bytes. */
export function syntheticGraphTar(
  paths: readonly string[],
  options: SyntheticOptions = {},
): Buffer {
  const tiles = paths.map((path) => ({
    path,
    body: options.bodies?.[path] ?? syntheticTile(path),
  }));
  const layout = (indexSize: number): IndexEntry[] => {
    // index.bin's header and data come first; each tile then takes a PAX header and its data, and its own header.
    let position = BLOCK + padded(Buffer.alloc(indexSize)).length;
    return tiles.map((tile) => {
      position += BLOCK + padded(paxPath(tile.path)).length;
      const entry = {
        offset: position + BLOCK,
        id: tileIdFromPath(tile.path),
        size: tile.body.length,
      };
      position += BLOCK + padded(tile.body).length;
      return entry;
    });
  };
  const rewrite = options.index ?? ((entries: IndexEntry[]) => entries);
  // The index's own size moves every tile, so lay the archive out again for the size the rewrite gives.
  const indexSize = rewrite(layout(tiles.length * 16)).length * 16;
  const entries = rewrite(layout(indexSize));
  const index = Buffer.alloc(indexSize);
  entries.forEach((entry, at) => {
    index.writeBigUInt64LE(BigInt(entry.offset), at * 16);
    index.writeUInt32LE(entry.id, at * 16 + 8);
    index.writeUInt32LE(entry.size, at * 16 + 12);
  });
  const indexMember = [header('index.bin', indexSize, '0'), padded(index)];
  const tileMembers = tiles.flatMap((tile) => {
    const pax = paxPath(tile.path);
    return [
      header('././@PaxHeader', pax.length, 'x'),
      padded(pax),
      header(tile.path, tile.body.length, '0'),
      padded(tile.body),
    ];
  });
  const members =
    options.tileFirst === true
      ? [...tileMembers, ...indexMember]
      : [...indexMember, ...tileMembers];
  return Buffer.concat([...members, Buffer.alloc(BLOCK * 2)]);
}

if (process.argv[1]?.endsWith('graph-tar-testing.ts') === true) {
  const out = process.argv[2];
  if (out === undefined) {
    console.error('usage: graph-tar-testing.ts <out.tar>');
    process.exit(1);
  }
  writeFileSync(out, syntheticGraphTar(SYNTHETIC_TILE_PATHS));
}
