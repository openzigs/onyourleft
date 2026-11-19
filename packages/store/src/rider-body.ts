// SPDX-License-Identifier: Apache-2.0

/**
 * Which rider the trainer game draws for this athlete — #2839.
 *
 * ## A closed word, and never a health input
 *
 * The owner's ruling of 2026-11-18: a "Rider" choice beside the kit colour,
 * Female or Male, that says how the rider LOOKS. It is not read from
 * `AthleteRecord.calorieSex` and never writes it: that field is an input to
 * the heart-rate calorie estimate and stays on the device
 * (`apps/web/src/privacy/calorie-inputs-stay-here.test.ts`), and choosing how
 * you look does not touch it. Two fields, two setters, and no code path from
 * one to the other — `activity-store.rider-body.test.ts` holds that a write of
 * either leaves the other as it was.
 *
 * ## Like the kit colour, stored here and read nowhere in `packages/`
 *
 * The athlete's own appearance, so it is on the athlete row for
 * `kit-colour.ts`'s reason (ADR 0020 D-2's precedent): it travels with the
 * account export, and a tablet and a phone draw the same rider. Nothing
 * stored, computed, signed or exported changes when it changes.
 *
 * ## An unrecognised value falls back rather than throwing
 *
 * For `kit-colour.ts`'s reason: a hand-edited row saying `"robot"` decides
 * only which body is drawn, and refusing the whole athlete row over it would
 * take a rider's library away. {@link parseRiderBody} answers with
 * {@link DEFAULT_RIDER_BODY} and the row decodes.
 */

/**
 * | Key | The rider drawn |
 * |---|---|
 * | `female` | The female body, in both worlds. |
 * | `male` | The male body: the rider every athlete was drawn as before #2839. **The default.** |
 */
export type RiderBody = 'female' | 'male';

/** Every permitted value, in the order the settings screen offers them. */
export const RIDER_BODIES: readonly RiderBody[] = ['female', 'male'];

/**
 * What an athlete who has not chosen is drawn as: the body they had before
 * #2839, so nobody's rider changes until they choose (the issue's "keep
 * today's look until they choose").
 */
export const DEFAULT_RIDER_BODY: RiderBody = 'male';

/**
 * Whether `value` is one of the two words.
 *
 * ⚠️ `includes` over the list, never `in` over an object, for
 * `kit-colour.ts` §`isKitColour`'s reason: `"constructor"` must not pass.
 */
export function isRiderBody(value: unknown): value is RiderBody {
  return typeof value === 'string' && (RIDER_BODIES as readonly string[]).includes(value);
}

/**
 * The body a stored value names, or {@link DEFAULT_RIDER_BODY}.
 *
 * Total, deliberately — see "An unrecognised value falls back" above.
 */
export function parseRiderBody(value: unknown): RiderBody {
  return isRiderBody(value) ? value : DEFAULT_RIDER_BODY;
}
