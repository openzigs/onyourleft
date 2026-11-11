// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The drawn rider eases off for a sharp bend, as a real rider brakes — #1998.
 *
 * ## Why
 *
 * The game never slows for a bend: the simulation has no cornering speed
 * limit, because the trainer is sent grade only. So the drawn lean,
 * `tan φ = v²/(g·R)` from `racing-line.ts` §`leanAt`, sat at its 38.7° cap
 * through every 90–180° corner taken at speed, and the rider looked as if they
 * were falling over. **Owner ruling, 2026-11-02:** *ease off for bends*. The
 * drawn rider slows into a sharp bend; the rider's watts count exactly as
 * before; only the DRAWN speed through the bend changes. That supersedes
 * #546's "true to physics" ruling for lean in a tight bend.
 *
 * ## What is drawn
 *
 * Each rider is drawn at a DRAWN place `D = d − lag` along the road, where `d`
 * is their odometer, moving at a drawn speed `u`:
 *
 * - **Into a bend**, `u` is at most the speed whose steady-turn lean on the
 *   LINE is {@link EASED_LEAN_RADIANS} (25°), `√(g·tan 25° / |κ|)`, and it
 *   comes down to it at {@link BRAKING_METRES_PER_SECOND_SQUARED} before the
 *   bend, and goes back up at {@link PICK_UP_METRES_PER_SECOND_SQUARED} after.
 *   While `u` is below the rider's own speed `v`, the drawn rider falls behind
 *   the odometer: the lag grows by `1 − u/v` a metre ridden.
 * - **After it**, the lag is GIVEN BACK: the drawn rider rides faster than
 *   the odometer, by at most {@link GIVE_BACK_SHARE} of `v`, and by less as
 *   it closes in — the extra speed falls at {@link GIVE_BACK_EASING_METRES_PER_SECOND_SQUARED}
 *   as the lag runs out — so it arrives on the odometer smoothly, never
 *   overtakes it (the lag never goes below nought), and is exactly on it a
 *   little way after the bend. The lag is BOUNDED, at {@link MAX_LAG_METRES}:
 *   at a descent's speed a hairpin would cost hundreds of metres, which could
 *   not be given back inside {@link EASING_WINDOW_METRES} and would be
 *   dropped in one step as the bend left it.
 *
 * ## What is NOT changed — and how the speed lost is accounted for
 *
 * ⚠️ **This is a drawing, never physics.** Nothing here is read by the
 * simulation, the trainer's grade (`gradient.ts`), recording, the HUD's
 * distance, speed or "To go", segments, the ghost's replay or the pacer's gap:
 * they all stay on the odometer, and the rider's watts move the odometer
 * exactly as they did. The speed lost in a bend is kept as a difference in
 * DRAWN POSITION only, the lag, and given back on the way out, so the drawn
 * rider is on their own odometer again once the road straightens — a ride's
 * recorded distance is the rider's own, and no distance is invented or lost.
 *
 * **Pacers and ghosts stay comparable** in two ways: every rider is eased by
 * this one function of where they are and how fast, so a bot or a ghost at the
 * rider's distance and speed is drawn exactly where the rider is; and no
 * rider is drawn more than {@link MAX_LAG_METRES} behind their odometer, so
 * riders at different speeds are never drawn further out of order than that,
 * and "To go" and the finish are never further out than that.
 *
 * ## Stateless, like the lean
 *
 * The lag is a function of the odometer and the speed alone — the lag a rider
 * holding this speed would have at this point — found by riding the last
 * {@link EASING_WINDOW_METRES} at that speed. `racing-line.ts` §"The lean"
 * argues the same for the roll rate: no state, so a frame is a function of
 * where the riders are and how fast. For a rider holding their speed the drawn
 * place never goes backwards (`D` moves `u/v` a metre). ⚠️ **What it costs**:
 * a rider whose speed changes in a bend has their lag recomputed for the new
 * speed, so their drawn place moves a little faster or slower than `u` while
 * they accelerate or brake; and a run of bends longer than the window is eased
 * as if the lag were nought where the window begins.
 *
 * Pure: no clock, no `three`, no DOM, no platform API.
 */

import { distanceOnRoute } from '@onyourleft/domain';
import { STANDARD_GRAVITY_METRES_PER_SECOND_SQUARED } from '@onyourleft/physics';

import type { RacingLine } from './racing-line';

/**
 * The most a rider is drawn leaning in a bend they are eased through: **25°**,
 * the owner's *"about 25° or less"* (#1998). The combined lean — rider and
 * bicycle together, `racing-line.ts` §`leanAt`.
 */
export const EASED_LEAN_RADIANS = (25 * Math.PI) / 180;

/**
 * How hard the drawn rider brakes for a bend: **3 m/s²**. Chosen, and stated
 * as a choice: firm, unhurried braking on a dry road, well inside the 5–6 m/s²
 * a bicycle stops at in an emergency, so the slowing reads as a rider setting
 * up a bend rather than grabbing the brakes.
 */
export const BRAKING_METRES_PER_SECOND_SQUARED = 3;

/**
 * How hard the drawn rider picks up speed out of a bend: **1 m/s²**. Chosen:
 * a rider sprinting out of a corner manages about this, and a softer one would
 * leave the drawn rider dawdling through the exit.
 */
export const PICK_UP_METRES_PER_SECOND_SQUARED = 1;

/**
 * The most the drawn rider rides faster than the odometer while it gives back
 * the lag: **15 %** of the rider's speed. Chosen: enough to give back a
 * hairpin's lag within a couple of hundred metres, little enough that a
 * rider is not seen sprinting away from a pacer they are level with.
 */
export const GIVE_BACK_SHARE = 0.15;

/**
 * How gently the drawn rider arrives back on the odometer: its speed over the
 * odometer's falls at **0.5 m/s²** as the last of the lag is given back, so
 * it is `√(2 · 0.5 · lag)` — nought exactly as the lag is, rather than
 * {@link GIVE_BACK_SHARE} over its speed up to the moment it stops dead on
 * it. Chosen. A closing speed proportional to the lag never arrives at all.
 */
export const GIVE_BACK_EASING_METRES_PER_SECOND_SQUARED = 0.5;

/**
 * The most the drawn rider ever lags its odometer: **30 m**. Chosen, and why it
 * is a bound rather than whatever the bend costs: at a descent's speed a
 * hairpin costs hundreds of metres of lag (256 m at 25 m/s), which takes more
 * than {@link EASING_WINDOW_METRES} to give back, so the lag recomputed from the
 * window dropped in one step as the bend left it and the drawn rider jumped
 * metres in a frame; and a rider that far behind its own odometer disagrees
 * with the HUD's gap, "To go" and a pacer or ghost beside it. Giving back
 * `L` metres takes about `L / `{@link GIVE_BACK_SHARE} of odometer (200 m for
 * 30 m, at any speed), so the whole lag is given back well inside the window.
 * ⚠️ Where the bend would cost more, the drawn place keeps pace with the
 * odometer once the lag is at the bound while the drawn speed stays eased: the
 * lean is held to 25° and the position is held close to the odometer.
 */
export const MAX_LAG_METRES = 30;

/**
 * How far back the lag is ridden from: **1 000 m**. With the lag bounded by
 * {@link MAX_LAG_METRES} a bend's lag is given back within about 250 m of it
 * at any speed up to a descent's; this is long enough for a run of switchbacks.
 */
export const EASING_WINDOW_METRES = 1_000;

/** The step the lag is ridden at, in metres of odometer. */
const EASING_STEP_METRES = 1;

/**
 * The step the speed limit is laid out at, in metres of route: **0.5 m**,
 * `racing-line.ts` §`leanAt`'s own grid, so the limit is as fine as the
 * curvature the lean is read from.
 */
const LIMIT_STEP_METRES = 0.5;

/**
 * How far either side of a place `leanAt` reads the curvature its lean is
 * drawn from: its half-metre grid (`LEAN_STEP_METRES`).
 */
const LEAN_READ_METRES = 0.5;

/** Where a speed limit is no limit — a straight, curvature nought. Finite so it interpolates. */
const NO_LIMIT_SQUARED = 1e12;

/** Where a rider is drawn along the road, and how fast. */
export interface EasedPlace {
  /** The drawn place, as an odometer: never past the one it was given. */
  readonly distance: number;
  /** The drawn speed there, in metres a second. */
  readonly speed: number;
}

/**
 * Where, and how fast, a rider at odometer `distance` and speed `speed` is
 * DRAWN on `line`'s route. @see the module note
 *
 * At rest, on a straight and anywhere no bend in the window asks this speed
 * to ease off, it is exactly `{ distance, speed }`.
 *
 * Three steps, each over only the stretch that can matter:
 *
 * 1. **Whether anything does.** The line's curvature is linear between its
 *    samples, so its tightest is AT a sample; a sample whose steady-turn
 *    speed at 25° is not under `speed` cannot slow it. The earliest place a
 *    sample that is under it can reach back to — by braking from the
 *    give-back's speed — is where the lag can first be other than nought.
 * 2. **The limit** on a half-metre grid from there to beyond the odometer by
 *    a stop's length: the steady-turn limit of the tightest curvature within
 *    {@link LEAN_READ_METRES}, brought down ahead of a bend at
 *    {@link BRAKING_METRES_PER_SECOND_SQUARED} and up after it at
 *    {@link PICK_UP_METRES_PER_SECOND_SQUARED}. Fine, not per sample: the
 *    limit's square, `g·tan 25° / κ`, is convex in a curvature that is linear
 *    between samples, so a limit drawn straight between two samples is above
 *    the limit in between, and leant the rider at 27–29° in a test.
 * 3. **The lag**, ridden from there to the odometer at
 *    {@link EASING_STEP_METRES}: `1 − u/v` a metre, between nought and
 *    {@link MAX_LAG_METRES}.
 */
export function easedPlace(line: RacingLine, distance: number, speed: number): EasedPlace {
  if (!(speed > 0) || !Number.isFinite(distance)) {
    return { distance, speed };
  }
  const fastest = speed * (1 + GIVE_BACK_SHARE);
  // How far a bend can reach back: braking from the fastest the drawn rider
  // ever goes, to a stop, and a sample and the lean's read either side.
  const reach =
    (fastest * fastest) / (2 * BRAKING_METRES_PER_SECOND_SQUARED) +
    line.profile.resolution +
    LEAN_READ_METRES;
  const from = easingStarts(line, distance, speed, reach);
  if (from === undefined) {
    return { distance, speed };
  }
  const limit = limitsFrom(line, from, distance + reach);
  let lag = 0;
  for (let at = from; at < distance;) {
    const step = Math.min(EASING_STEP_METRES, distance - at);
    const drawn = drawnSpeed(limit, from, at - lag, speed, lag);
    lag = Math.min(MAX_LAG_METRES, Math.max(0, lag + step * (1 - drawn / speed)));
    at += step;
  }
  return { distance: distance - lag, speed: drawnSpeed(limit, from, distance - lag, speed, lag) };
}

/**
 * Where, inside the window, the lag can first be other than nought for a
 * rider at `distance` and `speed` — or `undefined` where no bend within reach
 * asks this speed to ease off. @see easedPlace, step 1
 */
function easingStarts(
  line: RacingLine,
  distance: number,
  speed: number,
  reach: number,
): number | undefined {
  const resolution: number = line.profile.resolution;
  const turning = turningSquared();
  const windowStart = distance - EASING_WINDOW_METRES;
  let earliest: number | undefined;
  const first = Math.floor(windowStart / resolution) * resolution;
  for (let at = first; at <= distance + reach; at += resolution) {
    const curvature = curvatureAt(line, at);
    if (!(curvature > 0)) continue;
    const limit = turning / curvature;
    if (limit >= speed * speed) continue;
    const reachesBack = at - reach;
    earliest = earliest === undefined ? reachesBack : Math.min(earliest, reachesBack);
  }
  if (earliest === undefined || earliest > distance) {
    return undefined;
  }
  return Math.max(windowStart, earliest);
}

/** The limit's square on {@link LIMIT_STEP_METRES} from `from` to `to`. @see easedPlace, step 2 */
function limitsFrom(line: RacingLine, from: number, to: number): Float64Array {
  const count = Math.ceil((to - from) / LIMIT_STEP_METRES) + 1;
  const found = limitScratch(count);
  const turning = turningSquared();
  for (let index = 0; index < count; index += 1) {
    const curvature = tightestNear(line, from + index * LIMIT_STEP_METRES);
    found[index] =
      curvature > 0 ? Math.min(NO_LIMIT_SQUARED, turning / curvature) : NO_LIMIT_SQUARED;
  }
  const braking = 2 * BRAKING_METRES_PER_SECOND_SQUARED * LIMIT_STEP_METRES;
  for (let index = count - 2; index >= 0; index -= 1) {
    found[index] = Math.min(found[index] as number, (found[index + 1] as number) + braking);
  }
  const pickUp = 2 * PICK_UP_METRES_PER_SECOND_SQUARED * LIMIT_STEP_METRES;
  for (let index = 1; index < count; index += 1) {
    found[index] = Math.min(found[index] as number, (found[index - 1] as number) + pickUp);
  }
  limitCount = count;
  return found;
}

/**
 * The scratch {@link limitsFrom} lays the limit out in — MODULE scratch, grown
 * when a call needs more and never shrunk, as `racing-line.ts` §`leanAt`'s
 * is. Safe because {@link easedPlace} is synchronous and re-entered by nothing
 * it calls. {@link limitCount} is how much of it the last call filled.
 */
let limitBuffer = new Float64Array(4_096);
let limitCount = 0;

function limitScratch(count: number): Float64Array {
  if (limitBuffer.length < count) {
    limitBuffer = new Float64Array(count);
  }
  return limitBuffer;
}

/** The drawn speed at a drawn place with a lag to give back: under the limit, and over `speed` only by the give-back. */
function drawnSpeed(
  limit: Float64Array,
  from: number,
  at: number,
  speed: number,
  lag: number,
): number {
  const closing = Math.sqrt(2 * GIVE_BACK_EASING_METRES_PER_SECOND_SQUARED * lag);
  const wanted = speed + Math.min(GIVE_BACK_SHARE * speed, closing);
  const raw = Math.max(0, (at - from) / LIMIT_STEP_METRES);
  const index = Math.min(Math.floor(raw), limitCount - 2);
  const fraction = Math.min(1, raw - index);
  const low = limit[index] as number;
  const high = limit[index + 1] as number;
  return Math.min(Math.sqrt(low + (high - low) * fraction), wanted);
}

/** `g · tan 25°`: a steady turn's speed squared times its curvature, at {@link EASED_LEAN_RADIANS}. */
function turningSquared(): number {
  return STANDARD_GRAVITY_METRES_PER_SECOND_SQUARED * Math.tan(EASED_LEAN_RADIANS);
}

/**
 * The largest |curvature| within {@link LEAN_READ_METRES} of a distance —
 * linear between samples, as `racing-line.ts` reads it, so the largest is at
 * an end of that stretch or at a sample inside it.
 */
function tightestNear(line: RacingLine, distance: number): number {
  const resolution: number = line.profile.resolution;
  let tightest = Math.max(
    curvatureAt(line, distance - LEAN_READ_METRES),
    curvatureAt(line, distance + LEAN_READ_METRES),
  );
  const inside = Math.ceil((distance - LEAN_READ_METRES) / resolution) * resolution;
  if (inside <= distance + LEAN_READ_METRES) {
    tightest = Math.max(tightest, curvatureAt(line, inside));
  }
  return tightest;
}

/** The line's |curvature| at a distance, linear between samples — `racing-line.ts` §`curvatureAt`'s reading. */
function curvatureAt(line: RacingLine, distance: number): number {
  const values = line.curvatures;
  if (values.length < 2) {
    return 0;
  }
  const raw = distanceOnRoute(line.profile, distance) / line.profile.resolution;
  const index = Math.max(0, Math.min(Math.floor(raw), values.length - 2));
  const fraction = Math.max(0, Math.min(1, raw - index));
  const low = values[index] as number;
  const high = values[index + 1] as number;
  return Math.abs(low + (high - low) * fraction);
}
