// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The model slot: one model race at a time, and write-ups wait while it
 * runs** — #2709, ADR 0071 D-6.
 *
 * Spike 0039 measured that the local model server serves one request at a
 * time, so a bot decision asked during a write-up waited the write-up's whole
 * length (§4). So while a model race runs, the HOLD is on:
 *
 * - **Post-ride write-ups wait** (D-6.1): the job engine (`jobs.ts`) claims no
 *   write-up while {@link RaceHold.holding}, and claims again when the hold
 *   ends ({@link RaceHold.onRelease}). A held job is queued, not failed, and
 *   its agent's run budget starts when it runs (`agent.ts` counts from its
 *   own start), so the wait never counts against it. **A write-up already
 *   running is not cancelled** (D-6.2): nothing here touches a running job.
 * - **A re-plan is not held** (D-6.6): the engine still claims those.
 * - **One model race per instance** (D-6.3): while one athlete holds the slot,
 *   every other athlete's {@link RaceHold.claim} is `busy`, and their race is
 *   seeded.
 *
 * ## How the hold ends (D-6.4)
 *
 * Whichever comes first:
 *
 * 1. **The app says the race ended** ({@link RaceHold.end}).
 * 2. **A lapse with no tactics request**: {@link TACTICS_HOLD_LAPSE_MS}, so a
 *    closed app cannot hold write-ups for ever.
 * 3. **A fixed ceiling on the whole hold**: {@link TACTICS_HOLD_CEILING_MS}
 *    from its first claim, so a client that keeps sending requests cannot
 *    hold every rider's write-ups and every other rider's model races
 *    indefinitely. ⚠️ **A hold its ceiling ended is SPENT**: that athlete's
 *    claims are `busy` until they have sent nothing for a whole lapse, and
 *    an {@link RaceHold.end} does not clear it — so a client cannot end and
 *    claim again to start a fresh ceiling while it is still sending. Another
 *    athlete may claim the slot at once.
 *
 * The hold is in memory only (ADR 0071 D-8.5(c): the instance keeps nothing
 * of a race but the hold's state while it runs). An instance restarted mid-race
 * has no hold; the next tactics request claims one again.
 *
 * Every timer is injected, so a test moves the clock by hand.
 */

import { PLATFORM_TIMERS, type JobTimers } from './jobs.ts';

/**
 * How long a hold lasts with no tactics request: **30 s**.
 *
 * ## Provenance — the author's choice, against spike 0039's figures
 *
 * The app asks every 4 s of race time (spike 0039's cadence, ADR 0071 D-7's
 * draft), so 30 s is seven requests missed in a row: no race still running
 * misses that many unless its instance is unreachable, and then it is riding
 * seeded tactics anyway (D-7). It is short beside a write-up's ten minutes, so
 * a closed app costs the riders waiting half a minute. A request's answer also
 * counts as activity, so a decision queued 24 to 30 s behind a write-up at the
 * model server (spike 0039 §4) does not end its own race's hold.
 */
export const TACTICS_HOLD_LAPSE_MS = 30_000;

/**
 * The longest one hold may last however often it is refreshed: **2 hours**.
 *
 * ## Provenance — the author's choice, not a measurement
 *
 * The owner's ruling on #2711 asked for a fixed ceiling (review of D-6.4).
 * The lap race allows 10 laps of the rider's own loop (`apps/web`
 * §`LAP_RACE_MOST_LAPS`); spike 0039's three laps of 628 m took under five
 * minutes. Two hours is longer than any lap race the owner has ridden, and
 * bounds what the riders waiting behind it can lose: a race past it rides
 * seeded tactics from there (D-7), and loses nothing else.
 */
export const TACTICS_HOLD_CEILING_MS = 2 * 60 * 60 * 1000;

/** What a claim answered: the slot is the caller's now, or somebody else's (or the caller's spent hold). */
export type HoldClaim = 'held' | 'busy';

export interface RaceHold {
  /**
   * Claim the slot for `athleteId`, or refresh their hold: `held`, or `busy`
   * while another athlete holds it, or while `athleteId`'s own last hold is
   * spent. Every tactics request claims it, warm-up included.
   */
  claim(athleteId: string): HoldClaim;
  /**
   * `athleteId`'s request was answered: counted as activity, as a claim is,
   * when they still hold the slot. Nothing for anybody else.
   */
  touch(athleteId: string): void;
  /** `athleteId`'s race ended (the app said so): their hold ends now. Nothing for anybody else. */
  end(athleteId: string): void;
  /** Whether a model race holds the slot now: write-ups wait while it does. */
  holding(): boolean;
  /** Called each time a hold ends, by any of its three ways. */
  onRelease(listener: () => void): void;
  /** Clear the timer: the instance is stopping. */
  stop(): void;
}

export interface RaceHoldOptions {
  /** Unix milliseconds. */
  readonly now: () => number;
  /** The platform's unless a test's fake clock. */
  readonly timers?: JobTimers;
  /** {@link TACTICS_HOLD_LAPSE_MS} unless a test's. */
  readonly lapseMs?: number;
  /** {@link TACTICS_HOLD_CEILING_MS} unless a test's. */
  readonly ceilingMs?: number;
}

interface Held {
  readonly athleteId: string;
  readonly startedAt: number;
  lastAt: number;
}

export function createRaceHold(options: RaceHoldOptions): RaceHold {
  const { now } = options;
  const timers = options.timers ?? PLATFORM_TIMERS;
  const lapseMs = options.lapseMs ?? TACTICS_HOLD_LAPSE_MS;
  const ceilingMs = options.ceilingMs ?? TACTICS_HOLD_CEILING_MS;
  const listeners: (() => void)[] = [];
  let current: Held | undefined;
  /** Athletes whose hold its ceiling ended, and when each last asked. */
  const spent = new Map<string, number>();
  let timer: unknown;

  const release = (): void => {
    current = undefined;
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
    for (const listener of listeners) listener();
  };

  /** End the hold if its lapse or its ceiling has passed, and forget spent holds a lapse quiet. */
  const settle = (): void => {
    const at = now();
    for (const [athleteId, lastAt] of spent) {
      if (at - lastAt >= lapseMs) spent.delete(athleteId);
    }
    if (current === undefined) return;
    if (at - current.startedAt >= ceilingMs) {
      spent.set(current.athleteId, current.lastAt);
      release();
    } else if (at - current.lastAt >= lapseMs) {
      release();
    }
  };

  /** Wake when the hold would end, so held write-ups start with no request to start them. */
  const arm = (): void => {
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
    if (current === undefined) return;
    const due = Math.min(current.lastAt + lapseMs, current.startedAt + ceilingMs);
    timer = timers.setTimeout(
      () => {
        timer = undefined;
        settle();
        arm();
      },
      Math.max(0, due - now()),
    );
  };

  return {
    claim(athleteId) {
      settle();
      const at = now();
      if (spent.has(athleteId)) {
        spent.set(athleteId, at);
        return 'busy';
      }
      if (current !== undefined && current.athleteId !== athleteId) return 'busy';
      if (current === undefined) current = { athleteId, startedAt: at, lastAt: at };
      else current.lastAt = at;
      arm();
      return 'held';
    },

    touch(athleteId) {
      settle();
      if (current?.athleteId !== athleteId) return;
      current.lastAt = now();
      arm();
    },

    end(athleteId) {
      settle();
      if (current?.athleteId === athleteId) release();
    },

    holding() {
      settle();
      return current !== undefined;
    },

    onRelease(listener) {
      listeners.push(listener);
    },

    stop() {
      if (timer !== undefined) timers.clearTimeout(timer);
      timer = undefined;
    },
  };
}
