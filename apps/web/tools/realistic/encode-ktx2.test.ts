// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The GLB rewrite of `encode-ktx2.ts` — #618 — held against hand-built GLBs and
 * the committed ones, with a stand-in encoder, because the pinned `ktx` does
 * not run in CI. What the real encoder writes is `realistic:process --check`'s,
 * and what three makes of it is `realistic-textures.test.ts`'.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BASISU_EXTENSION,
  embeddedImages,
  pngHasAlpha,
  readGlbBytes,
  withKtx2Images,
  writeGlbBytes,
  type GltfJson,
} from './encode-ktx2';

const SHIPPED = fileURLToPath(new URL('../../public/realistic/', import.meta.url));

const PNG_RGBA = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 4,
  0, 0, 0, 4, 8, 6, 0, 0, 0, 0, 0, 0, 0,
]);
const PNG_RGB = Uint8Array.from(PNG_RGBA.map((byte, index) => (index === 25 ? 2 : byte)));
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

/** A GLB with a mesh accessor between two images, so a moved view is visible. */
function fixture(): Uint8Array {
  const accessor = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const parts = [JPEG, accessor, PNG_RGBA];
  const views: GltfJson['bufferViews'] = [];
  let offset = 0;
  const bytes: number[] = [];
  for (const part of parts) {
    views.push({ buffer: 0, byteOffset: offset, byteLength: part.byteLength });
    bytes.push(...part);
    while (bytes.length % 4 !== 0) bytes.push(0);
    offset = bytes.length;
  }
  const json: GltfJson = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bytes.length }],
    bufferViews: views,
    accessors: [{ bufferView: 1, componentType: 5126, count: 2, type: 'SCALAR' }],
    images: [
      { bufferView: 0, mimeType: 'image/jpeg' },
      { bufferView: 2, mimeType: 'image/png' },
    ],
    samplers: [{ magFilter: 9729, minFilter: 9987 }],
    textures: [
      { sampler: 0, source: 0 },
      { sampler: 0, source: 1 },
    ],
    materials: [
      {
        name: 'leaves',
        alphaMode: 'MASK',
        pbrMetallicRoughness: { baseColorTexture: { index: 1 } },
        normalTexture: { index: 0 },
      },
    ],
  };
  return writeGlbBytes(json, Uint8Array.from(bytes));
}

/** A stand-in encoder: a KTX2-shaped marker naming what it was asked for. */
const stand = (picture: Uint8Array, encoding: string): Uint8Array =>
  new TextEncoder().encode(`KTX2:${encoding}:${String(picture.byteLength)}:padding-to-move`);

describe('a GLB with its maps encoded as KTX2 — #618', () => {
  it('chooses a normal map’s encoding by its use, and a leaf card’s alpha by its PNG', () => {
    const { json, binary } = readGlbBytes(fixture());
    expect(embeddedImages(json, binary)).toEqual([
      { image: 0, bufferView: 0, mimeType: 'image/jpeg', encoding: 'normal' },
      { image: 1, bufferView: 2, mimeType: 'image/png', encoding: 'colour-alpha' },
    ]);
    expect(pngHasAlpha(PNG_RGBA)).toBe(true);
    expect(pngHasAlpha(PNG_RGB)).toBe(false);
  });

  it('replaces each image’s bytes, moves every later view, and leaves the accessor’s bytes as they were', () => {
    const { json, binary } = readGlbBytes(withKtx2Images(fixture(), stand));
    const text = (view: number): string => {
      const at = json.bufferViews?.[view];
      const start = at?.byteOffset ?? 0;
      return new TextDecoder().decode(binary.subarray(start, start + (at?.byteLength ?? 0)));
    };
    expect(text(0)).toBe('KTX2:normal:7:padding-to-move');
    expect(text(2)).toBe('KTX2:colour-alpha:33:padding-to-move');
    const accessor = json.bufferViews?.[1];
    expect([
      ...binary.subarray(accessor?.byteOffset ?? 0, (accessor?.byteOffset ?? 0) + 8),
    ]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const view of json.bufferViews ?? []) expect((view.byteOffset ?? 0) % 4).toBe(0);
    expect(json.buffers?.[0]?.byteLength).toBe(binary.byteLength);
  });

  it('names every image KTX2 and makes the extension REQUIRED, so no loader draws it untextured', () => {
    const { json } = readGlbBytes(withKtx2Images(fixture(), stand));
    expect(json.images?.map((image) => image.mimeType)).toEqual(['image/ktx2', 'image/ktx2']);
    expect(json.textures).toEqual([
      { sampler: 0, extensions: { [BASISU_EXTENSION]: { source: 0 } } },
      { sampler: 0, extensions: { [BASISU_EXTENSION]: { source: 1 } } },
    ]);
    expect(json.extensionsUsed).toEqual([BASISU_EXTENSION]);
    expect(json.extensionsRequired).toEqual([BASISU_EXTENSION]);
    // And everything else is carried across as it was parsed.
    expect(json.materials).toEqual(readGlbBytes(fixture()).json.materials);
    expect(json.samplers).toEqual([{ magFilter: 9729, minFilter: 9987 }]);
  });

  it('leaves a GLB with no images byte for byte as it was — a tree’s middle level, the rider', () => {
    const empty = writeGlbBytes({ asset: { version: '2.0' } }, new Uint8Array(0));
    expect(withKtx2Images(empty, stand)).toBe(empty);
  });

  it('refuses an image used as both a colour and a normal map, rather than guessing', () => {
    const { json, binary } = readGlbBytes(fixture());
    const both: GltfJson = {
      ...json,
      materials: [
        { pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, normalTexture: { index: 0 } },
        { pbrMetallicRoughness: { baseColorTexture: { index: 1 } } },
      ],
    };
    expect(() => embeddedImages(both, binary)).toThrow(/both a colour and a normal map/);
  });

  it('finds every committed GLB’s maps KTX2 under the required extension', () => {
    const glbs = readdirSync(SHIPPED).filter((file) => file.endsWith('.glb'));
    let withMaps = 0;
    for (const file of glbs) {
      const { json } = readGlbBytes(new Uint8Array(readFileSync(join(SHIPPED, file))));
      if ((json.images ?? []).length === 0) continue;
      withMaps += 1;
      expect(json.extensionsRequired, file).toContain(BASISU_EXTENSION);
      for (const image of json.images ?? []) expect(image.mimeType, file).toBe('image/ktx2');
      for (const texture of json.textures ?? []) {
        expect(texture.source, file).toBeUndefined();
        expect(texture.extensions?.[BASISU_EXTENSION], file).toBeDefined();
      }
    }
    expect(withMaps).toBe(7);
  });
});
