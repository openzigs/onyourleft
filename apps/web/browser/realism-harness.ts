// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The realism spike's page — [#457](https://github.com/openzigs/onyourleft/issues/457).
 *
 * ⚠️ **Spike, never merged.** This page decides nothing and ships in nothing:
 * `vite.browser.config.ts` builds it beside the gates, and it is opened on the
 * tablet from a locally-staged debug APK (`tools/realism/stage-into-apk.ts`
 * and the spike write-up say how). It is NOT a gate — no spec asserts on what
 * it measures, because the numbers that matter come from a Mali GPU and a
 * headless SwiftShader number means nothing for a phone.
 *
 * It rides the product's own world — `sceneFrame` over `browser/realism/
 * route.ts` — at 9 m/s with the cranks turning at the pacer's gear
 * (`simulatedCrankAngle`), and draws it with `browser/realism/view.ts`. The URL
 * chooses what is drawn (`browser/realism/config.ts` is the table).
 *
 * ## What it measures, and where the numbers go
 *
 * - **Frame time**: the interval between `requestAnimationFrame` timestamps —
 *   what a rider sees, vsync included, so it cannot go below the display's
 *   period. **GPU time**: `EXT_disjoint_timer_query_webgl2` around the draw,
 *   where the browser offers it (the tablet's WebView does not always; the
 *   write-up says to read `dumpsys gfxinfo` beside it either way).
 * - A run warms up for {@link WARM_UP_SECONDS}, then samples for
 *   `?seconds=` (default 30) and publishes 50th/90th/99th percentiles, draw
 *   calls, triangles, texture count and the texture-memory ESTIMATE.
 * - With `?soak=20` it keeps riding for twenty minutes and records one
 *   minute's percentiles at the end of each minute.
 * - Everything is published on `window.__oylRealism` and logged to the
 *   console as one `OYL-REALISM {json}` line, which `adb logcat` shows under
 *   the `chromium` tag — so the numbers can be read off the device with no
 *   debugger attached.
 */

import { metres, metresPerSecond, seconds } from '@onyourleft/domain';

import { simulatedCrankAngle } from '../src/game/bicycle';
import { sceneFrame } from '../src/game/scene';
import { atStartLine } from '../src/game/simulation';
import { corridorOrigin } from '../src/game/terrain';
import { loadSceneryModels } from '../src/game/three-renderer';
import { installHaze } from './realism/atmosphere';
import {
  configQuery,
  parseConfig,
  percentiles,
  type Percentiles,
  type RealismConfig,
} from './realism/config';
import { describe, guarded, MeasurementClock } from './realism/loop';
import { realismRoute } from './realism/route';
import { RealismView, type AssetManifest, type FrameCounts } from './realism/view';
import { worldStyle } from '../src/game/world';

/** How long the scene runs before anything is sampled: shader compiles, first uploads. */
export const WARM_UP_SECONDS = 3;
/** How fast the rider goes: about 32 km/h. */
const RIDE_METRES_PER_SECOND = 9;
/**
 * Where the ride starts: 300 m short of the stream crossing `waterways.ts`
 * finds at about 2 847 m (`realism/route.ts`), so a 30 s run at 9 m/s rides
 * over the bridge and every measured frame has water in it for most of the run.
 */
const START_METRES = 2_550;
/** Where a long run wraps back to, and how much road it rides before it does. */
const LOOP_FROM_METRES = 300;
const LOOP_METRES = 3_500;

export interface RealismResult {
  readonly query: string;
  readonly userAgent: string;
  readonly drawingBuffer: readonly [number, number];
  readonly devicePixelRatio: number;
  readonly frameMs: Percentiles;
  /** `undefined` when the browser offers no GPU timer. */
  readonly gpuMs: Percentiles | undefined;
  readonly counts: FrameCounts;
  readonly spikeTextureBytesEstimate: number;
  readonly notes: Record<string, unknown>;
  /** Steps longer than `MAXIMUM_FRAME_GAP_MS`, counted and NOT sampled. */
  readonly stalls: number;
}

declare global {
  interface Window {
    __oylRealism?: {
      readonly ready: boolean;
      readonly errors: readonly string[];
      readonly config: RealismConfig | undefined;
      readonly assets: boolean;
      readonly result: RealismResult | undefined;
      readonly soak: readonly (RealismResult & { readonly minute: number })[];
    };
  }
}

interface TimerQueryExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

const errors: string[] = [];
let published: Window['__oylRealism'] = {
  ready: false,
  errors,
  config: undefined,
  assets: false,
  result: undefined,
  soak: [],
};
window.__oylRealism = published;
const publish = (patch: Partial<NonNullable<Window['__oylRealism']>>): void => {
  published = { ...(published as NonNullable<Window['__oylRealism']>), ...patch };
  window.__oylRealism = published;
};

async function manifest(base: string): Promise<AssetManifest | undefined> {
  const response = await fetch(`${base}manifest.json`);
  if (!response.ok) return undefined;
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('json')) return undefined;
  return (await response.json()) as AssetManifest;
}

function panel(config: RealismConfig): HTMLElement {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;top:0;left:0;max-width:100%;background:rgba(0,0,0,.72);color:#fff;font:14px/1.4 system-ui,sans-serif;padding:8px 10px;z-index:1';
  const toggle = (
    label: string,
    key: keyof RealismConfig,
    on: unknown,
    off: unknown,
  ): HTMLElement => {
    const row = document.createElement('label');
    row.style.cssText = 'display:inline-block;margin:0 12px 6px 0;min-height:32px';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = config[key] === on;
    input.style.cssText = 'width:24px;height:24px;vertical-align:middle';
    input.addEventListener('change', () => {
      const next = { ...config, [key]: input.checked ? on : off };
      location.search = configQuery(next);
    });
    row.append(input, ` ${label}`);
    return row;
  };
  const choose = <T extends string | number>(
    label: string,
    key: keyof RealismConfig,
    options: readonly T[],
  ): HTMLElement => {
    const row = document.createElement('label');
    row.style.cssText = 'display:inline-block;margin:0 12px 6px 0';
    const select = document.createElement('select');
    for (const option of options) {
      const element = document.createElement('option');
      element.value = String(option);
      element.textContent = String(option);
      element.selected = config[key] === option;
      select.append(element);
    }
    select.addEventListener('change', () => {
      const picked = options.find((option) => String(option) === select.value);
      location.search = configQuery({ ...config, [key]: picked });
    });
    row.append(`${label} `, select);
    return row;
  };
  const stats = document.createElement('pre');
  stats.id = 'oyl-realism-stats';
  stats.style.cssText = 'margin:4px 0 0;white-space:pre-wrap;font:12px/1.3 ui-monospace,monospace';
  box.append(
    toggle('(1) sky', 'sky', true, false),
    choose('tone', 'tone', ['none', 'aces', 'agx'] as const),
    choose('(2) surfaces', 'surfaces', ['off', '1k', '2k'] as const),
    toggle('(3) trees', 'trees', true, false),
    toggle('(4) rider', 'rider', true, false),
    toggle('(5) haze', 'haze', true, false),
    toggle('(5) bloom', 'bloom', true, false),
    choose('(6) scale', 'scale', [1, 0.75, 0.5] as const),
    stats,
  );
  return box;
}

async function run(): Promise<void> {
  const config = parseConfig(location.search);
  publish({ config });
  const base = `${import.meta.env.BASE_URL}realism-assets/`;
  const assets = await manifest(base);
  publish({ assets: assets !== undefined });
  const profile = realismRoute();
  const origin = corridorOrigin(profile);
  if (config.haze) installHaze(worldStyle(profile).sun);
  await loadSceneryModels();

  document.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100vw;height:100vh';
  document.body.append(canvas);
  const box = config.panel ? panel(config) : undefined;
  if (box !== undefined) document.body.append(box);

  const view = new RealismView(canvas, config);
  await view.load(base, assets);
  const resize = (): void => view.resize(canvas.clientWidth, canvas.clientHeight);
  resize();
  addEventListener('resize', resize);

  const gl = view.renderer.getContext() as WebGL2RenderingContext;
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExtension | null;
  const pending: WebGLQuery[] = [];
  let frameSamples: number[] = [];
  let gpuSamples: number[] = [];
  let counts: FrameCounts = { calls: 0, triangles: 0, textures: 0, programs: 0 };

  const collectGpu = (sampling: boolean): void => {
    if (timer === null) return;
    const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT) as boolean;
    while (pending.length > 0) {
      const query = pending[0] as WebGLQuery;
      if (!(gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) as boolean)) break;
      const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      if (sampling && !disjoint) gpuSamples.push(nanoseconds / 1e6);
      gl.deleteQuery(query);
      pending.shift();
    }
  };

  const summary = (): RealismResult => ({
    query: location.search,
    userAgent: navigator.userAgent,
    drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    devicePixelRatio,
    frameMs: percentiles(frameSamples),
    gpuMs: timer === null ? undefined : percentiles(gpuSamples),
    counts,
    spikeTextureBytesEstimate: Math.round(view.textureBytes),
    notes: view.notes,
    stalls: lastStalls,
  });

  // ONE clock: requestAnimationFrame's own timestamp, whose origin is the
  // first frame drawn after every asset has loaded — `realism/loop.ts` says
  // why a `performance.now()` origin put a negative duration into `seconds()`
  // on the tablet and killed the loop.
  const clock = new MeasurementClock(WARM_UP_SECONDS);
  let minute = 0;
  let soakFrom = 0;
  const soak: (RealismResult & { minute: number })[] = [];
  let measured = false;
  let shownAt = 0;
  let lastStalls = 0;

  const frameAt = (distance: number, elapsed: number) => {
    const state = atStartLine(profile);
    return sceneFrame({
      profile,
      origin,
      state: {
        ...state,
        ride: { speed: metresPerSecond(RIDE_METRES_PER_SECOND), distance: metres(distance) },
        elapsed: seconds(elapsed),
        ridden: seconds(elapsed),
      },
      crankAngle: simulatedCrankAngle(distance),
    });
  };

  const step = (now: number): void => {
    const { elapsedSeconds: elapsed, sampledMs } = clock.frame(now);
    const sampling = sampledMs !== undefined && (!measured || config.soakMinutes > 0);
    collectGpu(sampling);
    const distance =
      config.at ??
      LOOP_FROM_METRES +
        ((START_METRES - LOOP_FROM_METRES + elapsed * RIDE_METRES_PER_SECOND) % LOOP_METRES);
    const frame = frameAt(distance, config.at === undefined ? elapsed : 0);
    let query: WebGLQuery | null = null;
    if (timer !== null && pending.length < 8) {
      query = gl.createQuery();
      if (query !== null) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    }
    counts = view.render(frame);
    if (!published?.ready) publish({ ready: true });
    if (query !== null && timer !== null) {
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      pending.push(query);
    }
    if (!measured && clock.windowFull(config.seconds)) {
      measured = true;
      soakFrom = elapsed;
      const taken = clock.take();
      frameSamples = [...taken.samples];
      lastStalls = taken.stalls;
      const result = summary();
      publish({ result });
      console.log(`OYL-REALISM ${JSON.stringify(result)}`);
      gpuSamples = [];
    } else if (
      config.soakMinutes > 0 &&
      measured &&
      minute < config.soakMinutes &&
      elapsed >= soakFrom + (minute + 1) * 60
    ) {
      minute += 1;
      const taken = clock.take();
      frameSamples = [...taken.samples];
      lastStalls = taken.stalls;
      const sample = { ...summary(), minute };
      soak.push(sample);
      publish({ soak: [...soak] });
      console.log(`OYL-REALISM-SOAK ${JSON.stringify(sample)}`);
      gpuSamples = [];
    } else if (measured && config.soakMinutes === 0) {
      clock.take();
    }
    if (box !== undefined && now - shownAt > 1000) {
      shownAt = now;
      const live = percentiles(clock.samples.slice(-120));
      const stats = document.getElementById('oyl-realism-stats');
      if (stats !== null) {
        stats.textContent =
          `${measured ? 'measured' : elapsed < WARM_UP_SECONDS ? 'warming up' : 'sampling'} · frame p50 ${live.p50.toFixed(1)} ms · ` +
          `calls ${counts.calls} · tris ${counts.triangles} · tex ${counts.textures} · ` +
          `buffer ${gl.drawingBufferWidth}×${gl.drawingBufferHeight}` +
          (assets === undefined ? ' · ASSETS NOT IN THIS BUILD' : '');
      }
    }
  };
  const safeStep = guarded(step, fail);
  const tick = (now: number): void => {
    if (safeStep(now)) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Puts an error where the procedure reads it, and on the screen. Never throws. */
function fail(message: string): void {
  errors.push(message);
  publish({ errors: [...errors] });
  console.log(`OYL-REALISM-ERROR ${message}`);
  const shown = document.createElement('p');
  shown.textContent = errors.join('\n');
  shown.style.cssText =
    'position:fixed;bottom:0;left:0;margin:0;z-index:2;color:#fff;background:#700;padding:12px;font:16px system-ui';
  document.body.append(shown);
}

// Whatever throws outside the guarded frame — a loader callback, a rejected
// promise nothing awaited — lands in `errors` too.
addEventListener('error', (event) => {
  fail(describe(event.error ?? event.message));
});
addEventListener('unhandledrejection', (event) => {
  fail(describe(event.reason));
});

run().catch((error: unknown) => {
  fail(describe(error));
});
