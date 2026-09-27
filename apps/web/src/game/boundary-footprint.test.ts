// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every field boundary and signpost stands inside the footprint
 * `settlements.ts` keeps clear of the road — #602.
 *
 * `buildings.test.ts` holds every BUILDING vertex to
 * `settlements.ts` §`STRUCTURE_FOOTPRINTS`; nothing held the boundaries, and
 * the fence's end posts stood 6 cm past it (±4.06 m on a ±4 m footprint), so
 * `structureClearance` measured a fence piece shorter than the one drawn.
 *
 * Read through `three-renderer.ts` §`realisticStructureGeometry`, every
 * surface: a boundary's realistic shape is `BOUNDARY_STYLE`'s own parts with a
 * photograph on them, and the stylised world draws those same parts merged, so
 * one read covers both worlds' vertices.
 */

import { BoxGeometry, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';

import { isBuiltKind } from './buildings';
import { STRUCTURE_KINDS, type StructureKind } from './scatter';
import { STRUCTURE_FOOTPRINTS } from './settlements';
import { realisticStructureGeometry, realisticStructureSurfaces } from './three-renderer';

/**
 * Float slack only. A position attribute is 32-bit, so a hedge's 0.55 m
 * half-width is stored as 0.550000012 — a rounding error, where the fence's
 * 6 cm was not. A 32-bit ulp at 4 m is under half a micrometre.
 */
const TOLERANCE_METRES = 1e-6;

const BOUNDARY_KINDS = STRUCTURE_KINDS.filter((kind) => !isBuiltKind(kind));

/** Each vertex of `geometry` that lies outside `kind`'s footprint, as `x, z`. */
function outsideFootprint(kind: StructureKind, geometry: BufferGeometry): string[] {
  const footprint = STRUCTURE_FOOTPRINTS[kind];
  const position = geometry.getAttribute('position');
  const outside: string[] = [];
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    if (
      Math.abs(x) > footprint.x + TOLERANCE_METRES ||
      z < footprint.back - TOLERANCE_METRES ||
      z > footprint.front + TOLERANCE_METRES
    ) {
      outside.push(`${x.toFixed(3)}, ${z.toFixed(3)}`);
    }
  }
  return outside;
}

describe('the boundaries stand inside their footprints — #602', () => {
  it('names the four boundary kinds, so a filter that matched nothing is red', () => {
    expect([...BOUNDARY_KINDS].sort()).toEqual(['fence', 'hedge', 'signpost', 'wall']);
  });

  it.each(BOUNDARY_KINDS)('keeps every vertex of a %s inside its footprint', (kind) => {
    let vertices = 0;
    for (const surface of realisticStructureSurfaces(kind)) {
      const geometry = realisticStructureGeometry(kind, surface);
      if (geometry === undefined) continue;
      vertices += geometry.getAttribute('position').count;
      expect(outsideFootprint(kind, geometry), `${kind} ${surface}`).toEqual([]);
      geometry.dispose();
    }
    // A kind that built nothing would pass the loop above over no vertex.
    expect(vertices).toBeGreaterThan(0);
  });

  it('would report the fence as it was before #602 — the control', () => {
    // The end post exactly as `BOUNDARY_STYLE` drew it: 0.12 m square, centred
    // on the end of the 8 m run, so its outer face stood at 4.06 m.
    const oldEndPost = new BoxGeometry(0.12, 1.7, 0.12).translate(0, 0.45, 4);
    expect(outsideFootprint('fence', oldEndPost).length).toBeGreaterThan(0);
    oldEndPost.dispose();
  });
});
