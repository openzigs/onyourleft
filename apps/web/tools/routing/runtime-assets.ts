// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the product build puts the in-browser routing engine's own files
 * (#2734): `valhalla-browser`'s worker and its WebAssembly, which the bundler
 * emits because the SDK names them with `new URL(…, import.meta.url)`.
 *
 * Under `routing/` rather than `assets/`, for `pose/`'s reason
 * (`vite.config.ts` §`worker`): `tools/precache/precache.ts` leaves the
 * directory out of the precache, so a first visit does not download ten
 * megabytes of engine a rider who never draws a route has no use for. They
 * are fetched the first time a leg is routed, and with no network then the
 * leg is drawn straight (`src/routing/valhalla-browser-provider.ts`). In the
 * Android app every file is on the device anyway.
 *
 * The names keep their content hash, so `third-party-notices.json`
 * §`copiedIntoBuild` names the exact WebAssembly a version ships, and a
 * version bump fails the build until that entry is read again.
 */

/** The directory, as `PRECACHE_EXCLUSIONS` and `copiedIntoBuild` read it. */
export const ROUTING_RUNTIME_DIRECTORY = 'routing/';

/** Whether an emitted asset is one of the SDK's own files, read off the modules it came from. */
export function isRoutingRuntimeAsset(originalFileNames: readonly string[]): boolean {
  return originalFileNames.some((name) =>
    /(?:^|[\\/])node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?valhalla-browser[\\/]/.test(
      name,
    ),
  );
}

/**
 * Whether a chunk is the engine's licence texts (`public/routing/third-party.txt`,
 * imported by `src/credits/notices-document.ts`), read off the modules in it.
 */
export function isRoutingRuntimeChunk(moduleIds: readonly string[]): boolean {
  return moduleIds.some((id) => /(?:^|[\\/])public[\\/]routing[\\/]/.test(id));
}

/**
 * Rolldown's `chunkFileNames`: the engine's licence texts under `routing/`
 * with the engine, out of the precache (#2734); every other chunk where Vite
 * puts it.
 */
export function chunkFileName(chunk: { readonly moduleIds: readonly string[] }): string {
  return isRoutingRuntimeChunk(chunk.moduleIds)
    ? `${ROUTING_RUNTIME_DIRECTORY}[name]-[hash].js`
    : 'assets/[name]-[hash].js';
}

/** Rolldown's `assetFileNames`: the SDK's files under `routing/`, every other asset where Vite puts it. */
export function assetFileName(asset: { readonly originalFileNames: readonly string[] }): string {
  return isRoutingRuntimeAsset(asset.originalFileNames)
    ? `${ROUTING_RUNTIME_DIRECTORY}[name]-[hash][extname]`
    : 'assets/[name]-[hash][extname]';
}
