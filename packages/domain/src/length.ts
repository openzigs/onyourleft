// SPDX-License-Identifier: Apache-2.0

/**
 * The imperial length definitions, in the one package every conversion in this
 * program goes through.
 *
 * ## Why these are here rather than beside their caller
 *
 * `METRES_PER_MILE` was already here, in `speed.ts`, because miles per hour
 * needs it. `METRES_PER_FOOT` was not: it sat in `apps/web/src/units/format.ts`
 * with a comment claiming the two were *"consistent with each other by
 * construction: 5280 × 0.3048 = 1609.344"* — which was an **assertion about two
 * constants in two packages**, true only for as long as somebody kept them in
 * step. A review raised it; this module is the answer.
 *
 * The claim is now construction. {@link METRES_PER_MILE} is **derived** from
 * {@link METRES_PER_FOOT} and {@link FEET_PER_MILE} rather than written out
 * again, so the two cannot disagree: changing either changes the mile, and
 * `length.test.ts` pins the derived value to the exact 1 609.344 the 1959
 * agreement defines. That product is exact in IEEE-754 — checked, not assumed,
 * and the test is what keeps it checked.
 *
 * ## Definitions, not measurements
 *
 * The international yard and pound agreement of 1959 fixes the yard at exactly
 * 0.9144 m, and with it the foot at exactly 0.3048 m and the mile at exactly
 * 1 609.344 m. None of these carries a rounding of its own. The **US survey**
 * foot and mile are different by about three parts per million; they are
 * land-survey units and nothing in this program renders a road distance or an
 * elevation in one.
 */

/**
 * Metres in an international foot, exactly.
 *
 * The elevation and segment-scale unit an imperial rider reads — a climb in
 * feet rather than metres.
 */
export const METRES_PER_FOOT = 0.3048;

/** Feet in a mile. A definition, and the link between the two above. */
export const FEET_PER_MILE = 5280;

/**
 * Metres in an international mile, exactly 1 609.344.
 *
 * ⚠️ **Derived rather than written out**, so the foot and the mile are
 * consistent by construction. See the module note.
 */
export const METRES_PER_MILE = FEET_PER_MILE * METRES_PER_FOOT;
