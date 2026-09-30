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
 * ⚠️ **And over {@link explainableMetres} it is ignored** (#922): the most
 * the two could have come apart since the frame before, at the faster of
 * the local speed and the speed the room reports — the latter admitted only
 * as far as the local speed makes it plausible ({@link admittedRoomSpeed}).
 * Before #922 there was a floor and no ceiling, so a room — buggy or
 * hostile — could move the rider any distance along the route with one
 * frame. A frame that far out leaves the local odometer alone. After a
 * legitimate drop the frames are far apart and so is the bound: 55 s at
 * 10 m/s is 550 m, and a correction that size still goes through.
 *
 * ⚠️ **The room does not choose its own ceiling** (#928's review). A room
 * reporting the wire's maximum, 100 m/s, is read as reporting at most
 * {@link admittedRoomSpeed} of the local speed, so it moves a rider riding at
 * 10 m/s by at most about 50 m a frame at 1 Hz rather than about 300 m. What
 * it can still do is move the rider by that much, frame after frame — as far
 * as a rider going a quarter faster, plus 2 m/s, would have gone.
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

/**
 * How much faster than the local simulation the room may say this rider is
 * going and be believed: **25 %, plus 2 m/s**. The room re-simulates the same
 * reported power through the same physics (ADR 0028 D-2 rule 5), so an honest
 * room's speed differs from the local one only by the half second a report
 * takes to reach it: a hard sprint gains well under 1 m/s in that time, which
 * the 2 m/s covers from a standstill, and the quarter covers a descent, where
 * speed changes fastest. Chosen, not measured on a person.
 */
export const ROOM_SPEED_ALLOWANCE_SHARE = 0.25;
export const ROOM_SPEED_ALLOWANCE_METRES_PER_SECOND = 2;

/**
 * The room's reported speed for this rider, as far as the local speed can
 * explain it (#922, #928's review): never more than
 * `local × (1 + {@link ROOM_SPEED_ALLOWANCE_SHARE}) + {@link ROOM_SPEED_ALLOWANCE_METRES_PER_SECOND}`.
 */
export function admittedRoomSpeed(
  roomMetresPerSecond: number,
  localMetresPerSecond: number,
): number {
  const local = Math.max(0, localMetresPerSecond);
  return Math.min(
    roomMetresPerSecond,
    local * (1 + ROOM_SPEED_ALLOWANCE_SHARE) + ROOM_SPEED_ALLOWANCE_METRES_PER_SECOND,
  );
}

/**
 * How far the local odometer and the room's may have come apart since the
 * frame before this one, in metres: the faster of the two speeds, over the
 * time since that frame plus a correction's own {@link CORRECTION_SECONDS}
 * (the last correction may still have been under way), plus
 * {@link CORRECTION_THRESHOLD_METRES} for the latency the threshold is for.
 * #922. Chosen, from what the frames themselves say.
 */
export function explainableMetres(fasterMetresPerSecond: number, sinceSeconds: number): number {
  return (
    CORRECTION_THRESHOLD_METRES +
    Math.max(0, fasterMetresPerSecond) * (Math.max(0, sinceSeconds) + CORRECTION_SECONDS)
  );
}

/** The room's word on where this rider is. */
export interface RoomPosition {
  readonly distanceMetres: number;
  readonly speedMetresPerSecond: number;
  /** The LOCAL instant the room's position describes, in milliseconds. */
  readonly atLocalMs: number;
}

/** What the local simulation knows, beside the room's frame (#922). */
export interface LocalPosition {
  readonly distanceMetres: number;
  readonly speedMetresPerSecond: number;
  /**
   * The LOCAL instant the frame before this one described — or, for the
   * first frame of a ride, when the ride began — in milliseconds.
   */
  readonly sinceLocalMs: number;
}

/**
 * How far the room places this rider ahead of where the local simulation has
 * them at `nowMs` — negative when behind — or `undefined` when the two agree
 * to within {@link CORRECTION_THRESHOLD_METRES}, or disagree by more than
 * {@link explainableMetres} (#922), which is no correction to make.
 */
export function roomErrorMetres(
  room: RoomPosition,
  local: LocalPosition,
  nowMs: number,
): number | undefined {
  const carried = Math.max(0, nowMs - room.atLocalMs) / 1000;
  const roomNow = room.distanceMetres + room.speedMetresPerSecond * carried;
  const error = roomNow - local.distanceMetres;
  if (!Number.isFinite(error) || Math.abs(error) <= CORRECTION_THRESHOLD_METRES) return undefined;
  const faster = Math.max(
    local.speedMetresPerSecond,
    admittedRoomSpeed(room.speedMetresPerSecond, local.speedMetresPerSecond),
  );
  const since = (nowMs - local.sinceLocalMs) / 1000;
  if (!(Math.abs(error) <= explainableMetres(faster, since))) return undefined;
  return error;
}
