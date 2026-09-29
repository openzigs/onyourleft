// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Only the Lucide icons the source names ship — held at build time, #673.
 *
 * [ADR 0034](../../../../docs/adr/0034-lucide-icons.md) D-2 admits `lucide-react`
 * on the condition that the build carries the icons this app imports and no
 * others. The precache is derived from the build (#406), so an icon that ships
 * is an icon every rider downloads on a first visit; `DynamicIcon` or the
 * `icons` namespace would put the whole set — thousands of modules — there
 * with every test green. `eslint.config.js` refuses the obvious spellings; this
 * is what catches the rest, because the build is the one place that knows what
 * it wrote.
 *
 * ## The two counts
 *
 * - **Imported**: the distinct value names imported from `lucide-react` by any
 *   module of this app that the build bundled, less the few that are not icons
 *   ({@link NOT_ICONS}). A type-only name is not counted. A namespace or
 *   default import of the package is a problem in itself: it names every icon.
 * - **Bundled**: the modules under `lucide-react/dist/esm/icons/` in any chunk.
 *
 * They must be equal, and neither may be zero while the other is not. ⚠️ An
 * icon imported under two of its aliases (`House` and `Home`) is counted twice
 * and bundled once, and fails: import each icon by one name.
 */

import { readFileSync } from 'node:fs';

import type { Plugin } from 'vite';

/** Value exports of `lucide-react` that are not icons, so draw nothing of their own. */
export const NOT_ICONS: ReadonlySet<string> = new Set([
  'Icon',
  'createLucideIcon',
  'LucideProvider',
  'useLucideContext',
]);

/** Where a bundled module id says it is one of Lucide's icons. */
const ICON_MODULE = /[\\/]lucide-react[\\/]dist[\\/]esm[\\/]icons[\\/][^\\/]+\.m?js$/;

/** The icon names one module's source imports from `lucide-react`, and anything it cannot count. */
export function importedIcons(source: string): {
  readonly icons: readonly string[];
  readonly problems: readonly string[];
} {
  const icons: string[] = [];
  const problems: string[] = [];
  for (const match of source.matchAll(
    /import\s+(type\s+)?([^'";]*?)\s*from\s*['"]lucide-react['"]/g,
  )) {
    if (match[1] !== undefined) {
      continue;
    }
    const clause = (match[2] ?? '').trim();
    const named = /^\{([^}]*)\}$/.exec(clause);
    if (named === null) {
      problems.push(`\`import ${clause} from 'lucide-react'\` names every icon in the set`);
      continue;
    }
    for (const part of (named[1] ?? '').split(',')) {
      const specifier = part.trim();
      if (specifier === '' || specifier.startsWith('type ')) {
        continue;
      }
      const name = specifier.split(/\s+as\s+/)[0]?.trim() ?? '';
      if (name === 'icons') {
        problems.push("`icons` from 'lucide-react' is every icon in the set");
      } else if (!NOT_ICONS.has(name)) {
        icons.push(name);
      }
    }
  }
  return { icons, problems };
}

/** Whether a bundled module id is one of Lucide's icons. */
export function isIconModule(id: string): boolean {
  return ICON_MODULE.test(id.replace(/\?.*$/, ''));
}

/** What is wrong with the icons a build carries, one sentence a problem; empty when nothing is. */
export function iconProblems(
  sources: readonly { readonly id: string; readonly code: string }[],
  bundledModuleIds: readonly string[],
): string[] {
  const imported = new Set<string>();
  const problems: string[] = [];
  for (const { id, code } of sources) {
    const found = importedIcons(code);
    for (const icon of found.icons) {
      imported.add(icon);
    }
    problems.push(...found.problems.map((problem) => `${id}: ${problem}`));
  }
  const bundled = new Set(bundledModuleIds.filter(isIconModule));
  if (bundled.size !== imported.size) {
    problems.push(
      `the build carries ${String(bundled.size)} Lucide icon module(s) and the source imports ` +
        `${String(imported.size)} icon(s) (${[...imported].sort().join(', ') || 'none'})`,
    );
  }
  return problems;
}

/** The plugin. `enforce: 'post'`, so it reads the bundle every other plugin left. */
export function onlyImportedIcons(): Plugin {
  return {
    name: 'oyl-only-imported-icons',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const moduleIds = Object.values(bundle).flatMap((output) =>
        output.type === 'chunk' ? Object.keys(output.modules) : [],
      );
      const sources = moduleIds
        .filter(
          (id) =>
            !id.startsWith('\0') &&
            /\.(?:tsx?|jsx?)$/.test(id) &&
            !/[\\/]node_modules[\\/]/.test(id),
        )
        .map((id) => ({ id, code: readFileSync(id, 'utf8') }));
      const problems = iconProblems(sources, moduleIds);
      if (problems.length > 0) {
        this.error(
          `oyl-only-imported-icons: the build carries Lucide icons the source does not name (#673, ADR 0034 D-2).\n  - ` +
            `${problems.join('\n  - ')}\nImport each icon by name from 'lucide-react'.`,
        );
      }
    },
  };
}
