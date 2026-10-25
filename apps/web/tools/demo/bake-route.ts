// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `demo:bake` — one preset route's map data, baked from our archive into the
 * demo build's output only. #1651, ADR 0056.
 *
 * ```sh
 * pnpm --filter @onyourleft/web run demo:bake -- --route <id> [--gpx <file>] [--archive <https-url-or-file>] [--record]
 * pnpm --filter @onyourleft/web run demo:bake -- --route <id> --gpx <your file> --strip
 * ```
 *
 * - **The route** is the owner's GPX, `apps/web/demo/routes/<id>.gpx` unless
 *   `--gpx` names another (ADR 0056 D-7). Only each point's latitude,
 *   longitude and `<ele>` are kept; its times, extensions, names and metadata
 *   are never read into the output, and the output is checked for a timestamp
 *   before it is written (`route-bundle.ts` §`timestampFields`). Trimming the
 *   ends so no home is published is the owner's, at upload (D-7.3).
 * - **The archive** is `map/basemap.ts` §`PUBLISHED_BASEMAP_URL` unless
 *   `--archive` names another, by `https:` URL or as a local file — CI's is
 *   the browser gate's synthetic fixture (D-9), never OpenStreetMap data.
 * - **The read is a ride's.** `corridor.ts` §`planCorridor` and
 *   §`readCorridorTiles`, through `world-data/corridor-source.ts`
 *   §`corridorArchiveFrom` (with its own `archiveSource` for a URL), and
 *   §`packedCorridorFeatures` — so the demo draws exactly what a rider on the
 *   route would get. At most `CORRIDOR_MAX_TILES` (600) tiles, each one range
 *   read. A route that leaves the archive's bounds, or a tile that is refused,
 *   fails the bake: a half-read route is not reproducible.
 * - **The output** is `apps/web/demo/dist/routes/` — gitignored, pruned, never
 *   committed (D-5.1): `<id>.<digest>.bin`, `routes.json` (the manifest) and
 *   `LICENCE-ODbL.txt`. `vite.demo.config.ts` keeps them across a demo build
 *   and fails the build above `DEMO_ROUTE_MAX_BYTES`.
 * - **A preset route's record**, `apps/web/demo/routes/<id>.bake.json`,
 *   committed beside the GPX. The owner writes its `gpx` block first — the
 *   licence (`CC0-1.0`), where the track came from, and the date they
 *   confirmed it is theirs to publish (D-7.4, D-7.5) — and a preset route
 *   with no whole block is not baked. **`--record`** adds the bake's
 *   digests: the file's SHA-256, the archive's URL and identity, the GPX's own
 *   SHA-256 and the reader version (D-5.2). Without it, a bake that disagrees
 *   with the recorded digests fails, naming which field moved.
 *
 * ## Adding a preset route (the owner)
 *
 * 1. `demo:bake -- --route <id> --gpx <your file> --strip` writes
 *    `apps/web/demo/routes/<id>.gpx` with the track's latitude, longitude and
 *    elevation only — a preset GPX with a time, an extension, a name or
 *    metadata in it is refused, since committing it would publish them. Trim
 *    its ends so that neither is near a home (D-7.3).
 * 2. Write `apps/web/demo/routes/<id>.bake.json`:
 *    `{ "gpx": { "licence": "CC0-1.0", "source": "my own ride, recorded on a head unit", "confirmed": "YYYY-MM-DD" } }`.
 * 3. `pnpm --filter @onyourleft/web run demo:bake -- --route <id> --record`,
 *    then commit the GPX and the record — never anything under `demo/dist/`.
 *
 * ⚠️ **Location data** (ADR 0004 D): nothing here prints a coordinate. A
 * failure names the field or the count; the read's own failures are put in
 * words by `corridor.ts` §`describeCorridorFailure` alone.
 *
 * A build-time tool: not in the demo's or the rider app's module graph, and
 * its reads of the archive are made by whoever runs it (D-6).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  altitudeMetres,
  routeProfile,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';
import { decodeGpx, trackPointsOf } from '@onyourleft/fit';
import type { Source } from 'pmtiles';

import {
  CORRIDOR_READER_VERSION,
  gunzipBytes,
  packedCorridorFeatures,
  planCorridor,
  readCorridorTiles,
  type CorridorArchive,
} from '../../src/game/world-data/corridor';
import { PUBLISHED_BASEMAP_URL } from '../../src/map/basemap';
import { archiveSource, corridorArchiveFrom } from '../../src/world-data/corridor-source';

import { DEMO_ROUTE_MAX_BYTES, ODBL_NOTICE_FILE, ROUTE_MANIFEST_FILE } from './demo-routes';
import {
  bundleLicence,
  encodeRouteBundle,
  odblNoticeText,
  OSM_COPYRIGHT_URL,
  ROUTE_BUNDLE_FORMAT,
  ROUTE_BUNDLE_VERSION,
  ROUTE_LINE_LICENCE,
  type RoutePointTuple,
  type UncoveredTile,
} from './route-bundle';

/** A route id: it becomes a file name, so nothing that could leave the directory. */
export const ROUTE_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** The GPX as the bake keeps it: the points' three numbers, and the profile a ride would build. */
export interface RouteLine {
  readonly points: readonly RoutePointTuple[];
  readonly profile: RouteProfile;
}

/**
 * The route's line from a GPX: through `@onyourleft/fit`'s own decoder, which
 * refuses a `<!DOCTYPE` (XXE), and `@onyourleft/domain`'s `routeProfile`, as
 * `decodeGpxRoute` builds an imported route's. Of each point, only its
 * position and its `<ele>` are taken.
 */
export function routeLineOf(gpx: string): RouteLine {
  const { activity } = decodeGpx(gpx);
  const points: RoutePointTuple[] = [];
  const routePoints: RoutePoint[] = [];
  for (const point of trackPointsOf(activity)) {
    if (point.position === undefined) continue;
    const elevation = point.altitude === undefined ? null : Number(point.altitude);
    points.push([Number(point.position.latitude), Number(point.position.longitude), elevation]);
    routePoints.push({
      position: point.position,
      elevation: elevation === null ? undefined : altitudeMetres(elevation),
    });
  }
  if (points.length < 2) {
    throw new Error(
      `demo:bake: the GPX has ${String(points.length)} points with a position; a route needs two`,
    );
  }
  return { points, profile: routeProfile(routePoints) };
}

/**
 * A GPX of the line's three numbers and nothing else — what is committed as a
 * preset route (ADR 0056 D-7.2): no time, no extension, no name, no metadata
 * and no `creator`. Read back by {@link routeLineOf}, it gives the same points.
 */
export function strippedGpx(points: readonly RoutePointTuple[]): string {
  const lines = points.map(
    ([latitude, longitude, elevation]) =>
      `<trkpt lat="${String(latitude)}" lon="${String(longitude)}">` +
      `${elevation === null ? '' : `<ele>${String(elevation)}</ele>`}</trkpt>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>',
    ...lines,
    '</trkseg></trk></gpx>',
    '',
  ].join('\n');
}

/** The GPX elements and attributes a committed preset route may not carry, as found. */
export function personalGpxFields(gpx: string): string[] {
  return ['time', 'extensions', 'metadata', 'name', 'desc', 'cmt', 'src', 'link']
    .filter((element) => new RegExp(`<(?:[\\w-]+:)?${element}[\\s>/]`).test(gpx))
    .map((element) => `<${element}>`)
    .concat(/\screator\s*=/.test(gpx) ? ['creator='] : []);
}

/** What the manifest says of one route. */
export interface ManifestEntry {
  readonly file: string;
  readonly sha256: string;
  /** The file's bytes, and the JSON's inside it. */
  readonly bytes: number;
  readonly jsonBytes: number;
  readonly archiveUrl: string;
  /** The archive header's ETag, or a SHA-256 of the header where its host sends none. */
  readonly archiveIdentity: string;
  readonly readerVersion: number;
  readonly tiles: { readonly planned: number; readonly covered: number };
  readonly points: number;
  /** Where the hills come from (ADR 0056 D-7.6): the GPX's own `<ele>`, and no elevation dataset. */
  readonly elevation: 'gpx-ele';
  readonly gpxSha256: string;
}

export interface BakeOptions {
  readonly routeId: string;
  readonly gpx: string;
  readonly archive: CorridorArchive;
  readonly archiveUrl: string;
  readonly log?: ((line: string) => void) | undefined;
}

export interface BakedRoute {
  readonly routeId: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly entry: ManifestEntry;
}

const sha256 = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');

/** One route, baked in memory. Throws for anything that would make a partial or unrepeatable file. */
export async function bakeRoute(options: BakeOptions): Promise<BakedRoute> {
  const { routeId } = options;
  if (!ROUTE_ID.test(routeId)) {
    throw new Error('demo:bake: a route id is lower-case letters, digits and hyphens');
  }
  const log = options.log ?? ((): void => undefined);
  const line = routeLineOf(options.gpx);
  // No privacy zones: the line is the owner's, trimmed at upload (D-7.3).
  const plan = planCorridor(line.profile.positions, []);
  if (plan === undefined) throw new Error('demo:bake: the route plans no corridor');
  const read = await readCorridorTiles({
    plan,
    archive: options.archive,
    signal: new AbortController().signal,
    progress: (done, of) => {
      if (done === of || done % 50 === 0)
        log(`demo:bake: ${routeId}: ${String(done)} of ${String(of)} tiles`);
    },
    yieldToIdle: () => Promise.resolve(),
    log,
  });
  if (read.kind !== 'read') {
    throw new Error(
      read.kind === 'wrong-schema'
        ? 'demo:bake: the archive is not a Protomaps basemap v4 archive'
        : `demo:bake: the archive could not be read (${read.kind})`,
    );
  }
  const uncovered: UncoveredTile[] = [];
  plan.tiles.forEach((_, index) => {
    const state = read.tiles[index]?.state;
    if (state !== undefined && state !== 'covered') uncovered.push({ index, state });
  });
  const outside = uncovered.filter((tile) => tile.state === 'outside-archive').length;
  if (outside > 0) {
    throw new Error(
      `demo:bake: ${String(outside)} of the route's tiles are outside the archive, which covers ` +
        'the United States only; a route outside it is refused',
    );
  }
  const refused = uncovered.filter((tile) => tile.state === 'refused').length;
  if (refused > 0) {
    throw new Error(
      `demo:bake: ${String(refused)} tiles were refused; bake again, since a partial read is not reproducible`,
    );
  }
  const bytes = await encodeRouteBundle({
    format: ROUTE_BUNDLE_FORMAT,
    version: ROUTE_BUNDLE_VERSION,
    ...bundleLicence(),
    source: {
      name: 'OpenStreetMap contributors',
      url: OSM_COPYRIGHT_URL,
      archiveUrl: options.archiveUrl,
      archiveIdentity: read.identity,
    },
    readerVersion: CORRIDOR_READER_VERSION,
    route: { licence: ROUTE_LINE_LICENCE, points: line.points },
    tiles: { planned: plan.tiles.length, uncovered },
    features: packedCorridorFeatures(read.features),
  });
  if (bytes.byteLength > DEMO_ROUTE_MAX_BYTES) {
    throw new Error(
      `demo:bake: ${routeId} is ${String(bytes.byteLength)} bytes, over the ceiling of ` +
        `${String(DEMO_ROUTE_MAX_BYTES)} (demo-routes.ts §DEMO_ROUTE_MAX_BYTES)`,
    );
  }
  const digest = sha256(bytes);
  return {
    routeId,
    bytes,
    entry: {
      file: `${routeId}.${digest.slice(0, 16)}.bin`,
      sha256: digest,
      bytes: bytes.byteLength,
      jsonBytes: (await gunzipBytes(bytes)).byteLength,
      archiveUrl: options.archiveUrl,
      archiveIdentity: read.identity,
      readerVersion: CORRIDOR_READER_VERSION,
      tiles: { planned: plan.tiles.length, covered: plan.tiles.length - uncovered.length },
      points: line.points.length,
      elevation: 'gpx-ele',
      gpxSha256: sha256(options.gpx),
    },
  };
}

/** The manifest's whole shape. */
export interface RouteManifest {
  readonly format: typeof ROUTE_BUNDLE_FORMAT;
  readonly version: typeof ROUTE_BUNDLE_VERSION;
  readonly licence: 'ODbL-1.0';
  readonly licenceUrl: string;
  readonly notice: string;
  readonly noticeFile: typeof ODBL_NOTICE_FILE;
  readonly routes: Readonly<Record<string, ManifestEntry>>;
}

/**
 * Writes a baked route into `directory`: its file, in place of any earlier
 * bake of the same route, its manifest entry beside the others', and the
 * notice file. Returns the file's path.
 */
export function writeBakedRoute(directory: string, baked: BakedRoute): string {
  mkdirSync(directory, { recursive: true });
  for (const name of readdirSync(directory)) {
    if (name.startsWith(`${baked.routeId}.`) && name.endsWith('.bin'))
      rmSync(join(directory, name));
  }
  const file = join(directory, baked.entry.file);
  writeFileSync(file, baked.bytes);
  const manifestPath = join(directory, ROUTE_MANIFEST_FILE);
  const earlier = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as RouteManifest).routes
    : {};
  const routes: Record<string, ManifestEntry> = { ...earlier, [baked.routeId]: baked.entry };
  const manifest: RouteManifest = {
    format: ROUTE_BUNDLE_FORMAT,
    version: ROUTE_BUNDLE_VERSION,
    ...bundleLicence(),
    noticeFile: ODBL_NOTICE_FILE,
    routes: Object.fromEntries(
      Object.keys(routes)
        .sort()
        .map((id) => [id, routes[id] as ManifestEntry]),
    ),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(directory, ODBL_NOTICE_FILE), odblNoticeText());
  return file;
}

/** The committed record of a bake (ADR 0056 D-5.2): a digest, never data. */
export interface BakeRecord {
  readonly sha256: string;
  readonly archiveUrl: string;
  readonly archiveIdentity: string;
  readonly gpxSha256: string;
  readonly readerVersion: number;
}

export function recordOf(entry: ManifestEntry): BakeRecord {
  return {
    sha256: entry.sha256,
    archiveUrl: entry.archiveUrl,
    archiveIdentity: entry.archiveIdentity,
    gpxSha256: entry.gpxSha256,
    readerVersion: entry.readerVersion,
  };
}

/**
 * The owner's word on a preset route's GPX (ADR 0056 D-7.4, D-7.5), written
 * by the owner into `<id>.bake.json` before the first bake: that the track is
 * theirs to publish, where it came from, and when they confirmed it. The GPX
 * is plain text, not a binary, so `ASSETS.toml` does not hold it; this does.
 */
export interface GpxProvenance {
  /** `CC0-1.0`, D-10 Q2's ruling. Any other licence needs its own ruling first. */
  readonly licence: typeof ROUTE_LINE_LICENCE;
  /** Where the track came from: the owner's own recorded ride, or drawn by hand — never a planner's. */
  readonly source: string;
  /** The day the owner confirmed it is theirs to publish, `YYYY-MM-DD`. */
  readonly confirmed: string;
}

/** A preset route's committed file: the owner's provenance, and the bake's digests once recorded. */
export type PresetRecord = { readonly gpx: GpxProvenance } & Partial<BakeRecord>;

/** What is missing from a record's provenance, as lines; empty when it is whole. */
export function provenanceFindings(record: unknown): string[] {
  const gpx = (record as { gpx?: Partial<Record<keyof GpxProvenance, unknown>> } | null)?.gpx;
  if (typeof gpx !== 'object' || gpx === null) {
    return ['no "gpx" block: the owner states the licence, source and confirmation date'];
  }
  const findings: string[] = [];
  if (gpx.licence !== ROUTE_LINE_LICENCE) {
    findings.push(`"gpx.licence" is not ${ROUTE_LINE_LICENCE} (ADR 0056 D-7.5)`);
  }
  if (typeof gpx.source !== 'string' || gpx.source.trim() === '') {
    findings.push('"gpx.source" does not say where the track came from');
  }
  if (typeof gpx.confirmed !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(gpx.confirmed)) {
    findings.push('"gpx.confirmed" is not the date the owner confirmed it, as YYYY-MM-DD');
  }
  return findings;
}

/** Throws unless `committed` is a record with whole provenance — checked before the archive is read. */
export function assertProvenance(committed: unknown): asserts committed is PresetRecord {
  if (committed === undefined) {
    throw new Error(
      'demo:bake: a preset route needs its <id>.bake.json beside the GPX, with a "gpx" block of ' +
        '"licence", "source" and "confirmed" (ADR 0056 D-7.5)',
    );
  }
  const findings = provenanceFindings(committed);
  if (findings.length > 0) throw new Error(`demo:bake: the GPX's record: ${findings.join('; ')}`);
}

/**
 * What a bake of a preset route does with its committed record: refuses one
 * with no whole provenance; with `write`, returns the record with the bake's
 * digests in it; otherwise refuses a bake that moved from the digests the
 * record holds, naming which. `undefined`: nothing to write.
 */
export function settleRecord(
  committed: unknown,
  baked: BakeRecord,
  write: boolean,
): PresetRecord | undefined {
  assertProvenance(committed);
  if (write) return { gpx: committed.gpx, ...baked };
  if (committed.sha256 !== undefined) {
    const drift = recordDrift(committed as BakeRecord, baked);
    if (drift.length > 0) {
      throw new Error(
        `demo:bake: the bake does not match its committed record in ${drift.join(', ')}; ` +
          'if the archive, the GPX or the reader changed on purpose, bake again with --record',
      );
    }
  }
  return undefined;
}

/** The fields of a committed record a bake disagrees with; empty when it agrees. */
export function recordDrift(committed: BakeRecord, baked: BakeRecord): (keyof BakeRecord)[] {
  return (Object.keys(baked) as (keyof BakeRecord)[]).filter(
    (key) => committed[key] !== baked[key],
  );
}

/** A `pmtiles` source over a local file — an archive on disk, such as CI's synthetic fixture. */
export function fileSource(path: string): Source {
  return {
    getKey: () => path,
    getBytes: async (offset, length) => {
      const handle = await open(path, 'r');
      try {
        const buffer = new Uint8Array(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        return { data: buffer.slice(0, bytesRead).buffer };
      } finally {
        await handle.close();
      }
    },
  };
}

/** The archive an `--archive` value names, and the URL the manifest records for it. */
export function archiveOf(value: string): { archive: CorridorArchive; archiveUrl: string } {
  if (/^https:\/\//.test(value)) {
    return { archive: corridorArchiveFrom(archiveSource(value)), archiveUrl: value };
  }
  if (/^[a-z]+:/i.test(value)) throw new Error('demo:bake: --archive is an https: URL or a file');
  // A file's directory is the baker's own, so only its name is recorded.
  const path = resolve(value);
  return { archive: corridorArchiveFrom(fileSource(path)), archiveUrl: `file:${basename(path)}` };
}

export interface BakeArguments {
  readonly route: string;
  readonly gpx: string | undefined;
  readonly archive: string;
  readonly record: boolean;
  /** Write `--gpx`'s line, stripped, as the preset route's GPX, and bake nothing. */
  readonly strip: boolean;
}

/** `argv` after the script's own path. A bare `--` (pnpm's separator) is skipped. */
export function parseBakeArguments(argv: readonly string[]): BakeArguments {
  let route: string | undefined;
  let gpx: string | undefined;
  let archive = PUBLISHED_BASEMAP_URL;
  let record = false;
  let strip = false;
  for (let at = 0; at < argv.length; at += 1) {
    const flag = argv[at];
    const value = (): string => {
      const next = argv[at + 1];
      if (next === undefined || next.startsWith('--'))
        throw new Error(`demo:bake: ${String(flag)} needs a value`);
      at += 1;
      return next;
    };
    if (flag === '--') continue;
    else if (flag === '--route') route = value();
    else if (flag === '--gpx') gpx = value();
    else if (flag === '--archive') archive = value();
    else if (flag === '--record') record = true;
    else if (flag === '--strip') strip = true;
    else throw new Error(`demo:bake: unknown argument ${String(flag)}`);
  }
  if (route === undefined) throw new Error('demo:bake: --route <id> is required');
  if (!ROUTE_ID.test(route)) {
    throw new Error('demo:bake: a route id is lower-case letters, digits and hyphens');
  }
  return { route, gpx, archive, record, strip };
}

const WEB = fileURLToPath(new URL('../../', import.meta.url));

/** Where the committed GPX and record live, and where the bake writes. */
export const PRESET_ROUTES_DIRECTORY = join(WEB, 'demo', 'routes');
export const BAKED_ROUTES_DIRECTORY = join(WEB, 'demo', 'dist', 'routes');

async function main(): Promise<void> {
  const args = parseBakeArguments(process.argv.slice(2));
  const gpxPath = args.gpx ?? join(PRESET_ROUTES_DIRECTORY, `${args.route}.gpx`);
  const gpx = readFileSync(gpxPath, 'utf8');
  if (args.strip) {
    if (args.gpx === undefined) throw new Error('demo:bake: --strip needs --gpx <your file>');
    const out = join(PRESET_ROUTES_DIRECTORY, `${args.route}.gpx`);
    mkdirSync(PRESET_ROUTES_DIRECTORY, { recursive: true });
    writeFileSync(out, strippedGpx(routeLineOf(gpx).points));
    console.log(
      `demo:bake: wrote ${out}, its line and elevations only; trim its ends if a home is near either`,
    );
    return;
  }
  // A preset route — the committed GPX — is held to its committed record,
  // before a byte of the archive is read. A GPX named with `--gpx` (CI's
  // fixture, a trial line) has no record and makes none.
  const recordPath = join(PRESET_ROUTES_DIRECTORY, `${args.route}.bake.json`);
  let committed: unknown;
  if (args.gpx === undefined) {
    const personal = personalGpxFields(gpx);
    if (personal.length > 0) {
      throw new Error(
        `demo:bake: the committed GPX carries ${personal.join(', ')}; commit only its line, ` +
          'written by `demo:bake -- --route <id> --gpx <your file> --strip`',
      );
    }
    committed = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : undefined;
    assertProvenance(committed);
  } else if (args.record) {
    throw new Error('demo:bake: --record is for a preset route, so not with --gpx');
  }
  const { archive, archiveUrl } = archiveOf(args.archive);
  const baked = await bakeRoute({
    routeId: args.route,
    gpx,
    archive,
    archiveUrl,
    log: (line) => {
      console.log(line);
    },
  });
  if (args.gpx === undefined) {
    const next = settleRecord(committed, recordOf(baked.entry), args.record);
    if (next !== undefined) {
      writeFileSync(recordPath, `${JSON.stringify(next, null, 2)}\n`);
      console.log(`demo:bake: recorded ${recordPath}`);
    }
  }
  const file = writeBakedRoute(BAKED_ROUTES_DIRECTORY, baked);
  const { entry } = baked;
  console.log(
    `demo:bake: ${args.route}: ${file}, ${String(entry.bytes)} bytes ` +
      `(${String(entry.jsonBytes)} uncompressed), ${String(entry.tiles.covered)} of ` +
      `${String(entry.tiles.planned)} tiles, sha256 ${entry.sha256}`,
  );
}

if (process.argv[1]?.endsWith('bake-route.ts') === true) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
