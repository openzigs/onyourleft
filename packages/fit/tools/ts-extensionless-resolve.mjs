// SPDX-License-Identifier: Apache-2.0

/**
 * A module resolve hook that lets `node` run this workspace's TypeScript.
 *
 * Node 24 strips types from a `.ts` file it is given, but it does not resolve
 * an extensionless specifier: `import { x } from './y'` inside a `.ts` file
 * fails with `ERR_MODULE_NOT_FOUND` on `./y`, and so does every extensionless
 * import inside `@onyourleft/domain` once the generator reaches it. Checked on
 * Node v24.20.0 and v22.22.3 on 2026-09-03; both fail.
 *
 * Rewriting the whole workspace to explicit `.ts` specifiers would need
 * `allowImportingTsExtensions` and would change files in `packages/domain` that
 * this issue has no business touching. Adding a TypeScript runner would be a
 * new dependency and a licence question. Twenty lines using Node's own
 * `module.registerHooks` is the smallest thing that works, and it is scoped to
 * the one command that needs it — `pnpm --filter @onyourleft/fit run
 * fixtures:generate`. Vitest resolves these specifiers itself and does not load
 * this file.
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
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        throw error;
      }
    }
  },
});
