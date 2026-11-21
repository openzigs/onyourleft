// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A route ride never makes the streamed read** — #2890, ADR 0090 D-1: a
 * route ride keeps ADR 0054 D-2.4 in full, one corridor read before the ride
 * and no request while it records.
 *
 * Two halves. The behavioural one is `world-data/corridor-port.test.ts`'
 * (a corridor port told a ride is recording asks the archive for nothing).
 * This is the structural one: the streamed reader, `game/world-data/area.ts`,
 * is the only code that asks for map while a ride records, so **the modules
 * that may import it are an exact list**, and none of them is on a route
 * ride's path. A route-ride module that imported it — the corridor port, the
 * lazy port, `main.tsx`'s corridor wiring, the game's route-ride code — goes
 * red here. #2896 (the open-world session) adds its own module to the list.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../../units/no-inline-units';

const SOURCE_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * The modules permitted to import the streamed reader. None of them builds a
 * reader yet: `world-data/ridden-blocks.ts` (#2891) is the cache the reader
 * asks before the network, and takes the block's key and the cache's shape
 * from it.
 */
const AREA_READER_IMPORTERS: readonly string[] = [join('world-data', 'ridden-blocks.ts')];

/** The route ride's own read: each must keep to the corridor (ADR 0054 D-2.4). */
const ROUTE_RIDE_READ = [
  join('world-data', 'corridor-port.ts'),
  join('world-data', 'corridor-lazy.ts'),
  join('world-data', 'corridor-source.ts'),
  'main.tsx',
];

interface SourceFile {
  readonly path: string;
  readonly source: string;
}

function productSources(): SourceFile[] {
  const found: SourceFile[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name) &&
        !/-testing\.tsx?$/.test(entry.name)
      ) {
        found.push({ path: relative(SOURCE_ROOT, path), source: readFileSync(path, 'utf8') });
      }
    }
  };
  walk(SOURCE_ROOT);
  return found;
}

/** Every module that imports `world-data/area` at run time, statically or dynamically. */
function areaImporters(files: readonly SourceFile[]): string[] {
  const pattern =
    /(?:from\s+|import\s*\(\s*|import\s+)['"][^'"]*world-data\/area['"]|(?:from\s+|import\s*\(\s*|import\s+)['"]\.\/area['"]/;
  const typeOnly = /import\s+type\s+\{[^}]*\}\s+from\s+['"][^'"]*area['"]/g;
  return files
    .filter((file) => file.path !== join('game', 'world-data', 'area.ts'))
    .filter((file) => pattern.test(stripComments(file.source).replace(typeOnly, '')))
    .map((file) => file.path)
    .sort();
}

describe('the streamed reader is imported by an exact list, and no route ride is on it', () => {
  const tree = productSources();

  it('has source to scan, including the route ride’s read', () => {
    expect(tree.length).toBeGreaterThan(100);
    for (const path of ROUTE_RIDE_READ) expect(tree.map((f) => f.path)).toContain(path);
  });

  it('finds an import of it, in any spelling, where there is one', () => {
    const fake = (source: string): SourceFile[] => [{ path: 'x.ts', source }];
    expect(areaImporters(fake("import { createAreaReader } from './area';"))).toHaveLength(1);
    expect(areaImporters(fake("import { x } from '../game/world-data/area';"))).toHaveLength(1);
    expect(areaImporters(fake("const m = await import('./game/world-data/area');"))).toHaveLength(
      1,
    );
    expect(areaImporters(fake("import type { AreaReader } from './area';"))).toHaveLength(0);
    expect(areaImporters(fake("import { x } from './area-other';"))).toHaveLength(0);
  });

  it('is imported by exactly the permitted modules', () => {
    expect(areaImporters(tree)).toStrictEqual([...AREA_READER_IMPORTERS].sort());
  });

  it('is never imported by the route ride’s read', () => {
    const importers = areaImporters(tree);
    for (const path of ROUTE_RIDE_READ) expect(importers).not.toContain(path);
  });
});
