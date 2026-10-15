// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Another rider's ghost, as this instance serves it** (#331, ADR 0039).
 *
 * A rider racing a route asks for a ghost by the SHA-256 of that route's
 * canonical GPX (`migrations/0024-race-route.ts` says what the digest is and
 * who sets it). The instance answers with **one** attempt, or none:
 *
 * - **One, never a list** (ADR 0021 D-4.1, ADR 0039 D-3). The route answers a
 *   single ghost, so there is nothing for a client to rank, order or place,
 *   and no response shape that could carry a plurality (D-4.2, D-4.7).
 * - **Which one: the most recently arrived** that the caller may see. Not
 *   the fastest: choosing the fastest of several riders is ranking them, and
 *   ADR 0021 D-2 rests the distance to '026 on there being no ranked list. The
 *   newest is a choice about time, not about anybody's performance.
 * - **Only a consented, offered ride of somebody else's** (`sql-store.ts`
 *   §`listRaceableOnRoute`), and only one the caller may see: a rider who
 *   blocked them, or whom they blocked, or whom a moderator suspended, is
 *   passed over (`moderation.ts` §`canSee`, asked once per candidate).
 * - **Only the speed, against a uniform clock**, and the rider's public
 *   display name. No position, no time of day, no date, no power, no heart
 *   rate, no ride id, no content hash — nothing a ghost does not need to be
 *   raced. A ghost is not a signed record and not evidence (ADR 0021 D-5.4).
 *
 * The speed is resampled onto a uniform clock here so the client replays it
 * with the same integrator its own ghost uses (`apps/web/src/game/
 * ghost-source.ts` §`ghostFromSpeed`), which refuses a ride holed for more
 * than a few seconds rather than guessing across it.
 */

import type { Sample } from './activity-file.ts';

/**
 * The most slots a ghost is sent in. Two hours at one a second; a longer ride
 * is sent at a coarser whole-second step so the answer stays far inside the
 * client's answer limit (`instance-transport.ts`
 * §`MAXIMUM_INSTANCE_ANSWER_BYTES`, 256 KiB).
 */
export const MAXIMUM_GHOST_SLOTS = 7200;

/** Speeds are sent to a centimetre a second: finer is noise, and bytes. */
const SPEED_STEP = 100;

/** What a client is sent for one ghost. */
export interface RiderGhost {
  /** The rider's public display name (`auth/public-athlete.ts`). */
  readonly rider: string;
  /** Seconds between slots: a whole number, at least one. */
  readonly sampleInterval: number;
  /** Metres per second per slot; `null` where the file held no speed in that slot. */
  readonly speed: readonly (number | null)[];
}

/**
 * A ride's speed on a uniform clock of whole seconds, or `undefined` when it
 * has none to replay — no sample with a speed, or a clock that does not move.
 */
export function ghostSpeed(
  samples: readonly Sample[],
): Pick<RiderGhost, 'sampleInterval' | 'speed'> | undefined {
  const timed = samples.filter((sample) => Number.isFinite(sample.t) && sample.t >= 0);
  const duration = timed.reduce((latest, sample) => Math.max(latest, sample.t), 0);
  if (!(duration > 0) || !timed.some((sample) => sample.speed !== null)) return undefined;
  const sampleInterval = Math.max(1, Math.ceil(duration / (MAXIMUM_GHOST_SLOTS - 1)));
  const slots = Math.floor(duration / sampleInterval) + 1;
  const sums = new Array<number>(slots).fill(0);
  const counts = new Array<number>(slots).fill(0);
  for (const sample of timed) {
    if (sample.speed === null || !Number.isFinite(sample.speed) || sample.speed < 0) continue;
    const slot = Math.min(slots - 1, Math.round(sample.t / sampleInterval));
    sums[slot] = (sums[slot] ?? 0) + sample.speed;
    counts[slot] = (counts[slot] ?? 0) + 1;
  }
  const speed = sums.map((sum, slot) => {
    const count = counts[slot] ?? 0;
    return count === 0 ? null : Math.round((sum / count) * SPEED_STEP) / SPEED_STEP;
  });
  return { sampleInterval, speed };
}
