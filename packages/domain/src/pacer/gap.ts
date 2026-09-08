// SPDX-License-Identifier: Apache-2.0

/**
 * How far ahead the bot is — #92's fourth acceptance criterion, minus its
 * screen.
 *
 * The criterion reads *"the bot's position relative to the rider is visible in
 * the HUD (#94) as time or distance gap, updating continuously"*. The **HUD**
 * is #94's and lives in `apps/mobile`, which does not exist yet (#87 creates
 * it). What is deliverable here is the arithmetic underneath it, and it belongs
 * here rather than in the screen for the reason every other computation in this
 * package does: a gap shown on a phone and a gap shown on the web must be the
 * same number, and "distance ÷ speed" is exactly the kind of one-liner that
 * gets written twice with two different speeds in it.
 *
 * ## Two odometers, not two positions on a route
 *
 * Both distances are **odometers** — how far each has ridden in total, not
 * where they are on the route — and they are compared without wrapping. That
 * is deliberate and it is the whole behaviour on a loop: a bot a full lap ahead
 * of the rider reads as a lap's worth of metres ahead, not as zero. Wrapping
 * either one first would report a bot about to lap you as being level with you,
 * which is the one moment a rider most wants the number to be right.
 *
 * `route/profile.ts` §`distanceOnRoute` is what wraps, and it is for asking
 * *what gradient is here*. This is asking *who is in front*, which is a
 * different question about the same two numbers.
 *
 * ## This compares the rider to a computation, and to nothing else
 *
 * ⚠️ Worth stating in the file that does the comparing: the only thing a rider
 * is measured against here is the bot, and the bot is arithmetic over a target
 * intensity and a route (`pacer/pacing.ts`). There is no other person in this
 * calculation, no ordering, no board and nothing stored. ADR 0007 D4 is why,
 * and #92's last criterion — *"no leaderboard, ranking or comparison against
 * any other person exists in this issue"* — is the line this file must not be
 * the first to cross.
 */

import type { Metres, MetresPerSecond, Seconds } from '../quantities';
import { seconds } from '../quantities';

/** Where the bot and the rider have each got to, and how fast the rider is going. */
export interface GapInput {
  /** The bot's odometer. Unwrapped — see the header. */
  readonly botDistance: Metres;
  /** The rider's odometer, on the same route and from the same start. */
  readonly riderDistance: Metres;
  /**
   * The speed the time gap is expressed at.
   *
   * The rider's own current speed is the natural choice and is what #94 should
   * pass: it answers *"at this pace, how long until I am where the bot is"*,
   * which is the question a rider is actually asking. It is a parameter rather
   * than a fixed choice because the other sensible answer — the bot's speed,
   * giving *"how long ago was the bot here"* — is the same arithmetic, and a
   * caller that wants a steadier number on a punchy course may prefer it.
   */
  readonly referenceSpeed: MetresPerSecond;
}

/** The gap, in both of the units #92's criterion offers. */
export interface PacerGap {
  /**
   * Signed, in metres: **positive when the bot is ahead**, negative when the
   * rider is.
   *
   * A plain number rather than a `Metres`, for the reason `packages/physics`
   * returns plain numbers from its force terms: `Metres` is a non-negative
   * magnitude, so a branded gap could not describe a rider who is winning.
   */
  readonly metres: number;
  /**
   * Signed, in seconds, at {@link GapInput.referenceSpeed}. Same sign
   * convention as {@link metres}.
   *
   * `undefined` when the reference speed is zero — a rider at a standstill is
   * not closing a gap at all, and any number here would be a lie about a
   * division by zero. #94 renders that as a dash, not as a nought.
   */
  readonly seconds: number | undefined;
}

/**
 * The gap between the bot and the rider, as a distance and as a time.
 *
 * Pure arithmetic over two odometers and a speed. Nothing here reads a clock,
 * and nothing here reads a stored ride: both distances are produced live, the
 * rider's by their own recording and the bot's by
 * `@onyourleft/physics`'s `advanceBot`.
 */
export function pacerGap(input: GapInput): PacerGap {
  const metres = input.botDistance - input.riderDistance;
  const speed: number = input.referenceSpeed;
  return {
    metres,
    seconds: speed > 0 ? metres / speed : undefined,
  };
}

/**
 * Whether the bot is in front. `false` when the two are exactly level, which is
 * the honest answer to "is it ahead" and the one a HUD should render as level
 * rather than as behind.
 */
export function botIsAhead(gap: PacerGap): boolean {
  return gap.metres > 0;
}

/**
 * The gap as a magnitude, for a caller that renders the direction separately —
 * "12 s behind" reads better than "−12 s", and formatting a minus sign into a
 * label is where a sign gets lost.
 */
export function gapMagnitudeSeconds(gap: PacerGap): Seconds | undefined {
  return gap.seconds === undefined ? undefined : seconds(Math.abs(gap.seconds));
}
