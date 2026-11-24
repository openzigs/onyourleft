// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #3107: the mapped buildings' materials are made once for a world and
 * shared by every belt it builds (`three-renderer.ts`
 * §`mappedBuildingMaterials`).
 *
 * A belt is one set of buildings', and an open-world ride plans the buildings
 * round the rider again as it goes, so its belt is built again and again.
 * Each belt made and disposed of its own materials, and three keeps a program
 * only while a material uses it: every new belt linked its programs again,
 * mid-ride. jsdom has no GL context to count a link on, so this holds what a
 * link follows from: that a belt handed materials draws in exactly those,
 * that disposing of it leaves them be, and that a belt handed none still owns
 * and disposes of its own. That the realistic world's drawing hands every
 * belt it builds the one set is `realistic-textures.test.ts`'s, which loads
 * the world.
 */

import { describe, expect, it } from 'vitest';

import { mappedBuildingsOf } from './mapped-buildings';
import {
  MappedBuildingBelt,
  mappedBuildingMaterials,
  mappedBuildingWarmUp,
} from './three-renderer';

/** A material, as far as this file reads one: `three-seam.test.ts` keeps `three` to the renderer. */
type Material = MappedBuildingBelt['modelMesh']['material'] extends infer Held
  ? Held extends readonly unknown[]
    ? never
    : Held
  : never;

/** The materials a belt's two meshes draw in. */
function drawnIn(belt: MappedBuildingBelt): Set<Material> {
  const surfaces = belt.mesh.material;
  return new Set([
    ...(Array.isArray(surfaces) ? surfaces : [surfaces]),
    belt.modelMesh.material as Material,
  ]);
}

/** Which of `materials` have been disposed of, counted as three reports it. */
function disposals(materials: Iterable<Material>): { count: number } {
  const seen = { count: 0 };
  for (const material of materials) {
    material.addEventListener('dispose', () => {
      seen.count += 1;
    });
  }
  return seen;
}

describe('the mapped buildings’ materials outlive a belt — #3107', () => {
  it('two belts handed one set of materials draw in exactly those, and disposing of a belt leaves them be', () => {
    const shared = mappedBuildingMaterials(new Map());
    const all = new Set<Material>([...shared.surfaces.values(), shared.models]);
    const disposed = disposals(all);
    // One set of buildings, then another: an open-world ride's next plan.
    const first = new MappedBuildingBelt(mappedBuildingsOf([]), new Map(), undefined, shared);
    for (const material of drawnIn(first)) expect(all.has(material)).toBe(true);
    expect(first.modelMesh.material).toBe(shared.models);
    first.dispose();
    expect(disposed.count).toBe(0);
    const second = new MappedBuildingBelt(mappedBuildingsOf([]), new Map(), undefined, shared);
    // The same objects: no material is new, so no program is.
    const before = drawnIn(first);
    const after = drawnIn(second);
    expect(after.size).toBe(before.size);
    for (const material of after) expect(before.has(material)).toBe(true);
    second.dispose();
    expect(disposed.count).toBe(0);
  });

  it('a belt handed none makes its own, and disposes of them with itself', () => {
    const belt = new MappedBuildingBelt(mappedBuildingsOf([]), new Map());
    const own = drawnIn(belt);
    expect(own.size).toBeGreaterThan(0);
    const disposed = disposals(own);
    belt.dispose();
    expect(disposed.count).toBe(own.size);
    // And another's are other objects.
    const other = new MappedBuildingBelt(mappedBuildingsOf([]), new Map());
    for (const material of drawnIn(other)) expect(own.has(material)).toBe(false);
    other.dispose();
  });

  it('the warm-up meshes wear every material, on a belt’s own attributes, and draw nothing', () => {
    // PR #3117's review: an open-world ride's first frame carries no building,
    // so `prepare` compiles the buildings' programs from these. Three keys a
    // program on the material and on what its geometry carries.
    const shared = mappedBuildingMaterials(new Map());
    const warmUp = mappedBuildingWarmUp(shared);
    const belt = new MappedBuildingBelt(mappedBuildingsOf([]), new Map(), undefined, shared);
    const carried = (mesh: MappedBuildingBelt['mesh']): string[] =>
      Object.entries(mesh.geometry.attributes)
        .map(([name, attribute]) => `${name}:${String(attribute.itemSize)}`)
        .sort();
    expect(carried(warmUp.surfaces)).toStrictEqual(carried(belt.mesh));
    expect(carried(warmUp.models)).toStrictEqual(carried(belt.modelMesh));
    // Every surface's material, not only the six a belt's refill opens.
    const worn = warmUp.surfaces.material;
    expect(new Set(Array.isArray(worn) ? worn : [worn])).toStrictEqual(
      new Set(shared.surfaces.values()),
    );
    expect(shared.surfaces.size).toBeGreaterThan(6);
    expect(warmUp.models.material).toBe(shared.models);
    // And nothing is drawn from them: hidden, with no vertex.
    for (const mesh of [warmUp.surfaces, warmUp.models]) {
      expect(mesh.visible).toBe(false);
      expect(mesh.geometry.getAttribute('position').count).toBe(0);
    }
    belt.dispose();
  });
});
