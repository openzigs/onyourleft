// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The hedge's shape — #1617: rounded and irregular, its ends tapering, in
 * place of the box a short stretch of #1542's `hedge-breaks` read as.
 *
 * Read through the two paths a frame draws a hedge by: the realistic belt's
 * geometry (`three-renderer.ts` §`realisticStructureGeometry`, its one
 * surface, `hedge`) and the stylised belt's one instanced mesh
 * (`ScatterBelt.meshesOf`). Through the geometry's own accessors rather than
 * by importing three here: `three-seam.test.ts` allows one file to name it.
 */

import { describe, expect, it } from 'vitest';

import { REALISTIC_TRIANGLES } from './realistic-budget';
import { BOUNDARY_PIECE_METRES, STRUCTURE_FOOTPRINTS } from './settlements';
import {
  ScatterBelt,
  realisticStructureGeometry,
  realisticStructureSurfaces,
} from './three-renderer';

interface Readable {
  readonly count: number;
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
}

interface Shape {
  readonly triangles: number;
  readonly points: readonly (readonly [x: number, y: number, z: number])[];
}

function shapeOf(geometry: {
  getAttribute(name: string): unknown;
  readonly index: { readonly count: number } | null;
}): Shape {
  const position = geometry.getAttribute('position') as Readable;
  const points: [number, number, number][] = [];
  for (let at = 0; at < position.count; at += 1) {
    points.push([position.getX(at), position.getY(at), position.getZ(at)]);
  }
  const triangles = (geometry.index?.count ?? position.count) / 3;
  return { triangles, points };
}

/** The highest point and the widest, of the points whose `z` `where` admits. */
function reachOf(
  shape: Shape,
  where: (z: number) => boolean,
): { readonly top: number; readonly half: number } {
  let top = Number.NEGATIVE_INFINITY;
  let half = 0;
  for (const [x, y, z] of shape.points) {
    if (!where(z)) continue;
    top = Math.max(top, y);
    half = Math.max(half, Math.abs(x));
  }
  return { top, half };
}

/** Each ring's top: the highest point at each `z`, along the run. */
function topsAlong(shape: Shape): number[] {
  const byZ = new Map<string, number>();
  for (const [, y, z] of shape.points) {
    const key = z.toFixed(3);
    byZ.set(key, Math.max(byZ.get(key) ?? Number.NEGATIVE_INFINITY, y));
  }
  return [...byZ.entries()].sort(([a], [b]) => Number(a) - Number(b)).map(([, top]) => top);
}

function realisticHedge(): Shape {
  expect(realisticStructureSurfaces('hedge')).toEqual(['hedge']);
  const geometry = realisticStructureGeometry('hedge', 'hedge');
  if (geometry === undefined) throw new Error('no realistic hedge');
  const shape = shapeOf(geometry);
  geometry.dispose();
  return shape;
}

function stylisedHedge(): Shape {
  const belt = new ScatterBelt(new Map());
  const meshes = belt.meshesOf('hedge');
  expect(meshes).toHaveLength(1);
  const shape = shapeOf((meshes[0] as { geometry: Parameters<typeof shapeOf>[0] }).geometry);
  belt.dispose();
  return shape;
}

describe('the hedge’s shape — #1617', () => {
  const half = BOUNDARY_PIECE_METRES / 2;
  const middle = (z: number): boolean => Math.abs(z) < half - 2;
  const ends = (z: number): boolean => Math.abs(z) > half - 0.5;

  it.each([
    ['realistic', realisticHedge],
    ['stylised', stylisedHedge],
  ] as const)(
    'draws the %s hedge rounded and irregular, its ends tapering, not as a box',
    (_, of) => {
      const shape = of();
      // A box is 12 triangles and 8 corners (24 vertices with its normals).
      expect(shape.triangles).toBeGreaterThan(100);
      // The ends taper: lower and narrower than the middle.
      const inMiddle = reachOf(shape, middle);
      const atEnds = reachOf(shape, ends);
      expect(atEnds.top).toBeLessThan(0.8 * inMiddle.top);
      expect(atEnds.half).toBeLessThan(0.8 * inMiddle.half);
      // The top is irregular along the middle of the run: no two neighbouring
      // rings the same height, and lumps of more than 10 cm.
      const tops = topsAlong(shape).filter((_, at, all) => at > 2 && at < all.length - 3);
      expect(tops.length).toBeGreaterThan(6);
      expect(Math.max(...tops) - Math.min(...tops)).toBeGreaterThan(0.1);
      for (let at = 1; at < tops.length; at += 1) {
        expect(Math.abs((tops[at] as number) - (tops[at - 1] as number))).toBeGreaterThan(1e-3);
      }
      // Rounded across: between its widest and its top, points that are neither.
      const shoulders = shape.points.filter(
        ([x, y, z]) => middle(z) && Math.abs(x) > 0.15 && Math.abs(x) < 0.45 && y > 0.6 && y < 1.2,
      );
      expect(shoulders.length).toBeGreaterThan(0);
    },
  );

  it('keeps it inside the box it replaces, under a structure’s triangles, the same in both worlds', () => {
    const realistic = realisticHedge();
    const stylised = stylisedHedge();
    expect(realistic.triangles).toBe(stylised.triangles);
    expect(realistic.triangles).toBeLessThanOrEqual(REALISTIC_TRIANGLES.structure);
    const footprint = STRUCTURE_FOOTPRINTS.hedge;
    for (const [x, y, z] of realistic.points) {
      expect(Math.abs(x)).toBeLessThanOrEqual(footprint.x + 1e-6);
      expect(z).toBeGreaterThanOrEqual(footprint.back - 1e-6);
      expect(z).toBeLessThanOrEqual(footprint.front + 1e-6);
      expect(y).toBeLessThanOrEqual(1.3 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(-0.5 - 1e-6);
    }
    // Non-vacuity: it still reaches its box's top and width in the middle.
    const inMiddle = reachOf(realistic, middle);
    expect(inMiddle.top).toBeGreaterThan(1.1);
    expect(inMiddle.half).toBeGreaterThan(0.45);
  });
});
