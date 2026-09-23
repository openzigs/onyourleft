// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How the realistic world is lit, as arithmetic — #425, [ADR 0026](../../../../docs/adr/0026-realistic-game-world.md)
 * D-9 and D-10.
 *
 * ## One sun, one sky, and the numbers that make them agree
 *
 * D-9: the realistic world adds **no light class**. Its sky is a CC0 HDRI
 * that is both the background and — prefiltered by three's `PMREMGenerator`
 * into `scene.environment` — the ambient term every physically based material
 * receives; the one `DirectionalLight` is still `world.ts`'s sun. Two things
 * have to be decided for those to be one sky rather than two, and both are
 * solved here rather than set by eye (#457 set them by eye):
 *
 * 1. **How bright the environment is** — {@link environmentIntensity}. The
 *    stylised world's lamps are solved so that a horizontal surface receives
 *    exactly `world.ts`'s ambient share plus its direct share, which is 1. The
 *    environment replaces the ambient lamp, so it is scaled until a horizontal
 *    surface receives exactly that same ambient share from it. What a
 *    horizontal surface receives from a sky is the sky's upper hemisphere,
 *    cosine-weighted — {@link upwardRadiance} reads it off the HDR's own pixels.
 * 2. **Which way the sky faces** — {@link skyRotation}. The HDRI was
 *    photographed with its sun somewhere; `world.ts` puts its sun at
 *    `SUN_AZIMUTH_DEGREES`. The background and the environment are both turned
 *    about the vertical until the two agree, so a tree's lit side faces the
 *    bright part of the sky behind it.
 *
 * ## What the realistic path can clip, which D-10 says this issue owes
 *
 * `scenery-palette.ts` §`SCENERY_PALETTE` bounds the stylised world's colours
 * under its unmapped, linear output. It does not cover a texture and must not
 * be read as though it did. The realistic path is **tone mapped with AgX**,
 * which does not clip at 1: it compresses, and only an input at or above
 * {@link AGX_WHITE_INPUT} — about 16.3 in linear light — reaches white. So:
 *
 * - **No lit surface can clip.** Its input is at most its albedo, which a
 *   texture cannot put above 1, times the irradiance `world.ts` allows at its
 *   peak (`PEAK_IRRADIANCE`, about 1.2) — an order of magnitude under the white
 *   point. `realistic-light.test.ts` holds that inequality to the two real
 *   constants, so raising the sun or the exposure fails there first.
 * - **The sky can, and does, and that is the photograph.** A clear HDRI's sun
 *   disc is thousands of times brighter than its sky; it reaches white, which
 *   is what a sun does in any photograph. It carries no information a rider
 *   reads.
 * - **What tone mapping does to information is COMPRESSION, not clipping**, and
 *   the one colour here that is information — the road's gradient tint (#242) —
 *   is therefore measured after tone mapping rather than argued about:
 *   `game.browser.spec.ts` §"the realistic world" reads the steepest climb and
 *   the steepest descent off a real drawing buffer and holds them to
 *   `MINIMUM_TINT_CONTRAST_RATIO`.
 *
 * Pure: no three, no DOM. `three-renderer.ts` applies what this decides.
 */

import { ROAD_SURFACE_GRAIN } from './terrain';

/**
 * The linear input at which three's AgX saturates to white: 2 to the power of
 * `AgxMaxEv`, which three 0.185.1's `tonemapping_pars_fragment.glsl.js`
 * declares as `4.026069` (*"log2(pow(2, LOG2_MAX) * MIDDLE_GRAY)"*, with
 * `LOG2_MAX = 6.5` and `MIDDLE_GRAY = 0.18`). Read out of the shader rather
 * than chosen; a three bump that moved it would move this.
 *
 * @test-facing held by `realistic-light.test.ts`, which is where D-10's
 * clipping statement is asserted against `world.ts`'s peak irradiance
 */
export const AGX_WHITE_INPUT = 2 ** 4.026069;

/**
 * The exposure the realistic world is tone mapped at: **1**, three's default.
 * Nothing here scales it, because the lighting is solved to put a horizontal
 * surface where the stylised world puts it; a different exposure would be a
 * second knob on the same brightness.
 */
export const REALISTIC_EXPOSURE = 1;

/** A half-precision float's value. IEEE 754-2008 binary16. */
export function halfToFloat(half: number): number {
  const sign = half & 0x8000 ? -1 : 1;
  const exponent = (half >> 10) & 0x1f;
  const fraction = half & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

/**
 * An equirectangular HDR's texels, as three's HDR loader leaves them.
 */
export interface SkyPixels {
  readonly width: number;
  readonly height: number;
  /** RGBA, four channels a texel, row 0 at the TOP of the picture. */
  readonly channel: (index: number) => number;
}

/** Relative luminance of linear RGB, Rec. 709 — the weights `contrast.ts` uses. */
function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The elevation of a row's centre, in radians: +π/2 at the top row, −π/2 at the bottom. */
function elevationOf(row: number, height: number): number {
  return Math.PI / 2 - ((row + 0.5) / height) * Math.PI;
}

/**
 * The cosine-weighted mean radiance of the sky's upper hemisphere — what a
 * horizontal Lambertian surface sees, divided by π — as a luminance.
 *
 * Each texel of an equirectangular image covers a solid angle proportional to
 * the cosine of its elevation, and faces a horizontal surface at the sine of
 * it, so the sum is weighted by both. Normalised by the same sum over a sky of
 * radiance 1, so a uniform sky of radiance `L` answers exactly `L`.
 *
 * `step` samples every `step`-th texel in both directions: a 2K sky is two
 * million texels, and the answer is a mean.
 */
export function upwardRadiance(sky: SkyPixels, step = 4): number {
  let weighted = 0;
  let weights = 0;
  for (let row = 0; row < sky.height / 2; row += step) {
    const elevation = elevationOf(row, sky.height);
    if (elevation <= 0) continue;
    const weight = Math.sin(elevation) * Math.cos(elevation);
    for (let column = 0; column < sky.width; column += step) {
      const at = (row * sky.width + column) * 4;
      const value = luminance(sky.channel(at), sky.channel(at + 1), sky.channel(at + 2));
      if (!Number.isFinite(value)) continue;
      weighted += weight * value;
      weights += weight;
    }
  }
  if (!(weights > 0) || !(weighted > 0)) {
    throw new Error('the sky has no upper hemisphere to light anything with');
  }
  return weighted / weights;
}

/** A colour in linear light, red, green and blue. */
export type LinearColour = readonly [number, number, number];

/**
 * The elevations, in degrees, whose sky the realistic water reflects as its
 * "sky" and its "horizon" colour — #475. #459's water shader mixes two colours
 * along the reflected ray, reaching the sky's at 0.4 of the way up (about 24°);
 * these are the two bands of the HDRI those two colours stand for.
 */
export const WATER_ZENITH_BAND: readonly [number, number] = [30, 90];

/**
 * The horizon's band. @see WATER_ZENITH_BAND
 */
export const WATER_HORIZON_BAND: readonly [number, number] = [0, 10];

/**
 * The mean radiance of the sky between two elevations, in degrees, as linear
 * RGB — every column of each row, each row weighted by the cosine of its
 * elevation, which is the solid angle an equirectangular row covers. So it is
 * an average over the whole ring of sky, and turning the sky
 * ({@link skyRotation}) cannot move it.
 *
 * Throws when the band holds no finite texel: a water surface reflecting a
 * colour nobody measured is a quieter failure than a world that did not load.
 */
export function skyBandRadiance(
  sky: SkyPixels,
  fromDegrees: number,
  toDegrees: number,
  step = 4,
): LinearColour {
  const from = (fromDegrees * Math.PI) / 180;
  const to = (toDegrees * Math.PI) / 180;
  const sum = [0, 0, 0];
  let weights = 0;
  // Every ROW, and every `step`-th column: a band ten degrees deep is only
  // fifty-odd rows of a 2K sky, and skipping rows could miss it entirely. A
  // sky too coarse to have a row inside the band at all is read at the one
  // row nearest its middle.
  const inBand = (row: number): boolean => {
    const elevation = elevationOf(row, sky.height);
    return elevation >= from && elevation <= to;
  };
  let rows = Array.from({ length: sky.height }, (_, row) => row).filter(inBand);
  if (rows.length === 0) {
    const middle = (from + to) / 2;
    let nearest = 0;
    for (let row = 1; row < sky.height; row += 1) {
      if (
        Math.abs(elevationOf(row, sky.height) - middle) <
        Math.abs(elevationOf(nearest, sky.height) - middle)
      ) {
        nearest = row;
      }
    }
    rows = [nearest];
  }
  for (const row of rows) {
    const elevation = elevationOf(row, sky.height);
    const weight = Math.cos(elevation);
    for (let column = 0; column < sky.width; column += step) {
      const at = (row * sky.width + column) * 4;
      const r = sky.channel(at);
      const g = sky.channel(at + 1);
      const b = sky.channel(at + 2);
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) continue;
      sum[0] = (sum[0] ?? 0) + weight * r;
      sum[1] = (sum[1] ?? 0) + weight * g;
      sum[2] = (sum[2] ?? 0) + weight * b;
      weights += weight;
    }
  }
  if (!(weights > 0)) {
    throw new Error(
      `the sky has no texel between ${String(fromDegrees)}° and ${String(toDegrees)}°`,
    );
  }
  return [(sum[0] ?? 0) / weights, (sum[1] ?? 0) / weights, (sum[2] ?? 0) / weights];
}

/**
 * A band of the realistic sky ({@link skyBandRadiance}) as the colour the
 * water reflects: its HUE, at the brightness `targetLuminance` asks for — #475.
 *
 * ⚠️ **The hue is the photograph's and the brightness is not.** #459's water
 * was tuned against the stylised sky's two colours, and its shader is not tone
 * mapped; an HDRI's absolute radiance is whatever the photographer exposed.
 * So the realistic rungs keep the brightness the stylised world's water was
 * judged at — `three-renderer.ts` passes the luminance of `world.ts`'s own sky
 * and horizon colours — and take the colour of the sky actually drawn behind
 * the water, so a lake under a grey HDRI is grey rather than the stylised
 * world's blue. A band with no light at all answers black.
 */
export function reflectedSkyColour(band: LinearColour, targetLuminance: number): LinearColour {
  const [r, g, b] = band;
  const measured = luminance(r, g, b);
  if (!(measured > 0) || !(targetLuminance > 0)) return [0, 0, 0];
  const scale = targetLuminance / measured;
  return [r * scale, g * scale, b * scale];
}

/**
 * Where in the picture the sky's sun is: the brightest texel of its upper
 * hemisphere, as a horizontal texture coordinate in [0, 1).
 */
export function skySunU(sky: SkyPixels, step = 2): number {
  let brightest = -Infinity;
  let found = 0;
  for (let row = 0; row < sky.height / 2; row += step) {
    for (let column = 0; column < sky.width; column += step) {
      const at = (row * sky.width + column) * 4;
      const value = luminance(sky.channel(at), sky.channel(at + 1), sky.channel(at + 2));
      if (value > brightest) {
        brightest = value;
        found = column;
      }
    }
  }
  return (found + 0.5) / sky.width;
}

/**
 * How far to turn the sky about the vertical, in radians, so that its sun
 * stands at the same azimuth as `world.ts`'s — for `scene.backgroundRotation`
 * and `scene.environmentRotation` alike.
 *
 * ## The convention, read out of three 0.185.1 rather than assumed
 *
 * - An equirectangular texture maps a direction `d` to
 *   `u = atan(d.z, d.x) / 2π + 0.5` (`common.glsl.js` §`equirectUv`), so the
 *   picture's column `u` is the azimuth `(u − 0.5) · 2π` measured from `+X`
 *   towards `+Z`.
 * - The background and the environment both sample at `Rᵀ · d`, where `R` is
 *   the rotation the scene's Euler describes (`WebGLBackground.js` and
 *   `WebGLMaterials.js` transpose it). A turn of `θ` about `+Y` therefore
 *   samples the picture at the world azimuth plus `θ`.
 *
 * So `θ` is the picture's sun azimuth less the world's. `sunX` and `sunZ` are
 * `world.ts`'s `SunStyle` components, `+X` east and `+Z` north.
 */
export function skyRotation(sunU: number, sunX: number, sunZ: number): number {
  const picture = (sunU - 0.5) * 2 * Math.PI;
  const world = Math.atan2(sunZ, sunX);
  return picture - world;
}

/**
 * The `scene.environmentIntensity` that gives a horizontal surface exactly
 * `ambientShare` of light from the sky — the share the stylised world's
 * ambient lamp gives it, which the environment replaces.
 *
 * ⚠️ **Why the division is enough.** three's physically based diffuse term
 * from an environment is `π · C · I · albedo / π` — `getIBLIrradiance` times
 * `BRDF_Lambert` — where `C` is the prefiltered map at full roughness, which is
 * the cosine-convolved radiance {@link upwardRadiance} estimates. So a
 * horizontal surface receives `albedo · I · C`, and `I = ambientShare / C` puts
 * it at `albedo · ambientShare`: exactly the stylised world's ambient. The
 * prefilter is a GGX lobe rather than a true cosine, which is the one
 * approximation, and it errs by a few per cent on a sky this soft.
 */
export function environmentIntensity(ambientShare: number, skyUpwardRadiance: number): number {
  if (!(skyUpwardRadiance > 0)) {
    throw new Error('a sky with no light cannot be scaled to give some');
  }
  return ambientShare / skyUpwardRadiance;
}

/**
 * The most a photographic road texture may lighten or darken the gradient tint
 * it is drawn over: **±15 %**, `terrain.ts` §`ROAD_SURFACE_GRAIN`'s own bound.
 *
 * ⚠️ **The tint is information and the photograph is not** (#242, ADR 0026
 * D-2). So the photograph never colours the road: its luminance, divided by
 * its own mean — the texture's smallest mip, one texel that IS the mean — is a
 * grain the tint is multiplied by, and that grain is clamped to this band in
 * the shader. The same bound the procedural grain has, so the same worst case
 * `terrain.test.ts` holds to `MINIMUM_TINT_CONTRAST_RATIO` holds for the
 * photograph before any light reaches it; what light and tone mapping then do
 * to it is measured in the browser.
 */
export const PHOTOGRAPHIC_ROAD_GRAIN = ROAD_SURFACE_GRAIN;
