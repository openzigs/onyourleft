// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `pnpm --filter @onyourleft/web levels:author -- --draft <draft.json> [--archive <url>] [--out <directory>]`
 *
 * Draws one built-in Delivery level — #2361, ADR 0065 D-7.3 — and writes it to
 * `src/game/delivery/levels/data/<id>.json`. **Run by a developer, by hand,
 * never in CI**: it reads the project's own basemap archive and USGS 3DEP over
 * the network.
 *
 * The draft is a small JSON file kept in the private scratchpad, never
 * committed, because it holds the start (D-13.2):
 * `{ "id", "name", "start": [latitude, longitude], "park"?, "targetMetres", "round": { … } }`,
 * where `round` is the level file's own round (`level-file.ts` §`LevelRound`).
 *
 * 1. **The line**: the circuits' own street read and loop search
 *    (`tools/circuits/author-circuit.ts`, `loop.ts`), held to 1.5 to 5 km,
 *    with USGS 3DEP heights at every point (D-7.4).
 * 2. **The buildings**: the corridor's tiles, planned as a ride plans them
 *    (`world-data/corridor.ts` §`planCorridor`, no privacy zone) and read
 *    through the app's own reader, keeping each footprint with a corner within
 *    `CORRIDOR_HALF_WIDTH_METRES` of the line, its building fields and no
 *    other layer (D-2.2). The decoder reads no OSM id, name or address, so
 *    none can be written. A corridor with any tile not read is refused: a
 *    level with a hole in it would be short of houses.
 * 3. **The checks, before anything is written**: the file is read back
 *    through the app's own reader; it must be within the size ceilings
 *    (`level-sizes.ts`, D-3.2); and **its round houses, counted by
 *    `delivery/courses.ts` §`roundHousesOn` over the corridor the level will
 *    be ridden on (`levels.ts` §`levelCorridor`), must be at least the
 *    round's houses plus {@link LEVEL_HOUSE_MARGIN}** (D-5.4). A level that
 *    fails any of them is not written, and the tool exits non-zero.
 *
 * What it prints is lengths, counts, sizes and digests. **It prints no
 * coordinate**, and every error names the field and the constraint and never
 * the value (D-13.3): put a start in the private scratchpad, never in an issue.
 */

import { createHash, type Hash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { GeographicPosition } from '@onyourleft/domain';
import {
  BUILDING_FIELD_NAMES,
  localMetres,
  type BuildingFeature,
  type TileId,
} from '@onyourleft/map-features';

import { roundHousesOn } from '../../src/game/delivery/courses';
import {
  LEVEL_FILE_FORMAT,
  LEVEL_FILE_VERSION,
  LEVEL_HEIGHTS_DATASET,
  LEVEL_LICENCE,
  LEVEL_LONGEST_METRES,
  LEVEL_SHORTEST_METRES,
  levelLength,
  parseLevelFile,
  type LevelBuilding,
  type LevelFile,
  type LevelPoint,
  type LevelShape,
} from '../../src/game/delivery/levels/level-file';
import { levelCorridor, levelRoute } from '../../src/game/delivery/levels/levels';
import {
  CORRIDOR_HALF_WIDTH_METRES,
  planCorridor,
  readCorridorTiles,
  type CorridorArchive,
} from '../../src/game/world-data/corridor';
import { PUBLISHED_BASEMAP_URL } from '../../src/map/basemap';
import { archiveSource, corridorArchiveFrom } from '../../src/world-data/corridor-source';
import {
  geographic,
  readStreets,
  sampleHeights,
  WRITTEN_STEP_METRES,
} from '../circuits/author-circuit';
import {
  bridgeHeights,
  buildGraph,
  densify,
  nearestNode,
  searchLoops,
  type LocalPoint,
} from '../circuits/loop';
import { LEVEL_FILE_MAX_BYTES, levelFileSizes, levelSizeFindings } from './level-sizes';

/**
 * **The margin: 2 houses.** A level is written only when the round houses
 * `roundHousesOn` counts on it are at least its round's houses plus this, so
 * the HUD's too-few-houses message is never reached on a level (D-5.4), with
 * room for a seeded pick that takes a house ruling out two (`targets.ts`
 * §`countRoundHouses`: the count is a ceiling on any pick). The count is
 * capped at `round.ts` §`MOST_HOUSES`, so a level can ask for at most ten.
 */
export const LEVEL_HOUSE_MARGIN = 2;

/** An error of the tool's own: its message names what failed and never a value. */
export class AuthorError extends Error {
  override name = 'AuthorError';
}

/** What a developer asks for: kept in the private scratchpad, never committed. */
export interface LevelDraft {
  readonly id: string;
  readonly name: string;
  readonly start: { readonly latitude: number; readonly longitude: number };
  readonly park: boolean;
  readonly targetMetres: number;
  readonly round: unknown;
}

/** The line a source drew, with its heights, and the digest of what it read to draw it. */
export interface DrawnLine {
  readonly shape: LevelShape;
  readonly points: readonly LevelPoint[];
  readonly resolutionMetres: number;
  readonly digest: Hash;
}

/** Where the line and the buildings come from: the network by default, a fixture in a test. */
export interface LevelSources {
  drawLine(draft: LevelDraft, archive: string): Promise<DrawnLine>;
  /** Every footprint the corridor of `points` holds, in local metres from the first; read bytes go into `digest`. */
  readBuildings(
    points: readonly LevelPoint[],
    archive: string,
    digest: Hash,
  ): Promise<readonly BuildingFeature[]>;
}

function roundTo(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function positionsOf(points: readonly LevelPoint[]): GeographicPosition[] {
  return points.map(([latitude, longitude]) => ({ latitude, longitude }) as GeographicPosition);
}

/** The network's line: the circuits' street read and loop search, held to a level's lengths. */
async function drawLineFromNetwork(draft: LevelDraft, archive: string): Promise<DrawnLine> {
  const frame = draft.start;
  const read = await readStreets(archive, frame);
  const graph = buildGraph(read.streets);
  let near: LocalPoint = { x: 0, z: 0 };
  if (draft.park) {
    const park = [...read.parks].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
    if (park === undefined) throw new AuthorError('start: no mapped park within the streets read');
    near = park;
  }
  const start = nearestNode(graph, near, 400);
  if (start === undefined) throw new AuthorError('start: no street node within 400 m');
  const loop = searchLoops(graph, start, {
    minMetres: LEVEL_SHORTEST_METRES + 100,
    maxMetres: LEVEL_LONGEST_METRES - 100,
    targetMetres: draft.targetMetres,
  });
  if (loop === undefined) throw new AuthorError('loop: no loop of 1.5 to 5 km from this start');
  const dense = densify(
    loop.nodes.map((node) => graph.nodes[node] as LocalPoint),
    loop.bridge,
    WRITTEN_STEP_METRES,
  );
  const places = dense.points.map((point) => geographic(frame, point));
  const sampled = await sampleHeights(places, read.digest);
  const heights = bridgeHeights(sampled.heights, dense.bridge);
  return {
    shape: 'loop',
    points: places.map(
      (place, at) =>
        [
          roundTo(place.latitude, 6),
          roundTo(place.longitude, 6),
          roundTo(heights[at] as number, 1),
        ] as const,
    ),
    resolutionMetres: sampled.resolution,
    digest: read.digest,
  };
}

/** The network's buildings: the corridor read as a ride reads it, every tile of it or nothing. */
async function readBuildingsFromNetwork(
  points: readonly LevelPoint[],
  archive: string,
  digest: Hash,
): Promise<readonly BuildingFeature[]> {
  const plan = planCorridor(positionsOf(points), []);
  if (plan === undefined) throw new AuthorError('corridor: the line has no points');
  const source = corridorArchiveFrom(archiveSource(archive));
  const bytes = new Map<string, Uint8Array>();
  const key = (tile: TileId): string => `${String(tile.x)}/${String(tile.y)}`;
  const recording: CorridorArchive = {
    open: (signal) => source.open(signal),
    tile: async (tile, signal) => {
      const read = await source.tile(tile, signal);
      if (read !== undefined) bytes.set(key(tile), read);
      return read;
    },
  };
  const read = await readCorridorTiles({
    plan,
    archive: recording,
    signal: new AbortController().signal,
    progress: () => undefined,
    yieldToIdle: () => Promise.resolve(),
    log: (line) => process.stderr.write(`${line}\n`),
  });
  if (read.kind !== 'read') throw new AuthorError(`corridor: the read came to ${read.kind}`);
  const missing = read.tiles.filter((tile) => tile.state !== 'covered').length;
  if (missing > 0) {
    throw new AuthorError(
      `corridor: ${String(missing)} of its tiles were not read; a level is drawn only where all are`,
    );
  }
  // In the plan's order, so the digest does not depend on which tile arrived first.
  for (const tile of plan.requestable) {
    const tileBytes = bytes.get(key(tile));
    if (tileBytes !== undefined) digest.update(tileBytes);
  }
  return read.features.buildings;
}

export const NETWORK_SOURCES: LevelSources = {
  drawLine: drawLineFromNetwork,
  readBuildings: readBuildingsFromNetwork,
};

/** The shortest distance from `(x, z)` to the polyline `line`, in the same local metres. */
function distanceToLine(x: number, z: number, line: readonly { x: number; z: number }[]): number {
  let best = Infinity;
  for (let at = 0; at + 1 < line.length; at += 1) {
    const a = line[at] as { x: number; z: number };
    const b = line[at + 1] as { x: number; z: number };
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const span = dx * dx + dz * dz;
    const t = span === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / span));
    best = Math.min(best, Math.hypot(x - (a.x + t * dx), z - (a.z + t * dz)));
  }
  return best;
}

/**
 * The footprints to bake (D-2.2): each with a corner of its outline within
 * `CORRIDOR_HALF_WIDTH_METRES` of the line, at centimetres, with only its set
 * building fields. Nothing else of a footprint is kept, because nothing else
 * is in a `BuildingFeature`.
 */
export function bakedBuildings(
  points: readonly LevelPoint[],
  shape: LevelShape,
  buildings: readonly BuildingFeature[],
): LevelBuilding[] {
  const first = points[0];
  if (first === undefined) return [];
  const frame = { latitude: first[0], longitude: first[1] };
  const line = points.map(([latitude, longitude]) => localMetres(frame, longitude, latitude));
  if (shape === 'loop') line.push(line[0] as { x: number; z: number });
  const baked: LevelBuilding[] = [];
  for (const building of buildings) {
    const outline = building.rings[0];
    if (outline === undefined) continue;
    let near = false;
    for (let at = 0; at + 1 < outline.length && !near; at += 2) {
      near =
        distanceToLine(outline[at] as number, outline[at + 1] as number, line) <=
        CORRIDOR_HALF_WIDTH_METRES;
    }
    if (!near) continue;
    const fields: Partial<Record<(typeof BUILDING_FIELD_NAMES)[number], string | number>> = {};
    for (const name of BUILDING_FIELD_NAMES) {
      const value = building[name];
      if (value !== null) fields[name] = value;
    }
    baked.push({
      kind: building.kind,
      heightMetres: building.heightMetres === null ? null : roundTo(building.heightMetres, 2),
      minHeightMetres:
        building.minHeightMetres === null ? null : roundTo(building.minHeightMetres, 2),
      fields,
      rings: building.rings.map((ring) => Array.from(ring, (value) => roundTo(value, 2))),
    });
  }
  return baked;
}

/**
 * The file as written: two-space JSON, then one footprint a line and one
 * point a line. `.prettierignore` leaves the levels' JSON alone, so what this
 * writes is what is committed, and a redraw diffs only what moved.
 */
export function serialise(file: LevelFile): string {
  const { buildings, points, ...rest } = file;
  const head = JSON.stringify(rest, null, 2).replace(/\n}$/, '');
  const footprints =
    buildings.length === 0
      ? '[]'
      : `[\n${buildings.map((building) => `    ${JSON.stringify(building)}`).join(',\n')}\n  ]`;
  const lines = points.map((point) => `    [${point.map(String).join(', ')}]`).join(',\n');
  return `${head},\n  "buildings": ${footprints},\n  "points": [\n${lines}\n  ]\n}\n`;
}

interface Arguments {
  readonly draft: LevelDraft;
  readonly archive: string;
  readonly out: string;
}

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../../src/game/delivery/levels/data');

async function readDraft(path: string): Promise<LevelDraft> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    // Never the parser's own message: it quotes the text, and the text holds the start.
    throw new AuthorError('draft: is not a JSON file that can be read');
  }
  const draft = raw as Partial<Record<keyof LevelDraft, unknown>> | null;
  const start = draft?.start;
  if (
    typeof draft?.id !== 'string' ||
    typeof draft.name !== 'string' ||
    !Array.isArray(start) ||
    start.length !== 2 ||
    !start.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
    typeof draft.targetMetres !== 'number'
  ) {
    throw new AuthorError(
      'draft: needs id, name, start [latitude, longitude], targetMetres and round',
    );
  }
  return {
    id: draft.id,
    name: draft.name,
    start: { latitude: start[0] as number, longitude: start[1] as number },
    park: draft.park === true,
    targetMetres: draft.targetMetres,
    round: draft.round,
  };
}

async function parseArguments(argv: readonly string[]): Promise<Arguments> {
  const value = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at < 0 ? undefined : argv[at + 1];
  };
  const draft = value('--draft');
  if (draft === undefined) throw new AuthorError('arguments: --draft <draft.json> is required');
  return {
    draft: await readDraft(draft),
    archive: value('--archive') ?? PUBLISHED_BASEMAP_URL,
    out: value('--out') ?? DATA,
  };
}

/** `basemap-us-oyl-20261031` from its URL. */
function buildOf(archive: string): string {
  return archive.replace(/^.*\//, '').replace(/\.pmtiles$/, '');
}

async function author(argv: readonly string[], sources: LevelSources): Promise<number> {
  const { draft, archive, out } = await parseArguments(argv);
  const line = await sources.drawLine(draft, archive);
  const buildings = bakedBuildings(
    line.points,
    line.shape,
    await sources.readBuildings(line.points, archive, line.digest),
  );
  const drawn = {
    format: LEVEL_FILE_FORMAT,
    version: LEVEL_FILE_VERSION,
    id: draft.id,
    name: draft.name,
    shape: line.shape,
    lengthMetres: Math.round(levelLength(line.points, line.shape)),
    heights: { dataset: LEVEL_HEIGHTS_DATASET, resolutionMetres: line.resolutionMetres },
    round: draft.round,
    archive: { build: buildOf(archive), sha256: line.digest.digest('hex') },
    licence: { ...LEVEL_LICENCE, through: archive },
    buildings,
    points: line.points,
  };
  // Read back through the app's own reader before anything is written: what
  // is checked from here on is the file as the game will read it.
  const file = parseLevelFile(JSON.parse(JSON.stringify(drawn)), draft.id);
  const written = serialise(file);
  const bytes = Buffer.byteLength(written);
  const others = levelFileSizes(out).filter((each) => each.name !== `${file.id}.json`);
  const findings = levelSizeFindings([...others, { name: `${file.id}.json`, bytes }]);
  if (findings.length > 0) {
    throw new AuthorError(
      `size: not written, redraw it shorter or elsewhere (ADR 0065 D-3.2; the ceiling is ${String(LEVEL_FILE_MAX_BYTES)} bytes a level): ${findings.join('; ')}`,
    );
  }
  const houses = roundHousesOn(levelCorridor(file), levelRoute(file).profile);
  const wanted = file.round.houses + LEVEL_HOUSE_MARGIN;
  if (houses < wanted) {
    throw new AuthorError(
      `houses: not written; the level holds ${String(houses)} round houses and its round asks for ` +
        `${String(file.round.houses)} plus a margin of ${String(LEVEL_HOUSE_MARGIN)} (ADR 0065 D-5.4)`,
    );
  }
  await writeFile(join(out, `${file.id}.json`), written);
  process.stdout.write(
    `wrote ${file.id}: ${file.shape}, ${String(file.lengthMetres)} m, ${String(file.points.length)} points, ` +
      `${String(file.buildings.length)} buildings, ${String(houses)} round houses for ${String(file.round.houses)}, ` +
      `${String(bytes)} bytes\n` +
      `sha256 ${createHash('sha256').update(written).digest('hex')}\n` +
      `inputsha256 ${file.archive.sha256}\n`,
  );
  return 0;
}

/** The tool: `0` when the level is written, `1`, with the reason and no file, when it is not. */
export async function main(
  argv: readonly string[],
  sources: LevelSources = NETWORK_SOURCES,
): Promise<number> {
  try {
    return await author(argv, sources);
  } catch (error) {
    // Every message here names a field and a constraint: the tool's own, the
    // reader's (`LevelFileError`) and the circuits' street read's alike.
    process.stderr.write(`levels:author: ${error instanceof Error ? error.message : 'failed'}\n`);
    return 1;
  }
}
