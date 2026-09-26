// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the service worker precaches, derived from the build's own output (#406).
 *
 * ## The list is never written down, and that is the whole point
 *
 * [ADR 0024](../../../../docs/adr/0024-offline-and-caching-posture.md) D-2: a
 * hand-written list of chunk names fails closed against *deleting* an asset and
 * **open** against *adding* one. A twelfth scenery model, or a new
 * `lazy()`-imported route, would simply not be cached — and every gate in this
 * repository would stay green about it, because nothing here asserts a
 * negative. That is [#142](https://github.com/openzigs/onyourleft/issues/142)'s
 * shape, which this repository has now shipped five separate times under
 * different names.
 *
 * So the list is the union of two **discoveries**: every file Rollup emitted,
 * and every file Vite copied out of `public/`. Adding an asset caches it with
 * no edit here and no edit to the worker; removing one changes the digest below
 * and therefore the cache name, which is the behaviour that wants to be
 * automatic.
 *
 * ## Why the version is a digest of contents rather than of names
 *
 * Vite puts a content hash in the filename of every chunk and every emitted
 * asset, so for those two a name change and a content change are the same
 * event. They are **not** the same event for `index.html` or for anything in
 * `public/`: the manifest, the icons and the HTML document all keep their names
 * for ever. A version derived from names alone would leave a rider's browser
 * holding yesterday's `index.html` with no way to notice — CLAUDE.md §5's
 * dominant defect, at the outermost layer. So every entry contributes its
 * content digest.
 */

/** One file in the build's output, with a digest of what is in it. */
export interface PrecacheFile {
  /** Its path relative to the build's root, as it will be served. */
  readonly name: string;
  /** A hex digest of its bytes. */
  readonly digest: string;
}

/**
 * What is emitted into `dist` and deliberately not precached.
 *
 * ⚠️ An **exclusion** list, which is the opposite failure mode from the
 * inclusion list the header refuses: a pattern nobody updates leaves a new file
 * *in* the precache, which is the safe direction. Four entries:
 *
 * - a source map is a debugging artefact a rider never requests, and the
 *   product build emits none today, so this is insurance rather than a filter;
 * - `sw.js` is the worker itself, and a worker that precached its own script
 *   would serve a rider the old worker for ever — the browser fetches it
 *   bypassing the worker anyway, so caching it can only be wrong;
 * - ⚠️ **`realistic/`, since ADR 0026 D-7** — the realistic world's whole set,
 *   about 31 MiB, which would multiply what a first visit downloads by ten for
 *   a world no rider can yet choose (D-12) and most never will. It is selected
 *   by **where it lives in the build** — every file Vite copies out of
 *   `public/realistic/` lands under `realistic/` — and never by name, so a
 *   realistic asset added later is excluded with no edit here, which is D-2's
 *   own argument applied to the exclusion. It is fetched when the rider
 *   chooses the realistic world; offline, the game falls back to the stylised
 *   world and says so. Inside the Android shell there is no worker at all and
 *   the set ships in the APK. `precache.test.ts` holds the rule both ways —
 *   every stylised asset cached, no realistic one — and
 *   `offline.browser.spec.ts` does the same against the cache a real browser
 *   filled from the real build.
 * - ⚠️ **`pose/`, since #530** — the side camera's pose model (5.8 MB of
 *   weights, out of `public/pose/`) and its WebAssembly runtime (11.8 MB,
 *   emitted by `tools/pose/pose-runtime-plugin.ts`). Spike 0010 §7 measured
 *   that precaching them would multiply a first visit by about seven for
 *   every rider, camera or not; ADR 0026 D-7 made the same trade for the
 *   realistic world, by the same rule: selected by where the files live, so a
 *   file added there later is excluded with no edit here. They are fetched
 *   the first time a paired phone sends a picture. ⚠️ **Offline, in a
 *   browser, that means no pose model** — the tablet says the model could not
 *   be loaded and counts nothing; inside the Android shell there is no worker
 *   and both files ship in the APK.
 */
export const PRECACHE_EXCLUSIONS: readonly RegExp[] = [
  /\.map$/,
  /^sw\.js$/,
  /^realistic\//,
  /^pose\//,
];

function included(name: string): boolean {
  return !PRECACHE_EXCLUSIONS.some((pattern) => pattern.test(name));
}

/**
 * Everything the worker precaches, in a stable order.
 *
 * Sorted so the digest below cannot depend on the order a directory walk or a
 * bundler happened to produce, which would make the cache version move for no
 * reason and evict a rider's cache on a rebuild of identical bytes.
 */
export function precacheEntries(files: readonly PrecacheFile[]): readonly string[] {
  const names = new Set<string>();
  for (const file of files) {
    if (included(file.name)) {
      names.add(file.name);
    }
  }
  return [...names].sort();
}

/**
 * The separator between an entry's name and its digest, and between entries.
 *
 * Two characters that cannot occur in either half, so that a file called
 * `a` with digest `bc` and a file called `ab` with digest `c` cannot produce
 * the same canonical string. A join on a printable character could.
 */
const FIELD_SEPARATOR = '\u0000';
const RECORD_SEPARATOR = '\u0001';

/**
 * The cache version: a digest over every precached entry's name and contents.
 *
 * Takes the hash function rather than importing one, so this module names no
 * platform API at all and its test can drive a trivial one. The caller is
 * `vite.config.ts`, which has `node:crypto`.
 */
export function cacheVersion(
  files: readonly PrecacheFile[],
  digestOf: (input: string) => string,
): string {
  const canonical = files
    .filter((file) => included(file.name))
    .map((file) => `${file.name}${FIELD_SEPARATOR}${file.digest}`)
    .sort()
    .join(RECORD_SEPARATOR);
  return digestOf(canonical);
}
