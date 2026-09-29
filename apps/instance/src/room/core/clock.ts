// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A client's clock, related to the room's — #779, settling the first point
 * carried from #832's review.
 *
 * ## The problem
 *
 * Rule 1's `ReportWindow` (`@onyourleft/physics` §`judgeReport`) is a span of
 * the **room's** clock, and a report's `atMs` is on the **client's**: its own
 * `Date.now()` or `performance.now()`, which may be an hour off, a day off, or
 * counting from when the tab opened. Neither `welcome` nor `frame` carries room
 * time. A room that judged `atMs` against its own clock directly would coast
 * every honest rider whose phone is not set to the room's time — silently, and
 * only in production, where clocks differ.
 *
 * ## The answer: map `atMs` onto the room's clock, per connection
 *
 * No change to the protocol. For each connection the room keeps an **offset**,
 * `room time − client time`, as the **smallest** `arrivalMs − atMs` it has seen
 * among reports it admitted. A report is then judged at `atMs + offset`:
 *
 * - The first report of a connection sets the offset, and is admitted —
 *   there is nothing yet to be inconsistent with.
 * - Every later one must fall inside `[now − lateMs, now + earlyMs]` once
 *   mapped. The smallest arrival gap is the fastest delivery seen, so an
 *   honest report maps at or before its arrival, never after it; `earlyMs`
 *   absorbs the two clocks drifting apart over a ride, and `lateMs` a report
 *   held up in a queue.
 * - Only an **admitted** report may lower the offset. A report stamped far in
 *   the future is refused before it can move the clock it is judged by.
 *
 * ⚠️ **What this does not protect.** A client decides its own timeline, so
 * `atMs` proves nothing about when power was produced; it only keeps a
 * connection's reports **consistent with each other** and with how fast they
 * actually arrive, which is what rule 1 needs to refuse a stale replay. Power
 * is judged by rule 2 over what the room simulated, and never by `atMs`.
 *
 * A new connection — a rejoin, a reload — starts a new offset: a relaunched
 * client may count from somewhere else entirely.
 */

import type { ReportWindow } from '@onyourleft/physics';

/** One connection's offset: `undefined` until its first admitted report. */
export interface ClientClock {
  readonly offsetMs: number | undefined;
}

export const UNSET_CLIENT_CLOCK: ClientClock = { offsetMs: undefined };

/**
 * Rule 1's window for a report arriving at room time `nowMs`, in the
 * **client's** coordinates — so `judgeReport` compares like with like.
 */
export function reportWindow(
  clock: ClientClock,
  lastAdmittedSequence: number | undefined,
  nowMs: number,
  slack: { readonly lateMs: number; readonly earlyMs: number },
  atMs: number,
): ReportWindow {
  if (clock.offsetMs === undefined) {
    // The first report defines the timeline: admit it on its time alone.
    return { lastAdmittedSequence, earliestAtMs: atMs, latestAtMs: atMs };
  }
  return {
    lastAdmittedSequence,
    earliestAtMs: nowMs - clock.offsetMs - slack.lateMs,
    latestAtMs: nowMs - clock.offsetMs + slack.earlyMs,
  };
}

/** The clock after admitting a report stamped `atMs` that arrived at room time `nowMs`. */
export function afterAdmitting(clock: ClientClock, atMs: number, nowMs: number): ClientClock {
  const seen = nowMs - atMs;
  return clock.offsetMs === undefined || seen < clock.offsetMs ? { offsetMs: seen } : clock;
}
