// SPDX-License-Identifier: Apache-2.0

/**
 * The imperial mass definition, in the one package every conversion in this
 * program goes through.
 *
 * ## Why this is here rather than beside its caller
 *
 * For {@link METRES_PER_FOOT}'s reason, and it is worth restating because that
 * constant had to be *moved* here after a review found it living in
 * `apps/web/src/units/format.ts`: a conversion factor in a client is a
 * conversion the device and a Phase 3 instance could disagree about, and the
 * disagreement would be invisible until two numbers derived from one
 * measurement failed to match. `packages/domain/README.md` states the rule —
 * every conversion in this program goes through this package — and a mass is
 * not an exception to it.
 *
 * ## A definition, not a measurement
 *
 * The international yard and pound agreement of 1959 fixes the **pound** at
 * exactly 0.453 592 37 kg. It carries no rounding of its own, so
 * {@link KILOGRAMS_PER_POUND} is written out to its full definition rather
 * than to the 0.4536 a calculator offers.
 *
 * ⚠️ **The avoirdupois pound**, which is the one a rider means. The troy pound
 * (0.373 241 721 6 kg) is for precious metals and nothing here weighs any.
 *
 * ## What this is not
 *
 * ⚠️ **Not a stone**, even though a British rider would say "eleven stone
 * seven". A stone is 14 lb and rendering one needs a *two-part* reading —
 * `11 st 7 lb` — which `units/format.ts`'s {@link Measurement} cannot carry: it
 * is one value and one unit by construction, and that construction is #238's
 * fifth criterion rather than an accident. Adding stones is therefore a change
 * to the shape of a measurement and not a constant, and it belongs to whichever
 * issue decides a rider needs it.
 *
 * ⚠️ **Mass, not force.** Everything this program weighs is a mass in the
 * physics sense — `packages/physics`' `gravityForceNewtons` multiplies by `g`
 * itself — and a pound-force is a different quantity that happens to share a
 * name. Nothing here converts one.
 */

/**
 * Kilograms in an avoirdupois pound, exactly.
 *
 * The unit an imperial rider enters and reads their own weight in.
 */
export const KILOGRAMS_PER_POUND = 0.45359237;
