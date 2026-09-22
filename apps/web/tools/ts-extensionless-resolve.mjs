// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A module resolve hook that lets `node` run this app's authoring-time
 * TypeScript — the `realistic:*` scripts in `package.json` (#430, #478).
 *
 * Node 24 strips types from a `.ts` file it is given, but it does not resolve
 * an extensionless specifier: `import { LOCK } from './fetch-assets'` fails
 * with `ERR_MODULE_NOT_FOUND`, and a directory specifier fails with
 * `ERR_UNSUPPORTED_DIR_IMPORT`. So both spellings are tried — `./y.ts` and
 * `./y/index.ts` — using Node's own `module.registerHooks`, with no new
 * dependency.
 *
 * ## Why this app has its own, rather than borrowing `packages/fit`'s
 *
 * The scripts used to run `node --import ../../packages/fit/tools/ts-extensionless-resolve.mjs`,
 * which made a tool of this app depend on another package's AUTHORING-TIME
 * directory layout: a move of that file would break them, and no gate runs
 * them, so nothing would say so (#477's review, #478). CLAUDE.md §4b declines
 * the same coupling for `fit-file-parser`'s ambient declaration and pays for it
 * with a second copy, and so does this: thirty lines, the same logic as
 * `packages/fit/tools/ts-extensionless-resolve.mjs`, under this app's own
 * licence. `ts-extensionless-resolve.test.ts` beside it runs a script's real
 * import graph through it, and checks that every `--import` in `package.json`
 * names a file inside this app that exists.
 *
 * It only ever *adds* a candidate: a specifier that already resolves is
 * untouched, and one that carries an explicit extension is never rewritten, so
 * this cannot silently shadow a real module.
 */

import { registerHooks } from 'node:module';

const HAS_EXTENSION = /\.[cm]?[jt]sx?$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (HAS_EXTENSION.test(specifier)) {
        throw error;
      }
      for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
        try {
          return nextResolve(candidate, context);
        } catch {
          // Try the next spelling; the original error is what gets reported.
        }
      }
      throw error;
    }
  },
});
