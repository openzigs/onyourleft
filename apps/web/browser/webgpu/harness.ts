// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Spike 0024 (#1273). NEVER MERGED. `realistic-harness.ts`'s ride, through the
 * product's own `three-renderer.ts`, with the renderer chosen by the URL:
 *
 *   ?backend=webglrenderer | webgpu | webgl2     which renderer (see three-shim.ts)
 *   ?seconds=60                                  how long is measured, in 30 s windows
 *   ?at=2550                                     hold the camera there, clock stopped (screenshots)
 *   ?traa=1 ?ao=1 ?wind=1                        the optional layers (WebGPURenderer only)
 *
 * Publishes `window.__oylSpike` and one console line per window, `OYL-SPIKE {json}`.
 */

import { INITIAL_QUALITY, worldRung, type WorldQualityState } from '../../src/game/quality';
import { realisticWorldNotice } from '../../src/game/realistic-assets';
import { corridorOrigin } from '../../src/game/terrain';
import {
  drawnWorldOf,
  loadRealisticWorld,
  loadSceneryModels,
  realisticTextureReport,
  threeGameRenderer,
} from '../../src/game/three-renderer';
import { percentiles } from '../realistic/config';
import { rideFrame, RIDE_METRES_PER_SECOND } from '../realistic/frame';
import { describe } from '../realistic/loop';
import { realisticRoute } from '../realistic/route';

import { installLayers, type LayerSwitches } from './layers';
import { ClassicWebGLRenderer, WebGPURenderer, type SpikeGlobals } from './three-shim';

const WARM_UP_SECONDS = 3;
const START_METRES = 2_550;
const LOOP_FROM_METRES = 300;
const LOOP_METRES = 3_500;
const WINDOW_SECONDS = 30;

type Backend = 'webglrenderer' | 'webgpu' | 'webgl2';

interface Published {
  ready: boolean;
  errors: string[];
  query: string;
  config?: unknown;
  drawing?: unknown;
  firstFrameMs?: number;
  windows: unknown[];
  result?: unknown;
}

const published: Published = { ready: false, errors: [], query: location.search, windows: [] };
(window as unknown as { __oylSpike: Published }).__oylSpike = published;

function fail(message: string): void {
  published.errors.push(message);
  console.log(`OYL-SPIKE-ERROR ${message}`);
}
addEventListener('error', (event) => fail(describe(event.error ?? event.message)));
addEventListener('unhandledrejection', (event) => fail(describe(event.reason)));

// three reports an unsupported material through the console, not by throwing.
for (const level of ['warn', 'error'] as const) {
  const original = console[level].bind(console);
  const seen = new Set<string>();
  console[level] = (...args: unknown[]) => {
    const text = args.map((each) => (typeof each === 'string' ? each : describe(each))).join(' ');
    if (!seen.has(text) && seen.size < 60) {
      seen.add(text);
      console.log(`OYL-SPIKE-CONSOLE ${level} ${text.slice(0, 400)}`);
    }
    original(...args);
  };
}

async function run(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const backend = (params.get('backend') ?? 'webgpu') as Backend;
  const seconds = Number(params.get('seconds') ?? '60');
  const at = params.has('at') ? Number(params.get('at')) : undefined;
  const switches: LayerSwitches = {
    traa: params.get('traa') === '1',
    ao: params.get('ao') === '1',
    wind: params.get('wind') === '1',
  };
  published.config = { backend, seconds, at, ...switches };

  document.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100vw;height:100vh';
  document.body.append(canvas);

  // The renderer is made and initialised HERE, because `WebGPURenderer` cannot
  // draw (or build a PMREM) before `init()` resolves and the product's view
  // builds its world in a constructor. @see three-shim.ts `WebGLRenderer`
  let renderer: any;
  if (backend === 'webglrenderer') {
    renderer = new ClassicWebGLRenderer({ canvas, antialias: false, alpha: false });
  } else {
    renderer = new WebGPURenderer({
      canvas,
      antialias: false,
      alpha: false,
      forceWebGL: backend === 'webgl2',
    });
    await renderer.init();
    renderer.capabilities = { getMaxAnisotropy: () => renderer.getMaxAnisotropy() as number };
    renderer.forceContextLoss = () => undefined;
  }
  (globalThis as SpikeGlobals).__oylSpikeRenderer = renderer;
  // The scene and camera the view draws, caught at the one call that names them.
  const drawn: { scene?: unknown; camera?: unknown } = {};
  (globalThis as { __oylSpikeDrawn?: unknown }).__oylSpikeDrawn = drawn;
  const render = renderer.render.bind(renderer);
  renderer.render = (scene: unknown, camera: unknown) => {
    if ((scene as { isScene?: boolean }).isScene === true && (scene as { fog?: unknown }).fog) {
      drawn.scene = scene;
      drawn.camera = camera;
    }
    return render(scene, camera);
  };
  renderer.info.autoReset = false;
  const isWebGPUBackend = renderer.backend?.isWebGPUBackend === true;
  const adapter = isWebGPUBackend ? await navigator.gpu.requestAdapter() : null;
  published.drawing = {
    asked: backend,
    renderer: backend === 'webglrenderer' ? 'WebGLRenderer' : 'WebGPURenderer',
    webgpuBackend: isWebGPUBackend,
    adapter:
      adapter === null
        ? null
        : {
            vendor: adapter.info.vendor,
            architecture: adapter.info.architecture,
            device: adapter.info.device,
            description: adapter.info.description,
            isFallbackAdapter: (adapter as { isFallbackAdapter?: boolean }).isFallbackAdapter,
            features: [...adapter.features].sort(),
          },
    userAgent: navigator.userAgent,
  };

  await loadSceneryModels();
  const outcome = await loadRealisticWorld();
  const notice = realisticWorldNotice(outcome);
  if (notice !== undefined) fail(`the realistic world did not load: ${notice}`);

  const profile = realisticRoute(undefined);
  const origin = corridorOrigin(profile);
  const state: WorldQualityState = {
    realistic: true,
    quality: { ...INITIAL_QUALITY, level: 0 },
  };
  const rung = worldRung(state);
  const view = threeGameRenderer.create(canvas, rung);
  const resize = (): void => view.resize(canvas.clientWidth, canvas.clientHeight);
  resize();
  addEventListener('resize', resize);
  const layers =
    backend === 'webglrenderer' ? undefined : await installLayers(renderer, switches, fail);

  const frames: number[] = [];
  const renderMs: number[] = [];
  let windowFrames: number[] = [];
  let windowRender: number[] = [];
  let windowTriangles = 0;
  let windowCalls = 0;
  let gaps = 0;
  let last: number | undefined;
  let startedAt: number | undefined;
  let windowAt = 0;
  let done = false;

  const tick = (now: number): void => {
    try {
      startedAt ??= now;
      const elapsed = (now - startedAt) / 1000;
      const distance =
        at ??
        LOOP_FROM_METRES +
          ((START_METRES - LOOP_FROM_METRES + elapsed * RIDE_METRES_PER_SECOND) % LOOP_METRES);
      const frame = rideFrame({
        profile,
        origin,
        distance,
        elapsed: at === undefined ? elapsed : 0,
        rung,
      });
      renderer.info.reset();
      layers?.beforeFrame(at === undefined ? elapsed : 0);
      const before = performance.now();
      view.render(frame);
      const spent = performance.now() - before;
      const info = renderer.info.render;
      const measuring = elapsed >= WARM_UP_SECONDS && !done;
      if (!published.ready) {
        published.ready = true;
        published.firstFrameMs = performance.now();
        console.log(`OYL-SPIKE-FIRST-FRAME ${performance.now().toFixed(0)}`);
      }
      if (measuring) {
        if (last !== undefined) {
          const gap = now - last;
          windowFrames.push(gap);
          frames.push(gap);
          if (gap > 100) gaps += 1;
        }
        windowRender.push(spent);
        renderMs.push(spent);
        windowTriangles += info.triangles as number;
        windowCalls += (info.drawCalls ?? info.calls) as number;
        if (elapsed - WARM_UP_SECONDS >= windowAt + WINDOW_SECONDS) {
          windowAt += WINDOW_SECONDS;
          const each = {
            window: windowAt / WINDOW_SECONDS,
            frames: windowFrames.length,
            fps: windowFrames.length / WINDOW_SECONDS,
            frameMs: percentiles(windowFrames),
            renderMs: percentiles(windowRender),
            trianglesPerFrame: Math.round(windowTriangles / windowRender.length),
            drawCallsPerFrame: Math.round(windowCalls / windowRender.length),
          };
          published.windows.push(each);
          console.log(`OYL-SPIKE ${JSON.stringify(each)}`);
          windowFrames = [];
          windowRender = [];
          windowTriangles = 0;
          windowCalls = 0;
          if (windowAt >= seconds) {
            done = true;
            const textures = { bytes: 0, formats: {} as Record<string, number>, sky: '' };
            for (const texture of realisticTextureReport()) {
              if (texture.role === 'sky') textures.sky = texture.format;
              else {
                textures.bytes += texture.bytes;
                textures.formats[texture.format] = (textures.formats[texture.format] ?? 0) + 1;
              }
            }
            const gl = backend === 'webglrenderer' || backend === 'webgl2';
            published.result = {
              ...(published.drawing as object),
              world: drawnWorldOf(view),
              rung: rung.label,
              seconds,
              frames: frames.length,
              fps: frames.length / seconds,
              frameMs: percentiles(frames),
              renderMs: percentiles(renderMs),
              gapsOver100Ms: gaps,
              lastFrame: { ...info },
              memory: { ...renderer.info.memory },
              textures,
              drawingBuffer: [canvas.width, canvas.height],
              devicePixelRatio,
              gl,
              layers: switches,
              firstFrameMs: published.firstFrameMs,
            };
            console.log(`OYL-SPIKE-RESULT ${JSON.stringify(published.result)}`);
          }
        }
      }
      last = now;
      requestAnimationFrame(tick);
    } catch (error) {
      fail(describe(error));
    }
  };
  requestAnimationFrame(tick);
}

run().catch((error: unknown) => {
  fail(describe(error));
});
