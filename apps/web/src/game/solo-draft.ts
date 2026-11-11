// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rider's draft on a SOLO ride — #2425, deciding nothing that
 * [ADR 0066](../../../../docs/adr/0066-the-bot-pacer-and-the-riders-own-ghost-give-a-draft-in-a-solo-ride.md)
 * has not: the bot pacer and the rider's own ghost give a draft, and take none.
 *
 * ## One model, from odometers only (D-1.2)
 *
 * The rider's `k` is `fieldDraftFactors([rider, pacer?, ghost?])` at the
 * rider's index — the call a room makes (`apps/instance` §`room.ts`
 * §`draft`), so a solo `k` and a room's `k` for the same gaps are equal to the
 * bit. The distances are the rider's `state.ride.distance`, the pacer's
 * `state.bot.state.distance` on the same fixed step, and the ghost's
 * `ghostDistanceAt` at the ride's own racing clock: **never** a drawn place
 * (`bend-easing.ts`, `racing-line.ts`, `scene.ts` §`lateralOf`). A finished
 * ghost stays at the end of its attempt and a pacer past the end of a
 * point-to-point route keeps its unclamped odometer: both still give a draft
 * (D-1.6, the owner's ruling of 2026-11-10). Nothing here clamps either.
 *
 * ## "Drafted" (D-5.6)
 *
 * In the draft is `room-ride.ts` §`draftEvent`'s state, fed the rider's whole
 * `k` as the Draft field reads it, advanced once per fixed simulation step by
 * `simulation.ts`. A ride, or the attempt "Your best" settles, is **drafted**
 * when the rider was in the draft for at least {@link DRAFTED_SHARE} of its
 * distance.
 */

import type { Seconds } from '@onyourleft/domain';
import { fieldDraftFactors } from '@onyourleft/physics';

/**
 * The least share of a ride's distance ridden in the draft for it to be
 * marked as drafted — ADR 0066 D-5.6. **10 %, the owner's approval of
 * 2026-11-10 on #2441; unsourced.** A later change changes this constant and
 * no ADR.
 */
export const DRAFTED_SHARE = 0.1;

/** {@link DRAFTED_SHARE} in words, so no sentence states a share of its own. */
const DRAFTED_SHARE_TEXT = `${String(Math.round(DRAFTED_SHARE * 100))} %`;

/**
 * What a drafted ride's page says of it — #2451, ADR 0066 D-5.3: the fact
 * kept with the ride, read back after a reload. In words, never a colour.
 * The value of the page's *Draft* row; {@link DRAFTED_RIDE_NOTE} is the
 * smaller line under it (owner ruling of 2026-11-11 on #2487: the one
 * sentence it replaced wrapped to three lines in its grid cell).
 */
export const DRAFTED_RIDE_TEXT = 'Drafted';

/** The *Draft* row's secondary line, under {@link DRAFTED_RIDE_TEXT}. */
export const DRAFTED_RIDE_NOTE = `${DRAFTED_SHARE_TEXT}+ behind the pacer or your ghost`;

/**
 * The mark a drafted segment effort carries wherever it is shown — #2451,
 * ADR 0066 D-5.2. *"Yours only"* because it is never offered to an
 * instance's board, as an effort in a privacy zone is said to be.
 */
export const DRAFTED_EFFORT_TEXT = 'Drafted — yours only';

/**
 * Who gives the rider a draft on a solo ride, handed to the simulation at its
 * setup — present only with the device's switch on (`solo-draft-preference.ts`)
 * on a solo ride with a pacer or the rider's own ghost.
 *
 * The pacer is the simulation's own bot, so it needs nothing here: a ride with
 * a pacer and this present is drafted behind it.
 */
export interface SoloDraftSources {
  /**
   * Where the rider's OWN ghost is after `ridden` seconds of riding —
   * `ghostDistanceAt(track, ridden)`, handed in so the ghost is replayed and
   * never re-simulated (ADR 0066 D-1.1). Absent with no own ghost. ⚠️ Never
   * another rider's ghost (D-3).
   */
  readonly ghostAt?: ((ridden: Seconds) => number) | undefined;
}

/** The solo draft as the simulation last stepped it. @see GameState.soloDraft */
export interface SoloDraftState {
  /** The draft multiplier the rider's last step was ridden at; `1` is alone. */
  readonly k: number;
  /** Whether the rider is in the draft, by `draftEvent`'s 10 % / 5 % state. */
  readonly inDraft: boolean;
  /** The metres the rider covered on steps ridden in the draft. */
  readonly inDraftMetres: number;
  /** The metres the rider covered on every step. */
  readonly riddenMetres: number;
}

/** The solo draft before a step has run: alone, out of the draft, no road covered. */
export const SOLO_DRAFT_AT_START: SoloDraftState = {
  k: 1,
  inDraft: false,
  inDraftMetres: 0,
  riddenMetres: 0,
};

/** The rider's `k` with the givers at `givers` — ADR 0038 D-3, the room's own call. */
export function soloDraftFactor(rider: number, givers: readonly number[]): number {
  return fieldDraftFactors([rider, ...givers])[0] as number;
}

/** The Draft field's reading for `k`: the share of drag the draft removed, in percent. */
export function soloDraftPercent(k: number): number {
  return (1 - k) * 100;
}

/** Whether the ride so far was drafted — at least {@link DRAFTED_SHARE} of it in the draft. */
export function draftedRide(draft: SoloDraftState | undefined): boolean {
  return (
    draft !== undefined &&
    draft.riddenMetres > 0 &&
    draft.inDraftMetres >= DRAFTED_SHARE * draft.riddenMetres
  );
}
