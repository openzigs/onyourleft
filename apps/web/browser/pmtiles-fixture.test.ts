// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The fixture archive, read back through the decoder that will actually read it.
 *
 * ## Why this is not asserted against expected bytes
 *
 * A byte-for-byte expectation over a generated binary is the cheapest test to
 * write here and the least useful. It goes red for a reordering that changes
 * nothing, it goes green for a header field that is well-formed and wrong, and
 * it never once exercises the question that matters — **can the consumer read
 * it?** CLAUDE.md §5's defect shape is *a write that reports success while the
 * read cannot see it*, and its instruction is to *"assert by reading back
 * through the same path a real consumer uses"*. So the container is read back
 * through `pmtiles`' own `PMTiles` class, which is the class `maplibre.ts`
 * hands to `addProtocol`.
 *
 * ⚠️ **What this substitutes, and what it therefore cannot see.** The
 * {@link MemorySource} below replaces `FetchSource`, so everything about the
 * **transport** is outside this file: whether the harness server answers a
 * `Range` request at all, whether it returns `206` or a whole-file `200` that
 * `FetchSource` rejects, whether the `.pmtiles` extension is served. Those are
 * real failure modes and `map.browser.spec.ts` is where they are covered, over
 * a real HTTP server and a real engine. Neither file is the other's superset.
 *
 * ## And why there is a second decoder in here
 *
 * `PMTiles` hands back a tile body and has no opinion about what is in it — it
 * is a container reader. Nothing in this repository decodes MVT, so
 * {@link readTile} does, in about forty lines of protobuf, written from the
 * specification rather than from the encoder it checks. That independence is
 * the point: a reader derived from the writer agrees with it by construction,
 * including where both are wrong. The same reason `identity-verifier.test.ts`
 * calls `crypto.subtle.verify` directly instead of routing through
 * `web-crypto.ts`.
 */

import { PMTiles, type RangeResponse, type Source, zxyToTileId } from 'pmtiles';
import { describe, expect, it } from 'vitest';

import {
  basemapStyle,
  BASEMAP_SOURCE_ID,
  OSM_ATTRIBUTION,
  type BasemapStyle,
} from '../src/map/basemap';
import {
  buildFixtureArchive,
  FIXTURE_MAX_ZOOM,
  FIXTURE_SOURCE_LAYERS,
  fixtureTile,
  pyramidTileCount,
} from './pmtiles-fixture';

/** The archive in memory, so a range request is a slice. @see the module note. */
class MemorySource implements Source {
  constructor(private readonly bytes: Uint8Array) {}

  getKey(): string {
    return 'memory://fixture';
  }

  getBytes(offset: number, length: number): Promise<RangeResponse> {
    // Clamped the way a well-behaved HTTP server clamps a range that runs past
    // the end of the file — which is what the first request does, since it asks
    // for 16,384 bytes of an archive far smaller than that.
    const end = Math.min(offset + length, this.bytes.length);
    const slice = this.bytes.slice(offset, end);
    return Promise.resolve({ data: slice.buffer });
  }
}

interface ProtobufCursor {
  readonly bytes: Uint8Array;
  position: number;
}

function readVarint(cursor: ProtobufCursor): number {
  let value = 0;
  let shift = 1;
  for (;;) {
    const byte = cursor.bytes[cursor.position];
    if (byte === undefined) {
      throw new RangeError('a varint ran off the end of the buffer');
    }
    cursor.position += 1;
    value += (byte & 0x7f) * shift;
    if ((byte & 0x80) === 0) {
      return value;
    }
    shift *= 0x80;
  }
}

/** Every `(field, bytes)` pair in a protobuf message, wire types 0 and 2 only. */
function readFields(bytes: Uint8Array): { field: number; varint?: number; bytes?: Uint8Array }[] {
  const cursor: ProtobufCursor = { bytes, position: 0 };
  const fields: { field: number; varint?: number; bytes?: Uint8Array }[] = [];
  while (cursor.position < bytes.length) {
    const key = readVarint(cursor);
    const field = Math.floor(key / 8);
    const wireType = key % 8;
    if (wireType === 0) {
      fields.push({ field, varint: readVarint(cursor) });
    } else if (wireType === 2) {
      const length = readVarint(cursor);
      fields.push({ field, bytes: bytes.subarray(cursor.position, cursor.position + length) });
      cursor.position += length;
    } else {
      throw new RangeError(`the fixture should emit no wire type ${String(wireType)}`);
    }
  }
  return fields;
}

interface DecodedFeature {
  readonly type: number;
  readonly commands: readonly number[];
}

interface DecodedLayer {
  readonly name: string;
  readonly extent: number;
  readonly version: number;
  readonly features: readonly DecodedFeature[];
}

/** A vector tile, as far as this fixture uses the format. */
function readTile(bytes: Uint8Array): DecodedLayer[] {
  const layers: DecodedLayer[] = [];
  for (const entry of readFields(bytes)) {
    if (entry.field !== 3 || entry.bytes === undefined) {
      continue;
    }
    let name = '';
    let extent = 0;
    let version = 0;
    const features: DecodedFeature[] = [];
    for (const field of readFields(entry.bytes)) {
      if (field.field === 1 && field.bytes !== undefined) {
        name = new TextDecoder().decode(field.bytes);
      } else if (field.field === 2 && field.bytes !== undefined) {
        let type = 0;
        const commands: number[] = [];
        for (const part of readFields(field.bytes)) {
          if (part.field === 3 && part.varint !== undefined) {
            type = part.varint;
          } else if (part.field === 4 && part.bytes !== undefined) {
            const cursor: ProtobufCursor = { bytes: part.bytes, position: 0 };
            while (cursor.position < part.bytes.length) {
              commands.push(readVarint(cursor));
            }
          }
        }
        features.push({ type, commands });
      } else if (field.field === 5 && field.varint !== undefined) {
        extent = field.varint;
      } else if (field.field === 15 && field.varint !== undefined) {
        version = field.varint;
      }
    }
    layers.push({ name, extent, version, features });
  }
  return layers;
}

/** Undo zigzag, so a parameter integer reads as the signed delta it encodes. */
function unzigzag(value: number): number {
  return (value >>> 1) ^ -(value & 1);
}

/** The vertices a ring or line walks, from its command integers. */
function walk(commands: readonly number[]): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let index = 0;
  while (index < commands.length) {
    const command = commands[index] ?? 0;
    index += 1;
    const id = command % 8;
    const count = Math.floor(command / 8);
    if (id === 7) {
      continue;
    }
    for (let step = 0; step < count; step += 1) {
      x += unzigzag(commands[index] ?? 0);
      y += unzigzag(commands[index + 1] ?? 0);
      index += 2;
      points.push({ x, y });
    }
  }
  return points;
}

/** The signed area of a ring, MVT 2.1 §4.3.3.3's surveyor's formula. */
function signedArea(points: readonly { x: number; y: number }[]): number {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const here = points[index];
    const next = points[(index + 1) % points.length];
    if (here === undefined || next === undefined) {
      continue;
    }
    total += here.x * next.y - next.x * here.y;
  }
  return total / 2;
}

/** Every `source-layer` the real style reads from the basemap vector source. */
function styleSourceLayers(style: BasemapStyle): string[] {
  return style.layers
    .filter((layer) => layer.source === BASEMAP_SOURCE_ID)
    .map((layer) => layer['source-layer'])
    .filter((name): name is string => name !== undefined)
    .sort();
}

const FIXTURE_URL = 'https://tiles.example.test/basemap.pmtiles';

describe('the fixture archive', () => {
  it('is readable by the decoder the client actually ships', async () => {
    const archive = new PMTiles(new MemorySource(buildFixtureArchive()));
    const header = await archive.getHeader();

    expect(header.specVersion).toBe(3);
    // `TileType.Mvt`. A wrong value here is the difference between MapLibre
    // parsing the body and MapLibre handing it to an image decoder.
    expect(header.tileType).toBe(1);
    expect(header.minZoom).toBe(0);
    expect(header.maxZoom).toBe(FIXTURE_MAX_ZOOM);
    expect(header.numTileEntries).toBe(1);
    expect(header.numTileContents).toBe(1);
    expect(header.numAddressedTiles).toBe(pyramidTileCount(FIXTURE_MAX_ZOOM));
  });

  it('declares the bounds Web Mercator actually has', async () => {
    const archive = new PMTiles(new MemorySource(buildFixtureArchive()));
    const header = await archive.getHeader();

    // ⚠️ Asserted because `pmtiles`' own MapLibre adapter logs
    // `Bounds of PMTiles archive … are not valid` and carries on when
    // `minLon >= maxLon`, which is a defect that reaches the browser as a
    // console line nobody reads and a map that clips everything away.
    expect(header.minLon).toBeLessThan(header.maxLon);
    expect(header.minLat).toBeLessThan(header.maxLat);
    expect(header.minLon).toBeCloseTo(-180, 5);
    expect(header.maxLon).toBeCloseTo(180, 5);
    expect(header.maxLat).toBeCloseTo(85.0511287, 5);
  });

  it('carries its metadata section, and claims no OpenStreetMap data in it', async () => {
    const archive = new PMTiles(new MemorySource(buildFixtureArchive()));
    const metadata = (await archive.getMetadata()) as {
      vector_layers: { id: string }[];
      attribution?: string;
    };

    expect(metadata.vector_layers.map((layer) => layer.id)).toEqual([...FIXTURE_SOURCE_LAYERS]);
    // The fixture is three rectangles and a line. An attribution field here
    // would be a false licence notice inside a build artefact, and the
    // product's own OSM credit — asserted in `MapPanel.test.tsx` — is a
    // separate thing that this must not be mistaken for.
    expect(metadata.attribution).toBeUndefined();
    expect(OSM_ATTRIBUTION).not.toContain('fixture');
  });

  it('answers for every tile from zoom zero to its declared maximum', async () => {
    const archive = new PMTiles(new MemorySource(buildFixtureArchive()));
    const expected = fixtureTile();

    // The corners of the pyramid, not a sample of the middle: the first tile,
    // the last tile at the deepest zoom, and one in between. A run length that
    // is short by any amount fails on the last of these, and a run length that
    // is one too long is invisible — which is why `numAddressedTiles` is
    // asserted arithmetically above rather than only probed here.
    const probes: [number, number, number][] = [
      [0, 0, 0],
      [1, 1, 0],
      [7, 63, 42],
      [FIXTURE_MAX_ZOOM, 2 ** FIXTURE_MAX_ZOOM - 1, 2 ** FIXTURE_MAX_ZOOM - 1],
    ];
    for (const [z, x, y] of probes) {
      const response = await archive.getZxy(z, x, y);
      expect(response, `no tile at ${String(z)}/${String(x)}/${String(y)}`).toBeDefined();
      expect(new Uint8Array(response?.data ?? new ArrayBuffer(0))).toEqual(expected);
    }

    // And the entry does not run past the zoom the header claims. A tile the
    // header says is absent must actually be absent, or `maxZoom` is a lie the
    // renderer will act on.
    expect(await archive.getZxy(FIXTURE_MAX_ZOOM + 1, 0, 0)).toBeUndefined();
  });

  it('spans exactly the pyramid, with no tile id left over', () => {
    // The arithmetic behind the run length, checked against the library's own
    // id function rather than against itself: the id of the last tile at the
    // deepest zoom is one less than the count.
    const last = zxyToTileId(FIXTURE_MAX_ZOOM, 2 ** FIXTURE_MAX_ZOOM - 1, 0);
    expect(last).toBe(pyramidTileCount(FIXTURE_MAX_ZOOM) - 1);
    expect(pyramidTileCount(0)).toBe(1);
    expect(pyramidTileCount(1)).toBe(5);
  });
});

describe('the fixture tile', () => {
  it('fills every source layer the real style reads, and no other', () => {
    const style = basemapStyle({ archiveUrl: FIXTURE_URL, attribution: OSM_ATTRIBUTION });

    // The drift guard. A `source-layer` added to `basemapStyle` that the
    // fixture does not carry is a style layer the browser gate can never see
    // paint — the map still renders, the pixel assertion still passes on some
    // other layer's colour, and the new one is covered by nothing at all.
    expect([...FIXTURE_SOURCE_LAYERS].sort()).toEqual(styleSourceLayers(style));
  });

  it('decodes as a version 2 vector tile with the extent it declares', () => {
    const layers = readTile(fixtureTile());

    expect(layers.map((layer) => layer.name)).toEqual([...FIXTURE_SOURCE_LAYERS]);
    for (const layer of layers) {
      expect(layer.version, `${layer.name} version`).toBe(2);
      expect(layer.extent, `${layer.name} extent`).toBe(4096);
      expect(layer.features.length).toBe(1);
    }
  });

  it('draws its polygons the way round that makes them exterior rings', () => {
    const layers = readTile(fixtureTile());
    const polygons = layers.filter((layer) => layer.features[0]?.type === 3);

    expect(polygons.map((layer) => layer.name)).toEqual(['earth', 'water']);
    for (const layer of polygons) {
      const points = walk(layer.features[0]?.commands ?? []);
      expect(points.length, `${layer.name} vertices`).toBe(4);
      // ⚠️ The whole reason this assertion exists. MVT 2.1 §4.3.3.3 reads the
      // sign of this number as the ring's role: positive is an exterior ring,
      // negative is a hole. Reverse the vertex order and the archive is still
      // well-formed, `PMTiles` still hands the tile over, and MapLibre draws
      // nothing at all — a failure whose only symptom is a blank map.
      expect(signedArea(points), `${layer.name} winding`).toBeGreaterThan(0);
    }
  });

  it('covers the whole tile with earth, past the edge, so tiles do not seam', () => {
    const earth = readTile(fixtureTile()).find((layer) => layer.name === 'earth');
    const points = walk(earth?.features[0]?.commands ?? []);

    // Every corner strictly outside `[0, 4096]`, which is what makes adjacent
    // tiles overlap instead of meeting on an antialiased shared edge.
    for (const point of points) {
      expect(point.x < 0 || point.x > 4096).toBe(true);
      expect(point.y < 0 || point.y > 4096).toBe(true);
    }
  });

  it('carries one feature that is not a polygon', () => {
    const roads = readTile(fixtureTile()).find((layer) => layer.name === 'roads');

    // The encoder is otherwise proved by rectangles alone, which would leave
    // `LineTo` without `ClosePath` — a different command sequence — untested.
    expect(roads?.features[0]?.type).toBe(2);
    expect(walk(roads?.features[0]?.commands ?? []).length).toBe(2);
    // And it is not closed: a `ClosePath` here would make MapLibre read a
    // degenerate ring rather than a line.
    expect(roads?.features[0]?.commands).not.toContain(15);
  });
});
