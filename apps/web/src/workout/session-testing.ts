// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A {@link WorkoutTrainer} straight over a control client** (#2348) — test
 * support, never shipped. For a test that drives a workout session with no
 * ride controller above it.
 *
 * It ends a workout the way `ride/controller.ts` §`beginRelease` does: the
 * step-down's `0x05`, then the Stop, both put on the client's one queue in the
 * same synchronous run. ⚠️ **It is not that code**, and a test that passes
 * through it says nothing about the controller's release: what the controller
 * sends at the end of a workout is asserted in `ride/controller.test.ts`
 * §"#2348", through the real controller and the simulated trainer.
 */

import type { TrainerControl } from '@onyourleft/sensors/protocol';

import type { WorkoutTrainer } from './session';

export function workoutTrainerOver(control: TrainerControl): WorkoutTrainer {
  return {
    setTargetPower: (target) => control.setTargetPower(target),
    stop: () => control.stop(),
    targetPower: () => control.targetPower(),
    letGo: async (stepDownTo) => {
      const steppedDown =
        stepDownTo === undefined
          ? Promise.resolve(undefined)
          : control.setTargetPower(stepDownTo).then(
              () => true,
              () => false,
            );
      const stop = control.letGo();
      return { stop: await stop, steppedDown: await steppedDown };
    },
  };
}
