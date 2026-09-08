// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one file in this repository that names `three`.
 *
 * The same rule `map/maplibre.ts` follows for `maplibre-gl`, and for the same
 * reason: a rendering library that leaks past its adapter is a rendering library
 * that cannot be replaced, and ADR 0008's own fallback (D-2) is a stack change
 * that would keep every leaf package and replace exactly this layer.
 *
 * ⚠️ **Nothing here is derived from another product.** #19 and ADR 0009 forbid
 * taking a world asset, course geometry, texture or model from anywhere, and
 * this file loads none: every vertex comes from `terrain.ts`, which computes
 * them from the rider's own imported GPX, and the three markers are primitives
 * three.js generates from numbers. There is no texture, no model file and no
 * asset directory in this epic — which #91 records as the reason it can ship
 * without an art budget rather than as a shortcut.
 *
 * ## Why it is written against a lost context rather than assuming one
 *
 * `canvas.getContext('webgl2')` returns `null` for ordinary reasons — WebGL
 * disabled, GPU memory exhausted, a context lost on a phone that just came back
 * from the background. `three` throws on construction when that happens. So
 * construction is guarded and {@link GameView.hasContext} reports the result:
 * the ride screen keeps its HUD and loses its scenery, rather than losing the
 * ride. A rider mid-effort should not be handed a blank page because the GPU
 * blinked.
 */

import {
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';

import type { QualitySettings } from './quality';
import type { CameraPose, GameRenderer, GameView, RiderMarker, SceneFrame } from './port';

/**
 * How far behind and above the rider the chase camera sits, in metres.
 *
 * ADR 0008 **D-5** fixes the camera, so these are the whole of the camera's
 * configuration — there is no free-look and adding one is a change to that ADR.
 * Eight metres back and three up is roughly a following motorbike: far enough
 * that the road ahead fills the frame on a phone held at arm's length, close
 * enough that the rider's own marker stays large enough to find.
 */
const CAMERA_BEHIND_METRES = 8;
const CAMERA_ABOVE_METRES = 3;

/** How far ahead of the rider the camera looks. */
const CAMERA_TARGET_AHEAD_METRES = 25;

/**
 * Colours, and the shapes that carry the same distinction without them.
 *
 * ⚠️ Each marker differs in **shape as well as colour**, which is #93's third
 * criterion taken seriously rather than satisfied with three hues. A rider
 * glancing at a bar-mounted phone in sunlight, possibly with a colour-vision
 * deficiency, has to tell these apart in about a second — and colour alone is
 * exactly what fails in both of those conditions. `views/AnalysisView.tsx` makes
 * the same argument for the same reason.
 */
const MARKER_STYLE: Record<RiderMarker['kind'], { colour: number; radius: number }> = {
  rider: { colour: 0x2f6fed, radius: 0.9 },
  bot: { colour: 0xc2410c, radius: 0.8 },
  ghost: { colour: 0x64748b, radius: 0.8 },
};

/** The road surface. Flat-shaded on purpose: no lighting means no light budget. */
const ROAD_COLOUR = 0x3f4a5a;

class ThreeGameView implements GameView {
  readonly hasContext: boolean;
  readonly #renderer: WebGLRenderer | undefined;
  readonly #scene = new Scene();
  readonly #camera = new PerspectiveCamera(60, 1, 0.5, 2_000);
  readonly #roadGeometry = new BufferGeometry();
  readonly #road: Mesh;
  readonly #markers = new Map<RiderMarker['kind'], Mesh>();
  #quality: QualitySettings;
  #widthCssPixels = 1;
  #heightCssPixels = 1;
  #vertexCapacity = 0;

  constructor(canvas: HTMLCanvasElement, settings: QualitySettings) {
    this.#quality = settings;
    let renderer: WebGLRenderer | undefined;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false });
    } catch {
      // See the header: a missing context is an ordinary condition, not a bug.
      renderer = undefined;
    }
    this.#renderer = renderer;
    this.hasContext = renderer !== undefined;

    this.#road = new Mesh(
      this.#roadGeometry,
      new MeshBasicMaterial({ color: ROAD_COLOUR, side: DoubleSide }),
    );
    // The corridor is rebuilt in world coordinates every time, so three's own
    // frustum culling has nothing useful to test against and would occasionally
    // cull the road we just built. There is one mesh; culling it saves nothing.
    this.#road.frustumCulled = false;
    this.#scene.add(this.#road);

    for (const kind of ['ghost', 'bot', 'rider'] as const) {
      const marker = new Mesh(
        markerGeometry(kind),
        new MeshBasicMaterial({
          color: MARKER_STYLE[kind].colour,
        }),
      );
      marker.frustumCulled = false;
      marker.visible = false;
      this.#markers.set(kind, marker);
      this.#scene.add(marker);
    }

    if (renderer !== undefined) {
      this.setQuality(settings);
    }
  }

  render(frame: SceneFrame): void {
    if (this.#renderer === undefined) {
      return;
    }
    this.#updateRoad(frame);
    this.#updateMarkers(frame.markers);
    this.#placeCamera(frame.camera);
    this.#renderer.render(this.#scene, this.#camera);
  }

  setQuality(settings: QualitySettings): void {
    this.#quality = settings;
    this.#applySize();
  }

  resize(widthCssPixels: number, heightCssPixels: number): void {
    this.#widthCssPixels = Math.max(1, widthCssPixels);
    this.#heightCssPixels = Math.max(1, heightCssPixels);
    this.#applySize();
  }

  destroy(): void {
    this.#roadGeometry.dispose();
    disposeMaterial(this.#road.material);
    for (const marker of this.#markers.values()) {
      marker.geometry.dispose();
      disposeMaterial(marker.material);
    }
    this.#markers.clear();
    // `forceContextLoss` before `dispose` because a WebGL context is not
    // garbage-collected promptly and a browser allows only a handful at once —
    // a rider starting five rides in a session would otherwise run out.
    this.#renderer?.forceContextLoss();
    this.#renderer?.dispose();
  }

  /**
   * Uploads the corridor.
   *
   * The buffer is **reused and only grown**, never reallocated per frame: the
   * corridor is rebuilt as the rider moves, and allocating a new
   * `Float32Array` plus a new `BufferAttribute` thirty times a second is the
   * allocation pattern that produces a garbage-collection pause — which on this
   * device shows up as the stutter #91's criterion is about.
   */
  #updateRoad(frame: SceneFrame): void {
    const vertices = frame.corridor.vertices;
    if (vertices.length > this.#vertexCapacity) {
      this.#vertexCapacity = vertices.length;
      this.#roadGeometry.setAttribute(
        'position',
        new BufferAttribute(new Float32Array(this.#vertexCapacity), 3),
      );
      this.#roadGeometry.setIndex(stripIndices(frame.corridor.quadCount));
    }
    const attribute = this.#roadGeometry.getAttribute('position') as BufferAttribute;
    (attribute.array as Float32Array).set(vertices);
    attribute.needsUpdate = true;
    // Draw only the quads this frame actually has, so a shorter corridor does
    // not draw stale triangles left in the buffer from a longer one.
    this.#roadGeometry.setDrawRange(0, Math.max(0, frame.corridor.quadCount * 6));
  }

  #updateMarkers(markers: readonly RiderMarker[]): void {
    for (const marker of this.#markers.values()) {
      marker.visible = false;
    }
    for (const wanted of markers) {
      const mesh = this.#markers.get(wanted.kind);
      if (mesh === undefined) {
        continue;
      }
      mesh.visible = true;
      mesh.position.set(wanted.x, wanted.y + MARKER_STYLE[wanted.kind].radius, wanted.z);
    }
  }

  #placeCamera(pose: CameraPose): void {
    this.#camera.position.set(
      pose.x - pose.headingX * CAMERA_BEHIND_METRES,
      pose.y + CAMERA_ABOVE_METRES,
      pose.z - pose.headingZ * CAMERA_BEHIND_METRES,
    );
    this.#camera.lookAt(
      new Vector3(
        pose.x + pose.headingX * CAMERA_TARGET_AHEAD_METRES,
        pose.y,
        pose.z + pose.headingZ * CAMERA_TARGET_AHEAD_METRES,
      ),
    );
  }

  /**
   * Applies the size and the quality level together.
   *
   * ⚠️ The render scale multiplies the **drawing buffer**, not the CSS size, so
   * a reduction makes the world softer without moving anything — the canvas
   * stays where it is and the HUD above it stays crisp, because the HUD is DOM
   * and is not scaled at all. That is the whole reason `quality.ts` reduces
   * resolution before frame rate.
   */
  #applySize(): void {
    if (this.#renderer === undefined) {
      return;
    }
    const devicePixels = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    this.#renderer.setPixelRatio(Math.max(0.1, devicePixels * this.#quality.renderScale));
    this.#renderer.setSize(this.#widthCssPixels, this.#heightCssPixels, false);
    this.#camera.aspect = this.#widthCssPixels / this.#heightCssPixels;
    this.#camera.updateProjectionMatrix();
  }
}

/** Two triangles per quad, over a left/right vertex strip. */
function stripIndices(quadCount: number): BufferAttribute {
  const indices = new Uint32Array(Math.max(0, quadCount) * 6);
  for (let quad = 0; quad < quadCount; quad += 1) {
    const base = quad * 2;
    const at = quad * 6;
    indices[at] = base;
    indices[at + 1] = base + 1;
    indices[at + 2] = base + 2;
    indices[at + 3] = base + 1;
    indices[at + 4] = base + 3;
    indices[at + 5] = base + 2;
  }
  return new BufferAttribute(indices, 1);
}

/** A different solid per kind — see {@link MARKER_STYLE}. */
function markerGeometry(kind: RiderMarker['kind']): BufferGeometry {
  const { radius } = MARKER_STYLE[kind];
  switch (kind) {
    case 'rider':
      return new SphereGeometry(radius, 12, 8);
    case 'bot':
      // A cone, which reads as an arrow at a glance and is not a ball.
      return new ConeGeometry(radius, radius * 2.2, 8);
    case 'ghost':
      // Faceted and angular, so it is not a smooth ball at any distance.
      return new OctahedronGeometry(radius, 0);
  }
}

function disposeMaterial(material: Material | Material[]): void {
  if (Array.isArray(material)) {
    for (const each of material) {
      each.dispose();
    }
    return;
  }
  material.dispose();
}

/** The renderer this app ships. @see GameRenderer */
export const threeGameRenderer: GameRenderer = {
  create(canvas, settings) {
    return new ThreeGameView(canvas, settings);
  },
};
