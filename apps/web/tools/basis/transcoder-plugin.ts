// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The Basis Universal transcoder, served from this app's own origin** —
 * [#618](https://github.com/openzigs/onyourleft/issues/618), ADR 0026 D-8's
 * 2026-09-27 amendment.
 *
 * three's `KTX2Loader` turns a KTX2 texture into whatever block format the GPU
 * reads — ASTC or ETC2 on the owner's tablet — inside a worker running Binomial's
 * transcoder, `basis_transcoder.js` and `basis_transcoder.wasm`, which
 * `three@0.185.1` vendors under `examples/jsm/libs/basis/`. This plugin copies
 * those two files out of the pinned, installed package, the way
 * `tools/pose/pose-runtime-plugin.ts` copies the pose runtime:
 *
 * - **in a build**, into `dist/realistic/basis/`
 *   (`src/game/transcoder-files.ts`), which the realistic set's own precache
 *   exclusion covers — ADR 0026 D-7: not precached, fetched only when a rider
 *   chooses the realistic world, and in the APK;
 * - **in development**, by answering the same two paths from the package.
 *
 * ⚠️ **Copied, never committed, and never from a CDN.** Its licence is NOT the
 * one `check:licences` reads for `three` (MIT): the transcoder is Binomial's
 * Basis Universal, **Apache-2.0**, with Zstandard's decoder (**BSD-3-Clause**)
 * compiled into the `.wasm`. `DEP001` cannot see a vendored file, so that was
 * read by hand (ADR 0026 D-8), and `third-party-notices.json`
 * §`copiedIntoBuild` names both files with both notices.
 *
 * ## ⚠️ And it takes the default URLs out of `KTX2Loader`
 *
 * `KTX2Loader.js` opens with `new URL('../libs/basis/basis_transcoder.wasm',
 * import.meta.url)` and the same for the `.js`, as its defaults for a loader
 * given no transcoder path. Vite resolves exactly that shape as an ASSET and
 * emits both files into `assets/` with a hash — where the service worker
 * precaches everything, which would put half a megabyte a rider never uses
 * into every first visit. The product always sets the path
 * (`three-renderer.ts` §`compressedRealisticLoaders`), so {@link withoutDefaultUrls}
 * replaces the two expressions with an empty string at build time, and a
 * build of a `three` in which they are not found fails rather than shipping
 * the copies unnoticed. That is the first use of `KTX2Loader` in this tree
 * finding the defect §4f's MapLibre worker found: a bundler and a library
 * disagreeing about where a worker's files are.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import type { Plugin } from 'vite';

import { REALISTIC_TRANSCODER_DIRECTORY } from '../../src/game/transcoder-files';

/** The two files `KTX2Loader` fetches from its transcoder path, by these names. */
export const TRANSCODER_FILES = ['basis_transcoder.js', 'basis_transcoder.wasm'] as const;

/** Where one of them is on disk: the installed `three`'s own file, resolved from `root`. */
export function transcoderSource(root: string, file: (typeof TRANSCODER_FILES)[number]): string {
  return createRequire(join(root, 'package.json')).resolve(`three/examples/jsm/libs/basis/${file}`);
}

/** The module this plugin rewrites. */
const KTX2_LOADER = /[\\/]three[\\/]examples[\\/]jsm[\\/]loaders[\\/]KTX2Loader\.js$/;

/** The two default-URL expressions, exactly as `three@0.185.1` spells them. */
const DEFAULT_URL =
  /new URL\( '\.\.\/libs\/basis\/basis_transcoder\.(?:wasm|js)', import\.meta\.url \)\.toString\(\)/g;

/**
 * `KTX2Loader.js` with its two default transcoder URLs replaced by `''`, or an
 * error naming what was not found. @see the ⚠️ in the header
 */
export function withoutDefaultUrls(code: string): string {
  const found = code.match(DEFAULT_URL) ?? [];
  if (found.length !== 2) {
    throw new Error(
      `KTX2Loader.js: expected its two default transcoder URLs, found ${String(found.length)} — ` +
        'a three that spells them differently would put the transcoder in the precache',
    );
  }
  return code.replace(DEFAULT_URL, "''");
}

/** The plugin. */
export function basisTranscoder(): Plugin {
  let base = '/';
  let root = '.';
  return {
    name: 'oyl-basis-transcoder',
    configResolved(config) {
      base = config.base;
      root = config.root;
    },
    transform(code, id) {
      if (!KTX2_LOADER.test(id.split('?')[0] ?? id)) return null;
      try {
        return { code: withoutDefaultUrls(code), map: null };
      } catch (error: unknown) {
        this.error(error instanceof Error ? error.message : String(error));
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0];
        const file = TRANSCODER_FILES.find(
          (each) => path === `${base}${REALISTIC_TRANSCODER_DIRECTORY}${each}`,
        );
        if (file === undefined) {
          next();
          return;
        }
        response.setHeader(
          'Content-Type',
          file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
        );
        response.end(readFileSync(transcoderSource(root, file)));
      });
    },
    generateBundle() {
      for (const file of TRANSCODER_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `${REALISTIC_TRANSCODER_DIRECTORY}${file}`,
          source: readFileSync(transcoderSource(root, file)),
        });
      }
    },
  };
}
