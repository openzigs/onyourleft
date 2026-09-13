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
 *    the same claim; the harness reads back the drawing buffer and reports what
 *    was written to it.
 * 4. **That the world `world.ts` derived reaches the screen** — #241. A
 *    `WorldStyle` added to `SceneFrame` that `three-renderer.ts` never reads
 *    passes every jsdom test and changes nothing a rider sees, which is #240's
 *    named defect shape for this epic. So the read-back is taken at four points
 *    rather than one: above the horizon, beside the road, on the road, and on
 *    the road again further away.
 * 5. **That the road's markings reach the screen, and cost one draw call** —
 *    #242, and the same defect shape one layer down. A colour attribute
 *    `terrain.ts` fills and `three-renderer.ts` never uploads passes every
 *    jsdom test too. So a fifth read-back finds the centre line against the
 *    carriageway beside it, and the driver's own draw calls are counted.
 *
 * ⚠️ **It publishes measurements and asserts nothing.** Every claim is in
 * `game.browser.spec.ts`, and every claim there is now *relative* — one pixel
 * against another, or a pixel against the `WorldStyle` this page publishes.
 * This harness used to export a `drewPixels` boolean instead, computed as
 * "the centre pixel is not black". It was true of a frame that drew nothing
 * the moment #241 gave the scene a non-black sky, and the road and every
 * marker could be removed from the scene with all 19 browser tests green. A
 * read-back compared against a fixed colour decays the moment somebody changes
 * that colour, and nothing says it has.
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
  metres,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import type { WorldStyle } from '../src/game/world';

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
      readonly quadCount: number;
      readonly vertexCount: number;
      /** How many triangle indices the road's index list holds. */
      readonly indexCount: number;
      /** The highest vertex any of those indices names. */
      readonly highestIndex: number;
      /**
       * How many draw calls one frame of the whole scene issued — #242's
       * fifth criterion, measured rather than reviewed.
       *
       * The road is meant to be **one** of them however many lanes and marks
       * it carries, so the total is the ground, the road, and the two markers
       * this harness puts on the route. A road split into three meshes reads
       * as six here.
       */
      readonly drawCallsPerFrame: number;
      readonly markerKinds: readonly string[];
      /**
       * The world `world.ts` derived for the harness route.
       *
       * Published so the spec can state what it expects on the screen as a
       * claim **relative to the derived numbers** rather than against a
       * hard-coded colour. #241 is itself the change that showed why: the
       * background stopped being black, and every assertion written as
       * "this pixel is not the clear colour" quietly stopped meaning anything.
       */
      readonly world: WorldStyle;
      /** Well above the horizon: the sky, which nothing fogs. */
      readonly skyPixel: Pixel;
      /** Low and far to the side: ground, outside the 7 m road. */
      readonly groundPixel: Pixel;
      /** Dead centre, which the chase camera puts on the road ahead. */
      readonly roadPixel: Pixel;
      /**
       * The same road, further up the frame and so further away.
       *
       * ⚠️ **This is the only thing that can see `WorldStyle.fogDensity` and
       * `WorldStyle.horizonColour`.** Both are read by `#updateWorld` and
       * neither changes any single pixel's *identity* — they change how far a
       * surface has converged toward the horizon by the time you see it. One
       * road pixel tells you nothing; two at different depths tell you the
       * whole of it. Setting `#fog.density = 0` in the renderer left all 19
       * browser tests green before this existed.
       */
      readonly roadFarPixel: Pixel;
      /**
       * GPU buffers and textures three had created after the first frame, and
       * after {@link FRAMES}. Equal means nothing new was allocated per frame.
       */
      readonly resourcesAfterFirstFrame: number;
      readonly resourcesAfterAllFrames: number;
      /**
       * The brightest disagreement between the road's centre column and the
       * carriageway beside it, found in the band the road fills — #242.
       *
       * ⚠️ **A pixel on the centre line and a pixel on the road beside it, which
       * is #242's browser-gate criterion in its own words.** It is *found*
       * rather than assumed, and both halves of that are deliberate: a mark is
       * periodic, so a fixed row lands in a gap as often as on paint; and a
       * 0.15 m line is a couple of pixels wide at this distance, so a fixed
       * column is one camera tweak away from missing it. A road with no centre
       * line makes every row in the band identical across its width, so the
       * best difference is zero and the spec's assertion goes red — which is
       * the only outcome that matters here.
       */
      readonly centreLinePixel: Pixel;
      /** Its pair: the same row, a little way across the carriageway. */
      readonly roadBesidePixel: Pixel;
      /** Where in the frame the pair was found, as a fraction of its height. */
      readonly centreLineRowFraction: number;
      /**
       * {@link roadPixel} again, on a **later frame** where the route descends.
       *
       * ⚠️ **This is the only probe that can see a buffer that was written and
       * never re-uploaded**, which is this program's dominant defect shape —
       * *a write that reports success while the read cannot see it* — arriving
       * in a vertex buffer. three uploads an attribute the first time it binds
       * it and thereafter only when `needsUpdate` says to, so dropping that one
       * line leaves the GPU holding frame one forever. Every other read-back
       * here is taken from a re-render of frame one and would agree with it
       * perfectly.
       *
       * The harness route climbs for its first half and descends for its
       * second, and #242 tints the surface by signed gradient — so a rider
       * moved onto the descent is the same road, the same camera and a
       * different colour.
       */
      readonly roadOnDescentPixel: Pixel;
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

/**
 * Where on {@link harnessRoute} the rider is for the last frame, in metres.
 *
 * The route crests at 500 m, so 800 is squarely on the descent — and far
 * enough past the crest that the profile's 100 m gradient window has settled.
 */
const ON_THE_DESCENT_METRES = 800;

const NOWHERE: Pixel = [0, 0, 0, 0];

/** What the harness reports for the world before a frame has produced one. */
const NO_WORLD: WorldStyle = {
  skyColour: 0,
  groundColour: 0,
  horizonColour: 0,
  fogDensity: 0,
};

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

/**
 * Counts every draw call the driver is asked for, for the whole of `body`.
 *
 * ⚠️ **#242's fifth criterion — "still one draw call for the road" — is a
 * claim about what a driver is asked to do, and this is the only place in the
 * repository that can watch.** A road split into three meshes would pass every
 * jsdom assertion about vertices and colours and quietly triple the cost of
 * the thing #240's NFR-2 says the budget is actually made of.
 *
 * Patched on the prototype for the reason above: three obtains its own context
 * and the harness never sees it. All four entry points are patched, not only
 * the indexed one, so a future mesh drawn some other way still counts.
 */
function countingDrawCalls(body: (calls: () => number) => void): void {
  const gl = WebGL2RenderingContext.prototype;
  const names = [
    'drawElements',
    'drawArrays',
    'drawElementsInstanced',
    'drawArraysInstanced',
  ] as const;
  const originals = new Map<string, (...args: never[]) => unknown>();
  let calls = 0;
  for (const name of names) {
    // Unbound on purpose, and re-bound with `.apply` below: a prototype patch
    // has to hold the original method separately from any instance, exactly as
    // `countingGpuResources` does.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original: (...args: never[]) => unknown = gl[name];
    originals.set(name, original);
    (gl as unknown as Record<string, unknown>)[name] = function patched(
      this: WebGL2RenderingContext,
      ...args: never[]
    ): unknown {
      calls += 1;
      return original.apply(this, args);
    };
  }
  try {
    body(() => calls);
  } finally {
    for (const name of names) {
      (gl as unknown as Record<string, unknown>)[name] = originals.get(name);
    }
  }
}

/** Where the road fills the frame, as fractions of its height. @see findCentreLine */
const ROAD_BAND = { from: 0.45, to: 0.56 } as const;

/**
 * How far across the carriageway the second probe sits, as a fraction of width.
 *
 * One percent of 600 px is six pixels, which at this depth is about half a
 * metre of road: outside a 0.15 m centre line and a long way inside a 7 m
 * road's edge lines.
 */
const BESIDE_FRACTION = 0.01;

/** Perceived brightness of a pixel, for comparing two of them. */
function luminanceOf(pixel: Pixel): number {
  return 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2];
}

/**
 * The row in {@link ROAD_BAND} where the centre column differs most from the
 * carriageway beside it.
 *
 * ⚠️ **Searched rather than assumed, and the search is what makes this a gate
 * rather than a coincidence.** A centre-line mark is periodic in route
 * distance, so which rows of the frame carry paint depends on where the rider
 * is; and the mark is two or three pixels wide at this depth, so a hard-coded
 * row would be one camera adjustment from measuring asphalt and saying so
 * confidently. What the search cannot manufacture is a difference that is not
 * there: with no centre line every row in this band is one flat colour across
 * its whole width.
 */
function findCentreLine(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
  width: number,
  height: number,
): { readonly centre: Pixel; readonly beside: Pixel; readonly row: number } {
  const column = Math.floor(width / 2);
  const beside = column + Math.max(2, Math.round(width * BESIDE_FRACTION));
  let best: { centre: Pixel; beside: Pixel; row: number; apart: number } = {
    centre: NOWHERE,
    beside: NOWHERE,
    row: 0,
    apart: -1,
  };
  for (
    let row = Math.floor(height * ROAD_BAND.from);
    row <= Math.floor(height * ROAD_BAND.to);
    row += 1
  ) {
    const onLine = readPixel(gl, column, row);
    const onRoad = readPixel(gl, beside, row);
    const apart = Math.abs(luminanceOf(onLine) - luminanceOf(onRoad));
    if (apart > best.apart) {
      best = { centre: onLine, beside: onRoad, row, apart };
    }
  }
  return best;
}

function run(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#world');
  const errors: string[] = [];
  if (canvas === null) {
    window.__oylGameHarness = {
      created: false,
      hasContext: false,
      framesDrawn: 0,
      quadCount: 0,
      vertexCount: 0,
      indexCount: 0,
      highestIndex: 0,
      drawCallsPerFrame: 0,
      markerKinds: [],
      world: NO_WORLD,
      skyPixel: NOWHERE,
      groundPixel: NOWHERE,
      roadPixel: NOWHERE,
      roadFarPixel: NOWHERE,
      resourcesAfterFirstFrame: 0,
      resourcesAfterAllFrames: 0,
      centreLinePixel: NOWHERE,
      roadBesidePixel: NOWHERE,
      centreLineRowFraction: 0,
      roadOnDescentPixel: NOWHERE,
      errors: ['no canvas'],
    };
    return;
  }

  let created = false;
  let hasContext = false;
  let framesDrawn = 0;
  let quadCount = 0;
  let vertexCount = 0;
  let indexCount = 0;
  let highestIndex = 0;
  let drawCallsPerFrame = 0;
  let markerKinds: readonly string[] = [];
  let world: WorldStyle = NO_WORLD;
  let skyPixel: Pixel = NOWHERE;
  let groundPixel: Pixel = NOWHERE;
  let roadPixel: Pixel = NOWHERE;
  let roadFarPixel: Pixel = NOWHERE;
  let resourcesAfterFirstFrame = 0;
  let resourcesAfterAllFrames = 0;
  let centreLinePixel: Pixel = NOWHERE;
  let roadBesidePixel: Pixel = NOWHERE;
  let centreLineRowFraction = 0;
  let roadOnDescentPixel: Pixel = NOWHERE;

  try {
    const profile = harnessRoute();
    const origin = corridorOrigin(profile);

    const start = atStartLine(profile);
    const frameAt = (distance: number) =>
      sceneFrame({
        profile,
        origin,
        state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
        botDistance: distance + 120,
      });

    countingGpuResources((resources) => {
      countingDrawCalls((calls) => {
        const view = threeGameRenderer.create(canvas, qualitySettings(0));
        created = true;
        hasContext = view.hasContext;
        view.resize(600, 400);

        const frame = frameAt(0);
        world = frame.world;
        quadCount = frame.corridor.quadCount;
        vertexCount = frame.corridor.vertices.length;
        indexCount = frame.corridor.indices.length;
        for (const index of frame.corridor.indices) {
          highestIndex = Math.max(highestIndex, index);
        }
        markerKinds = frame.markers.map((marker) => marker.kind);

        // A hundred frames rather than one. The first uploads the buffers, and
        // a bug that only appears when a buffer is *reused* would be invisible
        // in a single-frame harness.
        const before = calls();
        view.render(frame);
        framesDrawn += 1;
        drawCallsPerFrame = calls() - before;
        resourcesAfterFirstFrame = resources();

        // ⚠️ **The ninety-eight after it move the rider**, which the harness
        // did not do before #242. A corridor rebuilt at a new distance is a
        // new set of vertices and a new set of centre-line marks, and a road
        // whose buffer grew by one mark as the rider crossed a period would
        // allocate on the GPU forever — #240's NFR-3, and the whole reason
        // `terrain.ts` emits a zero-area quad for a mark outside the corridor
        // rather than leaving it out.
        while (framesDrawn < FRAMES - 2) {
          view.render(frameAt(framesDrawn * 3.7));
          framesDrawn += 1;
        }

        // Read the drawing buffer back. `preserveDrawingBuffer` is off, so this
        // is only valid immediately after a render and before the compositor
        // takes the frame — which is why it happens here rather than in the
        // spec, and why the frame being read is re-rendered first.
        view.render(frame);
        framesDrawn += 1;
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        if (gl !== null) {
          // The chase camera sits 3 m above the road and looks 25 m ahead of
          // it, which puts the horizon a few degrees above the centre of the
          // frame. These fractions come from that geometry rather than from the
          // eye: at 95 % of the height the ray is well above the horizon; at
          // 5 % across and 37.5 % up it meets the ground about 11 m to the side
          // of a road that is 7 m wide; and the centre is the road itself.
          skyPixel = readPixel(gl, canvas.width * 0.5, canvas.height * 0.95);
          groundPixel = readPixel(gl, canvas.width * 0.05, canvas.height * 0.375);
          // ⚠️ **Off the centre column by one percent of the width, since
          // #242.** Dead centre is now where the centre line is painted, and
          // this probe is about the road *surface* — its channel ordering, and
          // how far the fog has taken it. Six pixels across is clear of a mark
          // and nowhere near the edge lines at either probe's depth.
          roadPixel = readPixel(gl, canvas.width * 0.51, canvas.height * 0.5);
          // The fourth probe, and the only one that can see the fog. Straight
          // up the centre column from `roadPixel`, so it is the same surface at
          // a greater depth and the only thing between the two read-backs is
          // how far each has converged toward the horizon colour. 0.58 rather
          // than higher because the bot marker sits at about 0.60.
          roadFarPixel = readPixel(gl, canvas.width * 0.51, canvas.height * 0.58);
          const found = findCentreLine(gl, canvas.width, canvas.height);
          centreLinePixel = found.centre;
          roadBesidePixel = found.beside;
          centreLineRowFraction = found.row / canvas.height;
        }

        // The last frame, and the only one read back from a *different* place
        // on the route. @see roadOnDescentPixel
        view.render(frameAt(ON_THE_DESCENT_METRES));
        framesDrawn += 1;
        if (gl !== null) {
          roadOnDescentPixel = readPixel(gl, canvas.width * 0.51, canvas.height * 0.5);
        }
        resourcesAfterAllFrames = resources();
        view.destroy();
      });
    });
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  window.__oylGameHarness = {
    created,
    hasContext,
    framesDrawn,
    quadCount,
    vertexCount,
    indexCount,
    highestIndex,
    drawCallsPerFrame,
    markerKinds,
    world,
    skyPixel,
    groundPixel,
    roadPixel,
    roadFarPixel,
    resourcesAfterFirstFrame,
    resourcesAfterAllFrames,
    centreLinePixel,
    roadBesidePixel,
    centreLineRowFraction,
    roadOnDescentPixel,
    errors,
  };
}

run();
