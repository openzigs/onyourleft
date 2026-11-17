// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616's spike: the decision log, and when a logged decision is in force.
 *
 * A race with model tactics is the race's seed **and** this log: every model
 * call, when it was asked (race time), when its answer arrived (race time: the
 * ask plus the call's latency), and what it said. Each decision is applied at
 * the first tactics window (`@onyourleft/domain` §`BOT_TACTICS_WINDOW_MS`, 1 s)
 * that starts after it arrived, by race time, never by a clock, so a replay
 * from the seed and the log is the race to the bit (`replay.test.ts`). That is
 * what keeps ADR 0067 D-6.2's "pure seeded functions" true of the bots given
 * the log: the log, not the model, is the input.
 *
 * Spike code: see `decision.ts`.
 */

import { BOT_TACTICS_WINDOW_MS } from '@onyourleft/domain';

import type { ModelMove } from './decision';

/** How often the model is asked, ms of race time: every **4 s** (the issue's 3 to 5 s). */
export const MODEL_DECISION_EVERY_MS = 4_000;

/**
 * An answer that arrives more than this after its ask is **late**, ms: **5 s**.
 * It describes a race that has moved on, and is logged and never applied.
 */
export const MODEL_DECISION_LATE_MS = 5_000;

/**
 * How long a decision holds once applied, ms, unless the next one replaces it
 * first: **5 s**, so a late or missing answer lets the field fall back to the
 * seeded tactics rather than ride a stale move on.
 */
export const MODEL_DECISION_HOLD_MS = 5_000;

/** What one model call came to. */
export type LoggedOutcome = 'decision' | 'invalid' | 'late' | 'failed';

/** One model call, as the log keeps it. */
export interface LoggedDecision {
  /** Race time it was asked at, ms. */
  readonly requestedAtMs: number;
  /** Race time its answer arrived at, ms: the ask plus the call's latency. */
  readonly arrivedAtMs: number;
  readonly outcome: LoggedOutcome;
  /** The moves, for a `decision` (and kept for a `late` one, unapplied). */
  readonly moves?: readonly ModelMove[] | undefined;
  /** Why it was invalid (an `InvalidReason`), or what failed. */
  readonly reason?: string | undefined;
  /** What the server counted: tokens in, tokens out, and its own total time, ms. */
  readonly promptTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly serverMs?: number | undefined;
  /** The call's wall time from the client, ms, its transport included. */
  readonly wallMs?: number | undefined;
}

/** The race time a decision that arrived at `arrivedAtMs` is applied at: the next window's start. */
export function appliedAtMs(arrivedAtMs: number): number {
  return (Math.floor(arrivedAtMs / BOT_TACTICS_WINDOW_MS) + 1) * BOT_TACTICS_WINDOW_MS;
}

/** The race time of the next ask after an answer that arrived at `arrivedAtMs`: the next 4 s mark. */
export function nextRequestAtMs(arrivedAtMs: number): number {
  return (Math.floor(arrivedAtMs / MODEL_DECISION_EVERY_MS) + 1) * MODEL_DECISION_EVERY_MS;
}

/** How a call that took `latencyMs` is logged: `late` past {@link MODEL_DECISION_LATE_MS}. */
export function outcomeFor(parsedOk: boolean, latencyMs: number): LoggedOutcome {
  if (latencyMs > MODEL_DECISION_LATE_MS) return 'late';
  return parsedOk ? 'decision' : 'invalid';
}

/**
 * The moves in force at race time `atMs`, or `undefined` with none: the
 * latest `decision` applied at or before it, for {@link MODEL_DECISION_HOLD_MS}.
 * A `late`, `invalid` or `failed` call applies nothing.
 */
export function movesInForce(
  log: readonly LoggedDecision[],
  atMs: number,
): readonly ModelMove[] | undefined {
  let found: LoggedDecision | undefined;
  for (const entry of log) {
    if (entry.outcome !== 'decision') continue;
    const from = appliedAtMs(entry.arrivedAtMs);
    if (from > atMs) continue;
    if (found === undefined || from >= appliedAtMs(found.arrivedAtMs)) found = entry;
  }
  if (found === undefined) return undefined;
  return atMs < appliedAtMs(found.arrivedAtMs) + MODEL_DECISION_HOLD_MS ? found.moves : undefined;
}
