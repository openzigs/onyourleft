// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A building drawn by its parts, not by its outline too** — #3132.
 *
 * OpenStreetMap maps a building in 3-D as its outline (`building`) and the
 * pieces that make it up (`building:part`, here `building_part`), each with
 * its own height. The Simple 3D Buildings scheme says what a renderer does
 * with the two: *"When a building has any building:part=* areas, the building
 * outline is not considered for 3D rendering"*
 * (wiki.openstreetmap.org/wiki/Simple_3D_Buildings). The outline is for 2-D
 * maps.
 *
 * ⚠️ **What drawing both drew: a wall that flickers.** A part stands on its
 * building's outline along every wall they share, so the outline's wall and
 * the part's are one plane facing one way, each with its own paint, and
 * neither wins the depth test (z-fighting) — the stripes and patches the
 * owner saw on a city building's side on the tablet ride of 2026-11-24. Where
 * the part is as tall as the outline their roofs fight too. #3060's
 * measurement found these pairs and left them (its "Deferred").
 *
 * **Which outline is a part's** ({@link withoutPartOutlines}): a `building`
 * whose outer ring holds the centroid of a `building_part`'s outer ring. The
 * outline is left out; every part, and every other building, is kept.
 *
 * ⚠️ **Bounded**: a tile is untrusted input. The work — a candidate looked at,
 * or a vertex of a ring tested — is pooled at {@link PART_OUTLINE_WORK_PER_FOOTPRINT}
 * a footprint, and once it is spent every outline not yet found is kept, which
 * draws a building twice: the direction #3060 chose to be wrong in.
 *
 * Names no coordinate and formats no string (ADR 0004 D).
 */

import type { BuildingFeature, Ring } from '@onyourleft/map-features';

/** The work the search may do, per footprint, pooled: **2,000** units. @see the header */
export const PART_OUTLINE_WORK_PER_FOOTPRINT = 2_000;

/** The side of a cell of the grid the outlines are found in, metres. */
const CELL_METRES = 32;

/** `buildings` less every `building` outline that holds a `building_part`, in their order. */
export function withoutPartOutlines(
  buildings: readonly BuildingFeature[],
  workPerFootprint: number = PART_OUTLINE_WORK_PER_FOOTPRINT,
): readonly BuildingFeature[] {
  if (!buildings.some((building) => building.kind === 'building_part')) return buildings;
  let budget = workPerFootprint * buildings.length;
  const key = (ix: number, iz: number): number => (ix + 0x8000) * 0x1_0000 + (iz + 0x8000);
  // Every outline, by the cells its box reaches.
  const cells = new Map<number, number[]>();
  const boxes = new Map<number, readonly [number, number, number, number]>();
  buildings.forEach((building, index) => {
    const outer = building.rings[0];
    if (building.kind !== 'building' || outer === undefined || outer.length < 6) return;
    const box = boxOf(outer);
    boxes.set(index, box);
    const [minX, maxX, minZ, maxZ] = box;
    for (let ix = Math.floor(minX / CELL_METRES); ix <= Math.floor(maxX / CELL_METRES); ix++) {
      for (let iz = Math.floor(minZ / CELL_METRES); iz <= Math.floor(maxZ / CELL_METRES); iz++) {
        budget -= 1;
        const list = cells.get(key(ix, iz));
        if (list === undefined) cells.set(key(ix, iz), [index]);
        else list.push(index);
      }
    }
  });
  const outlines = new Set<number>();
  for (const part of buildings) {
    if (budget <= 0) break;
    const ring = part.rings[0];
    if (part.kind !== 'building_part' || ring === undefined || ring.length < 6) continue;
    budget -= ring.length / 2;
    const { x, z } = centroidOf(ring);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    for (const index of cells.get(key(Math.floor(x / CELL_METRES), Math.floor(z / CELL_METRES))) ??
      []) {
      budget -= 1;
      if (outlines.has(index) || budget <= 0) continue;
      const [minX, maxX, minZ, maxZ] = boxes.get(index) as readonly [
        number,
        number,
        number,
        number,
      ];
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      const outer = buildings[index]?.rings[0] as Ring;
      budget -= outer.length / 2;
      if (insideRing(outer, x, z)) outlines.add(index);
    }
  }
  if (outlines.size === 0) return buildings;
  return buildings.filter((_, index) => !outlines.has(index));
}

function boxOf(ring: Ring): readonly [number, number, number, number] {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    minX = Math.min(minX, ring[i] as number);
    maxX = Math.max(maxX, ring[i] as number);
    minZ = Math.min(minZ, ring[i + 1] as number);
    maxZ = Math.max(maxZ, ring[i + 1] as number);
  }
  return [minX, maxX, minZ, maxZ];
}

/** A ring's centroid by area; its vertices' mean where it has none. */
function centroidOf(ring: Ring): { readonly x: number; readonly z: number } {
  const n = Math.floor(ring.length / 2);
  let twice = 0;
  let cx = 0;
  let cz = 0;
  let mx = 0;
  let mz = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = ring[i * 2] as number;
    const az = ring[i * 2 + 1] as number;
    const bx = ring[j * 2] as number;
    const bz = ring[j * 2 + 1] as number;
    const cross = ax * bz - bx * az;
    twice += cross;
    cx += (ax + bx) * cross;
    cz += (az + bz) * cross;
    mx += ax;
    mz += az;
  }
  if (Math.abs(twice) < 1e-9) return { x: mx / n, z: mz / n };
  return { x: cx / (3 * twice), z: cz / (3 * twice) };
}

function insideRing(ring: Ring, x: number, z: number): boolean {
  const n = ring.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const xi = ring[i * 2] as number;
    const zi = ring[i * 2 + 1] as number;
    const xj = ring[j * 2] as number;
    const zj = ring[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
