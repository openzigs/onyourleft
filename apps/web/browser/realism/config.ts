// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which realism items the spike page draws, read from its URL — #457.
 *
 * ## ⚠️ Spike code, on a branch that is never merged
 *
 * Nothing here is imported by the product. The page is `browser/realism.html`,
 * built only by `vite.browser.config.ts`, and every item is off unless its
 * query parameter turns it on — so `realism.html` with no query IS the
 * product's own scene, drawn by the product's own belts, and each item's cost
 * is read against it on its own.
 *
 * | parameter | item (#457's numbering) | values |
 * |---|---|---|
 * | `sky` | (1) HDRI background + PMREM environment light | `1` |
 * | `tone` | (1) tone mapping | `none` (default), `aces`, `agx` |
 * | `surfaces` | (2) photographic road and ground | `1k`, `2k` |
 * | `trees` | (3) photoscanned trees + impostor far band | `1` |
 * | `rider` | (4) skinned MakeHuman rider on a modelled road bike | `1` |
 * | `haze` | (5) distance/height haze | `1` |
 * | `bloom` | (5) bloom | `1` |
 * | `scale` | (6) render scale | `1` (default), `0.75`, `0.5` |
 * | `renderer` | (7) the renderer | `webgl` only — see the write-up |
 * | `seconds` | how long a measurement runs | default 30 |
 * | `soak` | minutes of the 20-minute run; one sample a minute | default 0 |
 * | `at` | hold the rider still this far along the route, for a screenshot | metres |
 * | `panel` | the on-screen controls | `1` (default), `0` for a clean screenshot |
 */

/** How the frame is tone mapped. `none` is what the product does today. */
export type ToneMapping = 'none' | 'aces' | 'agx';

/** One configuration of the spike page. */
export interface RealismConfig {
  readonly sky: boolean;
  readonly tone: ToneMapping;
  /** Photographic surfaces, and at which texture resolution. `off` draws the product's. */
  readonly surfaces: 'off' | '1k' | '2k';
  readonly trees: boolean;
  readonly rider: boolean;
  readonly haze: boolean;
  readonly bloom: boolean;
  /** Multiplies the device pixel ratio, as `QualitySettings.renderScale` does. */
  readonly scale: 1 | 0.75 | 0.5;
  /** How long `measure` runs, in seconds. */
  readonly seconds: number;
  /** How many minutes the soak runs, sampling once a minute. 0 is no soak. */
  readonly soakMinutes: number;
  /** Where the rider is held still, or `undefined` to ride. */
  readonly at: number | undefined;
  /** Whether the controls are drawn over the scene. */
  readonly panel: boolean;
}

/** The product's own scene: every item off. */
export const BASELINE: RealismConfig = {
  sky: false,
  tone: 'none',
  surfaces: 'off',
  trees: false,
  rider: false,
  haze: false,
  bloom: false,
  scale: 1,
  seconds: 30,
  soakMinutes: 0,
  at: undefined,
  panel: true,
};

/** Every item on, at full scale. */
export const ALL_ON: RealismConfig = {
  ...BASELINE,
  sky: true,
  tone: 'agx',
  surfaces: '2k',
  trees: true,
  rider: true,
  haze: true,
  bloom: true,
};

const SCALES: readonly RealismConfig['scale'][] = [1, 0.75, 0.5];
const TONES: readonly ToneMapping[] = ['none', 'aces', 'agx'];
const SURFACES: readonly RealismConfig['surfaces'][] = ['off', '1k', '2k'];

/**
 * A configuration from a query string. Anything unrecognised is REFUSED
 * rather than ignored: a typo in a measurement URL would otherwise measure the
 * baseline and label it as the item, which is the one mistake a table of
 * numbers cannot show.
 */
export function parseConfig(search: string): RealismConfig {
  const params = new URLSearchParams(search);
  const known = new Set([
    'sky',
    'tone',
    'surfaces',
    'trees',
    'rider',
    'haze',
    'bloom',
    'scale',
    'renderer',
    'seconds',
    'soak',
    'at',
    'panel',
  ]);
  for (const key of params.keys()) {
    if (!known.has(key)) throw new Error(`realism: unknown parameter "${key}"`);
  }
  const flag = (key: string): boolean => {
    const value = params.get(key);
    if (value === null || value === '0') return false;
    if (value === '1') return true;
    throw new Error(`realism: ${key} is 0 or 1, not "${value}"`);
  };
  const oneOf = <T extends string | number>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = params.get(key);
    if (value === null) return fallback;
    const found = allowed.find((each) => String(each) === value);
    if (found === undefined)
      throw new Error(`realism: ${key} is one of ${allowed.join(', ')}, not "${value}"`);
    return found;
  };
  const positive = (key: string, fallback: number, minimum: number): number => {
    const value = params.get(key);
    if (value === null) return fallback;
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum) {
      throw new Error(`realism: ${key} is a number of at least ${minimum}, not "${value}"`);
    }
    return number;
  };
  oneOf('renderer', ['webgl'], 'webgl');
  return {
    sky: flag('sky'),
    tone: oneOf('tone', TONES, 'none'),
    surfaces: oneOf('surfaces', SURFACES, 'off'),
    trees: flag('trees'),
    rider: flag('rider'),
    haze: flag('haze'),
    bloom: flag('bloom'),
    scale: oneOf('scale', SCALES, 1),
    seconds: positive('seconds', BASELINE.seconds, 1),
    soakMinutes: positive('soak', 0, 0),
    at: params.has('at') ? positive('at', 0, 0) : undefined,
    panel: params.get('panel') !== '0',
  };
}

/** The query string that reproduces a configuration — the inverse of {@link parseConfig}. */
export function configQuery(config: RealismConfig): string {
  const params = new URLSearchParams();
  if (config.sky) params.set('sky', '1');
  if (config.tone !== 'none') params.set('tone', config.tone);
  if (config.surfaces !== 'off') params.set('surfaces', config.surfaces);
  if (config.trees) params.set('trees', '1');
  if (config.rider) params.set('rider', '1');
  if (config.haze) params.set('haze', '1');
  if (config.bloom) params.set('bloom', '1');
  if (config.scale !== 1) params.set('scale', String(config.scale));
  if (config.seconds !== BASELINE.seconds) params.set('seconds', String(config.seconds));
  if (config.soakMinutes !== 0) params.set('soak', String(config.soakMinutes));
  if (config.at !== undefined) params.set('at', String(config.at));
  if (!config.panel) params.set('panel', '0');
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

/** One row of the measurement table: a name and the configuration it measures. */
export interface MeasuredConfiguration {
  readonly name: string;
  readonly config: RealismConfig;
}

/**
 * The configurations #457 asks to be measured, in the order the write-up's
 * table lists them: the baseline; each item alone; all on; all on at 0.75 and
 * 0.5. Tone mapping is measured both ways because #457 asks for both.
 */
export const MEASUREMENT_MATRIX: readonly MeasuredConfiguration[] = [
  { name: 'baseline (the product)', config: BASELINE },
  { name: '(1) sky + environment, ACES', config: { ...BASELINE, sky: true, tone: 'aces' } },
  { name: '(1) sky + environment, AgX', config: { ...BASELINE, sky: true, tone: 'agx' } },
  { name: '(2) surfaces 1K', config: { ...BASELINE, surfaces: '1k' } },
  { name: '(2) surfaces 2K', config: { ...BASELINE, surfaces: '2k' } },
  { name: '(3) trees + impostors', config: { ...BASELINE, trees: true } },
  { name: '(4) rider', config: { ...BASELINE, rider: true } },
  { name: '(5) haze', config: { ...BASELINE, haze: true } },
  { name: '(5) bloom', config: { ...BASELINE, bloom: true } },
  { name: 'all on', config: ALL_ON },
  { name: '(6) all on, scale 0.75', config: { ...ALL_ON, scale: 0.75 } },
  { name: '(6) all on, scale 0.5', config: { ...ALL_ON, scale: 0.5 } },
];

/** The 50th, 90th and 99th percentiles of a sample, nearest-rank. */
export interface Percentiles {
  readonly p50: number;
  readonly p90: number;
  readonly p99: number;
  readonly count: number;
}

/**
 * Nearest-rank percentiles: the smallest sample with at least p% of the
 * samples at or below it. NaN for an empty sample rather than 0 — a frame
 * time of zero reads as "fast", and an empty sample means nothing was timed.
 */
export function percentiles(samples: readonly number[]): Percentiles {
  if (samples.length === 0) return { p50: NaN, p90: NaN, p99: NaN, count: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (p: number): number =>
    sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] as number;
  return { p50: rank(50), p90: rank(90), p99: rank(99), count: sorted.length };
}

/**
 * What a texture costs the GPU: width × height × bytes per texel, and a third
 * again for a full mip chain. An estimate — a driver may pad rows or keep a
 * copy — and labelled as one wherever it is shown.
 */
export function textureBytes(
  width: number,
  height: number,
  bytesPerTexel: number,
  mipmapped: boolean,
): number {
  const base = width * height * bytesPerTexel;
  return Math.round(mipmapped ? (base * 4) / 3 : base);
}
