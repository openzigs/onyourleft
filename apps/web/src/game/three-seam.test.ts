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
 * ## And exactly two lamps, which is a separate claim
 *
 * ⚠️ **This section used to say "no illumination", and the test below used to
 * require that `three-renderer.ts` contain no `Light` at all. A reviewer who
 * remembers that is reading the old file.** #241 shipped the scene unlit and
 * #286 gave it a sun, because the sentence the old rule protected —
 * *"no lighting means no light budget"* — was a performance claim with no
 * measurement behind it, and ADR 0008 D-2's rendering gate had been waived
 * rather than passed.
 *
 * What has **not** changed is why the rule exists: adding a lamp is a real
 * decision with a real cost on the device floor ADR 0008 D-4 names, so it
 * should be a decision somebody takes rather than a line somebody adds. So the
 * rule is now an allowlist of exactly the two that were decided on — an
 * `AmbientLight` and a `DirectionalLight` — and it fails exactly as closed: a
 * third lamp, a light probe, a spot light or a hemisphere light is a name that
 * is not in the pair and the build stops.
 *
 * ⚠️ It still matches by **shape** rather than by a list of three's own class
 * names, so a lamp this file's author never heard of is caught with the ones
 * they have. `LightProbe` matches neither `[A-Za-z]Light\b` nor `\bLight\(`
 * — no letter before, no word boundary after — and nor does
 * `HemisphereLightHelper`; every illumination class three exports carries the
 * capitalised word somewhere in its name, so that is the whole rule.
 *
 * It therefore also trips on a capitalised `Light` in prose, and that is the
 * right trade: the fix is to lowercase a word, and the rule fails closed.
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

  it('names exactly the two illumination classes #286 decided on', () => {
    // #241's criterion as #286 revised it, and the one that would otherwise be
    // checked by a reviewer running a grep by hand.
    //
    // ⚠️ **Every capitalised `Light` in the file, including the ones in
    // prose.** That is what makes the rule fail closed rather than merely
    // describing the imports: a `SpotLight` mentioned in a comment as "we
    // could also add a SpotLight" is a name in this set and goes red, and the
    // fix is to lowercase the word. See the header for why the shape rather
    // than three's own class list.
    const renderer = readFileSync(join(repositoryRoot, THE_SEAM), 'utf8');
    const named = [...new Set(renderer.match(/[A-Za-z]*Light[A-Za-z]*/g) ?? [])].sort();

    expect(named).toEqual(['AmbientLight', 'DirectionalLight']);
  });

  it('would notice a third lamp', () => {
    // ⚠️ The test above is an equality against a list, which is exactly the
    // shape that can be "fixed" by pasting a new name into the expectation. So
    // this one states the *property* the list is standing in for, over a copy
    // of the file with one more lamp in it: anything matching the shape and
    // not in the decided pair is a violation, whoever edited the expectation.
    const renderer = readFileSync(join(repositoryRoot, THE_SEAM), 'utf8');
    const decided = new Set(['AmbientLight', 'DirectionalLight']);
    const extra = (text: string): readonly string[] =>
      [...new Set(text.match(/[A-Za-z]*Light[A-Za-z]*/g) ?? [])].filter(
        (name) => !decided.has(name),
      );

    expect(extra(renderer)).toEqual([]);
    expect(extra(`${renderer}\nconst lamp = new SpotLight(0xffffff, 1);\n`)).toEqual(['SpotLight']);
  });
});
