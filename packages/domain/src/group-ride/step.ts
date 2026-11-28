// SPDX-License-Identifier: Apache-2.0

/**
 * **The group stepped through the one physics** — #3300, epic #3296, ADR 0101
 * D-3.2 and D-3.3.
 *
 * {@link stepGroupRide} moves a line of bots one tick on beside the rider. The
 * rotation (#3299) says who is where and the plan (#3298) says how hard the
 * front rides; this file turns both into a power for each bot and rides it
 * through the physics the rider's own ride goes through.
 *
 * ## One draft call, for every rider
 *
 * Each tick makes **one** {@link GroupPhysics.draftFactors} call, over every
 * member's odometer as the tick began, the rider's included. Every bot is
 * ridden at its factor from that call, and the same factors come back in
 * {@link GroupRideTick.draft}, where the rider's own is for the caller's
 * simulation to ride them at. Odometer distances only: no lateral position
 * enters, so a member drawn to one side while it drifts back is simply
 * somewhere in the odometer order (ADR 0038 D-3.4).
 *
 * ## What each bot rides
 *
 * | Seat | Power |
 * |---|---|
 * | on the front | the plan's power at its odometer, with the ledger's correction |
 * | on the front, with anybody ahead of it inside the draft's reach | that, and never more than what holds the speed the rotation asks of it (it eases to nothing for that, and does not sit up) |
 * | on the front of a line that holds for the rider (#3301) | that, and never more than what holds the eased speed; over it, it sits up |
 * | the sweep (#3301) | the wheel rule on a place a wheel gap ahead of the rider, at the rider's speed |
 * | on a wheel | the wheel rule (below) on the member ahead of it in the line, **the rider's wheel where that is the rider** |
 * | aside, drifting back | what holds the speed the rotation asks of it, or that share under the front's own speed where the line is slower |
 * | aside, latching | the wheel rule on the last wheel |
 *
 * The second row is ADR 0101 D-3.5 and D-3.8 on the road: a bot that has just
 * come to the front still has the old front rider's shelter for a few
 * seconds, and a rider who goes off the front shelters it too. At the plan's
 * power in that shelter it would lift, or chase. Held to the speed it is
 * asked, it does neither. A rider beyond the reach gives no shelter, and the
 * front rides the plan's power exactly: it does not chase (#3301).
 *
 * ## The wheel rule is the lap race's, not a copy
 *
 * `lap-race/tactics.ts` §`botWheelWatts` (#2542): a feed-forward, the power
 * that holds the wheel's speed in the bot's own draft on the road under it,
 * and a damped correction toward `BOT_TACTIC_WHEEL_GAP_METRES` inside the
 * 0.3 to 1 m band. The feed-forward carries what the wheel is putting into
 * speeding up, or giving up slowing down, as the lap race's does: over a
 * crest the wheel ahead accelerates at a steady power, and a bot that fed
 * forward its speed alone would be left. A speed the rotation asks for is
 * held by the same rule, as a wheel at that speed with the gap already right.
 *
 * ## A bot cannot brake, so it sits up
 *
 * The physics has no brake: a power is at least zero. Down a steep descent a
 * sheltered bot that coasts is faster than the front that pedals, and it
 * would roll through the wheel ahead. So where the rule asks a bot for **less
 * than zero**, it rides at zero and **gives up shelter**: its drag multiplier
 * rises from its draft factor toward 1, by the share of the open air's extra
 * drag that the missing watts are. Never above 1, and never below its factor:
 * a bot may take less shelter than the model offers and never more.
 * {@link GroupBot.dragFactor} is what it rode at. Accepted by the owner on
 * 2026-11-27 and recorded in ADR 0101's Amendments (its entry of that date,
 * on D-3.2); how it feels is for the harness (#3309) and the owner's ride.
 *
 * ## The rider is read and never written
 *
 * {@link GroupRideInput.rider} is the rider's odometer and speed, from their
 * own simulation. Nothing here returns a speed, a power or a position for the
 * rider: **the rider's physics is never tethered** (the owner's ruling 3, ADR
 * 0101 D-4.5). What comes back for them is a draft factor and a role.
 *
 * ## The physics is the caller's
 *
 * `packages/physics` depends on this package, so this file cannot import its
 * `advance` or `draft.ts`. The caller hands in a {@link GroupPhysics};
 * `@onyourleft/physics` §`groupRidePhysics` is the real one, and
 * `packages/physics/src/group-ride.test.ts` holds this file to the issue's
 * criteria on it.
 *
 * ## No-drop (#3301, ADR 0101 D-4)
 *
 * `no-drop.ts` decides, once a window, where the rider stands, which bot is
 * the sweep and whether the line holds for the rider (`waiting`,
 * `regrouping`) and at what speed, with no lower limit. This file rides it:
 * the held line's speed is what the rotation is told the group rides, so
 * {@link GroupRideTick.groupSpeedMps} is the group's speed now; the sweep
 * rides to a place just ahead of the rider; and the rider's role carries
 * their standing. A bot has no brake here either: a held line loses speed by
 * pedalling nothing and sitting up, as any bot does.
 *
 * After the first wait the line is **paced to the rider** (`no-drop.ts` §5,
 * the owner's ruling of 2026-11-27): it is asked a margin over the rider's
 * remembered pace and rides that as a held line rides its eased speed.
 *
 * **The ledger while the line is eased**, held or paced. An eased tick is
 * booked as paused (`plan.ts` rule 6), and the road the front covers in it is
 * booked at the plan's own time for that road; so is every tick after it
 * until the front is back at {@link GROUP_LEDGER_RESUME_SHARE} of the plan's
 * speed, and so is a rider's own pull under that speed. So the group is
 * exactly as late when it rides the plan again as it was before: **the eased
 * pace is the rider's ride**, none of it is chased back, and a group that
 * crawled forward is not taken to be early either.
 *
 * {@link GroupRoad.noDrop} `false` leaves the rule out: the line never holds,
 * nobody sweeps and every tick is booked, as before #3301.
 *
 * ## Room-portable, seeded, and nothing reaches a trainer
 *
 * Only `+ − × ÷`, comparisons, `Math.min` and `Math.max` (ADR 0067 D-5.2); no
 * clock and no random draw: the only draws are the rotation's, from the
 * line's seed. `step.test.ts` scans this file. Every number that comes out is
 * a bot's or a fact for the screen: none is a target for a trainer.
 */

import {
  BOT_TACTIC_WHEEL_FLOOR_WATTS,
  BOT_TACTIC_WHEEL_GAP_METRES,
  botWheelWatts,
} from '../lap-race/tactics';
import { fullBotEnergy, spendableWatts, stepWbal, type BotEnergy } from '../lap-race/wbal';
import { gradeAt, type RouteProfile } from '../route/profile';
import { lineClimbAheadM } from './climb-ahead';
import { GroupRideError } from './errors';
import {
  noDropRole,
  NO_DROP_REACH_METRES,
  startNoDrop,
  stepNoDrop,
  type NoDropState,
} from './no-drop';
import { stepGroupLedger, GROUP_LEDGER_START, type GroupLedger, type GroupPlan } from './plan';
import type { RiderRole } from './roles';
import {
  ROTATION_EASE_SHARE,
  startRotation,
  stepRotation,
  type LineMember,
  type MemberView,
  type RotationState,
  type RotationStep,
} from './rotation';

/**
 * After the line has been eased for the rider, its ticks are booked as riding
 * again once the front is back at this share of the plan's speed: **98 %**.
 */
export const GROUP_LEDGER_RESUME_SHARE = 0.98;

/**
 * The physics a group's bots ride through, handed in by the caller (see the
 * file comment). Every bot rides at the plan's fixed mass.
 */
export interface GroupPhysics {
  /** Each rider's draft multiplier from every rider's odometer, in the order given: `draft.ts` §`fieldDraftFactors`. */
  draftFactors(distancesMetres: readonly number[]): readonly number[];
  /** What every bot weighs with its bicycle, kilograms. */
  readonly massKilograms: number;
  /** The power, watts, that holds `speedMps` on `gradePercent` at `dragFactor`. Signed. */
  holdWatts(speedMps: number, gradePercent: number, dragFactor: number): number;
  /** A bot `seconds` on from `from`, at `powerWatts` on `gradePercent` and `dragFactor`: the one tick. */
  advance(
    from: MemberView,
    powerWatts: number,
    gradePercent: number,
    seconds: number,
    dragFactor: number,
  ): MemberView;
}

/** The road a group rides and how: fixed for the ride, and not part of its state. */
export interface GroupRoad {
  readonly course: RouteProfile;
  /** The plan solved for this course (#3298). */
  readonly plan: GroupPlan;
  readonly physics: GroupPhysics;
  /** Whether the no-drop rule (#3301) is on; on unless `false`. */
  readonly noDrop?: boolean;
}

/** A group at its start. */
export interface GroupRideSetup {
  /** The members, front first, the rider among them. */
  readonly line: readonly LineMember[];
  /** The line's seed (#3299). */
  readonly seed: number;
  /** The ride time it starts at, ms. */
  readonly atMs: number;
  /** Where the rider is and how fast: the bots form up around them, at their speed. */
  readonly rider: MemberView;
}

/** One bot of the group, between ticks. */
export interface GroupBot {
  /** Odometer, metres. */
  readonly distanceM: number;
  /** Speed, m/s. */
  readonly speedMps: number;
  /** What it rode on the last tick, watts. `null` before the first. */
  readonly powerWatts: number | null;
  /** The drag multiplier it rode at on the last tick: its draft factor, or more where it sat up. 1 before the first. */
  readonly dragFactor: number;
  /** Its W′ balance (`lap-race/wbal.ts`). */
  readonly energy: BotEnergy;
}

/** A group's whole state between ticks: plain data. */
export interface GroupRideState {
  /** Ride time, ms. */
  readonly atMs: number;
  readonly rotation: RotationState;
  readonly ledger: GroupLedger;
  /** The no-drop rule's state (#3301). */
  readonly noDrop: NoDropState;
  /**
   * Where the front was as the last tick began, metres, if that tick was not
   * booked as riding (the line eased for the rider, or getting back up to
   * speed): the road covered since is booked at the plan's time. `null`
   * after a tick that was ridden.
   */
  readonly heldFromM: number | null;
  /** Every bot, by id. Never the rider. */
  readonly bots: Readonly<Record<string, GroupBot>>;
  /**
   * The rider's speed as the last tick began and how long that tick was, so
   * the bot on their wheel reads whether they are speeding up or slowing.
   * `null` before the first tick. Read from the rider, never written to them.
   */
  readonly riderWas: { readonly speedMps: number; readonly elapsedSeconds: number } | null;
}

/** What one tick reads besides the state. */
export interface GroupRideInput {
  /** How much ride time the tick covers, seconds: above zero. */
  readonly elapsedSeconds: number;
  /** The rider's odometer and speed as the tick begins. Read, never written. */
  readonly rider: MemberView;
  /** Whether the rider pressed pull off since the last tick. */
  readonly riderSignal?: boolean;
  /** Whether the rider has chosen to sit in. */
  readonly riderSittingIn?: boolean;
  /**
   * Whether the rider has stopped pedalling, or has no power reading: the
   * group waits (#3301, ADR 0101 D-4.4 and D-6.11). The caller's word, from
   * the ride's own pause and sensor state; absent, riding.
   */
  readonly riderStopped?: boolean;
  /** The tightest bend radius on the road just ahead of the front, metres; absent or `null`, straight. */
  readonly bendRadiusM?: number | null;
}

/** One tick's answer. */
export interface GroupRideTick {
  readonly state: GroupRideState;
  /**
   * The rotation's answer for the tick: roles, the speeds asked of the bots,
   * and facts for the cues. The rider's role carries their standing (#3301):
   * `gapped`, `off-the-back` or `off-the-front` where they are off the line.
   */
  readonly rotation: RotationStep;
  /**
   * Every member's draft multiplier this tick, by id, **the rider's
   * included**: the one call the bots were ridden at.
   */
  readonly draft: Readonly<Record<string, number>>;
  /**
   * The group's speed now, m/s: what the plan asks of the line on the road
   * under the front, or less where the line holds for the rider (#3301).
   */
  readonly groupSpeedMps: number;
}

/** The rider's id in `line`, refused unless there is exactly one. */
function riderIdOf(line: readonly LineMember[]): string {
  const riders = line.filter((member) => member.kind === 'rider');
  if (riders.length !== 1) {
    throw new GroupRideError('line-invalid', 'a group ride needs exactly one rider in its line');
  }
  return (riders[0] as LineMember).id;
}

/**
 * The group at its start: the line `forming`, each bot on its seat
 * `BOT_TACTIC_WHEEL_GAP_METRES` from the next with the rider's seat at the
 * rider, every bot at the rider's speed and with a full reserve.
 *
 * @throws {GroupRideError} `line-invalid` for a line without exactly one
 *   rider, and as `startRotation`.
 */
export function startGroupRide(setup: GroupRideSetup): GroupRideState {
  const rotation = startRotation({ line: setup.line, seed: setup.seed, atMs: setup.atMs });
  const riderId = riderIdOf(setup.line);
  const riderSeat = setup.line.findIndex((member) => member.id === riderId);
  const bots: Record<string, GroupBot> = {};
  setup.line.forEach((member, seat) => {
    if (member.kind !== 'bot') return;
    bots[member.id] = {
      distanceM: setup.rider.distanceM + (riderSeat - seat) * BOT_TACTIC_WHEEL_GAP_METRES,
      speedMps: setup.rider.speedMps,
      powerWatts: null,
      dragFactor: 1,
      energy: fullBotEnergy(member.capacity),
    };
  });
  return {
    atMs: setup.atMs,
    rotation,
    ledger: GROUP_LEDGER_START,
    noDrop: startNoDrop(setup.atMs),
    heldFromM: null,
    bots,
    riderWas: null,
  };
}

/**
 * The group one tick on. See the file comment for what each bot rides.
 *
 * @throws {GroupRideError} `view-out-of-range` for a tick that does not cover
 *   a finite time above zero, and as `stepRotation` for a rider who is not
 *   somewhere finite.
 */
export function stepGroupRide(
  state: GroupRideState,
  input: GroupRideInput,
  road: GroupRoad,
): GroupRideTick {
  const elapsed = input.elapsedSeconds;
  if (!Number.isFinite(elapsed) || !(elapsed > 0)) {
    throw new GroupRideError(
      'view-out-of-range',
      'a group ride tick must cover a finite number of seconds above zero',
    );
  }
  const { course, plan, physics } = road;
  const line = state.rotation.line;
  const riderId = riderIdOf(line);
  const members: Record<string, MemberView> = { [riderId]: input.rider };
  const energy: Record<string, BotEnergy> = {};
  for (const [id, bot] of Object.entries(state.bots)) {
    members[id] = { distanceM: bot.distanceM, speedMps: bot.speedMps };
    energy[id] = bot.energy;
  }
  const at = (id: string): MemberView => members[id] as MemberView;

  // The rotation decides on the line as the tick began. A rider who is not on
  // the route yet is still on a line: the road is read where the route starts.
  const frontM = at(state.rotation.order[0] as string).distanceM;
  const planSpeedMps: number = plan.speedNowAt(frontM);

  // No-drop decides first, on the same windows: the rider's seat, the sweep,
  // and whether the line holds for the rider and how fast.
  let noDrop = state.noDrop;
  let lineBefore = state.rotation;
  if (road.noDrop !== false) {
    const decided = stepNoDrop(state.noDrop, {
      atMs: state.atMs,
      rotation: state.rotation,
      members,
      groupSpeedMps: planSpeedMps,
      course,
      riderStopped: input.riderStopped ?? false,
    });
    noDrop = decided.state;
    lineBefore = decided.rotation;
  }
  // Eased: held for the rider, or paced to them (#3301).
  const easing = noDrop.easedSpeedMps !== null;
  const groupSpeedMps = noDrop.easedSpeedMps ?? planSpeedMps;

  // The road a held line covered in the last tick, at the plan's own time for it.
  const ledger =
    state.heldFromM === null
      ? state.ledger
      : stepGroupLedger(
          state.ledger,
          Math.max(0, plan.plannedSecondsAt(frontM) - plan.plannedSecondsAt(state.heldFromM)),
          false,
        );

  // The eased pace is the rider's ride, not time the plan lost: an eased tick
  // is not booked as riding, and nor is one after it until the front is back
  // at the plan's speed, so getting back up to speed is not chased either.
  // A rider on the front who is under the group's speed is riding their own
  // pull: that is theirs too.
  const frontId = state.rotation.order[0] as string;
  const underSpeed = at(frontId).speedMps < GROUP_LEDGER_RESUME_SHARE * planSpeedMps;
  const unbooked =
    road.noDrop !== false &&
    (easing || (underSpeed && (state.heldFromM !== null || frontId === riderId)));

  const decision = stepRotation(lineBefore, {
    atMs: state.atMs,
    groupSpeedMps,
    members,
    energy,
    climbAheadM: lineClimbAheadM(course, frontM),
    bendRadiusM: input.bendRadiusM ?? null,
    riderSignal: input.riderSignal ?? false,
    riderSittingIn: input.riderSittingIn ?? false,
  });
  const riderRole = decision.roles[riderId] as RiderRole;
  const standingRole = noDropRole(noDrop.standing, riderRole);
  const rotation: RotationStep =
    standingRole === riderRole
      ? decision
      : { ...decision, roles: { ...decision.roles, [riderId]: standingRole } };

  // One draft call for the whole line, the rider included.
  const ids = line.map((member) => member.id);
  const factors = physics.draftFactors(ids.map((id) => at(id).distanceM));
  const draft: Record<string, number> = {};
  ids.forEach((id, index) => {
    draft[id] = factors[index] as number;
  });

  /**
   * What the member `id` is putting into speeding up, watts at a bot's mass,
   * or below zero what it gives up slowing down. A bot's is its power less
   * what its speed costs it on its own road at the drag it rode
   * (`@onyourleft/physics` §`readWheel`, #2542). The rider's is read off
   * their speed alone, the change over the last tick at a bot's mass: their
   * power is not an input here, and a rider with no power reading is still a
   * wheel. 0 before the first tick.
   */
  const surplusOf = (id: string): number => {
    const wheel = at(id);
    if (id === riderId) {
      const was = state.riderWas;
      if (was === null) return 0;
      const gained = (wheel.speedMps - was.speedMps) / was.elapsedSeconds;
      return physics.massKilograms * gained * wheel.speedMps;
    }
    const bot = state.bots[id] as GroupBot;
    if (bot.powerWatts === null) return 0;
    const road: number = gradeAt(course, wheel.distanceM);
    return bot.powerWatts - physics.holdWatts(wheel.speedMps, road, bot.dragFactor);
  };

  const { order } = rotation.state;
  const bots: Record<string, GroupBot> = {};
  for (const member of line) {
    if (member.kind !== 'bot') continue;
    const id = member.id;
    const own = at(id);
    const k = draft[id] as number;
    const grade: number = gradeAt(course, own.distanceM);
    const cpWatts = member.capacity.cpWatts;
    /** What holds `speedMps`: the wheel rule on a wheel at that speed, the gap already right. */
    const held = (speedMps: number): number =>
      botWheelWatts({
        gapMetres: BOT_TACTIC_WHEEL_GAP_METRES,
        closingMetresPerSecond: own.speedMps - speedMps,
        holdWatts: physics.holdWatts(speedMps, grade, k),
        cpWatts,
      });
    /** The wheel rule on `wheelId`. */
    const onWheel = (wheelId: string): number => {
      const wheel = at(wheelId);
      return botWheelWatts({
        gapMetres: wheel.distanceM - own.distanceM,
        closingMetresPerSecond: own.speedMps - wheel.speedMps,
        holdWatts: physics.holdWatts(wheel.speedMps, grade, k) + surplusOf(wheelId),
        cpWatts,
      });
    };
    const seat = order.indexOf(id);
    const asked = rotation.demands[id] as number;
    let wanted: number;
    if (id === noDrop.sweep) {
      // The sweep: a wheel gap ahead of the rider, at the rider's speed. The
      // wheel rule on a place two gaps up the road from them.
      const rider = at(riderId);
      wanted = botWheelWatts({
        gapMetres: rider.distanceM + 2 * BOT_TACTIC_WHEEL_GAP_METRES - own.distanceM,
        closingMetresPerSecond: own.speedMps - rider.speedMps,
        holdWatts: physics.holdWatts(rider.speedMps, grade, k) + surplusOf(riderId),
        cpWatts,
      });
    } else if (seat === 0) {
      const planned: number = plan.powerAt(own.distanceM, ledger);
      if (easing) {
        // A held or paced line rides the eased speed, and sits up when it is over it.
        wanted = Math.min(planned, held(asked));
      } else {
        const sheltered = ids.some((other) => {
          const ahead = at(other).distanceM - own.distanceM;
          return ahead > 0 && ahead <= NO_DROP_REACH_METRES;
        });
        wanted = sheltered ? Math.min(planned, Math.max(0, held(asked))) : planned;
      }
    } else if (seat > 0) {
      wanted = onWheel(order[seat - 1] as string);
    } else {
      // Aside: toward the last wheel from the moment it pulls off, so it
      // arrives behind it at the line's speed. Drifting back, it eases no
      // more than the rotation asks, and by that share of the front's own
      // speed where the line is slower than it is asked: behind a rider on
      // the front who cannot hold the group's speed it still drops back
      // (#3301), and the line is not left waiting for a change to finish.
      const last = onWheel(order[order.length - 1] as string);
      const drift = Math.min(asked, at(order[0] as string).speedMps * (1 - ROTATION_EASE_SHARE));
      wanted = rotation.roles[id] === 'latching' ? last : Math.max(last, held(drift));
    }
    const powerWatts = spendableWatts(
      member.capacity,
      energy[id] as BotEnergy,
      wanted,
      elapsed,
      BOT_TACTIC_WHEEL_FLOOR_WATTS,
    );
    // Asked for less than nothing, it sits up: the share of the open air's
    // extra drag that the missing watts are.
    let dragFactor = k;
    if (wanted < 0 && k < 1) {
      const open =
        physics.holdWatts(own.speedMps, grade, 1) - physics.holdWatts(own.speedMps, grade, k);
      if (open > 0) dragFactor = k + (1 - k) * Math.min(1, -wanted / open);
    }
    const next = physics.advance(own, powerWatts, grade, elapsed, dragFactor);
    bots[id] = {
      distanceM: next.distanceM,
      speedMps: next.speedMps,
      powerWatts,
      dragFactor,
      energy: stepWbal(member.capacity, energy[id] as BotEnergy, powerWatts, elapsed),
    };
  }

  return {
    state: {
      atMs: state.atMs + elapsed * 1_000,
      rotation: rotation.state,
      ledger: stepGroupLedger(ledger, elapsed, unbooked),
      noDrop,
      heldFromM: unbooked ? frontM : null,
      bots,
      riderWas: { speedMps: input.rider.speedMps, elapsedSeconds: elapsed },
    },
    rotation,
    draft,
    groupSpeedMps,
  };
}
