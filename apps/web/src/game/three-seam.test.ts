// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `three-renderer.ts` is the only file in this repository that names `three`.
 *
 * ## Why a test and not a review note
 *
 * `game/port.ts` exists so that the rendering library can be replaced without
 * touching the simulation, the corridor, the quality ladder or the HUD — and
 * ADR 0008 D-2 records a fallback that would keep every leaf package and
 * replace exactly that one file. A seam that is only a convention is a seam
 * that erodes: the second import is always the easy one, because the first file
 * already proved the library works.
 *
 * #240's epic-level criterion asks for this to be *"asserted by a test or a
 * grep in CI, not by review"*. This is that test, and it runs in the ordinary
 * suite rather than needing a CI step of its own.
 *
 * ## And no illumination, which is a separate claim
 *
 * #241 gave the scene a ground, a sky and fog, and deliberately **no lamp of
 * any kind**: `three-renderer.ts` says *"flat-shaded on purpose: no lighting
 * means no light budget"*, and every material in it is a `MeshBasicMaterial`,
 * which is unlit by definition. Adding a lamp would be a real decision with a
 * real cost on the device floor ADR 0008 D-4 names, so it should be a decision
 * somebody takes rather than a line somebody adds.
 *
 * ⚠️ The test below therefore greps for three's illumination classes, and it
 * deliberately spells them by **suffix** rather than by name, so that a lamp
 * this file's author never heard of is caught too.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/** The one file allowed to import the rendering library. */
const THE_SEAM = 'apps/web/src/game/three-renderer.ts';

/**
 * This file.
 *
 * ⚠️ It is excluded because it quotes the import specifier it is looking for,
 * which would otherwise make it its own first violation. Nothing else is
 * excluded, and an exclusion list of one is the point: the moment it needs a
 * second entry, somebody is arguing for a second importer.
 */
const THIS_FILE = 'apps/web/src/game/three-seam.test.ts';

/** Trees that are generated, installed or built rather than written. */
const NOT_SOURCE = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', 'android']);

const SOURCE_EXTENSIONS = /\.(?:[cm]?js|jsx|tsx?)$/;

/**
 * Every spelling of reaching for the rendering library, in either quote.
 *
 * ⚠️ **Four, not two.** A static `from 'three'` and a `require('three')` were
 * the only ones matched at first, and they miss the two a second importer here
 * is most likely to actually use: **`await import('three')`**, which is the
 * idiomatic spelling in this codebase because `GameView.tsx` already lazy-loads
 * the renderer to keep `three` out of the entry chunk (#240's NFR-4), and a
 * bare side-effect `import 'three'`. A seam test that misses the idiomatic
 * spelling is a seam test that passes while the seam erodes.
 */
const THREE_SPECIFIER = String.raw`['"]three(?:\/[^'"]*)?['"]`;
const IMPORTS_THREE = new RegExp(
  [
    String.raw`\bfrom\s+${THREE_SPECIFIER}`,
    String.raw`\brequire\(\s*${THREE_SPECIFIER}`,
    // `import('three')` — dynamic, with or without `await`.
    String.raw`\bimport\(\s*${THREE_SPECIFIER}`,
    // `import 'three'` — a side-effect import, which has no `from`.
    String.raw`\bimport\s+${THREE_SPECIFIER}`,
  ].join('|'),
);

/** Every source file under `apps/` and `packages/`, repository-relative. */
function sourceFiles(): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (NOT_SOURCE.has(entry.name)) {
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (SOURCE_EXTENSIONS.test(entry.name)) {
        found.push(relative(repositoryRoot, path));
      }
    }
  };
  walk(join(repositoryRoot, 'apps'));
  walk(join(repositoryRoot, 'packages'));
  return found;
}

describe('the rendering seam', () => {
  const files = sourceFiles();

  it('finds a source tree to search at all', () => {
    // A walk that found nothing would make every assertion below vacuous, which
    // is the one way a rule like this fails silently.
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(THE_SEAM);
  });

  it('has exactly one file importing three', () => {
    const importers = files
      .filter((file) => file !== THIS_FILE)
      .filter((file) => IMPORTS_THREE.test(readFileSync(join(repositoryRoot, file), 'utf8')));

    expect(importers).toEqual([THE_SEAM]);
  });

  it('adds no illumination to the scene', () => {
    // #241's own criterion, and the one that would otherwise be checked by a
    // reviewer running a grep by hand. Matched by shape so that a lamp class
    // nobody here has heard of is caught with the ones they have.
    //
    // ⚠️ The suffix forms alone (`[A-Za-z]Light\b`, `\bLight\(`) have a gap in
    // three's own class list: `LightProbe` matches neither — there is no letter
    // before `Light` and no word boundary after it — and nor does
    // `HemisphereLightHelper`. Every illumination class three exports carries
    // the capitalised word somewhere in its name, so that is the whole rule.
    //
    // It therefore also trips on a capitalised `Light` in prose, and that is
    // the right trade: the fix is to lowercase a word, and the rule fails
    // closed. The comment on `ROAD_COLOUR` says *"no lighting means no light
    // budget"* in lower case for that reason.
    const renderer = readFileSync(join(repositoryRoot, THE_SEAM), 'utf8');

    expect(renderer).not.toMatch(/Light/);
  });
});
