// SPDX-License-Identifier: Apache-2.0

/**
 * The one error this package throws.
 *
 * It is deliberately narrow. `@onyourleft/domain`'s constructors already reject
 * anything that is not the quantity at all — a negative mass, a NaN speed — and
 * every branded parameter in this package has therefore been checked before it
 * arrives. What is left is the small set of inputs that are individually valid
 * and jointly impossible, or that fall outside the range a published formula was
 * fitted over. Those are the cases below.
 *
 * A distinct class rather than `UnitError`, because these are not unit faults: a
 * caller catching one is deciding what to do about a model it cannot evaluate,
 * not about a number that was mislabelled.
 */
export class PhysicsError extends Error {
  public override readonly name = 'PhysicsError';

  public constructor(message: string) {
    super(message);
  }
}
