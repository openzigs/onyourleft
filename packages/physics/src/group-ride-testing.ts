// SPDX-License-Identifier: Apache-2.0

/**
 * Test support for #3300: a whole group ride on the real physics, with a
 * scripted rider. Imported by `group-ride.test.ts` only; the harness with
 * scripted riders that scores a ride is #3309's.
 *
 * ## The scripted rider
 *
 * Simulated through {@link groupRidePhysics} at their own mass, at the draft
 * factor the group's tick hands back for them, exactly as the game's
 * simulation will ride a real rider (#3303). What is scripted is their power:
 *
 * - holding the wheel, the default: the bots' own rule (`botWheelWatts` and
 *   the wheel's surplus) on the wheel ahead of them in the line; on the
 *   front, what holds the group's speed; and they press pull off
 *   {@link RiderScript.pressAfterSeconds} into a pull.
 * - `watts`: a fixed power, whatever the group does.
 *
 * ⚠️ **The script has a brake, and a rider on a trainer has none.** Where
 * the wheel rule asks the scripted rider for less than nothing (down the
 * fixture's descent, in the shelter of the line), they pedal nothing and are
 * slowed by the missing watts, so that the bots are judged behind a wheel
 * that is held. What a real rider's ride does there is #3303's and #3309's
 * to find out.
 */

import {
  BOT_TACTIC_WHEEL_GAP_METRES,
  botWheelWatts,
  gradeAt,
  metresPerSecond,
  planGroupRide,
  ROTATION_EASE_SHARE,
  startGroupRide,
  stepGroupRide,
  type BotCapacity,
  type GroupBot,
  type GroupPlan,
  type GroupRideState,
  type GroupRideTick,
  type LineMember,
  type LinePhase,
  type MemberView,
  type RiderRole,
  type RouteProfile,
} from '@onyourleft/domain';

import { groupRidePhysics } from './group-ride';

/** The rider's id in every scripted line. */
export const YOU = 'you';

/** The scripted rider's mass with their bicycle, kilograms: not a bot's. */
export const RIDER_MASS_KILOGRAMS = 83;

/** The scripted rider's critical power, watts: what their wheel rule's correction is a share of. */
const RIDER_CP_WATTS = 300;

/** The most the scripted rider ever rides, watts. */
const RIDER_MOST_WATTS = 600;

/** The ride's tick, seconds: four to a decision window. */
export const TICK_SECONDS = 0.25;

/** A bot of critical power `cp` watts with 20 kJ of W′ unless named. */
export function bot(id: string, cp = 420, wPrimeJoules = 20_000): LineMember {
  const capacity: BotCapacity = { cpWatts: cp, wPrimeJoules, peakWatts: 2 * cp, floorWatts: 0 };
  return { id, kind: 'bot', capacity };
}

export const RIDER: LineMember = { id: YOU, kind: 'rider' };

/** Five bots and the rider third: the default line of six. */
export const SIX: readonly LineMember[] = [
  bot('b1'),
  bot('b2'),
  RIDER,
  bot('b3'),
  bot('b4'),
  bot('b5'),
];

/** How the scripted rider rides. */
export interface RiderScript {
  /** A fixed power, watts, in place of holding the wheel. */
  readonly watts?: number;
  /** How long into their own pull they press pull off, seconds; 20 unless named. */
  readonly pressAfterSeconds?: number;
  /** Whether they sit in. */
  readonly sittingIn?: boolean;
  /** From `fromSeconds` to `toSeconds` they ride `kmh` slower than they were riding at `fromSeconds`. */
  readonly slow?: {
    readonly fromSeconds: number;
    readonly toSeconds: number;
    readonly kmh: number;
  };
  /** Where they start, in place of level with their seat at the route's start at the group's speed. */
  readonly start?: MemberView;
}

/** A ride for {@link rideGroup}. */
export interface GroupScript {
  readonly course: RouteProfile;
  /** The target average, km/h. */
  readonly targetKmh: number;
  readonly line?: readonly LineMember[];
  readonly seed?: number;
  /** How long to ride, seconds; absent, to the end of the course. */
  readonly seconds?: number;
  readonly rider?: RiderScript;
  /** The bend radius the group is told of, metres. */
  readonly bendRadiusM?: number;
}

/** One tick of a scripted ride: the line as the tick began, and what the tick decided on it. */
export interface Frame {
  readonly atMs: number;
  readonly phase: LinePhase;
  /** The line, front first, without the member aside. */
  readonly order: readonly string[];
  readonly aside: string | null;
  readonly roles: Readonly<Record<string, RiderRole>>;
  /** Every member's draft factor from the tick's one call. */
  readonly draft: Readonly<Record<string, number>>;
  readonly groupSpeedMps: number;
  /** Every member's odometer and speed as the tick began, the rider's included. */
  readonly at: Readonly<Record<string, MemberView>>;
  /** Every bot after the tick: what it rode and at what drag. */
  readonly rode: Readonly<Record<string, GroupBot>>;
  /** What the rider rode this tick, watts. */
  readonly riderWatts: number;
  /** The whole tick. */
  readonly tick: GroupRideTick;
}

/** A scripted ride's answer. */
export interface GroupRide {
  readonly plan: GroupPlan;
  readonly frames: readonly Frame[];
  /** When the front of the line reached the end of the course, seconds, or `null` if it did not. */
  readonly finishSeconds: number | null;
  readonly state: GroupRideState;
}

/** The plan for `targetKmh` on `course`, on the group's own physics. */
export function planFor(course: RouteProfile, targetKmh: number): GroupPlan {
  const plan = planGroupRide({
    course,
    targetSpeed: metresPerSecond(targetKmh / 3.6),
    frontSpeed: groupRidePhysics().frontSpeed,
  });
  if ('error' in plan) throw plan.error;
  return plan;
}

/** A scripted group ride on the real physics. */
export function rideGroup(script: GroupScript): GroupRide {
  const { course } = script;
  const physics = groupRidePhysics();
  const own = groupRidePhysics(RIDER_MASS_KILOGRAMS);
  const plan = planFor(course, script.targetKmh);
  const road = { course, plan, physics };
  const line = script.line ?? SIX;
  const riding = script.rider ?? {};
  const total = course.totalDistance as number;

  // The bots form up at the route's start at the group's speed; so does the
  // rider, unless the script starts them somewhere else.
  const seat: MemberView = { distanceM: 0, speedMps: plan.speedNowAt(0) };
  let rider: MemberView = riding.start ?? seat;
  let state = startGroupRide({ line, seed: script.seed ?? 7, atMs: 0, rider: seat });
  let slowTo: number | null = null;
  const frames: Frame[] = [];
  let finishSeconds: number | null = null;

  for (let step = 0; ; step += 1) {
    const seconds = step * TICK_SECONDS;
    if (script.seconds !== undefined && seconds >= script.seconds) break;
    const pull = state.rotation.pull;
    const press =
      state.rotation.phase === 'steady' &&
      pull?.by === YOU &&
      state.atMs - pull.fromMs >= (riding.pressAfterSeconds ?? 20) * 1_000;
    // Frozen: a step that wrote to the rider would throw here.
    Object.freeze(rider);
    const tick = stepGroupRide(
      state,
      {
        elapsedSeconds: TICK_SECONDS,
        rider,
        riderSignal: press,
        riderSittingIn: riding.sittingIn ?? false,
        ...(script.bendRadiusM === undefined ? {} : { bendRadiusM: script.bendRadiusM }),
      },
      road,
    );
    const at: Record<string, MemberView> = { [YOU]: rider };
    for (const [id, each] of Object.entries(state.bots)) {
      at[id] = { distanceM: each.distanceM, speedMps: each.speedMps };
    }

    // The rider, through the same physics at their own mass and the tick's draft factor.
    const { order } = tick.state.rotation;
    const k = tick.draft[YOU] as number;
    const grade: number = gradeAt(course, rider.distanceM);
    const held = (speedMps: number): number =>
      botWheelWatts({
        gapMetres: BOT_TACTIC_WHEEL_GAP_METRES,
        closingMetresPerSecond: rider.speedMps - speedMps,
        holdWatts: own.holdWatts(speedMps, grade, k),
        cpWatts: RIDER_CP_WATTS,
      });
    const onWheel = (id: string): number => {
      const wheel = at[id] as MemberView;
      const before = state.bots[id] as GroupBot;
      const surplus =
        before.powerWatts === null
          ? 0
          : ((before.powerWatts -
              physics.holdWatts(
                wheel.speedMps,
                gradeAt(course, wheel.distanceM),
                before.dragFactor,
              )) *
              RIDER_MASS_KILOGRAMS) /
            physics.massKilograms;
      return botWheelWatts({
        gapMetres: wheel.distanceM - rider.distanceM,
        closingMetresPerSecond: rider.speedMps - wheel.speedMps,
        holdWatts: own.holdWatts(wheel.speedMps, grade, k) + surplus,
        cpWatts: RIDER_CP_WATTS,
      });
    };
    const seat = order.indexOf(YOU);
    const slow = riding.slow;
    let wanted: number;
    let brakes = true;
    if (riding.watts !== undefined) {
      wanted = riding.watts;
    } else if (slow !== undefined && seconds >= slow.fromSeconds && seconds < slow.toSeconds) {
      slowTo ??= rider.speedMps - slow.kmh / 3.6;
      wanted = held(slowTo);
    } else if (seat === 0) {
      wanted = own.holdWatts(tick.groupSpeedMps, grade, k);
      brakes = false;
    } else if (seat > 0) {
      wanted = onWheel(order[seat - 1] as string);
    } else {
      const last = onWheel(order[order.length - 1] as string);
      wanted =
        tick.rotation.roles[YOU] === 'latching'
          ? last
          : Math.max(last, held(tick.groupSpeedMps * (1 - ROTATION_EASE_SHARE)));
    }
    const riderWatts = Math.min(RIDER_MOST_WATTS, Math.max(0, wanted));

    frames.push({
      atMs: state.atMs,
      phase: tick.state.rotation.phase,
      order,
      aside: tick.state.rotation.aside,
      roles: tick.rotation.roles,
      draft: tick.draft,
      groupSpeedMps: tick.groupSpeedMps,
      at,
      rode: tick.state.bots,
      riderWatts,
      tick,
    });

    const rolled = own.advance(rider, riderWatts, grade, TICK_SECONDS, k);
    // The script's brake: the watts under zero, taken off as speed.
    const braked =
      brakes && wanted < 0 && rider.speedMps > 0
        ? Math.max(
            0,
            rolled.speedMps + (wanted / (RIDER_MASS_KILOGRAMS * rider.speedMps)) * TICK_SECONDS,
          )
        : rolled.speedMps;
    rider = { distanceM: rolled.distanceM, speedMps: braked };
    state = tick.state;
    const front = order[0] as string;
    const frontM = front === YOU ? rider.distanceM : (state.bots[front] as GroupBot).distanceM;
    if (script.seconds === undefined && frontM >= total) {
      finishSeconds = seconds + TICK_SECONDS;
      break;
    }
  }
  return { plan, frames, finishSeconds, state };
}

/** The frames at a decision window: one a second. */
export function windowsOf(frames: readonly Frame[]): readonly Frame[] {
  return frames.filter((frame) => frame.atMs % 1_000 === 0);
}

/** The gap from `id` to the member ahead of it in the line, metres, or `null` on the front or aside. */
export function gapAhead(frame: Frame, id: string): number | null {
  const seat = frame.order.indexOf(id);
  if (seat < 1) return null;
  return (
    (frame.at[frame.order[seat - 1] as string] as MemberView).distanceM -
    (frame.at[id] as MemberView).distanceM
  );
}
