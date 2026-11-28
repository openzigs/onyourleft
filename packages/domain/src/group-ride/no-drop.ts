// SPDX-License-Identifier: Apache-2.0

/**
 * **The no-drop rule** — #3301, epic #3296, the owner's ruling 3 of
 * 2026-11-26 and ADR 0101 D-4.
 *
 * *A sweep bot drops back to pace the rider, and the group eases and regroups
 * for as long as needed, with no lower limit. The rider's own physics is
 * never tethered.*
 *
 * One pure function, {@link stepNoDrop}, which **decides once per decision
 * window** (`ROTATION_WINDOW_MS`, ADR 0067 D-6) on the same instants as the
 * rotation and returns the last decision unchanged inside one. It reads
 * odometers and speeds and answers four things:
 *
 * ## 1. Where the rider stands ({@link RiderStanding})
 *
 * Measured from **the last bot of the line ahead of the rider**: the bot in
 * the seat ahead of theirs, or the line's last wheel for a rider who is aside
 * after a pull. The sweep is not counted while it is back with the rider.
 *
 * | Standing | When |
 * |---|---|
 * | `gapped` | more than {@link NO_DROP_GAPPED_METRES} behind it, inside the draft's reach |
 * | `off-the-back` | more than {@link NO_DROP_REACH_METRES} behind it |
 * | `off-the-front` | in the line, not on the front, and more than the wheel band ahead of every bot of it |
 * | `with` | anything else, a rider on the front included |
 *
 * A rider at the back of the line, the usual place to lose a wheel, is
 * measured from the line's last bot. Bots behind a rider in the middle of the
 * line stay on the rider's wheel, as `step.ts` has always had them.
 *
 * **A rider who goes off the front gives up their seat** (one who only
 * overlaps the front, inside the wheel band, keeps it): they move to the
 * back of the order, so the bots that were behind them close up on a bot's
 * wheel and none follows the rider up the road.
 *
 * ## 2. The sweep
 *
 * While the rider is `gapped` or `off-the-back`, that last bot ahead of them
 * is the **sweep**: `step.ts` rides it to sit just ahead of the rider, so
 * there is a wheel to take. Exactly one, and only where another bot is ahead
 * of it to be the line. The rest of the line does not ease for a `gapped`
 * rider.
 *
 * ## 3. Whether the line holds for the rider ({@link NoDropHold})
 *
 * | Hold | Begins | Ends |
 * |---|---|---|
 * | `waiting` | the rider is `off-the-back`, or has stopped (below) | the rider is back on a wheel (`with`) and riding |
 * | `regrouping` | the front comes over the top of a climb with the rider `gapped` or `off-the-back` | the rider has been inside the reach for {@link NO_DROP_SETTLE_MS} |
 *
 * It moves the rotation's phase to match (`roles.ts` declared both for this
 * file): into the hold from any phase, `forming` included, and out of it to
 * `steady`, or to `changing` where a member was aside when the hold began,
 * so the change it interrupted finishes and nobody is lost from the order.
 * Over a crest a `waiting` line becomes a `regrouping` one.
 *
 * A `waiting` line holds until the rider is back on a wheel, not merely
 * inside the reach. Released at 30 m it rides away at once and waits again,
 * and a rider who cannot hold the pace spends the ride at the edge of the
 * reach; the scripted rides in `packages/physics/src/group-no-drop.test.ts`
 * measured that.
 *
 * **The rider who stops**: {@link NoDropView.riderStopped} is the caller's
 * word that the rider has stopped pedalling, or that there is no power
 * reading (ADR 0101 D-4.4, D-6.11). The group waits from that window, wherever
 * the rider is in the line, unless they are off the front.
 *
 * ## 4. How fast a held line rides: no lower limit
 *
 * `rider's speed × (1 − share)`, never above the plan's speed, where the
 * share grows with the rider's time gap to the line and is whole at
 * {@link NO_DROP_FULL_EASE_SECONDS}. **There is no floor**: a rider at a
 * crawl has a crawling group, and a stopped rider a stopped one. Under the
 * rider's own speed whenever they are behind, so they come back. Unlike the
 * pacer's 20 % (`pacer/device-rule.ts`, ADR 0083 D-1.3), which is unchanged
 * for the pacer.
 *
 * ## 5. The rider's pace, remembered: no ride-away-and-wait cycle
 *
 * The owner's ruling of 2026-11-27 (ADR 0101's Amendments): *after the first
 * wait, the group slows to the rider's sustained pace, so the rider stays on
 * a wheel.* Without it a line released from a wait rode away at the plan's
 * pace and waited again, for the whole ride.
 *
 * {@link NoDropState.paceShare} is what the rider can hold, as a share of the
 * plan's speed. It is **seeded by the first wait** (or regroup) with the
 * speed of a rider who is riding, and from then on the line is asked
 * `plan's speed × pace × (1 + margin) × (1 − give)`, never above the plan's:
 *
 * - the margin ({@link NO_DROP_PACE_MARGIN}) keeps the line a touch ahead of
 *   the pace;
 * - the give grows with how far off the wheel the rider is, whole at
 *   {@link NO_DROP_PACE_GAP_SECONDS} of their own speed (and never nearer
 *   than {@link NO_DROP_GAPPED_METRES}), so the line comes back to a rider
 *   who is slipping off long before the reach;
 * - **while the line holds, there is no give** (#3415): a held line rides §4's
 *   ease, never above `plan's speed × pace × (1 + margin)`. A wait begins
 *   beyond the reach, where the give is always whole, so with it every wait
 *   after its first window was asked for nothing: the line stood still on the
 *   road while the rider rode back to it, and the rider rolled through it.
 *
 * **How the pace moves.** A rider with the line rides the line's own speed,
 * so their speed says nothing of what they can hold, and a mean fed on it
 * feeds on itself: at 2 m behind the wheel the line was asked a quarter of a
 * metre a second within five minutes. So, once a decision window:
 *
 * | The rider | The pace |
 * |---|---|
 * | with the line, which is eased, and keeping their gap (its mean over {@link NO_DROP_PACE_SECONDS} is no more than {@link NO_DROP_PACE_SLIP_METRES} over its mean over {@link NO_DROP_PACE_MEMORY_SECONDS}) | rises, by the margin over {@link NO_DROP_PACE_SECONDS} |
 * | with the line, which is eased, and losing ground (a sustained loss: more than that) | comes down, {@link NO_DROP_PACE_SLIP_STEP} times as fast |
 * | with the line at the plan's speed | stays |
 * | `gapped` or `off-the-back` | follows their own speed, a running mean over {@link NO_DROP_PACE_SECONDS} |
 *
 * So **it recovers toward the plan for as long as the rider keeps up**, at any
 * gap inside the wheel band, and rides the plan again once they hold it. It
 * may pass 1, to {@link NO_DROP_PACE_MOST}: a rider who follows well back,
 * where the line gives speed away, still gets the plan's speed.
 *
 * A rider who has stopped does not move the pace: a stop is not a pace. A
 * one-off gap still ends in a wait or a regroup, as above.
 *
 * ## What it never does
 *
 * It returns nothing for the rider but a standing: no speed, no power, no
 * position, no draft. **The rider's physics is never tethered** (ADR 0101
 * D-4.5). Every number here is a bot's, and none is a target for a trainer.
 *
 * ## Room-portable and seeded
 *
 * Only `+ − × ÷`, comparisons, `Math.min` and `Math.max` (ADR 0067 D-5.2);
 * no clock and no random draw. It makes no draw at all, so the line's seed is
 * the rotation's alone and a ride replays from it. `no-drop.test.ts` scans
 * this file.
 *
 * Every figure is *proposed*: a feel parameter for the harness (#3309) and
 * the owner's ride.
 */

import { BOT_TACTIC_WHEEL_GAP_METRES } from '../lap-race/tactics';
import { pacerTerrainAt } from '../pacer/terrain-rule';
import type { RouteProfile } from '../route/profile';
import { GroupRideError } from './errors';
import { unknownValue, type LinePhase, type RiderRole } from './roles';
import {
  ROTATION_RIDER_WHEEL_BAND_METRES,
  ROTATION_WHEEL_BAND_METRES,
  ROTATION_WINDOW_MS,
  type MemberView,
  type RotationState,
} from './rotation';

/**
 * The draft's reach, odometer metres: **30**. `@onyourleft/physics`
 * §`DRAFT_REACH_METRES`, which this package cannot import;
 * `packages/physics/src/group-no-drop.test.ts` holds the two equal.
 */
export const NO_DROP_REACH_METRES = 30;

/**
 * A rider this far off the wheel, odometer metres, is `gapped`: **5 m**, the
 * rotation's own band for a rider on a wheel (`ROTATION_RIDER_WHEEL_BAND_METRES`).
 */
export const NO_DROP_GAPPED_METRES = ROTATION_RIDER_WHEEL_BAND_METRES;

/**
 * The time gap, seconds, at which a held line's ease is whole and it stops:
 * **10 s**, the gap the pacer's own ease is whole at (`PACER_GAP_FULL_S`).
 * Under it the share is in proportion.
 */
export const NO_DROP_FULL_EASE_SECONDS = 10;

/** How long a regrouping line stays eased once the rider is inside the reach, ms: **10 s**. */
export const NO_DROP_SETTLE_MS = 10_000;

/**
 * The time constant of the rider's remembered pace, seconds: **20 s**. Each
 * 1 s decision moves it a twentieth of its step: of the way to the speed of
 * a rider off the wheel, or of the margin for one with the line.
 */
export const NO_DROP_PACE_SECONDS = 20;

/** A paced line rides this share above the rider's remembered pace: **5 %**. */
export const NO_DROP_PACE_MARGIN = 0.05;

/**
 * A paced line gives all of its speed back to a rider this far off the wheel,
 * in seconds of the rider's own speed: **2 s**, and at least
 * {@link NO_DROP_GAPPED_METRES}. Under it, in proportion.
 */
export const NO_DROP_PACE_GAP_SECONDS = 2;

/**
 * The time constant of the long running mean of the rider's gap
 * ({@link NoDropState.longGapM}), seconds: **120**, six times the pace's own.
 * The short mean ({@link NoDropState.shortGapM}) is over
 * {@link NO_DROP_PACE_SECONDS}. A gap that swings out and back within a
 * minute or so moves the long mean hardly at all and the short one by less
 * than its swing, so it is a wander about a steady gap and not a loss.
 */
export const NO_DROP_PACE_MEMORY_SECONDS = 120;

/**
 * A rider with a paced line is losing ground when the short mean of their gap
 * is more than this over its long mean, metres: **0.5 m**. A gap that wanders
 * about a steady value grows in about half the windows, so one window's
 * growth, or a new furthest gap, is not losing ground: a sustained loss is.
 * A gap that keeps growing passes it once it has grown by 0.5 cm a second
 * for long enough: the two means lag it by 20 s and 120 s of its growth.
 */
export const NO_DROP_PACE_SLIP_METRES = 0.5;

/**
 * A rider losing ground brings the remembered pace down this many times as
 * fast as one keeping their gap brings it up: **1.5**. More, and a rider who
 * follows well back never has the line at the plan's speed again; less, and a
 * rider at their limit settles further off the wheel.
 */
export const NO_DROP_PACE_SLIP_STEP = 1.5;

/**
 * The most the remembered pace may be, as a share of the plan's speed: **2**.
 * Over 1 so that a rider who follows well back, where the line gives speed
 * away, still has it at the plan's speed.
 */
export const NO_DROP_PACE_MOST = 2;

/** Where the rider stands to the line. */
export const RIDER_STANDINGS = ['with', 'gapped', 'off-the-back', 'off-the-front'] as const;

/** One of {@link RIDER_STANDINGS}. */
export type RiderStanding = (typeof RIDER_STANDINGS)[number];

/** The phase a line holds for the rider in. */
export type NoDropHold = Extract<LinePhase, 'waiting' | 'regrouping'>;

/** The rule's whole state between windows: plain data. */
export interface NoDropState {
  /** The first instant the next decision may be made at. */
  readonly nextWindowAtMs: number;
  /** Whether the line holds for the rider, and how. */
  readonly hold: NoDropHold | null;
  readonly standing: RiderStanding;
  /** The bot that is back with the rider, or `null`. */
  readonly sweep: string | null;
  /**
   * The speed the line is asked to ride where that is not the plan's, m/s:
   * a held line's, or a line paced to the rider. `null` at the plan's speed.
   * No floor.
   */
  readonly easedSpeedMps: number | null;
  /**
   * The rider's remembered pace, as a share of the plan's speed, at most
   * {@link NO_DROP_PACE_MOST}: over 1 where the line gives speed away to a
   * rider who follows well back. `null` until the first wait.
   */
  readonly paceShare: number | null;
  /** How far the rider was behind the line at the last decision, metres; 0 when not behind it. */
  readonly behindM: number;
  /**
   * The running mean of how far the rider has been behind the line over
   * {@link NO_DROP_PACE_SECONDS}, metres; off the wheel, the gap itself.
   */
  readonly shortGapM: number;
  /**
   * The same over {@link NO_DROP_PACE_MEMORY_SECONDS}, metres; off the wheel,
   * the gap itself, so a rider back on from a gap settles at their own
   * distance without that reading as a loss. A rider with the line is losing
   * ground when {@link shortGapM} is more than
   * {@link NO_DROP_PACE_SLIP_METRES} over it.
   */
  readonly longGapM: number;
  /** Since when a regrouping line's rider has been inside the reach, or `null`. */
  readonly insideSinceMs: number | null;
  /** Whether the front was over the top of a climb at the last window. */
  readonly overTheTop: boolean;
}

/** What the rule reads. */
export interface NoDropView {
  /** Ride time, ms. */
  readonly atMs: number;
  /** The line as the tick began. */
  readonly rotation: RotationState;
  /** Every member's odometer and speed, by id. */
  readonly members: Readonly<Record<string, MemberView>>;
  /** The speed the plan asks of the line now, m/s: a held line never rides above it. */
  readonly groupSpeedMps: number;
  /** The road, for the top of a climb. */
  readonly course: RouteProfile;
  /** Whether the rider has stopped pedalling or has no power reading. The caller's word. */
  readonly riderStopped: boolean;
}

/** One step's answer. */
export interface NoDropStep {
  readonly state: NoDropState;
  /** The line after the rule: the rider's seat, and the phase it holds in. */
  readonly rotation: RotationState;
}

/** The rule before the ride's first window. */
export function startNoDrop(atMs: number): NoDropState {
  return {
    nextWindowAtMs: atMs,
    hold: null,
    standing: 'with',
    sweep: null,
    easedSpeedMps: null,
    paceShare: null,
    behindM: 0,
    shortGapM: 0,
    longGapM: 0,
    insideSinceMs: null,
    overTheTop: false,
  };
}

/**
 * The rider's role with their standing: `off-the-back` and `off-the-front`
 * in place of any role, and `gapped` in place of a wheel's. A rider who is
 * aside after a pull keeps `drifting-back` or `latching` while they are
 * inside the reach, which is what the cues for a drift back read.
 */
export function noDropRole(standing: RiderStanding, role: RiderRole): RiderRole {
  switch (standing) {
    case 'with':
      return role;
    case 'off-the-back':
    case 'off-the-front':
      return standing;
    case 'gapped':
      return role === 'drifting-back' || role === 'latching' ? role : 'gapped';
    default:
      return unknownValue(standing);
  }
}

/** `mean` a decision window's share of the way to `value`, over `seconds`. */
function meanOf(mean: number, value: number, seconds: number): number {
  return mean + (value - mean) * (ROTATION_WINDOW_MS / (1_000 * seconds));
}

/**
 * The rule one step on. Inside a decision window it returns the last decision
 * and the line unchanged; a line with no rider is never held.
 *
 * @throws {GroupRideError} `view-out-of-range` for a rider who is not
 *   somewhere finite.
 */
export function stepNoDrop(state: NoDropState, view: NoDropView): NoDropStep {
  const { rotation } = view;
  if (view.atMs < state.nextWindowAtMs) return { state, rotation };
  const following = state.nextWindowAtMs + ROTATION_WINDOW_MS;
  const nextWindowAtMs = following > view.atMs ? following : view.atMs + ROTATION_WINDOW_MS;
  const riderId = rotation.line.find((member) => member.kind === 'rider')?.id;
  if (riderId === undefined) return { state: { ...state, nextWindowAtMs }, rotation };
  const at = (id: string): MemberView => view.members[id] as MemberView;
  const rider = view.members[riderId];
  if (
    rider === undefined ||
    !Number.isFinite(rider.distanceM) ||
    !Number.isFinite(rider.speedMps) ||
    rider.speedMps < 0
  ) {
    throw new GroupRideError(
      'view-out-of-range',
      'the rider needs a finite odometer and a finite speed of at least zero',
    );
  }
  const frontId = rotation.order[0] as string;
  const frontM = at(frontId).distanceM;

  /**
   * Whether the rider is off the front of `line`, the bots in the seats ahead
   * of theirs: more than the wheel band up the road from every one of them.
   * One who only overlaps the front keeps their seat; and at a crawl, where
   * the line bunches, it is the furthest bot that counts and not the front's.
   */
  const pastEvery = (line: readonly string[]): boolean =>
    line.every((id) => rider.distanceM > at(id).distanceM + ROTATION_WHEEL_BAND_METRES);

  // A rider who goes off the front gives up their seat.
  let order = rotation.order;
  const seat = order.indexOf(riderId);
  if (seat > 0 && seat < order.length - 1 && pastEvery(order.slice(0, seat))) {
    order = [...order.filter((id) => id !== riderId), riderId];
  }

  // Where the rider stands, from the last bot of the line ahead of them, the
  // sweep not counted. Aside, the whole line is ahead of where they rejoin.
  const seatNow = order.indexOf(riderId);
  const ahead = seatNow < 0 ? order : order.slice(0, seatNow);
  const last = ahead[ahead.length - 1];
  const sweeper = ahead.length > 1 ? (last as string) : null;
  let standing: RiderStanding = 'with';
  let behindM = 0;
  if (last !== undefined) {
    if (seatNow > 0 && pastEvery(ahead)) {
      standing = 'off-the-front';
    } else {
      const tail =
        sweeper !== null && state.sweep === sweeper ? (ahead[ahead.length - 2] as string) : last;
      behindM = Math.max(0, at(tail).distanceM - rider.distanceM);
      standing =
        behindM > NO_DROP_REACH_METRES
          ? 'off-the-back'
          : behindM > NO_DROP_GAPPED_METRES
            ? 'gapped'
            : 'with';
    }
  }
  const behind = standing === 'gapped' || standing === 'off-the-back';
  const sweep = behind ? sweeper : null;

  // Whether the line holds for the rider.
  const overTheTop = pacerTerrainAt(view.course, frontM) === 'over-the-top';
  const waits =
    standing === 'off-the-back' ||
    (state.hold === 'waiting' && standing === 'gapped') ||
    (view.riderStopped && standing !== 'off-the-front');
  let hold: NoDropHold | null;
  let insideSinceMs: number | null = null;
  if (state.hold === 'regrouping') {
    insideSinceMs = standing === 'off-the-back' ? null : (state.insideSinceMs ?? view.atMs);
    if (insideSinceMs !== null && view.atMs - insideSinceMs >= NO_DROP_SETTLE_MS) {
      hold = waits ? 'waiting' : null;
      insideSinceMs = null;
    } else {
      hold = 'regrouping';
    }
  } else if (overTheTop && !state.overTheTop && behind) {
    hold = 'regrouping';
    insideSinceMs = standing === 'off-the-back' ? null : view.atMs;
  } else {
    hold = waits ? 'waiting' : null;
  }

  // The gap's two running means. Off the wheel each is the gap: the rider's
  // pace is read from their speed there, and coming back on is not losing ground.
  const shortGapM = behind ? behindM : meanOf(state.shortGapM, behindM, NO_DROP_PACE_SECONDS);
  const longGapM = behind ? behindM : meanOf(state.longGapM, behindM, NO_DROP_PACE_MEMORY_SECONDS);

  // The rider's pace, remembered from the first wait on. A stop is not a pace,
  // and a plan that asks no speed has no share to take.
  const planMps = view.groupSpeedMps;
  let paceShare = state.paceShare;
  if (!view.riderStopped && planMps > 0) {
    const step = ROTATION_WINDOW_MS / (1_000 * NO_DROP_PACE_SECONDS);
    if (paceShare === null) {
      if (hold !== null && behind) paceShare = Math.min(1, rider.speedMps / planMps);
    } else if (behind) {
      // Off the wheel: what they are riding is what they can hold.
      paceShare += (Math.min(1, rider.speedMps / planMps) - paceShare) * step;
    } else if (state.easedSpeedMps !== null) {
      // With the line while it is eased for them. Their speed is the line's
      // own there, so it says nothing of what they can hold: read whether
      // they keep the gap, over more than one window. Keeping it, the pace
      // rises by its margin; losing ground, it comes down by half as much again.
      const keeping = shortGapM <= longGapM + NO_DROP_PACE_SLIP_METRES;
      const moved =
        paceShare * (1 + (keeping ? step : -step * NO_DROP_PACE_SLIP_STEP) * NO_DROP_PACE_MARGIN);
      paceShare = Math.min(NO_DROP_PACE_MOST, moved);
    }
  }

  // How fast the line rides where that is under the plan's speed. Held: under
  // the rider's own speed while they are behind, by a share that grows with
  // their time gap. Paced: a margin over the rider's remembered pace, given
  // back as they come off the wheel. No floor. Never for a rider off the front.
  let asked = planMps;
  if (standing !== 'off-the-front') {
    if (hold !== null) {
      const whole = rider.speedMps * NO_DROP_FULL_EASE_SECONDS;
      const share = behindM >= whole ? 1 : behindM / whole;
      asked = Math.min(asked, rider.speedMps * (1 - share));
    }
    // The pace as it was remembered before this window: the wait that seeds
    // it is ridden as a wait, and so is every window of every hold. A held
    // line gives nothing back, as the hold's ease is already the share of the
    // gap, and only the margin over the pace caps it (#3415).
    if (state.paceShare !== null) {
      const off = Math.max(0, behindM - BOT_TACTIC_WHEEL_GAP_METRES);
      const whole = Math.max(rider.speedMps * NO_DROP_PACE_GAP_SECONDS, NO_DROP_GAPPED_METRES);
      const give = hold !== null ? 0 : off >= whole ? 1 : off / whole;
      asked = Math.min(asked, planMps * state.paceShare * (1 + NO_DROP_PACE_MARGIN) * (1 - give));
    }
  }
  const easedSpeedMps = hold !== null || asked < planMps ? asked : null;

  // The line's phase follows the hold.
  const wasHeld = rotation.phase === 'waiting' || rotation.phase === 'regrouping';
  const phase: LinePhase =
    hold ?? (wasHeld ? (rotation.aside === null ? 'steady' : 'changing') : rotation.phase);
  const line =
    order === rotation.order && phase === rotation.phase ? rotation : { ...rotation, order, phase };

  return {
    state: {
      nextWindowAtMs,
      hold,
      standing,
      sweep,
      easedSpeedMps,
      paceShare,
      behindM,
      shortGapM,
      longGapM,
      insideSinceMs,
      overTheTop,
    },
    rotation: line,
  };
}
