// SPDX-License-Identifier: Apache-2.0

import { POI_CLASS_RANK, POI_REACH_METRES, type PoiClass } from './schema';
import type { BuildingFeature, Ring } from './types';

/**
 * A `pois` point of a kept class, as the decoder reads it (#2975): its class
 * and where it is, in the tile's local metres. Never handed out of the
 * package — {@link matchPoisToBuildings} turns it into a footprint's `poi` and
 * the point is dropped.
 */
export interface PoiPoint {
  readonly poi: PoiClass;
  readonly x: number;
  readonly z: number;
}

/** The grid the footprints are bucketed in, metres a side. */
const CELL_METRES = 32;

/** A cell's key: `column` and `row` offset so that both are positive, in 21 bits each. */
const OFFSET = 2 ** 20;
const cellKey = (column: number, row: number): number => (column + OFFSET) * 2 ** 21 + row + OFFSET;

/**
 * Gives each footprint the class of the POIs that are its (#2975, ADR 0054's
 * entry of 2026-11-21): a POI is the footprint's that holds it, or where none
 * does, the nearest whose outline is within `schema.ts` §`POI_REACH_METRES`
 * of it — 3 m for a shop or a café, 30 m for a fuel station's forecourt. Only
 * a `building` takes one: a `building_part` stands inside its building, which
 * already has. Where two POIs are one footprint's, the higher
 * `POI_CLASS_RANK` wins. A POI no footprint is near is dropped.
 *
 * Returns `buildings` with every matched footprint replaced by a copy that
 * carries its `poi`, in the same order; the others are the same objects.
 */
export function matchPoisToBuildings(
  buildings: readonly BuildingFeature[],
  pois: readonly PoiPoint[],
): BuildingFeature[] {
  const out = buildings.slice();
  if (pois.length === 0) return out;

  // Each footprint's outer box, and the cells it covers.
  const boxes = new Float64Array(buildings.length * 4);
  const cells = new Map<number, number[]>();
  for (let i = 0; i < buildings.length; i++) {
    const building = buildings[i] as BuildingFeature;
    const outer = building.rings[0];
    if (building.kind !== 'building' || outer === undefined || outer.length < 6) continue;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let v = 0; v + 1 < outer.length; v += 2) {
      const x = outer[v] as number;
      const z = outer[v + 1] as number;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    boxes.set([minX, minZ, maxX, maxZ], i * 4);
    for (let c = Math.floor(minX / CELL_METRES); c <= Math.floor(maxX / CELL_METRES); c++) {
      for (let r = Math.floor(minZ / CELL_METRES); r <= Math.floor(maxZ / CELL_METRES); r++) {
        const key = cellKey(c, r);
        const list = cells.get(key);
        if (list === undefined) cells.set(key, [i]);
        else list.push(i);
      }
    }
  }

  const taken = new Map<number, PoiClass>();
  const seen = new Int32Array(buildings.length).fill(-1);
  for (let p = 0; p < pois.length; p++) {
    const { poi, x, z } = pois[p] as PoiPoint;
    const reach = POI_REACH_METRES[poi];
    let best = -1;
    let bestDistance = Infinity;
    for (
      let c = Math.floor((x - reach) / CELL_METRES);
      c <= Math.floor((x + reach) / CELL_METRES);
      c++
    ) {
      for (
        let r = Math.floor((z - reach) / CELL_METRES);
        r <= Math.floor((z + reach) / CELL_METRES);
        r++
      ) {
        for (const i of cells.get(cellKey(c, r)) ?? []) {
          if (seen[i] === p) continue;
          seen[i] = p;
          const at = i * 4;
          if (
            x < (boxes[at] as number) - reach ||
            z < (boxes[at + 1] as number) - reach ||
            x > (boxes[at + 2] as number) + reach ||
            z > (boxes[at + 3] as number) + reach
          ) {
            continue;
          }
          const distance = distanceToFootprint((buildings[i] as BuildingFeature).rings, x, z);
          if (
            distance <= reach &&
            (distance < bestDistance || (distance === bestDistance && i < best))
          ) {
            best = i;
            bestDistance = distance;
          }
        }
      }
    }
    if (best < 0) continue;
    const held = taken.get(best);
    if (held === undefined || POI_CLASS_RANK[poi] > POI_CLASS_RANK[held]) taken.set(best, poi);
  }
  for (const [i, poi] of taken) out[i] = { ...(buildings[i] as BuildingFeature), poi };
  return out;
}

/** 0 inside the footprint (its outer ring less its holes), else metres to its nearest edge. */
function distanceToFootprint(rings: readonly Ring[], x: number, z: number): number {
  let inside = false;
  let nearest = Infinity;
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r] as Ring;
    const crossings = ringCrossings(ring, x, z);
    // Inside the outer ring and outside every hole.
    if (r === 0) inside = crossings;
    else if (crossings) inside = false;
    nearest = Math.min(nearest, distanceToRing(ring, x, z));
  }
  return inside ? 0 : nearest;
}

/** Whether `(x, z)` is inside `ring`, by the even-odd rule. */
function ringCrossings(ring: Ring, x: number, z: number): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 2; i + 1 < n; j = i, i += 2) {
    const xi = ring[i] as number;
    const zi = ring[i + 1] as number;
    const xj = ring[j] as number;
    const zj = ring[j + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Metres from `(x, z)` to the nearest point of `ring`'s edges, the closing edge included. */
function distanceToRing(ring: Ring, x: number, z: number): number {
  let best = Infinity;
  const n = ring.length;
  for (let i = 0, j = n - 2; i + 1 < n; j = i, i += 2) {
    const ax = ring[j] as number;
    const az = ring[j + 1] as number;
    const dx = (ring[i] as number) - ax;
    const dz = (ring[i + 1] as number) - az;
    const length = dx * dx + dz * dz;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}
