// SPDX-License-Identifier: Apache-2.0

/**
 * A heart rate that responds to load (#1238), so a heart-rate hold can be
 * driven in a closed loop with nobody on the bike.
 *
 * ## The model
 *
 * First order: `dHR/dt = (HR_rest + k·P + drift − HR) / τ`, integrated exactly
 * for each step of constant power — `HR ← target + (HR − target)·e^(−dt/τ)` —
 * so the answer does not depend on how finely a caller slices time.
 *
 * ## ⚠️ The defaults are TEST defaults, not a claim about any rider
 *
 * `k = 0.392 bpm/W` and `τ = 65.6 s` are Hunt & Hurni (2019), *"k = 0.392
 * bpm/W"* and *"τ = 65.6 s"*, averaged over 25 healthy men aged 22–36 in a
 * laboratory (PMC6828638). A real rider's gain and lag differ, and change
 * through a ride. Nothing outside a test may read these numbers as a
 * prediction of somebody's heart. The resting rate is this file's own choice.
 *
 * ## Drift
 *
 * Cardiac drift — heart rate rising at constant power over a long effort — is
 * modelled as a term that grows at `bpmPerHour` and is added to the target,
 * so the reported rate follows it through the same lag as anything else.
 *
 * Platform-free: no clock, no timer, no randomness. Time arrives as a
 * parameter, as everywhere in this directory.
 */

import { seconds, type Seconds, type Watts } from '@onyourleft/domain';

/** Hunt & Hurni (2019), the mean gain over 25 participants. A test default. */
export const HUNT_HURNI_BPM_PER_WATT = 0.392;

/** Hunt & Hurni (2019), the mean time constant over 25 participants. A test default. */
export const HUNT_HURNI_TIME_CONSTANT: Seconds = seconds(65.6);

/** This file's choice: a resting rate for a test rider, not a measurement. */
export const DEFAULT_RESTING_HEART_RATE = 60;

const SECONDS_PER_HOUR = 3600;

export interface HeartRateResponseOptions {
  /** Beats per minute at zero power. Defaults to {@link DEFAULT_RESTING_HEART_RATE}. */
  readonly restingHeartRate?: number;
  /** The steady-state gain, bpm per watt. Defaults to {@link HUNT_HURNI_BPM_PER_WATT}. */
  readonly bpmPerWatt?: number;
  /** The time constant. Defaults to {@link HUNT_HURNI_TIME_CONSTANT}. */
  readonly timeConstant?: Seconds;
  /**
   * The power the rider has been holding before the first step, so the model
   * starts at its steady state rather than at rest. Defaults to zero.
   */
  readonly settledAt?: Watts;
}

export interface HeartRateResponse {
  /** The modelled rate, in beats per minute, unrounded. */
  readonly heartRate: number;
  /** The rate this power would settle at, drift included. */
  steadyStateAt(power: Watts): number;
  /** Ride `duration` at a constant `power`. */
  advance(power: Watts, duration: Seconds): void;
  /** Start drifting at `bpmPerHour` from now; zero stops it, a negative falls. */
  drift(bpmPerHour: number): void;
}

/**
 * @throws {RangeError} for a time constant that is not positive, or a gain or
 * resting rate that is not a finite number.
 */
export function createHeartRateResponse(options: HeartRateResponseOptions = {}): HeartRateResponse {
  const resting = options.restingHeartRate ?? DEFAULT_RESTING_HEART_RATE;
  const gain = options.bpmPerWatt ?? HUNT_HURNI_BPM_PER_WATT;
  const tau = options.timeConstant ?? HUNT_HURNI_TIME_CONSTANT;
  if (!Number.isFinite(resting) || !Number.isFinite(gain)) {
    throw new RangeError('a heart rate response needs a finite resting rate and gain');
  }
  if (!(tau > 0) || !Number.isFinite(tau)) {
    throw new RangeError(`a heart rate time constant must be positive, received ${String(tau)}`);
  }

  let driftRate = 0;
  let driftOffset = 0;
  const steadyStateAt = (power: Watts): number => resting + gain * power + driftOffset;
  let heartRate = steadyStateAt(options.settledAt ?? (0 as Watts));

  return {
    get heartRate() {
      return heartRate;
    },
    steadyStateAt,
    advance(power, duration) {
      if (!(duration >= 0) || !Number.isFinite(duration)) {
        throw new RangeError(`a step must be a finite, non-negative duration`);
      }
      // The drift moves the target during the step; taking it at the step's
      // end is exact to first order and the steps here are a second long
      // against an hour's drift.
      driftOffset += (driftRate * duration) / SECONDS_PER_HOUR;
      const target = steadyStateAt(power);
      heartRate = target + (heartRate - target) * Math.exp(-(duration as number) / tau);
    },
    drift(bpmPerHour) {
      if (!Number.isFinite(bpmPerHour)) {
        throw new RangeError('a drift must be a finite number of beats per minute per hour');
      }
      driftRate = bpmPerHour;
    },
  };
}
