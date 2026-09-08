// SPDX-License-Identifier: Apache-2.0

/**
 * The gradient setpoint driver — #90.
 *
 * Given a route profile and where the rider has got to, this decides **what
 * gradient the trainer should be told to simulate, and when to tell it**. It is
 * the half of #90 that is arithmetic rather than protocol: no op code, no byte,
 * no characteristic. `@onyourleft/sensors/protocol` writes what this produces,
 * and `apps/web` joins the two.
 *
 * ## Why it is here rather than beside the control point
 *
 * Two reasons, and the second is the one that decides it:
 *
 * 1. `route/profile.ts` already says #90 and #91 "must read the same numbers
 *    from the same code". The renderer's hill and the trainer's hill are the
 *    same hill, and a second gradient lookup beside the control point is a
 *    second source of truth for it.
 * 2. **This package may not name a platform API at all**, and that is exactly
 *    the constraint a setpoint driver should be written under. The rule that
 *    binds the recording engine binds this: *time arrives as a parameter*.
 *    There is no `Date`, no timer and no scheduler here, so what this decides
 *    is a pure function of the samples it was given — which is what makes "at
 *    a +6 % section the trainer is told +6 %" a test rather than a stopwatch
 *    exercise.
 *
 * ## What it decides, in order
 *
 * | Step | Why |
 * |---|---|
 * | Where the rider is **on the route** | `distanceOnRoute` wraps a loop and clamps a point-to-point, so a second lap re-rides the same hills rather than running off the end |
 * | The gradient there | `gradeAt`, interpolated between grid points — a held value steps by the whole difference between two samples every 10 m and a step in commanded resistance is felt |
 * | Clamp to {@link MAX_SIMULATED_GRADE_PERCENT} | **bounded before it is written, never after.** CLAUDE.md §6: a trainer applies physical resistance to a person who is pedalling |
 * | Rate limit to {@link SIMULATION_SETPOINT_INTERVAL_SECONDS} | one procedure per second is what a real FTMS host has been observed doing, and the control point runs one procedure at a time |
 * | Deadband of {@link SIMULATION_GRADE_DEADBAND_PERCENT} | a flat road should not spend a write a second saying nothing changed |
 *
 * ⚠️ **The clamp saturates rather than refusing.** The protocol client refuses
 * a gradient beyond its own ceiling, which is right for a caller that asked for
 * one explicitly — but this driver's input is a *route file*, and refusing a
 * sample would leave the trainer holding the gradient from before the spike,
 * with the rider unable to tell why the hill never arrived. The profile's
 * despike stage (`route/profile.ts`) makes the case nearly unreachable; this
 * is the belt to its braces, and it saturates so the ride continues.
 *
 * ⚠️ **A deadband means a long flat produces no writes at all**, which is
 * correct and worth stating: FTMS simulation parameters persist on the machine
 * until they are changed. Anything that invalidates that — a reconnection, a
 * reset, control taken and given back — is the caller's to signal, with
 * {@link SimulationDriver.restart}.
 */

import type { GradePercent, Metres, UnixSeconds } from '../quantities';
import { gradePercent, metres } from '../quantities';
import type { RouteProfile } from '../route/profile';
import { distanceOnRoute, gradeAt } from '../route/profile';

/**
 * The most often a gradient is written: **once a second**.
 *
 * `route/profile.ts` picked its 10 m grid partly against this number — a rider
 * at 25 km/h covers 7 m in a second, so a 1 Hz setpoint is about one grid point
 * per write and nothing finer is available to say. It is also the cadence a
 * real FTMS host has been observed writing at, and the Fitness Machine Control
 * Point runs one procedure at a time (FTMS §4.16.3), so a faster driver would
 * be queueing against itself rather than steering the trainer.
 */
export const SIMULATION_SETPOINT_INTERVAL_SECONDS = 1;

/**
 * How much the gradient must move before it is worth a write: **0.1 %**.
 *
 * Ten times the 0.01 % the wire can express, and far below anything a rider can
 * feel: at 75 kg, 0.1 % of gradient is about half a watt. Below it the write
 * would cost a control point procedure to command a resistance nobody could
 * distinguish from the one already applied.
 */
export const SIMULATION_GRADE_DEADBAND_PERCENT = 0.1;

/**
 * The steepest gradient this driver will ask for, in either direction: **40 %**.
 *
 * Deliberately the same number as the protocol client's own ceiling, and
 * deliberately not imported from it — `packages/domain` does not depend on
 * `packages/sensors`, and the two exist for different reasons. This one bounds
 * what a *course file* can ask for; that one bounds what any caller can write.
 * The steepest paved road in the world is about 35 %.
 */
export const MAX_SIMULATED_GRADE_PERCENT = 40;

/** Where the rider has got to, and when. */
export interface RiderPosition {
  /** The instant this position is for. Supplied, never read from a clock. */
  readonly at: UnixSeconds;
  /**
   * The rider's own odometer, in metres — **not** wrapped onto the route.
   *
   * A second lap of a 5 km loop is 5 000..10 000 here; the wrap happens inside,
   * so a caller never has to remember to do it. `route/profile.ts`
   * §`distanceOnRoute` states the rule this rests on.
   */
  readonly distance: Metres;
}

/** One gradient to write, and where it was read from. */
export interface SimulationSetpoint {
  /** The instant of the position this was derived from. */
  readonly at: UnixSeconds;
  /** Where on the route it was read — wrapped for a loop, clamped otherwise. */
  readonly distanceOnRoute: Metres;
  /** Signed, clamped, ready to write. A descent is negative. */
  readonly grade: GradePercent;
}

export interface SimulationDriverOptions {
  readonly profile: RouteProfile;
  /** Defaults to {@link SIMULATION_SETPOINT_INTERVAL_SECONDS}. */
  readonly minimumIntervalSeconds?: number | undefined;
  /** Defaults to {@link SIMULATION_GRADE_DEADBAND_PERCENT}. Zero writes every tick. */
  readonly gradeDeadbandPercent?: number | undefined;
  /** Defaults to {@link MAX_SIMULATED_GRADE_PERCENT}. */
  readonly maximumGradePercent?: number | undefined;
}

export interface SimulationDriver {
  /**
   * Offer a position. Returns the gradient to write, or nothing.
   *
   * Nothing means one of four things, all of them ordinary: too soon since the
   * last write, the gradient has not moved enough to be worth one, the
   * position's instant is not after the last one, or its instant is not a
   * finite number.
   */
  sample(position: RiderPosition): SimulationSetpoint | undefined;
  /** The last setpoint this driver produced, for a UI to render. */
  last(): SimulationSetpoint | undefined;
  /**
   * Forget what the trainer was told, so the next sample writes regardless.
   *
   * Called after anything that makes the machine's held parameters a guess: a
   * reconnection, a Reset, control lost and re-acquired. The alternative is a
   * rider on a 9 % wall whose trainer is still simulating the flat it was on
   * when the link dropped, with the driver's deadband holding the correction
   * back because *this* code thinks it already sent it.
   */
  restart(): void;
}

/** Saturate rather than refuse — see the header. */
function clampGrade(value: number, ceiling: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value > ceiling) return ceiling;
  if (value < -ceiling) return -ceiling;
  return value;
}

export function createSimulationDriver(options: SimulationDriverOptions): SimulationDriver {
  const { profile } = options;
  const minimumInterval = options.minimumIntervalSeconds ?? SIMULATION_SETPOINT_INTERVAL_SECONDS;
  const deadband = options.gradeDeadbandPercent ?? SIMULATION_GRADE_DEADBAND_PERCENT;
  const ceiling = options.maximumGradePercent ?? MAX_SIMULATED_GRADE_PERCENT;

  let written: SimulationSetpoint | undefined;

  return {
    sample(position: RiderPosition): SimulationSetpoint | undefined {
      if (!Number.isFinite(position.at)) {
        return undefined;
      }
      const previous = written;
      if (previous !== undefined) {
        // Not after the last write, so nothing has elapsed to justify one. A
        // clock that went backwards lands here too, and a driver that wrote on
        // it would then hold the *older* gradient as the newest thing it knows.
        if (position.at <= previous.at) {
          return undefined;
        }
        if (position.at - previous.at < minimumInterval) {
          return undefined;
        }
      }

      const on = distanceOnRoute(profile, position.distance);
      const grade = clampGrade(gradeAt(profile, on), ceiling);

      if (previous !== undefined && Math.abs(grade - previous.grade) < deadband) {
        return undefined;
      }

      const setpoint: SimulationSetpoint = {
        at: position.at,
        distanceOnRoute: metres(on),
        grade: gradePercent(grade),
      };
      written = setpoint;
      return setpoint;
    },

    last: () => written,

    restart(): void {
      written = undefined;
    },
  };
}
