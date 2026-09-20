// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reading a committed model's own bytes, independently of the renderer — #366.
 *
 * ## Why this exists rather than reusing the loader
 *
 * `three-renderer.ts` extracts a model's colours with three's `GLTFLoader` and
 * a canvas, and neither is available to the fast suite: `three-seam.test.ts`
 * allows exactly one file in this repository to import the rendering library,
 * and jsdom implements no 2D context. So a test that wanted to check what the
 * renderer extracted would have to import the renderer, which would be checking
 * an implementation against itself.
 *
 * ⚠️ **The same argument `packages/store`'s `identity-verifier.test.ts` makes**:
 * it calls `crypto.subtle.verify` directly rather than through
 * `web-crypto.ts`, *"because it is the independent spec verifier and routing it
 * through `web-crypto.ts` would destroy the independence it exists for"*. This
 * is that, for glTF and PNG: a reader written from the two published
 * specifications, sharing no line with the production path, so that
 * `scenery-palette.ts` §`SCENERY_PALETTE` is a claim two implementations agree
 * on rather than one implementation's own output written down.
 *
 * ## What it deliberately does not do
 *
 * It is **not** a glTF loader and must not grow into one. It reads exactly what
 * the palette gate needs — a material's `baseColorFactor`, a primitive's
 * `TEXCOORD_0` and which material it uses — and refuses everything it has not
 * been taught, loudly, rather than falling back to a default. A reader that
 * quietly returned white for a construct it did not understand would make the
 * gate pass over precisely the file that had changed.
 *
 * It supports **8-bit, non-interlaced** PNG only, which is what
 * `models/colormap.png` is. `scenery-palette.test.ts` asserts the header it
 * actually read, so a pack that re-exported its atlas at 16 bits fails here
 * rather than being silently mis-sampled.
 *
 * ⚠️ **`-testing.ts`, so `check-wiring.mjs` treats it as what it is.** The
 * wiring gate watches `apps/web/src/game/` and would otherwise report every
 * export below as reachable from no production module, which would be true and
 * useless. `scripts/check-wiring.mjs` §`isTestSupport` is the rule.
 */

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

import { atlasColourAt, type AtlasImage, type LinearRgb } from './scenery-palette';

/** The magic numbers glTF 2.0 §3.3 gives the container. */
const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BINARY = 0x004e4942;

/** Bytes per component, by glTF's `componentType`. §5.1.1 */
const COMPONENT_BYTES: Readonly<Record<number, number>> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

/** Components per element, by glTF's accessor `type`. §5.1.4 */
const TYPE_COMPONENTS: Readonly<Record<string, number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
};

interface GltfAccessor {
  readonly bufferView: number;
  readonly byteOffset?: number;
  readonly componentType: number;
  readonly count: number;
  readonly type: string;
}

interface GltfDocument {
  readonly accessors?: readonly GltfAccessor[];
  readonly bufferViews?: readonly { readonly byteOffset?: number; readonly byteStride?: number }[];
  readonly materials?: readonly {
    readonly name?: string;
    readonly pbrMetallicRoughness?: {
      readonly baseColorFactor?: readonly number[];
      readonly baseColorTexture?: { readonly index: number };
    };
  }[];
  readonly meshes?: readonly {
    readonly primitives: readonly {
      readonly attributes: Readonly<Record<string, number>>;
      readonly material?: number;
    }[];
  }[];
  readonly images?: readonly { readonly uri?: string }[];
  /**
   * ⚠️ Read only so that `scenery-models.test.ts` can assert every committed
   * file packs its geometry **inside** the container. A `.glb` naming an
   * external `.bin` would have its geometry answered with a transparent PNG and
   * would fall back to a primitive in silence.
   */
  readonly buffers?: readonly { readonly uri?: string }[];
}

/** One model's JSON chunk and its binary chunk. */
export interface GlbFile {
  readonly json: GltfDocument;
  readonly binary: Uint8Array;
}

/** Splits a `.glb` into its two chunks. glTF 2.0 §3.3. */
export function readGlb(path: string): GlbFile {
  const bytes = new Uint8Array(readFileSync(path));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error(`${path}: not a GLB`);
  }
  let json: GltfDocument | undefined;
  let binary: Uint8Array | undefined;
  let at = 12;
  while (at + 8 <= bytes.byteLength) {
    const length = view.getUint32(at, true);
    const kind = view.getUint32(at + 4, true);
    const chunk = bytes.subarray(at + 8, at + 8 + length);
    if (kind === CHUNK_JSON) {
      json = JSON.parse(new TextDecoder().decode(chunk)) as GltfDocument;
    } else if (kind === CHUNK_BINARY) {
      binary = chunk;
    }
    // Chunks are four-byte aligned, and a reader that ignored the padding
    // would find the next chunk's header one to three bytes late and read a
    // length out of the middle of it.
    at += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (json === undefined || binary === undefined) {
    throw new Error(`${path}: missing a JSON or a binary chunk`);
  }
  return { json, binary };
}

/** One accessor's elements, flattened. Floats only, which is all a UV is. */
function readFloatAccessor(file: GlbFile, index: number): Float32Array {
  const accessor = file.json.accessors?.[index];
  if (accessor === undefined) {
    throw new Error(`accessor ${String(index)} is not there`);
  }
  if (accessor.componentType !== 5126) {
    throw new Error(`accessor ${String(index)}: only float components are read`);
  }
  const components = TYPE_COMPONENTS[accessor.type];
  const size = COMPONENT_BYTES[accessor.componentType];
  if (components === undefined || size === undefined) {
    throw new Error(`accessor ${String(index)}: unsupported ${accessor.type}`);
  }
  const view = file.json.bufferViews?.[accessor.bufferView];
  if (view === undefined) {
    throw new Error(`accessor ${String(index)}: buffer view is not there`);
  }
  // ⚠️ The stride is the buffer view's when it declares one and the element's
  // own when it does not — glTF §3.6.1.1. A reader that assumed tight packing
  // reads an interleaved file as noise, which would look like a pack that had
  // changed its colours.
  const stride = view.byteStride ?? components * size;
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const source = new DataView(file.binary.buffer, file.binary.byteOffset, file.binary.byteLength);
  const out = new Float32Array(accessor.count * components);
  for (let element = 0; element < accessor.count; element += 1) {
    for (let component = 0; component < components; component += 1) {
      out[element * components + component] = source.getFloat32(
        base + element * stride + component * size,
        true,
      );
    }
  }
  return out;
}

/**
 * Every distinct colour a model's vertices carry, in the linear working space.
 *
 * Takes the atlas because a building's colour is in one; a model whose
 * materials all carry a `baseColorFactor` never looks at it, and a model that
 * needs one without it being supplied throws rather than guessing.
 */
export function modelColours(file: GlbFile, atlas?: AtlasImage): readonly LinearRgb[] {
  const found = new Map<string, LinearRgb>();
  for (const mesh of file.json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      const material =
        primitive.material === undefined ? undefined : file.json.materials?.[primitive.material];
      if (material === undefined) {
        throw new Error('a primitive declares no material');
      }
      const factor = material.pbrMetallicRoughness?.baseColorFactor;
      const textured = material.pbrMetallicRoughness?.baseColorTexture !== undefined;
      if (!textured && factor !== undefined) {
        // ⚠️ Straight through, with no conversion: glTF §5.19.2 defines
        // `baseColorFactor` as linear, and so is a `COLOR_0`.
        remember(found, [factor[0] ?? 0, factor[1] ?? 0, factor[2] ?? 0]);
        continue;
      }
      if (!textured) {
        throw new Error('a material carries neither a base colour factor nor a texture');
      }
      if (atlas === undefined) {
        throw new Error('a material is textured and no atlas was supplied');
      }
      const uvIndex = primitive.attributes['TEXCOORD_0'];
      if (uvIndex === undefined) {
        throw new Error('a textured primitive carries no TEXCOORD_0');
      }
      const uv = readFloatAccessor(file, uvIndex);
      for (let at = 0; at + 1 < uv.length; at += 2) {
        remember(found, atlasColourAt(atlas, uv[at] ?? 0, uv[at + 1] ?? 0));
      }
    }
  }
  return [...found.values()];
}

function remember(into: Map<string, LinearRgb>, colour: LinearRgb): void {
  into.set(serialiseColour(colour), colour);
}

/** One colour at the precision the digest is taken at. */
function serialiseColour(colour: LinearRgb): string {
  return colour.map((channel) => channel.toFixed(6)).join(' ');
}

/**
 * A model's colour set as eight hex digits — FNV-1a, 32-bit.
 *
 * Sorted first, so the digest is a property of the **set** rather than of the
 * order a file happens to declare its materials in; six decimal places, so a
 * floating-point round trip on a different CPU cannot move it, exactly as
 * `arrangement-unchanged.test.ts` argues for its own precision.
 */
export function paletteDigest(colours: readonly LinearRgb[]): string {
  let hash = 0x811c9dc5;
  for (const line of colours.map(serialiseColour).sort()) {
    for (let at = 0; at < line.length; at += 1) {
      hash ^= line.charCodeAt(at);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0x0a;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** What a decoded PNG carries beyond its pixels, so a test can assert it. */
export interface DecodedPng extends AtlasImage {
  /** PNG §11.2.2's colour type. 3 is palette-indexed, which is what we ship. */
  readonly colourType: number;
  readonly bitDepth: number;
}

const PNG_FILTER_BYTES = 1;

/**
 * An 8-bit, non-interlaced PNG, as top-row-first RGBA.
 *
 * Written from PNG (ISO 15948) §9 and §11: the IHDR header, the concatenated
 * IDAT stream through `inflate`, and the five per-row filters. Nothing else is
 * supported and everything else throws.
 */
export function decodePng(path: string): DecodedPng {
  const bytes = new Uint8Array(readFileSync(path));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  const data: Uint8Array[] = [];
  let palette: Uint8Array | undefined;
  while (at + 8 <= bytes.byteLength) {
    const length = view.getUint32(at, false);
    const kind = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const chunk = bytes.subarray(at + 8, at + 8 + length);
    if (kind === 'IHDR') {
      const header = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      width = header.getUint32(0, false);
      height = header.getUint32(4, false);
      bitDepth = chunk[8] ?? 0;
      colourType = chunk[9] ?? 0;
      if (bitDepth !== 8 || (chunk[12] ?? 0) !== 0) {
        throw new Error(`${path}: only 8-bit, non-interlaced PNG is read`);
      }
    } else if (kind === 'PLTE') {
      palette = chunk;
    } else if (kind === 'IDAT') {
      data.push(chunk);
    } else if (kind === 'IEND') {
      break;
    }
    at += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
  if (channels === undefined) {
    throw new Error(`${path}: unsupported colour type ${String(colourType)}`);
  }
  const raw = new Uint8Array(inflateSync(Buffer.concat(data.map((part) => Buffer.from(part)))));
  const stride = width * channels;
  const flat = unfilter(raw, width, height, channels);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const [red, green, blue] = pixelAt(flat, pixel, colourType, channels, palette);
    rgba[pixel * 4] = red;
    rgba[pixel * 4 + 1] = green;
    rgba[pixel * 4 + 2] = blue;
    rgba[pixel * 4 + 3] = 255;
  }
  if (flat.length !== height * stride) {
    throw new Error(`${path}: the inflated image is the wrong size`);
  }
  return { width, height, data: rgba, colourType, bitDepth };
}

/** PNG §9.2's five filters, undone a row at a time. */
function unfilter(raw: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array(height * stride);
  let previous = new Uint8Array(stride);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + PNG_FILTER_BYTES)] ?? 0;
    const line = raw.subarray(
      row * (stride + PNG_FILTER_BYTES) + PNG_FILTER_BYTES,
      (row + 1) * (stride + PNG_FILTER_BYTES),
    );
    const current = new Uint8Array(stride);
    for (let byte = 0; byte < stride; byte += 1) {
      const left = byte >= channels ? (current[byte - channels] ?? 0) : 0;
      const up = previous[byte] ?? 0;
      const upLeft = byte >= channels ? (previous[byte - channels] ?? 0) : 0;
      current[byte] = ((line[byte] ?? 0) + predictor(filter, left, up, upLeft)) & 0xff;
    }
    out.set(current, row * stride);
    previous = current;
  }
  return out;
}

function predictor(filter: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4: {
      // Paeth, PNG §9.4, written out rather than approximated.
      const estimate = left + up - upLeft;
      const toLeft = Math.abs(estimate - left);
      const toUp = Math.abs(estimate - up);
      const toUpLeft = Math.abs(estimate - upLeft);
      return toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft;
    }
    default:
      throw new Error(`unknown PNG row filter ${String(filter)}`);
  }
}

function pixelAt(
  flat: Uint8Array,
  pixel: number,
  colourType: number,
  channels: number,
  palette: Uint8Array | undefined,
): readonly [number, number, number] {
  if (colourType === 3) {
    if (palette === undefined) {
      throw new Error('a palette-indexed PNG carries no PLTE chunk');
    }
    const entry = (flat[pixel] ?? 0) * 3;
    return [palette[entry] ?? 0, palette[entry + 1] ?? 0, palette[entry + 2] ?? 0];
  }
  const at = pixel * channels;
  if (colourType === 0 || colourType === 4) {
    const grey = flat[at] ?? 0;
    return [grey, grey, grey];
  }
  return [flat[at] ?? 0, flat[at + 1] ?? 0, flat[at + 2] ?? 0];
}
