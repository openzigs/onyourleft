// SPDX-License-Identifier: Apache-2.0

/**
 * `@onyourleft/sensors/simulator` — the device simulator (#44).
 *
 * A second implementation of `SensorTransport`, with no radio behind it and no
 * change to the interface in front of it. A separate entry point rather than a
 * re-export from `@onyourleft/sensors`, so that a bundle of the app does not
 * carry the simulator unless something — a test, or a reviewer-reachable demo
 * mode — asks for it by name.
 *
 * The transport conformance suite is a further entry point,
 * `@onyourleft/sensors/conformance`, because it imports the test runner and
 * nothing that ships should.
 */

// --- The simulator ----------------------------------------------------------

export type {
  DeviceFrames,
  DeviceInspection,
  SimulatedDevice,
  Simulator,
  SimulatorBench,
  SimulatorOptions,
} from './simulator';

export { createSimulator } from './simulator';

// --- Devices ----------------------------------------------------------------

export type { SimulatedDeviceSpec, SimulatedService } from './devices';

export {
  capabilitiesOf,
  cpsPowerMeter,
  cscsSensor,
  ftmsTrainer,
  hrsStrap,
  modernTrainer,
  SERVICE_CAPABILITIES,
} from './devices';

// --- The rider --------------------------------------------------------------

export type { RiderProfile } from './rider';

export { DEFAULT_RIDER } from './rider';

// --- Scenarios --------------------------------------------------------------

export type { Scenario } from './scenario';

// --- FTMS: Indoor Bike Data, the control point, machine status --------------

export type {
  AttErrorCode,
  FitnessMachineStatus,
  FtmsControlOpCode,
  FtmsControlPoint,
  FtmsControlRequest,
  FtmsControlResponse,
  FtmsInspection,
  FtmsOptions,
  FtmsResultCode,
  FtmsSimulationParameters,
  FtmsSupportedRanges,
  FtmsWriteOutcome,
  IndoorBikeDataField,
  IndoorBikeDataFrame,
} from './ftms';

export {
  ATT_ERROR_CODE,
  DEFAULT_INDOOR_BIKE_DATA_FIELDS,
  DEFAULT_MAX_RESISTANCE_LEVEL,
  DEFAULT_MAX_TARGET_POWER,
  DEFAULT_MIN_RESISTANCE_LEVEL,
  DEFAULT_MIN_TARGET_POWER,
  DEFAULT_POWER_INCREMENT,
  DEFAULT_RESISTANCE_INCREMENT,
  FITNESS_MACHINE_STATUS_OP_CODE,
  FTMS_CONTROL_OP_CODE,
  FTMS_RESULT_CODE,
  INDOOR_BIKE_DATA_FLAG_BIT,
} from './ftms';

// --- The measurement-only profiles ------------------------------------------

export type { CscFrame, CyclingPowerFrame, HeartRateFrame } from './profiles';

export { CSC_CRANK, CSC_WHEEL, CYCLING_POWER_CRANK } from './profiles';

// --- Counters: the device half and the client half -------------------------

export type { CadenceDerivation, RevolutionReading, TimedReading } from './counters';

export { deriveCadence } from './counters';
