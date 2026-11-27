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
 * | `off-the-front` | in the line, not on the front, and ahead of the front |
 * | `with` | anything else, a rider on the front included |
 *
 * A rider at the back of the line, the usual place to lose a wheel, is
 * measured from the line's last bot. Bots behind a rider in the middle of the
 * line stay on the rider's wheel, as `step.ts` has always had them.
 *
 * **A rider who goes off the front gives up their seat**: they move to the
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

import { pacerTerrainAt } from '../pacer/terrain-rule';
import type { RouteProfile } from '../route/profile';
import { GroupRideError } from './errors';
import { unknownValue, type LinePhase, type RiderRole } from './roles';
import {
  ROTATION_RIDER_WHEEL_BAND_METRES,
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
  /** The speed a held line is asked to ride, m/s; `null` when it is not held. No floor. */
  readonly easedSpeedMps: number | null;
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
    !Number.isFinite(rider.speedMps)
  ) {
    throw new GroupRideError(
      'view-out-of-range',
      'every member needs a finite odometer and a finite speed of at least zero',
    );
  }
  const frontId = rotation.order[0] as string;
  const frontM = at(frontId).distanceM;

  // A rider who goes off the front gives up their seat.
  let order = rotation.order;
  const seat = order.indexOf(riderId);
  if (seat > 0 && seat < order.length - 1 && rider.distanceM > frontM) {
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
    if (seatNow > 0 && rider.distanceM > frontM) {
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

  // How fast a held line rides: under the rider's own speed while they are
  // behind, by a share that grows with their time gap. No floor.
  let easedSpeedMps: number | null = null;
  if (hold !== null) {
    if (standing === 'off-the-front') {
      easedSpeedMps = view.groupSpeedMps;
    } else {
      const whole = rider.speedMps * NO_DROP_FULL_EASE_SECONDS;
      const share = behindM >= whole ? 1 : behindM / whole;
      easedSpeedMps = Math.min(view.groupSpeedMps, rider.speedMps * (1 - share));
    }
  }

  // The line's phase follows the hold.
  const wasHeld = rotation.phase === 'waiting' || rotation.phase === 'regrouping';
  const phase: LinePhase =
    hold ?? (wasHeld ? (rotation.aside === null ? 'steady' : 'changing') : rotation.phase);
  const line =
    order === rotation.order && phase === rotation.phase ? rotation : { ...rotation, order, phase };

  return {
    state: { nextWindowAtMs, hold, standing, sweep, easedSpeedMps, insideSinceMs, overTheTop },
    rotation: line,
  };
}
