// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The workout goals form's pure core (#1237), and the screen's wording held
 * to ADR 0048 D-12's banned words.
 */

import { beatsPerMinute, thresholdShare } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { EMPTY_GOALS_FORM, formFromGoals, goalsFromForm, isNoGoal } from './form';
import * as wording from './wording';
import { fieldRefusal, POWER_CEILING_CONSTRAINT } from './wording';

describe('goalsFromForm', () => {
  it('reads blank boxes as no goal, never a default', () => {
    expect(goalsFromForm(EMPTY_GOALS_FORM)).toStrictEqual({ ok: true, goals: {} });
    expect(isNoGoal({})).toBe(true);
    expect(isNoGoal({ effortCheckIns: true })).toBe(false);
  });

  it('turns typed text into the goals, a percentage into a share', () => {
    const outcome = goalsFromForm({
      ...EMPTY_GOALS_FORM,
      sessionType: 'tempo',
      durationMinutes: ' 60 ',
      holdLow: '120',
      holdHigh: '130',
      heartRateAbove: '140',
      powerCeiling: '72.5',
      timeInRangeMinutes: '30',
      effortCheckIns: true,
    });
    expect(outcome).toStrictEqual({
      ok: true,
      goals: {
        sessionType: 'tempo',
        durationMinutes: 60,
        holdRange: { low: beatsPerMinute(120), high: beatsPerMinute(130) },
        heartRateAbove: beatsPerMinute(140),
        powerCeiling: thresholdShare(0.725),
        timeInRangeMinutes: 30,
        effortCheckIns: true,
      },
    });
    // And back, without float noise.
    if (outcome.ok) expect(formFromGoals(outcome.goals).powerCeiling).toBe('72.5');
  });

  it.each([
    ['text in a number box', { durationMinutes: 'an hour' }, 'durationMinutes'],
    ['a range with only one end', { holdLow: '120' }, 'holdHigh'],
    ['a range too narrow', { holdLow: '120', holdHigh: '124' }, 'holdHigh'],
    ['a fractional heart rate', { heartRateAbove: '150.5' }, 'heartRateAbove'],
    [
      'more time in range than the session',
      { durationMinutes: '30', timeInRangeMinutes: '40' },
      'timeInRangeMinutes',
    ],
  ] as const)('refuses %s, naming the box', (_name, typed, box) => {
    const outcome = goalsFromForm({ ...EMPTY_GOALS_FORM, ...typed });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.field).toBe(box);
      expect(outcome.message.startsWith(`${wording.FIELD_WORDS[box].label}: must`)).toBe(true);
    }
  });

  it.each(['86', '19', 'lots'])('refuses a ceiling of %s in the percentage typed', (typed) => {
    expect(goalsFromForm({ ...EMPTY_GOALS_FORM, powerCeiling: typed })).toStrictEqual({
      ok: false,
      field: 'powerCeiling',
      message: fieldRefusal('powerCeiling', POWER_CEILING_CONSTRAINT),
    });
  });
});

describe('the wording (ADR 0048 D-12)', () => {
  /** Every string the module exports, however deep. */
  function strings(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(strings);
    return [];
  }

  it('never says safe, cardiac, heart condition, patient, therapy or a limit for the heart', () => {
    const banned =
      /\b(safe|safety|cardiac|heart condition|rehabilitation|patient|therapy|limit for your heart|safe heart rate)\b/i;
    const all = [
      ...strings(wording),
      wording.goalsSaveFailure('x'),
      wording.goalsClearFailure('x'),
      ...Object.keys(wording.FIELD_WORDS).map((field) =>
        wording.fieldRefusal(field as wording.GoalField, 'x'),
      ),
    ];
    expect(all.length).toBeGreaterThan(20);
    expect(all.filter((sentence) => banned.test(sentence))).toStrictEqual([]);
  });
});
