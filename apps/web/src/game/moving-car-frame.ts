// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a frame carries of one moving car — #3283 (`moving-cars.ts` places
 * them, `three-renderer.ts` §`ParkedCarBelt` draws them).
 *
 * ⚠️ **A type alone, in a file of its own, importing nothing**: `port.ts`
 * names it, and everything that imports `port.ts` — Delivery's
 * `delivery/targets.ts` among them, whose closure must reach no recording
 * (`delivery/targets.test.ts`) — would otherwise reach whatever
 * `moving-cars.ts` imports.
 */

/** One moving car as a frame carries it, in the corridor's local metres. @see SceneFrame.movingCars in `port.ts` */
export interface MovingCar {
  readonly kind: 'oncoming' | 'crossing';
  readonly x: number;
  /** The drawn road or ground under its middle. */
  readonly y: number;
  readonly z: number;
  /** three's yaw: its nose points along `(sin heading, cos heading)` in `x, z`. */
  readonly heading: number;
  /** How far its nose is tipped up the road it drives on, radians. */
  readonly pitch: number;
  /** Its hash: which body and which paint it is (`parked-cars.ts` §`parkedCarBody`, §`parkedCarPaint`). */
  readonly look: number;
  /** How far it has driven, metres: its wheels roll through this. */
  readonly travelled: number;
  /** Its speed, metres a second: with its steer, how far its body leans. */
  readonly speed: number;
  /** How sharply its road bends for it, per metre, positive to its own left: what its front wheels steer by. */
  readonly curvature: number;
}
