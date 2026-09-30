// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ResolveHookContext, ResolveFnOutput } from 'node:module';

/**
 * How `node src/main.ts` loads this repository's own packages (#780, carried
 * from #840's review).
 *
 * The instance runs as TypeScript with no build step: Node 24 strips the types
 * and transforms nothing else. Its own files name every relative import with
 * its `.ts` extension, as Node's ESM loader requires. **`packages/domain`,
 * `packages/physics` and `packages/protocol` do not** — they are written for
 * a bundler (`"moduleResolution": "bundler"`), so `import { advance } from
 * './tick'` in them is a module Node cannot find, and the room core, which
 * imports all three, could not be mounted by a running instance at all.
 *
 * Three ways out were weighed:
 *
 * | Option | Verdict |
 * |---|---|
 * | Write `.ts` into about 400 imports across three Apache-2.0 packages | rejected: a noisy diff in packages every client builds from, for a problem only the server has |
 * | A build step (rolldown, already a devDependency) | rejected: the image would run something other than the committed source, and `start` would need a build first |
 * | **A resolve hook that tries `.ts`, then `/index.ts`, when an extensionless relative import is not found** | **chosen**: about thirty lines, Node's own `module.registerHooks`, in-thread and synchronous |
 *
 * ⚠️ **It only ever adds a candidate after Node has refused the specifier as
 * written**, and only for a relative specifier with no extension imported from
 * a `.ts` file. Anything Node resolves already is untouched, and a relative
 * import that names a missing `.ts` file is still an error — the hook does not
 * make a typo quietly resolve somewhere else.
 *
 * `main.ts` and the room worker's entry register it before they import
 * anything that reaches a package. `node-imports.test.ts` starts a real `node`
 * with and without it.
 */

const EXTENSION = /\.[A-Za-z0-9]+$/;

/** A candidate the hook may try after `specifier` itself was not found. */
export function candidatesFor(specifier: string, parentUrl: string | undefined): readonly string[] {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return [];
  if (parentUrl === undefined || !parentUrl.startsWith('file:') || !parentUrl.endsWith('.ts')) {
    return [];
  }
  const last = specifier.split('/').at(-1) ?? '';
  if (EXTENSION.test(last)) return [];
  return [`${specifier}.ts`, `${specifier}/index.ts`];
}

const NOT_FOUND = new Set(['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT']);

/** A `resolve` hook for `module.registerHooks`. */
export function resolveExtensionless(
  specifier: string,
  context: ResolveHookContext,
  nextResolve: (specifier: string, context?: Partial<ResolveHookContext>) => ResolveFnOutput,
): ResolveFnOutput {
  try {
    return nextResolve(specifier, context);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code !== 'string' || !NOT_FOUND.has(code)) throw error;
    for (const candidate of candidatesFor(specifier, context.parentURL)) {
      try {
        return nextResolve(candidate, context);
      } catch {
        // Try the next candidate; the original error is the one reported.
      }
    }
    throw error;
  }
}
