// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The stylised world's shapes by setting: which of its mesh's shapes an item
 * is drawn as, what the folded shapes may cost, and each item's tint — #3287.
 *
 * The stylised world is the default on every device (ADR 0026 D-3), and it
 * drew every house as one of three Kenney buildings and every tree as one of
 * four. This adds, without a draw call:
 *
 * - **buildings by setting**: {@link buildingSettingOf} reads the urban class
 *   the realistic world reads (`urban-class.ts`), `settlements.ts` §`lotsAt`
 *   writes it on a lot (`scatter.ts` §`ScatterItem.lotSetting`), and a suburban
 *   lot is drawn as one of City Kit (Suburban)'s modern houses, a commercial
 *   one as a City Kit (Commercial) building, a rural one as the building it
 *   always was;
 * - **more trees and rocks**: three broadleaves, three conifers and three
 *   stones from the Nature Kit;
 * - **a seeded tint** ({@link writeStylisedTint}) beside the scale
 *   `scatter.ts` already seeds, so a row is not one tree copied.
 *
 * ## Every shape is a Kenney file, and none is built here
 *
 * This file first built the new shapes from numbers, because on 2026-11-26
 * `kenney.nl` refused a scripted download. The owner then placed the three
 * archives, and ruled that Kenney's own models are used wherever they look
 * better; a model was found for every shape, so no shape is built in code.
 * Which files, and beside which mesh: `scenery-models.ts`
 * §`STYLISED_FOLD_MODELS`.
 *
 * ## How several shapes cost one draw call
 *
 * A shape was a mesh and a mesh a draw call (`scenery-models.ts`
 * §`MAXIMUM_SCENERY_VARIANTS`), and no ceiling is raised here. Each mesh a
 * kind already has instead holds SEVERAL shapes, and is drawn in its one
 * call as a `BatchedMesh` (`three-renderer.ts` §`ScatterBelt`): every
 * instance names the one shape it is ({@link stylisedFoldOf}) and submits
 * that shape's triangles alone. The mesh count, and so every draw-call
 * figure, is what it was. {@link STYLISED_SHAPE_TRIANGLES} holds the
 * heaviest shape a kind may be.
 *
 * Pure: no rendering library and no file — `settlements.ts` reads
 * {@link buildingSettingOf}, in a worker and under Node, where a model's URL
 * cannot be imported. Nothing here is derived from another product (ADR 0009
 * L2).
 */

import type { BuildingSetting, ScatterItem, SceneryKind } from './scatter';
import { mixInto, uniformFrom } from './seeded';
import type { UrbanClass } from './urban-class';

/**
 * The setting a stretch of the given urban class is — #3287.
 *
 * | urban class | setting |
 * |---|---|
 * | `unknown`, `rural` | `rural` |
 * | `village`, which is also what a suburb reads as | `suburban` |
 * | `town`, `city-centre` | `commercial` |
 *
 * The same table the realistic world's house models take
 * (`house-models.ts`, #3251), with its `modern` split in two.
 */
export function buildingSettingOf(urban: UrbanClass): BuildingSetting {
  if (urban === 'village') return 'suburban';
  if (urban === 'town' || urban === 'city-centre') return 'commercial';
  return 'rural';
}

/** Which fold of a building's mesh each setting is. The model is the first. */
const SETTING_FOLD: Readonly<Record<BuildingSetting, number>> = {
  rural: 0,
  suburban: 1,
  commercial: 2,
};

/**
 * The most triangles any ONE shape of a kind may be — #3287: the heaviest
 * file the kind is drawn as, its meshes' own models and the files beside
 * them (`scenery-models.ts`). An item submits the one shape it is, so this is
 * the most an item of the kind costs.
 *
 * | kind | heaviest file | triangles |
 * |---|---|--:|
 * | building | `building-g` | 2 006 |
 * | broadleaf | `tree_oak` | 196 |
 * | conifer | `tree_pineRoundD` | 170 |
 * | rock | `stone_largeB` | 85 |
 *
 * ⚠️ **Each is the heaviest file as committed, so it is a ratchet**: a
 * heavier file is a red test and a number moved in review.
 *
 * @test-facing held by `stylised-shapes.test.ts`, off the committed bytes;
 * `game.browser.spec.ts` §"#3287" counts what a frame a driver drew submits
 */
export const STYLISED_SHAPE_TRIANGLES: Partial<Record<SceneryKind, number>> = {
  'tree-broadleaf': 196,
  'tree-conifer': 170,
  rock: 85,
  building: 2_006,
};

/** The seed a place's shape and tint are hashed from: their own, so neither follows anything `scatter.ts` drew there. */
const PLACE_SEED = 0x57f1_3287;

/** Where an item stands, to a sixteenth of a metre: `instance-tint.ts`' key, for its reason. */
const KEY_STEPS_PER_METRE = 16;

/** One hash stream each: the shape, the darkening, the lean. */
const FOLD_STREAM = 0;
const DARKEN_STREAM = 1;
const LEAN_STREAM = 2;

function placeKey(x: number, z: number): number {
  return mixInto(
    mixInto(PLACE_SEED, Math.round(x * KEY_STEPS_PER_METRE)),
    Math.round(z * KEY_STEPS_PER_METRE),
  );
}

/**
 * Which of its mesh's `folds` shapes an item is drawn as — #3287. Allocates
 * nothing: a frame asks for every item it draws.
 *
 * - A **building** is its setting's: the model on a rural stretch or where
 *   there is no class, fold 1 on a suburban one, fold 2 on a commercial one.
 *   A mesh with fewer folds draws its last.
 * - A **tree or a rock** is picked by where it stands, evenly, so it is the
 *   same on every frame, on lap two and on the next ride.
 * - A mesh with one shape draws it.
 */
export function stylisedFoldOf(
  item: Pick<ScatterItem, 'kind' | 'x' | 'z' | 'lotSetting'>,
  folds: number,
): number {
  if (!(folds > 1)) return 0;
  if (item.kind === 'building') {
    return Math.min(folds - 1, SETTING_FOLD[item.lotSetting ?? 'rural']);
  }
  return Math.min(
    folds - 1,
    Math.floor(uniformFrom(placeKey(item.x, item.z), FOLD_STREAM) * folds),
  );
}

/** How far a kind's instances may be darkened, and leaned warm or cool, as shares of a channel. */
interface StylisedTintBound {
  readonly darken: number;
  readonly lean: number;
}

/**
 * The bounds, by kind — #3287: foliage up to a fifth darker and an eighth
 * warmer or cooler; stone less of both, because a rock reads wrong sooner
 * than a leaf does (`instance-tint.ts` says the same of the realistic world).
 * A kind with no entry is drawn as it is.
 */
const STYLISED_TINTS: Partial<Record<SceneryKind, StylisedTintBound>> = {
  'tree-broadleaf': { darken: 0.2, lean: 0.12 },
  'tree-conifer': { darken: 0.2, lean: 0.12 },
  shrub: { darken: 0.2, lean: 0.12 },
  rock: { darken: 0.14, lean: 0.04 },
};

/** Whether a kind's instances are tinted at all — #3287: the trees, the shrub and the rock. */
export function stylisedTinted(kind: SceneryKind): boolean {
  return STYLISED_TINTS[kind] !== undefined;
}

/**
 * The least any channel of a tint can be: the darkest foliage, leaned all the
 * way. Every channel of every tint is between this and 1.
 *
 * @test-facing the bound `stylised-shapes.test.ts` holds every tint inside;
 * the renderer writes what {@link writeStylisedTint} gives it
 */
export const STYLISED_TINT_FLOOR = Math.min(
  ...Object.values(STYLISED_TINTS).map((bound) => (1 - bound.darken) * (1 - bound.lean)),
);

/**
 * Writes the tint of the item of `kind` standing at `(x, z)` into `out` at
 * `at`: three numbers its colour is multiplied by — #3287. Allocates nothing.
 *
 * ⚠️ **Never above 1 in any channel**, so a tint only ever darkens: a colour
 * `scenery-palette.ts` holds under the sun's ceiling stays under it, and that
 * file's gate needs no second case. Warm takes the blue down and cool the
 * red; the green of a leaf is left alone.
 */
export function writeStylisedTint(
  kind: SceneryKind,
  x: number,
  z: number,
  out: Float32Array,
  at: number,
): void {
  const bound = STYLISED_TINTS[kind];
  if (bound === undefined) {
    out[at] = 1;
    out[at + 1] = 1;
    out[at + 2] = 1;
    return;
  }
  const key = placeKey(x, z);
  const light = 1 - bound.darken * uniformFrom(key, DARKEN_STREAM);
  const lean = bound.lean * (2 * uniformFrom(key, LEAN_STREAM) - 1);
  out[at] = light * (lean < 0 ? 1 + lean : 1);
  out[at + 1] = light;
  out[at + 2] = light * (lean > 0 ? 1 - lean : 1);
}
