// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { gradePercent } from '../quantities';
import {
  directedPacingFactor,
  directedPowerWatts,
  MODEL_PACER_ANSWER_MOST_CHARACTERS,
  MODEL_PACER_INPUT_MOST_CHARACTERS,
  MODEL_PACER_LAPSE_S,
  MODEL_PACER_LATE_S,
  MODEL_PACER_SAY_MOST_CHARACTERS,
  modelPacerAnswerSchema,
  PACER_INTENTS,
  PACER_PLANS,
  pacerDecisionRecord,
  pacerDirectionAt,
  pacerSayProblem,
  readModelPacerAnswer,
  readModelPacerInput,
  readPacerDecisionRecord,
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
    ['bad-say', answer({ say: 'Hold 250 watts.' })],
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
    ['markup', 'Push to 2 W/kg'],
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
