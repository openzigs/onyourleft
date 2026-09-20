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
  chooseTrainerControl,
  createTrainerControl,
  type GattUuid,
  type SupportedPowerRange,
  type TrainerControl,
  type TrainerControlChoice,
  type FitnessMachineChannel,
  type FitnessMachineFeatures,
  type SupportedResistanceLevelRange,
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
 * What a paired trainer turned out to be — #370.
 *
 * ⚠️ **Two fields rather than one, because "can this app drive it" and "what
 * does the machine offer" are different questions and this used to answer only
 * the first.** `openWebBluetoothTrainer` returned `TrainerConnection |
 * undefined`, so a trainer whose only control point is its manufacturer's — a
 * pre-FTMS Wahoo, say — was indistinguishable from a heart rate strap, and the
 * screen said *"no controllable trainer"*. It is one, it records power and
 * cadence perfectly well, and this program has decided not to drive it. That is
 * a different sentence and a rider can act on it.
 */
export interface TrainerAttachment {
  /**
   * Which control point this machine offers, from everything the link resolved.
   *
   * `none` also covers *"the transport could not say"*, which is the honest
   * reading: an empty answer is no information rather than a claim about the
   * device. @see the note on {@link controlChoice}.
   */
  readonly choice: TrainerControlChoice;
  /**
   * `undefined` when this app will not drive the machine — no Fitness Machine
   * Service, no Supported Power Range, or a vendor-only control point. Not a
   * rejection: a heart rate strap failing this is the ordinary case, not an
   * error to show.
   */
  readonly connection: TrainerConnection | undefined;
}

/** Open trainer control on a connected device. */
export type OpenTrainer = (id: DeviceId) => Promise<TrainerAttachment>;

/**
 * Nothing known about the machine.
 *
 * Shared with `controller.ts` so that "no trainer paired" and "a trainer whose
 * control surface could not be read" are one value rather than two literals
 * that can drift apart.
 */
export const NO_TRAINER_CONTROL: TrainerControlChoice = { kind: 'none' };

/**
 * `chooseTrainerControl` over whatever the transport could say.
 *
 * ⚠️ **Every failure here answers `none`, and that is deliberate in a place
 * where swallowing an error usually is not.** This call exists to make a
 * message *more* specific; a rider whose transport could not enumerate its
 * services must end up exactly where they were before #370 — with the general
 * sentence — rather than with a trainer that stopped working. The same reason
 * `openWebBluetoothTrainer` has never treated "not a fitness machine" as an
 * error.
 *
 * ⚠️ It catches `chooseTrainerControl`'s documented `RangeError` too, which is
 * the one judgement call in the file. That function refuses a malformed UUID
 * rather than ignoring it, because *"a silently ignored misspelling would be a
 * controllable trainer reported as uncontrollable"* — but the UUIDs reaching it
 * here come from a platform that normalises them, and letting one bad string
 * out of this function would surface as a pairing failure for the whole device.
 * A device is untrusted input (CLAUDE.md §6); losing a rider's trainer to it is
 * a worse outcome than a less specific message.
 */
async function controlChoice(
  read: () => Promise<readonly GattUuid[]>,
): Promise<TrainerControlChoice> {
  try {
    return chooseTrainerControl(await read());
  } catch {
    return NO_TRAINER_CONTROL;
  }
}

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
    const choice = await controlChoice(async () => transport.resolvedUuids(id));
    if (choice.kind === 'vendor-not-implemented') {
      // ⚠️ The Fitness Machine Service was not in what the link resolved, so
      // `openFitnessMachine` would reject — there is nothing to gain from
      // asking and a GATT round trip to lose. Returning here is also what makes
      // this the one branch `chooseTrainerControl` genuinely decides: every
      // other answer, `none` included, falls through to the path below exactly
      // as it did before #370, so a transport that cannot enumerate services
      // never costs a rider a trainer that works.
      return { choice, connection: undefined };
    }
    let machine;
    try {
      machine = await transport.openFitnessMachine(id);
    } catch {
      // Not a fitness machine. Every heart rate strap and power meter takes
      // this path, so it is not an error and is not reported as one.
      return { choice, connection: undefined };
    }
    const powerRange = machine.powerRange;
    if (powerRange === undefined) {
      return { choice, connection: undefined };
    }
    return {
      choice,
      connection: {
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
      },
    };
  };
}

/** What {@link openCapacitorTrainer} needs from the Android shell. */
export interface CapacitorTrainerPorts {
  /** Reads the three characteristics that say what may be written. */
  readMachine(deviceId: string): Promise<{
    readonly powerRange: SupportedPowerRange | undefined;
    readonly resistanceRange: SupportedResistanceLevelRange | undefined;
    readonly features: FitnessMachineFeatures | undefined;
  }>;
  /** Builds a control point channel over the plugin. */
  openChannel(deviceId: string): FitnessMachineChannel;
  /**
   * Every service and characteristic UUID the link resolved (#370).
   *
   * The Android half of {@link WebBluetoothTransport.resolvedUuids}, and the
   * reason #370's second criterion is met on **both** platforms rather than on
   * one with a note about the other: the plugin's `getServices` reads a table
   * the Android stack discovered on connect.
   */
  resolvedUuids(deviceId: string): Promise<readonly GattUuid[]>;
}

/**
 * {@link OpenTrainer}, over the Capacitor transport.
 *
 * ⚠️ **The body below is deliberately the same shape as
 * {@link openWebBluetoothTrainer}'s, and the duplication is the honest option.**
 * Everything that decides *what may be written to a trainer* —
 * `createTrainerControl`, the bounding, the quantisation, the feature gating —
 * is shared, platform-free code in `packages/sensors/protocol` and is called
 * identically from both. What differs is only how the three characteristics are
 * reached, which is exactly the platform difference #39's interface exists to
 * absorb. Folding the two into one function parameterised over a transport would
 * mean inventing a fourth interface whose only implementations are these two.
 *
 * ⚠️ The `powerRange === undefined` guard is not defensive tidiness. It is the
 * one thing standing between a rider and an unbounded setpoint on a machine
 * whose limits are unknown, and `apps/mobile/src/ble/fitness-machine.ts` records
 * why the read returns `undefined` rather than a default.
 */
export function openCapacitorTrainer(
  ports: CapacitorTrainerPorts,
  options: WebBluetoothTrainerOptions = {},
): OpenTrainer {
  const scheduleTimeout = options.scheduleTimeout ?? browserTimeouts;
  return async (id) => {
    const choice = await controlChoice(async () => ports.resolvedUuids(id));
    if (choice.kind === 'vendor-not-implemented') {
      return { choice, connection: undefined };
    }
    let machine;
    try {
      machine = await ports.readMachine(id);
    } catch {
      // Not a fitness machine, or not reachable. Every heart rate strap takes
      // this path, so it is the ordinary case rather than an error to show.
      return { choice, connection: undefined };
    }
    const powerRange = machine.powerRange;
    if (powerRange === undefined) {
      return { choice, connection: undefined };
    }
    return {
      choice,
      connection: {
        control: createTrainerControl(ports.openChannel(id), {
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
      },
    };
  };
}

/**
 * How long a control point procedure may go unanswered.
 *
 * @unwired the value that binds is `packages/sensors/protocol`'s
 * `CONTROL_POINT_PROCEDURE_TIMEOUT_SECONDS`, which the client cannot import
 * without pulling the protocol into a view. This is the copy `trainer.test.ts`
 * asserts the timeout against, and nothing in the client passes it anywhere.
 */
export const TRAINER_PROCEDURE_TIMEOUT: Seconds = seconds(5);
