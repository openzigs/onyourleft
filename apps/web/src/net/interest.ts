// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Which other riders are drawn** — #783's interest management, and #16's
 * epic criterion: *"Rendering is interest-managed to a stated rider count and
 * the behaviour at the boundary is defined rather than emergent — riders
 * entering and leaving view must not flicker."*
 *
 * ## The rule, in full
 *
 * Riders are ranked by how far along the road they are from this rider,
 * ahead or behind alike — the distance, never who is winning. Then:
 *
 * 1. **A rider enters** the drawn set when their rank is among the nearest
 *    `k` ({@link DEFAULT_DRAWN_RIDERS} unless a room says otherwise, at most
 *    {@link MAXIMUM_DRAWN_RIDERS} — ruling Q4, 2026-09-28).
 * 2. **A rider leaves** only when their rank is beyond the nearest
 *    `k + h`, `h` = {@link INTEREST_HYSTERESIS_RIDERS}; one who leaves the
 *    room leaves at once.
 * 3. **Neither happens to a rider more than once per**
 *    {@link INTEREST_DWELL_MS}: one who has just entered or left stays that
 *    way for that long, whatever their rank does meanwhile.
 *
 * So the set holds at most `k + h` riders, and a rider sitting on the
 * boundary — two riders trading the `k`-th place wheel to wheel — changes
 * nothing on the screen.
 *
 * ⚠️ **The ranking is internal and never shown.** It is a nearest-first cut
 * for the renderer's sake, not a standing: nothing here reaches the HUD but
 * a COUNT (ADR 0021 D-6, ADR 0028 D-7.7 — no ranked list during a ride), and
 * the order the set is returned in is by rider id, not by rank.
 */

/** Ruling Q4 (2026-09-28): K defaults to 50. */
export const DEFAULT_DRAWN_RIDERS = 50;

/** Ruling Q4 (2026-09-28): K may go up to 100. */
export const MAXIMUM_DRAWN_RIDERS = 100;

/**
 * `h`: how many ranks past `k` a drawn rider may fall before they leave —
 * **5**. Chosen: enough that a small group swapping places at the boundary
 * does not flicker, few enough that the renderer's capacity
 * (`k + h` ≤ 105 instances) stays one number.
 */
export const INTEREST_HYSTERESIS_RIDERS = 5;

/**
 * The least time between two changes to one rider's membership: **2 s** —
 * two of the room's 1 Hz frames, so a rider seen on one frame is still drawn
 * on the next whatever the ranking did. Chosen.
 */
export const INTEREST_DWELL_MS = 2_000;

/** The most riders a drawn set can hold. */
export const MAXIMUM_DRAWN_SET = MAXIMUM_DRAWN_RIDERS + INTEREST_HYSTERESIS_RIDERS;

/** One candidate: a rider id and how far along the road they are. */
export interface InterestCandidate {
  readonly riderId: number;
  readonly distanceMetres: number;
}

/** Which riders are drawn, and when each last changed. */
export class InterestSet {
  readonly #k: number;
  /** Members, with the instant each entered. */
  readonly #members = new Map<number, number>();
  /** Riders who left, with the instant they left, while that is inside the dwell. */
  readonly #left = new Map<number, number>();

  /** @param k how many riders are drawn — clamped to 0 … {@link MAXIMUM_DRAWN_RIDERS}. */
  constructor(k: number = DEFAULT_DRAWN_RIDERS) {
    this.#k = Math.max(0, Math.min(MAXIMUM_DRAWN_RIDERS, Math.floor(k)));
  }

  /** How many riders enter the drawn set: `k`. */
  get k(): number {
    return this.#k;
  }

  /**
   * Update the set from this frame's candidates and return it, by rider id.
   *
   * @param ownDistanceMetres where THIS rider is, the distance ranks are measured from.
   */
  update(
    candidates: readonly InterestCandidate[],
    ownDistanceMetres: number,
    nowMs: number,
  ): readonly number[] {
    for (const [riderId, at] of this.#left) {
      if (nowMs - at >= INTEREST_DWELL_MS) this.#left.delete(riderId);
    }
    const ranked = [...candidates].sort(
      (a, b) =>
        Math.abs(a.distanceMetres - ownDistanceMetres) -
          Math.abs(b.distanceMetres - ownDistanceMetres) || a.riderId - b.riderId,
    );
    const rankOf = new Map<number, number>();
    ranked.forEach((candidate, rank) => rankOf.set(candidate.riderId, rank));
    const keep = this.#k + INTEREST_HYSTERESIS_RIDERS;
    for (const [riderId, since] of this.#members) {
      const rank = rankOf.get(riderId);
      if (rank === undefined) {
        // Gone from the room: gone from the road, dwell or not.
        this.#members.delete(riderId);
        continue;
      }
      if (rank >= keep && nowMs - since >= INTEREST_DWELL_MS) {
        this.#members.delete(riderId);
        this.#left.set(riderId, nowMs);
      }
    }
    for (let rank = 0; rank < Math.min(this.#k, ranked.length); rank += 1) {
      const riderId = (ranked[rank] as InterestCandidate).riderId;
      if (this.#members.has(riderId) || this.#left.has(riderId)) continue;
      if (this.#members.size >= keep) break;
      this.#members.set(riderId, nowMs);
    }
    return [...this.#members.keys()].sort((a, b) => a - b);
  }
}
