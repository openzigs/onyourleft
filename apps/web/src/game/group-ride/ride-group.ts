// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A group ride on a ride** — #3303, epic #3296,
 * [ADR 0101](../../../../../docs/adr/0101-the-ai-group-ride.md): the line of
 * bots stepped beside the rider on the simulation's own steps, the rider's
 * draft from it, where the bots are drawn, and what the ride keeps of it.
 * `lap-race/ride-race.ts` is the pattern, and `GameView.tsx` is the caller.
 *
 * ## What it feeds, and what it reads back
 *
 * {@link stepGroupRideSession} calls `@onyourleft/domain` §`stepGroupRide`
 * once for each simulation step that ran, with the rider's odometer and speed
 * as that step began, on `@onyourleft/physics` §`groupRidePhysics`. Out of
 * each tick it keeps:
 *
 * - **{@link GroupRideSession.riderDraft}**, `tick.draft` at the rider: the
 *   one draft call the bots were ridden at. `GameView` hands it to
 *   `GameSimulation.draftWith`, where it is a multiplier on the rider's drag
 *   and nothing else (ADR 0038 D-1), as a lap race's is.
 * - **{@link GroupRideSession.groupSpeedMps}**, `tick.groupSpeedMps`: the
 *   group's speed now. It is the plan's on the road under the front, the
 *   eased speed while the line holds for the rider, and **the paced speed
 *   once the line is paced to them** (the amendment of 2026-11-27). The log
 *   keeps it; the HUD's strip (#3305) reads it here.
 * - the line's phase and the rider's role, for the log (below).
 *
 * ## The rider has stopped
 *
 * `riderStopped` is the caller's word (ADR 0101 D-4.4, D-6.11): `GameView`
 * says it while the recording is auto-paused or the power reading is not
 * live, and the line then waits, at a speed with no lower limit.
 *
 * ## The rider is read and never written
 *
 * Nothing here returns a speed, a power or a place for the rider: their
 * physics is never tethered (ADR 0101 D-4.5). The drawing leaves the rider
 * where the ride put them along the road and lays the bots out around them.
 *
 * ## The drawing is the lap race's pack layout
 *
 * `lap-race/pack-layout.ts` (#2517, #3268): rows a bike length apart, no
 * bicycle inside another, the rider never moved. Every member is handed in
 * in one lane, and the layout draws the riders a wheel gap apart as a pack,
 * up to three abreast in a row, as it draws a race's. A drawing only: nothing
 * reads it back. **Single file, and the retreating rider to one side, are
 * #3304's.**
 *
 * ## The group's make-up
 *
 * {@link groupLine}: the bots, front first, with the rider on the last wheel,
 * where a rider who has never sat in a line starts sheltered and comes to the
 * front in turn. Each bot's critical power is seeded inside
 * {@link GROUP_BOT_STRENGTH_SPREAD} of a figure that always holds the front
 * of this plan, so **every bot rides the same speed** and the stronger pull
 * longer (ADR 0101 D-3.4; `rotation.ts` scales a pull by strength). A bot is
 * a strength, a rule, the course and a seed: never a recorded ride (D-1.3).
 * Feel parameters, for the harness (#3309) and the owner's ride.
 *
 * ## What the ride keeps
 *
 * {@link groupRideFact}: the seed, the average chosen, the size, the rules'
 * version and a log with an entry each time the line's phase or the rider's
 * role changed, each with the group's speed then (`@onyourleft/store`
 * §`GroupRideFact`). Numbers and words from closed lists: no place, no
 * coordinate, no text.
 *
 * ## What the rider can tell the group (#3307, ADR 0101 D-3.7)
 *
 * Two things, and neither is ever needed to stay in the group:
 *
 * - **Pull off**, {@link pressGroupPullOff}: a discrete press, taken only
 *   while the rider's role is `on-front`. It is handed to the rotation as
 *   `riderSignal` on the next simulation step and to nothing else, and it
 *   moves the rider's **drawn** lane one lane to
 *   `rider-input.ts` §`GROUP_RIDE_PULL_OFF_SIDE` through `lanes.ts`, the lap
 *   race's steer.
 *   The press is one flag, so a held key or a mashed button is one pull-off,
 *   never a queue; in any other role it changes nothing. The drawn lane comes
 *   back to the line's once the rider is neither on the front nor drifting
 *   back. A drawing only: the simulation has no lateral field.
 * - **Sit in**, {@link setGroupSitIn}: a choice held for as long as it is on,
 *   handed to the rotation as `riderSittingIn` on every step, so the rider is
 *   never given the front; off again, they take their turn as it comes round.
 *
 * Neither is kept past the ride.
 *
 * ## Nothing here reaches a trainer
 *
 * No import here is of a trainer, a port or a transport, and no number that
 * comes out is a target for one (ADR 0101 D-6.1).
 * `group-ride-cannot-reach-trainer.test.tsx` holds a ride with the group to
 * the writes of the same ride without it.
 */

import {
  GROUP_PLAN_FACTOR_CEILING,
  GROUP_RIDE_CODE_VERSION,
  nextUnit,
  raceRandom,
  startGroupRide,
  stepGroupRide,
  type GroupRideState,
  type GroupRoad,
  type LineMember,
  type LinePhase,
  type MemberView,
  type RiderRole,
  type RouteProfile,
} from '@onyourleft/domain';
import { groupRidePhysics } from '@onyourleft/physics';
import { GROUP_RIDE_LOG_MOST, type GroupRideFact, type GroupRideLogEntry } from '@onyourleft/store';

import {
  drawnLateral,
  drawnShift,
  drawnSway,
  gridPackLayout,
  stepPackLayout,
  type PackLayout,
  type PackRacer,
} from '../lap-race/pack-layout';
import type { LapRaceDrawing } from '../lap-race/ride-race';
import { botSkinFor, seededRiderBody } from '../rider-body';
import {
  LANE_OFFSETS_METRES,
  sidewaysSpeedOf,
  startSteer,
  steerToward,
  stepSteer,
  type SteerState,
} from '../lanes';
import type { RaceBotInput } from '../scene';
import { SIMULATION_STEP_SECONDS } from '../simulation';

import { groupRidePlan, groupRideSized, type GroupRideChoice } from './choice';
import { GROUP_RIDE_PULL_OFF_SIDE } from './rider-input';

/** The rider's id in the line. */
export const GROUP_RIDE_RIDER_ID = 'rider';

/**
 * A bot's critical power before its strength, watts, where the plan asks the
 * front for less: **420 W**, the figure the scripted rides of #3300 and #3301
 * were judged on (`@onyourleft/physics` §`group-ride-testing.ts`).
 */
export const GROUP_BOT_CP_WATTS = 420;

/**
 * How far over the most the plan asks of the front a bot's critical power is
 * before its strength: **20 %**, so the weakest bot of the spread still holds
 * the front without spending its reserve.
 */
export const GROUP_BOT_CP_MARGIN = 1.2;

/** A bot's strength is seeded within this share either side of 1: **15 %**. */
export const GROUP_BOT_STRENGTH_SPREAD = 0.15;

/** A bot's W′, joules: **20 kJ**, the scripted rides' figure. */
export const GROUP_BOT_W_PRIME_JOULES = 20_000;

/** The line's lane: the centre line, where the rider is drawn in the group. */
const LINE_STEER: SteerState = startSteer(0);

/** The line of a group of `bots`, front first, the rider on the last wheel. */
export function groupLine(
  bots: number,
  seed: number,
  basePowerWatts: number,
): readonly LineMember[] {
  const least = Math.max(
    GROUP_BOT_CP_WATTS,
    GROUP_BOT_CP_MARGIN * GROUP_PLAN_FACTOR_CEILING * basePowerWatts,
  );
  const line: LineMember[] = [];
  let random = raceRandom(seed);
  for (let index = 0; index < bots; index += 1) {
    const drawn = nextUnit(random);
    random = drawn.next;
    const cpWatts = least * (1 + GROUP_BOT_STRENGTH_SPREAD * (2 * drawn.value - 1));
    line.push({
      id: `bot-${String(index + 1)}`,
      kind: 'bot',
      capacity: {
        cpWatts,
        wPrimeJoules: GROUP_BOT_W_PRIME_JOULES,
        peakWatts: 2 * cpWatts,
        floorWatts: 0,
      },
    });
  }
  line.push({ id: GROUP_RIDE_RIDER_ID, kind: 'rider' });
  return line;
}

/** A group ride between frames: plain data, replaced whole by each step. */
export interface GroupRideSession {
  readonly choice: GroupRideChoice;
  /** The line's seed. Kept with the ride ({@link groupRideFact}). */
  readonly seed: number;
  /** The course, its plan and the physics: fixed for the ride. */
  readonly road: GroupRoad;
  readonly state: GroupRideState;
  /** The bots' ids, front first as the line was set up: a bot's place here is its body's. */
  readonly botIds: readonly string[];
  /** The rider's odometer and speed as the last step ended: where the next begins. */
  readonly rider: MemberView;
  /** The rider's draft multiplier from the last tick; `1` before the first. */
  readonly riderDraft: number;
  /** The group's speed now, m/s: the paced speed while the line is paced to the rider. */
  readonly groupSpeedMps: number;
  /** The line's phase as the last tick left it. */
  readonly phase: LinePhase;
  /** The rider's role as the last tick left it, their standing included. */
  readonly role: RiderRole;
  /** Where the pack layout draws each bot. */
  readonly pack: PackLayout;
  /** The log so far. @see GroupRideFact.log */
  readonly log: readonly GroupRideLogEntry[];
  /** Whether a change was left out of {@link log} because it was full. */
  readonly logCut: boolean;
  /** Whether the rider has chosen to sit in. @see setGroupSitIn */
  readonly sittingIn: boolean;
  /** A pull-off press the rotation has not been handed yet: one flag, never a count. */
  readonly pullOffPressed: boolean;
  /** Where the rider is drawn across the road: the line's lane, or a lane aside after a pull-off. */
  readonly steer: SteerState;
}

/** What {@link startGroupRideSession} reads. */
export interface GroupRideSessionStart {
  readonly choice: GroupRideChoice;
  readonly profile: RouteProfile;
  /** Where the rider is at the press: the simulation's odometer, metres. */
  readonly riderDistance: number;
  /** How fast the rider is at the press, m/s. */
  readonly riderSpeed: number;
  /** The line's seed; absent, one is drawn. Only a test names one. */
  readonly seed?: number | undefined;
}

/** The line's seed, from the platform's cryptographic random source: one draw, at the press. */
function drawGroupSeed(): number {
  const drawn = new Uint32Array(1);
  crypto.getRandomValues(drawn);
  return drawn[0] as number;
}

/** The line as the pack layout reads it: every member in one lane, at its odometer. */
function packField(
  session: Pick<GroupRideSession, 'botIds'>,
  state: GroupRideState,
  rider: MemberView,
  before?: GroupRideState,
  steer: SteerState = LINE_STEER,
  steeredBefore: number = steer.offset,
): PackRacer[] {
  const field: PackRacer[] = [
    {
      id: GROUP_RIDE_RIDER_ID,
      along: rider.distanceM,
      // #3307: the rider's drawn lane, so the line comes through beside a rider who pulled off.
      lateral: steer.offset,
      heading: LANE_OFFSETS_METRES[steer.lane],
      lateralBefore: steeredBefore,
      speed: rider.speedMps,
    },
  ];
  for (const id of session.botIds) {
    const bot = state.bots[id];
    if (bot === undefined) continue;
    const was = before?.bots[id];
    field.push({
      id,
      along: bot.distanceM,
      ...(was === undefined ? {} : { alongBefore: was.distanceM }),
      lateral: 0,
      speed: bot.speedMps,
    });
  }
  return field;
}

/**
 * A group ride on the line at the press, or `undefined` for a choice that
 * cannot be ridden on this road: a size out of range, or a target the plan
 * refuses. The chooser refuses both before the press
 * (`choice.ts` §`groupRideAsked`), by the same plan.
 */
export function startGroupRideSession(input: GroupRideSessionStart): GroupRideSession | undefined {
  const { choice, profile } = input;
  if (!groupRideSized(choice.bots)) return undefined;
  const plan = groupRidePlan(choice, profile);
  if ('error' in plan) return undefined;
  const seed = input.seed ?? drawGroupSeed();
  const line = groupLine(choice.bots, seed, plan.basePower);
  const rider: MemberView = { distanceM: input.riderDistance, speedMps: input.riderSpeed };
  const state = startGroupRide({ line, seed, atMs: 0, rider });
  const botIds = line.filter((member) => member.kind === 'bot').map((member) => member.id);
  const phase = state.rotation.phase;
  const role = state.rotation.roles[GROUP_RIDE_RIDER_ID] ?? 'last-wheel';
  const groupSpeedMps: number = plan.speedNowAt(input.riderDistance);
  return {
    choice,
    seed,
    road: { course: profile, plan, physics: groupRidePhysics() },
    state,
    botIds,
    rider,
    riderDraft: 1,
    groupSpeedMps,
    phase,
    role,
    pack: gridPackLayout(packField({ botIds }, state, rider), GROUP_RIDE_RIDER_ID),
    log: [{ at: 0, phase, role, groupSpeed: groupSpeedMps }],
    logCut: false,
    sittingIn: false,
    pullOffPressed: false,
    steer: LINE_STEER,
  };
}

/**
 * The session after the rider pressed pull off (#3307): on the front, the
 * press waits for the next simulation step, which hands it to the rotation,
 * and the rider's drawn lane moves to the pull-off side. In
 * any other role, the same session: no rotation starts and nothing moves.
 */
export function pressGroupPullOff(session: GroupRideSession): GroupRideSession {
  if (session.role !== 'on-front' || session.pullOffPressed) return session;
  const { lane } = steerToward(LINE_STEER, GROUP_RIDE_PULL_OFF_SIDE);
  return { ...session, pullOffPressed: true, steer: { ...session.steer, lane } };
}

/** The session with the rider sitting in, or not (#3307): read by every step from the next on. */
export function setGroupSitIn(session: GroupRideSession, sittingIn: boolean): GroupRideSession {
  return session.sittingIn === sittingIn ? session : { ...session, sittingIn };
}

/** One frame's steps of the group. */
export interface GroupRideSessionStep {
  /** How many simulation steps ran: `GameSimulation.advanceTo`'s count. */
  readonly ticks: number;
  /** The rider now, after those steps: the simulation's odometer and speed. Read, never written. */
  readonly rider: MemberView;
  /**
   * Whether the rider has stopped pedalling or has no power reading: the
   * ride's auto-pause and its sensor state (ADR 0101 D-4.4, D-6.11).
   */
  readonly riderStopped: boolean;
}

/**
 * The group `ticks` simulation steps on. The rider's place and speed at the
 * start of each is read between where the last frame left them and where
 * this one has them.
 *
 * @throws {RangeError} for a count of ticks that is not a whole number of
 * nought or more; and through the rules for a rider who is not somewhere
 * finite.
 */
export function stepGroupRideSession(
  session: GroupRideSession,
  step: GroupRideSessionStep,
): GroupRideSession {
  const { ticks } = step;
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new RangeError('a group ride step runs a whole number of ticks, 0 or more');
  }
  if (ticks === 0) return session;
  const from = session.rider;
  const to = step.rider;
  let { state, pack, riderDraft, groupSpeedMps, phase, role, logCut, steer } = session;
  let log = session.log;
  for (let tick = 0; tick < ticks; tick += 1) {
    const share = tick / ticks;
    const rider: MemberView = {
      distanceM: from.distanceM + (to.distanceM - from.distanceM) * share,
      speedMps: from.speedMps + (to.speedMps - from.speedMps) * share,
    };
    const before = state;
    const ridden = stepGroupRide(
      state,
      {
        elapsedSeconds: SIMULATION_STEP_SECONDS,
        rider,
        riderStopped: step.riderStopped,
        // #3307: a press since the last step, once; the choice, for as long as it is on.
        riderSignal: session.pullOffPressed && tick === 0,
        riderSittingIn: session.sittingIn,
      },
      session.road,
    );
    state = ridden.state;
    riderDraft = ridden.draft[GROUP_RIDE_RIDER_ID] ?? 1;
    groupSpeedMps = ridden.groupSpeedMps;
    const phaseNow = ridden.rotation.state.phase;
    const roleNow = ridden.rotation.roles[GROUP_RIDE_RIDER_ID] ?? role;
    if (phaseNow !== phase || roleNow !== role) {
      phase = phaseNow;
      role = roleNow;
      if (log.length < GROUP_RIDE_LOG_MOST) {
        log = [...log, { at: state.atMs / 1_000, phase, role, groupSpeed: groupSpeedMps }];
      } else {
        logCut = true;
      }
    }
    // #3307: the drawn lane, back to the line's once the rider is neither on
    // the front nor drifting back, and a step nearer the lane it is steered to.
    const steeredBefore = steer.offset;
    if (steer.lane !== LINE_STEER.lane && role !== 'on-front' && role !== 'drifting-back') {
      steer = { ...steer, lane: LINE_STEER.lane };
    }
    steer = stepSteer(steer, SIMULATION_STEP_SECONDS);
    // The drawing, a tick on: the rider where this tick's end has them.
    const end = (tick + 1) / ticks;
    pack = stepPackLayout(
      packField(
        session,
        state,
        {
          distanceM: from.distanceM + (to.distanceM - from.distanceM) * end,
          speedMps: from.speedMps + (to.speedMps - from.speedMps) * end,
        },
        before,
        steer,
        steeredBefore,
      ),
      GROUP_RIDE_RIDER_ID,
      pack,
      SIMULATION_STEP_SECONDS,
    );
  }
  return {
    ...session,
    state,
    rider: to,
    riderDraft,
    groupSpeedMps,
    phase,
    role,
    pack,
    log,
    logCut,
    pullOffPressed: false,
    steer,
  };
}

/**
 * Where a frame draws the group: the bots through the lap race's pack layout,
 * and the rider where the ride has them, in the line's lane.
 * `riderDistance` is the rider's drawn odometer (`simulation.ts` §`drawnAt`,
 * a step behind the newest) and `behindSeconds` how far behind the newest
 * step that is, so each bot is drawn as far back along its own speed and the
 * line moves together, as `lap-race/ride-race.ts` §`lapRaceDrawing` does.
 * Never behind the route's start.
 */
export function groupRideDrawing(
  session: GroupRideSession,
  riderDistance: number,
  behindSeconds: number,
): LapRaceDrawing {
  const raceBots: RaceBotInput[] = [];
  session.botIds.forEach((id, index) => {
    const bot = session.state.bots[id];
    if (bot === undefined) return;
    const place = session.pack.get(id);
    raceBots.push({
      distanceMetres: Math.max(
        0,
        bot.distanceM +
          (place === undefined ? 0 : drawnShift(place, behindSeconds, SIMULATION_STEP_SECONDS)) -
          bot.speedMps * behindSeconds,
      ),
      speedMetresPerSecond: bot.speedMps,
      lateralMetres:
        place === undefined ? 0 : drawnLateral(place, behindSeconds, SIMULATION_STEP_SECONDS),
      swayMetresPerSecond:
        place === undefined ? 0 : drawnSway(place, behindSeconds, SIMULATION_STEP_SECONDS),
      laidOut: place !== undefined,
      // Which rider it is drawn as, from the line's seed and its place in the
      // line as it was set up, and which skin tone, from its id. Drawing only.
      body: seededRiderBody(session.seed, index),
      skin: botSkinFor(id),
    });
  });
  return {
    // The rider is never moved along the road: their own drawn odometer, in
    // the line's lane, or a lane aside after a pull-off (#3307).
    riderDistance,
    steeredLateral: session.steer.offset,
    steeringSpeed: sidewaysSpeedOf(session.steer),
    riderHit: undefined,
    raceBots,
  };
}

/** What the ride keeps of its group: `@onyourleft/store` §`RideFacts.groupRide`. */
export function groupRideFact(session: GroupRideSession): GroupRideFact {
  return {
    version: GROUP_RIDE_CODE_VERSION,
    seed: session.seed,
    targetSpeed: session.choice.targetSpeed,
    bots: session.choice.bots,
    log: session.log,
    ...(session.logCut ? { logCut: true as const } : {}),
  };
}
