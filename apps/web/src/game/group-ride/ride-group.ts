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
 * - **{@link GroupRideSession.cue}**, the rider's cue (#3305): each tick's
 *   rotation and what it read go to `@onyourleft/domain` §`stepCues` with the
 *   rider's power, and the last cue it selected is kept with its instant on
 *   the group's clock. The HUD's cue line and the announcer read it
 *   (`hud/group-ride-hud.ts`); {@link groupRideStrip} is the HUD's role strip.
 *   **With no power reading the selector says nothing** (ADR 0101 D-6.11).
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
 * where the ride put them and lays the bots out around them.
 *
 * ## The drawing is the lap race's pack layout, in single file
 *
 * `lap-race/pack-layout.ts` (#2517, #3268) with its `singleFile` set (#3304):
 * a row to each member of the line, a bike length and the wheel gap behind
 * the one ahead, no bicycle inside another, the rider never moved. The line
 * rides in {@link GROUP_LINE_LANE}. A drawing only: nothing reads it back,
 * and no lane or place across enters the rules or the draft (ADR 0101 D-3.3).
 *
 * **The member who has pulled off** (`rotation.aside`: `drifting-back`, then
 * `latching`) is drawn one lane to the side, in {@link GROUP_PULL_OFF_LANE},
 * beside the line and no row of it, so the line keeps its shape and they
 * drift back past it. Back in the line by the rules, they come across once
 * the line has drawn them a bike length of room, and not before.
 *
 * **When that member is the rider, it is the rider's own lane that moves**,
 * by `lanes.ts` §`stepSteer` at its 0.4 s a lane, out through
 * `steeredLateral` as a race's steer is ({@link GroupRideSession.riderSteer}).
 * The bots stay in the line's lane. The lane follows the rider's role, so
 * #3307's press needs to reach the rules only (`GroupRideInput.riderSignal`).
 * A bot moves across at the layout's own pace for a bot (#2665).
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
 * version, where the group's clock begins on the recording's
 * ({@link groupRideTimed}), and a log with an entry each time the line's
 * phase or the rider's role changed, each with the group's speed then
 * (`@onyourleft/store` §`GroupRideFact`), and what the rider told the
 * group. Numbers and words from closed lists: no place, no coordinate, no
 * text.
 *
 * ## What the rider can tell the group (#3307, ADR 0101 D-3.7)
 *
 * - **Pull off**, {@link pressGroupPullOff}: a discrete press, taken only
 *   while the rider's role is `on-front`, handed to the rotation as
 *   `riderSignal` on the next frame's steps. One flag, so a held key or a
 *   mashed button is one pull-off. The drawn lane follows from the rotation
 *   putting the rider aside (above).
 * - **Sit in**, {@link setGroupSitIn}: a choice held while on, handed to the
 *   rotation as `riderSittingIn` on every step.
 *
 * Every press taken and every sit-in choice goes in
 * {@link GroupRideSession.presses} with its ride time, and so in the fact.
 *
 * ## The group ride ends at the finish
 *
 * The plan is one pass of the route ({@link groupRideFinished}): on a route
 * with a finish, the group ride ends when the rider reaches it, and a rider
 * who answers *Keep riding* rides on alone. A loop is not offered a group
 * (`choice.ts` §`groupRideUnavailable`; laps are #3369's).
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
  startCues,
  startGroupRide,
  stepCues,
  stepGroupRide,
  type CueState,
  type GroupRideState,
  type GroupRoad,
  type LineMember,
  type LinePhase,
  type MemberView,
  type RiderRole,
  type RouteProfile,
} from '@onyourleft/domain';
import { groupRidePhysics } from '@onyourleft/physics';
import {
  GROUP_RIDE_LOG_MOST,
  type GroupRideFact,
  type GroupRideLogEntry,
  type GroupRidePress,
} from '@onyourleft/store';

import { LANE_OFFSETS_METRES, sidewaysSpeedOf, stepSteer, type SteerState } from '../lanes';
import {
  BIKE_LENGTH_METRES,
  drawnLateral,
  drawnShift,
  drawnSway,
  NO_PACK_LAYOUT,
  stepPackLayout,
  type PackLayout,
  type PackRacer,
} from '../lap-race/pack-layout';
import type { LapRaceDrawing } from '../lap-race/ride-race';
import { botSkinFor, seededRiderBody } from '../rider-body';
import {
  groupRideCueSelected,
  type GroupRideCueShown,
  type GroupRideHud,
} from '../hud/group-ride-hud';
import type { RaceBotInput } from '../scene';
import { SIMULATION_STEP_SECONDS } from '../simulation';

import { groupRidePlan, groupRideSized, type GroupRideChoice } from './choice';

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

/**
 * The lane the line rides in, an index into `lanes.ts`
 * §`LANE_OFFSETS_METRES`: **the middle one**, where a group ride has drawn
 * its rider since #3303.
 */
export const GROUP_LINE_LANE = 1;

/**
 * The lane a member who has pulled off is drawn in while they drift back:
 * **one lane to the left** of the line, the one fixed side of Phase 1 (ADR
 * 0101 D-3.7, Q6). Proposed: which side is the owner's to state on the ride
 * (#3305), and this is the one figure to change.
 */
export const GROUP_PULL_OFF_LANE = 0;

const LINE_LATERAL = LANE_OFFSETS_METRES[GROUP_LINE_LANE] as number;
const PULL_OFF_LATERAL = LANE_OFFSETS_METRES[GROUP_PULL_OFF_LANE] as number;

/** Two bicycles this near along the road are nose to tail at best, less a rounding. */
const ROOM_METRES = BIKE_LENGTH_METRES - 1e-6;

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
  /** The cue selector between windows (#3305). */
  readonly cues: CueState;
  /** The last cue selected, `undefined` before the ride's first. @see GroupRideCueShown */
  readonly cue: GroupRideCueShown | undefined;
  /** Where the pack layout draws each bot. */
  readonly pack: PackLayout;
  /**
   * The rider's own lane and where they are drawn across the road: the
   * line's, or the pull-off lane while they are the one who has pulled off.
   * A drawing only (`lanes.ts`).
   */
  readonly riderSteer: SteerState;
  /** Where the rider was drawn across a tick before: the frames between two ticks draw between. */
  readonly steeredBefore: number;
  /** The log so far. @see GroupRideFact.log */
  readonly log: readonly GroupRideLogEntry[];
  /** Whether a change was left out of {@link log} because it was full. */
  readonly logCut: boolean;
  /**
   * The recording's elapsed seconds when the group's clock read nought, or
   * `undefined` until a recording has been read. @see groupRideTimed
   */
  readonly startedAt: number | undefined;
  /** Whether the rider has chosen to sit in. @see setGroupSitIn */
  readonly sittingIn: boolean;
  /** A pull-off press the rotation has not been handed yet: one flag, never a count. */
  readonly pullOffPressed: boolean;
  /**
   * Whether the rider pressed pull off on this turn on the front: drawn in the
   * pull-off lane from the press, before the rotation's next window has them
   * aside, as #3307 draws it. Cleared once they are off the front.
   */
  readonly pullOffAsked: boolean;
  /** Every press taken and every sit-in choice so far, oldest first. @see GroupRideFact.presses */
  readonly presses: readonly GroupRidePress[];
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

/** What the drawing reads of a session between ticks. */
type Drawn = Pick<GroupRideSession, 'botIds' | 'pack' | 'riderSteer'>;

/** Whether a member was drawn in the pull-off lane, or on its way there, on the tick before. */
function wasOut(drawn: Drawn, id: string): boolean {
  return id === GROUP_RIDE_RIDER_ID
    ? drawn.riderSteer.lane === GROUP_PULL_OFF_LANE
    : drawn.pack.get(id)?.aim === PULL_OFF_LATERAL;
}

/**
 * Which members are drawn in the pull-off lane this tick: the one who has
 * pulled off, for as long as the rules have them aside; and after that, one
 * still out there until the line has drawn a bike length of room for them,
 * so nobody comes across into another bicycle.
 */
function membersOut(drawn: Drawn, state: GroupRideState, rider: MemberView): ReadonlySet<string> {
  const along = new Map<string, number>([[GROUP_RIDE_RIDER_ID, rider.distanceM]]);
  for (const id of drawn.botIds) {
    const bot = state.bots[id];
    if (bot !== undefined) along.set(id, bot.distanceM + (drawn.pack.get(id)?.shift ?? 0));
  }
  const out = new Set<string>();
  for (const [id, at] of along) {
    if (state.rotation.aside === id) {
      out.add(id);
      continue;
    }
    if (!wasOut(drawn, id)) continue;
    const room = [...along].every(
      ([other, otherAt]) => other === id || Math.abs(otherAt - at) >= ROOM_METRES,
    );
    if (!room) out.add(id);
  }
  return out;
}

/** The lane the rider is drawn steering to this tick. */
function riderLane(out: ReadonlySet<string>): number {
  return out.has(GROUP_RIDE_RIDER_ID) ? GROUP_PULL_OFF_LANE : GROUP_LINE_LANE;
}

/**
 * The line as the pack layout reads it: every member at its odometer, in the
 * line's lane or the pull-off lane, and the one the rules have aside beside
 * the line. The rider is where their own steer has them.
 */
function packField(
  drawn: Drawn,
  state: GroupRideState,
  rider: MemberView,
  out: ReadonlySet<string>,
  before?: GroupRideState,
): PackRacer[] {
  const aside = state.rotation.aside;
  const field: PackRacer[] = [
    {
      id: GROUP_RIDE_RIDER_ID,
      along: rider.distanceM,
      lateral: drawn.riderSteer.offset,
      // Where they are steering to, so the layout keeps the bots clear of the
      // rider's move across, as a race's does.
      heading: LANE_OFFSETS_METRES[drawn.riderSteer.lane],
      speed: rider.speedMps,
      beside: aside === GROUP_RIDE_RIDER_ID,
    },
  ];
  for (const id of drawn.botIds) {
    const bot = state.bots[id];
    if (bot === undefined) continue;
    const was = before?.bots[id];
    field.push({
      id,
      along: bot.distanceM,
      ...(was === undefined ? {} : { alongBefore: was.distanceM }),
      lateral: out.has(id) ? PULL_OFF_LATERAL : LINE_LATERAL,
      speed: bot.speedMps,
      beside: aside === id,
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
  const riderSteer: SteerState = { lane: GROUP_LINE_LANE, offset: LINE_LATERAL };
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
    // In single file from the press: the bots nose to tail ahead of the rider.
    pack: stepPackLayout(
      packField({ botIds, pack: NO_PACK_LAYOUT, riderSteer }, state, rider, new Set()),
      GROUP_RIDE_RIDER_ID,
      NO_PACK_LAYOUT,
      0,
      undefined,
      true,
    ),
    riderSteer,
    steeredBefore: LINE_LATERAL,
    cues: startCues(0),
    cue: undefined,
    log: [{ at: 0, phase, role, groupSpeed: groupSpeedMps }],
    logCut: false,
    startedAt: undefined,
    sittingIn: false,
    pullOffPressed: false,
    pullOffAsked: false,
    presses: [],
  };
}

/** `session` with `press` kept, at the ride time its last step ended; past the most kept, the cut is said. */
function pressKept(
  session: GroupRideSession,
  press: GroupRidePress['press'],
): Pick<GroupRideSession, 'presses' | 'logCut'> {
  return session.presses.length < GROUP_RIDE_LOG_MOST
    ? {
        presses: [...session.presses, { at: session.state.atMs / 1_000, press }],
        logCut: session.logCut,
      }
    : { presses: session.presses, logCut: true };
}

/**
 * The session after the rider pressed pull off (#3307): on the front, the
 * press waits for the next simulation step, which hands it to the rotation.
 * In any other role, the same session: no rotation starts and nothing moves.
 */
export function pressGroupPullOff(session: GroupRideSession): GroupRideSession {
  if (session.role !== 'on-front' || session.pullOffPressed) return session;
  return {
    ...session,
    ...pressKept(session, 'pull-off'),
    pullOffPressed: true,
    pullOffAsked: true,
    riderSteer: { ...session.riderSteer, lane: GROUP_PULL_OFF_LANE },
  };
}

/** The session with the rider sitting in, or not (#3307): read by every step from the next on. */
export function setGroupSitIn(session: GroupRideSession, sittingIn: boolean): GroupRideSession {
  return session.sittingIn === sittingIn
    ? session
    : { ...session, ...pressKept(session, sittingIn ? 'sit-in' : 'sit-out'), sittingIn };
}

/**
 * The session with where its clock begins on the recording's — the review of
 * PR #3364: the log's `at` is the group's own seconds from the press, and
 * this ties them to the recording's timeline, pauses included on both, so
 * the debrief (#3310) can line the log up with the samples. Fixed from the
 * first frame a recording's elapsed time is read and never moved after, to
 * within the recording's own tick. Usually about nought, as the recording
 * starts at the press; less than nought for a recording begun part-way
 * through the ride.
 *
 * @param recordingElapsedSeconds - the recording's elapsed time now
 *   (`trainer-port.ts` §`rideElapsedSeconds`), or `undefined` with none.
 */
export function groupRideTimed(
  session: GroupRideSession,
  recordingElapsedSeconds: number | undefined,
): GroupRideSession {
  if (session.startedAt !== undefined || recordingElapsedSeconds === undefined) return session;
  return { ...session, startedAt: recordingElapsedSeconds - session.state.atMs / 1_000 };
}

/**
 * Whether the rider has reached the finish of the route the group rides —
 * the review of PR #3364: the plan is one pass of the route, and past its
 * end it would read the last cell for ever, so the group ride ends there.
 * Never on a loop, which has no finish (and is offered no group).
 */
export function groupRideFinished(session: GroupRideSession): boolean {
  const { course } = session.road;
  return !course.loop && session.rider.distanceM >= course.totalDistance;
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
  /**
   * The rider's power now, watts, or `null` with no live reading: what the
   * cue selector reads (#3305). Absent is `null`, and **with no reading no
   * cue is selected** (ADR 0101 D-6.11).
   */
  readonly powerWatts?: number | null | undefined;
  /** The rider's own threshold power, watts, or `null` where they set none (`GamePort.ownThresholdPower`). */
  readonly thresholdWatts?: number | null | undefined;
}

/** A power the cue selector takes: finite watts of at least zero, or `null`. */
function cueWatts(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : null;
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
  let { state, pack, riderDraft, groupSpeedMps, phase, role, logCut, cues, cue } = session;
  let { riderSteer, steeredBefore, pullOffAsked } = session;
  let log = session.log;
  const powerWatts = cueWatts(step.powerWatts);
  const thresholdWatts = cueWatts(step.thresholdWatts);
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
        // #3307: a press since the last frame's steps, which the rotation
        // holds as one flag; the choice, for as long as it is on.
        riderSignal: session.pullOffPressed,
        riderSittingIn: session.sittingIn,
      },
      session.road,
    );
    state = ridden.state;
    riderDraft = ridden.draft[GROUP_RIDE_RIDER_ID] ?? 1;
    groupSpeedMps = ridden.groupSpeedMps;
    // #3305: the rider's cue, on the rotation's answer and the view it read.
    const chosen = stepCues(cues, {
      rotation: ridden.rotation,
      line: ridden.line,
      powerWatts,
      thresholdWatts,
    });
    cues = chosen.state;
    cue = groupRideCueSelected(cue, chosen.cue, ridden.line.atMs / 1_000);
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
    // The drawing, a tick on: the rider where this tick's end has them.
    const end = (tick + 1) / ticks;
    const riderAtEnd: MemberView = {
      distanceM: from.distanceM + (to.distanceM - from.distanceM) * end,
      speedMps: from.speedMps + (to.speedMps - from.speedMps) * end,
    };
    // Who is drawn in the pull-off lane, from the rules' word and the drawing
    // a tick before; and the rider's own lane a tick on, by the steer's step.
    const out = membersOut({ botIds: session.botIds, pack, riderSteer }, state, riderAtEnd);
    steeredBefore = riderSteer.offset;
    if (role !== 'on-front') pullOffAsked = false;
    const lane = pullOffAsked ? GROUP_PULL_OFF_LANE : riderLane(out);
    riderSteer = stepSteer({ ...riderSteer, lane }, SIMULATION_STEP_SECONDS);
    pack = stepPackLayout(
      packField({ botIds: session.botIds, pack, riderSteer }, state, riderAtEnd, out, before),
      GROUP_RIDE_RIDER_ID,
      pack,
      SIMULATION_STEP_SECONDS,
      undefined,
      true,
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
    cues,
    cue,
    pack,
    riderSteer,
    steeredBefore,
    log,
    logCut,
    pullOffPressed: false,
    pullOffAsked,
  };
}

/**
 * The group as the HUD's role strip reads it (#3305, `hud/group-ride-hud.ts`):
 * the rider's place in the line, the gap to the wheel ahead, the pull's
 * seconds left **only while the rider is on the front**, the group's speed
 * now and the average chosen. `live` is whether the rider's power reading is.
 *
 * A rider aside, drifting back or latching on, is out of the line's order
 * until they are on the last wheel: their place is the back, where they are
 * going, and their wheel the last one.
 */
export function groupRideStrip(session: GroupRideSession, live: boolean): GroupRideHud {
  const { rotation, atMs, bots } = session.state;
  const { order, pull } = rotation;
  const at = order.indexOf(GROUP_RIDE_RIDER_ID);
  const wheel = at > 0 ? order[at - 1] : at < 0 ? order[order.length - 1] : undefined;
  const wheelAt = wheel === undefined ? undefined : bots[wheel]?.distanceM;
  const gap = wheelAt === undefined ? undefined : wheelAt - session.rider.distanceM;
  const pulling =
    session.role === 'on-front' && pull !== null && pull.by === GROUP_RIDE_RIDER_ID
      ? Math.max(0, Math.ceil((pull.endsAtMs - atMs) / 1_000))
      : undefined;
  return {
    place: at < 0 ? rotation.line.length : at + 1,
    of: rotation.line.length,
    gapMetres: gap !== undefined && gap > 0 ? gap : undefined,
    pullLeftSeconds: pulling,
    groupSpeed: session.groupSpeedMps,
    targetSpeed: session.choice.targetSpeed,
    live,
  };
}

/**
 * Where a frame draws the group: the bots through the lap race's pack layout
 * in single file, and the rider where the ride has them along the road, in
 * the lane their own steer has them in.
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
    // The rider is never moved along the road: their own drawn odometer. Across
    // it they are where their own steer has them, between the tick before's
    // place and the newest's, as the bots are.
    riderDistance,
    steeredLateral:
      session.riderSteer.offset +
      (session.steeredBefore - session.riderSteer.offset) *
        Math.min(1, Math.max(0, behindSeconds / SIMULATION_STEP_SECONDS)),
    steeringSpeed: sidewaysSpeedOf(session.riderSteer),
    riderHit: undefined,
    raceBots,
  };
}

/**
 * What the ride keeps of its group: `@onyourleft/store` §`RideFacts.groupRide`.
 * `undefined` until the session is tied to a recording ({@link groupRideTimed}):
 * a group with no recording under it has nothing to be kept with.
 */
export function groupRideFact(session: GroupRideSession): GroupRideFact | undefined {
  if (session.startedAt === undefined) return undefined;
  return {
    version: GROUP_RIDE_CODE_VERSION,
    seed: session.seed,
    startedAt: session.startedAt,
    targetSpeed: session.choice.targetSpeed,
    bots: session.choice.bots,
    log: session.log,
    ...(session.logCut ? { logCut: true as const } : {}),
    ...(session.presses.length === 0 ? {} : { presses: session.presses }),
  };
}
