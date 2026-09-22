// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The realism spike's view — #457.
 *
 * ⚠️ **Spike code on a never-merged branch.** Nothing in the product imports
 * it. It imports three, which only `src/game/three-renderer.ts` may do in the
 * product; `three-seam.test.ts` carries a narrow exemption for
 * `browser/realism/` on this branch, and says so.
 *
 * ## The baseline is the product's own belts
 *
 * With every item off this draws the product's scene with the product's own
 * pieces — `TerrainBelt`, `HorizonRing`, `SkyDome`, `WaterBelt`,
 * `BridgeBelt`, `ScatterBelt`, `RiderBelt`, `ContactShadowBelt` and
 * `WorldLamps`, all exported by `three-renderer.ts` — at the target rung of
 * `quality.ts`, composed the way `ThreeGameView` composes them. Two
 * differences, both stated so a reader can weigh them: the road is drawn
 * without its surface grain (a private helper there), and the frame is not
 * capped at 30 fps (the product caps it; a cap would hide every cost below it).
 *
 * Each realism item then REPLACES or ADDS one piece and nothing else, so its
 * row in the write-up is its own cost.
 */

import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  Color,
  FogExp2,
  NoToneMapping,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';

import {
  cameraRig,
  verticalFieldOfViewDegrees,
  CAMERA_FIELD_OF_VIEW_DEGREES,
} from '../../src/game/camera';
import type { SceneFrame } from '../../src/game/port';
import { qualitySettings } from '../../src/game/quality';
import {
  BridgeBelt,
  ContactShadowBelt,
  HorizonRing,
  RiderBelt,
  ScatterBelt,
  sceneryFitMetres,
  SkyDome,
  TerrainBelt,
  WaterBelt,
  WorldLamps,
} from '../../src/game/three-renderer';
import { applySky, bloomComposer, bloomThreshold, loadSky, type Sky } from './atmosphere';
import type { RealismConfig } from './config';
import { RealisticRider } from './rider';
import { loadSurfaceMaps, Surfaces } from './surfaces';
import { TreeBelt, type Species, type SpeciesReport } from './trees';

/** What `build/processed/manifest.json` says; the page reads it before anything else. */
export interface AssetManifest {
  readonly files: readonly {
    readonly name: string;
    readonly bytes: number;
    readonly sha256: string;
  }[];
  readonly reports: Readonly<Record<string, unknown>>;
}

/** One frame's counts, read from three after it drew. */
export interface FrameCounts {
  readonly calls: number;
  readonly triangles: number;
  readonly textures: number;
  readonly programs: number;
}

export class RealismView {
  readonly renderer: WebGLRenderer;
  readonly #scene = new Scene();
  readonly #camera = new PerspectiveCamera(CAMERA_FIELD_OF_VIEW_DEGREES, 1, 0.5, 2_000);
  readonly #lookAt = new Vector3();
  readonly #config: RealismConfig;
  readonly #sky = new Color(0);
  readonly #fog = new FogExp2(0, 0);
  readonly #terrain = new TerrainBelt();
  readonly #horizon = new HorizonRing();
  readonly #skyDome = new SkyDome();
  readonly #water = new WaterBelt();
  readonly #bridges = new BridgeBelt();
  readonly #scatter = new ScatterBelt();
  readonly #riders = new RiderBelt();
  readonly #contactShadows = new ContactShadowBelt();
  readonly #lamps = new WorldLamps();
  #surfaces: Surfaces = new Surfaces(undefined);
  #trees: TreeBelt | undefined;
  #rider: RealisticRider | undefined;
  #loadedSky: Sky | undefined;
  #composer: EffectComposer | undefined;
  #width = 1;
  #height = 1;
  /** What the spike's own textures cost the GPU — an estimate, and labelled one. */
  textureBytes = 0;
  /** What this configuration adds, by item, for the write-up's asset table. */
  readonly notes: Record<string, unknown> = {};

  constructor(canvas: HTMLCanvasElement, config: RealismConfig) {
    this.#config = config;
    this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false });
    this.renderer.info.autoReset = false;
    this.renderer.toneMapping =
      config.tone === 'aces'
        ? ACESFilmicToneMapping
        : config.tone === 'agx'
          ? AgXToneMapping
          : NoToneMapping;
    this.#scene.background = this.#sky;
    this.#scene.fog = this.#fog;
    // The HDRI replaces the product's gradient dome; the dome is not added at all.
    if (!config.sky) this.#skyDome.addTo(this.#scene);
    this.#horizon.addTo(this.#scene);
    if (config.surfaces === 'off') this.#terrain.addTo(this.#scene);
    this.#water.addTo(this.#scene);
    this.#bridges.addTo(this.#scene);
    this.#scatter.addTo(this.#scene);
    this.#riders.addTo(this.#scene);
    this.#contactShadows.addTo(this.#scene);
    this.#lamps.addTo(this.#scene);
    const quality = qualitySettings(0);
    this.#scatter.setBudget(quality.scatterItems + quality.structureItems);
    this.#scatter.setVariants(quality.sceneryVariants);
    this.#terrain.setBands(quality.terrainBands);
    this.#terrain.setSurfaceDetail(quality.surfaceDetail);
    this.#water.setDrawn(quality.water);
    for (const belt of [this.#scatter, this.#riders, this.#terrain, this.#bridges])
      belt.setShading(quality.shading);
    this.#contactShadows.setShown(quality.riderShadows === 'contact');
  }

  /** Loads what the configuration asks for. Resolves when the first frame can be drawn. */
  async load(base: string, manifest: AssetManifest | undefined): Promise<void> {
    const needsAssets =
      this.#config.sky ||
      this.#config.surfaces !== 'off' ||
      this.#config.trees ||
      this.#config.rider;
    if (needsAssets && manifest === undefined) {
      throw new Error(
        'realism: the assets are not in this build — run apps/web/tools/realism/fetch-assets.ts and process-assets.ts, then rebuild',
      );
    }
    const anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    const jobs: Promise<void>[] = [];
    if (this.#config.sky) {
      jobs.push(
        loadSky(this.renderer, `${base}farm_field_2k.hdr`).then((sky) => {
          this.#loadedSky = sky;
          this.textureBytes += sky.textureBytes;
          applySky(this.#scene, sky);
        }),
      );
    }
    if (this.#config.surfaces !== 'off') {
      const resolution = this.#config.surfaces;
      jobs.push(
        Promise.all([
          loadSurfaceMaps(base, 'asphalt_02', resolution, anisotropy),
          loadSurfaceMaps(base, 'sparse_grass', resolution, anisotropy),
        ]).then(([asphalt, grass]) => {
          const side = resolution === '2k' ? 2048 : 1024;
          this.textureBytes += 6 * side * side * 4 * (4 / 3);
          this.#surfaces = new Surfaces({ asphalt, grass });
        }),
      );
    }
    if (this.#config.trees && manifest !== undefined) {
      const reports = manifest.reports as Record<Species, SpeciesReport>;
      jobs.push(
        TreeBelt.load(base, reports, sceneryFitMetres).then((trees) => {
          this.#trees = trees;
          this.textureBytes += trees.textureBytes;
          this.notes.treeTriangles = Object.fromEntries(trees.meshTriangles);
        }),
      );
    }
    if (this.#config.rider) {
      jobs.push(
        RealisticRider.load(base).then((rider) => {
          this.#rider = rider;
          this.notes.rider = {
            triangles: rider.triangles,
            bones: rider.boneCount,
            drawCalls: rider.drawCalls,
          };
        }),
      );
    }
    await Promise.all(jobs);
    this.#surfaces.addTo(this.#scene);
    this.#trees?.addTo(this.#scene);
    this.#rider?.addTo(this.#scene);
    if (this.#config.bloom)
      this.#composer = bloomComposer(
        this.renderer,
        this.#scene,
        this.#camera,
        bloomThreshold(this.#config.sky),
      );
  }

  resize(width: number, height: number): void {
    this.#width = Math.max(1, width);
    this.#height = Math.max(1, height);
    const devicePixels = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    this.renderer.setPixelRatio(Math.max(0.1, devicePixels * this.#config.scale));
    this.renderer.setSize(this.#width, this.#height, false);
    this.#composer?.setPixelRatio(Math.max(0.1, devicePixels * this.#config.scale));
    this.#composer?.setSize(this.#width, this.#height);
    const aspect = this.#width / this.#height;
    this.#camera.aspect = aspect;
    this.#camera.fov = verticalFieldOfViewDegrees(aspect);
    this.#camera.updateProjectionMatrix();
  }

  /** Draws one frame and returns what three counted while it did. */
  render(frame: SceneFrame): FrameCounts {
    const { world } = frame;
    if (this.#loadedSky === undefined) this.#sky.setHex(world.skyColour);
    this.#fog.color.setHex(world.horizonColour);
    this.#fog.density = world.fogDensity;
    this.#lamps.apply(world.sun);
    if (this.#loadedSky !== undefined) {
      // The environment is the ambient term now; the sun stays world.ts's.
      this.#lamps.lamps[0].intensity = 0;
    }
    if (this.#config.surfaces === 'off')
      this.#terrain.update(frame.terrain.mesh, world.groundColour);
    this.#surfaces.update(frame);
    this.#horizon.update(frame.terrain.horizon, world, frame.camera);
    this.#water.update(frame.water.surface, world, frame.water.seconds);
    this.#bridges.update(frame.water.bridges);
    const { eye, target } = cameraRig(frame.camera);
    const scatter =
      this.#trees === undefined
        ? frame.scatter
        : frame.scatter.filter(
            (item) => item.kind !== 'tree-broadleaf' && item.kind !== 'tree-conifer',
          );
    this.#scatter.update(scatter, frame.camera);
    if (this.#trees !== undefined) {
      this.notes.treesDrawn = this.#trees.update(frame.scatter, eye);
    }
    const others =
      this.#rider === undefined
        ? frame.markers
        : frame.markers.filter((marker) => marker.kind !== 'rider');
    this.#riders.place(others);
    this.#contactShadows.place(frame.markers, world.sun);
    this.#rider?.place(frame.markers.find((marker) => marker.kind === 'rider'));
    this.#camera.position.set(eye.x, eye.y, eye.z);
    this.#camera.lookAt(this.#lookAt.set(target.x, target.y, target.z));
    if (this.#loadedSky === undefined) this.#skyDome.update(world, eye);
    this.renderer.info.reset();
    if (this.#composer === undefined) this.renderer.render(this.#scene, this.#camera);
    else this.#composer.render();
    const { render, memory, programs } = this.renderer.info;
    return {
      calls: render.calls,
      triangles: render.triangles,
      textures: memory.textures,
      programs: programs?.length ?? 0,
    };
  }
}
