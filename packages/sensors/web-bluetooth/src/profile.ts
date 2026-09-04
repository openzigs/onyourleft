// SPDX-License-Identifier: Apache-2.0

/**
 * The seam #41–#43 plug into, re-exported.
 *
 * **The declarations moved to `packages/sensors/protocol/src` in #41.** They
 * were written here by #40 because the browser adapter was then the only thing
 * with a UUID to compare or a payload to decode; the protocol clients gave them
 * a second consumer, and it is the one the arrangement exists for. `README.md`
 * promises the decoders are *"the same parser, unchanged"* for the Capacitor
 * plugin over CoreBluetooth and Android BLE (#15), and a profile that had to
 * import its own type from the *browser* adapter would make #15 depend on #40 —
 * exactly the coupling #39 exists to prevent.
 *
 * Nothing that moved names a platform API: a `GattUuid` is a string, and
 * `DataView` is an ECMAScript built-in. `protocol/` is compiled by the same
 * `tsconfig.platform-free.json` that holds `src/` to `lib: ["ES2024"]` and
 * `types: []`, so the move did not widen anything.
 *
 * This file stays so that every import inside this directory, and
 * `@onyourleft/sensors/web-bluetooth`'s own entry point, are unchanged.
 */

export type { GattProfile, MeasurementSink, MeasurementValueFor } from '../../protocol/src/profile';

export { canonicalUuid } from '../../protocol/src/uuid';
