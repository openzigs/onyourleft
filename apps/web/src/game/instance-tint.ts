// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A small seeded tint for every realistic tree, shrub, rock and structure —
 * #621.
 *
 * Every instance of a realistic shape used to be the same colour, so a forest
 * read as one tree copied and a village as one house. Each instance now carries
 * a shift of hue, saturation and brightness, drawn from `seeded.ts` and keyed
 * by WHERE the item stands — so it is the same on every frame, on lap two and
 * on the next ride, and costs no geometry, no texture and no draw call: it
 * travels in the instance colour the belts already allocate.
 *
 * ## The bounds are stated here, not borrowed
 *
 * ADR 0026 D-10: `scenery-palette.ts` §`SCENERY_PALETTE` gates the STYLISED
 * world's colours and does not cover the realistic path, so nothing there
 * bounds this. {@link FOLIAGE_TINT} and {@link MASONRY_TINT} are the bounds,
 * and `instance-tint.test.ts` holds every tint to them. They are #621's own
 * starting figures, landed unchanged: brightness ±12 %, saturation ±10 %, hue
 * ±8° for foliage and ±4° for masonry — stone reads wrong sooner than a leaf
 * does, so a rock wears masonry's.
 *
 * ## One transform, written twice
 *
 * The shift is applied to a LINEAR colour, in this order: the hue turned about
 * the grey axis, the saturation scaled about the colour's own luminance, then
 * the brightness scaled. `three-renderer.ts` §`TINT_GLSL` is the shader's copy;
 * {@link tintedLinear} is this file's, for the tests. Every step is linear in
 * the colour, so a lit mesh (tinted before its light) and an impostor (tinted
 * after the light it was baked with) are shifted alike, and a tree does not
 * change colour at a hand-over.
 *
 * ## How it travels
 *
 * As ONE float, {@link packInstanceTint}: three quantised steps packed into the
 * 24 bits a float holds exactly, stored relative to "no tint" so that an
 * instance colour of nought — three's default — draws the model untinted. The
 * tree dither (`tree-levels.ts` §`writeInterval`) owns the other two channels.
 *
 * Pure, and allocation-free on the path a frame takes
 * ({@link packedInstanceTint}).
 */

import { mixInto, uniformFrom } from './seeded';

/** How far each part of a tint may move, either way. */
export interface TintBound {
  /** Degrees the hue may turn. */
  readonly hueDegrees: number;
  /** The share the saturation may move by: 0.1 is ±10 %. */
  readonly saturation: number;
  /** The share the brightness may move by: 0.12 is ±12 %. */
  readonly brightness: number;
}

/**
 * One instance's shift — each part a signed amount inside its {@link TintBound}.
 *
 * @test-facing the shape `instanceTint` reads a packed tint back as, for
 * `instance-tint.test.ts` and `game-harness.ts` §`tintProbe`; a frame only
 * ever writes the packed float
 */
export type InstanceTint = TintBound;

/** Trees and shrubs: #621's starting figures, landed unchanged. */
export const FOLIAGE_TINT: TintBound = { hueDegrees: 8, saturation: 0.1, brightness: 0.12 };

/** Structures and rocks: the same, with half the hue — #621. */
export const MASONRY_TINT: TintBound = { hueDegrees: 4, saturation: 0.1, brightness: 0.12 };

/**
 * No tint at all: the browser gate's control, and what a bound of nothing draws.
 *
 * @test-facing held by `game-harness.ts` §`tintProbe`, whose control draws
 * with it, and `realistic-renderer.test.ts` §"#621"; the product never does
 */
export const NO_TINT: TintBound = { hueDegrees: 0, saturation: 0, brightness: 0 };

/**
 * The most each packed part can carry, either way. Twice the widest bound, so
 * a bound can be widened without the codec changing; a bound past it is
 * clamped to it, never wrapped. @see packInstanceTint
 */
export const TINT_CODEC_RANGE: TintBound = { hueDegrees: 16, saturation: 0.2, brightness: 0.24 };

/** Steps either side of nought in each packed part: 127, so nought is exactly representable. */
export const TINT_CODEC_STEPS = 127;

/** How many values one packed part spans: `2 × 127 + 1`, in a base of 256. */
const PART_BASE = 256;

/** The packed value of no tint, which is stored as nought. @see packInstanceTint */
export const TINT_CODEC_ZERO = TINT_CODEC_STEPS * (1 + PART_BASE + PART_BASE * PART_BASE);

/**
 * The seed a tint's hash starts from — its own, so a tint is never correlated
 * with anything `scatter.ts` drew from where the item stands.
 */
const TINT_SEED = 0x7a4e_0621;

/**
 * Where an item stands, to the nearest sixteenth of a metre — the key. Coarse
 * enough that a position recomputed on a later frame lands on the same key,
 * fine enough that two items never share one.
 */
const KEY_STEPS_PER_METRE = 16;

/** The hash streams of the three parts: one each, for `seeded.ts` §`uniformFrom`'s reason. */
const HUE_STREAM = 0;
const SATURATION_STREAM = 1;
const BRIGHTNESS_STREAM = 2;

function keyOf(x: number, z: number): number {
  return mixInto(
    mixInto(TINT_SEED, Math.round(x * KEY_STEPS_PER_METRE)),
    Math.round(z * KEY_STEPS_PER_METRE),
  );
}

/** A part's step, toward nought, so a tint never passes its bound. */
function stepOf(key: number, stream: number, bound: number, range: number): number {
  if (!(bound > 0) || !(range > 0)) return 0;
  const signed = 2 * uniformFrom(key, stream) - 1;
  const wanted = (signed * Math.min(bound, range)) / range;
  return Math.trunc(wanted * TINT_CODEC_STEPS);
}

/**
 * The tint of the item standing at `(x, z)`, packed — what a belt writes into
 * an instance's third colour channel. Allocates nothing: a frame calls it for
 * every item it draws.
 */
export function packedInstanceTint(x: number, z: number, bound: TintBound): number {
  const key = keyOf(x, z);
  const hue = stepOf(key, HUE_STREAM, bound.hueDegrees, TINT_CODEC_RANGE.hueDegrees);
  const saturation = stepOf(key, SATURATION_STREAM, bound.saturation, TINT_CODEC_RANGE.saturation);
  const brightness = stepOf(key, BRIGHTNESS_STREAM, bound.brightness, TINT_CODEC_RANGE.brightness);
  return packSteps(hue, saturation, brightness);
}

function packSteps(hue: number, saturation: number, brightness: number): number {
  const at = (step: number): number => step + TINT_CODEC_STEPS;
  return (
    at(hue) + PART_BASE * at(saturation) + PART_BASE * PART_BASE * at(brightness) - TINT_CODEC_ZERO
  );
}

/**
 * A tint as one float, the codec {@link packedInstanceTint} writes — each part
 * quantised toward nought to {@link TINT_CODEC_STEPS} steps of its
 * {@link TINT_CODEC_RANGE}, and clamped to it.
 *
 * @test-facing held by `instance-tint.test.ts`, which round-trips it through
 * {@link unpackInstanceTint}; a frame packs with `packedInstanceTint`
 */
export function packInstanceTint(tint: InstanceTint): number {
  const step = (value: number, range: number): number =>
    Math.trunc(Math.max(-1, Math.min(1, value / range)) * TINT_CODEC_STEPS);
  return packSteps(
    step(tint.hueDegrees, TINT_CODEC_RANGE.hueDegrees),
    step(tint.saturation, TINT_CODEC_RANGE.saturation),
    step(tint.brightness, TINT_CODEC_RANGE.brightness),
  );
}

/**
 * What a packed tint says — the shader's `oylTintOf`, in degrees rather than
 * radians. Exactly the arithmetic the shader does: every value involved is an
 * integer below 2²⁴, so a float carries it exactly.
 *
 * @test-facing held by `instance-tint.test.ts`, and read by `instanceTint`;
 * the shader decodes its own copy
 */
export function unpackInstanceTint(packed: number): InstanceTint {
  const whole = packed + TINT_CODEC_ZERO;
  const brightness = Math.floor(whole / (PART_BASE * PART_BASE));
  const rest = whole - brightness * PART_BASE * PART_BASE;
  const saturation = Math.floor(rest / PART_BASE);
  const hue = rest - saturation * PART_BASE;
  const part = (step: number, range: number): number =>
    ((step - TINT_CODEC_STEPS) / TINT_CODEC_STEPS) * range;
  return {
    hueDegrees: part(hue, TINT_CODEC_RANGE.hueDegrees),
    saturation: part(saturation, TINT_CODEC_RANGE.saturation),
    brightness: part(brightness, TINT_CODEC_RANGE.brightness),
  };
}

/**
 * The tint of the item standing at `(x, z)` — {@link packedInstanceTint},
 * read back. For the browser gate, which picks two items whose tints differ,
 * and for the tests.
 *
 * @test-facing held by `instance-tint.test.ts` and `game-harness.ts`
 * §`tintProbe`; a frame writes `packedInstanceTint`
 */
export function instanceTint(x: number, z: number, bound: TintBound): InstanceTint {
  return unpackInstanceTint(packedInstanceTint(x, z, bound));
}

/** Rec. 709's luminance weights, for linear light. */
const LUMINANCE = [0.2126, 0.7152, 0.0722] as const;

/**
 * A linear colour with a tint applied — `three-renderer.ts` §`TINT_GLSL`'s
 * `oylTinted`, step for step: the hue turned about the grey axis (Rodrigues),
 * the saturation scaled about the luminance, the brightness scaled, and
 * nothing below nought.
 *
 * @test-facing held by `instance-tint.test.ts`, which states what each part of
 * a tint does to a colour; the shader applies its own copy
 */
export function tintedLinear(
  rgb: readonly [number, number, number],
  tint: InstanceTint,
): [number, number, number] {
  const angle = (tint.hueDegrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const k = 1 / Math.sqrt(3);
  const [r, g, b] = rgb;
  const along = k * (r + g + b);
  // k × c, for k = (1, 1, 1) / √3.
  const cross = [k * (b - g), k * (r - b), k * (g - r)] as const;
  const turned = [0, 1, 2].map(
    (at) => (rgb[at] ?? 0) * cos + (cross[at] ?? 0) * sin + k * along * (1 - cos),
  );
  const luminance = turned.reduce((sum, channel, at) => sum + channel * (LUMINANCE[at] ?? 0), 0);
  const [tr, tg, tb] = turned.map((channel) =>
    Math.max(
      0,
      (luminance + (1 + tint.saturation) * (channel - luminance)) * (1 + tint.brightness),
    ),
  );
  return [tr ?? 0, tg ?? 0, tb ?? 0];
}
