// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The wraps of the downtown kit's facade pieces, selected and drawn — #3334.
 *
 * `facade-kit-plans.test.ts` holds what a plan's wrap is. This holds what a
 * refill does with it: `mapped-buildings.ts` §`selectMappedBuildings` prices
 * a near wrapped plan at its wrap and counts the wraps' one group inside the
 * draw calls, and `three-renderer.ts` §`MappedBuildingBelt` writes it after
 * the house models in their buffer and draws it in the kit's own material.
 * The pieces are the committed GLB's (`facade-kit-testing.ts`), read back out
 * of the belt's own buffers.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  KIT_ATLAS_PIXELS,
  KIT_CELLS,
  KIT_GUTTER_PIXELS,
  KIT_PIECES,
  kitMeshIndex,
  kitPaletteOf,
} from './facade-kit';
import { committedKit } from './facade-kit-testing';
import { FOOTPRINT_VERTEX_FLOATS, footprintPlans, type FootprintPlan } from './footprint-buildings';
import { richmondStreetFixture, terraceStreetFixture } from './footprint-fixtures-testing';
import { HOUSE_MODELS } from './house-models';
import { landClassMask } from './land-class';
import {
  mappedBuildingsOf,
  MappedSelection,
  roleTriangles,
  selectMappedBuildings,
  type MappedBuildings,
  type RivalStructures,
} from './mapped-buildings';
import { nearPyramid } from './near-field';
import { PHOTOGRAPHIC_STRUCTURE_SURFACES } from './realistic-assets';
import {
  MAPPED_BUILDING_DRAW_CALLS,
  MAPPED_BUILDING_NEAR_METRES,
  MAPPED_BUILDING_MAX,
  MAPPED_BUILDING_TRIANGLES,
  MAPPED_KIT_NEAR_MAX,
  MAPPED_KIT_TRIANGLES,
  REALISTIC_KIT_WRAP_TRIANGLES,
  REALISTIC_STRUCTURE_ITEMS,
  REALISTIC_TRIANGLES,
} from './realistic-budget';
import { drawnRoadFrame } from './terrain';
import {
  kitGeometriesOf,
  MappedBuildingBelt,
  refillMappedBuildings,
  type RealisticHouses,
} from './three-renderer';
import type { UrbanClass, UrbanClassMap } from './urban-class';

function aTexture(): never {
  return { image: { width: 512, height: 512 }, dispose: () => undefined } as never;
}

const textures = new Map(
  PHOTOGRAPHIC_STRUCTURE_SURFACES.map((surface) => [
    surface,
    { colour: aTexture(), normal: aTexture() },
  ]),
);

/** Every stretch of the route `urban`. */
const everywhere = (urban: UrbanClass): UrbanClassMap => ({ classAt: () => urban });

/** #1635's terraced street, classed a town: houses in rows to 1 200 m, shops and offices beyond. */
const street = terraceStreetFixture();
const plans = footprintPlans(
  street.corridor,
  landClassMask(street.corridor),
  street.profile,
  street.origin,
  undefined,
  everywhere('town'),
).plans;
const buildings = mappedBuildingsOf(plans);

function roadAt(
  along: number,
  of: { readonly profile: typeof street.profile; readonly origin: typeof street.origin } = street,
): { readonly x: number; readonly z: number } {
  const frame = drawnRoadFrame(of.profile, of.origin, along);
  if (frame === undefined) throw new Error('the fixture road has no direction there');
  return { x: frame.x, z: frame.z };
}

/** A stand-in for each house model: one triangle, at its committed price. */
const houseAtlas = aTexture();
const kitAtlas = aTexture();
const houseModels = {
  models: HOUSE_MODELS.map((_, index) => ({
    position: Float32Array.from([index, 0, 0, index + 1, 2, 0, index, 0, 3]),
    normal: Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 1]),
    uv: Float32Array.from([0, 0, 1, 0, 0, 1]),
    triangles: 1,
  })),
  atlas: houseAtlas,
  triangles: HOUSE_MODELS.map((model) => model.triangles),
};
/** The world's houses with the COMMITTED kit: every piece as the pipeline wrote it. */
const withKit: RealisticHouses = { ...houseModels, kit: { ...committedKit(), atlas: kitAtlas } };

const belts: MappedBuildingBelt[] = [];
function aBelt(of: MappedBuildings, houses?: RealisticHouses): MappedBuildingBelt {
  const belt = new MappedBuildingBelt(of, textures, houses);
  belts.push(belt);
  return belt;
}

afterEach(() => {
  for (const belt of belts.splice(0)) belt.dispose();
});

/** How far outside `ring` the point `(x, z)` is, metres; 0 inside it. */
function outside(ring: Float32Array, x: number, z: number): number {
  let within = false;
  let nearest = Number.POSITIVE_INFINITY;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i * 2] as number;
    const zi = ring[i * 2 + 1] as number;
    const xj = ring[j * 2] as number;
    const zj = ring[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) within = !within;
    const dx = xi - xj;
    const dz = zi - zj;
    const t = Math.min(1, Math.max(0, ((x - xj) * dx + (z - zj) * dz) / (dx * dx + dz * dz)));
    nearest = Math.min(nearest, Math.hypot(xj + dx * t - x, zj + dz * t - z));
  }
  return within ? 0 : nearest;
}

/** Whether a texture coordinate is inside some piece's cell of the atlas, its gutter included. */
function inACell(u: number, v: number): boolean {
  const x = u * KIT_ATLAS_PIXELS;
  const y = v * KIT_ATLAS_PIXELS;
  return KIT_CELLS.some(
    (cell) =>
      x >= cell.x - 1e-3 &&
      x <= cell.x + cell.width + 1e-3 &&
      y >= cell.y - 1e-3 &&
      y <= cell.y + cell.height + 1e-3,
  );
}

describe('the fixture — #3334', () => {
  it('is a street of wrapped terraces, shops and offices', () => {
    const kinds = plans.map((plan) => plan.kit?.kind);
    expect(kinds.filter((kind) => kind === 'townhouse').length).toBeGreaterThan(10);
    expect(kinds.filter((kind) => kind === 'shop').length).toBeGreaterThan(5);
    expect(kinds.filter((kind) => kind === 'office').length).toBeGreaterThan(5);
    // Every wrap is priced inside one building's triangles.
    for (const plan of plans) {
      if (plan.kit === undefined) continue;
      expect(plan.kit.triangles).toBeLessThanOrEqual(REALISTIC_KIT_WRAP_TRIANGLES);
    }
    // The gutter is what a cell's edge may bleed into: the cells are that far apart.
    expect(KIT_GUTTER_PIXELS).toBe(8);
  });
});

/** The structures a refill at 1 250 m leaves the field boundaries with the kit: what `realistic-budget.ts` states. */
const FIELD_BOUNDARIES_LEFT = 5;

/**
 * The frames `realistic-budget.ts` states for the tablet check, at 1 250 m on the
 * street: billboards and procedural structures in the frame, then the buildings drawn
 * and the structures ranked in, without the kit and with it.
 */
const FRAMES = [
  [0, 0, { count: 36, rivals: 0 }, { count: 36, rivals: 0 }],
  [4, 0, { count: 36, rivals: 0 }, { count: 36, rivals: 0 }],
  [8, 6, { count: 36, rivals: 6 }, { count: 36, rivals: 6 }],
] as const;

describe('a refill’s selection, with the kit loaded — #3334', () => {
  const select = (
    kit: boolean,
    slots = MAPPED_BUILDING_DRAW_CALLS,
    rider = roadAt(1_150),
  ): MappedSelection => {
    const into = new MappedSelection();
    selectMappedBuildings(
      buildings,
      rider.x,
      rider.z,
      MAPPED_BUILDING_TRIANGLES,
      into,
      slots,
      undefined,
      undefined,
      undefined,
      kit,
    );
    return into;
  };

  it('draws a near wrapped plan as its wrap, at the wrap’s triangles, and a far one as its extrusion', () => {
    // From 70 m before the street's first house: its near rows and, past them, its far ones.
    const rider = roadAt(930);
    const selection = select(true, MAPPED_BUILDING_DRAW_CALLS, rider);
    expect(selection.kitCount).toBeGreaterThan(0);
    let kitTriangles = 0;
    let other = 0;
    let farWrapped = 0;
    let nearExtruded = 0;
    for (let at = 0; at < selection.count; at += 1) {
      const plan = plans[selection.plans[at] as number] as FootprintPlan;
      const far = selection.far[at] === 1;
      // Never a far plan, and never one with no wrap.
      if (selection.kitted[at] === 1) expect(!far && plan.kit !== undefined, String(at)).toBe(true);
      expect(selection.modelled[at]).toBe(0);
      if (selection.kitted[at] === 1) {
        kitTriangles += plan.kit?.triangles ?? NaN;
        // And its paved apron, where it has one: ground, drawn with the wrap.
        if (selection.paved[at] === 1) other += roleTriangles(plan, 'apron');
      } else other += far ? plan.farTriangleCount : plan.triangleCount;
      if (far && plan.kit !== undefined) farWrapped += 1;
      if (!far && plan.kit !== undefined && selection.kitted[at] === 0) nearExtruded += 1;
      // Near is near: a wrap is never drawn past the near level's reach.
      if (selection.kitted[at] === 1) {
        expect(
          Math.hypot(plan.centroid.x - rider.x, plan.centroid.z - rider.z),
        ).toBeLessThanOrEqual(MAPPED_BUILDING_NEAR_METRES);
      }
    }
    // A near wrapped plan is its extrusion only once the wraps' cap is reached.
    if (nearExtruded > 0) expect(selection.kitCount).toBe(MAPPED_KIT_NEAR_MAX);
    expect(selection.kitTriangles).toBe(kitTriangles);
    expect(selection.triangles).toBe(kitTriangles + other);
    expect(selection.triangles).toBeLessThanOrEqual(MAPPED_BUILDING_TRIANGLES);
    // Control: the street reaches past the near level, so some wrapped plan is drawn far.
    expect(farWrapped).toBeGreaterThan(0);
    // The wraps' one group is counted inside the draw calls.
    expect(selection.surfaces.length + 1).toBeLessThanOrEqual(MAPPED_BUILDING_DRAW_CALLS);
  });

  it('draws every wrapped plan as its extrusion where the kit is not loaded', () => {
    const selection = select(false);
    expect(selection.kitCount).toBe(0);
    expect(selection.kitTriangles).toBe(0);
    expect([...selection.kitted.subarray(0, selection.count)].every((each) => each === 0)).toBe(
      true,
    );
    let extruded = 0;
    for (let at = 0; at < selection.count; at += 1) {
      const plan = plans[selection.plans[at] as number] as FootprintPlan;
      extruded += selection.far[at] === 1 ? plan.farTriangleCount : plan.triangleCount;
    }
    expect(selection.triangles).toBe(extruded);
  });

  /**
   * A refill as `refillMappedBuildings` prices one: `billboards` taken off the
   * structure items first, and `rivals` procedural structures ranked in, every
   * 25 m out from the rider.
   */
  const refill = (
    kit: boolean,
    billboards: number,
    rivals: number,
    slots: number,
    along: number,
  ) => {
    const rider = roadAt(along);
    const into = new MappedSelection();
    selectMappedBuildings(
      buildings,
      rider.x,
      rider.z,
      Math.max(0, REALISTIC_STRUCTURE_ITEMS - billboards) * REALISTIC_TRIANGLES.structure,
      into,
      slots,
      {
        distances: Float64Array.from({ length: rivals }, (_, index) => 25 * (index + 1)),
        count: rivals,
        triangles: REALISTIC_TRIANGLES.structure,
      },
      undefined,
      undefined,
      kit,
    );
    return into;
  };

  it('prices a wrap far above the extrusion it replaces, and never above one building', () => {
    const wrapped = plans.filter((plan) => plan.kit !== undefined);
    const mean = (of: (plan: FootprintPlan) => number): number =>
      wrapped.reduce((sum, plan) => sum + of(plan), 0) / wrapped.length;
    const wraps = mean((plan) => plan.kit?.triangles ?? NaN);
    const extrusions = mean((plan) => plan.triangleCount);
    console.log(
      `#3334: a wrap averages ${wraps.toFixed(0)} triangles and its extrusion ${extrusions.toFixed(0)}`,
    );
    // Some thirty times: which is why only the nearest few are wraps at once.
    expect(wraps).toBeGreaterThan(20 * extrusions);
    for (const plan of wrapped) {
      expect(plan.kit?.triangles).toBeLessThanOrEqual(REALISTIC_KIT_WRAP_TRIANGLES);
      expect(plan.triangleCount).toBeLessThan(plan.kit?.triangles ?? NaN);
    }
  });

  it('draws the nearest six wrapped plans as wraps and every other as its extrusion, so no building goes undrawn', () => {
    expect(MAPPED_KIT_NEAR_MAX).toBe(6);
    expect(MAPPED_KIT_TRIANGLES).toBe(MAPPED_KIT_NEAR_MAX * REALISTIC_KIT_WRAP_TRIANGLES);
    // Among the shops and offices, where every plan in reach is wrapped: far more than six near.
    for (const along of [1_100, 1_150, 1_250]) {
      const rider = roadAt(along);
      const selection = select(true, MAPPED_BUILDING_DRAW_CALLS, rider);
      const without = select(false, MAPPED_BUILDING_DRAW_CALLS, rider);
      let nearWrapped = 0;
      let lastWrap = -1;
      let firstExtruded = selection.count;
      for (let at = 0; at < selection.count; at += 1) {
        const plan = plans[selection.plans[at] as number] as FootprintPlan;
        if (selection.far[at] === 1 || plan.kit === undefined) continue;
        nearWrapped += 1;
        if (selection.kitted[at] === 1) lastWrap = at;
        else firstExtruded = Math.min(firstExtruded, at);
      }
      // Control: the cap binds here.
      expect(nearWrapped, String(along)).toBeGreaterThan(MAPPED_KIT_NEAR_MAX);
      expect(selection.kitCount, String(along)).toBe(MAPPED_KIT_NEAR_MAX);
      expect(selection.kitTriangles, String(along)).toBeLessThanOrEqual(MAPPED_KIT_TRIANGLES);
      // The nearest of each side: `firstExtruded` may come before the far side's last wrap.
      expect(lastWrap, String(along)).toBeGreaterThanOrEqual(0);
      expect(firstExtruded, String(along)).toBeLessThan(selection.count);
      // And every building the frame drew without the kit, it draws with it.
      expect(selection.count, String(along)).toBe(without.count);
      expect(selection.count, String(along)).toBe(MAPPED_BUILDING_MAX);
      expect([...selection.plans.subarray(0, selection.count)]).toEqual([
        ...without.plans.subarray(0, without.count),
      ]);
    }
  });

  it('shares the six between the street’s two sides, the nearest of each in turn, though the rider rides on one', () => {
    // The street's frame at 1 250 m, and the rider 4 m off its middle: every building of the
    // near side is nearer than the one facing it.
    const frame = drawnRoadFrame(street.profile, street.origin, 1_250);
    const next = drawnRoadFrame(street.profile, street.origin, 1_251);
    if (frame === undefined || next === undefined) throw new Error('no road there');
    const [dx, dz] = [next.x - frame.x, next.z - frame.z];
    for (const off of [4, -4]) {
      const rider = { x: frame.x - dz * off, z: frame.z + dx * off };
      const selection = select(true, MAPPED_BUILDING_DRAW_CALLS, rider);
      expect(selection.kitCount).toBe(MAPPED_KIT_NEAR_MAX);
      const sides = new Map<string, number[]>();
      const nearest = new Map<string, number>();
      for (let at = 0; at < selection.count; at += 1) {
        const plan = plans[selection.plans[at] as number] as FootprintPlan;
        if (selection.far[at] === 1 || plan.kit === undefined) continue;
        // Which side of the road it stands on: the sign of its offset across it.
        const across = (plan.centroid.x - frame.x) * -dz + (plan.centroid.z - frame.z) * dx;
        const side = across > 0 ? 'one' : 'other';
        const apart = Math.hypot(plan.centroid.x - rider.x, plan.centroid.z - rider.z);
        if (selection.kitted[at] === 1) sides.set(side, [...(sides.get(side) ?? []), apart]);
        // The nearest of its side that is NOT a wrap.
        else nearest.set(side, Math.min(nearest.get(side) ?? Infinity, apart));
      }
      // Three and three, and on each side they are that side's nearest.
      expect(sides.get('one')?.length, String(off)).toBe(3);
      expect(sides.get('other')?.length, String(off)).toBe(3);
      for (const [side, wraps] of sides) {
        expect(Math.max(...wraps), `${side} ${String(off)}`).toBeLessThanOrEqual(
          nearest.get(side) ?? Infinity,
        );
      }
    }
  });

  it('holds the worst frame: the structure term’s 23 040 triangles with the kit as without it, wraps at most 18 000 of them', () => {
    // The pool is not raised, and the wraps' share leaves the rest of the frame its own.
    expect(MAPPED_BUILDING_TRIANGLES).toBe(23_040);
    expect(MAPPED_KIT_TRIANGLES).toBe(18_000);
    expect(MAPPED_BUILDING_TRIANGLES - MAPPED_KIT_TRIANGLES).toBe(5_040);
    // What a refill at 1 250 m on this street spends — [billboards, rivals], then the
    // buildings drawn and the rivals ranked in, without the kit and with it.
    for (const [billboards, rivals, without, withKit] of FRAMES) {
      const label = `${String(billboards)} billboards, ${String(rivals)} rivals`;
      const extruded = refill(false, billboards, rivals, MAPPED_BUILDING_DRAW_CALLS, 1_250);
      const wrapped = refill(true, billboards, rivals, MAPPED_BUILDING_DRAW_CALLS, 1_250);
      console.log(
        `#3334: ${label}: ${String(extruded.count)} buildings and ${String(extruded.rivals)} rivals in ${String(extruded.triangles)} triangles without the kit; ${String(wrapped.count)} and ${String(wrapped.rivals)} in ${String(wrapped.triangles)} with it (${String(wrapped.kitCount)} wraps, ${String(wrapped.kitTriangles)})`,
      );
      expect({ count: extruded.count, rivals: extruded.rivals }, label).toEqual(without);
      expect({ count: wrapped.count, rivals: wrapped.rivals }, label).toEqual(withKit);
      expect(wrapped.kitCount, label).toBeLessThanOrEqual(MAPPED_KIT_NEAR_MAX);
      expect(wrapped.kitTriangles, label).toBeLessThanOrEqual(MAPPED_KIT_TRIANGLES);
      // The ceiling is held: the buildings and the rivals ranked in are inside the frame's term.
      expect(
        wrapped.triangles + wrapped.rivals * REALISTIC_TRIANGLES.structure,
        label,
      ).toBeLessThanOrEqual(
        (REALISTIC_STRUCTURE_ITEMS - billboards) * REALISTIC_TRIANGLES.structure,
      );
    }
  });

  it('paves a wrapped shop’s apron with its wrap, in its extrusion’s own surface, and counts it', () => {
    // Among the shops, whose aprons run from their fronts to the kerb (#2848).
    const selection = select(true, MAPPED_BUILDING_DRAW_CALLS, roadAt(1_250));
    let paved = 0;
    let aprons = 0;
    for (let at = 0; at < selection.count; at += 1) {
      const plan = plans[selection.plans[at] as number] as FootprintPlan;
      if (selection.kitted[at] !== 1) continue;
      const apron = roleTriangles(plan, 'apron');
      expect(selection.paved[at], String(at)).toBe(apron > 0 ? 1 : 0);
      if (apron === 0) continue;
      paved += 1;
      aprons += apron;
      // Its surface's slot is open, though no wall of the plan is drawn in it.
      expect(selection.surfaces).toContain(plan.surfaces.wall);
    }
    expect(paved).toBeGreaterThan(0);
    // The belt draws them: the extrusions' mesh holds exactly the selection's surfaces' triangles.
    const belt = aBelt(buildings, withKit);
    const rider = roadAt(1_250);
    const stats = belt.refill(rider.x, rider.z, MAPPED_BUILDING_TRIANGLES);
    expect(stats.triangles).toBe(selection.triangles);
    expect(belt.mesh.geometry.drawRange.count).toBe((stats.triangles - stats.kitTriangles) * 3);
    // With no slot for its surface, the wrap is drawn and its apron is not.
    const one = select(true, 1, roadAt(1_250));
    expect(one.kitCount).toBeGreaterThan(0);
    expect([...one.paved.subarray(0, one.count)].every((each) => each === 0)).toBe(true);
    expect(aprons).toBeGreaterThan(0);
  });

  it('draws a wrapped plan as its extrusion where no slot is left for the wraps’ group', () => {
    // No slot at all: nothing can open a surface or a group, so nothing is drawn as a wrap.
    expect(select(true, 0).kitCount).toBe(0);
    // One slot: the wraps' group takes it, and every plan that needs a surface is passed over.
    const one = select(true, 1);
    expect(one.kitCount).toBeGreaterThan(0);
    expect(one.surfaces.length).toBe(0);
    expect(one.passed).toBeGreaterThan(0);
  });
});

describe('a wrap never costs a building, a structure or a surface — #3334', () => {
  // The Richmond street, classed a town and a city centre: house models beside wrapped shops,
  // and rivals (the procedural structures) ranked in at 20 m apart from 30 m out.
  const richmond = richmondStreetFixture();
  const classes: readonly UrbanClass[] = ['town', 'city-centre'];
  const richmondBuildings = classes.map((urban) =>
    mappedBuildingsOf(
      footprintPlans(
        richmond.corridor,
        landClassMask(richmond.corridor),
        richmond.profile,
        richmond.origin,
        undefined,
        everywhere(urban),
      ).plans,
    ),
  );
  const prices = HOUSE_MODELS.map((model) => model.triangles);
  const rivalsOf = (count: number): RivalStructures => ({
    distances: Float64Array.from({ length: count }, (_, at) => 30 + at * 20),
    count,
    triangles: REALISTIC_TRIANGLES.structure,
  });

  it('draws as many buildings, ranks in as many structures and passes over no more, than the same refill with no wrap', () => {
    let kitted = 0;
    let refills = 0;
    for (let along = 1_000; along <= 1_400; along += 10) {
      const rider = roadAt(along, richmond);
      for (const rivals of [0, 3, 6, 12].map(rivalsOf)) {
        for (const [urban, of] of richmondBuildings.entries()) {
          const pick = (kit: boolean): MappedSelection => {
            const into = new MappedSelection();
            selectMappedBuildings(
              of,
              rider.x,
              rider.z,
              MAPPED_BUILDING_TRIANGLES,
              into,
              MAPPED_BUILDING_DRAW_CALLS,
              rivals,
              prices,
              undefined,
              kit,
            );
            return into;
          };
          const bare = pick(false);
          const wrapped = pick(true);
          const where = `${String(along)} m, ${String(rivals.count)} rivals, ${String(classes[urban])}`;
          expect(wrapped.count, where).toBeGreaterThanOrEqual(bare.count);
          expect(wrapped.rivals, where).toBeGreaterThanOrEqual(bare.rivals);
          expect(wrapped.passed, where).toBeLessThanOrEqual(bare.passed);
          kitted += wrapped.kitCount;
          refills += 1;
        }
      }
    }
    // The sweep is not vacuous: wraps are drawn along it, and it is many frames.
    expect(kitted).toBeGreaterThan(0);
    expect(refills).toBeGreaterThan(100);
  });
});

describe('the kit a loaded scene is read as — #3334', () => {
  /**
   * A scene as the loader leaves one: a node for each piece that has a mesh of its own,
   * named by its id, holding `triangles`, every vertex of colour class `colourClass`.
   */
  function sceneOf(
    triangles: (id: string) => number | undefined,
    colourClass: number | null = 1,
  ): never {
    const nodes = KIT_PIECES.flatMap((piece, index) => {
      const count = kitMeshIndex(index) === index ? triangles(piece.id) : undefined;
      if (count === undefined) return [];
      const attribute = (
        size: number,
      ): { array: Float32Array; count: number; getX: () => number } => ({
        array: new Float32Array(count * 3 * size),
        count: count * 3,
        getX: () => colourClass ?? 0,
      });
      const node = {
        name: piece.id,
        isMesh: true,
        geometry: {
          index: null,
          getAttribute: (name: string) =>
            name === 'uv1' && colourClass === null
              ? undefined
              : attribute(name === 'uv' || name === 'uv1' ? 2 : 3),
        },
        traverse: (visit: (each: unknown) => void): void => {
          visit(node);
        },
      };
      return [node];
    });
    const scene = {
      name: '',
      traverse: (visit: (each: unknown) => void): void => {
        visit(scene);
        for (const node of nodes) visit(node);
      },
    };
    return scene as never;
  }
  const table = (id: string): number | undefined =>
    KIT_PIECES.find((piece) => piece.id === id)?.triangles;

  it('takes a scene whose every piece is the table’s, with a card made for each', () => {
    const kit = kitGeometriesOf(sceneOf(table));
    expect(kit?.pieces.map((piece) => piece.triangles)).toEqual(
      KIT_PIECES.map((piece) => piece.triangles),
    );
    expect(kit?.cards.map((card) => card.triangles)).toEqual(KIT_PIECES.map(() => 2));
    // A piece that wears another's mesh is that mesh, in its own cell of the atlas.
    const render = KIT_PIECES.findIndex((piece) => piece.id === 'render-window');
    const brick = KIT_PIECES.findIndex((piece) => piece.id === 'brick-window');
    expect(kit?.pieces[render]?.position).toBe(kit?.pieces[brick]?.position);
    expect(kit?.pieces[render]?.uv).not.toEqual(kit?.pieces[brick]?.uv);
    expect(inACell(kit?.pieces[render]?.uv[0] ?? NaN, kit?.pieces[render]?.uv[1] ?? NaN)).toBe(
      true,
    );
    // Every vertex carries its colour class.
    expect([...new Set(kit?.pieces[brick]?.tint)]).toEqual([1]);
  });

  it('refuses a scene whose vertices carry no colour class, or one that is no class', () => {
    expect(kitGeometriesOf(sceneOf(table, null))).toBeUndefined();
    expect(kitGeometriesOf(sceneOf(table, 4))).toBeUndefined();
    expect(kitGeometriesOf(sceneOf(table, 3))).toBeDefined();
  });

  it('refuses a scene with a piece missing, or one that is not the triangles a wrap was priced at', () => {
    // A wrap's count was planned from the table: a piece of another size would be
    // written past its building's range of the buffer.
    expect(
      kitGeometriesOf(sceneOf((id) => (id === 'metal-door' ? undefined : table(id)))),
    ).toBeUndefined();
    expect(
      kitGeometriesOf(sceneOf((id) => (id === 'brick-window' ? 173 : table(id)))),
    ).toBeUndefined();
    expect(kitGeometriesOf(sceneOf(() => undefined))).toBeUndefined();
  });
});

describe('the belt, with the committed kit — #3334', () => {
  it('writes each wrapped building’s pieces on its own footprint, after the models, in one call of its own', () => {
    const belt = aBelt(buildings, withKit);
    const rider = roadAt(1_150);
    const stats = belt.refill(rider.x, rider.z, MAPPED_BUILDING_TRIANGLES);
    expect(stats.kitted).toBeGreaterThan(0);
    expect(stats.modelled).toBe(0);
    expect(stats.drawCalls).toBeLessThanOrEqual(MAPPED_BUILDING_DRAW_CALLS);
    // The stat counts what is drawn: the extrusions' groups and the wraps' one call.
    expect(stats.drawCalls).toBe(belt.mesh.geometry.groups.length + 1);
    const geometry = belt.kitMesh.geometry;
    expect(geometry.drawRange).toEqual({ start: 0, count: stats.kitTriangles * 3 });
    expect(belt.modelMesh.geometry.drawRange.count).toBe(0);
    expect(belt.kitMesh.visible).toBe(true);
    expect(belt.modelMesh.visible).toBe(false);
    // The kit's own material, with the kit's own atlas; the models' with theirs.
    expect((belt.kitMesh.material as unknown as { map: unknown }).map).toBe(kitAtlas);
    expect((belt.modelMesh.material as unknown as { map: unknown }).map).toBe(houseAtlas);
    expect(belt.kitMesh.material).not.toBe(belt.modelMesh.material);
    const position = geometry.getAttribute('position').array;
    const normal = geometry.getAttribute('normal').array;
    const uv = geometry.getAttribute('uv').array;
    const colour = geometry.getAttribute('color').array;
    const tint = geometry.getAttribute('oylTint').array;
    let seen = 0;
    let vertices = 0;
    const shades = new Set<string>();
    const looks = new Set<string>();
    for (let place = 0; ; place += 1) {
      const drawn = belt.drawnAt(place);
      if (drawn === undefined) break;
      const plan = plans[drawn.plan] as FootprintPlan;
      if (drawn.modelAt < 0) {
        // An extrusion: far, not wrapped, or past the wraps' cap.
        if (!drawn.far && plan.kit !== undefined) expect(stats.kitted).toBe(MAPPED_KIT_NEAR_MAX);
        continue;
      }
      const wrap = plan.kit;
      if (wrap === undefined) throw new Error('a building in the wraps’ range has no wrap');
      seen += 1;
      const from = drawn.modelAt;
      const to = from + wrap.triangles * 3;
      let lowest = Infinity;
      let highest = -Infinity;
      for (let vertex = from; vertex < to; vertex += 1) {
        const x = position[vertex * 3] as number;
        const y = position[vertex * 3 + 1] as number;
        const z = position[vertex * 3 + 2] as number;
        // On its own mapped footprint, within what hangs furthest off any wall: a metre.
        expect(outside(plan.footprint, x, z)).toBeLessThanOrEqual(1.01);
        lowest = Math.min(lowest, y);
        highest = Math.max(highest, y);
        // A unit normal, and a texel inside a piece's cell of the atlas.
        expect(
          Math.hypot(
            normal[vertex * 3] as number,
            normal[vertex * 3 + 1] as number,
            normal[vertex * 3 + 2] as number,
          ),
        ).toBeCloseTo(1, 4);
        expect(inACell(uv[vertex * 2] as number, uv[vertex * 2 + 1] as number)).toBe(true);
        expect(tint[vertex]).toBe(plan.tint);
      }
      // From the plan's foot to its parapet's top.
      expect(lowest).toBeCloseTo(plan.base, 3);
      expect(highest).toBeCloseTo(plan.eaves + 0.5, 3);
      // Every vertex in one of its own three colours, or the atlas as it is; and its wall's
      // colour on some of them.
      const palette = kitPaletteOf(wrap.style.skin, plan.paint);
      const own = [[1, 1, 1], palette.wall, palette.trim, palette.accent].map((each) =>
        each.map((channel) => Math.fround(channel)).join(),
      );
      const worn = new Set<string>();
      for (let vertex = from; vertex < to; vertex += 1) {
        worn.add([...colour.slice(vertex * 3, vertex * 3 + 3)].join());
      }
      for (const each of worn) expect(own).toContain(each);
      expect(worn.has(own[1] as string)).toBe(true);
      expect(worn.size).toBeGreaterThanOrEqual(2);
      shades.add(`${wrap.style.skin} ${own[1] as string}`);
      looks.add([wrap.window, wrap.door, wrap.cornice, wrap.style.sign].join());
      vertices += to - from;
    }
    expect(seen).toBe(stats.kitted);
    expect(vertices).toBe(stats.kitTriangles * 3);
    // Not one long building: the six wraps drawn are walled in more than two colours and
    // built of more than two sets of pieces between them.
    expect(stats.kitted).toBe(MAPPED_KIT_NEAR_MAX);
    expect(shades.size).toBeGreaterThan(2);
    expect(looks.size).toBeGreaterThan(2);
  });

  it('writes a wrapped shop’s paved apron into the extrusions’ buffer, vertex for vertex, inside the draw range', () => {
    // ⚠️ Read back from the mesh's own position buffer: the draw range is summed from the
    // selection before anything is written, so it cannot tell a lost write.
    const belt = aBelt(buildings, withKit);
    const rider = roadAt(1_250);
    belt.refill(rider.x, rider.z, MAPPED_BUILDING_TRIANGLES);
    const position = belt.mesh.geometry.getAttribute('position').array;
    const drawn = belt.mesh.geometry.drawRange.count;
    /** Where the apron's vertices run, as a whole, in the buffer's drawn range; -1 if nowhere. */
    const findRun = (plan: FootprintPlan): number => {
      const floats = plan.triangles.apron;
      const vertices = floats.length / FOOTPRINT_VERTEX_FLOATS;
      for (let at = 0; at + vertices <= drawn; at += 1) {
        let same = true;
        for (let vertex = 0; same && vertex < vertices; vertex += 1) {
          for (let axis = 0; axis < 3; axis += 1) {
            if (
              position[(at + vertex) * 3 + axis] !== floats[vertex * FOOTPRINT_VERTEX_FLOATS + axis]
            ) {
              same = false;
              break;
            }
          }
        }
        if (same) return at;
      }
      return -1;
    };
    // The same refill's selection, the same places: which wraps it paved.
    const selection = new MappedSelection();
    selectMappedBuildings(
      buildings,
      rider.x,
      rider.z,
      MAPPED_BUILDING_TRIANGLES,
      selection,
      MAPPED_BUILDING_DRAW_CALLS,
      undefined,
      undefined,
      undefined,
      true,
    );
    let aprons = 0;
    for (let place = 0; place < selection.count; place += 1) {
      if (selection.kitted[place] !== 1 || selection.paved[place] !== 1) continue;
      const plan = plans[belt.drawnAt(place)?.plan as number] as FootprintPlan;
      expect(findRun(plan) >= 0, String(place)).toBe(true);
      aprons += 1;
    }
    expect(aprons).toBeGreaterThan(0);
  });

  it('draws real pieces: the wraps’ triangles are more than their cards alone, and each piece is the committed one', () => {
    const belt = aBelt(buildings, withKit);
    const rider = roadAt(1_150);
    const stats = belt.refill(rider.x, rider.z, MAPPED_BUILDING_TRIANGLES);
    let relief = 0;
    for (const index of belt.drawnPlans()) relief += plans[index]?.kit?.relief ?? 0;
    expect(relief).toBeGreaterThan(stats.kitted);
    // The pieces the belt copies are the table's, triangle for triangle.
    const kit = withKit.kit;
    KIT_PIECES.forEach((piece, at) => {
      expect(kit?.pieces[at]?.triangles, piece.id).toBe(piece.triangles);
    });
  });

  it('draws no wrap, and every building as before, where the kit is not loaded', () => {
    const rider = roadAt(1_150);
    const without = aBelt(buildings, houseModels);
    const stats = without.refill(rider.x, rider.z, MAPPED_BUILDING_TRIANGLES);
    expect(stats.kitted).toBe(0);
    expect(stats.kitTriangles).toBe(0);
    expect(without.kitMesh.geometry.drawRange.count).toBe(0);
    expect(without.kitMesh.visible).toBe(false);
    // And as a belt with no models at all draws them: the extrusions, to the vertex.
    const bare = aBelt(buildings);
    const bareStats = bare.refill(rider.x, rider.z, MAPPED_BUILDING_TRIANGLES);
    expect(stats).toEqual(bareStats);
    expect(stats.buildings).toBeGreaterThan(0);
    expect([...without.mesh.geometry.getAttribute('position').array]).toEqual([
      ...bare.mesh.geometry.getAttribute('position').array,
    ]);
  });

  it('hides a wrapped building the near plane would cut, in its own range, and writes it back', () => {
    const belt = aBelt(buildings, withKit);
    const rider = roadAt(1_150);
    belt.refill(rider.x, rider.z, MAPPED_BUILDING_TRIANGLES);
    let place = 0;
    while ((belt.drawnAt(place)?.modelAt ?? 0) < 0) place += 1;
    const drawn = belt.drawnAt(place);
    if (drawn === undefined) throw new Error('no wrap drawn');
    const plan = plans[drawn.plan] as FootprintPlan;
    const wrap = plan.kit;
    if (wrap === undefined) throw new Error('the building has no wrap');
    const array = belt.kitMesh.geometry.getAttribute('position').array;
    const whole = [...array];
    // A near pyramid 5 cm off the middle of its first wall triangle, looking into it
    // (`mapped-building-belt.test.ts` §`pyramidInside`).
    const floats = plan.triangles.wall;
    const stride = FOOTPRINT_VERTEX_FLOATS;
    const middle = (axis: number): number =>
      ((floats[axis] as number) +
        (floats[stride + axis] as number) +
        (floats[2 * stride + axis] as number)) /
      3;
    const [nx, ny, nz] = [floats[3] as number, floats[4] as number, floats[5] as number];
    const eye = { x: middle(0) + nx * 0.05, y: middle(1) + ny * 0.05, z: middle(2) + nz * 0.05 };
    const target = { x: middle(0) - nx + 0.5, y: middle(1), z: middle(2) - nz + 0.5 };
    const pyramid = nearPyramid({ eye, target }, 16 / 10);
    expect(belt.clearOf(pyramid)).toBeGreaterThan(0);
    expect(belt.hiddenAt(place)).toBe(true);
    const from = drawn.modelAt * 3;
    const to = from + wrap.triangles * 9;
    expect([...array.slice(from, to)].every((each) => each === 0)).toBe(true);
    belt.clearOf(undefined);
    expect(belt.hiddenAt(place)).toBe(false);
    expect([...array]).toEqual(whole);
  });

  it('leaves the field boundaries fewer structures than the same refill without the kit', () => {
    // `refillMappedBuildings` hands a wall, a hedge or a fence only what the buildings leave
    // (#2655): the product's own refill at 1 250 m, with nothing else in the frame.
    const rider = roadAt(1_250);
    const view = { buildings, chunk: 0, x: rider.x, z: rider.z };
    const left = (houses: RealisticHouses): number => {
      const cap = refillMappedBuildings(
        aBelt(buildings, houses),
        view,
        [],
        0,
        REALISTIC_STRUCTURE_ITEMS,
      );
      if (cap === undefined) throw new Error('a new belt refills');
      return cap;
    };
    const without = left(houseModels);
    const withTheKit = left(withKit);
    console.log(
      `#3334: the field boundaries are left ${String(without)} structures without the kit and ${String(withTheKit)} with it`,
    );
    expect(withTheKit).toBeLessThan(without);
    // The wraps' share of the pool leaves 5 040 triangles: seven structures, less what the
    // frame's other thirty buildings are.
    expect(withTheKit).toBeGreaterThanOrEqual(FIELD_BOUNDARIES_LEFT);
  });

  it('draws house models and wraps together, each in its own range of the one buffer', () => {
    // A street of narrow lots the RVA set fits, and shops: classed a town, its shops' lots
    // that no model fits are wrapped.
    const richmond = richmondStreetFixture();
    const richmondPlans = footprintPlans(
      richmond.corridor,
      landClassMask(richmond.corridor),
      richmond.profile,
      richmond.origin,
      undefined,
      everywhere('town'),
    ).plans;
    const belt = aBelt(mappedBuildingsOf(richmondPlans), withKit);
    // Among its shops: the lots the brick shop fits, and the ones it does not.
    // ⚠️ On this street the house models take most of the frame's triangles (seven of them
    // are 20 622), and a wrap is never drawn at a building's cost: at 1 250 m, among the
    // models, none is. At 1 220 m one fits beside eight models.
    const among = roadAt(1_250, richmond);
    expect(belt.refill(among.x, among.z, MAPPED_BUILDING_TRIANGLES).kitted).toBe(0);
    const rider = roadAt(1_220, richmond);
    const stats = belt.refill(rider.x, rider.z, MAPPED_BUILDING_TRIANGLES);
    expect(stats.modelled).toBeGreaterThan(0);
    expect(stats.kitted).toBeGreaterThan(0);
    expect(stats.drawCalls).toBe(belt.mesh.geometry.groups.length + 2);
    expect(stats.drawCalls).toBeLessThanOrEqual(MAPPED_BUILDING_DRAW_CALLS);
    // The models first (a stand-in triangle each), then the wraps, and no vertex in both.
    const models = belt.modelMesh.geometry.drawRange;
    const wraps = belt.kitMesh.geometry.drawRange;
    expect(models).toEqual({ start: 0, count: stats.modelled * 3 });
    expect(wraps).toEqual({ start: stats.modelled * 3, count: stats.kitTriangles * 3 });
    // One buffer between them: the same attributes, uploaded once.
    expect(belt.kitMesh.geometry.getAttribute('position')).toBe(
      belt.modelMesh.geometry.getAttribute('position'),
    );
    expect(belt.modelMesh.visible).toBe(true);
    expect(belt.kitMesh.visible).toBe(true);
    for (let place = 0; ; place += 1) {
      const drawn = belt.drawnAt(place);
      if (drawn === undefined) break;
      if (drawn.modelAt < 0) continue;
      const plan = richmondPlans[drawn.plan] as FootprintPlan;
      // A model's vertices are in the models' range and a wrap's in the wraps'.
      expect(drawn.modelAt >= wraps.start).toBe(plan.kit !== undefined);
      expect(plan.model !== undefined).toBe(plan.kit === undefined);
    }
  });
});
