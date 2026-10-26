// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1585: the house models — what the committed GLBs are, which footprints
 * they fit, and how one is laid on its footprint. Read back off the committed
 * bytes and off the plans the ride really makes.
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { footprintPlans, minimumAreaRectangle } from './footprint-buildings';
import {
  buildingBeside,
  mixedTownFixture,
  rectangleBeside,
  richmondStreetFixture,
} from './footprint-fixtures-testing';
import {
  frontOf,
  HOUSE_FIT,
  HOUSE_MODELS,
  houseModelFits,
  houseModelsFitting,
  MAIN_STREET_MODEL,
  placedPoint,
  placeHouseModel,
  placeOnPlot,
  plotModelFootprint,
  VILLAGE_HOUSE_MODELS,
  type HouseFitInput,
} from './house-models';
import { landClassMask } from './land-class';
import { drawnRoadFrame } from './terrain';
import { readGlb } from './model-bytes-testing';
import {
  houseModelFile,
  REALISTIC_HOUSE_ATLAS,
  REALISTIC_HOUSE_MODEL_IDS,
  realisticFiles,
} from './realistic-assets';
import {
  DEVICE_BYTES_PER_TEXEL,
  estimatedTextureBytes,
  REALISTIC_HOUSE_MODEL_SURFACES,
} from './realistic-budget';
import { fileKtx2Facts, modelFacts } from './realistic-bytes-testing';

const SHIPPED = fileURLToPath(new URL('../../public/realistic/', import.meta.url));
const at = (file: string): string => join(SHIPPED, file);

/** A GLB's one mesh's extent, from its POSITION accessor's own bounds. */
function extentOf(file: string): { min: number[]; max: number[] } {
  const json = readGlb(at(file)).json as unknown as {
    meshes: { primitives: { attributes: Record<string, number> }[] }[];
    accessors: { min?: number[]; max?: number[] }[];
  };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) {
      const accessor = json.accessors[primitive.attributes['POSITION'] as number];
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis] as number, accessor?.min?.[axis] ?? Infinity);
        max[axis] = Math.max(max[axis] as number, accessor?.max?.[axis] ?? -Infinity);
      }
    }
  }
  return { min, max };
}

describe('the committed house models — #1585', () => {
  it('names every model the set ships, in the order the realistic set lists them', () => {
    expect(HOUSE_MODELS.map((model) => model.id)).toEqual([...REALISTIC_HOUSE_MODEL_IDS]);
    expect(realisticFiles()).toEqual(
      expect.arrayContaining([
        ...REALISTIC_HOUSE_MODEL_IDS.map(houseModelFile),
        REALISTIC_HOUSE_ATLAS,
      ]),
    );
  });

  it.each(HOUSE_MODELS.map((model) => [model.id, model] as const))(
    '%s: is the size, the triangles and the stance its row says',
    (_, model) => {
      const file = houseModelFile(model.id);
      const facts = modelFacts(at(file));
      expect(facts.triangles).toBe(model.triangles);
      // Geometry only: the atlas is the one material's map.
      expect(facts.images).toEqual([]);
      const { min, max } = extentOf(file);
      expect((max[0] as number) - (min[0] as number)).toBeCloseTo(model.length, 3);
      expect((max[1] as number) - (min[1] as number)).toBeCloseTo(model.height, 3);
      expect((max[2] as number) - (min[2] as number)).toBeCloseTo(model.depth, 3);
      // Its footprint centred on the origin and its foot at y = 0, long axis X.
      expect((min[0] as number) + (max[0] as number)).toBeCloseTo(0, 3);
      expect((min[2] as number) + (max[2] as number)).toBeCloseTo(0, 3);
      expect(min[1]).toBeCloseTo(0, 4);
      expect(model.length).toBeGreaterThan(model.depth);
    },
  );

  it('pools the structure term rather than fitting 640 each, and stays inside its own byte ceilings', () => {
    // The owner's ruling: more than 640 each, and every one under the whole term.
    for (const model of HOUSE_MODELS) {
      expect(model.triangles, model.id).toBeGreaterThan(640);
      expect(model.triangles, model.id).toBeLessThan(23_040);
    }
    const atlas = fileKtx2Facts(at(REALISTIC_HOUSE_ATLAS));
    expect(atlas.scheme).toBe('etc1s');
    expect(atlas.alpha).toBe(false);
    expect(atlas.transfer).toBe('srgb');
    const memory = estimatedTextureBytes({
      ...atlas,
      bytesPerTexel: DEVICE_BYTES_PER_TEXEL.etc1s,
      mipmapped: true,
    });
    const build = [...REALISTIC_HOUSE_MODEL_IDS.map(houseModelFile), REALISTIC_HOUSE_ATLAS].reduce(
      (sum, file) => sum + statSync(at(file)).size,
      0,
    );
    console.log(
      `#1585: the house models are ${(memory / 2 ** 20).toFixed(2)} MiB estimated on the tablet and ${String(build)} bytes in the build`,
    );
    expect(memory).toBeLessThanOrEqual(REALISTIC_HOUSE_MODEL_SURFACES.textureBytes);
    expect(build).toBeLessThanOrEqual(REALISTIC_HOUSE_MODEL_SURFACES.buildBytes);
  });
});

/** The first RVA house: 20.6 m by 7.4 m, its front on an end, two storeys. */
const house = HOUSE_MODELS.findIndex((model) => model.id === 'rva_detached_house_04a');
const houseModel = HOUSE_MODELS[house] as (typeof HOUSE_MODELS)[number];
const fitsExactly: HouseFitInput = {
  long: houseModel.length,
  short: houseModel.depth,
  rectangularity: 1,
  storeys: 2,
  use: 'residential',
  front: 'end',
};

describe('the fit — #1585', () => {
  it('takes a footprint the model’s own size', () => {
    expect(houseModelFits(houseModel, fitsExactly)).toBe(true);
  });

  it.each([
    ['too short', { long: houseModel.length * (HOUSE_FIT.stretch.least - 0.01) }],
    ['too long', { long: houseModel.length * (HOUSE_FIT.stretch.most + 0.01) }],
    ['too narrow', { short: houseModel.depth * (HOUSE_FIT.stretch.least - 0.01) }],
    ['too wide', { short: houseModel.depth * (HOUSE_FIT.stretch.most + 0.01) }],
    ['an L', { rectangularity: HOUSE_FIT.rectangularity - 0.01 }],
    ['two storeys too tall', { storeys: 2 + HOUSE_FIT.storeys + 1 }],
    ['on commercial land', { use: 'commercial' }],
    ['its door on a side', { front: 'side' as const }],
    ['without a door', { front: undefined }],
  ])('refuses a footprint %s', (_, change) => {
    expect(houseModelFits(houseModel, { ...fitsExactly, ...change })).toBe(false);
  });

  it('takes each term’s bound itself', () => {
    // A hair inside each bound: 20.6 × 0.8 / 20.6 is not 0.8 in floating point.
    const least = HOUSE_FIT.stretch.least + 1e-9;
    const most = HOUSE_FIT.stretch.most - 1e-9;
    for (const change of [
      { long: houseModel.length * least },
      { long: houseModel.length * most },
      { short: houseModel.depth * least },
      { short: houseModel.depth * most },
      { rectangularity: HOUSE_FIT.rectangularity },
      { storeys: 2 + HOUSE_FIT.storeys },
      { storeys: 2 - HOUSE_FIT.storeys },
    ]) {
      expect(
        houseModelFits(houseModel, { ...fitsExactly, ...change }),
        JSON.stringify(change),
      ).toBe(true);
    }
  });

  it('gives the shop only to commercial land, and the side-door house only to a side door', () => {
    const shop = HOUSE_MODELS.findIndex((model) => model.use === 'commercial');
    const side = HOUSE_MODELS.findIndex((model) => model.front === 'side');
    const shopModel = HOUSE_MODELS[shop] as (typeof HOUSE_MODELS)[number];
    const sideModel = HOUSE_MODELS[side] as (typeof HOUSE_MODELS)[number];
    expect(
      houseModelsFitting({
        long: shopModel.length,
        short: shopModel.depth,
        rectangularity: 1,
        storeys: 3,
        use: 'commercial',
        front: 'end',
      }),
    ).toEqual([shop]);
    expect(
      houseModelsFitting({
        long: sideModel.length,
        short: sideModel.depth,
        rectangularity: 1,
        storeys: 2,
        use: 'residential',
        front: 'side',
      }),
    ).toEqual([side]);
  });
});

describe('laying a model on its footprint — #1585', () => {
  const rectangle = { cx: 100, cz: -40, ux: 0.6, uz: 0.8, halfLong: 11, halfShort: 4 };

  it('turns an end-door model’s front to the end the door is on, either way along', () => {
    const toward = placeHouseModel(house, rectangle, 0.6, 0.8, 5);
    expect([toward.ax, toward.az]).toEqual([0.6, 0.8]);
    const away = placeHouseModel(house, rectangle, -0.6, -0.8, 5);
    expect([away.ax, away.az]).toEqual([-0.6, -0.8]);
  });

  it('turns a side-door model’s front (+Z) to the side the door is on, and never mirrors it', () => {
    const side = HOUSE_MODELS.findIndex((model) => model.front === 'side');
    for (const sign of [1, -1]) {
      // The door's outward normal across the long axis.
      const nx = -0.8 * sign;
      const nz = 0.6 * sign;
      const placed = placeHouseModel(side, rectangle, nx, nz, 0);
      const [frontX, , frontZ] = placedPoint(placed, 0, 0, 1);
      const [middleX, , middleZ] = placedPoint(placed, 0, 0, 0);
      const dx = frontX - middleX;
      const dz = frontZ - middleZ;
      expect((dx * nx + dz * nz) / Math.hypot(dx, dz)).toBeCloseTo(1, 6);
      // A turn about the vertical: +X then +Z is the same handedness as x then z.
      const [alongX, , alongZ] = placedPoint(placed, 1, 0, 0);
      const ex = alongX - middleX;
      const ez = alongZ - middleZ;
      expect(ex * dz - ez * dx).toBeGreaterThan(0);
    }
  });

  it('stretches the model’s footprint onto the rectangle, corner to corner, and stands it at its foot', () => {
    const placed = placeHouseModel(house, rectangle, 0.6, 0.8, 7.5);
    const corners = [
      [houseModel.length / 2, houseModel.depth / 2],
      [-houseModel.length / 2, houseModel.depth / 2],
      [houseModel.length / 2, -houseModel.depth / 2],
      [-houseModel.length / 2, -houseModel.depth / 2],
    ] as const;
    for (const [x, z] of corners) {
      const [px, py, pz] = placedPoint(placed, x, 0, z);
      expect(py).toBe(7.5);
      const along = (px - rectangle.cx) * rectangle.ux + (pz - rectangle.cz) * rectangle.uz;
      const across = -(px - rectangle.cx) * rectangle.uz + (pz - rectangle.cz) * rectangle.ux;
      expect(Math.abs(along)).toBeCloseTo(rectangle.halfLong, 6);
      expect(Math.abs(across)).toBeCloseTo(rectangle.halfShort, 6);
    }
  });

  it('calls a door within 45° of the long axis an end door', () => {
    expect(frontOf(rectangle, 0.6, 0.8)).toBe('end');
    expect(frontOf(rectangle, -0.8, 0.6)).toBe('side');
  });
});

describe('the plans a ride makes — #1585', () => {
  /** The ride's plans, and how many of them are drawn as models. */
  function modelledOf(fixture: ReturnType<typeof mixedTownFixture>): {
    plans: ReturnType<typeof footprintPlans>['plans'];
    modelled: number;
  } {
    const { plans } = footprintPlans(
      fixture.corridor,
      landClassMask(fixture.corridor),
      fixture.profile,
      fixture.origin,
    );
    return { plans, modelled: plans.filter((plan) => plan.model !== undefined).length };
  }

  it('draws a Richmond street’s narrow lots as the RVA set and its shops as the shop, and its square lots as extrusions', () => {
    const { plans, modelled } = modelledOf(richmondStreetFixture());
    expect(plans.length).toBe(80);
    for (const plan of plans) {
      const rectangle = minimumAreaRectangle(plan.footprint);
      const long = 2 * rectangle.halfLong;
      const model = HOUSE_MODELS[plan.model?.model ?? -1];
      if (long < 15) {
        // The square lots: no model fits.
        expect(plan.model).toBeUndefined();
        continue;
      }
      expect(model?.use).toBe(long > 22 ? 'commercial' : 'residential');
    }
    // Two lots in three, both sides.
    expect(modelled).toBe(54);
    // Seeded among the fits: more than one model on the street.
    expect(new Set(plans.map((plan) => plan.model?.model)).size).toBeGreaterThan(3);
  });

  it('turns every modelled house on the Richmond street to face the road', () => {
    const fixture = richmondStreetFixture();
    const { plans } = modelledOf(fixture);
    // The fixture's road is straight: how far out from it a point is.
    const road = drawnRoadFrame(fixture.profile, fixture.origin, 1_000);
    if (road === undefined) throw new Error('no road');
    const out = (x: number, z: number): number =>
      Math.abs((x - road.x) * road.normalX + (z - road.z) * road.normalZ);
    for (const plan of plans) {
      const placed = plan.model;
      if (placed === undefined) continue;
      // The model's front (+X, its end) is nearer the road than its middle,
      // by the whole step, so the front faces the road square on.
      const [fx, , fz] = placedPoint(placed, 1, 0, 0);
      const [mx, , mz] = placedPoint(placed, 0, 0, 0);
      expect(out(mx, mz) - out(fx, fz)).toBeCloseTo(placed.stretchX, 3);
    }
  });

  it('never draws a building part, which stands on another, as a model', () => {
    const street = richmondStreetFixture();
    const lot = rectangleBeside(1_100, 21.5, 7, 19);
    const plansOf = (part?: {
      readonly minHeightMetres: number;
    }): ReturnType<typeof footprintPlans>['plans'] =>
      footprintPlans(
        {
          ...street.corridor,
          buildings: [buildingBeside(street.profile, street.origin, [lot], null, part)],
        },
        landClassMask(street.corridor),
        street.profile,
        street.origin,
      ).plans;
    expect(plansOf()[0]?.model).toBeDefined();
    const [raised] = plansOf({ minHeightMetres: 3 });
    expect(raised).toBeDefined();
    expect(raised?.model).toBeUndefined();
  });

  it('states how many of #1581’s mixed town it accepts', () => {
    const { plans, modelled } = modelledOf(mixedTownFixture());
    console.log(
      `#1585: the mixed town's ${String(plans.length)} plans, ${String(modelled)} drawn as models`,
    );
    // The mixed town's houses are 6–14 m by 6–12 m and square-ish; the RVA
    // set is 18–21 m by 6.6–7.4 m. Only its longest, narrowest fit.
    expect(modelled).toBe(MIXED_TOWN_MODELLED);
    for (const plan of plans) {
      if (plan.model === undefined) continue;
      const model = HOUSE_MODELS[plan.model.model] as (typeof HOUSE_MODELS)[number];
      const rectangle = minimumAreaRectangle(plan.footprint);
      expect(2 * rectangle.halfLong).toBeGreaterThanOrEqual(
        model.length * HOUSE_FIT.stretch.least - 1e-6,
      );
    }
  });
});

/** How many of the mixed town's plans fit a model, as measured. */
const MIXED_TOWN_MODELLED = 0;

describe('a model on a procedural plot — #1566', () => {
  it('offers a village house every end-fronted residential model, eleven, and its block the shop', () => {
    expect(VILLAGE_HOUSE_MODELS).toHaveLength(11);
    for (const index of VILLAGE_HOUSE_MODELS) {
      expect(HOUSE_MODELS[index]?.use).toBe('residential');
      expect(HOUSE_MODELS[index]?.front).toBe('end');
    }
    // The side-fronted one is 19 m along its door: wider than a plot's 18.
    const side = HOUSE_MODELS.findIndex((model) => model.front === 'side');
    expect(VILLAGE_HOUSE_MODELS).not.toContain(side);
    expect(HOUSE_MODELS[MAIN_STREET_MODEL]?.id).toBe('old_american_brick_shop');
  });

  it('stands its front end where the building’s front is, its length behind, turned to the road and never stretched', () => {
    const index = VILLAGE_HOUSE_MODELS[3] as number;
    const model = HOUSE_MODELS[index];
    if (model === undefined) throw new Error('no model');
    // An item at (10, 2, 40) facing +X — toward a road on its right.
    const rotation = Math.PI / 2;
    const placement = placeOnPlot(index, 10, 2, 40, rotation, 4.5);
    expect(placement.stretchX).toBe(1);
    expect(placement.stretchZ).toBe(1);
    const front = placedPoint(placement, model.length / 2, 0, model.depth / 2);
    expect(front[0]).toBeCloseTo(14.5, 9);
    expect(front[1]).toBeCloseTo(2, 9);
    expect(Math.abs(front[2] - 40)).toBeCloseTo(model.depth / 2, 9);
    const back = placedPoint(placement, -model.length / 2, 0, 0);
    expect(back[0]).toBeCloseTo(14.5 - model.length, 9);
    expect(back[2]).toBeCloseTo(40, 9);
    // The footprint it is held to says the same, in the item's frame.
    expect(plotModelFootprint(index, 4.5)).toEqual({
      x: model.depth / 2,
      back: 4.5 - model.length,
      front: 4.5,
    });
    expect(() => placeOnPlot(HOUSE_MODELS.length, 0, 0, 0, 0, 0)).toThrow();
    expect(() => plotModelFootprint(-1, 0)).toThrow();
  });
});
