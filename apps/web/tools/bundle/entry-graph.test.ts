// SPDX-License-Identifier: AGPL-3.0-or-later

import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  eagerLazyOnlyPackages,
  eagerLazyViews,
  readLazyGroups,
  reExportSpecifiers,
  staticGraph,
  withoutExtension,
  type BuiltChunk,
  type LazyGroup,
} from './entry-graph';

const WEB_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function chunk(fileName: string, over: Partial<BuiltChunk> = {}): BuiltChunk {
  return {
    fileName,
    isEntry: false,
    isDynamicEntry: false,
    imports: [],
    facadeModuleId: null,
    moduleIds: [],
    ...over,
  };
}

const GROUP: LazyGroup = {
  module: '/app/src/shell/lazy/more',
  views: ['/app/src/views/AboutView'],
};

/** A build as #674 means it: the entry, a shared chunk it imports, and the group on its own. */
function goodBuild(): BuiltChunk[] {
  return [
    chunk('assets/index.js', {
      isEntry: true,
      imports: ['assets/shared.js'],
      moduleIds: ['/app/src/main.tsx', '/app/src/views/HomeView.tsx'],
    }),
    chunk('assets/shared.js', { moduleIds: ['/app/src/design/Button.tsx'] }),
    chunk('assets/more.js', {
      isDynamicEntry: true,
      imports: ['assets/shared.js'],
      facadeModuleId: '/app/src/shell/lazy/more.ts',
      moduleIds: ['/app/src/shell/lazy/more.ts', '/app/src/views/AboutView.tsx'],
    }),
  ];
}

describe('which chunks the entry loads before anything else — #674', () => {
  it('follows static imports transitively and never a dynamic one', () => {
    const chunks = [
      chunk('a.js', { isEntry: true, imports: ['b.js'] }),
      chunk('b.js', { imports: ['c.js'] }),
      chunk('c.js'),
      chunk('lazy.js', { isDynamicEntry: true, imports: ['c.js'] }),
    ];
    expect(staticGraph(chunks).map((each) => each.fileName)).toEqual(['a.js', 'b.js', 'c.js']);
  });
});

describe('a view meant to load on demand is not in the entry — #674', () => {
  it('passes a build that keeps the group in a chunk of its own', () => {
    expect(eagerLazyViews(goodBuild(), [GROUP])).toEqual([]);
  });

  it('fails a view bundled into the entry chunk', () => {
    const build = goodBuild();
    build[0] = chunk('assets/index.js', {
      isEntry: true,
      imports: ['assets/shared.js'],
      moduleIds: ['/app/src/main.tsx', '/app/src/views/AboutView.tsx'],
    });
    expect(eagerLazyViews(build, [GROUP])).toEqual([
      '/app/src/views/AboutView is in assets/index.js, which the entry loads statically',
    ]);
  });

  it('fails a view in a chunk the entry imports statically, not only in the entry itself', () => {
    const build = goodBuild();
    build[1] = chunk('assets/shared.js', { moduleIds: ['/app/src/views/AboutView.tsx'] });
    expect(eagerLazyViews(build, [GROUP])).toEqual([
      '/app/src/views/AboutView is in assets/shared.js, which the entry loads statically',
    ]);
  });

  it('fails a group module that is not a dynamic entry of its own', () => {
    const build = goodBuild().map((each) =>
      each.fileName === 'assets/more.js' ? { ...each, isDynamicEntry: false } : each,
    );
    expect(eagerLazyViews(build, [GROUP])).toEqual([
      '/app/src/shell/lazy/more is not a chunk of its own that the app loads with import()',
    ]);
  });

  it('fails the group module itself in the entry', () => {
    const build = goodBuild();
    build[0] = chunk('assets/index.js', {
      isEntry: true,
      moduleIds: ['/app/src/shell/lazy/more.ts'],
    });
    expect(eagerLazyViews(build, [GROUP])).toContain(
      '/app/src/shell/lazy/more is in assets/index.js, which the entry loads statically',
    );
  });

  it('refuses to pass over nothing: no groups, a group with no view, a build with no entry', () => {
    expect(eagerLazyViews(goodBuild(), [])).toHaveLength(1);
    expect(eagerLazyViews(goodBuild(), [{ ...GROUP, views: [] }])).toEqual([
      '/app/src/shell/lazy/more re-exports no view',
    ]);
    expect(
      eagerLazyViews(
        goodBuild().map((each) => ({ ...each, isEntry: false })),
        [GROUP],
      ),
    ).toEqual(['the build has no entry chunk, so there is nothing to check']);
  });
});

describe('a Radix primitive is never in the entry — ADR 0034 D-5, #950', () => {
  const RADIX =
    '/repo/node_modules/.pnpm/@radix-ui+react-dialog@1.1.23/node_modules/@radix-ui/react-dialog/dist/index.mjs';

  it('passes a build that keeps it in a group chunk', () => {
    const build = goodBuild().map((each) =>
      each.fileName === 'assets/more.js'
        ? { ...each, moduleIds: [...each.moduleIds, RADIX] }
        : each,
    );
    expect(eagerLazyOnlyPackages(build)).toEqual([]);
  });

  it('fails one in the entry, or in a chunk the entry imports statically', () => {
    const inEntry = goodBuild().map((each) =>
      each.isEntry ? { ...each, moduleIds: [...each.moduleIds, RADIX] } : each,
    );
    expect(eagerLazyOnlyPackages(inEntry)).toEqual([
      `${RADIX} (@radix-ui/) is in assets/index.js, which the entry loads statically`,
    ]);
    const inShared = goodBuild().map((each) =>
      each.fileName === 'assets/shared.js' ? { ...each, moduleIds: [RADIX] } : each,
    );
    expect(eagerLazyOnlyPackages(inShared)).toHaveLength(1);
  });

  it('leaves every other package alone', () => {
    const build = goodBuild().map((each) =>
      each.isEntry
        ? { ...each, moduleIds: [...each.moduleIds, '/repo/node_modules/lucide-react/dist/x.js'] }
        : each,
    );
    expect(eagerLazyOnlyPackages(build)).toEqual([]);
  });
});

describe('the lazy groups are read from the source', () => {
  it('reads every re-export specifier, in order', () => {
    expect(
      reExportSpecifiers(
        "export { A } from '../a';\n// export { B } from '../b';\nexport { C, D } from './c';\n",
      ),
    ).toEqual(['../a', './c']);
  });

  it('strips an extension and a query so a module id and a specifier compare equal', () => {
    expect(withoutExtension('/x/View.tsx?used')).toBe('/x/View');
    expect(withoutExtension('C:\\x\\a.ts')).toBe('C:/x/a');
  });

  it('finds the four groups this app has, each naming at least one view that exists', () => {
    const groups = readLazyGroups(WEB_ROOT);
    expect(groups.map((group) => group.module.split('/').at(-1))).toEqual([
      'history',
      'more',
      'ride',
      'routes',
    ]);
    for (const group of groups) {
      expect(group.views.length).toBeGreaterThan(0);
    }
    // Home is the one navigation group that stays in the entry.
    expect(groups.flatMap((group) => group.views).some((view) => view.endsWith('/HomeView'))).toBe(
      false,
    );
  });

  it('reads nothing from a root with no group directory, which the check then refuses', () => {
    expect(readLazyGroups('/nowhere')).toEqual([]);
  });
});
