// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The realistic world is offered to a rider ONLY through their own choice —
 * [ADR 0026](../../../../docs/adr/0026-realistic-game-world.md) D-3 and D-12,
 * since [#475](https://github.com/openzigs/onyourleft/issues/475).
 *
 * ⚠️ **Until #475 this file said the opposite**, and a reviewer who remembers
 * *"the realistic world is offered to no rider yet"* is reading the old file:
 * it failed the build if any module the product ships named a way into the
 * realistic path, because layer 3 had not landed. It has (#481), the
 * twenty-minute soak has been run (validation 0002 Part Z), and #475 is the
 * pull request its own header said would change this, on purpose, with the
 * offer's tests beside it (`realistic-choice.test.tsx`).
 *
 * What it guards now is the SHAPE of the offer, which D-3 fixes: *"chosen by
 * the rider … and never entered by the thermal logic on its own"*, and the
 * default the stylised world on every device. So:
 *
 * - **One caller.** Outside the modules that DEFINE the realistic path, only
 *   `GameView.tsx` may name a way in, and it does so behind
 *   `world-preference.ts` — which `realistic-choice.test.tsx` holds
 *   behaviourally: no choice, no load, no realistic rung. A second caller —
 *   a screen that loaded the world on a first visit, say, which D-7 forbids —
 *   is a red build here rather than a review note.
 * - **Off by default.** Nothing stored, a store that throws, and any value but
 *   the one `world-preference.ts` writes all read as "no".
 *
 * ⚠️ **What it deliberately allows**: the harness pages and the tools, which
 * are not in the product build; tests; and the defining modules themselves.
 * `three-renderer.ts` is a defining module because ADR 0026 D-10 puts both
 * renderer paths there, and it is reached from `main.tsx` — which is exactly
 * why a caller is what this scans for rather than an import.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { readRealisticWorldChoice, REALISTIC_WORLD_STORAGE_KEY } from './world-preference';

const APPS = fileURLToPath(new URL('../../../', import.meta.url));

/** The one module the product ships that may offer it, behind the rider's choice. */
const OFFERED_FROM = 'web/src/game/GameView.tsx';

/** The modules that define the realistic path, and so may name it. */
const DEFINING = new Set([
  // The seam: it DECLARES `GameRenderer.loadRealisticWorld` so the renderer can
  // be asked, and calls nothing.
  'web/src/game/port.ts',
  'web/src/game/quality.ts',
  'web/src/game/three-renderer.ts',
  'web/src/game/realistic-assets.ts',
]);

/** The ways in, by name — and a rung spelled out by hand. */
const WAYS_IN: readonly RegExp[] = [
  /\bREALISTIC_LADDER\b/,
  /\bINITIAL_REALISTIC_QUALITY\b/,
  /\bnextWorldQuality\b/,
  /\bworldRung\b/,
  /\bloadRealisticWorld\b/,
  /\brealisticWorldNotice\b/,
  /\bdrawnWorldOf\b/,
  /\bworld:\s*['"]realistic['"]/,
];

/** Every production source file under each app's `src/`, `apps/`-relative. */
function productionSources(): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name) &&
        !/-testing\.ts$/.test(entry.name)
      ) {
        found.push(relative(APPS, path));
      }
    }
  };
  for (const app of readdirSync(APPS, { withFileTypes: true })) {
    const source = join(APPS, app.name, 'src');
    if (app.isDirectory()) {
      try {
        walk(source);
      } catch {
        // An app with no `src/` has nothing to ship from it.
      }
    }
  }
  return found;
}

/**
 * Which of `WAYS_IN` a text's CODE names, as their sources. Comments are
 * blanked first: a note saying where the way in is, like the `@unwired` reasons
 * beside the realistic path, is not a way in.
 */
function waysInOf(text: string): readonly string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return WAYS_IN.filter((pattern) => pattern.test(code)).map((pattern) => pattern.source);
}

describe('the realistic world is offered only through the rider’s choice — ADR 0026 D-3, #475', () => {
  const files = productionSources();

  it('finds the product’s sources, the game and the app entry among them', () => {
    // A walk that found nothing would pass every assertion below.
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('web/src/main.tsx');
    expect(files).toContain('web/src/game/GameView.tsx');
  });

  it('lets no module the product ships reach for the realistic world but the one that offers it', () => {
    const offenders = files
      .filter((file) => !DEFINING.has(file) && file !== OFFERED_FROM)
      .flatMap((file) =>
        waysInOf(readFileSync(join(APPS, file), 'utf8')).map((way) => `${file}: ${way}`),
      );
    expect(offenders).toEqual([]);
  });

  it('is offered from exactly one place, and that place reads the rider’s choice', () => {
    // The allowance above is not vacuous: the one module it exempts does reach
    // for the realistic world, and does it next to the choice. Deleting the
    // offer turns the first half red; deleting the read, the second.
    const offer = readFileSync(join(APPS, OFFERED_FROM), 'utf8');
    expect(waysInOf(offer)).not.toEqual([]);
    expect(offer).toMatch(/\breadRealisticWorldChoice\(/);
  });

  it('is off unless the device holds exactly the choice the setting writes', () => {
    const holding = (value: string | null) => ({
      getItem: (key: string) => (key === REALISTIC_WORLD_STORAGE_KEY ? value : null),
      setItem: () => undefined,
    });
    expect(readRealisticWorldChoice(undefined)).toBe(false);
    expect(readRealisticWorldChoice(holding(null))).toBe(false);
    expect(readRealisticWorldChoice(holding('off'))).toBe(false);
    expect(readRealisticWorldChoice(holding('true'))).toBe(false);
    expect(
      readRealisticWorldChoice({
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => undefined,
      }),
    ).toBe(false);
    expect(readRealisticWorldChoice(holding('on'))).toBe(true);
  });

  it('would notice the rider being offered it', () => {
    // The property, stated over the kind of line that would offer it, so the
    // list above cannot be satisfied by an empty pattern set.
    expect(waysInOf("import { REALISTIC_LADDER } from './quality';")).not.toEqual([]);
    expect(waysInOf('await renderer.loadRealisticWorld();')).not.toEqual([]);
    expect(waysInOf("setQuality({ ...rung, world: 'realistic' });")).not.toEqual([]);
    expect(waysInOf('const quality = qualitySettings(0);')).toEqual([]);
    // A comment naming it is a note, not a way in.
    expect(waysInOf('/** @unwired read by `loadRealisticWorld` */ const x = 1;')).toEqual([]);
    expect(waysInOf('// see REALISTIC_LADDER\nconst x = 1;')).toEqual([]);
  });
});
