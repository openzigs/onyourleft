// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What colour the scenery is, now that the models decide — #366.
 *
 * ## What changed, and why this file had to exist for it
 *
 * Until #366 every scatter kind was drawn in one colour typed into
 * `three-renderer.ts` §`SCATTER_STYLE`, and that table's completeness was the
 * whole of [ADR 0022](../../../../docs/adr/0022-game-scenery-model-pack.md) D-7's
 * argument: *"`LIT_COLOURS` a complete statement of the scene's palette, and
 * what stops a pack's house style deciding what this world looks like"*. The
 * cost was stated and was real — a Kenney tree is authored with a separate
 * trunk material, so the trunk was drawn in the canopy's green, and a building
 * whose whole colour lives in a texture atlas was drawn in one flat beige.
 *
 * #366 bakes each part's own colour into a `COLOR_0` attribute at merge time.
 * That is cheap — one attribute on a vertex buffer, the same trade `terrain.ts`
 * takes for the road and `bicycle.ts` takes for the rider, and it keeps one
 * merged geometry, one material and one draw call per mesh. What it is **not**
 * is free of D-7's argument, because the palette stops being enumerable in a
 * source file the moment its values come out of a binary.
 *
 * ⚠️ **So the replacement is a gate rather than a comment**, which is #366's
 * fifth criterion in its own words: *"a scene colour that nothing asserts is
 * the hole D-7 was protecting against"*. {@link SCENERY_PALETTE} records, per
 * model file, how many distinct colours it contributes, the brightest of them,
 * and a digest of the whole set; `scenery-palette.test.ts` recomputes all three
 * **from the committed bytes** with a reader that shares no code with the
 * renderer. A pack swap, a re-export, a new variant or an edited table is a red
 * build. What D-7 protected — that nobody can change what this world looks like
 * without it being visible — survives; what it protected it *with* does not.
 *
 * ## The one thing the renderer may not do, and why the bound is here
 *
 * `three-renderer.test.ts` §"lights no colour past white" requires every lit
 * colour to survive `world.ts`'s {@link PEAK_IRRADIANCE} without clipping: a
 * face square-on to the sun receives that much of its own colour, and a channel
 * that then exceeds white is clamped, which turns a shaded model into a flat
 * white patch and takes away exactly the form #286 added. For a colour somebody
 * typed, the answer is to type a darker one. **For a colour that arrives out of
 * a pack there is nobody to ask**, and it is not a handful: measured with
 * `model-bytes-testing.ts`' own reader over the committed bytes on 2026-09-19,
 * **13 of the 110 distinct colours the eleven models carry, in 7 of those 11
 * models**, are over the {@link MAXIMUM_LIT_CHANNEL} ceiling of 0.8830. Every
 * building's atlas peaks at 0.9734, `stone` is 0.9098 and `woodBark` 0.8863.
 * ⚠️ **This paragraph said "two of the five committed models" and named those
 * last two**, which was a spot check of the `baseColorFactor` models and missed
 * every atlas colour in the tree; a reviewer who remembers that sentence is
 * reading the old file. Nothing about the rule changes — {@link tonedForTheSun}
 * applies it to every colour rather than checking it, and the count is a
 * statement about the pack rather than about the gate.
 *
 * ⚠️ **This file rather than `three-renderer.ts`, because that file must never
 * name a sun constant.** `LIT_COLOURS`' own comment states it: *"the two halves
 * of it are deliberately in different files: the elevation band cannot see a
 * colour, and this file must never see a sun constant"*. The renderer imports
 * {@link tonedForTheSun} and learns nothing about where the ceiling came from,
 * exactly as it imports a `WorldStyle` and learns nothing about the sun's
 * elevation.
 *
 * ## The seam
 *
 * Nothing here names `three`. The renderer turns a triple into a vertex buffer;
 * everything that decides *which* triple is arithmetic the jsdom suite can
 * check, which is the same split `bicycle.ts`, `terrain.ts` and `scatter.ts`
 * already observe.
 */

import { PEAK_IRRADIANCE } from './world';

/**
 * One colour in the **linear** working space the shader multiplies in.
 *
 * ⚠️ **Linear, not sRGB, and that is not a detail.** A glTF's
 * `baseColorFactor` is defined by the specification as linear, three's
 * `GLTFLoader` reads it as linear, and a `COLOR_0` attribute is consumed as
 * linear. So a model's own factor is written straight through with no
 * conversion — where `bicycle.ts`'s hand-typed `0x22262b` goes through three's
 * `Color`, which converts, because a number somebody typed as a hex triple is
 * sRGB by convention. `terrain.ts` §`RoadCorridor.colours` records the same
 * distinction and the visible failure — *"visibly too bright, and wrong by a
 * different amount per channel"* — that mixing them produces.
 */
export type LinearRgb = readonly [number, number, number];

/**
 * The brightest any one channel may be and still not clip under the sun:
 * **1 / {@link PEAK_IRRADIANCE}**.
 *
 * Derived rather than typed, so a change to `world.ts`'s elevation band moves
 * it. `three-renderer.test.ts` §"lights no colour past white" states the same
 * rule for the colours this repository chooses; this is the rule applied to the
 * colours it does not choose.
 */
export const MAXIMUM_LIT_CHANNEL = 1 / PEAK_IRRADIANCE;

/**
 * A colour brought under {@link MAXIMUM_LIT_CHANNEL}, or left alone.
 *
 * ⚠️ **Scaled uniformly, so the hue and the ratio between the channels are
 * exactly preserved and only the lightness moves.** Clamping each channel
 * separately would be the obvious alternative and is wrong: it drags a colour
 * towards white and towards grey at the same time, so a pack's warm
 * near-white tan becomes a neutral one and a reviewer reading the recorded
 * palette could not predict what is drawn.
 *
 * The two colours this actually moves are `woodBark` (0.886 → 0.883, a fall of
 * 0.4 %) and `stone` (0.910 → 0.883, 3.0 %), neither of which is a visible
 * change — which is the point. What it prevents is a **channel** clipping and
 * flattening a face that the shading was supposed to give form to.
 */
export function tonedForTheSun(colour: LinearRgb): LinearRgb {
  const brightest = Math.max(colour[0], colour[1], colour[2]);
  if (!(brightest > MAXIMUM_LIT_CHANNEL)) {
    // Written as `!(… > …)` rather than `<=` so that a NaN falls through to the
    // scale below, where it is made finite, instead of being returned as-is
    // into a vertex buffer.
    return brightest >= 0 ? colour : [0, 0, 0];
  }
  const factor = MAXIMUM_LIT_CHANNEL / brightest;
  return [colour[0] * factor, colour[1] * factor, colour[2] * factor];
}

/**
 * One sRGB byte as a linear value, by the sRGB transfer function.
 *
 * The same conversion three's `Color` performs on a hex triple, written out
 * here because an atlas arrives as bytes rather than as a `Color` and this file
 * may not name the rendering library.
 */
export function srgbByteToLinear(byte: number): number {
  const unit = Math.min(1, Math.max(0, byte / 255));
  return unit <= 0.04045 ? unit / 12.92 : Math.pow((unit + 0.055) / 1.055, 2.4);
}

/** A decoded image, as the only thing {@link atlasColourAt} needs of one. */
export interface AtlasImage {
  readonly width: number;
  readonly height: number;
  /** Row-major RGBA bytes, the first row being the image's **top**. */
  readonly data: Uint8ClampedArray;
}

/**
 * The colour an atlas carries at one texture coordinate.
 *
 * ## The orientation, which is the one thing here that can be silently wrong
 *
 * ⚠️ **Row `floor(v × height)` counting from the image's TOP**, and not from
 * its bottom. glTF §3.8.2 puts the UV origin at the upper-left corner; three's
 * `GLTFLoader` sets `flipY = false` on every texture it builds, so the image's
 * first row is uploaded to `t = 0` and a sample at `v` reads that many rows
 * down from the top. Getting it upside down produces a building painted in
 * whatever else the atlas happens to hold, which looks like a *palette* choice
 * rather than a bug.
 *
 * ⚠️ It was settled by measurement as well as by reading the specification, and
 * the measurement is worth keeping: the top quarter of
 * `models/colormap.png` — every pixel of rows 0 to 127 — is solid black, and
 * under this orientation **no vertex of any committed building samples it**
 * (the `v` range is 0.275 to 0.975). Upside down, 108 of them do. A model
 * mapped onto the blank part of its own atlas is not a thing a pack ships.
 *
 * ## Nearest texel, deliberately
 *
 * No filtering. A vertex colour is one value however it was obtained, so
 * interpolating four texels would only blur the edge between two patches of a
 * palette atlas — and it would make the recorded {@link SCENERY_PALETTE}
 * digest depend on floating-point rounding rather than on the bytes.
 *
 * Out-of-range coordinates are clamped rather than wrapped: a UV outside
 * `[0, 1]` is a fault in the file, and wrapping would answer it with a
 * plausible colour from the far side of the atlas.
 */
export function atlasColourAt(image: AtlasImage, u: number, v: number): LinearRgb {
  const column = clampIndex(u, image.width);
  const row = clampIndex(v, image.height);
  const at = (row * image.width + column) * 4;
  return [
    srgbByteToLinear(image.data[at] ?? 0),
    srgbByteToLinear(image.data[at + 1] ?? 0),
    srgbByteToLinear(image.data[at + 2] ?? 0),
  ];
}

function clampIndex(unit: number, size: number): number {
  if (!Number.isFinite(unit)) {
    return 0;
  }
  return Math.min(size - 1, Math.max(0, Math.floor(unit * size)));
}

/** What one model file contributes to the scene's palette. @see SCENERY_PALETTE */
export interface ModelPalette {
  /** How many distinct colours its vertices end up carrying. */
  readonly colours: number;
  /**
   * The brightest single channel among them, **before** {@link tonedForTheSun}.
   *
   * Written out so that a reviewer can see which models the toning actually
   * moves without running anything, and so that a pack whose colours got
   * brighter is visible as a number rather than only as a digest.
   */
  readonly brightestChannel: number;
  /**
   * FNV-1a over the sorted colour list at six decimal places.
   *
   * ⚠️ **A digest rather than the list**, for the reason
   * `arrangement-unchanged.test.ts` gives for the arrangement: thirty-nine
   * triples per building is not something a reviewer reads, and a number that
   * moves is. The count and the brightest channel sit beside it so that a red
   * run says *what* changed rather than only *that* something did — the same
   * shape, and the same reason, as the item counts beside that file's digest.
   */
  readonly digest: string;
}

/**
 * Every colour the committed models put into the scene, as three numbers each.
 *
 * ⚠️ **This is what replaces `LIT_COLOURS`' completeness claim for the
 * scenery, and it is a gate rather than a record.**
 * `scenery-palette.test.ts` parses each `.glb`'s own JSON and binary chunks and
 * decodes `colormap.png` with a reader that shares no line of code with
 * `three-renderer.ts`, reproduces every entry below, and requires each recorded
 * colour to clear {@link MAXIMUM_LIT_CHANNEL} once {@link tonedForTheSun} has
 * run. Swapping a model, re-exporting one, adding a variant or editing this
 * table without the bytes is a red build.
 *
 * ⚠️ **The keys are the file's own name**, not a Vite URL: those are hashed at
 * build time and are not stable enough to key a table on.
 * `scenery-models.ts` §`SceneryModel.name` is where the two are tied together,
 * and `scenery-models.test.ts` asserts that every model named there has an
 * entry here and the reverse — which is what stops this table going stale
 * against the files actually loaded.
 *
 * ⚠️ **The four Nature Kit models carry their colour as a `baseColorFactor`
 * per material and the three buildings carry theirs in a shared texture
 * atlas**, so a building's count is the number of distinct texels its vertices
 * land on rather than the number of materials it declares. Read on
 * **2026-09-19** from the committed bytes.
 *
 * @test-facing a bound and an enumeration `scenery-palette.test.ts` asserts against.
 * Nothing in the client reads it, because every vertex already carries its own
 * colour — the same reason `three-renderer.ts` §`LIT_COLOURS` carries the tag.
 */
export const SCENERY_PALETTE: Readonly<Record<string, ModelPalette>> = {
  tree_default: { colours: 2, brightestChannel: 0.8862745, digest: '9edcadf0' },
  tree_oak: { colours: 2, brightestChannel: 0.8862745, digest: '9edcadf0' },
  tree_pineTallA: { colours: 2, brightestChannel: 0.8, digest: '1422b45c' },
  tree_pineRoundD: { colours: 2, brightestChannel: 0.8, digest: '1422b45c' },
  plant_bush: { colours: 1, brightestChannel: 0.847058833, digest: 'a507d2de' },
  plant_bushLargeTriangle: { colours: 1, brightestChannel: 0.847058833, digest: 'a507d2de' },
  stone_largeA: { colours: 1, brightestChannel: 0.9098039, digest: '629aee4a' },
  stone_largeC: { colours: 1, brightestChannel: 0.9098039, digest: '629aee4a' },
  'building-type-h': { colours: 27, brightestChannel: 0.9734452903984125, digest: 'b4a5d47d' },
  'building-type-i': { colours: 39, brightestChannel: 0.9734452903984125, digest: 'c7503177' },
  'building-type-k': { colours: 32, brightestChannel: 0.9734452903984125, digest: 'c2974f54' },
};
