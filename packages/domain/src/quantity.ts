// SPDX-License-Identifier: Apache-2.0

/**
 * Nominal typing for physical quantities.
 *
 * A speed, a distance and an altitude are all `number` to TypeScript, so
 * passing metres where metres per second are wanted is not an error the
 * compiler can see. That is the bug class this whole package exists to remove:
 * the wrong number is plausible, nothing throws, and it surfaces when an
 * athlete says their ride was 4,000 km.
 *
 * `Quantity` fixes it by intersecting `number` with a phantom property keyed on
 * a `unique symbol` that is declared here and never exported. Nothing outside
 * this file can name that key, so nothing outside this file can produce a
 * `Quantity` except through the constructors in `quantities.ts` — which is also
 * where validation lives, so "has a unit" and "has been checked" are the same
 * statement.
 *
 * The property is a type-level fiction. `declare const` emits nothing, the
 * intersection erases, and a `Metres` at runtime is a plain `number` with no
 * wrapper, no allocation and no cost. That is deliberate: this package is on
 * the hot path of a 1 Hz record loop and a boxed quantity would be a real
 * expense for a compile-time guarantee.
 *
 * Consequences worth knowing before you use it:
 *
 * - `Quantity<A>` is assignable **to** `number`, so `Math.abs(distance)` and
 *   `distance < other` work unchanged.
 * - `number` is **not** assignable to `Quantity<A>`, and `Quantity<A>` is not
 *   assignable to `Quantity<B>`. Those two facts are the guarantee.
 * - Arithmetic widens: `a + b` on two `Metres` is a `number`. Re-enter the
 *   type through its constructor, which re-validates, rather than casting.
 * - A cast defeats it. `10 as unknown as Metres` compiles. This is a guard
 *   against mistakes, not against a determined author.
 */

declare const unit: unique symbol;

/**
 * A `number` that carries its unit in the type system.
 *
 * @typeParam Unit - the unit's name, spelled the way it would be read aloud.
 * Two quantities are interchangeable if and only if this string matches, so it
 * distinguishes meaning and not only dimension: `'metre'` (a distance travelled)
 * and `'metre of altitude'` are both metres and are deliberately not the same
 * type, because one is a magnitude and the other is signed.
 */
export type Quantity<Unit extends string> = number & { readonly [unit]: Unit };
