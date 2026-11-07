// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The measurement page is dev-only (#2320): the router reaches no rider's
 * build until snapping ships as a product change of its own (#2009).
 *
 * A source scan, so it is a tripwire and not a proof: it sees an import of
 * `valhalla-browser`, or of this directory, in a file under `src/` or in the
 * product's Vite config, and nothing a bundler could reach some other way.
 * The product build's own `copied-into-build` check would also refuse the
 * WebAssembly as an unlisted asset from a package.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

describe('the in-browser Valhalla measurement stays out of the product', () => {
  it('is reached by no file under src/', () => {
    const files = sources(join(WEB, 'src'));
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter((file) => REACHES.test(readFileSync(file, 'utf8')))).toEqual([]);
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
