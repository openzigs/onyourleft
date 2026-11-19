// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { gradePercent } from '../quantities';
import {
  directedPacingFactor,
  directedPowerWatts,
  flooredDirection,
  gapTrendOf,
  MODEL_PACER_ANSWER_MOST_CHARACTERS,
  MODEL_PACER_INPUT_MOST_CHARACTERS,
  MODEL_PACER_LAPSE_S,
  MODEL_PACER_LATE_S,
  MODEL_PACER_RECENT_LINES,
  MODEL_PACER_SAY_MOST_CHARACTERS,
  modelPacerAnswerSchema,
  PACER_AHEAD_FLOOR_S,
  PACER_INTENTS,
  PACER_PLANS,
  pacerDecisionRecord,
  pacerDirectionAt,
  pacerSayAgainstIntent,
  pacerSaysEasing,
  pacerSaysPushing,
  pacerSayProblem,
  readModelPacerAnswer,
  readModelPacerInput,
  readPacerDecisionRecord,
  riderPlaceOf,
  type ModelPacerInput,
  type PacerDecisionRecord,
} from './model-pacer';
import {
  botPacerPlan,
  flatPowerWatts,
  PACING_FACTOR_CEILING,
  PACING_FACTOR_FLOOR,
  pacedPowerWatts,
  pacingFactor,
} from './pacing';

const STATE: ModelPacerInput = {
  pacerWPerKg: 2.5,
  plan: 'rolling',
  intent: 'hold',
  secondsInIntent: 10,
  riderGapM: -12.5,
  riderWPerKg: 2.3,
  riderInDraft: true,
  gradeAheadPct: 4.2,
  toFinishM: 8_000,
  rideS: 300,
};

const answer = (fields: Readonly<Record<string, unknown>>): string =>
  JSON.stringify({ plan: 'even', intent: 'lift', say: 'Stay on my wheel.', ...fields });

describe('a direction is ridden inside #92’s envelope — ADR 0072 D-2', () => {
  it('is #92’s own rule exactly for rolling and hold', () => {
    for (const grade of [-12, -6, -3, 0, 2, 5, 8, 15, Number.NaN]) {
      expect(directedPacingFactor({ plan: 'rolling', intent: 'hold' }, grade)).toBe(
        pacingFactor(grade),
      );
    }
  });

  it('rides the flat figure on every grade for even and hold', () => {
    for (const grade of [-10, 0, 10]) {
      expect(directedPacingFactor({ plan: 'even', intent: 'hold' }, grade)).toBe(1);
    }
  });

  it('reaches the envelope on gentler grades for climber', () => {
    expect(directedPacingFactor({ plan: 'climber', intent: 'hold' }, 4)).toBeCloseTo(
      PACING_FACTOR_CEILING,
      12,
    );
    expect(directedPacingFactor({ plan: 'climber', intent: 'hold' }, -3)).toBeCloseTo(
      PACING_FACTOR_FLOOR,
      12,
    );
    expect(directedPacingFactor({ plan: 'climber', intent: 'hold' }, 2)).toBeGreaterThan(
      pacingFactor(2),
    );
    expect(directedPacingFactor({ plan: 'climber', intent: 'hold' }, Number.NaN)).toBe(1);
  });

  it('lifts and eases on the flat, and never leaves the envelope on any grade', () => {
    expect(directedPacingFactor({ plan: 'even', intent: 'lift' }, 0)).toBeCloseTo(1.05, 12);
    expect(directedPacingFactor({ plan: 'even', intent: 'ease' }, 0)).toBeCloseTo(0.93, 12);
    for (const plan of PACER_PLANS) {
      for (const intent of PACER_INTENTS) {
        for (let grade = -20; grade <= 20; grade += 0.5) {
          const factor = directedPacingFactor({ plan, intent }, gradePercent(grade));
          expect(factor).toBeGreaterThanOrEqual(PACING_FACTOR_FLOOR);
          expect(factor).toBeLessThanOrEqual(PACING_FACTOR_CEILING);
        }
      }
    }
    // Lift on a steep climb is held at the ceiling, and ease on a steep descent at the floor.
    expect(directedPacingFactor({ plan: 'rolling', intent: 'lift' }, 10)).toBe(
      PACING_FACTOR_CEILING,
    );
    expect(directedPacingFactor({ plan: 'rolling', intent: 'ease' }, -10)).toBe(
      PACING_FACTOR_FLOOR,
    );
  });

  it('is a power of the plan’s flat figure, and pacedPowerWatts for rolling and hold', () => {
    const plan = botPacerPlan(3);
    expect(directedPowerWatts(plan, 5, { plan: 'rolling', intent: 'hold' })).toBe(
      pacedPowerWatts(plan, 5),
    );
    expect(directedPowerWatts(plan, 0, { plan: 'even', intent: 'lift' })).toBeCloseTo(
      flatPowerWatts(plan) * 1.05,
      9,
    );
  });
});

describe('the pacer state the model is shown — ADR 0072 D-3', () => {
  it('reads a state of exactly its shape', () => {
    expect(readModelPacerInput(STATE)).toEqual({ ok: true, value: STATE });
    expect(readModelPacerInput({ ...STATE, riderWPerKg: null, toFinishM: null }).ok).toBe(true);
  });

  it('refuses a field it does not name, so nothing else can ride along', () => {
    expect(readModelPacerInput({ ...STATE, place: 'Main Street' })).toEqual({
      ok: false,
      problem: { field: 'input', problem: 'has a field this pacer state does not' },
    });
  });

  it('names the field and the rule, and never the value', () => {
    const read = readModelPacerInput({ ...STATE, riderGapM: '51.5074, -0.1278' });
    expect(read).toEqual({
      ok: false,
      problem: { field: 'input.riderGapM', problem: 'must be metres' },
    });
    expect(JSON.stringify(read)).not.toContain('51.5074');
  });

  it.each([
    ['pacerWPerKg', 41],
    ['plan', 'sprint'],
    ['intent', 'wait'],
    ['secondsInIntent', 1.5],
    ['riderWPerKg', -1],
    ['riderInDraft', 'yes'],
    ['gradeAheadPct', 101],
    ['toFinishM', -1],
    ['rideS', 86_401],
  ])('refuses a bad %s', (field, value) => {
    const read = readModelPacerInput({ ...STATE, [field]: value });
    expect(read.ok).toBe(false);
    expect(read.ok ? undefined : read.problem.field).toBe(`input.${field}`);
  });

  it('refuses a missing field, a non-object and an over-long state', () => {
    const missing: Record<string, unknown> = { ...STATE };
    delete missing.rideS;
    expect(readModelPacerInput(missing)).toEqual({
      ok: false,
      problem: { field: 'input.rideS', problem: 'is required' },
    });
    expect(readModelPacerInput([STATE]).ok).toBe(false);
    expect(JSON.stringify(STATE).length).toBeLessThan(MODEL_PACER_INPUT_MOST_CHARACTERS);
    // Every field is bounded, so the cap is reached only by a state that breaks it.
    const long = readModelPacerInput({
      ...STATE,
      plan: 'x'.repeat(MODEL_PACER_INPUT_MOST_CHARACTERS),
    });
    expect(long.ok ? undefined : long.problem.field).toBe('input');
  });
});

/** The same state with every sensor live and three lines said — #2760. */
const SENSED: ModelPacerInput = {
  ...STATE,
  rider3sWPerKg: 2.6,
  riderMinuteWPerKg: 2.4,
  powerZone: 'Tempo',
  powerTrend: 'fading',
  aboveThresholdS: 0,
  cadenceRpm: 62,
  heartRateBpm: 151,
  heartRateZone: 'Endurance',
  heartRateTrend: 'rising',
  recentLines: ['Nice and steady.', 'Find a lighter gear here.', 'Stay with me.'],
};

describe('the rider’s own sensors, in the state — #2760', () => {
  it('reads a state with every sensor, and one with none of them', () => {
    expect(readModelPacerInput(SENSED)).toEqual({ ok: true, value: SENSED });
    expect(readModelPacerInput({ ...STATE, cadenceRpm: 90 })).toEqual({
      ok: true,
      value: { ...STATE, cadenceRpm: 90 },
    });
    expect(readModelPacerInput(STATE).ok).toBe(true);
  });

  it.each([
    ['rider3sWPerKg', 41],
    ['rider3sWPerKg', null],
    ['riderMinuteWPerKg', -0.1],
    ['powerZone', 'Zone 9'],
    ['powerZone', 'Threshold heart'],
    ['powerTrend', 'falling'],
    ['aboveThresholdS', 2.5],
    ['cadenceRpm', 88.5],
    ['cadenceRpm', 251],
    ['heartRateBpm', 19],
    ['heartRateBpm', null],
    ['heartRateZone', 'Sprint'],
    ['heartRateTrend', 'fading'],
    ['recentLines', []],
    ['recentLines', 'Nice and steady.'],
    ['recentLines', ['']],
    ['recentLines', ['Hold 3000 watts.']],
    ['recentLines', ['Lat 51.5074 is home.']],
    ['recentLines', ['a', 'b', 'c', 'd']],
    ['recentLines', [7]],
    ['riderPlace', 'in front'],
    ['riderPlace', null],
    ['gapTrend', 'growing'],
    ['gapTrend', 0.4],
  ])('refuses a bad %s (%j), naming the field and never the value', (field, value) => {
    const read = readModelPacerInput({ ...SENSED, [field]: value });
    expect(read.ok).toBe(false);
    expect(read.ok ? undefined : read.problem.field).toBe(`input.${field}`);
    expect(JSON.stringify(read)).not.toContain('51.5074');
  });

  it('fits a state with every sensor and the longest lines inside the cap', () => {
    const longest = '"'.repeat(MODEL_PACER_SAY_MOST_CHARACTERS - 1) + 'a';
    expect(pacerSayProblem(longest)).toBeUndefined();
    const widest: ModelPacerInput = {
      ...SENSED,
      riderGapM: -999_999.9,
      gradeAheadPct: -99.9,
      toFinishM: 999_999,
      rideS: 86_399,
      secondsInIntent: 86_399,
      aboveThresholdS: 86_399,
      riderWPerKg: 39.9,
      rider3sWPerKg: 39.9,
      riderMinuteWPerKg: 39.9,
      recentLines: Array.from({ length: MODEL_PACER_RECENT_LINES }, () => longest),
    };
    expect(JSON.stringify(widest).length).toBeLessThanOrEqual(MODEL_PACER_INPUT_MOST_CHARACTERS);
    expect(readModelPacerInput(widest).ok).toBe(true);
  });
});

describe('what the model may answer — ADR 0072 D-3 and D-4', () => {
  it('reads a plan, an intent and a line', () => {
    expect(readModelPacerAnswer(answer({}))).toEqual({
      ok: true,
      direction: { plan: 'even', intent: 'lift' },
      say: 'Stay on my wheel.',
    });
    expect(readModelPacerAnswer(answer({ say: '' }))).toEqual({
      ok: true,
      direction: { plan: 'even', intent: 'lift' },
      say: '',
    });
  });

  it('treats an answer with a power field as no answer at all', () => {
    expect(readModelPacerAnswer(answer({ watts: 900 }))).toEqual({
      ok: false,
      reason: 'unknown-key',
    });
    expect(readModelPacerAnswer(answer({ resistance: 'max' })).ok).toBe(false);
  });

  it.each([
    ['not-json', 'plan: even'],
    ['not-an-object', '["even"]'],
    ['bad-plan', answer({ plan: 'sprint' })],
    ['bad-intent', answer({ intent: 'wait' })],
    ['bad-say', answer({ say: 7 })],
    ['bad-say', answer({ say: 'Hold 9000 watts.' })],
    ['bad-say', answer({ say: 'Your heart rate is 150.' })],
    ['say-against-intent', answer({ intent: 'ease', say: 'I will push on this climb.' })],
    ['too-long', answer({ say: 'a'.repeat(MODEL_PACER_ANSWER_MOST_CHARACTERS) })],
  ])('reads %s as no decision', (reason, text) => {
    expect(readModelPacerAnswer(text)).toEqual({ ok: false, reason });
  });

  it('says what the server holds the model to: three closed fields and a capped line', () => {
    expect(modelPacerAnswerSchema()).toEqual({
      type: 'object',
      properties: {
        plan: { type: 'string', enum: ['rolling', 'even', 'climber'] },
        intent: { type: 'string', enum: ['hold', 'lift', 'ease'] },
        say: { type: 'string', maxLength: MODEL_PACER_SAY_MOST_CHARACTERS },
      },
      required: ['plan', 'intent', 'say'],
      additionalProperties: false,
    });
  });
});

describe('the line of feedback — ADR 0072 D-4', () => {
  it.each([
    'Nice work, stay with me.',
    'Easy over the top, then we go again.',
    'You’re right on my wheel. Keep it smooth!',
    'If you can, come round me on the next rise.',
  ])('shows “%s”', (say) => {
    expect(pacerSayProblem(say)).toBeUndefined();
  });

  it.each([
    ['too-long', 'a'.repeat(MODEL_PACER_SAY_MOST_CHARACTERS + 1)],
    ['not-a-line', 'Nice.\nNow harder.'],
    ['markup', '<b>Go</b>'],
    ['markup', 'Read more at www.example.org'],
    ['markup', 'Push to 2 W/kg / 3 W/kg'],
    ['number', 'Push to 20 W/kg'],
    ['number', 'Hold three hundred and 5 more.'],
    ['number', 'We are at 51.5074 north.'],
    ['number', 'Two ٣ go'],
    ['trademark', 'Your TSS is climbing.'],
    ['trademark', 'Watch your IF here.'],
    ['trademark', 'Good normalized power today.'],
    ['trademark', 'Your Training Stress is high.'],
    ['trademark', 'Your ＴＳＳ is climbing.'],
    ['trademark', 'Good Ｎormalized power today.'],
    ['health-claim', 'Good for your heart condition.'],
    ['health-claim', 'This is great therapy.'],
    ['health-claim', 'Stop if you feel pain.'],
    ['health-claim', 'Ride for your health.'],
    ['health-claim', 'Ca​rdiac work!'],
    ['no-words', '!!! ...'],
  ])('refuses %s: “%s”', (problem, say) => {
    expect(pacerSayProblem(say)).toBe(problem);
  });

  it('lets the empty line through: it shows nothing', () => {
    expect(pacerSayProblem('')).toBeUndefined();
  });
});

describe('a cadence or power figure in the line — ADR 0077 (owner ruling 2026-11-17)', () => {
  it.each([
    'Aim for 90 rpm.',
    'Hold 200 watts.',
    'Hold around 200 W up this rise.',
    'Try 3 W/kg up this rise.',
    'Easy for a minute, stay in this zone with me.',
    'Settle at 2.8 W/kg, then spin at 95rpm.',
    'Spin it up to ９０ rpm.',
    'Hold 30 watts, then 2000 watts, at 30 rpm or 150 rpm.',
    'Ease to 0.5 W/kg, or ride 10 W/kg.',
    'One more push at 250 watt.',
  ])('shows “%s”', (say) => {
    expect(pacerSayProblem(say)).toBeUndefined();
  });

  it.each([
    ['number', 'Your heart rate is 150.'],
    ['number', 'Heart rate 150 bpm, ease a little.'],
    ['number', 'Five more, then 5 minutes easy.'],
    ['number', 'Only 20 km to go.'],
    ['number', 'Hold 35 km an hour here.'],
    ['number', 'Stay in zone 4.'],
    ['markup', 'You are at 90% of threshold.'],
    ['number', 'Hold 9000 watts.'],
    ['number', 'Hold 29 watts.'],
    ['number', 'Hold 2001 W.'],
    ['number', 'Spin at 5 rpm.'],
    ['number', 'Spin at 151 rpm.'],
    ['number', 'Push 11 W/kg.'],
    ['number', 'Ease to 0.4 W/kg.'],
    ['number', 'Hold 3.25 W/kg.'],
    ['number', 'Hold 0.5074 W/kg.'],
    ['number', 'Hold 200.5 watts.'],
    ['number', 'Spin at 90.5 rpm.'],
    ['number', 'Hold 0200 watts.'],
    ['number', 'Hold 1,200 watts.'],
    ['number', 'Hold 200-250 watts.'],
    ['number', 'Hold -200 watts.'],
    ['number', 'Hold 200 wattage.'],
    ['number', 'Hold 200 W2.'],
    ['number', 'Hold a200 W.'],
    ['number', 'Spin at 90 rpm for 5 more.'],
    ['number', 'Spin at ٩٠ rpm.'],
    // A Unicode sign touches the number (review of #2762, finding 1).
    ['number', 'Hold \u2212200 watts.'],
    ['number', 'Hold \u00b1200 watts.'],
    ['number', 'Hold \u2013200 watts.'],
    ['number', 'Hold \u00d7200 W.'],
    // The figure in a sentence about something else (finding 2).
    ['number', 'Heart rate 150 W, ease a little.'],
    ['number', 'Hold 200 W, keep your BPM steady.'],
    ['number', 'Hold 200 W while your pulse settles.'],
    ['number', 'Hold 200 watts for a minute.'],
    ['number', 'Hold 200 watts for ten more seconds.'],
    ['number', 'Hold 200 W for an hour.'],
    ['number', 'Hold 200 W to the next km.'],
    ['number', 'Hold 200 W for a mile.'],
    ['number', 'Hold 200 W for one more kilometre.'],
    ['number', 'Hold 200 W for a few hundred Metres.'],
    ['number', 'Hold 200 W for a few hundred meters.'],
    ['number', 'Hold 90 rpm in this zone.'],
    ['number', 'Hold 200 W in this ＺＯＮＥ.'],
    // A Roman numeral, which NFKC would turn into letters (finding 3).
    ['number', 'Stay in zone \u2163.'],
    ['number', 'Stay in zone \u2173 now.'],
    ['number', 'Keep it at \u2182.'],
    ['number', 'Only \u216b more to go.'],
    ['number', 'Push for \u2172 more.'],
    ['number', 'Stay in zone IV.'],
    ['number', 'Stay in zone ii for now.'],
    ['trademark', 'Hold 200 watts and keep your TSS low.'],
    ['trademark', 'Aim for 90 rpm, good normalized power.'],
    ['health-claim', 'Hold 200 watts if you feel no pain.'],
    ['too-long', `Hold 200 watts ${'a'.repeat(MODEL_PACER_SAY_MOST_CHARACTERS)}`],
  ])('refuses %s: “%s”', (problem, say) => {
    expect(pacerSayProblem(say)).toBe(problem);
  });

  it('reads a cadence or power line as a decision, as the device and the instance do', () => {
    expect(readModelPacerAnswer(answer({ say: 'Aim for 90 rpm.' }))).toEqual({
      ok: true,
      direction: { plan: 'even', intent: 'lift' },
      say: 'Aim for 90 rpm.',
    });
  });
});

describe('the decision log, and the decision in force — ADR 0072 D-5 and D-7', () => {
  const ok = readModelPacerAnswer(answer({}));

  it('logs an answer in time as applied, with its direction and no line', () => {
    const record = pacerDecisionRecord(10, 12.5, ok);
    expect(record).toEqual({
      askedAtS: 10,
      arrivedAtS: 12.5,
      outcome: 'applied',
      plan: 'even',
      intent: 'lift',
    });
    expect(JSON.stringify(record)).not.toContain('wheel');
  });

  it('logs a late answer as late, whatever it said', () => {
    expect(pacerDecisionRecord(10, 10 + MODEL_PACER_LATE_S + 0.05, ok).outcome).toBe('late');
    expect(pacerDecisionRecord(10, 10 + MODEL_PACER_LATE_S, ok).outcome).toBe('applied');
  });

  it('logs invalid, refused and failed answers as such', () => {
    expect(pacerDecisionRecord(10, 11, readModelPacerAnswer('nope')).outcome).toBe('invalid');
    expect(pacerDecisionRecord(10, 11, 'refused').outcome).toBe('refused');
    expect(pacerDecisionRecord(10, 11, 'failed').outcome).toBe('failed');
  });

  const log: readonly PacerDecisionRecord[] = [
    { askedAtS: 5, arrivedAtS: 7, outcome: 'applied', plan: 'even', intent: 'lift' },
    { askedAtS: 10, arrivedAtS: 12, outcome: 'invalid' },
    { askedAtS: 15, arrivedAtS: 18, outcome: 'applied', plan: 'climber', intent: 'ease' },
  ];

  it('is #92’s rule before the first applied decision arrives', () => {
    expect(pacerDirectionAt(log, 6.95)).toBeUndefined();
    expect(pacerDirectionAt([], 100)).toBeUndefined();
  });

  it('applies a decision from its arrival until a newer one replaces it', () => {
    expect(pacerDirectionAt(log, 7)).toEqual({ plan: 'even', intent: 'lift' });
    // An invalid answer does not cancel the decision in force.
    expect(pacerDirectionAt(log, 15)).toEqual({ plan: 'even', intent: 'lift' });
    expect(pacerDirectionAt(log, 18)).toEqual({ plan: 'climber', intent: 'ease' });
  });

  it('lapses a decision nothing replaced', () => {
    expect(pacerDirectionAt(log, 18 + MODEL_PACER_LAPSE_S - 0.05)).toEqual({
      plan: 'climber',
      intent: 'ease',
    });
    expect(pacerDirectionAt(log, 18 + MODEL_PACER_LAPSE_S)).toBeUndefined();
  });

  it('reads each record back whole, or not at all', () => {
    for (const record of log) expect(readPacerDecisionRecord(record)).toEqual(record);
    expect(readPacerDecisionRecord({ askedAtS: 5, arrivedAtS: null, outcome: 'failed' })).toEqual({
      askedAtS: 5,
      arrivedAtS: null,
      outcome: 'failed',
    });
    for (const bad of [
      null,
      { ...log[0], say: 'Stay on my wheel.' },
      { ...log[0], plan: 'sprint' },
      { ...log[0], arrivedAtS: 4 },
      { ...log[0], arrivedAtS: null },
      { askedAtS: 5, arrivedAtS: 6, outcome: 'won' },
      { askedAtS: -1, arrivedAtS: 6, outcome: 'late' },
      { askedAtS: 5, arrivedAtS: 6, outcome: 'late', plan: 'even' },
      { askedAtS: 5, arrivedAtS: 4, outcome: 'late' },
    ]) {
      expect(readPacerDecisionRecord(bad)).toBeUndefined();
    }
  });
});

describe('where the rider is, in words — #2777', () => {
  it.each([
    [25, 10, 'ahead'],
    [20.1, 10, 'ahead'],
    [20, 10, 'level'],
    [-3, 10, 'level'],
    [-20, 10, 'level'],
    [-20.1, 10, 'behind'],
    [-250, 8, 'behind'],
  ] as const)('reads a rider %s m ahead at %s m/s as %s', (gap, speed, place) => {
    expect(riderPlaceOf(gap, speed)).toBe(place);
  });

  it('says no place at a standstill, or from a reading that is not a number', () => {
    expect(riderPlaceOf(40, 0)).toBeUndefined();
    expect(riderPlaceOf(Number.NaN, 10)).toBeUndefined();
    expect(riderPlaceOf(40, Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it.each([
    [{ atS: 0, riderGapM: 0 }, { atS: 5, riderGapM: 2 }, 'rider-gaining'],
    [{ atS: 0, riderGapM: -10 }, { atS: 5, riderGapM: -7 }, 'rider-gaining'],
    [{ atS: 0, riderGapM: 0 }, { atS: 5, riderGapM: -2 }, 'rider-losing'],
    [{ atS: 0, riderGapM: 30 }, { atS: 5, riderGapM: 25 }, 'rider-losing'],
    [{ atS: 0, riderGapM: 0 }, { atS: 5, riderGapM: 1 }, 'steady'],
    [{ atS: 0, riderGapM: 0 }, { atS: 5, riderGapM: -1 }, 'steady'],
  ] as const)('reads the gap from %j to %j as %s', (earlier, later, trend) => {
    expect(gapTrendOf(earlier, later)).toBe(trend);
  });

  it('says no trend when no time passed', () => {
    expect(gapTrendOf({ atS: 5, riderGapM: 0 }, { atS: 5, riderGapM: 9 })).toBeUndefined();
    expect(gapTrendOf({ atS: 6, riderGapM: 0 }, { atS: 5, riderGapM: 9 })).toBeUndefined();
  });

  it('reads a state that carries both, as the device sends it', () => {
    const placed: ModelPacerInput = { ...STATE, riderPlace: 'ahead', gapTrend: 'rider-gaining' };
    expect(readModelPacerInput(placed)).toEqual({ ok: true, value: placed });
  });
});

describe('the floor under the model’s intent — ADR 0078 (Proposed), #2777', () => {
  it('rides an ease as hold once the rider has been ahead long enough, keeping the plan', () => {
    expect(flooredDirection({ plan: 'climber', intent: 'ease' }, PACER_AHEAD_FLOOR_S)).toEqual({
      plan: 'climber',
      intent: 'hold',
    });
    expect(flooredDirection({ plan: 'even', intent: 'ease' }, 60)).toEqual({
      plan: 'even',
      intent: 'hold',
    });
  });

  it('rides every other direction as the model chose it, and never lifts', () => {
    const ease = { plan: 'rolling', intent: 'ease' } as const;
    expect(flooredDirection(ease, PACER_AHEAD_FLOOR_S - 0.1)).toBe(ease);
    expect(flooredDirection(ease, undefined)).toBe(ease);
    for (const intent of ['hold', 'lift'] as const) {
      const direction = { plan: 'rolling', intent } as const;
      expect(flooredDirection(direction, 600)).toBe(direction);
    }
  });
});

describe('the line says what the pacer does — #2777', () => {
  it.each([
    ['I will push on this climb, stay with me.', 'ease'],
    ['I will push on this climb, stay with me.', 'hold'],
    ['I’m going to lift the pace now.', 'hold'],
    ['Here I come, stay sharp.', 'hold'],
    ['I’ll chase you down on the climb.', 'ease'],
    ['Coming past you on this rise!', 'hold'],
    ['Watch me attack this rise.', 'ease'],
    ['Let’s pick up the pace together.', 'hold'],
    ['We will push to the top.', 'ease'],
    ['I am going to catch you on the descent.', 'ease'],
    ['I will pu​sh now.', 'ease'],
    ['I am easing off to let you bridge the gap.', 'lift'],
    ['I am slowing slightly so you can tuck back in behind me.', 'lift'],
    ['Waiting for you at the top.', 'lift'],
    ['Sitting up so you can come back to me.', 'lift'],
    ['I’ll back off a touch for you.', 'lift'],
  ] as const)('refuses “%s” under %s', (say, intent) => {
    // The screen passes every one: the refusal is the intent rule's alone.
    expect(pacerSayProblem(say)).toBeUndefined();
    expect(pacerSayAgainstIntent(say, intent)).toBe(true);
    expect(readModelPacerAnswer(answer({ intent, say }))).toEqual({
      ok: false,
      reason: 'say-against-intent',
    });
  });

  it.each([
    ['I will push on this climb, stay with me.', 'lift'],
    ['I am easing off to let you bridge the gap.', 'ease'],
    // The issue refuses an easing line only beside `lift`.
    ['I am easing off to let you bridge the gap.', 'hold'],
    ['Push through this rise, you are flying.', 'ease'],
    ['I see you pushing hard, lovely work.', 'ease'],
    ['I won’t push, take your time.', 'hold'],
    ['I am not going to push yet.', 'ease'],
    ['Ease a little and spin a lighter gear.', 'lift'],
    ['You are easing off, stay with me.', 'lift'],
    ['Lift your cadence to 90 rpm.', 'ease'],
    ['Nice and steady, stay on my wheel.', 'ease'],
    ['If you can, come round me on the next rise.', 'hold'],
  ] as const)('shows “%s” under %s', (say, intent) => {
    expect(pacerSayAgainstIntent(say, intent)).toBe(false);
    expect(readModelPacerAnswer(answer({ intent, say }))).toMatchObject({ ok: true, say });
  });

  it('reads easing and pushing apart, as the floor needs', () => {
    expect(pacerSaysEasing('I am easing off to let you bridge the gap.')).toBe(true);
    expect(pacerSaysPushing('I am easing off to let you bridge the gap.')).toBe(false);
    expect(pacerSaysPushing('I will push on this climb.')).toBe(true);
    expect(pacerSaysEasing('I will push on this climb.')).toBe(false);
  });
});
