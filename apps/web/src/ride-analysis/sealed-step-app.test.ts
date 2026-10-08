// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **No shipped module of the app seals a step** — the app's half of
 * `@onyourleft/analysis`'s `sealed-step.test.ts` rule that only the runner
 * names `sealStep` (#803). #1094 moved the runner and the sealer into that
 * package, whose own test holds the rule there; the package hands `sealStep`
 * to tests through `@onyourleft/analysis/testing` only, so this scan is what
 * stops a shipped module here importing it from there.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SOURCE_ROOT } from '../camera/import-walk-testing';
import { stripComments } from '../units/no-inline-units';

/** Every non-test production source under `src`, as paths relative to it. */
function productionSources(directory = SOURCE_ROOT): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return productionSources(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$|-testing\.tsx?$/.test(entry.name)
      ? [relative(SOURCE_ROOT, path)]
      : [];
  });
}

/** The production modules whose code names `sealStep`. */
function sealers(paths: readonly string[], read: (path: string) => string): string[] {
  return paths.filter((path) => /\bsealStep\b/.test(stripComments(read(path))));
}

describe('no shipped module of the app seals a step', () => {
  const read = (path: string): string => readFileSync(join(SOURCE_ROOT, path), 'utf8');

  it('has sources to scan', () => {
    expect(productionSources().length).toBeGreaterThan(100);
  });

  it('names sealStep in no production module', () => {
    expect(sealers(productionSources(), read)).toStrictEqual([]);
  });

  it('would notice a module that sealed a step of its own', () => {
    const planted: Record<string, string> = {
      [join('views', 'Planted.tsx')]:
        "import { sealStep } from '@onyourleft/analysis/testing';\nsealStep(step);",
      [join('views', 'Clean.tsx')]: '// sealStep is named only in a comment here',
    };
    expect(sealers(Object.keys(planted), (path) => planted[path] ?? '')).toStrictEqual([
      join('views', 'Planted.tsx'),
    ]);
  });
});
