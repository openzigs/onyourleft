// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { gradePercent } from '../quantities';
import {
  directedPacingFactor,
  directedPowerWatts,
  gapTrendOf,
  MODEL_PACER_ANSWER_MOST_CHARACTERS,
  MODEL_PACER_INPUT_MOST_CHARACTERS,
  MODEL_PACER_LAPSE_S,
  MODEL_PACER_LATE_S,
  MODEL_PACER_RECENT_LINES,
  MODEL_PACER_REPEAT_MEMORY,
  MODEL_PACER_SAY_MOST_CHARACTERS,
  modelPacerAnswerSchema,
  PACER_CHASE_MOST,
  PACER_EASE,
  PACER_INTENTS,
  PACER_LIFT,
  PACER_PLANS,
  PACER_SAY_SAME_SHARE,
  PACER_START_RAMP_S,
  PACER_SURGE_LEAST,
  PACER_SURGE_MOST,
  PACER_SURGE_WINDOW_S,
  PACER_WAIT_MOST,
  pacerAskOutcome,
  pacerAsRidden,
  pacerDirectionAt,
  pacerSayRepeats,
  pacerSaysEasing,
  pacerSaysPushing,
  pacerSayProblem,
  pacerStartFrom,
  pacerStartShare,
  pacerSurgeAt,
  readModelPacerAnswer,
  readModelPacerInput,
  readPacerDecisionRecord,
  riderPlaceOf,
  type ModelPacerInput,
  type PacerDecisionRecord,
  type PacerIntent,
  type PacerRuleRecord,
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
  reason: 'rider-level',
  byPct: 0,
  starting: false,
};

const answer = (fields: Readonly<Record<string, unknown>>): string =>
  JSON.stringify({ say: 'Stay on my wheel.', ...fields });

/** What #2777's line rules read for an intent: an easing line beside `lift`, a pushing one beside the others. */
const saysAgainst = (say: string, intent: PacerIntent): boolean =>
  intent === 'lift' ? pacerSaysEasing(say) : pacerSaysPushing(say);

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
      // #2794: the course ahead at its widest.
      course: {
        climb: { inM: 5_000, lengthM: 5_000, avgPct: -100, maxPct: -100 },
        descent: { inM: 5_000, lengthM: 5_000, avgPct: -100, maxPct: -100 },
        lapLeftM: 999_999,
        climbLeftM: 999_999,
      },
    };
    expect(JSON.stringify(widest).length).toBeLessThanOrEqual(MODEL_PACER_INPUT_MOST_CHARACTERS);
    expect(readModelPacerInput(widest).ok).toBe(true);
  });
});

describe('what the model may answer — ADR 0072 D-3 and D-4, ADR 0083 D-2', () => {
  it('reads a line, and nothing else', () => {
    expect(readModelPacerAnswer(answer({}))).toEqual({ ok: true, say: 'Stay on my wheel.' });
    expect(readModelPacerAnswer(answer({ say: '' }))).toEqual({ ok: true, say: '' });
  });

  it('treats an answer with a power field as no answer at all', () => {
    expect(readModelPacerAnswer(answer({ watts: 900 }))).toEqual({
      ok: false,
      reason: 'unknown-key',
    });
    expect(readModelPacerAnswer(answer({ resistance: 'max' })).ok).toBe(false);
  });

  it('treats an answer that names a plan or an intent as no answer: the model directs nothing (#2835)', () => {
    for (const extra of [{ intent: 'lift' }, { plan: 'even' }, { plan: 'even', intent: 'ease' }]) {
      expect(readModelPacerAnswer(answer(extra))).toEqual({ ok: false, reason: 'unknown-key' });
    }
  });

  it('never returns a direction, whatever a model wrote', () => {
    const read = readModelPacerAnswer(answer({}));
    expect(Object.keys(read).sort()).toEqual(['ok', 'say']);
  });

  it.each([
    ['not-json', 'say: hello'],
    ['not-an-object', '["even"]'],
    ['bad-say', answer({ say: 7 })],
    ['bad-say', answer({ say: 'Hold 9000 watts.' })],
    ['bad-say', answer({ say: 'Your heart rate is 150.' })],
    ['too-long', answer({ say: 'a'.repeat(MODEL_PACER_ANSWER_MOST_CHARACTERS) })],
  ])('reads %s as no line', (reason, text) => {
    expect(readModelPacerAnswer(text)).toEqual({ ok: false, reason });
  });

  it('says what the server holds the model to: one capped line and no other field', () => {
    expect(modelPacerAnswerSchema()).toEqual({
      type: 'object',
      properties: {
        say: { type: 'string', maxLength: MODEL_PACER_SAY_MOST_CHARACTERS },
      },
      required: ['say'],
      additionalProperties: false,
    });
  });
});

describe('a line the pacer has just said — #2835', () => {
  const recent = ['Stay on my wheel.', 'Easing so you can get back on.'];

  it('reads the same words again as a repeat, whatever the case, spacing or punctuation', () => {
    expect(pacerSayRepeats('Stay on my wheel.', recent)).toBe(true);
    expect(pacerSayRepeats('stay on  my wheel!', recent)).toBe(true);
    expect(pacerSayRepeats('Easing, so you can get back on', recent)).toBe(true);
  });

  it('reads other words, and the empty line, as new', () => {
    expect(pacerSayRepeats('Stay on my wheel up this climb.', recent)).toBe(false);
    expect(pacerSayRepeats('Aim for 90 rpm.', recent)).toBe(false);
    expect(pacerSayRepeats('', [''])).toBe(false);
    expect(pacerSayRepeats('Stay on my wheel.', [])).toBe(false);
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
      say: 'Aim for 90 rpm.',
    });
  });
});

describe('what became of an ask for a line — ADR 0072 D-7', () => {
  const ok = readModelPacerAnswer(answer({}));

  it('is applied for an answer in time, and late past the limit, whatever it said', () => {
    expect(pacerAskOutcome(10, 12.5, ok)).toBe('applied');
    expect(pacerAskOutcome(10, 10 + MODEL_PACER_LATE_S, ok)).toBe('applied');
    expect(pacerAskOutcome(10, 10 + MODEL_PACER_LATE_S + 0.05, ok)).toBe('late');
  });

  it('is invalid, refused or failed for those answers', () => {
    expect(pacerAskOutcome(10, 11, readModelPacerAnswer('nope'))).toBe('invalid');
    expect(pacerAskOutcome(10, 11, 'refused')).toBe('refused');
    expect(pacerAskOutcome(10, 11, 'failed')).toBe('failed');
  });
});

describe('the decision log of a ride before #2835, and its decision in force — ADR 0072 D-5 and D-7', () => {
  const log: readonly PacerDecisionRecord[] = [
    { askedAtS: 5, arrivedAtS: 7, outcome: 'applied', plan: 'even', intent: 'lift' },
    { askedAtS: 10, arrivedAtS: 12, outcome: 'invalid' },
    { askedAtS: 15, arrivedAtS: 18, outcome: 'applied', plan: 'climber', intent: 'ease' },
  ];

  it('is #92’s rule before the first applied decision arrives', () => {
    expect(pacerDirectionAt(log, 6.95)).toBeUndefined();
    expect(pacerDirectionAt([], 100)).toBeUndefined();
  });

  it('applies a decision from its arrival until a newer one replaces it, with no start ramp', () => {
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

describe('the device’s decisions in the log, and the one in force — #2835, ADR 0083 D-5', () => {
  const WAIT: PacerRuleRecord = {
    askedAtS: 70,
    arrivedAtS: 71.5,
    outcome: 'applied',
    plan: 'rolling',
    intent: 'ease',
    by: 0.12,
    reason: 'rider-behind',
    place: 'behind',
    gapS: -6.8,
    line: 'shown',
  };
  const FAILED: PacerRuleRecord = {
    askedAtS: 75,
    arrivedAtS: null,
    outcome: 'failed',
    plan: 'rolling',
    intent: 'lift',
    by: 0.03,
    reason: 'rider-ahead',
    place: 'ahead',
    gapS: 4.4,
    line: 'none',
  };
  const STOPPED: PacerRuleRecord = {
    askedAtS: 80,
    arrivedAtS: 86,
    outcome: 'late',
    plan: 'rolling',
    intent: 'hold',
    reason: 'rider-level',
    line: 'none',
  };
  const log: readonly PacerDecisionRecord[] = [WAIT, FAILED, STOPPED];

  it('is in force from the ask, not from the answer’s arrival', () => {
    expect(pacerDirectionAt(log, 69.95)).toBeUndefined();
    expect(pacerDirectionAt(log, 70)).toEqual({ plan: 'rolling', intent: 'ease', by: 0.12 });
    expect(pacerDirectionAt(log, 71)).toEqual({ plan: 'rolling', intent: 'ease', by: 0.12 });
  });

  it('rides a decision whose line failed, was late, or never arrived: the answer costs a line, never the pacing', () => {
    const lift = { plan: 'rolling', intent: 'lift', by: 0.03 } as const;
    expect(pacerDirectionAt(log, 75)).toEqual(pacerAsRidden(lift, 75));
    expect(pacerDirectionAt(log, 79.95)).toEqual(pacerAsRidden(lift, 79.95));
    expect(pacerDirectionAt(log, 80)).toEqual(
      pacerAsRidden({ plan: 'rolling', intent: 'hold' }, 80),
    );
  });

  it('lapses a decision nothing replaced, counted from its ask', () => {
    const at = 80 + MODEL_PACER_LAPSE_S - 0.05;
    expect(pacerDirectionAt(log, at)).toEqual(
      pacerAsRidden({ plan: 'rolling', intent: 'hold' }, at),
    );
    expect(pacerDirectionAt(log, 80 + MODEL_PACER_LAPSE_S)).toBeUndefined();
  });

  it('rides a decision inside the start ramp from where the rider was, as the log keeps it', () => {
    const early: PacerRuleRecord = { ...STOPPED, askedAtS: 10, arrivedAtS: 11, startFrom: 0.62 };
    expect(readPacerDecisionRecord(early)).toEqual(early);
    expect(pacerDirectionAt([early], 15)).toEqual({
      plan: 'rolling',
      intent: 'hold',
      startFrom: 0.62,
      startShare: 15 / PACER_START_RAMP_S,
    });
  });

  it('rides the surge the seconds ridden give, live and on replay by one function', () => {
    // A window with a surge in it, found rather than assumed, so the seed may change.
    let at = PACER_START_RAMP_S;
    while (pacerSurgeAt(at) < PACER_SURGE_LEAST / 2) at += 0.5;
    const held: PacerRuleRecord = { ...STOPPED, askedAtS: at - 1, arrivedAtS: at };
    expect(pacerDirectionAt([held], at)).toEqual({
      plan: 'rolling',
      intent: 'hold',
      surge: pacerSurgeAt(at),
    });
  });

  it('logs a decision that asked for no line as `unasked`, and reads it back whole', () => {
    const quiet: PacerRuleRecord = { ...FAILED, outcome: 'unasked' };
    expect(readPacerDecisionRecord(quiet)).toEqual(quiet);
    expect(pacerDirectionAt([quiet], 76)).toEqual(
      pacerAsRidden({ plan: 'rolling', intent: 'lift', by: 0.03 }, 76),
    );
  });

  it('reads each record back whole', () => {
    for (const record of log) expect(readPacerDecisionRecord(record)).toEqual(record);
  });

  it('keeps numbers and closed words only: no line, and nothing a place could be written into', () => {
    for (const record of log) {
      for (const value of Object.values(record)) {
        expect(['number', 'string', 'object']).toContain(typeof value);
        if (typeof value === 'object') expect(value).toBeNull();
      }
    }
    expect(readPacerDecisionRecord({ ...WAIT, say: 'Stay on my wheel.' })).toBeUndefined();
    expect(readPacerDecisionRecord({ ...WAIT, at: [51.5, -0.12] })).toBeUndefined();
  });

  it.each([
    ['a reason outside the list', { ...WAIT, reason: 'felt-like-it' }],
    ['a line word outside the list', { ...WAIT, line: 'Stay on my wheel.' }],
    ['a place outside the list', { ...WAIT, place: 'Box Hill' }],
    ['a share past the envelope', { ...WAIT, by: 0.25 }],
    ['a lift past the envelope', { ...FAILED, by: 0.12 }],
    ['a share finer than a hundredth', { ...WAIT, by: 0.123 }],
    ['a share on a hold', { ...STOPPED, by: 0.05 }],
    ['an applied ask with no arrival', { ...WAIT, arrivedAtS: null }],
    ['a line shown for an ask that was not applied', { ...STOPPED, line: 'shown' }],
    ['an arrival before the ask', { ...WAIT, arrivedAtS: 60 }],
    ['a gap that is not a number', { ...WAIT, gapS: 'far' }],
    ['a plan outside the list', { ...WAIT, plan: 'sprint' }],
    ['an outcome outside the list', { ...WAIT, outcome: 'won' }],
    ['an unasked decision with an answer', { ...WAIT, outcome: 'unasked', line: 'none' }],
    ['an unasked decision with a line', { ...FAILED, outcome: 'unasked', line: 'repeat' }],
    ['a start above the envelope', { ...WAIT, startFrom: 1.2 }],
    ['a start below nothing', { ...WAIT, startFrom: -0.1 }],
    ['a start finer than a hundredth', { ...WAIT, startFrom: 0.555 }],
    ['an old-shape record that was unasked', { askedAtS: 5, arrivedAtS: null, outcome: 'unasked' }],
  ])('drops a record with %s', (_what, bad) => {
    expect(readPacerDecisionRecord(bad)).toBeUndefined();
  });
});

describe('how far an intent goes — #2835, ADR 0083 D-1', () => {
  it('eases and lifts by the share the direction carries, on the flat', () => {
    expect(directedPacingFactor({ plan: 'even', intent: 'ease', by: 0.15 }, 0)).toBeCloseTo(
      0.85,
      12,
    );
    expect(directedPacingFactor({ plan: 'even', intent: 'lift', by: 0.08 }, 0)).toBeCloseTo(
      1.08,
      12,
    );
    expect(directedPacingFactor({ plan: 'even', intent: 'hold' }, 0)).toBe(1);
  });

  it('rides the fixed shares with none, as every ride before #2835 did', () => {
    expect(directedPacingFactor({ plan: 'even', intent: 'ease' }, 0)).toBeCloseTo(
      1 - PACER_EASE,
      12,
    );
    expect(directedPacingFactor({ plan: 'even', intent: 'lift' }, 0)).toBeCloseTo(
      1 + PACER_LIFT,
      12,
    );
  });

  it('can reach the whole of #92’s envelope, and no further, whatever share it is handed', () => {
    expect(PACER_WAIT_MOST).toBeCloseTo(1 - PACING_FACTOR_FLOOR, 12);
    expect(PACER_CHASE_MOST).toBeCloseTo(PACING_FACTOR_CEILING - 1, 12);
    expect(directedPacingFactor({ plan: 'even', intent: 'ease', by: PACER_WAIT_MOST }, 0)).toBe(
      PACING_FACTOR_FLOOR,
    );
    expect(directedPacingFactor({ plan: 'even', intent: 'lift', by: PACER_CHASE_MOST }, 0)).toBe(
      PACING_FACTOR_CEILING,
    );
    for (const by of [0.9, 5, -3, Number.POSITIVE_INFINITY, Number.NaN]) {
      for (const intent of PACER_INTENTS) {
        for (const plan of PACER_PLANS) {
          for (let grade = -25; grade <= 25; grade += 0.5) {
            const factor = directedPacingFactor({ plan, intent, by }, grade);
            expect(factor).toBeGreaterThanOrEqual(PACING_FACTOR_FLOOR);
            expect(factor).toBeLessThanOrEqual(PACING_FACTOR_CEILING);
          }
        }
      }
    }
  });
});

describe('a gentle start — #2835, ADR 0083 D-3, and the owner’s ruling of 2026-11-20', () => {
  it('states its figure: 30 s, the owner’s “over about 30 s”', () => {
    expect(PACER_START_RAMP_S).toBe(30);
  });

  it('is a straight line from nothing at the start to the whole at 30 s, and nothing after', () => {
    expect(pacerStartShare(0)).toBe(0);
    expect(pacerStartShare(15)).toBe(0.5);
    expect(pacerStartShare(29.95)).toBeCloseTo(0.99833, 4);
    expect(pacerStartShare(30)).toBeUndefined();
    expect(pacerStartShare(600)).toBeUndefined();
    expect(pacerStartShare(-1)).toBeUndefined();
    expect(pacerStartShare(Number.NaN)).toBeUndefined();
  });

  it('starts from the rider’s own effort: their W/kg over the pacer’s, held to the ceiling', () => {
    expect(pacerStartFrom(2.3, 2.3)).toBe(1);
    expect(pacerStartFrom(1.15, 2.3)).toBe(0.5);
    expect(pacerStartFrom(0, 2.3)).toBe(0);
    expect(pacerStartFrom(0.1, 3)).toBe(0.03);
    expect(pacerStartFrom(6, 2.3)).toBe(PACING_FACTOR_CEILING);
    expect(pacerStartFrom(null, 2.3)).toBe(0);
    expect(pacerStartFrom(undefined, 2.3)).toBe(0);
    expect(pacerStartFrom(Number.NaN, 2.3)).toBe(0);
    expect(pacerStartFrom(-2, 2.3)).toBe(0);
    expect(pacerStartFrom(2, 0)).toBe(0);
  });

  it('rides as hard as the rider at the line, below the envelope if they are, and reaches the target without a step', () => {
    for (const plan of PACER_PLANS) {
      for (const intent of PACER_INTENTS) {
        for (const grade of [-8, -2, 0, 3, 9]) {
          for (const startFrom of [0, 0.4, 1, PACING_FACTOR_CEILING]) {
            const direction = { plan, intent, startFrom } as const;
            const target = directedPacingFactor({ plan, intent }, grade);
            expect(directedPacingFactor(pacerAsRidden(direction, 0), grade)).toBe(startFrom);
            expect(directedPacingFactor(pacerAsRidden(direction, 15), grade)).toBeCloseTo(
              (startFrom + target) / 2,
              12,
            );
            expect(directedPacingFactor(pacerAsRidden(direction, 29.999), grade)).toBeCloseTo(
              target,
              4,
            );
          }
        }
      }
    }
  });

  it('starts at the bottom of #92’s envelope for a decision from before the ruling, with no start kept', () => {
    const direction = pacerAsRidden({ plan: 'rolling', intent: 'hold' }, 0);
    expect(directedPacingFactor(direction, 0)).toBe(PACING_FACTOR_FLOOR);
  });

  it('is a power the rider’s own W/kg at the pacer’s 75 kg, at the line', () => {
    const plan = botPacerPlan(2.5);
    const direction = pacerAsRidden(
      { plan: 'rolling', intent: 'hold', startFrom: pacerStartFrom(1.5, 2.5) },
      0,
    );
    expect(directedPowerWatts(plan, gradePercent(0), direction)).toBeCloseTo(1.5 * 75, 9);
  });

  it('holds no surge inside the ramp', () => {
    for (let at = 0; at < PACER_START_RAMP_S; at += 0.25) expect(pacerSurgeAt(at)).toBe(0);
    const direction = { plan: 'rolling', intent: 'hold' } as const;
    expect(pacerAsRidden(direction, 12)).toEqual({ ...direction, startShare: 0.4 });
  });
});

describe('a power range, ridden like a person — the owner’s ruling of 2026-11-20', () => {
  const HOUR = 3_600;
  const samples = (): number[] => {
    const out: number[] = [];
    for (let at = PACER_START_RAMP_S; at < HOUR; at += 0.1) out.push(pacerSurgeAt(at));
    return out;
  };

  it('states its range: surges of 4 to 8 % above the target, recoveries half as deep', () => {
    expect(PACER_SURGE_LEAST).toBe(0.04);
    expect(PACER_SURGE_MOST).toBe(0.08);
  });

  it('surges above its target and recovers below it, within the range, in the first hour', () => {
    const seen = samples();
    expect(Math.max(...seen)).toBeGreaterThanOrEqual(PACER_SURGE_LEAST);
    expect(Math.max(...seen)).toBeLessThanOrEqual(PACER_SURGE_MOST);
    expect(Math.min(...seen)).toBeLessThanOrEqual(-PACER_SURGE_LEAST / 2);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(-PACER_SURGE_MOST / 2);
    // Not every minute: some of the ride is steady.
    expect(seen.filter((surge) => surge === 0).length / seen.length).toBeGreaterThan(0.3);
  });

  it('rides some whole windows steady, as a person does not surge every minute', () => {
    const windows = Math.floor((HOUR - PACER_START_RAMP_S) / PACER_SURGE_WINDOW_S);
    let steady = 0;
    for (let window = 0; window < windows; window += 1) {
      const from = PACER_START_RAMP_S + window * PACER_SURGE_WINDOW_S;
      let flat = true;
      for (let at = from; at < from + PACER_SURGE_WINDOW_S; at += 0.5) {
        if (pacerSurgeAt(at) !== 0) flat = false;
      }
      if (flat) steady += 1;
    }
    // About one in four, by the hash; neither none nor most.
    expect(steady).toBeGreaterThan(windows / 8);
    expect(steady).toBeLessThan(windows / 2);
  });

  it('never steps: a tenth of a second moves it by no more than an edge’s slope allows', () => {
    const seen = samples();
    for (let index = 1; index < seen.length; index += 1) {
      expect(Math.abs((seen[index] ?? 0) - (seen[index - 1] ?? 0))).toBeLessThanOrEqual(
        (PACER_SURGE_MOST / 2) * 0.1 + 1e-4,
      );
    }
  });

  it('is the same on every call: a function of the seconds ridden and nothing else', () => {
    expect(samples()).toEqual(samples());
    expect(pacerSurgeAt(Number.NaN)).toBe(0);
  });

  it('never surges away from a rider it is waiting for', () => {
    const wait = { plan: 'rolling', intent: 'ease', by: 0.12 } as const;
    for (let at = PACER_START_RAMP_S; at < 600; at += 1) expect(pacerAsRidden(wait, at)).toBe(wait);
  });

  it('surges a hold and a chase, and moves the pacer’s power by the surge', () => {
    let at = PACER_START_RAMP_S;
    while (pacerSurgeAt(at) < PACER_SURGE_LEAST - 1e-9) at += 0.5;
    const hold = pacerAsRidden({ plan: 'even', intent: 'hold' }, at);
    expect(hold.surge).toBe(pacerSurgeAt(at));
    expect(directedPacingFactor(hold, 0)).toBeCloseTo(1 + pacerSurgeAt(at), 12);
    expect(pacerAsRidden({ plan: 'even', intent: 'lift', by: 0.05 }, at).surge).toBe(
      pacerSurgeAt(at),
    );
  });

  it('never takes the pacer outside #92’s envelope past the ramp, whatever it is handed', () => {
    for (const surge of [0.08, -0.04, 0.5, -3, Number.NaN]) {
      for (const intent of PACER_INTENTS) {
        for (const plan of PACER_PLANS) {
          for (let grade = -25; grade <= 25; grade += 2.5) {
            const factor = directedPacingFactor({ plan, intent, by: 0.1, surge }, grade);
            expect(factor).toBeGreaterThanOrEqual(PACING_FACTOR_FLOOR);
            expect(factor).toBeLessThanOrEqual(PACING_FACTOR_CEILING);
          }
        }
      }
    }
  });
});

describe('a line said again, or nearly — the owner’s ruling of 2026-11-20', () => {
  it('states its figures: ten lines remembered, six in ten words in common', () => {
    expect(MODEL_PACER_REPEAT_MEMORY).toBe(10);
    expect(PACER_SAY_SAME_SHARE).toBe(0.6);
  });

  it.each([
    ['the same words', 'Stay on my wheel.', 'stay on  my WHEEL'],
    [
      'nearly the same words',
      'Easing a little so you can get back on.',
      'Easing so you can get back on',
    ],
    ['the same words reordered', 'Keep it steady, nice work.', 'Nice work, keep it steady.'],
  ])('is a repeat: %s', (_what, said, before) => {
    expect(pacerSayRepeats(said, ['Something else entirely here.', before])).toBe(true);
  });

  it.each([
    ['a new line', 'Climb starts soon, settle in.', 'Nice work, keep it steady.'],
    ['a line sharing a phrase', 'Keep it steady up this climb.', 'Nice work, keep it steady.'],
  ])('is not a repeat: %s', (_what, said, before) => {
    expect(pacerSayRepeats(said, [before])).toBe(false);
  });

  it('never calls an empty line a repeat', () => {
    expect(pacerSayRepeats('', [''])).toBe(false);
  });
});

describe('what the pacer is doing, in the state — #2835', () => {
  it('refuses a state from before the device decided: no reason, no share, no start', () => {
    for (const key of ['reason', 'byPct', 'starting'] as const) {
      const without = Object.fromEntries(Object.entries(STATE).filter(([name]) => name !== key));
      expect(readModelPacerInput(without)).toEqual({
        ok: false,
        problem: { field: `input.${key}`, problem: 'is required' },
      });
    }
  });

  it('reads the trends as numbers, each optional', () => {
    const told = {
      ...STATE,
      gapS: -6.8,
      placeForS: 90,
      gapDriftM: 12.5,
      powerDriftPct: -8,
      cadenceDriftRpm: -4,
      heartRateDriftBpm: 3,
    };
    expect(readModelPacerInput(told)).toEqual({ ok: true, value: told });
  });

  it.each([
    ['reason', 'because I felt like it'],
    ['byPct', 21],
    ['byPct', 7.5],
    ['starting', 'yes'],
    ['gapS', 'far'],
    ['placeForS', 1.5],
    ['gapDriftM', null],
    ['powerDriftPct', 0.5],
    ['cadenceDriftRpm', 300],
    ['heartRateDriftBpm', '3'],
  ])('refuses a bad %s, naming the field and never the value', (field, value) => {
    const read = readModelPacerInput({ ...STATE, [field]: value });
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.problem.field).toBe(`input.${field}`);
    expect(JSON.stringify(read.problem)).not.toContain(String(value));
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

describe('the course ahead, in the state — #2794', () => {
  const course = {
    climb: { inM: 300, lengthM: 800, avgPct: 5, maxPct: 8 },
    descent: null,
    lapLeftM: null,
    climbLeftM: 120,
  };

  it('reads a state with the course ahead, and one from before it with none', () => {
    const shown: ModelPacerInput = { ...STATE, course };
    expect(readModelPacerInput(JSON.parse(JSON.stringify(shown)) as unknown)).toEqual({
      ok: true,
      value: shown,
    });
    expect(readModelPacerInput({ ...STATE, course: { ...course, lapLeftM: 1_250 } }).ok).toBe(true);
    expect(readModelPacerInput(STATE).ok).toBe(true);
  });

  it.each([
    ['null', null],
    ['a name', { ...course, name: 'Box Hill' }],
    ['no climbing', { climb: null, descent: null, lapLeftM: null }],
    ['a hill with a place', { ...course, climb: { ...course.climb, at: 'Box Hill' } }],
    [
      'a hill out of reach',
      { ...course, descent: { inM: 9_000, lengthM: 300, avgPct: -4, maxPct: -6 } },
    ],
    ['negative climbing', { ...course, climbLeftM: -1 }],
    ['a lap as text', { ...course, lapLeftM: '1 km' }],
  ])('refuses a course with %s, naming the field and never the value', (_, value) => {
    const read = readModelPacerInput({ ...STATE, course: value });
    expect(read.ok ? undefined : read.problem.field).toBe('input.course');
    expect(JSON.stringify(read)).not.toContain('Box Hill');
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
    expect(saysAgainst(say, intent)).toBe(true);
    // #2835: such a line no longer voids anything on the way in; the device hides it.
    expect(readModelPacerAnswer(answer({ say }))).toEqual({ ok: true, say });
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
    expect(saysAgainst(say, intent)).toBe(false);
    expect(readModelPacerAnswer(answer({ say }))).toMatchObject({ ok: true, say });
  });

  it('reads easing and pushing apart, as the floor needs', () => {
    expect(pacerSaysEasing('I am easing off to let you bridge the gap.')).toBe(true);
    expect(pacerSaysPushing('I am easing off to let you bridge the gap.')).toBe(false);
    expect(pacerSaysPushing('I will push on this climb.')).toBe(true);
    expect(pacerSaysEasing('I will push on this climb.')).toBe(false);
  });
});
