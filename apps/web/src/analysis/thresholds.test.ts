// SPDX-License-Identifier: AGPL-3.0-or-later

import { beatsPerMinute, watts } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { THRESHOLD_REFUSAL, thresholdsFor, thresholdsToSave } from './thresholds';
import { stubActivity } from '../detail/testing';
import { athleteId } from '@onyourleft/store';

const OWNER = athleteId('athlete-a');

describe('thresholdsFor — the one place a default is substituted', () => {
  it('uses the stored values and says they are not assumed', () => {
    const result = thresholdsFor({
      id: OWNER,
      displayName: 'A',
      createdAt: stubActivity().createdAt,
      thresholdPower: watts(288),
      thresholdHeartRate: beatsPerMinute(174),
    });

    expect(result.thresholdPower).toBe(288);
    expect(result.thresholdHeartRate).toBe(174);
    expect(result.assumed).toEqual({ power: false, heartRate: false });
  });

  it('marks each basis separately, because one can be measured and the other not', () => {
    // An athlete who has tested their threshold power and never measured a
    // maximum heart rate is the ordinary case. Telling them their power zones
    // are assumed teaches them to ignore the notice on the ones that are.
    const result = thresholdsFor({
      id: OWNER,
      displayName: 'A',
      createdAt: stubActivity().createdAt,
      thresholdPower: watts(288),
    });

    expect(result.assumed).toEqual({ power: false, heartRate: true });
  });

  it('handles a device with no athlete row at all', () => {
    // A browser that has never recorded anything. The same state as a row with
    // neither field set, handled here rather than at each call site.
    expect(thresholdsFor(undefined).assumed).toEqual({ power: true, heartRate: true });
  });
});

describe('thresholdsToSave — the refusal, where a test can hold it', () => {
  it('accepts two positive numbers', () => {
    const decision = thresholdsToSave('288', '174');

    expect(decision).toEqual({
      kind: 'save',
      thresholdPower: 288,
      thresholdHeartRate: 174,
    });
  });

  it('treats a blank box as clearing the setting, not as an error', () => {
    // The only way back to the default for a rider who typed one by mistake.
    expect(thresholdsToSave('', '')).toEqual({
      kind: 'save',
      thresholdPower: undefined,
      thresholdHeartRate: undefined,
    });
  });

  it('clears one while setting the other', () => {
    const decision = thresholdsToSave('288', '  ');

    expect(decision.kind).toBe('save');
    expect(decision.kind === 'save' ? decision.thresholdPower : undefined).toBe(288);
    expect(decision.kind === 'save' ? decision.thresholdHeartRate : 'unset').toBeUndefined();
  });

  it.each([['-40'], ['0'], ['abc'], ['NaN'], ['Infinity'], ['1e999']])(
    'refuses %s rather than writing it',
    (typed) => {
      // ⚠️ This is the assertion the earlier version of this code could not
      // make. The guard lived inside the click handler, where a mutation
      // deleting its `return` left the suite green — the fall-through hit
      // `watts()`, which throws on a non-number, so nothing was written anyway
      // and the only tell was an unhandled rejection.
      expect(thresholdsToSave(typed, '174')).toEqual({
        kind: 'refused',
        reason: THRESHOLD_REFUSAL,
      });
      expect(thresholdsToSave('288', typed)).toEqual({
        kind: 'refused',
        reason: THRESHOLD_REFUSAL,
      });
    },
  );

  it('tolerates surrounding whitespace, which a paste brings with it', () => {
    expect(thresholdsToSave(' 288 ', '\t174\n')).toEqual({
      kind: 'save',
      thresholdPower: 288,
      thresholdHeartRate: 174,
    });
  });
});
