// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the #547 start-of-ride case asserts about frame TIME, as arithmetic the
 * fast suite can hold — #997.
 *
 * `game.browser.spec.ts` §"builds no GPU program in the first frames" draws a
 * ride's first frames twice in the pinned Chromium: once at once (the control)
 * and once after `prepare` (the product's order). Links are its precise half.
 * Time is the coarse half, kept because a `prepare` that links everything
 * without the ride's first frame staged leaves ≈ 600 ms of a ≈ 610 ms first
 * frame where it was with a link count of zero (`three-renderer.ts` §`prepare`).
 *
 * ⚠️ **The old timing assertion flaked, and this is what replaced it.** It held
 * the slowest prepared frame — ANY of ten — under a quarter of the control's
 * first, two wall-clock samples on a shared two-core runner with SwiftShader.
 * On runs 36890311939, 36888132751, 36887027370 and 37011934599 a prepared
 * frame took 120 ms while the control's first took 362: one busy-runner frame,
 * anywhere in ten, against a control that happened to be fast. The failure it
 * exists for is not "some frame was slow" but "the FIRST frame still paid for
 * the start", so it now compares like with like:
 *
 * - each run's **first-frame excess** — its first frame less the median of the
 *   frames after it, which takes out what any frame costs on that machine at
 *   that moment;
 * - and requires the prepared excess to be under
 *   {@link RIDE_START_EXCESS_SHARE} of the control's.
 *
 * A noisy LATER frame no longer counts at all, and the regressions this guards
 * against put the prepared excess at about the control's (a share near 1), so
 * the bound keeps a factor of two either side.
 */

/**
 * The most of the control's first-frame excess a prepared first frame may keep:
 * **0.5**. The two measured regressions keep about all of it (600 and 560 ms
 * against ≈ 540); a healthy `prepare` keeps about none (≈ 9 ms against 540).
 */
export const RIDE_START_EXCESS_SHARE = 0.5;

/** The middle value of `values`; the mean of the two middle ones for an even count. */
export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new RangeError('median of no values');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * How much more a run's first frame cost than the frames after it: the first
 * less the median of the rest, never below nought. Needs at least two frames.
 */
export function firstFrameExcess(frameMs: readonly number[]): number {
  const [first, ...rest] = frameMs;
  if (first === undefined || rest.length === 0) {
    throw new RangeError('a first-frame excess needs at least two frames');
  }
  return Math.max(0, first - median(rest));
}

/**
 * Whether the prepared run's first frame kept less than
 * {@link RIDE_START_EXCESS_SHARE} of the control's first-frame excess.
 */
export function prepareTookTheStall(
  preparedFrameMs: readonly number[],
  unpreparedFrameMs: readonly number[],
): boolean {
  return (
    firstFrameExcess(preparedFrameMs) <
    RIDE_START_EXCESS_SHARE * firstFrameExcess(unpreparedFrameMs)
  );
}
