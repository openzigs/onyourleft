// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The lap race's code cannot reach the trainer**: ADR 0060 D-2.2, held as a
 * red test (#1898).
 *
 * A smart trainer applies resistance to a person who is pedalling (CLAUDE.md
 * §6), and ADR 0060 D-2.1 says no item pick-up, item use, hit, lap, overtake,
 * finish or bot action may change what the trainer is sent, or when. This
 * walks the static import graph from every non-test module of the mode, which
 * D-2.2 defines as everything under the mode's own directories in `apps/web`
 * and `packages/domain` ({@link LAP_RACE_ROOTS}). It fails, naming the chain,
 * when a module reaches anything in the forbidden set: the trainer-command
 * seam read off `scripts/check-wiring.mjs`, every trainer-control writer the
 * #1807 rules find, `game/trainer-port.ts`, `game/gradient.ts` and
 * `ride/trainer.ts`.
 *
 * **The walk is Delivery's, not a copy of it.** `../cannot-reach-trainer-testing.ts`
 * holds it for both modes, so a seam module or a writer added later is
 * forbidden to both the day it lands. The walk's own cases (every import
 * spelling, barrels, workers) are in Delivery's test. This file holds the
 * lap race's roots and the three plantings #1898 names.
 *
 * What it cannot see is a trainer reached at run time, through a value handed
 * in. That half is #1906's behavioural test.
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
} from '../cannot-reach-trainer-testing';

/** The mode's own directories (ADR 0060 D-2.2), as paths from the repository root. */
const LAP_RACE_ROOTS = ['apps/web/src/game/lap-race', 'packages/domain/src/lap-race'] as const;

const [WEB_ROOT, DOMAIN_ROOT] = LAP_RACE_ROOTS;

/** Every non-test module of the mode. A root directory that is not there throws. */
function lapRaceModules(): string[] {
  return LAP_RACE_ROOTS.flatMap((root) => modulesUnder(root));
}

/** The chains `code`, planted as one module at `path`, reaches the forbidden set by. */
function plantedViolations(planted: Readonly<Record<string, string>>, entry: string): string[] {
  return seamViolations([entry], forbiddenInTheTree(), plantedOver(planted));
}

describe('the lap race cannot reach the trainer-command seam (ADR 0060 D-2.2, #1898)', () => {
  it('reaches no trainer module from any lap-race module, by any static import chain', () => {
    expect(seamViolations(lapRaceModules(), forbiddenInTheTree())).toEqual([]);
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

  it('reads files: both roots exist, the model is among the roots, and every root is visited', () => {
    const roots = lapRaceModules();
    expect(roots).toContain(`${DOMAIN_ROOT}/race.ts`);
    const { modules } = walk(roots);
    for (const path of roots) {
      expect(modules, path).toContain(path);
    }
    expect(() => modulesUnder('apps/web/src/game/lap-race-renamed')).toThrow(/ENOENT/);
  });

  it('is red for a static import of game/gradient.ts from a lap-race module', () => {
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

  it('is red for #90’s setpoint driver taken from the domain barrel by a lap-race module', () => {
    const entry = `${DOMAIN_ROOT}/planted-entry.ts`;
    const found = plantedViolations(
      {
        [entry]:
          "import { createSimulationDriver } from '../index';\nvoid createSimulationDriver;\n",
      },
      entry,
    );
    expect(found).toContain(
      `${entry} → packages/domain/src/index.ts → packages/domain/src/trainer/simulation.ts`,
    );
  });

  it('refuses import.meta.glob in a lap-race module, rather than leaving out what it loads', () => {
    for (const root of LAP_RACE_ROOTS) {
      const entry = `${root}/planted-entry.ts`;
      const read = plantedOver({
        [entry]: "const all = import.meta.glob('../*.ts', { eager: true });\nvoid all;\n",
      });
      expect(() => walk([entry], read), root).toThrow(/uses import\.meta\.glob/);
    }
  });

  it('is red for setTargetPower imported by name through a barrel', () => {
    const entry = `${WEB_ROOT}/planted-entry.ts`;
    const barrel = `${WEB_ROOT}/planted-barrel.ts`;
    const found = plantedViolations(
      {
        [barrel]: "export * from '../../ride/controller';\n",
        [entry]: "import { setTargetPower } from './planted-barrel';\nvoid setTargetPower;\n",
      },
      entry,
    );
    expect(found).toContain(`${entry} → ${barrel} → apps/web/src/ride/controller.ts`);
  });
});
