// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The page the game half of the browser gate drives.
 *
 * It imports the **real** adapter — `game/three-renderer.ts`, the one file that
 * names `three` — and feeds it a corridor built by the **real** `terrain.ts`
 * from a route profile built by the **real** `packages/domain`. Nothing here is
 * a stand-in, for the reason `harness.ts` gives about the map: everything this
 * page exercises is exactly what `game/port.ts` records the jsdom suite cannot
 * reach.
 *
 * jsdom implements no WebGL, so a `WebGLRenderer` cannot be constructed there at
 * all. Four things therefore go unchecked without this page:
 *
 * 1. **That the renderer constructs against a real GL context**, rather than
 *    merely satisfying our own types.
 * 2. **That the geometry `terrain.ts` produces is one a real GL implementation
 *    accepts** — a vertex buffer whose length disagrees with its index buffer is
 *    a type-correct object that a driver rejects.
 * 3. **That a frame actually draws.** `render` returning without throwing is not
 *    the same claim; the harness reads back the drawing buffer and reports
 *    whether anything was written to it.
 * 4. **That the world `world.ts` derived reaches the screen** — #241. A
 *    `WorldStyle` added to `SceneFrame` that `three-renderer.ts` never reads
 *    passes every jsdom test and changes nothing a rider sees, which is #240's
 *    named defect shape for this epic. So the read-back is taken at three
 *    points rather than one: above the horizon, beside the road, and on the
 *    road itself.
 *
 * ⚠️ What it does **not** prove is that the scene *looks right*. There is no
 * reference image, and #19 forbids deriving one from another product. That limit
 * is stated in `game/port.ts` and in the pull request rather than papered over.
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { sceneFrame } from '../src/game/scene';
import { corridorOrigin } from '../src/game/terrain';
import { qualitySettings } from '../src/game/quality';
import { threeGameRenderer } from '../src/game/three-renderer';
import { atStartLine } from '../src/game/simulation';

/** One read-back pixel, as four bytes. */
type Pixel = readonly [number, number, number, number];

declare global {
  interface Window {
    __oylGameHarness?: {
      readonly created: boolean;
      readonly hasContext: boolean;
      readonly framesDrawn: number;
      readonly drewPixels: boolean;
      readonly quadCount: number;
      readonly vertexCount: number;
      readonly markerKinds: readonly string[];
      /** Well above the horizon: the sky, which nothing fogs. */
      readonly skyPixel: Pixel;
      /** Low and far to the side: ground, outside the 7 m road. */
      readonly groundPixel: Pixel;
      /** Dead centre, which the chase camera puts on the road ahead. */
      readonly roadPixel: Pixel;
      /**
       * GPU buffers and textures three had created after the first frame, and
       * after {@link FRAMES}. Equal means nothing new was allocated per frame.
       */
      readonly resourcesAfterFirstFrame: number;
      readonly resourcesAfterAllFrames: number;
      readonly errors: readonly string[];
    };
  }
}

/** How many frames the harness drives. #241's own criterion asks for 100. */
const FRAMES = 100;

/** A kilometre of climbing road, generated — as everything here is — from numbers. */
function harnessRoute(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 100; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index <= 50 ? index * 0.5 : (100 - index) * 0.5),
    });
  }
  return routeProfile(points);
}

const NOWHERE: Pixel = [0, 0, 0, 0];

/** One pixel out of the drawing buffer, in readPixels coordinates (origin bottom left). */
function readPixel(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
  x: number,
  y: number,
): Pixel {
  const pixels = new Uint8Array(4);
  gl.readPixels(Math.floor(x), Math.floor(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return [pixels[0] ?? 0, pixels[1] ?? 0, pixels[2] ?? 0, pixels[3] ?? 0];
}

/**
 * Counts every GPU resource three creates, for the whole of `body`.
 *
 * ⚠️ This is how #241's *"no new mesh is allocated per frame"* is actually
 * checked, and it is a **stronger** claim than comparing object identities: an
 * implementation that rebuilt a mesh but reused the JavaScript wrapper would
 * satisfy an identity check and fail this one. three allocates a buffer or a
 * texture the first time it draws an object and never again while the object
 * lives, so a per-frame allocation shows up here as a count that keeps rising.
 *
 * The two creators are patched on the prototype rather than on one context,
 * because three obtains the context itself and the harness never sees it.
 */
function countingGpuResources(body: (resources: () => number) => void): void {
  const gl = WebGL2RenderingContext.prototype;
  // Unbound on purpose, and re-bound with `.call` below: a prototype patch has
  // to hold the original method separately from any instance, and every WebGL
  // context in the page shares this one.
  /* eslint-disable @typescript-eslint/unbound-method */
  const realCreateBuffer = gl.createBuffer;
  const realCreateTexture = gl.createTexture;
  /* eslint-enable @typescript-eslint/unbound-method */
  let created = 0;
  gl.createBuffer = function patchedCreateBuffer(this: WebGL2RenderingContext) {
    created += 1;
    return realCreateBuffer.call(this);
  };
  gl.createTexture = function patchedCreateTexture(this: WebGL2RenderingContext) {
    created += 1;
    return realCreateTexture.call(this);
  };
  try {
    body(() => created);
  } finally {
    gl.createBuffer = realCreateBuffer;
    gl.createTexture = realCreateTexture;
  }
}

function run(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#world');
  const errors: string[] = [];
  if (canvas === null) {
    window.__oylGameHarness = {
      created: false,
      hasContext: false,
      framesDrawn: 0,
      drewPixels: false,
      quadCount: 0,
      vertexCount: 0,
      markerKinds: [],
      skyPixel: NOWHERE,
      groundPixel: NOWHERE,
      roadPixel: NOWHERE,
      resourcesAfterFirstFrame: 0,
      resourcesAfterAllFrames: 0,
      errors: ['no canvas'],
    };
    return;
  }

  let created = false;
  let hasContext = false;
  let framesDrawn = 0;
  let drewPixels = false;
  let quadCount = 0;
  let vertexCount = 0;
  let markerKinds: readonly string[] = [];
  let skyPixel: Pixel = NOWHERE;
  let groundPixel: Pixel = NOWHERE;
  let roadPixel: Pixel = NOWHERE;
  let resourcesAfterFirstFrame = 0;
  let resourcesAfterAllFrames = 0;

  try {
    const profile = harnessRoute();
    const origin = corridorOrigin(profile);

    countingGpuResources((resources) => {
      const view = threeGameRenderer.create(canvas, qualitySettings(0));
      created = true;
      hasContext = view.hasContext;
      view.resize(600, 400);

      const frame = sceneFrame({
        profile,
        origin,
        state: atStartLine(profile),
        botDistance: 120,
      });
      quadCount = frame.corridor.quadCount;
      vertexCount = frame.corridor.vertices.length;
      markerKinds = frame.markers.map((marker) => marker.kind);

      // A hundred frames rather than one. The first uploads the buffers, and a
      // bug that only appears when a buffer is *reused* would be invisible in a
      // single-frame harness; the ninety-nine after it are what say nothing is
      // allocated per frame.
      view.render(frame);
      framesDrawn += 1;
      resourcesAfterFirstFrame = resources();
      while (framesDrawn < FRAMES) {
        view.render(frame);
        framesDrawn += 1;
      }
      resourcesAfterAllFrames = resources();

      // Read the drawing buffer back. `preserveDrawingBuffer` is off, so this is
      // only valid immediately after a render and before the compositor takes the
      // frame — which is why it happens here rather than in the spec.
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (gl !== null) {
        // The chase camera sits 3 m above the road and looks 25 m ahead of it,
        // which puts the horizon a few degrees above the centre of the frame.
        // These three fractions come from that geometry rather than from the
        // eye: at 95 % of the height the ray is well above the horizon; at 5 %
        // across and 37.5 % up it meets the ground about 11 m to the side of a
        // road that is 7 m wide; and the centre is the road itself.
        skyPixel = readPixel(gl, canvas.width * 0.5, canvas.height * 0.95);
        groundPixel = readPixel(gl, canvas.width * 0.05, canvas.height * 0.375);
        roadPixel = readPixel(gl, canvas.width * 0.5, canvas.height * 0.5);
        // Colour only. The alpha channel reads 255 on every pixel because the
        // renderer is built with `alpha: false`, so including it would make
        // this true of a frame that drew nothing at all.
        drewPixels = roadPixel.slice(0, 3).some((channel) => channel !== 0);
      }
      view.destroy();
    });
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  window.__oylGameHarness = {
    created,
    hasContext,
    framesDrawn,
    drewPixels,
    quadCount,
    vertexCount,
    markerKinds,
    skyPixel,
    groundPixel,
    roadPixel,
    resourcesAfterFirstFrame,
    resourcesAfterAllFrames,
    errors,
  };
}

run();
