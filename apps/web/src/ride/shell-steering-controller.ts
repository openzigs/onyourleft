// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The Android shell's steering controller, the one that is remembered and
 * reconnected** — [#2672](https://github.com/openzigs/onyourleft/issues/2672).
 *
 * ## Why this is a module and not a second argument in `main.tsx`
 *
 * `createSteeringController`'s {@link SteeringReconnect} is OPTIONAL, because a
 * browser has no silent reconnect (docs/agents/web-bluetooth.md §8). An
 * optional argument nobody supplies is green in `check:wiring` and in every
 * test, which is the reason `shell-ride-controller.ts` exists for #524 and
 * #2669. So the shell's steering controller is built HERE, where every part
 * is required: the memory the sensors are kept in, the client's connect with
 * no chooser, the ride controller whose sensors share the budget, and its
 * restore, which this one waits for.
 *
 * ## After the sensors, and inside what they leave
 *
 * The controller is tried once the ride controller's restore has ended
 * ({@link ShellRideController.restored}), and only while fewer sensors are
 * listed than the transport's connection budget. A trainer and its sensors
 * come first because they are the ride; the controller steers a game. On
 * Android the plugin runs its calls one after another anyway, so waiting costs
 * the controller nothing it would not have waited for in the plugin's queue.
 *
 * ## Why the client is a parameter
 *
 * For `shell-ride-controller.ts`'s reason: `main.tsx` reaches
 * `@onyourleft/mobile` only behind an `import()`, so the client arrives built.
 */

import type { RememberedSensors } from './remembered-sensors';
import type { ShellRideController } from './shell-ride-controller';
import {
  createSteeringController,
  type SteeringController,
  type SteeringReconnect,
} from './steering-controller';
import type { KnownSteeringControllerPort } from './steering-controller-port';

export interface ShellSteeringOptions {
  /** The ONE memory: the ride controller's, which *Erase everything* forgets. */
  readonly remembered: RememberedSensors;
  /** Its listed sensors share the budget, and its restore goes first. */
  readonly ride: Pick<ShellRideController, 'getSnapshot' | 'restored'>;
  /** The transport's `traits.maxConcurrentConnections`. */
  readonly budget: number;
  /** Defaults to `setTimeout`. */
  readonly schedule?: SteeringReconnect['schedule'] | undefined;
}

function defaultSchedule(callback: () => void, afterSeconds: number): () => void {
  const handle = setTimeout(callback, afterSeconds * 1000);
  return () => {
    clearTimeout(handle);
  };
}

/**
 * The steering controller inside the Android shell: remembered when it pairs,
 * and reconnected with no chooser when the app opens and when its link drops.
 */
export function createShellSteeringController(
  client: KnownSteeringControllerPort,
  options: ShellSteeringOptions,
): SteeringController {
  const { ride, budget } = options;
  const steering = createSteeringController(client, {
    remembered: options.remembered,
    connectKnown: async (id, name) => client.connectKnown(id, name),
    hasRoom: () => ride.getSnapshot().sensors.length < budget,
    schedule: options.schedule ?? defaultSchedule,
  });
  void ride.restored.then(async () => steering.restoreRemembered());
  return steering;
}
