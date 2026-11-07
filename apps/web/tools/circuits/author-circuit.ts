// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `pnpm --filter @onyourleft/web circuits:author -- --id <id> --name "<Name>" --start <lat>,<lon> [--park] [--target <metres>]`
 * `pnpm --filter @onyourleft/web circuits:author -- --redraw src/game/circuits/data/<id>.json`
 *
 * Draws one built-in lap-race circuit — #2293, ADR 0064 D-7 — and writes it
 * to `src/game/circuits/data/<id>.json`. **Run by a developer, by hand, never
 * in CI** (D-7.1, ADR 0056 D-9's rule): it reads the project's own basemap
 * archive and USGS 3DEP over the network.
 *
 * 1. **The streets.** Every z15 tile within {@link READ_RADIUS_METRES} of the
 *    start, from the archive `map/basemap.ts` §`PUBLISHED_BASEMAP_URL` names
 *    (or `--archive`), through the app's own reader (`world-data/corridor-source.ts`)
 *    and decoder (`@onyourleft/map-features` §`decodeTile`), which decode no
 *    name and no id. Each street is clipped to its own tile, so two tiles'
 *    halves of it meet at the edge. Motorways, trunk roads, slip roads,
 *    service roads, alleys and tunnels are left out; a bridge is kept and
 *    marked.
 * 2. **The start.** The street node nearest `--start`, or with `--park` the
 *    node nearest the middle of the nearest mapped park: a public place, never
 *    a house (D-9.1).
 * 3. **The loop.** `loop.ts` §`searchLoops`.
 * 4. **The heights.** USGS 3DEP's bare-earth elevation service, sampled at
 *    every point, with a bridge's heights ramped between its ends
 *    (`loop.ts` §`bridgeHeights`): bare earth under a bridge is the valley.
 *
 * `--redraw` reads the start and the layout from a file already written and
 * draws it again, so a redraw after an archive refresh is a reviewable diff.
 *
 * What it prints is lengths, counts and digests. **It prints no coordinate**,
 * and every error names the field and the constraint and never the value
 * (ADR 0064 D-9.3): put a start in a shell history, never in an issue.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  decodeTile,
  METRES_PER_DEGREE_LATITUDE,
  tileBox,
  type Box,
  type CorridorFrame,
  type TileId,
} from '@onyourleft/map-features';

import {
  CIRCUIT_FILE_FORMAT,
  CIRCUIT_FILE_VERSION,
  CIRCUIT_HEIGHTS_DATASET,
  CIRCUIT_LICENCE,
  CIRCUIT_LONGEST_METRES,
  CIRCUIT_SHORTEST_METRES,
  circuitLength,
  parseCircuitFile,
  type CircuitFile,
  type CircuitPoint,
} from '../../src/game/circuits/circuit-file';
import { PUBLISHED_BASEMAP_URL } from '../../src/map/basemap';
import { archiveSource, corridorArchiveFrom } from '../../src/world-data/corridor-source';
import {
  bridgeHeights,
  buildGraph,
  densify,
  nearestNode,
  searchLoops,
  type LocalPoint,
  type LoopDesign,
  type StreetLine,
} from './loop';

/** How far round the start the streets are read. */
export const READ_RADIUS_METRES = 2800;

/** The widest gap left between two points of the written line. */
export const WRITTEN_STEP_METRES = 15;

/** USGS 3DEP's bare-earth elevation service (ADR 0032's table: public domain). */
export const THREE_DEP_SAMPLES_URL =
  'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples';

/** Points per 3DEP request: a GET, so the URL stays short. */
const SAMPLES_PER_REQUEST = 80;

const TILES_AT_Z15 = 2 ** 15;

/** A road's `kind_detail` the loop never rides. */
const NOT_RIDDEN_DETAILS = new Set([
  'motorway',
  'trunk',
  'service',
  'alley',
  'driveway',
  'parking_aisle',
]);

/** What a metre of each kind costs a leg: a quiet street is cheapest. */
function weightOf(kind: string, detail: string): number | undefined {
  if (kind === 'highway') return undefined;
  if (NOT_RIDDEN_DETAILS.has(detail) || detail.endsWith('_link')) return undefined;
  if (kind === 'major_road') return detail === 'primary' ? 1.6 : 1.25;
  return 1;
}

function column(longitude: number): number {
  return Math.floor(((longitude + 180) / 360) * TILES_AT_Z15);
}

function row(latitude: number): number {
  const radians = (latitude * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * TILES_AT_Z15);
}

/** The z15 tiles within `radius` metres of `frame`. */
export function tilesAround(frame: CorridorFrame, radius: number): readonly TileId[] {
  const dLat = radius / METRES_PER_DEGREE_LATITUDE;
  const dLon = radius / (METRES_PER_DEGREE_LATITUDE * Math.cos((frame.latitude * Math.PI) / 180));
  const tiles: TileId[] = [];
  for (let x = column(frame.longitude - dLon); x <= column(frame.longitude + dLon); x += 1) {
    for (let y = row(frame.latitude + dLat); y <= row(frame.latitude - dLat); y += 1) {
      tiles.push({ z: 15, x, y });
    }
  }
  return tiles;
}

/** The parts of a line inside `box` (Liang–Barsky, segment by segment). */
export function clipLine(points: readonly LocalPoint[], box: Box): LocalPoint[][] {
  const pieces: LocalPoint[][] = [];
  let current: LocalPoint[] = [];
  const flush = (): void => {
    if (current.length >= 2) pieces.push(current);
    current = [];
  };
  for (let at = 0; at + 1 < points.length; at += 1) {
    const a = points[at] as LocalPoint;
    const b = points[at + 1] as LocalPoint;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    let t0 = 0;
    let t1 = 1;
    let inside = true;
    for (const [p, q] of [
      [-dx, a.x - box.minX],
      [dx, box.maxX - a.x],
      [-dz, a.z - box.minZ],
      [dz, box.maxZ - a.z],
    ] as const) {
      if (p === 0) {
        if (q < 0) inside = false;
        continue;
      }
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
    if (!inside || t0 > t1) {
      flush();
      continue;
    }
    const from = { x: a.x + dx * t0, z: a.z + dz * t0 };
    const to = { x: a.x + dx * t1, z: a.z + dz * t1 };
    const last = current[current.length - 1];
    if (last === undefined || last.x !== from.x || last.z !== from.z) {
      flush();
      current.push(from);
    }
    current.push(to);
    if (t1 < 1) flush();
  }
  flush();
  return pieces;
}

function toLine(flat: Float32Array): LocalPoint[] {
  const points: LocalPoint[] = [];
  for (let at = 0; at + 1 < flat.length; at += 2) {
    points.push({ x: flat[at] as number, z: flat[at + 1] as number });
  }
  return points;
}

/** The inverse of `localMetres` for `frame`. */
function geographic(
  frame: CorridorFrame,
  point: LocalPoint,
): { latitude: number; longitude: number } {
  const perLon = METRES_PER_DEGREE_LATITUDE * Math.cos((frame.latitude * Math.PI) / 180);
  return {
    latitude: frame.latitude + point.z / METRES_PER_DEGREE_LATITUDE,
    longitude: frame.longitude - point.x / perLon,
  };
}

export interface Read {
  readonly streets: readonly StreetLine[];
  readonly parks: readonly LocalPoint[];
  /** SHA-256 over every tile read, in tile order: what ASSETS.toml calls `inputsha256`'s first half. */
  readonly digest: ReturnType<typeof createHash>;
}

export async function readStreets(archiveUrl: string, frame: CorridorFrame): Promise<Read> {
  const archive = corridorArchiveFrom(archiveSource(archiveUrl));
  const signal = new AbortController().signal;
  const opened = await archive.open(signal);
  if (opened.kind !== 'open') throw new Error('archive: is not a Protomaps v4 basemap');
  const digest = createHash('sha256');
  const streets: StreetLine[] = [];
  const parks: LocalPoint[] = [];
  const tiles = tilesAround(frame, READ_RADIUS_METRES);
  for (const tile of tiles) {
    const bytes = await archive.tile(tile, signal);
    if (bytes === undefined) continue;
    digest.update(bytes);
    const decoded = decodeTile(bytes, tile, frame);
    if ('reason' in decoded) throw new Error(`archive: a tile was refused (${decoded.reason})`);
    const box = tileBox(frame, tile);
    for (const street of decoded.streets) {
      if (street.grade === 'tunnel') continue;
      const weight = weightOf(street.kind, street.kindDetail);
      if (weight === undefined) continue;
      for (const piece of clipLine(toLine(street.line), box)) {
        streets.push({ points: piece, bridge: street.grade === 'bridge', weight });
      }
    }
    for (const use of decoded.landUse) {
      if (use.kind !== 'park') continue;
      const ring = use.rings[0];
      if (ring === undefined || ring.length < 6) continue;
      let x = 0;
      let z = 0;
      for (let at = 0; at + 1 < ring.length; at += 2) {
        x += ring[at] as number;
        z += ring[at + 1] as number;
      }
      parks.push({ x: x / (ring.length / 2), z: z / (ring.length / 2) });
    }
  }
  process.stdout.write(
    `read ${String(tiles.length)} tiles, ${String(streets.length)} street pieces\n`,
  );
  return { streets, parks, digest };
}

/** USGS 3DEP heights at `points`, in order; the answers go into `digest`. */
async function sampleHeights(
  points: readonly { latitude: number; longitude: number }[],
  digest: ReturnType<typeof createHash>,
): Promise<{ heights: number[]; resolution: number }> {
  const heights: number[] = [];
  let resolution = 0;
  for (let from = 0; from < points.length; from += SAMPLES_PER_REQUEST) {
    const batch = points.slice(from, from + SAMPLES_PER_REQUEST);
    const geometry = JSON.stringify({
      points: batch.map((point) => [point.longitude, point.latitude]),
      spatialReference: { wkid: 4326 },
    });
    const query = new URLSearchParams({
      geometry,
      geometryType: 'esriGeometryMultipoint',
      returnFirstValueOnly: 'true',
      interpolation: 'RSP_BilinearInterpolation',
      f: 'json',
    });
    let answer: string | undefined;
    for (let attempt = 0; attempt < 4 && answer === undefined; attempt += 1) {
      const response = await fetch(`${THREE_DEP_SAMPLES_URL}?${query.toString()}`);
      if (response.ok) answer = await response.text();
      else await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
    }
    if (answer === undefined) throw new Error('heights: 3DEP did not answer after four tries');
    digest.update(answer);
    const parsed = JSON.parse(answer) as {
      samples?: { locationId: number; value: string; resolution: number }[];
    };
    const samples = [...(parsed.samples ?? [])].sort((a, b) => a.locationId - b.locationId);
    if (samples.length !== batch.length) throw new Error('heights: 3DEP answered too few samples');
    for (const sample of samples) {
      const value = Number(sample.value);
      if (!Number.isFinite(value)) throw new Error('heights: 3DEP has no height for a point');
      heights.push(value);
      resolution = Math.max(resolution, sample.resolution);
    }
  }
  return { heights, resolution };
}

function round(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

/** The file as written: two-space JSON, one point a line, as Prettier leaves it. */
export function serialise(file: CircuitFile): string {
  const { points, ...rest } = file;
  const head = JSON.stringify(rest, null, 2).replace(/\n}$/, '');
  const lines = points.map((point) => `    [${point.map(String).join(', ')}]`).join(',\n');
  return `${head},\n  "points": [\n${lines}\n  ]\n}\n`;
}

interface Arguments {
  readonly id: string;
  readonly name: string;
  readonly start: CorridorFrame;
  readonly park: boolean;
  readonly targetMetres: number;
  readonly design: LoopDesign | undefined;
  readonly archive: string;
  readonly out: string;
}

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../../src/game/circuits/data');

async function parseArguments(argv: readonly string[]): Promise<Arguments> {
  const value = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at < 0 ? undefined : argv[at + 1];
  };
  const archive = value('--archive') ?? PUBLISHED_BASEMAP_URL;
  const redraw = value('--redraw');
  if (redraw !== undefined) {
    const file = parseCircuitFile(JSON.parse(await readFile(redraw, 'utf8')));
    const first = file.points[0] as CircuitPoint;
    return {
      id: file.id,
      name: file.name,
      start: { latitude: first[0], longitude: first[1] },
      park: false,
      targetMetres: file.lengthMetres,
      design: file.drawn,
      archive,
      out: redraw,
    };
  }
  const id = value('--id');
  const name = value('--name');
  const start = value('--start')?.split(',').map(Number);
  if (
    id === undefined ||
    name === undefined ||
    start?.length !== 2 ||
    start.some((n) => !Number.isFinite(n))
  ) {
    throw new Error('arguments: --id, --name and --start <latitude>,<longitude> are required');
  }
  return {
    id,
    name,
    start: { latitude: start[0] as number, longitude: start[1] as number },
    park: argv.includes('--park'),
    targetMetres: Number(value('--target') ?? 5000),
    design: undefined,
    archive,
    out: join(DATA, `${id}.json`),
  };
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = await parseArguments(argv);
  const frame = args.start;
  const read = await readStreets(args.archive, frame);
  const graph = buildGraph(read.streets);
  let near: LocalPoint = { x: 0, z: 0 };
  if (args.park) {
    const park = [...read.parks].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
    if (park === undefined) throw new Error('start: no mapped park within the streets read');
    near = park;
  }
  const start = nearestNode(graph, near, 400);
  if (start === undefined) throw new Error('start: no street node within 400 m');
  const loop = searchLoops(
    graph,
    start,
    {
      minMetres: CIRCUIT_SHORTEST_METRES + 100,
      maxMetres: CIRCUIT_LONGEST_METRES - 100,
      targetMetres: args.targetMetres,
    },
    args.design === undefined ? undefined : [args.design],
  );
  if (loop === undefined) throw new Error('loop: no loop of 3 to 8 km from this start');
  process.stdout.write(
    `loop: ${loop.lengthMetres.toFixed(0)} m, reused ${loop.reusedMetres.toFixed(0)} m, ` +
      `crossings ${String(loop.crossings)}, turns back ${String(loop.turnsBack)}, ` +
      `radius ${String(loop.design.radiusMetres)} m, corners ${String(loop.design.corners)}\n`,
  );
  const dense = densify(
    loop.nodes.map((node) => graph.nodes[node] as LocalPoint),
    loop.bridge,
    WRITTEN_STEP_METRES,
  );
  const places = dense.points.map((point) => geographic(frame, point));
  const sampled = await sampleHeights(places, read.digest);
  const heights = bridgeHeights(sampled.heights, dense.bridge);
  const points: CircuitPoint[] = places.map(
    (place, at) =>
      [
        round(place.latitude, 6),
        round(place.longitude, 6),
        round(heights[at] as number, 1),
      ] as const,
  );
  const file: CircuitFile = {
    format: CIRCUIT_FILE_FORMAT,
    version: CIRCUIT_FILE_VERSION,
    id: args.id,
    name: args.name,
    lengthMetres: Math.round(circuitLength(points)),
    heights: { dataset: CIRCUIT_HEIGHTS_DATASET, resolutionMetres: sampled.resolution },
    licence: { ...CIRCUIT_LICENCE, through: args.archive },
    drawn: loop.design,
    points,
  };
  // Read back through the app's own reader before it is written.
  parseCircuitFile(JSON.parse(serialise(file)), args.id);
  const written = serialise(file);
  await writeFile(args.out, written);
  let climb = 0;
  points.forEach((point, at) => {
    const next = points[(at + 1) % points.length] as CircuitPoint;
    if (next[2] > point[2]) climb += next[2] - point[2];
  });
  process.stdout.write(
    `wrote ${args.id}: ${String(file.lengthMetres)} m, ${String(points.length)} points, ` +
      `about ${climb.toFixed(0)} m of climbing, ${String(Buffer.byteLength(written))} bytes, ` +
      `3DEP resolution ${String(sampled.resolution)} m\n` +
      `sha256 ${createHash('sha256').update(written).digest('hex')}\n` +
      `inputsha256 ${read.digest.digest('hex')}\n`,
  );
  return 0;
}
