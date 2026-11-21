// SPDX-License-Identifier: Apache-2.0

/**
 * Which rider the trainer game draws for this athlete — #2839.
 *
 * ## One choice, which is also the calorie estimate's sex
 *
 * The owner's ruling of 2026-11-18 made this a "Rider" choice beside the kit
 * colour, Female or Male, and kept it apart from `AthleteRecord.calorieSex`
 * (the heart-rate calorie estimate's sex, #2432). **The owner's ruling of
 * 2026-11-20 supersedes the separation: "They should be a single choice."**
 * Settings asks Female or Male once, and the store's
 * `ActivityStore.setAthleteRider` writes that word to both fields in one
 * transaction. `calorieSex` still stays on the device
 * (`apps/web/src/privacy/calorie-inputs-stay-here.test.ts`), and so does this.
 *
 * Two fields remain on the row, because rows written before the ruling can
 * hold one without the other, or the two disagreeing. {@link riderChoiceOf}
 * is the one rule that reads them: `calorieSex` when it is set, else
 * `riderBody`. The next choice writes both, and they agree from then on.
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

/**
 * The rider's one Female / Male choice, read from a row written at any time —
 * the owner's ruling of 2026-11-20.
 *
 * `calorieSex` when it is set, else `riderBody`, else `undefined` (a rider who
 * never chose: drawn as {@link DEFAULT_RIDER_BODY}, and *Not set* for the
 * calorie estimate). Settings shows this, the game draws it, and the calorie
 * estimate uses it, so the three cannot disagree about a row whose two fields
 * do.
 *
 * `calorieSex` wins a disagreement because it is the one a rider chose
 * knowing it was a health input, and it is the older field (#2432 shipped,
 * #2839's `riderBody` existed only on test builds before the ruling).
 */
export function riderChoiceOf(
  row:
    | { readonly calorieSex?: RiderBody | undefined; readonly riderBody?: RiderBody | undefined }
    | undefined,
): RiderBody | undefined {
  return row?.calorieSex ?? row?.riderBody;
}
