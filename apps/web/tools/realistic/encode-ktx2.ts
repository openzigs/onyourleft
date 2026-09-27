// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The KTX2 step of the realistic pipeline — #618, ADR 0026 D-8's 2026-09-27
 * amendment.
 *
 * Two things, both run by `process-assets.ts` and never by hand:
 *
 * - {@link encodeKtx2} runs the pinned `ktx create` (`sources.ts`
 *   §`PINNED_KTX`) over one picture with the arguments
 *   `sources.ts` §`ktxCreateArguments` gives its encoding;
 * - {@link withKtx2Images} rewrites a GLB Blender wrote so that every embedded
 *   map is KTX2 under `KHR_texture_basisu`, which three's `GLTFLoader` reads
 *   through the `KTX2Loader` it is handed. Blender's glTF exporter writes JPEG
 *   and PNG only, so this is the step that does what it cannot.
 *
 * ## Why the GLB is rewritten rather than re-exported
 *
 * The Blender step is UNCHANGED by #618 and still writes, into the pipeline's
 * scratch directory, the very GLB that was committed before — byte for byte,
 * `--check` measured it. So what this rewrites is a file whose reproducibility
 * is already established, and the only thing it changes is the images: the
 * JSON's meshes, accessors, nodes and materials are carried across as parsed,
 * every buffer view keeps its index, and only an image's view gets new bytes.
 *
 * ⚠️ **Pure but for {@link encodeKtx2}**, so `encode-ktx2.test.ts` holds the
 * rewrite against hand-built GLBs with a stand-in encoder.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ktxCreateArguments,
  PINNED_KTX_VERSION_LINE,
  type Ktx2Step,
  type TextureEncoding,
} from './sources';

// An empty KTX (as `.env.example` leaves it) means unset, not "run nothing".
const KTX_FROM_ENV = process.env.KTX;
/** The `ktx` binary the pipeline runs: `KTX`, or `ktx` on the `PATH`. */
export const KTX = KTX_FROM_ENV !== undefined && KTX_FROM_ENV !== '' ? KTX_FROM_ENV : 'ktx';

/** What `ktx --version` prints, or throws when it cannot be run. */
export function ktxVersion(): string {
  const run = spawnSync(KTX, ['--version'], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`${KTX} --version failed; set KTX to KTX-Software's ktx`);
  return run.stdout.split('\n')[0]?.trim() ?? '';
}

/** Refuses any `ktx` but the pinned one. @see PINNED_KTX_VERSION_LINE */
export function requirePinnedKtx(): void {
  const version = ktxVersion();
  if (version !== PINNED_KTX_VERSION_LINE) {
    throw new Error(
      `${KTX} is "${version}"; the pipeline is pinned to "${PINNED_KTX_VERSION_LINE}"`,
    );
  }
}

/** Encodes one picture file as a KTX2 file. */
export function encodeKtx2(step: Ktx2Step, input: string, output: string): void {
  const run = spawnSync(KTX, [...ktxCreateArguments(step, input, output)], { encoding: 'utf8' });
  if (run.status !== 0) {
    throw new Error(`ktx create ${input} failed:\n${(run.stdout + run.stderr).slice(-4000)}`);
  }
}

/** Encodes picture bytes, through a scratch directory, and returns the KTX2 bytes. */
export function encodeKtx2Bytes(
  step: Ktx2Step,
  picture: Uint8Array,
  extension: string,
): Uint8Array {
  const scratch = mkdtempSync(join(tmpdir(), 'oyl-ktx2-'));
  try {
    const input = join(scratch, `picture.${extension}`);
    const output = join(scratch, 'picture.ktx2');
    writeFileSync(input, picture);
    encodeKtx2(step, input, output);
    return new Uint8Array(readFileSync(output));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/* ============================================================================
 * The GLB rewrite — pure
 * ========================================================================== */

/** The extension a glTF names a KTX2 image by. */
export const BASISU_EXTENSION = 'KHR_texture_basisu';

const GLB_MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"
const BIN_CHUNK = 0x004e4942; // "BIN\0"

/** A GLB, split: its JSON as parsed, and its one binary chunk. */
export interface Glb {
  readonly json: GltfJson;
  readonly binary: Uint8Array;
}

/** The part of a glTF's JSON the rewrite reads and writes. */
export interface GltfJson {
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  buffers?: { byteLength: number; uri?: string }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  images?: { bufferView?: number; mimeType?: string; uri?: string; name?: string }[];
  textures?: {
    source?: number;
    sampler?: number;
    name?: string;
    extensions?: Record<string, unknown>;
  }[];
  materials?: {
    name?: string;
    alphaMode?: string;
    pbrMetallicRoughness?: { baseColorTexture?: { index: number } };
    normalTexture?: { index: number };
  }[];
  [key: string]: unknown;
}

/** Splits a GLB into its JSON and its binary chunk. Refuses anything else. */
export function readGlbBytes(bytes: Uint8Array): Glb {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) {
    throw new Error('not a glTF 2.0 binary');
  }
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK) throw new Error('GLB: the first chunk is not JSON');
  const json = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)),
  ) as GltfJson;
  const at = 20 + jsonLength;
  if (at >= bytes.byteLength) return { json, binary: new Uint8Array(0) };
  const binaryLength = view.getUint32(at, true);
  if (view.getUint32(at + 4, true) !== BIN_CHUNK)
    throw new Error('GLB: the second chunk is not BIN');
  return { json, binary: bytes.subarray(at + 8, at + 8 + binaryLength) };
}

const padded = (length: number): number => Math.ceil(length / 4) * 4;

/** Writes a GLB: the JSON chunk padded with spaces, the binary chunk with zeros (glTF 2.0 §4.4). */
export function writeGlbBytes(json: GltfJson, binary: Uint8Array): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = padded(text.byteLength);
  const binaryLength = padded(binary.byteLength);
  const total = 12 + 8 + jsonLength + (binary.byteLength > 0 ? 8 + binaryLength : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, JSON_CHUNK, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(text, 20);
  if (binary.byteLength > 0) {
    const at = 20 + jsonLength;
    view.setUint32(at, binaryLength, true);
    view.setUint32(at + 4, BIN_CHUNK, true);
    out.set(binary, at + 8);
  }
  return out;
}

/** Whether a PNG carries an alpha channel: colour type 4 or 6, or a `tRNS` chunk. */
export function pngHasAlpha(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, index) => bytes[index] === byte)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const colourType = bytes[25] ?? 0;
  if (colourType === 4 || colourType === 6) return true;
  let at = 8;
  while (at + 8 <= bytes.byteLength) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === 'tRNS') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    at += 12 + length;
  }
  return false;
}

/** One embedded image of a GLB, and what the materials use it for. */
export interface EmbeddedImage {
  readonly image: number;
  readonly bufferView: number;
  readonly mimeType: string;
  /** How it is encoded: a normal map, or a colour map with or without alpha. */
  readonly encoding: TextureEncoding;
}

/**
 * Every embedded image and its encoding. An image used as a normal map is
 * `normal`; any other is a colour map, `colour-alpha` when it is a PNG that
 * carries alpha — a leaf card's cut-out — and `colour` otherwise.
 *
 * Refuses an image both roles use, or one no material uses: either would make
 * the choice of encoding a guess.
 */
export function embeddedImages(json: GltfJson, binary: Uint8Array): readonly EmbeddedImage[] {
  const roles = new Map<number, Set<'colour' | 'normal'>>();
  const use = (textureIndex: number | undefined, role: 'colour' | 'normal'): void => {
    if (textureIndex === undefined) return;
    const source = json.textures?.[textureIndex]?.source;
    if (source === undefined) throw new Error(`texture ${String(textureIndex)} names no source`);
    const set = roles.get(source) ?? new Set();
    set.add(role);
    roles.set(source, set);
  };
  for (const material of json.materials ?? []) {
    use(material.pbrMetallicRoughness?.baseColorTexture?.index, 'colour');
    use(material.normalTexture?.index, 'normal');
  }
  return (json.images ?? []).map((image, index) => {
    const role = roles.get(index);
    if (role === undefined || role.size !== 1) {
      throw new Error(
        `image ${String(index)} is used as ${role === undefined ? 'nothing' : 'both a colour and a normal map'}`,
      );
    }
    if (image.bufferView === undefined) throw new Error(`image ${String(index)} is not embedded`);
    const view = json.bufferViews?.[image.bufferView];
    if (view === undefined) throw new Error(`image ${String(index)} names no buffer view`);
    const start = view.byteOffset ?? 0;
    const bytes = binary.subarray(start, start + view.byteLength);
    const mimeType = image.mimeType ?? '';
    const encoding: TextureEncoding = role.has('normal')
      ? 'normal'
      : mimeType === 'image/png' && pngHasAlpha(bytes)
        ? 'colour-alpha'
        : 'colour';
    return { image: index, bufferView: image.bufferView, mimeType, encoding };
  });
}

/** Encodes one embedded picture: its bytes, its encoding and its MIME type. */
export type ImageEncoder = (
  picture: Uint8Array,
  encoding: TextureEncoding,
  mimeType: string,
) => Uint8Array;

/**
 * A GLB with every embedded image encoded as KTX2, or the same bytes when it
 * embeds none.
 *
 * - each image keeps its buffer view, whose bytes become the KTX2 file, and
 *   its `mimeType` becomes `image/ktx2`;
 * - each texture's `source` moves into `extensions.KHR_texture_basisu.source`,
 *   and the extension is REQUIRED, so a loader that cannot read KTX2 refuses
 *   the file rather than drawing it untextured;
 * - every buffer view is laid out again in index order, 4-byte aligned, so an
 *   accessor's own offset inside its view is untouched.
 *
 * ⚠️ **Origin `top-left`**: a glTF's maps are read unflipped, so they are
 * encoded as they are. @see TextureOrigin
 */
export function withKtx2Images(bytes: Uint8Array, encode: ImageEncoder): Uint8Array {
  const { json, binary } = readGlbBytes(bytes);
  const images = embeddedImages(json, binary);
  if (images.length === 0) return bytes;
  const replaced = new Map<number, Uint8Array>();
  for (const image of images) {
    const view = json.bufferViews?.[image.bufferView];
    if (view === undefined) throw new Error('unreachable: a checked view is gone');
    const start = view.byteOffset ?? 0;
    replaced.set(
      image.bufferView,
      encode(binary.subarray(start, start + view.byteLength), image.encoding, image.mimeType),
    );
  }
  const views = json.bufferViews ?? [];
  const pieces: Uint8Array[] = [];
  let offset = 0;
  const laidOut = views.map((view, index) => {
    if (view.buffer !== 0) throw new Error('a buffer view outside the GLB’s own buffer');
    const start = view.byteOffset ?? 0;
    const content = replaced.get(index) ?? binary.subarray(start, start + view.byteLength);
    const at = offset;
    pieces.push(content);
    const next = padded(at + content.byteLength);
    if (next > at + content.byteLength) pieces.push(new Uint8Array(next - at - content.byteLength));
    offset = next;
    return { ...view, byteOffset: at, byteLength: content.byteLength };
  });
  const joined = new Uint8Array(offset);
  let at = 0;
  for (const piece of pieces) {
    joined.set(piece, at);
    at += piece.byteLength;
  }
  const rewritten: GltfJson = {
    ...json,
    buffers: (json.buffers ?? []).map((buffer, index) =>
      index === 0 ? { ...buffer, byteLength: joined.byteLength } : buffer,
    ),
    bufferViews: laidOut,
    images: (json.images ?? []).map((image) => ({ ...image, mimeType: 'image/ktx2' })),
    textures: (json.textures ?? []).map((texture) => {
      const { source, ...rest } = texture;
      return {
        ...rest,
        extensions: { ...(texture.extensions ?? {}), [BASISU_EXTENSION]: { source } },
      };
    }),
    extensionsUsed: [...new Set([...(json.extensionsUsed ?? []), BASISU_EXTENSION])],
    extensionsRequired: [...new Set([...(json.extensionsRequired ?? []), BASISU_EXTENSION])],
  };
  return writeGlbBytes(rewritten, joined);
}

/** The encoder the pipeline hands {@link withKtx2Images}: the pinned `ktx`, top-left. */
export const pinnedImageEncoder: ImageEncoder = (picture, encoding, mimeType) =>
  encodeKtx2Bytes(
    { encoding, origin: 'top-left' },
    picture,
    mimeType === 'image/png' ? 'png' : 'jpg',
  );
