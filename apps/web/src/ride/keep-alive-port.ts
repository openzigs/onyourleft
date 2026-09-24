// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What a ride may ask the platform: keep this process alive while I record**
 * — [#524](https://github.com/openzigs/onyourleft/issues/524).
 *
 * On Android that is `RecordingService.java`, the `connectedDevice` foreground
 * service #87 built so a ride survives the screen going off. Until #524
 * **nothing started it**: `RecordingServicePlugin` was registered and declared
 * and no TypeScript named it, so `apps/mobile/src/ble/transport.ts`'s
 * `canRestoreConnectionsInBackground: true` rested on a service that never ran.
 * In a browser there is nothing to ask, and the controller is handed no port.
 *
 * ## Why this is a `*-port.ts`
 *
 * CLAUDE.md §4j: the suffix makes both methods `WIRE003` targets, so a
 * controller that stopped calling them is a red gate. ⚠️ **The provider half is
 * the §Limits case**: `main.tsx` hands the Android implementation to
 * `createRideController` as an optional option, and a `main.tsx` that stopped
 * doing so is green in `check:wiring` and in every test. `ride/controller.test.ts`
 * §"#524" covers everything after that line; nothing covers the line itself,
 * which is the gap `presence-port.ts` records for the camera.
 *
 * ## ⚠️ Neither method may throw into the ride
 *
 * The controller calls these fire-and-forget and swallows a rejection. A ride
 * recorded without the service is a DEGRADED ride — it may be cut short if the
 * phone reclaims the process — not a broken one, and refusing to record because
 * a notification could not be posted would turn a background risk into a
 * certain loss.
 */

/** The two calls a ride makes, on the transitions into and out of riding. */
export interface RideKeepAlivePort {
  /**
   * The ride is active — recording or paused. Keep the process alive.
   *
   * Called once per transition, never per tick. A pause keeps it: a paused
   * ride's sensor links still have to survive the screen going off.
   */
  keepRideAlive(): Promise<void>;
  /** The ride has stopped, or its controller is gone. Let the process sleep. */
  letRideSleep(): Promise<void>;
}
