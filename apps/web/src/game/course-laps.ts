// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the line of a course is, as the ride's odometer crosses it — #1312.
 *
 * The game knows two things about a lap and nothing else: that the rider has
 * just completed the course, and what the course says about the stretch —
 * how long it is and how much it climbs. Everything a lap STATES (its time,
 * its power, its heart rate) is the recording's, worked out by
 * `recording/laps.ts` from the recorder's own clock and samples; these events
 * are how the game tells it where the line was (`trainer-port.ts`
 * §`GameTrainerPort.courseLine`).
 *
 * ## What counts as completing the course
 *
 * - **A loop**: every crossing of its one line — `gantry.ts`'s lap line, at
 *   route distance 0 — and another lap begins at once.
 * - **A point-to-point course**: reaching its end, once. The road does not
 *   wrap (`route/profile.ts` §`distanceOnRoute` clamps), so there is no second
 *   lap in the same game ride; a rider who rides the course again in the same
 *   recording starts a new game ride, and its lap is the recording's next.
 *
 * By the ODOMETER, never the wrapped position: `floor(distance / length)` is
 * `plan.ts` §`planLap`'s own arithmetic, so the lap the HUD says the rider is
 * on and the lap these events end cannot disagree.
 *
 * Pure: it reads no clock and keeps no state. `GameView` threads the count of
 * laps done from frame to frame.
 */

import { recordedAscent, type Metres, type RouteProfile } from '@onyourleft/domain';

import type { CourseLineEvent } from '../recording/laps';

/** How many times the rider has completed the course at this odometer reading. */
export function courseLapsDone(profile: RouteProfile, distance: number): number {
  const total = profile.totalDistance as number;
  if (!(total > 0) || !(distance > 0)) {
    return 0;
  }
  return profile.loop ? Math.floor(distance / total) : distance >= total ? 1 : 0;
}

/**
 * The event for this frame, when the rider has completed the course since
 * `done` was counted — or `undefined` on every other frame, which is nearly
 * all of them.
 *
 * ⚠️ **One event however far the odometer moved.** A frame cannot ride two
 * laps; an odometer that jumped that far was corrected, not ridden
 * (`simulation.ts` §`correctToward`), and two laps ended on one instant would
 * be a lap of no time at all.
 */
export function courseLineEvent(
  profile: RouteProfile,
  done: number,
  distance: number,
): CourseLineEvent | undefined {
  if (courseLapsDone(profile, distance) <= done) {
    return undefined;
  }
  return {
    kind: 'lap',
    distance: profile.totalDistance,
    ascent: profile.totalAscent,
    partial: false,
    again: profile.loop,
  };
}

/**
 * The event for a game ride that has ended: a part lap when the rider stopped
 * part-way round, and otherwise only that no lap is open any more.
 *
 * ⚠️ **A part lap carries how far it got and what THAT stretch climbs** — the
 * course's profile from the line to where the rider stopped, by the same run
 * rule a whole lap's climb uses (`route/profile.ts` §`recordedAscent`). A
 * point-to-point course that was finished has no part lap after it: the road
 * ended there.
 */
export function courseEndEvent(profile: RouteProfile, distance: number): CourseLineEvent {
  const total = profile.totalDistance as number;
  const done = courseLapsDone(profile, distance);
  const into = profile.loop ? distance - done * total : done === 0 ? distance : 0;
  if (!(into > 0)) {
    return { kind: 'ended' };
  }
  return {
    kind: 'lap',
    distance: into as Metres,
    ascent: recordedAscent(
      profile.elevations.slice(0, Math.floor(into / (profile.resolution as number)) + 1),
    ),
    partial: true,
    again: false,
  };
}
