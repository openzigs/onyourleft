// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  botPacerPlan,
  metres,
  metresPerSecond,
  MODEL_PACER_ASK_EVERY_S,
  MODEL_PACER_LATE_S,
  MODEL_PACER_SAY_SHOWN_S,
  readModelPacerInput,
  seconds,
  watts,
  type ModelPacerInput,
  type PacerDecisionRecord,
  type PacerDirection,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import type { PacerReply } from '../instance/pacer-port';
import { ALWAYS_SPOKEN, announce, INITIAL_ANNOUNCER, PRIORITY } from './hud/announce';
import { DEFAULT_ANNOUNCEMENTS } from './hud/announce-preference';
import type { TraceSample } from './hud/recent-trace';
import {
  heartRateTrend,
  ModelPacer,
  modelPacerInput,
  modelPacerSensorFields,
  powerTrend,
  secondsAtOrAbove,
  UNDIRECTED,
  type ModelPacerLink,
  type ModelPacerSensors,
} from './model-pacer';
import { rollingRoute } from './route-fixtures-testing';

/** `length` seconds of trace, each sample from `at(index)`. */
const traceOf = (length: number, at: (index: number) => TraceSample): TraceSample[] =>
  Array.from({ length }, (_, index) => at(index));

const NO_SENSORS: ModelPacerSensors = {
  power3s: undefined,
  trace: [],
  cadenceRpm: undefined,
  heartRateBpm: undefined,
  thresholdPower: undefined,
  thresholdHeartRate: undefined,
};

/** A link whose every decision waits until the test answers it. */
function heldLink() {
  const asked: { input: ModelPacerInput; answer: (reply: PacerReply) => void }[] = [];
  const calls = { start: 0, end: 0 };
  const link: ModelPacerLink = {
    startPacerRide: () => {
      calls.start += 1;
      return Promise.resolve(true);
    },
    decidePacer: (input) =>
      new Promise((resolve) => {
        asked.push({ input, answer: resolve });
      }),
    endPacerRide: () => {
      calls.end += 1;
      return Promise.resolve();
    },
  };
  return { link, asked, calls };
}

const STATE: ModelPacerInput = {
  pacerWPerKg: 2.5,
  plan: 'rolling',
  intent: 'hold',
  secondsInIntent: 0,
  riderGapM: -3,
  riderWPerKg: 2.4,
  riderInDraft: true,
  gradeAheadPct: 1,
  toFinishM: 900,
  rideS: 0,
};

/** One director, ridden frame by frame, with what it applied and logged. */
function ride(link: ModelPacerLink) {
  const records: PacerDecisionRecord[] = [];
  const applied: { direction: PacerDirection; from: number }[] = [];
  const pacer = new ModelPacer(link, (record) => records.push(record));
  const frame = (at: number) =>
    pacer.frame({
      riddenSeconds: at,
      input: (inForce) => ({
        ...STATE,
        plan: inForce.direction.plan,
        intent: inForce.direction.intent,
        rideS: Math.floor(at),
      }),
      direct: (direction, from) => applied.push({ direction, from }),
    });
  return { pacer, records, applied, frame };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const LIFT: PacerReply = {
  kind: 'answer',
  direction: { plan: 'climber', intent: 'lift' },
  say: 'Come with me up this rise.',
};

describe('the AI pacer during a ride — #2712, ADR 0072 D-7', () => {
  it('takes the slot at the start and asks every few seconds of riding, never waiting', async () => {
    const { link, asked, calls } = heldLink();
    const { frame } = ride(link);
    expect(calls.start).toBe(1);
    frame(0);
    expect(asked).toHaveLength(1);
    // Nothing more is asked while one is out, however long it takes.
    frame(MODEL_PACER_ASK_EVERY_S * 3);
    expect(asked).toHaveLength(1);
    asked[0]?.answer({ kind: 'failed' });
    await flush();
    frame(MODEL_PACER_ASK_EVERY_S * 3 + 0.05);
    // The next ask waits out its own interval from the last one.
    frame(MODEL_PACER_ASK_EVERY_S * 3 + 0.1);
    expect(asked).toHaveLength(2);
  });

  it('puts an answer in force from the seconds ridden it arrived at, logs it, and shows its line', async () => {
    const { link, asked } = heldLink();
    const { frame, records, applied, pacer } = ride(link);
    frame(10);
    asked[0]?.answer(LIFT);
    await flush();
    const arrived = frame(12.5);
    expect(applied).toEqual([{ direction: { plan: 'climber', intent: 'lift' }, from: 12.5 }]);
    expect(records).toEqual([
      { askedAtS: 10, arrivedAtS: 12.5, outcome: 'applied', plan: 'climber', intent: 'lift' },
    ]);
    expect(pacer.log()).toEqual(records);
    expect(arrived).toEqual({ arrived: LIFT.say, showing: LIFT.say });
    // Said once, shown for its time, then gone.
    expect(frame(13)).toEqual({ showing: LIFT.say });
    expect(frame(12.5 + MODEL_PACER_SAY_SHOWN_S)).toEqual({});
    // The next ask is told the direction in force and since when.
    asked[1]?.answer({ kind: 'failed' });
    expect(asked[1]?.input).toMatchObject({ plan: 'climber', intent: 'lift' });
  });

  it('logs a late answer and never rides it', async () => {
    const { link, asked } = heldLink();
    const { frame, records, applied } = ride(link);
    frame(0);
    asked[0]?.answer(LIFT);
    await flush();
    const late = frame(MODEL_PACER_LATE_S + 0.05);
    expect(applied).toEqual([]);
    expect(late).toEqual({});
    expect(records).toEqual([
      { askedAtS: 0, arrivedAtS: MODEL_PACER_LATE_S + 0.05, outcome: 'late' },
    ]);
  });

  it('logs an invalid and a failed answer and rides on, and stops asking after a refusal', async () => {
    const { link, asked } = heldLink();
    const { frame, records, applied } = ride(link);
    frame(0);
    asked[0]?.answer({ kind: 'invalid' });
    await flush();
    frame(1);
    frame(5);
    asked[1]?.answer({ kind: 'refused' });
    await flush();
    frame(6);
    frame(60);
    expect(asked).toHaveLength(2);
    expect(applied).toEqual([]);
    expect(records.map((each) => each.outcome)).toEqual(['invalid', 'refused']);
  });

  it('treats a link that throws as a failure', async () => {
    const link: ModelPacerLink = {
      startPacerRide: () => Promise.resolve(true),
      decidePacer: () => Promise.reject(new Error('unreachable')),
      endPacerRide: () => Promise.resolve(),
    };
    const { frame, records } = ride(link);
    frame(0);
    await flush();
    frame(1);
    expect(records).toEqual([{ askedAtS: 0, arrivedAtS: 1, outcome: 'failed' }]);
  });

  it('lets the slot go once at the end, and asks nothing after', async () => {
    const { link, asked, calls } = heldLink();
    const { frame, pacer } = ride(link);
    frame(0);
    pacer.end();
    pacer.end();
    expect(calls.end).toBe(1);
    asked[0]?.answer({ kind: 'failed' });
    await flush();
    frame(30);
    expect(asked).toHaveLength(1);
  });
});

describe('the pacer state the model is shown — #2712, ADR 0072 D-3', () => {
  const profile = rollingRoute();
  const state = {
    ride: { speed: metresPerSecond(8), distance: metres(240.04) },
    bot: {
      state: { speed: metresPerSecond(8), distance: metres(252.36) },
      distanceOnRoute: metres(252.36),
      grade: 0 as never,
      power: watts(190),
    },
    ridden: seconds(61.95),
    input: { power: watts(180), live: true },
    soloDraft: { k: 0.7, inDraft: true, inDraftMetres: 100, riddenMetres: 240 },
  };

  it('is built from the ride, holds no coordinate, and reads back as the domain’s shape', () => {
    const input = modelPacerInput({
      state,
      plan: botPacerPlan(2.5),
      profile,
      riderMassKilograms: 75,
      inForce: { direction: UNDIRECTED, since: 40 },
    });
    expect(input).toMatchObject({
      pacerWPerKg: 2.5,
      plan: 'rolling',
      intent: 'hold',
      secondsInIntent: 21,
      riderGapM: -12.3,
      riderWPerKg: 2.4,
      riderInDraft: true,
      rideS: 61,
    });
    expect(input.toFinishM).toBe(profile.loop ? null : Math.round(profile.totalDistance - 252.36));
    expect(readModelPacerInput(input)).toEqual({ ok: true, value: input });
    expect(JSON.stringify(input)).not.toMatch(/latitude|longitude|position/);
  });

  it('says no W/kg with no live power, and no draft without one', () => {
    const input = modelPacerInput({
      state: { ...state, input: { power: watts(0), live: false }, soloDraft: undefined },
      plan: botPacerPlan(2.5),
      profile,
      riderMassKilograms: 75,
      inForce: { direction: UNDIRECTED, since: 0 },
    });
    expect(input.riderWPerKg).toBeNull();
    expect(input.riderInDraft).toBe(false);
  });

  it('carries the sensor fields, and reads back as the domain’s shape — #2760', () => {
    const input = modelPacerInput({
      state,
      plan: botPacerPlan(2.5),
      profile,
      riderMassKilograms: 75,
      inForce: { direction: UNDIRECTED, since: 40 },
      sensors: { ...NO_SENSORS, power3s: 210, cadenceRpm: 72, heartRateBpm: 148 },
    });
    expect(input).toMatchObject({ rider3sWPerKg: 2.8, cadenceRpm: 72, heartRateBpm: 148 });
    expect(readModelPacerInput(input)).toEqual({ ok: true, value: input });
  });
});

describe('the model sees its own last lines, so it does not repeat itself — #2760', () => {
  const line = (say: string): PacerReply => ({
    kind: 'answer',
    direction: { plan: 'rolling', intent: 'hold' },
    say,
  });

  it('sends none before the first line, then the last three, oldest first, and keeps none in the log', async () => {
    const { link, asked } = heldLink();
    const { frame, pacer } = ride(link);
    const said = [
      'Nice and steady.',
      'Find a lighter gear.',
      '',
      'Stay with me.',
      'Ease a little.',
    ];
    let at = 0;
    frame(at);
    for (const say of said) {
      asked.at(-1)?.answer(line(say));
      await flush();
      at += MODEL_PACER_ASK_EVERY_S;
      frame(at);
    }
    expect(asked[0]?.input).not.toHaveProperty('recentLines');
    expect(asked[1]?.input.recentLines).toEqual(['Nice and steady.']);
    // An empty line says nothing, and is not one of the lines said.
    expect(asked[3]?.input.recentLines).toEqual(['Nice and steady.', 'Find a lighter gear.']);
    expect(asked.at(-1)?.input.recentLines).toEqual([
      'Find a lighter gear.',
      'Stay with me.',
      'Ease a little.',
    ]);
    for (const each of asked) expect(readModelPacerInput(each.input).ok).toBe(true);
    expect(JSON.stringify(pacer.log())).not.toMatch(/gear|steady|Ease/);
  });
});

describe('the rider’s own sensors in the state — #2760', () => {
  it('leaves every sensor out when none is live: nothing is guessed', () => {
    expect(modelPacerSensorFields(NO_SENSORS, 75)).toEqual({});
    const gaps = traceOf(120, () => ({ power: undefined, heartRate: undefined }));
    expect(modelPacerSensorFields({ ...NO_SENSORS, trace: gaps, thresholdPower: 250 }, 75)).toEqual(
      {},
    );
  });

  it('says power, its zone and the stretch above threshold, cadence, heart rate and its zone', () => {
    const trace = traceOf(60, (index) => ({
      power: index < 30 ? 300 : 240,
      heartRate: index < 30 ? 150 : 156,
    }));
    const fields = modelPacerSensorFields(
      {
        power3s: 240,
        trace,
        cadenceRpm: 61.6,
        heartRateBpm: 156.4,
        thresholdPower: 250,
        thresholdHeartRate: 170,
      },
      80,
    );
    expect(fields).toEqual({
      rider3sWPerKg: 3,
      riderMinuteWPerKg: 3.4,
      powerZone: 'Threshold',
      powerTrend: 'fading',
      aboveThresholdS: 0,
      cadenceRpm: 62,
      heartRateBpm: 156,
      // 156 of 170 is 92 %: tempo, 90 % to 94 %.
      heartRateZone: 'Tempo',
      heartRateTrend: 'rising',
    });
  });

  it('sends no minute average or trend once its sensor has dropped, though the trace still holds it', () => {
    const trace = traceOf(60, (index) => ({
      power: index < 30 ? 300 : 240,
      heartRate: index < 30 ? 150 : 156,
    }));
    const live = modelPacerSensorFields(
      { ...NO_SENSORS, power3s: 240, heartRateBpm: 156, trace },
      80,
    );
    expect(live).toHaveProperty('riderMinuteWPerKg');
    expect(live).toHaveProperty('powerTrend');
    expect(live).toHaveProperty('heartRateTrend');
    // Power dropped out, heart rate still reads.
    const noPower = modelPacerSensorFields({ ...NO_SENSORS, heartRateBpm: 156, trace }, 80);
    expect(noPower).not.toHaveProperty('riderMinuteWPerKg');
    expect(noPower).not.toHaveProperty('powerTrend');
    expect(noPower).toHaveProperty('heartRateTrend');
    // Heart rate dropped out, power still reads.
    const noHeart = modelPacerSensorFields({ ...NO_SENSORS, power3s: 240, trace }, 80);
    expect(noHeart).not.toHaveProperty('heartRateTrend');
    expect(noHeart).toHaveProperty('powerTrend');
  });

  it('leaves out a zone with no threshold set, and a reading out of range rather than clamping it', () => {
    const fields = modelPacerSensorFields(
      { ...NO_SENSORS, power3s: 200, cadenceRpm: 400, heartRateBpm: 5 },
      75,
    );
    expect(fields).toEqual({ rider3sWPerKg: 2.7 });
  });

  it('leaves out W/kg with no rider mass', () => {
    expect(modelPacerSensorFields({ ...NO_SENSORS, power3s: 200 }, 0)).toEqual({});
  });

  it('reads a trend only from a full minute with enough live seconds in each half', () => {
    const steady = traceOf(60, () => ({ power: 200, heartRate: 140 }));
    expect(powerTrend(steady)).toBe('steady');
    expect(heartRateTrend(steady)).toBe('steady');
    expect(powerTrend(steady.slice(1))).toBeUndefined();
    const rising = traceOf(60, (index) => ({
      power: index < 30 ? 200 : 211,
      heartRate: index < 30 ? 140 : 137,
    }));
    expect(powerTrend(rising)).toBe('rising');
    expect(heartRateTrend(rising)).toBe('falling');
    // Within 5 % and under 3 bpm is steady.
    const near = traceOf(60, (index) => ({
      power: index < 30 ? 200 : 209,
      heartRate: index < 30 ? 140 : 142,
    }));
    expect(powerTrend(near)).toBe('steady');
    expect(heartRateTrend(near)).toBe('steady');
    // A half with too few live seconds says nothing.
    const thin = traceOf(60, (index) => ({
      power: index < 30 && index % 4 !== 0 ? undefined : 200,
      heartRate: undefined,
    }));
    expect(powerTrend(thin)).toBeUndefined();
    expect(heartRateTrend(thin)).toBeUndefined();
  });

  it('counts the unbroken seconds at or above threshold, newest back, a gap ending it', () => {
    const trace = traceOf(10, (index) => ({
      power: [260, 200, undefined, 250, 270, 280, 300, 251, 255, 262][index],
      heartRate: undefined,
    }));
    expect(secondsAtOrAbove(trace, 250)).toBe(7);
    expect(secondsAtOrAbove(trace, 256)).toBe(1);
    expect(secondsAtOrAbove([], 250)).toBe(0);
    // A dropped second is not a second above threshold, and the stretch before it does not count.
    const dropped = [300, undefined, 260, 270].map((power) => ({ power, heartRate: undefined }));
    expect(secondsAtOrAbove(dropped, 250)).toBe(2);
  });
});

describe('the AI pacer’s line is spoken only with announcements on — #2712, the issue', () => {
  const said = (enabled: boolean) =>
    announce(INITIAL_ANNOUNCER, {
      now: 10,
      readings: [],
      events: [{ kind: 'pacer-say', text: 'Come with me up this rise.' }],
      preference: { ...DEFAULT_ANNOUNCEMENTS, enabled, powerEverySeconds: 'never' },
    }).sentence;

  it('says the line with announcements on, and nothing with them off', () => {
    expect(said(true)).toBe('Come with me up this rise.');
    expect(said(false)).toBeUndefined();
  });

  it('is the lowest event: any other event in the window wins', () => {
    expect(PRIORITY.indexOf('pacer-say')).toBe(PRIORITY.indexOf('lap-race-place') + 1);
    expect(PRIORITY.indexOf('pacer-say')).toBeLessThan(PRIORITY.indexOf('power-off-target'));
    expect(ALWAYS_SPOKEN).not.toContain('pacer-say');
  });
});
