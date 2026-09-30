// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The realistic world's textures stay compressed on the GPU — #618, ADR 0026
 * D-8's 2026-09-27 amendment.
 *
 * Until #618 every realistic texture was a JPEG or PNG that three decoded to
 * RGBA8 on upload: 136 MiB by `realistic-budget.ts`' own estimate, 310 MiB
 * under the tablet's `GL mtrack` (validation 0002 Part Z8), where Godot held
 * the same files ETC2-compressed in 81.0 MiB (spike 0015 §4). Now every one is
 * KTX2, and this drives the WHOLE load — `loadRealisticWorld` through
 * `compressedRealisticLoaders`, the real `KTX2Loader` and `GLTFLoader`, the
 * real transcoder `.wasm`, every committed file — and reads back what each
 * texture a material wears was handed to the GPU as.
 *
 * ## ⚠️ The control is the same load on a device that offers nothing
 *
 * A device that reports neither `WEBGL_compressed_texture_astc` nor
 * `WEBGL_compressed_texture_etc` (nor anything else) gets the loader's
 * uncompressed target, RGBA8, and {@link everyTextureCompressed} must be
 * FALSE for it. Without that, "every texture is compressed" could be true of a
 * report that labelled everything compressed.
 *
 * What this cannot see is a real GPU's upload: `game.browser.spec.ts`
 * §"the realistic world" reads that back off a live context.
 *
 * ⚠️ **No `three` is imported here**, for `three-seam.test.ts`: the formats
 * are read through `three-renderer.ts` §`realisticTextureReport`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KIT_COLOURS } from '@onyourleft/store';

import { TRANSCODER_FILES, transcoderSource } from '../../tools/basis/transcoder-plugin';

import { KIT_PALETTE, PACER_KIT, type RiderKit } from './bicycle';
import {
  albedoBytes,
  toldApartFaults,
  toldApartFigures,
  type Bytes,
  type ThreeJerseys,
} from './kit-palette-testing';
import {
  PHOTOGRAPHIC_STRUCTURE_SURFACES,
  REALISTIC_BICYCLE_MAP_NAMES,
  REALISTIC_RIDER_KIT_MEAN,
  REALISTIC_RIDER_MAP_NAMES,
  REALISTIC_RIDER_MAPS,
  REALISTIC_VEGETATION,
  REALISTIC_VEGETATION_KINDS,
} from './realistic-assets';
import { modelFacts } from './realistic-bytes-testing';

/* ============================================================================
 * Running three's `KTX2Loader` under Vitest, for real
 *
 * The loader transcodes in a Web Worker it builds from a `Blob` of source: its
 * own worker function with Binomial's `basis_transcoder.js` pasted in, handed
 * the `.wasm` bytes in its first message. Node has no global `Worker`, so this
 * supplies one that runs that same source IN THIS THREAD — the real
 * transcoder, the real `.wasm`, the real choice of target format — with the
 * messages a worker would send delivered asynchronously, as a worker's are.
 * Nothing is mocked but the thread, `fetch` for the committed files, and the
 * two globals Node lacks (`self`, `ProgressEvent`).
 *
 * ⚠️ **In this test file rather than a `-testing.ts` module**, because it has
 * to name `fetch`, `Request` and `Response`, and `no-network.test.ts` and
 * `analysis-boundary.test.ts` rightly count those in any module but a test.
 *
 * ⚠️ **The worker's source is run with Node's globals masked** (`process`,
 * `require`, `module`, `__filename`), so the Emscripten wrapper takes its
 * worker branch, as it does in a browser, rather than its Node one.
 * ========================================================================== */

type Listener = (event: { readonly data: unknown }) => void;

/** A `Worker` that runs its script in this thread. */
class InProcessWorker {
  readonly #fromWorker = new Set<Listener>();
  readonly #toWorker = new Set<Listener>();
  readonly #ready: Promise<void>;
  #terminated = false;

  constructor(url: string | URL) {
    this.#ready = fetch(String(url))
      .then((response) => response.text())
      .then((source) => {
        const scope = {
          location: { href: 'http://oyl.test/worker.js' },
          addEventListener: (type: string, listener: Listener) => {
            if (type === 'message') this.#toWorker.add(listener);
          },
          postMessage: (data: unknown) => {
            setTimeout(() => {
              if (this.#terminated) return;
              for (const listener of this.#fromWorker) listener({ data });
            }, 0);
          },
        };
        // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the worker's own source, as a Worker would run it
        const run = new Function(
          'self',
          'importScripts',
          'process',
          'require',
          'module',
          'exports',
          '__filename',
          '__dirname',
          source,
        ) as (...args: unknown[]) => void;
        run(scope, () => undefined);
      });
  }

  addEventListener(type: string, listener: Listener): void {
    if (type === 'message') this.#fromWorker.add(listener);
  }

  postMessage(data: unknown): void {
    void this.#ready.then(() => {
      for (const listener of this.#toWorker) listener({ data });
    });
  }

  terminate(): void {
    this.#terminated = true;
  }
}

/**
 * Installs {@link InProcessWorker} as the global `Worker`, and returns the undo
 * — with `self` as the global too, where it is absent, because `GLTFLoader`
 * reads `self.URL` on the main thread to make a GLB's embedded map a `blob:`.
 */
function inProcessWorkers(): () => void {
  const global = globalThis as { Worker?: unknown; self?: unknown };
  const previous = global.Worker;
  const hadSelf = 'self' in globalThis;
  global.Worker = InProcessWorker;
  if (!hadSelf) global.self = globalThis;
  return () => {
    global.Worker = previous;
    if (!hadSelf) delete global.self;
  };
}

/** The `ProgressEvent` three's `FileLoader` reports a streamed download with, which Node lacks. */
class NodeProgressEvent extends Event {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
  constructor(
    type: string,
    init: { lengthComputable?: boolean; loaded?: number; total?: number } = {},
  ) {
    super(type);
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
}

/**
 * A `fetch` that answers `origin`-prefixed URLs from `read` and passes every
 * other — the `blob:` URLs three makes for a GLB's embedded maps and for the
 * worker's source — to Node's own. Returns the undo.
 */
function servedFrom(origin: string, read: (path: string) => Uint8Array): () => void {
  const hadProgress = 'ProgressEvent' in globalThis;
  if (!hadProgress) (globalThis as { ProgressEvent?: unknown }).ProgressEvent = NodeProgressEvent;
  const real = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(origin)) return real(input, init);
    const bytes = read(url.slice(origin.length));
    return new Response(new Uint8Array(bytes), { status: 200 });
  };
  return () => {
    globalThis.fetch = real;
    if (!hadProgress) delete (globalThis as { ProgressEvent?: unknown }).ProgressEvent;
  };
}

const ORIGIN = 'http://oyl.test';
const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const WEB = fileURLToPath(new URL('../../', import.meta.url));

/** What a device offers, as `KTX2Loader.detectSupport` asks. */
function device(offered: readonly string[]): {
  has(name: string): boolean;
  get(name: string): unknown;
} {
  return {
    has: (name) => offered.includes(name),
    get: (name) =>
      name === 'WEBGL_compressed_texture_astc' && offered.includes(name)
        ? { getSupportedProfiles: () => ['ldr'] }
        : null,
  };
}

/** The owner's tablet, as far as a KTX2 texture is concerned. */
const TABLET = ['WEBGL_compressed_texture_astc', 'WEBGL_compressed_texture_etc'];
/** A desktop that offers only the BC formats — SwiftShader on Linux, after `KTX2Loader`'s own Linux rule. */
const DESKTOP = ['EXT_texture_compression_bptc', 'WEBGL_compressed_texture_s3tc'];

type Renderer = typeof import('./three-renderer');

/** A fresh renderer module — the world is module state — and the whole world loaded on `offered`. */
async function loadedOn(offered: readonly string[]): Promise<Renderer> {
  vi.resetModules();
  const renderer = await import('./three-renderer');
  const inner = renderer.compressedRealisticLoaders(device(offered), `${ORIGIN}/basis/`);
  const at = (url: string): string => `${ORIGIN}${url}`;
  const outcome = await renderer.loadRealisticWorld({
    model: (url) => inner.model(at(url)),
    texture: (url) => inner.texture(at(url)),
    sky: (url) => inner.sky(at(url)),
    dispose: inner.dispose,
  });
  expect(outcome).toEqual({ loaded: true });
  return renderer;
}

/** The claim #618 makes: every texture a realistic material wears is a GPU block format. */
function everyTextureCompressed(report: ReturnType<Renderer['realisticTextureReport']>): boolean {
  const worn = report.filter((texture) => texture.role !== 'sky');
  return worn.length > 0 && worn.every((texture) => texture.compressed);
}

/** The bytes a block-compressed chain of a size is, level by level, at `blockBytes` a 4×4 block. */
function chainBytes(width: number, height: number, blockBytes: number): number {
  let total = 0;
  for (let w = width, h = height; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
    total += Math.ceil(w / 4) * Math.ceil(h / 4) * blockBytes;
    if (w === 1 && h === 1) return total;
  }
}

/** The bytes an uncompressed RGBA8 chain of a size is. */
function rgbaChainBytes(width: number, height: number): number {
  let total = 0;
  for (let w = width, h = height; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
    total += w * h * 4;
    if (w === 1 && h === 1) return total;
  }
}

let undo: (() => void)[] = [];

beforeEach(() => {
  undo = [
    inProcessWorkers(),
    servedFrom(ORIGIN, (path) => {
      const transcoder = TRANSCODER_FILES.find((each) => path === `/basis/${each}`);
      const file =
        transcoder === undefined ? join(PUBLIC, path) : transcoderSource(WEB, transcoder);
      return new Uint8Array(readFileSync(file));
    }),
  ];
});

afterEach(() => {
  for (const each of undo.reverse()) each();
});

describe('the realistic textures stay compressed on the GPU — #618', () => {
  it('hands every texture a material wears to the tablet as ASTC or ETC2, never RGBA8', async () => {
    const renderer = await loadedOn(TABLET);
    const report = renderer.realisticTextureReport();
    const worn = report.filter((texture) => texture.role !== 'sky');
    // Non-vacuity: the whole set — four surface maps, fourteen structure maps,
    // the bicycle's four (#624), four impostors and every map inside a tree,
    // shrub and rock — ONCE PER IMAGE, read off the committed files: a fir's
    // live and dead branches are two textures over one image, which three
    // uploads once.
    const images =
      4 +
      2 * PHOTOGRAPHIC_STRUCTURE_SURFACES.length +
      REALISTIC_BICYCLE_MAP_NAMES.length +
      REALISTIC_RIDER_MAP_NAMES.length +
      REALISTIC_VEGETATION_KINDS.flatMap((kind) => REALISTIC_VEGETATION[kind]).reduce(
        (sum, model) =>
          sum +
          modelFacts(join(PUBLIC, 'realistic', model.file)).images.length +
          (model.impostor === undefined ? 0 : 1),
        0,
      );
    expect(worn.length).toBeGreaterThanOrEqual(40);
    expect(worn.length).toBe(images);
    expect(new Set(worn.map((texture) => texture.role))).toEqual(
      new Set(['road', 'ground', 'structure', 'model', 'impostor', 'bicycle', 'rider']),
    );
    expect(everyTextureCompressed(report)).toBe(true);
    for (const texture of worn) {
      expect(['ASTC 4x4', 'ETC2 RGB', 'ETC2 RGBA'], JSON.stringify(texture)).toContain(
        texture.format,
      );
    }
    // Which format each is: an impostor is a cut-out, ETC2 with its alpha; the
    // road's and ground's normal maps are UASTC, so ASTC; their colour, ETC2.
    for (const texture of worn.filter((each) => each.role === 'impostor')) {
      expect(texture.format).toBe('ETC2 RGBA');
    }
    // #624: the bicycle's maps are all data a shader reads raw — two normal
    // maps and two roughness maps — so all four are UASTC, so ASTC, and small.
    const bicycle = worn.filter((each) => each.role === 'bicycle');
    expect(bicycle).toHaveLength(REALISTIC_BICYCLE_MAP_NAMES.length);
    for (const texture of bicycle) {
      expect(texture.format, JSON.stringify(texture)).toBe('ASTC 4x4');
      expect(texture.width, JSON.stringify(texture)).toBeLessThanOrEqual(256);
    }
    // #623: the rider's kit is colour, so ETC2; its relief and its
    // occlusion/roughness/mask are data a shader reads raw, so ASTC.
    const rider = worn.filter((each) => each.role === 'rider');
    expect(rider.map((each) => each.format).sort()).toEqual(['ASTC 4x4', 'ASTC 4x4', 'ETC2 RGB']);
    const counts = new Map<string, number>();
    for (const texture of worn) counts.set(texture.format, (counts.get(texture.format) ?? 0) + 1);
    expect(counts.get('ASTC 4x4')).toBeGreaterThan(10);
    expect(counts.get('ETC2 RGB')).toBeGreaterThan(10);
    // The bytes are the block formats' own: a byte a texel for ASTC 4×4 and
    // ETC2 RGBA, half that for ETC2 RGB — every level of the chain, which the
    // pipeline made because three cannot make one for a compressed texture.
    for (const texture of worn) {
      const blockBytes = texture.format === 'ETC2 RGB' ? 8 : 16;
      expect(texture.bytes, JSON.stringify(texture)).toBe(
        chainBytes(texture.width, texture.height, blockBytes),
      );
    }
    // The sky is out of #618's scope: half-float, for PMREMGenerator.
    expect(report.filter((texture) => texture.role === 'sky')).toEqual([
      expect.objectContaining({ format: 'half-float', compressed: false }),
    ]);
    const total = worn.reduce((sum, texture) => sum + texture.bytes, 0);
    console.log(
      `#618: ${String(worn.length)} realistic textures, ${(total / 2 ** 20).toFixed(1)} MiB on the tablet's formats — ` +
        [...counts].map(([format, count]) => `${String(count)} ${format}`).join(', '),
    );
  }, 120_000);

  it('CONTROL: on a device that offers no compressed format, falls back to RGBA8 and says so', async () => {
    const renderer = await loadedOn([]);
    const report = renderer.realisticTextureReport();
    const worn = report.filter((texture) => texture.role !== 'sky');
    expect(worn.length).toBeGreaterThanOrEqual(40);
    // The claim above must be FALSE here, or it is a claim about labels.
    expect(everyTextureCompressed(report)).toBe(false);
    for (const texture of worn) {
      expect(texture.format).toBe('RGBA8 (fallback)');
      expect(texture.compressed).toBe(false);
      expect(texture.bytes, JSON.stringify(texture)).toBe(
        rgbaChainBytes(texture.width, texture.height),
      );
    }
  }, 120_000);

  it('releases the transcoder’s workers once a load has settled, loaded or not', async () => {
    vi.resetModules();
    const renderer = await import('./three-renderer');
    const released = vi.fn();
    const failing = (): Promise<never> => Promise.reject(new Error('Failed to fetch'));
    await renderer.loadRealisticWorld({
      model: failing,
      texture: failing,
      sky: failing,
      dispose: released,
    });
    expect(released).toHaveBeenCalledTimes(1);
    const inner = renderer.compressedRealisticLoaders(device(TABLET), `${ORIGIN}/basis/`);
    const dispose = vi.fn(inner.dispose);
    const at = (url: string): string => `${ORIGIN}${url}`;
    await expect(
      renderer.loadRealisticWorld({
        model: (url) => inner.model(at(url)),
        texture: (url) => inner.texture(at(url)),
        sky: (url) => inner.sky(at(url)),
        dispose,
      }),
    ).resolves.toEqual({ loaded: true });
    expect(dispose).toHaveBeenCalledTimes(1);
  }, 120_000);

  it('on a desktop that offers only the BC formats, is compressed but neither ASTC nor ETC2', async () => {
    // What the browser gate sees on CI: SwiftShader on Linux offers ASTC and
    // ETC as well, and `KTX2Loader.detectSupport` turns both off there, on
    // Linux outside Android, because a desktop driver decodes them in software.
    const renderer = await loadedOn(DESKTOP);
    const report = renderer.realisticTextureReport();
    expect(everyTextureCompressed(report)).toBe(true);
    for (const texture of report.filter((each) => each.role !== 'sky')) {
      expect(texture.format).toBe('BC7');
    }
  }, 120_000);
});

/* ============================================================================
 * The dressed rider — #623
 * ========================================================================== */

/** A committed rider map decoded to RGBA8, top row first, through the real loader. */
async function decodedRiderMap(
  renderer: Renderer,
  map: keyof typeof REALISTIC_RIDER_MAPS,
): Promise<{ readonly size: number; readonly texels: Uint8Array }> {
  const inner = renderer.compressedRealisticLoaders(device([]), `${ORIGIN}/basis/`);
  try {
    const texture = await inner.texture(`${ORIGIN}/realistic/${REALISTIC_RIDER_MAPS[map]}`);
    const level = (texture as unknown as { mipmaps: { data: Uint8Array; width: number }[] })
      .mipmaps[0];
    if (level === undefined) throw new Error(`${map} has no level 0`);
    return { size: level.width, texels: level.data };
  } finally {
    inner.dispose?.();
  }
}

/**
 * How far the normals in a 7 × 7 window turn from their own mean, in degrees
 * — the relief a crease draws, with the body's own curvature (which the mean
 * absorbs) left out.
 */
function reliefAround(
  map: { readonly size: number; readonly texels: Uint8Array },
  column: number,
  row: number,
): number {
  const normals: [number, number, number][] = [];
  for (let dy = -3; dy <= 3; dy += 1) {
    for (let dx = -3; dx <= 3; dx += 1) {
      const at = ((row + dy) * map.size + column + dx) * 4;
      const n: [number, number, number] = [0, 1, 2].map(
        (channel) => ((map.texels[at + channel] ?? 0) / 255) * 2 - 1,
      ) as [number, number, number];
      const length = Math.hypot(...n);
      normals.push([n[0] / length, n[1] / length, n[2] / length]);
    }
  }
  const mean = [0, 1, 2].map((c) => normals.reduce((sum, n) => sum + n[c]!, 0));
  const meanLength = Math.hypot(...mean);
  const degrees = normals.map((n) => {
    const cosine = (n[0] * mean[0]! + n[1] * mean[1]! + n[2] * mean[2]!) / meanLength;
    return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
  });
  return degrees.reduce((sum, value) => sum + value, 0) / degrees.length;
}

/**
 * Where the crease and the flat panel are in the committed normal map, as
 * `process_rider.py` reports them (`creaseTexel`, `flatTexel`): the back of
 * the left knee, and the outside of the left thigh half-way down the shorts.
 * Column, then row from the TOP. They move only when the mesh's texture
 * coordinates do, and the run prints them.
 */
const CREASE_TEXEL = [608, 722] as const;
const FLAT_TEXEL = [545, 616] as const;
/**
 * The least the folds must turn the normals at the crease, in degrees — and
 * the most anything may at the flat panel. Measured on 2026-09-28: the crease
 * at about 7.0° and the flat panel under 0.5°.
 */
const CREASE_RELIEF_FLOOR_DEGREES = 3;

describe('the dressed rider — #623', () => {
  it('draws folds at a crease of the riding pose, and none on a flat panel — the baked normal map', async () => {
    const renderer = await loadedOn([]);
    const normal = await decodedRiderMap(renderer, 'normal');
    expect(normal.size).toBe(1024);
    const crease = reliefAround(normal, CREASE_TEXEL[0], CREASE_TEXEL[1]);
    const flat = reliefAround(normal, FLAT_TEXEL[0], FLAT_TEXEL[1]);
    // THE CONTROL: a flat normal map, every texel facing straight out, under
    // the same measure.
    const flatMap = {
      size: 1024,
      texels: new Uint8Array(1024 * 1024 * 4).map((_, at) => [128, 128, 255, 255][at % 4]!),
    };
    const control = reliefAround(flatMap, CREASE_TEXEL[0], CREASE_TEXEL[1]);
    console.log(
      `#623: relief at the back of the knee ${crease.toFixed(2)}°, on the thigh ${flat.toFixed(2)}°, ` +
        `a flat map ${control.toFixed(2)}°, against a floor of ${String(CREASE_RELIEF_FLOOR_DEGREES)}°`,
    );
    expect(crease).toBeGreaterThan(CREASE_RELIEF_FLOOR_DEGREES);
    expect(flat).toBeLessThan(CREASE_RELIEF_FLOOR_DEGREES);
    expect(control).toBeLessThan(CREASE_RELIEF_FLOOR_DEGREES);
  }, 120_000);

  it('states the kit’s own mean colour, which the browser gate’s control draws, as the maps carry it', async () => {
    const renderer = await loadedOn([]);
    const colour = await decodedRiderMap(renderer, 'colour');
    const orm = await decodedRiderMap(renderer, 'orm');
    const linear = (byte: number): number => {
      const c = byte / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const unmasked = [0, 0, 0];
    let shade = 0;
    const texels = colour.size * colour.size;
    for (let at = 0; at < texels; at += 1) {
      for (const channel of [0, 1, 2]) {
        unmasked[channel]! += linear(colour.texels[at * 4 + channel] ?? 0);
      }
      // The main colour's share is data, linear, never sRGB.
      shade += (orm.texels[at * 4 + 2] ?? 0) / 255;
    }
    // ETC1S and UASTC are lossy, so within a hundredth.
    unmasked.forEach((sum, channel) =>
      expect(sum / texels).toBeCloseTo(REALISTIC_RIDER_KIT_MEAN.unmasked[channel]!, 2),
    );
    expect(shade / texels).toBeCloseTo(REALISTIC_RIDER_KIT_MEAN.shade, 2);
    // Non-vacuity: the kit is a real share of the map, and so is what is not.
    expect(REALISTIC_RIDER_KIT_MEAN.shade).toBeGreaterThan(0.05);
  }, 120_000);

  it('dresses three riders in constructed materials, the kit on each body and the helmet one instanced mesh — D-11', async () => {
    const renderer = await loadedOn(TABLET);
    const riders = renderer.realisticRidersOfLoadedWorld();
    if (riders === undefined) throw new Error('no world');
    const bodies = riders.bodies;
    expect(bodies).toHaveLength(3);
    let meshes = 0;
    riders.group.traverse((node) => {
      const mesh = node as unknown as { isMesh?: boolean; material?: unknown; name: string };
      if (mesh.isMesh !== true) return;
      meshes += 1;
      expect(renderer.isConstructedMaterial(mesh.material as never), mesh.name).toBe(true);
      expect((mesh.material as { type: string }).type, mesh.name).toBe('MeshStandardMaterial');
      // The file's own helmet is not drawn a second time beside the instanced one.
      expect(mesh.name === 'helmet' && node !== (riders.helmets as unknown), mesh.name).toBe(false);
    });
    // Three bodies, and the frame, rubber, metal, cranks and helmets: eight draws, as before.
    expect(meshes).toBe(8);
    for (const body of bodies) {
      const material = body.material as unknown as Record<string, unknown>;
      expect(material['map']).toBeTruthy();
      expect(material['normalMap']).toBeTruthy();
      // One map that is both the occlusion and the roughness, in three's own order.
      expect(material['aoMap']).toBe(material['roughnessMap']);
      expect(material['roughness']).toBe(1);
      expect(material['vertexColors']).toBe(false);
    }
    // Each body has its own kit colour (#623 keeping #368), the rider's the
    // app's accent until a frame says otherwise.
    expect(new Set(riders.kitColours).size).toBe(riders.bodies.length);
    for (const kit of riders.kitColours) expect(kit.getHexString()).toBe('0b5c55');
    // The helmet and glasses are coloured per vertex, and tinted per instance.
    const helmet = riders.helmets;
    expect(helmet.geometry.getAttribute('color')).toBeDefined();
    expect((helmet.material as unknown as { vertexColors: boolean }).vertexColors).toBe(true);
  }, 120_000);

  it('holds the body, the helmet and the glasses together inside the rider’s 9 000 triangles', async () => {
    const renderer = await loadedOn(TABLET);
    const riders = renderer.realisticRidersOfLoadedWorld();
    if (riders === undefined) throw new Error('no world');
    const trianglesOf = (geometry: {
      index: { count: number } | null;
      getAttribute: (name: 'position') => { count: number };
    }): number => (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
    const body = trianglesOf(riders.bodies[0]!.geometry);
    const helmet = trianglesOf(riders.helmets.geometry);
    console.log(`#623: the rider is ${String(body)} body and ${String(helmet)} helmet and glasses`);
    // A modelled helmet with vents and straps, and two lenses: more than a cap.
    expect(helmet).toBeGreaterThan(200);
    expect(body + helmet).toBeLessThanOrEqual(9_000);
    // The frame's worst case counted 8 998 a rider before #623: no rise.
    expect(body + helmet).toBeLessThanOrEqual(8_998);
  }, 120_000);

  it('still tells the three riders apart by their tints on the jersey, #368’s measure — and not with the tints taken away', async () => {
    const renderer = await loadedOn(TABLET);
    const riders = renderer.realisticRidersOfLoadedWorld();
    if (riders === undefined) throw new Error('no world');
    const at = { x: 0, y: 0, z: 0, headingX: 0, headingZ: 1, lean: 0, bodyLean: 0, crankAngle: 0 };
    riders.place([
      { ...at, kind: 'rider' },
      { ...at, kind: 'bot' },
      { ...at, kind: 'ghost' },
    ] as never);
    // The jersey's albedo on each: its tint times the kit ITS KIND wears, as
    // the shader multiplies them, in sRGB bytes.
    // (`getHex` answers in sRGB; the product is taken in linear, as the
    // shader takes it.)
    type Colour = (typeof riders.kitColours)[number];
    const colourOf = (body: (typeof riders.bodies)[number]): Colour =>
      (body.material as unknown as { color: Colour }).color;
    const jersey = riders.bodies.map((body, slot) => {
      const hex = colourOf(body)
        .clone()
        .multiply(riders.kitColours[slot] as Colour)
        .getHex();
      return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
    });
    const apart = (a: readonly number[], b: readonly number[]): number =>
      Math.max(...[0, 1, 2].map((c) => Math.abs((a[c] ?? 0) - (b[c] ?? 0))));
    console.log(`#623: the jersey as the rider, the bot and the ghost — ${JSON.stringify(jersey)}`);
    const [rider, bot, ghost] = jersey as [number[], number[], number[]];
    // #368's hues, which a multiplier over the teal lost (#742's review: the
    // bot's jersey was [6,17,1]): the pacer's RED leads its green, and the
    // ghost's BLUE leads its green.
    expect(bot[0]! - bot[1]!).toBeGreaterThan(5);
    expect(ghost[2]! - ghost[1]!).toBeGreaterThan(8);
    expect(apart(rider, bot)).toBeGreaterThan(30);
    expect(apart(rider, ghost)).toBeGreaterThan(30);
    expect(apart(bot, ghost)).toBeGreaterThan(30);
    // THE CONTROL: three riders of one kind, the same tint, are one colour.
    riders.place([
      { ...at, kind: 'rider' },
      { ...at, kind: 'rider' },
      { ...at, kind: 'rider' },
    ] as never);
    const same = riders.bodies.map((body) => colourOf(body).getHex());
    expect(new Set(same).size).toBe(1);
  }, 120_000);

  it('#623 — every palette entry: the rider in it told from the pacer and the ghost, each in its own hue, and a jersey in the bot’s tint not', async () => {
    const renderer = await loadedOn(TABLET);
    const riders = renderer.realisticRidersOfLoadedWorld();
    if (riders === undefined) throw new Error('no world');
    const at = { x: 0, y: 0, z: 0, headingX: 0, headingZ: 1, lean: 0, bodyLean: 0, crankAngle: 0 };
    type Colour = (typeof riders.kitColours)[number];
    // The jersey as the body's shader multiplies it: the tint (the material's
    // colour) times the kit uniform, both linear. @see riderBodyMaterial
    const jerseys = (kit: RiderKit): ThreeJerseys => {
      riders.setRiderKit(kit);
      riders.place([
        { ...at, kind: 'rider' },
        { ...at, kind: 'bot' },
        { ...at, kind: 'ghost' },
      ] as never);
      const [rider, bot, ghost] = riders.bodies.map((body, slot) => {
        const tint = (body.material as unknown as { color: Colour }).color;
        const uniform = riders.kitColours[slot] as Colour;
        return albedoBytes([uniform.r, uniform.g, uniform.b], [tint.r, tint.g, tint.b]);
      }) as [Bytes, Bytes, Bytes];
      return { rider, bot, ghost, chosen: kit.jersey };
    };
    for (const key of KIT_COLOURS) {
      const drawn = jerseys(KIT_PALETTE[key].kit);
      console.log(`#623 realistic, ${key}: ${toldApartFigures(drawn)}`);
      expect(toldApartFaults(drawn), key).toEqual([]);
      // The uniform IS the entry: the pacer's and the ghost's stay PACER_KIT.
      expect(riders.kitColours[0]?.getHex()).toBe(KIT_PALETTE[key].kit.jersey);
      expect(riders.kitColours[1]?.getHex()).toBe(PACER_KIT.jersey);
      expect(riders.kitColours[2]?.getHex()).toBe(PACER_KIT.jersey);
    }
    // THE CONTROL: a jersey in the bot's own tint.
    const control = jerseys({ jersey: 0xc2410c, limb: 0x8a2e08 });
    console.log(`#623 realistic, the control: ${toldApartFigures(control)}`);
    expect(toldApartFaults(control).some((fault) => fault.includes('of hue from the bot'))).toBe(
      true,
    );
  }, 120_000);
});

/**
 * The realistic rider moves like a rider — #625, on the real MakeHuman body
 * posed by the real belt. Read in world space off each bone's `matrixWorld`,
 * because this file names no `three` type (`three-seam.test.ts`).
 */
describe('the realistic rider moves like a rider — #625', () => {
  type Riders = NonNullable<ReturnType<Renderer['realisticRidersOfLoadedWorld']>>;
  interface Posed {
    readonly name: string;
    readonly world: readonly number[];
    readonly local: readonly number[];
  }
  const HALF_PI = Math.PI / 2;

  /** Every bone of the rider's body, posed by one frame, copied out. */
  function posed(
    riders: Riders,
    crankAngle: number,
    pedalling: number,
    rideSeconds: number,
  ): ReadonlyMap<string, Posed> {
    riders.place([
      {
        kind: 'rider',
        x: 0,
        y: 0,
        z: 0,
        headingX: 0,
        headingZ: 1,
        lean: 0,
        bodyLean: 0,
        pedalling,
        rideSeconds,
        crankAngle,
      },
    ]);
    const body = riders.bodies[0];
    if (body === undefined) throw new Error('no body');
    const bones = new Map<string, Posed>();
    for (const bone of body.skeleton.bones) {
      bones.set(bone.name, {
        name: bone.name,
        world: [...bone.matrixWorld.elements],
        local: bone.quaternion.toArray(),
      });
    }
    return bones;
  }

  const bone = (pose: ReadonlyMap<string, Posed>, name: string): Posed => {
    const found = pose.get(name);
    if (found === undefined) throw new Error(`no bone ${name}`);
    return found;
  };
  const at = (pose: ReadonlyMap<string, Posed>, name: string): readonly number[] =>
    bone(pose, name).world.slice(12, 15);
  const distance = (a: readonly number[], b: readonly number[]): number =>
    Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
  /** The largest angle, in degrees, between a bone's world axes in two poses. */
  const turned = (a: Posed, b: Posed): number =>
    Math.max(
      ...[0, 4, 8].map((column) => {
        const u = a.world.slice(column, column + 3);
        const v = b.world.slice(column, column + 3);
        const dot = u.reduce((sum, each, i) => sum + each * (v[i] ?? 0), 0);
        const cosine = dot / (Math.hypot(...u) * Math.hypot(...v));
        return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
      }),
    );
  const shoulders = (pose: ReadonlyMap<string, Posed>): number =>
    ((at(pose, 'upperarm01L')[0] ?? 0) + (at(pose, 'upperarm01R')[0] ?? 0)) / 2;

  it('rocks the shoulders from side to side half a stroke apart, and not at all with no cadence', async () => {
    const renderer = await loadedOn(TABLET);
    const riders = renderer.realisticRidersOfLoadedWorld();
    if (riders === undefined) throw new Error('no world');
    // The bicycle faces +Z, so across it is world X.
    const rocked =
      shoulders(posed(riders, HALF_PI, 1, 0)) - shoulders(posed(riders, 3 * HALF_PI, 1, 0));
    const still =
      shoulders(posed(riders, HALF_PI, 0, 0)) - shoulders(posed(riders, 3 * HALF_PI, 0, 0));
    console.log(
      `#625: the shoulders half a stroke apart — ${(Math.abs(rocked) * 100).toFixed(2)} cm ` +
        `pedalling, ${(Math.abs(still) * 100).toFixed(3)} cm with no cadence`,
    );
    expect(Math.abs(rocked)).toBeGreaterThan(0.025);
    // Toward the downstroke: +X's pedal is going down at a quarter turn.
    expect(rocked).toBeGreaterThan(0);
    expect(Math.abs(still)).toBeLessThan(1e-9);
  }, 120_000);

  it('holds the pelvis, the back, the head and the ankles exactly as before with no cadence', async () => {
    const renderer = await loadedOn(TABLET);
    const riders = renderer.realisticRidersOfLoadedWorld();
    if (riders === undefined) throw new Error('no world');
    // At a breath's zero, so nothing but the stroke could move them.
    const a = posed(riders, HALF_PI, 0, 0);
    const b = posed(riders, 3 * HALF_PI, 0, 0);
    for (const name of ['root', 'pelvisL', 'pelvisR', 'spine05', 'neck01', 'head']) {
      expect(turned(bone(a, name), bone(b, name)), name).toBeLessThan(1e-4);
    }
    // No ankling: each foot keeps its rest turn against its shin.
    for (const name of ['footL', 'footR']) {
      expect(bone(a, name).local, name).toEqual(bone(b, name).local);
    }
    // …where pedalling turns every one of them.
    const c = posed(riders, HALF_PI, 1, 0);
    const d = posed(riders, 3 * HALF_PI, 1, 0);
    for (const name of ['pelvisL', 'pelvisR', 'spine05']) {
      expect(turned(bone(c, name), bone(d, name)), name).toBeGreaterThan(2);
    }
    // The pelvis's two halves turn about their own heads, which is one rigid
    // roll only because the two heads are one point: the body's middle.
    expect(distance(at(c, 'pelvisL'), at(c, 'pelvisR'))).toBeLessThan(0.01);
    for (const name of ['footL', 'footR']) {
      expect(bone(c, name).local, name).not.toEqual(bone(d, name).local);
    }
  }, 120_000);

  it('keeps the hands on the bar, the feet on the pedals and the head level while the body rocks and breathes', async () => {
    const renderer = await loadedOn(TABLET);
    const riders = renderer.realisticRidersOfLoadedWorld();
    if (riders === undefined) throw new Error('no world');
    let furthestHand = 0;
    let furthestFoot = 0;
    let headTurn = 0;
    let backTurn = 0;
    // The two peaks of the rock, at the two peaks of a breath.
    for (const crank of [HALF_PI, 3 * HALF_PI]) {
      for (const breath of [0.5, 1.5]) {
        const still = posed(riders, crank, 0, 0);
        const moving = posed(riders, crank, 1, breath);
        for (const name of ['wristL', 'wristR']) {
          furthestHand = Math.max(furthestHand, distance(at(still, name), at(moving, name)));
        }
        for (const name of ['footL', 'footR']) {
          furthestFoot = Math.max(furthestFoot, distance(at(still, name), at(moving, name)));
        }
        headTurn = Math.max(headTurn, turned(bone(still, 'head'), bone(moving, 'head')));
        backTurn = Math.max(backTurn, turned(bone(still, 'spine05'), bone(moving, 'spine05')));
      }
    }
    console.log(
      `#625: hands ${(furthestHand * 1000).toFixed(2)} mm, feet ${(furthestFoot * 1000).toFixed(2)} mm ` +
        `off where they were; the head turned ${headTurn.toFixed(3)}° while the back turned ${backTurn.toFixed(2)}°`,
    );
    expect(furthestHand).toBeLessThan(0.002);
    expect(furthestFoot).toBeLessThan(0.002);
    // The bound: the head within half a degree of level while the back moves
    // by the rock and the breath together.
    expect(headTurn).toBeLessThan(0.5);
    expect(backTurn).toBeGreaterThan(2);
  }, 120_000);

  it('is posed from the ride’s clock, never the wall’s — the same ride time at two wall times is the same body', async () => {
    const renderer = await loadedOn(TABLET);
    const riders = renderer.realisticRidersOfLoadedWorld();
    if (riders === undefined) throw new Error('no world');
    vi.useFakeTimers({ toFake: ['Date', 'performance'] });
    try {
      vi.setSystemTime(new Date('2026-09-29T10:00:00Z'));
      const first = posed(riders, 1.1, 1, 12.5);
      vi.setSystemTime(new Date('2026-09-29T10:00:07.321Z'));
      vi.advanceTimersByTime(7_321);
      const second = posed(riders, 1.1, 1, 12.5);
      for (const [name, each] of first) {
        expect(bone(second, name).world, name).toEqual(each.world);
      }
      // Non-vacuity: the RIDE's clock is read — half a breath on, the back moves.
      const later = posed(riders, 1.1, 1, 12.5 + 1);
      expect(turned(bone(first, 'spine05'), bone(later, 'spine05'))).toBeGreaterThan(0.5);
    } finally {
      vi.useRealTimers();
    }
  }, 120_000);
});

/**
 * The realistic riders' bike-shaped shadow — #626, from the real rider's own
 * silhouette. The shape is measured by how much of its own bounding rectangle
 * (along and across the bicycle) the covered region fills: a solid ellipse
 * fills π/4 of it, whatever its throw, and a bicycle's shadow — two wheels, a
 * frame triangle, a body, and the gaps between them — much less.
 *
 * ⚠️ **Not by its aspect, which #626's criterion named, and the table this
 * prints is why**: a cast shadow is long ALONG THE SUN'S THROW whatever casts
 * it, so the silhouette's and the round blob's aspects agree to within a few
 * tenths at every heading (1.1 : 1 against 1.0 : 1 with the sun abeam, 4.8 : 1
 * against 4.6 : 1 with it behind). An aspect gate would pass or fail with the
 * heading, never with the shape.
 */
describe('the realistic riders’ bike-shaped shadow — #626', () => {
  const HEADINGS = [0, 45, 90, 135, 180, 225, 270, 315];
  const ELEVATIONS = [55, 70];
  const STEP = 0.02;

  /** `world.ts`'s sun at an elevation: from its one azimuth, 225°. */
  function sunAt(elevationDegrees: number): { x: number; y: number; z: number } {
    const up = (elevationDegrees * Math.PI) / 180;
    const azimuth = (225 * Math.PI) / 180;
    return {
      x: -Math.cos(up) * Math.sin(azimuth),
      y: Math.sin(up),
      z: Math.cos(up) * Math.cos(azimuth),
    };
  }

  function riderFacing(degrees: number, kind: 'rider' | 'ghost' = 'rider') {
    const heading = (degrees * Math.PI) / 180;
    return {
      kind,
      x: 0,
      y: 0,
      z: 0,
      headingX: -Math.sin(heading),
      headingZ: Math.cos(heading),
      lean: 0,
      bodyLean: 0,
      pedalling: 0,
      rideSeconds: 0,
    } as const;
  }

  /** How much of its own bounding rectangle a covered set fills, and its aspect along the bicycle. */
  function shapeOf(
    covered: (across: number, along: number) => boolean,
    area: { acrossMin: number; acrossMax: number; alongMin: number; alongMax: number },
  ): { fill: number; aspect: number; squareMetres: number } {
    let count = 0;
    let [acrossLow, acrossHigh, alongLow, alongHigh] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let a = area.acrossMin; a <= area.acrossMax; a += STEP) {
      for (let c = area.alongMin; c <= area.alongMax; c += STEP) {
        if (!covered(a, c)) continue;
        count += 1;
        acrossLow = Math.min(acrossLow, a);
        acrossHigh = Math.max(acrossHigh, a);
        alongLow = Math.min(alongLow, c);
        alongHigh = Math.max(alongHigh, c);
      }
    }
    const squareMetres = count * STEP * STEP;
    const box = (acrossHigh - acrossLow + STEP) * (alongHigh - alongLow + STEP);
    return {
      fill: count === 0 ? Number.NaN : squareMetres / box,
      aspect: silhouettes.coveredAspect(covered, area, STEP),
      squareMetres,
    };
  }

  let silhouettes: typeof import('./rider-silhouette');
  let shadows: typeof import('./contact-shadow');

  it('is made from the rider and the bicycle that are drawn: their length, their height and their width', async () => {
    const renderer = await loadedOn(TABLET);
    const riders = renderer.realisticRidersOfLoadedWorld();
    if (riders === undefined) throw new Error('no world');
    const { BICYCLE_LENGTH_METRES, RIDER_HEIGHT_METRES } = await import('./bicycle');
    const silhouette = riders.silhouette();
    const { zMin, zMax, height, reach } = silhouette.bounds;
    console.log(`#626: the side view spans ${JSON.stringify(silhouette.bounds)}`);
    // Tyre to tyre, within a tyre's width of the bicycle's own length.
    expect(zMax - zMin).toBeGreaterThan(BICYCLE_LENGTH_METRES - 0.05);
    expect(zMax - zMin).toBeLessThan(BICYCLE_LENGTH_METRES + 0.1);
    // Up to the helmet, and across to the bars.
    expect(height).toBeGreaterThan(RIDER_HEIGHT_METRES - 0.15);
    expect(height).toBeLessThan(RIDER_HEIGHT_METRES + 0.2);
    expect(reach).toBeGreaterThan(0.15);
    expect(reach).toBeLessThan(0.4);
    // The picture is a real share of itself: not empty, not solid.
    let covered = 0;
    for (let at = 0; at < silhouette.texels.length; at += 2)
      if (silhouette.texels[at]) covered += 1;
    const share = covered / (silhouette.texels.length / 2);
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.6);
  }, 120_000);

  it('casts the shape of a bicycle at every heading, under both ends of the sun’s band — and the round blob does not', async () => {
    silhouettes = await import('./rider-silhouette');
    shadows = await import('./contact-shadow');
    const renderer = await loadedOn(TABLET);
    const riders = renderer.realisticRidersOfLoadedWorld();
    if (riders === undefined) throw new Error('no world');
    const silhouette = riders.silhouette();
    const rows: string[] = [];
    for (const elevation of ELEVATIONS) {
      for (const heading of HEADINGS) {
        const sun = sunAt(elevation);
        const marker = riderFacing(heading);
        const thrown = { x: 0, z: 0 };
        expect(silhouettes.silhouetteThrow(marker, sun, thrown)).toBe(true);
        const area = silhouettes.silhouetteFootprint(silhouette.bounds, thrown, {
          acrossMin: 0,
          acrossMax: 0,
          alongMin: 0,
          alongMax: 0,
        });
        const cast = shapeOf(
          (a, c) => silhouettes.silhouetteCoverage(silhouette, thrown, a, c) > 0.5,
          area,
        );
        // THE CONTROL: the blob this replaces, under the same sun, covered
        // where it is at least half its middle's darkness, in its own frame.
        const blob = { x: 0, y: 0, z: 0, yaw: 0, halfAlong: 0, halfAcross: 0 };
        expect(shadows.placeContactShadow(marker, sun, blob)).toBe(true);
        const round = shapeOf(
          (a, c) => (a / blob.halfAcross) ** 2 + (c / blob.halfAlong) ** 2 <= 0.66 ** 2,
          {
            acrossMin: -blob.halfAcross,
            acrossMax: blob.halfAcross,
            alongMin: -blob.halfAlong,
            alongMax: blob.halfAlong,
          },
        );
        rows.push(
          `${String(elevation)}° sun, heading ${String(heading)}°: silhouette fills ` +
            `${cast.fill.toFixed(2)} (aspect ${cast.aspect.toFixed(2)}, ${cast.squareMetres.toFixed(2)} m²); ` +
            `blob ${round.fill.toFixed(2)} (aspect ${round.aspect.toFixed(2)})`,
        );
        expect(cast.fill).toBeLessThan(0.6);
        // Not a speck: a whole rider's shadow.
        expect(cast.squareMetres).toBeGreaterThan(0.3);
        expect(round.fill).toBeGreaterThan(0.7);
      }
    }
    console.log(`#626:\n${rows.join('\n')}`);
  }, 120_000);

  it('casts none for the ghost, and none under a sun on the horizon', async () => {
    silhouettes = await import('./rider-silhouette');
    const thrown = { x: 7, z: 7 };
    expect(silhouettes.silhouetteThrow(riderFacing(0, 'ghost'), sunAt(60), thrown)).toBe(false);
    expect(silhouettes.silhouetteThrow(riderFacing(0), { x: 1, y: 0, z: 0 }, thrown)).toBe(false);
    expect(thrown).toEqual({ x: 7, z: 7 });
  });
});
