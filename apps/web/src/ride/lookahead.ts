// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The workout's next block, said BEFORE it starts — #398.
 *
 * ⚠️ **A safety question, read as one.** A sighted rider watches the next
 * interval approach on the screen; a rider who cannot see it meets the new
 * target in their legs, at the moment the trainer applies it. #394 announces
 * the block when it CHANGES; this announces it a rider-chosen number of
 * seconds before, which is a different claim and needs a different test.
 *
 * ## No new engine, no second clock
 *
 * `packages/domain`'s `segmentAt(timeline, elapsed + lead)` IS the lookahead:
 * the timeline is looked up, never replayed (`player.ts`), and `elapsed` is
 * the player's own offset — the ride's clock, rebased in exactly one place
 * (`player.ts` §`resume`). So a paused ride does not count down: its elapsed
 * does not move. This file reads no clock at all.
 *
 * ## What it says
 *
 * What changes, not only that something does: **harder**, **easier**, or
 * **the same effort**, and the block in words — `5 minutes at 95 percent of
 * your threshold`. ⚠️ **Never a watt figure.** The next target has not been
 * written, let alone acknowledged (`player.ts`: *"an interval has not begun
 * until its target is acknowledged"*), and a number the trainer may refuse is
 * a promise this client cannot keep. A share of threshold is the plan, and the
 * plan is what is known. At the last block it says the workout ends, rather
 * than naming a block that does not exist.
 */

import { seconds, segmentAt, type WorkoutSegment, type WorkoutTimeline } from '@onyourleft/domain';

import { percentOf } from '../workouts/library';

export interface Upcoming {
  /** When the change happens, as the player's elapsed seconds. Keys "once per boundary". */
  readonly boundary: number;
  readonly sentence: string;
}

/** A length of time as it is heard: `30 seconds`, `5 minutes`, `1 hour 10 minutes`. */
function spokenLength(totalSeconds: number): string {
  const whole = Math.max(0, Math.round(totalSeconds));
  if (whole < 60) return `${String(whole)} ${whole === 1 ? 'second' : 'seconds'}`;
  const minutes = Math.round(whole / 60);
  if (minutes < 60) return `${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const head = `${String(hours)} ${hours === 1 ? 'hour' : 'hours'}`;
  return rest === 0 ? head : `${head} ${String(rest)} minutes`;
}

/** A segment in words. A ramp says both ends; a free ride says there is no target. */
function spokenSegment(segment: WorkoutSegment): string {
  const length = spokenLength(segment.endsAt - segment.startsAt);
  if (segment.from === undefined || segment.to === undefined) {
    return `${length} of free riding, with no target`;
  }
  if (segment.from === segment.to) {
    return `${length} at ${String(percentOf(segment.from))} percent of your threshold`;
  }
  return `${length} rising from ${String(percentOf(segment.from))} to ${String(
    percentOf(segment.to),
  )} percent of your threshold`;
}

/** Which way the effort moves across the boundary, in a word a rider can prepare for. */
function direction(current: WorkoutSegment, next: WorkoutSegment): string {
  const before = current.to;
  const after = next.from;
  if (after === undefined) return 'easing off';
  if (before === undefined) return 'harder';
  if (after > before + 1e-9) return 'harder';
  if (after < before - 1e-9) return 'easier';
  return 'the same effort';
}

/**
 * The next change, when it is within `lead` seconds of `elapsed`, or nothing.
 *
 * @param elapsed the player's own offset — the ride's clock, never a wall one.
 */
export function upcomingBlock(
  timeline: WorkoutTimeline,
  elapsed: number,
  lead: number,
): Upcoming | undefined {
  const current = segmentAt(timeline, seconds(Math.max(0, elapsed)));
  if (current === undefined) {
    return undefined;
  }
  // ⚠️ The lookahead, literally: where the plan will be `lead` seconds from
  // now. The same segment means no change inside the window.
  const ahead = segmentAt(timeline, seconds(Math.max(0, elapsed + lead)));
  if (ahead !== undefined && ahead.startsAt === current.startsAt) {
    return undefined;
  }
  const boundary = current.endsAt as number;
  const inSeconds = Math.max(1, Math.round(boundary - elapsed));
  const when = `In ${spokenLength(inSeconds)}`;
  // Past the end: the last block. Say the workout ends; do not invent a next.
  const next = segmentAt(timeline, seconds(boundary));
  if (next === undefined) {
    return { boundary, sentence: `${when}, the workout ends.` };
  }
  return {
    boundary,
    sentence: `${when}: ${direction(current, next)} — ${spokenSegment(next)}.`,
  };
}
