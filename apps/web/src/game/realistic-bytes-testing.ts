// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reading what the committed realistic files actually are — #430, #474, #369.
 *
 * The same argument `model-bytes-testing.ts` makes, applied to the budget
 * rather than the palette: `realistic-budget.test.ts` has to know how many
 * triangles a shipped tree has and how large its maps are, and asking the
 * renderer would be checking an implementation against itself. So this reads
 * the files from the published formats — glTF 2.0's container, JPEG's frame
 * header, PNG's `IHDR`, Radiance's resolution string — and nothing else, and
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

/** A picture's size, whichever of the two formats a GLB may embed. */
export function imageSize(bytes: Uint8Array): ImageSize {
  return bytes[0] === 0x89 ? pngSize(bytes) : jpegSize(bytes);
}

/** What the budget reads from one committed model. */
export interface ModelFacts {
  /** Every triangle of every primitive of every mesh the scene uses. */
  readonly triangles: number;
  /** Every embedded image's size. */
  readonly images: readonly ImageSize[];
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
  const images = (json.images ?? []).map((image) => {
    const view = json.bufferViews?.[image.bufferView ?? -1];
    if (view === undefined) throw new Error(`${path}: an image is not embedded`);
    const start = view.byteOffset ?? 0;
    return imageSize(file.binary.subarray(start, start + view.byteLength));
  });
  return {
    triangles,
    images,
    skinned: (json.skins ?? []).length > 0,
    extras: json.nodes?.find((node) => node.extras !== undefined)?.extras ?? {},
  };
}

/** A standalone picture's size. */
export function fileImageSize(path: string): ImageSize {
  const bytes = new Uint8Array(readFileSync(path));
  return path.endsWith('.hdr') ? hdrSize(bytes) : imageSize(bytes);
}
