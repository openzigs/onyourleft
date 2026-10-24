// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the owner's realistic page draws, read from its URL — ADR 0026 D-12.
 *
 * The page is `browser/realistic.html`, built only by `vite.browser.config.ts`
 * and never by the product's own config, which is what makes it the one place
 * the realistic world can be reached until
 * [#475](https://github.com/openzigs/onyourleft/issues/475) offers it to a
 * rider. It rides the product's own renderer along `route.ts`, with the
 * product's quality ladder deciding the rung from frame times the way
 * `GameView` does.
 *
 * | parameter | what | values |
 * |---|---|---|
 * | `world` | which world the ride starts in | `realistic` (default), `stylised` |
 * | `rung` | which rung of that world's ladder it starts on | `0` (default), `1` |
 * | `ladder` | whether the ladder may move the rung | `1` (default), `0` to hold it |
 * | `seconds` | how long a measurement window is | default 30 |
 * | `soak` | minutes to keep riding, one sample a minute | default 0 |
 * | `at` | hold the rider still this far along the route, for a screenshot | metres |
 * | `panel` | the on-screen controls | `1` (default), `0` for a clean screenshot |
 * | `layers` | layers switched OFF, for their share of the GPU (#616) | `-sky`, `-surfaces`, `-vegetation`, `-impostors`, `-structures`, `-water`, `-riders`, `-grounding`, comma-separated; default none |
 * | `levers` | #619's levers switched OFF, for a before/after pair at one rung — since #622 its air and since #1274 its crag, for a by-eye pair, since #1283 the generated trees and #1294 the generated firs, for both, since #1523 the ground blend and the road wear, for a cost pair, #1523's bounds on both, for a before/after pair, since #1534 the villages' cleared ground, for both, since #1523 the firs' depth pre-pass, for a before/after pair, since #1541 the people, for both, since #1542 the countryside's planting, field boundaries, ground clutter, broken roadside hedge and small stones, for both, and since #1659 the mapped windows' reveals, for both | `-foliage-order`, `-texture-bias`, `-air`, `-crag`, `-generated-trees`, `-generated-conifers`, `-ground-blend`, `-road-wear`, `-surface-bounds`, `-settlement-clearing`, `-fir-prepass`, `-people`, `-land-planting`, `-land-boundaries`, `-ground-clutter`, `-hedge-breaks`, `-small-stones`, `-window-reveals`, comma-separated; default none |
 * | `facing` | which way the route is turned, relative to the sun (#702, `route.ts` §"Which way it faces") | `sun`, `away`; default the route unturned, which looks 110° to 160° away from the sun |
 * | `town` | ride through a mapped town instead of `route.ts`' road (#1581): `footprint-fixtures-testing.ts` §`mixedTownFixture`'s mixed footprints, planned, drawn and lotted as a ride's corridor is, from 900 m to 2 100 m; since #1585 `richmond`, `footprint-fixtures-testing.ts` §`richmondStreetFixture`'s narrow lots drawn as house models beside square ones drawn as extrusions, from 900 m to 1 500 m; since #1542 `countryside`, `footprint-fixtures-testing.ts` §`countrysideFixture`'s fields, woods and a park, from 900 m to 2 100 m, for #1542's levers | `mixed`, `richmond`, `countryside`; default none |
 * | `route` | which of `route.ts`' roads is ridden (#1559): absent, the valley road every Part Z and Part AH row was taken on; `village`, `route.ts` §`villageRoute`, a level road through two villages, for validation 0002 AE2 (`at=820` holds the first one's church and shops in frame). Refused beside `town`, which is a road of its own | `village`; default none |
 *
 * ⚠️ **Unknown parameters and values are REFUSED**, as #457's page refused
 * them: a typo in a soak URL would otherwise measure the default under another
 * name, and a table of numbers cannot show that it did.
 */

import type { CountrysideLever } from '../../src/game/land-class';
import type { RealisticTrees } from '../../src/game/realistic-assets';
import type { DepthPrepassMode, RealisticSurfaces } from '../../src/game/three-renderer';

import type { Facing } from './route';

/**
 * The layers `?layers=` can switch off — #616. What each one holds, in both
 * worlds, is `layers.ts` §`LAYER_OWNERS`; turning one off hides it in whichever
 * world is drawn and replaces it with nothing, and never moves the rung.
 */
export const LAYERS = [
  'sky',
  'surfaces',
  'vegetation',
  'impostors',
  'structures',
  'water',
  'riders',
  // #620: the ground blobs under the scenery — one mesh for trees, shrubs,
  // rocks and structures alike, so a layer of its own rather than a share of
  // two. Off, it is #620's "before": the rock's baked occlusion is in the file
  // and has no switch.
  'grounding',
] as const;

/** One of {@link LAYERS}. */
export type Layer = (typeof LAYERS)[number];

/**
 * #619's levers that `?levers=` can switch off — each a before/after pair the
 * owner runs at one rung (validation 0002 Part AH), the product's setting
 * being the one with every lever on.
 *
 * - `foliage-order` — lever 1: the canopy drawn after the opaque world
 *   (`three-renderer.ts` §`FOLIAGE_RENDER_ORDER`). Off puts every vegetation
 *   mesh back where three draws it unasked. The picture is the same either way.
 * - `texture-bias` — lever 2: the second realistic rung's one-mip-coarser
 *   photographs (`quality.ts` §`QualitySettings.textureLodBias`). Off samples
 *   them at the top rung's detail. It changes nothing on the top rung, which
 *   carries no bias: pair it with `rung=1&ladder=0`.
 * - `air` — #622: the fog leaning towards the sky in the direction looked, and
 *   the valley haze. Off flattens the direction table to its mean and turns the
 *   haze off, which is the picture before #622 — for the owner's BY-EYE
 *   comparison only. ⚠️ **Not a cost pair**: the shader runs either way, so
 *   #622's cost is two builds (validation 0002 Part AH §"The #622 rows").
 * - `crag` — #1274: the rock face a steep bank wears, ambientCG's. Off draws
 *   the bank in the scree's photograph, which is the picture before #1274 —
 *   for the owner's BY-EYE comparison. ⚠️ **Not a cost pair either**: the
 *   ground's shader is the same program with it off, and samples one
 *   photograph on a bank where it sampled the other.
 * - `generated-conifers` — #1294: the firs generated to their budget (ADR
 *   0049 D-1), in Poly Haven's photographed sprigs. Off loads the fir
 *   photoscans they replaced instead and leaves the broadleaves generated,
 *   which is the world #1283 left — the fir's own BY-EYE pair and the tablet's
 *   cost pair for it. Read at load, as `generated-trees` is.
 * - `generated-trees` — #1283: the trees generated to their budget (ADR 0049
 *   D-1). Off loads the photoscans instead — ⚠️ since #1294 EVERY tree's, the
 *   firs' too, with or without `generated-conifers` — which is
 *   the world before #1283 — for the owner's BY-EYE comparison, and for the
 *   tablet's cost pair: the two sets are different files, so the frame time,
 *   the draw calls and the triangles of one run against the other are the
 *   trees' own difference. ⚠️ **Read at load**: it chooses which files are
 *   fetched, so it is a different URL and not a switch on a running page.
 * - `ground-blend` — #1523: the realistic ground as it was before #627's
 *   verge, rock and scree and #1274's crag — #425's near and far photograph
 *   and #460's patchwork, in a program that holds none of the blend's code or
 *   its six maps (`three-renderer.ts` §`realisticSurfacesOf`). The tablet's
 *   COST pair for the blend, which `crag` is not; it changes the picture too.
 * - `road-wear` — #1523: the realistic road without #628's wear and #879's
 *   roughness and relief — no wheel track, no dust, no patch loop in its
 *   program. The tablet's cost pair for the wear, which `game-harness.ts`'s
 *   wear switch is not: that one zeroes uniforms and keeps the loop.
 * - `surface-bounds` — #1523's fix to both: the wear's patch loop only on a
 *   triangle a patch can reach and the paint's noise only on paint, and the
 *   ground blend's derivatives taken once. Off builds both shaders as they
 *   were before it, which draws the same picture (the browser gate holds the
 *   two to one) — the tablet's before/after pair for the fix on one build.
 *
 * None of #1523's changes anything a rider can reach: the product always
 * builds both surfaces, bounded, and only this page's URL turns one off.
 *
 * - `fir-prepass` — #1523's fix to the generated firs (#1294): each fir mesh
 *   drawn after a depth pre-pass that only cuts, so the lit shader runs on
 *   the one fragment a pixel keeps (`three-renderer.ts` §`withDepthPrepass`).
 *   Off draws the firs as they were before it, which is the same picture (the
 *   browser gate holds the two to one) — the tablet's before/after pair for
 *   the fix on one build. The product always draws the pre-pass.
 *
 * - `people` — #1541: the people on the pavements, front paths and footways
 *   (`people.ts`, `three-renderer.ts` §`PeopleBelt`). Off places nobody, so the
 *   frame draws neither their bodies' call nor their impostors' — the tablet's
 *   COST pair for them (validation 0002 Part AJ), and the owner's by-eye pair.
 *   The product draws them on the top realistic rung (`quality.ts`
 *   §`QualitySettings.people`).
 *
 * - `settlement-clearing` — #1534: the trees, shrubs and rocks left standing on
 *   a village's or a farmstead's ground, as every frame was before #1534
 *   (`scene.ts` §`SceneInput.settlementsWooded`). The tablet's cost pair for
 *   the clearing, which can only take instances away, and the owner's BY-EYE
 *   pair for it. Changes nothing a rider can reach.
 *
 * - `land-planting`, `land-boundaries`, `ground-clutter` — #1542's three
 *   changes, each off on its own (`scene.ts` §`SceneInput.countrysideOff`):
 *   the species mix and clustering by land class, field boundaries along
 *   farmland's edges, and stones on pasture and a wood's floor. Off is the
 *   countryside before #1542. They change only covered land, so pair them with
 *   `town=countryside`: on `route.ts`' road, which has no corridor, every one
 *   is the same picture. The owner's BY-EYE pair, and the tablet's cost pair
 *   (validation 0002 Part AH, #1542's rows).
 *
 * - `hedge-breaks`, `small-stones` — the owner's ruling of 2026-10-24 on
 *   #1542, each off on its own: mapped farmland's roadside hedge lowered and
 *   broken by gaps, a gate, fence and open verge (`settlements.ts`
 *   §`roadsidePiece`), and rocks on mapped farmland and a wood smaller and
 *   kept back from the road (`scatter.ts` §`STONE_SCALE`). Off, each is the
 *   countryside as #1542 first drew it. `hedge-breaks` has nothing to change
 *   with `land-boundaries` off; `small-stones` has nothing to change only
 *   with BOTH `land-planting` and `ground-clutter` off — with `ground-clutter`
 *   alone off it still shrinks a wood's rocks and keeps them back from the
 *   road.
 *
 * - `window-reveals` — #1659: every mapped window kind's view-dependent
 *   reveal, its sun's shadows on the glass and its sill's on the wall
 *   (`three-renderer.ts` §`windowRevealsOf`). Off builds the facade program
 *   without the term — its two functions built empty, not a uniform at zero,
 *   as `road-wear` does — so every window is drawn flat, as a decal: the
 *   tablet's COST pair and the owner's BY-EYE pair. Pair it with `town=mixed`
 *   or `town=richmond`: on `route.ts`' road there is no mapped building. The
 *   product always builds the reveals.
 */
export const LEVERS = [
  'air',
  'crag',
  'fir-prepass',
  'foliage-order',
  'generated-conifers',
  'generated-trees',
  'ground-blend',
  'ground-clutter',
  'hedge-breaks',
  'land-boundaries',
  'land-planting',
  'people',
  'road-wear',
  'settlement-clearing',
  'small-stones',
  'surface-bounds',
  'texture-bias',
  'window-reveals',
] as const;

/** One of {@link LEVERS}. */
export type Lever = (typeof LEVERS)[number];

/** One configuration of the page. */
export interface RealisticPageConfig {
  readonly world: 'realistic' | 'stylised';
  readonly rung: 0 | 1;
  readonly ladder: boolean;
  readonly seconds: number;
  readonly soakMinutes: number;
  readonly at: number | undefined;
  readonly panel: boolean;
  /** The layers switched off, in {@link LAYERS}' order, each at most once — #616. */
  readonly layersOff: readonly Layer[];
  /** #619's levers switched off, in {@link LEVERS}' order, each at most once. */
  readonly leversOff: readonly Lever[];
  /**
   * Which way the route is turned — #702. `undefined` is the route unturned,
   * the one every Part Z and Part AH row was taken on.
   */
  readonly facing: Facing | undefined;
  /**
   * A mapped town to ride through — #1581's by-eye pair for the owner, near a
   * town and inside one. `undefined` is `route.ts`' road, with no corridor.
   */
  readonly town: 'mixed' | 'richmond' | 'countryside' | undefined;
  /**
   * #1559: `route.ts` §`villageRoute` instead of its default road, for
   * validation 0002 AE2. `undefined` is the default road, unchanged.
   */
  readonly route: 'village' | undefined;
}

/** The ride the owner is asked to look at: the realistic world, the ladder running. */
export const DEFAULT_CONFIG: RealisticPageConfig = {
  world: 'realistic',
  rung: 0,
  ladder: true,
  seconds: 30,
  soakMinutes: 0,
  at: undefined,
  panel: true,
  layersOff: [],
  leversOff: [],
  facing: undefined,
  town: undefined,
  route: undefined,
};

const KNOWN = new Set([
  'world',
  'rung',
  'ladder',
  'seconds',
  'soak',
  'at',
  'panel',
  'layers',
  'levers',
  'facing',
  'town',
  'route',
]);

/**
 * `?layers=-vegetation,-water` as the layers it switches off — #616.
 *
 * ⚠️ Every entry is a `-` and a name from {@link LAYERS}, and anything else is
 * REFUSED, for the reason every other parameter here is: a typo in a layer's
 * name would otherwise measure every layer on under the name of one that was
 * off, and a row of numbers cannot show that it did. Only `-` exists, because
 * every layer is on unless the URL says otherwise.
 */
function layersFrom(value: string | null): readonly Layer[] {
  return switchedOff('layers', LAYERS, value);
}

/**
 * `?levers=-texture-bias` as the levers it switches off — #619, refused on the
 * same terms as {@link layersFrom} and for the same reason.
 */
function leversFrom(value: string | null): readonly Lever[] {
  return switchedOff('levers', LEVERS, value);
}

/** A `-name,-name` list of `names` switched off, in `names`' order; anything else refused. */
function switchedOff<T extends string>(
  key: string,
  names: readonly T[],
  value: string | null,
): readonly T[] {
  if (value === null) return [];
  const off = new Set<T>();
  for (const entry of value.split(',')) {
    const name = entry.startsWith('-') ? entry.slice(1) : undefined;
    const found = names.find((each) => each === name);
    if (found === undefined) {
      throw new Error(
        `realistic: ${key} is a comma-separated list of -${names.join(', -')}, not "${value}"`,
      );
    }
    off.add(found);
  }
  return names.filter((each) => off.has(each));
}

/** #1542's changes a run switches off, as `scene.ts` §`SceneInput.countrysideOff` takes them. */
export function countrysideWithLevers(leversOff: readonly Lever[]): readonly CountrysideLever[] {
  const off: CountrysideLever[] = [];
  if (leversOff.includes('land-planting')) off.push('planting');
  if (leversOff.includes('land-boundaries')) off.push('boundaries');
  if (leversOff.includes('ground-clutter')) off.push('clutter');
  if (leversOff.includes('hedge-breaks')) off.push('hedge-breaks');
  if (leversOff.includes('small-stones')) off.push('small-stones');
  return off;
}

/**
 * A rung as this run draws it: the product's own, with a lever that works
 * through the rung taken back out — #619. Only `texture-bias` does; the
 * foliage order is the view's, and `realistic-harness.ts` switches it there.
 */
export function rungWithLevers<R extends { readonly textureLodBias: number }>(
  rung: R,
  leversOff: readonly Lever[],
): R {
  return leversOff.includes('texture-bias') ? { ...rung, textureLodBias: 0 } : rung;
}

/**
 * Which trees this run loads — #1283, #1294: the generated ones, as the
 * product does; with `generated-conifers` off the scanned firs beside the
 * generated broadleaves; or with `generated-trees` off every tree's scan.
 * `realistic-harness.ts` hands it to `three-renderer.ts` §`setRealisticTrees`
 * before the world is loaded.
 */
export function treesWithLevers(leversOff: readonly Lever[]): RealisticTrees {
  if (leversOff.includes('generated-trees')) return 'scanned';
  return leversOff.includes('generated-conifers') ? 'scanned-conifers' : 'generated';
}

/**
 * Which of the realistic surfaces' shaders this run builds — #1523: both,
 * bounded, as the product does, unless `ground-blend`, `road-wear` or
 * `surface-bounds` is off.
 * `realistic-harness.ts` hands it to `three-renderer.ts` §`realisticSurfacesOf`.
 */
export function surfacesWithLevers(leversOff: readonly Lever[]): RealisticSurfaces {
  return {
    groundBlend: !leversOff.includes('ground-blend'),
    roadWear: !leversOff.includes('road-wear'),
    bounded: !leversOff.includes('surface-bounds'),
  };
}

/**
 * How this run draws the firs — #1523: after their depth pre-pass, as the
 * product does, unless `fir-prepass` is off. `realistic-harness.ts` hands it
 * to `three-renderer.ts` §`firDepthPrepassOf`.
 */
export function firPrepassWithLevers(leversOff: readonly Lever[]): DepthPrepassMode {
  return leversOff.includes('fir-prepass') ? 'off' : 'drawn';
}

/**
 * Whether this run builds the mapped windows' reveals — #1659: as the product
 * does, unless `window-reveals` is off. `realistic-harness.ts` hands it to
 * `three-renderer.ts` §`windowRevealsOf`.
 */
export function windowRevealsWithLevers(leversOff: readonly Lever[]): boolean {
  return !leversOff.includes('window-reveals');
}

/** A configuration from a query string. @see RealisticPageConfig */
export function parseConfig(search: string): RealisticPageConfig {
  const params = new URLSearchParams(search);
  for (const key of params.keys()) {
    if (!KNOWN.has(key)) throw new Error(`realistic: unknown parameter "${key}"`);
  }
  const oneOf = <T extends string | number>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = params.get(key);
    if (value === null) return fallback;
    const found = allowed.find((each) => String(each) === value);
    if (found === undefined) {
      throw new Error(`realistic: ${key} is one of ${allowed.join(', ')}, not "${value}"`);
    }
    return found;
  };
  const atLeast = (key: string, fallback: number, minimum: number): number => {
    const value = params.get(key);
    if (value === null) return fallback;
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum) {
      throw new Error(
        `realistic: ${key} is a number of at least ${String(minimum)}, not "${value}"`,
      );
    }
    return number;
  };
  return {
    world: oneOf('world', ['realistic', 'stylised'] as const, DEFAULT_CONFIG.world),
    rung: oneOf('rung', [0, 1] as const, DEFAULT_CONFIG.rung),
    ladder: oneOf('ladder', ['1', '0'] as const, '1') === '1',
    seconds: atLeast('seconds', DEFAULT_CONFIG.seconds, 1),
    soakMinutes: atLeast('soak', 0, 0),
    at: params.has('at') ? atLeast('at', 0, 0) : undefined,
    panel: oneOf('panel', ['1', '0'] as const, '1') === '1',
    layersOff: layersFrom(params.get('layers')),
    leversOff: leversFrom(params.get('levers')),
    facing: params.has('facing') ? oneOf('facing', ['sun', 'away'] as const, 'sun') : undefined,
    town: params.has('town')
      ? oneOf('town', ['mixed', 'richmond', 'countryside'] as const, 'mixed')
      : undefined,
    route: params.has('route') ? routeFrom(params) : undefined,
  };
}

/**
 * `?route=village` — #1559. Refused beside `town`, which rides a road of its
 * own: a URL naming both would measure one of them under the other's name.
 */
function routeFrom(params: URLSearchParams): 'village' {
  const value = params.get('route');
  if (value !== 'village')
    throw new Error(`realistic: route is one of village, not "${String(value)}"`);
  if (params.has('town')) {
    throw new Error('realistic: route and town are two roads; name one of them, not both');
  }
  return value;
}

/** The query string that reproduces a configuration — the inverse of {@link parseConfig}. */
export function configQuery(config: RealisticPageConfig): string {
  const params = new URLSearchParams();
  if (config.world !== DEFAULT_CONFIG.world) params.set('world', config.world);
  if (config.rung !== DEFAULT_CONFIG.rung) params.set('rung', String(config.rung));
  if (!config.ladder) params.set('ladder', '0');
  if (config.seconds !== DEFAULT_CONFIG.seconds) params.set('seconds', String(config.seconds));
  if (config.soakMinutes !== 0) params.set('soak', String(config.soakMinutes));
  if (config.at !== undefined) params.set('at', String(config.at));
  if (!config.panel) params.set('panel', '0');
  if (config.layersOff.length > 0) {
    params.set('layers', config.layersOff.map((layer) => `-${layer}`).join(','));
  }
  if (config.leversOff.length > 0) {
    params.set('levers', config.leversOff.map((lever) => `-${lever}`).join(','));
  }
  if (config.facing !== undefined) params.set('facing', config.facing);
  if (config.town !== undefined) params.set('town', config.town);
  if (config.route !== undefined) params.set('route', config.route);
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

/** The 50th, 90th and 99th percentiles of a sample, nearest-rank. */
export interface Percentiles {
  readonly p50: number;
  readonly p90: number;
  readonly p99: number;
  readonly count: number;
}

/**
 * Nearest-rank percentiles: the smallest sample with at least p% of the
 * samples at or below it. NaN for an empty sample rather than 0 — a frame time
 * of zero reads as "fast", and an empty sample means nothing was timed.
 */
export function percentiles(samples: readonly number[]): Percentiles {
  if (samples.length === 0) return { p50: NaN, p90: NaN, p99: NaN, count: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (p: number): number =>
    sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] as number;
  return { p50: rank(50), p90: rank(90), p99: rank(99), count: sorted.length };
}
