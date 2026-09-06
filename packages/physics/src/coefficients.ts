// SPDX-License-Identifier: Apache-2.0

/**
 * The model's tunable coefficients, and the default value of each with the
 * source it came from.
 *
 * **Nothing here is baked into a force term.** #88's fourth acceptance
 * criterion requires the six coefficients of the Dahmen & Saupe force balance —
 * ζ, μ, β₀, β₁, c_d and A — to be tunable with documented defaults and a stated
 * source per default, because a rider's drag area and a tyre's rolling
 * resistance are properties of that rider and that tyre and not of this
 * program. Three more ({@link PhysicsCoefficients.spokeDragAreaSquareMetres},
 * {@link PhysicsCoefficients.wheelMomentOfInertiaKilogramSquareMetres} and
 * {@link PhysicsCoefficients.wheelRadiusMetres}) are tunable for the same
 * reason: Martin's Equations 4 and 12 need them, and a disc wheel and a 32-spoke
 * box-section wheel are not the same number.
 *
 * ## Provenance, and what rests on weaker evidence
 *
 * Modelled on [`packages/fit/README.md`](../../fit/README.md) §3, which records
 * where every protocol number came from and flags the ones corroborated by less
 * than the rest rather than presenting them all as equally settled. The two
 * flagged here are `dragCoefficient` and `frontalAreaSquareMetres`: **Martin
 * reports only their product**, so the split between them is this package's and
 * not the paper's, and only the product enters any equation.
 */

/**
 * A coefficient set. Every field is a number in SI units; none is branded,
 * because `packages/domain` has no type for a drag coefficient or a rolling
 * resistance and #88 is not the issue that adds one.
 */
export interface PhysicsCoefficients {
  /**
   * `c_d` — the dimensionless coefficient of drag. **Tunable 1 of 6.**
   *
   * ⚠️ Only the product `c_d · A` is physically meaningful and only the product
   * is used, by {@link dragAreaSquareMetres}. Martin measures the product
   * directly in a wind tunnel (Equation 1, "the product of C_D × A (drag area)
   * was then calculated as C_D A = 2 F_D / ρ V_a²") and never reports the two
   * factors separately, so the split in these defaults is **not the paper's**.
   * It is chosen so that the product is the paper's figure; see
   * {@link frontalAreaSquareMetres}.
   */
  readonly dragCoefficient: number;

  /**
   * `A` — frontal area, in square metres. **Tunable 2 of 6.** Carries the same
   * caveat as {@link dragCoefficient}: the split is this package's, the product
   * is Martin's.
   */
  readonly frontalAreaSquareMetres: number;

  /**
   * `F_w` — the incremental drag area of the spokes, in square metres, from
   * Martin Equation 3. The wheels are not in the wind-tunnel balance's frontal
   * area and the spokes slice through the air like the blades of a fan, so the
   * paper measures the extra aerodynamic power to rotate a suspended wheel and
   * models it as a second drag area added to `c_d · A` in Equation 4.
   *
   * Folding it into `c_d · A` would be wrong in the direction riders notice:
   * it scales with `V_a²` exactly as the body's drag does, so the sum is right
   * but a rider changing wheels would be changing the wrong number.
   */
  readonly spokeDragAreaSquareMetres: number;

  /**
   * `μ`, Martin's `C_RR` — the dimensionless coefficient of rolling resistance,
   * the ratio of the tangential force to the normal force. **Tunable 3 of 6.**
   */
  readonly rollingResistanceCoefficient: number;

  /**
   * `β₀` — the speed-independent part of wheel-bearing friction, in newtons.
   * **Tunable 4 of 6.**
   *
   * Separate from {@link rollingResistanceCoefficient} on purpose. #88 names
   * folding bearing friction into `C_RR` as one of the two terms naive
   * implementations get wrong, and the reason is visible in the units: rolling
   * resistance scales with **weight** and bearing friction does not, so a model
   * that merges them gets low-speed behaviour wrong and gets it wrong
   * differently for a heavy rider than for a light one.
   */
  readonly bearingFrictionConstantNewtons: number;

  /**
   * `β₁` — the speed-proportional part of wheel-bearing friction, in newton
   * seconds per metre. **Tunable 5 of 6.**
   */
  readonly bearingFrictionPerMetrePerSecondNewtonSeconds: number;

  /**
   * `ζ` — the fraction of the rider's power lost in the drive chain, so that
   * the power reaching the wheel is `(1 − ζ) P`. **Tunable 6 of 6.**
   *
   * A fraction lost rather than an efficiency, because that is the form the
   * Dahmen & Saupe force balance #88 quotes uses (`P/v − ζP/v − …`), and
   * because a field named for the loss cannot be confused with one named for
   * what is left. Martin's `E_C` is `1 − ζ`.
   */
  readonly drivetrainLossFraction: number;

  /**
   * `I` — the moment of inertia of the two wheels, in kilogram square metres,
   * from Martin Equation 12.
   *
   * This and {@link wheelRadiusMetres} are what make the rotating mass of the
   * wheels count twice in an acceleration: once as mass and once as spin. #88's
   * third acceptance criterion is a test that removing this term changes the
   * answer, because without it a sprint accelerates instantly and experienced
   * riders identify the feel immediately.
   */
  readonly wheelMomentOfInertiaKilogramSquareMetres: number;

  /**
   * `r` — the outside radius of the tyre, in metres, from Martin Equation 12.
   * It enters as `I / r²`, so it is squared and a 5 % error here is a 10 %
   * error in the rotating-mass term.
   */
  readonly wheelRadiusMetres: number;
}

/**
 * The defaults, every one of them from Martin et al. 1998.
 *
 * They describe **that paper's rider on that paper's bicycle**: a 1.77 m
 * experienced cyclist in a time-trial position on a bicycle with a lens-shaped
 * rear disc wheel, a 24-oval-spoke airfoil front wheel and 20 mm clinchers at 9
 * atmospheres. They are a starting point, which is the whole reason the fields
 * above are tunable — an upright rider on 28 mm tyres matches none of them.
 *
 * | Field | Default | Source |
 * |---|---|---|
 * | `dragCoefficient` × `frontalAreaSquareMetres` | 0.264 m² | Model Application: "a hypothetical subject who had the average characteristics of our subjects (drag area = 0.264 m², mass = 71.9 kg)". The **split** into 0.88 × 0.30 is not the paper's — see below. |
 * | `spokeDragAreaSquareMetres` | 0.0044 m² | Appendix I: `(0.2565 + 0.0044)` in the aerodynamic power line. |
 * | `rollingResistanceCoefficient` | 0.0032 | "Kyle (1988) reported C_RR values ranging from 0.0027 to 0.0040 for 10 high-pressure clincher bicycle tires on smooth asphalt … we used the average of those 10 values (C_RR = 0.0032)". |
 * | `bearingFrictionConstantNewtons` | 0.091 N | Equation 7, `P_WB = V_G (91 + 8.7 V_G) 10⁻³`, divided through by `V_G` to give a force — see below. |
 * | `bearingFrictionPerMetrePerSecondNewtonSeconds` | 0.0087 N·s/m | Equation 7, likewise. Both trace back to Dahn, Mai, Poland & Jenkins (1991), whose measured bearing torque was `T = 0.015 + 0.00005 N` N·m. |
 * | `drivetrainLossFraction` | 0.024 | Appendix I divides by `E_C = 0.976`. ⚠️ The Results section reports 97.698 % — see below. |
 * | `wheelMomentOfInertiaKilogramSquareMetres` | 0.14 | Equation 12: "I is the moment of inertia of the two wheels (approximately 0.14 kg · m²)". |
 * | `wheelRadiusMetres` | 0.311 | Appendix I: `0.14 / 0.311²`. |
 *
 * ## Three notes, because two of these numbers are less settled than the rest
 *
 * **The drag-area split is invented.** 0.88 × 0.30 = 0.264 exactly, and 0.264 is
 * the paper's. Neither factor is: Martin measures the product and reports the
 * product, and no equation in this package reads either field alone. Splitting
 * at all is a concession to #88's acceptance criterion, which names `c_d` and
 * `A` as separate tunables. Tune the product; treat a single factor as
 * meaningless.
 *
 * **The paper states its own chain efficiency twice, and the two disagree.**
 * Results says "the efficiency of the chain drive system (E_C) was 97.698 %";
 * Appendix I computes `P_TOT = 208.2/0.976 = 213.3 W`. The default here is
 * `1 − 0.976`, the Appendix's value, because the Appendix is the worked example
 * `martin-1998.test.ts` reproduces and 97.698 % would put that reproduction
 * 0.4 W off the published answer. The difference between the two is 0.2 % of
 * total power; if you are tuning for a rider rather than for the paper, neither
 * figure is more right than the other.
 *
 * **Equation 7 is a power, and these two are forces.** The paper writes bearing
 * loss as `P_WB = V_G (91 + 8.7 V_G) 10⁻³` watts. Dividing by `V_G` gives the
 * force `(91 + 8.7 V_G) 10⁻³ = 0.091 + 0.0087 V_G` newtons, which is the
 * `β₀ + β₁ v` of the Dahmen & Saupe balance #88 quotes. The rearrangement is
 * arithmetic, not a modelling choice, and `terms.test.ts` asserts the force term
 * reproduces Equation 7 exactly when multiplied back by speed.
 */
export const MARTIN_1998_COEFFICIENTS: PhysicsCoefficients = {
  dragCoefficient: 0.88,
  frontalAreaSquareMetres: 0.3,
  spokeDragAreaSquareMetres: 0.0044,
  rollingResistanceCoefficient: 0.0032,
  bearingFrictionConstantNewtons: 0.091,
  bearingFrictionPerMetrePerSecondNewtonSeconds: 0.0087,
  drivetrainLossFraction: 0.024,
  wheelMomentOfInertiaKilogramSquareMetres: 0.14,
  wheelRadiusMetres: 0.311,
};

/**
 * The coefficient set every entry point falls back to when none is given.
 *
 * An alias rather than a second literal: two literals is two places to change
 * and one of them gets missed. The alias exists so that a caller reads
 * "defaults" and a reviewer reads "Martin 1998" at the same site.
 */
export const DEFAULT_COEFFICIENTS = MARTIN_1998_COEFFICIENTS;

/**
 * Fill in the fields a caller did not override.
 *
 * @param overrides - any subset of {@link PhysicsCoefficients}. `undefined` is
 * the whole set, which is what makes every `coefficients` parameter in this
 * package optional.
 */
export function withDefaultCoefficients(
  overrides?: Partial<PhysicsCoefficients>,
): PhysicsCoefficients {
  return overrides === undefined ? DEFAULT_COEFFICIENTS : { ...DEFAULT_COEFFICIENTS, ...overrides };
}

/**
 * The drag area `c_d · A`, in square metres — the only combination of those two
 * fields any equation uses.
 */
export function dragAreaSquareMetres(coefficients: PhysicsCoefficients): number {
  return coefficients.dragCoefficient * coefficients.frontalAreaSquareMetres;
}

/**
 * Martin's `E_C`, the fraction of the rider's power that reaches the wheel.
 */
export function drivetrainEfficiency(coefficients: PhysicsCoefficients): number {
  return 1 - coefficients.drivetrainLossFraction;
}

/**
 * An override that sets the drag area `c_d · A` directly.
 *
 * Every source of a drag area reports the product and not its factors: a wind
 * tunnel measures `C_D A = 2 F_D / ρ V_a²` (Martin, Equation 1), and a field
 * test regresses it out of power and speed. So the natural thing for a caller to
 * have is the product, and the natural way to spell that in a `c_d` and `A`
 * shape is to put all of it in one field and 1 in the other — which reads as a
 * mistake unless it is named.
 *
 * ```ts
 * powerRequired({ …, coefficients: withDragArea(0.264) });
 * ```
 *
 * @param dragAreaSquareMetres - `c_d · A`, in square metres.
 */
export function withDragArea(
  dragAreaSquareMetres: number,
): Pick<PhysicsCoefficients, 'dragCoefficient' | 'frontalAreaSquareMetres'> {
  return { dragCoefficient: dragAreaSquareMetres, frontalAreaSquareMetres: 1 };
}
