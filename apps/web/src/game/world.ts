// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How the world looks, derived from the route and from nothing else — #241.
 *
 * ## Why this is a pure function and not three lines inside the renderer
 *
 * `terrain.ts` gives the road its shape; this gives everything around it its
 * colour. Both are arithmetic over #89's `RouteProfile`, both cross
 * `port.ts`'s `SceneFrame`, and `three-renderer.ts` stays the one file that
 * names `three`. That is FR-2 and FR-3 of #240, and it is what lets every
 * number below be asserted in jsdom where no GL context exists.
 *
 * ⚠️ **Nothing here was consulted from another product.** #19 and ADR 0009 L2
 * forbid deriving a world asset, texture or palette from Zwift, Rouvy, FulGaz
 * or anything else — *including "for reference"*. The inputs are the athlete's
 * own imported route; the outputs are eight sRGB values this repository chose
 * and a fog density derived from `@onyourleft/physics`'s ISO 2533 atmosphere.
 * §"Provenance" below says which is which, because "it looked right" is the
 * answer #240's BR-1 exists to prevent.
 *
 * ## The two axes a route is read on
 *
 * **Latitude.** The mean absolute latitude of the route's own positions. The
 * sun's elevation falls monotonically from the equator to a pole, and with it
 * the colour of the sky and what grows under it. {@link warmth} is that axis,
 * 1 at the equator and 0 at a pole.
 *
 * **Altitude, twice over.** The mean elevation decides two different things and
 * they are deliberately computed separately:
 *
 * - *What the ground is made of* — through the **local tree line**, which is
 *   itself a function of latitude. A 2 000 m route at 46° N is above the trees;
 *   the same 2 000 m at the equator is deep in them. A single altitude
 *   threshold would get both wrong.
 * - *How far you can see* — through **air density**, from
 *   `airDensityKilogramsPerCubicMetre`. Thinner air scatters less, so an alpine
 *   route is clearer than a sea-level one. This is the one number here that is
 *   physics rather than choice.
 *
 * ## Provenance — measured fact, and this repository's own choices
 *
 * | Constant | Where it came from |
 * |---|---|
 * | {@link WORLD_LOWEST_LAND_METRES} | The Dead Sea shore, the lowest exposed land on earth. A published elevation, used as a clamp |
 * | {@link WORLD_HIGHEST_LAND_METRES} | Everest, 8 848.86 m, the 2020 China–Nepal joint survey, rounded to the metre |
 * | Air density | ISO 2533:1975, through `@onyourleft/physics`. Every constant in it is cited in `packages/physics/README.md` §2 |
 * | {@link TREE_LINE_AT_EQUATOR_METRES}, {@link TREE_LINE_SEA_LEVEL_LATITUDE_DEGREES} | Two published anchors — equatorial tree lines in the Andes and on Kilimanjaro sit near 3 900–4 000 m, and the northern tree line reaches the coast near 70° N. **The straight line between them is this repository's own approximation**, not anybody's table |
 * | {@link SNOW_BAND_METRES} | **This repository's own.** Tree line and snow line are separated by a few hundred metres to a kilometre and no single published figure applies everywhere |
 * | {@link FOG_OCCLUSION_AT_VIEW_END} | **This repository's own**, and it is a requirement rather than a taste: #241 keeps `VIEW_AHEAD_METRES` at 400 and hides the corridor's cut end with depth instead of extending it. The density follows from this number and from `terrain.ts`'s own view distance, so the two cannot drift |
 * | The eight sRGB endpoints | **This repository's own**, chosen to satisfy the properties `world.test.ts` asserts — the sky's blue channel is always its largest, the ground brightens monotonically from vegetation through rock to snow — rather than to match any image |
 *
 * ## What it deliberately does not model
 *
 * Weather, season, time of day and aerosol load. None of them is in a
 * `RouteProfile`, and inventing one would make the world stop being a function
 * of the route — which is the one property that keeps #240 clear of ADR 0009
 * entirely. A route ridden twice looks the same twice, and that is the trade.
 */

import { altitudeMetres, degreesCelsius } from '@onyourleft/domain';
import {
  airDensityKilogramsPerCubicMetre,
  SEA_LEVEL_STANDARD_TEMPERATURE_KELVIN,
  TROPOSPHERIC_LAPSE_RATE_KELVIN_PER_METRE,
} from '@onyourleft/physics';

import { VIEW_AHEAD_METRES } from './terrain';

import type { GeographicPosition, RouteProfile } from '@onyourleft/domain';

/**
 * How the world looks, derived from the route. Pure; no `three` type appears
 * here, which is what lets it cross `port.ts`.
 */
export interface WorldStyle {
  /** Packed 0xRRGGBB. */
  readonly skyColour: number;
  readonly groundColour: number;
  readonly horizonColour: number;
  /** Exponential fog density, per metre. 0 disables fog. */
  readonly fogDensity: number;
}

/**
 * The most profile samples the two means are taken over: **256**.
 *
 * The latitude band and the altitude band of a route are properties of the
 * whole route, and 256 evenly-strided samples describe them as well as 20 000
 * do. The bound matters because `scene.ts` calls this **every frame**, on the
 * same JavaScript thread GATT notifications arrive on — #240's NFR-2. Without
 * it a 200 km import would make the cost of a frame a function of the route's
 * length, which is the shape `terrain.ts`'s {@link MAXIMUM_CORRIDOR_QUADS}
 * exists to avoid one layer down.
 */
export const WORLD_SAMPLE_LIMIT = 256;

/** The Dead Sea shore: the lowest exposed land there is, in metres. */
export const WORLD_LOWEST_LAND_METRES = -430;

/** Everest, from the 2020 China–Nepal joint survey, in metres. */
export const WORLD_HIGHEST_LAND_METRES = 8849;

/** The tree line at the equator, in metres. @see the provenance table above. */
export const TREE_LINE_AT_EQUATOR_METRES = 3900;

/** The latitude at which the tree line reaches sea level, in degrees. */
export const TREE_LINE_SEA_LEVEL_LATITUDE_DEGREES = 70;

/** How far above the local tree line the ground is taken as permanent snow. */
export const SNOW_BAND_METRES = 1000;

/**
 * How much of the horizon's colour the corridor's cut end has taken on: 0.95.
 *
 * This is the whole reason #241 prefers fog to a longer corridor. `terrain.ts`
 * builds {@link VIEW_AHEAD_METRES} of road and then stops, and the stop is a
 * straight edge hanging in space. Extending the corridor moves the edge and
 * costs vertices every frame; fading it out costs nothing and is what a real
 * atmosphere does to a distant road anyway.
 *
 * The density is **solved from this number**, so raising the view distance
 * thins the fog automatically and the two cannot disagree.
 */
export const FOG_OCCLUSION_AT_VIEW_END = 0.95;

/**
 * The least the cut end may be faded, however thin the air is: 0.75.
 *
 * The physical derivation below ties fog to air density, which is right and has
 * one consequence at the top of its range: on the highest land there is, the
 * air is 61 % thinner and the cut end would be only a third faded — a straight
 * edge hanging in space, which is the artefact this whole mechanism exists to
 * remove.
 *
 * ⚠️ So the density has a floor, and the floor **binds above about 3 300 m**.
 * Two routes above that altitude get the same fog. That is stated rather than
 * hidden: the alternative is a visible cut end on the routes that most want a
 * long view, and the range a rider actually rides in — sea level to the highest
 * paved passes — is almost entirely below it.
 */
export const MINIMUM_VIEW_END_OCCLUSION = 0.75;

/**
 * The most the fog may dim the road immediately under the rider: 2 %.
 *
 * A fog dense enough to hide the cut end at 400 m must still leave the road the
 * rider is actually on looking like road. `world.test.ts` asserts this at zero
 * depth and at the chase camera's own distance, because a density that failed
 * it would be a grey screen rather than a visible bug.
 */
export const NEAR_FOG_LIMIT = 0.02;

/**
 * The sky at the equator, at sea level.
 *
 * All three sky endpoints have blue as their largest channel and green as their
 * second, which is the property that survives being mixed: any blend of them is
 * still blue-dominant, so the sky reads as sky at every point on both axes.
 */
const SKY_TROPICAL = 0x7fb4e0;
/** The sky at a pole: the same air with the sun much lower in it. */
const SKY_POLAR = 0x9fb3c4;
/** The sky with most of the air below you. */
const SKY_THIN_AIR = 0x1d4f8f;

/**
 * Haze, which pools at the horizon and is what the fog is coloured with.
 *
 * Exported so `world.test.ts` can state the one property the horizon has that
 * is not visible from the outside: it runs from this towards the sky as the air
 * thins, rather than being a third independent colour.
 */
export const HORIZON_HAZE = 0xb8c2c9;

/** What grows at sea level at the equator. */
const VEGETATION_TROPICAL = 0x3f6b2e;
/** What grows at sea level at a pole. */
const VEGETATION_POLAR = 0x5a6347;
/** The ground at the tree line. */
const ROCK = 0x7a7468;
/** The ground a kilometre above it. */
const SNOW = 0xe8edf2;

/** Sea-level standard temperature in degrees Celsius: 15, from ISO 2533. */
const SEA_LEVEL_STANDARD_TEMPERATURE_CELSIUS = SEA_LEVEL_STANDARD_TEMPERATURE_KELVIN - 273.15;

/** Air density at the reference the ISO 2533 table is quoted at. */
const SEA_LEVEL_AIR_DENSITY = standardAirDensity(0);

/**
 * How much thinner the air is on the highest land there is.
 *
 * The full scale of the altitude axis, so that {@link worldStyle}'s blend runs
 * over the range the earth actually offers rather than over a range somebody
 * picked. Nothing clamps to it except a route on Everest.
 */
const THIN_AIR_FULL_SCALE =
  1 - standardAirDensity(WORLD_HIGHEST_LAND_METRES) / SEA_LEVEL_AIR_DENSITY;

/**
 * The fog density at sea level, solved from {@link FOG_OCCLUSION_AT_VIEW_END}.
 *
 * `FogExp2`'s factor is `1 − exp(−(density · depth)²)`, so a wanted occlusion
 * `f` at depth `d` is `density = √(−ln(1 − f)) / d`.
 */
const SEA_LEVEL_FOG_DENSITY = densityForOcclusion(FOG_OCCLUSION_AT_VIEW_END);

/** The floor {@link MINIMUM_VIEW_END_OCCLUSION} states, as a density. */
const MINIMUM_FOG_DENSITY = densityForOcclusion(MINIMUM_VIEW_END_OCCLUSION);

/**
 * The density that fades something at {@link VIEW_AHEAD_METRES} by `occlusion`.
 *
 * `FogExp2`'s factor is `1 − exp(−(density · depth)²)`, so a wanted occlusion
 * `f` at depth `d` is `density = √(−ln(1 − f)) / d`. Inverting it here rather
 * than writing the two densities down is what makes the fog follow
 * `terrain.ts`'s view distance instead of agreeing with it by hand.
 */
function densityForOcclusion(occlusion: number): number {
  return Math.sqrt(-Math.log(1 - occlusion)) / VIEW_AHEAD_METRES;
}

/**
 * How much of the horizon's colour something at `depthMetres` has taken on.
 *
 * The `FogExp2` curve, written here rather than read off the renderer, so the
 * bound {@link NEAR_FOG_LIMIT} states can be asserted without a GL context.
 */
export function fogFactor(density: number, depthMetres: number): number {
  return 1 - Math.exp(-((density * depthMetres) ** 2));
}

/**
 * The world a route implies.
 *
 * Pure and total: every input a `RouteProfile` can carry produces a style, and
 * the two means are clamped into the range the earth offers before anything
 * physical is computed. A GPX is user-supplied input, and an elevation of
 * 50 000 m in one is a malformed file rather than a place — clamping is what
 * keeps it from reaching the ISO 2533 model, which refuses an altitude above
 * the troposphere and would otherwise throw on the render path.
 *
 * ⚠️ The clamp is silent, and deliberately so. ADR 0004 decision D binds every
 * layer that formats a coordinate into a string, and the safest way to honour
 * it here is to have no message at all: a renderer has nothing useful to say
 * about a bad elevation, and the import path is where a file is judged.
 */
export function worldStyle(profile: RouteProfile): WorldStyle {
  // Already inside [0, 90]: `degreesLatitude` refuses anything else, so the
  // mean of the magnitudes needs no clamp of its own.
  const latitude = meanOverSamples(profile.positions, (position: GeographicPosition) =>
    Math.abs(position.latitude),
  );
  const altitude = clamp(
    meanOverSamples(profile.elevations, (elevation: number) => elevation),
    WORLD_LOWEST_LAND_METRES,
    WORLD_HIGHEST_LAND_METRES,
  );

  // 1 at the equator, 0 at a pole.
  const warmth = 1 - latitude / 90;
  const densityRatio = standardAirDensity(altitude) / SEA_LEVEL_AIR_DENSITY;
  const thinness = clamp01((1 - densityRatio) / THIN_AIR_FULL_SCALE);

  const sky = mix(mix(SKY_POLAR, SKY_TROPICAL, warmth), SKY_THIN_AIR, thinness);
  return {
    skyColour: sky,
    // Haze is what the fog is coloured with, and thin air has less of it, so
    // the horizon of an alpine route is very nearly its sky.
    horizonColour: mix(HORIZON_HAZE, sky, thinness),
    groundColour: groundColour(warmth, altitude, treeLine(latitude)),
    fogDensity: Math.max(MINIMUM_FOG_DENSITY, SEA_LEVEL_FOG_DENSITY * densityRatio),
  };
}

/**
 * The altitude the trees stop at, for a latitude.
 *
 * Straight-line between the two anchors in the provenance table, and never
 * below zero: past {@link TREE_LINE_SEA_LEVEL_LATITUDE_DEGREES} there is no
 * altitude at which trees start, which is what tundra is.
 */
function treeLine(latitudeDegrees: number): number {
  return Math.max(
    0,
    TREE_LINE_AT_EQUATOR_METRES * (1 - latitudeDegrees / TREE_LINE_SEA_LEVEL_LATITUDE_DEGREES),
  );
}

/**
 * Vegetation, then rock, then snow.
 *
 * The two stages are separate rather than one blend because they answer
 * different questions: below the tree line the ground is *what grows there*,
 * which depends on latitude; above it the ground is *what is left*, which does
 * not.
 */
function groundColour(warmth: number, altitudeMetresValue: number, treeLineMetres: number): number {
  if (altitudeMetresValue >= treeLineMetres) {
    return mix(ROCK, SNOW, clamp01((altitudeMetresValue - treeLineMetres) / SNOW_BAND_METRES));
  }
  const vegetation = mix(VEGETATION_POLAR, VEGETATION_TROPICAL, warmth);
  return mix(vegetation, ROCK, clamp01(altitudeMetresValue / treeLineMetres));
}

/**
 * Air density at an altitude, at the standard temperature for that altitude.
 *
 * The temperature on the day is not in a `RouteProfile` and never will be, so
 * the ISA lapse rate supplies it. That keeps the whole function of altitude
 * alone, which is what makes the world deterministic.
 */
function standardAirDensity(altitude: number): number {
  return airDensityKilogramsPerCubicMetre(
    altitudeMetres(altitude),
    degreesCelsius(
      SEA_LEVEL_STANDARD_TEMPERATURE_CELSIUS - TROPOSPHERIC_LAPSE_RATE_KELVIN_PER_METRE * altitude,
    ),
  );
}

/**
 * The mean of a bounded, evenly-strided sample of an array.
 *
 * A `RouteProfile` is never empty — `routeProfile` refuses a route with no
 * points — so there is no empty case to guard, the same invariant
 * `terrain.ts`'s `corridorOrigin` relies on when it reads `positions[0]`.
 */
function meanOverSamples<T>(items: readonly T[], value: (item: T) => number): number {
  const stride = Math.max(1, Math.ceil(items.length / WORLD_SAMPLE_LIMIT));
  let sum = 0;
  let count = 0;
  for (let index = 0; index < items.length; index += stride) {
    sum += value(items[index] as T);
    count += 1;
  }
  return sum / count;
}

/** Per-channel blend of two packed sRGB colours. `t` is clamped to [0, 1]. */
function mix(from: number, to: number, t: number): number {
  const amount = clamp01(t);
  let blended = 0;
  for (let shift = 16; shift >= 0; shift -= 8) {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    blended |= Math.round(a + (b - a) * amount) << shift;
  }
  return blended;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
