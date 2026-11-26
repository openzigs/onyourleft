// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The static half of #1992's "reaches no trainer": no import chain leads from
 * the simulated rider to the trainer-command seam, in the walk #1807 built
 * (`cannot-reach-trainer-testing.ts`). The run-time half is
 * `simulated-rider-wiring.test.tsx`.
 *
 * #3210 adds the same walk for its invented cadence and heart rate: no import
 * chain leads from them to anything that records, stores, uploads or posts a
 * ride, so the only way an invented reading leaves the screen is through a
 * port, and a simulated ride is handed none (the wiring test's half).
 */

import { describe, expect, it } from 'vitest';

import {
  forbiddenInTheTree,
  modulesUnder,
  plantedOver,
  seamViolations,
} from './cannot-reach-trainer-testing';

describe('the simulated rider cannot reach the trainer-command seam (#1992)', () => {
  it('has no static import chain to a trainer module', () => {
    expect(seamViolations(['apps/web/src/game/simulated-rider.ts'], forbiddenInTheTree())).toEqual(
      [],
    );
  });

  it('nor do capture mode’s script and recorder figures — #3152', () => {
    expect(
      seamViolations(
        ['apps/web/src/game/capture-scene.ts', 'apps/web/src/game/capture-recording.ts'],
        forbiddenInTheTree(),
      ),
    ).toEqual([]);
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

describe('the invented readings cannot reach a recording, an upload or a room (#3210)', () => {
  /** Everything that records, keeps, exports, syncs or posts a ride. */
  const keepers = [
    ...modulesUnder('apps/web/src/recording'),
    ...modulesUnder('apps/web/src/ride'),
    ...modulesUnder('apps/web/src/net'),
    ...modulesUnder('apps/web/src/instance'),
    ...modulesUnder('apps/web/src/offline'),
    ...modulesUnder('apps/web/src/transfer'),
    ...modulesUnder('packages/store/src'),
    'apps/web/src/game/trainer-port.ts',
  ];
  const roots = ['apps/web/src/game/simulated-body.ts', 'apps/web/src/game/simulated-rider.ts'];

  it('has no static import chain to one', () => {
    expect(keepers.length).toBeGreaterThan(100);
    expect(seamViolations(roots, keepers)).toEqual([]);
  });

  it('is a walk that can fail: a planted import of the recorder is caught', () => {
    const entry = 'apps/web/src/game/simulated-body.ts';
    const found = seamViolations(
      [entry],
      keepers,
      plantedOver({
        [entry]: "import { rideTotals } from '../recording/totals';\nvoid rideTotals;\n",
      }),
    );
    expect(found).toEqual([`${entry} → apps/web/src/recording/totals.ts`]);
  });
});
