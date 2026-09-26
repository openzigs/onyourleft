// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The committed models as `near-field.ts` needs them, read off the files — #545.
 * Test support, never shipped: what `near-field.test.ts` rides the fixture
 * routes with, so that the gate's shapes come from the bytes rather than from
 * the loader it is checking.
 */

import { readFileSync } from 'node:fs';

import type { ShapeTriangles } from './near-field';

interface GltfNode {
  readonly mesh?: number;
  readonly children?: readonly number[];
  readonly translation?: readonly number[];
  readonly rotation?: readonly number[];
  readonly scale?: readonly number[];
  readonly extras?: Readonly<Record<string, unknown>>;
}

interface Gltf {
  readonly nodes?: readonly GltfNode[];
  readonly scenes?: readonly { readonly nodes: readonly number[] }[];
  readonly meshes?: readonly {
    readonly primitives: readonly {
      readonly attributes: Readonly<Record<string, number>>;
      readonly indices?: number;
      readonly mode?: number;
    }[];
  }[];
  readonly accessors?: readonly {
    readonly bufferView: number;
    readonly byteOffset?: number;
    readonly componentType: number;
    readonly count: number;
    readonly type: string;
  }[];
  readonly bufferViews?: readonly {
    readonly byteOffset?: number;
    readonly byteStride?: number;
  }[];
}

/** The magic numbers glTF 2.0 §4.4 gives the container and its two chunks. */
const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BINARY = 0x004e4942;

/** Bytes per component, by glTF's `componentType`, for the four a mesh here uses. */
const COMPONENT_BYTES: Readonly<Record<number, number>> = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };

/**
 * A committed model's triangles, as its file lays them out: nine numbers a
 * triangle, every primitive of every node of the first scene, moved by its
 * nodes' translations. And the first extras a node carries, where the
 * realistic pipeline records the scan's size.
 *
 * ⚠️ **Its own reader**, sharing nothing with `three-renderer.ts`' loader — the
 * argument `model-bytes-testing.ts` makes. A node that rotates or scales is
 * refused rather than approximated, and so is a primitive that is not a list of
 * triangles.
 */
export function modelTriangles(path: string): {
  readonly triangles: Float32Array;
  readonly extras: Readonly<Record<string, unknown>>;
} {
  const bytes = new Uint8Array(readFileSync(path));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error(`${path}: not a GLB`);
  let json: Gltf | undefined;
  let binary: DataView | undefined;
  for (let at = 12; at + 8 <= bytes.byteLength;) {
    const length = view.getUint32(at, true);
    const kind = view.getUint32(at + 4, true);
    if (kind === CHUNK_JSON) {
      json = JSON.parse(new TextDecoder().decode(bytes.subarray(at + 8, at + 8 + length))) as Gltf;
    } else if (kind === CHUNK_BINARY) {
      binary = new DataView(bytes.buffer, bytes.byteOffset + at + 8, length);
    }
    at += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (json === undefined || binary === undefined) throw new Error(`${path}: missing a chunk`);
  const document = json;
  const data = binary;
  const read = (index: number, element: number, component: number): number => {
    const accessor = document.accessors?.[index];
    if (accessor === undefined) throw new Error(`${path}: accessor ${String(index)}`);
    const size = COMPONENT_BYTES[accessor.componentType];
    if (size === undefined) {
      throw new Error(`${path}: component type ${String(accessor.componentType)}`);
    }
    const width = accessor.type === 'VEC3' ? 3 : 1;
    const bufferView = document.bufferViews?.[accessor.bufferView];
    const stride = bufferView?.byteStride ?? width * size;
    const where =
      (bufferView?.byteOffset ?? 0) +
      (accessor.byteOffset ?? 0) +
      element * stride +
      component * size;
    if (accessor.componentType === 5126) return data.getFloat32(where, true);
    if (accessor.componentType === 5125) return data.getUint32(where, true);
    if (accessor.componentType === 5123) return data.getUint16(where, true);
    return data.getUint8(where);
  };
  const out: number[] = [];
  let extras: Readonly<Record<string, unknown>> | undefined;
  const visit = (index: number, offset: readonly number[]): void => {
    const node = document.nodes?.[index];
    if (node === undefined) throw new Error(`${path}: node ${String(index)}`);
    const rotation = node.rotation ?? [0, 0, 0, 1];
    if (rotation.some((value, at) => Math.abs(value - (at === 3 ? 1 : 0)) > 1e-6)) {
      throw new Error(`${path}: a node rotates`);
    }
    if ((node.scale ?? [1, 1, 1]).some((value) => Math.abs(value - 1) > 1e-6)) {
      throw new Error(`${path}: a node scales`);
    }
    extras ??= node.extras;
    const here = offset.map((value, at) => value + (node.translation?.[at] ?? 0));
    const primitives =
      node.mesh === undefined ? [] : (document.meshes?.[node.mesh]?.primitives ?? []);
    for (const primitive of primitives) {
      if ((primitive.mode ?? 4) !== 4) throw new Error(`${path}: a primitive is not triangles`);
      const position = primitive.attributes['POSITION'];
      if (position === undefined) throw new Error(`${path}: a primitive has no positions`);
      const indices = primitive.indices;
      const corners = document.accessors?.[indices ?? position]?.count ?? 0;
      for (let corner = 0; corner < corners; corner += 1) {
        const vertex = indices === undefined ? corner : read(indices, corner, 0);
        for (let axis = 0; axis < 3; axis += 1) {
          out.push(read(position, vertex, axis) + (here[axis] as number));
        }
      }
    }
    for (const child of node.children ?? []) visit(child, here);
  };
  for (const root of document.scenes?.[0]?.nodes ?? []) visit(root, [0, 0, 0]);
  return { triangles: new Float32Array(out), extras: extras ?? {} };
}

/** The least and greatest of each axis over a list of corners. */
export function boundsOf(triangles: Float32Array): {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
} {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let at = 0; at < triangles.length; at += 1) {
    const axis = at % 3;
    min[axis] = Math.min(min[axis] as number, triangles[at] as number);
    max[axis] = Math.max(max[axis] as number, triangles[at] as number);
  }
  return { min: min as [number, number, number], max: max as [number, number, number] };
}

/**
 * A stylised model as `three-renderer.ts` §`prepareSceneryGeometry` draws it:
 * scaled so its largest extent is `fit`, centred on x and z, standing on y = 0.
 */
export function fittedStylised(triangles: Float32Array, fit: number): ShapeTriangles {
  const { min, max } = boundsOf(triangles);
  const factor = fit / Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const centreX = (min[0] + max[0]) / 2;
  const centreZ = (min[2] + max[2]) / 2;
  const out = new Float32Array(triangles.length);
  for (let at = 0; at < triangles.length; at += 3) {
    out[at] = ((triangles[at] as number) - centreX) * factor;
    out[at + 1] = ((triangles[at + 1] as number) - min[1]) * factor;
    out[at + 2] = ((triangles[at + 2] as number) - centreZ) * factor;
  }
  return out;
}

/**
 * A realistic model as `three-renderer.ts` §`RealisticVegetationBelt` draws it:
 * about its own pivot, scaled by `fit` over the scan's recorded extent.
 */
export function fittedRealistic(
  triangles: Float32Array,
  extras: Readonly<Record<string, unknown>>,
  fit: number,
): ShapeTriangles {
  const extent = Math.max(Number(extras['oyl_scan_height']), Number(extras['oyl_scan_width']));
  if (!(extent > 0)) throw new Error('the file records no scan size');
  const factor = fit / extent;
  return triangles.map((value) => value * factor);
}
