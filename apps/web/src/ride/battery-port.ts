// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **How much charge a paired device has left** —
 * [#2047](https://github.com/openzigs/onyourleft/issues/2047): *"each
 * connected sensor that reports a level shows it … a sensor that does not
 * report one shows nothing, never 0%."*
 *
 * In a browser the Web Bluetooth transport reads the Battery Service's one
 * `uint8` through #2046's parser (`WebBluetoothTransport.readBatteryLevel`),
 * and `main.tsx` builds that transport with `batteryLevel: true` so the
 * service is in the grant. The Android shell has no port yet: its native
 * plugin reads no Battery Service, so Home shows no level there rather than
 * a guess.
 *
 * ## Why this is a `*-port.ts`
 *
 * docs/agents/wiring-gate.md §4j: `WIRE003` holds the one method to a
 * production caller (`battery-level.ts` §`useBatteryLevels`). ⚠️ The provider
 * half is the §Limits case, as `signal-port.ts` records: `main.tsx` passes it
 * as an optional prop, and dropping that line is green in the gate —
 * `browser/devices.browser.spec.ts` §"#2047" is what reads a level through it.
 *
 * ⚠️ **It writes nothing to the device** (CLAUDE.md §6): one GATT read.
 */

import type { Percent } from '@onyourleft/domain';
import type { DeviceId } from '@onyourleft/sensors';

export interface BatteryLevelPort {
  /**
   * The connected device's battery level, or `undefined` when it reports
   * none — never 0 for "unknown". Never rejects.
   */
  readBatteryLevel(id: DeviceId): Promise<Percent | undefined>;
}
