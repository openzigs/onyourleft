// SPDX-License-Identifier: Apache-2.0

/**
 * What a simulated device is made of: a name, an id, and the GATT profiles it
 * serves — in priority order, because that order decides which profile feeds a
 * capability that two of them carry.
 *
 * ## The modern-trainer case
 *
 * `modernTrainer()` serves FTMS, Cycling Power and CSC on **one** device. That
 * is #39's design decision — capabilities are a set on one device, not one
 * device per capability — made concrete enough to break an adapter that gets
 * it wrong: a `SensorDevice` per service would fail the conformance suite's
 * identity assertions, and delivering power from both FTMS and CPS would fail
 * the once-per-cycle assertion in `simulator.test.ts`. A simulator with one
 * profile per device could not have caught either.
 */

import type { SensorCapability } from '../capability';
import type { FtmsOptions } from './ftms';

/** The profiles the simulator serves, by their usual abbreviations. */
export type SimulatedService = 'ftms' | 'cps' | 'cscs' | 'hrs';

/**
 * What each profile lets a device declare.
 *
 * CSC declares cadence and **not** speed: it reports wheel revolutions, and
 * turning those into a speed needs the athlete's wheel circumference, which is
 * a rider setting. `capability.ts` states the rule; this table obeys it.
 */
export const SERVICE_CAPABILITIES: Readonly<Record<SimulatedService, readonly SensorCapability[]>> =
  {
    ftms: ['power', 'cadence', 'speed', 'trainer-control'],
    cps: ['power', 'cadence'],
    cscs: ['cadence'],
    hrs: ['heart-rate'],
  };

export interface SimulatedDeviceSpec {
  /** Labelled by the simulator with `deviceId()`; a blank one is refused there. */
  readonly id: string;
  readonly name: string;
  /**
   * In priority order. When two services carry the same capability, the
   * earlier one is the source — FTMS before CPS before CSC on a trainer, which
   * is the preference `plan.ts` encodes for the same reason.
   */
  readonly services: readonly SimulatedService[];
  readonly ftms?: FtmsOptions;
}

/** Everything a spec's services let the device declare, as one set. */
export function capabilitiesOf(spec: SimulatedDeviceSpec): ReadonlySet<SensorCapability> {
  return new Set(spec.services.flatMap((service) => SERVICE_CAPABILITIES[service]));
}

interface DeviceOptions {
  readonly id?: string;
  readonly name?: string;
}

/** A chest strap: Heart Rate Service only. */
export function hrsStrap(options: DeviceOptions = {}): SimulatedDeviceSpec {
  return {
    id: options.id ?? 'hrs-strap',
    name: options.name ?? 'HRM-Dual 0C3F',
    services: ['hrs'],
  };
}

/** A crank-based power meter: Cycling Power Service with crank revolution data. */
export function cpsPowerMeter(options: DeviceOptions = {}): SimulatedDeviceSpec {
  return {
    id: options.id ?? 'cps-power-meter',
    name: options.name ?? 'ASSIOMA 1A2B',
    services: ['cps'],
  };
}

/** A speed and cadence sensor: CSC Service with wheel and crank data. */
export function cscsSensor(options: DeviceOptions = {}): SimulatedDeviceSpec {
  return {
    id: options.id ?? 'cscs-sensor',
    name: options.name ?? 'SPD-CAD 7E10',
    services: ['cscs'],
  };
}

/** A trainer that speaks FTMS and nothing else. */
export function ftmsTrainer(options: DeviceOptions & FtmsOptions = {}): SimulatedDeviceSpec {
  return {
    id: options.id ?? 'ftms-trainer',
    name: options.name ?? 'FTMS Trainer 3C4D',
    services: ['ftms'],
    ftms: ftmsOptionsOf(options),
  };
}

/** A current smart trainer: FTMS, Cycling Power and CSC on one device. */
export function modernTrainer(options: DeviceOptions & FtmsOptions = {}): SimulatedDeviceSpec {
  return {
    id: options.id ?? 'modern-trainer',
    name: options.name ?? 'KICKR CORE 1F2A',
    services: ['ftms', 'cps', 'cscs'],
    ftms: ftmsOptionsOf(options),
  };
}

function ftmsOptionsOf(options: FtmsOptions): FtmsOptions {
  // Copied key by key rather than spread wholesale, so a `DeviceOptions` field
  // — `id`, `name` — cannot leak into the machine's own options.
  return {
    ...(options.minTargetPower === undefined ? {} : { minTargetPower: options.minTargetPower }),
    ...(options.maxTargetPower === undefined ? {} : { maxTargetPower: options.maxTargetPower }),
    ...(options.powerIncrement === undefined ? {} : { powerIncrement: options.powerIncrement }),
    ...(options.minResistanceLevel === undefined
      ? {}
      : { minResistanceLevel: options.minResistanceLevel }),
    ...(options.maxResistanceLevel === undefined
      ? {}
      : { maxResistanceLevel: options.maxResistanceLevel }),
    ...(options.resistanceIncrement === undefined
      ? {}
      : { resistanceIncrement: options.resistanceIncrement }),
    ...(options.supportsSimulation === undefined
      ? {}
      : { supportsSimulation: options.supportsSimulation }),
    ...(options.fields === undefined ? {} : { fields: options.fields }),
  };
}
