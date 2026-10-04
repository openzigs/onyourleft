// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1070 — a power channel that read nought is not a basis for a load, on the
 * write (`loadSummaryOf`) and on the read (`loadFromSummary`,
 * `needsLoadSummary`), by the rule #1054 applied to an average: a figure that
 * rounds to 0 W.
 */

import { beatsPerMinute, seconds, watts } from '@onyourleft/domain';
import type { ActivitySummary } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { stubActivity } from '../detail/testing';

import { isPowerBasis, loadFromSummary, loadSummaryOf, needsLoadSummary } from './summary';
import { thresholdsFor } from './thresholds';

const INTERVAL = seconds(1);
const zeros = Array.from({ length: 600 }, () => watts(0));
const strap = Array.from({ length: 600 }, () => beatsPerMinute(150));

describe('isPowerBasis', () => {
  it('is false for no figure and for one that rounds to 0 W, true from half a watt', () => {
    expect(isPowerBasis(undefined)).toBe(false);
    expect(isPowerBasis(watts(0))).toBe(false);
    expect(isPowerBasis(watts(0.49))).toBe(false);
    expect(isPowerBasis(watts(0.5))).toBe(true);
    expect(isPowerBasis(watts(200))).toBe(true);
  });
});

describe('loadSummaryOf — #1070', () => {
  it('summarises an all-zero power channel from heart rate when the ride has a strap', () => {
    expect(loadSummaryOf({ power: zeros, heartRate: strap }, INTERVAL)).toEqual({
      effortWeightedHeartRate: beatsPerMinute(150),
      loadCoveredTime: seconds(600),
    });
  });

  it('stores no summary for an all-zero power channel with nothing else', () => {
    expect(loadSummaryOf({ power: zeros }, INTERVAL)).toBeUndefined();
  });

  it('still lets real power win over heart rate', () => {
    const power = Array.from({ length: 600 }, () => watts(200));
    expect(loadSummaryOf({ power, heartRate: strap }, INTERVAL)?.effortWeightedPower).toBe(
      watts(200),
    );
  });
});

describe('reading a ride stored before #1070 with effortWeightedPower: 0', () => {
  const thresholds = thresholdsFor(undefined);

  function stored(fields: Partial<ActivitySummary>): ActivitySummary {
    return stubActivity({ loadCoveredTime: seconds(3600), ...fields });
  }

  it('has no load, and is a ride the backfill must work out again', () => {
    const row = stored({ effortWeightedPower: watts(0) });
    expect(loadFromSummary(row, thresholds)).toBeUndefined();
    expect(needsLoadSummary(row)).toBe(true);
  });

  it('reads the heart-rate figure the backfill merged in beside the stale 0', () => {
    const row = stored({
      effortWeightedPower: watts(0),
      effortWeightedHeartRate: beatsPerMinute(160),
    });
    expect(loadFromSummary(row, thresholds)?.basis).toBe('heartRate');
    expect(needsLoadSummary(row)).toBe(false);
  });
});
