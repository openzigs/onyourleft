// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the trainer says it will accept, read from the device on Android.
 *
 * The counterpart of `packages/sensors/web-bluetooth`'s
 * `transport.openFitnessMachine`. All three values are **read from the machine**
 * and none is defaulted, which is #43's acceptance criterion and the reason this
 * file exists rather than a constant somewhere:
 *
 * > *a setpoint bounded by anything else is the hard-coded assumption #43's
 * > criteria forbid*
 *
 * ⚠️ **A missing Supported Power Range means no ERG client is built at all.**
 * `web-bluetooth`'s `FitnessMachine.powerRange` says why in one sentence and it
 * is worth repeating on the platform that will actually be riding: *"an
 * unbounded setpoint on a machine whose limits are unknown is the one failure
 * this whole path exists to prevent."* So this returns `undefined` for the
 * range rather than inventing one, and the caller declines to offer control.
 */

import {
  FITNESS_MACHINE_FEATURE,
  FITNESS_MACHINE_SERVICE,
  SUPPORTED_POWER_RANGE,
  SUPPORTED_RESISTANCE_LEVEL_RANGE,
  decodeFitnessMachineFeature,
  decodeSupportedPowerRange,
  decodeSupportedResistanceLevelRange,
  type FitnessMachineFeatures,
  type SupportedPowerRange,
  type SupportedResistanceLevelRange,
} from '@onyourleft/sensors/protocol';

import type { CapacitorBlePort } from './plugin-port';

/** What a trainer declared about itself. @see readCapacitorFitnessMachine */
export interface CapacitorFitnessMachine {
  readonly powerRange: SupportedPowerRange | undefined;
  readonly resistanceRange: SupportedResistanceLevelRange | undefined;
  readonly features: FitnessMachineFeatures | undefined;
}

/**
 * Reads the three characteristics that say what may be written to a trainer.
 *
 * Every read is **individually optional**, and that is deliberate rather than
 * lax. FTMS makes the Supported Resistance Level Range and the Fitness Machine
 * Feature characteristic optional, and real trainers omit them; a machine that
 * serves a control point and a power range but no feature bits is a controllable
 * trainer, and refusing the whole device because one optional read failed would
 * turn a working trainer into an uncontrollable one.
 *
 * ⚠️ What is **not** optional is the power range. Its absence is reported as
 * `undefined` and the caller must then decline to build a control client — see
 * the header.
 */
export async function readCapacitorFitnessMachine(
  port: CapacitorBlePort,
  deviceId: string,
): Promise<CapacitorFitnessMachine> {
  return {
    powerRange: await optionalRead(
      port,
      deviceId,
      SUPPORTED_POWER_RANGE,
      decodeSupportedPowerRange,
    ),
    resistanceRange: await optionalRead(
      port,
      deviceId,
      SUPPORTED_RESISTANCE_LEVEL_RANGE,
      decodeSupportedResistanceLevelRange,
    ),
    features: await optionalRead(
      port,
      deviceId,
      FITNESS_MACHINE_FEATURE,
      decodeFitnessMachineFeature,
    ),
  };
}

/**
 * One read that may legitimately fail or be unreadable.
 *
 * ⚠️ A **decode** failure is swallowed as well as a read failure, and the two
 * are different things worth naming. A read failure means the characteristic is
 * not there. A decode failure means it is there and is malformed — a device
 * lying about its own capabilities, which CLAUDE.md §6 lists as untrusted input.
 * Neither is a reason to crash a rider's ride screen, and both are a reason not
 * to trust the value: the safe direction for all three of these is "we do not
 * know", which is exactly `undefined`.
 */
async function optionalRead<T>(
  port: CapacitorBlePort,
  deviceId: string,
  characteristic: string,
  decode: (value: DataView) => T,
): Promise<T | undefined> {
  try {
    return decode(await port.read(deviceId, FITNESS_MACHINE_SERVICE, characteristic));
  } catch {
    return undefined;
  }
}
