// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The Operate area cannot reach the trainer** (#2603, epic #2601: "no
 * trainer control from anywhere in this area").
 *
 * A smart trainer applies resistance to a person who is pedalling (CLAUDE.md
 * §6), and nothing an instance's operator does from the app may set it. This
 * walks the static import graph from the Operate area's modules — its view
 * and its port — and fails, naming the chain, when one reaches anything in
 * the forbidden set the game's modes are held to
 * (`game/cannot-reach-trainer-testing.ts`): the trainer-command seam read off
 * `scripts/check-wiring.mjs`, every trainer-control writer found by rule, and
 * the game's own trainer modules. `pnpm run check:wiring` holds the port's
 * methods to a production caller; this holds the area away from the seam.
 */

import { describe, expect, it } from 'vitest';

import {
  forbiddenInTheTree,
  plantedOver,
  seamViolations,
  walk,
} from '../game/cannot-reach-trainer-testing';

/** The Operate area's modules, as paths from the repository root. */
const OPERATE_MODULES = [
  'apps/web/src/views/OperateView.tsx',
  'apps/web/src/views/OperateBackupsPanel.tsx',
  'apps/web/src/instance/operate-port.ts',
] as const;

describe('the Operate area cannot reach the trainer-command seam — #2603', () => {
  it('reaches no trainer module from the view or the port, by any static import chain', () => {
    const { modules } = walk([...OPERATE_MODULES]);
    for (const path of OPERATE_MODULES) expect(modules, path).toContain(path);
    expect(seamViolations([...OPERATE_MODULES], forbiddenInTheTree())).toEqual([]);
  });

  it('is red for a static import of the trainer seam planted in the Operate view', () => {
    const entry = 'apps/web/src/views/planted-operate-entry.tsx';
    const found = seamViolations(
      [entry],
      forbiddenInTheTree(),
      plantedOver({
        [entry]:
          "import { createGradientSession } from '../game/gradient';\nvoid createGradientSession;\n",
      }),
    );
    expect(found).toContain(`${entry} → apps/web/src/game/gradient.ts`);
  });
});
