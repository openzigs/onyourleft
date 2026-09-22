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

/**
 * ⚠️ SPIKE #457, on `spike/issue-457-realism-on-the-device-floor` ONLY — a
 * branch that is never merged. The realism spike draws with three directly
 * (HDRI, PMREM, skinned meshes, post-processing), none of which the product's
 * seam offers, and it is a harness page that ships in nothing: it is built only
 * by `vite.browser.config.ts`. The exemption is one directory, named, and the
 * test below still fails for any other importer — `would notice a second
 * importer outside the spike` is what says so.
 */
const SPIKE_457 = 'apps/web/browser/realism/';
const inSpike457 = (file: string): boolean => file.startsWith(SPIKE_457);

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
      .filter((file) => !inSpike457(file))
      .filter((file) => IMPORTS_THREE.test(readFileSync(join(repositoryRoot, file), 'utf8')));

    expect(importers).toEqual([THE_SEAM]);
  });

  it('would notice a second importer outside the spike — #457’s exemption is one directory', () => {
    const exempt = inSpike457;
    expect(exempt('apps/web/browser/realism/view.ts')).toBe(true);
    expect(exempt('apps/web/browser/realism-harness.ts')).toBe(false);
    expect(exempt('apps/web/browser/game-harness.ts')).toBe(false);
    expect(exempt('apps/web/src/game/scene.ts')).toBe(false);
  });

  it('holds the spike to the product’s two lamps, and keeps it out of the product — #457', () => {
    // ⚠️ SPIKE BRANCH ONLY. The exemption above is a WEAKENING of the
    // one-importer rule and is stated as one: a spike that measures an HDRI,
    // PMREM, a skinned mesh and a bloom pass cannot draw through a seam that
    // offers none of them without widening `three-renderer.ts` itself, which
    // would change the product. What it must NOT do is widen the other two
    // rules, so both are held over the exempt files as well:
    const spike = files.filter(inSpike457);
    expect(spike.length).toBeGreaterThan(0);
    // (1) no illumination class beyond the decided pair — image-based light
    // from an HDRI is `scene.environment`, not a lamp, and needs no new class;
    const decided = new Set(['AmbientLight', 'DirectionalLight']);
    const lamps = spike.flatMap((file) =>
      [
        ...new Set(
          readFileSync(join(repositoryRoot, file), 'utf8').match(/[A-Za-z]*Light[A-Za-z]*/g) ?? [],
        ),
      ]
        .filter((name) => !decided.has(name))
        .map((name) => `${file}: ${name}`),
    );
    expect(lamps).toEqual([]);
    // (2) and nothing the product builds may reach the spike, so the exemption
    // can never carry `three` into a shipped module.
    const reachesSpike = /['"][^'"]*browser\/realism(?:\/|-harness|['"])/;
    const leaks = files
      .filter((file) => file.startsWith('apps/web/src/') || file.startsWith('packages/'))
      .filter((file) => file !== THIS_FILE)
      .filter((file) => reachesSpike.test(readFileSync(join(repositoryRoot, file), 'utf8')));
    expect(leaks).toEqual([]);
    expect(reachesSpike.test("import { x } from '../../browser/realism/view';")).toBe(true);
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

  it('lets only the sun and the riders cast a shadow, and only the catcher receive one — #426', () => {
    // #426 asked whether this file should see shadow state as well as lamps,
    // since a shadow map adds no light class and would slip past the two
    // tests above. **It should**, and this is the decision: a `castShadow`
    // left on the scenery is a second render of every tree on every frame,
    // and nothing else here would notice it. So every write is counted:
    //
    // | write | where | count |
    // |---|---|---|
    // | `.castShadow =` | `WorldLamps.setCasting` (the sun) and `RiderBelt.setCasting` | 2 |
    // | `.receiveShadow =` | the shadow catcher, in `ThreeGameView`'s constructor | 1 |
    // | `shadowMap.enabled =` | `ThreeGameView.#applyRiderShadows`, from the rung | 1 |
    //
    // ⚠️ A count, so a third caster is a red test whoever edited it — and the
    // BEHAVIOUR (the belt never casts; the riders cast on the map rung only) is
    // `three-renderer.test.ts`'s, which this cannot see.
    const renderer = readFileSync(join(repositoryRoot, THE_SEAM), 'utf8');
    expect(shadowState(renderer)).toEqual({
      castShadow: { mentions: 2, assignments: 2 },
      receiveShadow: { mentions: 1, assignments: 1 },
      shadowMap: { mentions: 1, assignments: 1 },
    });

    const elsewhere = files
      .filter((file) => file !== THE_SEAM && file !== THIS_FILE)
      .filter((file) => writesShadowState(file, readFileSync(join(repositoryRoot, file), 'utf8')));
    expect(elsewhere).toEqual([]);
  });

  it('would notice shadow state written any other way — #455', () => {
    // ⚠️ **#448's review found the count above matched ASSIGNMENTS only**, so
    // `Object.assign(mesh, { castShadow: true })` or `mesh['castShadow'] = true`
    // was a third caster the test could not see. It now counts every MENTION of
    // the three names in the file's code — comments stripped, strings kept —
    // and requires each to be one of the assignments. So this states the
    // property over copies of the file with a write in each spelling, the move
    // `would notice a third lamp` makes for the lamps.
    const renderer = readFileSync(join(repositoryRoot, THE_SEAM), 'utf8');
    const clean = shadowState(renderer);
    for (const spelling of [
      'Object.assign(mesh, { castShadow: true });',
      "mesh['castShadow'] = true;",
      'const { receiveShadow } = mesh;',
      "renderer['shadowMap'].enabled = true;",
      'Object.assign(renderer.shadowMap, { enabled: true });',
    ]) {
      expect(shadowState(`${renderer}\n${spelling}\n`), spelling).not.toEqual(clean);
    }
    // ⚠️ And in any other file, where production code may not write it at all.
    for (const spelling of [
      'Object.assign(mesh, { castShadow: true });',
      "mesh['receiveShadow'] = true;",
      'renderer.shadowMap.enabled = true;',
      "renderer['shadowMap'].enabled = true;",
      'Object.assign(renderer.shadowMap, { enabled: true });',
    ]) {
      expect(writesShadowState('apps/web/src/game/scene.ts', spelling), spelling).toBe(true);
    }
    // A test READING the flag is not a write.
    expect(writesShadowState('x.test.ts', 'expect(mesh.castShadow).toBe(true);')).toBe(false);
  });
});

/**
 * How often each piece of shadow state is MENTIONED in a file's code, and how
 * often as a plain assignment — #455.
 *
 * ⚠️ **Mentions, not assignments, are what fail closed.** A mention that is
 * not one of the counted assignments is a write in some other spelling —
 * `Object.assign`, a computed key, a destructure feeding one — or a read, and
 * either is a change to this file somebody should look at. Comments are
 * stripped first so that prose may name the flags; strings are NOT, because a
 * computed key is a string.
 *
 * ⚠️ **What it still cannot see, stated rather than hidden:** a name built at
 * run time (`'cast' + 'Shadow'`), and a write made through a helper imported
 * from another file — which `writesShadowState` below catches only when that
 * file spells the name.
 */
function shadowState(text: string): Record<string, { mentions: number; assignments: number }> {
  const code = withoutComments(text);
  const count = (pattern: RegExp): number => code.match(pattern)?.length ?? 0;
  return {
    castShadow: {
      mentions: count(/\bcastShadow\b/g),
      assignments: count(/\.castShadow\s*=(?!=)/g),
    },
    receiveShadow: {
      mentions: count(/\breceiveShadow\b/g),
      assignments: count(/\.receiveShadow\s*=(?!=)/g),
    },
    shadowMap: {
      mentions: count(/\bshadowMap\b/g),
      assignments: count(/\.shadowMap\.enabled\s*=(?!=)/g),
    },
  };
}

/**
 * Whether a file other than the seam writes shadow state in any spelling.
 *
 * ⚠️ A test file may READ the flags — `contact-shadow.test.ts` does, through a
 * type literal whose `castShadow: boolean` is shaped exactly like an
 * `Object.assign` payload — so the object-literal and computed-key spellings
 * are held against production code only. The plain assignment is held against
 * every file, as it was before #455.
 */
function writesShadowState(file: string, text: string): boolean {
  const code = withoutComments(text);
  if (/\.(?:castShadow|receiveShadow)\s*=(?!=)|\.shadowMap\.enabled\s*=(?!=)/.test(code)) {
    return true;
  }
  if (/\.test\.tsx?$/.test(file)) {
    return false;
  }
  // `['shadowMap']` only where `enabled` follows: `Window['__oylGameHarness']
  // ['shadowMap']` is a TYPE in the browser harness, and names a measurement.
  return /\b(?:castShadow|receiveShadow)\s*:|\[\s*['"`](?:castShadow|receiveShadow)['"`]\s*\]|\[\s*['"`]shadowMap['"`]\s*\]\s*(?:\.|\[\s*['"`])enabled\b|shadowMap\s*,\s*\{\s*enabled\b/.test(
    code,
  );
}

/** A file's text with its comments blanked. Naive about `//` inside a string, which only blanks more. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
