// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One footprint where two tiles each carry it — #3047.
 *
 * A vector tile carries a buffer past its own edges (`schema.ts`
 * §`COORDINATE_BUFFER_EXTENTS`; the published archive's is a sixteenth of a
 * tile, some 55 m at z15), so a building within it of a tile's edge is in
 * both tiles: whole in each, or whole in one and **clipped** at the other's
 * buffer line. A read joins the tiles' features (`corridor.ts`
 * §`readCorridorTiles`), so the corridor held the building twice.
 *
 * ⚠️ **What that drew: a building with no walls.** `footprint-buildings.ts`
 * found a party wall (#1635) on every edge the two copies share and, the two
 * being the same height, drew neither copy's face there: a whole copy lost
 * every wall, and a clipped one took the walls along the stretch it shares
 * with it. Measured on 2026-11-22 from the published archive along NH 1A at
 * Hampton Beach NH (public), where the owner saw "some buildings missing
 * sides": 46 extra copies among 2 417 footprints, and 159 of the 185 planned
 * buildings with an edge under a third walled were one of a copy's pair.
 *
 * **What is a copy** ({@link isCopyOf}): a footprint with the other's
 * attributes, every vertex of whose outer ring lies within
 * {@link TILE_COPY_METRES} of the other's outer ring, and the middle of every
 * edge of which is on that ring or inside it. A clipped copy is that: the
 * other's vertices and the points where the clip line crosses its edges. A
 * neighbour that shares a wall is not: its far side is off the ring. Of two
 * copies of each other the one with more area is kept, and of two the same
 * the one read first.
 *
 * ⚠️ **What it does not mend**: a building more than the buffer across the
 * seam on both sides is clipped in both tiles, and neither copy holds the
 * other. Both are kept.
 */

import type { BuildingFeature, Ring } from '@onyourleft/map-features';

/**
 * How far a copy's vertex may stand from the other's ring: **0.5 m**. Each
 * tile quantises a vertex to its own grid, a 4 096th of a tile — 0.3 m at
 * the equator at z15 — so two copies' vertices are up to that apart.
 */
const TILE_COPY_METRES = 0.5;

/** The side of a cell of the grid the candidates are found in, metres. */
const CELL_METRES = 32;

/** The corridor's buildings with every tile copy left out, in their order — #3047. */
export function withoutTileCopies(
  buildings: readonly BuildingFeature[],
): readonly BuildingFeature[] {
  const outers = buildings.map((building) => building.rings[0] ?? new Float32Array(0));
  const areas = outers.map((ring) => Math.abs(signedArea(ring)));
  const cells = new Map<number, number[]>();
  const key = (ix: number, iz: number): number => (ix + 0x8000) * 0x1_0000 + (iz + 0x8000);
  const boxes = outers.map(boxOf);
  boxes.forEach(([minX, maxX, minZ, maxZ], index) => {
    for (let ix = Math.floor(minX / CELL_METRES); ix <= Math.floor(maxX / CELL_METRES); ix++) {
      for (let iz = Math.floor(minZ / CELL_METRES); iz <= Math.floor(maxZ / CELL_METRES); iz++) {
        const list = cells.get(key(ix, iz));
        if (list === undefined) cells.set(key(ix, iz), [index]);
        else list.push(index);
      }
    }
  });
  const dropped = new Uint8Array(buildings.length);
  // #2975: a POI is matched within its own tile, so the copy left out may hold the one the kept lacks.
  const pois = new Map<number, BuildingFeature['poi']>();
  for (let index = 0; index < buildings.length; index++) {
    const [minX, maxX, minZ, maxZ] = boxes[index] as Box;
    const seen = new Set<number>();
    let keeper = -1;
    for (let ix = Math.floor(minX / CELL_METRES); ix <= Math.floor(maxX / CELL_METRES); ix++) {
      for (let iz = Math.floor(minZ / CELL_METRES); iz <= Math.floor(maxZ / CELL_METRES); iz++) {
        for (const other of cells.get(key(ix, iz)) ?? []) {
          if (other === index || seen.has(other) || keeper >= 0) continue;
          seen.add(other);
          if (dropped[other] === 1) continue;
          // A copy's box is inside the other's: the cheap test, before any vertex is.
          const [otherMinX, otherMaxX, otherMinZ, otherMaxZ] = boxes[other] as Box;
          if (
            minX < otherMinX - TILE_COPY_METRES ||
            maxX > otherMaxX + TILE_COPY_METRES ||
            minZ < otherMinZ - TILE_COPY_METRES ||
            maxZ > otherMaxZ + TILE_COPY_METRES
          ) {
            continue;
          }
          const a = buildings[index] as BuildingFeature;
          const b = buildings[other] as BuildingFeature;
          if (!sameAttributes(a, b) || !isCopyOf(outers[index] as Ring, outers[other] as Ring)) {
            continue;
          }
          const mine = areas[index] as number;
          const theirs = areas[other] as number;
          // Two copies of each other (both whole) keep the first read; otherwise the larger.
          const mutual = isCopyOf(outers[other] as Ring, outers[index] as Ring);
          if (mutual ? other < index : theirs >= mine) keeper = other;
        }
      }
    }
    if (keeper < 0) continue;
    dropped[index] = 1;
    const poi = buildings[index]?.poi;
    if (poi !== undefined && buildings[keeper]?.poi === undefined && !pois.has(keeper)) {
      pois.set(keeper, poi);
    }
  }
  if (!dropped.includes(1)) return buildings;
  const kept: BuildingFeature[] = [];
  buildings.forEach((building, index) => {
    if (dropped[index] === 1) return;
    const poi = pois.get(index);
    kept.push(poi === undefined ? building : { ...building, poi });
  });
  return kept;
}

/**
 * Whether `copy` is a tile's copy of `of` — every vertex of it within
 * {@link TILE_COPY_METRES} of `of`'s ring, and the middle of every edge on
 * that ring or inside it.
 */
function isCopyOf(copy: Ring, of: Ring): boolean {
  const n = copy.length / 2;
  if (n < 3 || of.length < 6) return false;
  for (let i = 0; i < n; i++) {
    if (distanceToRing(of, copy[i * 2] as number, copy[i * 2 + 1] as number) > TILE_COPY_METRES) {
      return false;
    }
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const mx = ((copy[i * 2] as number) + (copy[j * 2] as number)) / 2;
    const mz = ((copy[i * 2 + 1] as number) + (copy[j * 2 + 1] as number)) / 2;
    if (distanceToRing(of, mx, mz) > TILE_COPY_METRES && !insideRing(of, mx, mz)) return false;
  }
  return true;
}

/** Whether two footprints carry the same tags: a tile's copy carries its building's own. */
function sameAttributes(a: BuildingFeature, b: BuildingFeature): boolean {
  return (
    a.kind === b.kind &&
    a.heightMetres === b.heightMetres &&
    a.minHeightMetres === b.minHeightMetres &&
    a.buildingType === b.buildingType &&
    a.levels === b.levels &&
    a.roofLevels === b.roofLevels &&
    a.roofShape === b.roofShape &&
    a.roofOrientation === b.roofOrientation &&
    a.roofDirectionDegrees === b.roofDirectionDegrees &&
    a.wallColour === b.wallColour &&
    a.roofColour === b.roofColour &&
    a.wallMaterial === b.wallMaterial &&
    a.roofMaterial === b.roofMaterial &&
    a.startYear === b.startYear &&
    a.landmark === b.landmark
  );
}

type Box = readonly [minX: number, maxX: number, minZ: number, maxZ: number];

function boxOf(ring: Ring): Box {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    const x = ring[i] as number;
    const z = ring[i + 1] as number;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return ring.length < 2 ? [0, -1, 0, -1] : [minX, maxX, minZ, maxZ];
}

function signedArea(ring: Ring): number {
  const n = ring.length / 2;
  let twice = 0;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    twice +=
      (ring[j * 2] as number) * (ring[i * 2 + 1] as number) -
      (ring[i * 2] as number) * (ring[j * 2 + 1] as number);
  }
  return twice / 2;
}

function distanceToRing(ring: Ring, x: number, z: number): number {
  const n = ring.length / 2;
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = ring[i * 2] as number;
    const az = ring[i * 2 + 1] as number;
    const dx = (ring[j * 2] as number) - ax;
    const dz = (ring[j * 2 + 1] as number) - az;
    const span = dx * dx + dz * dz;
    const t = span > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
    nearest = Math.min(nearest, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return nearest;
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
