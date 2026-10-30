// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1782's rule for a plan that would pass a cap: an archetype's house gives
 * up its dormers first, then its porch, and is never truncated. No footprint
 * an archetype admits comes near 640 triangles (`house-archetypes.test.ts`
 * §"the caps"), so the rule is reached here by planning with the near cap
 * (`realistic-budget.ts` §`REALISTIC_TRIANGLES.structure`, which
 * `FOOTPRINT_MAX_TRIANGLES` is) lowered, through the planner the belt reads.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DOOR_FACE,
  FACADE_DOOR,
  FACADE_OFFSET,
  FOOTPRINT_VERTEX_FLOATS,
  PORCH,
  type FootprintPlan,
} from './footprint-buildings';
import { houseStreetFixture } from './footprint-fixtures-testing';

/**
 * `footprint-buildings.ts` imported afresh, its near cap `cap` triangles where
 * one is given, with the `land-class.ts` of the same fresh graph.
 */
async function plannerCapped(cap?: number): Promise<{
  readonly planner: typeof import('./footprint-buildings');
  readonly land: typeof import('./land-class');
}> {
  vi.resetModules();
  vi.doUnmock('./realistic-budget');
  if (cap !== undefined) {
    vi.doMock('./realistic-budget', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./realistic-budget')>();
      return { ...actual, REALISTIC_TRIANGLES: { ...actual.REALISTIC_TRIANGLES, structure: cap } };
    });
  }
  return { planner: await import('./footprint-buildings'), land: await import('./land-class') };
}

afterEach(() => {
  vi.doUnmock('./realistic-budget');
  vi.resetModules();
});

/**
 * Whether a plan has a door canopy: trim over its front door, above the door's
 * head and within a canopy's reach of its middle — not its gutters, under the eaves.
 */
function hasCanopy(plan: FootprintPlan): boolean {
  const at = (floats: Float32Array, vertex: number, k: number): number =>
    floats[vertex * FOOTPRINT_VERTEX_FLOATS + k] as number;
  const door = plan.triangles.door;
  const doorVertices = Array.from({ length: door.length / FOOTPRINT_VERTEX_FLOATS }, (_, v) => v)
    .filter((v) => at(door, v, FACADE_OFFSET + 2) === FACADE_DOOR)
    .map((v) => [at(door, v, 0), at(door, v, 1), at(door, v, 2)] as const);
  if (doorVertices.length === 0) return false;
  const floor = Math.min(...doorVertices.map(([, y]) => y));
  const mx = doorVertices.reduce((sum, [x]) => sum + x, 0) / doorVertices.length;
  const mz = doorVertices.reduce((sum, [, , z]) => sum + z, 0) / doorVertices.length;
  const trim = plan.triangles.trim;
  for (let v = 0; v < trim.length / FOOTPRINT_VERTEX_FLOATS; v += 1) {
    const y = at(trim, v, 1) - floor;
    const reach = Math.hypot(at(trim, v, 0) - mx, at(trim, v, 2) - mz);
    if (
      y > DOOR_FACE.height &&
      y < DOOR_FACE.height + 0.5 &&
      reach <= Math.hypot(PORCH.width / 2, PORCH.depth)
    ) {
      return true;
    }
  }
  return false;
}

const street = houseStreetFixture();
/** The street's Capes — every sixth house of its 40 from the second — each alone on the street. */
const capes = street.corridor.buildings
  .filter((_, index) => index < 40 && index % 6 === 1)
  .map((building) => ({ ...street.corridor, buildings: [building] }));

describe('a plan over a cap — #1782', () => {
  it('gives up its dormers first, then its porch, and fits each cap it is planned under', async () => {
    let both = 0;
    for (const corridor of capes) {
      const plan = async (cap?: number) => {
        const { planner, land } = await plannerCapped(cap);
        const [only] = planner.footprintPlans(
          corridor,
          land.landClassMask(corridor),
          street.profile,
          street.origin,
        ).plans;
        if (only === undefined) throw new Error('the Cape was not planned');
        return { only, cap: planner.FOOTPRINT_MAX_TRIANGLES };
      };
      const natural = (await plan()).only;
      expect(natural.archetype).toBe('cape');
      if (natural.dormers === 0) continue;

      // One triangle under: the dormers go, and nothing else.
      const noDormers = await plan(natural.triangleCount - 1);
      expect(noDormers.cap).toBe(natural.triangleCount - 1);
      expect(noDormers.only.archetype).toBe('cape');
      expect(noDormers.only.dormers).toBe(0);
      expect(noDormers.only.triangles.dormer.length).toBe(0);
      expect(noDormers.only.triangles.trim.length).toBe(natural.triangles.trim.length);
      expect(noDormers.only.triangleCount).toBeLessThanOrEqual(noDormers.cap);

      // A Cape with no canopy has no porch to give up.
      if (!hasCanopy(noDormers.only)) continue;
      const bare = await plan(noDormers.only.triangleCount - 1);
      expect(bare.only.dormers).toBe(0);
      expect(hasCanopy(bare.only)).toBe(false);
      expect(bare.only.triangles.trim.length).toBeLessThan(noDormers.only.triangles.trim.length);
      expect(bare.only.triangleCount).toBeLessThanOrEqual(bare.cap);
      // Its walls and roof are whole: nothing truncated.
      expect(bare.only.triangles.wall).toStrictEqual(natural.triangles.wall);
      expect(bare.only.triangles.roof).toStrictEqual(natural.triangles.roof);
      both += 1;
    }
    expect(both).toBeGreaterThan(0);
  });
});
