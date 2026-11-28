// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Test support for #3304: a scripted rotation, a frame at a time, for the
 * drawing's tests and the browser harness's group ride. Not a harness that
 * scores a ride: that is #3309's.
 *
 * ## The scripted rider
 *
 * A rider on rails. Their odometer and speed are set by the script, a
 * simulation step at a time, and handed to the session exactly as `GameView`
 * hands the simulation's ({@link stepGroupRideSession}):
 *
 * - **in the line**, they hold the wheel ahead {@link SCRIPT_WHEEL_GAP_METRES}
 *   back, at its speed plus a damped correction;
 * - **on the front**, they ride the group's speed for
 *   {@link SCRIPT_PULL_SECONDS} and then fade, gently enough that the wheel
 *   behind them is held, so the line comes round without a press
 *   (`rotation.ts` §"The rider's pull"; the press is #3307's);
 * - **aside**, they ease by `rotation.ts` §`ROTATION_EASE_SHARE` of the
 *   front's speed, as a bot does, and once behind the last wheel they take
 *   it, {@link LineScript.latchGapMetres} back.
 *
 * Every bot is the rules' own, on the real physics. Nothing here is drawn:
 * the tests read the drawing through `ride-group.ts` §`groupRideDrawing`.
 */

import { ROTATION_EASE_SHARE, type RouteProfile } from '@onyourleft/domain';

import { northRoute } from '../route-fixtures-testing';
import { SIMULATION_STEP_SECONDS } from '../simulation';
import { speedFrom } from '../../units/format';

import {
  GROUP_RIDE_RIDER_ID,
  startGroupRideSession,
  stepGroupRideSession,
  type GroupRideSession,
} from './ride-group';

/** The scripted rides' road: 20 km of flat. */
export const SCRIPT_FLAT: RouteProfile = northRoute(20_000, () => 0);

/** The scripted rides' target average, m/s: 30 km/h. */
export const SCRIPT_TARGET_MPS = speedFrom(30, 'metric');

/** How far behind a wheel the scripted rider holds, metres. */
export const SCRIPT_WHEEL_GAP_METRES = 0.65;

/** How long the scripted rider holds the group's speed on the front before they fade, seconds. */
export const SCRIPT_PULL_SECONDS = 12;

/** How far under the group's speed the scripted rider fades, m/s: 2.2 km/h, past the rules' margin. */
const SCRIPT_FADE_MPS = speedFrom(2.2, 'metric');

/** How fast they fade, m/s²: slower than a sheltered bot coasts down, so none rides into them. */
const SCRIPT_FADE_MPS2 = 0.05;

/** One simulation step of a scripted ride. */
export interface LineFrame {
  /** Ride time as the step ended, seconds. */
  readonly at: number;
  readonly session: GroupRideSession;
}

/** A scripted ride. */
export interface LineScript {
  /** How many bots; 5 unless named, a line of six. */
  readonly bots?: number;
  readonly seconds: number;
  /** The line's seed; 7 unless named. */
  readonly seed?: number;
  /**
   * How far behind the last wheel the rider takes it after their own pull,
   * metres; {@link SCRIPT_WHEEL_GAP_METRES} unless named. Nearer than the
   * drawing's clear distance, they are back in the line by the rules before
   * the drawn line has room for them.
   */
  readonly latchGapMetres?: number;
}

/** The scripted rider's speed for the next step, m/s. */
function scriptedSpeed(
  session: GroupRideSession,
  frontSince: number | null,
  at: number,
  latchGap: number,
): number {
  const { rotation, bots } = session.state;
  const where = (id: string): { readonly distanceM: number; readonly speedMps: number } =>
    id === GROUP_RIDE_RIDER_ID ? session.rider : (bots[id] ?? session.rider);
  const onWheel = (id: string, back = SCRIPT_WHEEL_GAP_METRES): number => {
    const wheel = where(id);
    const gap = wheel.distanceM - session.rider.distanceM;
    return wheel.speedMps + Math.max(-1, Math.min(1, gap - back));
  };
  const last = rotation.order[rotation.order.length - 1] as string;
  if (rotation.aside === GROUP_RIDE_RIDER_ID) {
    const front = where(rotation.order[0] as string);
    const behind = where(last).distanceM - session.rider.distanceM;
    return behind < latchGap ? front.speedMps * (1 - ROTATION_EASE_SHARE) : onWheel(last, latchGap);
  }
  const seat = rotation.order.indexOf(GROUP_RIDE_RIDER_ID);
  if (seat > 0) return onWheel(rotation.order[seat - 1] as string);
  const fading = frontSince === null ? 0 : Math.max(0, at - frontSince - SCRIPT_PULL_SECONDS);
  return session.groupSpeedMps - Math.min(SCRIPT_FADE_MPS, SCRIPT_FADE_MPS2 * fading);
}

/**
 * A scripted ride of a line, every simulation step of it: the line at the
 * press with the rider on the last wheel at the group's speed, then one
 * frame a step.
 */
export function rideLine(script: LineScript): readonly LineFrame[] {
  const start = startGroupRideSession({
    choice: { targetSpeed: SCRIPT_TARGET_MPS, bots: script.bots ?? 5 },
    profile: SCRIPT_FLAT,
    riderDistance: 100,
    riderSpeed: SCRIPT_TARGET_MPS,
    seed: script.seed ?? 7,
  });
  if (start === undefined) throw new Error('the scripted group did not start');
  const frames: LineFrame[] = [{ at: 0, session: start }];
  let session = start;
  let frontSince: number | null = null;
  const steps = Math.round(script.seconds / SIMULATION_STEP_SECONDS);
  for (let step = 1; step <= steps; step += 1) {
    const at = step * SIMULATION_STEP_SECONDS;
    const onFront = session.state.rotation.order[0] === GROUP_RIDE_RIDER_ID;
    frontSince = onFront ? (frontSince ?? at) : null;
    const speedMps = scriptedSpeed(
      session,
      frontSince,
      at,
      script.latchGapMetres ?? SCRIPT_WHEEL_GAP_METRES,
    );
    session = stepGroupRideSession(session, {
      ticks: 1,
      rider: {
        distanceM: session.rider.distanceM + speedMps * SIMULATION_STEP_SECONDS,
        speedMps,
      },
      riderStopped: false,
    });
    frames.push({ at, session });
  }
  return frames;
}
