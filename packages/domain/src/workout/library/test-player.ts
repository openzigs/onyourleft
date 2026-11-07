// SPDX-License-Identifier: Apache-2.0

/**
 * Riding a threshold test: the workout player, with the test's own end — #2303.
 *
 * A threshold test is an ordinary workout (`library/test.ts`), and this rides
 * it with an ordinary {@link createWorkoutPlayer}. What it adds is one rule:
 * **the test's effort ends early**, on whichever comes first of
 *
 * - **a stall-rescue verdict during the effort** — `erg-safety.ts`'s existing
 *   assessment, read off the player's own `rescue` field, and not a second
 *   detector; or
 * - **the rider's *I'm done*** ({@link ThresholdTestPlayer.done}).
 *
 * Ending the effort moves the rider straight to the test's cool-down. For the
 * ramp that is a free ride, so the end is the player's existing `release`
 * intent and nothing else: no new writer, and `player.ts`, `erg-safety.ts` and
 * the trainer-command seam are unchanged.
 *
 * ## ⚠️ Why the end is the FIRST verdict, and not a stall at the floor
 *
 * In a workout, a spiral is answered with relief: two thirds of the target,
 * then the full target back after a whole trend window of recovery. In a ramp
 * that is exactly wrong. By the time the latch lets go, the ramp has climbed a
 * step or two, so the full target that comes back is higher than the one the
 * rider just failed — the rescue racing a rising target, which ends in another
 * spiral and another relief until the cap. So in the effort, the first
 * `relief` or `floor` step **is** the end of the test: the rider has shown the
 * target is more than they can hold, which is what a ramp is for, and nothing
 * after it asks the trainer for more.
 *
 * The cost is a test that ends one step sooner than a rider who would have
 * fought on might have managed, and its estimate is then a little low. That
 * error runs the safe way, and a rider can ride the test again.
 *
 * ## How the cool-down is ridden after an early end
 *
 * The player has no way to skip ahead in a timeline — and should not grow one
 * for this. So the end stops the player riding the test and starts a second
 * {@link createWorkoutPlayer} over the cool-down alone, on the same clock; the
 * state this module reports adds the offset the effort ended at, so `elapsed`
 * keeps counting the ride as ridden. The second player's first tick is given
 * the same cadence history, so a rider still stalled is still judged stalled.
 *
 * ⚠️ **That second player starts with no rescue latch**, where the one it
 * replaces had one set. For the ramp it does not matter — its cool-down is a
 * free ride, which writes no target either way — and `test-player.test.ts`
 * asserts that the ramp's cool-down sets no target, so a change that put the
 * ramp's cool-down back in ERG has to answer for this paragraph.
 */

import { seconds, type Seconds, type Watts } from '../../quantities';
import {
  createWorkoutPlayer,
  type PlayerOptions,
  type PlayerState,
  type RiderSample,
  type WorkoutPlayer,
} from '../player';
import { tailorWorkout } from '../template';
import { expandWorkout, type WorkoutSegment, type WorkoutTimeline } from '../timeline';

import type { ThresholdTest } from './test';

/** What ended a test's effort before its written end. */
export type ThresholdTestEnd =
  /** A stall-rescue verdict during the effort: the rider could not hold the target. */
  | 'stalled'
  /** The rider's *I'm done*. */
  | 'done'
  /** The workout was stopped during the effort. */
  | 'stopped';

/** Where the test's effort sits in the ride, for `estimateThreshold`. */
export interface ThresholdTestProgress {
  /** Seconds from the workout's start at which the effort begins. */
  readonly effortStartsAt: Seconds;
  /**
   * Where the effort ends: as written, or where it ended early. Before
   * {@link effortStartsAt} when the test ended in its warm-up.
   */
  readonly effortEndsAt: Seconds;
  /** What ended it early; `undefined` while it has not, or when it ran its course. */
  readonly endedBy: ThresholdTestEnd | undefined;
}

/** The player's state, and where the test is. */
export interface ThresholdTestState extends PlayerState {
  readonly test: ThresholdTestProgress;
}

/** The same options as a player, with the test in place of a timeline. */
export interface ThresholdTestPlayerOptions extends Omit<PlayerOptions, 'timeline'> {
  readonly test: ThresholdTest;
}

/** A workout player for a threshold test. @see createThresholdTestPlayer */
export interface ThresholdTestPlayer {
  /** The test as written, for a screen to draw. */
  readonly timeline: WorkoutTimeline;
  state(): ThresholdTestState;
  /** Begin, at this instant. A test player rides its test once. */
  start(now: Seconds): ThresholdTestState;
  tick(now: Seconds, rider?: RiderSample): ThresholdTestState;
  pause(now: Seconds): ThresholdTestState;
  resume(now: Seconds): ThresholdTestState;
  acknowledge(written: Watts): ThresholdTestState;
  writeFailed(): ThresholdTestState;
  linkLost(now: Seconds): ThresholdTestState;
  stop(): ThresholdTestState;
  /**
   * The rider's *I'm done*: end the effort now and go to the cool-down.
   * Acts only while running and before the effort has ended.
   */
  done(now: Seconds): ThresholdTestState;
}

/**
 * Why the trainer is released after a test's effort ended early — the free
 * ride's own reason says only that the block sets no target.
 */
export const TEST_OVER_REASON =
  'The test is over, so the trainer has been released. Spin easy to cool down.';

/**
 * Ride a threshold test.
 *
 * @throws {WorkoutError} if the test's template does not tailor as written,
 * or has no cool-down to end into — which no built-in test may, and
 * `test-player.test.ts` asserts.
 */
export function createThresholdTestPlayer(
  options: ThresholdTestPlayerOptions,
): ThresholdTestPlayer {
  const { test, ...riderOptions } = options;
  const template = test.template;
  const workout = tailorWorkout(template, {});
  const timeline = expandWorkout(workout);

  // The effort is the main set: blocks [first, after) of the tailored workout.
  const first = template.warmUp.length;
  const after = first + template.mainSet.blocks.length;
  const effortStartsAt = blockStart(timeline, first);
  const writtenEnd = blockStart(timeline, after);
  // Built now rather than at the end, so a test with no cool-down to end into
  // is refused when it is made, never in the middle of a ride.
  const coolDownTimeline = expandWorkout({ name: workout.name, blocks: template.coolDown });

  const playerFor = (plan: WorkoutTimeline): WorkoutPlayer =>
    createWorkoutPlayer({ ...riderOptions, timeline: plan });

  const during = playerFor(timeline);
  /** The cool-down's player once the effort has ended early, and where it began. */
  let coolDown: { readonly player: WorkoutPlayer; readonly offset: number } | undefined;
  let ended: { readonly at: Seconds; readonly by: ThresholdTestEnd } | undefined;

  const active = (): WorkoutPlayer => coolDown?.player ?? during;

  const inEffort = (state: PlayerState): boolean =>
    state.status === 'running' &&
    state.segment !== undefined &&
    state.segment.block >= first &&
    state.segment.block < after;

  const progress = (): ThresholdTestProgress => ({
    effortStartsAt,
    effortEndsAt: ended?.at ?? writtenEnd,
    endedBy: ended?.by,
  });

  const snapshot = (): ThresholdTestState => {
    if (coolDown === undefined) {
      return { ...during.state(), test: progress() };
    }
    const { offset } = coolDown;
    const state = coolDown.player.state();
    const freeRide = state.segment !== undefined && state.segment.from === undefined;
    return {
      ...state,
      elapsed: seconds(offset + state.elapsed),
      segment: state.segment === undefined ? undefined : shifted(state.segment, offset, after),
      intent:
        state.status === 'running' &&
        state.intent.kind === 'release' &&
        state.rescue === undefined &&
        freeRide
          ? { kind: 'release', reason: TEST_OVER_REASON }
          : state.intent,
      test: progress(),
    };
  };

  /** End the effort at `at`, and start the cool-down at `now`. */
  const end = (now: Seconds, at: Seconds, by: ThresholdTestEnd, sample?: RiderSample): void => {
    during.stop();
    ended = { at, by };
    const player = playerFor(coolDownTimeline);
    coolDown = { player, offset: at };
    player.start(now);
    player.tick(now, sample);
  };

  return {
    timeline,
    state: snapshot,

    start(now: Seconds): ThresholdTestState {
      during.start(now);
      return snapshot();
    },

    tick(now: Seconds, sample?: RiderSample): ThresholdTestState {
      if (coolDown !== undefined) {
        coolDown.player.tick(now, sample);
        return snapshot();
      }
      const state = during.tick(now, sample);
      if (ended === undefined && inEffort(state) && state.rescue !== undefined) {
        end(now, state.elapsed, 'stalled', sample);
      }
      return snapshot();
    },

    done(now: Seconds): ThresholdTestState {
      const last = during.state();
      if (
        coolDown !== undefined ||
        ended !== undefined ||
        last.status !== 'running' ||
        (last.segment?.block ?? after) >= after
      ) {
        // Not riding, already ended, or past the effort: the test ran its
        // course and the rider is in the cool-down, so there is nothing to end.
        return snapshot();
      }
      // `pause` reads the player's clock at `now` without asking for a
      // target; what it says is discarded with the player. Never past the
      // written end, for a tick that crossed it since the one above.
      const at = during.pause(now).elapsed;
      end(now, seconds(Math.min(at, writtenEnd)), 'done');
      return snapshot();
    },

    pause(now: Seconds): ThresholdTestState {
      active().pause(now);
      return snapshot();
    },

    resume(now: Seconds): ThresholdTestState {
      active().resume(now);
      return snapshot();
    },

    acknowledge(written: Watts): ThresholdTestState {
      active().acknowledge(written);
      return snapshot();
    },

    writeFailed(): ThresholdTestState {
      active().writeFailed();
      return snapshot();
    },

    linkLost(now: Seconds): ThresholdTestState {
      active().linkLost(now);
      return snapshot();
    },

    stop(): ThresholdTestState {
      const state = during.state();
      if (coolDown === undefined && ended === undefined && inEffort(state)) {
        ended = { at: state.elapsed, by: 'stopped' };
      }
      active().stop();
      return snapshot();
    },
  };
}

/** Where block `index` begins; the timeline's end for the block after the last. */
function blockStart(timeline: WorkoutTimeline, index: number): Seconds {
  return (
    timeline.segments.find((segment) => segment.block === index)?.startsAt ?? timeline.totalSeconds
  );
}

/** A cool-down segment, at the ride's offsets and the test's block numbers. */
function shifted(segment: WorkoutSegment, offset: number, firstBlock: number): WorkoutSegment {
  return {
    ...segment,
    startsAt: seconds(offset + segment.startsAt),
    endsAt: seconds(offset + segment.endsAt),
    block: firstBlock + segment.block,
  };
}
