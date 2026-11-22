// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Junction choice cannot reach the trainer**: ADR 0088 D-5.2, held as a red
 * test (#2897).
 *
 * A turn press changes which road the rolling route appends, and nothing else
 * (D-5.1). This walks the static import graph from every non-test module of
 * the open-world mode, which D-5.2 defines as every module of the
 * junction-choice input and its prompt, and every non-test module under the
 * mode's own directories ({@link OPEN_WORLD_ROOTS}), and fails, naming the
 * chain, when one reaches the forbidden set: the trainer-command seam read
 * off `scripts/check-wiring.mjs`, every trainer-control writer the #1807 rules
 * find, `game/trainer-port.ts`, `game/gradient.ts` and `ride/trainer.ts`.
 *
 * **The walk is shared, not copied**: `../cannot-reach-trainer-testing.ts`,
 * as Delivery's and the lap race's tests call it. Its own cases (every import
 * spelling, barrels, workers, failing closed on what it cannot follow) are in
 * Delivery's test; this file holds the open world's roots and D-5.2's three
 * plantings. The prompt and its on-screen symbols (#2898) live in the HUD,
 * beside the controls of every other mode, so they are named
 * ({@link PROMPT_MODULES}) rather than walked by directory.
 *
 * What it cannot see is a trainer reached at run time, through a value handed
 * in. That half is the behavioural ride in `junction-choice.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  forbiddenInTheTree,
  GAME_TRAINER_MODULES,
  modulesUnder,
  plantedOver,
  seamViolations,
  trainerCommandSeam,
  walk,
  WIRING_SOURCE,
  WRITERS_ON_DISK,
  writesToATrainer,
  type ReadSource,
} from '../cannot-reach-trainer-testing';

/** The mode's own directory in `apps/web` (ADR 0088 D-5.2). */
const WEB_ROOT = 'apps/web/src/game/open-world';

/**
 * Its modules in `packages/`, by name: the rolling route the choice swaps the
 * tail of (#2895). It lives beside `route/profile.ts` rather than in a
 * directory of the mode's own, so it is named rather than walked by directory.
 */
const PACKAGE_MODULES = ['packages/domain/src/route/rolling.ts'] as const;

/**
 * The junction prompt (#2898): its view, with the on-screen turn symbols of
 * D-3.1, its words and sentences, and the pad reader that hands it a pad's
 * turns. In `game/hud/`, so named.
 */
const PROMPT_MODULES = [
  'apps/web/src/game/hud/JunctionChoicePrompt.tsx',
  'apps/web/src/game/hud/junction-text.ts',
  'apps/web/src/game/hud/GamepadIntents.tsx',
] as const;

/** Every non-test module of the mode. A root directory that is not there throws. */
function openWorldModules(): string[] {
  return [...modulesUnder(WEB_ROOT), ...PACKAGE_MODULES, ...PROMPT_MODULES];
}

/** The roots that are themselves trainer-control writers, by the #1807 rules. */
function writingRoots(roots: readonly string[], read: ReadSource): string[] {
  return roots.filter((path) => {
    const code = read(path);
    if (code === undefined) throw new Error(`${path} names no file`);
    return writesToATrainer(code, path);
  });
}

/** The chains a planted module at `entry` reaches the forbidden set by. */
function plantedViolations(planted: Readonly<Record<string, string>>, entry: string): string[] {
  return seamViolations([entry], forbiddenInTheTree(), plantedOver(planted));
}

describe('junction choice cannot reach the trainer-command seam (ADR 0088 D-5.2, #2897)', () => {
  it('reaches no trainer module from any open-world module, by any static import chain', () => {
    expect(seamViolations(openWorldModules(), forbiddenInTheTree())).toEqual([]);
  });

  it('has no open-world module that is itself a trainer-control writer', () => {
    const read = plantedOver({});
    expect(writingRoots(openWorldModules(), read)).toEqual([]);
  });

  it('forbids the seam as check-wiring lists it, every writer found by rule, and the game’s three', () => {
    const forbidden = forbiddenInTheTree();
    for (const path of [...trainerCommandSeam(WIRING_SOURCE), ...GAME_TRAINER_MODULES]) {
      expect(forbidden).toContain(path);
    }
    expect(WRITERS_ON_DISK.length).toBeGreaterThan(0);
    for (const path of WRITERS_ON_DISK) {
      expect(forbidden).toContain(path);
    }
    for (const path of [
      'apps/web/src/game/trainer-port.ts',
      'apps/web/src/game/gradient.ts',
      'apps/web/src/ride/trainer.ts',
    ]) {
      expect(forbidden).toContain(path);
    }
  });

  it('reads files: the choice, its inputs and the rolling route are roots, and every root is visited', () => {
    const roots = openWorldModules();
    for (const path of [
      `${WEB_ROOT}/junction-choice.ts`,
      `${WEB_ROOT}/turn-input.ts`,
      'packages/domain/src/route/rolling.ts',
      ...PROMPT_MODULES,
    ]) {
      expect(roots).toContain(path);
    }
    const { modules } = walk(roots);
    for (const path of roots) {
      expect(modules, path).toContain(path);
    }
    expect(() => modulesUnder('apps/web/src/game/open-world-renamed')).toThrow(/ENOENT/);
  });

  it('is red for a root that imports game/gradient.ts', () => {
    const entry = `${WEB_ROOT}/planted-entry.ts`;
    const found = plantedViolations(
      {
        [entry]:
          "import { createGradientSession } from '../gradient';\nvoid createGradientSession;\n",
      },
      entry,
    );
    expect(found).toContain(`${entry} → apps/web/src/game/gradient.ts`);
  });

  it('is red for a root that imports a seam module, directly or through the domain barrel', () => {
    const entry = `${WEB_ROOT}/planted-entry.ts`;
    const seam = trainerCommandSeam(WIRING_SOURCE);
    expect(seam).toContain('packages/domain/src/trainer/simulation.ts');
    const found = plantedViolations(
      {
        [entry]:
          "import { createSimulationDriver } from '@onyourleft/domain';\nvoid createSimulationDriver;\n",
      },
      entry,
    );
    expect(found).toContain(
      `${entry} → packages/domain/src/index.ts → packages/domain/src/trainer/simulation.ts`,
    );
    // And through the existing turn input, so a hop is named.
    const input = `${WEB_ROOT}/turn-input.ts`;
    const read = plantedOver({});
    const original = read(input) as string;
    const throughInput = seamViolations(
      [input],
      forbiddenInTheTree(),
      plantedOver({
        [input]: `${original}\nimport { createSimulationDriver } from '@onyourleft/domain';\nvoid createSimulationDriver;\n`,
      }),
    );
    expect(throughInput).toContain(
      `${input} → packages/domain/src/index.ts → packages/domain/src/trainer/simulation.ts`,
    );
  });

  it('is red for the prompt importing game/gradient.ts', () => {
    const entry = 'apps/web/src/game/hud/JunctionChoicePrompt.tsx';
    const original = plantedOver({})(entry) as string;
    const found = seamViolations(
      [entry],
      forbiddenInTheTree(),
      plantedOver({
        [entry]: `${original}\nimport { createGradientSession } from '../gradient';\nvoid createGradientSession;\n`,
      }),
    );
    expect(found).toContain(`${entry} → apps/web/src/game/gradient.ts`);
  });

  it('is red for a root that defines a trainer-control writer', () => {
    const entry = `${WEB_ROOT}/planted-entry.ts`;
    const read = plantedOver({
      [entry]:
        'export const port = {\n  setTargetPower: async (watts: number) => { void watts; },\n};\n',
    });
    expect(writingRoots([...openWorldModules(), entry], read)).toEqual([entry]);
  });
});
