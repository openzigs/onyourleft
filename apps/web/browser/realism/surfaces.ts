// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The road and the ground, drawn by the spike rather than by the product's
 * belts — #457 (2).
 *
 * ⚠️ **Spike code on a never-merged branch.** It imports three, which only
 * `src/game/three-renderer.ts` may do in the product; `three-seam.test.ts`
 * carries a narrow exemption for `browser/realism/` on this branch only.
 *
 * Both surfaces are the product's OWN geometry — `SceneFrame.corridor` and
 * `SceneFrame.terrain.mesh`, built by `terrain.ts` and `landform.ts` — so the
 * photographic version and the baseline differ in material and nothing else:
 *
 * - **baseline**: the road only, unlit (`MeshBasicMaterial` with the
 *   corridor's vertex colours, as `three-renderer.ts` draws it, minus its
 *   surface grain, which is a private helper there). The ground is the
 *   product's own `TerrainBelt`, drawn by `view.ts`.
 * - **photographic**: `MeshStandardMaterial` with a Poly Haven colour, normal
 *   and roughness map, mipmapped JPEG at 1K or 2K, anisotropy 4. The texture
 *   coordinates are WORLD-planar (x and z over a tile size), computed here each
 *   frame, because neither mesh carries any and a world mapping cannot seam
 *   between two frames' corridors. The ground samples its map at two scales
 *   and blends them by distance — the cheapest cure for visible tiling.
 *
 * The road markings stay the product's: a vertex the corridor coloured as a
 * marking is painted over the asphalt in the shader, so the lines are where
 * `terrain.ts` puts them.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  type Scene,
  type Texture,
} from 'three';

import type { SceneFrame } from '../../src/game/port';

/** How many metres one repeat of the asphalt covers. */
export const ASPHALT_TILE_METRES = 3;
/** How many metres one repeat of the grass covers, near. The far sample is 9× that. */
export const GRASS_TILE_METRES = 4;

/** A loaded set of maps, and what they cost the GPU (an estimate). */
export interface SurfaceMaps {
  readonly colour: Texture;
  readonly normal: Texture;
  readonly roughness: Texture;
  /** The colour map's mean, linear — what the ground is normalised by. @see groundMaterial */
  readonly mean: readonly [number, number, number];
}

/** The mean of an image, in linear light, from a 16 × 16 reduction of it. */
function meanColour(image: CanvasImageSource): [number, number, number] {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext('2d');
  if (context === null) return [0.2, 0.2, 0.2];
  context.drawImage(image, 0, 0, 16, 16);
  const pixels = context.getImageData(0, 0, 16, 16).data;
  const linear = (byte: number): number => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const sum: [number, number, number] = [0, 0, 0];
  for (let at = 0; at < pixels.length; at += 4) {
    sum[0] += linear(pixels[at] ?? 0);
    sum[1] += linear(pixels[at + 1] ?? 0);
    sum[2] += linear(pixels[at + 2] ?? 0);
  }
  const count = pixels.length / 4;
  return [sum[0] / count, sum[1] / count, sum[2] / count];
}

/** Loads one Poly Haven material's three maps. */
export async function loadSurfaceMaps(
  base: string,
  id: string,
  resolution: '1k' | '2k',
  anisotropy: number,
): Promise<SurfaceMaps> {
  const loader = new TextureLoader();
  const load = async (map: string, colour: boolean): Promise<Texture> => {
    const texture = await loader.loadAsync(`${base}${id}_${map}_${resolution}.jpg`);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.anisotropy = anisotropy;
    if (colour) texture.colorSpace = SRGBColorSpace;
    return texture;
  };
  const [colour, normal, roughness] = await Promise.all([
    load('diff', true),
    load('nor_gl', false),
    load('rough', false),
  ]);
  return { colour, normal, roughness, mean: meanColour(colour.image as CanvasImageSource) };
}

/** Which vertices of the corridor are markings: the corridor colours them near-white. */
function markingShare(colours: Float32Array, out: Float32Array): void {
  for (let vertex = 0; vertex < out.length; vertex += 1) {
    const r = colours[vertex * 3] ?? 0;
    const g = colours[vertex * 3 + 1] ?? 0;
    const b = colours[vertex * 3 + 2] ?? 0;
    out[vertex] = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? 1 : 0;
  }
}

function planarUvs(vertices: Float32Array, tile: number, out: Float32Array): void {
  const count = vertices.length / 3;
  for (let vertex = 0; vertex < count; vertex += 1) {
    out[vertex * 2] = (vertices[vertex * 3] ?? 0) / tile;
    out[vertex * 2 + 1] = (vertices[vertex * 3 + 2] ?? 0) / tile;
  }
}

/** A growable geometry: attributes are reallocated only when a frame outgrows them. */
class Growable {
  readonly geometry = new BufferGeometry();
  #indices = 0;

  set(name: string, values: Float32Array, size: number): void {
    const current = this.geometry.getAttribute(name) as BufferAttribute | undefined;
    if (current === undefined || current.array.length < values.length) {
      this.geometry.setAttribute(name, new BufferAttribute(new Float32Array(values.length), size));
    }
    const attribute = this.geometry.getAttribute(name) as BufferAttribute;
    (attribute.array as Float32Array).set(values);
    attribute.needsUpdate = true;
  }

  index(values: Uint32Array): void {
    const current = this.geometry.getIndex();
    if (current === null || current.array.length < values.length) {
      this.geometry.setIndex(new BufferAttribute(new Uint32Array(values.length), 1));
    }
    const index = this.geometry.getIndex() as BufferAttribute;
    (index.array as Uint32Array).set(values);
    index.needsUpdate = true;
    this.#indices = values.length;
    this.geometry.setDrawRange(0, this.#indices);
  }
}

/** The road and the ground, in either look. */
export class Surfaces {
  readonly #road = new Growable();
  readonly #ground = new Growable();
  readonly #roadMesh: Mesh;
  readonly #groundMesh: Mesh;
  #scratchUv = new Float32Array(0);
  #scratchMark = new Float32Array(0);
  readonly #photographic: boolean;
  #groundTint: { value: Color } | undefined;

  constructor(
    photographic: { readonly asphalt: SurfaceMaps; readonly grass: SurfaceMaps } | undefined,
  ) {
    this.#photographic = photographic !== undefined;
    if (photographic === undefined) {
      this.#roadMesh = new Mesh(
        this.#road.geometry,
        new MeshBasicMaterial({ side: DoubleSide, vertexColors: true }),
      );
      this.#groundMesh = new Mesh(this.#ground.geometry, new MeshBasicMaterial());
    } else {
      this.#roadMesh = new Mesh(this.#road.geometry, roadMaterial(photographic.asphalt));
      this.#groundTint = { value: new Color(1, 1, 1) };
      this.#groundMesh = new Mesh(
        this.#ground.geometry,
        groundMaterial(photographic.grass, this.#groundTint),
      );
    }
    this.#roadMesh.frustumCulled = false;
    this.#groundMesh.frustumCulled = false;
  }

  addTo(scene: Scene): void {
    if (this.#photographic) scene.add(this.#groundMesh);
    scene.add(this.#roadMesh);
  }

  update(frame: SceneFrame): void {
    const { corridor } = frame;
    const ground = frame.terrain.mesh;
    this.#road.set('position', corridor.vertices, 3);
    this.#road.set('color', corridor.colours, 3);
    this.#road.index(corridor.indices);
    if (!this.#photographic) return;
    // The corridor carries no normals — the product's road is unlit — and a lit
    // material with none has a zero normal, which an environment map lights
    // not at all: the road drew black under the HDRI until this line.
    this.#road.geometry.computeVertexNormals();
    this.#ground.set('position', ground.vertices, 3);
    this.#ground.set('normal', ground.normals, 3);
    this.#ground.set('color', ground.colours, 3);
    this.#ground.index(ground.indices);
    this.#groundTint?.value.setHex(frame.world.groundColour);
    const roadVertices = corridor.vertices.length / 3;
    const groundVertices = ground.vertices.length / 3;
    const most = Math.max(roadVertices, groundVertices);
    if (this.#scratchUv.length < most * 2) this.#scratchUv = new Float32Array(most * 2);
    if (this.#scratchMark.length < roadVertices) this.#scratchMark = new Float32Array(roadVertices);
    planarUvs(corridor.vertices, ASPHALT_TILE_METRES, this.#scratchUv);
    this.#road.set('uv', this.#scratchUv.subarray(0, roadVertices * 2), 2);
    markingShare(corridor.colours, this.#scratchMark);
    this.#road.set('marking', this.#scratchMark.subarray(0, roadVertices), 1);
    planarUvs(ground.vertices, GRASS_TILE_METRES, this.#scratchUv);
    this.#ground.set('uv', this.#scratchUv.subarray(0, groundVertices * 2), 2);
  }

  dispose(): void {
    this.#road.geometry.dispose();
    this.#ground.geometry.dispose();
    (this.#roadMesh.material as MeshBasicMaterial).dispose();
    (this.#groundMesh.material as MeshBasicMaterial).dispose();
  }
}

function roadMaterial(maps: SurfaceMaps): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    map: maps.colour,
    normalMap: maps.normal,
    roughnessMap: maps.roughness,
    normalScale: new Vector2(0.8, 0.8),
    side: DoubleSide,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float marking;\nvarying float vMarking;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMarking = marking;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vMarking;')
      // Paint over the asphalt where the product put a line: a worn white.
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.77, 0.72), vMarking * 0.92);',
      );
  };
  return material;
}

/**
 * The ground: the photograph's DETAIL over the product's own ground colour.
 *
 * A photographed field is the colour of the field that was photographed —
 * every grass on Poly Haven is brown-green — and the product's ground colour
 * is `world.ts`'s, chosen per route. So the map is divided by its own mean and
 * multiplied by the product's colour: the texture brings grain, clumps and
 * light, and the hue stays the world's. The mottle and the patchwork the
 * vertex colours carry still multiply on top.
 */
function groundMaterial(maps: SurfaceMaps, tint: { value: Color }): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    map: maps.colour,
    normalMap: maps.normal,
    roughnessMap: maps.roughness,
    vertexColors: true,
    metalness: 0,
  });
  const [r, g, b] = maps.mean;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.groundTint = tint;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 groundTint;')
      // The distance blend: a second sample at 1/9 the frequency, weighted in
      // with depth. Tiling that is invisible at 5 m is a grid at 150 m.
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec4 nearTexel = texture2D( map, vMapUv );
  vec4 farTexel = texture2D( map, vMapUv * 0.111 + vec2( 0.37, 0.61 ) );
  float farShare = smoothstep( 8.0, 120.0, -vViewPosition.z );
  vec4 texel = mix( nearTexel, mix( nearTexel, farTexel, 0.5 ) * 0.55 + farTexel * 0.45, farShare );
  diffuseColor.rgb *= groundTint * texel.rgb / vec3( ${r.toFixed(5)}, ${g.toFixed(5)}, ${b.toFixed(5)} );
#endif`,
      );
  };
  return material;
}
