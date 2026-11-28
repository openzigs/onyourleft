// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3309's harness: **the scripted riders**. What each one pedals, tick by
 * tick, given the group as the tick begins. Nothing here moves a rider: the
 * power goes through the one physics in `ride.ts`, as a real rider's legs do.
 *
 * | Rider | What they do |
 * |---|---|
 * | `steady` | holds the wheel, holds the group's speed on the front, presses pull off when the pull's time is up |
 * | `surger` | as `steady`, but lifts on the front: rides {@link SURGE_KMH} over the group's speed |
 * | `gap-opener` | as `steady`, but drifts off the wheel: out to {@link DRIFT_METRES} behind it and back, again and again |
 * | `weak` | {@link WEAK_SHARE} of the group's power, whatever the group does |
 * | `absent` | as `steady`, but stops pedalling for {@link ABSENT_FROM_SECONDS}–{@link ABSENT_TO_SECONDS} |
 * | `never-presses` | as `steady`, but never presses pull off: at the pull's end they fade on the front by {@link FADE_KMH} |
 * | `fixed-power` | {@link FIXED_WATTS} whatever the group does: the owner's note (3) on #3309 |
 *
 * ⚠️ **A wheel-holder has a brake, and a rider on a trainer has none.** Where
 * the wheel rule asks for less than nothing (in the shelter of the line down
 * a descent) they pedal nothing and are slowed by the missing watts, as
 * `@onyourleft/physics` §`group-ride-testing.ts` scripts it, so the group is
 * judged behind a wheel that is held. On the front there is no wheel to ride
 * into, and the brake is off: a rider coming off a descent there coasts down
 * to the group's speed, as one on a trainer does. `weak` and `fixed-power`
 * have none anywhere: what a rider at a fixed effort does to the line is
 * theirs to show.
 *
 * The six of the issue are the first six; `fixed-power` is the seventh, for
 * the owner's note, and has no pass mark (`marks.ts`).
 */

import {
  BOT_TACTIC_WHEEL_GAP_METRES,
  botWheelWatts,
  gradeAt,
  ROTATION_EASE_SHARE,
  type GroupBot,
  type GroupRideState,
  type GroupRoad,
  type MemberView,
  type RiderRole,
} from '@onyourleft/domain';
import type { GroupRidePhysics } from '@onyourleft/physics';

import { GROUP_RIDE_RIDER_ID } from '../../src/game/group-ride/ride-group';

/** The scripted riders, in the score table's order. */
export const SCRIPTED_RIDERS = [
  'steady',
  'surger',
  'gap-opener',
  'weak',
  'absent',
  'never-presses',
  'fixed-power',
] as const;

/** One of {@link SCRIPTED_RIDERS}. */
export type ScriptedRider = (typeof SCRIPTED_RIDERS)[number];

/** The scripted rider's mass with their bicycle, kilograms: not a bot's 75. */
export const RIDER_MASS_KILOGRAMS = 83;

/** The scripted rider's critical power, watts: what their wheel rule's correction is a share of. */
export const RIDER_CP_WATTS = 300;

/** The most any scripted rider rides, watts. */
export const RIDER_MOST_WATTS = 600;

/** How far over the group's speed the `surger` rides on the front, km/h: over the cue's 2 km/h band. */
export const SURGE_KMH = 4;

/** How far behind the wheel the `gap-opener` drifts, metres: inside the 5 m band, over the cue's 2 m. */
export const DRIFT_METRES = 4;

/** How long one of the `gap-opener`'s drifts out and back takes, seconds. */
export const DRIFT_CYCLE_SECONDS = 90;

/** The `weak` rider's share of the group's power: the issue's **60 %**. */
export const WEAK_SHARE = 0.6;

/**
 * When the `absent` rider stops pedalling, seconds into the ride: about
 * 500 m in, on the level kilometre every course starts with, so the stop
 * scores the wait and not the road.
 *
 * ⚠️ A stop on a climb is the case to ride next: one at 180 s, on the rolling
 * course's first climb, left the group at a crawl for most of half an hour
 * after the rider started again (#3405), and one just before a crest let the
 * waiting bots roll on down the descent (#3406). Each issue moves this stop,
 * or adds a rider, once it is fixed; until then it would slow the gate or fail it.
 */
export const ABSENT_FROM_SECONDS = 60;

/** When the `absent` rider starts again: **three minutes** later. */
export const ABSENT_TO_SECONDS = 240;

/** How far under the group's speed the `never-presses` rider fades once their pull's time is up, km/h. */
export const FADE_KMH = 3;

/** The `fixed-power` rider's watts: the owner's simulated rider of note (3). */
export const FIXED_WATTS = 120;

/**
 * The group as the last tick left it: what `ride-group.ts` keeps of each tick
 * (`GroupRideSession`'s `state`, `road`, `role`, `riderDraft` and
 * `groupSpeedMps`), and all a scripted rider reads of it.
 */
export interface GroupNow {
  readonly state: GroupRideState;
  readonly road: GroupRoad;
  /** The rider's role, their standing included. */
  readonly role: RiderRole;
  /** The rider's draft multiplier from the last tick. */
  readonly riderDraft: number;
  /** The group's speed now, m/s. */
  readonly groupSpeedMps: number;
}

/** What a scripted rider reads as a tick begins. */
export interface RiderMoment {
  /** Ride time, seconds. */
  readonly seconds: number;
  /** The group as the tick begins. */
  readonly group: GroupNow;
  /** The rider as the tick begins. */
  readonly rider: MemberView;
  /** The grade under the rider, percent. */
  readonly grade: number;
  /** The physics at the rider's own mass. */
  readonly own: GroupRidePhysics;
}

/** What a scripted rider does in a tick. */
export interface RiderAction {
  /** What they pedal, watts: under zero asks for a brake (above). */
  readonly wanted: number;
  /** Whether a `wanted` under zero is braked off; otherwise it is pedalling nothing. */
  readonly brakes: boolean;
  /** Whether they have stopped: what `GameView` says while the recording is paused. */
  readonly stopped: boolean;
  /** Whether they press pull off in this tick. */
  readonly press: boolean;
}

/** The grade at `odometer` on the course, percent; held to the course's ends. */
function gradeUnder(course: GroupRoad['course'], odometer: number): number {
  return gradeAt(course, Math.min(Math.max(0, odometer), course.totalDistance));
}

/** The wheel rule: what holds the rider `furtherM` behind the wheel `id`'s usual gap. */
function onWheel(moment: RiderMoment, id: string, furtherM: number): number {
  const { group, rider, grade, own } = moment;
  const { course, physics } = group.road;
  const wheel = group.state.bots[id] as GroupBot;
  // The wheel's own surplus over holding its speed, at the rider's mass: so
  // the rider goes with a wheel that is speeding up, as a bot behind it does.
  const surplus =
    wheel.powerWatts === null
      ? 0
      : ((wheel.powerWatts -
          physics.holdWatts(
            wheel.speedMps,
            gradeUnder(course, wheel.distanceM),
            wheel.dragFactor,
          )) *
          RIDER_MASS_KILOGRAMS) /
        physics.massKilograms;
  return botWheelWatts({
    gapMetres: wheel.distanceM - rider.distanceM - furtherM,
    closingMetresPerSecond: rider.speedMps - wheel.speedMps,
    holdWatts: own.holdWatts(wheel.speedMps, grade, group.riderDraft) + surplus,
    cpWatts: RIDER_CP_WATTS,
  });
}

/** What brings the rider to `speedMps` and holds them there: the wheel rule with no wheel. */
function heldAt(moment: RiderMoment, speedMps: number): number {
  const { rider, grade, own, group } = moment;
  return botWheelWatts({
    gapMetres: BOT_TACTIC_WHEEL_GAP_METRES,
    closingMetresPerSecond: rider.speedMps - speedMps,
    holdWatts: own.holdWatts(speedMps, grade, group.riderDraft),
    cpWatts: RIDER_CP_WATTS,
  });
}

/** Whether the rider's own pull's time is up. */
function pullIsUp(group: GroupNow): boolean {
  const { pull } = group.state.rotation;
  return (
    group.role === 'on-front' &&
    pull !== null &&
    pull.by === GROUP_RIDE_RIDER_ID &&
    group.state.atMs >= pull.endsAtMs
  );
}

/** What a wheel-holder pedals, and whether they brake. */
type Pedalled = Pick<RiderAction, 'wanted' | 'brakes'>;

/**
 * A wheel-holder: on the front, the group's speed now and `frontKmh` over it,
 * with no brake (there is no wheel to ride into); on the wheel ahead,
 * `furtherM` further back than its gap; aside, easing to let the line pass
 * and then onto its last wheel.
 */
function wheelHolder(moment: RiderMoment, frontKmh: number, furtherM: number): Pedalled {
  const { group } = moment;
  const { order } = group.state.rotation;
  const seat = order.indexOf(GROUP_RIDE_RIDER_ID);
  if (seat === 0) {
    return { wanted: heldAt(moment, group.groupSpeedMps + frontKmh / 3.6), brakes: false };
  }
  // Behind the sweep, which comes back to sit a wheel gap ahead, they take its wheel.
  const further = (id: string): number => (id === group.state.noDrop.sweep ? 0 : furtherM);
  if (seat > 0) {
    const wheel = order[seat - 1] as string;
    return { wanted: onWheel(moment, wheel, further(wheel)), brakes: true };
  }
  const last = order[order.length - 1] as string;
  const latch = onWheel(moment, last, further(last));
  return {
    wanted:
      group.role === 'latching'
        ? latch
        : Math.max(latch, heldAt(moment, group.groupSpeedMps * (1 - ROTATION_EASE_SHARE))),
    brakes: true,
  };
}

/** How far further back than the wheel's gap the `gap-opener` is at `seconds`: out and back. */
export function driftAt(seconds: number): number {
  const phase = (seconds % DRIFT_CYCLE_SECONDS) / DRIFT_CYCLE_SECONDS;
  const out = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  return Math.max(0, out * DRIFT_METRES - BOT_TACTIC_WHEEL_GAP_METRES);
}

/** What `who` does in the tick that `moment` begins. */
export function riderAction(who: ScriptedRider, moment: RiderMoment): RiderAction {
  const { group, seconds } = moment;
  const riding = { stopped: false, press: false };
  switch (who) {
    case 'steady':
      return { ...riding, ...wheelHolder(moment, 0, 0), press: pullIsUp(group) };
    case 'surger':
      return { ...riding, ...wheelHolder(moment, SURGE_KMH, 0), press: pullIsUp(group) };
    case 'gap-opener':
      return { ...riding, ...wheelHolder(moment, 0, driftAt(seconds)), press: pullIsUp(group) };
    case 'weak':
      return {
        ...riding,
        brakes: false,
        wanted: WEAK_SHARE * group.road.plan.powerAt(moment.rider.distanceM, group.state.ledger),
      };
    case 'absent':
      return seconds >= ABSENT_FROM_SECONDS && seconds < ABSENT_TO_SECONDS
        ? { wanted: 0, brakes: false, stopped: true, press: false }
        : { ...riding, ...wheelHolder(moment, 0, 0), press: pullIsUp(group) };
    case 'never-presses':
      return { ...riding, ...wheelHolder(moment, pullIsUp(group) ? -FADE_KMH : 0, 0) };
    case 'fixed-power':
      return { ...riding, brakes: false, wanted: FIXED_WATTS };
    default:
      return who satisfies never;
  }
}
