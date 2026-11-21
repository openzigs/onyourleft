// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which rider is drawn — #2839: the rider's own choice (Settings, "Your
 * rider"), and the mix a field of bots and scenery cyclists is drawn in.
 *
 * The two words are `@onyourleft/store`'s `RiderBody`; what each is DRAWN as
 * is the renderer's: the stylised world's parts are `bicycle.ts`
 * §`RIDER_UPPER_BODY_PARTS_BY_BODY`, and the realistic world's models are
 * `realistic-assets.ts` §`REALISTIC_RIDER_BODIES`.
 *
 * ⚠️ **Drawing only.** Nothing here reaches the physics, a trainer, a saved
 * ride or the heart-rate calorie estimate. Since the owner's ruling of
 * 2026-11-20 the rider's choice is ALSO the estimate's sex, but that is the
 * store's one write (`setAthleteRider`) and `athlete/calorie-inputs.ts`' read,
 * not this module's: it is handed the choice and only draws it. Pure: no
 * `three`, no clock, no storage.
 *
 * ⚠️ **A TYPE from `@onyourleft/store`, and nothing at runtime**, for
 * `bicycle.ts`'s reason: the renderer imports this file, the demo bundles the
 * renderer, and the demo may reach no store (`demo/no-recorded-data.test.ts`,
 * #1645). So the default is restated here, and `rider-body.test.ts` holds it
 * equal to the store's `DEFAULT_RIDER_BODY`.
 */

import type { RiderBody } from '@onyourleft/store';

/** What each choice is called on the settings screen. */
export const RIDER_BODY_NAMES: Readonly<Record<RiderBody, string>> = {
  female: 'Female',
  male: 'Male',
};

/**
 * The body a rider is drawn as, from what their athlete row — or a room, or a
 * frame — says.
 *
 * ⚠️ **The one place an absent or unrecognised choice becomes the default**
 * (`@onyourleft/store`'s `DEFAULT_RIDER_BODY`: the rider everybody was drawn
 * as before #2839), for `bicycle.ts` §`riderKitFor`'s reason: `undefined` is a
 * rider who has never chosen, and anything that is not one of the two words —
 * a hand-edited row, a value off a future build — is untrusted on read and
 * draws the default, so nothing else can select a model.
 */
export function riderBodyFor(chosen: unknown): RiderBody {
  // `Object.hasOwn`, never `in`: `"toString"` is no rider.
  return typeof chosen === 'string' && Object.hasOwn(RIDER_BODY_NAMES, chosen)
    ? (chosen as RiderBody)
    : DRAWN_BY_DEFAULT;
}

/** The store's `DEFAULT_RIDER_BODY`, restated — see the file header. */
const DRAWN_BY_DEFAULT: RiderBody = 'male';

/**
 * The body the `index`th simulated rider of a field is drawn as — #2839's
 * "a seeded mix of both, deterministic per race seed".
 *
 * The seed decides which body the first rider has, and the field alternates
 * from there, so any field of two or more holds BOTH bodies — a draw per
 * rider would, one field in four, make three bots all alike — and the same
 * seed draws the same field on every replay and every device. Total: any
 * finite seed and index answer, and anything else answers as nought does.
 */
export function seededRiderBody(seed: number, index: number): RiderBody {
  const first = mixed(Number.isFinite(seed) ? Math.trunc(seed) : 0) & 1;
  const at = Number.isFinite(index) ? Math.trunc(index) : 0;
  return ((first + at) & 1) === 0 ? 'female' : 'male';
}

/** A 32-bit integer mix (the finaliser of MurmurHash3), so near seeds do not share a first body. */
function mixed(value: number): number {
  let h = value | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * The body the lone pacer of a solo ride is drawn as — #2839. A solo ride has
 * no race seed, so the pacer's is the ROUTE's: the same route draws the same
 * pacer on every ride and every device, and across routes the pacers are a
 * mix of both. `routeId` is only hashed (FNV-1a, 32 bits); nothing of it is
 * kept or sent.
 */
export function pacerBodyFor(routeId: string): RiderBody {
  let hash = 0x811c9dc5;
  for (let at = 0; at < routeId.length; at += 1) {
    hash = Math.imul(hash ^ routeId.charCodeAt(at), 0x01000193);
  }
  return seededRiderBody(hash, 0);
}
