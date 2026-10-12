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
 * | `levers` | #619's levers switched OFF, for a before/after pair at one rung — since #622 its air and since #1274 its crag, for a by-eye pair, and since #1283 the generated trees, for both | `-foliage-order`, `-texture-bias`, `-air`, `-crag`, `-generated-trees`, comma-separated; default none |
 * | `facing` | which way the route is turned, relative to the sun (#702, `route.ts` §"Which way it faces") | `sun`, `away`; default the route unturned, which looks 110° to 160° away from the sun |
 *
 * ⚠️ **Unknown parameters and values are REFUSED**, as #457's page refused
 * them: a typo in a soak URL would otherwise measure the default under another
 * name, and a table of numbers cannot show that it did.
 */

import type { RealisticTrees } from '../../src/game/realistic-assets';

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
 * - `generated-trees` — #1283: the broadleaf trees generated to their budget
 *   (ADR 0049 D-1). Off loads the photoscans they replaced instead, which is
 *   the world before #1283 — for the owner's BY-EYE comparison, and for the
 *   tablet's cost pair: the two sets are different files, so the frame time,
 *   the draw calls and the triangles of one run against the other are the
 *   trees' own difference. ⚠️ **Read at load**: it chooses which files are
 *   fetched, so it is a different URL and not a switch on a running page.
 */
export const LEVERS = ['air', 'crag', 'foliage-order', 'generated-trees', 'texture-bias'] as const;

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
 * Which broadleaf trees this run loads — #1283: the generated ones, as the
 * product does, or with `generated-trees` off the scans they replaced.
 * `realistic-harness.ts` hands it to `three-renderer.ts` §`setRealisticTrees`
 * before the world is loaded.
 */
export function treesWithLevers(leversOff: readonly Lever[]): RealisticTrees {
  return leversOff.includes('generated-trees') ? 'scanned' : 'generated';
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
  };
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
