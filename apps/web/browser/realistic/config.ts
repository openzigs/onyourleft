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
 *
 * ⚠️ **Unknown parameters and values are REFUSED**, as #457's page refused
 * them: a typo in a soak URL would otherwise measure the default under another
 * name, and a table of numbers cannot show that it did.
 */

/** One configuration of the page. */
export interface RealisticPageConfig {
  readonly world: 'realistic' | 'stylised';
  readonly rung: 0 | 1;
  readonly ladder: boolean;
  readonly seconds: number;
  readonly soakMinutes: number;
  readonly at: number | undefined;
  readonly panel: boolean;
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
};

const KNOWN = new Set(['world', 'rung', 'ladder', 'seconds', 'soak', 'at', 'panel']);

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
