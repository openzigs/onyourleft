// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **One module may name the archive reader, and it names one origin** —
 * #1539, the static half of ADR 0032 D-4 item 2 (the network half is
 * `browser/game.browser.spec.ts` §"#1539 corridor read").
 *
 * `pmtiles` is imported under `apps/web/src/` by `map/maplibre.ts` (the ride
 * map) and by `world-data/corridor-source.ts` (the corridor read), and by
 * nothing else — never by anything under `game/`, which names no network at
 * all (ADR 0054 D-1.1). And the one URL that module is handed is
 * `readBasemapConfig(…).archiveUrl`: it holds no URL of its own, and
 * `main.tsx` builds the port with the configured basemap and nothing else.
 * `map/basemap.ts` §`styleOrigins` is the same shape for the map's style.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../../units/no-inline-units';

const SOURCE_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The modules permitted to import `pmtiles`, by path relative to `apps/web/src`. */
const PMTILES_IMPORTERS = [join('map', 'maplibre.ts'), join('world-data', 'corridor-source.ts')];

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
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        found.push({ path: relative(SOURCE_ROOT, path), source: readFileSync(path, 'utf8') });
      }
    }
  };
  walk(SOURCE_ROOT);
  return found;
}

/**
 * Every file that imports `pmtiles` at run time, statically or dynamically,
 * comments ignored. An `import type` is erased at compile time and names no
 * code, so `world-data/archive-testing.ts`' types do not count.
 */
function pmtilesImporters(files: readonly SourceFile[]): string[] {
  const pattern = /(?:from\s+|import\s*\(\s*|import\s+)['"]pmtiles(?:\/[^'"]*)?['"]/;
  const typeOnly = /import\s+type\s+\{[^}]*\}\s+from\s+['"]pmtiles['"]/g;
  return files
    .filter((file) => pattern.test(stripComments(file.source).replace(typeOnly, '')))
    .map((file) => file.path)
    .sort();
}

/** What the scan says is wrong with a tree: an importer outside the list, or one under `game/`. */
function pmtilesFindings(files: readonly SourceFile[]): string[] {
  return pmtilesImporters(files)
    .filter((path) => !PMTILES_IMPORTERS.includes(path) || path.startsWith(`game${sep}`))
    .map((path) => `${path} imports pmtiles; only ${PMTILES_IMPORTERS.join(' and ')} may`);
}

describe('pmtiles is named by the map and the corridor read, and nothing else', () => {
  const tree = productSources();

  it('has source to scan, and finds the two that do import it', () => {
    expect(tree.length).toBeGreaterThan(100);
    expect(pmtilesImporters(tree)).toStrictEqual([...PMTILES_IMPORTERS].sort());
  });

  it('is clean over the tree', () => {
    expect(pmtilesFindings(tree)).toStrictEqual([]);
  });

  it('goes red for a second importer, under game/ or anywhere else', () => {
    const fixtures: SourceFile[] = [
      ...tree,
      {
        path: join('game', 'world-data', 'fixture.ts'),
        source: "import { PMTiles } from 'pmtiles';",
      },
      { path: join('routes', 'fixture.ts'), source: "const p = await import('pmtiles');" },
    ];
    expect(pmtilesFindings(fixtures)).toHaveLength(2);
  });

  it('is not fooled by a comment that names it', () => {
    expect(
      pmtilesImporters([
        { path: 'x.ts', source: "// import { PMTiles } from 'pmtiles';\nconst a = 1;" },
      ]),
    ).toStrictEqual([]);
  });
});

describe('the corridor read is handed readBasemapConfig’s archiveUrl and holds no URL of its own', () => {
  const read = (path: string): string =>
    stripComments(readFileSync(join(SOURCE_ROOT, path), 'utf8'));

  it('names no origin in the reader module', () => {
    const source = read(join('world-data', 'corridor-source.ts'));
    expect(source).not.toMatch(/['"`]https?:/);
    expect(source).not.toMatch(/['"`]\/\//);
    // The one URL it reads from is the configuration's.
    expect(source).toMatch(/archiveSource\(config\.archiveUrl\)/);
  });

  it('is built in main.tsx from the configured basemap and the one reader', () => {
    const main = read('main.tsx');
    const builder = main.slice(
      main.indexOf('function buildWorldCorridorPort('),
      main.indexOf('function buildWorkoutPort('),
    );
    expect(builder).toMatch(/lazyWorldCorridorPort\(\{/);
    expect(builder).toMatch(/basemap: browserBasemapConfig,/);
    // The lazy port's archive is the one reader's, and nothing else.
    const lazy = read(join('world-data', 'corridor-lazy.ts'));
    expect(lazy).toMatch(/archive: source\.corridorArchive/);
    expect(lazy.match(/archive:/g)).toHaveLength(1);
    expect(builder).toMatch(/mapTilesOn: \(\) => readMapTilesChoice\(deviceStorage\(\)\)/);
  });
});
