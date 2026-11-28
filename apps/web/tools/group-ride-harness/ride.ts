// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3309's harness: **one scripted rider's group ride, ridden** on the rules
 * the game rides, set up as the game sets them up:
 *
 * - the plan from the chooser's own `groupRidePlan` (`choice.ts`), and the
 *   line from the session's own `groupLine` (`ride-group.ts`): the same bots,
 *   the same strengths for a seed, the rider on the last wheel;
 * - each tick, `@onyourleft/domain` §`stepGroupRide` with the rider's
 *   odometer and speed, whether they pressed pull off, and whether they have
 *   stopped; then §`stepCues` on that tick's rotation and view with the
 *   rider's power: the two calls `stepGroupRideSession` makes;
 * - the rider ridden on `@onyourleft/physics` §`groupRidePhysics` at their
 *   own mass and at the draft the tick handed back for them, as
 *   `GameSimulation.draftWith` applies it.
 *
 * ⚠️ **A tick is {@link HARNESS_TICK_SECONDS}, a quarter of a second, and not
 * the game's 0.05 s.** The rules decide once a 1 s window whatever the tick
 * (`rotation.ts`), and the scripted rides of #3300 and #3301 judged them at
 * this tick too. At the game's, a ride cost five times as much, and under the
 * nightly coverage run (`test:coverage`) a marked ride took 3.5 to 7.5 s, past
 * a case's time: the review of PR #3411's first run. The session's drawing
 * (the pack layout) is not ridden: nothing here scores it.
 *
 * No clock, no random draw: the line's seed is the only one, and it is the
 * harness's ({@link HARNESS_SEED}). The same seed, rider and course give the
 * same record, bit for bit.
 *
 * What is kept is a {@link RideRecord}: a sample a decision window, the cues
 * selected, and the two finishes. Numbers and closed-list words only: no
 * place, no coordinate.
 */

import {
  gradeAt,
  startCues,
  startGroupRide,
  stepCues,
  stepGroupRide,
  type CueCorrectionKind,
  type CueKind,
  type GroupRoad,
  type LinePhase,
  type MemberView,
  type RiderRole,
} from '@onyourleft/domain';
import { groupRidePhysics } from '@onyourleft/physics';

import { GROUP_RIDE_DEFAULT_BOTS, groupRidePlan } from '../../src/game/group-ride/choice';
import { GROUP_RIDE_RIDER_ID, groupLine } from '../../src/game/group-ride/ride-group';

import type { HarnessCourse } from './courses';
import {
  riderAction,
  RIDER_MASS_KILOGRAMS,
  RIDER_MOST_WATTS,
  type GroupNow,
  type ScriptedRider,
} from './riders';

/** The line's seed for every ride: fixed here and nowhere else. */
export const HARNESS_SEED = 3309;

/** The average every ride is asked for, km/h: the chooser's own default. */
export const HARNESS_TARGET_KMH = 30;

/** A tick of a ride, seconds: four to a decision window. See the file comment. */
export const HARNESS_TICK_SECONDS = 0.25;

/** A ride not over after this many times the plan's time has stalled, and is cut there. */
const MOST_PLAN_TIMES = 6;

/** One decision window of a ride, as it ended. */
export interface WindowSample {
  /** Ride time, seconds. */
  readonly seconds: number;
  readonly phase: LinePhase;
  readonly role: RiderRole;
  /** Who is on the front. */
  readonly front: string;
  /** The largest gap between two neighbours of the line, front first, the rider included where they are in it; metres. */
  readonly widestGapM: number;
  /** How far the rider is behind the group, the sweep not counted, metres; 0 with nobody ahead. */
  readonly behindM: number;
  /** The group's speed now, m/s. */
  readonly groupSpeedMps: number;
}

/** A scripted ride's record. */
export interface RideRecord {
  readonly rider: ScriptedRider;
  readonly course: HarnessCourse['name'];
  readonly seed: number;
  readonly targetKmh: number;
  readonly courseMetres: number;
  readonly windows: readonly WindowSample[];
  /** Every cue the selector chose, with its ride time in seconds. */
  readonly cues: readonly { readonly kind: CueKind; readonly seconds: number }[];
  /** The quiet marks the selector kept in place of a third cue in a row. */
  readonly marks: Readonly<Record<CueCorrectionKind, number>>;
  /** How many times the rider pressed pull off. */
  readonly presses: number;
  /** When the first of the line reached the finish, seconds, or `null` if none did. */
  readonly groupFinishSeconds: number | null;
  /** When the rider reached the finish, seconds, or `null` if the ride was cut first. */
  readonly riderFinishSeconds: number | null;
  /** How far the rider was behind the nearest member ahead as they finished, metres. */
  readonly finishBehindM: number | null;
}

/** Where every member of the line is, the rider included. */
function membersOf(group: GroupNow, rider: MemberView): ReadonlyMap<string, number> {
  const at = new Map<string, number>([[GROUP_RIDE_RIDER_ID, rider.distanceM]]);
  for (const [id, bot] of Object.entries(group.state.bots)) at.set(id, bot.distanceM);
  return at;
}

/**
 * How far the rider is behind the group: the nearest bot ahead of them, the
 * sweep not counted while it is back with them, metres; 0 with none ahead.
 * A sweep that sits on a dropped rider is a wheel to take, not the group.
 */
function behindOf(group: GroupNow, rider: MemberView): number {
  const riderM = rider.distanceM;
  const { sweep } = group.state.noDrop;
  let nearest = Number.POSITIVE_INFINITY;
  for (const [id, bot] of Object.entries(group.state.bots)) {
    if (id !== sweep && bot.distanceM > riderM) nearest = Math.min(nearest, bot.distanceM - riderM);
  }
  return nearest === Number.POSITIVE_INFINITY ? 0 : nearest;
}

/** The widest gap between neighbours of the line as it is ordered, front first; metres. */
function widestGapOf(group: GroupNow, rider: MemberView): number {
  const at = membersOf(group, rider);
  const { order } = group.state.rotation;
  let widest = 0;
  for (let seat = 1; seat < order.length; seat += 1) {
    const ahead = at.get(order[seat - 1] as string) as number;
    const here = at.get(order[seat] as string) as number;
    widest = Math.max(widest, ahead - here);
  }
  return widest;
}

/** What a ride is: who, where, and on which seed. */
export interface RideAsked {
  readonly rider: ScriptedRider;
  readonly course: HarnessCourse;
  readonly seed?: number;
  readonly targetKmh?: number;
}

/**
 * `asked.rider` ridden with the group over `asked.course` to the finish, or
 * for at most {@link MOST_PLAN_TIMES} the plan's time.
 *
 * @throws {Error} where the chooser's plan refuses the ride.
 */
export function rideScripted(asked: RideAsked): RideRecord {
  const seed = asked.seed ?? HARNESS_SEED;
  const targetKmh = asked.targetKmh ?? HARNESS_TARGET_KMH;
  const { profile } = asked.course;
  const total: number = profile.totalDistance;
  const own = groupRidePhysics(RIDER_MASS_KILOGRAMS);
  const choice = { targetSpeed: targetKmh / 3.6, bots: GROUP_RIDE_DEFAULT_BOTS };
  const plan = groupRidePlan(choice, profile);
  if ('error' in plan) throw new Error('the plan refused the ride');
  const road: GroupRoad = { course: profile, plan, physics: groupRidePhysics() };
  let rider: MemberView = { distanceM: 0, speedMps: choice.targetSpeed };
  const state = startGroupRide({
    line: groupLine(choice.bots, seed, plan.basePower),
    seed,
    atMs: 0,
    rider,
  });
  let group: GroupNow = {
    state,
    road,
    role: state.rotation.roles[GROUP_RIDE_RIDER_ID] ?? 'last-wheel',
    riderDraft: 1,
    groupSpeedMps: plan.speedNowAt(0),
  };
  let cueState = startCues(0);
  const windows: WindowSample[] = [];
  const cues: { kind: CueKind; seconds: number }[] = [];
  let presses = 0;
  let pressing = false;
  let groupFinishSeconds: number | null = null;
  let riderFinishSeconds: number | null = null;
  let finishBehindM: number | null = null;
  const mostTicks = Math.ceil(
    (MOST_PLAN_TIMES * total) / choice.targetSpeed / HARNESS_TICK_SECONDS,
  );

  for (let step = 0; step < mostTicks; step += 1) {
    const seconds = step * HARNESS_TICK_SECONDS;
    const grade: number = gradeAt(profile, Math.min(rider.distanceM, total));
    const action = riderAction(asked.rider, { seconds, group, rider, grade, own });
    // A press is taken only on the front, and a held one is one press, as `pressGroupPullOff` has it.
    const press = action.press && group.role === 'on-front';
    if (press && !pressing) presses += 1;
    pressing = press;
    const watts = Math.min(RIDER_MOST_WATTS, Math.max(0, action.wanted));
    const tick = stepGroupRide(
      group.state,
      {
        elapsedSeconds: HARNESS_TICK_SECONDS,
        rider,
        riderSignal: press,
        riderSittingIn: false,
        riderStopped: action.stopped,
      },
      road,
    );
    const chosen = stepCues(cueState, {
      rotation: tick.rotation,
      line: tick.line,
      powerWatts: watts,
      thresholdWatts: null,
    });
    cueState = chosen.state;
    const atSeconds = tick.state.atMs / 1_000;
    if (chosen.cue !== null) cues.push({ kind: chosen.cue.kind, seconds: tick.line.atMs / 1_000 });

    // The rider, through the same physics at their own mass and this tick's draft.
    const draft = tick.draft[GROUP_RIDE_RIDER_ID] ?? 1;
    const rolled = own.advance(rider, watts, grade, HARNESS_TICK_SECONDS, draft);
    // The script's brake (`riders.ts`): the watts under zero, taken off as speed.
    const speedMps =
      action.brakes && action.wanted < 0 && rider.speedMps > 0
        ? Math.max(
            0,
            rolled.speedMps +
              (action.wanted / (RIDER_MASS_KILOGRAMS * rider.speedMps)) * HARNESS_TICK_SECONDS,
          )
        : rolled.speedMps;
    rider = { distanceM: rolled.distanceM, speedMps };
    group = {
      state: tick.state,
      road,
      role: tick.rotation.roles[GROUP_RIDE_RIDER_ID] ?? group.role,
      riderDraft: draft,
      groupSpeedMps: tick.groupSpeedMps,
    };

    if (tick.state.atMs % 1_000 === 0) {
      windows.push({
        seconds: atSeconds,
        phase: tick.state.rotation.phase,
        role: group.role,
        front: tick.state.rotation.order[0] as string,
        widestGapM: widestGapOf(group, rider),
        behindM: behindOf(group, rider),
        groupSpeedMps: group.groupSpeedMps,
      });
    }
    if (groupFinishSeconds === null && Math.max(...membersOf(group, rider).values()) >= total) {
      groupFinishSeconds = atSeconds;
    }
    if (rider.distanceM >= total) {
      riderFinishSeconds = atSeconds;
      finishBehindM = behindOf(group, rider);
      break;
    }
  }
  return {
    rider: asked.rider,
    course: asked.course.name,
    seed,
    targetKmh,
    courseMetres: total,
    windows,
    cues,
    marks: cueState.marks,
    presses,
    groupFinishSeconds,
    riderFinishSeconds,
    finishBehindM,
  };
}
