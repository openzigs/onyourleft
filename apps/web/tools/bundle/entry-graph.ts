// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * No lazily loaded view is in the entry chunk — held at build time, #674.
 *
 * `AppShell` loads every navigation group but Home through a literal
 * `import()` of one module under `src/shell/lazy/` (`shell/lazy-view.tsx`).
 * That split is one static import away from undoing itself: a view that
 * anything in the entry's graph imports by name is bundled into the entry (or
 * into a chunk the entry imports statically) whatever `AppShell` does, every
 * test stays green, and the only symptom is a number in the build log that
 * nobody reads. So the build reads it.
 *
 * ## What is checked
 *
 * - **Which views are lazy** is read out of `src/shell/lazy/*.ts` — every
 *   `export { … } from '…'` there — rather than written down twice. A group
 *   module that names no view, or a directory that holds no group module, is
 *   a failure: a check over an empty list passes for ever (#142's shape).
 * - **The entry's static graph** is the entry chunk and every chunk it
 *   imports statically, transitively — what the browser must fetch and
 *   evaluate before Home can paint. A dynamic import is not followed, which is
 *   the point.
 * - A lazy view module, or a group module, found in that graph fails the
 *   build, and so does a group module that is not a dynamic entry of its own.
 *
 * ## What it does not check
 *
 * It says nothing about how big the entry is; `pnpm run build` prints that.
 * It does not look inside a lazy view for what IT imports eagerly: a module a
 * view shares with Home is in the entry by design.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Plugin } from 'vite';

/** Where the group modules are, relative to the app's root. */
export const LAZY_GROUP_DIRECTORY = 'src/shell/lazy';

/** One chunk of the bundle, as far as this rule reads it. */
export interface BuiltChunk {
  readonly fileName: string;
  readonly isEntry: boolean;
  readonly isDynamicEntry: boolean;
  readonly imports: readonly string[];
  readonly facadeModuleId: string | null;
  readonly moduleIds: readonly string[];
}

/** A group module and the view modules it re-exports, as absolute paths without an extension. */
export interface LazyGroup {
  readonly module: string;
  readonly views: readonly string[];
}

/** Every `export { … } from '<specifier>'` in a module's source, in order. */
export function reExportSpecifiers(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/^export\s+\{[^}]*\}\s+from\s+'([^']+)';/gm)) {
    const specifier = match[1];
    if (specifier !== undefined) {
      found.push(specifier);
    }
  }
  return found;
}

/** A module id without its extension or query, so a `.tsx` and its specifier compare equal. */
export function withoutExtension(id: string): string {
  return id
    .replace(/\\/g, '/')
    .replace(/\?.*$/, '')
    .replace(/\.(?:tsx?|jsx?|mjs)$/, '');
}

/** The chunks the entry needs before anything else runs: itself and its static imports. */
export function staticGraph(chunks: readonly BuiltChunk[]): BuiltChunk[] {
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const entries = chunks.filter((chunk) => chunk.isEntry);
  const seen = new Set<string>();
  const queue = entries.map((chunk) => chunk.fileName);
  while (queue.length > 0) {
    const name = queue.pop();
    if (name === undefined || seen.has(name)) {
      continue;
    }
    seen.add(name);
    queue.push(...(byName.get(name)?.imports ?? []));
  }
  return chunks.filter((chunk) => seen.has(chunk.fileName));
}

/** What is wrong with the split, one sentence a problem; empty when nothing is. */
export function eagerLazyViews(
  chunks: readonly BuiltChunk[],
  groups: readonly LazyGroup[],
): string[] {
  if (groups.length === 0) {
    return [`${LAZY_GROUP_DIRECTORY} holds no group module, so there is nothing to check`];
  }
  if (!chunks.some((chunk) => chunk.isEntry)) {
    return ['the build has no entry chunk, so there is nothing to check'];
  }
  const problems: string[] = [];
  const eager = new Map<string, string>();
  for (const chunk of staticGraph(chunks)) {
    for (const id of chunk.moduleIds) {
      eager.set(withoutExtension(id), chunk.fileName);
    }
  }
  const dynamicFacades = new Set(
    chunks
      .filter((chunk) => chunk.isDynamicEntry && chunk.facadeModuleId !== null)
      .map((chunk) => withoutExtension(chunk.facadeModuleId ?? '')),
  );
  for (const group of groups) {
    if (group.views.length === 0) {
      problems.push(`${group.module} re-exports no view`);
    }
    const groupAt = eager.get(group.module);
    if (groupAt !== undefined) {
      problems.push(`${group.module} is in ${groupAt}, which the entry loads statically`);
    } else if (!dynamicFacades.has(group.module)) {
      problems.push(`${group.module} is not a chunk of its own that the app loads with import()`);
    }
    for (const view of group.views) {
      const at = eager.get(view);
      if (at !== undefined) {
        problems.push(`${view} is in ${at}, which the entry loads statically`);
      }
    }
  }
  return problems;
}

/** The group modules under `root`'s {@link LAZY_GROUP_DIRECTORY}, and what each re-exports. */
export function readLazyGroups(root: string): LazyGroup[] {
  const directory = join(root, LAZY_GROUP_DIRECTORY);
  let names: string[];
  try {
    names = readdirSync(directory).filter((name) => /\.tsx?$/.test(name));
  } catch {
    return [];
  }
  return names.sort().map((name) => {
    const path = join(directory, name);
    return {
      module: withoutExtension(path),
      views: reExportSpecifiers(readFileSync(path, 'utf8')).map((specifier) =>
        withoutExtension(resolve(directory, specifier)),
      ),
    };
  });
}

/** The plugin. `enforce: 'post'`, so it reads the bundle every other plugin left. */
export function lazyViewsStayLazy(root: string): Plugin {
  return {
    name: 'oyl-lazy-views-stay-lazy',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const chunks: BuiltChunk[] = Object.values(bundle).flatMap((output) =>
        output.type === 'chunk'
          ? [
              {
                fileName: output.fileName,
                isEntry: output.isEntry,
                isDynamicEntry: output.isDynamicEntry,
                imports: output.imports,
                facadeModuleId: output.facadeModuleId,
                moduleIds: Object.keys(output.modules),
              },
            ]
          : [],
      );
      const problems = eagerLazyViews(chunks, readLazyGroups(root));
      if (problems.length > 0) {
        this.error(
          `oyl-lazy-views-stay-lazy: a view meant to load on demand is in the entry chunk (#674).\n  - ` +
            `${problems.join('\n  - ')}\nImport it through AppShell's lazyView, never by name.`,
        );
      }
    },
  };
}
