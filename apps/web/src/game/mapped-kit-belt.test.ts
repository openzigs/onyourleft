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
  KIT_PAINTS,
  KIT_PIECES,
  kitPaintOf,
} from './facade-kit';
import { committedKit } from './facade-kit-testing';
import { FOOTPRINT_VERTEX_FLOATS, footprintPlans, type FootprintPlan } from './footprint-buildings';
import { richmondStreetFixture, terraceStreetFixture } from './footprint-fixtures-testing';
import { HOUSE_MODELS } from './house-models';
import { landClassMask } from './land-class';
import {
  mappedBuildingsOf,
  MappedSelection,
  selectMappedBuildings,
  type MappedBuildings,
} from './mapped-buildings';
import { nearPyramid } from './near-field';
import { PHOTOGRAPHIC_STRUCTURE_SURFACES } from './realistic-assets';
import {
  MAPPED_BUILDING_DRAW_CALLS,
  MAPPED_BUILDING_NEAR_METRES,
  MAPPED_BUILDING_TRIANGLES,
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
    // Every wrap is priced inside one structure's triangles.
    for (const plan of plans) {
      if (plan.kit === undefined) continue;
      expect(plan.kit.triangles).toBeLessThanOrEqual(REALISTIC_TRIANGLES.structure);
    }
    // The gutter is what a cell's edge may bleed into: the cells are that far apart.
    expect(KIT_GUTTER_PIXELS).toBe(8);
    // A shade is a shade: the first is the kit's own colours, and none is far from them.
    expect(KIT_PAINTS[0]).toEqual([1, 1, 1]);
    for (const shade of KIT_PAINTS) {
      for (const channel of shade) {
        expect(channel).toBeGreaterThanOrEqual(0.5);
        expect(channel).toBeLessThanOrEqual(1.5);
      }
    }
    expect(kitPaintOf(KIT_PAINTS.length + 1)).toBe(KIT_PAINTS[1]);
    expect(kitPaintOf(0)).toBe(KIT_PAINTS[0]);
  });
});

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
    for (let at = 0; at < selection.count; at += 1) {
      const plan = plans[selection.plans[at] as number] as FootprintPlan;
      const far = selection.far[at] === 1;
      expect(selection.kitted[at], String(at)).toBe(!far && plan.kit !== undefined ? 1 : 0);
      expect(selection.modelled[at]).toBe(0);
      if (selection.kitted[at] === 1) kitTriangles += plan.kit?.triangles ?? NaN;
      else other += far ? plan.farTriangleCount : plan.triangleCount;
      if (far && plan.kit !== undefined) farWrapped += 1;
      // Near is near: a wrap is never drawn past the near level's reach.
      if (selection.kitted[at] === 1) {
        expect(
          Math.hypot(plan.centroid.x - rider.x, plan.centroid.z - rider.z),
        ).toBeLessThanOrEqual(MAPPED_BUILDING_NEAR_METRES);
      }
    }
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

  it('prices a wrap far above the extrusion it replaces, and never above one structure', () => {
    // PR #3343's review: a wrap is NOT the triangles its extrusion was. It is inside the one
    // structure the frame's structure term prices a building at, which is the ceiling it holds.
    const wrapped = plans.filter((plan) => plan.kit !== undefined);
    const mean = (of: (plan: FootprintPlan) => number): number =>
      wrapped.reduce((sum, plan) => sum + of(plan), 0) / wrapped.length;
    const wraps = mean((plan) => plan.kit?.triangles ?? NaN);
    const extrusions = mean((plan) => plan.triangleCount);
    expect(wraps).toBeLessThan(10 * extrusions);
    for (const plan of wrapped) {
      expect(plan.kit?.triangles).toBeLessThanOrEqual(REALISTIC_TRIANGLES.structure);
      expect(plan.triangleCount).toBeLessThan(plan.kit?.triangles ?? NaN);
    }
  });

  it('pools the frame’s structure triangles, so a frame of billboards and rivals draws fewer buildings with the kit', () => {
    // What the kit costs where the budget binds — the figures `facade-kit.ts` states, at
    // 1 250 m on this street: [billboards, rivals], then the buildings drawn and the rivals
    // ranked in without the kit and with it. With nothing else in the frame every building is
    // still drawn; with billboards and procedural structures in it, the wraps take the
    // triangles the farthest buildings and structures were drawn in.
    for (const [billboards, rivals, without, withKit] of [
      [0, 0, { count: 36, rivals: 0 }, { count: 36, rivals: 0 }],
      [4, 0, { count: 36, rivals: 0 }, { count: 34, rivals: 0 }],
      [8, 6, { count: 36, rivals: 6 }, { count: 27, rivals: 2 }],
    ] as const) {
      const label = `${String(billboards)} billboards, ${String(rivals)} rivals`;
      const extruded = refill(false, billboards, rivals, MAPPED_BUILDING_DRAW_CALLS, 1_250);
      const wrapped = refill(true, billboards, rivals, MAPPED_BUILDING_DRAW_CALLS, 1_250);
      expect({ count: extruded.count, rivals: extruded.rivals }, label).toEqual(without);
      expect({ count: wrapped.count, rivals: wrapped.rivals }, label).toEqual(withKit);
      expect(extruded.triangles, label).toBe(2_842);
      expect(wrapped.kitCount, label).toBe(wrapped.count);
      // The ceiling is held: the buildings and the rivals ranked in are inside the frame's term.
      expect(
        wrapped.triangles + wrapped.rivals * REALISTIC_TRIANGLES.structure,
        label,
      ).toBeLessThanOrEqual(
        (REALISTIC_STRUCTURE_ITEMS - billboards) * REALISTIC_TRIANGLES.structure,
      );
    }
    expect(refill(true, 0, 0, MAPPED_BUILDING_DRAW_CALLS, 1_250).triangles).toBe(21_658);
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

describe('the kit a loaded scene is read as — #3334', () => {
  /** A scene as the loader leaves one: a node a piece, named by its id, holding `triangles`. */
  function sceneOf(triangles: (id: string) => number | undefined): never {
    const nodes = KIT_PIECES.flatMap((piece) => {
      const count = triangles(piece.id);
      if (count === undefined) return [];
      const attribute = (size: number): { array: Float32Array } => ({
        array: new Float32Array(count * 3 * size),
      });
      const node = {
        name: piece.id,
        isMesh: true,
        geometry: {
          index: null,
          getAttribute: (name: string) => attribute(name === 'uv' ? 2 : 3),
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
    for (let place = 0; ; place += 1) {
      const drawn = belt.drawnAt(place);
      if (drawn === undefined) break;
      const plan = plans[drawn.plan] as FootprintPlan;
      if (drawn.modelAt < 0) {
        // An extrusion: far, or not wrapped.
        expect(drawn.far || plan.kit === undefined).toBe(true);
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
        // On its own mapped footprint, within the deepest relief of any piece.
        expect(outside(plan.footprint, x, z)).toBeLessThanOrEqual(0.11);
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
      // In one colour, first vertex to last: the shade its wall paint chooses.
      const shade = kitPaintOf(plan.paint.wall);
      for (const vertex of [from, to - 1]) {
        for (let channel = 0; channel < 3; channel += 1) {
          expect(colour[vertex * 3 + channel]).toBeCloseTo(shade[channel] as number, 6);
        }
      }
      shades.add(shade.join());
      vertices += to - from;
    }
    expect(seen).toBe(stats.kitted);
    expect(vertices).toBe(stats.kitTriangles * 3);
    // Not one long building: the wraps drawn wear more than two shades between them.
    expect(shades.size).toBeGreaterThan(2);
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
    expect(withTheKit).toBeLessThan(without / 4);
    expect(withTheKit).toBeGreaterThanOrEqual(0);
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
    const rider = roadAt(1_250, richmond);
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
