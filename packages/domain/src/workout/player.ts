// SPDX-License-Identifier: Apache-2.0

/**
 * The workout player — #14.
 *
 * A pure state machine over a {@link WorkoutTimeline}. It decides **what the
 * trainer should be told and when**; it writes nothing, holds no link and reads
 * no clock. Time arrives as a parameter, which is `packages/domain`'s rule and
 * the same one the recording engine follows.
 *
 * ## It emits an INTENT, and the caller does the writing
 *
 * `tick` returns what the player wants to happen next, not a promise of it
 * happening. The caller — `apps/web`, holding an `ErgWriter` — turns that into
 * a control-point write and reports back through {@link acknowledge} or
 * {@link writeFailed}. That split is what lets the whole of #14's control-loop
 * logic be tested without a trainer, and it is why this file is in the package
 * that may not name one.
 *
 * ## An interval has not begun until its target is acknowledged
 *
 * > *"A test proves each interval's target is sent **and acknowledged** before
 * > the interval is treated as begun."*
 *
 * So the player carries a **pending** target across ticks. While one is
 * outstanding it does not ask for another, which is also what keeps it from
 * feeding the writer faster than the control point drains — #14 calls queue
 * depth *"a live design constraint, not a detail"*, and the player is the other
 * end of the bound `erg-writer.ts` enforces.
 *
 * ⚠️ **The clock does not stop while a target is pending.** A machine that
 * takes four seconds to answer does not make the interval four seconds longer:
 * the rider is riding throughout, and stretching the workout to match a slow
 * device would drift the plan away from the clock the rider is watching. What
 * waits is the *next* write, not the ride.
 *
 * ## A disconnect pauses, and never discards
 *
 * > *"A test proves a trainer disconnect mid-workout pauses the workout and
 * > preserves the recording rather than losing the session."*
 *
 * {@link linkLost} moves to `paused` and keeps every offset. The recording is
 * not this module's to preserve — that is `packages/domain/src/recording` and
 * the checkpoints in `packages/store` — and the player deliberately cannot
 * touch it. What it guarantees is the half it owns: no state is thrown away,
 * so a reconnection resumes rather than restarts.
 *
 * ## A rescue ends on a whole trend window of recovery, not on one good reading
 *
 * #441. `assessErgCadence` decides a spiral from a rider grinding on purpose,
 * and this file does not second-guess it. What it adds is how a rescue ENDS.
 * The verdict is a function of the last {@link TREND_WINDOW}, so it flips back
 * to `holding` the first tick cadence reads 50 rpm again with no fresh
 * collapse behind it — and the full target that caused the spiral goes
 * straight back on, cadence falls, the relief goes on again: a flapping target
 * under a rider who is already struggling. So once a verdict has been
 * `spiralling` or `stalled`, the relief stays applied until the verdict has
 * been `holding` for one whole {@link TREND_WINDOW} — the same span the
 * detector looks back over, so "recovered" means the detector itself has seen
 * a whole window with nothing wrong in it. A grinding rider who never
 * spiralled is never eased, because the latch is only set by a verdict.
 *
 * The return is therefore stepped, not a jump: a stalled rider is at the
 * trainer's floor (`intent: release`, which the caller writes as the machine's
 * own lowest target); starting to pedal again reads as `spiralling` below
 * 50 rpm, so the relief target; and the full target only after a steady
 * window.
 *
 * ## A rescue survives a free ride and a pause
 *
 * The latch is cleared by a whole window of `holding` verdicts and by
 * {@link WorkoutPlayer.start}, and by nothing else — not by a free-ride block,
 * where no verdict is taken, and not by a pause, where no tick runs. So a rider
 * who spiralled, then rode a free block or paused, gets the relief target on
 * the next ERG block for up to one {@link TREND_WINDOW} before the full one.
 * That is deliberate, and it was implicit until PR #444's review: the pause and
 * the free block are both likely to follow the struggle, the cost is at most
 * eight seconds at two thirds of a target, and the error runs the safe way. A
 * latch that a free ride cleared would put the full target that caused the
 * spiral straight back on a rider whose legs have not been tested since.
 */

import { seconds, watts, type Seconds, type Watts } from '../quantities';

import { assessErgCadence, RELIEF_SHARE, TREND_WINDOW, type CadenceReading } from './erg-safety';
import { segmentAt, targetAt, type WorkoutSegment, type WorkoutTimeline } from './timeline';

export type PlayerStatus = 'idle' | 'running' | 'paused' | 'finished';

/** What the player wants the caller to do with the trainer. */
export type PlayerIntent =
  /** Nothing to do this tick. */
  | { readonly kind: 'hold' }
  /**
   * Write this target and report back.
   *
   * `share` is what the workout asked for; `watts` is that share against the
   * athlete's threshold, after any ERG relief. A caller writes the watts and
   * a screen may show either — but the two are reported separately so a screen
   * showing "88%" beside a reduced wattage is not lying about one of them.
   */
  | {
      readonly kind: 'write-target';
      readonly watts: Watts;
      readonly share: number;
      readonly eased: boolean;
    }
  /**
   * Stop writing targets and let the rider ride.
   *
   * A free-ride block, or a rider who has stopped pedalling. **Not a target of
   * zero** — see `FreeRideBlock`.
   */
  | { readonly kind: 'release'; readonly reason: string }
  /** The workout is over. */
  | { readonly kind: 'finished' };

export interface PlayerState {
  readonly status: PlayerStatus;
  /** How far into the workout the rider is, excluding paused time. */
  readonly elapsed: Seconds;
  /** The segment being ridden, or `undefined` when idle, paused or finished. */
  readonly segment: WorkoutSegment | undefined;
  /** A target written and not yet answered, if any. */
  readonly pending: Watts | undefined;
  /**
   * What the trainer last said it holds, which is not what it was asked for.
   *
   * `setTargetPower` quantises, and a machine may clamp to its own supported
   * range. Reported separately from {@link pending} so a screen can show the
   * real number without the player pretending it asked for it.
   */
  readonly held: Watts | undefined;
  /** The last thing the player asked for. */
  readonly intent: PlayerIntent;
}

export interface PlayerOptions {
  readonly timeline: WorkoutTimeline;
  /**
   * The athlete's threshold, which turns a share into watts.
   *
   * ⚠️ Required, and there is no default. `apps/web/src/analysis/thresholds.ts`
   * is the one place in this program that substitutes a threshold default, and
   * doing it again here would put a made-up number on a trainer.
   */
  readonly thresholdPower: Watts;
  /**
   * How often to refresh an unchanged target, in seconds.
   *
   * #14's revision block records an FTMS host writing **continuously at roughly
   * 1 Hz** rather than once per interval, and a machine that has been reset or
   * has lost the session silently ignores what it was told — so a player that
   * writes once per interval and stops has no way to notice. Refreshing is how
   * the loop stays closed.
   */
  readonly refreshSeconds?: number | undefined;
}

/** The default refresh, matching the observed host cadence. */
export const REFRESH_SECONDS = 1;

/** What a tick is told about the rider. */
export interface RiderSample {
  readonly cadence?: readonly CadenceReading[] | undefined;
}

export interface WorkoutPlayer {
  state(): PlayerState;
  /** Begin, at this instant. */
  start(now: Seconds): PlayerState;
  /**
   * Advance to `now` and decide what to do.
   *
   * @param rider what is known about the rider, for the ERG rule. Omitted, the
   * spiral check does not run — which is correct for a trainer with no cadence
   * rather than a reason to refuse to ride.
   */
  tick(now: Seconds, rider?: RiderSample): PlayerState;
  pause(now: Seconds): PlayerState;
  resume(now: Seconds): PlayerState;
  /** The trainer answered. `written` is what it actually holds. */
  acknowledge(written: Watts): PlayerState;
  /** The write failed. The player will ask again on the next tick. */
  writeFailed(): PlayerState;
  /** The link dropped: pause, and keep everything. */
  linkLost(now: Seconds): PlayerState;
  /** End the workout deliberately. */
  stop(): PlayerState;
}

export function createWorkoutPlayer(options: PlayerOptions): WorkoutPlayer {
  const { timeline, thresholdPower } = options;
  const refresh = options.refreshSeconds ?? REFRESH_SECONDS;

  let status: PlayerStatus = 'idle';
  let elapsed = 0;
  /** Wall-clock instant the current running stretch began. */
  let runningSince: number | undefined;
  /** Elapsed at the moment the current stretch began. */
  let elapsedAtResume = 0;
  let pending: Watts | undefined;
  let held: Watts | undefined;
  let lastWrittenAt: number | undefined;
  let lastShare: number | undefined;
  let intent: PlayerIntent = { kind: 'hold' };
  /**
   * Whether a spiral or a stall has been seen and not yet recovered from. See
   * the module note: a rescue ends on a whole window of `holding`, not on one.
   */
  let rescuing = false;
  /** When the current unbroken run of `holding` verdicts began, while rescuing. */
  let steadySince: number | undefined;

  const snapshot = (): PlayerState => ({
    status,
    elapsed: seconds(elapsed),
    segment: status === 'running' ? segmentAt(timeline, seconds(elapsed)) : undefined,
    pending,
    held,
    intent,
  });

  const advance = (now: Seconds): void => {
    if (status !== 'running' || runningSince === undefined) {
      return;
    }
    elapsed = elapsedAtResume + (now - runningSince);
  };

  return {
    state: snapshot,

    start(now: Seconds): PlayerState {
      status = 'running';
      elapsed = 0;
      elapsedAtResume = 0;
      runningSince = now;
      pending = undefined;
      held = undefined;
      lastWrittenAt = undefined;
      lastShare = undefined;
      intent = { kind: 'hold' };
      rescuing = false;
      steadySince = undefined;
      return snapshot();
    },

    tick(now: Seconds, rider?: RiderSample): PlayerState {
      if (status !== 'running') {
        return snapshot();
      }
      advance(now);

      if (elapsed >= timeline.totalSeconds) {
        status = 'finished';
        pending = undefined;
        intent = { kind: 'finished' };
        return snapshot();
      }

      const share = targetAt(timeline, seconds(elapsed));
      if (share === undefined) {
        // A free ride: the intent is `release`, not a small target of this
        // player's choosing. ⚠️ What the caller then SENDS changed in #441: on
        // the trainer #372 was measured on, a Stop left the previous interval's
        // target applied, so `apps/web/src/workout/session.ts` §`ease` writes
        // the machine's own lowest target instead. That is a trade and it is
        // stated rather than hidden: ERG at the floor is still ERG, so pushing
        // harder spins the rider out rather than loading them — which is a
        // great deal better than being held at the last interval with no
        // spiral check running at all.
        // ⚠️ The reason said "Ride however you like" until PR #444's review.
        // With the machine held at its floor in ERG that is not true — pushing
        // harder spins the rider out rather than loading them — so it says
        // only what this player knows: the block has no target of its own.
        pending = undefined;
        lastShare = undefined;
        intent = { kind: 'release', reason: 'This block sets no target of its own — ride easy.' };
        return snapshot();
      }

      // ⚠️ Judged at `now`, NOT at `elapsed`, and the difference is the whole
      // of whether the spiral rule works for a caller whose clock does not
      // start at zero.
      //
      // `assessErgCadence` filters its window against the instant it is given,
      // and the readings are stamped by the CALLER — so they are on the
      // caller's clock. `elapsed` is an offset from the workout's start, which
      // is the same number only when the workout began at zero. A ride screen
      // that stamps readings with a wall clock and a player judging at
      // `elapsed` compare an epoch against a small offset: every reading fails
      // `reading.at <= now`, the window is always empty, and the rule silently
      // never fires. Found by wiring this into `apps/web/src/ride`, where the
      // clock is the ride's; every test here started at zero and could not see
      // it.
      const verdict =
        rider?.cadence === undefined
          ? ({ kind: 'holding' } as const)
          : assessErgCadence(rider.cadence, now);

      if (verdict.kind === 'holding') {
        if (rescuing) {
          steadySince ??= now;
          if (now - steadySince >= TREND_WINDOW) {
            rescuing = false;
            steadySince = undefined;
          }
        }
      } else {
        rescuing = true;
        steadySince = undefined;
      }

      if (verdict.kind === 'stalled') {
        pending = undefined;
        lastShare = undefined;
        intent = { kind: 'release', reason: verdict.reason };
        return snapshot();
      }

      const eased = rescuing;
      const relief = verdict.kind === 'spiralling' ? verdict.relief : RELIEF_SHARE;
      const effective = eased ? share * relief : share;

      // ⚠️ While a write is outstanding the player asks for nothing more. That
      // is #14's "acknowledged before the interval is treated as begun", and it
      // is also the other end of the writer's bounded queue: the player cannot
      // outrun a control point that answers slowly.
      if (pending !== undefined) {
        intent = { kind: 'hold' };
        return snapshot();
      }

      const changed = lastShare === undefined || Math.abs(lastShare - effective) > 1e-9;
      const stale = lastWrittenAt === undefined || elapsed - lastWrittenAt >= refresh;
      if (!changed && !stale) {
        intent = { kind: 'hold' };
        return snapshot();
      }

      const target = watts(Math.round(thresholdPower * effective));
      pending = target;
      lastShare = effective;
      lastWrittenAt = elapsed;
      intent = { kind: 'write-target', watts: target, share, eased };
      return snapshot();
    },

    pause(now: Seconds): PlayerState {
      if (status !== 'running') {
        return snapshot();
      }
      advance(now);
      status = 'paused';
      runningSince = undefined;
      // The outstanding write is forgotten rather than awaited: whatever it was
      // for, the rider has stopped, and the next tick after a resume decides
      // afresh. Keeping it would leave the player refusing to write on resume
      // until an acknowledgement that may never come.
      pending = undefined;
      intent = { kind: 'release', reason: 'Paused.' };
      return snapshot();
    },

    resume(now: Seconds): PlayerState {
      if (status !== 'paused') {
        return snapshot();
      }
      status = 'running';
      runningSince = now;
      // ⚠️ The ONE place the offset is rebased, and neither `pause` nor
      // `linkLost` does it too. Resume is the only way out of `paused`, and
      // `advance` reads nothing while paused because `runningSince` is
      // cleared — so an assignment on the way in would be a second copy of
      // this decision that no test could tell had gone stale. Mutation-tested:
      // deleting the same line from either of those two left the suite green.
      elapsedAtResume = elapsed;
      // Forget when the last write happened, so the first tick after a resume
      // writes rather than waiting out the refresh interval. A rider pressing
      // resume should feel the trainer pick up.
      lastWrittenAt = undefined;
      lastShare = undefined;
      return snapshot();
    },

    acknowledge(written: Watts): PlayerState {
      pending = undefined;
      // ⚠️ `lastShare` deliberately keeps what was ASKED FOR, not `written`.
      // `setTargetPower` quantises, so a readback of 151 W against an ask of
      // 150 W is an ordinary acknowledgement rather than a change — and a
      // comparison against the readback would therefore differ on every tick
      // and rewrite the same target forever, which is the exact busy loop the
      // refresh interval exists to bound. What the machine holds is worth
      // showing a rider, so it is kept and reported; it is not what the next
      // tick's decision is made against.
      held = written;
      return snapshot();
    },

    writeFailed(): PlayerState {
      pending = undefined;
      // Forget the share too, so the next tick counts as a change and tries
      // again rather than deciding nothing has moved.
      lastShare = undefined;
      return snapshot();
    },

    linkLost(now: Seconds): PlayerState {
      if (status === 'running') {
        advance(now);
      }
      status = status === 'finished' ? 'finished' : 'paused';
      runningSince = undefined;
      pending = undefined;
      intent = {
        kind: 'release',
        reason: 'The trainer disconnected, so the workout is paused. Nothing has been lost.',
      };
      return snapshot();
    },

    stop(): PlayerState {
      status = 'finished';
      runningSince = undefined;
      pending = undefined;
      intent = { kind: 'finished' };
      return snapshot();
    },
  };
}
