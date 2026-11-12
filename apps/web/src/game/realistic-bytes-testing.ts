// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reading what the committed realistic files actually are — #430, #474, #369.
 *
 * The same argument `model-bytes-testing.ts` makes, applied to the budget
 * rather than the palette: `realistic-budget.test.ts` has to know how many
 * triangles a shipped tree has and how large its maps are, and asking the
 * renderer would be checking an implementation against itself. So this reads
 * the files from the published formats — glTF 2.0's container, JPEG's frame
 * header, PNG's `IHDR`, Radiance's resolution string and, since #618, KTX
 * 2.0's header and data format descriptor — and nothing else, and
 * refuses what it has not been taught rather than guessing.
 *
 * ⚠️ `-testing.ts`, so `check-wiring.mjs` §`isTestSupport` treats it as what it
 * is rather than as product code nothing imports.
 */

import { readFileSync } from 'node:fs';

import { readGlb } from './model-bytes-testing';

/** A picture's pixel dimensions. */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** A JPEG's size, from its first start-of-frame marker. ITU T.81 §B.2.2. */
export function jpegSize(bytes: Uint8Array): ImageSize {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG');
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) throw new Error(`JPEG: no marker at byte ${String(at)}`);
    const marker = bytes[at + 1] ?? 0;
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    // SOF0–SOF15, less DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: ((bytes[at + 5] ?? 0) << 8) | (bytes[at + 6] ?? 0),
        width: ((bytes[at + 7] ?? 0) << 8) | (bytes[at + 8] ?? 0),
      };
    }
    at += 2 + length;
  }
  throw new Error('JPEG: no start-of-frame marker');
}

/** A PNG's size, from `IHDR`, which the specification requires first. */
export function pngSize(bytes: Uint8Array): ImageSize {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, index) => bytes[index] === byte)) throw new Error('not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * A Radiance HDR's size, from the resolution string after its header's blank
 * line. Only the standard orientation, `-Y <height> +X <width>`, which is the
 * one three's `HDRLoader` reads; any other is refused.
 */
export function hdrSize(bytes: Uint8Array): ImageSize {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  if (!head.startsWith('#?RADIANCE') && !head.startsWith('#?RGBE')) throw new Error('not an HDR');
  const matched = /\n\n-Y (\d+) \+X (\d+)\n/.exec(head);
  if (matched === null) throw new Error('HDR: no standard -Y/+X resolution string');
  return { height: Number(matched[1]), width: Number(matched[2]) };
}

/** The twelve bytes a KTX 2.0 file opens with — `«KTX 20»\r\n\x1A\n`. */
const KTX2_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

/** What the budget reads from a KTX2 file — #618. */
export interface Ktx2Facts extends ImageSize {
  /** Mip levels stored, the base included. */
  readonly levels: number;
  /** Which Basis Universal encoding: ETC1S, or UASTC. */
  readonly scheme: 'etc1s' | 'uastc';
  /** Whether it carries alpha. */
  readonly alpha: boolean;
  /** Its transfer function, from the data format descriptor. */
  readonly transfer: 'srgb' | 'linear';
}

/**
 * Reads a KTX 2.0 file's header and data format descriptor — the Khronos KTX
 * 2.0 specification §3 and the Khronos Data Format Specification 1.3 §5, the
 * Basis Universal colour models 163 (ETC1S) and 166 (UASTC). Refuses anything
 * that is not a Basis Universal texture, because that is all this set holds.
 */
export function ktx2Facts(bytes: Uint8Array): Ktx2Facts {
  if (!KTX2_IDENTIFIER.every((byte, index) => bytes[index] === byte)) throw new Error('not a KTX2');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(12, true) !== 0) throw new Error('KTX2: not a Basis Universal texture');
  const dfd = view.getUint32(48, true);
  const model = view.getUint8(dfd + 12);
  const transfer = view.getUint8(dfd + 14);
  const blockSize = view.getUint16(dfd + 10, true);
  const samples = (blockSize - 24) / 16;
  const channels: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    channels.push(view.getUint8(dfd + 4 + 24 + sample * 16 + 3) & 0x0f);
  }
  let scheme: Ktx2Facts['scheme'];
  let alpha: boolean;
  if (model === 163) {
    scheme = 'etc1s';
    // ETC1S: an AAA slice (channel 15) beside the RGB one.
    alpha = channels.includes(15);
  } else if (model === 166) {
    scheme = 'uastc';
    // UASTC: RGBA (3) or RRRG (5).
    alpha = channels.includes(3) || channels.includes(5);
  } else {
    throw new Error(`KTX2: colour model ${String(model)} is not Basis Universal`);
  }
  return {
    width: view.getUint32(20, true),
    height: view.getUint32(24, true),
    levels: view.getUint32(40, true),
    scheme,
    alpha,
    transfer: transfer === 2 ? 'srgb' : 'linear',
  };
}

/** Whether these bytes are a KTX2 file. */
export function isKtx2(bytes: Uint8Array): boolean {
  return KTX2_IDENTIFIER.every((byte, index) => bytes[index] === byte);
}

/** A picture's size, whichever format a GLB may embed — JPEG, PNG or, since #618, KTX2. */
export function imageSize(bytes: Uint8Array): ImageSize {
  if (isKtx2(bytes)) {
    const facts = ktx2Facts(bytes);
    return { width: facts.width, height: facts.height };
  }
  return bytes[0] === 0x89 ? pngSize(bytes) : jpegSize(bytes);
}

/** What the budget reads from one committed model. */
export interface ModelFacts {
  /** Every triangle of every primitive of every mesh the scene uses. */
  readonly triangles: number;
  /** Every embedded image's size. */
  readonly images: readonly ImageSize[];
  /** Every embedded image that is KTX2, read — #618. */
  readonly ktx2: readonly Ktx2Facts[];
  /** Whether it carries a skin — the rider does and nothing else should. */
  readonly skinned: boolean;
  /** The first node's extras, where the pipeline records what the runtime needs. */
  readonly extras: Readonly<Record<string, unknown>>;
}

interface GltfJson {
  readonly meshes?: readonly {
    readonly primitives: readonly {
      readonly indices?: number;
      readonly mode?: number;
      readonly attributes: Readonly<Record<string, number>>;
    }[];
  }[];
  readonly nodes?: readonly {
    readonly mesh?: number;
    readonly skin?: number;
    readonly extras?: Readonly<Record<string, unknown>>;
  }[];
  readonly accessors?: readonly { readonly count: number }[];
  readonly images?: readonly { readonly bufferView?: number }[];
  readonly bufferViews?: readonly { readonly byteOffset?: number; readonly byteLength: number }[];
  readonly skins?: readonly unknown[];
}

/** Reads a committed `.glb` for the budget. Refuses a mode other than triangles. */
export function modelFacts(path: string): ModelFacts {
  const file = readGlb(path);
  const json = file.json as unknown as GltfJson;
  let triangles = 0;
  for (const node of json.nodes ?? []) {
    if (node.mesh === undefined) continue;
    for (const primitive of json.meshes?.[node.mesh]?.primitives ?? []) {
      if ((primitive.mode ?? 4) !== 4) throw new Error(`${path}: a primitive is not triangles`);
      const counted =
        primitive.indices === undefined ? primitive.attributes['POSITION'] : primitive.indices;
      triangles += (json.accessors?.[counted ?? -1]?.count ?? 0) / 3;
    }
  }
  const embedded = (json.images ?? []).map((image) => {
    const view = json.bufferViews?.[image.bufferView ?? -1];
    if (view === undefined) throw new Error(`${path}: an image is not embedded`);
    const start = view.byteOffset ?? 0;
    return file.binary.subarray(start, start + view.byteLength);
  });
  return {
    triangles,
    images: embedded.map(imageSize),
    ktx2: embedded.filter(isKtx2).map(ktx2Facts),
    skinned: (json.skins ?? []).length > 0,
    extras: json.nodes?.find((node) => node.extras !== undefined)?.extras ?? {},
  };
}

/** A standalone picture's size. */
export function fileImageSize(path: string): ImageSize {
  const bytes = new Uint8Array(readFileSync(path));
  return path.endsWith('.hdr') ? hdrSize(bytes) : imageSize(bytes);
}

/** A standalone KTX2 file, read. @see ktx2Facts */
export function fileKtx2Facts(path: string): Ktx2Facts {
  return ktx2Facts(new Uint8Array(readFileSync(path)));
}

/**
 * A roadside model, read off its committed bytes — #1274: what
 * `three-renderer.ts` §`roadsideGeometryOf` copies out of the loader's scene,
 * read here from glTF 2.0's own accessors, so a test can hand a belt the
 * committed model without asking the renderer to read it.
 */
export interface RoadsideFacts {
  /** Not indexed: three floats a vertex. */
  readonly position: Float32Array;
  readonly normal: Float32Array;
  /** Its `COLOR_0`, red, green and blue as the fraction each stands for. */
  readonly colour: Float32Array;
  readonly triangles: number;
  /** The attributes its one primitive names. */
  readonly attributes: readonly string[];
  /** How many materials, images and textures the file declares. */
  readonly materials: number;
  readonly images: number;
}

export interface AccessorJson {
  readonly bufferView?: number;
  readonly byteOffset?: number;
  readonly componentType: number;
  readonly count: number;
  readonly normalized?: boolean;
  readonly type: string;
}

const COMPONENTS: Readonly<Record<string, number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
};

/** One accessor's values, as numbers — a normalized integer as its fraction. glTF 2.0 §3.6. */
export function accessorValues(
  json: {
    readonly accessors?: readonly AccessorJson[];
    readonly bufferViews?: readonly {
      readonly byteOffset?: number;
      readonly byteStride?: number;
    }[];
  },
  binary: Uint8Array,
  index: number,
): { readonly values: Float64Array; readonly size: number } {
  const accessor = json.accessors?.[index];
  if (accessor === undefined) throw new Error(`no accessor ${String(index)}`);
  const view = json.bufferViews?.[accessor.bufferView ?? -1];
  if (view === undefined) throw new Error(`accessor ${String(index)} has no buffer view`);
  const size = COMPONENTS[accessor.type];
  if (size === undefined) throw new Error(`accessor ${String(index)}: ${accessor.type}`);
  const read: Readonly<
    Record<number, readonly [number, (data: DataView, at: number) => number, number]>
  > = {
    5121: [1, (data, at) => data.getUint8(at), 255],
    5123: [2, (data, at) => data.getUint16(at, true), 65_535],
    5125: [4, (data, at) => data.getUint32(at, true), 4_294_967_295],
    5126: [4, (data, at) => data.getFloat32(at, true), 1],
  };
  const how = read[accessor.componentType];
  if (how === undefined)
    throw new Error(`accessor ${String(index)}: ${String(accessor.componentType)}`);
  const [bytes, get, scale] = how;
  const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const stride = view.byteStride ?? bytes * size;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const values = new Float64Array(accessor.count * size);
  for (let element = 0; element < accessor.count; element += 1) {
    for (let component = 0; component < size; component += 1) {
      const raw = get(data, start + element * stride + component * bytes);
      values[element * size + component] =
        accessor.normalized === true && accessor.componentType !== 5126 ? raw / scale : raw;
    }
  }
  return { values, size };
}

/** Reads a committed roadside model. Refuses a file of more than one primitive. */
export function roadsideFacts(path: string): RoadsideFacts {
  const file = readGlb(path);
  const json = file.json as unknown as {
    readonly meshes?: readonly {
      readonly primitives: readonly {
        readonly indices?: number;
        readonly attributes: Readonly<Record<string, number>>;
      }[];
    }[];
    readonly accessors?: readonly AccessorJson[];
    readonly bufferViews?: readonly {
      readonly byteOffset?: number;
      readonly byteStride?: number;
    }[];
    readonly materials?: readonly unknown[];
    readonly images?: readonly unknown[];
  };
  const primitives = (json.meshes ?? []).flatMap((mesh) => mesh.primitives);
  const [primitive] = primitives;
  if (primitive === undefined || primitives.length !== 1) {
    throw new Error(`${path}: expected one primitive, found ${String(primitives.length)}`);
  }
  const of = (name: string): { readonly values: Float64Array; readonly size: number } => {
    const at = primitive.attributes[name];
    if (at === undefined) throw new Error(`${path}: no ${name}`);
    return accessorValues(json, file.binary, at);
  };
  const positions = of('POSITION');
  const normals = of('NORMAL');
  const colours = of('COLOR_0');
  const order =
    primitive.indices === undefined
      ? Array.from({ length: positions.values.length / 3 }, (_, at) => at)
      : Array.from(accessorValues(json, file.binary, primitive.indices).values);
  const position = new Float32Array(order.length * 3);
  const normal = new Float32Array(order.length * 3);
  const colour = new Float32Array(order.length * 3);
  order.forEach((vertex, at) => {
    for (let axis = 0; axis < 3; axis += 1) {
      position[at * 3 + axis] = positions.values[vertex * 3 + axis] as number;
      normal[at * 3 + axis] = normals.values[vertex * 3 + axis] as number;
      colour[at * 3 + axis] = colours.values[vertex * colours.size + axis] as number;
    }
  });
  return {
    position,
    normal,
    colour,
    triangles: order.length / 3,
    attributes: Object.keys(primitive.attributes).sort(),
    materials: (json.materials ?? []).length,
    images: (json.images ?? []).length,
  };
}

/** The chain-link fence's piece, read off its committed bytes — #1274. @see chainLinkFacts */
export interface ChainLinkFacts {
  readonly frame: RoadsideFacts;
  /** The wire, with its `TEXCOORD_0`: two floats a vertex. */
  readonly wire: RoadsideFacts & { readonly uv: Float32Array };
}

/**
 * Reads the committed chain-link piece — #1274: its node named `frame` and its
 * node named `wire`, each one primitive, as {@link roadsideFacts} reads a
 * model, from glTF 2.0's own accessors and with nothing of the renderer's.
 */
export function chainLinkFacts(path: string): ChainLinkFacts {
  const file = readGlb(path);
  const json = file.json as unknown as {
    readonly nodes?: readonly { readonly name?: string; readonly mesh?: number }[];
    readonly meshes?: readonly {
      readonly primitives: readonly {
        readonly indices?: number;
        readonly attributes: Readonly<Record<string, number>>;
      }[];
    }[];
    readonly accessors?: readonly AccessorJson[];
    readonly bufferViews?: readonly {
      readonly byteOffset?: number;
      readonly byteStride?: number;
    }[];
    readonly materials?: readonly unknown[];
    readonly images?: readonly unknown[];
  };
  const named = (name: string): RoadsideFacts & { readonly uv: Float32Array } => {
    const node = (json.nodes ?? []).find((each) => each.name === name);
    const primitives = json.meshes?.[node?.mesh ?? -1]?.primitives ?? [];
    const [primitive] = primitives;
    if (primitive === undefined || primitives.length !== 1) {
      throw new Error(`${path}: expected one primitive named ${name}`);
    }
    const of = (attribute: string): { readonly values: Float64Array; readonly size: number } => {
      const at = primitive.attributes[attribute];
      if (at === undefined) return { values: new Float64Array(0), size: 0 };
      return accessorValues(json, file.binary, at);
    };
    const positions = of('POSITION');
    const normals = of('NORMAL');
    const colours = of('COLOR_0');
    const uvs = of('TEXCOORD_0');
    const order =
      primitive.indices === undefined
        ? Array.from({ length: positions.values.length / 3 }, (_, at) => at)
        : Array.from(accessorValues(json, file.binary, primitive.indices).values);
    const position = new Float32Array(order.length * 3);
    const normal = new Float32Array(order.length * 3);
    const colour = new Float32Array(order.length * 3);
    const uv = new Float32Array(uvs.size === 0 ? 0 : order.length * 2);
    order.forEach((vertex, at) => {
      for (let axis = 0; axis < 3; axis += 1) {
        position[at * 3 + axis] = positions.values[vertex * 3 + axis] as number;
        normal[at * 3 + axis] = normals.values[vertex * 3 + axis] as number;
        colour[at * 3 + axis] = colours.values[vertex * colours.size + axis] as number;
      }
      if (uvs.size !== 0) {
        uv[at * 2] = uvs.values[vertex * 2] as number;
        uv[at * 2 + 1] = uvs.values[vertex * 2 + 1] as number;
      }
    });
    return {
      position,
      normal,
      colour,
      uv,
      triangles: order.length / 3,
      attributes: Object.keys(primitive.attributes).sort(),
      materials: (json.materials ?? []).length,
      images: (json.images ?? []).length,
    };
  };
  return { frame: named('frame'), wire: named('wire') };
}
