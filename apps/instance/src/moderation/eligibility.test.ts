// SPDX-License-Identifier: AGPL-3.0-or-later

/** Public-room eligibility (#775): one pure predicate, tested at every boundary. */

import { describe, expect, it } from 'vitest';

import {
  publicRoomEligibility,
  type EligibilityFacts,
  type PublicRoomThresholds,
} from './eligibility.ts';

const DAY = 24 * 60 * 60;
const CREATED = 1_790_000_000;
const THRESHOLDS: PublicRoomThresholds = { minimumAccountDays: 7, minimumCompletedRides: 3 };

/** An athlete who meets every requirement exactly, at `now`. */
const ELIGIBLE: EligibilityFacts = {
  registrationState: 'active',
  suspendedAt: null,
  adultConfirmedAt: CREATED + 60,
  createdAt: CREATED,
  completedRides: 3,
};
const NOW = CREATED + 7 * DAY;

describe('publicRoomEligibility (#775)', () => {
  it('admits an athlete who meets every requirement exactly at its boundary', () => {
    expect(publicRoomEligibility(ELIGIBLE, THRESHOLDS, NOW)).toEqual({
      eligible: true,
      reasons: [],
    });
  });

  it('refuses one second short of the account age, and admits on the second', () => {
    expect(publicRoomEligibility(ELIGIBLE, THRESHOLDS, NOW - 1)).toEqual({
      eligible: false,
      reasons: ['account-too-new'],
    });
  });

  it('refuses one ride short, and admits at the threshold', () => {
    expect(
      publicRoomEligibility({ ...ELIGIBLE, completedRides: 2 }, THRESHOLDS, NOW).reasons,
    ).toEqual(['too-few-rides']);
    expect(
      publicRoomEligibility({ ...ELIGIBLE, completedRides: 4 }, THRESHOLDS, NOW).eligible,
    ).toBe(true);
  });

  it('refuses a rider who has not confirmed they are 18 or over, whatever else holds (ruling Q5)', () => {
    expect(publicRoomEligibility({ ...ELIGIBLE, adultConfirmedAt: null }, THRESHOLDS, NOW)).toEqual(
      { eligible: false, reasons: ['not-confirmed-adult'] },
    );
  });

  it('refuses an account that is awaiting approval, or was refused', () => {
    for (const registrationState of ['pending', 'refused']) {
      expect(
        publicRoomEligibility({ ...ELIGIBLE, registrationState }, THRESHOLDS, NOW).reasons,
      ).toEqual(['not-approved']);
    }
  });

  it('refuses a suspended account', () => {
    expect(
      publicRoomEligibility({ ...ELIGIBLE, suspendedAt: NOW - 1 }, THRESHOLDS, NOW).reasons,
    ).toEqual(['suspended']);
  });

  it('reads the thresholds it is given: an operator’s zero admits a new account', () => {
    const none: PublicRoomThresholds = { minimumAccountDays: 0, minimumCompletedRides: 0 };
    expect(publicRoomEligibility({ ...ELIGIBLE, completedRides: 0 }, none, CREATED).eligible).toBe(
      true,
    );
  });

  it('names every reason that applies, not only the first', () => {
    expect(
      publicRoomEligibility(
        {
          registrationState: 'pending',
          suspendedAt: 1,
          adultConfirmedAt: null,
          createdAt: CREATED,
          completedRides: 0,
        },
        THRESHOLDS,
        CREATED,
      ).reasons,
    ).toEqual([
      'not-approved',
      'suspended',
      'not-confirmed-adult',
      'account-too-new',
      'too-few-rides',
    ]);
  });
});
