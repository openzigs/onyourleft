// SPDX-License-Identifier: Apache-2.0

/**
 * `@onyourleft/sensors` — the transport-agnostic sensor abstraction.
 *
 * The shape every BLE transport implements: device discovery, connection
 * lifecycle, capability description and typed measurement streams. **No
 * transport and no protocol live here.** The Web Bluetooth adapter is #40; the
 * Heart Rate, CSC, Cycling Power and FTMS clients are #41–#43; the simulator is
 * #44. A service UUID or a characteristic payload in this package means the
 * boundary has been crossed.
 *
 * This package depends on **no platform API at all** — no DOM, no Node globals,
 * no network types, and in particular no `navigator.bluetooth`. `tsconfig.json`
 * enforces it by narrowing `lib` to ES2024 and emptying `types`;
 * `eslint.config.js` enforces it again for the module specifiers a `lib`
 * narrowing cannot see. That is not tidiness: the same interfaces have to be
 * satisfied unchanged by CoreBluetooth and the Android BLE APIs in #15, and an
 * interface that can name a browser type has already chosen one of the three.
 *
 * `README.md` carries the walkthrough showing Web Bluetooth and a native stack
 * satisfying this interface unchanged, which is #39's second acceptance
 * criterion.
 *
 * Everything the rest of the program uses is re-exported here, so a consumer
 * imports from `@onyourleft/sensors` and never from a file inside it.
 */

// --- Capabilities -----------------------------------------------------------

export type { ControlCapability, MeasurementCapability, SensorCapability } from './capability';

export {
  isMeasurementCapability,
  MEASUREMENT_CAPABILITIES,
  SENSOR_CAPABILITIES,
} from './capability';

// --- Devices and identity ---------------------------------------------------

export type { DeviceId, DeviceIdentity, SensorDevice, TransportId } from './device';

export {
  ANDROID_BLE,
  CORE_BLUETOOTH,
  deviceId,
  deviceProvides,
  sameDevice,
  SIMULATED,
  transportId,
  WEB_BLUETOOTH,
} from './device';

// --- Connection lifecycle ---------------------------------------------------

export type { ConnectionState } from './connection';

export {
  canReportMeasurements,
  CONNECTION_STATES,
  isConnectionTransitionAllowed,
} from './connection';

// --- Measurements -----------------------------------------------------------
//
// Every field is a branded quantity from @onyourleft/domain. No raw numbers
// cross this boundary — see the header of `measurement.ts` for the units that
// are still missing from #25 and were left out rather than typed as `number`.

export type {
  CadenceMeasurement,
  HeartRateMeasurement,
  MeasurementEnvelope,
  MeasurementFor,
  PowerMeasurement,
  SensorMeasurement,
  SpeedMeasurement,
} from './measurement';

export { isMeasurementOf } from './measurement';

// --- The per-device session every transport composes ------------------------

export type { DeviceSession } from './session';

export { createDeviceSession } from './session';

// --- The transport interface ------------------------------------------------

export type {
  DiscoveryRequest,
  SensorTransport,
  TransportAvailability,
  TransportTraits,
} from './transport';

// --- Planning against the connection budget ---------------------------------

export type { CapabilityAssignment, CapabilityPlan, CapabilityPlanRequest } from './plan';

export { MAX_RECOMMENDED_CONCURRENT_CONNECTIONS, planCapabilitySources } from './plan';

// --- Errors -----------------------------------------------------------------

export type { SensorErrorCode } from './errors';

export { isSensorError, SensorError } from './errors';

// --- Subscriptions ----------------------------------------------------------

export type { Listener, Unsubscribe } from './subscription';
