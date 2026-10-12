// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Spike 0024: stands in for `three.module.js` when only the size of a WebGPU-only page is
 * wanted (W7). The product still CONSTRUCTS the stylised water's `ShaderMaterial` in the
 * realistic world, so `UniformsUtils.merge` has to exist; nothing here is drawn.
 */
export const ShaderChunk = {};
export const UniformsLib = { fog: {} };
export const UniformsUtils = {
  merge: (list: readonly object[]): object => Object.assign({}, ...list),
  clone: (uniforms: object): object => ({ ...uniforms }),
};
export class PMREMGenerator {}
export class WebGLRenderer {}
