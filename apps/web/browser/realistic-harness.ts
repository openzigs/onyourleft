// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's realistic page — [ADR 0026](../../../docs/adr/0026-realistic-game-world.md)
 * D-12: *"the realistic world is reachable only from a harness page under
 * `apps/web/browser/` … and from no control in the shipped app, until layers
 * 1–3 have landed."* This is that page.
 *
 * ## What it is, and what it is not
 *
 * It rides the **product's own renderer** — `three-renderer.ts`, the same
 * `threeGameRenderer` `main.tsx` hands `GameView` — along `realistic/route.ts`
 * at 9 m/s, with the cranks turning at the pacer's gear, and lets the product's
 * own two-ladder policy (`quality.ts` §`nextWorldQuality`) move the rung from
 * the frame times, as `GameView` does with `nextQuality`. So what the owner
 * sees on the tablet is what a rider who chose it in Settings sees (#475): the same
 * code, the same assets, the same step down to the stylised world when the
 * device runs hot — and the same "falls back and says so" when the world
 * cannot load (D-7), shown on the page.
 *
 * It is **not** a gate: nothing asserts on what it measures, because the
 * numbers that matter come from the tablet's GPU. `game.browser.spec.ts`
 * §"the realistic world" is the gate, on its own page. ⚠️ Since #616
 * `realistic.browser.spec.ts` loads THIS page — to hold its instruments to
 * account (the triangle counter against three's own, and the layer switch
 * against a control), never to hold the world to a number. It is **not** the
 * product: the product's build never sees this directory, and the tablet
 * reaches it only through a debug APK staged with
 * `tools/realistic/stage-into-apk.ts` — validation 0002 Part Z has the steps.
 *
 * ## What it publishes
 *
 * `window.__oylRealistic` — the configuration, the load's outcome and the
 * notice, which world is drawn and at which rung, and after `?seconds=` of
 * riding the frame-time percentiles, the draw calls and — since #616 — the
 * triangles submitted per frame; with `?soak=20`, one sample a minute for
 * twenty minutes. Since #616, `?layers=-vegetation` (or any of
 * `realistic/config.ts` §`LAYERS`) turns a layer off without moving the rung,
 * so a layer's share of the tablet's GPU clock is the difference between two
 * runs; `realistic/layers.ts` says what each layer is, in both worlds. Since
 * #619, `?levers=-foliage-order` or `-texture-bias` switches one of that
 * issue's kept levers off, so its saving is a before/after pair at one rung —
 * and since #622 `-air` puts the fog back as it was, for a by-eye pair only;
 * `realistic/config.ts` §`LEVERS` says which rung each one needs.
 * Each is also one console line, `OYL-REALISTIC {json}` and
 * `OYL-REALISTIC-SOAK {json}`, which `adb logcat` shows under the `chromium` tag — so the numbers come off the device with no
 * debugger attached, as #457's did.
 */

import { FramePacer } from '../src/game/frame-pacer';
import {
  DISPLAY_RATE,
  INITIAL_QUALITY,
  nextWorldQuality,
  worldRung,
  type WorldQualityState,
} from '../src/game/quality';
import { realisticWorldNotice, type RealisticWorldOutcome } from '../src/game/realistic-assets';
import { corridorOrigin } from '../src/game/terrain';
import {
  drawnWorldOf,
  atmosphereOf,
  foliageOrderedOf,
  loadRealisticWorld,
  loadSceneryModels,
  realisticTextureReport,
  threeGameRenderer,
} from '../src/game/three-renderer';
import {
  configQuery,
  parseConfig,
  percentiles,
  rungWithLevers,
  type Layer,
  type Lever,
  type Percentiles,
} from './realistic/config';
import { drawCounter } from './realistic/draws';
import { rideFrame, RIDE_METRES_PER_SECOND } from './realistic/frame';
import { installLayerSwitch, type LayerCensus } from './realistic/layers';
import { describe, guarded, MAXIMUM_FRAME_GAP_MS, MeasurementClock } from './realistic/loop';
import { readoutLine, takeOverReporting } from './realistic/reporting';
import { realisticRoute } from './realistic/route';

/** How long the scene runs before anything is sampled: shader compiles, first uploads. */
const WARM_UP_SECONDS = 3;
/** Where a long ride starts, wraps back to, and how much road it rides before it does. */
const START_METRES = 2_550;
const LOOP_FROM_METRES = 300;
const LOOP_METRES = 3_500;

/** One window's numbers. */
export interface RealisticSample {
  readonly world: string;
  readonly rung: string;
  /**
   * The rung's frame cap — #476: `'display'` for the display's own rate, which
   * is both realistic rungs and the stylised top; 30, 24 or 20 below that.
   */
  readonly frameCap: 'display' | number;
  /** The time between DRAWN frames — at a capped rung, at least the cap's interval. */
  readonly frameMs: Percentiles;
  readonly drawCalls: number;
  /**
   * Triangles submitted per drawn frame over the window, counted at the WebGL
   * draw calls — #616. @see realistic/draws.ts
   */
  readonly trianglesPerFrame: number;
  /**
   * The window's LAST frame, counted two ways: at the draw calls, and by
   * three's own `renderer.info.render.triangles` for the same `render` — the
   * browser gate holds them within 1 % of each other (#616). `undefined` for
   * three's when no frame has been drawn through the switch yet.
   */
  readonly lastFrame: {
    readonly triangles: number;
    readonly rendererTriangles: number | undefined;
  };
  /** The layers switched off for this run — #616. Empty for an ordinary ride. */
  readonly layersOff: readonly Layer[];
  /** #619's levers switched off for this run. Empty for an ordinary ride. */
  readonly leversOff: readonly Lever[];
  readonly drawingBuffer: readonly [number, number];
  readonly devicePixelRatio: number;
  readonly stalls: number;
  readonly userAgent: string;
}

/**
 * What `realistic.html`'s first, classic script records before this module
 * runs — #478. @see realistic.html
 */
export interface EarlyRecord {
  /** `typeof window.Capacitor` before any script of ours ran: `'object'` when the shell's bridge was injected. */
  readonly capacitorAtStart: string;
  /** `typeof window.androidBridge`: the interface the bridge talks through, which the WebView provides. */
  readonly androidBridgeAtStart: string;
  /** Whether the page stood in for a missing bridge's `triggerEvent`. */
  readonly standIn: boolean;
  /** Every lifecycle event the shell sent to the stand-in. */
  readonly events: readonly { readonly event: string; readonly target: string }[];
  /** Errors caught before this module took over reporting. */
  readonly errors: string[];
  report: ((message: string) => void) | undefined;
}

/** What Part AH's #618 row records of the textures a load chose. @see realisticTextureReport */
interface TextureSummary {
  /** How many textures a material wears, once per image, by the format each was handed to the GPU as. */
  readonly formats: Readonly<Record<string, number>>;
  /** Their GPU bytes, every mip level. */
  readonly bytes: number;
  /** The sky's format, which #618 leaves at half-float. */
  readonly sky: string;
}

/** The loaded world's textures, summarised for the tablet's row. */
function textureSummary(): TextureSummary {
  const formats: Record<string, number> = {};
  let bytes = 0;
  let sky = '';
  for (const texture of realisticTextureReport()) {
    if (texture.role === 'sky') {
      sky = texture.format;
      continue;
    }
    formats[texture.format] = (formats[texture.format] ?? 0) + 1;
    bytes += texture.bytes;
  }
  return { formats, bytes, sky };
}

declare global {
  interface Window {
    __oylRealisticEarly?: EarlyRecord;
    __oylRealistic?: {
      readonly ready: boolean;
      /**
       * #618: milliseconds from the page opening to its first drawn realistic
       * frame — `performance.now()` then — for validation 0002 Part AH's #618
       * rows, whose ceiling is +500 ms. Absent until that frame.
       */
      readonly firstFrameMs?: number;
      /**
       * #618's review: the formats the load CHOSE, not only the ones the
       * WebView offers — `KTX2Loader`'s own rules can turn an offered format
       * off, as its Linux rule does. Every texture a material wears, by
       * format, and their GPU bytes; the sky is apart. Absent until the first
       * frame. @see realisticTextureReport
       */
      readonly textures?: TextureSummary;
      readonly errors: readonly string[];
      /** What the first script saw of Capacitor's bridge, and what the shell sent it. @see EarlyRecord */
      readonly bridge: Omit<EarlyRecord, 'errors' | 'report'> | undefined;
      readonly query: string;
      readonly outcome: RealisticWorldOutcome | undefined;
      readonly notice: string | undefined;
      readonly result: RealisticSample | undefined;
      readonly soak: readonly (RealisticSample & { readonly minute: number })[];
      /** What the layer switch found in the scene, by layer — #616. @see LayerCensus */
      readonly layers: LayerCensus | undefined;
    };
  }
}

const errors: string[] = [];
const early = window.__oylRealisticEarly;
let published: NonNullable<Window['__oylRealistic']> = {
  ready: false,
  errors,
  bridge:
    early === undefined
      ? undefined
      : {
          capacitorAtStart: early.capacitorAtStart,
          androidBridgeAtStart: early.androidBridgeAtStart,
          standIn: early.standIn,
          // The same array the stand-in appends to, so it is live.
          events: early.events,
        },
  query: location.search,
  outcome: undefined,
  notice: undefined,
  result: undefined,
  soak: [],
  layers: undefined,
};
window.__oylRealistic = published;
const publish = (patch: Partial<NonNullable<Window['__oylRealistic']>>): void => {
  published = { ...published, ...patch };
  window.__oylRealistic = published;
};

/** The controls: which world, which rung, the ladder, and a line of numbers. */
function panel(config: ReturnType<typeof parseConfig>): { box: HTMLElement; line: HTMLElement } {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;top:0;left:0;max-width:100%;background:rgba(0,0,0,.72);color:#fff;font:15px/1.4 system-ui,sans-serif;padding:8px 10px;z-index:1';
  const button = (label: string, next: Partial<ReturnType<typeof parseConfig>>): HTMLElement => {
    const element = document.createElement('button');
    element.textContent = label;
    element.style.cssText = 'min-height:44px;margin:0 8px 6px 0;font:inherit';
    element.addEventListener('click', () => {
      location.search = configQuery({ ...config, ...next });
    });
    return element;
  };
  const line = document.createElement('pre');
  line.style.cssText = 'margin:4px 0 0;white-space:pre-wrap;font:13px/1.3 ui-monospace,monospace';
  box.append(
    button(config.world === 'realistic' ? 'Show the stylised world' : 'Show the realistic world', {
      world: config.world === 'realistic' ? 'stylised' : 'realistic',
      rung: 0,
    }),
    button(config.ladder ? 'Hold this rung' : 'Let the ladder move', { ladder: !config.ladder }),
    button(config.rung === 0 ? 'Start one rung down' : 'Start at the top rung', {
      rung: config.rung === 0 ? 1 : 0,
    }),
    line,
  );
  return { box, line };
}

async function run(): Promise<void> {
  const config = parseConfig(location.search);
  // #478's draw calls and #616's triangles, counted at the WebGL entry points.
  const counter = drawCounter(WebGL2RenderingContext.prototype);
  // #616: installed before the view exists, so it sees every belt join the scene.
  const layerSwitch = installLayerSwitch(config.layersOff);
  await loadSceneryModels();
  let outcome: RealisticWorldOutcome | undefined;
  if (config.world === 'realistic') {
    outcome = await loadRealisticWorld();
  }
  const notice = outcome === undefined ? undefined : realisticWorldNotice(outcome);
  publish({ outcome, notice });

  // #702: turned towards the sun or away from it only when the URL asks.
  const profile = realisticRoute(config.facing);
  const origin = corridorOrigin(profile);
  document.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100vw;height:100vh';
  document.body.append(canvas);
  const controls = config.panel ? panel(config) : undefined;
  if (controls !== undefined) document.body.append(controls.box);

  let state: WorldQualityState = {
    realistic: config.world === 'realistic',
    quality: { ...INITIAL_QUALITY, level: config.rung },
  };
  // #619: the rung the view draws with, a lever that works through the rung
  // taken back out; the label, cap and scenery the page reports are the rung's.
  const drawnRung = (at: WorldQualityState) => rungWithLevers(worldRung(at), config.leversOff);
  const view = threeGameRenderer.create(canvas, drawnRung(state));
  // #619 lever 1's control. The view builds its realistic belts when a rung
  // first asks for them, so it is applied again after every rung change.
  const foliageOrdered = !config.leversOff.includes('foliage-order');
  foliageOrderedOf(view, foliageOrdered);
  // #622's by-eye pair: the air as the product breathes it, or as it was
  // before #622. A setting of the view's, so it survives a rung change.
  const airOn = !config.leversOff.includes('air');
  atmosphereOf(view, { table: airOn ? 'directional' : 'flattened', valley: airOn });
  const resize = (): void => view.resize(canvas.clientWidth, canvas.clientHeight);
  resize();
  addEventListener('resize', resize);
  const gl = canvas.getContext('webgl2');

  const clock = new MeasurementClock(WARM_UP_SECONDS);
  let measured = false;
  let windowFrom = 0;
  let minute = 0;
  let callsInWindow = 0;
  let trianglesInWindow = 0;
  let framesInWindow = 0;
  let lastFrameTriangles = 0;
  let lastFrameRendererTriangles: number | undefined;
  let shownAt = 0;
  const soak: (RealisticSample & { minute: number })[] = [];

  const sample = (frames: readonly number[], stalls: number): RealisticSample => ({
    world: drawnWorldOf(view),
    rung: worldRung(state).label,
    frameCap: worldRung(state).frameCap === DISPLAY_RATE ? 'display' : worldRung(state).frameCap,
    frameMs: percentiles(frames),
    drawCalls: framesInWindow === 0 ? 0 : Math.round(callsInWindow / framesInWindow),
    trianglesPerFrame: framesInWindow === 0 ? 0 : Math.round(trianglesInWindow / framesInWindow),
    lastFrame: { triangles: lastFrameTriangles, rendererTriangles: lastFrameRendererTriangles },
    layersOff: config.layersOff,
    leversOff: config.leversOff,
    drawingBuffer: [gl?.drawingBufferWidth ?? 0, gl?.drawingBufferHeight ?? 0],
    devicePixelRatio,
    stalls,
    userAgent: navigator.userAgent,
  });

  // #476: the rung's frame cap, applied as `GameView` applies it, and the
  // ladder fed what `GameView` feeds it. @see FramePacer
  const pacer = new FramePacer();
  let warmedUp = false;
  const step = (now: number): void => {
    const paced = pacer.frame(now, worldRung(state).frameCap);
    // The product's own two-ladder policy, fed the product's own signal: the
    // gap after a DRAWN frame, never a skipped one's. Not during the warm-up,
    // and not across a stall, as this page always did.
    if (
      config.ladder &&
      warmedUp &&
      paced.frameMs !== undefined &&
      paced.frameMs <= MAXIMUM_FRAME_GAP_MS
    ) {
      const next = nextWorldQuality(state, { frameMs: paced.frameMs });
      if (next.realistic !== state.realistic || next.quality.level !== state.quality.level) {
        view.setQuality(drawnRung(next));
        foliageOrderedOf(view, foliageOrdered);
      }
      state = next;
    }
    if (!paced.draw) return;
    // Only drawn frames reach the clock, so what it publishes is the time
    // between frames a rider SEES — at a capped rung, at least the cap.
    const { elapsedSeconds: elapsed } = clock.frame(now);
    warmedUp = elapsed > WARM_UP_SECONDS;
    const distance =
      config.at ??
      LOOP_FROM_METRES +
        ((START_METRES - LOOP_FROM_METRES + elapsed * RIDE_METRES_PER_SECOND) % LOOP_METRES);
    // The rung the ladder is on decides how much scenery the frame carries, as
    // it does in `GameView` — #478. @see rideFrame
    view.render(
      rideFrame({
        profile,
        origin,
        distance,
        elapsed: config.at === undefined ? elapsed : 0,
        rung: worldRung(state),
      }),
    );
    callsInWindow += counter.takeCalls();
    lastFrameTriangles = counter.takeTriangles();
    trianglesInWindow += lastFrameTriangles;
    // three resets its own count at the start of every `render`, so after the
    // view's one `render` it holds exactly this frame's.
    lastFrameRendererTriangles = layerSwitch.renderer()?.info.render.triangles;
    framesInWindow += 1;
    if (!published.ready) {
      const textures = textureSummary();
      publish({ ready: true, firstFrameMs: performance.now(), textures });
      console.log(`OYL-REALISTIC-FIRST-FRAME ${performance.now().toFixed(0)}`);
      console.log(`OYL-REALISTIC-TEXTURES ${JSON.stringify(textures)}`);
    }
    if (!measured && clock.windowFull(config.seconds)) {
      measured = true;
      windowFrom = elapsed;
      const taken = clock.take();
      const result = sample(taken.samples, taken.stalls);
      callsInWindow = 0;
      trianglesInWindow = 0;
      framesInWindow = 0;
      const layers = layerSwitch.census();
      publish({ result, layers });
      console.log(`OYL-REALISTIC ${JSON.stringify(result)}`);
      // #616: a share read with something the switch could not place still on
      // is a share of an unknown thing, so a run that switched a layer off says so.
      if (config.layersOff.length > 0 && layers.unplaced.length > 0) {
        fail(
          `realistic: the layer switch could not place ${layers.unplaced.join(', ')}; ` +
            'a layer it leaves on is not a layer switched off',
        );
      }
    } else if (
      measured &&
      config.soakMinutes > 0 &&
      minute < config.soakMinutes &&
      elapsed >= windowFrom + (minute + 1) * 60
    ) {
      minute += 1;
      const taken = clock.take();
      const each = { ...sample(taken.samples, taken.stalls), minute };
      callsInWindow = 0;
      trianglesInWindow = 0;
      framesInWindow = 0;
      soak.push(each);
      publish({ soak: [...soak] });
      console.log(`OYL-REALISTIC-SOAK ${JSON.stringify(each)}`);
    } else if (measured && config.soakMinutes === 0) {
      clock.take();
    }
    if (controls !== undefined && now - shownAt > 1_000) {
      shownAt = now;
      // The clock's own rolling window, never the measurement window: that one
      // is emptied every frame once measured, which is the `NaN` the tablet
      // showed. @see readoutLine
      controls.line.textContent = readoutLine({
        world: drawnWorldOf(view),
        rung: worldRung(state).label,
        frameCap:
          worldRung(state).frameCap === DISPLAY_RATE ? 'display' : worldRung(state).frameCap,
        phase: measured ? 'measured' : elapsed < WARM_UP_SECONDS ? 'warming up' : 'sampling',
        clock,
        buffer: [gl?.drawingBufferWidth ?? 0, gl?.drawingBufferHeight ?? 0],
        notice,
      });
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
  console.log(`OYL-REALISTIC-ERROR ${message}`);
  const shown = document.createElement('p');
  shown.textContent = errors.join('\n');
  shown.style.cssText =
    'position:fixed;bottom:0;left:0;margin:0;z-index:2;color:#fff;background:#700;padding:12px;font:16px system-ui';
  document.body.append(shown);
}

// #478. `realistic.html`'s first script has been catching errors since before
// this module existed; from here on it hands them to `fail`, and what it caught
// meanwhile is reported now. Without that script — a page built from an old
// `realistic.html` — this module listens for itself, as it always did.
// @see takeOverReporting
takeOverReporting(early, fail, (type, listener) => addEventListener(type, listener), describe);
// One line for `adb logcat`, whatever else happens: whether the shell's bridge
// reached this page. It does (#480) — the tablet's `triggerEvent` error is the
// app's launch, not this page. @see apps/mobile/src/android/lifecycle-events.test.ts
console.log(
  `OYL-REALISTIC-LOAD ${JSON.stringify({ bridge: published.bridge ?? 'no early script' })}`,
);

run().catch((error: unknown) => {
  fail(describe(error));
});
