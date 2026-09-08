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
 * all. Three things therefore go unchecked without this page:
 *
 * 1. **That the renderer constructs against a real GL context**, rather than
 *    merely satisfying our own types.
 * 2. **That the geometry `terrain.ts` produces is one a real GL implementation
 *    accepts** — a vertex buffer whose length disagrees with its index buffer is
 *    a type-correct object that a driver rejects.
 * 3. **That a frame actually draws.** `render` returning without throwing is not
 *    the same claim; the harness reads back the drawing buffer and reports
 *    whether anything was written to it.
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
      readonly errors: readonly string[];
    };
  }
}

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

  try {
    const profile = harnessRoute();
    const origin = corridorOrigin(profile);
    const view = threeGameRenderer.create(canvas, qualitySettings(0));
    created = true;
    hasContext = view.hasContext;
    view.resize(600, 400);

    // Three frames rather than one: the first uploads the buffers, and a bug
    // that only appears when a buffer is *reused* would be invisible in a
    // single-frame harness. `three-renderer.ts` reuses and only grows.
    const frame = sceneFrame({
      profile,
      origin,
      state: atStartLine(profile),
      botDistance: 120,
    });
    quadCount = frame.corridor.quadCount;
    vertexCount = frame.corridor.vertices.length;
    markerKinds = frame.markers.map((marker) => marker.kind);
    for (let pass = 0; pass < 3; pass += 1) {
      view.render(frame);
      framesDrawn += 1;
    }

    // Read the drawing buffer back. `preserveDrawingBuffer` is off, so this is
    // only valid immediately after a render and before the compositor takes the
    // frame — which is why it happens here rather than in the spec.
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (gl !== null) {
      const pixels = new Uint8Array(4);
      gl.readPixels(
        Math.floor(canvas.width / 2),
        Math.floor(canvas.height / 2),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
      // Anything but a fully transparent black pixel means something was drawn.
      drewPixels = pixels[0] !== 0 || pixels[1] !== 0 || pixels[2] !== 0 || pixels[3] !== 0;
    }
    view.destroy();
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
    errors,
  };
}

run();
