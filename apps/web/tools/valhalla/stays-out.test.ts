// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The measurement page is dev-only (#2320), and since #2734 the router reaches
 * a rider's build through exactly one module: `src/routing/valhalla-browser-provider.ts`,
 * which loads it with a dynamic `import()` on the first leg it routes. Any
 * other file under `src/` that reaches the package, and anything that reaches
 * this directory, is a failure.
 *
 * A source scan, so it is a tripwire and not a proof: it sees an import of
 * `valhalla-browser`, or of this directory, in a file under `src/` or in the
 * product's Vite config, and nothing a bundler could reach some other way.
 * The product build's own `copied-into-build` check would also refuse the
 * WebAssembly as an unlisted asset from a package.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** An import, a side-effect import or a dynamic import of the package, or of `tools/valhalla`. */
const REACHES =
  /(?:from\s+|import\s*\(\s*|import\s+)['"](?:valhalla-browser(?:\/[^'"]*)?|[./]*(?:\.\.\/)*tools\/valhalla[^'"]*)['"]/;

function sources(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx|js|mjs)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** The one product module admitted to the SDK (#2734). */
const ADMITTED = 'routing/valhalla-browser-provider.ts';

/** This directory, by any relative path. */
const REACHES_TOOLS =
  /(?:from\s+|import\s*\(\s*|import\s+)['"][./]*(?:\.\.\/)*tools\/valhalla[^'"]*['"]/;

describe('the in-browser Valhalla measurement stays out of the product', () => {
  it('is reached by one file under src/, the routing adapter, and that one by a dynamic import only', () => {
    const files = sources(join(WEB, 'src'));
    expect(files.length).toBeGreaterThan(100);
    const reaching = files
      .filter((file) => REACHES.test(readFileSync(file, 'utf8')))
      .map((file) => relative(join(WEB, 'src'), file).split(sep).join('/'));
    expect(reaching).toEqual([ADMITTED]);
    const adapter = readFileSync(join(WEB, 'src', ADMITTED), 'utf8');
    // A static import would put the SDK in the chunk that imports the adapter.
    expect(adapter).not.toMatch(/(?:from\s+|import\s+)['"]valhalla-browser/);
    expect(adapter).toMatch(/import\(\s*['"]valhalla-browser['"]\s*\)/);
    expect(files.filter((file) => REACHES_TOOLS.test(readFileSync(file, 'utf8')))).toEqual([]);
  });

  it('is reached by neither the product’s Vite config nor its index.html', () => {
    expect(REACHES.test(readFileSync(join(WEB, 'vite.config.ts'), 'utf8'))).toBe(false);
    expect(readFileSync(join(WEB, 'index.html'), 'utf8')).not.toContain('valhalla');
  });

  it('would see an import of the package or of this directory', () => {
    expect(REACHES.test("import { Router } from 'valhalla-browser';")).toBe(true);
    expect(REACHES.test("import 'valhalla-browser/worker.js';")).toBe(true);
    expect(REACHES.test("const url = await import('valhalla-browser/worker.js?url');")).toBe(true);
    expect(
      REACHES.test("import { runMeasurement } from '../../tools/valhalla/measure/measure';"),
    ).toBe(true);
    expect(REACHES.test("import { route } from './valhalla-routing';")).toBe(false);
  });
});
