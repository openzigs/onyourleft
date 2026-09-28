// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Where the Basis Universal transcoder is served** — #618, ADR 0026 D-8's
 * 2026-09-27 amendment.
 *
 * A name only, in a module that imports nothing, for `camera/pose-files.ts`'s
 * reason: the build reads it too (`tools/basis/transcoder-plugin.ts`), and a
 * config that imported `realistic-assets.ts` would load the Capacitor bridge
 * to learn a directory name.
 *
 * ⚠️ **Under `realistic/` on purpose.** The transcoder — `basis_transcoder.js`
 * and its 527 333-byte `.wasm`, copied out of the pinned `three@0.185.1` by
 * that plugin — is needed only by a rider who chose the realistic world, so it
 * sits where `tools/precache/precache.ts` §`PRECACHE_EXCLUSIONS` already
 * excludes the realistic set (ADR 0026 D-7, ADR 0024): not precached in a
 * browser, and in the APK with everything else in `dist`.
 * `tools/precache/precache.test.ts` §"#618" holds it inside that directory
 * and out of the precache, and `tools/basis/transcoder-plugin.test.ts` pins
 * the directory the plugin writes to.
 */

/** The transcoder's directory, relative to the build's root. */
export const REALISTIC_TRANSCODER_DIRECTORY = 'realistic/basis/';
