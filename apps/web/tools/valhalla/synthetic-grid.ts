// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A road grid off Null Island, as an OpenStreetMap `.osm.pbf`, for the routing
 * graph the browser gate routes on (#2734). No real place: the grid is in the
 * Gulf of Guinea, where there is no road, and nothing in it is OpenStreetMap
 * data.
 *
 * ```sh
 * node tools/valhalla/synthetic-grid.ts <out.osm.pbf>
 * bash tools/valhalla/build-graph.sh --pbf <out.osm.pbf> --prefix oyl-synthetic --out <dir>
 * ```
 *
 * `browser/valhalla-grid/README.md` says how the committed graph was built
 * from it, and why it is committed rather than built in CI.
 *
 * The grid is {@link GRID_LINES} by {@link GRID_LINES} junctions,
 * {@link GRID_SPACING_DEGREES} apart, every line a residential street and
 * every fifth a secondary road. Beside it, out of reach of it, is a small
 * square of streets with no road to the grid: a leg from one to the other is
 * a graph that holds both ends and has no path, the engine's no-route answer.
 *
 * The writer is the least of the PBF format Valhalla reads (`DenseNodes`, one
 * block of nodes and one of ways, zlib blobs), written here because the
 * Valhalla image carries no OSM tool and a dependency for forty lines of
 * protobuf would be a dependency for the gate's fixture alone.
 */

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

/** Junctions along each side of the grid. */
export const GRID_LINES = 21;

/** About 550 m between junctions at this latitude. */
export const GRID_SPACING_DEGREES = 0.005;

/** The grid's south-west junction: a tenth of a degree off Null Island, in open sea. */
export const GRID_ORIGIN = { latitude: 0.05, longitude: 0.05 } as const;

/** The unconnected square's south-west corner, 0.05° east of the grid's east edge. */
export const ISLAND_ORIGIN = {
  latitude: GRID_ORIGIN.latitude,
  longitude: GRID_ORIGIN.longitude + (GRID_LINES - 1) * GRID_SPACING_DEGREES + 0.05,
} as const;

interface Node {
  readonly id: number;
  readonly latitude: number;
  readonly longitude: number;
}

interface Way {
  readonly id: number;
  readonly highway: string;
  readonly refs: readonly number[];
}

/** The grid and the island, as nodes and ways. */
export function syntheticNetwork(): { nodes: Node[]; ways: Way[] } {
  const nodes: Node[] = [];
  const ways: Way[] = [];
  const square = (
    origin: { latitude: number; longitude: number },
    lines: number,
    firstNode: number,
    firstWay: number,
  ): void => {
    const id = (row: number, column: number): number => firstNode + row * lines + column;
    for (let row = 0; row < lines; row += 1) {
      for (let column = 0; column < lines; column += 1) {
        nodes.push({
          id: id(row, column),
          latitude: origin.latitude + row * GRID_SPACING_DEGREES,
          longitude: origin.longitude + column * GRID_SPACING_DEGREES,
        });
      }
    }
    for (let line = 0; line < lines; line += 1) {
      const highway = line % 5 === 0 ? 'secondary' : 'residential';
      const along = Array.from({ length: lines }, (_, at) => at);
      ways.push({ id: firstWay + line * 2, highway, refs: along.map((at) => id(line, at)) });
      ways.push({ id: firstWay + line * 2 + 1, highway, refs: along.map((at) => id(at, line)) });
    }
  };
  square(GRID_ORIGIN, GRID_LINES, 1, 1);
  square(ISLAND_ORIGIN, 3, 100_000, 100_000);
  return { nodes, ways };
}

function varint(value: number): number[] {
  const bytes: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    bytes.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  bytes.push(rest);
  return bytes;
}

const zigzag = (value: number): number => (value >= 0 ? value * 2 : -value * 2 - 1);

function field(number: number, wire: number): number[] {
  return varint(number * 8 + wire);
}

function bytesField(number: number, data: readonly number[] | Buffer): number[] {
  return [...field(number, 2), ...varint(data.length), ...data];
}

function varintField(number: number, value: number): number[] {
  return [...field(number, 0), ...varint(value)];
}

const text = (value: string): Buffer => Buffer.from(value, 'utf8');

/** Packed, delta-coded, zigzagged: how `DenseNodes` and `Way.refs` store their numbers. */
function packedDeltas(values: readonly number[]): number[] {
  let previous = 0;
  return values.flatMap((value) => {
    const delta = value - previous;
    previous = value;
    return varint(zigzag(delta));
  });
}

function blob(type: string, data: Buffer): Buffer {
  const body = Buffer.from([...varintField(2, data.length), ...bytesField(3, deflateSync(data))]);
  const header = Buffer.from([...bytesField(1, text(type)), ...varintField(3, body.length)]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  return Buffer.concat([length, header, body]);
}

/** The network as `.osm.pbf` bytes. */
export function syntheticGridPbf(): Buffer {
  const { nodes, ways } = syntheticNetwork();
  const header = Buffer.from([
    ...bytesField(4, text('OsmSchema-V0.6')),
    ...bytesField(4, text('DenseNodes')),
    ...bytesField(16, text('onyourleft synthetic-grid')),
  ]);
  const strings = ['', 'highway', 'residential', 'secondary'];
  const stringTable = bytesField(
    1,
    strings.flatMap((value) => bytesField(1, text(value))),
  );
  // Granularity 100 nanodegrees, the default: a coordinate is degrees × 10⁷.
  const scaled = (degrees: number): number => Math.round(degrees * 1e7);
  const dense = [
    ...bytesField(1, packedDeltas(nodes.map((node) => node.id))),
    ...bytesField(8, packedDeltas(nodes.map((node) => scaled(node.latitude)))),
    ...bytesField(9, packedDeltas(nodes.map((node) => scaled(node.longitude)))),
  ];
  const nodeGroup = bytesField(2, bytesField(2, dense));
  const wayGroup = bytesField(
    2,
    ways.flatMap((way) =>
      bytesField(3, [
        ...varintField(1, way.id),
        ...bytesField(2, varint(strings.indexOf('highway'))),
        ...bytesField(3, varint(strings.indexOf(way.highway))),
        ...bytesField(8, packedDeltas(way.refs)),
      ]),
    ),
  );
  const block = (group: number[]): Buffer =>
    Buffer.from([...stringTable, ...group, ...varintField(17, 100)]);
  return Buffer.concat([
    blob('OSMHeader', header),
    blob('OSMData', block(nodeGroup)),
    blob('OSMData', block(wayGroup)),
  ]);
}

if (process.argv[1]?.endsWith('synthetic-grid.ts') === true) {
  const out = process.argv[2];
  if (out === undefined || !out.endsWith('.osm.pbf')) {
    console.error('usage: synthetic-grid.ts <out.osm.pbf>');
    process.exit(1);
  }
  writeFileSync(out, syntheticGridPbf());
}
