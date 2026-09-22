// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Photoscanned trees near, impostors far — #457 (3).
 *
 * ⚠️ **Spike code on a never-merged branch** (see `surfaces.ts`).
 *
 * The trees stand exactly where the product's scatter puts them: this belt is
 * handed the `tree-broadleaf` and `tree-conifer` items of `SceneFrame.scatter`
 * and the product's `ScatterBelt` gets everything else, so what changes is the
 * tree and not the arrangement (`arrangement-unchanged.test.ts`'s promise,
 * kept by construction here).
 *
 * - **Species.** Broadleaf items alternate between two scans by their
 *   `variant`; conifers are the one fir. Each is scaled so its largest extent
 *   is `sceneryFitMetres(kind) × item.scale` — the product's own sizing rule.
 * - **Near band** (< {@link NEAR_METRES} from the camera): the thinned,
 *   AO-baked mesh from `process_tree.py`, one `InstancedMesh` per primitive.
 *   Foliage is alpha-TESTED rather than blended, so it sorts and instances.
 * - **Far band**: one camera-facing quad per tree, drawn from the eight-frame
 *   strip `process_tree.py` rendered, the frame chosen by where the camera is
 *   relative to the tree's own yaw. One draw call per species.
 */

import {
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SRGBColorSpace,
  TextureLoader,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type BufferGeometry,
  type Material,
  type Scene,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { ScatterItem, SceneryKind } from '../../src/game/scatter';

/** Beyond this, a tree is an impostor. */
export const NEAR_METRES = 45;

/** The most trees of one species in a frame; the product's own scatter bound is 240 items in all. */
const CAPACITY = 240;

/** What `process_tree.py` reports, and the runtime needs, about one species. */
export interface SpeciesReport {
  readonly heightMetres: number;
  readonly widthMetres: number;
  readonly impostorOrthoScale: number;
  readonly impostorFrames: number;
  readonly impostorFramePixels: readonly [number, number];
}

export const SPECIES = ['island_tree_02', 'tree_small_02', 'fir_sapling'] as const;
export type Species = (typeof SPECIES)[number];

/** Which species an item is drawn as. */
export function speciesOf(item: ScatterItem): Species | undefined {
  if (item.kind === 'tree-conifer') return 'fir_sapling';
  if (item.kind === 'tree-broadleaf')
    return item.variant % 2 === 0 ? 'island_tree_02' : 'tree_small_02';
  return undefined;
}

interface Part {
  readonly mesh: InstancedMesh;
}

interface Loaded {
  readonly parts: readonly Part[];
  readonly impostor: InstancedMesh;
  readonly report: SpeciesReport;
  readonly nativeExtent: number;
}

export class TreeBelt {
  readonly #species = new Map<Species, Loaded>();
  readonly #fit: (kind: SceneryKind) => number;
  readonly #matrix = new Matrix4();
  readonly #quaternion = new Quaternion();
  readonly #up = new Vector3(0, 1, 0);
  readonly #position = new Vector3();
  readonly #scale = new Vector3();
  /** What the loaded textures cost the GPU, estimated from their sizes. */
  textureBytes = 0;
  /** Triangles in one of each species' near mesh. */
  readonly meshTriangles = new Map<Species, number>();

  private constructor(fit: (kind: SceneryKind) => number) {
    this.#fit = fit;
  }

  static async load(
    base: string,
    reports: Readonly<Record<Species, SpeciesReport>>,
    fit: (kind: SceneryKind) => number,
  ): Promise<TreeBelt> {
    const belt = new TreeBelt(fit);
    const loader = new GLTFLoader();
    const textures = new TextureLoader();
    await Promise.all(
      SPECIES.map(async (species) => {
        const [gltf, strip] = await Promise.all([
          loader.loadAsync(`${base}${species}.glb`),
          textures.loadAsync(`${base}${species}-impostor.png`),
        ]);
        strip.colorSpace = SRGBColorSpace;
        const report = reports[species];
        const parts: Part[] = [];
        let triangles = 0;
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((node) => {
          if (!(node instanceof Mesh)) return;
          const geometry = (node.geometry as BufferGeometry).clone().applyMatrix4(node.matrixWorld);
          const material = node.material as MeshStandardMaterial;
          belt.textureBytes += textureCost(material);
          if (material.transparent || material.alphaHash) {
            material.transparent = false;
            material.alphaHash = false;
            material.alphaTest = 0.5;
            material.side = DoubleSide;
            material.depthWrite = true;
          }
          triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
          const mesh = new InstancedMesh(geometry, material, CAPACITY);
          mesh.instanceMatrix.setUsage(DynamicDrawUsage);
          mesh.count = 0;
          mesh.frustumCulled = false;
          parts.push({ mesh });
        });
        belt.textureBytes +=
          (strip.image as { width: number }).width *
          (strip.image as { height: number }).height *
          4 *
          (4 / 3);
        belt.meshTriangles.set(species, triangles);
        const impostor = new InstancedMesh(
          impostorQuad(),
          impostorMaterial(strip, report),
          CAPACITY,
        );
        impostor.instanceMatrix.setUsage(DynamicDrawUsage);
        impostor.count = 0;
        impostor.frustumCulled = false;
        belt.#species.set(species, {
          parts,
          impostor,
          report,
          nativeExtent: Math.max(report.heightMetres, report.widthMetres),
        });
      }),
    );
    return belt;
  }

  addTo(scene: Scene): void {
    for (const loaded of this.#species.values()) {
      for (const part of loaded.parts) scene.add(part.mesh);
      scene.add(loaded.impostor);
    }
  }

  /** Places this frame's trees. Returns how many were drawn near and far. */
  update(
    items: readonly ScatterItem[],
    eye: { x: number; y: number; z: number },
  ): { near: number; far: number } {
    const near = new Map<Species, number>();
    const far = new Map<Species, number>();
    let nearCount = 0;
    let farCount = 0;
    for (const item of items) {
      const species = speciesOf(item);
      if (species === undefined) continue;
      const loaded = this.#species.get(species);
      if (loaded === undefined) continue;
      const scale = (this.#fit(item.kind) * item.scale) / loaded.nativeExtent;
      this.#position.set(item.x, item.y, item.z);
      this.#quaternion.setFromAxisAngle(this.#up, item.rotation);
      this.#scale.set(scale, scale, scale);
      this.#matrix.compose(this.#position, this.#quaternion, this.#scale);
      const distance = Math.hypot(item.x - eye.x, item.z - eye.z);
      if (distance < NEAR_METRES) {
        const slot = near.get(species) ?? 0;
        if (slot >= CAPACITY) continue;
        for (const part of loaded.parts) part.mesh.setMatrixAt(slot, this.#matrix);
        near.set(species, slot + 1);
        nearCount += 1;
      } else {
        const slot = far.get(species) ?? 0;
        if (slot >= CAPACITY) continue;
        loaded.impostor.setMatrixAt(slot, this.#matrix);
        far.set(species, slot + 1);
        farCount += 1;
      }
    }
    for (const [species, loaded] of this.#species) {
      const n = near.get(species) ?? 0;
      for (const part of loaded.parts) {
        part.mesh.count = n;
        part.mesh.visible = n > 0;
        part.mesh.instanceMatrix.needsUpdate = true;
      }
      const f = far.get(species) ?? 0;
      loaded.impostor.count = f;
      loaded.impostor.visible = f > 0;
      loaded.impostor.instanceMatrix.needsUpdate = true;
    }
    return { near: nearCount, far: farCount };
  }

  /** Every material this belt draws with, so the haze and the environment reach them. */
  materials(): readonly Material[] {
    return [...this.#species.values()].flatMap((loaded) => [
      ...loaded.parts.map((part) => part.mesh.material as Material),
      loaded.impostor.material as Material,
    ]);
  }
}

function textureCost(material: MeshStandardMaterial): number {
  let bytes = 0;
  for (const texture of [
    material.map,
    material.normalMap,
    material.roughnessMap,
    material.metalnessMap,
    material.aoMap,
  ]) {
    const image = texture?.image as { width?: number; height?: number } | undefined;
    if (image?.width !== undefined && image.height !== undefined)
      bytes += image.width * image.height * 4 * (4 / 3);
  }
  return bytes;
}

/** A unit quad standing on its bottom edge, x in [-0.5, 0.5], y in [0, 1]. */
function impostorQuad(): PlaneGeometry {
  const quad = new PlaneGeometry(1, 1);
  quad.translate(0, 0.5, 0);
  return quad;
}

/**
 * The far band's material: a cylindrical billboard sized from the strip's own
 * orthographic frame, the frame picked by azimuth, alpha-tested, fogged and
 * lit by one constant. Texture unlit on purpose: the strip was rendered lit.
 */
function impostorMaterial(strip: Texture, report: SpeciesReport): ShaderMaterial {
  const [frameW, frameH] = report.impostorFramePixels;
  const quadHeight = report.impostorOrthoScale;
  const quadWidth = (quadHeight * frameW) / frameH;
  // The strip's frame is centred on half the tree's height, so its bottom
  // edge sits below the ground by the difference.
  const bottom = report.heightMetres / 2 - quadHeight / 2;
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog, { strip: { value: null } }]),
    fog: true,
    side: DoubleSide,
    defines: {
      FRAMES: report.impostorFrames.toFixed(1),
      QUAD_W: quadWidth.toFixed(4),
      QUAD_H: quadHeight.toFixed(4),
      QUAD_BOTTOM: bottom.toFixed(4),
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vStripUv;
      void main() {
        vec3 centre = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 across = (instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
        vec3 along = (instanceMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz;
        float size = length(across);
        vec3 toCamera = cameraPosition - centre;
        vec2 facing = normalize(vec2(toCamera.x, toCamera.z) + vec2(1e-5));
        // Where the camera is in the tree's own frame, and which frame shows that.
        float localX = dot(vec2(toCamera.x, toCamera.z), across.xz / size);
        float localZ = dot(vec2(toCamera.x, toCamera.z), along.xz / size);
        float azimuth = atan(localX, localZ);
        float frame = mod(floor(azimuth / (2.0 * PI) * FRAMES + 0.5), FRAMES);
        vec3 right = vec3(facing.y, 0.0, -facing.x);
        vec3 world = centre
          + right * position.x * QUAD_W * size
          + vec3(0.0, QUAD_BOTTOM + position.y * QUAD_H, 0.0) * size;
        vStripUv = vec2((frame + uv.x) / FRAMES, uv.y);
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D strip;
      varying vec2 vStripUv;
      void main() {
        vec4 texel = texture2D(strip, vStripUv);
        if (texel.a < 0.5) discard;
        gl_FragColor = vec4(texel.rgb, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  (material.uniforms.strip as { value: Texture | null }).value = strip;
  return material;
}
