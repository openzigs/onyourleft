// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Spike 0024 (#1273). NEVER MERGED. What `three` resolves to on the spike's
 * page (`vite.webgpu.config.ts` aliases it here), so the product's own
 * `three-renderer.ts`, and every three addon it loads, draws through whichever
 * renderer the page made before the view existed:
 *
 * - `?backend=webglrenderer`: the installed build's `WebGLRenderer`, the control;
 * - `?backend=webgpu`: `WebGPURenderer` on its WebGPU backend;
 * - `?backend=webgl2`: `WebGPURenderer` with `forceWebGL`.
 *
 * `three/webgpu` and `three` share `three.core.js`, so a `Mesh` is the same
 * class under all three. What differs is here.
 */

// eslint-disable-next-line import-x/no-unresolved -- aliased in vite.webgpu.config.ts
import * as classic from 'oyl-three-classic';
import * as gpu from 'three/webgpu';

export * from 'three/webgpu';
export const ShaderChunk = classic.ShaderChunk;
export const UniformsLib = classic.UniformsLib;
export const UniformsUtils = classic.UniformsUtils;

/** The renderer the page made and initialised. `three-renderer.ts`'s `new WebGLRenderer` returns it. */
export interface SpikeGlobals {
  __oylSpikeRenderer?: object;
}

/** `new WebGLRenderer(...)` in the product hands back the page's renderer, already initialised. */
export class WebGLRenderer {
  constructor() {
    const renderer = (globalThis as SpikeGlobals).__oylSpikeRenderer;
    if (renderer === undefined) throw new Error('spike 0024: the page made no renderer');
    return renderer as WebGLRenderer;
  }
}

/** The PMREM generator that matches the renderer it is handed. */
export class PMREMGenerator {
  constructor(renderer: { isWebGPURenderer?: boolean }) {
    return (
      renderer.isWebGPURenderer === true
        ? new gpu.PMREMGenerator(renderer as never)
        : new classic.PMREMGenerator(renderer as never)
    ) as unknown as PMREMGenerator;
  }
}

export const ClassicWebGLRenderer = classic.WebGLRenderer;

/**
 * Under `WebGPURenderer` the product's `new MeshStandardMaterial(...)` makes the
 * NODE material of the same name, so `spike-0024-nodes.ts` has somewhere to
 * put a TSL port. Decided once, from the URL, before any material is made.
 * `?nodes=0` keeps the classic classes, which is the "nothing ported" picture.
 */
const query = new URLSearchParams(globalThis.location?.search ?? '');
const asNodes = (query.get('backend') ?? 'webgpu') !== 'webglrenderer' && query.get('nodes') !== '0';
(globalThis as { __oylNodes?: boolean }).__oylNodes = asNodes;

export const MeshStandardMaterial = asNodes ? gpu.MeshStandardNodeMaterial : gpu.MeshStandardMaterial;
export const MeshBasicMaterial = asNodes ? gpu.MeshBasicNodeMaterial : gpu.MeshBasicMaterial;
export const MeshLambertMaterial = asNodes ? gpu.MeshLambertNodeMaterial : gpu.MeshLambertMaterial;
export const ShadowMaterial = asNodes ? gpu.ShadowNodeMaterial : gpu.ShadowMaterial;
