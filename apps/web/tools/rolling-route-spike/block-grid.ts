// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2882's spike: reading the map on a FIXED grid of blocks while riding.
 * Throwaway (see `rolling-profile.ts`).
 *
 * A block is `size × size` z15 tiles whose corner tile's column and row are
 * multiples of `size`, so a block's identity depends on the grid and never on
 * where the rider is (the epic's Q2 ruling: coarse fixed blocks, never centred
 * on a place). A ride asks for every block that comes within `reach` metres of
 * the rider, once; a block already asked for is never asked for again
 * (the ridden-tile cache of the epic's Q6).
 *
 * {@link streamRide} is the measurement: it rides a path at a speed, asks for
 * blocks `lead` metres before they are needed, makes each block ready a given
 * number of milliseconds after it is asked for, and counts the tiles read and
 * every block that was needed before it was ready.
 */

const TILES = 2 ** 15;
const METRES_PER_DEGREE_LATITUDE = 111_320;

/** A z15 tile's column and row. */
export interface Tile {
  readonly x: number;
  readonly y: number;
}

/** A place in plain degrees. */
export interface LatLon {
  readonly latitude: number;
  readonly longitude: number;
}

/** The z15 tile under a position. */
export function tileAt(position: LatLon): Tile {
  const x = Math.floor(((position.longitude + 180) / 360) * TILES);
  const radians = (position.latitude * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * TILES);
  return { x, y };
}

/** A block's key: its corner tile's, so one number names one block on one grid. */
export function blockKey(tile: Tile, size: number): number {
  const bx = Math.floor(tile.x / size) * size;
  const by = Math.floor(tile.y / size) * size;
  return by * TILES + bx;
}

/** The tiles of the block `key` names. */
export function blockTiles(key: number, size: number): Tile[] {
  const bx = key % TILES;
  const by = Math.floor(key / TILES);
  const tiles: Tile[] = [];
  for (let dy = 0; dy < size; dy += 1) {
    for (let dx = 0; dx < size; dx += 1) tiles.push({ x: bx + dx, y: by + dy });
  }
  return tiles;
}

/** Every block a square of half-side `reach` metres about `at` touches. */
export function blocksWithin(at: LatLon, reach: number, size: number): Set<number> {
  const perLongitude = METRES_PER_DEGREE_LATITUDE * Math.cos((at.latitude * Math.PI) / 180);
  const dLat = reach / METRES_PER_DEGREE_LATITUDE;
  const dLon = reach / perLongitude;
  const corner = tileAt({ latitude: at.latitude + dLat, longitude: at.longitude - dLon });
  const far = tileAt({ latitude: at.latitude - dLat, longitude: at.longitude + dLon });
  const keys = new Set<number>();
  for (let y = corner.y; y <= far.y; y += 1) {
    for (let x = corner.x; x <= far.x; x += 1) keys.add(blockKey({ x, y }, size));
  }
  return keys;
}

/** What {@link streamRide} counted. */
export interface StreamCount {
  readonly blocks: number;
  readonly tiles: number;
  readonly seconds: number;
  /** Tiles read an hour, at the ride's rate. */
  readonly tilesPerHour: number;
  /** How many (step, block) pairs found a block within `need` not ready yet: 0 is on time. */
  readonly late: number;
}

/**
 * Rides `path` (one position a `step` seconds) asking for blocks within
 * `need + lead` metres of the rider, each ready `readyAfterMs` later, and
 * counts a block within `need` metres that is not ready as late.
 */
export function streamRide(options: {
  readonly path: readonly LatLon[];
  readonly stepSeconds: number;
  readonly size: number;
  readonly need: number;
  readonly lead: number;
  readonly readyAfterMs: number;
}): StreamCount {
  const { path, stepSeconds, size, need, lead, readyAfterMs } = options;
  const readyAt = new Map<number, number>();
  let late = 0;
  path.forEach((at, index) => {
    const now = index * stepSeconds * 1000;
    for (const key of blocksWithin(at, need + lead, size)) {
      // The first blocks are read before the ride starts, as a ride start waits for them.
      if (!readyAt.has(key)) readyAt.set(key, index === 0 ? 0 : now + readyAfterMs);
    }
    for (const key of blocksWithin(at, need, size)) {
      // Asked for this very step at the latest, so `readyAt` holds it.
      if ((readyAt.get(key) as number) > now) late += 1;
    }
  });
  const seconds = Math.max(stepSeconds, (path.length - 1) * stepSeconds);
  const tiles = readyAt.size * size * size;
  return {
    blocks: readyAt.size,
    tiles,
    seconds,
    tilesPerHour: Math.round((tiles * 3600) / seconds),
    late,
  };
}
