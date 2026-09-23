// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where each rider's contact shadow lies on the road — #426.
 *
 * ## Why a blob, and why first
 *
 * The riders floated: nothing connected a bicycle to the road under it, and
 * the world has had a sun since #286 that nothing it lit ever cast. A shadow
 * under a moving object is the strongest single cue that it is ON a surface,
 * and a soft dark ellipse gets most of that for one transparent draw.
 * `three-renderer.ts` §`ContactShadowBelt` draws it; this file only says where.
 *
 * ⚠️ **The road cannot receive a real shadow and that is not an oversight.**
 * The road and the ground are unlit `MeshBasicMaterial`s (`three-renderer.ts`
 * header §"What is lit"), and an unlit material has no shadow-map lookup in its
 * shader at all. A blob is drawn ON the road instead of being received BY it.
 *
 * ## Placed from the one sun `world.ts` already has
 *
 * No second light direction is invented (#426's first criterion). The blob is
 * the shadow of the rider's middle — {@link CAST_HEIGHT_METRES} up — thrown
 * along the sun's horizontal direction away from it, and stretched along that
 * direction by the length of the shadow the whole rider would throw. A high
 * sun gives a short blob almost under the wheels; the lowest this program's
 * band reaches (55°, `world.ts` §`SUN_ELEVATION_AT_POLE_DEGREES`) throws it
 * about half a metre off to one side.
 *
 * ## Who casts one — ⚠️ the ghost does not
 *
 * {@link CASTS_CONTACT_SHADOW} is the decision #426 asked to be recorded. The
 * rider and the pacer cast one. **The ghost does not**, deliberately: it is a
 * replay of an attempt, not something on the road, and a bicycle with no
 * shadow reads as *not really here* at a glance — which is #93's at-a-glance
 * criterion helped for nothing, where the tint (#368) alone has to carry it
 * today. It is a table rather than a branch so that reversing it is one word.
 *
 * ## Where a leaning rider's shadow goes — #499
 *
 * A rider leaning `φ` into a bend has their middle `sin φ` of its height
 * toward the inside of the bend and `cos φ` of it up, so the blob is thrown
 * from THERE: toward the inside, shorter along the sun, and wider across the
 * bicycle by the length of the rider now lying across it. The same sun; the
 * ghost still casts none.
 *
 * ## What it gets wrong, stated
 *
 * The bicycle itself is drawn LEVEL on a road that climbs (`port.ts`
 * §`RiderMarker` carries a heading and no pitch), and the blob is level with
 * it, lifted {@link CONTACT_SHADOW_LIFT_METRES}. On a 10 % grade the uphill end
 * of a 1.7 m blob is 8 cm under the road surface and the depth test hides it —
 * which is where the wheel is buried too. And it is one ellipse for a shape
 * that is not one: a rider's shadow has a head and two wheels in it. The shadow
 * MAP rung (`quality.ts` §`RIDER_SHADOW_MAP_RUNG`) is what draws the real shape,
 * and it is off by default.
 *
 * Pure: no `three`, no clock, no DOM. `three-seam.test.ts` keeps it that way.
 */

import {
  BICYCLE_FRONT_METRES,
  BICYCLE_LENGTH_METRES,
  RIDER_HALF_WIDTH_METRES,
  RIDER_HEIGHT_METRES,
} from './bicycle';
import type { RiderMarker } from './port';
import type { SunStyle } from './world';

/**
 * Which riders cast a contact shadow. ⚠️ The ghost does not — see the module
 * note §"Who casts one". Keyed by kind, so a fourth marker kind is a compile
 * error here rather than a rider that silently casts or does not.
 */
export const CASTS_CONTACT_SHADOW: Readonly<Record<RiderMarker['kind'], boolean>> = {
  rider: true,
  bot: true,
  ghost: false,
};

/**
 * How far above the road's height at the rider the blob is drawn: **2 cm**.
 *
 * Enough to clear the road's own triangles at the depth precision a 0.5 m near
 * plane leaves 10 m out, with the polygon offset `three-renderer.ts` also
 * applies; small enough that nothing at a rider's eye height can see the gap.
 */
export const CONTACT_SHADOW_LIFT_METRES = 0.02;

/**
 * How dark the blob is at its middle, as the alpha of black: **0.45**.
 *
 * Chosen, not derived, and stated as a choice. A shadow under a clear sky is
 * lit by the sky alone, which is `SunStyle.ambient` of the light on a
 * horizontal surface — 0.4, `world.ts` §`SUN_AMBIENT_SHARE` — so a shadow that
 * took away ALL of the direct light would be black at an alpha of 0.6. 0.45 at
 * the centre, fading to nothing at the rim, is lighter than that everywhere,
 * which is the soft contact shadow #426 asks for rather than a hard cast one.
 */
export const CONTACT_SHADOW_DARKNESS = 0.45;

/**
 * The height whose shadow the blob is centred on: half the rider, **0.76 m**.
 * A person on a bicycle is roughly a column of that height over the wheels.
 */
const CAST_HEIGHT_METRES = RIDER_HEIGHT_METRES / 2;

/**
 * How far behind the marker's origin the bicycle's middle is. The wheels span
 * from the rear tyre to {@link BICYCLE_FRONT_METRES}, so the middle is half
 * the length back from the front.
 */
const BICYCLE_MIDDLE_AHEAD_METRES = BICYCLE_FRONT_METRES - BICYCLE_LENGTH_METRES / 2;

/**
 * The footprint's half-width: the handlebar's, plus a margin so the blob shows
 * either side of a tyre that is itself only 5 cm wide.
 */
const FOOTPRINT_HALF_WIDTH_METRES = RIDER_HALF_WIDTH_METRES + 0.1;

/** One blob: where its middle is, which way its long axis points, and how big. */
export interface ContactShadow {
  x: number;
  y: number;
  z: number;
  /** A rotation about +Y, in radians, taking +Z onto the blob's long axis. */
  yaw: number;
  halfAlong: number;
  halfAcross: number;
}

/**
 * Where one rider's contact shadow lies under one sun, written into `into`.
 *
 * @returns whether this rider casts one at all — `false` for the ghost
 * ({@link CASTS_CONTACT_SHADOW}), and under a sun at or below the horizon,
 * which `world.ts` never produces (its band is 55°–70°) and which would
 * otherwise throw a shadow of infinite length. Stated rather than clamped to
 * a length nobody chose. `into` is untouched when it returns `false`.
 *
 * ⚠️ **Writes into an object the caller owns rather than returning one**,
 * because it is called for every rider on every frame and #240's NFR-3 is
 * that a frame allocates nothing — `RiderBelt.place` is written the same way.
 */
export function placeContactShadow(
  marker: RiderMarker,
  sun: Pick<SunStyle, 'x' | 'y' | 'z'>,
  into: ContactShadow,
): boolean {
  if (!Object.hasOwn(CASTS_CONTACT_SHADOW, marker.kind) || !CASTS_CONTACT_SHADOW[marker.kind]) {
    return false;
  }
  if (!(sun.y > 0)) {
    return false;
  }
  // Where the shadow of a point `h` up lands, relative to the point's foot:
  // along the sun's horizontal direction, AWAY from the sun, `h / tan(elev)`.
  const awayX = -sun.x / sun.y;
  const awayZ = -sun.z / sun.y;
  const acrossX = marker.headingZ;
  const acrossZ = -marker.headingX;
  // #499: a leaning rider's middle is not over the wheels. It is `sin φ` of its
  // height toward the road's normal — `−across` — and only `cos φ` of it up, so
  // it is both displaced and nearer the road, and the rider's whole length now
  // lies partly ACROSS the bicycle as well as up it.
  const rise = Math.cos(marker.lean);
  const tip = Math.sin(marker.lean);
  const middleX = -acrossX * tip * CAST_HEIGHT_METRES;
  const middleZ = -acrossZ * tip * CAST_HEIGHT_METRES;
  // The whole rider's shadow, projected onto the bicycle's two axes: how much
  // it lengthens the blob along the bicycle, and how much across it.
  const throwX = awayX * RIDER_HEIGHT_METRES * rise - acrossX * tip * RIDER_HEIGHT_METRES;
  const throwZ = awayZ * RIDER_HEIGHT_METRES * rise - acrossZ * tip * RIDER_HEIGHT_METRES;
  const along = Math.abs(throwX * marker.headingX + throwZ * marker.headingZ);
  const across = Math.abs(throwX * acrossX + throwZ * acrossZ);
  into.x =
    marker.x +
    BICYCLE_MIDDLE_AHEAD_METRES * marker.headingX +
    awayX * CAST_HEIGHT_METRES * rise +
    middleX;
  into.y = marker.y + CONTACT_SHADOW_LIFT_METRES;
  into.z =
    marker.z +
    BICYCLE_MIDDLE_AHEAD_METRES * marker.headingZ +
    awayZ * CAST_HEIGHT_METRES * rise +
    middleZ;
  into.yaw = Math.atan2(marker.headingX, marker.headingZ);
  into.halfAlong = BICYCLE_LENGTH_METRES / 2 + along / 2;
  into.halfAcross = FOOTPRINT_HALF_WIDTH_METRES + across / 2;
  return true;
}
