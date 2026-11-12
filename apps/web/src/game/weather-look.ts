// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How a Delivery level's dusk and rain look, in both worlds — #2508, the
 * owner's ruling on PR #2502 (#2366, ADR 0065 D-10.4): its dusk "reads as an
 * overcast day", the ground only a little darker under a blue sky with bright
 * white clouds, and its rain is "thin, sparse streaks".
 *
 * ## The world, re-lit, and nothing drawn more
 *
 * {@link weatheredWorld} takes the route's `world.ts` §`WorldStyle` and
 * returns the one the frame is drawn in: at dusk a deep blue sky over an
 * orange-pink horizon, a low warm sun, less sky light and a darker, warmer
 * ground; in rain a greyer sky, a duller sun, a little less sky light and a
 * thicker haze. The view
 * draws every frame from it (`three-renderer.ts` §`ThreeGameView.render`), so
 * the sky dome, the fog, the lamps, the ground and the water all agree, in
 * both worlds, and it costs no draw call: only colours and intensities
 * change. The realistic world's photographed sky is graded to match
 * (`realistic-light.ts` §`duskSkyTexel`) and its exposure lowered
 * (`realistic-light.ts` §`REALISTIC_DUSK_EXPOSURE_SHARE`).
 *
 * ## The drawing only
 *
 * Nothing here is read by the round, the throw, the obstacles, the ride or
 * the trainer: the frame's world is a drawing (ADR 0065 D-11). The targets
 * still show inside `delivery/in-view.ts` §`LOW_LIGHT_REVEAL_METRES`, and each
 * marker still glows, whatever the light.
 *
 * This project's own numbers, for the owner's approval in #2508's pull
 * request. Pure: no three, no DOM.
 */

import type { DeliveryWeatherFrame } from './port';
import type { SunStyle, WorldStyle } from './world';

/** The sky overhead at dusk, sRGB: a deep blue. */
export const DUSK_SKY_COLOUR = 0x28335f;

/** The sky at the horizon at dusk, and what the haze converges on, sRGB: an orange-pink. */
export const DUSK_HORIZON_COLOUR = 0xd98a62;

/** The sun's light at dusk, sRGB: a low warm orange. White by day. */
export const DUSK_SUN_COLOUR = 0xffa060;

/** The sun's light by day: white, as `three-renderer.ts` §`WorldLamps` has always lit it. */
export const DAY_SUN_COLOUR = 0xffffff;

/** How high the sun stands at dusk, degrees above the horizon, its bearing kept. */
export const DUSK_SUN_ELEVATION_DEGREES = 8;

/** What share of its daytime light the sun gives at dusk. */
export const DUSK_DIRECT_SHARE = 0.55;

/** What share of its daytime light the sky gives at dusk. */
export const DUSK_AMBIENT_SHARE = 0.45;

/** The ground's colour at dusk, as a share of its daytime colour, each channel: darker, and warmer. */
export const DUSK_GROUND_TINT: readonly [number, number, number] = [0.62, 0.52, 0.44];

/** How much thicker the haze is in rain. */
export const RAIN_FOG_SHARE = 1.8;

/** The grey a rain sky is drawn toward, sRGB. */
export const RAIN_SKY_GREY = 0x6b737c;

/** How far toward {@link RAIN_SKY_GREY} the sky and the horizon are drawn in rain. */
export const RAIN_GREY_SHARE = 0.55;

/** What share of its light the sun gives through rain cloud. */
export const RAIN_DIRECT_SHARE = 0.5;

/** What share of its light the sky gives under rain cloud. */
export const RAIN_AMBIENT_SHARE = 0.8;

/** `from` moved `share` of the way to `to`, each sRGB channel. */
function mixed(from: number, to: number, share: number): number {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    out |= Math.round(a + (b - a) * share) << shift;
  }
  return out;
}

/** `colour` with each sRGB channel scaled by its share of `tint`. */
function tinted(colour: number, tint: readonly [number, number, number]): number {
  let out = 0;
  [16, 8, 0].forEach((shift, channel) => {
    const value = Math.round(((colour >> shift) & 0xff) * (tint[channel] as number));
    out |= Math.min(255, Math.max(0, value)) << shift;
  });
  return out;
}

/** The sun at dusk: low, its bearing kept, and dimmer. */
function duskSun(sun: SunStyle): SunStyle {
  const level = Math.hypot(sun.x, sun.z);
  // An overhead sun has no bearing: it sets in the north.
  const [x, z] = level > 1e-9 ? [sun.x / level, sun.z / level] : [0, 1];
  const elevation = (DUSK_SUN_ELEVATION_DEGREES * Math.PI) / 180;
  return {
    x: x * Math.cos(elevation),
    y: Math.sin(elevation),
    z: z * Math.cos(elevation),
    ambient: sun.ambient * DUSK_AMBIENT_SHARE,
    direct: sun.direct * DUSK_DIRECT_SHARE,
  };
}

/**
 * The world a frame is drawn in, under `weather` — #2508. Clear daylight, or
 * no weather, is `world` itself. Dusk and rain together are dusk, then rain.
 */
export function weatheredWorld(world: WorldStyle, weather?: DeliveryWeatherFrame): WorldStyle {
  if (weather === undefined || (!weather.dusk && !weather.rain)) return world;
  let out = world;
  if (weather.dusk) {
    out = {
      ...out,
      skyColour: DUSK_SKY_COLOUR,
      horizonColour: DUSK_HORIZON_COLOUR,
      groundColour: tinted(out.groundColour, DUSK_GROUND_TINT),
      sun: duskSun(out.sun),
    };
  }
  if (weather.rain) {
    out = {
      ...out,
      skyColour: mixed(out.skyColour, RAIN_SKY_GREY, RAIN_GREY_SHARE),
      horizonColour: mixed(out.horizonColour, RAIN_SKY_GREY, RAIN_GREY_SHARE),
      fogDensity: out.fogDensity * RAIN_FOG_SHARE,
      sun: {
        ...out.sun,
        ambient: out.sun.ambient * RAIN_AMBIENT_SHARE,
        direct: out.sun.direct * RAIN_DIRECT_SHARE,
      },
    };
  }
  return out;
}

/**
 * The stylised road's paint at dusk, linear, each channel — #2508: the road's
 * colours are its own and unlit (`terrain.ts`), so the dusk's light does not
 * reach them, and an unlit pale road under a dark sky reads as day. About
 * 0.6 of its daytime brightness, a little warm. Its gradient tint keeps its
 * contrast: every colour on the road is scaled alike.
 */
export const DUSK_ROAD_TINT: readonly [number, number, number] = [0.36, 0.32, 0.28];

/** The stylised road's paint in rain, linear: darker, as a wet road is. */
export const RAIN_ROAD_TINT: readonly [number, number, number] = [0.7, 0.7, 0.72];

/** The stylised road's paint under `weather`, linear: white (its own colours) in clear daylight. */
export function roadTintIn(weather?: DeliveryWeatherFrame): readonly [number, number, number] {
  const tint: [number, number, number] = [1, 1, 1];
  for (const [on, by] of [
    [weather?.dusk === true, DUSK_ROAD_TINT],
    [weather?.rain === true, RAIN_ROAD_TINT],
  ] as const) {
    if (!on) continue;
    for (const channel of [0, 1, 2] as const) tint[channel] *= by[channel];
  }
  return tint;
}

/** The colour the sun's lamp is lit in, under `weather`: warm at dusk, white otherwise. */
export function sunColourIn(weather?: DeliveryWeatherFrame): number {
  return weather?.dusk === true ? DUSK_SUN_COLOUR : DAY_SUN_COLOUR;
}

/** An sRGB channel in [0, 1], in linear light. */
function linearOf(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** A packed sRGB colour, in linear light, each channel. */
function linearColourOf(colour: number): [number, number, number] {
  return [16, 8, 0].map((shift) => linearOf(((colour >> shift) & 0xff) / 255)) as [
    number,
    number,
    number,
  ];
}

/**
 * How the scenery is shaded under `weather`, linear, each channel — the
 * owner's ruling on PR #2522 ("trees stay bright green and look pasted on"):
 * at dusk **exactly the ground's own darkening**, the linear light of the
 * route's ground tinted by {@link DUSK_GROUND_TINT} over that of its ground,
 * so a tree, a shrub, a hedge and a far impostor go down with the verge they
 * stand on, and warm with it. White (nothing) otherwise: rain re-lights them
 * through the sun, as it does the ground. `world` is the route's own, before
 * the weather. Applied by `three-renderer.ts` to the stylised scenery's
 * colour and to the realistic vegetation's and hedges' surface colour, and
 * to no draw call.
 */
export function sceneryShadeIn(
  world: WorldStyle,
  weather?: DeliveryWeatherFrame,
): readonly [number, number, number] {
  if (weather?.dusk !== true) return [1, 1, 1];
  const day = linearColourOf(world.groundColour);
  const dusk = linearColourOf(tinted(world.groundColour, DUSK_GROUND_TINT));
  // A channel the ground has none of takes the tint's own share of it.
  return [0, 1, 2].map((channel) => {
    const from = day[channel] as number;
    return from > 0
      ? (dusk[channel] as number) / from
      : linearOf(DUSK_GROUND_TINT[channel] as number);
  }) as unknown as readonly [number, number, number];
}

/**
 * How much of the route's own light reaches a surface under the drawn
 * world's sun, linear, each channel — PR #2522: the sky's share and half the
 * sun's (a surface turned no way in particular), the sun's in its colour
 * ({@link sunColourIn}), `drawn` over `day`. 1 in clear daylight; at dusk
 * dimmer and warm, in rain dimmer. For what the lamps do not reach: a far
 * tree's impostor, whose relight is a ratio and so keeps its daytime
 * brightness under any sun, and the rain's streaks, which are unlit.
 */
export function sceneLightIn(
  day: SunStyle,
  drawn: SunStyle,
  weather?: DeliveryWeatherFrame,
): readonly [number, number, number] {
  const whole = day.ambient + day.direct / 2;
  if (!(whole > 0)) return [1, 1, 1];
  const sun = linearColourOf(sunColourIn(weather));
  return sun.map(
    (channel) => (drawn.ambient + (drawn.direct / 2) * channel) / whole,
  ) as unknown as readonly [number, number, number];
}
