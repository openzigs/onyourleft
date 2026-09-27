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

import { TRANSCODER_FILES, transcoderSource } from '../../tools/basis/transcoder-plugin';

import {
  PHOTOGRAPHIC_STRUCTURE_SURFACES,
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
    // four impostors and every map inside a tree, shrub and rock — ONCE PER
    // IMAGE, read off the committed files: a fir's live and dead branches are
    // two textures over one image, which three uploads once.
    const images =
      4 +
      2 * PHOTOGRAPHIC_STRUCTURE_SURFACES.length +
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
      new Set(['road', 'ground', 'structure', 'model', 'impostor']),
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
