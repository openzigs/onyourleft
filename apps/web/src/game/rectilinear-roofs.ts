// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An L-, T-, U- or Z-shaped footprint as the rectangles its pitched roof is
 * built over — #1660, epic #1656 (owner ruling (b), 2026-10-24): "split L-,
 * T- and U-shaped footprints into 2–3 rectangles and run the existing
 * pitchedRoof on each".
 *
 * ## The rule
 *
 * 1. **Snap.** The ring's frame is its edges' mean direction, modulo a right
 *    angle and weighted by length. Every edge
 *    must lie within {@link RECTILINEAR_SNAP_DEGREES} of that axis or of its
 *    normal, or the ring is not rectilinear. Each run of edges along one
 *    axis becomes one edge, at the length-weighted mean of its offsets; a run
 *    that turns back on itself is a zig-zag, and not rectilinear.
 * 2. **Decompose.** The snapped ring's distinct offsets cut it into a grid of
 *    cells. The fewest of its maximal inside rectangles — at most
 *    {@link RECTANGLES_MAX} — whose union is every inside cell are the
 *    answer. They may overlap: same-pitch roofs over overlapping rectangles
 *    meet in the right valleys by the depth test alone.
 *
 * Anything else is `undefined`, and `footprint-buildings.ts` keeps #1540's
 * rule for it unchanged. Plan-time only, built once at the press, never per
 * frame.
 *
 * Formats no string, so names no vertex (ADR 0004 D): a refusal is
 * `undefined`, and nothing more.
 */

import type { Ring } from '@onyourleft/map-features';

/** An edge is on an axis within this many degrees of it: **8°** (#1660's starting value). */
export const RECTILINEAR_SNAP_DEGREES = 8;

/** The most rectangles a footprint is roofed in: **3** (#1660). */
export const RECTANGLES_MAX = 3;

/**
 * A rectangle: its centre, its long axis (unit) and its half-lengths along and
 * across it — the shape `footprint-buildings.ts` §`minimumAreaRectangle` names.
 */
export interface Rectangle {
  readonly cx: number;
  readonly cz: number;
  readonly ux: number;
  readonly uz: number;
  readonly halfLong: number;
  readonly halfShort: number;
}

/**
 * The most distinct offsets along either axis the snapped ring may have: a
 * union of {@link RECTANGLES_MAX} rectangles has at most two each.
 */
const MAX_OFFSETS = 2 * RECTANGLES_MAX;

/** The most cells the grid may have, one bit each of a 32-bit number. */
const MAX_CELLS = 30;

/** Two offsets nearer than this are one: **1 mm**. */
const SAME_OFFSET_METRES = 1e-3;

/** An edge shorter than this is no edge: it adds no corner. */
const NO_EDGE_METRES = 1e-6;

/**
 * The 1 to {@link RECTANGLES_MAX} rectangles whose union is `ring` snapped to
 * right angles, the largest first; `undefined` where it is not rectilinear or
 * needs more.
 */
export function rectanglesOf(ring: Ring): readonly Rectangle[] | undefined {
  const n = ring.length / 2;
  if (n < 4) return undefined;
  // The frame: the edges' mean direction, modulo a right angle and weighted by length —
  // each edge's angle four times over, so an edge and its normal pull the same way.
  let sumCos = 0;
  let sumSin = 0;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const dx = (ring[j * 2] as number) - (ring[i * 2] as number);
    const dz = (ring[j * 2 + 1] as number) - (ring[i * 2 + 1] as number);
    const length = Math.hypot(dx, dz);
    if (!(length > NO_EDGE_METRES)) continue;
    const angle = 4 * Math.atan2(dz, dx);
    sumCos += length * Math.cos(angle);
    sumSin += length * Math.sin(angle);
  }
  if (!(Math.hypot(sumCos, sumSin) > NO_EDGE_METRES)) return undefined;
  const turn = Math.atan2(sumSin, sumCos) / 4;
  const ux = Math.cos(turn);
  const uz = Math.sin(turn);
  const ox = ring[0] as number;
  const oz = ring[1] as number;
  const aOf = (i: number): number =>
    ((ring[i * 2] as number) - ox) * ux + ((ring[i * 2 + 1] as number) - oz) * uz;
  const cOf = (i: number): number =>
    -((ring[i * 2] as number) - ox) * uz + ((ring[i * 2 + 1] as number) - oz) * ux;

  // 1. Each edge: along the axis (its offset is `c`) or across it (`a`).
  const sinLimit = Math.sin((RECTILINEAR_SNAP_DEGREES * Math.PI) / 180);
  const along: boolean[] = [];
  const forward: boolean[] = [];
  const offsets: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const da = aOf(j) - aOf(i);
    const dc = cOf(j) - cOf(i);
    const length = Math.hypot(da, dc);
    if (!(length > NO_EDGE_METRES)) continue;
    if (Math.abs(dc) <= length * sinLimit) {
      along.push(true);
      forward.push(da > 0);
      offsets.push((cOf(i) + cOf(j)) / 2);
    } else if (Math.abs(da) <= length * sinLimit) {
      along.push(false);
      forward.push(dc > 0);
      offsets.push((aOf(i) + aOf(j)) / 2);
    } else {
      return undefined;
    }
    weights.push(length);
  }
  // Runs of one orientation, round the ring from a change of orientation.
  const edges = along.length;
  let start = -1;
  for (let i = 0; i < edges; i += 1) {
    if (along[i] !== along[(i + edges - 1) % edges]) {
      start = i;
      break;
    }
  }
  if (start < 0) return undefined;
  const runAlong: boolean[] = [];
  const runOffset: number[] = [];
  for (let step = 0; step < edges;) {
    const first = (start + step) % edges;
    let sum = 0;
    let weight = 0;
    while (step < edges && along[(start + step) % edges] === along[first]) {
      const k = (start + step) % edges;
      // A run that turns back on itself is a zig-zag, not a wall.
      if (forward[k] !== forward[first]) return undefined;
      sum += (offsets[k] as number) * (weights[k] as number);
      weight += weights[k] as number;
      step += 1;
    }
    runAlong.push(along[first] as boolean);
    runOffset.push(sum / weight);
  }
  // The snapped ring's corners, each where a run across meets a run along.
  const runs = runAlong.length;
  if (runs < 4 || runs % 2 !== 0) return undefined;
  const corners: [number, number][] = [];
  for (let r = 0; r < runs; r += 1) {
    const next = (r + 1) % runs;
    const a = runAlong[r] === true ? (runOffset[next] as number) : (runOffset[r] as number);
    const c = runAlong[r] === true ? (runOffset[r] as number) : (runOffset[next] as number);
    corners.push([a, c]);
  }

  // 2. The grid of the snapped ring's offsets.
  const as = distinct(corners.map(([a]) => a));
  const cs = distinct(corners.map(([, c]) => c));
  if (as.length > MAX_OFFSETS || cs.length > MAX_OFFSETS) return undefined;
  if (as.length < 2 || cs.length < 2) return undefined;
  const columns = as.length - 1;
  const rows = cs.length - 1;
  // A cell a bit of one number: never more than 30 of them.
  if (columns * rows > MAX_CELLS) return undefined;
  const inside: boolean[] = [];
  let wanted = 0;
  for (let i = 0; i < columns; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      const a = ((as[i] as number) + (as[i + 1] as number)) / 2;
      const c = ((cs[j] as number) + (cs[j + 1] as number)) / 2;
      const cell = insideCorners(corners, a, c);
      inside.push(cell);
      if (cell) wanted |= 1 << (i * rows + j);
    }
  }
  if (wanted === 0) return undefined;
  const cover = fewestCover(inside, columns, rows, wanted);
  if (cover === undefined) return undefined;
  const vx = -uz;
  const vz = ux;
  const rectangles = cover.map(([i0, i1, j0, j1]): Rectangle => {
    const a0 = as[i0] as number;
    const a1 = as[i1] as number;
    const c0 = cs[j0] as number;
    const c1 = cs[j1] as number;
    const am = (a0 + a1) / 2;
    const cm = (c0 + c1) / 2;
    const cx = ox + ux * am + vx * cm;
    const cz = oz + uz * am + vz * cm;
    const halfA = (a1 - a0) / 2;
    const halfC = (c1 - c0) / 2;
    return halfA >= halfC
      ? { cx, cz, ux, uz, halfLong: halfA, halfShort: halfC }
      : { cx, cz, ux: vx, uz: vz, halfLong: halfC, halfShort: halfA };
  });
  // The largest first, by area: the rectangle the roof's trim goes on.
  return rectangles.sort((p, q) => q.halfLong * q.halfShort - p.halfLong * p.halfShort);
}

/** `values` sorted, those within {@link SAME_OFFSET_METRES} of the last kept dropped. */
function distinct(values: readonly number[]): number[] {
  const sorted = [...values].sort((p, q) => p - q);
  const out: number[] = [];
  for (const value of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || value - last > SAME_OFFSET_METRES) out.push(value);
  }
  return out;
}

/** Whether `(a, c)` is inside the ring of `corners`, by the even-odd rule. */
function insideCorners(
  corners: readonly (readonly [number, number])[],
  a: number,
  c: number,
): boolean {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i, i += 1) {
    const [ai, ci] = corners[i] as readonly [number, number];
    const [aj, cj] = corners[j] as readonly [number, number];
    if (ci > c !== cj > c && a < ((aj - ai) * (c - ci)) / (cj - ci) + ai) inside = !inside;
  }
  return inside;
}

/** A rectangle of grid cells: columns `[i0, i1)` by rows `[j0, j1)`, as offset indices. */
type Cells = readonly [i0: number, i1: number, j0: number, j1: number];

/**
 * The fewest maximal inside rectangles of the grid, at most
 * {@link RECTANGLES_MAX}, whose cells together are exactly `wanted`; the
 * largest first. `undefined` where more would be needed.
 */
function fewestCover(
  inside: readonly boolean[],
  columns: number,
  rows: number,
  wanted: number,
): readonly Cells[] | undefined {
  const cellInside = (i: number, j: number): boolean => inside[i * rows + j] === true;
  const candidates: { readonly cells: Cells; readonly mask: number; readonly area: number }[] = [];
  for (let i0 = 0; i0 < columns; i0 += 1) {
    for (let i1 = i0 + 1; i1 <= columns; i1 += 1) {
      for (let j0 = 0; j0 < rows; j0 += 1) {
        for (let j1 = j0 + 1; j1 <= rows; j1 += 1) {
          let mask = 0;
          let full = true;
          for (let i = i0; i < i1 && full; i += 1) {
            for (let j = j0; j < j1; j += 1) {
              if (!cellInside(i, j)) {
                full = false;
                break;
              }
              mask |= 1 << (i * rows + j);
            }
          }
          if (full) candidates.push({ cells: [i0, i1, j0, j1], mask, area: (i1 - i0) * (j1 - j0) });
        }
      }
    }
  }
  // Only the maximal ones: none inside another.
  const maximal = candidates
    .filter(
      (each) =>
        !candidates.some(
          (other) =>
            other !== each && (other.mask & each.mask) === each.mask && other.mask !== each.mask,
        ),
    )
    .sort((p, q) => q.area - p.area);
  const count = maximal.length;
  // The first `size` of them, in that order, whose union is `wanted`: fewest first.
  const chosen: number[] = [];
  const search = (from: number, size: number, union: number): boolean => {
    if (chosen.length === size) return union === wanted;
    for (let k = from; k < count; k += 1) {
      chosen.push(k);
      if (search(k + 1, size, union | (maximal[k] as (typeof maximal)[number]).mask)) return true;
      chosen.pop();
    }
    return false;
  };
  for (let size = 1; size <= RECTANGLES_MAX; size += 1) {
    chosen.length = 0;
    if (search(0, size, 0))
      return chosen.map((k) => (maximal[k] as (typeof maximal)[number]).cells);
  }
  return undefined;
}
