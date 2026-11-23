// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **How far a place is from the nearest street an open-world ride holds** —
 * #3094.
 *
 * `landform.ts` levels the ground beside a road: no invented relief within
 * `RELIEF_CLEAR_METRES` of it, and growing from there. Until #3094 the road was
 * the one the route takes, so a junction choice, which makes another street the
 * road, redrew the hills along every way out on the frame of the press. An
 * open-world view's ground is levelled beside EVERY street the ride holds
 * (`open-world/street-corridor.ts`, the network the side streets are drawn
 * from), the road's and the side streets' alike, so it is the same whichever of
 * them the route takes. This answers the distance it levels by.
 *
 * ## A lattice, not a search a vertex
 *
 * A frame's ground is some 3 500 vertices, and the nearest of a few hundred
 * streets to each is a search a frame cannot afford. So the distance is read
 * on a lattice {@link LEVEL_LATTICE_METRES} apart in the ride's frame, each
 * point found once and kept, and a place reads the four round it bilinearly.
 * The lattice is the ride's, not the view's: every view reads the same
 * number at the same place, which is the whole point. Distance to a straight
 * street is linear either side of it, which bilinear reproduces exactly, so it
 * is exact past a cell's diagonal from a street (11 m), and over-reads within
 * it, where the ground is level anyway (`RELIEF_CLEAR_METRES`, 12 m).
 *
 * The streets are read from a source, and the lattice is dropped whenever the
 * source hands over different streets (a block read or dropped): the held
 * streets change about once a kilometre, and the lattice round the view is
 * found again then.
 *
 * Pure but for its caches, and names no rendering library.
 */

/**
 * The most a distance is read as, metres: **300**, where `landform.ts`'s far
 * relief field has taken over (`RELIEF_BLEND_METRES`) and past where its
 * relief stops growing (12 m + 45 m / 0.18 = 262 m). A place farther from
 * every street than this is levelled exactly as one this far is.
 */
export const LEVEL_REACH_METRES = 300;

/** How far apart the lattice's points are, metres: **8**. */
export const LEVEL_LATTICE_METRES = 8;

/** Lattice steps a chunk's side; a chunk holds one more point a side, so a cell never spans two. */
const CHUNK_STEPS = 32;
const CHUNK_SIDE = CHUNK_STEPS + 1;

/**
 * The most chunks kept: **256**, 1.1 MB. A view reads some twenty; past this
 * the lattice is dropped and found again, which changes no value.
 */
const CHUNK_LIMIT = 256;

/** The side of one cell of the streets' index, metres. */
const INDEX_CELL_METRES = 64;

/** A street, as the source hands it: `x0, z0, x1, z1, …` in the ride's frame. */
export interface LevelledStreet {
  readonly line: Float32Array;
}

/** A key for a pair of integers, unique within ±50 000 of each other's axis. */
function pairKey(column: number, row: number): number {
  return column * 100_003 + row;
}

/** The distance from `(x, z)` to the segment `a → b`. */
function toSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const span = dx * dx + dz * dz;
  const t = span > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
  return Math.hypot(x - ax - t * dx, z - az - t * dz);
}

/** The streets a ride holds, and how far any place is from the nearest. See the file's header. */
export class StreetLevels {
  readonly #source: () => readonly LevelledStreet[] | undefined;
  /** The streets the index and the lattice were built from. */
  #streets: readonly LevelledStreet[] | undefined;
  /** Every segment, four floats: `ax, az, bx, bz`. */
  #segments = new Float64Array(0);
  /** Each index cell's segments, by {@link pairKey}. */
  #cells = new Map<number, number[]>();
  /** The lattice, by chunk. */
  #chunks = new Map<number, Float32Array>();
  /** The last chunk read, which the next read is most often in. */
  #lastKey = Number.NaN;
  #last: Float32Array | undefined;

  constructor(source: () => readonly LevelledStreet[] | undefined) {
    this.#source = source;
  }

  /**
   * How far `(x, z)` is from the nearest street held, metres, read off the
   * lattice; at most {@link LEVEL_REACH_METRES}, and `Infinity` while no
   * street is held.
   */
  distance(x: number, z: number): number {
    this.#current();
    if (this.#segments.length === 0) return Number.POSITIVE_INFINITY;
    const u = x / LEVEL_LATTICE_METRES;
    const v = z / LEVEL_LATTICE_METRES;
    const column = Math.floor(u);
    const row = Math.floor(v);
    const chunkColumn = Math.floor(column / CHUNK_STEPS);
    const chunkRow = Math.floor(row / CHUNK_STEPS);
    const key = pairKey(chunkColumn, chunkRow);
    let chunk = this.#lastKey === key ? this.#last : this.#chunks.get(key);
    if (chunk === undefined) chunk = this.#chunk(chunkColumn, chunkRow, key);
    this.#lastKey = key;
    this.#last = chunk;
    const i = column - chunkColumn * CHUNK_STEPS;
    const j = row - chunkRow * CHUNK_STEPS;
    const s = u - column;
    const t = v - row;
    const at = i * CHUNK_SIDE + j;
    const a = chunk[at] as number;
    const b = chunk[at + CHUNK_SIDE] as number;
    const c = chunk[at + 1] as number;
    const d = chunk[at + CHUNK_SIDE + 1] as number;
    return (a + (b - a) * s) * (1 - t) + (c + (d - c) * s) * t;
  }

  /** The index, built again whenever the source hands over different streets. */
  #current(): void {
    const streets = this.#source();
    if (streets === this.#streets) return;
    this.#streets = streets;
    this.#chunks.clear();
    this.#lastKey = Number.NaN;
    this.#last = undefined;
    this.#cells = new Map();
    const segments: number[] = [];
    for (const street of streets ?? []) {
      const line = street.line;
      for (let at = 0; at + 3 < line.length; at += 2) {
        const ax = line[at] as number;
        const az = line[at + 1] as number;
        const bx = line[at + 2] as number;
        const bz = line[at + 3] as number;
        if (![ax, az, bx, bz].every(Number.isFinite)) continue;
        const index = segments.length / 4;
        segments.push(ax, az, bx, bz);
        const lowColumn = Math.floor(Math.min(ax, bx) / INDEX_CELL_METRES);
        const highColumn = Math.floor(Math.max(ax, bx) / INDEX_CELL_METRES);
        const lowRow = Math.floor(Math.min(az, bz) / INDEX_CELL_METRES);
        const highRow = Math.floor(Math.max(az, bz) / INDEX_CELL_METRES);
        for (let column = lowColumn; column <= highColumn; column += 1) {
          for (let row = lowRow; row <= highRow; row += 1) {
            const cell = pairKey(column, row);
            const list = this.#cells.get(cell);
            if (list === undefined) this.#cells.set(cell, [index]);
            else list.push(index);
          }
        }
      }
    }
    this.#segments = Float64Array.from(segments);
  }

  /** One chunk of the lattice, found and kept. */
  #chunk(chunkColumn: number, chunkRow: number, key: number): Float32Array {
    if (this.#chunks.size >= CHUNK_LIMIT) this.#chunks.clear();
    const chunk = new Float32Array(CHUNK_SIDE * CHUNK_SIDE);
    for (let i = 0; i < CHUNK_SIDE; i += 1) {
      for (let j = 0; j < CHUNK_SIDE; j += 1) {
        chunk[i * CHUNK_SIDE + j] = this.#nearest(
          (chunkColumn * CHUNK_STEPS + i) * LEVEL_LATTICE_METRES,
          (chunkRow * CHUNK_STEPS + j) * LEVEL_LATTICE_METRES,
        );
      }
    }
    this.#chunks.set(key, chunk);
    return chunk;
  }

  /**
   * The distance from `(x, z)` to the nearest segment, at most
   * {@link LEVEL_REACH_METRES}: the index's cells in rings round the point's
   * own, until no nearer segment can be in the next ring.
   */
  #nearest(x: number, z: number): number {
    const segments = this.#segments;
    const column = Math.floor(x / INDEX_CELL_METRES);
    const row = Math.floor(z / INDEX_CELL_METRES);
    const rings = Math.ceil(LEVEL_REACH_METRES / INDEX_CELL_METRES) + 1;
    let best = LEVEL_REACH_METRES;
    for (let ring = 0; ring <= rings; ring += 1) {
      // Every cell of ring `ring` is at least `ring − 1` cells from the point.
      if (best <= (ring - 1) * INDEX_CELL_METRES) break;
      for (let i = -ring; i <= ring; i += 1) {
        for (let j = -ring; j <= ring; j += 1) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
          const list = this.#cells.get(pairKey(column + i, row + j));
          if (list === undefined) continue;
          for (const index of list) {
            const at = index * 4;
            const distance = toSegment(
              x,
              z,
              segments[at] as number,
              segments[at + 1] as number,
              segments[at + 2] as number,
              segments[at + 3] as number,
            );
            if (distance < best) best = distance;
          }
        }
      }
    }
    return best;
  }
}
