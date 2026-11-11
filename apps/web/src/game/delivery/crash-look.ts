// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A crash in a Delivery round, DRAWN — #2454. Until it, a crash cost the round
 * a point and nothing on screen showed it (`obstacles.ts` §"A crash costs
 * points, and nothing else"). The owner, on the tablet: "when I hit an
 * obstacle nothing happens. Should be a crash animation and then respawn the
 * user on the bike."
 *
 * ## What is drawn: the rider goes down where they are, and gets back up
 *
 * For {@link CRASH_SECONDS} after a crash the rider's bicycle, and the rider
 * on it, fall over to one side, lie there, and are back upright on the bike:
 *
 * - **Down**, over {@link CRASH_FALL_SECONDS}: the lean goes from the ride's
 *   own to {@link CRASH_LEAN_RADIANS}, gathering speed as a fall does (the
 *   square of the time).
 * - **Lying**, until {@link CRASH_RISE_AT_SECONDS}: held there, the body rolled
 *   with the bicycle rather than held upright over it, and the pedal stroke's
 *   motion stopped.
 * - **Back up** — the respawn — over {@link CRASH_RISE_SECONDS}: eased back to
 *   the ride's own lean, so the rider rejoins the ride with no jump.
 *
 * ## Where: at the simulated position, so the camera does nothing new
 *
 * The rider is drawn where the simulation has them throughout, which is where
 * they were drawn before #2454: the crash changes the drawn ATTITUDE and
 * nothing else. So the chase camera follows the odometer as it always does,
 * and there is nothing to rejoin: the respawn is the bicycle standing up where
 * it already is. A crash that held the drawn rider back would need the camera
 * to choose between them and a jump back; one that really paused the rider
 * would change the trainer's timing, which ADR 0059 D-2 item 4 forbids
 * without an amendment and an owner ruling. Neither is done.
 *
 * ## Reduced motion (§4e)
 *
 * No fall and no rise: {@link crashShare} is a still crash pose, the bicycle
 * on its side, from the crash until the rise would have begun, and then the
 * crash is over and the rider is drawn upright as the ride draws them — no
 * animation between, and the HUD's "Crashed" ends with the pose.
 *
 * ## A drawing, never physics
 *
 * It imports nothing. Nothing here is read by `simulation.ts`, the gradient
 * session or the trainer, and `delivery-cannot-reach-trainer.test.ts` walks
 * the Delivery modules unchanged.
 */

/** How long the fall takes, in seconds: **0.45**, about a body's height falling at 1 g. */
export const CRASH_FALL_SECONDS = 0.45;

/** When the rider starts back up, in seconds after the crash: **1.2**. */
export const CRASH_RISE_AT_SECONDS = 1.2;

/** How long getting back up takes, in seconds: **0.3**. */
export const CRASH_RISE_SECONDS = 0.3;

/** How long a crash is drawn, start to finish: **1.5 s**, inside the issue's "about 1–2 s". */
export const CRASH_SECONDS = CRASH_RISE_AT_SECONDS + CRASH_RISE_SECONDS;

/**
 * How far over a fallen bicycle lies, in radians from upright: **75°** — on
 * its side, short of flat so the rider stays in sight from the chase camera.
 */
export const CRASH_LEAN_RADIANS = (75 * Math.PI) / 180;

/**
 * How far into the crash pose the rider is drawn, `seconds` after a crash: 0
 * on the bike as the ride draws them, 1 on the ground. `undefined` before the
 * crash (a negative or non-finite time) and once {@link CRASH_SECONDS} have
 * passed — under reduced motion once {@link CRASH_RISE_AT_SECONDS} have: the
 * crash is over and the ride is drawn as it is.
 */
export function crashShare(seconds: number, reducedMotion: boolean): number | undefined {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds >= CRASH_SECONDS) return undefined;
  // #2454's review: over at the rise under reduced motion, not a still upright
  // pose until CRASH_SECONDS, so the HUD's "Crashed" ends as the rider is up.
  if (reducedMotion) return seconds < CRASH_RISE_AT_SECONDS ? 1 : undefined;
  if (seconds < CRASH_FALL_SECONDS) return (seconds / CRASH_FALL_SECONDS) ** 2;
  if (seconds < CRASH_RISE_AT_SECONDS) return 1;
  const risen = (seconds - CRASH_RISE_AT_SECONDS) / CRASH_RISE_SECONDS;
  // Smoothstep down to nought: no jump as the rise starts or as it ends.
  return 1 - risen * risen * (3 - 2 * risen);
}

/** Which way a crashed rider falls: to the rider's right (`1`) or left (`-1`). */
export type CrashSide = 1 | -1;

/**
 * A crash being drawn: when it happened, by `GameView`'s crash clock — the
 * frames the loop ran, so a pause does not use it up — and which way the rider
 * falls.
 */
export interface DrawnCrash {
  readonly atMs: number;
  readonly side: CrashSide;
}

/**
 * The crash to draw once another happens at `atMs`, falling to `side`: that
 * one, unless `drawing` is still being drawn — a rider already down does not
 * jump back up to fall again, so a second obstacle hit while down is drawn as
 * the first. Its point and its sentence are the round's, as before.
 */
export function crashFrom(
  drawing: DrawnCrash | undefined,
  atMs: number,
  side: CrashSide,
): DrawnCrash {
  if (drawing !== undefined && (atMs - drawing.atMs) / 1000 < CRASH_SECONDS) return drawing;
  return { atMs, side };
}

/**
 * Which way a rider steered to `offset` metres right of the centre line falls:
 * toward the edge of the road their lane is on, the right from the middle.
 */
export function crashSideFor(offset: number): CrashSide {
  return offset < 0 ? -1 : 1;
}

/**
 * The rider's drawn roll a share `share` of the way into a crash to `side`,
 * from the ride's own `bicycle` and `body` (`bicycle.ts` §`RiderRoll`): the
 * bicycle toward {@link CRASH_LEAN_RADIANS} on that side, and the body's roll
 * relative to it toward nought, so a fallen rider lies with the bicycle.
 */
export function crashedRoll(
  roll: { readonly bicycle: number; readonly body: number },
  share: number,
  side: CrashSide,
): { readonly bicycle: number; readonly body: number } {
  return {
    bicycle: roll.bicycle + (side * CRASH_LEAN_RADIANS - roll.bicycle) * share,
    // `+ 0` so that a fallen rider's body is `0` and never `-0`, as `bicycleRoll`'s.
    body: roll.body * (1 - share) + 0,
  };
}
