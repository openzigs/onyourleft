// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The product build.
 *
 * ⚠️ **The harness build is `vite.browser.config.ts` and is a different file.**
 * Anything added here leaves it untouched, which is correct and is asserted
 * rather than assumed: a service worker registered on the harness origin would
 * answer `map.browser.spec.ts`'s network assertions from a cache, including the
 * `appType: 'mpa'` 404 test. `src/offline/configs.test.ts` is the static half
 * of that assertion and `offline.browser.spec.ts` is the half a browser makes.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { build, defineConfig, type Plugin } from 'vite';

import { cacheVersion, precacheEntries, type PrecacheFile } from './tools/precache/precache';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIRECTORY = join(ROOT, 'public');
const OUT_DIRECTORY = join(ROOT, 'dist');
const WORKER_ENTRY = join(ROOT, 'src/offline/sw.ts');

function sha256(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Every file under `public/`, which Vite copies into `dist` verbatim. */
function publicFiles(directory: string, prefix = ''): PrecacheFile[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    // No `public/` at all is a legitimate state — it did not exist before
    // #405 — and an empty list is the right answer rather than a build failure.
    return [];
  }
  const files: PrecacheFile[] = [];
  for (const entry of entries) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      files.push(...publicFiles(full, `${prefix}${entry}/`));
      continue;
    }
    files.push({ name: `${prefix}${entry}`, digest: sha256(readFileSync(full)) });
  }
  return files;
}

/**
 * Build the service worker, with a precache derived from what this build
 * emitted (#406).
 *
 * ## Why a second, nested Rollup pass
 *
 * A service worker is a separate program with a separate global scope, and it
 * has to be served from the scope root as its own script — it cannot be a chunk
 * of the application. So `generateBundle` reads what the application build
 * produced, and `closeBundle` compiles `src/offline/sw.ts` into `dist/sw.js`
 * with that list substituted in.
 *
 * ⚠️ **`configFile: false` on the nested build, and it is load-bearing**:
 * without it Vite would load this file again, run this plugin again, and build
 * the worker for ever.
 *
 * ## Why not `vite-plugin-pwa`
 *
 * ADR 0024 D-1, and it was a measurement rather than a preference: installing
 * it adds 284 packages and turns `pnpm run check:licences` red — `DEP001:
 * caniuse-lite is CC-BY-4.0, which is not permitted in the build-time closure
 * of an AGPL-3.0-or-later application`, reached through `workbox-build` →
 * `@babel/preset-env` → `browserslist`. Adopting it costs a licence ruling
 * before it costs a line of code.
 */
function serviceWorker(): Plugin {
  let files: PrecacheFile[] = [];
  return {
    name: 'oyl-service-worker',
    // Only in a build. `vite dev` serves modules that do not exist on disk, so
    // there is nothing coherent for a precache to name — and a worker holding a
    // dev server's transformed modules is a debugging experience nobody wants.
    apply: 'build',
    // After every plugin that might emit an asset, so nothing lands in `dist`
    // that this list has not seen.
    enforce: 'post',
    generateBundle(_options, bundle) {
      files = [
        ...Object.values(bundle).map((output) => ({
          name: output.fileName,
          digest: sha256(output.type === 'chunk' ? output.code : output.source),
        })),
        ...publicFiles(PUBLIC_DIRECTORY),
      ];
    },
    async closeBundle() {
      if (files.length === 0) {
        // The application build emitted nothing at all. Refusing here rather
        // than writing a worker with an empty precache: a worker that
        // successfully caches nothing is exactly the vacuous pass this epic is
        // about, and it would make every offline assertion downstream a
        // statement about an empty set.
        throw new Error(
          'oyl-service-worker: the build emitted no files, so there is no precache to derive',
        );
      }
      const entries = precacheEntries(files);
      const version = cacheVersion(files, sha256).slice(0, 16);
      await build({
        configFile: false,
        root: ROOT,
        logLevel: 'warn',
        define: {
          __OYL_PRECACHE__: JSON.stringify(entries),
          __OYL_CACHE_VERSION__: JSON.stringify(version),
        },
        build: {
          outDir: OUT_DIRECTORY,
          // ⚠️ The application's own output is already there.
          emptyOutDir: false,
          copyPublicDir: false,
          sourcemap: false,
          rollupOptions: {
            input: WORKER_ENTRY,
            output: {
              // At the scope root, under a fixed name, because the browser
              // fetches it by URL and a hashed one could not be registered.
              entryFileNames: 'sw.js',
              // A classic worker rather than a module one: `type: 'module'`
              // service workers are supported in Chromium and not everywhere,
              // and there is nothing here that needs one.
              format: 'iife',
              inlineDynamicImports: true,
            },
          },
        },
      });
      // The one line of build output this plugin produces, and the number
      // ADR 0024 §Consequences says is a real cost on a phone plan and "is not
      // yet measured".
      console.log(
        `oyl-service-worker: precaching ${String(entries.length)} files, ` +
          `${(byteSize(files, entries) / 1024 / 1024).toFixed(2)} MiB, as ${version}`,
      );
    },
  };
}

/** How much a first visit downloads because of the precache. ADR 0024 §Consequences. */
function byteSize(files: readonly PrecacheFile[], entries: readonly string[]): number {
  const wanted = new Set(entries);
  let total = 0;
  for (const file of files) {
    if (!wanted.has(file.name)) {
      continue;
    }
    try {
      total += statSync(join(OUT_DIRECTORY, ...file.name.split('/'))).size;
    } catch {
      // A file this plugin saw in the bundle but cannot stat is one Vite has
      // not written yet. Reporting a smaller number is better than failing a
      // build over a log line.
    }
  }
  return total;
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
});
