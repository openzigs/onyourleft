// SPDX-License-Identifier: Apache-2.0

/**
 * The failures a transport is allowed to report, and the one error class that
 * carries them.
 *
 * The codes are the point, not the class. Three BLE stacks fail in three
 * different vocabularies — Web Bluetooth rejects `requestDevice()` with a
 * `NotFoundError` whether the chooser found nothing or the athlete pressed
 * cancel, Android raises a runtime-permission denial, CoreBluetooth reports a
 * `CBManagerState` — and a caller above the transport boundary has to be able
 * to tell "nothing was found" from "you may not look". The issue calls that out
 * explicitly: *"'no device found' and 'not permitted' are distinct states the
 * interface must be able to express."* A single opaque `Error` collapses them,
 * and the UI that results tells an athlete with Bluetooth switched off to buy a
 * different trainer.
 *
 * One class with a discriminating `code`, rather than a subclass per code:
 * `instanceof` across package boundaries is fragile once anything is bundled
 * twice, and a `switch` on a string union is exhaustively checked by the
 * compiler in a way a chain of `instanceof` is not.
 */

/**
 * Why a sensor operation failed.
 *
 * Every code here is a state some transport can genuinely reach. Nothing is
 * reserved "in case", because an unreachable code is a branch no caller ever
 * writes a test for.
 */
export type SensorErrorCode =
  /**
   * The runtime has no BLE stack this transport can drive at all — Safari and
   * Firefox in the browser, where Web Bluetooth is not implemented and (per
   * CLAUDE.md §8) never will be. Permanent for the session: retrying cannot
   * help, and a UI that offers a retry button here is lying.
   */
  | 'transport-unsupported'
  /**
   * There is a BLE stack, but the athlete has not granted the permission it
   * needs. Distinct from `transport-unsupported` because it is recoverable, and
   * distinct from `no-device-selected` because the athlete never got as far as
   * choosing. Android's runtime location/Bluetooth permissions and iOS's
   * `NSBluetoothAlwaysUsageDescription` prompt both land here.
   */
  | 'not-permitted'
  /**
   * The stack is present and permitted, but the Bluetooth adapter is off or
   * otherwise unusable. Recoverable without any code change: the athlete turns
   * Bluetooth on.
   */
  | 'adapter-unavailable'
  /**
   * Discovery ran and ended without a device — nothing advertising, or the
   * athlete dismissed the chooser. Deliberately **not** an `adapter-unavailable`
   * and **not** a `not-permitted`: this is the ordinary outcome of pressing
   * "cancel", and it must not be reported as a fault.
   */
  | 'no-device-selected'
  /**
   * Discovery was attempted without the user gesture the transport requires.
   * Web Bluetooth's `requestDevice()` throws unless it is called from a user
   * activation, and there is no way to ask for one programmatically. A caller
   * that hits this has a UI bug — it called discovery from a timer, a promise
   * continuation or page load — not a device problem.
   */
  | 'user-gesture-required'
  /**
   * A transport handed back a device id that is empty or blank. Always a fault
   * in the transport rather than in the device: an id is the only handle the
   * flat, `deviceId`-keyed interface has, and a blank one silently aliases
   * every device to every other. Caught at the boundary rather than three
   * layers later, when a measurement has already been attributed to the wrong
   * trainer.
   */
  | 'invalid-device-id'
  /**
   * The device id is not one this transport knows. Because a device id is
   * scoped to the transport that issued it (see `device.ts`), the commonest
   * cause is a remembered id from a different platform or a different origin.
   */
  | 'device-not-found'
  /**
   * The operation needs an established connection and there is not one. This is
   * the code behind the rule that a transport cannot report or be asked for
   * measurements while it is disconnected.
   */
  | 'not-connected'
  /**
   * A connection-state change was requested that the lifecycle does not permit
   * — see `connection.ts`. Always an implementation fault in the transport, not
   * a device fault, which is why it is a distinct code rather than folded into
   * `not-connected`.
   */
  | 'illegal-state-transition'
  /**
   * The device does not provide the capability that was asked of it. Reached
   * when a remembered device is re-paired and turns out to be a different
   * model, and when a caller subscribes to a capability it never checked for.
   */
  | 'capability-unsupported'
  /**
   * A notification's payload could not be decoded: a flag claimed a field the
   * buffer does not contain, a mandatory field is missing, or a field holds a
   * value the profile does not permit.
   *
   * **A device fault or an attack, never a caller fault** — which is why it is
   * its own code rather than folded into `capability-unsupported`. Sensor data
   * is untrusted input (SECURITY.md, CLAUDE.md §6): the payload comes from a
   * device that may not be what it claims, and the obvious attack on a
   * flags-gated variable-length characteristic is a flag claiming a field that
   * is not there. The alternative to a code here is a bare `RangeError` out of
   * a `DataView`, which a caller cannot tell from a bug in this package.
   *
   * Costs one notification. `packages/sensors/protocol` raises it and the
   * adapter drops that notification and carries on — see `onProtocolError`.
   */
  | 'malformed-payload'
  /**
   * A setpoint was attempted without control of the machine, or the machine
   * answered `0x05` Control Not Permitted.
   *
   * **The most important code in the trainer-control surface.** FTMS §4.16.2 is
   * explicit that a machine which has not granted control does not error on a
   * setpoint — it *ignores* it. So a client that writes anyway reports a target
   * the trainer never took, the rider pedals against whatever resistance was
   * already set, and the screen says otherwise for the rest of the session.
   * This code is what the client raises instead of writing.
   */
  | 'control-not-held'
  /**
   * The machine ran the procedure and refused it — Op Code Not Supported,
   * Invalid Parameter, Operation Failed, or a reserved result code — or the ATT
   * write itself was refused.
   *
   * Distinct from `control-not-held` because it says nothing about whether this
   * client still holds control, and distinct from `control-out-of-range`
   * because the refusal came from the device rather than from this program.
   */
  | 'control-rejected'
  /**
   * A setpoint was refused **before it was written**, because it is outside the
   * range the device reported or outside this client's own ceiling.
   *
   * Its own code because the difference matters to a UI and to a bug report: no
   * byte reached the trainer. CLAUDE.md §6 — trainer control is a safety
   * problem, and the value that never reaches the brake is the safe one.
   */
  | 'control-out-of-range'
  /**
   * A control point procedure went unanswered.
   *
   * The Fitness Machine Control Point is request/response: until the indication
   * arrives, whether the machine applied the setpoint is unknown. Reported as
   * its own code because "unknown" is a different state from "refused" — the
   * trainer may well be holding a target nobody confirmed.
   */
  | 'control-timed-out'
  /**
   * The plan needs more simultaneous connections than the platform will carry.
   * See `MAX_RECOMMENDED_CONCURRENT_CONNECTIONS` in `plan.ts`: the budget is
   * OS-wide and shared with whatever else the athlete has paired, so this is a
   * routine outcome rather than an edge case.
   */
  | 'connection-budget-exceeded';

/**
 * The one error this package raises.
 *
 * Carries the `code` above, and optionally the device the failure is about.
 * `cause` is the transport's own error, kept so a bug report can name the
 * underlying `DOMException` without this layer having to understand it.
 *
 * ⚠️ **Never put the transport's raw message in front of an athlete.** A
 * platform BLE error can name a device address or a nearby device's advertised
 * name, and SECURITY.md treats leaking that as in scope. Render from `code`.
 */
export class SensorError extends Error {
  readonly code: SensorErrorCode;

  /** The device the failure concerns, when the failure is about a device. */
  readonly deviceId: string | undefined;

  constructor(
    code: SensorErrorCode,
    message: string,
    options?: { readonly deviceId?: string; readonly cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SensorError';
    this.code = code;
    this.deviceId = options?.deviceId;
  }
}

/** Narrow an unknown caught value to a `SensorError` with a particular code. */
export function isSensorError(value: unknown, code?: SensorErrorCode): value is SensorError {
  if (!(value instanceof SensorError)) {
    return false;
  }
  return code === undefined || value.code === code;
}
