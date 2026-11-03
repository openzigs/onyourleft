// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The static half of #1992's "reaches no trainer": no import chain leads from
 * the simulated rider to the trainer-command seam, in the walk #1807 built
 * (`cannot-reach-trainer-testing.ts`). The run-time half is
 * `simulated-rider-wiring.test.tsx`.
 */

import { describe, expect, it } from 'vitest';

import { forbiddenInTheTree, plantedOver, seamViolations } from './cannot-reach-trainer-testing';

describe('the simulated rider cannot reach the trainer-command seam (#1992)', () => {
  it('has no static import chain to a trainer module', () => {
    expect(seamViolations(['apps/web/src/game/simulated-rider.ts'], forbiddenInTheTree())).toEqual(
      [],
    );
  });

  it('is a walk that can fail: a planted import of the gradient writer is caught', () => {
    const entry = 'apps/web/src/game/simulated-rider.ts';
    const found = seamViolations(
      [entry],
      forbiddenInTheTree(),
      plantedOver({
        [entry]:
          "import { createGradientSession } from './gradient';\nvoid createGradientSession;\n",
      }),
    );
    expect(found).not.toEqual([]);
  });
});
