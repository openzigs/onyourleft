// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the realistic scenery's ground blobs lie — #620, in jsdom.
 *
 * What a GPU is needed for — that the darkening reaches the drawing buffer at
 * the strength {@link GROUND_BLOB_DARKNESS} states, and not at another — is
 * `game.browser.spec.ts` §"#620". What is here is everything that decides
 * where a blob goes: the one sun, the landform's own triangles, and the road's
 * edge on a hairpin.
 */

import { describe, expect, it } from 'vitest';

import { sunThrowPerMetre } from './contact-shadow';
import {
  blobCasters,
  GROUND_BLOB_CORE,
  GROUND_BLOB_DARKNESS,
  groundBlobAlpha,
  groundBlobAxes,
  groundUnder,
  groundUnderBlob,
  keptByRoadClip,
  placeGroundBlob,
  ROAD_EDGE_METRES,
  roadClip,
  type BlobCaster,
  type GroundBlob,
  type GroundPoint,
} from './ground-blob';
import { terrainCorridor, terrainHeightAt } from './landform';
import { hairpinRoute, hillRoute } from './route-fixtures-testing';
import { scatterAt, scatterSeed, type ScatterItem } from './scatter';
import { STRUCTURE_FOOTPRINTS, structuresAt } from './settlements';
import { corridorOrigin, roadCorridor, type CorridorPoint } from './terrain';
import { worldStyle, type SunStyle } from './world';

/** A sun at `elevation` degrees, from `azimuth` degrees round +Z towards +X. */
function sunAt(elevation: number, azimuth: number): SunStyle {
  const up = (elevation * Math.PI) / 180;
  const round = (azimuth * Math.PI) / 180;
  return {
    x: Math.cos(up) * Math.sin(round),
    y: Math.sin(up),
    z: Math.cos(up) * Math.cos(round),
    ambient: 0.4,
    direct: 0.6,
  };
}

function aTree(x: number, z: number, radius = 3, height = 9, y = 0): BlobCaster {
  return {
    x,
    y,
    z,
    yaw: 0,
    round: true,
    halfAlong: radius,
    halfAcross: radius,
    centreAlong: 0,
    height,
    strength: 1,
  };
}

const blob = (): GroundBlob => ({ x: 0, z: 0, yaw: 0, halfAlong: 0, halfAcross: 0 });
const ground = (): GroundPoint => ({ y: 0, nx: 0, ny: 1, nz: 0 });

describe('a ground blob’s darkness — #620', () => {
  it('is the stated darkness through its core, and nothing at the rim or past it', () => {
    expect(groundBlobAlpha(0)).toBe(GROUND_BLOB_DARKNESS);
    expect(groundBlobAlpha(GROUND_BLOB_CORE)).toBe(GROUND_BLOB_DARKNESS);
    expect(groundBlobAlpha(1)).toBe(0);
    expect(groundBlobAlpha(1.5)).toBe(0);
    let previous = GROUND_BLOB_DARKNESS;
    for (let r = GROUND_BLOB_CORE; r < 1; r += 0.05) {
      const alpha = groundBlobAlpha(r);
      expect(alpha).toBeLessThanOrEqual(previous);
      previous = alpha;
    }
    expect(groundBlobAlpha(0.99)).toBeLessThan(0.01);
  });
});

describe('a ground blob is thrown from the one sun — #620', () => {
  it('lies AWAY from the sun, along the ground projection the riders’ shadow uses', () => {
    for (const sun of [sunAt(55, 0), sunAt(62, 135), sunAt(70, 250), sunAt(58, 310)]) {
      const into = blob();
      placeGroundBlob(aTree(100, 200), sunThrow(sun), into);
      const away = Math.hypot(sun.x, sun.z);
      const ours = Math.hypot(into.x - 100, into.z - 200);
      // Straight away from the sun, horizontally.
      expect((into.x - 100) / ours).toBeCloseTo(-sun.x / away, 9);
      expect((into.z - 200) / ours).toBeCloseTo(-sun.z / away, 9);
      // Half the column's shadow: 4.5 m up, thrown 4.5 / tan(elevation).
      expect(ours).toBeCloseTo((4.5 * away) / sun.y, 9);
      // Long along the sun by the whole shadow, and the crown's width across.
      expect(into.halfAlong).toBeCloseTo(3 + (9 * away) / sun.y / 2, 9);
      expect(into.halfAcross).toBeCloseTo(3, 9);
      expect(Math.sin(into.yaw)).toBeCloseTo(-sun.x / away, 9);
      expect(Math.cos(into.yaw)).toBeCloseTo(-sun.z / away, 9);
    }
  });

  it('keeps a building’s own axes, stretched by the shadow along and across them', () => {
    const sun = sunAt(60, 90); // due +X: the shadow falls towards −X
    const caster: BlobCaster = {
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      round: false,
      halfAlong: 5,
      halfAcross: 2,
      centreAlong: 1,
      height: 8,
      strength: 1,
    };
    const into = blob();
    placeGroundBlob(caster, sunThrow(sun), into);
    const shadow = 8 / Math.tan(Math.PI / 3);
    expect(into.yaw).toBe(0);
    expect(into.halfAlong).toBeCloseTo(5, 9);
    expect(into.halfAcross).toBeCloseTo(2 + shadow / 2, 9);
    expect(into.x).toBeCloseTo(-shadow / 2, 9);
    expect(into.z).toBeCloseTo(1, 9);
  });
});

function sunThrow(sun: SunStyle): { x: number; z: number } {
  const into = { x: 0, z: 0 };
  if (!sunThrowPerMetre(sun, into)) throw new Error('no shadow under this sun');
  return into;
}

describe('a ground blob lies on the landform, not on a plane — #620', () => {
  const profile = hillRoute();
  const origin = corridorOrigin(profile);
  const seed = scatterSeed(profile);
  const corridor = roadCorridor(profile, origin, 900);
  const mesh = terrainCorridor(profile, origin, corridor, seed);

  it('reads the height of the triangle it is over, which is where the ground is drawn', () => {
    let checked = 0;
    let sloped = 0;
    for (let row = 20; row < corridor.centre.length - 20; row += 7) {
      const point = corridor.centre[row] as CorridorPoint;
      const next = corridor.centre[row + 1] as CorridorPoint;
      const length = Math.hypot(next.x - point.x, next.z - point.z);
      // The road's normal, the RIGHT, `(−headingZ, headingX)` since #583.
      const rightX = -(next.z - point.z) / length;
      const rightZ = (next.x - point.x) / length;
      for (const lateral of [-30, -14, -6, 6, 14, 30]) {
        const x = point.x + rightX * lateral;
        const z = point.z + rightZ * lateral;
        const into = ground();
        expect(groundUnder(mesh, corridor.centre, x, z, into)).toBe(true);
        const expected = terrainHeightAt(profile, origin, seed, point.distance, lateral);
        // The mesh is piecewise-linear across columns and rows; the point is
        // on a row, so only the columns' interpolation is in it.
        expect(Math.abs(into.y - expected)).toBeLessThan(0.05);
        expect(into.ny).toBeGreaterThan(0.8);
        if (Math.hypot(into.nx, into.nz) > 0.02) sloped += 1;
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(40);
    // Non-vacuity: a hill's cross-slope tilts the ground, so the normal read
    // is not "up" everywhere — a blob laid flat would float or sink there.
    expect(sloped).toBeGreaterThan(checked / 4);
  });

  it('turns the normal it reads the way the ground slopes', () => {
    // Two points a hand's width apart either way of one point on the hill:
    // the height it reads changes as its normal says the ground tilts.
    let compared = 0;
    for (let row = 20; row < corridor.centre.length - 20; row += 11) {
      const point = corridor.centre[row] as CorridorPoint;
      for (const offset of [-20, 20]) {
        const x = point.x + offset;
        const z = point.z + 3;
        const here = ground();
        if (!groundUnder(mesh, corridor.centre, x, z, here)) continue;
        const east = ground();
        const north = ground();
        if (!groundUnder(mesh, corridor.centre, x + 0.05, z, east)) continue;
        if (!groundUnder(mesh, corridor.centre, x, z + 0.05, north)) continue;
        // Only where all three are over the same triangle.
        if (east.nx !== here.nx || north.nz !== here.nz) continue;
        expect(Math.hypot(here.nx, here.ny, here.nz)).toBeCloseTo(1, 9);
        expect((east.y - here.y) / 0.05).toBeCloseTo(-here.nx / here.ny, 5);
        expect((north.y - here.y) / 0.05).toBeCloseTo(-here.nz / here.ny, 5);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(5);
  });

  it('finds the ground under every triangle of a hairpin’s mesh, the outside of the bend included', () => {
    // The nearest cross-section to a point 300 m out beside a bend is not the
    // one whose quad it is over: the columns fan out. Every triangle's own
    // middle has ground under it, and it is found.
    const profile = hairpinRoute(10);
    const at = corridorOrigin(profile);
    const bend = roadCorridor(profile, at, 400);
    const ground10 = terrainCorridor(profile, at, bend, scatterSeed(profile));
    const vertices = ground10.vertices;
    let found = 0;
    let asked = 0;
    for (let index = 0; index < ground10.indices.length; index += 3) {
      const [p, q, r] = [0, 1, 2].map((k) => (ground10.indices[index + k] as number) * 3);
      const x =
        ((vertices[p ?? 0] as number) +
          (vertices[q ?? 0] as number) +
          (vertices[r ?? 0] as number)) /
        3;
      const z =
        ((vertices[(p ?? 0) + 2] as number) +
          (vertices[(q ?? 0) + 2] as number) +
          (vertices[(r ?? 0) + 2] as number)) /
        3;
      asked += 1;
      if (groundUnder(ground10, bend.centre, x, z, ground())) found += 1;
    }
    expect(asked).toBeGreaterThan(1_000);
    expect(found).toBe(asked);
  });

  it('finds no ground past the mesh, rather than inventing some', () => {
    const into = ground();
    const far = corridor.centre[0] as CorridorPoint;
    expect(groundUnder(mesh, corridor.centre, far.x + 5_000, far.z, into)).toBe(false);
  });

  it('lays the blob in the ground’s plane, as long along the slope as on the flat', () => {
    const into = new Float64Array(9);
    const tilted: GroundPoint = { y: 0, nx: 0.3, ny: Math.sqrt(1 - 0.09 - 0.04), nz: 0.2 };
    groundBlobAxes({ x: 0, z: 0, yaw: 0.7, halfAlong: 5, halfAcross: 2 }, tilted, into);
    const across = [into[0], into[1], into[2]] as number[];
    const normal = [into[3], into[4], into[5]] as number[];
    const along = [into[6], into[7], into[8]] as number[];
    const dot = (a: number[], b: number[]): number =>
      (a[0] as number) * (b[0] as number) +
      (a[1] as number) * (b[1] as number) +
      (a[2] as number) * (b[2] as number);
    expect(dot(across, normal)).toBeCloseTo(0, 12);
    expect(dot(along, normal)).toBeCloseTo(0, 12);
    expect(dot(across, along)).toBeCloseTo(0, 12);
    expect(Math.sqrt(dot(along, along))).toBeCloseTo(5, 12);
    expect(Math.sqrt(dot(across, across))).toBeCloseTo(2, 12);
    // Right-handed with the normal as up: across × normal = along's direction,
    // so the quad `three-renderer.ts` winds for +Y faces the sky.
    const cross = [
      (across[1] as number) * (normal[2] as number) - (across[2] as number) * (normal[1] as number),
      (across[2] as number) * (normal[0] as number) - (across[0] as number) * (normal[2] as number),
      (across[0] as number) * (normal[1] as number) - (across[1] as number) * (normal[0] as number),
    ];
    expect(dot(cross, along)).toBeGreaterThan(0);
  });
});

/** How far a point is from the drawn centreline's chords. */
function fromTheRoad(centre: readonly CorridorPoint[], x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < centre.length; index += 1) {
    const a = centre[index] as CorridorPoint;
    const b = centre[index + 1] as CorridorPoint;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const length = abx * abx + abz * abz;
    const share =
      length > 0 ? Math.min(1, Math.max(0, ((x - a.x) * abx + (z - a.z) * abz) / length)) : 0;
    best = Math.min(best, Math.hypot(a.x + abx * share - x, a.z + abz * share - z));
  }
  return best;
}

/**
 * Every blob's points, sampled on a grid over its quad wherever it has any
 * darkness at all: how many the road clip keeps, how many of those lie on the
 * carriageway, and how many would have without the clip — the control.
 */
function sampleBlobs(
  centre: readonly CorridorPoint[],
  mesh: ReturnType<typeof terrainCorridor>,
  casters: readonly BlobCaster[],
  sun: SunStyle,
): {
  readonly drawn: number;
  readonly onRoad: number;
  readonly onRoadUnclipped: number;
  readonly clipped: number;
  readonly blobs: number;
} {
  const planes = new Float32Array(6);
  const axes = new Float64Array(9);
  const throwPerMetre = sunThrow(sun);
  let drawn = 0;
  let onRoad = 0;
  let onRoadUnclipped = 0;
  let clipped = 0;
  let blobs = 0;
  for (const caster of casters) {
    const placed = blob();
    placeGroundBlob(caster, throwPerMetre, placed);
    const under = ground();
    // The product's own choice of ground — a middle thrown over the road
    // included, which lies in its foot's plane and must be clipped too.
    if (!groundUnderBlob(mesh, centre, placed, caster, under)) continue;
    blobs += 1;
    groundBlobAxes(placed, under, axes);
    const reach = Math.max(placed.halfAlong, placed.halfAcross);
    roadClip(centre, placed.x, placed.z, reach, planes);
    // Only the chords that could come within the blob's reach of the road.
    const chords: [CorridorPoint, CorridorPoint][] = [];
    for (let index = 0; index + 1 < centre.length; index += 1) {
      const a = centre[index] as CorridorPoint;
      const b = centre[index + 1] as CorridorPoint;
      const bound = reach + ROAD_EDGE_METRES + Math.hypot(b.x - a.x, b.z - a.z);
      if (Math.hypot(a.x - placed.x, a.z - placed.z) <= bound) chords.push([a, b]);
    }
    for (let i = -10; i <= 10; i += 1) {
      for (let j = -10; j <= 10; j += 1) {
        const u = i / 10;
        const v = j / 10;
        if (groundBlobAlpha(Math.hypot(u, v)) <= 0) continue;
        // Where the fragment is from the middle, horizontally — the frame the
        // shader tests its planes in.
        const dx = (axes[0] as number) * u + (axes[6] as number) * v;
        const dz = (axes[2] as number) * u + (axes[8] as number) * v;
        const road = fromTheChords(chords, placed.x + dx, placed.z + dz) < ROAD_EDGE_METRES - 1e-6;
        if (road) onRoadUnclipped += 1;
        if (!keptByRoadClip(planes, 0, dx, dz)) {
          clipped += 1;
          continue;
        }
        drawn += 1;
        if (road) onRoad += 1;
      }
    }
  }
  return { drawn, onRoad, onRoadUnclipped, clipped, blobs };
}

/** How far a point is from the nearest of some chords. */
function fromTheChords(
  chords: readonly (readonly [CorridorPoint, CorridorPoint])[],
  x: number,
  z: number,
): number {
  let best = Number.POSITIVE_INFINITY;
  for (const [a, b] of chords) {
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const length = abx * abx + abz * abz;
    const share =
      length > 0 ? Math.min(1, Math.max(0, ((x - a.x) * abx + (z - a.z) * abz) / length)) : 0;
    best = Math.min(best, Math.hypot(a.x + abx * share - x, a.z + abz * share - z));
  }
  return best;
}

describe('a ground blob never lies on the carriageway — #620, on the hairpin', () => {
  for (const radius of [20, 10]) {
    it(`clips every blob at the road’s edge round a ${String(radius)} m hairpin, from every sun`, () => {
      const profile = hairpinRoute(radius);
      const origin = corridorOrigin(profile);
      const seed = scatterSeed(profile);
      // The rider in the bend, so the corridor holds both legs and the arc.
      const corridor = roadCorridor(profile, origin, 400 + (Math.PI * radius) / 2);
      const mesh = terrainCorridor(profile, origin, corridor, seed);
      const centre = corridor.centre;

      // The scenery the route really has there, and a dense grid of trees and
      // houses a verge's width off the road, on both legs, the outside of the
      // bend and — the case two planes are for — between the legs.
      const casters: BlobCaster[] = [];
      const bend = centre[Math.floor(centre.length / 2)] as CorridorPoint;
      const real: readonly ScatterItem[] = [
        ...scatterAt(profile, origin, seed, 250, 700, { maxItems: 100_000, riderMetres: 0 }),
        ...structuresAt(profile, origin, seed, 250, 700, { maxItems: 100_000, riderMetres: 0 }),
      ];
      for (const item of real) {
        if (Math.hypot(item.x - bend.x, item.z - bend.z) > 90) continue;
        const footprint = STRUCTURE_FOOTPRINTS[item.kind as keyof typeof STRUCTURE_FOOTPRINTS];
        casters.push(
          footprint === undefined
            ? aTree(item.x, item.z, 3 * item.scale, 9 * item.scale, item.y)
            : {
                x: item.x,
                y: item.y,
                z: item.z,
                yaw: item.rotation,
                round: false,
                halfAlong: (footprint.front - footprint.back) / 2,
                halfAcross: footprint.x,
                centreAlong: (footprint.front + footprint.back) / 2,
                height: 8,
                strength: 1,
              },
        );
      }
      for (let dx = -60; dx <= 60; dx += 2.5) {
        for (let dz = -60; dz <= 60; dz += 2.5) {
          const x = bend.x + dx;
          const z = bend.z + dz;
          const off = fromTheRoad(centre, x, z);
          if (off < ROAD_EDGE_METRES + 1 || off > ROAD_EDGE_METRES + 5) continue;
          const foot = ground();
          if (!groundUnder(mesh, centre, x, z, foot)) continue;
          casters.push(aTree(x, z, 3, 9, foot.y));
        }
      }

      const world = worldStyle(profile).sun;
      let clippedSomewhere = 0;
      let blobs = 0;
      for (const sun of [world, sunAt(55, 0), sunAt(55, 90), sunAt(55, 180), sunAt(55, 270)]) {
        const product = sampleBlobs(centre, mesh, casters, sun);
        expect(product.onRoad, 'a drawn point of a blob lies on the carriageway').toBe(0);
        expect(product.drawn).toBeGreaterThan(1_000);
        clippedSomewhere += product.clipped;
        blobs += product.blobs;
        // The control: the same blobs unclipped DO reach the road, so the zero
        // above is the clip's and not a layout that never came near it.
        expect(product.onRoadUnclipped).toBeGreaterThan(100);
      }
      expect(clippedSomewhere).toBeGreaterThan(0);
      expect(blobs).toBeGreaterThan(casters.length);
    }, 60_000);
  }

  it('clips between the legs of a tight hairpin with BOTH planes — the road on two sides', () => {
    // 10 m hairpin: the legs' edges are 13 m apart. A tree in the middle with
    // a blob 8 m long reaches both, and one plane cannot hold both off.
    const profile = hairpinRoute(10);
    const origin = corridorOrigin(profile);
    const corridor = roadCorridor(profile, origin, 300);
    const centre = corridor.centre;
    // Half-way between the two legs at 300 m up them.
    const legA = centre.reduce((best, point) =>
      Math.abs(point.distance - 300) < Math.abs(best.distance - 300) ? point : best,
    );
    const planes = new Float32Array(6);
    // The other leg is 20 m across the route's own frame from the first.
    const across = centre.filter(
      (point) =>
        Math.hypot(point.x - legA.x, point.z - legA.z) < 25 &&
        Math.abs(point.distance - legA.distance) > 50,
    );
    expect(across.length).toBeGreaterThan(0);
    const legB = across[0] as CorridorPoint;
    const midX = (legA.x + legB.x) / 2;
    const midZ = (legA.z + legB.z) / 2;
    roadClip(centre, midX, midZ, 9, planes);
    // Two real planes, neither the one that clips nothing.
    expect(Math.hypot(planes[0] as number, planes[1] as number)).toBeCloseTo(1, 6);
    expect(Math.hypot(planes[3] as number, planes[4] as number)).toBeCloseTo(1, 6);
    // Each leg's own middle is on the far side of one of the two planes.
    expect(keptByRoadClip(planes, 0, legA.x - midX, legA.z - midZ)).toBe(false);
    expect(keptByRoadClip(planes, 0, legB.x - midX, legB.z - midZ)).toBe(false);
    // And the middle itself, 10 m from each, is kept.
    expect(keptByRoadClip(planes, 0, 0, 0)).toBe(true);
  });

  it('holds a THIRD stretch of road off too, by folding it into a plane', () => {
    // Road either side of the blob, 6 m off, and a third stretch across the end
    // of the gap 7 m ahead — three separate runs of the corridor. Two are
    // planes; the third is folded into one of them, which only clips more.
    const run = (points: readonly (readonly [number, number])[]): CorridorPoint[] =>
      points.map(([x, z]) => ({
        x,
        y: 0,
        z,
        distance: 0,
        odometer: 0,
      })) as unknown as CorridorPoint[];
    const line = (x0: number, z0: number, x1: number, z1: number): [number, number][] =>
      Array.from({ length: 9 }, (_, at) => [x0 + ((x1 - x0) * at) / 8, z0 + ((z1 - z0) * at) / 8]);
    // Far apart in the list, so each is its own run: 200 m of road between them.
    const centre = [
      ...run(line(-6, -40, -6, 40)),
      ...run(line(-200, 40, -200, 300)),
      ...run(line(6, 40, 6, -40)),
      ...run(line(200, -40, 200, -300)),
      ...run(line(-2, 7, 2, 7)),
    ];
    const planes = new Float32Array(6);
    roadClip(centre, 0, 0, 12, planes);
    const road: [number, number][] = [
      [-6, 0],
      [-6 + ROAD_EDGE_METRES - 0.01, 3],
      [6, 0],
      [6 - ROAD_EDGE_METRES + 0.01, -3],
      [0, 7],
      [2, 7 - ROAD_EDGE_METRES + 0.01],
      [-2, 7 - ROAD_EDGE_METRES + 0.01],
    ];
    for (const [x, z] of road) {
      expect(keptByRoadClip(planes, 0, x, z), `road at ${String(x)}, ${String(z)}`).toBe(false);
    }
  });

  it('clips nothing off a blob that the road cannot reach', () => {
    const profile = hillRoute();
    const origin = corridorOrigin(profile);
    const corridor = roadCorridor(profile, origin, 900);
    const point = corridor.centre[40] as CorridorPoint;
    const planes = new Float32Array(6);
    roadClip(corridor.centre, point.x + 60, point.z, 5, planes);
    expect(Array.from(planes)).toEqual([0, 0, -1, 0, 0, -1]);
  });
});

/** The height of every distinct sheet of `mesh` over `(x, z)`, found by reading every triangle. */
function sheetsOver(mesh: ReturnType<typeof terrainCorridor>, x: number, z: number): number[] {
  const v = mesh.vertices;
  const heights: number[] = [];
  for (let at = 0; at < mesh.indices.length; at += 3) {
    const [p, q, r] = [0, 1, 2].map((k) => (mesh.indices[at + k] as number) * 3) as [
      number,
      number,
      number,
    ];
    const ux = (v[q] as number) - (v[p] as number);
    const uz = (v[q + 2] as number) - (v[p + 2] as number);
    const vx = (v[r] as number) - (v[p] as number);
    const vz = (v[r + 2] as number) - (v[p + 2] as number);
    const det = ux * vz - uz * vx;
    if (Math.abs(det) < 1e-9) continue;
    const wx = x - (v[p] as number);
    const wz = z - (v[p + 2] as number);
    const s = (wx * vz - wz * vx) / det;
    const t = (ux * wz - uz * wx) / det;
    if (s < 0 || t < 0 || s + t > 1) continue;
    const y =
      (v[p + 1] as number) +
      s * ((v[q + 1] as number) - (v[p + 1] as number)) +
      t * ((v[r + 1] as number) - (v[p + 1] as number));
    if (heights.every((other) => Math.abs(other - y) > 0.05)) heights.push(y);
  }
  return heights;
}

describe('which ground a blob lies on — #620, #686’s review', () => {
  it('lays a blob the sun throws over the carriageway in the plane under its caster’s foot, rather than dropping it', () => {
    const profile = hillRoute();
    const origin = corridorOrigin(profile);
    const corridor = roadCorridor(profile, origin, 900);
    const mesh = terrainCorridor(profile, origin, corridor, scatterSeed(profile));
    let laid = 0;
    for (let row = 30; row < corridor.centre.length - 30; row += 4) {
      const point = corridor.centre[row] as CorridorPoint;
      const next = corridor.centre[row + 1] as CorridorPoint;
      const length = Math.hypot(next.x - point.x, next.z - point.z);
      const rightX = -(next.z - point.z) / length;
      const rightZ = (next.x - point.x) / length;
      // A tree a metre off the LEFT edge, under a 55° sun from its left: the
      // shadow of its middle falls 3.2 m to the right, on the tarmac.
      const out = ROAD_EDGE_METRES + 1;
      const foot = ground();
      const fx = point.x - rightX * out;
      const fz = point.z - rightZ * out;
      if (!groundUnder(mesh, corridor.centre, fx, fz, foot)) continue;
      const caster = aTree(fx, fz, 3, 9, foot.y);
      const up = (55 * Math.PI) / 180;
      const sun: SunStyle = {
        x: -rightX * Math.cos(up),
        y: Math.sin(up),
        z: -rightZ * Math.cos(up),
        ambient: 0.4,
        direct: 0.6,
      };
      const placed = blob();
      placeGroundBlob(caster, sunThrow(sun), placed);
      // Non-vacuity: the middle IS over the road, where no landform is.
      expect(groundUnder(mesh, corridor.centre, placed.x, placed.z, ground())).toBe(false);
      const into = ground();
      expect(groundUnderBlob(mesh, corridor.centre, placed, caster, into)).toBe(true);
      expect(into.nx).toBeCloseTo(foot.nx, 9);
      expect(into.ny).toBeCloseTo(foot.ny, 9);
      expect(into.nz).toBeCloseTo(foot.nz, 9);
      expect(into.y).toBeCloseTo(
        foot.y - (foot.nx * (placed.x - fx) + foot.nz * (placed.z - fz)) / foot.ny,
        6,
      );
      laid += 1;
    }
    expect(laid).toBeGreaterThan(10);
  });

  it('takes the sheet nearest its caster’s foot where a hairpin’s two sheets of ground overlap', () => {
    const profile = hairpinRoute(10);
    const origin = corridorOrigin(profile);
    const seed = scatterSeed(profile);
    const bendAt = 400 + (Math.PI * 10) / 2;
    const corridor = roadCorridor(profile, origin, bendAt);
    const mesh = terrainCorridor(profile, origin, corridor, seed);
    const items = scatterAt(profile, origin, seed, bendAt - 60, bendAt + 150, {
      maxItems: 100_000,
      riderMetres: bendAt,
    });
    let overlapping = 0;
    let firstFoundWrong = 0;
    const world = worldStyle(profile).sun;
    for (const sun of [world, sunAt(55, 0), sunAt(55, 90), sunAt(55, 180), sunAt(55, 270)]) {
      for (const item of items) {
        const caster = aTree(item.x, item.z, 3 * item.scale, 9 * item.scale, item.y);
        const placed = blob();
        placeGroundBlob(caster, sunThrow(sun), placed);
        const sheets = sheetsOver(mesh, placed.x, placed.z);
        if (sheets.length < 2) continue;
        overlapping += 1;
        // The caster stands on one of them: its blob lies on the one whose
        // height is nearest the foot's.
        const nearest = sheets.reduce((best, y) =>
          Math.abs(y - item.y) < Math.abs(best - item.y) ? y : best,
        );
        const into = ground();
        expect(groundUnderBlob(mesh, corridor.centre, placed, caster, into)).toBe(true);
        expect(into.y).toBeCloseTo(nearest, 3);
        const first = ground();
        groundUnder(mesh, corridor.centre, placed.x, placed.z, first);
        if (Math.abs(first.y - nearest) > 0.05) firstFoundWrong += 1;
      }
    }
    // Non-vacuity, and the control: the overlaps are there, and the first
    // triangle found is the wrong sheet for some of them — the defect #686's
    // review measured, one blob in 29 under the visible ground.
    expect(overlapping).toBeGreaterThan(20);
    expect(firstFoundWrong).toBeGreaterThan(0);
  }, 60_000);
});

describe('a frame’s casters are made once — #620', () => {
  it('holds as many as it was made for, each its own object', () => {
    const list = blobCasters(5);
    expect(list.casters).toHaveLength(5);
    expect(new Set(list.casters).size).toBe(5);
    expect(list.count).toBe(0);
  });
});
