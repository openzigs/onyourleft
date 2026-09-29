// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { iconProblems, importedIcons, isIconModule } from './icon-modules';

const LUCIDE = '/repo/node_modules/.pnpm/lucide-react@1.48.0/node_modules/lucide-react/dist/esm/';
const icon = (name: string): string => `${LUCIDE}icons/${name}.mjs`;

describe('which Lucide icons a module imports — #673', () => {
  it('counts named value imports and skips type-only ones', () => {
    expect(
      importedIcons(
        "import { Bike, House as Home, type LucideIcon } from 'lucide-react';\n" +
          "import type { LucideProps } from 'lucide-react';\n",
      ),
    ).toEqual({ icons: ['Bike', 'House'], problems: [] });
  });

  it('does not count the exports that draw nothing of their own', () => {
    expect(
      importedIcons("import { Icon, LucideProvider, Route } from 'lucide-react';").icons,
    ).toEqual(['Route']);
  });

  it('refuses a namespace, a default and the icons map, each of which names every icon', () => {
    expect(importedIcons("import * as L from 'lucide-react';").problems).toHaveLength(1);
    expect(importedIcons("import L from 'lucide-react';").problems).toHaveLength(1);
    expect(importedIcons("import { icons } from 'lucide-react';").problems).toHaveLength(1);
  });

  it('reads the real NavIcon as the five icons it draws', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/shell/NavIcon.tsx', import.meta.url)),
      'utf8',
    );
    expect(importedIcons(source).icons).toEqual([
      'Bike',
      'Ellipsis',
      'House',
      'RotateCcwClock',
      'Route',
    ]);
  });
});

describe('the build carries the icons the source names and no others — #673, ADR 0034 D-2', () => {
  const nav = {
    id: '/app/src/shell/NavIcon.tsx',
    code: "import { Bike, House } from 'lucide-react';",
  };

  it('recognises an icon module and nothing else of the package', () => {
    expect(isIconModule(icon('bike'))).toBe(true);
    expect(isIconModule(`${LUCIDE}Icon.mjs`)).toBe(false);
    expect(isIconModule(`${LUCIDE}dynamicIconImports.mjs`)).toBe(false);
  });

  it('passes when the counts agree', () => {
    expect(iconProblems([nav], [icon('bike'), icon('house'), `${LUCIDE}Icon.mjs`])).toEqual([]);
  });

  it('fails a build carrying the whole set, which is what DynamicIcon does', () => {
    const everything = Array.from({ length: 1854 }, (_unused, index) => icon(`i${String(index)}`));
    expect(iconProblems([nav], everything)).toEqual([
      'the build carries 1854 Lucide icon module(s) and the source imports 2 icon(s) (Bike, House)',
    ]);
  });

  it('fails an icon imported under two aliases, which ships once and is counted twice', () => {
    const aliases = { id: '/app/a.tsx', code: "import { House, Home } from 'lucide-react';" };
    expect(iconProblems([aliases], [icon('house')])).toHaveLength(1);
  });

  it('names the module of a namespace import', () => {
    expect(
      iconProblems([{ id: '/app/b.tsx', code: "import * as L from 'lucide-react';" }], []),
    ).toEqual(["/app/b.tsx: `import * as L from 'lucide-react'` names every icon in the set"]);
  });
});
