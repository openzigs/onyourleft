// SPDX-License-Identifier: Apache-2.0

/**
 * The Fitness Machine Service (0x1826) as a simulated trainer serves it: Indoor
 * Bike Data, the Fitness Machine Control Point and Fitness Machine Status.
 *
 * ## Where the misbehaviour comes from
 *
 * Nothing here is invented. #44's revision block grounds each case in the FTMS
 * 1.0 specification, the Core Specification Supplement's common error codes, or
 * a decoded session log from a real trainer:
 *
 * | Behaviour | Source |
 * |---|---|
 * | `0x05` Control Not Permitted for a setpoint before Request Control | FTMS 4.16.2, the routine case on a phone that reconnected |
 * | Reset revokes the requesting client's own control | FTMS 4.16.2.1 |
 * | Fitness Machine Status `0xFF` Control Permission Lost | FTMS 4.17 |
 * | ATT `0xFD` CCCD Improperly Configured for a write before indications are on | CSS Part B 1.2 |
 * | ATT `0xFE` Procedure Already in Progress for an overlapping write | CSS Part B 1.2 |
 * | Indoor Bike Data with flag bit 0 **clear** meaning speed **present** | FTMS 4.9.1.1 — the inverted bit |
 * | A host writing at ~1 Hz, continuously | observed; the simulator is exercised at that cadence |
 *
 * ## What is modelled, and what is not
 *
 * Six op codes: Request Control, Reset, Set Target Power, **Set Target
 * Resistance Level, Set Indoor Bike Simulation Parameters and Stop or Pause**.
 * The last three arrived with #43, which needed a device answering the whole
 * control surface its client writes. #44 shipped the first three because those
 * are the ones the grounded misbehaviours involve, and left `0x11` out because
 * `@onyourleft/domain` had no grade type; it has `GradePercent` now, so the
 * parameter array is modelled rather than typed as a bare number.
 *
 * Result codes are the four this machine can actually produce. `0x02` Op Code
 * Not Supported joined them with #43 and it is reachable: a trainer built with
 * `supportsSimulation: false` answers it, which is what a client gating its
 * gradient UI on Target Setting bit 13 has to cope with. `0x04` Operation
 * Failed is still absent, because a code no scenario reaches is a branch no
 * test can cover (`../errors.ts` makes the same argument). The expended-energy
 * and heart-rate fields of Indoor Bike Data are omitted for the same unit
 * reason `../measurement.ts` records.
 *
 * ⚠️ **The control point is reached through the simulator's bench.** #39 has no
 * write path — `../transport.ts` says so and why — and #43 owns the command
 * surface. The simulator serves the device side of that surface now, so that
 * #43's client has something to be tested against on arrival; it does not widen
 * `SensorTransport` to get there.
 */

import {
  metres,
  resistanceLevel,
  watts,
  type GradePercent,
  type Metres,
  type MetresPerSecond,
  type ResistanceLevel,
  type RevolutionsPerMinute,
  type Seconds,
  type Watts,
} from '@onyourleft/domain';

import { SensorError } from '../errors';
import type { Listener, Unsubscribe } from '../subscription';
import { listenerList } from './listeners';
import type { RiderProfile } from './rider';

// --- Indoor Bike Data (0x2AD2) ----------------------------------------------

/** The Indoor Bike Data fields this trainer can carry. */
export type IndoorBikeDataField =
  'instantaneous-speed' | 'instantaneous-cadence' | 'total-distance' | 'instantaneous-power';

/**
 * Which flag bit governs each field.
 *
 * ⚠️ Bit 0 is **More Data**, and Instantaneous Speed is present when it is
 * **clear** — the opposite sense to every other presence bit in the
 * characteristic. A decoder that treats bit 0 like the others reads speed when
 * there is none and misaligns every field after it.
 */
export const INDOOR_BIKE_DATA_FLAG_BIT = {
  'instantaneous-speed': 0,
  'instantaneous-cadence': 2,
  'total-distance': 4,
  'instantaneous-power': 6,
} as const satisfies Record<IndoorBikeDataField, number>;

/** What a typical smart trainer sends: speed, cadence and power, every second. */
export const DEFAULT_INDOOR_BIKE_DATA_FIELDS: ReadonlySet<IndoorBikeDataField> = new Set([
  'instantaneous-speed',
  'instantaneous-cadence',
  'instantaneous-power',
]);

export interface IndoorBikeDataFrame {
  readonly instantaneousSpeed?: MetresPerSecond;
  readonly instantaneousCadence?: RevolutionsPerMinute;
  /** A `uint24` of metres on the wire. */
  readonly totalDistance?: Metres;
  readonly instantaneousPower?: Watts;
}

// --- Fitness Machine Control Point (0x2AD9) ---------------------------------

export type FtmsControlOpCode =
  | 'request-control'
  | 'reset'
  | 'set-target-resistance'
  | 'set-target-power'
  | 'stop-or-pause'
  | 'set-simulation-parameters';

/** FTMS 1.0 Table 4.15. */
export const FTMS_CONTROL_OP_CODE = {
  'request-control': 0x00,
  reset: 0x01,
  'set-target-resistance': 0x04,
  'set-target-power': 0x05,
  'stop-or-pause': 0x08,
  'set-simulation-parameters': 0x11,
} as const satisfies Record<FtmsControlOpCode, number>;

/** The simulated course conditions, FTMS Table 4.20. `grade` is **signed**. */
export interface FtmsSimulationParameters {
  readonly grade: GradePercent;
  readonly windSpeed: MetresPerSecond;
  readonly rollingResistanceCoefficient: number;
  readonly windResistanceCoefficient: number;
}

export type FtmsControlRequest =
  | { readonly opCode: 'request-control' }
  | { readonly opCode: 'reset' }
  | { readonly opCode: 'set-target-resistance'; readonly level: ResistanceLevel }
  | { readonly opCode: 'set-target-power'; readonly target: Watts }
  | { readonly opCode: 'stop-or-pause'; readonly stop: boolean }
  | { readonly opCode: 'set-simulation-parameters'; readonly parameters: FtmsSimulationParameters };

export type FtmsResultCode =
  'success' | 'op-code-not-supported' | 'invalid-parameter' | 'control-not-permitted';

/** FTMS 1.0 Table 4.24, the four values this machine produces. */
export const FTMS_RESULT_CODE = {
  success: 0x01,
  'op-code-not-supported': 0x02,
  'invalid-parameter': 0x03,
  'control-not-permitted': 0x05,
} as const satisfies Record<FtmsResultCode, number>;

/** The response indication: which request, and how it went. */
export interface FtmsControlResponse {
  readonly requestOpCode: FtmsControlOpCode;
  readonly result: FtmsResultCode;
}

export type AttErrorCode = 'cccd-improperly-configured' | 'procedure-already-in-progress';

/** Core Specification Supplement, Part B §1.2, common profile and service error codes. */
export const ATT_ERROR_CODE = {
  'cccd-improperly-configured': 0xfd,
  'procedure-already-in-progress': 0xfe,
} as const satisfies Record<AttErrorCode, number>;

/**
 * What the ATT write itself returned. `accepted` means the response will arrive
 * as an indication on the next tick; an ATT error means it will not.
 */
export type FtmsWriteOutcome =
  { readonly kind: 'accepted' } | { readonly kind: 'att-error'; readonly error: AttErrorCode };

// --- Fitness Machine Status (0x2ADA) ----------------------------------------

export type FitnessMachineStatus =
  | { readonly kind: 'reset' }
  | { readonly kind: 'stopped-or-paused' }
  | { readonly kind: 'target-resistance-changed'; readonly level: ResistanceLevel }
  | { readonly kind: 'target-power-changed'; readonly target: Watts }
  | { readonly kind: 'simulation-parameters-changed' }
  | { readonly kind: 'control-permission-lost' };

/** FTMS 1.0 Table 4.26, the values this machine produces. */
export const FITNESS_MACHINE_STATUS_OP_CODE = {
  reset: 0x01,
  'stopped-or-paused': 0x02,
  'target-resistance-changed': 0x07,
  'target-power-changed': 0x08,
  'simulation-parameters-changed': 0x12,
  'control-permission-lost': 0xff,
} as const satisfies Record<FitnessMachineStatus['kind'], number>;

// --- The control point, as a client sees it ---------------------------------

export interface FtmsControlPoint {
  /**
   * Configure the CCCD for indications. A client does this before its first
   * write; a write without it is refused with `cccd-improperly-configured`.
   */
  enableIndications(): void;
  /**
   * Write a request.
   *
   * @throws {SensorError} `not-connected` when there is no link to write on.
   */
  write(request: FtmsControlRequest): FtmsWriteOutcome;
  /** Response indications, delivered one tick after the write is accepted. */
  onResponse(listener: Listener<FtmsControlResponse>): Unsubscribe;
  /** Fitness Machine Status notifications. */
  onStatus(listener: Listener<FitnessMachineStatus>): Unsubscribe;
}

/** The trainer's control state, for a test to read without a protocol. */
export interface FtmsInspection {
  readonly controlHeld: boolean;
  readonly indicationsEnabled: boolean;
  readonly targetPower: Watts | undefined;
  readonly targetResistance: ResistanceLevel | undefined;
  readonly simulation: FtmsSimulationParameters | undefined;
  readonly stopped: boolean;
}

/**
 * What this machine's Supported Power Range and Supported Resistance Level
 * Range characteristics would report if they were read.
 *
 * Exposed as values rather than served as bytes, because this directory bars
 * GATT payload — `../README.md` §"What is deliberately not here". A client
 * reads them through whatever bridge encodes them, exactly as it does Indoor
 * Bike Data.
 */
export interface FtmsSupportedRanges {
  readonly minTargetPower: Watts;
  readonly maxTargetPower: Watts;
  readonly powerIncrement: Watts;
  readonly minResistanceLevel: ResistanceLevel;
  readonly maxResistanceLevel: ResistanceLevel;
  readonly resistanceIncrement: ResistanceLevel;
}

// --- The machine ------------------------------------------------------------

export interface FtmsOptions {
  /** Bottom of the Supported Power Range. Defaults to 0 W. */
  readonly minTargetPower?: Watts;
  /** Top of the Supported Power Range. Defaults to 2000 W. */
  readonly maxTargetPower?: Watts;
  /** Minimum Increment of the Supported Power Range. Defaults to 1 W. */
  readonly powerIncrement?: Watts;
  /** Bottom of the Supported Resistance Level Range. Defaults to 0. */
  readonly minResistanceLevel?: ResistanceLevel;
  /** Top of the Supported Resistance Level Range. Defaults to 20. */
  readonly maxResistanceLevel?: ResistanceLevel;
  /** Minimum Increment of the Supported Resistance Level Range. Defaults to 0.5. */
  readonly resistanceIncrement?: ResistanceLevel;
  /**
   * Whether this machine answers Set Indoor Bike Simulation Parameters.
   *
   * Defaults to `true`. Built `false`, the machine answers `0x02` Op Code Not
   * Supported — which is what a trainer whose Target Setting bit 13 is clear
   * does, and the case a client gating its gradient UI on that bit has to cope
   * with.
   */
  readonly supportsSimulation?: boolean;
  /** Which Indoor Bike Data fields to carry. Defaults to speed, cadence, power. */
  readonly fields?: ReadonlySet<IndoorBikeDataField>;
}

export const DEFAULT_MIN_TARGET_POWER: Watts = watts(0);
export const DEFAULT_MAX_TARGET_POWER: Watts = watts(2000);
export const DEFAULT_POWER_INCREMENT: Watts = watts(1);
export const DEFAULT_MIN_RESISTANCE_LEVEL: ResistanceLevel = resistanceLevel(0);
export const DEFAULT_MAX_RESISTANCE_LEVEL: ResistanceLevel = resistanceLevel(20);
export const DEFAULT_RESISTANCE_INCREMENT: ResistanceLevel = resistanceLevel(0.5);

/** The simulated trainer, device side. Driven by `simulator.ts`. */
export interface FtmsMachine {
  readonly controlPoint: FtmsControlPoint;
  /** Time passes on the trainer: distance accumulates. */
  advance(rider: RiderProfile, duration: Seconds): void;
  /** The next Indoor Bike Data notification. */
  frame(rider: RiderProfile): IndoorBikeDataFrame;
  /** The target in ERG mode, the rider's own power otherwise. */
  effectivePower(rider: RiderProfile): Watts;
  /** What the two supported-range characteristics would report. */
  supportedRanges(): FtmsSupportedRanges;
  /** Deliver the queued response and status messages. Called once per tick while connected. */
  flush(): void;
  /** Scenario: another client, or the trainer itself, takes control away. */
  losePermission(): void;
  /** Scenario: change which fields Indoor Bike Data carries. */
  setFields(fields: ReadonlySet<IndoorBikeDataField>): void;
  /**
   * The link dropped. The CCCD is per-connection so indications are off, the
   * queued response is lost with the bearer, and control is not held across a
   * reconnection.
   */
  onLinkLost(): void;
  inspect(): FtmsInspection;
}

export function createFtmsMachine(
  options: FtmsOptions,
  link: { readonly deviceId: string; isConnected(): boolean },
): FtmsMachine {
  const ranges: FtmsSupportedRanges = {
    minTargetPower: options.minTargetPower ?? DEFAULT_MIN_TARGET_POWER,
    maxTargetPower: options.maxTargetPower ?? DEFAULT_MAX_TARGET_POWER,
    powerIncrement: options.powerIncrement ?? DEFAULT_POWER_INCREMENT,
    minResistanceLevel: options.minResistanceLevel ?? DEFAULT_MIN_RESISTANCE_LEVEL,
    maxResistanceLevel: options.maxResistanceLevel ?? DEFAULT_MAX_RESISTANCE_LEVEL,
    resistanceIncrement: options.resistanceIncrement ?? DEFAULT_RESISTANCE_INCREMENT,
  };
  const supportsSimulation = options.supportsSimulation ?? true;
  let fields = options.fields ?? DEFAULT_INDOOR_BIKE_DATA_FIELDS;

  let controlHeld = false;
  let indicationsEnabled = false;
  let targetPower: Watts | undefined;
  let targetResistance: ResistanceLevel | undefined;
  let simulation: FtmsSimulationParameters | undefined;
  let stopped = false;
  let totalDistance = 0;
  let pendingResponse: FtmsControlResponse | undefined;
  const pendingStatus: FitnessMachineStatus[] = [];

  const responses = listenerList<FtmsControlResponse>();
  const statuses = listenerList<FitnessMachineStatus>();

  /** FTMS 4.16.2: the procedure, with its result. State changes on receipt; the response follows. */
  const perform = (request: FtmsControlRequest): FtmsResultCode => {
    switch (request.opCode) {
      case 'request-control':
        controlHeld = true;
        return 'success';
      case 'reset':
        if (!controlHeld) {
          return 'control-not-permitted';
        }
        // 4.16.2.1: a Reset returns the machine to its defaults *and* resets
        // the control permission — the client that asked for it loses it.
        controlHeld = false;
        targetPower = undefined;
        targetResistance = undefined;
        simulation = undefined;
        pendingStatus.push({ kind: 'reset' });
        return 'success';
      case 'set-target-power':
        if (!controlHeld) {
          return 'control-not-permitted';
        }
        if (request.target < ranges.minTargetPower || request.target > ranges.maxTargetPower) {
          return 'invalid-parameter';
        }
        targetPower = request.target;
        targetResistance = undefined;
        simulation = undefined;
        pendingStatus.push({ kind: 'target-power-changed', target: request.target });
        return 'success';
      case 'set-target-resistance':
        if (!controlHeld) {
          return 'control-not-permitted';
        }
        if (
          request.level < ranges.minResistanceLevel ||
          request.level > ranges.maxResistanceLevel
        ) {
          return 'invalid-parameter';
        }
        targetResistance = request.level;
        // Setting a brake level ends ERG. FTMS 4.16.2: a procedure that
        // contradicts a previously triggered one aborts it, and no machine
        // holds a watt target and a brake level at the same time.
        targetPower = undefined;
        simulation = undefined;
        pendingStatus.push({ kind: 'target-resistance-changed', level: request.level });
        return 'success';
      case 'set-simulation-parameters':
        if (!controlHeld) {
          return 'control-not-permitted';
        }
        if (!supportsSimulation) {
          return 'op-code-not-supported';
        }
        simulation = request.parameters;
        targetPower = undefined;
        targetResistance = undefined;
        pendingStatus.push({ kind: 'simulation-parameters-changed' });
        return 'success';
      case 'stop-or-pause':
        if (!controlHeld) {
          return 'control-not-permitted';
        }
        stopped = true;
        if (request.stop) {
          // A stop ends the session, so the setpoints go with it. A pause holds
          // them — which is the whole difference the parameter octet carries.
          targetPower = undefined;
          targetResistance = undefined;
          simulation = undefined;
        }
        pendingStatus.push({ kind: 'stopped-or-paused' });
        return 'success';
    }
  };

  const controlPoint: FtmsControlPoint = {
    enableIndications() {
      indicationsEnabled = true;
    },
    write(request) {
      if (!link.isConnected()) {
        throw new SensorError('not-connected', 'a control point write needs a connection', {
          deviceId: link.deviceId,
        });
      }
      if (!indicationsEnabled) {
        return { kind: 'att-error', error: 'cccd-improperly-configured' };
      }
      if (pendingResponse !== undefined) {
        return { kind: 'att-error', error: 'procedure-already-in-progress' };
      }
      pendingResponse = { requestOpCode: request.opCode, result: perform(request) };
      return { kind: 'accepted' };
    },
    onResponse(listener) {
      return responses.add(listener);
    },
    onStatus(listener) {
      return statuses.add(listener);
    },
  };

  const effectivePower = (rider: RiderProfile): Watts => targetPower ?? rider.power;

  return {
    controlPoint,
    effectivePower,

    supportedRanges: () => ranges,

    advance(rider, duration) {
      totalDistance += rider.speed * duration;
    },

    frame(rider) {
      return {
        ...(fields.has('instantaneous-speed') ? { instantaneousSpeed: rider.speed } : {}),
        ...(fields.has('instantaneous-cadence') ? { instantaneousCadence: rider.cadence } : {}),
        ...(fields.has('total-distance') ? { totalDistance: metres(totalDistance) } : {}),
        ...(fields.has('instantaneous-power') ? { instantaneousPower: effectivePower(rider) } : {}),
      };
    },

    flush() {
      if (pendingResponse !== undefined) {
        const response = pendingResponse;
        pendingResponse = undefined;
        responses.emit(response);
      }
      for (const status of pendingStatus.splice(0)) {
        statuses.emit(status);
      }
    },

    losePermission() {
      controlHeld = false;
      pendingStatus.push({ kind: 'control-permission-lost' });
    },

    setFields(next) {
      fields = next;
    },

    onLinkLost() {
      indicationsEnabled = false;
      controlHeld = false;
      pendingResponse = undefined;
      pendingStatus.splice(0);
    },

    inspect() {
      return {
        controlHeld,
        indicationsEnabled,
        targetPower,
        targetResistance,
        simulation,
        stopped,
      };
    },
  };
}
