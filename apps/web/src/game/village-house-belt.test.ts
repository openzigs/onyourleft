// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1566's belt, in Node: which village plots it draws as #1585's house models,
 * where it writes them, what it leaves the procedural belts, the structure
 * term it keeps to, and when it rewrites — `three-renderer.ts`
 * §`VillageHouseBelt`, read back off its own buffers and its own return. What
 * needs a GPU (the frame's draw calls on the village hold) is
 * `realistic-town.browser.spec.ts` §"#1566".
 */

import { afterEach, describe, expect, it } from 'vitest';

import { blobCasters } from './ground-blob';
import { lotModelPaint, lotPaint } from './building-paint';
import {
  HOUSE_MODELS,
  MAIN_STREET_MODEL,
  placeOnPlot,
  placedPoint,
  VILLAGE_HOUSE_MODELS,
} from './house-models';
import { MASONRY_TINT, packedInstanceTint } from './instance-tint';
import type { CameraPose } from './port';
import { REALISTIC_STRUCTURE_ITEMS, REALISTIC_TRIANGLES } from './realistic-budget';
import type { ScatterItem } from './scatter';
import { STRUCTURE_FOOTPRINTS } from './settlements';
import {
  appendCasters,
  realisticStructureTriangles,
  VillageHouseBelt,
  type RealisticHouses,
} from './three-renderer';

/** Looking up the road, +Z, from the origin. */
const POSE: CameraPose = {
  x: 0,
  y: 0,
  z: 0,
  headingX: 0,
  headingZ: 1,
  eyeRoadY: 0,
  targetRoadY: 0,
};

/**
 * A stand-in for each model: its committed triangle count, every vertex at
 * the model's origin but the first two — the middle of its FRONT end
 * (`+X`, `length / 2`) and of its back — so a test can find both once placed.
 */
const houses: RealisticHouses = {
  models: HOUSE_MODELS.map((model) => {
    const position = new Float32Array(model.triangles * 9);
    position[0] = model.length / 2;
    position[3] = -model.length / 2;
    position[4] = model.height;
    const normal = new Float32Array(model.triangles * 9);
    for (let at = 0; at < model.triangles * 3; at += 1) normal[at * 3] = 1;
    return {
      position,
      normal,
      uv: new Float32Array(model.triangles * 6),
      triangles: model.triangles,
    };
  }),
  atlas: { image: { width: 4, height: 4 }, dispose: () => undefined } as never,
  triangles: HOUSE_MODELS.map((model) => model.triangles),
};

const made: VillageHouseBelt[] = [];
function aBelt(models: RealisticHouses | null = houses): VillageHouseBelt {
  const belt = new VillageHouseBelt(models ?? undefined);
  made.push(belt);
  return belt;
}
afterEach(() => {
  for (const belt of made.splice(0)) belt.dispose();
});

/** A village house on the right of the road, `along` metres up it, facing the road (−X). */
function house(along: number, model = VILLAGE_HOUSE_MODELS[0] as number): ScatterItem {
  return {
    kind: 'building',
    x: 15,
    y: 1,
    z: along,
    rotation: Math.atan2(-1, 0),
    scale: 1,
    variant: 0,
    paint: lotPaint(7, Math.round(along), 1, true),
    house: model,
  };
}

/** The belt's position buffer at vertex `at`. */
function vertexAt(belt: VillageHouseBelt, at: number): readonly [number, number, number] {
  const array = belt.mesh.geometry.getAttribute('position').array;
  return [array[at * 3] ?? NaN, array[at * 3 + 1] ?? NaN, array[at * 3 + 2] ?? NaN];
}

describe('the village houses as models — #1566', () => {
  it('writes a plot’s model with its door end at the house’s front, toward the road, in one mesh', () => {
    const belt = aBelt();
    const plot = house(30);
    const procedural = belt.update([plot], POSE, REALISTIC_STRUCTURE_ITEMS);
    expect(procedural).toEqual([]);
    expect(belt.stats.houses).toBe(1);
    expect(belt.mesh.visible).toBe(true);
    const model = HOUSE_MODELS[plot.house as number];
    if (model === undefined) throw new Error('no model');
    expect(belt.mesh.geometry.drawRange.count).toBe(model.triangles * 3);
    // Its front end stands where the procedural house's front does, 4.5 m
    // nearer the road than the plot, and its back its whole length behind.
    const front = STRUCTURE_FOOTPRINTS.building.front;
    const [fx, fy, fz] = vertexAt(belt, 0);
    expect(fx).toBeCloseTo(15 - front, 5);
    expect(fz).toBeCloseTo(30, 5);
    expect(fy).toBeCloseTo(1, 5);
    const [bx, by, bz] = vertexAt(belt, 1);
    expect(bx).toBeCloseTo(15 - front + model.length, 5);
    expect(bz).toBeCloseTo(30, 5);
    expect(by).toBeCloseTo(1 + model.height, 5);
    // `house-models.ts` §`placeOnPlot` and §`placedPoint` are what it wrote.
    const placement = placeOnPlot(plot.house as number, 15, 1, 30, plot.rotation, front);
    const [px, py, pz] = placedPoint(placement, model.length / 2, 0, 0);
    expect(px).toBeCloseTo(fx, 4);
    expect(py).toBeCloseTo(fy, 4);
    expect(pz).toBeCloseTo(fz, 4);
    // The normal is turned with it: the model's +X faces the road.
    const normal = belt.mesh.geometry.getAttribute('normal').array;
    expect(normal[0]).toBeCloseTo(-1, 5);
    // Painted as a model wears its plot's wall paint, and tinted as a structure is.
    const colour = belt.mesh.geometry.getAttribute('color').array;
    const paint = lotModelPaint(plot.paint, true);
    for (const channel of [0, 1, 2]) {
      expect(colour[channel]).toBeCloseTo(paint[channel] ?? NaN, 5);
    }
    expect(belt.mesh.geometry.getAttribute('oylTint').array[0]).toBeCloseTo(
      packedInstanceTint(15, 30, MASONRY_TINT),
      3,
    );
  });

  it('hands the procedural belts every item it does not model, and the same list when it models none', () => {
    const belt = aBelt();
    const shrub: ScatterItem = { ...house(20), kind: 'shrub' };
    const behind = house(-200);
    // No near level: a house 300 m up the road, in view, is a model too.
    const far = house(300);
    const near = house(40);
    const unmodelled: ScatterItem = {
      kind: 'church',
      x: 20,
      y: 0,
      z: 50,
      rotation: 0,
      scale: 1,
      variant: 0,
    };
    const items = [shrub, behind, far, near, unmodelled];
    const procedural = belt.update(items, POSE, REALISTIC_STRUCTURE_ITEMS);
    expect(procedural).toEqual([shrub, behind, unmodelled]);
    expect(belt.stats.houses).toBe(2);
    // None modelled: the list itself, not a copy, and nothing drawn.
    const none = [shrub, behind, unmodelled];
    expect(belt.update(none, POSE, REALISTIC_STRUCTURE_ITEMS)).toBe(none);
    expect(belt.stats.houses).toBe(0);
    expect(belt.mesh.visible).toBe(false);
  });

  it('keeps to the structure term: nearest first, a procedural structure at its heaviest shape and a model at its triangles', () => {
    const price = REALISTIC_TRIANGLES.structure;
    const a = house(20, VILLAGE_HOUSE_MODELS[1]);
    const b = house(40, VILLAGE_HOUSE_MODELS[2]);
    const church: ScatterItem = {
      kind: 'church',
      x: 20,
      y: 0,
      z: 10,
      rotation: 0,
      scale: 1,
      variant: 0,
    };
    const trianglesOf = (item: ScatterItem): number =>
      HOUSE_MODELS[item.house as number]?.triangles ?? NaN;
    const steeple = realisticStructureTriangles('church');
    expect(steeple).toBeGreaterThan(0);
    expect(steeple).toBeLessThan(price);
    // The structure items at the ceiling price that hold the church and both models.
    const needed = steeple + trianglesOf(a) + trianglesOf(b);
    const both = Math.ceil(needed / price);
    const belt = aBelt();
    expect(belt.update([b, church, a], POSE, both)).toEqual([church]);
    expect(belt.stats.houses).toBe(2);
    expect(belt.stats.triangles).toBe(trianglesOf(a) + trianglesOf(b));
    expect(belt.stats.items).toBe(Math.ceil((trianglesOf(a) + trianglesOf(b)) / price));
    // THE CONTROL: one structure fewer — less than the three need — and the farther house is its kind.
    expect((both - 1) * price).toBeLessThan(needed);
    expect(belt.update([b, church, a], POSE, both - 1)).toEqual([b, church]);
    expect(belt.stats.houses).toBe(1);
    // And with no room for any model, every plot is its kind.
    expect(belt.update([b, church, a], POSE, 1)).toEqual([b, church, a]);
    expect(belt.stats.houses).toBe(0);
  });

  it('prices the church before any model, and holds the procedural belts to what is left, in their own order', () => {
    const price = REALISTIC_TRIANGLES.structure;
    const steeple = realisticStructureTriangles('church');
    const cottage = realisticStructureTriangles('building');
    const one = VILLAGE_HOUSE_MODELS[0] as number;
    const two = VILLAGE_HOUSE_MODELS[1] as number;
    const ta = HOUSE_MODELS[one]?.triangles ?? NaN;
    const tb = HOUSE_MODELS[two]?.triangles ?? NaN;
    // The church is the FARTHEST, and still priced first: room for it and one model.
    const church: ScatterItem = {
      kind: 'church',
      x: 20,
      y: 0,
      z: 100,
      rotation: 0,
      scale: 1,
      variant: 0,
    };
    const shrub: ScatterItem = {
      kind: 'shrub',
      x: 9,
      y: 0,
      z: 110,
      rotation: 0,
      scale: 1,
      variant: 0,
    };
    const near = house(20, one);
    const next = house(40, two);
    const room = Math.ceil((steeple + ta) / price);
    expect(room * price).toBeLessThan(steeple + ta + tb);
    const belt = aBelt();
    expect(belt.update([church, near, next, shrub], POSE, room)).toEqual([church, next, shrub]);
    expect(belt.stats.houses).toBe(1);
    // The church and the shrub, in the belts' order; the house left as its
    // kind only if the rest holds it.
    const left = room * price - ta - steeple;
    expect(belt.stats.procedural).toBe(left >= cottage ? 3 : 1);
    // THE CONTROL: room for both models, and the church still drawn.
    belt.update([church, near, next, shrub], POSE, Math.ceil((steeple + ta + tb) / price));
    expect(belt.stats.houses).toBe(2);
    expect(belt.stats.procedural).toBe(2);
    // With nothing modelled the budget is the rung's, untouched.
    belt.update([church, shrub], POSE, room);
    expect(belt.stats.procedural).toBe(Number.POSITIVE_INFINITY);
  });

  it('stops the procedural belts at the first structure the rest of the term cannot hold', () => {
    const price = REALISTIC_TRIANGLES.structure;
    const cottage = realisticStructureTriangles('building');
    // A model whose items at the ceiling price leave less than a house.
    const one = VILLAGE_HOUSE_MODELS.find((index) => {
      const triangles = HOUSE_MODELS[index]?.triangles ?? 0;
      return Math.ceil(triangles / price) * price - triangles < cottage;
    });
    if (one === undefined) throw new Error('every model leaves room for a house');
    const triangles = HOUSE_MODELS[one]?.triangles ?? NaN;
    const room = Math.ceil(triangles / price);
    const near = house(20, one);
    const far = house(60, one);
    const belt = aBelt();
    // The far house comes first in the list, as a belt admits.
    expect(belt.update([far, near], POSE, room)).toEqual([far]);
    expect(belt.stats.houses).toBe(1);
    expect(belt.stats.procedural).toBe(0);
    // THE CONTROL: a house's room more, and it is admitted as its kind.
    belt.update([far, near], POSE, room + Math.ceil(cottage / price));
    expect(belt.stats.procedural).toBeGreaterThanOrEqual(1);
  });

  it('draws the main-street block as the brick shop, its front where the row of shops’ is', () => {
    const belt = aBelt();
    const block: ScatterItem = {
      ...house(30, MAIN_STREET_MODEL),
      kind: 'shop-row',
      paint: lotPaint(7, 30, 1, false),
    };
    belt.update([block], POSE, REALISTIC_STRUCTURE_ITEMS);
    expect(belt.stats.houses).toBe(1);
    expect(vertexAt(belt, 0)[0]).toBeCloseTo(15 - STRUCTURE_FOOTPRINTS['shop-row'].front, 5);
    const colour = belt.mesh.geometry.getAttribute('color').array;
    expect(colour[0]).toBeCloseTo(lotModelPaint(block.paint, false)[0], 5);
  });

  it('rewrites its buffer only when the houses it models change', () => {
    const belt = aBelt();
    const items = [house(20), house(40, VILLAGE_HOUSE_MODELS[3])];
    belt.update(items, POSE, REALISTIC_STRUCTURE_ITEMS);
    expect(belt.stats.rewrites).toBe(1);
    // The same houses, as a new frame's new objects: nothing written.
    belt.update(
      items.map((item) => ({ ...item })),
      POSE,
      REALISTIC_STRUCTURE_ITEMS,
    );
    expect(belt.stats.rewrites).toBe(1);
    // THE CONTROL: another model on one plot is a rewrite.
    belt.update(
      [items[0] as ScatterItem, house(40, VILLAGE_HOUSE_MODELS[4])],
      POSE,
      REALISTIC_STRUCTURE_ITEMS,
    );
    expect(belt.stats.rewrites).toBe(2);
  });

  it('models nothing with the lever off or no models loaded, and hides itself with the world', () => {
    const items = [house(20)];
    const off = aBelt();
    off.switchOn(false);
    expect(off.update(items, POSE, REALISTIC_STRUCTURE_ITEMS)).toBe(items);
    expect(off.stats.houses).toBe(0);
    const none = aBelt(null);
    expect(none.update(items, POSE, REALISTIC_STRUCTURE_ITEMS)).toBe(items);
    const on = aBelt();
    on.update(items, POSE, REALISTIC_STRUCTURE_ITEMS);
    expect(on.mesh.visible).toBe(true);
    on.setShown(false);
    expect(on.mesh.visible).toBe(false);
    expect(on.grounded.count).toBe(0);
  });

  it('grounds each model in its own footprint, and appends the blobs after the structures’', () => {
    const belt = aBelt();
    const plot = house(30);
    belt.update([plot], POSE, REALISTIC_STRUCTURE_ITEMS);
    const model = HOUSE_MODELS[plot.house as number];
    if (model === undefined) throw new Error('no model');
    expect(belt.grounded.count).toBe(1);
    const caster = belt.grounded.casters[0];
    expect(caster?.halfAlong).toBeCloseTo(model.length / 2, 6);
    expect(caster?.halfAcross).toBeCloseTo(model.depth / 2, 6);
    expect(caster?.centreAlong).toBeCloseTo(
      STRUCTURE_FOOTPRINTS.building.front - model.length / 2,
      6,
    );
    expect(caster?.yaw).toBe(plot.rotation);
    const into = blobCasters(2);
    into.count = 1;
    appendCasters(into, belt.grounded);
    expect(into.count).toBe(2);
    expect(into.casters[1]?.halfAlong).toBeCloseTo(model.length / 2, 6);
    // Never past its room.
    appendCasters(into, belt.grounded);
    expect(into.count).toBe(2);
  });
});
