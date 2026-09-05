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
 * Node also refuses a **directory** specifier outright, with
 * `ERR_UNSUPPORTED_DIR_IMPORT` rather than `ERR_MODULE_NOT_FOUND`: `import … from
 * '../../src'` is how every module in this package names the package entry
 * point, and CommonJS-style directory resolution is not something ESM does. So
 * both candidates are tried — `./y.ts` and `./y/index.ts` — which between them
 * cover every spelling this workspace uses.
 *
 * Rewriting the whole workspace to explicit `.ts` specifiers would need
 * `allowImportingTsExtensions` and would change files in `packages/domain` that
 * this issue has no business touching. Adding a TypeScript runner would be a
 * new dependency and a licence question. Thirty lines using Node's own
 * `module.registerHooks` is the smallest thing that works, and it is scoped to
 * the two commands that need it — `pnpm --filter @onyourleft/fit run
 * fixtures:generate`, and the child process `tools/memory/retention.test.ts`
 * spawns (#127). Vitest resolves these specifiers itself and does not load this
 * file.
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
