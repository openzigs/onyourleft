// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The group ride's code cannot import the trainer** — #3308, ADR 0101 D-6.1
 * and the owner's ruling 4 of 2026-11-26: the static half of the
 * `group-ride-cannot-reach-trainer` gate, whose behavioural half (simulation,
 * ERG, the worst case, the release) is `group-ride-cannot-reach-trainer.test.tsx`
 * beside it. Apart because the walk reads the tree from disk, which that
 * file's `jsdom` environment cannot.
 *
 * It walks the static import graph from every non-test module of the mode
 * (its two directories, the physics it rides on and its three HUD modules) on
 * the walk the lap race and Delivery share (`../cannot-reach-trainer-testing.ts`),
 * whose forbidden set is the trainer-command seam as `scripts/check-wiring.mjs`
 * lists it, every module that writes to a trainer (found by rule),
 * `game/trainer-port.ts`, `game/gradient.ts` and `ride/trainer.ts`; and fails,
 * naming the chain, at any of them. `check:wiring`'s WIRE005 refuses a direct
 * import of one from `game/group-ride/` on every run besides; this follows
 * every chain. What it cannot see is a trainer reached at run time, through a
 * value handed in: that is the behavioural half.
 */

import { describe, expect, it } from 'vitest';

import {
  forbiddenInTheTree,
  modulesUnder,
  plantedOver,
  seamViolations,
  walk,
} from '../cannot-reach-trainer-testing';

/** The mode's own directories, as paths from the repository root (ADR 0101 D-6.15). */
const GROUP_RIDE_ROOTS = [
  'apps/web/src/game/group-ride',
  'packages/domain/src/group-ride',
] as const;
/** Its modules outside them: the physics it rides on, and the HUD it draws and is pressed through. */
const GROUP_RIDE_MODULES_BESIDE = [
  'packages/physics/src/group-ride.ts',
  'apps/web/src/game/hud/group-ride-hud.ts',
  'apps/web/src/game/hud/GroupRideCue.tsx',
  'apps/web/src/game/hud/GroupRideControls.tsx',
] as const;

/** Every non-test module of the mode. A root directory that is not there throws. */
function groupRideModules(): string[] {
  return [...GROUP_RIDE_ROOTS.flatMap((root) => modulesUnder(root)), ...GROUP_RIDE_MODULES_BESIDE];
}

describe('the group ride cannot import the trainer, by any static chain — #3308, ADR 0101 D-6.1', () => {
  it('reaches no trainer module from any group-ride module', () => {
    const modules = groupRideModules();
    expect(modules).toContain('apps/web/src/game/group-ride/ride-group.ts');
    expect(modules).toContain('packages/domain/src/group-ride/rotation.ts');
    const { modules: visited } = walk(modules);
    for (const path of modules) expect(visited, path).toContain(path);
    expect(seamViolations(modules, forbiddenInTheTree())).toEqual([]);
  });

  it('is red for the trainer port imported by a group-ride module, and for a seam module through a barrel', () => {
    const entry = 'apps/web/src/game/group-ride/planted-entry.ts';
    const read = plantedOver({
      [entry]:
        "import { gameTrainerPortOver } from '../trainer-port';\n" +
        "import { createErgWriter } from '@onyourleft/sensors/protocol';\n" +
        'void gameTrainerPortOver;\nvoid createErgWriter;\n',
    });
    const found = seamViolations([entry], forbiddenInTheTree(), read);
    expect(found).toContain(`${entry} → apps/web/src/game/trainer-port.ts`);
    expect(
      found.some((chain) => chain.endsWith('packages/sensors/protocol/src/erg-writer.ts')),
    ).toBe(true);
  });
});
