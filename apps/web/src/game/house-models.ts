// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which mapped footprints are drawn as a house MODEL, and how one is laid on
 * its footprint — #1585, the owner's ruling of 2026-10-22: "real models where
 * a footprint fits", after the detail pass (#1588, #1589, #1590).
 *
 * The models are GildedAge's RVA set (twelve houses and duplexes after
 * Richmond, Virginia) and Orzechu's brick building with shop, CC-BY-4.0
 * (`realistic-assets.ts` §`REALISTIC_HOUSE_MODEL_IDS`, `ASSETS.toml`, the
 * credits). `tools/realistic/blender/process_house_models.py` turns each so
 * its long axis is X, stands it on the origin, and maps all thirteen into one
 * atlas, so every model drawn is one draw call between them.
 *
 * ## The fit, and its tolerance
 *
 * A plan is drawn as a model when, of its simplified footprint
 * (`footprint-buildings.ts` §`minimumAreaRectangle`):
 *
 * - the **minimum-area rectangle's sides** are each within
 *   {@link HOUSE_FIT}'s `stretch` of the model's footprint — long side to
 *   long side, short to short: from 0.8 to 1.25 times, the model stretched
 *   to the rectangle and never by more;
 * - its **rectangularity** (its area over the rectangle's) is at least
 *   {@link HOUSE_FIT}'s `rectangularity`, so an L is never drawn as a box;
 * - its **storeys** are within {@link HOUSE_FIT}'s `storeys` of the model's;
 * - its **use** is the model's: a house on residential land, the shop on
 *   commercial;
 * - its **front door** is where the model's is: on an END of the long axis
 *   for most of the set, on a long SIDE for one ({@link HouseModel.front}).
 *
 * Of the fits, one is chosen, seeded per footprint. A model is never
 * stretched upward: its storeys are its own.
 *
 * ⚠️ **A model is drawn only at the near level**: past
 * `realistic-budget.ts` §`MAPPED_BUILDING_NEAR_METRES` a modelled plan is
 * drawn as its extrusion's far level, walls and roof, as every other plan is.
 * The model's 1 100 to 2 900 triangles would cost a far building ten times a
 * far extrusion's.
 *
 * Pure, and names no rendering library. No coordinate is formatted into any
 * string here.
 */

import type { HouseModelId } from './realistic-assets';

/** Where a model's front door is: an end of its long axis (+X), or its long side (+Z). */
export type HouseFront = 'end' | 'side';

/** One house model, as its GLB is: metres, long axis X, standing on y = 0. */
export interface HouseModel {
  readonly id: HouseModelId;
  /** The land it stands on: a house on residential land, the shop on commercial. */
  readonly use: 'residential' | 'commercial';
  readonly front: HouseFront;
  /** Its footprint's extent along X and Z, and its height, metres. */
  readonly length: number;
  readonly depth: number;
  readonly height: number;
  /** Its storeys, as #1540 counts a plan's. */
  readonly storeys: number;
  /** Its triangles: what it costs the structure term when drawn. */
  readonly triangles: number;
}

/**
 * The thirteen, as `process_house_models.py` reported them on 2026-10-23 —
 * held to the committed GLBs by `house-models.test.ts`. The RVA houses stand
 * two storeys over a raised basement under a roof, about 10 m; the shop is
 * three storeys and a flat roof, 9.6 m.
 */
export const HOUSE_MODELS: readonly HouseModel[] = [
  {
    id: 'old_american_brick_shop',
    use: 'commercial',
    front: 'end',
    length: 24.2278,
    depth: 7.2447,
    height: 9.6091,
    storeys: 3,
    triangles: 2_946,
  },
  {
    id: 'rva_detached_house_01a',
    use: 'residential',
    front: 'end',
    length: 20.4499,
    depth: 6.6,
    height: 10.0006,
    storeys: 2,
    triangles: 1_624,
  },
  {
    id: 'rva_detached_house_02a',
    use: 'residential',
    front: 'end',
    length: 20.6003,
    depth: 7.4,
    height: 10.2777,
    storeys: 2,
    triangles: 1_243,
  },
  {
    id: 'rva_detached_house_02b',
    use: 'residential',
    front: 'end',
    length: 20.6003,
    depth: 7.4,
    height: 10.2777,
    storeys: 2,
    triangles: 1_243,
  },
  {
    id: 'rva_detached_house_03a',
    use: 'residential',
    front: 'end',
    length: 19.5499,
    depth: 7.4,
    height: 9.8434,
    storeys: 2,
    triangles: 1_235,
  },
  {
    id: 'rva_detached_house_03c',
    use: 'residential',
    front: 'end',
    length: 19.5499,
    depth: 7.4,
    height: 9.8434,
    storeys: 2,
    triangles: 1_305,
  },
  {
    id: 'rva_detached_house_04a',
    use: 'residential',
    front: 'end',
    length: 20.6,
    depth: 7.4,
    height: 10.1206,
    storeys: 2,
    triangles: 1_130,
  },
  {
    id: 'rva_detached_house_04b',
    use: 'residential',
    front: 'end',
    length: 20.6,
    depth: 7.4,
    height: 10.1206,
    storeys: 2,
    triangles: 1_116,
  },
  {
    id: 'rva_duplex_01a',
    use: 'residential',
    front: 'end',
    length: 18.4,
    depth: 7.4,
    height: 9.806,
    storeys: 2,
    triangles: 1_157,
  },
  {
    id: 'rva_duplex_01b',
    use: 'residential',
    front: 'end',
    length: 18.4,
    depth: 7.4,
    height: 9.806,
    storeys: 2,
    triangles: 1_170,
  },
  {
    id: 'rva_duplex_02a',
    use: 'residential',
    front: 'end',
    length: 18.4,
    depth: 7.4,
    height: 9.806,
    storeys: 2,
    triangles: 1_468,
  },
  {
    id: 'rva_duplex_02b',
    use: 'residential',
    front: 'end',
    length: 18.4,
    depth: 7.4,
    height: 9.806,
    storeys: 2,
    triangles: 1_465,
  },
  {
    id: 'rva_house_01_brick_alternate',
    use: 'residential',
    front: 'side',
    length: 18.9608,
    depth: 14.996,
    height: 10.0006,
    storeys: 2,
    triangles: 1_625,
  },
];

/**
 * The fit's tolerance — #1585: each side of the footprint's minimum-area
 * rectangle from **0.8 to 1.25** times the model's (a stretch the eye takes
 * for a different house of the same kind, where a door 25 % narrower or a
 * wall 25 % longer is still a door and a wall), a rectangularity of at least
 * **0.85** (#1540's own bar for a gable, `FOOTPRINT_GABLE_MIN_RECTANGULARITY`),
 * and **one** storey either way.
 */
export const HOUSE_FIT = {
  stretch: { least: 0.8, most: 1.25 },
  rectangularity: 0.85,
  storeys: 1,
} as const;

/**
 * Whether a front edge is on an END of the rectangle's long axis: its outward
 * normal within 45° of the axis.
 */
export const END_FRONT_COSINE = Math.SQRT1_2;

/** What the fit reads of a plan. */
export interface HouseFitInput {
  /** The minimum-area rectangle's long and short sides, metres. */
  readonly long: number;
  readonly short: number;
  readonly rectangularity: number;
  readonly storeys: number;
  readonly use: string;
  /** Where its front door is, or `undefined` for a plan with none. */
  readonly front: HouseFront | undefined;
}

/** Whether `model` fits a plan, by every one of {@link HOUSE_FIT}'s terms. */
export function houseModelFits(model: HouseModel, plan: HouseFitInput): boolean {
  const { least, most } = HOUSE_FIT.stretch;
  const along = plan.long / model.length;
  const across = plan.short / model.depth;
  return (
    plan.front === model.front &&
    plan.use === model.use &&
    plan.rectangularity >= HOUSE_FIT.rectangularity &&
    Math.abs(plan.storeys - model.storeys) <= HOUSE_FIT.storeys &&
    along >= least &&
    along <= most &&
    across >= least &&
    across <= most
  );
}

/** The models that fit a plan, by their place in {@link HOUSE_MODELS}. */
export function houseModelsFitting(
  plan: HouseFitInput,
  models: readonly HouseModel[] = HOUSE_MODELS,
): readonly number[] {
  const fitting: number[] = [];
  models.forEach((model, index) => {
    if (houseModelFits(model, plan)) fitting.push(index);
  });
  return fitting;
}

/**
 * A model laid on a plan — #1585: which, where, and turned and stretched how.
 * A model point `(x, y, z)` stands at
 * `(x·stretchX·ax + z·stretchZ·bx + cx, y + y0, x·stretchX·az + z·stretchZ·bz + cz)`,
 * where `(ax, az)` is where the model's +X points and `(bx, bz) = (-az, ax)`
 * where its +Z does: a turn about the vertical, never a mirror.
 */
export interface HousePlacement {
  /** Its place in {@link HOUSE_MODELS}. */
  readonly model: number;
  readonly cx: number;
  readonly cz: number;
  /** Where its foot stands, metres, local. */
  readonly y0: number;
  readonly ax: number;
  readonly az: number;
  readonly stretchX: number;
  readonly stretchZ: number;
}

/** The rectangle a placement is made on: `footprint-buildings.ts` §`minimumAreaRectangle`'s. */
export interface PlacementRectangle {
  readonly cx: number;
  readonly cz: number;
  /** Its long axis, a unit vector. */
  readonly ux: number;
  readonly uz: number;
  readonly halfLong: number;
  readonly halfShort: number;
}

/** Where a plan's front door is, relative to its rectangle: on an end, or a side. */
export function frontOf(rectangle: PlacementRectangle, nx: number, nz: number): HouseFront {
  return Math.abs(nx * rectangle.ux + nz * rectangle.uz) >= END_FRONT_COSINE ? 'end' : 'side';
}

/**
 * Lays `models[index]` on `rectangle`, its front toward the door's outward
 * normal `(nx, nz)` — the end the door is on for an `end` model, the side
 * for a `side` one — its foot at `y0`, stretched to the rectangle.
 */
export function placeHouseModel(
  index: number,
  rectangle: PlacementRectangle,
  nx: number,
  nz: number,
  y0: number,
  models: readonly HouseModel[] = HOUSE_MODELS,
): HousePlacement {
  const model = models[index];
  if (model === undefined) throw new Error('no such house model');
  const { ux, uz } = rectangle;
  let ax: number;
  let az: number;
  if (model.front === 'end') {
    // +X toward the door's end of the long axis.
    const toward = nx * ux + nz * uz >= 0 ? 1 : -1;
    ax = ux * toward;
    az = uz * toward;
  } else {
    // +Z toward the door's side, across the long axis; +X then follows from
    // it, (bx, bz) = (-az, ax), so that the turn is never a mirror.
    const vx = -uz;
    const vz = ux;
    const toward = nx * vx + nz * vz >= 0 ? 1 : -1;
    const bx = vx * toward;
    const bz = vz * toward;
    ax = bz;
    az = -bx;
  }
  return {
    model: index,
    cx: rectangle.cx,
    cz: rectangle.cz,
    y0,
    ax,
    az,
    stretchX: (2 * rectangle.halfLong) / model.length,
    stretchZ: (2 * rectangle.halfShort) / model.depth,
  };
}

/**
 * Where a model point stands once placed — the transform the belt writes
 * every vertex through, here so a test can hold the belt to it.
 */
export function placedPoint(
  placement: HousePlacement,
  x: number,
  y: number,
  z: number,
): readonly [number, number, number] {
  const { ax, az, stretchX, stretchZ } = placement;
  const along = x * stretchX;
  const across = z * stretchZ;
  return [
    placement.cx + along * ax - across * az,
    placement.y0 + y,
    placement.cz + along * az + across * ax,
  ];
}
