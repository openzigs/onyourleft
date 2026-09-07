// SPDX-License-Identifier: Apache-2.0

/**
 * The two-parameter critical-power model, fitted to a power-duration curve.
 *
 * ## The model
 *
 * Monod and Scherrer's hyperbolic relation (*Ergonomics* 8:329–338, 1965),
 * applied to cycling by Moritani et al. (*Ergonomics* 24:339–350, 1981):
 *
 *     P(t) = W′ / t + CP
 *
 * **CP** is the highest power that can be sustained without drawing on a
 * finite reserve — an asymptote, in watts. **W′** ("W prime") is that reserve:
 * a fixed quantity of work available above CP, in joules, which is why it is
 * {@link Joules} and not watts.
 *
 * The form is linear in `1 / t`, so the fit is an ordinary least-squares
 * regression of power on inverse duration: the intercept is CP and the slope
 * is W′. No iteration, no starting guess, no convergence criterion — which is
 * the whole reason this parameterisation is the one to use.
 *
 * ## Provenance
 *
 * The relation and the linearisation are from the published literature cited
 * above, and equations are not copyrightable (CLAUDE.md §6). GoldenCheetah
 * has mature CP-model code and is **GPL-2.0**: reading it to check a formula
 * is permitted, copying from it is not, and under §3 a GPL derivation inside
 * `packages/` is fatal rather than merely awkward. Nothing here derives from
 * it — the least-squares algebra below is the textbook closed form.
 *
 * ## Naming
 *
 * #76 flags that the common names for *its* metrics are reported to be
 * registered trademarks of a commercial platform. That concern does not reach
 * this file: "critical power", "W prime" and "power-duration curve" are terms
 * from the physiology literature above, decades older than any such platform
 * and used generically throughout it. The exported names are those terms.
 */

import { joules, watts, type Joules, type Seconds, type Watts } from '../quantities';
import { type PowerDurationCurve } from './power-duration';

/**
 * The duration band the fit is taken over, in seconds.
 *
 * The two-parameter model is a description of the aerobic/anaerobic boundary
 * and is **known to misfit outside a middle band**, in opposite directions:
 * below about two minutes the effort is dominated by the anaerobic reserve and
 * the hyperbola overestimates CP; beyond about twenty minutes aerobic decay
 * sets in, the true curve falls away from the asymptote, and CP is
 * underestimated. Fitting over everything available therefore produces a
 * confident number that is wrong in a direction determined by which efforts
 * the athlete happens to have ridden.
 *
 * Two to twenty minutes is the band the cited work uses and the one this fit
 * is restricted to.
 */
export const CRITICAL_POWER_MINIMUM_SECONDS = 120;
export const CRITICAL_POWER_MAXIMUM_SECONDS = 1200;

/**
 * The fewest distinct durations inside the band that can support a fit.
 *
 * Two points define a line exactly, with no residual and therefore no evidence
 * that the model describes anything — an R² of 1 that means nothing. Three is
 * the smallest number at which the fit can be wrong, and being able to be
 * wrong is the whole of what makes a goodness-of-fit informative.
 */
export const CRITICAL_POWER_MINIMUM_EFFORTS = 3;

/** Why no fit was reported. */
export type CriticalPowerRefusal =
  /**
   * Too few efforts inside the band. #75: *"a confident critical-power number
   * derived from three rides is worse than no number"* — so this is a refusal
   * rather than a fit with a caveat attached, because a caveat is not read.
   */
  | 'not-enough-efforts'
  /**
   * The fit ran and produced something unphysical — a non-positive CP or W′.
   * It happens when the efforts in the band are flat or non-monotonic, which
   * is what a library of steady endurance rides with no hard efforts looks
   * like. Reporting a negative reserve would be worse than reporting nothing.
   */
  | 'implausible-fit';

export interface CriticalPowerFit {
  readonly criticalPower: Watts;
  /** W′: the work available above {@link criticalPower}. */
  readonly workCapacity: Joules;
  /**
   * Coefficient of determination, 0 to 1.
   *
   * Reported alongside the parameters rather than used to gate them: what
   * counts as good enough is a judgement for the caller and the athlete, and
   * a threshold hidden in here would be this file deciding it silently. The
   * refusals above are for cases where there is no defensible number at all,
   * which is a different thing from a poor one.
   */
  readonly rSquared: number;
  /** How many efforts the fit rests on. Three is the fewest — see above. */
  readonly effortsUsed: number;
}

export type CriticalPowerResult =
  | { readonly fitted: true; readonly fit: CriticalPowerFit }
  | { readonly fitted: false; readonly refusal: CriticalPowerRefusal };

/**
 * Fit the model to a curve, or refuse.
 *
 * Refusing is a first-class outcome here rather than an exception: a library
 * that cannot support a fit is the *normal* state of a new athlete's library,
 * not an error in the program.
 */
export function fitCriticalPower(curve: PowerDurationCurve): CriticalPowerResult {
  const usable = curve.filter(
    (effort) =>
      effort.duration >= CRITICAL_POWER_MINIMUM_SECONDS &&
      effort.duration <= CRITICAL_POWER_MAXIMUM_SECONDS,
  );

  if (usable.length < CRITICAL_POWER_MINIMUM_EFFORTS) {
    return { fitted: false, refusal: 'not-enough-efforts' };
  }

  // Least squares on (x, y) = (1 / t, P). Slope is W′, intercept is CP.
  const points = usable.map((effort) => ({
    x: 1 / effort.duration,
    y: effort.power,
  }));
  const count = points.length;
  const meanX = points.reduce((total, point) => total + point.x, 0) / count;
  const meanY = points.reduce((total, point) => total + point.y, 0) / count;

  let covariance = 0;
  let varianceX = 0;
  for (const point of points) {
    const deviationX = point.x - meanX;
    covariance += deviationX * (point.y - meanY);
    varianceX += deviationX * deviationX;
  }

  if (varianceX === 0) {
    // Every effort at the same duration. No line through them is determined,
    // and the division below would be a division by zero rather than a fit.
    return { fitted: false, refusal: 'implausible-fit' };
  }

  const slope = covariance / varianceX;
  const intercept = meanY - slope * meanX;

  if (!(slope > 0) || !(intercept > 0)) {
    // A non-positive reserve or asymptote. `!(x > 0)` rather than `x <= 0` so
    // that a NaN — which no arithmetic above should produce, but which would
    // otherwise sail through a `<=` comparison — is caught here rather than
    // reaching a caller as a plausible-looking number.
    return { fitted: false, refusal: 'implausible-fit' };
  }

  // R² = 1 − (residual sum of squares) / (total sum of squares).
  let residualSum = 0;
  let totalSum = 0;
  for (const point of points) {
    const predicted = intercept + slope * point.x;
    residualSum += (point.y - predicted) ** 2;
    totalSum += (point.y - meanY) ** 2;
  }
  // A curve that is flat across the band has no variance to explain. The fit
  // is exact and vacuous; 1 is the conventional answer and is honest here
  // because the residuals really are zero.
  const rSquared = totalSum === 0 ? 1 : 1 - residualSum / totalSum;

  return {
    fitted: true,
    fit: {
      criticalPower: watts(intercept),
      workCapacity: joules(slope),
      rSquared,
      effortsUsed: count,
    },
  };
}

/**
 * The power the model predicts for a duration.
 *
 * Exposed so a caller can plot the fitted curve against the measured one,
 * which is the only way a reader can judge a goodness-of-fit number for
 * themselves.
 */
export function predictedPower(fit: CriticalPowerFit, duration: Seconds): Watts {
  return watts(fit.workCapacity / duration + fit.criticalPower);
}
