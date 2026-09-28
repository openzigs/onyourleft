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
 * The rows of an equirectangular sky whose centres lie between two
 * elevations, in degrees — or, for a sky too coarse to have a row inside the
 * band at all, the one row nearest its middle. Every row: a band ten degrees
 * deep is only fifty-odd rows of a 2K sky, and skipping rows could miss it
 * entirely. Shared by {@link skyBandRadiance} and {@link skyHorizonTable}, so
 * the table and the one colour it is blended towards are read off the same
 * rows.
 */
function bandRows(sky: SkyPixels, fromDegrees: number, toDegrees: number): readonly number[] {
  const from = (fromDegrees * Math.PI) / 180;
  const to = (toDegrees * Math.PI) / 180;
  const inBand = (row: number): boolean => {
    const elevation = elevationOf(row, sky.height);
    return elevation >= from && elevation <= to;
  };
  const rows = Array.from({ length: sky.height }, (_, row) => row).filter(inBand);
  if (rows.length > 0) return rows;
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
  return [nearest];
}

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
  const sum = [0, 0, 0];
  let weights = 0;
  for (const row of bandRows(sky, fromDegrees, toDegrees)) {
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
 * Where the photographed sky's own skyline ends, in degrees above the eye:
 * **5** — #544.
 *
 * `farm_field_2k.hdr` is a photograph taken standing in a field, so its lowest
 * few degrees are not sky at all: a ploughed field, a treeline and distant
 * hills, averaging 0.12 of radiance at 0°, rising to 0.67 at 4° and 0.83 at
 * 5°, and levelling at about 0.9–1.0 from 6° up — read row by row off the
 * committed file on 2026-09-26. Column by column, 83 % of the picture's
 * skyline is at or under 5°. The realistic world is not that field, so where
 * the horizon ring stood lower than this, the photograph's ground was drawn
 * ABOVE the game's hills — the "white film" under a dark treeline on the
 * owner's tablet. `three-renderer.ts` §`HorizonRing` lifts every crest of the
 * realistic ring to at least this elevation ({@link skylineCrestFloor}).
 *
 * ⚠️ **A property of this one photograph.** A different `REALISTIC_SKY` needs
 * this re-read, and {@link REALISTIC_HORIZON_BAND} with it.
 */
export const REALISTIC_SKYLINE_DEGREES = 5;

/**
 * The band of the photographed sky the realistic world's far end converges on,
 * in degrees: **5° to 10°** — the sky just above the photograph's own skyline
 * ({@link REALISTIC_SKYLINE_DEGREES}), which is what the lifted crests of the
 * horizon ring stand against. #475's {@link WATER_HORIZON_BAND} starts at 0°
 * and so averages in the photographed field, which drew the hills darker than
 * the sky behind them; the water keeps it, because it re-scales the hue to the
 * stylised brightness anyway.
 */
export const REALISTIC_HORIZON_BAND: readonly [number, number] = [REALISTIC_SKYLINE_DEGREES, 10];

/**
 * How much of the photographed sky's horizon colour the realistic world's
 * distant ridge carries: **0.8** — #544.
 *
 * The stylised ring's 0.7 (`three-renderer.ts` §`HORIZON_HAZE_SHARE`) was set
 * by eye against the stylised sky, whose output is not tone mapped. Under AgX
 * the same 0.7 put the ridge only 51 % of the way from the ground's luminance
 * to the sky's in the worst column `game.browser.spec.ts` §"the distant hills"
 * reads — barely nearer the sky than the ground — and #544 asks that it
 * converge on the sky's; at 0.8 the worst of those columns is 57 %. At 1.1 km the realistic world's own fog would take a
 * hill entirely, so more haze is the physical direction as well.
 */
export const REALISTIC_HORIZON_HAZE_SHARE = 0.8;

/**
 * The lowest a crest of the realistic horizon ring may stand, in local metres:
 * `eyeY` plus the rise that puts it at `skylineDegrees` above the eye at
 * `radiusMetres` — so no crest is ever drawn below the photograph's own
 * skyline, and the sky above every hill is sky (#544).
 *
 * ⚠️ **It follows the EYE**, which the ring's own heights deliberately do not
 * — and it binds on practically EVERY realistic frame, not only once a rider
 * is high up. The floor is the eye plus `1100 · tan 5° ≈ 96 m`; the route's
 * own crests stand 30 to 150 m above the middle of its elevation
 * (`landform.ts` §`HORIZON_RISE_METRES`), and on a level route the eye is
 * about 2 m above that middle, so the lowest of the 48 crests is almost
 * always under the floor. The whole ridge is then lifted by
 * {@link ridgeLift} and, from there on, rises and falls with the rider's eye
 * one for one: in the realistic world the distant hills behave like a
 * backdrop at infinity, and a rider who climbs does NOT rise past them. That
 * is the trade — the alternative is the photographed field drawn above the
 * world — and validation 0002 Part AG asks the owner to judge it on a climb
 * and a descent.
 */
export function skylineCrestFloor(
  eyeY: number,
  radiusMetres: number,
  skylineDegrees: number = REALISTIC_SKYLINE_DEGREES,
): number {
  return eyeY + radiusMetres * Math.tan((skylineDegrees * Math.PI) / 180);
}

/**
 * How far the whole horizon ring is lifted so that its lowest crest stands at
 * `floor`: `max(0, floor − min(tops))`, in metres — #544.
 *
 * The WHOLE ridge moves by this one amount, keeping its shape; clamping each
 * crest to the floor instead laid every low crest on one level line, which is
 * a hard straight edge of its own. `three-renderer.ts` §`HorizonRing.update`
 * draws with it and the browser gate's probe aims with it, so the two cannot
 * disagree about where a crest is. A floor of `-Infinity` — the stylised
 * world's — lifts nothing, and so does an empty ring.
 */
export function ridgeLift(tops: ArrayLike<number>, floor: number): number {
  let lowest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < tops.length; index += 1) {
    lowest = Math.min(lowest, tops[index] as number);
  }
  const lift = floor - lowest;
  return lift > 0 ? lift : 0;
}

/**
 * The colour the realistic sky is DRAWN at the horizon, in linear light — the
 * one the far end of the realistic world converges on (#544).
 *
 * `band` is {@link skyBandRadiance} over {@link REALISTIC_HORIZON_BAND}, the
 * HDRI's own radiance just above its skyline, and `backgroundIntensity` the factor three
 * multiplies every background texel by (`scene.backgroundIntensity`, which
 * `three-renderer.ts` sets to {@link environmentIntensity}). The product is
 * what reaches the tone mapper from the sky behind a distant hill, so a
 * surface handed this colour, and tone mapped the same way, is drawn at the
 * sky's own brightness.
 *
 * ⚠️ **Unlike {@link reflectedSkyColour} it keeps the photograph's
 * brightness.** The water keeps the stylised world's because its shader was
 * tuned against it; the fog and the distant hills have to MEET the drawn sky,
 * and the stylised world's horizon (`world.ts` §`HORIZON_HAZE`) is brighter
 * than the realistic sky drawn behind it — which is what drew the far hills as
 * a pale band in front of a darker sky (#544).
 */
export function drawnHorizonColour(band: LinearColour, backgroundIntensity: number): LinearColour {
  if (!(backgroundIntensity >= 0) || !Number.isFinite(backgroundIntensity)) {
    throw new Error('a sky drawn at no finite intensity has no horizon colour');
  }
  const [r, g, b] = band;
  return [r * backgroundIntensity, g * backgroundIntensity, b * backgroundIntensity];
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
 * `world.ts`'s `SunStyle` components, `+X` WEST and `+Z` north since #583.
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

/* ============================================================================
 * THE AIR — #622
 * ========================================================================== */

/**
 * How many directions the realistic sky's horizon is read in: **16**, one every
 * 22.5° of azimuth — #622.
 *
 * Enough to carry the one thing a direction changes in `farm_field_2k.hdr`'s
 * band just above its skyline — warmer and brighter on the sun's side, bluer
 * and darker where the treeline stands in the photograph — and few enough to be
 * 16 `vec3` uniforms, 192 bytes, rather than a texture. Read on 2026-09-27
 * off the committed file, bin by bin: luminance 0.46 to 1.82 against a mean of
 * 0.97, blue over red 0.98 on the sun's side against 1.05 opposite it.
 */
export const HORIZON_AZIMUTH_BINS = 16;

/**
 * The sky just above its skyline, read in {@link HORIZON_AZIMUTH_BINS}
 * directions — #622. Bin `i` is the mean of the picture's columns
 * `[i, i + 1) · width / bins`, over the rows {@link skyBandRadiance} reads and
 * weighted as it weights them, so its centre is the picture's column
 * `(i + 0.5) / bins` and — by three's equirectangular convention
 * (@see skyRotation) — the PICTURE's azimuth `((i + 0.5) / bins − 0.5) · 2π`.
 * Read once, at load, off the HDR's own texels; nothing samples the sky per
 * frame.
 *
 * With the same `step`, on a sky at least `step · bins` wide whose width they
 * divide — the committed one is 2 048 — every bin holds the same number of
 * columns, so the mean of the table IS {@link skyBandRadiance} over the same band — which is what
 * makes {@link flattenedTable} the one colour the realistic fog had before
 * #622, and the browser gate's control exactly that.
 *
 * Throws when a bin holds no finite texel, for {@link skyBandRadiance}'s reason.
 */
export function skyHorizonTable(
  sky: SkyPixels,
  fromDegrees: number,
  toDegrees: number,
  bins: number = HORIZON_AZIMUTH_BINS,
  step = 4,
): LinearColour[] {
  const sums = Array.from({ length: bins }, () => [0, 0, 0, 0]);
  // Never so coarse that a direction is skipped: a sky only a few texels wider
  // than there are bins is read column by column.
  const stride = Math.max(1, Math.min(step, Math.floor(sky.width / bins)));
  for (const row of bandRows(sky, fromDegrees, toDegrees)) {
    const weight = Math.cos(elevationOf(row, sky.height));
    for (let column = 0; column < sky.width; column += stride) {
      const at = (row * sky.width + column) * 4;
      const r = sky.channel(at);
      const g = sky.channel(at + 1);
      const b = sky.channel(at + 2);
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) continue;
      const sum = sums[Math.floor((column * bins) / sky.width)] as number[];
      sum[0] = (sum[0] as number) + weight * r;
      sum[1] = (sum[1] as number) + weight * g;
      sum[2] = (sum[2] as number) + weight * b;
      sum[3] = (sum[3] as number) + weight;
    }
  }
  return sums.map(([r = 0, g = 0, b = 0, weights = 0], bin) => {
    if (!(weights > 0)) {
      throw new Error(`the sky has no texel in direction ${String(bin)} of ${String(bins)}`);
    }
    return [r / weights, g / weights, b / weights] as const;
  });
}

/**
 * A table with every direction set to the table's own mean — the browser
 * gate's control for #622, and the realistic fog as it was before it: one
 * colour for every direction. @see skyHorizonTable
 */
export function flattenedTable(table: readonly LinearColour[]): LinearColour[] {
  const mean = [0, 1, 2].map(
    (channel) => table.reduce((sum, each) => sum + each[channel as 0 | 1 | 2], 0) / table.length,
  ) as unknown as LinearColour;
  return table.map(() => mean);
}

/**
 * The table's colour at a PICTURE azimuth, in radians — linearly between the
 * two bins whose centres stand either side of it, wrapping from the last bin to
 * the first. Exactly what `three-renderer.ts` §`ATMOSPHERE_FRAGMENT` does on the
 * GPU, written again here so the browser gate can predict a pixel from it.
 */
export function tableColourAt(
  table: readonly LinearColour[],
  pictureAzimuth: number,
): LinearColour {
  const bins = table.length;
  const at = (pictureAzimuth / (2 * Math.PI) + 0.5) * bins - 0.5;
  const lower = Math.floor(at);
  const share = at - lower;
  const from = table[((lower % bins) + bins) % bins] as LinearColour;
  const to = table[(((lower + 1) % bins) + bins) % bins] as LinearColour;
  return [
    from[0] + (to[0] - from[0]) * share,
    from[1] + (to[1] - from[1]) * share,
    from[2] + (to[2] - from[2]) * share,
  ];
}

/**
 * How far the realistic fog's colour leans from the one horizon colour towards
 * the sky's own colour in the direction a rider looks: **0.5** — #622.
 *
 * ⚠️ **This repository's own choice, and the owner's to re-tune** after
 * validation 0002 Part AG and #622's own row: whether a directional fog helps
 * or fights #544's lifted ridge is judged by eye on the tablet, and nothing in
 * CI can. Not 1, because a 22.5° bin of a photograph taken in a field is not
 * all air: where the photograph's treeline stands above its own skyline (17 %
 * of its columns, @see REALISTIC_SKYLINE_DEGREES) a bin carries trees, and the
 * darkest bins, 0.46 against a mean of 0.97, are exactly those. Half keeps the
 * sun's side warmer and brighter than the far side, as the band says, without
 * painting a treeline into the air. 0 is the realistic fog before #622.
 */
export const REALISTIC_FOG_DIRECTION_SHARE = 0.5;

/**
 * The realistic fog's colour looking along a WORLD azimuth, in radians
 * (`atan2(z, x)` of the view ray in three's world), in whatever space `base`
 * and `table` are in — #622: `base` blended towards the table's colour at that
 * direction by `share`.
 *
 * `turn` is {@link skyRotation}'s: the picture's azimuth is the world's plus
 * it, by the same convention the background and the environment are sampled
 * with, so the fog in a direction is the sky DRAWN in that direction.
 */
export function directionalFogColour(
  base: LinearColour,
  table: readonly LinearColour[],
  share: number,
  worldAzimuth: number,
  turn: number,
): LinearColour {
  const toward = tableColourAt(table, worldAzimuth + turn);
  return [
    base[0] + (toward[0] - base[0]) * share,
    base[1] + (toward[1] - base[1]) * share,
    base[2] + (toward[2] - base[2]) * share,
  ];
}

/**
 * How much denser the realistic fog is at the bottom of a valley than on a
 * ridge: **1.25** times the density, reached {@link REALISTIC_VALLEY_DEPTH_METRES}
 * below the middle of the route's own elevation range — #622.
 *
 * ⚠️ **This repository's own choice, and the owner's to re-tune** with
 * {@link REALISTIC_FOG_DIRECTION_SHARE}. Still air pools in low ground and holds
 * its haze there; how much is a property of a morning, not a constant anybody
 * publishes. A quarter more density is about half as much again of the fog's
 * optical depth (`FogExp2` squares it), which makes a valley floor seen from
 * above read as further away without taking a ridge at the same distance with
 * it. 1 is the realistic fog before #622.
 *
 * ⚠️ **"Below the middle" is the MIDPOINT of the route's elevation range
 * (`landform.ts` §`HorizonRelief.middle`), not the MEAN elevation #622's text
 * names** — a choice, made so the haze and #544's ridge stand on one number,
 * and one the owner may reverse. The two differ most on the routes where it
 * shows: on a flat route with one 200 m climb the midpoint stands 100 m above
 * the flat, so the whole flat is 50 m or more below it and takes the FULL
 * 1.25× haze, where the mean would sit near the flat and haze almost nothing
 * but the dip below it. Validation 0002 Part AH §"#622's rows" asks the owner
 * to judge exactly that route shape.
 */
export const REALISTIC_VALLEY_HAZE = 1.25;

/**
 * How far below the middle of the route's elevation the valley haze reaches
 * its full {@link REALISTIC_VALLEY_HAZE}, in metres: **50** — about the depth of
 * `valleyRoute`'s own valley, so the haze deepens across a valley rather than
 * switching on at its rim.
 */
export const REALISTIC_VALLEY_DEPTH_METRES = 50;

/**
 * The factor the realistic fog's density is multiplied by at a height, in local
 * metres — #622: 1 at or above `middle` (the MIDPOINT of the route's own
 * elevation range, `landform.ts` §`HorizonRelief.middle` — not its mean, and
 * {@link REALISTIC_VALLEY_HAZE} says what that costs a flat route with one
 * climb), rising linearly to
 * `haze` at `depth` metres below it and no further. The same arithmetic
 * `three-renderer.ts` §`ATMOSPHERE_FRAGMENT` does on the GPU.
 *
 * @test-facing the shader's arithmetic written again, so `realistic-light.test.ts`
 * can state it and the browser gate's harness can predict a pixel from it;
 * the product does it in GLSL and never calls this
 */
export function valleyHazeFactor(
  height: number,
  middle: number,
  haze: number = REALISTIC_VALLEY_HAZE,
  depth: number = REALISTIC_VALLEY_DEPTH_METRES,
): number {
  const below = Math.min(Math.max((middle - height) / depth, 0), 1);
  return 1 + (haze - 1) * below;
}

/*
 * ## The grade #622 offered, and why AgX alone is kept
 *
 * #622 offers a grade inside `tonemapping_fragment` — contrast, saturation and
 * white balance — or a written decision that AgX alone is kept. **AgX alone is
 * kept**, for three reasons, and the owner can reverse it:
 *
 * 1. **Every colour gate the realistic world has was measured through AgX.**
 *    The road's climb and descent (`MINIMUM_TINT_CONTRAST_RATIO`, information,
 *    #242), #544's ridge between ground and sky, #621's tints, #620's ground
 *    darkening and the window glass are each held to bounds taken on this
 *    tone map. A grade moves every one of them at once, and for no reason a
 *    rider asked for.
 * 2. **There is nothing to grade TOWARDS.** ADR 0009 forbids matching another
 *    product's pictures, and the one reference this project may use — the
 *    owner's eye on the tablet — has not looked yet: validation 0002 Part AG's
 *    rows are empty. Three or four constants chosen now would be taste with no
 *    measurement behind them, and they would change the colours #544 set
 *    before anybody has judged #544.
 * 3. **A grade inside the tone map is global and a fog is not.** The fog above
 *    is patched on the realistic world's own materials. A grade would have to
 *    reach three's own background material too — or the sky would be ungraded
 *    behind a graded world, the seam #544 removed — and three builds that one.
 *
 * So there is no grade constant here, deliberately: the grade is
 * [#701](https://github.com/openzigs/onyourleft/issues/701), to be decided
 * after Part AG and #622's own by-eye rows.
 */
