// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The realistic world is not offered to a rider — [ADR 0026](../../../../docs/adr/0026-realistic-game-world.md)
 * D-12, until [#475](https://github.com/openzigs/onyourleft/issues/475).
 *
 * > *"The realistic world is reachable only from a harness page under
 * > `apps/web/browser/` — built by `vite.browser.config.ts`, which can never
 * > ship — and from no control in the shipped app, until layers 1–3 have
 * > landed."*
 *
 * Layers 1, 2 and 4 are in the product now — the code, and the assets inside
 * `dist` and so inside the APK — and layer 3 is not. So the one thing standing
 * between a rider and a half-built world is that **no module the product ships
 * reaches for it**, and a review note would be the wrong guard for that. This
 * reads every production source file under `apps/` and fails if anything but
 * the modules that DEFINE the realistic path names the way into it: the
 * realistic ladder, the loader, the two-ladder policy, or a rung whose world is
 * `'realistic'`.
 *
 * ⚠️ **What it deliberately allows**: the harness pages and the tools, which
 * are not in the product build; tests; and the defining modules themselves.
 * `three-renderer.ts` is a defining module because ADR 0026 D-10 puts both
 * renderer paths there, and it is reached from `main.tsx` — which is exactly
 * why a caller is what this scans for rather than an import.
 *
 * When #475 offers the world to riders, this test is what that pull request
 * changes, on purpose, with the offer's own tests beside it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const APPS = fileURLToPath(new URL('../../../', import.meta.url));

/** The modules that define the realistic path, and so may name it. */
const DEFINING = new Set([
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

describe('the realistic world is offered to no rider yet — ADR 0026 D-12', () => {
  const files = productionSources();

  it('finds the product’s sources, the game and the app entry among them', () => {
    // A walk that found nothing would pass every assertion below.
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('web/src/main.tsx');
    expect(files).toContain('web/src/game/GameView.tsx');
  });

  it('lets no module the product ships reach for the realistic world', () => {
    const offenders = files
      .filter((file) => !DEFINING.has(file))
      .flatMap((file) =>
        waysInOf(readFileSync(join(APPS, file), 'utf8')).map((way) => `${file}: ${way}`),
      );
    expect(offenders).toEqual([]);
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
