// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What replaces `LIT_COLOURS`' completeness claim for the scenery — #366.
 *
 * ## The criterion this file exists for
 *
 * > *"Whatever replaces `LIT_COLOURS`' completeness claim is a gate, not a
 * > comment — a scene colour that nothing asserts is the hole D-7 was
 * > protecting against."*
 *
 * [ADR 0022](../../../../docs/adr/0022-game-scenery-model-pack.md) D-7 chose one
 * colour per kind so that `three-renderer.ts` §`SCATTER_STYLE` would be the
 * whole of the scene's palette and *"a pack's house style"* could not decide
 * what this world looks like. #366 takes the colours out of the models, which
 * makes that claim false. What stops the palette becoming unenumerable with it
 * is this file: `SCENERY_PALETTE` is a table in source, and every entry in it
 * is reproduced here **from the committed bytes**.
 *
 * ## Why the reader is a second implementation
 *
 * `model-bytes-testing.ts` parses glTF and PNG from the two published
 * specifications and shares no line with the renderer, which extracts the same
 * colours through three's `GLTFLoader` and a 2D canvas. Neither is available
 * here — `three-seam.test.ts` allows exactly one file in this repository to
 * import the rendering library, and jsdom implements no 2D context — so a test
 * that wanted to check the renderer's answer would have to *be* the renderer.
 * The same argument `packages/store`'s `identity-verifier.test.ts` makes for
 * calling `crypto.subtle.verify` directly.
 *
 * What ties the two together is the browser gate: `game.browser.spec.ts` reads
 * a tree's and a building's own pixels back off a drawing buffer, which is the
 * claim this file cannot make and the one it cannot be substituted for.
 */

import { describe, expect, it } from 'vitest';

import { decodePng, modelColours, paletteDigest, readGlb } from './model-bytes-testing';
import { SCENERY_MODELS } from './scenery-models';
import {
  MAXIMUM_LIT_CHANNEL,
  SCENERY_PALETTE,
  atlasColourAt,
  srgbByteToLinear,
  tonedForTheSun,
  type AtlasImage,
} from './scenery-palette';
import { PEAK_IRRADIANCE } from './world';

const MODELS = new URL('./models/', import.meta.url).pathname;

/** The committed atlas, decoded once for the whole file. */
const atlas = decodePng(`${MODELS}colormap.png`);

/** Every model named in `scenery-models.ts`, by its own name. */
const names = Object.values(SCENERY_MODELS).flatMap((models) => models.map((model) => model.name));

describe('the atlas the buildings are painted from', () => {
  it('is the 8-bit palette PNG the sampler assumes', () => {
    // ⚠️ **Asserted rather than assumed, because the reader supports one
    // shape.** A pack that re-exported its atlas at 16 bits or with an
    // interlace would be sampled wrongly rather than refused, and the buildings
    // would come out in whatever the misread produced — which looks like a
    // palette choice.
    expect(atlas.width).toBe(512);
    expect(atlas.height).toBe(512);
    expect(atlas.bitDepth).toBe(8);
    expect(atlas.colourType).toBe(3);
  });

  it('has an unused black quarter that no building samples — #366', () => {
    // ⚠️ **The measurement that settled the UV orientation**, kept because the
    // specification argument alone is the kind that reads convincingly in both
    // directions. Rows 0 to 127 of this atlas are solid black; under the
    // orientation `atlasColourAt` implements, no vertex of any committed
    // building has a `v` below 0.25 and so none of them lands there. Upside
    // down, 108 of them do — a model mapped onto the blank part of its own
    // atlas, which is not a thing a pack ships.
    for (let row = 0; row < 128; row += 16) {
      for (let column = 0; column < atlas.width; column += 64) {
        const at = (row * atlas.width + column) * 4;

        expect([atlas.data[at], atlas.data[at + 1], atlas.data[at + 2]]).toEqual([0, 0, 0]);
      }
    }
    // And the quarter below it is not black, so the check above is about where
    // the black is rather than about the whole image being black.
    const belowAt = (200 * atlas.width + 200) * 4;

    expect(atlas.data[belowAt + 1]).toBeGreaterThan(0);
  });
});

describe('the palette the committed models actually carry — #366', () => {
  it('records one entry per model and no more', () => {
    expect(Object.keys(SCENERY_PALETTE).sort()).toEqual([...names].sort());
  });

  for (const name of names) {
    it(`reproduces ${name}'s colours from its own bytes`, () => {
      const recorded = SCENERY_PALETTE[name];
      const colours = modelColours(readGlb(`${MODELS}${name}.glb`), atlas);

      expect(recorded).toBeDefined();
      // Three independent statements about the same set, so that a red run says
      // *what* moved. A count alone survives a recoloured pack; a digest alone
      // says only that something did; the brightest channel is the one the
      // light budget below turns on.
      expect(colours).toHaveLength(recorded?.colours ?? -1);
      expect(Math.max(...colours.map((colour) => Math.max(...colour)))).toBeCloseTo(
        recorded?.brightestChannel ?? -1,
        6,
      );
      expect(paletteDigest(colours)).toBe(recorded?.digest);
    });
  }

  it('is not satisfied by an empty model, or by one colour everywhere', () => {
    // ⚠️ **The non-vacuity of the loop above.** A reader that returned nothing
    // would reproduce a recorded count of nothing, and three of these models
    // would be indistinguishable from the flat-coloured world #366 replaced.
    for (const name of names) {
      expect(SCENERY_PALETTE[name]?.colours ?? 0).toBeGreaterThan(0);
    }
    expect(SCENERY_PALETTE['tree_default']?.colours).toBe(2);
    expect(SCENERY_PALETTE['building-type-h']?.colours).toBeGreaterThan(10);
  });

  it('gives the broadleaf tree a trunk that is not its canopy — #366', () => {
    // #366's first criterion, at the numbers: *"a brown trunk and a green
    // canopy, from the model's own values"*. One of `tree_default`'s two
    // colours leads on red and the other on green, which is what that sentence
    // means arithmetically and is what a single flat colour cannot produce.
    // The pixels are `game.browser.spec.ts`.
    const colours = modelColours(readGlb(`${MODELS}tree_default.glb`));
    const leads = colours.map((colour) =>
      colour[0] > colour[1] ? 'red' : colour[1] > colour[2] ? 'green' : 'blue',
    );

    expect(leads).toHaveLength(2);
    expect(new Set(leads).size).toBe(2);
    expect(leads).toContain('red');
  });
});

describe('the light budget, applied to colours nobody here chose — #366', () => {
  it('states a ceiling derived from the sun rather than typed', () => {
    expect(MAXIMUM_LIT_CHANNEL).toBeCloseTo(1 / PEAK_IRRADIANCE, 12);
    // Non-vacuity: a ceiling of 1 or more would make `tonedForTheSun` the
    // identity and every assertion below meaningless.
    expect(MAXIMUM_LIT_CHANNEL).toBeLessThan(1);
    expect(MAXIMUM_LIT_CHANNEL).toBeGreaterThan(0.5);
  });

  it('has two colours in the pack that would clip, so the toning is not idle', () => {
    // ⚠️ **The reason `tonedForTheSun` exists rather than an assertion that the
    // pack is already safe.** If this ever goes green the other way — every
    // pack colour under the ceiling — the toning has become untested and the
    // next pack is the one that finds out.
    const clipping = names.filter(
      (name) => (SCENERY_PALETTE[name]?.brightestChannel ?? 0) > MAXIMUM_LIT_CHANNEL,
    );

    expect(clipping.length).toBeGreaterThan(0);
    expect(clipping).toContain('stone_largeA');
  });

  it('brings every recorded colour under the ceiling', () => {
    for (const name of names) {
      for (const colour of modelColours(readGlb(`${MODELS}${name}.glb`), atlas)) {
        for (const channel of tonedForTheSun(colour)) {
          expect(channel * PEAK_IRRADIANCE).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('scales a colour uniformly rather than clamping its channels', () => {
    // Hue and the ratio between the channels are preserved exactly; only the
    // lightness moves. Clamping would drag a warm near-white towards grey, so
    // a reviewer reading the recorded palette could not predict what is drawn.
    const toned = tonedForTheSun([1, 0.5, 0.25]);

    expect(toned[0]).toBeCloseTo(MAXIMUM_LIT_CHANNEL, 12);
    expect(toned[1] / toned[0]).toBeCloseTo(0.5, 12);
    expect(toned[2] / toned[0]).toBeCloseTo(0.25, 12);
  });

  it('leaves a colour that already clears the ceiling exactly alone', () => {
    const safe: readonly [number, number, number] = [0.4, 0.2, 0.1];

    expect(tonedForTheSun(safe)).toBe(safe);
  });

  it('answers a colour that is not a colour with black', () => {
    // A `NaN` or a negative reaching a vertex buffer is a mesh three may refuse
    // to draw at all, which is a whole kind gone for a value nobody can see.
    expect(tonedForTheSun([Number.NaN, 0, 0])).toEqual([0, 0, 0]);
    expect(tonedForTheSun([-1, -1, -1])).toEqual([0, 0, 0]);
  });
});

describe('reading a colour out of an atlas', () => {
  /** Four texels: red, green, blue, white, top-left to bottom-right. */
  const quad: AtlasImage = {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
    ]),
  };

  it('reads `v` downwards from the top row, as glTF defines it', () => {
    // The whole of the orientation decision, at two texels. Upside down these
    // two answers swap, which is exactly the failure the black-quarter
    // measurement above found in the committed files.
    expect(atlasColourAt(quad, 0.25, 0.25)).toEqual([1, 0, 0]);
    expect(atlasColourAt(quad, 0.25, 0.75)).toEqual([0, 0, 1]);
  });

  it('reads `u` rightwards', () => {
    expect(atlasColourAt(quad, 0.75, 0.25)).toEqual([0, 1, 0]);
  });

  it('clamps rather than wrapping', () => {
    // A UV outside `[0, 1]` is a fault in the file, and wrapping would answer
    // it with a plausible colour from the far side of the atlas.
    expect(atlasColourAt(quad, -5, -5)).toEqual([1, 0, 0]);
    expect(atlasColourAt(quad, 5, 5)).toEqual([1, 1, 1]);
    expect(atlasColourAt(quad, Number.NaN, Number.NaN)).toEqual([1, 0, 0]);
  });

  it('converts an sRGB byte into the linear space the shader multiplies in', () => {
    // ⚠️ **Not a divide by 255.** A vertex colour written as raw bytes is the
    // mistake `terrain.ts` §`RoadCorridor.colours` records for the road:
    // visibly too bright, and wrong by a different amount per channel.
    expect(srgbByteToLinear(0)).toBe(0);
    expect(srgbByteToLinear(255)).toBeCloseTo(1, 12);
    expect(srgbByteToLinear(128)).toBeCloseTo(0.2158605, 6);
    expect(srgbByteToLinear(10)).toBeCloseTo(0.0030352, 6);
    // Mid-grey is nowhere near 0.5, which is the whole point of the conversion.
    expect(srgbByteToLinear(128)).toBeLessThan(0.3);
  });
});
