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
 * ## Letting the trainer go is a Reset, not a Stop — #372
 *
 * ⚠️ **This file used to say that `stop()` was "the deliberate way to end
 * resistance", and a reviewer who remembers that is reading the old file.**
 * On the one trainer this program has been measured against, an acknowledged
 * `0x08` Stop released NOTHING, of either kind: a ride ended on a climb left
 * the grade applied (validation 0002 Part L, 2026-09-19), and for 36 s after an
 * acknowledged Stop an ERG target of 200 W was still being chased — power rose
 * from 99 W to 175 W while cadence fell from 55 to 46 rpm, which a passive
 * brake cannot do (#372, 2026-09-21). FTMS `Stop` ends the training *session*;
 * nothing in the specification requires a machine to discard its target
 * settings on it.
 *
 * So {@link TrainerControl.letGo} sends `0x01` **Reset**, which FTMS
 * §4.16.2.1 defines as returning the machine to its default state — the
 * specification's own instrument for clearing target settings — and which
 * revokes this client's control. That second half is what the Reset trap above
 * is about, and it does not forbid this: the trap is a player that resets
 * *between intervals and keeps sending*. A release is **terminal**. Nothing is
 * written after it, losing control is the intent, and a later write is not
 * lost into the void either — {@link TrainerControl.hasControl} is false, so
 * `requireControl` refuses it out loud.
 *
 * ⚠️ **What no test here can prove is that a real trainer releases on a
 * Reset.** The #44 simulator clears its targets on one because it was written
 * to; that is a statement about a double. Validation 0002 Part L's pedal-through
 * step is the only evidence that counts.
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
 *   never answers leaves its procedure pending until `linkLost()` or
 *   `close()`, each of which rejects it rather than leaving the queue wedged
 *   behind an answer that can no longer arrive.
 */

import {
  gradePercent,
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
 *
 * @unwired it bounds {@link TrainerControl.setTargetResistance}, which nothing
 * in this client calls — see that method. The bound is reached from inside this
 * module and is exported so `fitness-machine-control.test.ts` can assert the
 * refusal against the number rather than against a literal typed twice.
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

/**
 * Wind speed is a `sint16` at 0.001 m/s, so the field carries ±32.767 m/s.
 *
 * ⚠️ A **field-width limit, not a plausibility bound** — unlike every
 * `MAX_PLAUSIBLE_*` in this program, which is a product judgement about what a
 * reading can credibly be. 32.767 m/s is 118 km/h of headwind, so nothing this
 * client would ever simulate reaches it.
 *
 * The *usable* range is narrower still and in one direction only: `sint16`
 * admits a tailwind, `MetresPerSecond` is non-negative, so a tailwind cannot be
 * expressed through this parameter at all. That is #16's problem to raise when
 * it drives conditions from a course, and it is a domain-type question rather
 * than a wire one.
 */
const MAX_ENCODABLE_WIND_SPEED_METRES_PER_SECOND =
  SINT16_MAX / WIND_SPEED_UNITS_PER_METRE_PER_SECOND;

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

/** The release fallback's road: level, in still air. @see TrainerControl.letGo */
const FLAT_ROAD: GradePercent = gradePercent(0);

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
   *
   * ⚠️ **An implementation must use an acknowledged write** —
   * `writeValueWithResponse()` on Web Bluetooth, `write` rather than
   * `writeWithoutResponse` on a native stack. Filling this with an
   * unacknowledged write compiles, satisfies every test in this file, and
   * reintroduces exactly the fire-and-forget failure the client exists to
   * prevent: `CCCD Improperly Configured` and `Procedure Already In Progress`
   * would never reject, so an unwritten setpoint would be indistinguishable
   * from a machine that simply never answered.
   */
  writeControlPoint(value: Uint8Array): Promise<void>;
}

/**
 * What a {@link TrainerControl.letGo} achieved, as far as the machine said.
 *
 * Two outcomes rather than a boolean, because the second is a real and
 * different thing to tell a rider: the trainer answered, and what it answered
 * does not establish that the resistance is gone. The whole of #372 is a
 * command that was acknowledged and did not do what it claimed, so nothing but
 * a Reset answered with success is reported as a release.
 */
export type TrainerRelease =
  /**
   * `0x01` Reset, answered with success. The machine has been told to return to
   * its defaults, and this client no longer holds control.
   */
  | { readonly kind: 'reset' }
  /**
   * The Reset was refused or went unanswered, so the fallback was written: a
   * flat road in still air (where the machine offers simulation), then Stop.
   * ⚠️ **Not a confirmed release.** A flat road takes a trainer out of ERG into
   * the gentlest simulation there is, which is the most this client can ask
   * for without a Reset — and on a machine that retains targets through a
   * Stop, it is also what is left applied.
   */
  | {
      readonly kind: 'incomplete';
      /** Why the Reset did not do it. */
      readonly resetRefusal: SensorError;
      /** Whether the flat road was written and acknowledged. */
      readonly flattened: boolean;
    };

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

/**
 * What a rider is told when the machine answers `0x05` Control Not Permitted.
 *
 * `0x05` already has its own code — `control-not-held`, distinct from the
 * `control-rejected` every other refusal becomes — but a code is not an
 * instruction, and `apps/web`'s ride controller renders a `SensorError`'s
 * **message**. So the message has to be the actionable half, and #90's fifth
 * criterion asks for exactly that: it must *name the likely cause*.
 *
 * The likely cause is not a fault. FTMS §4.16.2 grants control to one client at
 * a time, and on a phone the other client is very often the rider's own second
 * cycling app, left running in the background, or the trainer manufacturer's
 * app, or a head unit that paired itself on the way past. "The trainer refused
 * the command" sends that rider to a support page about their trainer; this
 * sends them to the app switcher.
 *
 * ⚠️ **No device name, no address, and no other client's identity** — there is
 * nothing in the protocol that says who holds control, and SECURITY.md treats
 * naming a nearby device as in scope. The sentence is a list of the usual
 * suspects, not a claim about this one.
 */
export const CONTROL_NOT_PERMITTED_GUIDANCE =
  "another app is controlling this trainer, so it is ignoring this one. That is usually a second cycling app still running on this device, the trainer maker's own app, or a head unit that connected to it. Close or disconnect the other one, then reconnect here.";

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
  /**
   * Set the brake level. @returns the quantised level actually written.
   *
   * @unwired no screen offers one, and that is a product decision rather than
   * an omission. This client drives a trainer two ways — an ERG target from a
   * workout (#14) and a gradient from a route (#362) — and both are quantities
   * a rider can reason about. A brake level means nothing except relative to
   * the range of the machine it is written to, so a control for it would be a
   * number with no units in front of somebody who is pedalling. It is
   * implemented because #43's criteria are about the *protocol* being complete,
   * and it is watched since #363 because a trainer command with no caller is
   * exactly the shape #362 had.
   */
  setTargetResistance(level: ResistanceLevel): Promise<ResistanceLevel>;
  /** Set the simulated course conditions. */
  setSimulationParameters(parameters: SimulationParameters): Promise<void>;
  /**
   * Stop the training session — `0x08` with control information `0x01`.
   *
   * ⚠️ **This ends the SESSION. It does not end the resistance, and it is NOT
   * how this program lets a trainer go.** This comment used to say it was "the
   * deliberate way to end resistance" — a reviewer who remembers that sentence
   * is reading the old file. FTMS does not require a machine to discard its
   * target setting values on `0x08`, and the trainer #372 was measured on keeps
   * both kinds through an acknowledged Stop: a grade (2026-09-19) and an ERG
   * target it went on chasing (2026-09-21). {@link letGo} is the release.
   *
   * It stays for the non-terminal cases — a workout's free-ride block, a pause
   * — where this client will write again and must keep control to do it.
   * @see https://github.com/openzigs/onyourleft/issues/372
   */
  stop(): Promise<void>;
  /**
   * Let the trainer go at the end of a ride, a workout or an ERG session — the
   * one place in the program that decides what a release sends (#372).
   *
   * ⚠️ **Named `letGo` rather than `release` on purpose.** CLAUDE.md §4j's
   * `WIRE003` credits a call by member name, and production already calls a
   * `release()` on the screen wake lock and the map protocol — so a method
   * called `release` stayed green in that gate with every one of its own
   * callers deleted. Measured, not assumed.
   *
   * Sends `0x01` **Reset**. On success the machine has been told to return to
   * its defaults and this client **no longer holds control** — by design, and
   * silently: a release is not a loss, so {@link onControlLost} is NOT told,
   * and a `0xFF` Control Permission Lost is not re-acquired against — whether
   * it arrives after the Reset's answer, or BEFORE it, which nothing in BLE or
   * FTMS rules out. The caller that released owns what happens next; taking
   * control again is {@link requestControl}, which is a thing the rider does.
   *
   * If the machine refuses the Reset or does not answer it, and control is
   * still held, the fallback is written: Set Indoor Bike Simulation Parameters
   * at 0 % in still air — skipped where the Feature characteristic says the
   * machine has no simulation mode — then Stop. That resolves `incomplete`,
   * never `reset`. A revocation during the fallback (a `0xFF`, or Control Not
   * Permitted answering the flat road after a Reset that timed out) ends it
   * early, still `incomplete`, and is not reported as a loss either.
   *
   * @throws {SensorError} `control-not-held` or `not-connected` when there is
   * nothing this client can send — including a Reset answered Control Not
   * Permitted, which is an involuntary loss and IS reported as one — and
   * whatever the fallback's Stop was refused with. A rejection means the
   * trainer may still be holding whatever it held.
   */
  letGo(): Promise<TrainerRelease>;
  /**
   * Start or resume the training session.
   *
   * The counterpart of {@link stop}. A machine that has been stopped ignores
   * setpoints until it is started again, which is the second way a workout
   * player can find every target it sends going nowhere.
   */
  start(): Promise<void>;
  /**
   * Reset the machine to its defaults. ⚠️ Revokes this client's control, and
   * tells {@link onControlLost} so with the reason `reset`.
   *
   * The bare procedure. A release at the end of a ride is {@link letGo},
   * which sends the same op code and is not reported as a loss.
   */
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
  /**
   * Unsubscribe from the channel and refuse everything after.
   *
   * Rejects the procedure in flight, as {@link TrainerControl.linkLost} does
   * and for the same reason: the indication is unsubscribed here, so its answer
   * can no longer arrive, and `enqueue` chains every later call behind it.
   */
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
  /**
   * Set when a {@link TrainerControl.letGo} has run — whatever it achieved —
   * and cleared by the next granted Request Control. While it is set a `0xFF`
   * Control Permission Lost is the tail of a release this client asked for, and
   * neither a loss to report nor a control to take back — re-acquiring here
   * would be the silent re-grab the release exists to rule out.
   *
   * ⚠️ This used to be set only by a Reset answered with success, and a
   * reviewer who remembers that is reading the old file. It left two holes:
   * see {@link releasing}, and an `incomplete` release after which a late
   * `0xFF` still queued a Request Control behind a ride that had ended.
   */
  let released = false;
  /**
   * Present for the WHOLE of a {@link TrainerControl.letGo} — set before the
   * Reset is written, cleared when the release settles.
   *
   * ⚠️ **Why before the write, and not on the Reset's answer.** A `0xFF`
   * Control Permission Lost arrives on the Fitness Machine Status
   * characteristic and the Reset's answer on the control point, and nothing in
   * BLE or FTMS orders two different characteristics. A machine that revokes
   * control as it executes a Reset may notify `0xFF` BEFORE it indicates
   * `80 01 01` — and when the flag was set only on that answer, the `0xFF` was
   * read as an involuntary loss: "Control lost" on the Ride screen, a finished
   * workout paused through `linkLost`, and a Request Control queued straight
   * behind the Reset, so control came back without the rider doing anything.
   * PR #442's review reproduced exactly that, writes `[0x00, 0x05, 0x01, 0x00]`.
   *
   * While it is present, a revocation — a `0xFF`, or Control Not Permitted
   * answering one of the fallback's writes after a Reset that timed out — is
   * recorded here and nothing else: control is dropped, no listener is told,
   * nothing is re-requested. The Reset's OWN Control Not Permitted answer is
   * the exception and is still a loss, because it says the Reset was not this
   * client's to send: somebody else had the machine first.
   *
   * ⚠️ It is NOT evidence of a release. A `0xFF` cannot say whose action caused
   * it, so a release whose Reset was not answered with success still resolves
   * `incomplete` even when the machine revoked control during it.
   */
  let releasing: { revoked: boolean } | undefined;
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
      if (releasing !== undefined) {
        held = false;
        releasing.revoked = true;
        return;
      }
      if (released) {
        held = false;
        return;
      }
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
      if (closed || !linkUp) {
        // ⚠️ Re-checked, because this is the one await that happens BEFORE the
        // indication waiter is armed — so a teardown landing here finds no
        // `pending` to reject, and the procedure would go on to arm a waiter
        // that `close()` has already unsubscribed, or to claim control on a
        // link that is down. Recording the CCCD as enabled would be wrong
        // twice over: it is per-connection, so a reconnection has to write it
        // again.
        throw fail('not-connected', 'a control point write needs a connection');
      }
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
      if (releasing !== undefined && request.opCode !== 'reset') {
        // A fallback write after a Reset that went unanswered, refused because
        // the machine did execute the Reset and dropped this client. Part of
        // the release, not a loss — see `releasing`.
        held = false;
        releasing.revoked = true;
      } else {
        // The routine case on a phone that reconnected. No status notification
        // arrives; the machine simply says no. A client that kept believing it
        // had control would write into the void for the rest of the ride.
        loseControl('permission-lost');
      }
      // ⚠️ NOT folded into the `control-rejected` branch below. `0x05` is the
      // one result code that says something a rider can act on, and swallowing
      // it into the generic "the machine refused op code 0x11" is how a
      // recoverable clash between two apps becomes a trainer that looks broken.
      throw fail(
        'control-not-held',
        `the machine refused op code 0x${expectedOpCode.toString(
          16,
        )} with Control Not Permitted: ${CONTROL_NOT_PERMITTED_GUIDANCE}`,
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
      released = false;
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

  /**
   * The body of {@link TrainerControl.letGo}, run with `releasing` set.
   *
   * Every revocation that arrives while this runs lands in `release.revoked`
   * rather than in a listener, so this function — and nothing that listens for
   * losses — decides what the release achieved.
   */
  const releaseTheMachine = async (release: { revoked: boolean }): Promise<TrainerRelease> => {
    let resetRefusal: SensorError;
    try {
      await runProcedure({ opCode: 'reset' });
      // FTMS §4.16.2.1: control ends with the client's own Reset. Dropped here
      // WITHOUT `loseControl` — a release is not a loss, and the one listener
      // that matters (the ride screen) would otherwise show a "Control lost"
      // warning and pause a workout that is ending.
      target = { kind: 'none' };
      held = false;
      return { kind: 'reset' };
    } catch (error) {
      if (!(error instanceof SensorError)) {
        throw error;
      }
      resetRefusal = error;
    }
    // A flat road replaced any ERG target; without one this client cannot say
    // what the machine still holds, and "none" would be a claim.
    const incomplete = (flattened: boolean): TrainerRelease => {
      target =
        flattened || target.kind === 'none'
          ? { kind: 'none' }
          : {
              kind: 'unknown',
              attempted: target.kind === 'confirmed' ? target.target : target.attempted,
            };
      return { kind: 'incomplete', resetRefusal, flattened };
    };
    if (
      release.revoked &&
      // The Reset's own Control Not Permitted is a loss, rejected below.
      resetRefusal.code !== 'control-not-held' &&
      linkUp &&
      !closed
    ) {
      // The machine revoked control during a Reset that was not answered with
      // success — a timed-out Reset it executed, most likely. There is nothing
      // left this client may send, and a `0xFF` cannot say whose action it
      // was, so this is not reported as released.
      return incomplete(false);
    }
    // ⚠️ Re-checked: a Reset answered Control Not Permitted has already dropped
    // control through `runProcedure`, and a link that went during it is down.
    // Either way there is nothing left to send, and the caller is told so
    // rather than handed an outcome.
    requireControl();
    let flattened = false;
    if (features?.targetSetting.indoorBikeSimulationParameters !== false) {
      try {
        await runProcedure({
          opCode: 'set-simulation-parameters',
          parameters: { grade: FLAT_ROAD, windSpeed: metresPerSecond(0) },
        });
        flattened = true;
      } catch {
        // Reported by `flattened` staying false. The Stop is still worth
        // sending, and a refusal of it is what rejects this release.
      }
    }
    if (release.revoked) {
      // Revoked since the Reset — the flat road answered Control Not
      // Permitted, or a `0xFF` arrived. A Stop now would be refused too.
      return incomplete(flattened);
    }
    try {
      await runProcedure({ opCode: 'stop' });
    } catch (error) {
      if (!release.revoked) {
        throw error;
      }
    }
    return incomplete(flattened);
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
            // ⚠️ The effective maximum is the smaller of what the device
            // advertised and what the wire field can carry. `quantise` rounds
            // to the *nearest* step, so a grid that does not land on its own
            // maximum (0.6 in steps of 25) rounds a level both guards above
            // admitted up past the uint8 ceiling. Capping here steps back down
            // onto the grid, rather than failing two layers away in
            // `encodeControlRequest` with a message about a parameter the
            // caller never named.
            Math.min(resistanceRange.maximum, MAX_ENCODABLE_RESISTANCE_LEVEL),
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
          parameters.windSpeed > MAX_ENCODABLE_WIND_SPEED_METRES_PER_SECOND
        ) {
          throw outOfRange(
            `a wind speed of ${String(parameters.windSpeed)} m/s is above ${String(
              MAX_ENCODABLE_WIND_SPEED_METRES_PER_SECOND,
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

    letGo(): Promise<TrainerRelease> {
      return enqueue(async (): Promise<TrainerRelease> => {
        requireControl();
        // ⚠️ Before the Reset is written, not on its answer — `releasing` says
        // why, and what went wrong when it was the other way round.
        const release = { revoked: false };
        releasing = release;
        try {
          return await releaseTheMachine(release);
        } finally {
          releasing = undefined;
          released = true;
        }
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
      // The indication is unsubscribed above, so the answer this procedure is
      // waiting on can no longer arrive by any route. Left pending it never
      // settles — and `enqueue` chains every later call behind it, so one
      // orphaned procedure wedges the client rather than failing locally.
      const waiting = pending;
      pending = undefined;
      if (waiting !== undefined) {
        waiting.cancelTimeout();
        waiting.reject(
          fail('not-connected', 'the client was closed while a procedure was outstanding'),
        );
      }
      lossListeners.splice(0);
      held = false;
    },
  };
}
