// SPDX-License-Identifier: Apache-2.0

/**
 * Physical constants, each with the source it was read from.
 *
 * A constant here is a **fact**: a measured or defined quantity taken from a
 * published paper or a published standard. CLAUDE.md §6 draws the line this
 * file sits on — "a physical constant or an equation from a published paper
 * (Martin et al. 1998, for instance) carries no such restriction. An
 * implementation of it is." Every mature prior-art cycling-physics
 * implementation is GPL, AGPL or NonCommercial, and `packages/` admits none of
 * the three, so nothing in this package was read out of one. Each number below
 * names the document it came from and, where the document disagrees with
 * itself, says so rather than picking the convenient one.
 *
 * ## The sources
 *
 * - **Martin, Milliken, Cobb, McFadden & Coggan (1998).** *Validation of a
 *   Mathematical Model for Road Cycling Power.* J Appl Biomech 14(3):276–291.
 *   Equation numbers cited throughout this package are that paper's.
 * - **ISO 2533:1975, the International Standard Atmosphere**, for the
 *   air-density model in `air.ts`.
 */

/**
 * The acceleration of gravity, in metres per second squared, **as Martin et al.
 * 1998 uses it**: Equation 5 states "g is the acceleration of gravity (9.81
 * m/s²)".
 *
 * Deliberately not 9.80665, the standard gravity of ISO 2533 and the CGPM. The
 * two differ by 0.034 %, which is about 0.008 W on the paper's own worked
 * example — far inside its 2.7 W standard error, and far outside the 0.1 W
 * tolerance `martin-1998.test.ts` asserts the worked example to. Reproducing a
 * published figure means using the published figure's inputs, so the model uses
 * this one and {@link STANDARD_GRAVITY_METRES_PER_SECOND_SQUARED} is confined
 * to the atmosphere model, where ISO 2533 defines the value it is part of.
 */
export const GRAVITY_METRES_PER_SECOND_SQUARED = 9.81;

/**
 * Standard gravity, in metres per second squared: 9.80665, defined exactly by
 * the 3rd CGPM (1901) and used by ISO 2533 in the barometric formula.
 *
 * Used **only** by `air.ts`, because it is one of the defined constants of the
 * standard atmosphere rather than a free choice. Using Martin's 9.81 there
 * instead would be substituting a rounded value into a formula whose other
 * constants were fixed alongside this one.
 */
export const STANDARD_GRAVITY_METRES_PER_SECOND_SQUARED = 9.80665;

/**
 * The divisor between a grade in percent and the dimensionless rise-over-run
 * ratio the equations take.
 *
 * `GradePercent` is percent because the wire format, the course file and the
 * rider all use percent — a 7 % climb is 7, not 0.07 (`packages/domain`). Every
 * grade in Martin et al. is a ratio: the worked example's grade is 0.003, which
 * is 0.3 %. Getting this backwards is a hundred-fold error that still produces
 * a plausible-looking number, which is why the conversion is a named constant
 * applied in exactly one place ({@link gradeRatio}) rather than a `/ 100`
 * scattered across the force terms.
 */
export const PERCENT_PER_UNIT_RATIO = 100;

/**
 * The rise-over-run ratio of a grade given in percent — Martin's `G_R`.
 *
 * @param percent - a signed grade in percent; a descent is negative.
 */
export function gradeRatio(percent: number): number {
  return percent / PERCENT_PER_UNIT_RATIO;
}
