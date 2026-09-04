// SPDX-License-Identifier: Apache-2.0

/**
 * `@onyourleft/sensors/protocol` — the GATT profile clients.
 *
 * Heart Rate (0x180D), Cycling Speed and Cadence (0x1816) and Cycling Power
 * (0x1818): the half of the sensor stack that turns an untrusted little-endian
 * GATT payload into branded domain quantities. FTMS (0x1826) is #43's, and is
 * deliberately not here — it carries a control point that applies physical
 * resistance to a person who is pedalling, which CLAUDE.md §6 calls a safety
 * problem rather than only a security one.
 *
 * ## Why this is a third directory rather than part of `src/` or `web-bluetooth/`
 *
 * `README.md` promises that *"the parsing in #41–#43 is the half that must not
 * be written twice"* — the Web Bluetooth adapter (#40) and the Capacitor plugin
 * over CoreBluetooth and Android BLE (#15) both hand it bytes and get
 * measurements back. That rules out `web-bluetooth/`, which would make the
 * native stacks depend on the browser one. And `src/` bars a service UUID and a
 * `DataView` of GATT payload by its own rule, because #39's *abstraction* must
 * not know a wire format.
 *
 * So this directory sits beside both, arriving the way `web-bluetooth/` did:
 * its own place in `eslint.config.js`, and its own paths in the package's two
 * tsconfig programs. It is **platform-free** — compiled by
 * `tsconfig.platform-free.json` with `lib: ["ES2024"]` and `types: []`, so
 * `navigator`, `window` and `BluetoothRemoteGATTCharacteristic` cannot be named
 * here any more than in `src/`. `DataView` is an ECMAScript built-in, which is
 * the whole reason a decoder can be platform-free at all.
 *
 * ## Every UUID was re-read from the primary source
 *
 * #41 requires it, and the values in both issue bodies were corroborated during
 * planning rather than read from the specification. Every constant below was
 * read on **2026-09-04** from the Bluetooth SIG's own machine-readable assigned
 * numbers — `bluetooth-SIG/public`, `assigned_numbers/uuids/service_uuids.yaml`
 * and `characteristic_uuids.yaml` — and all ten matched. The transcription into
 * 128-bit form is checked rather than trusted:
 * `web-bluetooth/src/protocol-registry.test.ts` asserts each literal equals
 * `canonicalUuid` of its 16-bit number. `../README.md` §"The protocol clients"
 * carries the table.
 *
 * ## Sensor data is untrusted input
 *
 * Every read is bounds-checked and every failure is a
 * `SensorError('malformed-payload')` — never a bare `RangeError`, never an
 * out-of-bounds `DataView` read. A flag claiming a field the buffer does not
 * contain is the obvious attack on a flags-gated variable-length
 * characteristic, and the FIT decoder (#125) set the posture this follows.
 */

// --- The seam, and the UUID normalisation every layer compares through ------

export type { GattProfile, MeasurementSink, MeasurementValueFor } from './profile';

export type { GattUuid } from './uuid';

export { canonicalUuid } from './uuid';

// --- Reading a payload defensively ------------------------------------------

export type { PayloadReader } from './payload';

export { createPayloadReader, flagSet, malformedPayload } from './payload';

// --- Per-link derivation state ----------------------------------------------

export type { DerivationStore } from './derivation';

export { createDerivationStore } from './derivation';

// --- Heart Rate Service (0x180D) --------------------------------------------

export type { HeartRateReading, SensorContact } from './heart-rate';

export {
  BODY_SENSOR_LOCATION,
  decodeHeartRateMeasurement,
  HEART_RATE_MEASUREMENT,
  HEART_RATE_SERVICE,
  heartRateProfile,
} from './heart-rate';

// --- Cycling Speed and Cadence Service (0x1816) -----------------------------

export type { CscFeatures, CscReading } from './cycling-speed-cadence';

export {
  createCyclingSpeedCadenceProfile,
  CSC_CRANK_COUNTER,
  CSC_FEATURE,
  CSC_MEASUREMENT,
  CSC_WHEEL_COUNTER,
  CYCLING_SPEED_CADENCE_SERVICE,
  decodeCscFeature,
  decodeCscMeasurement,
} from './cycling-speed-cadence';

// --- Cycling Power Service (0x1818) -----------------------------------------

export type {
  AccumulatedTorqueSource,
  CyclingPowerAccumulation,
  CyclingPowerFeatures,
  CyclingPowerReading,
  ExtremeMagnitudes,
  PedalPowerBalanceReference,
} from './cycling-power';

export {
  accumulate,
  createCyclingPowerProfile,
  CYCLING_POWER_CRANK_COUNTER,
  CYCLING_POWER_FEATURE,
  CYCLING_POWER_MEASUREMENT,
  CYCLING_POWER_SENSOR_LOCATION,
  CYCLING_POWER_SERVICE,
  CYCLING_POWER_WHEEL_COUNTER,
  cyclingPowerCapabilities,
  decodeCyclingPowerFeature,
  decodeCyclingPowerMeasurement,
  MAX_PLAUSIBLE_POWER_WATTS,
} from './cycling-power';
