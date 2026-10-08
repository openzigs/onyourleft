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
 * docs/agents/wiring-gate.md §4j: the suffix makes both methods `WIRE003` targets. Since #647
 * the controller calls `keepRideAlive` in ONE place, `askToKeepAlive`, which
 * `syncKeepAlive`, a granted notification (#526) and a sensor pairing mid-ride
 * all go through — so deleting that call is a red `WIRE003`. ⚠️ Deleting one
 * of the three CALLERS of `askToKeepAlive` is not: what goes red then is
 * `ride/controller.test.ts` §"#524", §"#526" and §"#647". Deleting
 * `letRideSleep`'s one call is a red `WIRE003`.
 *
 * **The provider half** used to be the §Limits case: `main.tsx` handed the
 * Android implementation to `createRideController` as an optional option, and
 * a `main.tsx` that stopped doing so was green everywhere. Since #524's second
 * pull request the shell's controller is built by
 * `ride/shell-ride-controller.ts`, which a `main.tsx` that stopped calling is a
 * red `WIRE001`, and whose test drives a ride down to a scripted
 * `RecordingServicePlugin` through the real `@onyourleft/mobile` adapters.
 *
 * ## ⚠️ Neither method may throw into the ride
 *
 * The controller calls these fire-and-forget. A ride recorded without the
 * service is a DEGRADED ride — it may be cut short if the phone reclaims the
 * process — not a broken one, and refusing to record because a notification
 * could not be posted would turn a background risk into a certain loss.
 *
 * ⚠️ **Since #647 a refused `keepRideAlive` is not swallowed silently.** It
 * still never reaches the ride, but it is `RideSnapshot.keepAliveFailed`, and
 * the Ride screen and the game's HUD tell the rider to keep the screen on.
 * A REJECTION (or a throw) is what means "refused"; a promise that never
 * settles is read as nothing either way. `RecordingServicePlugin.java` §`start`
 * settles at once on both paths, so no bound is put on it here.
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
