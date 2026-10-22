// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A route's corridor of map features, read once from the configured basemap
 * archive — #1539, ADR 0054 D-2.
 *
 * ⚠️ **This file names no network primitive, and neither does anything else
 * under `game/`** (ADR 0054 D-1.1). The read is planned and decoded here; the
 * bytes arrive through a {@link CorridorArchive}, which the one module outside
 * `game/` that may ask for them — `world-data/corridor-source.ts` — implements
 * with its own single `fetch`. A test's archive is a fake that counts.
 *
 * What a read does, in order:
 *
 * 1. **Plans** the tiles: `corridorTileCover` (#1544) at z15, ±250 m, capped at
 *    {@link CORRIDOR_MAX_TILES}; less every tile that comes within a privacy
 *    zone's widened radius (ADR 0054 D-6.3), marked `privacy-zone` and never
 *    requested. A plan with nothing left to request makes **no request at
 *    all** — not even for the archive's header.
 * 2. **Opens** the archive: its header bounds (a tile outside them is
 *    `outside-archive` and never requested) and its identity.
 * 3. **Reads** at most {@link CORRIDOR_CONCURRENCY} tiles at a time, each
 *    aborted after {@link TILE_TIMEOUT_MS} and the whole after
 *    {@link READ_TIMEOUT_MS}, yielding to the idle callback between tiles.
 *    A tile that is refused (a `DecodeRefusal`, an HTTP error, an abort) is
 *    `refused`: its area is procedural and the rest stands.
 *
 * ⚠️ **Location data** (ADR 0054 D-6.6, ADR 0004 D): every failure is put
 * into words by {@link describeCorridorFailure} alone, which names what failed
 * and never a coordinate or a tile's `x`/`y`.
 */

import type { GeographicPosition } from '@onyourleft/domain';
import {
  corridorTileCover,
  decodeTile,
  describeRefusal,
  tileBounds,
  tileBox,
  type Box,
  type BuildingFeature,
  type CorridorFrame,
  type DecodeRefusal,
  type LandUseFeature,
  type PathFeature,
  type StreetFeature,
  type StreetGrade,
  type TileId,
} from '@onyourleft/map-features';
import type { PrivacyZoneRecord, WorldCorridorTileState } from '@onyourleft/store';

import { TRIM_JITTER_FRACTION } from '../../detail/privacy';
import type { CorridorOrigin } from '../terrain';

/**
 * How far either side of the route's line the corridor reaches: **250 m**,
 * #1538's P-3, inside ADR 0054 D-2.3's 300 m ceiling.
 */
export const CORRIDOR_HALF_WIDTH_METRES = 250;

/** The most tiles one route's corridor asks for: **600** (P-3). Past it, the world is procedural. */
export const CORRIDOR_MAX_TILES = 600;

/** Tiles in flight at once. */
export const CORRIDOR_CONCURRENCY = 4;

/** A tile that has not arrived in this long is aborted and `refused`. */
export const TILE_TIMEOUT_MS = 15_000;

/** The whole read is abandoned after this long. */
export const READ_TIMEOUT_MS = 120_000;

/**
 * Bumped when the decode, or the fields this keeps, change — so a record kept
 * by an older reader is read again rather than trusted (`records.ts`
 * §`WorldCorridorRecord.readerVersion`). **2** since #1565, which keeps the
 * streets a version-1 record never decoded.
 */
export const CORRIDOR_READER_VERSION = 2;

/** What the chooser says about the corridor, and what a ride starts from. */
export type CorridorState =
  | {
      readonly kind: 'off';
      readonly why: 'stylised-world' | 'map-tiles-off' | 'no-archive' | 'wrong-schema';
    }
  | { readonly kind: 'reading'; readonly done: number; readonly of: number }
  | { readonly kind: 'ready'; readonly corridor: WorldCorridor }
  | { readonly kind: 'unavailable'; readonly why: 'offline' | 'outside-coverage' | 'refused' };

/** One route's map features, in the corridor frame the world is drawn in. */
export interface WorldCorridor {
  readonly routeId: string;
  /** `terrain.ts`' — the route's first point. */
  readonly origin: CorridorOrigin;
  /** Whether map data was read at `(x, z)` in local metres. O(1) and allocation-free. */
  readonly covered: (x: number, z: number) => boolean;
  /**
   * Every covered tile's box in local metres, in route order — what
   * `land-class.ts` §`landClassMask` builds its chunks over (#1546). A z15
   * tile is an exact axis-aligned rectangle in this frame: `x` reads the
   * longitude alone and `z` the latitude alone.
   */
  readonly coveredBoxes: readonly Box[];
  readonly landUse: readonly LandUseFeature[];
  readonly buildings: readonly BuildingFeature[];
  readonly paths: readonly PathFeature[];
  /** #1565: the streets the cross streets are found from (`cross-streets.ts`). */
  readonly streets: readonly StreetFeature[];
}

/** One tile of a corridor, and why it holds what it holds. */
export interface CorridorTile {
  readonly x: number;
  readonly y: number;
  readonly state: WorldCorridorTileState;
}

/** The archive's bounds in degrees, from its header. */
export interface ArchiveBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/** What opening the archive found. */
export type ArchiveOpening =
  | {
      readonly kind: 'open';
      /** Its header etag, or a digest of the header when the host sends none. */
      readonly identity: string;
      readonly bounds: ArchiveBounds;
    }
  /** Its metadata does not declare the Protomaps basemap v4 schema: nothing is read. */
  | { readonly kind: 'wrong-schema' };

/**
 * The archive, as the read sees it — implemented by `world-data/corridor-source.ts`
 * and nowhere else in the product.
 *
 * Both methods **throw** for a network failure, an HTTP error, an abort or an
 * over-large decompression, with a {@link CorridorFailure} as the error's
 * `cause` where one is known.
 */
export interface CorridorArchive {
  open(signal: AbortSignal): Promise<ArchiveOpening>;
  /** The tile, decompressed, or `undefined` when the archive holds none. */
  tile(tile: TileId, signal: AbortSignal): Promise<Uint8Array | undefined>;
}

/** Why something in a read failed, without a location in it. */
export type CorridorFailure =
  | { readonly kind: 'refusal'; readonly refusal: DecodeRefusal }
  | { readonly kind: 'http'; readonly status: number }
  | { readonly kind: 'not-a-range' }
  | { readonly kind: 'changed' }
  | { readonly kind: 'too-large'; readonly limit: number }
  | { readonly kind: 'compression' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'network' }
  | { readonly kind: 'store'; readonly name: string };

/**
 * A failure in words, for a log line. ⚠️ **The one formatter** (ADR 0004 D):
 * it is handed no location and so can print none; `corridor.test.ts` walks
 * every variant for the fixture's coordinates and tile ids.
 */
export function describeCorridorFailure(failure: CorridorFailure): string {
  switch (failure.kind) {
    case 'refusal':
      return `Towns from map data: ${describeRefusal(failure.refusal)}`;
    case 'http':
      return `Towns from map data: the archive answered HTTP ${String(failure.status)} for a range.`;
    case 'not-a-range':
      return 'Towns from map data: the archive did not answer with the byte range asked for.';
    case 'changed':
      return 'Towns from map data: the archive changed during the read.';
    case 'too-large':
      return `Towns from map data: a part of the archive is larger than the limit of ${String(failure.limit)} bytes.`;
    case 'compression':
      return 'Towns from map data: a part of the archive uses a compression this does not read.';
    case 'timeout':
      return 'Towns from map data: a part of the archive did not arrive in time.';
    case 'aborted':
      return 'Towns from map data: the read was stopped.';
    case 'network':
      return 'Towns from map data: the archive could not be reached.';
    case 'store':
      return `Towns from map data: the corridor could not be kept (${failure.name}).`;
  }
}

/** The {@link CorridorFailure} an error carries, or `network` for one that carries none. */
export function failureOf(error: unknown): CorridorFailure {
  const cause = error instanceof Error ? (error.cause as CorridorFailure | undefined) : undefined;
  if (cause !== undefined && typeof cause === 'object' && 'kind' in cause) return cause;
  if (error instanceof Error && error.name === 'AbortError') return { kind: 'aborted' };
  return { kind: 'network' };
}

/** An `Error` carrying a {@link CorridorFailure} — what a {@link CorridorArchive} throws. */
export function corridorError(failure: CorridorFailure): Error {
  return new Error(describeCorridorFailure(failure), { cause: failure });
}

// --- The chooser's line ---------------------------------------------------

/** The one line the stage chooser shows. It names no place (#1539 behaviour 5). */
export function corridorStateText(state: CorridorState): string {
  switch (state.kind) {
    case 'ready':
      return 'Towns from map data: ready';
    case 'reading':
      return `Towns from map data: reading (${String(state.done)} of ${String(state.of)})`;
    case 'unavailable':
      return 'Towns from map data: not available for this route';
    case 'off':
      switch (state.why) {
        case 'map-tiles-off':
          return 'Towns from map data: off, because map tiles are off in Settings';
        case 'stylised-world':
          return 'Towns from map data: off, because the stylised world is chosen';
        case 'no-archive':
          return 'Towns from map data: off, because this build has no map archive';
        case 'wrong-schema':
          return 'Towns from map data: off, because this build’s map archive is not one this reads';
      }
  }
}

// --- Planning -------------------------------------------------------------

/** The corridor frame for a route: its first position, as `terrain.ts` §`corridorOrigin`. */
function frameOf(positions: readonly GeographicPosition[]): CorridorFrame | undefined {
  const first = positions[0];
  return first === undefined ? undefined : { latitude: first.latitude, longitude: first.longitude };
}

/**
 * How far from a zone's centre a tile is skipped: the zone's radius widened
 * by the trim's whole jitter (ADR 0004 B, `detail/privacy.ts`
 * §`TRIM_JITTER_FRACTION`), and by 1% more for the gap between this flat
 * measure and the great-circle one `privacy/boundaries.ts` checks it with.
 */
export function zoneReachMetres(zone: PrivacyZoneRecord): number {
  return zone.radius * (1 + TRIM_JITTER_FRACTION) * 1.01;
}

/**
 * Whether a tile comes within any zone's widened radius. Measured in a frame
 * centred on each zone, so the distance is exact to the projection's error
 * at the zone rather than at the route's start, which may be far away.
 */
export function tileTouchesZone(tile: TileId, zones: readonly PrivacyZoneRecord[]): boolean {
  for (const zone of zones) {
    const frame = { latitude: zone.centre.latitude, longitude: zone.centre.longitude };
    const box = tileBox(frame, tile);
    const dx = Math.max(box.minX, 0, -box.maxX);
    const dz = Math.max(box.minZ, 0, -box.maxZ);
    if (Math.hypot(dx, dz) < zoneReachMetres(zone)) return true;
  }
  return false;
}

/** The tiles a read would ask for, before the archive is opened. */
export interface CorridorPlan {
  readonly frame: CorridorFrame;
  /** Every tile in the cover, in route order, with the ones never to be requested marked. */
  readonly tiles: readonly CorridorTile[];
  /** The ones still to request: `privacy-zone` and `over-cap` are not among them. */
  readonly requestable: readonly TileId[];
}

/**
 * The tile plan for a route — no request is made here.
 *
 * The cover is asked for one tile past the cap, so a route whose corridor is
 * longer than {@link CORRIDOR_MAX_TILES} says so (`over-cap`) rather than
 * silently stopping. A privacy-zone tile counts against the cap: the cap is on
 * the corridor, and a zone does not lengthen it.
 */
export function planCorridor(
  positions: readonly GeographicPosition[],
  zones: readonly PrivacyZoneRecord[],
): CorridorPlan | undefined {
  const frame = frameOf(positions);
  if (frame === undefined) return undefined;
  const cover = corridorTileCover(positions, CORRIDOR_HALF_WIDTH_METRES, CORRIDOR_MAX_TILES + 1);
  const tiles: CorridorTile[] = [];
  const requestable: TileId[] = [];
  cover.forEach((tile, index) => {
    if (index >= CORRIDOR_MAX_TILES) {
      tiles.push({ x: tile.x, y: tile.y, state: 'over-cap' });
    } else if (tileTouchesZone(tile, zones)) {
      tiles.push({ x: tile.x, y: tile.y, state: 'privacy-zone' });
    } else {
      // Provisional: the read decides `covered`, `refused` or `outside-archive`.
      tiles.push({ x: tile.x, y: tile.y, state: 'covered' });
      requestable.push(tile);
    }
  });
  return { frame, tiles, requestable };
}

/** Whether any of a tile lies inside the archive's header bounds. */
export function insideBounds(tile: TileId, bounds: ArchiveBounds): boolean {
  const edges = tileBounds(tile);
  return (
    edges.east > bounds.west &&
    edges.west < bounds.east &&
    edges.north > bounds.south &&
    edges.south < bounds.north
  );
}

// --- Reading --------------------------------------------------------------

/** The features a read decoded, before they are packed. */
export interface CorridorFeatures {
  readonly landUse: readonly LandUseFeature[];
  readonly buildings: readonly BuildingFeature[];
  readonly paths: readonly PathFeature[];
  readonly streets: readonly StreetFeature[];
}

/** What {@link readCorridorTiles} came to. */
export type CorridorRead =
  | {
      readonly kind: 'read';
      readonly identity: string;
      readonly tiles: readonly CorridorTile[];
      readonly features: CorridorFeatures;
    }
  | { readonly kind: 'wrong-schema' }
  /** The archive could not be opened, or not one tile came back: nothing to keep. */
  | { readonly kind: 'offline' }
  | { readonly kind: 'aborted' };

export interface CorridorReadOptions {
  readonly plan: CorridorPlan;
  readonly archive: CorridorArchive;
  readonly signal: AbortSignal;
  readonly progress: (done: number, of: number) => void;
  /** Between tiles, so decoding never holds the main thread for long. */
  readonly yieldToIdle?: (() => Promise<void>) | undefined;
  /** Where failures are said, in {@link describeCorridorFailure}'s words only. */
  readonly log?: ((line: string) => void) | undefined;
  /** Checked before each request: `true` abandons the read (ADR 0054 D-2.4, never while recording). */
  readonly mustStop?: (() => boolean) | undefined;
  /** Test seams for the two timeouts. */
  readonly tileTimeoutMs?: number | undefined;
  readonly readTimeoutMs?: number | undefined;
}

/** A child signal that aborts with its parent or after `ms`. */
function linkedSignal(parent: AbortSignal, ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  if (parent.aborted) abort();
  parent.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, ms);
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      parent.removeEventListener('abort', abort);
    },
  };
}

/** The default yield: the next idle period, or the next task where there is no idle callback. */
export function idleYield(): Promise<void> {
  return new Promise((resolve) => {
    const idle = (
      globalThis as {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => void;
      }
    ).requestIdleCallback;
    if (idle === undefined) setTimeout(resolve, 0);
    else idle(() => resolve(), { timeout: 50 });
  });
}

/**
 * Reads a planned corridor through `archive`. Never throws for anything the
 * archive does: each tile's outcome is in its state.
 */
export async function readCorridorTiles(options: CorridorReadOptions): Promise<CorridorRead> {
  const { plan, archive } = options;
  const log = options.log ?? ((): void => undefined);
  const yieldToIdle = options.yieldToIdle ?? idleYield;
  const whole = linkedSignal(options.signal, options.readTimeoutMs ?? READ_TIMEOUT_MS);
  try {
    if (plan.requestable.length === 0) return { kind: 'offline' };
    if (options.mustStop?.() === true) return { kind: 'aborted' };
    let opening: ArchiveOpening;
    try {
      opening = await archive.open(whole.signal);
    } catch (error) {
      log(describeCorridorFailure(failureOf(error)));
      return whole.signal.aborted ? { kind: 'aborted' } : { kind: 'offline' };
    }
    if (opening.kind === 'wrong-schema') return { kind: 'wrong-schema' };

    const states = new Map<number, WorldCorridorTileState>();
    const key = (tile: { x: number; y: number }): number => tile.y * 2 ** 15 + tile.x;
    const queue: TileId[] = [];
    for (const tile of plan.requestable) {
      if (insideBounds(tile, opening.bounds)) queue.push(tile);
      else states.set(key(tile), 'outside-archive');
    }
    const landUse: LandUseFeature[] = [];
    const buildings: BuildingFeature[] = [];
    const paths: PathFeature[] = [];
    const streets: StreetFeature[] = [];
    let done = 0;
    let arrived = 0;
    const of = queue.length;
    options.progress(done, of);

    const one = async (tile: TileId): Promise<void> => {
      const own = linkedSignal(whole.signal, options.tileTimeoutMs ?? TILE_TIMEOUT_MS);
      try {
        const bytes = await archive.tile(tile, own.signal);
        arrived += 1;
        if (bytes === undefined) {
          states.set(key(tile), 'outside-archive');
          return;
        }
        await yieldToIdle();
        const decoded = decodeTile(bytes, tile, plan.frame);
        if ('reason' in decoded) {
          states.set(key(tile), 'refused');
          log(describeCorridorFailure({ kind: 'refusal', refusal: decoded }));
          return;
        }
        states.set(key(tile), 'covered');
        for (const feature of decoded.landUse) landUse.push(feature);
        for (const feature of decoded.buildings) buildings.push(feature);
        for (const feature of decoded.paths) paths.push(feature);
        for (const feature of decoded.streets) streets.push(feature);
      } catch (error) {
        states.set(key(tile), 'refused');
        const failure =
          own.signal.aborted && !whole.signal.aborted
            ? { kind: 'timeout' as const }
            : failureOf(error);
        log(describeCorridorFailure(failure));
      } finally {
        own.done();
        done += 1;
        if (!whole.signal.aborted) options.progress(done, of);
      }
    };

    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < queue.length) {
        if (whole.signal.aborted || options.mustStop?.() === true) return;
        const tile = queue[next] as TileId;
        next += 1;
        await one(tile);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CORRIDOR_CONCURRENCY, of) }, worker));
    if (whole.signal.aborted || options.mustStop?.() === true) return { kind: 'aborted' };
    // Not one tile arrived, and some were asked for: the network is not there,
    // and an all-refused corridor is not worth keeping over a later read.
    if (of > 0 && arrived === 0) return { kind: 'offline' };

    const tiles = plan.tiles.map((tile) => {
      const state = states.get(key(tile));
      return state === undefined ? tile : { x: tile.x, y: tile.y, state };
    });
    return {
      kind: 'read',
      identity: opening.identity,
      tiles,
      features: { landUse, buildings, paths, streets },
    };
  } finally {
    whole.done();
  }
}

// --- Packing: the store's `features` blob ---------------------------------

/** Centimetres: far finer than a drawn edge, and half the bytes of float32 text. */
const PACK_SCALE = 100;

interface PackedFeatures {
  /** 2 since #1565, which added {@link streets}. */
  readonly v: 2;
  readonly landUse: readonly { layer: 'landuse' | 'water'; kind: string; rings: number[][] }[];
  readonly buildings: readonly {
    kind: 'building' | 'building_part';
    h: number | null;
    mh: number | null;
    rings: number[][];
  }[];
  readonly paths: readonly { kind: string; detail: string; line: number[] }[];
  /** `g` is the street's grade (#1565); a record without one is read as at grade. */
  readonly streets: readonly { kind: string; detail: string; g?: StreetGrade; line: number[] }[];
}

const toInts = (values: Float32Array): number[] =>
  Array.from(values, (value) => Math.round(value * PACK_SCALE));
const fromInts = (values: readonly number[]): Float32Array =>
  Float32Array.from(values, (value) => value / PACK_SCALE);

/**
 * Every byte a stream yields, in one array. Read here rather than through a
 * fetch-API body, so this module names no HTTP type
 * (`camera/analysis-boundary.test.ts`): it is not a transport.
 */
export async function streamBytes(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/** The features as the store keeps them: gzip over JSON, coordinates in centimetres. */
export async function packCorridorFeatures(features: CorridorFeatures): Promise<Blob> {
  const packed: PackedFeatures = {
    v: 2,
    landUse: features.landUse.map((f) => ({
      layer: f.layer,
      kind: f.kind,
      rings: f.rings.map(toInts),
    })),
    buildings: features.buildings.map((f) => ({
      kind: f.kind,
      h: f.heightMetres,
      mh: f.minHeightMetres,
      rings: f.rings.map(toInts),
    })),
    paths: features.paths.map((f) => ({
      kind: f.kind,
      detail: f.kindDetail,
      line: toInts(f.line),
    })),
    streets: features.streets.map((f) => ({
      kind: f.kind,
      detail: f.kindDetail,
      g: f.grade,
      line: toInts(f.line),
    })),
  };
  const json = new Blob([JSON.stringify(packed)]);
  const gzipped = json.stream().pipeThrough(new CompressionStream('gzip'));
  return new Blob([await streamBytes(gzipped)], { type: 'application/gzip' });
}

/** Reads back what {@link packCorridorFeatures} packed. Throws for a blob it did not write. */
export async function unpackCorridorFeatures(blob: Blob): Promise<CorridorFeatures> {
  const json = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  const packed = JSON.parse(new TextDecoder().decode(await streamBytes(json))) as PackedFeatures;
  if (packed.v !== 2) throw new Error('worldCorridors.features: not a version this reads');
  return {
    landUse: packed.landUse.map((f) => ({
      layer: f.layer,
      kind: f.kind,
      rings: f.rings.map(fromInts),
    })),
    buildings: packed.buildings.map((f) => ({
      kind: f.kind,
      heightMetres: f.h,
      minHeightMetres: f.mh,
      rings: f.rings.map(fromInts),
    })),
    paths: packed.paths.map((f) => ({
      kind: f.kind,
      kindDetail: f.detail,
      line: fromInts(f.line),
    })),
    streets: packed.streets.map((f) => ({
      kind: f.kind,
      kindDetail: f.detail,
      grade: f.g === 'bridge' || f.g === 'tunnel' ? f.g : 'ground',
      line: fromInts(f.line),
    })),
  };
}

// --- The corridor a ride is handed ----------------------------------------

const METRES_PER_DEGREE_LATITUDE = 111_320;
const TILES = 2 ** 15;

/**
 * Whether map data was read at a point: the point's z15 tile, looked up in a
 * set of numeric keys. No allocation per call — a `Set<number>` lookup boxes
 * nothing — and O(1).
 */
export function coveredLookup(
  origin: CorridorFrame,
  tiles: readonly CorridorTile[],
): (x: number, z: number) => boolean {
  const covered = new Set<number>();
  for (const tile of tiles) if (tile.state === 'covered') covered.add(tile.y * TILES + tile.x);
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((origin.latitude * Math.PI) / 180);
  return (x, z) => {
    // The inverse of `projection.ts` §`localMetres`: x is metres WEST.
    const longitude = origin.longitude - x / metresPerDegreeLongitude;
    const latitude = origin.latitude + z / METRES_PER_DEGREE_LATITUDE;
    const column = Math.floor(((longitude + 180) / 360) * TILES);
    const radians = (latitude * Math.PI) / 180;
    const row = Math.floor(((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * TILES);
    return covered.has(row * TILES + column);
  };
}

/** The corridor a ride is handed, from what was read or kept. */
export function worldCorridorOf(
  routeId: string,
  origin: CorridorOrigin,
  tiles: readonly CorridorTile[],
  features: CorridorFeatures,
): WorldCorridor {
  return {
    routeId,
    origin,
    covered: coveredLookup(origin, tiles),
    coveredBoxes: tiles
      .filter((tile) => tile.state === 'covered')
      .map((tile) => tileBox(origin, { z: 15, x: tile.x, y: tile.y })),
    landUse: features.landUse,
    buildings: features.buildings,
    paths: features.paths,
    streets: features.streets,
  };
}
