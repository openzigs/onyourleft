// SPDX-License-Identifier: Apache-2.0

/**
 * The Fitness Machine Control Point (0x2AD9): ERG mode, resistance, and
 * gradient simulation.
 *
 * **This is the file that applies physical resistance to a person who is
 * pedalling.** CLAUDE.md §6 and SECURITY.md both say trainer control is a
 * safety problem and not only a security one, and everything below is arranged
 * around that: the bounds are checked before the write rather than trusted from
 * the device, a setpoint is never reported as applied until the machine has
 * said so, and every state this client claims about the trainer is one the
 * trainer confirmed.
 *
 * ## The control point is a protocol, not a write
 *
 * A fire-and-forget implementation *appears to work* — the developer writing it
 * is usually also pedalling, so the power on the screen is theirs. It fails for
 * a rider in a workout, silently, for the rest of the session. Four things make
 * it a protocol:
 *
 * 1. **`0x2AD9` is indications, not notifications.** CCCD value `0x0002`. A
 *    client that configures `0x0001` gets an ATT error at best and silence at
 *    worst, which reads as a broken trainer rather than a broken client. The
 *    CCCD is configured here before the first write, and again after a
 *    reconnection because the descriptor is per-connection.
 * 2. **Control must be requested and granted.** Until Request Control succeeds
 *    the machine does not error on a setpoint — it *ignores* it (FTMS
 *    §4.16.2). So this client refuses to write one, rather than writing into
 *    the void and reporting success.
 * 3. **Every write is answered by an indication carrying the request op code
 *    and a result code**, and the two must be **correlated**. A client that
 *    writes and assumes success reports an ERG target the trainer rejected; the
 *    rider then pedals against a resistance nobody chose and the screen says
 *    otherwise.
 * 4. **Control is lost, in three different ways**, and each has to be seen:
 *    another client takes it (Fitness Machine Status `0xFF`, at the *top* of
 *    the range), the machine answers `0x05` Control Not Permitted without any
 *    status at all, or **this client's own Reset revokes it** (FTMS
 *    §4.16.2.1). The third is the trap for a workout player that resets between
 *    intervals and keeps sending targets.
 *
 * ## Two failure vocabularies, deliberately not conflated
 *
 * A write can fail as an **ATT error** — the write itself is rejected, no
 * procedure starts (FTMS §4.16.4 says so explicitly), and the transport's
 * promise rejects — or as a **result code** in the indication, which means the
 * procedure ran and refused. `CCCD Improperly Configured` and `Procedure
 * Already In Progress` are the first kind; `Control Not Permitted` and `Invalid
 * Parameter` are the second. They are branched on separately because they mean
 * different things about the machine's state: after an ATT error nothing
 * happened, so the previously confirmed target still stands.
 *
 * ## The bounds are the client's, then the device's
 *
 * A hostile or broken trainer advertises whatever it likes in its Supported
 * Power Range. So the order is: this client's own absolute ceiling
 * ({@link MAX_PLAUSIBLE_TARGET_POWER_WATTS}, checked in
 * `decodeSupportedPowerRange` *and* again here), then the device's advertised
 * range, then quantisation to the device's own increment. A setpoint that fails
 * any of them is refused **without being written** — the failure a rider can
 * feel is the one where a number reaches the brake, not the one where it does
 * not.
 *
 * ## What is deliberately not here
 *
 * - **The vendor control characteristic inside 0x1818.** Some pre-FTMS trainers
 *   expose one; #43's revision block records its op codes and also records that
 *   two independent open-source implementations disagree by a factor of ten on
 *   the rolling-resistance scaling. Writing an unverifiable scaling to a brake
 *   is exactly the thing this file is careful about. GoldenCheetah's precedence
 *   rule is adopted anyway and costs nothing: **prefer a standard controllable
 *   service and fall back only when none was found**, which is what stops level
 *   mode disappearing the day a trainer's firmware gains FTMS.
 * - **Spin Down (`0x13`).** Its success response carries a parameter no other
 *   procedure has, and it needs hardware to be worth anything.
 * - **A clock.** This directory is platform-free, so there is no `setTimeout`.
 *   The procedure timeout is an **injected port**
 *   ({@link TrainerControlOptions.scheduleTimeout}); omit it and a machine that
 *   never answers leaves its procedure pending until `linkLost()`.
 */

import {
  metresPerSecond,
  resistanceLevel,
  watts,
  type GradePercent,
  type MetresPerSecond,
  type ResistanceLevel,
  type Seconds,
  type Watts,
} from '@onyourleft/domain';

import { SensorError } from '../../src/errors';
import type { Listener, Unsubscribe } from '../../src/subscription';

import {
  MAX_PLAUSIBLE_TARGET_POWER_WATTS,
  type FitnessMachineFeatures,
  type SupportedPowerRange,
  type SupportedResistanceLevelRange,
} from './fitness-machine';
import { createPayloadReader, malformedPayload } from './payload';

// --- The wire format --------------------------------------------------------

/** FTMS 1.0 Table 4.15, plus the Response Code op the indication carries. */
export const FTMS_OP_CODE = {
  requestControl: 0x00,
  reset: 0x01,
  setTargetSpeed: 0x02,
  setTargetInclination: 0x03,
  setTargetResistanceLevel: 0x04,
  setTargetPower: 0x05,
  setTargetHeartRate: 0x06,
  startOrResume: 0x07,
  stopOrPause: 0x08,
  setIndoorBikeSimulationParameters: 0x11,
  setWheelCircumference: 0x12,
  spinDownControl: 0x13,
  setTargetedCadence: 0x14,
  /** ⚠️ The first octet of every response indication. */
  responseCode: 0x80,
} as const;

/** FTMS 1.0 Table 4.24. */
export const FTMS_RESULT_CODE = {
  success: 0x01,
  opCodeNotSupported: 0x02,
  invalidParameter: 0x03,
  operationFailed: 0x04,
  controlNotPermitted: 0x05,
} as const;

/** FTMS 1.0 Table 4.26. `0xFF` is at the top of the range, not the bottom. */
export const FITNESS_MACHINE_STATUS_OP_CODE = {
  reset: 0x01,
  stoppedOrPausedByUser: 0x02,
  stoppedBySafetyKey: 0x03,
  startedOrResumedByUser: 0x04,
  targetResistanceChanged: 0x07,
  targetPowerChanged: 0x08,
  simulationParametersChanged: 0x12,
  /** ⚠️ The only push signal that another client took control. */
  controlPermissionLost: 0xff,
} as const;

/** FTMS 1.0 Table 4.16: the Stop or Pause control information parameter. */
const STOP_OR_PAUSE_PARAMETER = { stop: 0x01, pause: 0x02 } as const;

/** Set Target Power carries a `sint16` of whole watts. */
const SINT16_MIN = -32_768;
const SINT16_MAX = 32_767;

/** Set Target Resistance Level carries a `uint8` at a resolution of 0.1. */
const RESISTANCE_UNITS_PER_LEVEL = 10;

/** Simulation parameter resolutions, FTMS Table 4.20. */
const WIND_SPEED_UNITS_PER_METRE_PER_SECOND = 1000;
const GRADE_UNITS_PER_PERCENT = 100;
const ROLLING_RESISTANCE_UNITS_PER_UNIT = 10_000;
const WIND_RESISTANCE_UNITS_PER_KILOGRAM_PER_METRE = 100;

/**
 * The highest resistance level the Set Target Resistance Level parameter can
 * carry: a `uint8` at a resolution of 0.1.
 *
 * ⚠️ **FTMS 1.0 is internally inconsistent here.** The Supported Resistance
 * Level Range characteristic is a `sint16` at 0.1, so a machine can legally
 * advertise a maximum of 3 276.7 — and machines advertising 32 are common. The
 * *setpoint* cannot express it. Truncating the octet would set 6.4 where 32 was
 * asked for, so this client refuses instead and says why.
 */
export const MAX_ENCODABLE_RESISTANCE_LEVEL = 255 / RESISTANCE_UNITS_PER_LEVEL;

/**
 * The steepest gradient this client will simulate, in either direction.
 *
 * The parameter is a `sint16` at 0.01 %, so the wire allows ±327.67 %. The
 * steepest paved road in the world is about 35 %. A grade beyond this is a
 * course-file fault or a hostile input, and it reaches a brake that a rider is
 * pushing against.
 */
export const MAX_PLAUSIBLE_GRADE_PERCENT = 40;

/** Rolling resistance is a `uint8` at 0.0001. */
const MAX_ROLLING_RESISTANCE_COEFFICIENT = 255 / ROLLING_RESISTANCE_UNITS_PER_UNIT;

/** Wind resistance is a `uint8` at 0.01 kg/m. */
const MAX_WIND_RESISTANCE_COEFFICIENT = 255 / WIND_RESISTANCE_UNITS_PER_KILOGRAM_PER_METRE;

/** Wind speed is a `sint16` at 0.001 m/s. This client writes only tailwind-free values. */
const MAX_WIND_SPEED_METRES_PER_SECOND = SINT16_MAX / WIND_SPEED_UNITS_PER_METRE_PER_SECOND;

/**
 * The simulated course conditions a trainer is asked to reproduce.
 *
 * Only `grade` is required, and it is the one #16 drives from course gradient.
 * The other three default to a road bike on tarmac in still air, because a
 * caller that supplies a grade and nothing else means "this hill, nothing
 * else", and leaving the coefficients at zero would mean "this hill, in a
 * vacuum, on ice".
 */
export interface SimulationParameters {
  /** Signed. Negative is a descent, and the sign reaches the rider's legs. */
  readonly grade: GradePercent;
  /** Headwind, in metres per second. Defaults to still air. */
  readonly windSpeed?: MetresPerSecond | undefined;
  /** Crr, unitless. Defaults to 0.004 — a road tyre on tarmac. */
  readonly rollingResistanceCoefficient?: number | undefined;
  /** Cw, in kg/m. Defaults to 0.51 — a rider on the hoods. */
  readonly windResistanceCoefficient?: number | undefined;
}

const DEFAULT_ROLLING_RESISTANCE_COEFFICIENT = 0.004;
const DEFAULT_WIND_RESISTANCE_COEFFICIENT = 0.51;

/** Every control point procedure this client performs. */
export type ControlRequest =
  | { readonly opCode: 'request-control' }
  | { readonly opCode: 'reset' }
  | { readonly opCode: 'start-or-resume' }
  | { readonly opCode: 'stop' }
  | { readonly opCode: 'pause' }
  | { readonly opCode: 'set-target-power'; readonly target: Watts }
  | { readonly opCode: 'set-target-resistance'; readonly level: ResistanceLevel }
  | { readonly opCode: 'set-simulation-parameters'; readonly parameters: SimulationParameters };

/** The op code octet each request is written with. */
function opCodeOf(request: ControlRequest): number {
  switch (request.opCode) {
    case 'request-control':
      return FTMS_OP_CODE.requestControl;
    case 'reset':
      return FTMS_OP_CODE.reset;
    case 'start-or-resume':
      return FTMS_OP_CODE.startOrResume;
    case 'stop':
    case 'pause':
      return FTMS_OP_CODE.stopOrPause;
    case 'set-target-power':
      return FTMS_OP_CODE.setTargetPower;
    case 'set-target-resistance':
      return FTMS_OP_CODE.setTargetResistanceLevel;
    case 'set-simulation-parameters':
      return FTMS_OP_CODE.setIndoorBikeSimulationParameters;
  }
}

/** Raise the one error this file refuses a setpoint with. */
function outOfRange(message: string): SensorError {
  return new SensorError('control-out-of-range', message);
}

/** Round to the wire's integer units, refusing anything the field cannot carry. */
function scaled(
  value: number,
  unitsPerValue: number,
  min: number,
  max: number,
  what: string,
): number {
  const raw = Math.round(value * unitsPerValue);
  if (raw < min || raw > max) {
    throw outOfRange(
      `${what} of ${String(value)} does not fit the field the specification gives it`,
    );
  }
  return raw;
}

/** Little-endian, the mirror of `PayloadReader`. */
function bytesOf(...octets: number[]): Uint8Array {
  return Uint8Array.from(octets);
}

function littleEndian16(raw: number): [number, number] {
  const unsigned = raw < 0 ? raw + 0x1_0000 : raw;
  return [unsigned & 0xff, (unsigned >>> 8) & 0xff];
}

/**
 * Encode one control point request.
 *
 * @throws {SensorError} `control-out-of-range` for a parameter the wire field
 * cannot carry. Encoding is where a scaling error becomes a physical one, so
 * the range check is here as well as in the client — a caller that reaches for
 * the encoder directly gets the same refusal.
 */
export function encodeControlRequest(request: ControlRequest): Uint8Array {
  const op = opCodeOf(request);
  switch (request.opCode) {
    case 'request-control':
    case 'reset':
    case 'start-or-resume':
      return bytesOf(op);
    case 'stop':
      return bytesOf(op, STOP_OR_PAUSE_PARAMETER.stop);
    case 'pause':
      return bytesOf(op, STOP_OR_PAUSE_PARAMETER.pause);
    case 'set-target-power':
      return bytesOf(
        op,
        ...littleEndian16(scaled(request.target, 1, SINT16_MIN, SINT16_MAX, 'a target power')),
      );
    case 'set-target-resistance':
      return bytesOf(
        op,
        scaled(request.level, RESISTANCE_UNITS_PER_LEVEL, 0, 255, 'a target resistance level'),
      );
    case 'set-simulation-parameters': {
      const { parameters } = request;
      const wind = scaled(
        parameters.windSpeed ?? 0,
        WIND_SPEED_UNITS_PER_METRE_PER_SECOND,
        SINT16_MIN,
        SINT16_MAX,
        'a wind speed',
      );
      // The one signed field that matters to a rider: a descent must stay a
      // descent. `littleEndian16` writes the twos complement.
      const grade = scaled(
        parameters.grade,
        GRADE_UNITS_PER_PERCENT,
        SINT16_MIN,
        SINT16_MAX,
        'a gradient',
      );
      const crr = scaled(
        parameters.rollingResistanceCoefficient ?? DEFAULT_ROLLING_RESISTANCE_COEFFICIENT,
        ROLLING_RESISTANCE_UNITS_PER_UNIT,
        0,
        255,
        'a rolling resistance coefficient',
      );
      const cw = scaled(
        parameters.windResistanceCoefficient ?? DEFAULT_WIND_RESISTANCE_COEFFICIENT,
        WIND_RESISTANCE_UNITS_PER_KILOGRAM_PER_METRE,
        0,
        255,
        'a wind resistance coefficient',
      );
      return bytesOf(op, ...littleEndian16(wind), ...littleEndian16(grade), crr, cw);
    }
  }
}

/** What the machine said about the procedure it just ran. */
export type ControlResult =
  | 'success'
  | 'op-code-not-supported'
  | 'invalid-parameter'
  | 'operation-failed'
  | 'control-not-permitted'
  /** `0x06`–`0xFF`. Not success, and named so it cannot be mistaken for one. */
  | 'reserved';

/** One response indication, decoded. */
export interface ControlResponse {
  /** The op code the machine says it is answering. **Correlate this.** */
  readonly requestOpCode: number;
  readonly result: ControlResult;
}

function resultOf(code: number): ControlResult {
  switch (code) {
    case FTMS_RESULT_CODE.success:
      return 'success';
    case FTMS_RESULT_CODE.opCodeNotSupported:
      return 'op-code-not-supported';
    case FTMS_RESULT_CODE.invalidParameter:
      return 'invalid-parameter';
    case FTMS_RESULT_CODE.operationFailed:
      return 'operation-failed';
    case FTMS_RESULT_CODE.controlNotPermitted:
      return 'control-not-permitted';
    default:
      // Including 0x00, which is reserved. Anything unrecognised is NOT
      // success: a client that defaulted the other way would report a setpoint
      // as applied on the strength of a code it has no word for.
      return 'reserved';
  }
}

/**
 * Decode one Fitness Machine Control Point indication.
 *
 * @throws {SensorError} `malformed-payload` for a short value, or for a first
 * octet that is not `0x80`. A value that is not a Response Code is not a
 * response to anything, and treating it as one would correlate a setpoint
 * against noise.
 */
export function decodeControlResponse(value: DataView): ControlResponse {
  const reader = createPayloadReader(value, 'a Fitness Machine Control Point indication');
  const responseCode = reader.u8('response code op code');
  if (responseCode !== FTMS_OP_CODE.responseCode) {
    throw malformedPayload(
      `a Fitness Machine Control Point indication begins with 0x${responseCode.toString(
        16,
      )} rather than the response code op 0x80`,
    );
  }
  return {
    requestOpCode: reader.u8('request op code'),
    result: resultOf(reader.u8('result code')),
  };
}

/** One Fitness Machine Status notification, decoded. */
export type MachineStatus =
  | { readonly kind: 'reset' }
  | { readonly kind: 'stopped-or-paused' }
  | { readonly kind: 'stopped-by-safety-key' }
  | { readonly kind: 'started-or-resumed' }
  | { readonly kind: 'target-power-changed'; readonly target: number }
  | { readonly kind: 'target-resistance-changed'; readonly level: number }
  | { readonly kind: 'simulation-parameters-changed' }
  | { readonly kind: 'control-permission-lost' }
  /** A status this client does not model. Reported, never raised. */
  | { readonly kind: 'other'; readonly opCode: number };

/**
 * Decode one Fitness Machine Status notification.
 *
 * An op code this client does not model is reported as `other` rather than
 * raised: a machine that notifies a status about a procedure this program never
 * performs must not take the ride down.
 *
 * @throws {SensorError} `malformed-payload` for an empty notification, or for
 * one whose parameter is shorter than its op code promises.
 */
export function decodeFitnessMachineStatus(value: DataView): MachineStatus {
  const reader = createPayloadReader(value, 'a Fitness Machine Status notification');
  const opCode = reader.u8('status op code');
  switch (opCode) {
    case FITNESS_MACHINE_STATUS_OP_CODE.reset:
      return { kind: 'reset' };
    case FITNESS_MACHINE_STATUS_OP_CODE.stoppedOrPausedByUser:
      return { kind: 'stopped-or-paused' };
    case FITNESS_MACHINE_STATUS_OP_CODE.stoppedBySafetyKey:
      return { kind: 'stopped-by-safety-key' };
    case FITNESS_MACHINE_STATUS_OP_CODE.startedOrResumedByUser:
      return { kind: 'started-or-resumed' };
    case FITNESS_MACHINE_STATUS_OP_CODE.targetPowerChanged:
      return { kind: 'target-power-changed', target: reader.i16('new target power') };
    case FITNESS_MACHINE_STATUS_OP_CODE.targetResistanceChanged:
      return {
        kind: 'target-resistance-changed',
        level: reader.u8('new target resistance level') / RESISTANCE_UNITS_PER_LEVEL,
      };
    case FITNESS_MACHINE_STATUS_OP_CODE.simulationParametersChanged:
      return { kind: 'simulation-parameters-changed' };
    case FITNESS_MACHINE_STATUS_OP_CODE.controlPermissionLost:
      return { kind: 'control-permission-lost' };
    default:
      return { kind: 'other', opCode };
  }
}

// --- The client -------------------------------------------------------------

/**
 * What a transport has to supply for this client to drive a control point.
 *
 * Four methods, none of which names a platform type. `web-bluetooth/` fills it
 * from a `BluetoothRemoteGATTCharacteristic`; the simulator fills it from the
 * bench's own machine; a native stack (#15) fills it from
 * `BleClient.write(deviceId, service, characteristic, value)`. That is the
 * whole reason this lives in `protocol/`.
 */
export interface FitnessMachineChannel {
  /**
   * Configure the control point CCCD for **indications** — value `0x0002`.
   *
   * Called before the first write and again after a reconnection, because the
   * descriptor is per-connection. Idempotent from this client's side.
   */
  enableControlPointIndications(): Promise<void>;
  /** Control point indications, as the characteristic's own `DataView`. */
  onControlPointIndication(listener: (value: DataView) => void): Unsubscribe;
  /** Fitness Machine Status notifications, likewise. */
  onStatus(listener: (value: DataView) => void): Unsubscribe;
  /**
   * Write to the control point.
   *
   * @returns a promise that rejects with the **ATT error** when the write
   * itself was refused, and resolves when the machine acknowledged the write.
   * Resolving says nothing about the result: that arrives as an indication.
   */
  writeControlPoint(value: Uint8Array): Promise<void>;
}

/** Why this client stopped holding control. */
export type ControlLossReason =
  /** Another client took it, or the machine revoked it. */
  | 'permission-lost'
  /** This client's own Reset revoked it — FTMS §4.16.2.1. */
  | 'reset'
  /** The connection went. Control does not survive one. */
  | 'link-lost';

/**
 * What this client believes the trainer's ERG target to be.
 *
 * Three states rather than `Watts | undefined`, because "we do not know" is a
 * real and different answer from "there is none". After a timeout or a dropped
 * link the machine may or may not be holding the last target, and a UI that
 * showed the last confirmed figure would be telling the rider something nobody
 * confirmed.
 */
export type TargetPower =
  | { readonly kind: 'none' }
  | { readonly kind: 'confirmed'; readonly target: Watts }
  | { readonly kind: 'unknown'; readonly attempted: Watts };

/**
 * A one-shot timer, injected.
 *
 * `protocol/` is platform-free, so there is no `setTimeout` here and no `Date`.
 * A transport that has one passes it in; the returned function cancels.
 */
export type ScheduleTimeout = (afterSeconds: Seconds, run: () => void) => () => void;

/**
 * How long a procedure may go unanswered before this client gives up on it.
 *
 * FTMS §4.16.4 defines when a procedure starts and completes but names no
 * timeout; the ATT transaction timeout underneath is 30 s. Five seconds is a
 * product choice rather than a protocol one: a rider whose ERG target has not
 * changed in five seconds has already noticed, and a client that waits 30 s
 * blocks every subsequent setpoint behind the one that hung.
 */
export const CONTROL_POINT_PROCEDURE_TIMEOUT_SECONDS = 5 as Seconds;

export interface TrainerControlOptions {
  /**
   * The device's own Supported Power Range, **read from the device**. Required:
   * #43's acceptance criteria say an out-of-range target must be rejected using
   * the range the device reported and not a hard-coded assumption, and a
   * default here would be that assumption.
   */
  readonly powerRange: SupportedPowerRange;
  /**
   * The device's Supported Resistance Level Range. Without it
   * {@link TrainerControl.setTargetResistance} refuses, because a brake level
   * means nothing except relative to the range of the machine it is written to.
   */
  readonly resistanceRange?: SupportedResistanceLevelRange | undefined;
  /**
   * The machine's Feature characteristic. Supplied, ERG is gated on Target
   * Setting bit 3 and simulation on bit 13. Omitted, neither is gated — a
   * transport that has not read the Feature characteristic (#134) must not have
   * every setpoint refused.
   */
  readonly features?: FitnessMachineFeatures | undefined;
  /** Named on every error, so a bug report can say which trainer. */
  readonly deviceId?: string | undefined;
  /**
   * Request control again when the machine reports it lost. Defaults to `true`.
   *
   * ⚠️ Never after a **Reset**: this client's own reset deliberately gives
   * control up, and silently taking it back would defeat the procedure.
   */
  readonly reacquireControl?: boolean | undefined;
  /** See {@link ScheduleTimeout}. Omitted, procedures are not timed out. */
  readonly scheduleTimeout?: ScheduleTimeout | undefined;
}

export interface TrainerControl {
  /** Whether the machine has granted control and has not taken it back. */
  hasControl(): boolean;
  /** What this client believes the ERG target to be, and how sure it is. */
  targetPower(): TargetPower;
  /** Request control, enabling indications first if they are not on. */
  requestControl(): Promise<void>;
  /**
   * Set the ERG target.
   *
   * @returns the value actually written, after quantisation to the device's
   * minimum increment — which is not always the value asked for.
   * @throws {SensorError} `control-not-held`, `control-out-of-range`,
   * `capability-unsupported`, `control-rejected`, `control-timed-out` or
   * `not-connected`. It never resolves for a setpoint the machine did not
   * confirm.
   */
  setTargetPower(target: Watts): Promise<Watts>;
  /** Set the brake level. @returns the quantised level actually written. */
  setTargetResistance(level: ResistanceLevel): Promise<ResistanceLevel>;
  /** Set the simulated course conditions. */
  setSimulationParameters(parameters: SimulationParameters): Promise<void>;
  /** Stop the training session. The deliberate way to end resistance. */
  stop(): Promise<void>;
  /**
   * Start or resume the training session.
   *
   * The counterpart of {@link stop}. A machine that has been stopped ignores
   * setpoints until it is started again, which is the second way a workout
   * player can find every target it sends going nowhere.
   */
  start(): Promise<void>;
  /** Reset the machine to its defaults. ⚠️ Revokes this client's control. */
  reset(): Promise<void>;
  /** Told whenever control is lost, with the reason. */
  onControlLost(listener: Listener<ControlLossReason>): Unsubscribe;
  /**
   * The link dropped.
   *
   * Called by the transport. Rejects the procedure in flight, drops the control
   * claim, and marks the target **unknown** rather than none — the machine is
   * still holding whatever it last accepted, and this client can no longer
   * change it. That is a state a UI has to be able to show.
   */
  linkLost(): void;
  /**
   * A new link came up.
   *
   * Also the transport's to call. Control is **not** restored: FTMS §4.16.2.1
   * ends control permission when the connection terminates, so the caller has
   * to `requestControl()` again — and the CCCD is per-connection too, so this
   * client re-enables indications on its next write rather than assuming the
   * descriptor survived.
   */
  linkRestored(): void;
  /** Unsubscribe from the channel and refuse everything after. */
  close(): void;
}

interface Pending {
  readonly expectedOpCode: number;
  readonly resolve: (response: ControlResponse) => void;
  readonly reject: (error: SensorError) => void;
  readonly cancelTimeout: () => void;
}

export function createTrainerControl(
  channel: FitnessMachineChannel,
  options: TrainerControlOptions,
): TrainerControl {
  const { powerRange, resistanceRange, features, deviceId, scheduleTimeout } = options;
  const reacquireControl = options.reacquireControl ?? true;

  let held = false;
  let indicationsEnabled = false;
  let linkUp = true;
  let closed = false;
  let target: TargetPower = { kind: 'none' };
  let pending: Pending | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const lossListeners: Array<Listener<ControlLossReason>> = [];

  const fail = (
    code: 'control-not-held' | 'control-rejected' | 'control-timed-out' | 'not-connected',
    message: string,
  ): SensorError =>
    new SensorError(code, message, deviceId === undefined ? undefined : { deviceId });

  const loseControl = (reason: ControlLossReason): void => {
    held = false;
    for (const listener of [...lossListeners]) {
      listener(reason);
    }
  };

  // --- The indication half, installed once and never per write --------------

  const settlePending = (response: ControlResponse): void => {
    const waiting = pending;
    if (waiting === undefined) {
      // An indication with nothing outstanding. FTMS serialises procedures, so
      // this is a machine talking out of turn; it is not this client's answer
      // to anything and is dropped rather than correlated against the next
      // write.
      return;
    }
    pending = undefined;
    waiting.cancelTimeout();
    if (response.requestOpCode !== waiting.expectedOpCode) {
      waiting.reject(
        fail(
          'control-rejected',
          `the machine answered op code 0x${response.requestOpCode.toString(
            16,
          )} while 0x${waiting.expectedOpCode.toString(16)} was outstanding`,
        ),
      );
      return;
    }
    waiting.resolve(response);
  };

  const stopIndications = channel.onControlPointIndication((value) => {
    let response: ControlResponse;
    try {
      response = decodeControlResponse(value);
    } catch {
      // An unreadable indication is a device fault and costs one procedure's
      // answer; it must not throw out of a notification handler.
      return;
    }
    settlePending(response);
  });

  const stopStatus = channel.onStatus((value) => {
    let status: MachineStatus;
    try {
      status = decodeFitnessMachineStatus(value);
    } catch {
      return;
    }
    if (status.kind === 'control-permission-lost') {
      target = { kind: 'none' };
      loseControl('permission-lost');
      if (reacquireControl && linkUp && !closed) {
        void requestControl().catch(() => undefined);
      }
    }
  });

  // --- One procedure, awaited and correlated --------------------------------

  const runProcedure = async (request: ControlRequest): Promise<ControlResponse> => {
    if (closed || !linkUp) {
      throw fail('not-connected', 'a control point write needs a connection');
    }
    if (!indicationsEnabled) {
      // 0x2AD9 is indications, CCCD 0x0002. Before this, every write is an ATT
      // error at best.
      await channel.enableControlPointIndications();
      indicationsEnabled = true;
    }

    const bytes = encodeControlRequest(request);
    const expectedOpCode = opCodeOf(request);

    // ⚠️ Armed BEFORE the write, deliberately. A stack may dispatch the
    // indication before the write promise settles, and a client that subscribed
    // afterwards would wait for an answer it has already been given.
    const answered = new Promise<ControlResponse>((resolve, reject) => {
      const cancelTimeout =
        scheduleTimeout === undefined
          ? () => undefined
          : scheduleTimeout(CONTROL_POINT_PROCEDURE_TIMEOUT_SECONDS, () => {
              if (pending?.resolve === resolve) {
                pending = undefined;
              }
              reject(
                fail(
                  'control-timed-out',
                  `the machine did not answer op code 0x${expectedOpCode.toString(
                    16,
                  )} within ${String(CONTROL_POINT_PROCEDURE_TIMEOUT_SECONDS)} s`,
                ),
              );
            });
      pending = { expectedOpCode, resolve, reject, cancelTimeout };
    });

    try {
      await channel.writeControlPoint(bytes);
    } catch (cause) {
      // An ATT error — `CCCD Improperly Configured`, `Procedure Already In
      // Progress`, or a link that went while the write was in flight. FTMS
      // §4.16.4: a procedure is NOT started when the write returns an ATT
      // error, so nothing on the machine changed and the previously confirmed
      // setpoint still stands.
      const refused = new SensorError(
        'control-rejected',
        'the control point write was refused by the attribute protocol',
        { ...(deviceId === undefined ? {} : { deviceId }), cause },
      );
      const waiting = pending;
      if (waiting?.expectedOpCode === expectedOpCode) {
        pending = undefined;
        waiting.cancelTimeout();
        waiting.reject(refused);
      }
      // Settled above, and nothing is awaiting it on this path.
      answered.catch(() => undefined);
      throw refused;
    }

    const response = await answered;
    if (response.result === 'control-not-permitted') {
      // The routine case on a phone that reconnected. No status notification
      // arrives; the machine simply says no. A client that kept believing it
      // had control would write into the void for the rest of the ride.
      loseControl('permission-lost');
      throw fail(
        'control-not-held',
        `the machine refused op code 0x${expectedOpCode.toString(16)}: control not permitted`,
      );
    }
    if (response.result !== 'success') {
      throw fail(
        'control-rejected',
        `the machine refused op code 0x${expectedOpCode.toString(16)}: ${response.result}`,
      );
    }
    return response;
  };

  /** Serialised: this client never provokes Procedure Already In Progress. */
  const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    // The chain must not be poisoned by a rejection, or one refused setpoint
    // would wedge every later one for the rest of the ride.
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  function requestControl(): Promise<void> {
    return enqueue(async () => {
      await runProcedure({ opCode: 'request-control' });
      held = true;
    });
  }

  const requireControl = (): void => {
    if (closed || !linkUp) {
      // Checked before the control claim so that a dropped link reads as a
      // dropped link. Both are true after `linkLost()`, and "not connected" is
      // the one a UI can act on.
      throw fail('not-connected', 'a control point write needs a connection');
    }
    if (!held) {
      throw fail(
        'control-not-held',
        'this client has not been granted control of the machine; a setpoint written now would be ignored rather than refused',
      );
    }
  };

  const requireFeature = (supported: boolean | undefined, what: string): void => {
    if (supported === false) {
      throw new SensorError(
        'capability-unsupported',
        `this machine's Fitness Machine Feature characteristic does not claim ${what}`,
        deviceId === undefined ? undefined : { deviceId },
      );
    }
  };

  /**
   * Round onto the device's own grid, measured from its minimum, never above
   * its maximum.
   *
   * Rounding up past the maximum is the failure worth naming: a device whose
   * range does not land on its own increment (0..998 in steps of 25) would
   * otherwise be handed 1000.
   */
  const quantise = (value: number, min: number, max: number, increment: number): number => {
    const steps = Math.round((value - min) / increment);
    const candidate = min + steps * increment;
    if (candidate > max) {
      return min + (steps - 1) * increment;
    }
    return candidate;
  };

  return {
    hasControl: () => held,
    targetPower: () => target,
    requestControl,

    setTargetPower(requested: Watts): Promise<Watts> {
      return enqueue(async () => {
        requireControl();
        requireFeature(features?.targetSetting.powerTarget, 'power target setting');
        if (requested > MAX_PLAUSIBLE_TARGET_POWER_WATTS) {
          throw outOfRange(
            `a target of ${String(requested)} W is above the ${String(
              MAX_PLAUSIBLE_TARGET_POWER_WATTS,
            )} W ceiling this client will write to a trainer`,
          );
        }
        if (requested < powerRange.minimum || requested > powerRange.maximum) {
          throw outOfRange(
            `a target of ${String(requested)} W is outside the ${String(
              powerRange.minimum,
            )}..${String(powerRange.maximum)} W range this device reported`,
          );
        }
        const quantised = watts(
          quantise(requested, powerRange.minimum, powerRange.maximum, powerRange.increment),
        );
        try {
          await runProcedure({ opCode: 'set-target-power', target: quantised });
        } catch (error) {
          if (error instanceof SensorError && error.code === 'control-timed-out') {
            // The machine may or may not have applied it. Saying "confirmed"
            // would be a claim nobody made; saying "none" would be one too.
            target = { kind: 'unknown', attempted: quantised };
          }
          throw error;
        }
        target = { kind: 'confirmed', target: quantised };
        return quantised;
      });
    },

    setTargetResistance(requested: ResistanceLevel): Promise<ResistanceLevel> {
      return enqueue(async () => {
        requireControl();
        requireFeature(features?.targetSetting.resistanceTarget, 'resistance target setting');
        if (resistanceRange === undefined) {
          throw new SensorError(
            'capability-unsupported',
            "a brake level means nothing except relative to the machine's own Supported Resistance Level Range, which was not read",
            deviceId === undefined ? undefined : { deviceId },
          );
        }
        if (requested < resistanceRange.minimum || requested > resistanceRange.maximum) {
          throw outOfRange(
            `a resistance level of ${String(requested)} is outside the ${String(
              resistanceRange.minimum,
            )}..${String(resistanceRange.maximum)} range this device reported`,
          );
        }
        if (requested > MAX_ENCODABLE_RESISTANCE_LEVEL) {
          throw outOfRange(
            `a resistance level of ${String(requested)} is above ${String(
              MAX_ENCODABLE_RESISTANCE_LEVEL,
            )}, which is the most the uint8 Set Target Resistance Level parameter can carry`,
          );
        }
        const quantised = resistanceLevel(
          quantise(
            requested,
            resistanceRange.minimum,
            resistanceRange.maximum,
            resistanceRange.increment,
          ),
        );
        await runProcedure({ opCode: 'set-target-resistance', level: quantised });
        return quantised;
      });
    },

    setSimulationParameters(parameters: SimulationParameters): Promise<void> {
      return enqueue(async () => {
        requireControl();
        requireFeature(
          features?.targetSetting.indoorBikeSimulationParameters,
          'indoor bike simulation parameters',
        );
        if (Math.abs(parameters.grade) > MAX_PLAUSIBLE_GRADE_PERCENT) {
          throw outOfRange(
            `a gradient of ${String(parameters.grade)} % is beyond the ±${String(
              MAX_PLAUSIBLE_GRADE_PERCENT,
            )} % this client will simulate`,
          );
        }
        const crr = parameters.rollingResistanceCoefficient;
        if (crr !== undefined && (crr < 0 || crr > MAX_ROLLING_RESISTANCE_COEFFICIENT)) {
          throw outOfRange(
            `a rolling resistance coefficient of ${String(crr)} is outside 0..${String(
              MAX_ROLLING_RESISTANCE_COEFFICIENT,
            )}`,
          );
        }
        const cw = parameters.windResistanceCoefficient;
        if (cw !== undefined && (cw < 0 || cw > MAX_WIND_RESISTANCE_COEFFICIENT)) {
          throw outOfRange(
            `a wind resistance coefficient of ${String(cw)} is outside 0..${String(
              MAX_WIND_RESISTANCE_COEFFICIENT,
            )}`,
          );
        }
        if (
          parameters.windSpeed !== undefined &&
          parameters.windSpeed > MAX_WIND_SPEED_METRES_PER_SECOND
        ) {
          throw outOfRange(
            `a wind speed of ${String(parameters.windSpeed)} m/s is above ${String(
              MAX_WIND_SPEED_METRES_PER_SECOND,
            )} m/s`,
          );
        }
        await runProcedure({
          opCode: 'set-simulation-parameters',
          parameters: {
            ...parameters,
            windSpeed: parameters.windSpeed ?? metresPerSecond(0),
          },
        });
      });
    },

    stop(): Promise<void> {
      return enqueue(async () => {
        requireControl();
        await runProcedure({ opCode: 'stop' });
        target = { kind: 'none' };
      });
    },

    start(): Promise<void> {
      return enqueue(async () => {
        requireControl();
        await runProcedure({ opCode: 'start-or-resume' });
      });
    },

    reset(): Promise<void> {
      return enqueue(async () => {
        requireControl();
        await runProcedure({ opCode: 'reset' });
        // FTMS §4.16.2.1: control permission ends when the client initiates a
        // Reset. The machine is now ignoring this client, and a workout player
        // that reset between intervals would send every later target into the
        // void. `reacquireControl` deliberately does not apply.
        target = { kind: 'none' };
        loseControl('reset');
      });
    },

    onControlLost(listener): Unsubscribe {
      lossListeners.push(listener);
      return () => {
        const index = lossListeners.indexOf(listener);
        if (index !== -1) {
          lossListeners.splice(index, 1);
        }
      };
    },

    linkLost(): void {
      linkUp = false;
      indicationsEnabled = false;
      const waiting = pending;
      pending = undefined;
      if (waiting !== undefined) {
        waiting.cancelTimeout();
        waiting.reject(fail('not-connected', 'the link dropped while a procedure was outstanding'));
      }
      if (target.kind === 'confirmed') {
        // The machine is still holding it and this client can no longer change
        // it. "Confirmed" would tell a UI everything is fine.
        target = { kind: 'unknown', attempted: target.target };
      }
      loseControl('link-lost');
    },

    linkRestored(): void {
      linkUp = true;
      // Deliberately not `held = true`. Nothing about a new connection grants
      // control, and a client that assumed otherwise would write setpoints the
      // machine ignores — which is the failure this whole file is about.
      // `indicationsEnabled` is already false; the CCCD is per-connection.
    },

    close(): void {
      closed = true;
      stopIndications();
      stopStatus();
      lossListeners.splice(0);
      held = false;
    },
  };
}
