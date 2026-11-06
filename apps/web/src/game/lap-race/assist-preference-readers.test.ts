// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The lap race's assisted setting stays on the device — #1905: only the
 * Settings screen and the lap race's own modules read it, and its stored key
 * is named in one module, both derived from the client's own tree (Delivery's
 * test for #1813, applied here). A node-environment file of its own, because
 * the tree is read from disk and `assist-preference.test.ts` runs in jsdom
 * for the device's `localStorage`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const THIS_MODULE = fileURLToPath(new URL('./assist-preference.ts', import.meta.url));

/** Every shipped source file under `apps/web/src`: no test, and no `*-testing.ts` support. */
function shippedSources(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...shippedSources(path));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name) &&
      !/-testing\.tsx?$/.test(entry.name)
    ) {
      found.push(path);
    }
  }
  return found;
}

/** Every relative module a source names: `import … from`, `export … from` and `import('…')`. */
function relativeImports(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  return [
    ...text.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g),
    ...text.matchAll(/\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g),
    ...text.matchAll(/\bimport\s+['"](\.[^'"]+)['"]/g),
  ].map((match) => resolve(dirname(path), match[1] ?? ''));
}

describe('the setting stays on the device and changes nothing on any other ride — #1905', () => {
  const sources = shippedSources(SOURCE_ROOT);

  it('walks the client’s own tree, not an empty one', () => {
    expect(sources.length).toBeGreaterThan(300);
    expect(sources).toContain(THIS_MODULE);
  });

  it('is read only by the Settings screen and by the lap race’s own modules', () => {
    const target = THIS_MODULE.replace(/\.ts$/, '');
    const readers = sources
      .filter((path) => path !== THIS_MODULE)
      .filter((path) =>
        relativeImports(path).some((name) => name === target || name === THIS_MODULE),
      )
      .map((path) => relative(SOURCE_ROOT, path).split('\\').join('/'));
    expect(readers).toContain('views/SettingsView.tsx');
    expect(readers.filter((path) => !path.startsWith('game/lap-race/'))).toEqual([
      'views/SettingsView.tsx',
    ]);
  });

  it('keeps its stored key in this module alone, so nothing reads the storage around it', () => {
    const naming = sources
      .filter((path) => readFileSync(path, 'utf8').includes('oyl.game.lap-race.assist'))
      .map((path) => relative(SOURCE_ROOT, path).split('\\').join('/'));
    expect(naming).toEqual(['game/lap-race/assist-preference.ts']);
  });
});
