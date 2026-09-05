// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Building #43's trainer-control client from a device the athlete just paired.
 *
 * This is the composition root for trainer control, and it is deliberately
 * small: `@onyourleft/sensors/web-bluetooth` resolves the control point and
 * reads the three characteristics that say what may be written to it, and
 * `@onyourleft/sensors/protocol` turns that into a client. What is left for
 * this file is the two product decisions neither package may make.
 *
 * **One: a machine that will not say what it can take does not get an ERG
 * client.** `createTrainerControl` requires a Supported Power Range because
 * #43's acceptance criteria say a setpoint must be bounded by the range the
 * device reported and not by a hard-coded assumption. A trainer that answers no
 * read gets {@link openWebBluetoothTrainer} returning `undefined`, and the
 * screen says trainer control is unavailable rather than offering a slider
 * whose limits nobody knows. Trainer control is a safety problem before it is a
 * feature (CLAUDE.md §6).
 *
 * **Two: the feature bits gate the controls.** #49's revision block:
 * *"Fitness Machine Feature `0x2ACC` Target Setting bit 3 (power target) and
 * bit 13 (simulation parameters) say whether ERG and gradient are available at
 * all … Offering a control the trainer will refuse is worse than not offering
 * it."* An **absent** feature characteristic gates nothing — the same rule
 * `TrainerControlOptions.features` states, so that a machine which did not
 * answer the read is not left with every setpoint refused.
 */

import { seconds, type Seconds } from '@onyourleft/domain';
import type { DeviceId } from '@onyourleft/sensors';
import {
  createTrainerControl,
  type SupportedPowerRange,
  type TrainerControl,
} from '@onyourleft/sensors/protocol';
import type { WebBluetoothTransport } from '@onyourleft/sensors/web-bluetooth';

/** A trainer this app may write to, and what it will accept. */
export interface TrainerConnection {
  readonly control: TrainerControl;
  /** Target Setting bit 3, or `true` when the machine reported no features. */
  readonly canSetPower: boolean;
  /** Target Setting bit 13 — the gradient control. #50 is its first consumer. */
  readonly canSimulate: boolean;
  /** As the machine reported it. The screen quotes the limits from here. */
  readonly powerRange: SupportedPowerRange;
}

/**
 * Open trainer control on a connected device.
 *
 * @returns `undefined` when the device is not a controllable trainer — no
 * Fitness Machine Service, or no Supported Power Range. Not a rejection: a
 * heart rate strap failing this is the ordinary case, not an error to show.
 */
export type OpenTrainer = (id: DeviceId) => Promise<TrainerConnection | undefined>;

/**
 * A one-shot timer for `packages/sensors/protocol`, which may not have one.
 *
 * `CONTROL_POINT_PROCEDURE_TIMEOUT_SECONDS` is five seconds and the client is
 * documented as never timing a procedure out without this. Without it a trainer
 * that stops answering leaves every later setpoint queued behind the first, so
 * the ERG control on this screen would stop working with no explanation — which
 * is the failure mode the timeout exists to convert into a visible refusal.
 */
export function browserTimeouts(afterSeconds: Seconds, run: () => void): () => void {
  const handle = globalThis.setTimeout(run, afterSeconds * 1000);
  return () => {
    globalThis.clearTimeout(handle);
  };
}

export interface WebBluetoothTrainerOptions {
  /** Defaults to {@link browserTimeouts}; a test supplies a virtual clock. */
  readonly scheduleTimeout?: (afterSeconds: Seconds, run: () => void) => () => void;
}

/** {@link OpenTrainer}, over the browser transport. */
export function openWebBluetoothTrainer(
  transport: WebBluetoothTransport,
  options: WebBluetoothTrainerOptions = {},
): OpenTrainer {
  const scheduleTimeout = options.scheduleTimeout ?? browserTimeouts;
  return async (id) => {
    let machine;
    try {
      machine = await transport.openFitnessMachine(id);
    } catch {
      // Not a fitness machine. Every heart rate strap and power meter takes
      // this path, so it is not an error and is not reported as one.
      return undefined;
    }
    const powerRange = machine.powerRange;
    if (powerRange === undefined) {
      return undefined;
    }
    return {
      control: createTrainerControl(machine.channel, {
        powerRange,
        deviceId: id,
        scheduleTimeout,
        ...(machine.resistanceRange === undefined
          ? {}
          : { resistanceRange: machine.resistanceRange }),
        ...(machine.features === undefined ? {} : { features: machine.features }),
      }),
      canSetPower: machine.features?.targetSetting.powerTarget ?? true,
      canSimulate: machine.features?.targetSetting.indoorBikeSimulationParameters ?? true,
      powerRange,
    };
  };
}

/** How long a control point procedure may go unanswered. Re-exported for tests. */
export const TRAINER_PROCEDURE_TIMEOUT: Seconds = seconds(5);
