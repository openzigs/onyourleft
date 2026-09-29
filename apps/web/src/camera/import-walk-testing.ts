// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Every module a module can reach**, by walking its relative imports
 * transitively. Test support, never shipped (the `-testing.ts` suffix).
 *
 * Two gates read it, and they ask opposite-facing questions of one graph:
 *
 * - `side-report-safety.test.ts` — nothing on the side camera's report path
 *   reaches a trainer (#388). The walker lived there until #799.
 * - `no-picture-reachable.test.ts` — nothing a model request is built from
 *   reaches a picture type (#799, #518).
 *
 * ⚠️ **The source is READ through a function**, never straight off the disk
 * inside the walk, so a gate's control can plant a chain of modules that do
 * not exist (`entry → helper → frame.ts`) and require the walk to find it.
 * A walker that could only read the tree could only ever be shown green.
 *
 * Paths are POSIX paths relative to `apps/web/src`, the way both gates name
 * their modules. A bare specifier (`react`, `@onyourleft/sensors`) is recorded
 * and not followed.
 *
 * A relative specifier whose query is exactly `?url` or `?raw` is an asset
 * handed over as a string and is not followed; one naming an existing
 * stylesheet or JSON file is not followed either. **Any other relative
 * specifier that does not resolve to a `.ts`/`.tsx` module is an error** —
 * a `?worker` or `?inline` query, an existing `.js` file — never a module
 * quietly left out of the walk (#822, #823).
 *
 * ## What it cannot see
 *
 * A specifier that is not a string literal (`import(name)`), and a module a
 * caller hands in at run time. The same limits `scripts/check-wiring.mjs`
 * §Limits states for its own walk.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../units/no-inline-units';

/** `apps/web/src`, on disk. */
export const SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** A module's source, by its path under `src`, or `undefined` when there is none. */
export type ReadSource = (path: string) => string | undefined;

/** The real tree. */
export const readFromDisk: ReadSource = (path) => {
  const file = join(SOURCE_ROOT, path);
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
};

/**
 * Every module specifier in `code`: `from '…'`, a bare `import '…'`, and — since
 * #561's review — a dynamic `import('…')` with a literal, so a lazily loaded
 * module is walked like a static one.
 */
export function specifiersIn(code: string): string[] {
  return [...code.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)'([^']+)'/g)].map(
    (match) => match[1] ?? '',
  );
}

/** One module's imports: relative ones resolved to paths under `src`, bare ones as written. */
export interface ModuleImports {
  readonly local: readonly string[];
  readonly bare: readonly string[];
}

/** What a walk found. */
export interface ImportClosure {
  /** Every module reached, the roots included. */
  readonly modules: ReadonlySet<string>;
  /** Every bare specifier any of them imports. */
  readonly bare: ReadonlySet<string>;
  /**
   * How a module was first reached: the chain of imports from a root to it,
   * root first. `undefined` for a module the walk never reached.
   */
  readonly chainTo: (path: string) => readonly string[] | undefined;
}

const RESOLUTION_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'] as const;

/** The only queries that hand a module over as a string: `?url` and `?raw`, alone. */
const ASSET_QUERY = /^[^?]+\?(?:url|raw)$/;

/** Files that are there and hold no code to walk: stylesheets and data. */
const INERT_EXTENSION = /\.(?:css|json)$/;

/** A walker over `read`. */
export function importWalk(read: ReadSource = readFromDisk): {
  readonly importsOf: (path: string) => ModuleImports;
  readonly closure: (roots: readonly string[]) => ImportClosure;
} {
  const resolveFile = (base: string): string | undefined =>
    RESOLUTION_SUFFIXES.map((suffix) => `${base}${suffix}`).find(
      (candidate) => /\.tsx?$/.test(candidate) && read(candidate) !== undefined,
    );

  const importsOf = (path: string): ModuleImports => {
    const source = read(path);
    if (source === undefined) {
      throw new Error(`the walk was asked for ${path}, which is not there`);
    }
    const local: string[] = [];
    const bare: string[] = [];
    for (const specifier of specifiersIn(stripComments(source))) {
      if (!specifier.startsWith('.')) {
        bare.push(specifier);
        continue;
      }
      // A `?url` or `?raw` import is an asset handed over as a string, not a
      // module: there is nothing in it to walk. EXACTLY those two — `?worker`
      // names a module that runs, and `?inline` or `?url&worker` is not a
      // string either, so any other query falls through to the error (#823).
      if (ASSET_QUERY.test(specifier)) {
        continue;
      }
      const base = posix.normalize(posix.join(posix.dirname(path), specifier));
      const file = resolveFile(base);
      if (file !== undefined) {
        local.push(file);
        continue;
      }
      // A stylesheet imported for its side effect, or JSON, is there and is
      // not code. A named list, so an existing `.js`, `.mjs` or `.jsx` — code
      // that can import a picture — is refused rather than skipped (#823).
      if (INERT_EXTENSION.test(base) && read(base) !== undefined) {
        continue;
      }
      // #822: a relative import that resolves to nothing used to be dropped
      // here in silence, so the walk passed over whatever it really named.
      throw new Error(`${path} imports ${specifier}, which the walk cannot resolve`);
    }
    return { local, bare };
  };

  const closure = (roots: readonly string[]): ImportClosure => {
    const parent = new Map<string, string | undefined>();
    const bare = new Set<string>();
    // Breadth first, so the chain a failure names is the shortest one.
    const queue: { path: string; from: string | undefined }[] = roots.map((path) => ({
      path,
      from: undefined,
    }));
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      if (parent.has(next.path)) {
        continue;
      }
      parent.set(next.path, next.from);
      const found = importsOf(next.path);
      for (const specifier of found.bare) {
        bare.add(specifier);
      }
      for (const path of found.local) {
        queue.push({ path, from: next.path });
      }
    }
    return {
      modules: new Set(parent.keys()),
      bare,
      chainTo: (path) => {
        if (!parent.has(path)) {
          return undefined;
        }
        const chain: string[] = [];
        for (let at: string | undefined = path; at !== undefined; at = parent.get(at)) {
          chain.unshift(at);
        }
        return chain;
      },
    };
  };

  return { importsOf, closure };
}
