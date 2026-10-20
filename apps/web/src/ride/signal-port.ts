// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **How strongly a paired device is heard** —
 * [#1435](https://github.com/openzigs/onyourleft/issues/1435): *"the pairing
 * list shows each device's signal strength where the platform gives it."*
 *
 * Only the Android shell gives it: `apps/mobile/src/ble/signal.ts` reads the
 * phone's own RSSI for a connected link. Web Bluetooth has no RSSI for a
 * connected device — Chrome's chooser shows one and hands the page nothing,
 * and `watchAdvertisements()` is behind a flag (docs/agents/web-bluetooth.md
 * §8) — so in a browser there is no port and the list shows no figure.
 *
 * ## Why this is a `*-port.ts`
 *
 * docs/agents/wiring-gate.md §4j: `WIRE003` holds the one method to a
 * production caller (`signal-strength.ts` §`useSignalStrengths`). ⚠️ The
 * provider half is the §Limits case, as `keep-alive-port.ts` records:
 * `main.tsx` passes it as an optional prop, and dropping that line is green
 * in the gate.
 *
 * ⚠️ **It sends nothing to the device** (CLAUDE.md §6) — see
 * `apps/mobile/src/ble/plugin-port.ts` §`readRssi`.
 */

import type { DeviceId } from '@onyourleft/sensors';

export interface SignalStrengthPort {
  /**
   * The connected device's signal strength in dBm, or `undefined` when the
   * platform cannot say. Never rejects.
   */
  readSignal(id: DeviceId): Promise<number | undefined>;
}
