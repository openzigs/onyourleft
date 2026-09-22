// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The sky, the environment light, the haze and the bloom — #457 (1) and (5).
 *
 * ⚠️ **Spike code on a never-merged branch** (see `surfaces.ts`).
 *
 * - **Sky** (1): a Poly Haven equirectangular HDR as the background, and the
 *   same image prefiltered by `PMREMGenerator` as `scene.environment`, which
 *   lights every `MeshStandardMaterial` in the scene — the spike's road,
 *   ground, trees and rider. The product's own `WorldLamps` stay, so the sun
 *   still comes from `world.ts`; the ambient lamp is turned off, because the
 *   environment IS the ambient term now. The product's Lambert belts
 *   (buildings, bridges) are not re-lit: `scene.environment` does not reach a
 *   Lambert material, and converting them would change what the baseline
 *   measures.
 * - **Haze** (5): three's fog chunks are replaced, for this page only, with a
 *   height-attenuated exponential fog that is thicker low down (valley haze)
 *   and warms towards the sun. The same density the product's `FogExp2` uses,
 *   so the far view ends where it did.
 * - **Bloom** (5): `UnrealBloomPass` at half resolution with a high threshold,
 *   so only the sky and specular highlights bloom — the "cheap bloom" #457
 *   asks for. It needs an `EffectComposer`, which means the frame is drawn to
 *   a half-float target and tone-mapped by `OutputPass` instead of by the
 *   materials; that switch is part of what the bloom row measures.
 */

import {
  EquirectangularReflectionMapping,
  PMREMGenerator,
  ShaderChunk,
  Vector2,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import type { PerspectiveCamera } from 'three';

/** How strongly the environment lights the scene. By eye; see {@link applySky}. */
export const ENVIRONMENT_INTENSITY = 0.8;

/**
 * The bloom threshold, in linear HDR luminance. Without the HDRI nothing in the
 * frame exceeds 1 and only the white lines bloom at 0.92; with it, the sky is
 * several times brighter than 1 and a low threshold blooms the whole frame
 * into a veil (the first all-on screenshot did exactly that).
 */
export function bloomThreshold(sky: boolean): number {
  return sky ? 1.6 : 0.92;
}

/** A loaded sky, and what it costs the GPU (an estimate: half-float RGBA). */
export interface Sky {
  readonly background: Texture;
  readonly environment: Texture;
  readonly textureBytes: number;
}

export async function loadSky(renderer: WebGLRenderer, url: string): Promise<Sky> {
  const background = await new HDRLoader().loadAsync(url);
  background.mapping = EquirectangularReflectionMapping;
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(background).texture;
  pmrem.dispose();
  const image = background.image as { width: number; height: number };
  const environmentImage = environment.image as { width: number; height: number };
  // Half-float RGBA is 8 bytes a texel; the PMREM target carries its own mips in-atlas.
  const textureBytes =
    image.width * image.height * 8 + environmentImage.width * environmentImage.height * 8;
  return { background, environment, textureBytes };
}

export function applySky(scene: Scene, sky: Sky): void {
  scene.background = sky.background;
  scene.environment = sky.environment;
  // The HDR's own scale is arbitrary; tuned by eye so a level field under the
  // environment plus world.ts's sun reads about as bright as the product's
  // (which is held to exactly 1 for a horizontal surface, world.ts §SunStyle).
  scene.environmentIntensity = ENVIRONMENT_INTENSITY;
  // Poly Haven's farm field has its sun low in the south-east of the image;
  // turned so it agrees roughly with world.ts's azimuth of 135°.
  scene.backgroundRotation.set(0, Math.PI * 0.25, 0);
  scene.environmentRotation.set(0, Math.PI * 0.25, 0);
}

/**
 * Replaces three's fog chunks with the height haze. Called before anything is
 * compiled; every fogged material on the page then gets it.
 *
 * `sun` is `world.ts`'s sun direction for the route, baked in as a constant
 * because the spike's route has one latitude.
 */
export function installHaze(sun: { x: number; y: number; z: number }): void {
  const s = `vec3(${sun.x.toFixed(4)}, ${sun.y.toFixed(4)}, ${sun.z.toFixed(4)})`;
  ShaderChunk.fog_pars_vertex =
    '#ifdef USE_FOG\n varying float vFogDepth;\n varying vec3 vHazeWorld;\n#endif';
  ShaderChunk.fog_vertex =
    '#ifdef USE_FOG\n vFogDepth = - mvPosition.z;\n vHazeWorld = ( inverse( viewMatrix ) * mvPosition ).xyz;\n#endif';
  ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vHazeWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    // Thicker below the eye, thinner above it: a valley holds its haze.
    float below = clamp( ( cameraPosition.y - vHazeWorld.y ) / 40.0, -1.0, 1.0 );
    float density = fogDensity * ( 1.0 + 0.3 * below );
    float fogFactor = 1.0 - exp( - density * density * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  vec3 view = normalize( vHazeWorld - cameraPosition );
  float toSun = pow( max( dot( view, normalize( ${s} ) ), 0.0 ), 6.0 );
  vec3 haze = mix( fogColor, vec3( 1.0, 0.92, 0.78 ), toSun * 0.45 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, haze, fogFactor );
#endif`;
}

/** The composer that draws the frame when bloom is on. */
export function bloomComposer(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  threshold: number,
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const size = renderer.getSize(new Vector2());
  composer.addPass(new UnrealBloomPass(new Vector2(size.x / 2, size.y / 2), 0.2, 0.4, threshold));
  composer.addPass(new OutputPass());
  return composer;
}
