// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Correcting the rider toward the room** — #782, ADR 0028 D-2.
 *
 * *"The rider's own screen must be instant, so the client simulates locally
 * from its own trainer's power and draws immediately. The room re-simulates
 * every rider … A client that disagrees is corrected toward the room's
 * answer and is never asked to re-report."* So the local simulation keeps
 * running and this decides, from each frame, how far the room says it is out.
 *
 * ## The error, and when it is acted on
 *
 * A frame is the room's position for this rider at the room's instant
 * `tick × frameIntervalMs`, which is in the past by the time it arrives. So it
 * is carried forward at the room's own speed to NOW
 * ({@link roomErrorMetres}), and compared with the local odometer. Under
 * {@link CORRECTION_THRESHOLD_METRES} the two are treated as agreeing: a
 * report reaches the room up to half a second after the power it samples, so
 * the room is a few metres behind a rider accelerating hard, and chasing that
 * would pull a rider back on every sprint.
 *
 * ## How it is applied — `simulation.ts` §`correctToward`
 *
 * Spread over {@link CORRECTION_SECONDS}, a share per fixed step, and **never
 * backwards**: a rider the room places behind them has forward progress taken
 * away, step by step, down to none — they are held, not moved back — so a
 * rider ahead of the room by more than they ride in that time takes longer to
 * converge, and is told nothing moved backwards because nothing did.
 *
 * ## What the trainer feels — `game/gradient.ts` §`sample`
 *
 * The trainer's gradient comes from the rider's position (#362), so moving the
 * position moves the resistance. While a correction runs, the gradient the
 * trainer is sent may change by at most {@link CORRECTION_GRADE_STEP_PERCENT_PER_SECOND}
 * per second, and `trainer-wiring.test.tsx` §"#782" reads that off the
 * trainer double rather than off the position.
 */

/**
 * The disagreement acted on, in metres: **8**.
 *
 * About what a rider going 12 m/s (43 km/h) covers in the 500 ms between two
 * reports, plus 2 m for the frame's own rounding and clocks — so ordinary
 * latency is never corrected, and a room that has actually placed the rider
 * elsewhere is. Chosen, not measured on a person.
 */
export const CORRECTION_THRESHOLD_METRES = 8;

/**
 * How long a correction is spread over, in seconds: **2** — two frames at the
 * default 1 Hz, so a correction has finished before the next-but-one frame
 * could start another. Chosen.
 */
export const CORRECTION_SECONDS = 2;

/**
 * The most the gradient sent to a trainer may change per second while a
 * correction runs: **1 %**. A rider moved 20 m up a road whose grade steps
 * from 2 % to 8 % is walked up to it over six seconds rather than hit with it
 * mid-effort. Chosen, and ten times the driver's own deadband of 0.1 %
 * (`@onyourleft/domain` §`SIMULATION_GRADE_DEADBAND_PERCENT`), so a bounded
 * write is still one the driver would have made.
 */
export const CORRECTION_GRADE_STEP_PERCENT_PER_SECOND = 1;

/** The room's word on where this rider is. */
export interface RoomPosition {
  readonly distanceMetres: number;
  readonly speedMetresPerSecond: number;
  /** The LOCAL instant the room's position describes, in milliseconds. */
  readonly atLocalMs: number;
}

/**
 * How far the room places this rider ahead of where the local simulation has
 * them at `nowMs` — negative when behind — or `undefined` when the two agree
 * to within {@link CORRECTION_THRESHOLD_METRES}.
 */
export function roomErrorMetres(
  room: RoomPosition,
  localDistanceMetres: number,
  nowMs: number,
): number | undefined {
  const carried = Math.max(0, nowMs - room.atLocalMs) / 1000;
  const roomNow = room.distanceMetres + room.speedMetresPerSecond * carried;
  const error = roomNow - localDistanceMetres;
  if (!Number.isFinite(error) || Math.abs(error) <= CORRECTION_THRESHOLD_METRES) return undefined;
  return error;
}
