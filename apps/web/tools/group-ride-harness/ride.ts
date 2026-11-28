// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3309's harness: **one scripted rider's group ride, ridden** through the
 * shipped session, `src/game/group-ride/ride-group.ts`, as `GameView` steps
 * it: one call of {@link stepGroupRideSession} for each simulation step, the
 * rider's odometer and speed after it, whether they have stopped, and their
 * power for the cue selector. The rider is ridden on `@onyourleft/physics`
 * §`groupRidePhysics` at their own mass and at the draft the session handed
 * back for them, exactly as `GameSimulation.draftWith` applies it.
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
  type CueCorrectionKind,
  type CueKind,
  type LinePhase,
  type MemberView,
  type RiderRole,
} from '@onyourleft/domain';
import { groupRidePhysics } from '@onyourleft/physics';

import { GROUP_RIDE_DEFAULT_BOTS } from '../../src/game/group-ride/choice';
import {
  GROUP_RIDE_RIDER_ID,
  pressGroupPullOff,
  startGroupRideSession,
  stepGroupRideSession,
  type GroupRideSession,
} from '../../src/game/group-ride/ride-group';
import { SIMULATION_STEP_SECONDS } from '../../src/game/simulation';

import type { HarnessCourse } from './courses';
import { riderAction, RIDER_MASS_KILOGRAMS, RIDER_MOST_WATTS, type ScriptedRider } from './riders';

/** The line's seed for every ride: fixed here and nowhere else. */
export const HARNESS_SEED = 3309;

/** The average every ride is asked for, km/h: the chooser's own default. */
export const HARNESS_TARGET_KMH = 30;

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
function membersOf(session: GroupRideSession): ReadonlyMap<string, number> {
  const at = new Map<string, number>([[GROUP_RIDE_RIDER_ID, session.rider.distanceM]]);
  for (const [id, bot] of Object.entries(session.state.bots)) at.set(id, bot.distanceM);
  return at;
}

/**
 * How far the rider is behind the group: the nearest bot ahead of them, the
 * sweep not counted while it is back with them, metres; 0 with none ahead.
 * A sweep that sits on a dropped rider is a wheel to take, not the group.
 */
function behindOf(session: GroupRideSession): number {
  const riderM = session.rider.distanceM;
  const { sweep } = session.state.noDrop;
  let nearest = Number.POSITIVE_INFINITY;
  for (const [id, bot] of Object.entries(session.state.bots)) {
    if (id !== sweep && bot.distanceM > riderM) nearest = Math.min(nearest, bot.distanceM - riderM);
  }
  return nearest === Number.POSITIVE_INFINITY ? 0 : nearest;
}

/** The widest gap between neighbours of the line as it is ordered, front first; metres. */
function widestGapOf(session: GroupRideSession): number {
  const at = membersOf(session);
  const { order } = session.state.rotation;
  let widest = 0;
  for (let seat = 1; seat < order.length; seat += 1) {
    const ahead = at.get(order[seat - 1] as string) as number;
    const here = at.get(order[seat] as string) as number;
    widest = Math.max(widest, ahead - here);
  }
  return widest;
}

/** The odometer of whoever of the line is furthest along, metres. */
function firstOf(session: GroupRideSession): number {
  return Math.max(...membersOf(session).values());
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
 * @throws {Error} where the shipped session refuses the ride.
 */
export function rideScripted(asked: RideAsked): RideRecord {
  const seed = asked.seed ?? HARNESS_SEED;
  const targetKmh = asked.targetKmh ?? HARNESS_TARGET_KMH;
  const { profile } = asked.course;
  const total: number = profile.totalDistance;
  const own = groupRidePhysics(RIDER_MASS_KILOGRAMS);
  const choice = { targetSpeed: targetKmh / 3.6, bots: GROUP_RIDE_DEFAULT_BOTS };
  const start = startGroupRideSession({
    choice,
    profile,
    riderDistance: 0,
    riderSpeed: choice.targetSpeed,
    seed,
  });
  if (start === undefined) throw new Error('the session refused the ride');
  let session: GroupRideSession = start;
  let rider: MemberView = session.rider;
  const windows: WindowSample[] = [];
  const cues: { kind: CueKind; seconds: number }[] = [];
  let groupFinishSeconds: number | null = null;
  let riderFinishSeconds: number | null = null;
  let finishBehindM: number | null = null;
  const mostSteps = Math.ceil(
    (MOST_PLAN_TIMES * total) / choice.targetSpeed / SIMULATION_STEP_SECONDS,
  );

  for (let step = 0; step < mostSteps; step += 1) {
    const seconds = step * SIMULATION_STEP_SECONDS;
    const grade: number = gradeAt(profile, Math.min(rider.distanceM, total));
    const action = riderAction(asked.rider, { seconds, session, rider, grade, own });
    if (action.press && session.role === 'on-front') {
      session = pressGroupPullOff(session);
    }
    const watts = Math.min(RIDER_MOST_WATTS, Math.max(0, action.wanted));
    const rolled = own.advance(rider, watts, grade, SIMULATION_STEP_SECONDS, session.riderDraft);
    // The script's brake (`riders.ts`): the watts under zero, taken off as speed.
    const speedMps =
      action.brakes && action.wanted < 0 && rider.speedMps > 0
        ? Math.max(
            0,
            rolled.speedMps +
              (action.wanted / (RIDER_MASS_KILOGRAMS * rider.speedMps)) * SIMULATION_STEP_SECONDS,
          )
        : rolled.speedMps;
    rider = { distanceM: rolled.distanceM, speedMps };
    const cueBefore = session.cue;
    session = stepGroupRideSession(session, {
      ticks: 1,
      rider,
      riderStopped: action.stopped,
      powerWatts: watts,
      thresholdWatts: null,
    });
    const atSeconds = session.state.atMs / 1_000;
    if (session.cue !== cueBefore && session.cue !== undefined) {
      cues.push({ kind: session.cue.kind, seconds: session.cue.atSeconds });
    }
    if (session.state.atMs % 1_000 === 0) {
      windows.push({
        seconds: atSeconds,
        phase: session.phase,
        role: session.role,
        front: session.state.rotation.order[0] as string,
        widestGapM: widestGapOf(session),
        behindM: behindOf(session),
        groupSpeedMps: session.groupSpeedMps,
      });
    }
    if (groupFinishSeconds === null && firstOf(session) >= total) groupFinishSeconds = atSeconds;
    if (rider.distanceM >= total) {
      riderFinishSeconds = atSeconds;
      finishBehindM = behindOf(session);
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
    marks: session.cues.marks,
    presses: session.presses.filter((each) => each.press === 'pull-off').length,
    groupFinishSeconds,
    riderFinishSeconds,
    finishBehindM,
  };
}
