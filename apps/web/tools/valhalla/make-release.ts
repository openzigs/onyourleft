// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Turns one Valhalla build into the immutable release directory that
 * `valhalla-browser` reads (#2320): `build-graph.sh` runs it after the
 * container has written `graph.tar` and `native-config.json`.
 *
 * ```sh
 * node --import ./tools/ts-extensionless-resolve.mjs tools/valhalla/make-release.ts \
 *   --work <dir> --out <dir> --pbf <extract> --image <digest> --valhalla-version 3.8.3
 * ```
 *
 * What it writes, under `<out>/<release>/`, is what the SDK's manifest schema
 * 1 asks for and nothing about where the graph is:
 *
 * - `graph.tar`, Valhalla's own archive with `index.bin` first, unchanged;
 * - `tiles/<level>/…/<n>.gph`, the same tiles cut out of the archive, for the
 *   `individual-tiles` transport spike 0035 recommends (the only one the
 *   browser's HTTP cache reused);
 * - `config.json`, the runtime configuration: **`loki.use_connectivity` is
 *   `false`** (with the default every remote route failed with error 170) and
 *   every local path is emptied;
 * - `manifest.json`, with each object's SHA-256 and the strong ETag R2 gives a
 *   single-part upload (its MD5, quoted). `upload.sh` checks that ETag on the
 *   public URL before it uploads the manifest, so a wrong guess stops there;
 * - `NOTICE.txt`, the ODbL notice: the graph is a Derivative Database of
 *   OpenStreetMap and `graph.tar` is all of it (`docs/odbl.md`).
 *
 * ⚠️ **Nothing in the release names the extract.** The state is the
 * maintainer's to choose and is never written in public (#2320): the
 * extract's file name and hash go only into `<out>/<release>.build.json`,
 * beside the release and never uploaded. The coverage box is derived from the
 * tiles, so nobody types a coordinate.
 *
 * Imports only `src/map/basemap.ts`'s constants and Node, so `node` runs it
 * with types stripped.
 */

import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';

import { ODBL_LICENCE_URL, ODBL_NOTICE, OSM_ATTRIBUTION } from '../../src/map/basemap';

/** The SDK's manifest schema (`valhalla-browser` 0.2.1, `DatasetManifest`). */
export const MANIFEST_SCHEMA = 1;

/** The one profile the measurement routes with. The tiles carry the others; the manifest offers only this. */
export const COSTINGS = ['bicycle'] as const;

/** The release directory's files, by name. */
export const MANIFEST_FILE = 'manifest.json';
export const CONFIG_FILE = 'config.json';
export const ARCHIVE_FILE = 'graph.tar';
export const NOTICE_FILE = 'NOTICE.txt';
export const TILES_DIRECTORY = 'tiles';

/** The SDK refuses a manifest or a configuration over 4 MiB (`METADATA_LIMIT` upstream). */
export const METADATA_LIMIT_BYTES = 4 * 1024 * 1024;

/** The largest decoded-tile budget the SDK accepts, and the one the measurement uses. */
export const TILE_BUDGET_BYTES = 128 * 1024 * 1024;

/** Valhalla's tile size per hierarchy level, in degrees: 0 is highways, 1 arterials, 2 local roads. */
const LEVEL_TILE_DEGREES: Readonly<Record<number, number>> = { 0: 4, 1: 1, 2: 0.25 };

const TILE_PATH = /^[012]\/(?:\d{3}\/)*\d{3}\.gph$/;
const INDEX_ENTRY_BYTES = 16;
const BLOCK = 512;

/** One tile, as the archive holds it. Offsets and sizes are bytes into `graph.tar`. */
export interface GraphTile {
  readonly id: number;
  readonly path: string;
  readonly offset: number;
  readonly size: number;
  readonly sha256: string;
  readonly md5: string;
}

/** What `readGraphArchive` learns from `graph.tar`. */
export interface GraphArchive {
  readonly size: number;
  readonly index: Buffer;
  readonly headerSha256: string;
  readonly sha256: string;
  readonly md5: string;
  readonly tiles: readonly GraphTile[];
}

interface TarMember {
  readonly name: string;
  readonly offset: number;
  readonly size: number;
}

function readExactly(fd: number, length: number, position: number): Buffer {
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const got = readSync(fd, buffer, read, length - read, position + read);
    if (got === 0) throw new Error('graph.tar ends inside a member');
    read += got;
  }
  return buffer;
}

function cString(buffer: Buffer, from: number, length: number): string {
  const field = buffer.subarray(from, from + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString('utf8');
}

function octal(buffer: Buffer, from: number, length: number): number {
  const text = cString(buffer, from, length).trim();
  if (!/^[0-7]+$/.test(text)) throw new Error('graph.tar has a header field that is not octal');
  return Number.parseInt(text, 8);
}

function checksumMatches(header: Buffer): boolean {
  let sum = 0;
  for (let at = 0; at < BLOCK; at += 1) sum += at >= 148 && at < 156 ? 0x20 : (header[at] ?? 0);
  return sum === octal(header, 148, 8);
}

/** The `path` and `size` records of a PAX extended header, which apply to the member after it. */
function paxRecords(data: Buffer): Map<string, string> {
  const records = new Map<string, string>();
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    if (space === -1) break;
    const length = Number.parseInt(data.subarray(at, space).toString('ascii'), 10);
    if (!Number.isInteger(length) || length <= 0)
      throw new Error('graph.tar has a malformed PAX header');
    const record = data.subarray(space + 1, at + length - 1).toString('utf8');
    const equals = record.indexOf('=');
    if (equals > 0) records.set(record.slice(0, equals), record.slice(equals + 1));
    at += length;
  }
  return records;
}

/** Every regular file in a ustar/PAX archive, with the byte offset of its data. Anything else is refused. */
function tarMembers(fd: number, fileSize: number): TarMember[] {
  const members: TarMember[] = [];
  let position = 0;
  let pax = new Map<string, string>();
  while (position + BLOCK <= fileSize) {
    const header = readExactly(fd, BLOCK, position);
    if (header.every((byte) => byte === 0)) break;
    if (!checksumMatches(header)) throw new Error('graph.tar has a header whose checksum is wrong');
    const type = String.fromCharCode(header[156] ?? 0);
    const size = octal(header, 124, 12);
    const dataOffset = position + BLOCK;
    if (type === 'x') {
      pax = paxRecords(readExactly(fd, size, dataOffset));
    } else if (type === '0' || type === '\0') {
      const prefix = cString(header, 257, 6) === 'ustar' ? cString(header, 345, 155) : '';
      const short = cString(header, 0, 100);
      const name = pax.get('path') ?? (prefix === '' ? short : `${prefix}/${short}`);
      const memberSize = pax.has('size') ? Number(pax.get('size')) : size;
      members.push({ name, offset: dataOffset, size: memberSize });
      pax = new Map();
    } else if (type !== 'g') {
      throw new Error(
        `graph.tar holds a member of type '${type}'; only regular files are expected`,
      );
    }
    const dataSize = type === '0' || type === '\0' ? (members.at(-1)?.size ?? size) : size;
    position = dataOffset + Math.ceil(dataSize / BLOCK) * BLOCK;
  }
  return members;
}

function hashRange(
  fd: number,
  offset: number,
  size: number,
): { sha256: string; md5: string; head: Buffer } {
  const sha256 = createHash('sha256');
  const md5 = createHash('md5');
  const chunk = 1024 * 1024;
  let head: Buffer = Buffer.alloc(0);
  for (let done = 0; done < size; done += chunk) {
    const part = readExactly(fd, Math.min(chunk, size - done), offset + done);
    if (done === 0) head = part.subarray(0, 8);
    sha256.update(part);
    md5.update(part);
  }
  return { sha256: sha256.digest('hex'), md5: md5.digest('hex'), head };
}

/** A tile's id from its path: the digits after the level, times eight, plus the level. */
export function tileIdFromPath(path: string): number {
  const parts = path.slice(0, -'.gph'.length).split('/');
  const level = Number(parts[0]);
  return Number(parts.slice(1).join('')) * 8 + level;
}

/**
 * Reads `graph.tar` and cross-checks it the way the SDK will: `index.bin`
 * first at byte 512, one index entry per tile, each entry's offset and size
 * those of its member, and each tile's own header carrying the id its path
 * says. Throws on the first disagreement.
 */
export function readGraphArchive(path: string): GraphArchive {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const members = tarMembers(fd, size);
    const first = members[0];
    if (first?.name !== 'index.bin' || first.offset !== BLOCK) {
      throw new Error(
        'graph.tar does not begin with index.bin; build it with valhalla_build_extract',
      );
    }
    if (first.size === 0 || first.size % INDEX_ENTRY_BYTES !== 0) {
      throw new Error('graph.tar has an index.bin whose size is not a whole number of entries');
    }
    const index = readExactly(fd, first.size, first.offset);
    const byOffset = new Map<number, TarMember>();
    for (const member of members.slice(1)) {
      if (!TILE_PATH.test(member.name))
        throw new Error(`graph.tar holds a file that is not a tile: ${member.name}`);
      byOffset.set(member.offset, member);
    }
    const tiles: GraphTile[] = [];
    const seen = new Set<number>();
    for (let at = 0; at < index.length; at += INDEX_ENTRY_BYTES) {
      const offset = Number(index.readBigUInt64LE(at));
      const id = index.readUInt32LE(at + 8);
      const tileSize = index.readUInt32LE(at + 12);
      const member = byOffset.get(offset);
      if (member === undefined || member.size !== tileSize || seen.has(id) || (id & 7) > 2) {
        throw new Error('graph.tar has an index.bin that does not match its tiles');
      }
      if (tileIdFromPath(member.name) !== id)
        throw new Error(`graph.tar has a tile at the wrong path: ${member.name}`);
      const { sha256, md5, head } = hashRange(fd, member.offset, member.size);
      // The tile header's first 46 bits are its GraphId, the same one the index gives.
      if (head.length < 8 || Number(head.readBigUInt64LE(0) & ((1n << 46n) - 1n)) !== id) {
        throw new Error(`graph.tar has a tile whose header names another tile: ${member.name}`);
      }
      seen.add(id);
      tiles.push({ id, path: member.name, offset: member.offset, size: member.size, sha256, md5 });
    }
    if (tiles.length === 0 || tiles.length !== byOffset.size) {
      throw new Error('graph.tar has an index.bin that does not cover every tile exactly once');
    }
    const whole = hashRange(fd, 0, size);
    return {
      size,
      index,
      headerSha256: createHash('sha256')
        .update(readExactly(fd, BLOCK, 0))
        .digest('hex'),
      sha256: whole.sha256,
      md5: whole.md5,
      tiles,
    };
  } finally {
    closeSync(fd);
  }
}

/**
 * The box the graph covers, `[west, south, east, north]`: the union of the
 * tiles at the finest level the graph has. Local-road tiles (0.25°) are where
 * an end point can snap, and a highway tile is 4° across, which would declare
 * coverage far outside the extract.
 */
export function coverageOf(tileIds: readonly number[]): [number, number, number, number] {
  const finest = Math.max(...tileIds.map((id) => id & 7));
  const degrees = LEVEL_TILE_DEGREES[finest];
  if (degrees === undefined) throw new Error('coverageOf: no tile at levels 0 to 2');
  const columns = 360 / degrees;
  let [west, south, east, north] = [180, 90, -180, -90];
  for (const id of tileIds) {
    if ((id & 7) !== finest) continue;
    const index = id >>> 3;
    const minLon = -180 + (index % columns) * degrees;
    const minLat = -90 + Math.floor(index / columns) * degrees;
    west = Math.min(west, minLon);
    south = Math.min(south, minLat);
    east = Math.max(east, minLon + degrees);
    north = Math.max(north, minLat + degrees);
  }
  return [west, south, east, north];
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The configuration the SDK is served, from the one the tiles were built
 * with: every local path emptied, `tile_extract` and `traffic_extract`
 * removed (the SDK fetches tiles itself), the cache settings upstream's own
 * builder uses, and `loki.use_connectivity` off.
 */
export function runtimeConfig(native: unknown): JsonObject {
  if (!isObject(native) || !isObject(native['mjolnir']) || !isObject(native['loki'])) {
    throw new Error('native-config.json has no mjolnir or loki section');
  }
  const config = structuredClone(native);
  const mjolnir = config['mjolnir'] as JsonObject;
  delete mjolnir['tile_extract'];
  delete mjolnir['traffic_extract'];
  Object.assign(mjolnir, {
    tile_dir: '',
    tile_url: '',
    admin: '',
    timezone: '',
    max_cache_size: 32 * 1024 * 1024,
    use_lru_mem_cache: true,
    lru_mem_cache_hard_control: true,
    global_synchronized_cache: false,
  });
  Object.assign(config['loki'] as JsonObject, { use_connectivity: false });
  return config;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}

/** Canonical JSON: sorted keys, two-space indent, a final newline. */
export function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(sortKeys(value), null, 2)}\n`);
}

function sha256Of(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function md5Of(bytes: Buffer): string {
  return createHash('md5').update(bytes).digest('hex');
}

/** The ETag R2 returns for an object put in one part: its MD5, quoted. */
export function singlePartEtag(md5: string): string {
  return `"${md5}"`;
}

const PREFIX = /^[a-z0-9][a-z0-9-]{0,31}$/;
const DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** `YYYY-MM-DD` from a Geofabrik dated extract's name (`<area>-YYMMDD.osm.pbf`), or `undefined`. */
export function extractDateFromName(name: string): string | undefined {
  const match = /-(\d{2})(\d{2})(\d{2})\.osm\.pbf$/.exec(name);
  if (match === null) return undefined;
  const date = `20${match[1]}-${match[2]}-${match[3]}`;
  return DATE.test(date) ? date : undefined;
}

/** Inputs to one release. */
export interface ReleaseInputs {
  readonly archive: GraphArchive;
  readonly nativeConfig: unknown;
  readonly valhallaRevision: string;
  readonly valhallaVersion: string;
  readonly prefix: string;
  readonly extractDate: string | undefined;
}

/** A release, before it is written. */
export interface Release {
  readonly id: string;
  readonly manifest: JsonObject;
  readonly config: Buffer;
  readonly notice: string;
}

/**
 * The release's id, manifest and configuration. The id is the prefix, the
 * extract's date and a hash of what the graph is, so the same build gets the
 * same directory and a different one never reuses a name.
 */
export function planRelease(inputs: ReleaseInputs): Release {
  if (!PREFIX.test(inputs.prefix)) {
    throw new Error('--prefix must be 1 to 32 lower-case letters, digits or hyphens');
  }
  if (inputs.extractDate !== undefined && !DATE.test(inputs.extractDate)) {
    throw new Error('--extract-date must be YYYY-MM-DD');
  }
  const config = jsonBytes(runtimeConfig(inputs.nativeConfig));
  if (config.length > METADATA_LIMIT_BYTES)
    throw new Error('config.json is over the SDK’s 4 MiB limit');
  const coverage = coverageOf(inputs.archive.tiles.map((tile) => tile.id));
  const identity = {
    archiveSha256: inputs.archive.sha256,
    configSha256: sha256Of(config),
    costings: COSTINGS,
    coverage,
    valhallaRevision: inputs.valhallaRevision,
  };
  const date = inputs.extractDate?.replaceAll('-', '');
  const id = [inputs.prefix, date, sha256Of(jsonBytes(identity)).slice(0, 12)]
    .filter((part) => part !== undefined)
    .join('-');
  const manifest: JsonObject = {
    schema: MANIFEST_SCHEMA,
    release: id,
    valhallaRevision: inputs.valhallaRevision,
    valhallaVersion: inputs.valhallaVersion,
    costings: COSTINGS,
    coverage,
    source: {
      kind: 'openstreetmap',
      attribution: OSM_ATTRIBUTION,
      licence: 'ODbL-1.0',
      licenceUrl: ODBL_LICENCE_URL,
      notice: ODBL_NOTICE,
      ...(inputs.extractDate === undefined ? {} : { extractDate: inputs.extractDate }),
    },
    config: { url: CONFIG_FILE, sha256: sha256Of(config) },
    archive: {
      url: ARCHIVE_FILE,
      size: String(inputs.archive.size),
      indexSize: String(inputs.archive.index.length),
      etag: singlePartEtag(inputs.archive.md5),
      headerSha256: inputs.archive.headerSha256,
      indexSha256: sha256Of(inputs.archive.index),
    },
    tiles: Object.fromEntries(
      inputs.archive.tiles.map((tile) => [
        String(tile.id),
        {
          path: tile.path,
          offset: String(tile.offset),
          size: String(tile.size),
          sha256: tile.sha256,
          etag: singlePartEtag(tile.md5),
        },
      ]),
    ),
  };
  if (jsonBytes(manifest).length > METADATA_LIMIT_BYTES) {
    throw new Error('manifest.json is over the SDK’s 4 MiB limit: build a smaller extract');
  }
  return {
    id,
    manifest,
    config,
    notice: odblNotice(id, inputs.valhallaVersion, inputs.extractDate),
  };
}

/** `NOTICE.txt`: ODbL §4.2 (the licence's URI), §4.3 (the notice) and §4.6 a (where the whole database is). */
export function odblNotice(
  release: string,
  valhallaVersion: string,
  extractDate: string | undefined,
): string {
  const from =
    extractDate === undefined
      ? 'an OpenStreetMap extract'
      : `an OpenStreetMap extract dated ${extractDate}`;
  return [
    `On Your Left: routing graph ${release}`,
    '',
    ODBL_NOTICE,
    '',
    `  OpenStreetMap:          https://www.openstreetmap.org/copyright`,
    `  Open Database License:  ${ODBL_LICENCE_URL}`,
    '',
    `${OSM_ATTRIBUTION}.`,
    '',
    `This directory is a Valhalla ${valhallaVersion} routing graph built from ${from}.`,
    'It is a database derived from OpenStreetMap, made available under the Open',
    'Database License 1.0 (ODbL-1.0). graph.tar is the entire derived database',
    '(ODbL section 4.6 a); tiles/ holds the same tiles, one file each, and you may',
    'copy either from here.',
    '',
    'It was built by apps/web/tools/valhalla/build-graph.sh in the On Your Left',
    'source. The program is AGPL-3.0-or-later; the ODbL governs the data only.',
    '',
  ].join('\n');
}

/** Options for `writeRelease`. */
export interface WriteOptions {
  readonly archivePath: string;
  readonly out: string;
  /** Written only to the local build record, never into the release. */
  readonly record: Readonly<Record<string, unknown>>;
}

/**
 * Writes `release` to `<out>/<id>/`, through a staging directory renamed into
 * place, so a failed run leaves nothing a later upload could take for a
 * release. Refuses a directory that already exists: a release is immutable.
 */
export function writeRelease(
  release: Release,
  archive: GraphArchive,
  options: WriteOptions,
): string {
  const destination = join(options.out, release.id);
  if (existsSync(destination))
    throw new Error(`release ${release.id} already exists in ${options.out}`);
  mkdirSync(options.out, { recursive: true });
  const staging = join(options.out, `.staging-${release.id}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging);
  try {
    const archiveBytes = readFileSync(options.archivePath);
    if (md5Of(archiveBytes) !== archive.md5)
      throw new Error('graph.tar changed while the release was being made');
    writeFileSync(join(staging, ARCHIVE_FILE), archiveBytes);
    for (const tile of archive.tiles) {
      const target = join(staging, TILES_DIRECTORY, tile.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, archiveBytes.subarray(tile.offset, tile.offset + tile.size));
    }
    writeFileSync(join(staging, CONFIG_FILE), release.config);
    writeFileSync(join(staging, NOTICE_FILE), release.notice);
    writeFileSync(join(staging, MANIFEST_FILE), jsonBytes(release.manifest));
    renameSync(staging, destination);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  const largest = Math.max(...archive.tiles.map((tile) => tile.size));
  writeFileSync(
    join(options.out, `${release.id}.build.json`),
    jsonBytes({
      ...options.record,
      release: release.id,
      archiveBytes: archive.size,
      tiles: archive.tiles.length,
      largestTileBytes: largest,
      coverage: release.manifest['coverage'],
    }),
  );
  return destination;
}

/** The Valhalla release and revision compiled into the installed SDK's WebAssembly. */
export function sdkRuntime(runtimeJson: unknown): {
  revision: string;
  release: string;
  sdk: string;
} {
  const versions = isObject(runtimeJson) ? runtimeJson['versions'] : undefined;
  const sdk = isObject(runtimeJson) ? runtimeJson['sdk'] : undefined;
  if (
    !isObject(versions) ||
    typeof versions['valhalla'] !== 'string' ||
    typeof versions['valhallaRelease'] !== 'string' ||
    typeof sdk !== 'string'
  ) {
    throw new Error('valhalla-browser/runtime.json does not name its Valhalla revision');
  }
  return { revision: versions['valhalla'], release: versions['valhallaRelease'], sdk };
}

/** Options for `makeRelease`, the whole step. */
export interface MakeReleaseOptions {
  readonly work: string;
  readonly out: string;
  readonly pbf: string;
  readonly image: string;
  readonly valhallaVersion: string;
  readonly runtimeJson: unknown;
  readonly prefix: string;
  readonly extractDate: string | undefined;
}

/**
 * Reads `<work>/graph.tar` and `<work>/native-config.json` and writes the
 * release. Refuses tiles built by another Valhalla than the SDK's WASM, which
 * the SDK would refuse at run time as `INCOMPATIBLE_DATASET`.
 */
export function makeRelease(options: MakeReleaseOptions): {
  id: string;
  path: string;
  largestTileBytes: number;
} {
  const runtime = sdkRuntime(options.runtimeJson);
  if (options.valhallaVersion.trim() !== runtime.release) {
    throw new Error(
      `the tiles were built by Valhalla ${options.valhallaVersion.trim()}, and ${runtime.sdk} runs ${runtime.release}`,
    );
  }
  const archivePath = join(options.work, ARCHIVE_FILE);
  const archive = readGraphArchive(archivePath);
  const nativeConfig: unknown = JSON.parse(
    readFileSync(join(options.work, 'native-config.json'), 'utf8'),
  );
  const extractDate = options.extractDate ?? extractDateFromName(basename(options.pbf));
  const release = planRelease({
    archive,
    nativeConfig,
    valhallaRevision: runtime.revision,
    valhallaVersion: runtime.release,
    prefix: options.prefix,
    extractDate,
  });
  const path = writeRelease(release, archive, {
    archivePath,
    out: options.out,
    record: {
      builtAt: new Date().toISOString(),
      extract: options.pbf,
      extractSha256: sha256Of(readFileSync(options.pbf)),
      image: options.image,
      sdk: runtime.sdk,
      valhallaVersion: runtime.release,
    },
  });
  return {
    id: release.id,
    path,
    largestTileBytes: Math.max(...archive.tiles.map((tile) => tile.size)),
  };
}

/** `--flag value` pairs into a map; a flag twice, or one with no value, is an error. */
export function parseArguments(argv: readonly string[]): Map<string, string> {
  const known = new Set([
    '--work',
    '--out',
    '--pbf',
    '--image',
    '--valhalla-version',
    '--prefix',
    '--extract-date',
  ]);
  const values = new Map<string, string>();
  for (let at = 0; at < argv.length; at += 2) {
    const flag = argv[at] ?? '';
    const value = argv[at + 1];
    if (!known.has(flag)) throw new Error(`make-release: unknown argument ${flag}`);
    if (value === undefined || value.startsWith('--'))
      throw new Error(`make-release: ${flag} needs a value`);
    if (values.has(flag)) throw new Error(`make-release: ${flag} given twice`);
    values.set(flag, value);
  }
  for (const required of ['--work', '--out', '--pbf', '--image', '--valhalla-version']) {
    if (!values.has(required)) throw new Error(`make-release: ${required} is required`);
  }
  return values;
}

function main(): void {
  const values = parseArguments(process.argv.slice(2));
  const require = createRequire(import.meta.url);
  const runtimeJson: unknown = JSON.parse(
    readFileSync(require.resolve('valhalla-browser/runtime.json'), 'utf8'),
  );
  const made = makeRelease({
    work: values.get('--work') ?? '',
    out: values.get('--out') ?? '',
    pbf: values.get('--pbf') ?? '',
    image: values.get('--image') ?? '',
    valhallaVersion: values.get('--valhalla-version') ?? '',
    runtimeJson,
    prefix: values.get('--prefix') ?? 'oyl-bicycle',
    extractDate: values.get('--extract-date'),
  });
  console.log(`make-release: wrote ${made.id} to ${made.path}`);
  if (made.largestTileBytes > TILE_BUDGET_BYTES) {
    console.warn(
      `make-release: the largest tile is ${made.largestTileBytes} bytes, over the SDK's 128 MiB decoded-tile budget; routes through it cannot be cached`,
    );
  }
}

if (process.argv[1]?.endsWith('make-release.ts') === true) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
