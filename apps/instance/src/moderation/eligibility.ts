// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether an athlete may enter a **public** room (#775): ONE pure predicate,
 * over facts the instance already holds, with the thresholds the operator
 * configures.
 *
 * ADR 0028 D-6.2: an identity here is a device key, and a new key costs
 * nothing, so a ban on its own is worthless. What gives an identity a cost is
 * everything a new key does not have: an approval (#775's default
 * registration mode), an account old enough, rides actually synced, and the
 * rider's own statement that they are 18 or over (ruling Q5, 2026-09-28).
 *
 * An athlete is eligible only when every one of these holds:
 *
 * - `not-approved` — the registration is `active`: not awaiting approval, not
 *   refused;
 * - `suspended` — no moderator has suspended the account;
 * - `not-confirmed-adult` — the rider confirmed they are 18 or over. ⚠️ Only
 *   the confirmation and its date are stored. No date of birth is ever asked
 *   for or kept;
 * - `account-too-new` — at least {@link PublicRoomThresholds.minimumAccountDays}
 *   whole days since the account was created, counted in seconds, so the
 *   boundary is exact;
 * - `too-few-rides` — at least {@link PublicRoomThresholds.minimumCompletedRides}
 *   rides synced to this instance.
 *
 * Every reason that applies is returned, not only the first, so a rider can
 * be told everything that is missing at once.
 */

/** The operator's thresholds. */
export interface PublicRoomThresholds {
  readonly minimumAccountDays: number;
  readonly minimumCompletedRides: number;
}

/**
 * The defaults when the operator sets nothing. ⚠️ Chosen in the pull request
 * that built this (#775) without an owner ruling: a week and three rides.
 */
export const DEFAULT_PUBLIC_ROOM_THRESHOLDS: PublicRoomThresholds = {
  minimumAccountDays: 7,
  minimumCompletedRides: 3,
};

/** What the predicate reads about an athlete. */
export interface EligibilityFacts {
  readonly registrationState: string;
  readonly suspendedAt: number | null;
  readonly adultConfirmedAt: number | null;
  /** Unix seconds. */
  readonly createdAt: number;
  /** Rides synced to this instance. */
  readonly completedRides: number;
}

export type IneligibleReason =
  'not-approved' | 'suspended' | 'not-confirmed-adult' | 'account-too-new' | 'too-few-rides';

export interface Eligibility {
  readonly eligible: boolean;
  readonly reasons: readonly IneligibleReason[];
}

const DAY_SECONDS = 24 * 60 * 60;

/** The predicate. `now` is Unix seconds. */
export function publicRoomEligibility(
  facts: EligibilityFacts,
  thresholds: PublicRoomThresholds,
  now: number,
): Eligibility {
  const reasons: IneligibleReason[] = [];
  if (facts.registrationState !== 'active') reasons.push('not-approved');
  if (facts.suspendedAt !== null) reasons.push('suspended');
  if (facts.adultConfirmedAt === null) reasons.push('not-confirmed-adult');
  if (now - facts.createdAt < thresholds.minimumAccountDays * DAY_SECONDS) {
    reasons.push('account-too-new');
  }
  if (facts.completedRides < thresholds.minimumCompletedRides) reasons.push('too-few-rides');
  return { eligible: reasons.length === 0, reasons };
}
